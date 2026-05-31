/**
 * Pure geometric helpers for shadow projection. Extracted from
 * createPolyScene.ts so the per-receiver-face shadow path can be unit-tested
 * in isolation and the main scene factory stays focused on DOM wiring.
 *
 * Nothing here touches scene state, MeshEntry, or the DOM. Inputs are
 * polygon arrays + transform parameters; outputs are 2D/3D vectors and
 * plane groups. Callers in createPolyScene close over their own MeshEntry
 * state and adapt it into the parameters this module expects.
 */
import {
  convexHull2D,
  ensureCcw2D,
} from "@layoutit/polycss-core";
import type { Polygon, Vec3 } from "@layoutit/polycss-core";
import {
  DEFAULT_TILE,
  worldPositionToCss,
} from "./transforms";

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
  /** Per-constituent-polygon (u,v) outlines that make up this face group.
   *  Used to post-filter sub-shadows that land inside the convex hull but
   *  OUTSIDE the actual polygon union (concave regions like an L-shape's
   *  inside corner — the hull bridges the air gap, so shadows clipped to the
   *  hull paint in regions with no physical surface). Each member is a CCW
   *  (u,v) polygon. */
  memberPolysUv: Array<Array<[number, number]>>;
  /** Receiver-mesh polygon indices for the members in memberPolysUv, in
   *  matching order. Used to look up per-polygon facts about the receiver
   *  surface (e.g. whether every member is occluded from the light, in which
   *  case the entire face is already painted at ambient-only by the baked
   *  atlas and no shadow projection should be layered on top). */
  memberPolyIndices: number[];
};

/**
 * Normalize a `PolyMeshTransform.scale` value into a Vec3.
 *
 *   - undefined / null   → `[1, 1, 1]`
 *   - number `s`         → `[s, s, s]`
 *   - `[sx, sy, sz]`     → as-is (with `?? 1` per axis)
 */
export function meshScaleVec3(
  scale: number | Vec3 | undefined | null,
): Vec3 {
  if (scale === undefined || scale === null) return [1, 1, 1];
  if (typeof scale === "number") return [scale, scale, scale];
  return [scale[0] ?? 1, scale[1] ?? 1, scale[2] ?? 1];
}

/**
 * Build a `vert → CSS-frame world position` function for a mesh with the
 * given scale + position. Pivots scale from the mesh ORIGIN (matches the
 * Three.js mesh.scale semantics also used by buildMeshTransform). Rotation
 * is intentionally not applied here — shadow geometry is computed once per
 * mesh-transform change and already lives in world coords after the
 * per-vertex transform; rotation lives on the wrapper.
 */
export function worldCssForMesh(
  scale: number | Vec3 | undefined | null,
): (vert: Vec3, pos: Vec3) => Vec3 {
  const s = meshScaleVec3(scale);
  const unit = s[0] === 1 && s[1] === 1 && s[2] === 1;
  return (vert, pos) => {
    const cssPos = worldPositionToCss(pos);
    const x0 = vert[1] * DEFAULT_TILE;
    const y0 = vert[0] * DEFAULT_TILE;
    const z0 = vert[2] * DEFAULT_TILE;
    const sx = unit ? x0 : x0 * s[0];
    const sy = unit ? y0 : y0 * s[1];
    const sz = unit ? z0 : z0 * s[2];
    return [sx + cssPos[0], sy + cssPos[1], sz + cssPos[2]];
  };
}

/**
 * Minkowski expansion of a convex CCW polygon outward by `expand` units.
 * Each vertex moves along the bisector of its two adjacent edge outward-
 * perpendiculars, scaled so the edge offset distance equals `expand` (true
 * Minkowski sum with a disk of radius `expand`, evaluated at the vertex).
 * For convex inputs the result is a larger convex polygon with every edge
 * offset outward by exactly `expand`.
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
 *  Adjacent receiver faces sharing an edge each expand by this amount in
 *  their own UV basis, so the two shadows overlap by ~2×EXPAND at the corner
 *  — eliminating the sub-pixel light strip that used to appear where two
 *  wall faces meet (the residual gap left after SELF_SHADOW_EPS / lift
 *  reductions). 0.5 CSS px stays sub-pixel at typical zoom. */
export const RECEIVER_OUTLINE_EXPAND = 0.5;

/** Plane-grouping tolerances. dot-product > 0.999 (~2.5° angular) catches
 *  tessellation artifacts on flat surfaces without merging adjacent faces
 *  of a low-poly curved mesh. Plane-offset tolerance is 0.5 CSS px — sub-
 *  pixel coplanarity drift in glTF imports doesn't separate what should be
 *  a single surface. */
export const RECEIVER_NORMAL_TOL = 0.001;
export const RECEIVER_OFFSET_TOL = 0.5;

/**
 * Groups a receiver's polygons into shadow-receiving surfaces. Two passes:
 *
 *   1. **Plane bucket** — group by matching normal + plane offset within
 *      tolerance. Catches tessellated flat regions (many triangles on one
 *      plane).
 *   2. **Connected component** — within each plane bucket, run union-find on
 *      shared-edge adjacency (faces sharing >= 2 vertices). Catches the case
 *      where a mesh has disjoint coplanar walls (e.g. a cottage with a front
 *      body + a forward entry section both at the same Y plane): the
 *      hull-of-everything would bridge the air gap and paint shadow on the
 *      empty space between them. Connected components keep each real wall as
 *      its own group.
 *
 * Per group, output a convex hull in the group's (u, v) coords (Minkowski-
 * expanded by `RECEIVER_OUTLINE_EXPAND`). Hull is the right shape for
 * connected coplanar regions (cubes, planes, simple platforms). It still
 * over-extends in true L-shaped regions where neighbouring edges connect
 * AROUND a concave corner — rare for an L of just two edges, harder to avoid
 * without a polygon-union implementation downstream (Sutherland-Hodgman
 * needs convex clips).
 *
 * `worldCss(vert, pos)` is the per-vertex world→CSS conversion (built via
 * `worldCssForMesh` for the receiver's scale + position). `dedupDrop` is the
 * set of receiver polygon indices to skip (interior polygons that were
 * already dropped by `cullInteriorPolygons`).
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
    offset: number;  // plane offset = n · O
  };
  type FacePlaneWithIndex = FacePlane & { polyIndex: number };
  const facePlanes: FacePlaneWithIndex[] = [];
  for (let i = 0; i < polygons.length; i++) {
    if (dedupDrop.has(i)) continue;
    const face = polygons[i]!;
    if (face.vertices.length < 3) continue;
    const O = worldCss(face.vertices[0]!, rpos);
    const w1 = worldCss(face.vertices[1]!, rpos);
    const w2 = worldCss(face.vertices[2]!, rpos);
    const e1: Vec3 = [w1[0] - O[0], w1[1] - O[1], w1[2] - O[2]];
    const e2: Vec3 = [w2[0] - O[0], w2[1] - O[1], w2[2] - O[2]];
    // Normal = e2 × e1 (LEFT-hand cross), matching the atlas builder's
    // outward CSS-frame normal under PolyCSS's axis swap. e1 × e2 (right-
    // hand) would point inward → shadow would land on the side facing
    // away from the light.
    const nx = e2[1] * e1[2] - e2[2] * e1[1];
    const ny = e2[2] * e1[0] - e2[0] * e1[2];
    const nz = e2[0] * e1[1] - e2[1] * e1[0];
    const nLen = Math.hypot(nx, ny, nz);
    if (nLen < 1e-9) continue;
    const n: Vec3 = [nx / nLen, ny / nLen, nz / nLen];
    const e1Len = Math.hypot(e1[0], e1[1], e1[2]);
    if (e1Len < 1e-9) continue;
    const u: Vec3 = [e1[0] / e1Len, e1[1] / e1Len, e1[2] / e1Len];
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
  const VERTEX_KEY_PRECISION = 3;  // ~0.001 CSS px
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
