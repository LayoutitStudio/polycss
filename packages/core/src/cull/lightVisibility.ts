/**
 * computeLightVisibility — for each polygon of a mesh, determines whether
 * direct light from a given direction physically reaches it (ray from the
 * polygon's centroid toward the light source is unblocked) or is occluded
 * by other geometry of the same mesh.
 *
 * This is the CPU equivalent of one shadow-map sample per polygon from the
 * light's POV. Used by the baked atlas pipeline so polygons in shadow get
 * lit with ambient-only color, matching Three.js's depth-pass occlusion.
 *
 * Algorithm: Möller-Trumbore ray-triangle intersection per candidate, with
 * a flat-array BVH for any-hit traversal. Cost: O(F log F) per mesh per
 * light direction. Cottage at ~240 polys: ~5-10 ms. Caller should cache by
 * (mesh geometry version, lightDir hash) and only recompute on change.
 */
import type { Polygon, Vec3 } from "../types";

const PARALLEL_EPS = 1e-9;
const MIN_HIT_T = 1e-3;
const RAY_ORIGIN_OFFSET = 1e-3;

interface PolyMeta {
  triFlat: Float64Array;
  centroid: Vec3;
  normal: Vec3;
  bcx: number; bcy: number; bcz: number; br2: number;
  minX: number; minY: number; minZ: number;
  maxX: number; maxY: number; maxZ: number;
}

function precompute(p: Polygon): PolyMeta | null {
  const verts = p.vertices;
  if (!verts || verts.length < 3) return null;
  let cx = 0, cy = 0, cz = 0;
  for (const [x, y, z] of verts) { cx += x; cy += y; cz += z; }
  const inv = 1 / verts.length;
  cx *= inv; cy *= inv; cz *= inv;
  const v0 = verts[0], v1 = verts[1], v2 = verts[2];
  const e1x = v1[0] - v0[0], e1y = v1[1] - v0[1], e1z = v1[2] - v0[2];
  const e2x = v2[0] - v0[0], e2y = v2[1] - v0[1], e2z = v2[2] - v0[2];
  let nx = e1y * e2z - e1z * e2y;
  let ny = e1z * e2x - e1x * e2z;
  let nz = e1x * e2y - e1y * e2x;
  const nLen = Math.hypot(nx, ny, nz);
  if (nLen < PARALLEL_EPS) return null;
  nx /= nLen; ny /= nLen; nz /= nLen;
  const nTri = verts.length - 2;
  const triFlat = new Float64Array(nTri * 9);
  let ti = 0;
  for (let i = 1; i < verts.length - 1; i++) {
    const a = verts[0], b = verts[i], c = verts[i + 1];
    triFlat[ti++] = a[0]; triFlat[ti++] = a[1]; triFlat[ti++] = a[2];
    triFlat[ti++] = b[0]; triFlat[ti++] = b[1]; triFlat[ti++] = b[2];
    triFlat[ti++] = c[0]; triFlat[ti++] = c[1]; triFlat[ti++] = c[2];
  }
  let br2 = 0;
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (const [x, y, z] of verts) {
    const ddx = x - cx, ddy = y - cy, ddz = z - cz;
    const d2 = ddx * ddx + ddy * ddy + ddz * ddz;
    if (d2 > br2) br2 = d2;
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
  }
  return {
    centroid: [cx, cy, cz], normal: [nx, ny, nz],
    triFlat, bcx: cx, bcy: cy, bcz: cz, br2,
    minX, minY, minZ, maxX, maxY, maxZ,
  };
}

function rayTriFlat(
  ox: number, oy: number, oz: number,
  dx: number, dy: number, dz: number,
  tf: Float64Array, base: number,
): boolean {
  const ax = tf[base], ay = tf[base + 1], az = tf[base + 2];
  const e1x = tf[base + 3] - ax, e1y = tf[base + 4] - ay, e1z = tf[base + 5] - az;
  const e2x = tf[base + 6] - ax, e2y = tf[base + 7] - ay, e2z = tf[base + 8] - az;
  const hx = dy * e2z - dz * e2y;
  const hy = dz * e2x - dx * e2z;
  const hz = dx * e2y - dy * e2x;
  const det = e1x * hx + e1y * hy + e1z * hz;
  if (det > -PARALLEL_EPS && det < PARALLEL_EPS) return false;
  const invDet = 1 / det;
  const sx = ox - ax, sy = oy - ay, sz = oz - az;
  const u = invDet * (sx * hx + sy * hy + sz * hz);
  if (u < 0 || u > 1) return false;
  const qx = sy * e1z - sz * e1y;
  const qy = sz * e1x - sx * e1z;
  const qz = sx * e1y - sy * e1x;
  const v = invDet * (dx * qx + dy * qy + dz * qz);
  if (v < 0 || u + v > 1) return false;
  return invDet * (e2x * qx + e2y * qy + e2z * qz) > MIN_HIT_T;
}

function rayHitsPolygon(
  ox: number, oy: number, oz: number,
  dx: number, dy: number, dz: number,
  q: PolyMeta,
): boolean {
  const vx = q.bcx - ox, vy = q.bcy - oy, vz = q.bcz - oz;
  const proj = vx * dx + vy * dy + vz * dz;
  const perpX = vx - proj * dx;
  const perpY = vy - proj * dy;
  const perpZ = vz - proj * dz;
  if (perpX * perpX + perpY * perpY + perpZ * perpZ > q.br2) return false;
  const tf = q.triFlat;
  const n = tf.length;
  for (let b = 0; b < n; b += 9) {
    if (rayTriFlat(ox, oy, oz, dx, dy, dz, tf, b)) return true;
  }
  return false;
}

// Flat-array SAH BVH (mirrors cullInteriorPolygons). Node layout:
//   [0..5] AABB minX minY minZ maxX maxY maxZ
//   [6]    isLeaf (1/0)
//   [7,8]  leaf: start,end into polyIndices; internal: left,right
const BVH_STRIDE = 9;
const BVH_LEAF_SIZE = 6;
const SAH_BUCKETS = 12;

interface BVH {
  data: Float64Array;
  nodeCount: number;
  polyIndices: Int32Array;
  meta: Array<PolyMeta | null>;
}

function aabbSA(minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number): number {
  const dx = maxX - minX, dy = maxY - minY, dz = maxZ - minZ;
  return dx * dy + dy * dz + dz * dx;
}

function buildBVH(meta: Array<PolyMeta | null>): BVH {
  const valid: number[] = [];
  for (let i = 0; i < meta.length; i++) { if (meta[i]) valid.push(i); }
  const n = valid.length;
  const polyIndices = new Int32Array(n);
  for (let i = 0; i < n; i++) polyIndices[i] = valid[i];
  const centX = new Float64Array(n);
  const centY = new Float64Array(n);
  const centZ = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const m = meta[polyIndices[i]]!;
    centX[i] = (m.minX + m.maxX) * 0.5;
    centY[i] = (m.minY + m.maxY) * 0.5;
    centZ[i] = (m.minZ + m.maxZ) * 0.5;
  }
  const maxNodes = 2 * Math.max(1, n) + 1;
  const data = new Float64Array(maxNodes * BVH_STRIDE);
  let nodeCount = 0;
  const bMinX = new Float64Array(SAH_BUCKETS);
  const bMinY = new Float64Array(SAH_BUCKETS);
  const bMinZ = new Float64Array(SAH_BUCKETS);
  const bMaxX = new Float64Array(SAH_BUCKETS);
  const bMaxY = new Float64Array(SAH_BUCKETS);
  const bMaxZ = new Float64Array(SAH_BUCKETS);
  const bCnt  = new Int32Array(SAH_BUCKETS);
  const lSA   = new Float64Array(SAH_BUCKETS - 1);
  const lCnt  = new Int32Array(SAH_BUCKETS - 1);
  const rSA   = new Float64Array(SAH_BUCKETS - 1);
  const rCnt  = new Int32Array(SAH_BUCKETS - 1);
  function buildNode(start: number, end: number): number {
    const ni = nodeCount++;
    const base = ni * BVH_STRIDE;
    const count = end - start;
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (let i = start; i < end; i++) {
      const m = meta[polyIndices[i]]!;
      if (m.minX < minX) minX = m.minX; if (m.maxX > maxX) maxX = m.maxX;
      if (m.minY < minY) minY = m.minY; if (m.maxY > maxY) maxY = m.maxY;
      if (m.minZ < minZ) minZ = m.minZ; if (m.maxZ > maxZ) maxZ = m.maxZ;
    }
    data[base] = minX; data[base + 1] = minY; data[base + 2] = minZ;
    data[base + 3] = maxX; data[base + 4] = maxY; data[base + 5] = maxZ;
    if (count <= BVH_LEAF_SIZE) {
      data[base + 6] = 1; data[base + 7] = start; data[base + 8] = end;
      return ni;
    }
    let cxMin = Infinity, cyMin = Infinity, czMin = Infinity;
    let cxMax = -Infinity, cyMax = -Infinity, czMax = -Infinity;
    for (let i = start; i < end; i++) {
      if (centX[i] < cxMin) cxMin = centX[i]; if (centX[i] > cxMax) cxMax = centX[i];
      if (centY[i] < cyMin) cyMin = centY[i]; if (centY[i] > cyMax) cyMax = centY[i];
      if (centZ[i] < czMin) czMin = centZ[i]; if (centZ[i] > czMax) czMax = centZ[i];
    }
    const extX = cxMax - cxMin, extY = cyMax - cyMin, extZ = czMax - czMin;
    if (extX === 0 && extY === 0 && extZ === 0) {
      data[base + 6] = 1; data[base + 7] = start; data[base + 8] = end;
      return ni;
    }
    const nodeSA = aabbSA(minX, minY, minZ, maxX, maxY, maxZ);
    const invSA = nodeSA > 0 ? 1 / nodeSA : 0;
    let bestCost = count + 1;
    let bestAxis = 0, bestSplitVal = 0;
    for (let axis = 0; axis < 3; axis++) {
      const cMin = axis === 0 ? cxMin : (axis === 1 ? cyMin : czMin);
      const ext  = axis === 0 ? extX  : (axis === 1 ? extY  : extZ);
      if (ext === 0) continue;
      const centArr = axis === 0 ? centX : (axis === 1 ? centY : centZ);
      const scale = SAH_BUCKETS / ext;
      bMinX.fill(Infinity); bMinY.fill(Infinity); bMinZ.fill(Infinity);
      bMaxX.fill(-Infinity); bMaxY.fill(-Infinity); bMaxZ.fill(-Infinity);
      bCnt.fill(0);
      for (let i = start; i < end; i++) {
        let b = (centArr[i] - cMin) * scale | 0;
        if (b >= SAH_BUCKETS) b = SAH_BUCKETS - 1;
        const m = meta[polyIndices[i]]!;
        if (m.minX < bMinX[b]) bMinX[b] = m.minX; if (m.maxX > bMaxX[b]) bMaxX[b] = m.maxX;
        if (m.minY < bMinY[b]) bMinY[b] = m.minY; if (m.maxY > bMaxY[b]) bMaxY[b] = m.maxY;
        if (m.minZ < bMinZ[b]) bMinZ[b] = m.minZ; if (m.maxZ > bMaxZ[b]) bMaxZ[b] = m.maxZ;
        bCnt[b]++;
      }
      let lx0 = Infinity, ly0 = Infinity, lz0 = Infinity;
      let lx1 = -Infinity, ly1 = -Infinity, lz1 = -Infinity;
      let lc = 0;
      for (let k = 0; k < SAH_BUCKETS - 1; k++) {
        if (bMinX[k] < lx0) lx0 = bMinX[k]; if (bMaxX[k] > lx1) lx1 = bMaxX[k];
        if (bMinY[k] < ly0) ly0 = bMinY[k]; if (bMaxY[k] > ly1) ly1 = bMaxY[k];
        if (bMinZ[k] < lz0) lz0 = bMinZ[k]; if (bMaxZ[k] > lz1) lz1 = bMaxZ[k];
        lc += bCnt[k];
        lSA[k] = aabbSA(lx0, ly0, lz0, lx1, ly1, lz1);
        lCnt[k] = lc;
      }
      let rx0 = Infinity, ry0 = Infinity, rz0 = Infinity;
      let rx1 = -Infinity, ry1 = -Infinity, rz1 = -Infinity;
      let rc = 0;
      for (let k = SAH_BUCKETS - 2; k >= 0; k--) {
        const kb = k + 1;
        if (bMinX[kb] < rx0) rx0 = bMinX[kb]; if (bMaxX[kb] > rx1) rx1 = bMaxX[kb];
        if (bMinY[kb] < ry0) ry0 = bMinY[kb]; if (bMaxY[kb] > ry1) ry1 = bMaxY[kb];
        if (bMinZ[kb] < rz0) rz0 = bMinZ[kb]; if (bMaxZ[kb] > rz1) rz1 = bMaxZ[kb];
        rc += bCnt[kb];
        rSA[k] = aabbSA(rx0, ry0, rz0, rx1, ry1, rz1);
        rCnt[k] = rc;
      }
      for (let k = 0; k < SAH_BUCKETS - 1; k++) {
        if (lCnt[k] === 0 || rCnt[k] === 0) continue;
        const cost = 0.125 + (lSA[k] * lCnt[k] + rSA[k] * rCnt[k]) * invSA;
        if (cost < bestCost) {
          bestCost = cost;
          bestAxis = axis;
          bestSplitVal = cMin + (k + 1) / scale;
        }
      }
    }
    const centArr2 = bestAxis === 0 ? centX : (bestAxis === 1 ? centY : centZ);
    let lo = start, hi = end - 1;
    while (lo <= hi) {
      if (centArr2[lo] < bestSplitVal) {
        lo++;
      } else {
        const tmp = polyIndices[lo]; polyIndices[lo] = polyIndices[hi]; polyIndices[hi] = tmp;
        const t0 = centX[lo]; centX[lo] = centX[hi]; centX[hi] = t0;
        const t1 = centY[lo]; centY[lo] = centY[hi]; centY[hi] = t1;
        const t2 = centZ[lo]; centZ[lo] = centZ[hi]; centZ[hi] = t2;
        hi--;
      }
    }
    let mid = lo;
    if (mid === start || mid === end) mid = (start + end) >> 1;
    data[base + 6] = 0;
    const left = buildNode(start, mid);
    const right = buildNode(mid, end);
    data[ni * BVH_STRIDE + 7] = left;
    data[ni * BVH_STRIDE + 8] = right;
    return ni;
  }
  if (n > 0) buildNode(0, n);
  return { data, nodeCount, polyIndices, meta };
}

function rayHitsAnyInBVH(
  ox: number, oy: number, oz: number,
  dx: number, dy: number, dz: number,
  selfIdx: number,
  bvh: BVH,
  stack: Int32Array,
): boolean {
  if (bvh.nodeCount === 0) return false;
  const { data, polyIndices, meta } = bvh;
  const invDx = dx !== 0 ? 1 / dx : (dx >= 0 ? Infinity : -Infinity);
  const invDy = dy !== 0 ? 1 / dy : (dy >= 0 ? Infinity : -Infinity);
  const invDz = dz !== 0 ? 1 / dz : (dz >= 0 ? Infinity : -Infinity);
  let top = 0;
  stack[top++] = 0;
  while (top > 0) {
    const ni = stack[--top];
    const base = ni * BVH_STRIDE;
    const tx1 = (data[base]     - ox) * invDx;
    const tx2 = (data[base + 3] - ox) * invDx;
    let tMin = tx1 < tx2 ? tx1 : tx2;
    let tMax = tx1 < tx2 ? tx2 : tx1;
    const ty1 = (data[base + 1] - oy) * invDy;
    const ty2 = (data[base + 4] - oy) * invDy;
    const tyMin = ty1 < ty2 ? ty1 : ty2;
    const tyMax = ty1 < ty2 ? ty2 : ty1;
    if (tMin > tyMax || tyMin > tMax) continue;
    if (tyMin > tMin) tMin = tyMin;
    if (tyMax < tMax) tMax = tyMax;
    const tz1 = (data[base + 2] - oz) * invDz;
    const tz2 = (data[base + 5] - oz) * invDz;
    const tzMin = tz1 < tz2 ? tz1 : tz2;
    const tzMax = tz1 < tz2 ? tz2 : tz1;
    if (tMin > tzMax || tzMin > tMax) continue;
    if (tzMax < tMax) tMax = tzMax;
    if (tMax < MIN_HIT_T) continue;
    if (data[base + 6] === 1) {
      const start = data[base + 7] | 0;
      const end   = data[base + 8] | 0;
      for (let k = start; k < end; k++) {
        const j = polyIndices[k];
        if (j === selfIdx) continue;
        const q = meta[j];
        if (q && rayHitsPolygon(ox, oy, oz, dx, dy, dz, q)) return true;
      }
    } else {
      stack[top++] = data[base + 7] | 0;
      stack[top++] = data[base + 8] | 0;
    }
  }
  return false;
}

/**
 * Returns a Set of polygon indices that are OCCLUDED from the light
 * (a ray from the polygon's centroid in the +lightDir direction hits
 * another polygon of the same mesh before escaping to infinity).
 *
 * `lightDir` is the direction TO the light source (matching the
 * convention used by `shadePolygon`'s caller — points from the
 * surface toward the light).
 *
 * Caller should cache by mesh-geometry version + lightDir hash;
 * recompute only when either changes.
 */
export function computeLightVisibility(
  polygons: readonly Polygon[],
  lightDir: Vec3,
): Set<number> {
  const occluded = new Set<number>();
  if (polygons.length < 2) return occluded;
  const lLen = Math.hypot(lightDir[0], lightDir[1], lightDir[2]);
  if (lLen < PARALLEL_EPS) return occluded;
  const lx = lightDir[0] / lLen, ly = lightDir[1] / lLen, lz = lightDir[2] / lLen;
  const meta: Array<PolyMeta | null> = polygons.map(precompute);
  const bvh = buildBVH(meta);
  const stack = new Int32Array(Math.max(64, bvh.nodeCount));
  for (let i = 0; i < polygons.length; i++) {
    const p = meta[i];
    if (!p) continue;
    // Push origin slightly along the OUTWARD NORMAL so the ray doesn't
    // immediately self-hit the polygon's own plane (Möller-Trumbore is
    // sensitive to t close to 0). The offset is in mesh units; geometry
    // at parser scale typically spans ~1-10 units, so 1e-3 = 0.001 units
    // is safely sub-feature-size.
    const ox = p.centroid[0] + p.normal[0] * RAY_ORIGIN_OFFSET;
    const oy = p.centroid[1] + p.normal[1] * RAY_ORIGIN_OFFSET;
    const oz = p.centroid[2] + p.normal[2] * RAY_ORIGIN_OFFSET;
    // Back-facing-to-light polys can never be lit (n·L <= 0). Don't
    // call them occluded — that's a different concept handled by the
    // standard Lambert formula. Mark them as "no direct light" via
    // the front-face dot test outside; here we only care about
    // front-facing polys that are blocked by other geometry.
    const ndotL = p.normal[0] * lx + p.normal[1] * ly + p.normal[2] * lz;
    if (ndotL <= 0) continue;
    if (rayHitsAnyInBVH(ox, oy, oz, lx, ly, lz, i, bvh, stack)) {
      occluded.add(i);
    }
  }
  return occluded;
}
