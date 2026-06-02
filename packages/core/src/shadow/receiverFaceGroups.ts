/**
 * Pure geometric helpers for receiver-shadow face grouping. Inputs are polygon
 * arrays + transform parameters; outputs are 2D/3D vectors and plane groups.
 * Used by every renderer (vanilla, React, Vue) to identify the coplanar
 * surface groups on a `receiveShadow: true` mesh that should aggregate cast
 * shadows under one SVG per group.
 *
 * Lives in core so renderers don't duplicate the algorithm or depend on each
 * other. Renderers wrap the pure-data output with their own DOM mounting.
 */
import { BASE_TILE } from "../camera/camera";
import { convexHull2D, ensureCcw2D } from "./projection";
import type { Polygon, Vec3 } from "../types";

/**
 * One coplanar group of receiver polygons projected into a 2D (u, v) basis on
 * the shared plane. Sutherland-Hodgman clips caster-projected shadows to this
 * group's outline; the per-member polygons let the renderer post-filter sub-
 * shadows that fall outside the actual surface union (concave-bridging air
 * gaps inside the convex hull).
 */
export type ReceiverPlaneGroup = {
  O: Vec3;       // CSS-3D origin (representative face vertex 0)
  n: Vec3;       // unit normal
  u: Vec3;       // in-plane u basis
  v: Vec3;       // in-plane v basis (= n × u)
  outlineUv: Array<[number, number]>;  // CCW convex hull of group's (u,v) coords (Minkowski-expanded)
  memberPolysUv: Array<Array<[number, number]>>;
  memberPolyIndices: number[];
};

/** World→CSS axis swap. World is `+X right, +Y forward, +Z up`; the renderer's
 *  internal frame swaps X↔Y and scales by BASE_TILE (one world unit =
 *  BASE_TILE CSS px). Same conversion every renderer applies at the boundary
 *  for mesh positions, polygon vertices, and light directions. */
export function worldPositionToCss(p: Vec3): Vec3 {
  return [p[1] * BASE_TILE, p[0] * BASE_TILE, p[2] * BASE_TILE];
}

/** World→CSS axis swap for directions (no scale; directions stay unit). The
 *  polygon basis stores normals in the swapped CSS frame, so light vectors
 *  must match before any dot product. */
export function worldDirectionToCss(d: Vec3): Vec3 {
  return [d[1], d[0], d[2]];
}

/** Apply {@link worldDirectionToCss} to a directional-light object,
 *  preserving the other fields. Used by atlas plan + buildBasisHints +
 *  receiver-shadow callers so the light vector is in the same CSS-axis
 *  frame as the polygon normals. Mirror of vanilla's
 *  `worldDirectionalLightToCss` in `packages/polycss/src/api/scene/transforms.ts`. */
export function worldDirectionalLightToCss<
  T extends { direction?: Vec3 } | undefined,
>(light: T): T {
  if (!light?.direction) return light;
  return { ...light, direction: worldDirectionToCss(light.direction) } as T;
}

/** Normalize a mesh `scale` value into a Vec3 (undefined → [1,1,1], number →
 *  uniform, Vec3 → as-is with `?? 1` per axis). */
export function meshScaleVec3(
  scale: number | Vec3 | undefined | null,
): Vec3 {
  if (scale === undefined || scale === null) return [1, 1, 1];
  if (typeof scale === "number") return [scale, scale, scale];
  return [scale[0] ?? 1, scale[1] ?? 1, scale[2] ?? 1];
}

/**
 * Build a `vert → CSS-frame world position` function for a mesh with the
 * given scale + position. Pivots scale from the mesh ORIGIN. Rotation is
 * intentionally not applied here — shadow geometry is computed once per
 * mesh-transform change and already lives in world coords after this
 * per-vertex transform; rotation lives on the wrapper.
 */
export function worldCssForMesh(
  scale: number | Vec3 | undefined | null,
): (vert: Vec3, pos: Vec3) => Vec3 {
  const s = meshScaleVec3(scale);
  const unit = s[0] === 1 && s[1] === 1 && s[2] === 1;
  return (vert, pos) => {
    const cssPos = worldPositionToCss(pos);
    const x0 = vert[1] * BASE_TILE;
    const y0 = vert[0] * BASE_TILE;
    const z0 = vert[2] * BASE_TILE;
    const sx = unit ? x0 : x0 * s[0];
    const sy = unit ? y0 : y0 * s[1];
    const sz = unit ? z0 : z0 * s[2];
    return [sx + cssPos[0], sy + cssPos[1], sz + cssPos[2]];
  };
}

/**
 * Minkowski expansion of a convex CCW polygon outward by `expand` units. Each
 * vertex moves along the bisector of its two adjacent edge outward-
 * perpendiculars, scaled so the edge offset distance equals `expand` (true
 * Minkowski sum with a disk of radius `expand`, evaluated at the vertex). For
 * convex inputs the result is a larger convex polygon with every edge offset
 * outward by exactly `expand`.
 */
export function expandConvexHullOutward(
  hullCcw: Array<[number, number]>,
  expand: number,
): Array<[number, number]> {
  if (hullCcw.length < 3 || expand === 0) return hullCcw;
  const out: Array<[number, number]> = [];
  const n = hullCcw.length;
  for (let i = 0; i < n; i++) {
    const u = hullCcw[(i - 1 + n) % n]!;
    const v = hullCcw[i]!;
    const w = hullCcw[(i + 1) % n]!;
    const e1x = v[0] - u[0], e1y = v[1] - u[1];
    const e2x = w[0] - v[0], e2y = w[1] - v[1];
    const l1 = Math.hypot(e1x, e1y), l2 = Math.hypot(e2x, e2y);
    if (l1 < 1e-9 || l2 < 1e-9) { out.push(v); continue; }
    const n1x = e1y / l1, n1y = -e1x / l1;
    const n2x = e2y / l2, n2y = -e2x / l2;
    const bx = n1x + n2x, by = n1y + n2y;
    const bl = Math.hypot(bx, by);
    if (bl < 1e-9) { out.push(v); continue; }
    const bxn = bx / bl, byn = by / bl;
    const dot = bxn * n1x + byn * n1y;
    if (Math.abs(dot) < 1e-9) { out.push(v); continue; }
    const scale = expand / dot;
    out.push([v[0] + bxn * scale, v[1] + byn * scale]);
  }
  return out;
}

/** Outward extension applied to each receiver face's convex outline (CSS px).
 *  Adjacent receiver faces sharing an edge each expand by this amount, so the
 *  two shadows overlap by ~2×EXPAND at the corner — eliminating the sub-pixel
 *  light strip that used to appear where two wall faces meet. 0.5 CSS px stays
 *  sub-pixel at typical zoom. */
export const RECEIVER_OUTLINE_EXPAND = 0.5;

/** Plane-grouping tolerances. dot-product > 0.999 (~2.5° angular) catches
 *  tessellation artifacts on flat surfaces without merging adjacent faces of
 *  a low-poly curved mesh. Plane-offset tolerance is 0.5 CSS px — sub-pixel
 *  coplanarity drift in glTF imports doesn't separate what should be a single
 *  surface. */
export const RECEIVER_NORMAL_TOL = 0.001;
export const RECEIVER_OFFSET_TOL = 0.5;

/**
 * Groups a receiver's polygons into shadow-receiving surfaces. Two passes:
 *
 *   1. Plane bucket — group by matching normal + plane offset within tolerance
 *      (catches tessellated flat regions).
 *   2. Connected component — within each plane bucket, union-find on shared-
 *      edge adjacency (faces sharing >= 2 vertices). Catches disjoint coplanar
 *      walls where a convex hull of everything would bridge an air gap.
 *
 * Per group, output a convex hull in the group's (u, v) coords (Minkowski-
 * expanded by `RECEIVER_OUTLINE_EXPAND`).
 *
 * `worldCss(vert, pos)` is the per-vertex world→CSS conversion (built via
 * `worldCssForMesh` for the receiver's scale + position). `dedupDrop` is the
 * set of receiver polygon indices to skip.
 */
export function groupReceiverFaceGroups(
  polygons: readonly Polygon[],
  rpos: Vec3,
  worldCss: (vert: Vec3, pos: Vec3) => Vec3,
  dedupDrop: ReadonlySet<number>,
): ReceiverPlaneGroup[] {
  type FacePlane = {
    face: Polygon;
    O: Vec3; n: Vec3; u: Vec3; v: Vec3;
    offset: number;
  };
  type FacePlaneWithIndex = FacePlane & { polyIndex: number };
  const facePlanes: FacePlaneWithIndex[] = [];
  for (let i = 0; i < polygons.length; i++) {
    if (dedupDrop.has(i)) continue;
    const face = polygons[i]!;
    if (face.vertices.length < 3) continue;
    // World vertices for this face.
    const ws: Vec3[] = face.vertices.map((vert) => worldCss(vert, rpos));
    const O = ws[0]!;
    // Compute face normal via fan-triangulated cross-product sum (Newell-
    // style). Using only the first 3 vertices is fragile: any polygon
    // whose v0/v1/v2 happen to be near-collinear (long thin slabs with
    // a short leading edge, or merged polys with clustered first
    // vertices) yields a tiny cross product that gets culled by the
    // `nLen < 1e-9` threshold even though the face is geometrically
    // well-defined. Summing across all fan triangles gives the true
    // face normal (= 2× signed area along normal) regardless of which
    // corner happens to be first. Sign matches `e2 × e1` for the
    // original (v0,v1,v2) triangle so the LEFT-hand outward convention
    // is preserved.
    let nx = 0, ny = 0, nz = 0;
    for (let k = 1; k + 1 < ws.length; k++) {
      const a = ws[k]!, b = ws[k + 1]!;
      const e1x = a[0] - O[0], e1y = a[1] - O[1], e1z = a[2] - O[2];
      const e2x = b[0] - O[0], e2y = b[1] - O[1], e2z = b[2] - O[2];
      nx += e2y * e1z - e2z * e1y;
      ny += e2z * e1x - e2x * e1z;
      nz += e2x * e1y - e2y * e1x;
    }
    const nLen = Math.hypot(nx, ny, nz);
    if (nLen < 1e-9) continue;
    const n: Vec3 = [nx / nLen, ny / nLen, nz / nLen];
    // Pick `u` as the FIRST edge that's long enough — same fan loop so
    // the basis is robust to a degenerate leading edge too.
    let u: Vec3 | null = null;
    for (let k = 1; k < ws.length; k++) {
      const w = ws[k]!;
      const ex = w[0] - O[0], ey = w[1] - O[1], ez = w[2] - O[2];
      const eLen = Math.hypot(ex, ey, ez);
      if (eLen > 1e-9) { u = [ex / eLen, ey / eLen, ez / eLen]; break; }
    }
    if (!u) continue;
    // Re-orthogonalize u against n so the basis is exactly planar even
    // when the picked edge has tiny out-of-plane component from float
    // noise after rotation accumulates.
    const uDotN = u[0] * n[0] + u[1] * n[1] + u[2] * n[2];
    u = [u[0] - uDotN * n[0], u[1] - uDotN * n[1], u[2] - uDotN * n[2]];
    const uLen2 = Math.hypot(u[0], u[1], u[2]);
    if (uLen2 < 1e-9) continue;
    u = [u[0] / uLen2, u[1] / uLen2, u[2] / uLen2];
    const v: Vec3 = [
      n[1] * u[2] - n[2] * u[1],
      n[2] * u[0] - n[0] * u[2],
      n[0] * u[1] - n[1] * u[0],
    ];
    const offset = n[0] * O[0] + n[1] * O[1] + n[2] * O[2];
    facePlanes.push({ face, O, n, u, v, offset, polyIndex: i });
  }

  type PlaneBucket = { rep: FacePlaneWithIndex; faces: FacePlaneWithIndex[] };
  const planeBuckets: PlaneBucket[] = [];
  for (const fp of facePlanes) {
    let merged = false;
    for (const g of planeBuckets) {
      const r = g.rep;
      const dot = fp.n[0] * r.n[0] + fp.n[1] * r.n[1] + fp.n[2] * r.n[2];
      if (1 - dot > RECEIVER_NORMAL_TOL) continue;
      if (Math.abs(fp.offset - r.offset) > RECEIVER_OFFSET_TOL) continue;
      g.faces.push(fp);
      merged = true;
      break;
    }
    if (!merged) planeBuckets.push({ rep: fp, faces: [fp] });
  }

  const out: ReceiverPlaneGroup[] = [];
  const VERTEX_KEY_PRECISION = 3;
  const vertexKey = (w: Vec3): string =>
    `${w[0].toFixed(VERTEX_KEY_PRECISION)},${w[1].toFixed(VERTEX_KEY_PRECISION)},${w[2].toFixed(VERTEX_KEY_PRECISION)}`;
  for (const bucket of planeBuckets) {
    if (bucket.faces.length === 1) {
      emitGroup(bucket.faces);
      continue;
    }
    const faceVertexSets: Set<string>[] = bucket.faces.map((fp) => {
      const set = new Set<string>();
      for (const vert of fp.face.vertices) set.add(vertexKey(worldCss(vert, rpos)));
      return set;
    });
    const parent: number[] = bucket.faces.map((_, i) => i);
    const find = (x: number): number => {
      while (parent[x]! !== x) { parent[x] = parent[parent[x]!]!; x = parent[x]!; }
      return x;
    };
    const union = (a: number, b: number) => {
      const ra = find(a), rb = find(b);
      if (ra !== rb) parent[ra] = rb;
    };
    for (let i = 0; i < bucket.faces.length; i++) {
      for (let j = i + 1; j < bucket.faces.length; j++) {
        const a = faceVertexSets[i]!, b = faceVertexSets[j]!;
        let shared = 0;
        for (const k of a) if (b.has(k)) { shared++; if (shared >= 2) break; }
        if (shared >= 2) union(i, j);
      }
    }
    const componentFaces = new Map<number, FacePlaneWithIndex[]>();
    for (let i = 0; i < bucket.faces.length; i++) {
      const root = find(i);
      let arr = componentFaces.get(root);
      if (!arr) { arr = []; componentFaces.set(root, arr); }
      arr.push(bucket.faces[i]!);
    }
    for (const componentFacesArr of componentFaces.values()) emitGroup(componentFacesArr);
  }

  function emitGroup(faces: FacePlaneWithIndex[]): void {
    const rep = faces[0]!;
    const { O, n, u, v } = rep;
    const uvs: Array<[number, number]> = [];
    const memberPolysUv: Array<Array<[number, number]>> = [];
    const memberPolyIndices: number[] = [];
    for (const fp of faces) {
      const polyUv: Array<[number, number]> = [];
      for (const vert of fp.face.vertices) {
        const w = worldCss(vert, rpos);
        const dx = w[0] - O[0];
        const dy = w[1] - O[1];
        const dz = w[2] - O[2];
        const pt: [number, number] = [
          dx * u[0] + dy * u[1] + dz * u[2],
          dx * v[0] + dy * v[1] + dz * v[2],
        ];
        uvs.push(pt);
        polyUv.push(pt);
      }
      if (polyUv.length >= 3) {
        memberPolysUv.push(ensureCcw2D(polyUv));
        memberPolyIndices.push(fp.polyIndex);
      }
    }
    if (uvs.length < 3) return;
    const hull = convexHull2D(uvs);
    if (hull.length < 3) return;
    const outlineUv = expandConvexHullOutward(ensureCcw2D(hull), RECEIVER_OUTLINE_EXPAND);
    out.push({ O, n, u, v, outlineUv, memberPolysUv, memberPolyIndices });
  }
  return out;
}
