/**
 * computeCameraVisibility — the CAMERA twin of computeLightVisibility.
 *
 * Where `computeLightVisibility` ray-casts each polygon centroid toward a
 * distant LIGHT direction (parallel rays to infinity) to decide "does light
 * reach this face", this decides "can the CAMERA at `eye` see this face": is a
 * ray from `eye` to the face centroid unblocked by other opaque geometry of
 * the same mesh, is the face front-facing to the eye, and (optionally) is it
 * inside the view frustum. It is the CPU equivalent of one visibility sample
 * per polygon from the camera's POV — exactly the shadow machinery re-keyed on
 * the camera position instead of the light vector.
 *
 * The one geometric difference from the light case: the camera is a POINT, so
 * the occlusion ray has a FINITE length (the eye→centroid distance). A hit
 * BEYOND the eye is behind the camera and does not occlude; the traversal
 * clamps `tMax` to that distance.
 *
 * Cost: O(F log F) to build the flat-array SAH BVH once, then O(log F) per
 * polygon per camera position. Callers that sample MANY camera positions over
 * one static mesh (per-cell PVS bake) build the context once with
 * `createCameraVisibilityContext` and query it per cell — the BVH is not
 * rebuilt per query, unlike the one-shot `computeLightVisibility`.
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
  tf: Float64Array, base: number, tMax: number,
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
  const t = invDet * (e2x * qx + e2y * qy + e2z * qz);
  return t > MIN_HIT_T && t < tMax;
}

function rayHitsPolygon(
  ox: number, oy: number, oz: number,
  dx: number, dy: number, dz: number,
  tMax: number,
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
    if (rayTriFlat(ox, oy, oz, dx, dy, dz, tf, b, tMax)) return true;
  }
  return false;
}

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
  tMax: number,
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
    let tBoxMax = tx1 < tx2 ? tx2 : tx1;
    const ty1 = (data[base + 1] - oy) * invDy;
    const ty2 = (data[base + 4] - oy) * invDy;
    const tyMin = ty1 < ty2 ? ty1 : ty2;
    const tyMax = ty1 < ty2 ? ty2 : ty1;
    if (tMin > tyMax || tyMin > tBoxMax) continue;
    if (tyMin > tMin) tMin = tyMin;
    if (tyMax < tBoxMax) tBoxMax = tyMax;
    const tz1 = (data[base + 2] - oz) * invDz;
    const tz2 = (data[base + 5] - oz) * invDz;
    const tzMin = tz1 < tz2 ? tz1 : tz2;
    const tzMax = tz1 < tz2 ? tz2 : tz1;
    if (tMin > tzMax || tzMin > tBoxMax) continue;
    if (tzMax < tBoxMax) tBoxMax = tzMax;
    // The occlusion ray is a SEGMENT eye→centroid: reject boxes entirely
    // before MIN_HIT_T or entirely beyond the target distance tMax.
    if (tBoxMax < MIN_HIT_T || tMin > tMax) continue;
    if (data[base + 6] === 1) {
      const start = data[base + 7] | 0;
      const end   = data[base + 8] | 0;
      for (let k = start; k < end; k++) {
        const j = polyIndices[k];
        if (j === selfIdx) continue;
        const q = meta[j];
        if (q && rayHitsPolygon(ox, oy, oz, dx, dy, dz, tMax, q)) return true;
      }
    } else {
      stack[top++] = data[base + 7] | 0;
      stack[top++] = data[base + 8] | 0;
    }
  }
  return false;
}

export interface CameraFrustum {
  /** Unit (or any-length) forward direction the camera looks along. */
  forward: Vec3;
  /** Full horizontal field of view in radians. */
  fovRadians: number;
}

export interface CameraVisibilityQueryOptions {
  /** Optional view frustum; when omitted the query is omni-directional
   * (occlusion + front-facing only) — the correct mode for a per-cell PVS
   * bake that must cover every look direction from the cell. */
  frustum?: CameraFrustum;
  /** Treat faces within this distance of the eye as always visible (skip the
   * occlusion ray). Guards against a face the eye is sitting flush against. */
  nearVisibleDistance?: number;
}

/**
 * A reusable camera-visibility context: precomputes per-polygon metadata and
 * the BVH ONCE so a caller can query many camera positions (per-cell PVS bake)
 * without rebuilding. `skipIndices` drops overlapping/duplicate polygons (e.g.
 * coincident two-sided wall twins) from being occlusion candidates.
 */
export interface CameraVisibilityContext {
  readonly polygonCount: number;
  query(eye: Vec3, options?: CameraVisibilityQueryOptions): Set<number>;
  /** Convenience: is at least one polygon in `indices` visible from `eye`? */
  anyVisible(eye: Vec3, indices: Iterable<number>, options?: CameraVisibilityQueryOptions): boolean;
}

export function createCameraVisibilityContext(
  polygons: readonly Polygon[],
  skipIndices?: ReadonlySet<number>,
): CameraVisibilityContext {
  const meta: Array<PolyMeta | null> = polygons.map(precompute);
  if (skipIndices && skipIndices.size > 0) {
    for (const i of skipIndices) meta[i] = null;
  }
  const bvh = buildBVH(meta);
  const stack = new Int32Array(Math.max(64, bvh.nodeCount * 2));

  const isVisible = (i: number, ex: number, ey: number, ez: number, options?: CameraVisibilityQueryOptions): boolean => {
    const p = meta[i];
    if (!p) return false;
    const toEyeX = ex - p.centroid[0];
    const toEyeY = ey - p.centroid[1];
    const toEyeZ = ez - p.centroid[2];
    const dist = Math.hypot(toEyeX, toEyeY, toEyeZ);
    if (dist < PARALLEL_EPS) return true;
    // Front-facing: the outward normal must point toward the eye. Faces whose
    // lit side faces away are back-faces the compositor hides — never visible.
    const ndotV = p.normal[0] * toEyeX + p.normal[1] * toEyeY + p.normal[2] * toEyeZ;
    if (ndotV <= 0) return false;
    const invDist = 1 / dist;
    const dirX = toEyeX * invDist, dirY = toEyeY * invDist, dirZ = toEyeZ * invDist;
    if (options?.frustum) {
      const f = options.frustum;
      const fLen = Math.hypot(f.forward[0], f.forward[1], f.forward[2]) || 1;
      const fx = f.forward[0] / fLen, fy = f.forward[1] / fLen, fz = f.forward[2] / fLen;
      // Angle between the view axis and the eye→centroid direction (note dir
      // points centroid→eye, so the camera→centroid direction is its negation).
      const cosToFace = -(dirX * fx + dirY * fy + dirZ * fz);
      if (cosToFace < Math.cos(f.fovRadians * 0.5)) return false;
    }
    if (options?.nearVisibleDistance !== undefined && dist <= options.nearVisibleDistance) return true;
    // Occlusion segment: origin just off the face along its outward normal,
    // toward the eye, length = dist. A hit before the eye blocks the view.
    const ox = p.centroid[0] + p.normal[0] * RAY_ORIGIN_OFFSET;
    const oy = p.centroid[1] + p.normal[1] * RAY_ORIGIN_OFFSET;
    const oz = p.centroid[2] + p.normal[2] * RAY_ORIGIN_OFFSET;
    return !rayHitsAnyInBVH(ox, oy, oz, dirX, dirY, dirZ, dist - RAY_ORIGIN_OFFSET, i, bvh, stack);
  };

  return {
    polygonCount: polygons.length,
    query(eye, options) {
      const visible = new Set<number>();
      for (let i = 0; i < polygons.length; i++) {
        if (isVisible(i, eye[0], eye[1], eye[2], options)) visible.add(i);
      }
      return visible;
    },
    anyVisible(eye, indices, options) {
      for (const i of indices) {
        if (isVisible(i, eye[0], eye[1], eye[2], options)) return true;
      }
      return false;
    },
  };
}

/**
 * One-shot camera visibility (the direct twin of `computeLightVisibility`):
 * returns the set of polygon indices POTENTIALLY VISIBLE from `eye` — those
 * that are front-facing, inside the optional frustum, and not fully occluded
 * by other polygons of the same mesh. Builds a throwaway BVH; callers sampling
 * many positions should use `createCameraVisibilityContext` instead.
 */
export function computeCameraVisibility(
  polygons: readonly Polygon[],
  eye: Vec3,
  options?: CameraVisibilityQueryOptions,
  skipIndices?: ReadonlySet<number>,
): Set<number> {
  return createCameraVisibilityContext(polygons, skipIndices).query(eye, options);
}
