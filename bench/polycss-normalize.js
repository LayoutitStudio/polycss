// packages/core/src/math/quaternion.ts
var DEG_TO_RAD = Math.PI / 180;
var RAD_TO_DEG = 180 / Math.PI;

// packages/core/src/merge/mergePolygons.ts
var EPS_NORMAL = 1e-3;
var EPS_DISTANCE = 0.05;
var EPS_TEXTURE_DISTANCE = 1e-3;
var EPS_RENDER_DISTANCE = 1e-3;
var sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
var cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0]
];
var dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
var norm = (a) => Math.hypot(a[0], a[1], a[2]);
var eqVec = (a, b) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
function edgeKey(a, b) {
  const ka = `${a[0]},${a[1]},${a[2]}`;
  const kb = `${b[0]},${b[1]},${b[2]}`;
  return ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
}
function planeOf(vertices) {
  if (vertices.length < 3) return null;
  const e1 = sub(vertices[1], vertices[0]);
  const e2 = sub(vertices[2], vertices[0]);
  const n = cross(e1, e2);
  const len = norm(n);
  if (len < 1e-12) return null;
  const normal = [n[0] / len, n[1] / len, n[2] / len];
  const d = dot(normal, vertices[0]);
  return { normal, d };
}
function samePlane(a, b) {
  const dotN = dot(a.normal, b.normal);
  if (dotN < 1 - EPS_NORMAL) return false;
  return Math.abs(a.d - b.d) < EPS_DISTANCE;
}
function sameTexturePlane(a, b) {
  const dotN = dot(a.normal, b.normal);
  if (dotN < 1 - EPS_NORMAL) return false;
  return Math.abs(a.d - b.d) < EPS_TEXTURE_DISTANCE;
}
function mergeAlongEdge(a, b, e0, e1) {
  const ai0 = a.vertices.findIndex((v) => eqVec(v, e0));
  const ai1 = a.vertices.findIndex((v) => eqVec(v, e1));
  const bi0 = b.vertices.findIndex((v) => eqVec(v, e0));
  const bi1 = b.vertices.findIndex((v) => eqVec(v, e1));
  if (ai0 < 0 || ai1 < 0 || bi0 < 0 || bi1 < 0) return null;
  const an = a.vertices.length;
  const bn = b.vertices.length;
  const aGoesForward = (ai0 + 1) % an === ai1;
  const bGoesForward = (bi0 + 1) % bn === bi1;
  if (aGoesForward === bGoesForward) return null;
  const aStart = aGoesForward ? ai1 : ai0;
  const aEnd = aGoesForward ? ai0 : ai1;
  const bStart = bGoesForward ? bi1 : bi0;
  const bEnd = bGoesForward ? bi0 : bi1;
  const trackUvs = !!(a.uvs && b.uvs);
  const merged = [];
  const mergedUvs = trackUvs ? [] : void 0;
  let i = aStart;
  while (true) {
    merged.push(a.vertices[i]);
    if (mergedUvs) mergedUvs.push(a.uvs[i]);
    if (i === aEnd) break;
    i = (i + 1) % an;
  }
  i = bStart;
  while (true) {
    merged.push(b.vertices[i]);
    if (mergedUvs) mergedUvs.push(b.uvs[i]);
    if (i === bEnd) break;
    i = (i + 1) % bn;
  }
  const dedupV = [];
  const dedupU = mergedUvs ? [] : void 0;
  for (let k = 0; k < merged.length; k++) {
    if (dedupV.length === 0 || !eqVec(merged[k], dedupV[dedupV.length - 1])) {
      dedupV.push(merged[k]);
      if (dedupU && mergedUvs) dedupU.push(mergedUvs[k]);
    }
  }
  if (dedupV.length > 1 && eqVec(dedupV[0], dedupV[dedupV.length - 1])) {
    dedupV.pop();
    dedupU?.pop();
  }
  if (trackUvs) return rotateToNonCollinearStart(dedupV, dedupU);
  const cleaned = [];
  const cleanedUvs = dedupU ? [] : void 0;
  for (let k = 0; k < dedupV.length; k++) {
    const prev = dedupV[(k - 1 + dedupV.length) % dedupV.length];
    const cur = dedupV[k];
    const next = dedupV[(k + 1) % dedupV.length];
    const c = cross(sub(cur, prev), sub(next, prev));
    if (norm(c) > 1e-9) {
      cleaned.push(cur);
      if (cleanedUvs && dedupU) cleanedUvs.push(dedupU[k]);
    }
  }
  if (cleaned.length < 3) return null;
  return rotateToNonCollinearStart(cleaned, cleanedUvs);
}
function isConvex(vertices, normal) {
  const n = vertices.length;
  let sign = 0;
  for (let i = 0; i < n; i++) {
    const a = vertices[i];
    const b = vertices[(i + 1) % n];
    const c = vertices[(i + 2) % n];
    const e1 = sub(b, a);
    const e2 = sub(c, b);
    const turn = dot(cross(e1, e2), normal);
    if (Math.abs(turn) < 1e-9) continue;
    const s = turn > 0 ? 1 : -1;
    if (sign === 0) sign = s;
    else if (s !== sign) return false;
  }
  return true;
}
function mergeIsPlanar(vertices, epsilon) {
  if (vertices.length < 3) return false;
  const plane = planeOf(vertices);
  if (!plane) return false;
  for (const vertex of vertices) {
    if (Math.abs(dot(plane.normal, vertex) - plane.d) > epsilon) {
      return false;
    }
  }
  return true;
}
function cloneTextureTriangles(triangles) {
  return triangles.map((triangle) => ({
    vertices: triangle.vertices.map((vertex) => [...vertex]),
    uvs: triangle.uvs.map((uv) => [...uv])
  }));
}
function fanTextureTriangles(vertices, uvs) {
  const triangles = [];
  for (let i = 1; i < vertices.length - 1; i++) {
    triangles.push({
      vertices: [
        [...vertices[0]],
        [...vertices[i]],
        [...vertices[i + 1]]
      ],
      uvs: [
        [...uvs[0]],
        [...uvs[i]],
        [...uvs[i + 1]]
      ]
    });
  }
  return triangles;
}
function rotateToNonCollinearStart(vertices, uvs) {
  for (let i = 0; i < vertices.length; i++) {
    const a = vertices[i];
    const b = vertices[(i + 1) % vertices.length];
    const c = vertices[(i + 2) % vertices.length];
    if (norm(cross(sub(b, a), sub(c, a))) <= 1e-9) continue;
    if (i === 0) return { vertices, uvs };
    return {
      vertices: [...vertices.slice(i), ...vertices.slice(0, i)],
      uvs: uvs ? [...uvs.slice(i), ...uvs.slice(0, i)] : void 0
    };
  }
  return { vertices, uvs };
}
function mergePolygons(input) {
  const out = [];
  const polys = [];
  for (const polygon of input ?? []) {
    if (!polygon || !polygon.vertices || polygon.vertices.length < 3) {
      if (polygon) out.push(polygon);
      continue;
    }
    const verts = polygon.vertices.map((v) => [v[0], v[1], v[2]]);
    const plane = planeOf(verts);
    if (!plane) {
      out.push(polygon);
      continue;
    }
    const uvs = polygon.texture && polygon.uvs && polygon.uvs.length === verts.length ? polygon.uvs.map((uv) => [uv[0], uv[1]]) : void 0;
    const textureTriangles = polygon.texture && uvs ? polygon.textureTriangles?.length ? cloneTextureTriangles(polygon.textureTriangles) : fanTextureTriangles(verts, uvs) : void 0;
    polys.push({
      vertices: verts,
      uvs,
      color: polygon.color ?? "#cccccc",
      texture: polygon.texture,
      textureTriangles,
      normal: plane.normal,
      d: plane.d,
      alive: true,
      data: polygon.data
    });
  }
  const tryMergePass = () => {
    const edgeIndex = /* @__PURE__ */ new Map();
    for (let i = 0; i < polys.length; i++) {
      const p = polys[i];
      if (!p.alive) continue;
      const n = p.vertices.length;
      for (let k = 0; k < n; k++) {
        const a = p.vertices[k];
        const b = p.vertices[(k + 1) % n];
        const key = edgeKey(a, b);
        let arr = edgeIndex.get(key);
        if (!arr) {
          arr = [];
          edgeIndex.set(key, arr);
        }
        arr.push(i);
      }
    }
    let mergedThisPass = false;
    const findSharedEdge = (a, b) => {
      for (let k = 0; k < a.vertices.length; k++) {
        const va = a.vertices[k];
        const vb = a.vertices[(k + 1) % a.vertices.length];
        for (let j = 0; j < b.vertices.length; j++) {
          const ub = b.vertices[j];
          const uc = b.vertices[(j + 1) % b.vertices.length];
          if (eqVec(va, uc) && eqVec(vb, ub)) return [va, vb];
        }
      }
      return null;
    };
    for (const [, owners] of edgeIndex) {
      if (owners.length < 2) continue;
      const [ai, bi] = owners;
      if (ai === bi) continue;
      const a = polys[ai];
      const b = polys[bi];
      if (!a.alive || !b.alive) continue;
      if (a.color !== b.color) continue;
      if (a.texture !== b.texture) continue;
      const hasTexture = Boolean(a.texture || b.texture);
      if (hasTexture && (!a.textureTriangles || !b.textureTriangles)) continue;
      if (!!a.uvs !== !!b.uvs) continue;
      if (hasTexture ? !sameTexturePlane(a, b) : !samePlane(a, b)) continue;
      const shared = findSharedEdge(a, b);
      if (!shared) continue;
      const [e0, e1] = shared;
      const merged = mergeAlongEdge(a, b, e0, e1);
      if (!merged) continue;
      if (!mergeIsPlanar(merged.vertices, hasTexture ? EPS_TEXTURE_DISTANCE : EPS_RENDER_DISTANCE)) continue;
      if (!isConvex(merged.vertices, a.normal)) continue;
      a.vertices = merged.vertices;
      a.uvs = merged.uvs;
      a.textureTriangles = hasTexture ? [...a.textureTriangles ?? [], ...b.textureTriangles ?? []] : void 0;
      b.alive = false;
      mergedThisPass = true;
    }
    return mergedThisPass;
  };
  while (tryMergePass()) {
  }
  for (const p of polys) {
    if (!p.alive) continue;
    const out_p = {
      vertices: p.vertices,
      color: p.color
    };
    if (p.texture) out_p.texture = p.texture;
    if (p.uvs) out_p.uvs = p.uvs;
    if (p.textureTriangles?.length) out_p.textureTriangles = p.textureTriangles;
    if (p.data) out_p.data = p.data;
    out.push(out_p);
  }
  return out;
}

// packages/core/src/merge/dedupeOverlappingPolygons.ts
var DEFAULT_NORMAL_TOLERANCE = 1e-3;
var DEFAULT_DISTANCE_TOLERANCE = 0.05;
var DEFAULT_OVERLAP_FRACTION = 0.7;
var BUCKET_NORMAL_STEP = 0.05;
var sub2 = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
var cross2 = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0]
];
var dot2 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
function computeMeta(polygon, index) {
  const v = polygon.vertices;
  if (!v || v.length < 3) return null;
  let nx = 0, ny = 0, nz = 0;
  for (let i = 0; i < v.length; i++) {
    const a = v[i];
    const b = v[(i + 1) % v.length];
    nx += (a[1] - b[1]) * (a[2] + b[2]);
    ny += (a[2] - b[2]) * (a[0] + b[0]);
    nz += (a[0] - b[0]) * (a[1] + b[1]);
  }
  const nLen = Math.hypot(nx, ny, nz);
  if (nLen < 1e-12) return null;
  const normal = [nx / nLen, ny / nLen, nz / nLen];
  let cx = 0, cy = 0, cz = 0;
  for (const p of v) {
    cx += p[0];
    cy += p[1];
    cz += p[2];
  }
  const inv = 1 / v.length;
  const centroid = [cx * inv, cy * inv, cz * inv];
  const d = dot2(normal, centroid);
  const area = nLen * 0.5;
  return {
    index,
    polygon,
    normal,
    d,
    centroid,
    area,
    local2D: null,
    bbox2D: null,
    basis: null
  };
}
function planeBasis(normal) {
  const axis = Math.abs(normal[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  let ux = axis[0] - normal[0] * dot2(axis, normal);
  let uy = axis[1] - normal[1] * dot2(axis, normal);
  let uz = axis[2] - normal[2] * dot2(axis, normal);
  const uLen = Math.hypot(ux, uy, uz);
  ux /= uLen;
  uy /= uLen;
  uz /= uLen;
  const u = [ux, uy, uz];
  const v = cross2(normal, u);
  return { u, v };
}
function ensure2D(meta) {
  if (meta.local2D) return;
  const basis2 = planeBasis(meta.normal);
  const local2D = [];
  let minU = Infinity, minV = Infinity;
  let maxU = -Infinity, maxV = -Infinity;
  for (const p of meta.polygon.vertices) {
    const u = dot2(p, basis2.u);
    const v = dot2(p, basis2.v);
    local2D.push([u, v]);
    if (u < minU) minU = u;
    if (u > maxU) maxU = u;
    if (v < minV) minV = v;
    if (v > maxV) maxV = v;
  }
  meta.local2D = local2D;
  meta.bbox2D = { min: [minU, minV], max: [maxU, maxV] };
  meta.basis = basis2;
}
function projectInto(polygon, basis2) {
  const local2D = [];
  let minU = Infinity, minV = Infinity;
  let maxU = -Infinity, maxV = -Infinity;
  for (const p of polygon.vertices) {
    const u = dot2(p, basis2.u);
    const v = dot2(p, basis2.v);
    local2D.push([u, v]);
    if (u < minU) minU = u;
    if (u > maxU) maxU = u;
    if (v < minV) minV = v;
    if (v > maxV) maxV = v;
  }
  return { local2D, bbox2D: { min: [minU, minV], max: [maxU, maxV] } };
}
function bboxOverlap2D(a, b) {
  return a.max[0] >= b.min[0] && a.min[0] <= b.max[0] && a.max[1] >= b.min[1] && a.min[1] <= b.max[1];
}
function pointInPolygon2D(p, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    const intersect = a[1] > p[1] !== b[1] > p[1] && p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1] + 1e-30) + a[0];
    if (intersect) inside = !inside;
  }
  return inside;
}
function centroid2D(poly) {
  let cx = 0, cy = 0;
  for (const p of poly) {
    cx += p[0];
    cy += p[1];
  }
  return [cx / poly.length, cy / poly.length];
}
function overlapScore2D(a, b) {
  const aC = centroid2D(a);
  const bC = centroid2D(b);
  const inset = 1e-4;
  let hitsAinB = 0;
  for (const p of a) {
    const testP = [
      p[0] + (aC[0] - p[0]) * inset,
      p[1] + (aC[1] - p[1]) * inset
    ];
    if (pointInPolygon2D(testP, b)) hitsAinB++;
  }
  let hitsBinA = 0;
  for (const p of b) {
    const testP = [
      p[0] + (bC[0] - p[0]) * inset,
      p[1] + (bC[1] - p[1]) * inset
    ];
    if (pointInPolygon2D(testP, a)) hitsBinA++;
  }
  const aIn = hitsAinB / a.length;
  const bIn = hitsBinA / b.length;
  return Math.max(aIn, bIn);
}
function bucketKey(meta, distanceTolerance) {
  let nx = meta.normal[0], ny = meta.normal[1], nz = meta.normal[2];
  const absX = Math.abs(nx), absY = Math.abs(ny), absZ = Math.abs(nz);
  let dominant = nx;
  if (absY > absX && absY > absZ) dominant = ny;
  else if (absZ > absX && absZ > absY) dominant = nz;
  if (dominant < 0) {
    nx = -nx;
    ny = -ny;
    nz = -nz;
  }
  const qx = Math.round(nx / BUCKET_NORMAL_STEP);
  const qy = Math.round(ny / BUCKET_NORMAL_STEP);
  const qz = Math.round(nz / BUCKET_NORMAL_STEP);
  const dAbs = meta.d * (meta.normal[0] === nx && meta.normal[1] === ny && meta.normal[2] === nz ? 1 : -1);
  const qd = Math.round(dAbs / (distanceTolerance * 2));
  return `${qx},${qy},${qz}|${qd}`;
}
function coplanar(a, b, normalTolerance, distanceTolerance) {
  const d = dot2(a.normal, b.normal);
  if (Math.abs(d) < 1 - normalTolerance) return false;
  const sign = d > 0 ? 1 : -1;
  return Math.abs(a.d - sign * b.d) < distanceTolerance;
}
function facesInward(meta, meshCentroid) {
  const toCenter = sub2(meshCentroid, meta.centroid);
  return dot2(meta.normal, toCenter) > 0;
}
function findOverlappingPolygonDuplicates(input, options) {
  if (!input || input.length < 2) return /* @__PURE__ */ new Set();
  const normalTolerance = options?.normalTolerance ?? DEFAULT_NORMAL_TOLERANCE;
  const distanceTolerance = options?.distanceTolerance ?? DEFAULT_DISTANCE_TOLERANCE;
  const overlapFraction = options?.overlapFraction ?? DEFAULT_OVERLAP_FRACTION;
  const metas = [];
  for (let i = 0; i < input.length; i++) {
    const m = computeMeta(input[i], i);
    if (m) metas.push(m);
  }
  if (metas.length < 2) return /* @__PURE__ */ new Set();
  let mcx = 0, mcy = 0, mcz = 0, totalArea = 0;
  for (const m of metas) {
    mcx += m.centroid[0] * m.area;
    mcy += m.centroid[1] * m.area;
    mcz += m.centroid[2] * m.area;
    totalArea += m.area;
  }
  const meshCentroid = totalArea > 0 ? [mcx / totalArea, mcy / totalArea, mcz / totalArea] : [0, 0, 0];
  const buckets = /* @__PURE__ */ new Map();
  for (const m of metas) {
    const key = bucketKey(m, distanceTolerance);
    let arr = buckets.get(key);
    if (!arr) {
      arr = [];
      buckets.set(key, arr);
    }
    arr.push(m);
  }
  const dropped = /* @__PURE__ */ new Set();
  for (const arr of buckets.values()) {
    if (arr.length < 2) continue;
    for (let i = 0; i < arr.length; i++) {
      const a = arr[i];
      if (dropped.has(a.index)) continue;
      for (let j = i + 1; j < arr.length; j++) {
        const b = arr[j];
        if (dropped.has(b.index)) continue;
        if (!coplanar(a, b, normalTolerance, distanceTolerance)) continue;
        ensure2D(a);
        const bProj = projectInto(b.polygon, a.basis);
        if (!bboxOverlap2D(a.bbox2D, bProj.bbox2D)) continue;
        const score = overlapScore2D(a.local2D, bProj.local2D);
        if (score < overlapFraction) continue;
        const aInward = facesInward(a, meshCentroid);
        const bInward = facesInward(b, meshCentroid);
        let drop;
        if (aInward && !bInward) drop = a;
        else if (bInward && !aInward) drop = b;
        else drop = a.area < b.area ? a : b;
        dropped.add(drop.index);
        if (drop === a) break;
      }
    }
  }
  return dropped;
}

// packages/core/src/merge/coverPlanarPolygons.ts
var DEFAULT_MIN_GROUP = 4;
var DEFAULT_MAX_AXES = 8;
var DEFAULT_PLANE_EPSILON = 1e-3;
var EPS = 1e-9;
var LOCAL_ROUND = 1e6;
var WORLD_ROUND = 1e6;
var sub3 = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
var add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
var scale = (v, n) => [v[0] * n, v[1] * n, v[2] * n];
var dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
var cross3 = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0]
];
var length = (v) => Math.hypot(v[0], v[1], v[2]);
function normalize(v) {
  const len = length(v);
  if (len <= EPS) return null;
  return [v[0] / len, v[1] / len, v[2] / len];
}
function round(value, factor) {
  return Math.round(value * factor) / factor;
}
function roundLocal(value) {
  return round(value, LOCAL_ROUND);
}
function roundWorld(value) {
  return round(value, WORLD_ROUND);
}
function eq2(a, b) {
  return Math.abs(a[0] - b[0]) <= 1e-7 && Math.abs(a[1] - b[1]) <= 1e-7;
}
function pointKey(point) {
  return `${roundLocal(point[0])},${roundLocal(point[1])}`;
}
function undirectedSegmentKey(segment) {
  const ak = pointKey(segment.a);
  const bk = pointKey(segment.b);
  return ak < bk ? `${ak}|${bk}` : `${bk}|${ak}`;
}
function vecKey(v) {
  return `${v[0]},${v[1]},${v[2]}`;
}
function edgeKey2(a, b) {
  const ak = vecKey(a);
  const bk = vecKey(b);
  return ak < bk ? `${ak}|${bk}` : `${bk}|${ak}`;
}
function dataKey(data) {
  if (!data) return "";
  return Object.keys(data).sort().map((key) => `${key}:${String(data[key])}`).join("|");
}
function materialKey(polygon) {
  return [
    polygon.color ?? "#cccccc",
    polygon.texture ?? "",
    polygon.uvs ? "uv" : "plain",
    dataKey(polygon.data)
  ].join("|");
}
function planeOf2(polygon) {
  const vertices = polygon.vertices;
  if (!vertices || vertices.length < 3) return null;
  const origin = vertices[0];
  let normalSum = [0, 0, 0];
  for (let i = 1; i < vertices.length - 1; i++) {
    normalSum = add(normalSum, cross3(sub3(vertices[i], origin), sub3(vertices[i + 1], origin)));
  }
  const normal = normalize(normalSum);
  if (!normal) return null;
  return { normal, d: dot3(normal, origin) };
}
function samePlane2(a, b, epsilon) {
  return dot3(a.normal, b.normal) > 1 - epsilon && Math.abs(a.d - b.d) <= epsilon;
}
function canCover(polygon) {
  return !polygon.texture && !polygon.uvs && !polygon.textureTriangles;
}
function sharedData(group, polygons) {
  const first = polygons[group[0]]?.data;
  const firstKey = dataKey(first);
  for (const index of group) {
    if (dataKey(polygons[index].data) !== firstKey) return void 0;
  }
  return first ? { ...first } : void 0;
}
function buildGroups(polygons, planeEpsilon) {
  const planes = polygons.map((polygon) => canCover(polygon) ? planeOf2(polygon) : null);
  const eligible = planes.map(Boolean);
  const edgeOwners = /* @__PURE__ */ new Map();
  for (let i = 0; i < polygons.length; i++) {
    if (!planes[i]) continue;
    const vertices = polygons[i].vertices;
    for (let edge = 0; edge < vertices.length; edge++) {
      const key = edgeKey2(vertices[edge], vertices[(edge + 1) % vertices.length]);
      const owners = edgeOwners.get(key);
      const owner = { polygon: i, edge };
      if (owners) owners.push(owner);
      else edgeOwners.set(key, [owner]);
    }
  }
  const adjacency = polygons.map(() => /* @__PURE__ */ new Set());
  for (const owners of edgeOwners.values()) {
    if (owners.length < 2) continue;
    for (let i = 0; i < owners.length; i++) {
      for (let j = i + 1; j < owners.length; j++) {
        const a = owners[i].polygon;
        const b = owners[j].polygon;
        const planeA = planes[a];
        const planeB = planes[b];
        if (!planeA || !planeB) continue;
        if (materialKey(polygons[a]) !== materialKey(polygons[b])) continue;
        if (!samePlane2(planeA, planeB, planeEpsilon)) continue;
        adjacency[a].add(b);
        adjacency[b].add(a);
      }
    }
  }
  const visited = /* @__PURE__ */ new Set();
  const groups = [];
  for (let i = 0; i < polygons.length; i++) {
    if (!eligible[i] || visited.has(i)) continue;
    const group = [];
    const queue = [i];
    visited.add(i);
    while (queue.length > 0) {
      const current = queue.shift();
      group.push(current);
      for (const next of adjacency[current]) {
        if (visited.has(next)) continue;
        visited.add(next);
        queue.push(next);
      }
    }
    groups.push(group);
  }
  return { groups };
}
function boundaryEdgesForGroup(group, polygons) {
  const groupSet = new Set(group);
  const owners = /* @__PURE__ */ new Map();
  for (const polygonIndex of group) {
    const vertices = polygons[polygonIndex].vertices;
    for (let edge = 0; edge < vertices.length; edge++) {
      const key = edgeKey2(vertices[edge], vertices[(edge + 1) % vertices.length]);
      const list = owners.get(key);
      const owner = { polygon: polygonIndex, edge };
      if (list) list.push(owner);
      else owners.set(key, [owner]);
    }
  }
  const boundary = [];
  for (const list of owners.values()) {
    const localOwners = list.filter((owner) => groupSet.has(owner.polygon));
    if (localOwners.length === 1) {
      const owner = localOwners[0];
      const vertices = polygons[owner.polygon].vertices;
      boundary.push({
        a: vertices[owner.edge],
        b: vertices[(owner.edge + 1) % vertices.length]
      });
    } else if (localOwners.length !== 2) {
      return null;
    }
  }
  return boundary;
}
function boundaryIsClosed(boundary) {
  const degree = /* @__PURE__ */ new Map();
  for (const edge of boundary) {
    degree.set(vecKey(edge.a), (degree.get(vecKey(edge.a)) ?? 0) + 1);
    degree.set(vecKey(edge.b), (degree.get(vecKey(edge.b)) ?? 0) + 1);
  }
  for (const count of degree.values()) {
    if (count % 2 !== 0) return false;
  }
  return true;
}
function canonicalAxis(axis) {
  const out = [axis[0], axis[1], axis[2]];
  const major = Math.abs(out[0]) >= Math.abs(out[1]) && Math.abs(out[0]) >= Math.abs(out[2]) ? 0 : Math.abs(out[1]) >= Math.abs(out[2]) ? 1 : 2;
  if (out[major] < 0) return [-out[0], -out[1], -out[2]];
  return out;
}
function axisKey(axis) {
  const canonical = canonicalAxis(axis);
  return `${round(canonical[0], 1e3)},${round(canonical[1], 1e3)},${round(canonical[2], 1e3)}`;
}
function fallbackAxis(normal) {
  const seed = Math.abs(normal[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  const projected = sub3(seed, scale(normal, dot3(seed, normal)));
  return normalize(projected) ?? [1, 0, 0];
}
function candidateAxes(boundary, normal, maxAxes) {
  const byKey = /* @__PURE__ */ new Map();
  for (const edge of boundary) {
    const edgeVector = sub3(edge.b, edge.a);
    const projected = sub3(edgeVector, scale(normal, dot3(edgeVector, normal)));
    const axis = normalize(projected);
    if (!axis) continue;
    const canonical = canonicalAxis(axis);
    const key = axisKey(canonical);
    const weight = length(projected);
    const current = byKey.get(key);
    if (current) current.weight += weight;
    else byKey.set(key, { axis: canonical, weight });
  }
  const axes = [...byKey.values()].sort((a, b) => b.weight - a.weight).slice(0, maxAxes).map((candidate) => candidate.axis);
  if (axes.length === 0) axes.push(fallbackAxis(normal));
  return axes;
}
function projectPoint(point, origin, xAxis, yAxis) {
  const local = sub3(point, origin);
  return [roundLocal(dot3(local, xAxis)), roundLocal(dot3(local, yAxis))];
}
function uniqueSorted(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const out = [];
  for (const value of sorted) {
    if (out.length === 0 || Math.abs(value - out[out.length - 1]) > 1e-7) {
      out.push(value);
    }
  }
  return out;
}
function segmentYAt(segment, x) {
  const [x0, y0] = segment.a;
  const [x1, y1] = segment.b;
  const t = (x - x0) / (x1 - x0);
  return roundLocal(y0 + (y1 - y0) * t);
}
function cleanLocalPolygon(points) {
  const dedup = [];
  for (const point of points) {
    if (dedup.length === 0 || Math.abs(point[0] - dedup[dedup.length - 1][0]) > 1e-7 || Math.abs(point[1] - dedup[dedup.length - 1][1]) > 1e-7) {
      dedup.push(point);
    }
  }
  if (dedup.length > 1 && Math.abs(dedup[0][0] - dedup[dedup.length - 1][0]) <= 1e-7 && Math.abs(dedup[0][1] - dedup[dedup.length - 1][1]) <= 1e-7) {
    dedup.pop();
  }
  const cleaned = [];
  for (let i = 0; i < dedup.length; i++) {
    const prev = dedup[(i - 1 + dedup.length) % dedup.length];
    const current = dedup[i];
    const next = dedup[(i + 1) % dedup.length];
    const cross22 = (current[0] - prev[0]) * (next[1] - current[1]) - (current[1] - prev[1]) * (next[0] - current[0]);
    if (Math.abs(cross22) > 1e-8) cleaned.push(current);
  }
  return cleaned;
}
function signedArea(points) {
  let area = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    area += a[0] * b[1] - b[0] * a[1];
  }
  return area / 2;
}
function localBBox(points) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of points) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  return { minX, minY, maxX, maxY };
}
function localBBoxesCanTouch(ab, bb) {
  return !(ab.maxX < bb.minX - 1e-7 || bb.maxX < ab.minX - 1e-7 || ab.maxY < bb.minY - 1e-7 || bb.maxY < ab.minY - 1e-7);
}
function localAreaAbs(points) {
  return Math.abs(signedArea(points));
}
function isConvexLocal(points) {
  if (points.length < 3) return false;
  let sign = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    const c = points[(i + 2) % points.length];
    const turn = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
    if (Math.abs(turn) <= 1e-8) continue;
    const nextSign = turn > 0 ? 1 : -1;
    if (sign === 0) sign = nextSign;
    else if (sign !== nextSign) return false;
  }
  return true;
}
function pointOnSegment(point, a, b) {
  const abx = b[0] - a[0];
  const aby = b[1] - a[1];
  const apx = point[0] - a[0];
  const apy = point[1] - a[1];
  const cross22 = abx * apy - aby * apx;
  const len = Math.hypot(abx, aby);
  if (len <= 1e-9 || Math.abs(cross22) > Math.max(1e-8, len * 1e-8)) return false;
  const dot22 = apx * abx + apy * aby;
  return dot22 >= -1e-8 && dot22 <= abx * abx + aby * aby + 1e-8;
}
function pointParameterOnSegment(point, a, b) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const denom = dx * dx + dy * dy;
  if (denom <= 1e-12) return 0;
  return ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / denom;
}
function colinearSegmentsOverlap(a0, a1, b0, b1) {
  const ax = a1[0] - a0[0];
  const ay = a1[1] - a0[1];
  const bx = b1[0] - b0[0];
  const by = b1[1] - b0[1];
  const aLen = Math.hypot(ax, ay);
  const bLen = Math.hypot(bx, by);
  if (aLen <= 1e-9 || bLen <= 1e-9) return false;
  const crossB0 = ax * (b0[1] - a0[1]) - ay * (b0[0] - a0[0]);
  const crossB1 = ax * (b1[1] - a0[1]) - ay * (b1[0] - a0[0]);
  const crossAxes = ax * by - ay * bx;
  const tolerance = Math.max(1e-8, Math.max(aLen, bLen) * 1e-8);
  if (Math.abs(crossB0) > tolerance || Math.abs(crossB1) > tolerance || Math.abs(crossAxes) > tolerance) {
    return false;
  }
  const useX = Math.abs(ax) >= Math.abs(ay);
  const aMin = Math.min(useX ? a0[0] : a0[1], useX ? a1[0] : a1[1]);
  const aMax = Math.max(useX ? a0[0] : a0[1], useX ? a1[0] : a1[1]);
  const bMin = Math.min(useX ? b0[0] : b0[1], useX ? b1[0] : b1[1]);
  const bMax = Math.max(useX ? b0[0] : b0[1], useX ? b1[0] : b1[1]);
  return Math.min(aMax, bMax) - Math.max(aMin, bMin) > 1e-8;
}
function polygonsMayShareBoundary(a, b) {
  for (let i = 0; i < a.length; i++) {
    const a0 = a[i];
    const a1 = a[(i + 1) % a.length];
    for (let j = 0; j < b.length; j++) {
      if (colinearSegmentsOverlap(a0, a1, b[j], b[(j + 1) % b.length])) {
        return true;
      }
    }
  }
  return false;
}
function splitDirectedEdges(polygon, splitPoints) {
  const segments = [];
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i];
    const b = polygon[(i + 1) % polygon.length];
    const splits = [
      { t: 0, point: a },
      { t: 1, point: b }
    ];
    for (const point of splitPoints) {
      if (eq2(point, a) || eq2(point, b)) continue;
      if (!pointOnSegment(point, a, b)) continue;
      splits.push({
        t: pointParameterOnSegment(point, a, b),
        point
      });
    }
    splits.sort((left, right) => left.t - right.t);
    const unique = [];
    for (const split of splits) {
      if (unique.some((item) => Math.abs(item.t - split.t) <= 1e-8 || eq2(item.point, split.point))) continue;
      unique.push(split);
    }
    for (let j = 0; j < unique.length - 1; j++) {
      const start = unique[j].point;
      const end = unique[j + 1].point;
      if (Math.hypot(end[0] - start[0], end[1] - start[1]) <= 1e-8) continue;
      segments.push({
        a: [roundLocal(start[0]), roundLocal(start[1])],
        b: [roundLocal(end[0]), roundLocal(end[1])]
      });
    }
  }
  return segments;
}
function unionConvexLocalPair(a, b, aBBox = localBBox(a), bBBox = localBBox(b)) {
  if (!localBBoxesCanTouch(aBBox, bBBox) || !polygonsMayShareBoundary(a, b)) return null;
  const pieces = [
    ...splitDirectedEdges(a, b),
    ...splitDirectedEdges(b, a)
  ];
  const grouped = /* @__PURE__ */ new Map();
  for (const segment of pieces) {
    const key = undirectedSegmentKey(segment);
    const current = grouped.get(key);
    if (current) current.push(segment);
    else grouped.set(key, [segment]);
  }
  let hadSharedEdge = false;
  const boundary = [];
  for (const group of grouped.values()) {
    if (group.length === 1) {
      boundary.push(group[0]);
      continue;
    }
    hadSharedEdge = true;
    const forward = group.filter((segment) => pointKey(segment.a) < pointKey(segment.b)).length;
    const backward = group.length - forward;
    if (forward !== backward) return null;
  }
  if (!hadSharedEdge || boundary.length < 3) return null;
  const outgoing = /* @__PURE__ */ new Map();
  for (const segment of boundary) {
    const key = pointKey(segment.a);
    if (outgoing.has(key)) return null;
    outgoing.set(key, segment);
  }
  const start = boundary[0];
  const startKey = pointKey(start.a);
  const loop = [];
  const used = /* @__PURE__ */ new Set();
  let currentKey = startKey;
  for (let guard = 0; guard <= boundary.length; guard++) {
    const segment = outgoing.get(currentKey);
    if (!segment) return null;
    const edgeKey22 = `${pointKey(segment.a)}>${pointKey(segment.b)}`;
    if (used.has(edgeKey22)) return null;
    used.add(edgeKey22);
    loop.push(segment.a);
    currentKey = pointKey(segment.b);
    if (currentKey === startKey) break;
  }
  if (currentKey !== startKey || used.size !== boundary.length) return null;
  const cleaned = cleanLocalPolygon(loop);
  if (cleaned.length < 3 || !isConvexLocal(cleaned)) return null;
  const area = localAreaAbs(cleaned);
  const expectedArea = localAreaAbs(a) + localAreaAbs(b);
  if (Math.abs(area - expectedArea) > Math.max(1e-5, expectedArea * 1e-5)) return null;
  return signedArea(cleaned) >= 0 ? cleaned : [...cleaned].reverse();
}
function mergeLocalCells(cells) {
  const polygons = cells.map(cleanLocalPolygon).filter((polygon) => polygon.length >= 3 && localAreaAbs(polygon) > 1e-8);
  const bboxes = polygons.map(localBBox);
  let changed = true;
  while (changed) {
    changed = false;
    for (let i = 0; i < polygons.length; i++) {
      for (let j = i + 1; j < polygons.length; j++) {
        const merged = unionConvexLocalPair(polygons[i], polygons[j], bboxes[i], bboxes[j]);
        if (!merged) continue;
        polygons[i] = merged;
        bboxes[i] = localBBox(merged);
        polygons.splice(j, 1);
        bboxes.splice(j, 1);
        changed = true;
        break;
      }
      if (changed) break;
    }
  }
  return polygons;
}
function localToWorldFactory(origin, xAxis, yAxis) {
  const snap = /* @__PURE__ */ new Map();
  return (point) => {
    const x = roundLocal(point[0]);
    const y = roundLocal(point[1]);
    const key = `${x},${y}`;
    const existing = snap.get(key);
    if (existing) return [existing[0], existing[1], existing[2]];
    const world = add(origin, add(scale(xAxis, x), scale(yAxis, y)));
    const rounded = [roundWorld(world[0]), roundWorld(world[1]), roundWorld(world[2])];
    snap.set(key, rounded);
    return [rounded[0], rounded[1], rounded[2]];
  };
}
function decomposeWithAxis(group, polygons, boundary, normal, xAxisInput) {
  const origin = boundary[0]?.a;
  if (!origin) return null;
  const xAxisProjected = normalize(sub3(xAxisInput, scale(normal, dot3(xAxisInput, normal))));
  if (!xAxisProjected) return null;
  const yAxis = normalize(cross3(normal, xAxisProjected));
  if (!yAxis) return null;
  const segments = [];
  const xs = [];
  for (const edge of boundary) {
    const a = projectPoint(edge.a, origin, xAxisProjected, yAxis);
    const b = projectPoint(edge.b, origin, xAxisProjected, yAxis);
    if (Math.hypot(a[0] - b[0], a[1] - b[1]) <= 1e-7) continue;
    segments.push({ a, b });
    xs.push(a[0], b[0]);
  }
  const sortedXs = uniqueSorted(xs);
  if (segments.length < 3 || sortedXs.length < 2) return null;
  const color = polygons[group[0]].color;
  const data = sharedData(group, polygons);
  const localCells = [];
  for (let i = 0; i < sortedXs.length - 1; i++) {
    const x0 = sortedXs[i];
    const x1 = sortedXs[i + 1];
    if (x1 - x0 <= 1e-7) continue;
    const xm = (x0 + x1) / 2;
    const active = segments.filter((segment) => {
      const minX = Math.min(segment.a[0], segment.b[0]);
      const maxX = Math.max(segment.a[0], segment.b[0]);
      return minX < xm && xm < maxX && Math.abs(segment.a[0] - segment.b[0]) > 1e-7;
    }).map((segment) => ({
      segment,
      yMid: segmentYAt(segment, xm)
    })).sort((a, b) => a.yMid - b.yMid);
    if (active.length === 0) continue;
    if (active.length % 2 !== 0) return null;
    for (let j = 0; j < active.length; j += 2) {
      const low = active[j].segment;
      const high = active[j + 1].segment;
      const low0 = segmentYAt(low, x0);
      const low1 = segmentYAt(low, x1);
      const high0 = segmentYAt(high, x0);
      const high1 = segmentYAt(high, x1);
      const local = cleanLocalPolygon([
        [x0, low0],
        [x1, low1],
        [x1, high1],
        [x0, high0]
      ]);
      if (local.length < 3 || Math.abs(signedArea(local)) <= 1e-8) continue;
      const oriented = signedArea(local) > 0 ? local : [...local].reverse();
      localCells.push(oriented);
    }
  }
  if (localCells.length === 0) return null;
  const toWorld = localToWorldFactory(origin, xAxisProjected, yAxis);
  const cells = mergeLocalCells(localCells).map((local) => ({
    vertices: local.map(toWorld),
    ...color ? { color } : {},
    ...data ? { data } : {}
  }));
  return mergePolygons(cells);
}
function optimizeGroup(group, polygons, maxCandidateAxes) {
  const boundary = boundaryEdgesForGroup(group, polygons);
  if (!boundary || boundary.length < 3 || !boundaryIsClosed(boundary)) return null;
  const plane = planeOf2(polygons[group[0]]);
  if (!plane) return null;
  let best = null;
  for (const axis of candidateAxes(boundary, plane.normal, maxCandidateAxes)) {
    const result = decomposeWithAxis(group, polygons, boundary, plane.normal, axis);
    if (!result) continue;
    if (!best || result.length < best.length) best = result;
  }
  if (!best || best.length >= group.length) return null;
  return best;
}
function coverPlanarPolygons(input, options = {}) {
  const minGroupPolygons = options.minGroupPolygons ?? DEFAULT_MIN_GROUP;
  const maxCandidateAxes = options.maxCandidateAxes ?? DEFAULT_MAX_AXES;
  const planeEpsilon = options.planeEpsilon ?? DEFAULT_PLANE_EPSILON;
  const polygons = input ?? [];
  if (polygons.length < minGroupPolygons) return polygons;
  const { groups } = buildGroups(polygons, planeEpsilon);
  if (groups.length === 0) return polygons;
  const replacements = /* @__PURE__ */ new Map();
  const replaced = /* @__PURE__ */ new Set();
  for (const group of groups) {
    if (group.length < minGroupPolygons) continue;
    const optimized = optimizeGroup(group, polygons, maxCandidateAxes);
    if (!optimized) continue;
    replacements.set(group[0], optimized);
    for (const index of group) replaced.add(index);
  }
  if (replacements.size === 0) return polygons;
  const output = [];
  for (let i = 0; i < polygons.length; i++) {
    const replacement = replacements.get(i);
    if (replacement) {
      output.push(...replacement);
      continue;
    }
    if (replaced.has(i)) continue;
    output.push(polygons[i]);
  }
  return output;
}

// packages/core/src/cull/cullInteriorPolygons.ts
var DEFAULT_HEMISPHERE_SAMPLES = 8;
var RAY_ORIGIN_OFFSET = 1e-3;
var MIN_HIT_T = 1e-3;
var PARALLEL_EPS = 1e-9;
var ORIGIN_INSET = 0.08;
function precompute(p) {
  const verts = p.vertices;
  if (!verts || verts.length < 3) return null;
  let cx = 0, cy = 0, cz = 0;
  for (const [x, y, z] of verts) {
    cx += x;
    cy += y;
    cz += z;
  }
  const inv = 1 / verts.length;
  cx *= inv;
  cy *= inv;
  cz *= inv;
  const v0 = verts[0], v1 = verts[1], v2 = verts[2];
  const e1x = v1[0] - v0[0], e1y = v1[1] - v0[1], e1z = v1[2] - v0[2];
  const e2x = v2[0] - v0[0], e2y = v2[1] - v0[1], e2z = v2[2] - v0[2];
  let nx = e1y * e2z - e1z * e2y;
  let ny = e1z * e2x - e1x * e2z;
  let nz = e1x * e2y - e1y * e2x;
  const nLen = Math.hypot(nx, ny, nz);
  if (nLen < PARALLEL_EPS) return null;
  nx /= nLen;
  ny /= nLen;
  nz /= nLen;
  const nTri = verts.length - 2;
  const triFlat = new Float64Array(nTri * 9);
  let ti = 0;
  for (let i = 1; i < verts.length - 1; i++) {
    const a = verts[0], b = verts[i], c = verts[i + 1];
    triFlat[ti++] = a[0];
    triFlat[ti++] = a[1];
    triFlat[ti++] = a[2];
    triFlat[ti++] = b[0];
    triFlat[ti++] = b[1];
    triFlat[ti++] = b[2];
    triFlat[ti++] = c[0];
    triFlat[ti++] = c[1];
    triFlat[ti++] = c[2];
  }
  let br2 = 0;
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (const [x, y, z] of verts) {
    const ddx = x - cx, ddy = y - cy, ddz = z - cz;
    const d2 = ddx * ddx + ddy * ddy + ddz * ddz;
    if (d2 > br2) br2 = d2;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }
  return {
    centroid: [cx, cy, cz],
    normal: [nx, ny, nz],
    vertices: verts,
    triFlat,
    bcx: cx,
    bcy: cy,
    bcz: cz,
    br2,
    minX,
    minY,
    minZ,
    maxX,
    maxY,
    maxZ
  };
}
function rayTriFlat(ox, oy, oz, dx, dy, dz, tf, base) {
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
function rayHitsPolygon(ox, oy, oz, dx, dy, dz, q) {
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
var BVH_STRIDE = 9;
var BVH_LEAF_SIZE = 6;
var SAH_BUCKETS = 12;
function aabbSA(minX, minY, minZ, maxX, maxY, maxZ) {
  const dx = maxX - minX, dy = maxY - minY, dz = maxZ - minZ;
  return dx * dy + dy * dz + dz * dx;
}
function buildBVH(meta) {
  const valid = [];
  for (let i = 0; i < meta.length; i++) {
    if (meta[i]) valid.push(i);
  }
  const n = valid.length;
  const polyIndices = new Int32Array(n);
  for (let i = 0; i < n; i++) polyIndices[i] = valid[i];
  const centX = new Float64Array(n);
  const centY = new Float64Array(n);
  const centZ = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const m = meta[polyIndices[i]];
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
  const bCnt = new Int32Array(SAH_BUCKETS);
  const lSA = new Float64Array(SAH_BUCKETS - 1);
  const lCnt = new Int32Array(SAH_BUCKETS - 1);
  const rSA = new Float64Array(SAH_BUCKETS - 1);
  const rCnt = new Int32Array(SAH_BUCKETS - 1);
  function buildNode(start, end) {
    const ni = nodeCount++;
    const base = ni * BVH_STRIDE;
    const count = end - start;
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (let i = start; i < end; i++) {
      const m = meta[polyIndices[i]];
      if (m.minX < minX) minX = m.minX;
      if (m.maxX > maxX) maxX = m.maxX;
      if (m.minY < minY) minY = m.minY;
      if (m.maxY > maxY) maxY = m.maxY;
      if (m.minZ < minZ) minZ = m.minZ;
      if (m.maxZ > maxZ) maxZ = m.maxZ;
    }
    data[base] = minX;
    data[base + 1] = minY;
    data[base + 2] = minZ;
    data[base + 3] = maxX;
    data[base + 4] = maxY;
    data[base + 5] = maxZ;
    if (count <= BVH_LEAF_SIZE) {
      data[base + 6] = 1;
      data[base + 7] = start;
      data[base + 8] = end;
      return ni;
    }
    let cxMin = Infinity, cyMin = Infinity, czMin = Infinity;
    let cxMax = -Infinity, cyMax = -Infinity, czMax = -Infinity;
    for (let i = start; i < end; i++) {
      if (centX[i] < cxMin) cxMin = centX[i];
      if (centX[i] > cxMax) cxMax = centX[i];
      if (centY[i] < cyMin) cyMin = centY[i];
      if (centY[i] > cyMax) cyMax = centY[i];
      if (centZ[i] < czMin) czMin = centZ[i];
      if (centZ[i] > czMax) czMax = centZ[i];
    }
    const extX = cxMax - cxMin, extY = cyMax - cyMin, extZ = czMax - czMin;
    if (extX === 0 && extY === 0 && extZ === 0) {
      data[base + 6] = 1;
      data[base + 7] = start;
      data[base + 8] = end;
      return ni;
    }
    const nodeSA = aabbSA(minX, minY, minZ, maxX, maxY, maxZ);
    const invSA = nodeSA > 0 ? 1 / nodeSA : 0;
    let bestCost = count + 1;
    let bestAxis = 0, bestSplitVal = 0;
    for (let axis = 0; axis < 3; axis++) {
      const cMin = axis === 0 ? cxMin : axis === 1 ? cyMin : czMin;
      const ext = axis === 0 ? extX : axis === 1 ? extY : extZ;
      if (ext === 0) continue;
      const centArr = axis === 0 ? centX : axis === 1 ? centY : centZ;
      const scale2 = SAH_BUCKETS / ext;
      bMinX.fill(Infinity);
      bMinY.fill(Infinity);
      bMinZ.fill(Infinity);
      bMaxX.fill(-Infinity);
      bMaxY.fill(-Infinity);
      bMaxZ.fill(-Infinity);
      bCnt.fill(0);
      for (let i = start; i < end; i++) {
        let b = (centArr[i] - cMin) * scale2 | 0;
        if (b >= SAH_BUCKETS) b = SAH_BUCKETS - 1;
        const m = meta[polyIndices[i]];
        if (m.minX < bMinX[b]) bMinX[b] = m.minX;
        if (m.maxX > bMaxX[b]) bMaxX[b] = m.maxX;
        if (m.minY < bMinY[b]) bMinY[b] = m.minY;
        if (m.maxY > bMaxY[b]) bMaxY[b] = m.maxY;
        if (m.minZ < bMinZ[b]) bMinZ[b] = m.minZ;
        if (m.maxZ > bMaxZ[b]) bMaxZ[b] = m.maxZ;
        bCnt[b]++;
      }
      let lx0 = Infinity, ly0 = Infinity, lz0 = Infinity;
      let lx1 = -Infinity, ly1 = -Infinity, lz1 = -Infinity;
      let lc = 0;
      for (let k = 0; k < SAH_BUCKETS - 1; k++) {
        if (bMinX[k] < lx0) lx0 = bMinX[k];
        if (bMaxX[k] > lx1) lx1 = bMaxX[k];
        if (bMinY[k] < ly0) ly0 = bMinY[k];
        if (bMaxY[k] > ly1) ly1 = bMaxY[k];
        if (bMinZ[k] < lz0) lz0 = bMinZ[k];
        if (bMaxZ[k] > lz1) lz1 = bMaxZ[k];
        lc += bCnt[k];
        lSA[k] = aabbSA(lx0, ly0, lz0, lx1, ly1, lz1);
        lCnt[k] = lc;
      }
      let rx0 = Infinity, ry0 = Infinity, rz0 = Infinity;
      let rx1 = -Infinity, ry1 = -Infinity, rz1 = -Infinity;
      let rc = 0;
      for (let k = SAH_BUCKETS - 2; k >= 0; k--) {
        const kb = k + 1;
        if (bMinX[kb] < rx0) rx0 = bMinX[kb];
        if (bMaxX[kb] > rx1) rx1 = bMaxX[kb];
        if (bMinY[kb] < ry0) ry0 = bMinY[kb];
        if (bMaxY[kb] > ry1) ry1 = bMaxY[kb];
        if (bMinZ[kb] < rz0) rz0 = bMinZ[kb];
        if (bMaxZ[kb] > rz1) rz1 = bMaxZ[kb];
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
          bestSplitVal = cMin + (k + 1) / scale2;
        }
      }
    }
    const centArr2 = bestAxis === 0 ? centX : bestAxis === 1 ? centY : centZ;
    let lo = start, hi = end - 1;
    while (lo <= hi) {
      if (centArr2[lo] < bestSplitVal) {
        lo++;
      } else {
        const tmp = polyIndices[lo];
        polyIndices[lo] = polyIndices[hi];
        polyIndices[hi] = tmp;
        const t0 = centX[lo];
        centX[lo] = centX[hi];
        centX[hi] = t0;
        const t1 = centY[lo];
        centY[lo] = centY[hi];
        centY[hi] = t1;
        const t2 = centZ[lo];
        centZ[lo] = centZ[hi];
        centZ[hi] = t2;
        hi--;
      }
    }
    let mid = lo;
    if (mid === start || mid === end) mid = start + end >> 1;
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
function rayHitsAnyInBVH(ox, oy, oz, dx, dy, dz, selfIdx, bvh, stack) {
  if (bvh.nodeCount === 0) return false;
  const { data, polyIndices, meta } = bvh;
  const invDx = dx !== 0 ? 1 / dx : dx >= 0 ? Infinity : -Infinity;
  const invDy = dy !== 0 ? 1 / dy : dy >= 0 ? Infinity : -Infinity;
  const invDz = dz !== 0 ? 1 / dz : dz >= 0 ? Infinity : -Infinity;
  let top = 0;
  stack[top++] = 0;
  while (top > 0) {
    const ni = stack[--top];
    const base = ni * BVH_STRIDE;
    const tx1 = (data[base] - ox) * invDx;
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
      const end = data[base + 8] | 0;
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
function hemisphereSamplesFlat(k) {
  const phi = (1 + Math.sqrt(5)) / 2;
  const out = new Float64Array(k * 3);
  for (let i = 0; i < k; i++) {
    const z = (i + 0.5) / k;
    const r = Math.sqrt(Math.max(0, 1 - z * z));
    const theta = 2 * Math.PI * (i / phi);
    out[i * 3] = r * Math.cos(theta);
    out[i * 3 + 1] = r * Math.sin(theta);
    out[i * 3 + 2] = z;
  }
  return out;
}
function basis(n) {
  const ax = Math.abs(n[0]) > 0.9 ? 0 : 1;
  const ay = Math.abs(n[0]) > 0.9 ? 1 : 0;
  let ux = ay * n[2];
  let uy = -ax * n[2];
  let uz = ax * n[1] - ay * n[0];
  const uLen = Math.hypot(ux, uy, uz);
  ux /= uLen;
  uy /= uLen;
  uz /= uLen;
  const vx = n[1] * uz - n[2] * uy;
  const vy = n[2] * ux - n[0] * uz;
  const vz = n[0] * uy - n[1] * ux;
  return { ux, uy, uz, vx, vy, vz };
}
function cullInteriorPolygons(polygons, options) {
  const k = options?.samples ?? DEFAULT_HEMISPHERE_SAMPLES;
  if (polygons.length < 4 || k < 1) return polygons;
  const meta = polygons.map(precompute);
  const samplesFlat = hemisphereSamplesFlat(k);
  const kept = [];
  const bvh = buildBVH(meta);
  const stack = new Int32Array(Math.max(64, bvh.nodeCount));
  const MAX_ORIGINS = 64 * 3;
  const origBuf = new Float64Array(MAX_ORIGINS);
  for (let i = 0; i < polygons.length; i++) {
    const p = meta[i];
    if (!p) {
      kept.push(polygons[i]);
      continue;
    }
    const nx = p.normal[0], ny = p.normal[1], nz = p.normal[2];
    const offX = RAY_ORIGIN_OFFSET * nx;
    const offY = RAY_ORIGIN_OFFSET * ny;
    const offZ = RAY_ORIGIN_OFFSET * nz;
    {
      const ox1 = p.centroid[0] + offX;
      const oy1 = p.centroid[1] + offY;
      const oz1 = p.centroid[2] + offZ;
      if (!rayHitsAnyInBVH(ox1, oy1, oz1, nx, ny, nz, i, bvh, stack)) {
        kept.push(polygons[i]);
        continue;
      }
    }
    const { ux, uy, uz, vx, vy, vz } = basis(p.normal);
    const cx0 = p.centroid[0], cy0 = p.centroid[1], cz0 = p.centroid[2];
    const verts = p.vertices;
    const vCount = verts.length;
    let oCnt = 0;
    origBuf[oCnt++] = cx0 + offX;
    origBuf[oCnt++] = cy0 + offY;
    origBuf[oCnt++] = cz0 + offZ;
    for (let vi = 0; vi < vCount; vi++) {
      const v = verts[vi];
      origBuf[oCnt++] = v[0] + (cx0 - v[0]) * ORIGIN_INSET + offX;
      origBuf[oCnt++] = v[1] + (cy0 - v[1]) * ORIGIN_INSET + offY;
      origBuf[oCnt++] = v[2] + (cz0 - v[2]) * ORIGIN_INSET + offZ;
    }
    for (let vi = 0; vi < vCount; vi++) {
      const a = verts[vi];
      const b = verts[(vi + 1) % vCount];
      const mx = (a[0] + b[0]) * 0.5;
      const my = (a[1] + b[1]) * 0.5;
      const mz = (a[2] + b[2]) * 0.5;
      origBuf[oCnt++] = mx + (cx0 - mx) * ORIGIN_INSET + offX;
      origBuf[oCnt++] = my + (cy0 - my) * ORIGIN_INSET + offY;
      origBuf[oCnt++] = mz + (cz0 - mz) * ORIGIN_INSET + offZ;
    }
    let escaped = false;
    outer: for (let si = 0; si < samplesFlat.length; si += 3) {
      const lx = samplesFlat[si], ly = samplesFlat[si + 1], lz = samplesFlat[si + 2];
      const rdx = lx * ux + ly * vx + lz * nx;
      const rdy = lx * uy + ly * vy + lz * ny;
      const rdz = lx * uz + ly * vz + lz * nz;
      for (let oi = 0; oi < oCnt; oi += 3) {
        const rox = origBuf[oi], roy = origBuf[oi + 1], roz = origBuf[oi + 2];
        if (!rayHitsAnyInBVH(rox, roy, roz, rdx, rdy, rdz, i, bvh, stack)) {
          escaped = true;
          break outer;
        }
      }
    }
    if (escaped) kept.push(polygons[i]);
  }
  return kept;
}

// packages/core/src/merge/optimizePolygons.ts
var NORMALIZE_MAX_ANGLE_DEG = 3;
var NORMALIZE_MAX_PLANE_DISPLACEMENT = 0.03;
var NORMALIZE_MAX_BOUNDARY_DISPLACEMENT = 0.02;
var DEFAULT_NORMALIZE_OPTIONS = {
  maxAngleDeg: NORMALIZE_MAX_ANGLE_DEG,
  maxPlaneDisplacement: NORMALIZE_MAX_PLANE_DISPLACEMENT,
  maxBoundaryDisplacement: NORMALIZE_MAX_BOUNDARY_DISPLACEMENT,
  isolatedPairs: false
};
var DEFAULT_LOSSY_APPROXIMATE_OPTIONS = {
  maxAngleDeg: 15,
  maxPlaneDisplacement: 0.35,
  maxBoundaryDisplacement: 0.0725,
  isolatedPairs: true
};
var LOSSY_BUDGET_SWEEP = [
  {
    maxAngleDeg: 15,
    maxPlaneDisplacement: 0.35,
    maxBoundaryDisplacement: 0.02
  },
  {
    maxAngleDeg: 15,
    maxPlaneDisplacement: 0.35,
    maxBoundaryDisplacement: 0.0725
  },
  {
    maxAngleDeg: 45,
    maxPlaneDisplacement: 1,
    maxBoundaryDisplacement: 0.0725
  }
];
var LOSSY_COLOR_QUANTIZE_STEPS = [4, 8, 12];
var LOSSY_RECTANGULATED_MIN_POLYGONS = 300;
var LOSSY_RECTANGULATED_MAX_TRIANGLE_RATIO = 0.3;
var LOSSY_AUTOMATIC_GROUP_MAX_POLYGONS = 300;
var LOSSY_CRACK_COST_SLACK = 16;
var LOSSY_CRACK_RELATIVE_COST_SLACK = 0.015;
var LOSSY_CRACK_QUALITY_SEARCH_MULTIPLIER = 2.6;
var LOSSY_POLYGON_PAIR_MAX_PASSES = 3;
var RECT_COVER_MOSTLY_QUAD_TRIANGLE_LIMIT = 96;
var AUTOMATIC_RECT_COVER_MAX_POLYGONS = 1800;
var AUTOMATIC_RECT_COVER_MIN_TRIANGLE_RATIO = 0.65;
var LOSSY_RECTANGULATED_FAST_EXIT_MIN_POLYGONS = 900;
var AUTOMATIC_GEOMETRY_SKIP_MIN_POLYGONS = 300;
var CARDINAL_NORMAL_EPSILON = 1e-5;
var DEFAULT_RECT_COVER_OPTIONS = {
  minGroupPolygons: 2,
  maxCandidateAxes: 24
};
var AUTOMATIC_LOSSY_RECT_COVER_OPTIONS = {
  ...DEFAULT_RECT_COVER_OPTIONS,
  maxCandidateAxes: 1
};
var EMPTY_CRACK_METRICS = {
  maxGap: 0,
  internalBoundaryLength: 0,
  excessBoundaryLength: 0
};
function optimizeMeshPolygons(polygons, options = {}) {
  const meshResolution = options.meshResolution ?? "lossy";
  const preprocessCache = {};
  const baseline = preprocessModelPolygons(polygons, false, preprocessCache);
  let best = baseline;
  let bestCost = polygonRenderCost(baseline);
  const acceptCandidate = (candidate, cost = polygonRenderCost(candidate)) => {
    if (cost >= bestCost) return false;
    best = candidate;
    bestCost = cost;
    return true;
  };
  const initialRectCover = meshResolution === "lossy" && options.rectCover === void 0 ? automaticLossyRectCoverOptions(baseline) : options.rectCover;
  const rectCovered = applyRectCoverCandidate(baseline, initialRectCover);
  if (rectCovered !== baseline) acceptCandidate(rectCovered);
  if (meshResolution === "lossy" && options.approximateMerge !== false) {
    const qualityCandidates = [];
    const referenceCandidate = best;
    let crackSource = null;
    let referenceCracks = null;
    const getCrackSource = () => {
      crackSource ?? (crackSource = createCrackSourceContext(polygons));
      return crackSource;
    };
    const getReferenceCracks = () => {
      referenceCracks ?? (referenceCracks = candidateCrackQualityMetrics(
        getCrackSource(),
        referenceCandidate,
        DEFAULT_LOSSY_APPROXIMATE_OPTIONS.maxBoundaryDisplacement
      ).metrics);
      return referenceCracks;
    };
    const automaticApproximate = options.approximateMerge === void 0 || options.approximateMerge === true;
    const passesLossyCrackBudget = (sample, allowReferenceCracks = true) => !crackMetricsExceed(
      getCrackSource(),
      sample.metrics,
      sample.tolerance,
      allowReferenceCracks ? getReferenceCracks() : null
    );
    const sampleCandidateCracks = (candidate, maxBoundaryDisplacement, allowReferenceCracks = true) => {
      const source = getCrackSource();
      const tolerance = crackToleranceForSource(source, maxBoundaryDisplacement);
      return candidateCrackQualityMetrics(
        source,
        candidate,
        maxBoundaryDisplacement,
        crackMetricLimits(
          source,
          tolerance,
          allowReferenceCracks ? getReferenceCracks() : null
        )
      );
    };
    const acceptLossyCandidate = (candidate, cost) => {
      acceptCandidate(candidate, cost);
    };
    const considerQualityCandidate = (candidate, cost, maxBoundaryDisplacement = DEFAULT_LOSSY_APPROXIMATE_OPTIONS.maxBoundaryDisplacement, metrics) => {
      if (!automaticApproximate || cost > bestCost + lossyCrackCostSlack(bestCost)) return;
      qualityCandidates.push({
        polygons: candidate,
        cost,
        maxBoundaryDisplacement,
        metrics
      });
    };
    const coverLossyCandidates = options.rectCover !== void 0 && options.rectCover !== false;
    const skipAutomaticGeometryApproximation = automaticApproximate && shouldSkipAutomaticGeometryApproximation(baseline);
    const approximateCandidates = skipAutomaticGeometryApproximation ? [] : lossyApproximateCandidates(
      options.approximateMerge,
      automaticApproximate ? baseline : void 0
    );
    const colorQuantizeCandidates = automaticApproximate ? lossyColorQuantizeCandidates(polygons) : [];
    for (let approximateIndex = 0; approximateIndex < approximateCandidates.length; approximateIndex++) {
      const approximateOptions = approximateCandidates[approximateIndex];
      const approximate = preprocessModelPolygons(polygons, approximateOptions, preprocessCache);
      const approximateCost = polygonRenderCost(approximate);
      let approximateCracks = null;
      let approximateMetrics;
      const sampleApproximateCracks = (allowReferenceCracks) => {
        approximateCracks ?? (approximateCracks = sampleCandidateCracks(
          approximate,
          approximateOptions.maxBoundaryDisplacement,
          allowReferenceCracks
        ));
        return approximateCracks;
      };
      const approximateAllowsReferenceCracks = !!approximateOptions.allowReferenceCracks;
      let approximatePassesCrackBudget = true;
      if (automaticApproximate || approximateOptions.guard) {
        const sample = sampleApproximateCracks(approximateAllowsReferenceCracks);
        approximateMetrics = sample.metrics;
        approximatePassesCrackBudget = passesLossyCrackBudget(sample, approximateAllowsReferenceCracks);
      }
      if (!approximatePassesCrackBudget && approximateCost < bestCost) {
        continue;
      }
      if (approximatePassesCrackBudget) {
        acceptLossyCandidate(approximate, approximateCost);
        considerQualityCandidate(
          approximate,
          approximateCost,
          approximateOptions.maxBoundaryDisplacement,
          approximateMetrics
        );
      }
      if (coverLossyCandidates) {
        const coveredApproximate = applyRectCoverCandidate(approximate, options.rectCover);
        const coveredApproximateCost = polygonRenderCost(coveredApproximate);
        let coveredApproximateCracks = null;
        let coveredApproximateMetrics;
        const sampleCoveredApproximateCracks = (allowReferenceCracks) => {
          coveredApproximateCracks ?? (coveredApproximateCracks = sampleCandidateCracks(
            coveredApproximate,
            approximateOptions.maxBoundaryDisplacement,
            allowReferenceCracks
          ));
          return coveredApproximateCracks;
        };
        if (coveredApproximate !== approximate && coveredApproximateCost < bestCost) {
          let coveredPassesCrackGuard = true;
          if (automaticApproximate || approximateOptions.guard) {
            const sample = sampleCoveredApproximateCracks(approximateAllowsReferenceCracks);
            coveredApproximateMetrics = sample.metrics;
            coveredPassesCrackGuard = passesLossyCrackBudget(sample, approximateAllowsReferenceCracks);
          }
          if (coveredPassesCrackGuard) {
            acceptLossyCandidate(coveredApproximate, coveredApproximateCost);
            considerQualityCandidate(
              coveredApproximate,
              coveredApproximateCost,
              approximateOptions.maxBoundaryDisplacement,
              coveredApproximateMetrics
            );
          }
        }
      }
    }
    if (automaticApproximate && colorQuantizeCandidates.length === 0 && shouldUseRectangulatedFastExit(baseline)) {
      return best;
    }
    if (automaticApproximate) {
      for (const colorPolygons of colorQuantizeCandidates) {
        const colorCache = createColorPreprocessCache(colorPolygons, preprocessCache);
        const colorBaseline = colorCache.baseline;
        const colorCost = polygonRenderCost(colorBaseline);
        let colorPassesCrackBudget = true;
        let colorCracks = null;
        let colorMetrics;
        const sampleColorCracks = () => {
          colorCracks ?? (colorCracks = sampleCandidateCracks(
            colorBaseline,
            DEFAULT_LOSSY_APPROXIMATE_OPTIONS.maxBoundaryDisplacement
          ));
          return colorCracks;
        };
        if (colorCost < bestCost) {
          const sample = sampleColorCracks();
          colorMetrics = sample.metrics;
          colorPassesCrackBudget = passesLossyCrackBudget(sample);
        }
        if (colorPassesCrackBudget) {
          acceptLossyCandidate(colorBaseline, colorCost);
          considerQualityCandidate(colorBaseline, colorCost, void 0, colorMetrics);
        }
        if (coverLossyCandidates) {
          const coveredColor = applyRectCoverCandidate(colorBaseline, options.rectCover);
          if (coveredColor !== colorBaseline) {
            const coveredColorCost = polygonRenderCost(coveredColor);
            let coveredColorCracks = null;
            let coveredColorMetrics;
            const sampleCoveredColorCracks = () => {
              coveredColorCracks ?? (coveredColorCracks = sampleCandidateCracks(
                coveredColor,
                DEFAULT_LOSSY_APPROXIMATE_OPTIONS.maxBoundaryDisplacement
              ));
              return coveredColorCracks;
            };
            const coveredColorPassesCrackBudget = () => {
              const sample = sampleCoveredColorCracks();
              coveredColorMetrics = sample.metrics;
              return passesLossyCrackBudget(sample);
            };
            if (coveredColorCost >= bestCost || coveredColorPassesCrackBudget()) {
              acceptLossyCandidate(coveredColor, coveredColorCost);
              considerQualityCandidate(coveredColor, coveredColorCost, void 0, coveredColorMetrics);
            }
          }
        }
        const colorApproximateCandidates = skipAutomaticGeometryApproximation ? [] : lossyApproximateCandidates(
          options.approximateMerge,
          colorCache.baseline
        );
        for (const approximateOptions of colorApproximateCandidates) {
          const approximate = preprocessModelPolygons(colorPolygons, approximateOptions, colorCache);
          const approximateCost = polygonRenderCost(approximate);
          let approximateCracks = null;
          let approximateMetrics;
          const sampleApproximateCracks = (allowReferenceCracks) => {
            approximateCracks ?? (approximateCracks = sampleCandidateCracks(
              approximate,
              approximateOptions.maxBoundaryDisplacement,
              allowReferenceCracks
            ));
            return approximateCracks;
          };
          const approximateAllowsReferenceCracks = !!approximateOptions.allowReferenceCracks;
          let approximatePassesCrackBudget = true;
          if (automaticApproximate || approximateOptions.guard) {
            const sample = sampleApproximateCracks(approximateAllowsReferenceCracks);
            approximateMetrics = sample.metrics;
            approximatePassesCrackBudget = passesLossyCrackBudget(sample, approximateAllowsReferenceCracks);
          }
          if (!approximatePassesCrackBudget && approximateCost < bestCost) {
            continue;
          }
          if (approximatePassesCrackBudget) {
            acceptLossyCandidate(approximate, approximateCost);
            considerQualityCandidate(
              approximate,
              approximateCost,
              approximateOptions.maxBoundaryDisplacement,
              approximateMetrics
            );
          }
          if (coverLossyCandidates) {
            const coveredApproximate = applyRectCoverCandidate(approximate, options.rectCover);
            const coveredApproximateCost = polygonRenderCost(coveredApproximate);
            let coveredApproximateCracks = null;
            let coveredApproximateMetrics;
            const sampleCoveredApproximateCracks = (allowReferenceCracks) => {
              coveredApproximateCracks ?? (coveredApproximateCracks = sampleCandidateCracks(
                coveredApproximate,
                approximateOptions.maxBoundaryDisplacement,
                allowReferenceCracks
              ));
              return coveredApproximateCracks;
            };
            if (coveredApproximate !== approximate && coveredApproximateCost < bestCost) {
              let coveredPassesCrackGuard = true;
              if (automaticApproximate || approximateOptions.guard) {
                const sample = sampleCoveredApproximateCracks(approximateAllowsReferenceCracks);
                coveredApproximateMetrics = sample.metrics;
                coveredPassesCrackGuard = passesLossyCrackBudget(sample, approximateAllowsReferenceCracks);
              }
              if (coveredPassesCrackGuard) {
                acceptLossyCandidate(coveredApproximate, coveredApproximateCost);
                considerQualityCandidate(
                  coveredApproximate,
                  coveredApproximateCost,
                  approximateOptions.maxBoundaryDisplacement,
                  coveredApproximateMetrics
                );
              }
            }
          }
        }
      }
    }
    if (automaticApproximate && !skipAutomaticGeometryApproximation) {
      for (const budget of LOSSY_BUDGET_SWEEP) {
        const polygonPairOptions = resolveNormalizeOptions({ ...budget, isolatedPairs: true });
        const polygonPaired = mergeAdjacentApproximatePolygonPairs(best, polygonPairOptions);
        if (polygonPaired === best) continue;
        const polygonPairCost = polygonRenderCost(polygonPaired);
        if (polygonPairCost >= bestCost) continue;
        const polygonPairCracks = sampleCandidateCracks(
          polygonPaired,
          polygonPairOptions.maxBoundaryDisplacement
        );
        if (!passesLossyCrackBudget(polygonPairCracks)) continue;
        acceptLossyCandidate(polygonPaired, polygonPairCost);
        considerQualityCandidate(
          polygonPaired,
          polygonPairCost,
          polygonPairOptions.maxBoundaryDisplacement,
          polygonPairCracks.metrics
        );
      }
    }
    const qualityBest = chooseLossyQualityCandidate(
      qualityCandidates,
      best,
      bestCost,
      (candidate) => {
        candidate.metrics ?? (candidate.metrics = candidateCrackQualityMetrics(
          getCrackSource(),
          candidate.polygons,
          candidate.maxBoundaryDisplacement
        ).metrics);
        return candidate.metrics;
      },
      () => candidateCrackQualityMetrics(
        getCrackSource(),
        best,
        DEFAULT_LOSSY_APPROXIMATE_OPTIONS.maxBoundaryDisplacement
      ).metrics
    );
    if (qualityBest) {
      best = qualityBest.polygons;
      bestCost = qualityBest.cost;
    }
  }
  return best;
}
function lossyColorQuantizeCandidates(polygons) {
  const profile = solidHexColorProfile(polygons);
  if (profile.eligiblePolygons < 24 || profile.colorCount < 8) return [];
  const candidates = [];
  const seen = /* @__PURE__ */ new Set();
  for (const step of LOSSY_COLOR_QUANTIZE_STEPS) {
    const quantized = quantizeSolidHexColors(polygons, step, profile.colorCount);
    if (!quantized) continue;
    const signature = colorSignature(quantized);
    if (seen.has(signature)) continue;
    seen.add(signature);
    candidates.push(quantized);
  }
  return candidates;
}
function solidHexColorProfile(polygons) {
  const colors = /* @__PURE__ */ new Set();
  let eligiblePolygons = 0;
  for (const polygon of polygons) {
    if (polygon.texture || polygon.material?.texture || polygon.uvs || polygon.textureTriangles?.length) {
      continue;
    }
    if (!parseHexColor(polygon.color)) continue;
    eligiblePolygons += 1;
    colors.add(polygon.color ?? "#cccccc");
  }
  return { eligiblePolygons, colorCount: colors.size };
}
function quantizeSolidHexColors(polygons, step, originalColorCount) {
  let changed = false;
  const quantizedColors = /* @__PURE__ */ new Set();
  const output = polygons.map((polygon) => {
    if (polygon.texture || polygon.material?.texture || polygon.uvs || polygon.textureTriangles?.length) {
      return polygon;
    }
    const color = parseHexColor(polygon.color);
    if (!color) return polygon;
    const nextColor = formatHexColor([
      Math.round(color[0] / step) * step,
      Math.round(color[1] / step) * step,
      Math.round(color[2] / step) * step
    ]);
    quantizedColors.add(nextColor);
    if (nextColor === polygon.color) return polygon;
    changed = true;
    return { ...polygon, color: nextColor };
  });
  if (!changed || quantizedColors.size >= originalColorCount) return null;
  return output;
}
function parseHexColor(color) {
  const value = color ?? "#cccccc";
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(value);
  if (short) {
    return [
      parseInt(short[1] + short[1], 16),
      parseInt(short[2] + short[2], 16),
      parseInt(short[3] + short[3], 16)
    ];
  }
  const full = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(value);
  if (!full) return null;
  return [
    parseInt(full[1], 16),
    parseInt(full[2], 16),
    parseInt(full[3], 16)
  ];
}
function formatHexColor(color) {
  return `#${color.map(
    (channel) => Math.max(0, Math.min(255, Math.round(channel))).toString(16).padStart(2, "0")
  ).join("")}`;
}
function colorSignature(polygons) {
  return polygons.map((polygon) => polygon.color ?? "").join("|");
}
function lossyApproximateCandidates(setting, baseline) {
  if (setting && setting !== true) {
    if (typeof setting.isolatedPairs === "boolean") {
      return [{ ...setting, guard: setting.isolatedPairs === false }];
    }
    return [
      { ...setting, isolatedPairs: true, guard: false },
      { ...setting, isolatedPairs: false, guard: true }
    ];
  }
  if (baseline && shouldUseRectangulatedLossyPath(baseline)) {
    return [{
      ...LOSSY_BUDGET_SWEEP[0],
      isolatedPairs: true,
      guard: false,
      allowReferenceCracks: true
    }];
  }
  const candidates = [];
  const seen = /* @__PURE__ */ new Set();
  const isolatedPairModes = baseline && baseline.length > LOSSY_AUTOMATIC_GROUP_MAX_POLYGONS ? [true] : [true, false];
  for (let budgetIndex = 0; budgetIndex < LOSSY_BUDGET_SWEEP.length; budgetIndex++) {
    const budget = LOSSY_BUDGET_SWEEP[budgetIndex];
    for (const isolatedPairs of isolatedPairModes) {
      const candidate = {
        ...budget,
        isolatedPairs,
        guard: budgetIndex > 0 || isolatedPairs === false,
        allowReferenceCracks: true
      };
      const key = [
        candidate.maxAngleDeg,
        candidate.maxPlaneDisplacement,
        candidate.maxBoundaryDisplacement,
        candidate.isolatedPairs
      ].join("|");
      if (seen.has(key)) continue;
      seen.add(key);
      candidates.push(candidate);
    }
  }
  if (candidates.length === 0) {
    return [{ ...DEFAULT_LOSSY_APPROXIMATE_OPTIONS, guard: false }];
  }
  return candidates;
}
function shouldUseRectangulatedLossyPath(baseline) {
  if (baseline.length < LOSSY_RECTANGULATED_MIN_POLYGONS) return false;
  const triangles = polygonTriangleCount(baseline);
  return triangles / baseline.length <= LOSSY_RECTANGULATED_MAX_TRIANGLE_RATIO;
}
function shouldUseRectangulatedFastExit(baseline) {
  return baseline.length >= LOSSY_RECTANGULATED_FAST_EXIT_MIN_POLYGONS && shouldUseRectangulatedLossyPath(baseline);
}
function shouldSkipAutomaticGeometryApproximation(baseline) {
  if (baseline.length < AUTOMATIC_GEOMETRY_SKIP_MIN_POLYGONS) return false;
  for (const polygon of baseline) {
    if (polygon.vertices.length !== 4) return false;
    if (polygon.texture || polygon.material?.texture || polygon.textureTriangles?.length) return false;
    const plane = planeOfPolygon(polygon);
    if (!plane || !isCardinalNormal(plane.normal)) return false;
  }
  return true;
}
function isCardinalNormal(normal) {
  const ax = Math.abs(normal[0]);
  const ay = Math.abs(normal[1]);
  const az = Math.abs(normal[2]);
  const dominant = Math.max(ax, ay, az);
  return dominant >= 1 - CARDINAL_NORMAL_EPSILON && ax + ay + az - dominant <= CARDINAL_NORMAL_EPSILON;
}
function polygonRenderCost(polygons) {
  let cost = 0;
  for (const polygon of polygons) {
    const vertexCount = polygon.vertices.length;
    const irregularPenalty = vertexCount <= 4 ? 0 : Math.min(4, vertexCount - 4) * 0.12;
    const texturePenalty = polygon.texture || polygon.material?.texture || polygon.textureTriangles?.length ? 0.15 : 0;
    cost += 1 + irregularPenalty + texturePenalty;
  }
  return cost;
}
function lossyCrackCostSlack(cost) {
  return Math.max(LOSSY_CRACK_COST_SLACK, cost * LOSSY_CRACK_RELATIVE_COST_SLACK);
}
function chooseLossyQualityCandidate(candidates, best, bestCost, candidateMetrics, bestMetrics) {
  if (candidates.length === 0) return null;
  const slack = lossyCrackCostSlack(bestCost);
  const currentCandidate = candidates.find((candidate) => candidate.polygons === best);
  let currentMetrics = null;
  let selected = null;
  let selectedMetrics = null;
  for (const candidate of candidates) {
    if (candidate.polygons === best || candidate.cost > bestCost + slack) continue;
    const metrics = candidateMetrics(candidate);
    currentMetrics ?? (currentMetrics = currentCandidate ? candidateMetrics(currentCandidate) : bestMetrics());
    if (!crackMetricsMateriallyBetter(metrics, currentMetrics)) continue;
    if (!selected || !selectedMetrics || compareLossyQualityCandidates(candidate, metrics, selected, selectedMetrics) < 0) {
      selected = candidate;
      selectedMetrics = metrics;
    }
  }
  return selected;
}
function compareLossyQualityCandidates(a, aMetrics, b, bMetrics) {
  return aMetrics.maxGap - bMetrics.maxGap || aMetrics.internalBoundaryLength - bMetrics.internalBoundaryLength || aMetrics.excessBoundaryLength - bMetrics.excessBoundaryLength || a.cost - b.cost;
}
function crackMetricsMateriallyBetter(candidate, current) {
  const gapSlack = Math.max(5e-4, current.maxGap * 0.02);
  if (candidate.maxGap < current.maxGap - gapSlack) return true;
  if (candidate.maxGap > current.maxGap + gapSlack) return false;
  const lengthSlack = Math.max(8, current.internalBoundaryLength * 0.01);
  if (candidate.internalBoundaryLength < current.internalBoundaryLength - lengthSlack) return true;
  if (candidate.internalBoundaryLength > current.internalBoundaryLength + lengthSlack) return false;
  const excessSlack = Math.max(8, current.excessBoundaryLength * 0.01);
  return candidate.excessBoundaryLength < current.excessBoundaryLength - excessSlack;
}
function crackMetricsExceed(source, metrics, tolerance, reference = null) {
  return crackMetricsExceedLimits(metrics, crackMetricLimits(source, tolerance, reference));
}
function crackMetricLimits(source, tolerance, reference = null) {
  if (!reference) {
    return {
      maxGap: Infinity,
      internalBoundaryLength: 0,
      excessBoundaryLength: tolerance
    };
  }
  const gapSlack = Math.max(tolerance * 0.1, 1e-6);
  const referenceGapLimit = reference.maxGap + gapSlack;
  const gapLimit = tolerance <= 0.08 ? Math.max(referenceGapLimit, Math.min(tolerance * 0.75, 0.04)) : referenceGapLimit;
  const lengthSlack = Math.max(tolerance * 2, reference.internalBoundaryLength * 0.15);
  const excessSlack = Math.max(tolerance * 2, reference.excessBoundaryLength * 0.15);
  return {
    maxGap: gapLimit,
    internalBoundaryLength: reference.internalBoundaryLength + lengthSlack,
    excessBoundaryLength: reference.excessBoundaryLength + excessSlack
  };
}
function crackMetricsExceedLimits(metrics, limits) {
  return metrics.maxGap > limits.maxGap || metrics.internalBoundaryLength > limits.internalBoundaryLength || metrics.excessBoundaryLength > limits.excessBoundaryLength;
}
function candidateCrackMetrics(source, candidate, maxBoundaryDisplacement = 0, searchTolerance = crackToleranceForSource(source, maxBoundaryDisplacement), stopLimits) {
  const sourceEdges = source.edges;
  const candidateEdges = collectEdgeStats(candidate);
  const tolerance = crackToleranceForSource(source, maxBoundaryDisplacement);
  const internalIndex = searchTolerance > 0 ? internalSegmentIndexForSource(source, searchTolerance) : null;
  const metrics = {
    ...EMPTY_CRACK_METRICS,
    excessBoundaryLength: Math.max(0, candidateEdges.boundaryLength - sourceEdges.boundaryLength)
  };
  if (stopLimits && crackMetricsExceedLimits(metrics, stopLimits)) {
    return { metrics, tolerance };
  }
  for (const edge of candidateEdges.boundarySegments) {
    const key = edgeKey3(edge.a, edge.b);
    if (sourceEdges.boundaryKeys.has(key)) continue;
    if (sourceEdges.internalKeys.has(key)) {
      metrics.internalBoundaryLength += distanceVec(edge.a, edge.b);
      if (stopLimits && crackMetricsExceedLimits(metrics, stopLimits)) break;
      continue;
    }
    const gap = internalIndex ? indexedInternalEdgeGap(edge, internalIndex, searchTolerance) : null;
    if (gap !== null) {
      metrics.maxGap = Math.max(metrics.maxGap, gap);
      metrics.internalBoundaryLength += distanceVec(edge.a, edge.b);
      if (stopLimits && crackMetricsExceedLimits(metrics, stopLimits)) break;
    }
  }
  return { metrics, tolerance };
}
function candidateCrackQualityMetrics(source, candidate, maxBoundaryDisplacement = 0, stopLimits) {
  return candidateCrackMetrics(
    source,
    candidate,
    maxBoundaryDisplacement,
    crackQualitySearchToleranceForSource(source, maxBoundaryDisplacement),
    stopLimits
  );
}
function createCrackSourceContext(polygons) {
  const diagonal = modelDiagonal(polygons);
  const baseTolerance = diagonal > 0 ? Math.min(0.08, Math.max(1e-3, diagonal * 1e-3)) : 0;
  return {
    edges: collectEdgeStats(polygons),
    baseTolerance,
    polygonCount: polygons.length,
    indexes: /* @__PURE__ */ new Map()
  };
}
function crackToleranceForSource(source, maxBoundaryDisplacement = 0) {
  return Math.max(source.baseTolerance, maxBoundaryDisplacement * 1.05);
}
function crackQualitySearchToleranceForSource(source, maxBoundaryDisplacement = 0) {
  return Math.max(
    crackToleranceForSource(source, maxBoundaryDisplacement),
    source.baseTolerance * LOSSY_CRACK_QUALITY_SEARCH_MULTIPLIER,
    maxBoundaryDisplacement * LOSSY_CRACK_QUALITY_SEARCH_MULTIPLIER
  );
}
function internalSegmentIndexForSource(source, tolerance) {
  const key = tolerance.toFixed(6);
  const current = source.indexes.get(key);
  if (current) return current;
  const index = buildSegmentIndex(source.edges.internalSegments, tolerance);
  source.indexes.set(key, index);
  return index;
}
function collectEdgeStats(polygons) {
  const edges = /* @__PURE__ */ new Map();
  for (const polygon of polygons) {
    for (let i = 0; i < polygon.vertices.length; i++) {
      const a = polygon.vertices[i];
      const b = polygon.vertices[(i + 1) % polygon.vertices.length];
      const key = edgeKey3(a, b);
      const current = edges.get(key);
      if (current) current.count += 1;
      else edges.set(key, { count: 1, a, b });
    }
  }
  const boundaryKeys = /* @__PURE__ */ new Set();
  const internalKeys = /* @__PURE__ */ new Set();
  const boundarySegments = [];
  const internalSegments = [];
  let boundaryLength = 0;
  for (const [key, edge] of edges) {
    const segment = { a: edge.a, b: edge.b };
    if (edge.count === 1) {
      boundaryKeys.add(key);
      boundarySegments.push(segment);
      boundaryLength += distanceVec(segment.a, segment.b);
    } else {
      internalKeys.add(key);
      internalSegments.push(segment);
    }
  }
  return { boundaryKeys, internalKeys, boundarySegments, internalSegments, boundaryLength };
}
function modelDiagonal(polygons) {
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  for (const polygon of polygons) {
    for (const [x, y, z] of polygon.vertices) {
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      minZ = Math.min(minZ, z);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      maxZ = Math.max(maxZ, z);
    }
  }
  return Number.isFinite(minX) ? Math.hypot(maxX - minX, maxY - minY, maxZ - minZ) : 0;
}
function buildSegmentIndex(segments, tolerance) {
  const cellSize = Math.max(tolerance * 2, 1e-6);
  const cells = /* @__PURE__ */ new Map();
  for (const segment of segments) {
    const [cx, cy, cz] = segmentCell(segment, cellSize);
    const key = cellKey(cx, cy, cz);
    const bucket = cells.get(key);
    if (bucket) bucket.push(segment);
    else cells.set(key, [segment]);
  }
  return { cellSize, cells };
}
function indexedInternalEdgeGap(segment, index, tolerance) {
  const [cx, cy, cz] = segmentCell(segment, index.cellSize);
  let best = null;
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dz = -1; dz <= 1; dz++) {
        const bucket = index.cells.get(cellKey(cx + dx, cy + dy, cz + dz));
        if (!bucket) continue;
        for (const candidate of bucket) {
          const gap = segmentEndpointGap(segment, candidate);
          if (gap <= tolerance) best = best === null ? gap : Math.min(best, gap);
        }
      }
    }
  }
  return best;
}
function segmentCell(segment, cellSize) {
  return [
    Math.floor((segment.a[0] + segment.b[0]) / 2 / cellSize),
    Math.floor((segment.a[1] + segment.b[1]) / 2 / cellSize),
    Math.floor((segment.a[2] + segment.b[2]) / 2 / cellSize)
  ];
}
function cellKey(x, y, z) {
  return `${x},${y},${z}`;
}
function segmentEndpointGap(a, b) {
  return Math.min(
    Math.max(distanceVec(a.a, b.a), distanceVec(a.b, b.b)),
    Math.max(distanceVec(a.a, b.b), distanceVec(a.b, b.a))
  );
}
function applyRectCoverCandidate(polygons, setting) {
  if (setting === false) return polygons;
  const options = resolveRectCoverOptions(polygons, setting);
  if (!options) return polygons;
  const covered = coverPlanarPolygons(polygons, options);
  return covered.length < polygons.length ? covered : polygons;
}
function resolveRectCoverOptions(polygons, setting) {
  if (setting && setting !== true) return setting;
  const polygonCount = polygons.length;
  if (polygonCount > 2200) return null;
  if (polygonCount > 1200) {
    return {
      ...DEFAULT_RECT_COVER_OPTIONS,
      maxCandidateAxes: Math.min(DEFAULT_RECT_COVER_OPTIONS.maxCandidateAxes ?? 24, 2)
    };
  }
  if (polygonCount > 300 && polygonTriangleCount(polygons) <= RECT_COVER_MOSTLY_QUAD_TRIANGLE_LIMIT) {
    return {
      ...DEFAULT_RECT_COVER_OPTIONS,
      maxCandidateAxes: Math.min(DEFAULT_RECT_COVER_OPTIONS.maxCandidateAxes ?? 24, 2)
    };
  }
  if (polygonCount > 900) {
    return {
      ...DEFAULT_RECT_COVER_OPTIONS,
      maxCandidateAxes: Math.min(DEFAULT_RECT_COVER_OPTIONS.maxCandidateAxes ?? 24, 4)
    };
  }
  return DEFAULT_RECT_COVER_OPTIONS;
}
function automaticLossyRectCoverOptions(polygons) {
  if (polygons.length > AUTOMATIC_RECT_COVER_MAX_POLYGONS) return false;
  if (polygons.length === 0) return false;
  if (polygonTriangleCount(polygons) / polygons.length < AUTOMATIC_RECT_COVER_MIN_TRIANGLE_RATIO) {
    return false;
  }
  return AUTOMATIC_LOSSY_RECT_COVER_OPTIONS;
}
function polygonTriangleCount(polygons) {
  let triangles = 0;
  for (const polygon of polygons) {
    if (polygon.vertices.length === 3) triangles += 1;
  }
  return triangles;
}
function applyIndexFilter(polygons, filter) {
  if (filter === void 0 || filter === null) return polygons;
  return filter.map((index) => polygons[index]).filter((polygon) => !!polygon);
}
function keptIndexFilter(input, kept) {
  if (kept === input) return null;
  if (kept.length === input.length && kept.every((polygon, index) => polygon === input[index])) {
    return null;
  }
  const keptSet = new Set(kept);
  const indices = [];
  for (let i = 0; i < input.length; i++) {
    if (keptSet.has(input[i])) indices.push(i);
  }
  return indices.length === input.length ? null : indices;
}
function dedupedPolygonsForMerge(polygons, cache) {
  if (cache?.deduped) return cache.deduped;
  let filter = cache?.dedupedIndices;
  if (filter === void 0) {
    const dropped = findOverlappingPolygonDuplicates(polygons);
    if (dropped.size === 0) {
      filter = null;
    } else {
      filter = [];
      for (let i = 0; i < polygons.length; i++) {
        if (!dropped.has(i)) filter.push(i);
      }
    }
    if (cache) cache.dedupedIndices = filter;
  }
  const deduped = applyIndexFilter(polygons, filter);
  if (cache) cache.deduped = deduped;
  return deduped;
}
function interiorPolygonsForMerge(polygons, cache) {
  if (cache?.interior) return cache.interior;
  let filter = cache?.interiorIndices;
  if (filter === void 0) {
    const kept = cullInteriorPolygons(polygons);
    filter = keptIndexFilter(polygons, kept);
    if (cache) cache.interiorIndices = filter;
  }
  const interior = applyIndexFilter(polygons, filter);
  if (cache) cache.interior = interior;
  return interior;
}
function createColorPreprocessCache(polygons, source) {
  const cache = {
    dedupedIndices: source.dedupedIndices,
    interiorIndices: source.interiorIndices,
    snappedInteriorIndices: source.snappedInteriorIndices
  };
  const deduped = dedupedPolygonsForMerge(polygons, cache);
  if (source.snapped && source.snapped.length === deduped.length) {
    cache.snapped = applyGeometryTemplate(deduped, source.snapped);
  }
  const interior = interiorPolygonsForMerge(deduped, cache);
  cache.baseline = mergePolygons(interior);
  return cache;
}
function applyGeometryTemplate(polygons, template) {
  return polygons.map((polygon, index) => {
    const geometry = template[index];
    if (!geometry) return polygon;
    return {
      ...polygon,
      vertices: geometry.vertices,
      ...geometry.uvs ? { uvs: geometry.uvs } : {},
      ...geometry.textureTriangles ? { textureTriangles: geometry.textureTriangles } : {}
    };
  });
}
function preprocessModelPolygons(polygons, normalizeGeometry, cache) {
  const deduped = dedupedPolygonsForMerge(polygons, cache);
  const interior = interiorPolygonsForMerge(deduped, cache);
  const baseline = cache?.baseline ?? mergePolygons(interior);
  if (cache && !cache.baseline) cache.baseline = baseline;
  if (!normalizeGeometry) return baseline;
  const options = normalizeGeometry === true ? DEFAULT_NORMALIZE_OPTIONS : resolveNormalizeOptions(normalizeGeometry);
  if (options.isolatedPairs) {
    const paired = mergeIsolatedTrianglePairs(snappedInteriorPolygonsForMerge(deduped, cache), options);
    const mergedPaired = mergePolygons(paired);
    return mergedPaired.length < baseline.length ? mergedPaired : baseline;
  }
  const normalized = mergePolygons(cullInteriorPolygons(normalizeGeometryForMerge(deduped, options, cache)));
  return normalized.length < baseline.length ? normalized : baseline;
}
function snappedPolygonsForMerge(polygons, cache) {
  if (!cache) return snapGeometryForMerge(polygons);
  if (!cache.snapped) cache.snapped = snapGeometryForMerge(polygons);
  return cache.snapped;
}
function snappedInteriorPolygonsForMerge(polygons, cache) {
  if (!cache) return cullInteriorPolygons(snapGeometryForMerge(polygons));
  if (!cache.snappedInterior) {
    const snapped = snappedPolygonsForMerge(polygons, cache);
    if (cache.snappedInteriorIndices === void 0) {
      const kept = cullInteriorPolygons(snapped);
      cache.snappedInteriorIndices = keptIndexFilter(snapped, kept);
      cache.snappedInterior = kept;
    } else {
      cache.snappedInterior = applyIndexFilter(snapped, cache.snappedInteriorIndices);
    }
  }
  return cache.snappedInterior;
}
function resolveNormalizeOptions(options) {
  return {
    maxAngleDeg: options.maxAngleDeg ?? DEFAULT_NORMALIZE_OPTIONS.maxAngleDeg,
    maxPlaneDisplacement: options.maxPlaneDisplacement ?? DEFAULT_NORMALIZE_OPTIONS.maxPlaneDisplacement,
    maxBoundaryDisplacement: options.maxBoundaryDisplacement ?? DEFAULT_NORMALIZE_OPTIONS.maxBoundaryDisplacement,
    isolatedPairs: options.isolatedPairs ?? DEFAULT_NORMALIZE_OPTIONS.isolatedPairs
  };
}
function mergeIsolatedTrianglePairs(polygons, options) {
  const metas = polygons.map((polygon) => {
    const plane = planeOfPolygon(polygon);
    if (!plane) return null;
    return {
      polygon,
      normal: plane.normal,
      area: plane.area,
      materialKey: materialKeyForPolygon(polygon)
    };
  });
  const edgeOwners = /* @__PURE__ */ new Map();
  for (let i = 0; i < polygons.length; i++) {
    const polygon = polygons[i];
    if (polygon.vertices.length !== 3 || !metas[i]) continue;
    for (let j = 0; j < polygon.vertices.length; j++) {
      const key = edgeKey3(polygon.vertices[j], polygon.vertices[(j + 1) % polygon.vertices.length]);
      const owners = edgeOwners.get(key);
      if (owners) owners.push(i);
      else edgeOwners.set(key, [i]);
    }
  }
  const candidates = [];
  for (const owners of edgeOwners.values()) {
    if (owners.length !== 2) continue;
    const [a, b] = owners;
    const candidate = approximateTrianglePairCandidate(a, b, polygons, metas, options);
    if (candidate) candidates.push(candidate);
  }
  const used = /* @__PURE__ */ new Set();
  const replacements = /* @__PURE__ */ new Map();
  const skipped = /* @__PURE__ */ new Set();
  const selected = choosePairCandidates(candidates);
  const vertexMoves = averagedVertexPositionMoves(selected.flatMap((candidate) => candidate.vertexMoves));
  for (const candidate of selected) {
    used.add(candidate.a);
    used.add(candidate.b);
    const outputIndex = Math.min(candidate.a, candidate.b);
    replacements.set(outputIndex, candidate.polygon);
    skipped.add(Math.max(candidate.a, candidate.b));
  }
  const output = [];
  for (let i = 0; i < polygons.length; i++) {
    const replacement = replacements.get(i);
    if (replacement) {
      output.push(replacement);
      continue;
    }
    if (skipped.has(i)) continue;
    output.push(polygons[i]);
  }
  return vertexMoves.size > 0 ? applyVertexPositionMoves(output, vertexMoves) : output;
}
function choosePairCandidates(candidates) {
  if (candidates.length > 3e3) return choosePairCandidatesStatic(candidates);
  return choosePairCandidatesDynamic(candidates);
}
function choosePairCandidatesStatic(candidates) {
  const pairDegrees = /* @__PURE__ */ new Map();
  for (const candidate of candidates) {
    pairDegrees.set(candidate.a, (pairDegrees.get(candidate.a) ?? 0) + 1);
    pairDegrees.set(candidate.b, (pairDegrees.get(candidate.b) ?? 0) + 1);
  }
  const sorted = [...candidates].sort((a, b) => {
    const degreeA = (pairDegrees.get(a.a) ?? 0) + (pairDegrees.get(a.b) ?? 0);
    const degreeB = (pairDegrees.get(b.a) ?? 0) + (pairDegrees.get(b.b) ?? 0);
    return degreeA - degreeB || a.score - b.score;
  });
  const used = /* @__PURE__ */ new Set();
  const selected = [];
  for (const candidate of sorted) {
    if (used.has(candidate.a) || used.has(candidate.b)) continue;
    used.add(candidate.a);
    used.add(candidate.b);
    selected.push(candidate);
  }
  return selected;
}
function choosePairCandidatesDynamic(candidates) {
  const incident = /* @__PURE__ */ new Map();
  for (let i = 0; i < candidates.length; i++) {
    const candidate = candidates[i];
    const aIncident = incident.get(candidate.a);
    if (aIncident) aIncident.push(i);
    else incident.set(candidate.a, [i]);
    const bIncident = incident.get(candidate.b);
    if (bIncident) bIncident.push(i);
    else incident.set(candidate.b, [i]);
  }
  const selected = [];
  const live = new Array(candidates.length).fill(true);
  const liveIncidentCount = /* @__PURE__ */ new Map();
  const heap = new PairCandidateRankHeap();
  for (const [polygon, list] of incident) liveIncidentCount.set(polygon, list.length);
  const liveDegree = (candidate) => (liveIncidentCount.get(candidate.a) ?? 0) + (liveIncidentCount.get(candidate.b) ?? 0);
  const pushRank = (index) => {
    const candidate = candidates[index];
    heap.push({
      degree: liveDegree(candidate),
      score: candidate.score,
      index
    });
  };
  const invalidate = (index, changedPolygons) => {
    if (!live[index]) return;
    live[index] = false;
    const candidate = candidates[index];
    for (const polygon of [candidate.a, candidate.b]) {
      liveIncidentCount.set(polygon, (liveIncidentCount.get(polygon) ?? 0) - 1);
      changedPolygons.add(polygon);
    }
  };
  for (let i = 0; i < candidates.length; i++) pushRank(i);
  while (heap.size() > 0) {
    const rank = heap.pop();
    if (!live[rank.index]) continue;
    const candidate = candidates[rank.index];
    const degree = liveDegree(candidate);
    if (degree !== rank.degree) {
      pushRank(rank.index);
      continue;
    }
    selected.push(candidate);
    const changedPolygons = /* @__PURE__ */ new Set();
    for (const polygon of [candidate.a, candidate.b]) {
      for (const index of incident.get(polygon) ?? []) {
        invalidate(index, changedPolygons);
      }
    }
    for (const polygon of changedPolygons) {
      for (const index of incident.get(polygon) ?? []) {
        if (live[index]) pushRank(index);
      }
    }
  }
  return selected;
}
var PairCandidateRankHeap = class {
  constructor() {
    this.items = [];
  }
  size() {
    return this.items.length;
  }
  push(item) {
    this.items.push(item);
    let index = this.items.length - 1;
    while (index > 0) {
      const parent = index - 1 >> 1;
      if (comparePairCandidateRanks(this.items[parent], this.items[index]) <= 0) break;
      [this.items[parent], this.items[index]] = [this.items[index], this.items[parent]];
      index = parent;
    }
  }
  pop() {
    if (this.items.length === 0) return null;
    const top = this.items[0];
    const last = this.items.pop();
    if (this.items.length > 0) {
      this.items[0] = last;
      let index = 0;
      for (; ; ) {
        const left = index * 2 + 1;
        const right = left + 1;
        let best = index;
        if (left < this.items.length && comparePairCandidateRanks(this.items[left], this.items[best]) < 0) best = left;
        if (right < this.items.length && comparePairCandidateRanks(this.items[right], this.items[best]) < 0) best = right;
        if (best === index) break;
        [this.items[index], this.items[best]] = [this.items[best], this.items[index]];
        index = best;
      }
    }
    return top;
  }
};
function comparePairCandidateRanks(a, b) {
  return a.degree - b.degree || a.score - b.score || a.index - b.index;
}
function mergeAdjacentApproximatePolygonPairs(polygons, options) {
  let current = polygons;
  let currentCost = polygonRenderCost(current);
  let origins = vertexOriginsForPolygons(current);
  for (let pass = 0; pass < LOSSY_POLYGON_PAIR_MAX_PASSES; pass++) {
    const result = mergeAdjacentApproximatePolygonPairPass(current, options, origins);
    if (!result) break;
    const nextCost = polygonRenderCost(result.polygons);
    if (nextCost >= currentCost) break;
    current = result.polygons;
    currentCost = nextCost;
    origins = result.origins;
  }
  return current === polygons ? polygons : current;
}
function mergeAdjacentApproximatePolygonPairPass(polygons, options, origins) {
  const metas = polygons.map((polygon) => {
    const plane = planeOfPolygon(polygon);
    if (!plane) return null;
    return {
      polygon,
      normal: plane.normal,
      area: plane.area,
      materialKey: materialKeyForPolygon(polygon)
    };
  });
  const edgeOwners = /* @__PURE__ */ new Map();
  for (let i = 0; i < polygons.length; i++) {
    const polygon = polygons[i];
    if (!metas[i] || polygon.vertices.length < 3) continue;
    for (let edge = 0; edge < polygon.vertices.length; edge++) {
      const key = edgeKey3(polygon.vertices[edge], polygon.vertices[(edge + 1) % polygon.vertices.length]);
      const owners = edgeOwners.get(key);
      if (owners) owners.push({ polygon: i, edge });
      else edgeOwners.set(key, [{ polygon: i, edge }]);
    }
  }
  const candidates = [];
  for (const owners of edgeOwners.values()) {
    if (owners.length !== 2) continue;
    const [a, b] = owners;
    const candidate = approximatePolygonPairCandidate(a.polygon, a.edge, b.polygon, b.edge, polygons, metas, options);
    if (candidate) candidates.push(candidate);
  }
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => b.score - a.score);
  const used = /* @__PURE__ */ new Set();
  const selected = [];
  for (const candidate of candidates) {
    if (used.has(candidate.a) || used.has(candidate.b)) continue;
    used.add(candidate.a);
    used.add(candidate.b);
    selected.push(candidate);
  }
  if (selected.length === 0) return null;
  const vertexMoves = averagedVertexPositionMoves(selected.flatMap((candidate) => candidate.vertexMoves));
  if (!vertexPositionMovesWithinOriginBudget(vertexMoves, origins, options.maxBoundaryDisplacement)) {
    return null;
  }
  const moved = applyVertexPositionMoves(polygons, vertexMoves);
  const movedOrigins = applyVertexPositionMovesToOrigins(polygons, vertexMoves, origins);
  const merged = mergePolygons(moved);
  return polygonRenderCost(merged) < polygonRenderCost(polygons) ? { polygons: merged, origins: pruneVertexOriginsToPolygons(merged, movedOrigins) } : null;
}
function approximatePolygonPairCandidate(aIndex, aEdge, bIndex, bEdge, polygons, metas, options) {
  const a = polygons[aIndex];
  const b = polygons[bIndex];
  const aMeta = metas[aIndex];
  const bMeta = metas[bIndex];
  if (!aMeta || !bMeta) return null;
  if (a.vertices.length === 3 && b.vertices.length === 3) return null;
  if (!canApproximatePairMerge(a, b, aMeta, bMeta)) return null;
  const normalDot = Math.abs(dotVec(aMeta.normal, bMeta.normal));
  const minNormalDot = Math.cos(options.maxAngleDeg * Math.PI / 180);
  if (normalDot < minNormalDot) return null;
  const ring = boundaryRingForAdjacentPair(a, b, aEdge) ?? boundaryRingForAdjacentPair(b, a, bEdge);
  if (!ring || ring.length < 4 || ring.length > 10) return null;
  const fit = fitPlaneForVertices(ring);
  if (!fit) return null;
  let maxDistance = 0;
  let squaredDistance = 0;
  for (const vertex of ring) {
    const distance = Math.abs(signedPlaneDistance(vertex, fit));
    maxDistance = Math.max(maxDistance, distance);
    squaredDistance += distance * distance;
  }
  if (maxDistance > Math.min(options.maxPlaneDisplacement, options.maxBoundaryDisplacement)) return null;
  const projected = ring.map((vertex) => projectVecToPlane(vertex, fit));
  if (!isConvexPolygon(projected, fit.normal)) return null;
  const projectedPlane = planeOfPolygon({ vertices: projected });
  if (!projectedPlane || dotVec(projectedPlane.normal, aMeta.normal) < 0.2 || dotVec(projectedPlane.normal, bMeta.normal) < 0.2) {
    return null;
  }
  const vertexMoves = [
    ...ring.map((vertex, index) => ({
      key: vertexKey(vertex),
      target: projected[index]
    })),
    ...textureTriangleVertexProjectionMoves([a, b], fit)
  ];
  const projectedPair = applyVertexPositionMoves([a, b], averagedVertexPositionMoves(vertexMoves));
  const sourceCost = polygonRenderCost([a, b]);
  const projectedCost = polygonRenderCost(mergePolygons(projectedPair));
  if (projectedCost >= sourceCost) return null;
  const score = sourceCost - projectedCost - (squaredDistance / ring.length + maxDistance * 0.25 + (1 - normalDot) * 0.1);
  if (score <= 0) return null;
  return {
    a: aIndex,
    b: bIndex,
    vertexMoves,
    score
  };
}
function boundaryRingForAdjacentPair(a, b, aEdge) {
  const aVertices = a.vertices;
  const bVertices = b.vertices;
  const a0 = aVertices[aEdge];
  const a1 = aVertices[(aEdge + 1) % aVertices.length];
  let bEdge = -1;
  for (let i = 0; i < bVertices.length; i++) {
    if (eqVec2(bVertices[i], a1) && eqVec2(bVertices[(i + 1) % bVertices.length], a0)) {
      bEdge = i;
      break;
    }
  }
  if (bEdge < 0) return null;
  const ring = [];
  let index = (aEdge + 1) % aVertices.length;
  ring.push(aVertices[index]);
  while (index !== aEdge) {
    index = (index + 1) % aVertices.length;
    ring.push(aVertices[index]);
  }
  index = (bEdge + 2) % bVertices.length;
  while (index !== bEdge) {
    const vertex = bVertices[index];
    if (!eqVec2(vertex, ring[ring.length - 1])) ring.push(vertex);
    index = (index + 1) % bVertices.length;
  }
  if (ring.length > 1 && eqVec2(ring[0], ring[ring.length - 1])) ring.pop();
  return ring;
}
function vertexPositionMovesWithinOriginBudget(moves, origins, budget) {
  for (const [key, target] of moves) {
    const fallback = vertexFromKey(key);
    const candidates = origins.get(key) ?? (fallback ? [fallback] : []);
    if (candidates.length === 0) return false;
    for (const source of candidates) {
      if (distanceVec(source, target) > budget + 1e-6) return false;
    }
  }
  return true;
}
function vertexOriginsForPolygons(polygons) {
  const origins = /* @__PURE__ */ new Map();
  for (const polygon of polygons) {
    for (const vertex of polygon.vertices) {
      addVertexOrigin(origins, vertexKey(vertex), vertex);
    }
    for (const triangle of polygon.textureTriangles ?? []) {
      for (const vertex of triangle.vertices) {
        addVertexOrigin(origins, vertexKey(vertex), vertex);
      }
    }
  }
  return origins;
}
function applyVertexPositionMovesToOrigins(polygons, moves, origins) {
  const moved = /* @__PURE__ */ new Map();
  for (const polygon of polygons) {
    const vertices = [
      ...polygon.vertices,
      ...(polygon.textureTriangles ?? []).flatMap((triangle) => triangle.vertices)
    ];
    for (const vertex of vertices) {
      const sourceKey = vertexKey(vertex);
      const target = moves.get(sourceKey) ?? vertex;
      const targetKey = vertexKey(target);
      for (const origin of origins.get(sourceKey) ?? [vertex]) {
        addVertexOrigin(moved, targetKey, origin);
      }
    }
  }
  return moved;
}
function pruneVertexOriginsToPolygons(polygons, origins) {
  const pruned = /* @__PURE__ */ new Map();
  for (const polygon of polygons) {
    const vertices = [
      ...polygon.vertices,
      ...(polygon.textureTriangles ?? []).flatMap((triangle) => triangle.vertices)
    ];
    for (const vertex of vertices) {
      const key = vertexKey(vertex);
      for (const origin of origins.get(key) ?? [vertex]) {
        addVertexOrigin(pruned, key, origin);
      }
    }
  }
  return pruned;
}
function addVertexOrigin(origins, key, origin) {
  const values = origins.get(key);
  if (!values) {
    origins.set(key, [origin]);
    return;
  }
  const originKey = vertexKey(origin);
  if (!values.some((value) => vertexKey(value) === originKey)) values.push(origin);
}
function vertexFromKey(key) {
  const parts = key.split(",").map(Number);
  return parts.length === 3 && parts.every(Number.isFinite) ? [parts[0], parts[1], parts[2]] : null;
}
function averagedVertexPositionMoves(moves) {
  const totals = /* @__PURE__ */ new Map();
  for (const move of moves) {
    const total = totals.get(move.key);
    if (total) {
      total.x += move.target[0];
      total.y += move.target[1];
      total.z += move.target[2];
      total.count += 1;
    } else {
      totals.set(move.key, {
        x: move.target[0],
        y: move.target[1],
        z: move.target[2],
        count: 1
      });
    }
  }
  const averaged = /* @__PURE__ */ new Map();
  for (const [key, total] of totals) {
    averaged.set(key, [
      total.x / total.count,
      total.y / total.count,
      total.z / total.count
    ]);
  }
  return averaged;
}
function vertexPositionMovesForProjection(source, projected) {
  const moves = [];
  for (let i = 0; i < source.length; i++) {
    const sourceVertices = source[i].vertices;
    const projectedVertices = projected[i]?.vertices;
    if (!projectedVertices || projectedVertices.length !== sourceVertices.length) continue;
    for (let j = 0; j < sourceVertices.length; j++) {
      moves.push({
        key: vertexKey(sourceVertices[j]),
        target: projectedVertices[j]
      });
    }
    const sourceTriangles = source[i].textureTriangles ?? [];
    const projectedTriangles = projected[i]?.textureTriangles ?? [];
    for (let j = 0; j < sourceTriangles.length; j++) {
      const projectedTriangle = projectedTriangles[j];
      if (!projectedTriangle) continue;
      for (let k = 0; k < sourceTriangles[j].vertices.length; k++) {
        moves.push({
          key: vertexKey(sourceTriangles[j].vertices[k]),
          target: projectedTriangle.vertices[k]
        });
      }
    }
  }
  return moves;
}
function textureTriangleVertexProjectionMoves(polygons, fit) {
  const moves = [];
  for (const polygon of polygons) {
    for (const triangle of polygon.textureTriangles ?? []) {
      for (const vertex of triangle.vertices) {
        moves.push({
          key: vertexKey(vertex),
          target: projectVecToPlane(vertex, fit)
        });
      }
    }
  }
  return moves;
}
function applyVertexPositionMoves(polygons, moves) {
  return polygons.map((polygon) => {
    let changed = false;
    const moveVertex = (vertex) => {
      const target = moves.get(vertexKey(vertex));
      if (!target) return vertex;
      changed = true;
      return target;
    };
    const vertices = polygon.vertices.map(moveVertex);
    const textureTriangles = mapTextureTriangleVertices(polygon.textureTriangles, moveVertex);
    return changed ? {
      ...polygon,
      vertices,
      ...textureTriangles ? { textureTriangles } : {}
    } : polygon;
  });
}
function approximateTrianglePairCandidate(aIndex, bIndex, polygons, metas, options) {
  const a = polygons[aIndex];
  const b = polygons[bIndex];
  const aMeta = metas[aIndex];
  const bMeta = metas[bIndex];
  if (!aMeta || !bMeta) return null;
  if (a.vertices.length !== 3 || b.vertices.length !== 3) return null;
  if (!canApproximatePairMerge(a, b, aMeta, bMeta)) return null;
  const shared = sharedEdgeIndices(a, b);
  if (!shared) return null;
  const [ai0, ai1, bi0, bi1] = shared;
  const bGoesSameDirection = (bi0 + 1) % b.vertices.length === bi1;
  if (bGoesSameDirection) return null;
  const normalDot = Math.abs(dotVec(aMeta.normal, bMeta.normal));
  const minNormalDot = Math.cos(options.maxAngleDeg * Math.PI / 180);
  if (normalDot < minNormalDot) return null;
  const aThird = (ai1 + 1) % a.vertices.length;
  const bThird = 3 - bi0 - bi1;
  const ring = [
    a.vertices[ai1],
    a.vertices[aThird],
    a.vertices[ai0],
    b.vertices[bThird]
  ];
  const fit = fitPlaneForVertices(ring);
  if (!fit) return null;
  let maxDistance = 0;
  let squaredDistance = 0;
  for (const vertex of ring) {
    const distance = Math.abs(signedPlaneDistance(vertex, fit));
    maxDistance = Math.max(maxDistance, distance);
    squaredDistance += distance * distance;
  }
  if (maxDistance > Math.min(options.maxPlaneDisplacement, options.maxBoundaryDisplacement)) return null;
  const projected = ring.map((vertex) => projectVecToPlane(vertex, fit));
  if (!isConvexPolygon(projected, fit.normal)) return null;
  const projectedPlane = planeOfPolygon({ vertices: projected });
  if (!projectedPlane || dotVec(projectedPlane.normal, aMeta.normal) < 0.2 || dotVec(projectedPlane.normal, bMeta.normal) < 0.2) {
    return null;
  }
  const polygon = {
    vertices: ring,
    color: a.color,
    ...a.data ? { data: { ...a.data } } : {}
  };
  if (canUseTexturedLossyMerge(a, b) && a.uvs && b.uvs && a.texture) {
    polygon.texture = a.texture;
    polygon.uvs = [
      [...a.uvs[ai1]],
      [...a.uvs[aThird]],
      [...a.uvs[ai0]],
      [...b.uvs[bThird]]
    ];
    const textureTriangles = textureTrianglesForPolygons([a, b]);
    if (textureTriangles?.length) polygon.textureTriangles = textureTriangles;
  }
  return {
    a: aIndex,
    b: bIndex,
    polygon,
    vertexMoves: [
      ...ring.map((vertex, index) => ({
        key: vertexKey(vertex),
        target: projected[index]
      })),
      ...textureTriangleVertexProjectionMoves([a, b], fit)
    ],
    score: squaredDistance / ring.length + maxDistance * 0.25 + (1 - normalDot) * 0.1
  };
}
function fitPlaneForVertices(vertices) {
  if (vertices.length < 3) return null;
  let nx = 0;
  let ny = 0;
  let nz = 0;
  let px = 0;
  let py = 0;
  let pz = 0;
  for (let i = 0; i < vertices.length; i++) {
    const current = vertices[i];
    const next = vertices[(i + 1) % vertices.length];
    nx += (current[1] - next[1]) * (current[2] + next[2]);
    ny += (current[2] - next[2]) * (current[0] + next[0]);
    nz += (current[0] - next[0]) * (current[1] + next[1]);
    px += current[0];
    py += current[1];
    pz += current[2];
  }
  const normal = normalizeVec([nx, ny, nz]);
  if (!normal) return null;
  return {
    normal,
    point: [px / vertices.length, py / vertices.length, pz / vertices.length]
  };
}
function isConvexPolygon(vertices, normal) {
  let sign = 0;
  for (let i = 0; i < vertices.length; i++) {
    const a = vertices[i];
    const b = vertices[(i + 1) % vertices.length];
    const c = vertices[(i + 2) % vertices.length];
    const turn = dotVec(crossVec(subVec(b, a), subVec(c, b)), normal);
    if (Math.abs(turn) <= 1e-9) continue;
    const nextSign = turn > 0 ? 1 : -1;
    if (sign === 0) sign = nextSign;
    else if (sign !== nextSign) return false;
  }
  return true;
}
function normalizeGeometryForMerge(polygons, options, cache) {
  const snapped = snappedPolygonsForMerge(polygons, cache);
  const planeEpsilon = planeFitEpsilon(snapped, options);
  if (planeEpsilon <= 0) return snapped;
  const metas = snapped.map((polygon) => {
    const plane = planeOfPolygon(polygon);
    if (!plane) return null;
    return {
      polygon,
      normal: plane.normal,
      area: plane.area,
      materialKey: materialKeyForPolygon(polygon)
    };
  });
  const adjacency = buildMergeAdjacency(snapped, metas);
  const assigned = /* @__PURE__ */ new Set();
  const output = Array(snapped.length);
  const vertexMoves = [];
  const writeOutput = (index, polygon) => {
    output[index] = polygon;
  };
  for (let i = 0; i < snapped.length; i++) {
    const meta = metas[i];
    if (assigned.has(i)) continue;
    if (!meta) {
      writeOutput(i, snapped[i]);
      continue;
    }
    const group = growPlaneGroup(i, metas, adjacency, assigned, planeEpsilon, options);
    for (const index of group) assigned.add(index);
    if (group.length < 2) {
      writeOutput(i, snapped[i]);
      continue;
    }
    const replacements = choosePlaneGroupReplacements(group, snapped, metas, adjacency, planeEpsilon, options);
    vertexMoves.push(...replacements.vertexMoves);
    for (const index of group) {
      writeOutput(index, replacements.polygons.get(index) ?? snapped[index]);
    }
  }
  const projected = output.flatMap((polygon) => polygon ? [polygon] : []);
  const moved = vertexMoves.length > 0 ? applyVertexPositionMoves(projected, averagedVertexPositionMoves(vertexMoves)) : projected;
  return snapGeometryForMerge(moved);
}
function snapGeometryForMerge(polygons) {
  const geometryEpsilon = geometrySnapEpsilon(polygons);
  const uvEpsilon = 1e-4;
  if (geometryEpsilon <= 0) return polygons;
  const vertices = createVec3Snapper(geometryEpsilon);
  const uvs = createVec2Snapper(uvEpsilon);
  return polygons.map((polygon) => {
    const snapVertex = (vertex) => vertices.snap(vertex);
    const snappedVertices = polygon.vertices.map(snapVertex);
    const snappedUvs = polygon.uvs && polygon.uvs.length === polygon.vertices.length ? polygon.uvs.map((uv) => uvs.snap(uv)) : void 0;
    const snappedTextureTriangles = mapTextureTriangleVertices(polygon.textureTriangles, snapVertex);
    const snappedPolygon = {
      ...polygon,
      vertices: snappedVertices,
      ...snappedUvs ? { uvs: snappedUvs } : {},
      ...snappedTextureTriangles ? { textureTriangles: snappedTextureTriangles } : {}
    };
    return {
      ...snappedPolygon,
      ...snappedPolygon.texture ? { textureTriangles: textureTrianglesForPolygon(snappedPolygon) } : {}
    };
  });
}
function textureTrianglesForPolygon(polygon) {
  if (!polygon.texture) return void 0;
  if (polygon.textureTriangles?.length) return cloneTextureTriangles2(polygon.textureTriangles);
  if (polygon.uvs && polygon.uvs.length === polygon.vertices.length) {
    return fanTextureTriangles2(polygon.vertices, polygon.uvs);
  }
  return void 0;
}
function textureTrianglesForPolygons(polygons) {
  const triangles = polygons.flatMap((polygon) => textureTrianglesForPolygon(polygon) ?? []);
  return triangles.length > 0 ? triangles : void 0;
}
function fanTextureTriangles2(vertices, uvs) {
  const triangles = [];
  for (let i = 1; i < vertices.length - 1; i++) {
    triangles.push({
      vertices: [
        [...vertices[0]],
        [...vertices[i]],
        [...vertices[i + 1]]
      ],
      uvs: [
        [...uvs[0]],
        [...uvs[i]],
        [...uvs[i + 1]]
      ]
    });
  }
  return triangles;
}
function cloneTextureTriangles2(triangles) {
  return triangles.map((triangle) => ({
    vertices: triangle.vertices.map((vertex) => [...vertex]),
    uvs: triangle.uvs.map((uv) => [...uv])
  }));
}
function mapTextureTriangleVertices(triangles, mapVertex) {
  if (!triangles?.length) return void 0;
  return triangles.map((triangle) => ({
    vertices: triangle.vertices.map(mapVertex),
    uvs: triangle.uvs.map((uv) => [...uv])
  }));
}
function choosePlaneGroupReplacements(group, polygons, metas, adjacency, planeEpsilon, options) {
  const fullGroup = projectedPlanePatchCandidate(group, polygons, metas, planeEpsilon, options);
  if (fullGroup) return replacementsForPlanePatch(fullGroup);
  return splitPlaneGroupIntoWinningPatches(group, polygons, metas, adjacency, planeEpsilon, options);
}
function splitPlaneGroupIntoWinningPatches(group, polygons, metas, adjacency, planeEpsilon, options) {
  const groupSet = new Set(group);
  const candidates = [];
  for (const a of group) {
    for (const b of adjacency.get(a) ?? []) {
      if (a >= b || !groupSet.has(b)) continue;
      const candidate = projectedPlanePatchCandidate([a, b], polygons, metas, planeEpsilon, options);
      if (candidate) candidates.push(candidate);
    }
  }
  candidates.sort((a, b) => b.score - a.score);
  const used = /* @__PURE__ */ new Set();
  const replacements = /* @__PURE__ */ new Map();
  const vertexMoves = [];
  for (const candidate of candidates) {
    if (candidate.indices.some((index) => used.has(index))) continue;
    vertexMoves.push(...candidate.vertexMoves);
    for (let i = 0; i < candidate.indices.length; i++) {
      const index = candidate.indices[i];
      used.add(index);
      replacements.set(index, polygons[index]);
    }
  }
  return { polygons: replacements, vertexMoves };
}
function replacementsForPlanePatch(candidate) {
  const replacements = /* @__PURE__ */ new Map();
  for (let i = 0; i < candidate.indices.length; i++) {
    replacements.set(candidate.indices[i], candidate.source[i]);
  }
  return { polygons: replacements, vertexMoves: candidate.vertexMoves };
}
function projectedPlanePatchCandidate(group, polygons, metas, planeEpsilon, options) {
  const fit = fitPlaneForGroup(group, metas);
  if (!fit || !groupWithinPlaneBudget(group, metas, fit, planeEpsilon, options)) return null;
  const source = group.map((index) => polygons[index]);
  const projected = source.map((polygon) => projectPolygonToPlane(polygon, fit));
  const sourceCost = polygonRenderCost(mergePolygons(source));
  const projectedCost = polygonRenderCost(mergePolygons(projected));
  if (projectedCost >= sourceCost) return null;
  return {
    indices: group,
    source,
    projected,
    vertexMoves: vertexPositionMovesForProjection(source, projected),
    score: sourceCost - projectedCost
  };
}
function planeFitEpsilon(polygons, options) {
  const geometryEpsilon = geometrySnapEpsilon(polygons);
  if (geometryEpsilon <= 0) return 0;
  return options.maxPlaneDisplacement;
}
function geometrySnapEpsilon(polygons) {
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  for (const polygon of polygons) {
    for (const [x, y, z] of polygon.vertices) {
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      minZ = Math.min(minZ, z);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      maxZ = Math.max(maxZ, z);
    }
  }
  if (!Number.isFinite(minX)) return 0;
  const diagonal = Math.hypot(maxX - minX, maxY - minY, maxZ - minZ);
  if (diagonal <= 0) return 0;
  return Math.min(0.025, Math.max(1e-4, diagonal * 25e-5));
}
function createVec3Snapper(epsilon) {
  const buckets = /* @__PURE__ */ new Map();
  const cell = (value) => Math.floor(value / epsilon);
  const key = (x, y, z) => `${x},${y},${z}`;
  return {
    snap(input) {
      const cx = cell(input[0]);
      const cy = cell(input[1]);
      const cz = cell(input[2]);
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          for (let dz = -1; dz <= 1; dz++) {
            const bucket2 = buckets.get(key(cx + dx, cy + dy, cz + dz));
            if (!bucket2) continue;
            for (const candidate of bucket2) {
              if (distanceVec(input, candidate) <= epsilon) {
                return [candidate[0], candidate[1], candidate[2]];
              }
            }
          }
        }
      }
      const snapped = [input[0], input[1], input[2]];
      const bucketKey2 = key(cx, cy, cz);
      const bucket = buckets.get(bucketKey2);
      if (bucket) bucket.push(snapped);
      else buckets.set(bucketKey2, [snapped]);
      return snapped;
    }
  };
}
function createVec2Snapper(epsilon) {
  const buckets = /* @__PURE__ */ new Map();
  const cell = (value) => Math.floor(value / epsilon);
  const key = (x, y) => `${x},${y}`;
  return {
    snap(input) {
      const cx = cell(input[0]);
      const cy = cell(input[1]);
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          const bucket2 = buckets.get(key(cx + dx, cy + dy));
          if (!bucket2) continue;
          for (const candidate of bucket2) {
            if (Math.hypot(input[0] - candidate[0], input[1] - candidate[1]) <= epsilon) {
              return [candidate[0], candidate[1]];
            }
          }
        }
      }
      const snapped = [input[0], input[1]];
      const bucketKey2 = key(cx, cy);
      const bucket = buckets.get(bucketKey2);
      if (bucket) bucket.push(snapped);
      else buckets.set(bucketKey2, [snapped]);
      return snapped;
    }
  };
}
function materialKeyForPolygon(polygon) {
  return `${polygon.color ?? "#cccccc"}|${polygon.texture ?? ""}|${polygon.uvs ? "uv" : "plain"}`;
}
function planeOfPolygon(polygon) {
  const vertices = polygon.vertices;
  if (!vertices || vertices.length < 3) return null;
  let nx = 0;
  let ny = 0;
  let nz = 0;
  const origin = vertices[0];
  for (let i = 1; i < vertices.length - 1; i++) {
    const a = subVec(vertices[i], origin);
    const b = subVec(vertices[i + 1], origin);
    const cross4 = crossVec(a, b);
    nx += cross4[0];
    ny += cross4[1];
    nz += cross4[2];
  }
  const len = Math.hypot(nx, ny, nz);
  if (len <= 1e-10) return null;
  return {
    normal: [nx / len, ny / len, nz / len],
    area: len / 2
  };
}
function buildMergeAdjacency(polygons, metas) {
  const edgeOwners = /* @__PURE__ */ new Map();
  const adjacency = /* @__PURE__ */ new Map();
  for (let i = 0; i < polygons.length; i++) {
    const polygon = polygons[i];
    if (!metas[i] || polygon.vertices.length < 3) continue;
    for (let j = 0; j < polygon.vertices.length; j++) {
      const key = edgeKey3(polygon.vertices[j], polygon.vertices[(j + 1) % polygon.vertices.length]);
      const owners = edgeOwners.get(key);
      if (owners) owners.push(i);
      else edgeOwners.set(key, [i]);
    }
  }
  for (const owners of edgeOwners.values()) {
    for (let a = 0; a < owners.length; a++) {
      for (let b = a + 1; b < owners.length; b++) {
        const ai = owners[a];
        const bi = owners[b];
        if (canShareMergePatch(polygons[ai], polygons[bi], metas[ai], metas[bi])) {
          addAdjacency(adjacency, ai, bi);
          addAdjacency(adjacency, bi, ai);
        }
      }
    }
  }
  return adjacency;
}
function canShareMergePatch(a, b, aMeta, bMeta) {
  if (!aMeta || !bMeta) return false;
  if (aMeta.materialKey !== bMeta.materialKey) return false;
  if (!!a.uvs !== !!b.uvs) return false;
  if (hasTextureMergeState(a) || hasTextureMergeState(b)) return canUseTexturedLossyMerge(a, b);
  if (!a.uvs || !b.uvs) return true;
  const shared = sharedEdgeIndices(a, b);
  if (!shared) return false;
  const [ai0, ai1, bi0, bi1] = shared;
  return eqUv(a.uvs[ai0], b.uvs[bi0]) && eqUv(a.uvs[ai1], b.uvs[bi1]);
}
function canApproximatePairMerge(a, b, aMeta, bMeta) {
  if (aMeta.materialKey !== bMeta.materialKey) return false;
  if (hasTextureMergeState(a) || hasTextureMergeState(b)) return canUseTexturedLossyMerge(a, b);
  return !a.uvs && !b.uvs && !a.textureTriangles?.length && !b.textureTriangles?.length;
}
function hasTextureMergeState(polygon) {
  return Boolean(polygon.texture || polygon.material?.texture || polygon.textureTriangles?.length);
}
function canUseTexturedLossyMerge(a, b) {
  if (!a.texture || !b.texture || a.texture !== b.texture) return false;
  if (a.material?.texture || b.material?.texture) return false;
  if (!a.uvs || !b.uvs) return false;
  if (a.uvs.length !== a.vertices.length || b.uvs.length !== b.vertices.length) return false;
  const shared = sharedEdgeIndices(a, b);
  if (!shared) return false;
  const [ai0, ai1, bi0, bi1] = shared;
  return eqUv(a.uvs[ai0], b.uvs[bi0]) && eqUv(a.uvs[ai1], b.uvs[bi1]);
}
function addAdjacency(adjacency, from, to) {
  const values = adjacency.get(from);
  if (values) values.add(to);
  else adjacency.set(from, /* @__PURE__ */ new Set([to]));
}
function growPlaneGroup(seed, metas, adjacency, assigned, planeEpsilon, options) {
  const group = [seed];
  const queued = /* @__PURE__ */ new Set([seed]);
  const queue = [seed];
  while (queue.length > 0) {
    const current = queue.shift();
    for (const next of adjacency.get(current) ?? []) {
      if (assigned.has(next) || queued.has(next)) continue;
      const nextMeta = metas[next];
      const seedMeta = metas[seed];
      if (!nextMeta || !seedMeta) continue;
      if (nextMeta.materialKey !== seedMeta.materialKey) continue;
      if (!canJoinPlaneGroup([...group, next], metas, planeEpsilon, options)) continue;
      group.push(next);
      queued.add(next);
      queue.push(next);
    }
  }
  return group;
}
function canJoinPlaneGroup(group, metas, planeEpsilon, options) {
  const fit = fitPlaneForGroup(group, metas);
  return !!fit && groupWithinPlaneBudget(group, metas, fit, planeEpsilon, options);
}
function fitPlaneForGroup(group, metas) {
  const seed = metas[group[0]];
  if (!seed) return null;
  let nx = 0;
  let ny = 0;
  let nz = 0;
  let px = 0;
  let py = 0;
  let pz = 0;
  let weightSum = 0;
  for (const index of group) {
    const meta = metas[index];
    if (!meta) return null;
    const direction = dotVec(seed.normal, meta.normal) < 0 ? -1 : 1;
    const weight = Math.max(meta.area, 1e-6);
    nx += meta.normal[0] * direction * weight;
    ny += meta.normal[1] * direction * weight;
    nz += meta.normal[2] * direction * weight;
    for (const vertex of meta.polygon.vertices) {
      px += vertex[0];
      py += vertex[1];
      pz += vertex[2];
      weightSum += 1;
    }
  }
  const normal = normalizeVec([nx, ny, nz]);
  if (!normal || weightSum === 0) return null;
  const boundaryVertices = groupBoundaryVertexKeys(group, metas);
  const boundaryD = planeOffsetRangeForVertices(group, metas, normal, boundaryVertices);
  if (boundaryD) {
    const d = (boundaryD.min + boundaryD.max) / 2;
    return {
      normal,
      point: [normal[0] * d, normal[1] * d, normal[2] * d]
    };
  }
  return {
    normal,
    point: [px / weightSum, py / weightSum, pz / weightSum]
  };
}
function planeOffsetRangeForVertices(group, metas, normal, vertexKeys) {
  let min = Infinity;
  let max = -Infinity;
  for (const index of group) {
    const meta = metas[index];
    if (!meta) continue;
    for (const vertex of meta.polygon.vertices) {
      if (!vertexKeys.has(vertexKey(vertex))) continue;
      const d = dotVec(vertex, normal);
      min = Math.min(min, d);
      max = Math.max(max, d);
    }
  }
  return Number.isFinite(min) && Number.isFinite(max) ? { min, max } : null;
}
function groupWithinPlaneBudget(group, metas, fit, planeEpsilon, options) {
  const normalDotMin = Math.cos(options.maxAngleDeg * Math.PI / 180);
  const boundaryVertices = groupBoundaryVertexKeys(group, metas);
  for (const index of group) {
    const meta = metas[index];
    if (!meta) return false;
    if (Math.abs(dotVec(meta.normal, fit.normal)) < normalDotMin) return false;
    for (const vertex of meta.polygon.vertices) {
      const limit = boundaryVertices.has(vertexKey(vertex)) ? options.maxBoundaryDisplacement : planeEpsilon;
      if (Math.abs(signedPlaneDistance(vertex, fit)) > limit) return false;
    }
  }
  return true;
}
function groupBoundaryVertexKeys(group, metas) {
  const edgeCounts = /* @__PURE__ */ new Map();
  for (const index of group) {
    const meta = metas[index];
    if (!meta) continue;
    const vertices = meta.polygon.vertices;
    for (let i = 0; i < vertices.length; i++) {
      const a = vertices[i];
      const b = vertices[(i + 1) % vertices.length];
      const key = edgeKey3(a, b);
      const current = edgeCounts.get(key);
      if (current) current.count += 1;
      else edgeCounts.set(key, { count: 1, a, b });
    }
  }
  const boundary = /* @__PURE__ */ new Set();
  for (const edge of edgeCounts.values()) {
    if (edge.count !== 1) continue;
    boundary.add(vertexKey(edge.a));
    boundary.add(vertexKey(edge.b));
  }
  return boundary;
}
function projectPolygonToPlane(polygon, fit) {
  const projectVertex = (vertex) => projectVecToPlane(vertex, fit);
  const textureTriangles = mapTextureTriangleVertices(polygon.textureTriangles, projectVertex);
  return {
    ...polygon,
    vertices: polygon.vertices.map(projectVertex),
    ...textureTriangles ? { textureTriangles } : {}
  };
}
function sharedEdgeIndices(a, b) {
  for (let ai0 = 0; ai0 < a.vertices.length; ai0++) {
    const ai1 = (ai0 + 1) % a.vertices.length;
    for (let bi0 = 0; bi0 < b.vertices.length; bi0++) {
      const bi1 = (bi0 + 1) % b.vertices.length;
      if (eqVec2(a.vertices[ai0], b.vertices[bi0]) && eqVec2(a.vertices[ai1], b.vertices[bi1])) {
        return [ai0, ai1, bi0, bi1];
      }
      if (eqVec2(a.vertices[ai0], b.vertices[bi1]) && eqVec2(a.vertices[ai1], b.vertices[bi0])) {
        return [ai0, ai1, bi1, bi0];
      }
    }
  }
  return null;
}
function edgeKey3(a, b) {
  const ak = vertexKey(a);
  const bk = vertexKey(b);
  return ak < bk ? `${ak}|${bk}` : `${bk}|${ak}`;
}
function vertexKey(vertex) {
  return `${vertex[0]},${vertex[1]},${vertex[2]}`;
}
function eqVec2(a, b) {
  return a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
}
function eqUv(a, b) {
  return Math.abs(a[0] - b[0]) <= 1e-4 && Math.abs(a[1] - b[1]) <= 1e-4;
}
function subVec(a, b) {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}
function crossVec(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0]
  ];
}
function dotVec(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}
function distanceVec(a, b) {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}
function normalizeVec(value) {
  const length2 = Math.hypot(value[0], value[1], value[2]);
  if (length2 <= 1e-10) return null;
  return [value[0] / length2, value[1] / length2, value[2] / length2];
}
function signedPlaneDistance(vertex, fit) {
  return dotVec(subVec(vertex, fit.point), fit.normal);
}
function projectVecToPlane(vertex, fit) {
  const distance = signedPlaneDistance(vertex, fit);
  return [
    vertex[0] - fit.normal[0] * distance,
    vertex[1] - fit.normal[1] * distance,
    vertex[2] - fit.normal[2] * distance
  ];
}

// packages/core/src/parser/solidTextureSamples.ts
var DEFAULT_MAX_TEXTURE_PIXELS = 16 * 1024 * 1024;

// packages/core/src/voxel/voxelSlicePlanner.ts
var CUBE_FACES = ["t", "b", "bl", "br", "fr", "fl"];
var FACE_ORDER = new Map(CUBE_FACES.map((face, index) => [face, index]));

// packages/polycss/src/render/textureAtlas.ts
var ATLAS_MAX_SIZE = 4096;
var AUTO_ATLAS_LOW_AREA = ATLAS_MAX_SIZE * ATLAS_MAX_SIZE;
var AUTO_ATLAS_MEDIUM_AREA = AUTO_ATLAS_LOW_AREA * 3;
var AUTO_ATLAS_MAX_DECODED_BYTES_MOBILE = 4 * 1024 * 1024;
var AUTO_ATLAS_MAX_DECODED_BYTES_DESKTOP = 16 * 1024 * 1024;
var PROJECTIVE_QUAD_MAX_WEIGHT_RATIO = Number.POSITIVE_INFINITY;

// bench/entries/normalize.ts
function preprocessModelPolygons2(polygons, normalizeGeometry) {
  return optimizeMeshPolygons(polygons, {
    meshResolution: normalizeGeometry ? "lossy" : "lossless"
  });
}
function paintPolygonsSolid(polygons, color) {
  return polygons.map((p) => ({
    ...p,
    color,
    texture: void 0,
    uvs: void 0,
    textureTriangles: void 0
  }));
}
function polygonsToWireframe(polygons, lineWidth, color) {
  const out = [];
  for (const p of polygons) {
    const v = p.vertices;
    if (!v || v.length < 3) continue;
    const n = computePolygonNormal(v);
    if (!n) continue;
    const half = lineWidth / 2;
    for (let i = 0; i < v.length; i++) {
      const a = v[i];
      const b = v[(i + 1) % v.length];
      const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
      const len = Math.hypot(dx, dy, dz);
      if (len < 1e-9) continue;
      const ex = dx / len, ey = dy / len, ez = dz / len;
      const px = n[1] * ez - n[2] * ey;
      const py = n[2] * ex - n[0] * ez;
      const pz = n[0] * ey - n[1] * ex;
      const plen = Math.hypot(px, py, pz) || 1;
      const ox = px / plen * half;
      const oy = py / plen * half;
      const oz = pz / plen * half;
      out.push({
        vertices: [
          [a[0] + ox, a[1] + oy, a[2] + oz],
          [b[0] + ox, b[1] + oy, b[2] + oz],
          [b[0] - ox, b[1] - oy, b[2] - oz],
          [a[0] - ox, a[1] - oy, a[2] - oz]
        ],
        color
      });
    }
  }
  return out;
}
function computePolygonNormal(vertices) {
  let nx = 0, ny = 0, nz = 0;
  const o = vertices[0];
  for (let i = 1; i < vertices.length - 1; i++) {
    const a = vertices[i];
    const b = vertices[i + 1];
    const ax = a[0] - o[0], ay = a[1] - o[1], az = a[2] - o[2];
    const bx = b[0] - o[0], by = b[1] - o[1], bz = b[2] - o[2];
    nx += ay * bz - az * by;
    ny += az * bx - ax * bz;
    nz += ax * by - ay * bx;
  }
  const len = Math.hypot(nx, ny, nz);
  if (len < 1e-12) return null;
  return [nx / len, ny / len, nz / len];
}
export {
  paintPolygonsSolid,
  polygonsToWireframe,
  preprocessModelPolygons2 as preprocessModelPolygons
};
