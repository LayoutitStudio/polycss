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
  /** Parallel to `memberPolysUv`: for each member, the CCW edge indices
   *  (edge i = point i → point i+1 of the stored CCW member polygon) that
   *  geometrically coincide with an edge of ANOTHER member of the same
   *  group. Used by the shadow member-clip seam bleed — clip polygons
   *  expand outward along these edges only, so abutting members' clipped
   *  shadow subpaths overlap instead of leaving an antialiasing seam.
   *  `undefined` for members with no shared edges. */
  memberSharedEdges: Array<ReadonlySet<number> | undefined>;
};

function normalizeWorldUnitPx(worldUnitPx: number): number {
  if (!Number.isFinite(worldUnitPx) || worldUnitPx <= 0) {
    throw new Error("PolyCSS world unit size must be a positive finite number.");
  }
  return worldUnitPx;
}

/** Convert a world-space scalar to CSS pixels. The default matches PolyCSS's
 *  current renderer scale: one world unit = BASE_TILE CSS px. */
export function worldDistanceToCss(value: number, worldUnitPx = BASE_TILE): number {
  return value * normalizeWorldUnitPx(worldUnitPx);
}

/** Convert a CSS-pixel scalar back to PolyCSS world units. */
export function cssDistanceToWorld(value: number, worldUnitPx = BASE_TILE): number {
  return value / normalizeWorldUnitPx(worldUnitPx);
}

/** World→CSS axis swap. World is `+X right, +Y forward, +Z up`; the renderer's
 *  internal frame swaps X↔Y and scales by BASE_TILE (one world unit =
 *  BASE_TILE CSS px). Same conversion every renderer applies at the boundary
 *  for mesh positions, polygon vertices, and light directions. */
export function worldPositionToCss(p: Vec3, worldUnitPx = BASE_TILE): Vec3 {
  const scale = normalizeWorldUnitPx(worldUnitPx);
  return [p[1] * scale, p[0] * scale, p[2] * scale];
}

/** Inverse of {@link worldPositionToCss}: CSS-pixel frame → world XYZ. */
export function cssPositionToWorld(p: Vec3, worldUnitPx = BASE_TILE): Vec3 {
  const scale = normalizeWorldUnitPx(worldUnitPx);
  return [p[1] / scale, p[0] / scale, p[2] / scale];
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
 *  frame as the polygon normals. Public package wrappers delegate here so
 *  directional-light conversion stays single-source. */
export function worldDirectionalLightToCss<
  T extends { direction?: Vec3 } | undefined,
>(light: T): T {
  if (!light?.direction) return light;
  return { ...light, direction: worldDirectionToCss(light.direction) } as T;
}

export const worldDistanceToPolyCss = worldDistanceToCss;
export const polyCssDistanceToWorld = cssDistanceToWorld;
export const worldPositionToPolyCss = worldPositionToCss;
export const polyCssPositionToWorld = cssPositionToWorld;
export const worldDirectionToPolyCss = worldDirectionToCss;
export const worldDirectionalLightToPolyCss = worldDirectionalLightToCss;

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

/** Half-width of the "same infinite line" band for the collinear-adjacency
 *  predicate, in CSS px on the receiver plane. */
export const RECEIVER_EDGE_PERP_EPS = 0.25;
/** Minimum overlap length along the shared line for two collinear edges to
 *  count as adjacent (CSS px). Requiring POSITIVE length keeps collinear
 *  continuations — edges meeting at a single point — non-adjacent. */
export const RECEIVER_EDGE_OVERLAP_EPS = 1e-3;

/** A 2D edge on a receiver plane, precomputed for the collinear-adjacency
 *  predicate. Built by {@link planarEdge}. */
export type PlanarEdge = {
  ax: number; ay: number; bx: number; by: number;
  minX: number; minY: number; maxX: number; maxY: number;
  len: number;
};

/** Precompute a {@link PlanarEdge}. Returns `null` for degenerate edges
 *  shorter than {@link RECEIVER_EDGE_OVERLAP_EPS}, which can never contribute
 *  a positive-length overlap. */
export function planarEdge(
  a: readonly [number, number],
  b: readonly [number, number],
): PlanarEdge | null {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  if (len <= RECEIVER_EDGE_OVERLAP_EPS) return null;
  return {
    ax: a[0], ay: a[1], bx: b[0], by: b[1],
    minX: Math.min(a[0], b[0]), minY: Math.min(a[1], b[1]),
    maxX: Math.max(a[0], b[0]), maxY: Math.max(a[1], b[1]),
    len,
  };
}

function perpDistToEdgeLine(E: PlanarEdge, px: number, py: number): number {
  return Math.abs((px - E.ax) * (E.by - E.ay) - (py - E.ay) * (E.bx - E.ax)) / E.len;
}

/**
 * THE shared geometric contract for T-junction adjacency on a receiver plane:
 * two edges are adjacent when they lie on the same infinite line within
 * `RECEIVER_EDGE_PERP_EPS` and their projections onto that line overlap by
 * more than `RECEIVER_EDGE_OVERLAP_EPS`.
 *
 * Both the face-grouping union pass (which decides how many shadow SVGs a
 * receiver emits) and the member seam-bleed pass (which decides which member
 * clip edges expand) depend on this being ONE predicate — a grouping that
 * merges faces the bleed pass then treats as unshared would reopen the exact
 * hairline cracks both exist to close.
 *
 * Collinearity is checked in BOTH directions so a short edge sitting at a
 * slight angle near a long edge's line does not false-positive.
 */
export function planarEdgesShareLine(A: PlanarEdge, B: PlanarEdge): boolean {
  if (
    A.minX > B.maxX + RECEIVER_EDGE_PERP_EPS || B.minX > A.maxX + RECEIVER_EDGE_PERP_EPS ||
    A.minY > B.maxY + RECEIVER_EDGE_PERP_EPS || B.minY > A.maxY + RECEIVER_EDGE_PERP_EPS
  ) return false;
  if (
    perpDistToEdgeLine(A, B.ax, B.ay) > RECEIVER_EDGE_PERP_EPS ||
    perpDistToEdgeLine(A, B.bx, B.by) > RECEIVER_EDGE_PERP_EPS
  ) return false;
  if (
    perpDistToEdgeLine(B, A.ax, A.ay) > RECEIVER_EDGE_PERP_EPS ||
    perpDistToEdgeLine(B, A.bx, A.by) > RECEIVER_EDGE_PERP_EPS
  ) return false;
  const dx = (A.bx - A.ax) / A.len;
  const dy = (A.by - A.ay) / A.len;
  const t0 = (B.ax - A.ax) * dx + (B.ay - A.ay) * dy;
  const t1 = (B.bx - A.ax) * dx + (B.by - A.ay) * dy;
  const bMin = Math.min(t0, t1);
  const bMax = Math.max(t0, t1);
  return Math.min(A.len, bMax) - Math.max(0, bMin) > RECEIVER_EDGE_OVERLAP_EPS;
}

/** A 3D world-frame edge, precomputed for the CREASE-adjacency predicate.
 *  Built by {@link spatialEdge}. Crease neighbours live on DIFFERENT face
 *  planes, so they are not coplanar and the 2D {@link planarEdgesShareLine}
 *  predicate does not apply — the shared line has to be found in world space. */
export type SpatialEdge = {
  ax: number; ay: number; az: number;
  bx: number; by: number; bz: number;
  dx: number; dy: number; dz: number;
  minX: number; maxX: number;
  minY: number; maxY: number;
  minZ: number; maxZ: number;
  len: number;
};

/** Broad phase for {@link spatialEdgesShareLine}: two edges on a common line
 *  within `RECEIVER_EDGE_PERP_EPS` necessarily have AABBs overlapping within
 *  that same slack, so this rejects non-neighbours before the four
 *  perpendicular-distance evaluations. Pure optimization — it can never
 *  reject a pair the predicate would have accepted. */
export function spatialEdgeBoundsOverlap(A: SpatialEdge, B: SpatialEdge): boolean {
  const e = RECEIVER_EDGE_PERP_EPS;
  return !(
    A.minX > B.maxX + e || B.minX > A.maxX + e ||
    A.minY > B.maxY + e || B.minY > A.maxY + e ||
    A.minZ > B.maxZ + e || B.minZ > A.maxZ + e
  );
}

/** Precompute a {@link SpatialEdge}. Returns `null` for degenerate edges
 *  shorter than {@link RECEIVER_EDGE_OVERLAP_EPS}. */
export function spatialEdge(a: Vec3, b: Vec3): SpatialEdge | null {
  const ex = b[0] - a[0], ey = b[1] - a[1], ez = b[2] - a[2];
  const len = Math.hypot(ex, ey, ez);
  if (len <= RECEIVER_EDGE_OVERLAP_EPS) return null;
  return {
    ax: a[0], ay: a[1], az: a[2],
    bx: b[0], by: b[1], bz: b[2],
    dx: ex / len, dy: ey / len, dz: ez / len,
    minX: Math.min(a[0], b[0]), maxX: Math.max(a[0], b[0]),
    minY: Math.min(a[1], b[1]), maxY: Math.max(a[1], b[1]),
    minZ: Math.min(a[2], b[2]), maxZ: Math.max(a[2], b[2]),
    len,
  };
}

function perpDistToSpatialLine(E: SpatialEdge, px: number, py: number, pz: number): number {
  const rx = px - E.ax, ry = py - E.ay, rz = pz - E.az;
  // |r × d| with d already unit → perpendicular distance to the line.
  return Math.hypot(
    ry * E.dz - rz * E.dy,
    rz * E.dx - rx * E.dz,
    rx * E.dy - ry * E.dx,
  );
}

/**
 * World-space sibling of {@link planarEdgesShareLine}: two 3D edges are
 * adjacent when they lie on the same infinite line within
 * `RECEIVER_EDGE_PERP_EPS` and their projections onto that line overlap by
 * more than `RECEIVER_EDGE_OVERLAP_EPS`. Same tolerances, same both-directions
 * collinearity check — only the dimensionality differs.
 *
 * This is the geometric test for a CREASE: an edge whose neighbouring surface
 * belongs to a different (non-coplanar) receiver face group. Those two groups
 * emit separate shadow SVGs whose antialiased clip edges meet exactly at the
 * crease and do not sum to full coverage, which is the hairline-crack class
 * this predicate exists to find.
 */
export function spatialEdgesShareLine(A: SpatialEdge, B: SpatialEdge): boolean {
  if (A.minX > B.maxX + RECEIVER_EDGE_PERP_EPS || B.minX > A.maxX + RECEIVER_EDGE_PERP_EPS) {
    return false;
  }
  if (
    perpDistToSpatialLine(A, B.ax, B.ay, B.az) > RECEIVER_EDGE_PERP_EPS ||
    perpDistToSpatialLine(A, B.bx, B.by, B.bz) > RECEIVER_EDGE_PERP_EPS
  ) return false;
  if (
    perpDistToSpatialLine(B, A.ax, A.ay, A.az) > RECEIVER_EDGE_PERP_EPS ||
    perpDistToSpatialLine(B, A.bx, A.by, A.bz) > RECEIVER_EDGE_PERP_EPS
  ) return false;
  const t0 = (B.ax - A.ax) * A.dx + (B.ay - A.ay) * A.dy + (B.az - A.az) * A.dz;
  const t1 = (B.bx - A.ax) * A.dx + (B.by - A.ay) * A.dy + (B.bz - A.az) * A.dz;
  const bMin = Math.min(t0, t1);
  const bMax = Math.max(t0, t1);
  return Math.min(A.len, bMax) - Math.max(0, bMin) > RECEIVER_EDGE_OVERLAP_EPS;
}

/**
 * Detect edges shared between DIFFERENT member polygons of one face group,
 * in the group's (u, v) space. Two passes: an exact endpoint-pair hash at the
 * grouping's 1e-3 quantization (orientation-independent, catches cleanly
 * shared edges), then a collinear-overlap sweep for T-junction topology where
 * a member edge lies along part of a neighbour's edge without sharing
 * endpoints (imported architecture like the castle). Edge index i is the
 * stored CCW member polygon's point i → point i+1 edge.
 */
export function detectMemberSharedEdges(
  memberPolysUv: ReadonlyArray<ReadonlyArray<readonly [number, number]>>,
): Array<ReadonlySet<number> | undefined> {
  const result: Array<Set<number> | undefined> = memberPolysUv.map(() => undefined);
  if (memberPolysUv.length < 2) return result;
  const ptKey = (p: readonly [number, number]): string =>
    `${Math.round(p[0] * 1000)},${Math.round(p[1] * 1000)}`;
  const edgeUvKey = (a: readonly [number, number], b: readonly [number, number]): string => {
    const ka = ptKey(a);
    const kb = ptKey(b);
    return ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
  };
  const owners = new Map<string, Array<{ member: number; edge: number }>>();
  for (let mi = 0; mi < memberPolysUv.length; mi++) {
    const poly = memberPolysUv[mi]!;
    for (let e = 0; e < poly.length; e++) {
      const key = edgeUvKey(poly[e]!, poly[(e + 1) % poly.length]!);
      let list = owners.get(key);
      if (!list) { list = []; owners.set(key, list); }
      list.push({ member: mi, edge: e });
    }
  }
  const mark = (member: number, edge: number): void => {
    let set = result[member];
    if (!set) { set = new Set(); result[member] = set; }
    set.add(edge);
  };
  for (const list of owners.values()) {
    if (list.length < 2) continue;
    let multiMember = false;
    for (let i = 1; i < list.length; i++) {
      if (list[i]!.member !== list[0]!.member) { multiMember = true; break; }
    }
    if (!multiMember) continue;
    for (const o of list) mark(o.member, o.edge);
  }

  // Collinear-overlap pass: imported meshes (the castle) have T-JUNCTIONS —
  // a member edge lying along a PORTION of a neighbour's longer edge without
  // sharing endpoints, which the exact endpoint-pair pass above can't see.
  // Adjacency is decided by the shared `planarEdgesShareLine` predicate, the
  // same one `groupReceiverFaceGroups` unions faces with.
  //
  // The whole edge is bled even when only part of it overlaps: partial-edge
  // bleed would need vertex insertion, destabilizing the convex offset. The
  // ≤ SHADOW_CLIP_SEAM_BLEED overshoot along the non-overlapped remainder is
  // sub-pixel and still bounded by the group outline clip.
  //
  // Nominally O(edges²) per group, reduced to a sweep: edges are sorted by
  // `minX` so the inner loop can BREAK once a candidate starts to the right of
  // the current edge's right end — every later candidate starts further right
  // still. Two edges that share a line within PERP_EPS always have overlapping
  // x-intervals, so the break can never skip a real adjacency.
  const edges: Array<PlanarEdge & { member: number; edge: number }> = [];
  for (let mi = 0; mi < memberPolysUv.length; mi++) {
    const poly = memberPolysUv[mi]!;
    for (let e = 0; e < poly.length; e++) {
      const built = planarEdge(poly[e]!, poly[(e + 1) % poly.length]!);
      if (built) edges.push({ ...built, member: mi, edge: e });
    }
  }
  edges.sort((a, b) => a.minX - b.minX);
  for (let i = 0; i < edges.length; i++) {
    const A = edges[i]!;
    const xLimit = A.maxX + RECEIVER_EDGE_PERP_EPS;
    for (let j = i + 1; j < edges.length; j++) {
      const B = edges[j]!;
      if (B.minX > xLimit) break;
      if (A.member === B.member) continue;
      if (result[A.member]?.has(A.edge) && result[B.member]?.has(B.edge)) continue;
      if (!planarEdgesShareLine(A, B)) continue;
      mark(A.member, A.edge);
      mark(B.member, B.edge);
    }
  }
  return result;
}

/**
 * Groups a receiver's polygons into shadow-receiving surfaces. Two passes:
 *
 *   1. Plane bucket — group by matching normal + plane offset within tolerance
 *      (catches tessellated flat regions).
 *   2. Connected component — within each plane bucket, union-find on shared-
 *      edge adjacency: an exact >= 2-shared-vertex test first, then the
 *      `planarEdgesShareLine` T-junction test for pairs that fail it. Catches
 *      disjoint coplanar walls where a convex hull of everything would bridge
 *      an air gap, while keeping T-junction neighbours (imported architecture)
 *      in ONE group — separate groups mean separate SVGs, whose abutting
 *      antialiased edges do not sum to full coverage and show as hairline
 *      light cracks through the shadow.
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
    // One projection pass per bucket: world positions feed both the exact
    // vertex-key sets and the bucket-basis 2D edges the T-junction predicate
    // needs. The bucket rep's basis is the same one `emitGroup` projects into.
    const { O: bO, u: bU, v: bV } = bucket.rep;
    const faceVertexSets: Set<string>[] = [];
    const faceEdges: PlanarEdge[][] = [];
    const faceBounds: Array<{ minX: number; minY: number; maxX: number; maxY: number }> = [];
    for (const fp of bucket.faces) {
      const set = new Set<string>();
      const pts: Array<[number, number]> = [];
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const vert of fp.face.vertices) {
        const w = worldCss(vert, rpos);
        set.add(vertexKey(w));
        const dx = w[0] - bO[0], dy = w[1] - bO[1], dz = w[2] - bO[2];
        const pt: [number, number] = [
          dx * bU[0] + dy * bU[1] + dz * bU[2],
          dx * bV[0] + dy * bV[1] + dz * bV[2],
        ];
        pts.push(pt);
        if (pt[0] < minX) minX = pt[0];
        if (pt[0] > maxX) maxX = pt[0];
        if (pt[1] < minY) minY = pt[1];
        if (pt[1] > maxY) maxY = pt[1];
      }
      faceVertexSets.push(set);
      const built: PlanarEdge[] = [];
      for (let e = 0; e < pts.length; e++) {
        const edge = planarEdge(pts[e]!, pts[(e + 1) % pts.length]!);
        if (edge) built.push(edge);
      }
      faceEdges.push(built);
      faceBounds.push({ minX, minY, maxX, maxY });
    }
    const parent: number[] = bucket.faces.map((_, i) => i);
    const find = (x: number): number => {
      while (parent[x]! !== x) { parent[x] = parent[parent[x]!]!; x = parent[x]!; }
      return x;
    };
    const union = (a: number, b: number) => {
      const ra = find(a), rb = find(b);
      if (ra !== rb) parent[ra] = rb;
    };
    // Sweep the bucket left-to-right so the inner loop can BREAK past faces
    // that start beyond the current face's right end. Both adjacency tests
    // require touching geometry, so both imply overlapping x-intervals — the
    // break can only skip pairs that could never union.
    const order = bucket.faces.map((_, i) => i)
      .sort((a, b) => faceBounds[a]!.minX - faceBounds[b]!.minX);
    for (let oi = 0; oi < order.length; oi++) {
      const i = order[oi]!;
      const xLimit = faceBounds[i]!.maxX + RECEIVER_EDGE_PERP_EPS;
      for (let oj = oi + 1; oj < order.length; oj++) {
        const j = order[oj]!;
        if (faceBounds[j]!.minX > xLimit) break;
        // Already one component: neither test below can change the partition,
        // and skipping keeps a large connected tessellation off the
        // O(faces² × edges²) worst case.
        if (find(i) === find(j)) continue;
        const a = faceVertexSets[i]!, b = faceVertexSets[j]!;
        let shared = 0;
        for (const k of a) if (b.has(k)) { shared++; if (shared >= 2) break; }
        if (shared >= 2) { union(i, j); continue; }
        const ba = faceBounds[i]!, bb = faceBounds[j]!;
        if (
          ba.minX > bb.maxX + RECEIVER_EDGE_PERP_EPS ||
          bb.minX > ba.maxX + RECEIVER_EDGE_PERP_EPS ||
          ba.minY > bb.maxY + RECEIVER_EDGE_PERP_EPS ||
          bb.minY > ba.maxY + RECEIVER_EDGE_PERP_EPS
        ) continue;
        const ea = faceEdges[i]!, eb = faceEdges[j]!;
        let adjacent = false;
        for (let x = 0; x < ea.length && !adjacent; x++) {
          for (let y = 0; y < eb.length; y++) {
            if (planarEdgesShareLine(ea[x]!, eb[y]!)) { adjacent = true; break; }
          }
        }
        if (adjacent) union(i, j);
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
    const memberSharedEdges = detectMemberSharedEdges(memberPolysUv);
    out.push({ O, n, u, v, outlineUv, memberPolysUv, memberPolyIndices, memberSharedEdges });
  }
  return out;
}
