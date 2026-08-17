/**
 * Pure receiver-shadow algorithm. For each coplanar receiver face group on a
 * `receiveShadow: true` mesh, project every caster polygon onto that face's
 * plane along the directional-light vector, Sutherland-Hodgman-clip against
 * the face outline, and emit one ShadowFaceSpec per visible group.
 *
 * Shared across vanilla / React / Vue. Renderers handle cache invalidation
 * + DOM mounting; this module owns the geometry.
 *
 * Caching strategy: every input is precomputed by the caller (caster items +
 * receiver face planes). The caller maintains WeakMap<Mesh, ...> caches and
 * re-runs the prepare* helpers only when their bust keys change. The
 * compute step is pure data-in/data-out so it's safe to call every frame.
 */
import { BASE_TILE } from "../camera/camera";
import { normalFacesCamera, type CameraCullRotation } from "../cull/cameraBackfaceCulling";
import { shadePolygon } from "../atlas/paintDefaults";
import { safePlanSeamBleedAmount } from "../atlas/edgeRepair";
import { offsetConvexPolygonPointsByEdgeAmounts } from "../atlas/solidTriangle";
import { parseHexColor } from "../color/color";
import { rotateVec3InWrapperCssFrame } from "../math/rotation";
import { clipPolygonToConvex2D } from "./clipping";
import { ensureCcw2D } from "./projection";
import {
  expandConvexHullOutward,
  groupReceiverFaceGroups,
  meshScaleVec3,
  RECEIVER_EDGE_PERP_EPS,
  RECEIVER_OUTLINE_EXPAND,
  spatialEdge,
  spatialEdgeBoundsOverlap,
  spatialEdgesShareLine,
  worldCssForMesh,
  worldPositionToCss,
  type SpatialEdge,
} from "./receiverFaceGroups";
import {
  buildEdgeOwners as buildEdgeOwnersHelper,
  classifyFacing,
  extractSilhouetteLoops,
  silhouetteReliable,
  type EdgeOwners,
} from "./silhouette";
import type {
  PolyAmbientLight,
  PolyDirectionalLight,
  Polygon,
  Vec2,
  Vec3,
} from "../types";

/** Minimum item count required to attempt per-caster-mesh silhouette
 *  extraction. For smaller meshes (crates, simple primitives) the
 *  per-poly path stays cheaper than building the edge map and walking
 *  loops. See `bench/notes/SHADOW_PERF_LOG.md` H9. */
const SILHOUETTE_MIN_POLYS = 40;

/**
 * Outward overscan (CSS px on the receiver plane — UV units) applied to a
 * member polygon's clip outline along its SHARED and CREASE edges only, before
 * shadow geometry is clipped against it. Exactly-abutting clipped subpaths
 * don't sum to full coverage under SVG antialiasing, so member seams and
 * creases showed a hairline light strip — the same artifact class the atlas
 * seam bleed solves for solid leaves. Edges with no neighbouring surface get
 * zero expansion so the shadow never leaks past the face-group boundary.
 *
 * Fixed constant: the scene `seamBleed` option does not flow into the
 * shadow pipeline (`shadow` options carry only color/opacity/maxExtend),
 * and threading it through all three renderers is out of scope here.
 */
export const SHADOW_CLIP_SEAM_BLEED = 0.75;

/**
 * How much wider than `RECEIVER_OUTLINE_EXPAND` the shadow pre-clip has to be
 * so it never caps the per-edge member bleed. The pre-clip runs BEFORE the
 * per-member clips, so at the stored 0.5 px outline a crease sitting on the
 * group hull (91% of the castle's) kept only 0.5 px of its granted 0.75 px.
 * Applied ONLY where a crease edge was actually bled, because the stored outline also
 * sizes the face plane's matrix and box — widening that unconditionally moves
 * emitted geometry on multi-light and textured receivers, which get no crease
 * bleed at all. The group hull is not the surface boundary (the member clips
 * are, and they still bound every edge), so widening the clip copy cannot push
 * shadow past a member outline.
 */
const CLIP_OUTLINE_EXTRA = Math.max(0, SHADOW_CLIP_SEAM_BLEED - RECEIVER_OUTLINE_EXPAND);

/**
 * Per-receiver cached face geometry. One record per coplanar face group:
 * plane (O, n, u, v), outline polygon (Sutherland-Hodgman clip), bbox in
 * (u, v) for SVG sizing, and the pre-stringified matrix3d transform that
 * places an SVG on that face plane.
 *
 * All of this is invariant under light/caster changes. Per light tick the
 * caller just re-runs the per-tri SH and builds the path `d` — never
 * recompute groups or basis. Cache invalidated when the receiver's polygon
 * count or position changes.
 */
export interface ReceiverFacePlane {
  O: Vec3;
  n: Vec3;
  u: Vec3;
  v: Vec3;
  outlineUv: Array<[number, number]>;
  memberPolysUv: Array<Array<[number, number]>>;
  /** Parallel to `memberPolysUv`: each member's unsnapped world-space vertices
   *  (see `ReceiverPlaneGroup.memberPolysWorld`). Crease matching reads these
   *  rather than lifting (u, v) back to 3D, which would snap non-planar
   *  members onto their group plane and hide real creases.
   *
   *  Optional so a hand-built plane still type-checks: without it a face gets
   *  no crease detection and no pre-blend (its members' shading cannot be
   *  verified), which is the safe degradation, not a silent approximation. */
  memberPolysWorld?: Vec3[][];
  memberPolyIndices: number[];
  /** Parallel to `memberPolysUv`: CCW edge indices shared with another member
   *  of the same group (see `ReceiverPlaneGroup.memberSharedEdges`). Drives
   *  the member-clip seam bleed. Optional — absent means no seam bleed. */
  memberSharedEdges?: Array<ReadonlySet<number> | undefined>;
  /** Parallel to `memberPolysUv`: CCW edge index → the normals of the
   *  neighbouring surfaces that belong to a DIFFERENT (non-coplanar) face
   *  group — a CREASE. Those two groups emit separate SVGs, so their
   *  antialiased clip edges abut at the crease without summing to full
   *  coverage. Unioned with `memberSharedEdges` at clip-expansion time so one
   *  pass bleeds both classes. Filled by `prepareReceiverFacePlanes` after the
   *  occlusion cull; edges already in `memberSharedEdges` are skipped
   *  (already bled).
   *
   *  The neighbour normals are kept — not just the edge index — because the
   *  bleed is only safe where the neighbour actually renders on the far side
   *  of the crease. See `creaseBleedsIntoNeighbour`.
   *
   *  Optional, and filled in place by `prepareReceiverFacePlanes`; absent
   *  means no crease bleed. */
  memberCreaseEdges?: Array<ReadonlyMap<number, Vec3[]> | undefined>;
  minU: number;
  minV: number;
  width: number;
  height: number;
  matrixCss: string;
  faceIndex: number;
  /** World-frame lift (already × BASE_TILE) along +n. Re-applied per-frame
   *  when building a tight shadow SVG matrix so the SVG hovers over the face. */
  lift: number;
}

/**
 * Per-caster cached per-polygon data: world-space vertices + 3D AABB
 * corners + caster-polygon plane normal/offset. Invariant under light
 * direction; depends only on the caster mesh's geometry and position.
 */
export interface CasterPolyItem {
  wv: Vec3[];
  bboxCorners: Vec3[];
  planeN: Vec3 | null;
  planeOffset: number;
  polygonIndex: number;
}

/** A caster mesh's prepared items paired with a stable identifier the caller
 *  can use for per-path attribution. */
export interface ReceiverCasterInput<T = unknown> {
  /** Caller-defined identifier (e.g. mesh ref, mesh shadow id). Echoed back
   *  on each emitted path so the renderer can map a subpath to its source
   *  caster mesh. */
  id: T;
  items: CasterPolyItem[];
  /** Self-shadow edge adjacency. When this caster is the same mesh as the
   *  receiver, the renderer pre-computes a map polygonIndex →
   *  set-of-other-polygonIndex that share at least one edge (within
   *  EDGE_MATCH_EPS). The shadow algorithm skips projecting `polygonIndex`
   *  onto any receiver face whose member set intersects the shared-edge
   *  set — those projections are sliver shadows along seams (smooth-shaded
   *  GLB meshes, subdivided spheres) that the user never wants to see. */
  selfShadowEdgeMap?: ReadonlyMap<number, ReadonlySet<number>>;
  /** Per-mesh edge ownership map for silhouette extraction. Cached by the
   *  caller (WeakMap<Mesh, …>) and shared across receivers within a frame.
   *  When present AND the caster is NOT the receiver AND items.length ≥
   *  SILHOUETTE_MIN_POLYS, the shadow algorithm projects per-mesh
   *  silhouette loops instead of every front-facing triangle — collapses
   *  the N-triangle path to 1 outline per caster per receiver. See H9 in
   *  `bench/notes/SHADOW_PERF_LOG.md`. */
  edgeOwners?: ReadonlyMap<string, EdgeOwners>;
  /** Total polygon count on the source caster mesh (NOT the filtered
   *  `items` count). Needed by silhouette extraction so the `facing`
   *  array is sized correctly even when atlas-plan / dedup filters drop
   *  some polygons from `items`. */
  casterPolygonCount?: number;
  /** Parametric-shadow override: a precomputed world-frame silhouette loop set
   *  (see `computeParametricShadowSilhouette`). When present it is projected
   *  directly — skipping per-poly and silhouette extraction — so a cheap,
   *  low-resolution outline casts onto every receiver via the normal pipeline. */
  overrideSilhouette?: Vec3[][];
  /** Per-point-light parametric override (indexed by the point light's index in
   *  `allPointLights`). A point pass uses this RADIAL silhouette instead of the
   *  directional `overrideSilhouette`; an undefined entry → exact point path. */
  overridePointSilhouettes?: Array<Vec3[][] | undefined>;
}

/**
 * Build a polygon-adjacency map: polygonIndex → set of polygonIndex that
 * share at least one edge (vertex pair, orientation-independent). Used by
 * the receiver-shadow algorithm to cull sliver shadows along mesh seams.
 *
 * Edge match tolerance is small enough to dedupe vertex coordinates that
 * went through `optimizeMeshPolygons` snap-to-plane but not so loose it
 * connects geometrically distinct polygons.
 */
export function buildSharedEdgeMap(
  polygons: readonly Polygon[],
): Map<number, Set<number>> {
  const EDGE_MATCH_PRECISION = 1e-4;
  const quant = (n: number): string => Math.round(n / EDGE_MATCH_PRECISION).toString(36);
  const vertKey = (v: Vec3): string => `${quant(v[0])},${quant(v[1])},${quant(v[2])}`;
  // Edge key: sorted vertex-pair string so orientation doesn't matter.
  const edgeKey = (a: Vec3, b: Vec3): string => {
    const ka = vertKey(a);
    const kb = vertKey(b);
    return ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
  };
  // edgeKey → polygon indices touching that edge
  const edgeOwners = new Map<string, number[]>();
  for (let i = 0; i < polygons.length; i++) {
    const poly = polygons[i];
    if (!poly || poly.vertices.length < 2) continue;
    const verts = poly.vertices;
    for (let j = 0; j < verts.length; j++) {
      const a = verts[j]!;
      const b = verts[(j + 1) % verts.length]!;
      const k = edgeKey(a, b);
      let owners = edgeOwners.get(k);
      if (!owners) {
        owners = [];
        edgeOwners.set(k, owners);
      }
      owners.push(i);
    }
  }
  const out = new Map<number, Set<number>>();
  for (const owners of edgeOwners.values()) {
    if (owners.length < 2) continue;
    for (const a of owners) {
      for (const b of owners) {
        if (a === b) continue;
        let set = out.get(a);
        if (!set) {
          set = new Set();
          out.set(a, set);
        }
        set.add(b);
      }
    }
  }
  return out;
}

/** One contributing caster's shadow subpath on a single receiver face. */
export interface ReceiverShadowPath<T = unknown> {
  /** Caster id echoed from the input. */
  casterId: T;
  /** Path data string: `M…L…Z` subpaths in face-local (u, v) coordinates
   *  pre-translated so the SVG's `viewBox` is `0 0 width height`. */
  d: string;
  /** Source polygon indices on the caster mesh in subpath order (one per
   *  M…L…Z block). Used for DevTools attribution. */
  casterPolygonIndices: number[];
}

/** Per-receiver-face shadow spec. Renderer mounts one SVG per spec. */
export interface ReceiverShadowFaceSpec<T = unknown> {
  /** Index into the prepared `ReceiverFacePlane[]` list. Stable across
   *  frames; used as the `data-poly-shadow-receiver-face` attr. */
  faceIndex: number;
  /** Receiver polygon indices that make up this coplanar group. */
  memberPolyIndices: number[];
  /** matrix3d(...) transform that places the SVG on the face plane. */
  matrixCss: string;
  width: number;
  height: number;
  /** Fill (and stroke) color resolved per-face: textured receivers get the
   *  user's `shadow.color`; solid receivers get their own ambient-only
   *  shadePolygon for byte-exact Three.js parity. */
  fill: string;
  /** Per-face opacity (already accounts for textured-darken Lambert ratio
   *  if applicable). */
  opacity: number;
  paths: Array<ReceiverShadowPath<T>>;
  /** Full-lit face color C (all lights), for the multi-light merge: callers
   *  multiply C by each pass's `fill/C` factor so overlaps composite to the
   *  both-blocked color. Empty string for textured receivers (per-pixel base,
   *  multiply can't be uniform — those fall back to cumulative-alpha). */
  fullLitFill: string;
  /** Every clipped caster polygon for this pass in absolute face-(u,v) space
   *  (NOT offset by the tight bbox). The multi-light merge re-bases these to a
   *  shared per-face bbox so all lights' shadows live in one SVG. */
  facePolysUv: Array<Array<[number, number]>>;
  /** True when EVERY member polygon of this group paints exactly
   *  `fullLitFill`, AND the pre-blend of `fill` at `opacity` over it is
   *  representable — so a single-pass shadow may be emitted as that
   *  PRE-BLENDED color at alpha 1 instead of the shadowed color at `opacity`
   *  (identical pixel, but idempotent under overlap).
   *
   *  All three conditions are required:
   *  - solid receiver (a textured one has no uniform lit base);
   *  - every member paints `fullLitFill` — a group is formed by plane +
   *    adjacency, not material, and admits member normals up to
   *    `RECEIVER_NORMAL_TOL` apart, so neither one base color nor one Lambert
   *    term can be assumed. Checked per member against its OWN normal and
   *    centroid, i.e. exactly what the renderer bakes into the leaf;
   *  - `blendShadowOverLitBase` can actually represent the result. A
   *    translucent receiver shades to `rgba(...)`, which it cannot — and
   *    emitting the alpha form under expanded clips would double-darken. */
  preblendEligible: boolean;
  /** True when at least one member clip of this face was expanded across a
   *  CREASE edge into a neighbouring face group's SVG. Only these faces need
   *  the opaque pre-blend (that overlap is what alpha paint would
   *  double-darken); every other face keeps the alpha form, whose off-surface
   *  `shadow.lift` parallax at grazing angles is far less visible. */
  creaseBled: boolean;
}

/**
 * Build silhouette `edgeOwners` for a caster mesh in world-CSS frame.
 * Used by the silhouette path inside `computeReceiverShadowFaces` (H9).
 * Polygons are transformed through the same world-CSS pipeline as
 * `prepareCasterPolyItems` (worldCssForMesh + optional rotation around
 * the CSS-pivot) so the silhouette loop vertices land in the same world
 * frame as the receiver face plane and the light direction.
 *
 * Caller caches by (mesh, polygon-list-identity + position + scale +
 * rotation) — invalidates only when the caster's geometry or transform
 * actually changes. Light direction is NOT a bust key (silhouette
 * adjacency is per-mesh, facing is per-frame).
 */
export function prepareCasterEdgeOwners(
  polygons: readonly Polygon[],
  position: Vec3,
  scale: number | Vec3 | undefined | null,
  rotation?: Vec3 | null,
): ReadonlyMap<string, EdgeOwners> {
  const worldCss = worldCssForMesh(scale);
  const hasRotation = !!rotation && (rotation[0] !== 0 || rotation[1] !== 0 || rotation[2] !== 0);
  const cssPivot = hasRotation ? worldPositionToCss(position) : null;
  // Lightweight stub list — buildEdgeOwners only reads `.vertices`.
  const worldPolys: Polygon[] = polygons.map((p) => {
    if (!p) return { vertices: [], color: "" };
    let wv = p.vertices.map((vert) => worldCss(vert, position));
    if (hasRotation && cssPivot && rotation) {
      wv = wv.map((w) => {
        const local: Vec3 = [w[0] - cssPivot[0], w[1] - cssPivot[1], w[2] - cssPivot[2]];
        const r = rotateVec3InWrapperCssFrame(local, rotation);
        return [r[0] + cssPivot[0], r[1] + cssPivot[1], r[2] + cssPivot[2]];
      });
    }
    return { vertices: wv, color: "" };
  });
  return buildEdgeOwnersHelper(worldPolys);
}

/**
 * Build CasterPolyItem[] for a caster mesh. Pure: same inputs → same output.
 * The caller memoizes by mesh ref + bust key. `includePolygonIndex(idx)`
 * decides which polygons participate (e.g. dedup drop + atlas-plan filter
 * in vanilla; just dedup drop in React/Vue without an atlas-plan concept).
 */
export function prepareCasterPolyItems(
  polygons: readonly Polygon[],
  position: Vec3,
  scale: number | Vec3 | undefined | null,
  includePolygonIndex: (polygonIndex: number) => boolean,
  rotation?: Vec3 | null,
): CasterPolyItem[] {
  const out: CasterPolyItem[] = [];
  const worldCss = worldCssForMesh(scale);
  // Mesh rotation lives on the wrapper as a CSS rotate around the wrapper
  // local origin. To put caster vertices into the SAME world-space the
  // wrapper composites into, we apply the wrapper's CSS rotation matrix
  // around the wrapper's CSS-space origin (which is `cssPos`). Without
  // this, shadows stay attached to the un-rotated mesh while the visible
  // mesh tips/swings.
  const hasRotation = !!rotation && (rotation[0] !== 0 || rotation[1] !== 0 || rotation[2] !== 0);
  const cssPivot = hasRotation ? worldPositionToCss(position) : null;
  for (let i = 0; i < polygons.length; i++) {
    if (!includePolygonIndex(i)) continue;
    const polygon = polygons[i];
    if (!polygon) continue;
    let wv = polygon.vertices.map((vert) => worldCss(vert, position));
    if (hasRotation && cssPivot && rotation) {
      wv = wv.map((w) => {
        const local: Vec3 = [w[0] - cssPivot[0], w[1] - cssPivot[1], w[2] - cssPivot[2]];
        const r = rotateVec3InWrapperCssFrame(local, rotation);
        return [r[0] + cssPivot[0], r[1] + cssPivot[1], r[2] + cssPivot[2]];
      });
    }
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (const w of wv) {
      if (w[0] < minX) minX = w[0]; if (w[0] > maxX) maxX = w[0];
      if (w[1] < minY) minY = w[1]; if (w[1] > maxY) maxY = w[1];
      if (w[2] < minZ) minZ = w[2]; if (w[2] > maxZ) maxZ = w[2];
    }
    const bboxCorners: Vec3[] = [
      [minX, minY, minZ], [maxX, minY, minZ],
      [minX, maxY, minZ], [maxX, maxY, minZ],
      [minX, minY, maxZ], [maxX, minY, maxZ],
      [minX, maxY, maxZ], [maxX, maxY, maxZ],
    ];
    let planeN: Vec3 | null = null;
    let planeOffset = 0;
    if (wv.length >= 3) {
      const O = wv[0]!, w1 = wv[1]!, w2 = wv[2]!;
      const e1: Vec3 = [w1[0] - O[0], w1[1] - O[1], w1[2] - O[2]];
      const e2: Vec3 = [w2[0] - O[0], w2[1] - O[1], w2[2] - O[2]];
      const nx = e2[1] * e1[2] - e2[2] * e1[1];
      const ny = e2[2] * e1[0] - e2[0] * e1[2];
      const nz = e2[0] * e1[1] - e2[1] * e1[0];
      const nLen = Math.hypot(nx, ny, nz);
      if (nLen > 1e-9) {
        planeN = [nx / nLen, ny / nLen, nz / nLen];
        planeOffset = planeN[0] * O[0] + planeN[1] * O[1] + planeN[2] * O[2];
      }
    }
    out.push({ wv, bboxCorners, planeN, planeOffset, polygonIndex: i });
  }
  return out;
}

/**
 * Default clearance between a receiver face and the shadow painted on it, in
 * world units.
 *
 * Single source of truth on purpose: this default was previously written out at
 * seven call sites across the three renderers, and two of them drifted to
 * `0.001` — small enough that the receiver painted over its own shadow, so
 * `castShadow` + `receiveShadow` emitted paths that darkened nothing.
 *
 * Note this is a WORLD-unit value while the depth conflict it must win is
 * resolved in device pixels, so it still fails below roughly `zoom: 1`. That
 * limitation is documented for callers; fixing it needs projection-aware
 * clearance.
 */
export const POLY_DEFAULT_SHADOW_LIFT = 0.05;

/**
 * Build ReceiverFacePlane[] for a receiver mesh. Pure: groups coplanar
 * polygons, computes (u,v) basis + outline, applies interior occlusion cull
 * (drops face planes hidden behind a parallel face plane within wall-
 * thickness range).
 *
 * `shadowLift` is the world-unit lift applied along each face normal so the
 * shadow SVG composites above the surface without z-fighting (matches the
 * ground-shadow `shadow.lift` option).
 */
export function prepareReceiverFacePlanes(
  polygons: readonly Polygon[],
  position: Vec3,
  scale: number | Vec3 | undefined | null,
  dedupDrop: ReadonlySet<number>,
  shadowLift: number,
  rotation?: Vec3 | null,
): ReceiverFacePlane[] {
  const baseWorldCss = worldCssForMesh(scale);
  // Same as the caster path: rotation lives on the wrapper as a CSS
  // rotate around its local origin (CSS-pivot = `worldPositionToCss(pos)`).
  // Wrap the per-vertex worldCss so the receiver face planes match where
  // the rotated mesh actually composites — otherwise the shadow projects
  // onto the un-rotated face plane and detaches from the visible surface.
  const hasRotation = !!rotation && (rotation[0] !== 0 || rotation[1] !== 0 || rotation[2] !== 0);
  const cssPivot = hasRotation ? worldPositionToCss(position) : null;
  const worldCss: (vert: Vec3, pos: Vec3) => Vec3 = (hasRotation && cssPivot && rotation)
    ? (vert, pos) => {
        const w = baseWorldCss(vert, pos);
        const local: Vec3 = [w[0] - cssPivot[0], w[1] - cssPivot[1], w[2] - cssPivot[2]];
        const r = rotateVec3InWrapperCssFrame(local, rotation);
        return [r[0] + cssPivot[0], r[1] + cssPivot[1], r[2] + cssPivot[2]];
      }
    : baseWorldCss;
  const surfaces = groupReceiverFaceGroups(polygons, position, worldCss, dedupDrop);
  let planes: ReceiverFacePlane[] = surfaces.map((group, faceIndex): ReceiverFacePlane => {
    const {
      O, n, u, v, outlineUv,
      memberPolysUv, memberPolysWorld, memberPolyIndices, memberSharedEdges,
    } = group;
    let minU = Infinity, minV = Infinity, maxU = -Infinity, maxV = -Infinity;
    for (const pt of outlineUv) {
      if (pt[0] < minU) minU = pt[0];
      if (pt[1] < minV) minV = pt[1];
      if (pt[0] > maxU) maxU = pt[0];
      if (pt[1] > maxV) maxV = pt[1];
    }
    const width = maxU - minU;
    const height = maxV - minV;
    const lift = shadowLift * BASE_TILE;
    const Ox = O[0] + minU * u[0] + minV * v[0] + lift * n[0];
    const Oy = O[1] + minU * u[1] + minV * v[1] + lift * n[1];
    const Oz = O[2] + minU * u[2] + minV * v[2] + lift * n[2];
    const m = [
      u[0], u[1], u[2], 0,
      v[0], v[1], v[2], 0,
      n[0], n[1], n[2], 0,
      Ox,   Oy,   Oz,   1,
    ];
    const matrixCss = `matrix3d(${m.map((x) => x.toFixed(4)).join(",")})`;
    return {
      O, n, u, v, outlineUv,
      memberPolysUv, memberPolysWorld, memberPolyIndices, memberSharedEdges,
      memberCreaseEdges: memberPolysUv.map(() => undefined),
      minU, minV, width, height, matrixCss, faceIndex, lift,
    };
  });

  // Interior occlusion cull. Drop face planes hidden behind a parallel
  // plane along the outward normal (interior wall layers inside imported
  // building meshes). Without z-buffer occlusion the interior wall's shadow
  // would paint where the user can't see it.
  const OCCL_NORMAL_TOL = 0.015;
  const OCCL_OFFSET_TOL = 0.5;
  // Wall thickness is typically 1-10 CSS px; beyond that the planes are
  // separated by air, not nested geometry.
  const OCCL_MAX_GAP = 20;
  const occluded = new Set<number>();
  for (let i = 0; i < planes.length; i++) {
    if (occluded.has(i)) continue;
    const pi = planes[i]!;
    const offsetI = pi.n[0] * pi.O[0] + pi.n[1] * pi.O[1] + pi.n[2] * pi.O[2];
    const iMinU = pi.minU, iMinV = pi.minV;
    const iMaxU = pi.minU + pi.width, iMaxV = pi.minV + pi.height;
    for (let j = 0; j < planes.length; j++) {
      if (j === i || occluded.has(j)) continue;
      const pj = planes[j]!;
      const dotN = pi.n[0] * pj.n[0] + pi.n[1] * pj.n[1] + pi.n[2] * pj.n[2];
      if (dotN < 1 - OCCL_NORMAL_TOL) continue;
      const offsetJ = pi.n[0] * pj.O[0] + pi.n[1] * pj.O[1] + pi.n[2] * pj.O[2];
      if (offsetJ <= offsetI + OCCL_OFFSET_TOL) continue;
      if (offsetJ - offsetI > OCCL_MAX_GAP) continue;
      let jMinU = Infinity, jMinV = Infinity, jMaxU = -Infinity, jMaxV = -Infinity;
      for (const pt of pj.outlineUv) {
        const wx = pj.O[0] + pt[0] * pj.u[0] + pt[1] * pj.v[0];
        const wy = pj.O[1] + pt[0] * pj.u[1] + pt[1] * pj.v[1];
        const wz = pj.O[2] + pt[0] * pj.u[2] + pt[1] * pj.v[2];
        const dx = wx - pi.O[0], dy = wy - pi.O[1], dz = wz - pi.O[2];
        const iu = dx * pi.u[0] + dy * pi.u[1] + dz * pi.u[2];
        const iv = dx * pi.v[0] + dy * pi.v[1] + dz * pi.v[2];
        if (iu < jMinU) jMinU = iu;
        if (iu > jMaxU) jMaxU = iu;
        if (iv < jMinV) jMinV = iv;
        if (iv > jMaxV) jMaxV = iv;
      }
      if (jMinU <= iMinU && jMaxU >= iMaxU && jMinV <= iMinV && jMaxV >= iMaxV) {
        // Don't cull when j is much LARGER than i — small surface feature
        // (door frame, recess) sitting inside a broader wall.
        const iArea = Math.max(0, iMaxU - iMinU) * Math.max(0, iMaxV - iMinV);
        const jArea = Math.max(0, jMaxU - jMinU) * Math.max(0, jMaxV - jMinV);
        const OCCL_AREA_RATIO = 2.0;
        if (jArea > iArea * OCCL_AREA_RATIO) continue;
        occluded.add(i);
        break;
      }
    }
  }
  planes = planes.filter((_, i) => !occluded.has(i));
  fillCrossGroupCreaseEdges(planes);
  return planes;
}

/**
 * Fill each plane's `memberCreaseEdges`: member edges whose neighbouring
 * surface belongs to a DIFFERENT face plane. On imported architecture (the
 * castle) this is the dominant receiver-edge class — merlon face vs merlon top
 * vs wall — and each group's shadow SVG stops exactly at the crease with an
 * antialiased edge, so two abutting layers leave a pale hairline.
 *
 * Matching runs on `memberPolysWorld` — the members' TRUE world vertices — not
 * on the (u, v) outlines lifted back to 3D. That lift is exact only for members
 * that are perfectly coplanar with their group plane, and imported architecture
 * is routinely not: the castle has quads with vertices ~0.3 CSS px off their
 * own plane. Projecting drops that offset, so each of two groups snaps the SAME
 * shared vertex to a different point, moving an exactly-shared crease edge
 * further apart than `RECEIVER_EDGE_PERP_EPS` (0.25) allows — and the crease
 * silently vanished, leaving the pale hairline it exists to close.
 *
 * Two passes mirroring `detectMemberSharedEdges`: an exact quantized
 * endpoint-pair hash, then a collinear-overlap pass over a uniform spatial
 * hash for T-junctions where a crease neighbour covers only part of the edge.
 * Edges already in `memberSharedEdges` stay in the candidate pool but are
 * pre-marked: marking them again could not change their own clip expansion
 * (both sets union into one), yet they are still the only neighbour some
 * crease edge on another plane has, so dropping them outright hid those
 * creases. The 2D `planarEdgesShareLine` predicate cannot be reused here
 * because crease neighbours are by definition not coplanar —
 * `spatialEdgesShareLine` is its world-space sibling with the same tolerances.
 *
 * Runs AFTER the occlusion cull so hidden interior planes cannot mark a
 * visible plane's edge as a crease.
 */
function fillCrossGroupCreaseEdges(planes: ReceiverFacePlane[]): void {
  if (planes.length < 2) return;
  type Ref = SpatialEdge & { plane: number; member: number; edge: number; pre: boolean };
  const refs: Ref[] = [];
  for (let pi = 0; pi < planes.length; pi++) {
    const plane = planes[pi]!;
    const memberWorld = plane.memberPolysWorld;
    if (!memberWorld) continue;
    for (let mi = 0; mi < memberWorld.length; mi++) {
      const world = memberWorld[mi]!;
      if (world.length < 3) continue;
      const shared = plane.memberSharedEdges?.[mi];
      for (let e = 0; e < world.length; e++) {
        const built = spatialEdge(world[e]!, world[(e + 1) % world.length]!);
        // `pre` = already bled as a within-group seam. Such an edge needs no
        // crease mark of its own, but must stay a candidate so it can supply
        // the neighbour that marks a crease edge on another plane.
        if (built) refs.push({ ...built, plane: pi, member: mi, edge: e, pre: !!shared?.has(e) });
      }
    }
  }
  if (refs.length < 2) return;

  const marked: Array<Map<number, Vec3[]> | undefined>[] = planes.map((p) =>
    p.memberPolysUv.map(() => undefined),
  );
  const mark = (r: Ref, neighbourPlane: number): void => {
    if (r.pre) return;
    const perPlane = marked[r.plane]!;
    let map = perPlane[r.member];
    if (!map) { map = new Map(); perPlane[r.member] = map; }
    const n = planes[neighbourPlane]!.n;
    const existing = map.get(r.edge);
    if (!existing) { map.set(r.edge, [n]); return; }
    if (!existing.includes(n)) existing.push(n);
  };
  const isMarked = (r: Ref): boolean =>
    r.pre || !!marked[r.plane]![r.member]?.has(r.edge);

  const QUANT = 1000;
  const ptKey = (x: number, y: number, z: number): string =>
    `${Math.round(x * QUANT)},${Math.round(y * QUANT)},${Math.round(z * QUANT)}`;
  const owners = new Map<string, Ref[]>();
  for (const r of refs) {
    const ka = ptKey(r.ax, r.ay, r.az);
    const kb = ptKey(r.bx, r.by, r.bz);
    const key = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
    let list = owners.get(key);
    if (!list) { list = []; owners.set(key, list); }
    list.push(r);
  }
  for (const list of owners.values()) {
    if (list.length < 2) continue;
    let crossPlane = false;
    for (let i = 1; i < list.length; i++) {
      if (list[i]!.plane !== list[0]!.plane) { crossPlane = true; break; }
    }
    if (!crossPlane) continue;
    for (const r of list) {
      for (const other of list) {
        if (other.plane !== r.plane) mark(r, other.plane);
      }
    }
  }

  // Collinear-overlap pass for crease T-JUNCTIONS: a member edge lying along
  // part of a neighbouring surface's longer edge, which the exact endpoint-pair
  // hash above cannot see. Creases are LOCAL in world space, so candidates come
  // from a uniform spatial hash rather than a linear sweep — on the coliseum a
  // minX sweep still visited 2.1M pairs (94% of edges are already matched by
  // the exact pass, so almost every visit was wasted), which dominated the
  // whole preparation.
  //
  // Cell hash collisions merely widen a bucket; the geometric predicate still
  // decides, so they cost time and never correctness. Edges whose padded AABB
  // spans more cells than CELL_CAP go in `oversized` and are tested against
  // everything, which keeps a few long edges from exploding the grid.
  const EPS = RECEIVER_EDGE_PERP_EPS;
  let lenSum = 0;
  for (const r of refs) lenSum += r.len;
  const cell = Math.max(2 * EPS, lenSum / refs.length);
  const CELL_CAP = 32;
  const cellKey = (ix: number, iy: number, iz: number): number =>
    (Math.imul(ix, 73856093) ^ Math.imul(iy, 19349663) ^ Math.imul(iz, 83492791)) | 0;
  const grid = new Map<number, number[]>();
  const oversized: number[] = [];
  const cellRange = (r: Ref) => ({
    x0: Math.floor((r.minX - EPS) / cell), x1: Math.floor((r.maxX + EPS) / cell),
    y0: Math.floor((r.minY - EPS) / cell), y1: Math.floor((r.maxY + EPS) / cell),
    z0: Math.floor((r.minZ - EPS) / cell), z1: Math.floor((r.maxZ + EPS) / cell),
  });
  for (let i = 0; i < refs.length; i++) {
    const c = cellRange(refs[i]!);
    const span = (c.x1 - c.x0 + 1) * (c.y1 - c.y0 + 1) * (c.z1 - c.z0 + 1);
    if (span > CELL_CAP) { oversized.push(i); continue; }
    for (let ix = c.x0; ix <= c.x1; ix++) {
      for (let iy = c.y0; iy <= c.y1; iy++) {
        for (let iz = c.z0; iz <= c.z1; iz++) {
          const k = cellKey(ix, iy, iz);
          let bucket = grid.get(k);
          if (!bucket) { bucket = []; grid.set(k, bucket); }
          bucket.push(i);
        }
      }
    }
  }
  // Stamp so a pair sharing several cells is only evaluated once.
  const stamp = new Int32Array(refs.length).fill(-1);
  const test = (i: number, j: number): void => {
    const A = refs[i]!, B = refs[j]!;
    if (A.plane === B.plane) return;
    if (isMarked(A) && isMarked(B)) return;
    if (!spatialEdgeBoundsOverlap(A, B)) return;
    if (!spatialEdgesShareLine(A, B)) return;
    mark(A, B.plane);
    mark(B, A.plane);
  };
  // Only edges the exact pass left UNMATCHED need querying: a pair whose two
  // edges are both already marked is skipped by `test`, and every pair with an
  // unmatched member is reached from that member's own query. On the coliseum
  // that is ~600 queries instead of ~10600.
  for (let i = 0; i < refs.length; i++) {
    if (isMarked(refs[i]!)) continue;
    const c = cellRange(refs[i]!);
    const span = (c.x1 - c.x0 + 1) * (c.y1 - c.y0 + 1) * (c.z1 - c.z0 + 1);
    if (span > CELL_CAP) continue;
    for (let ix = c.x0; ix <= c.x1; ix++) {
      for (let iy = c.y0; iy <= c.y1; iy++) {
        for (let iz = c.z0; iz <= c.z1; iz++) {
          const bucket = grid.get(cellKey(ix, iy, iz));
          if (!bucket) continue;
          for (const j of bucket) {
            if (j === i || stamp[j] === i) continue;
            stamp[j] = i;
            test(i, j);
          }
        }
      }
    }
  }
  for (const i of oversized) {
    for (let j = 0; j < refs.length; j++) {
      if (j === i) continue;
      test(i, j);
    }
  }

  for (let pi = 0; pi < planes.length; pi++) {
    planes[pi]!.memberCreaseEdges = marked[pi]!;
  }
}

/** Input for `computeReceiverShadowFaces`. */
export interface ComputeReceiverShadowFacesInput<T = unknown> {
  /** Precomputed face planes from `prepareReceiverFacePlanes`. */
  receiverPlanes: ReceiverFacePlane[];
  /** Receiver's polygon list, used to look up per-face fill color. */
  receiverPolygons: readonly Polygon[];
  /** Whether the receiver mesh has any textured polygons. Drives the
   *  textured-darken opacity calc vs solid-replace fill color. */
  receiverHasTexture: boolean;
  /** Per-caster items + caller id, in caller-defined order. */
  casters: ReceiverCasterInput<T>[];
  /** Light direction in CSS frame, pointing TOWARD the light (to-source).
   *  For a point light this is a representative direction (used only for the
   *  textured-receiver opacity ratio); per-vertex directions come from
   *  `lightPos`. */
  lightDir: Vec3;
  /** When set, the light is a point light at this CSS-frame position. The
   *  shadow projection becomes radial (per-vertex direction from the light)
   *  and the silhouette fast path is disabled (facing is per-polygon). */
  lightPos?: Vec3;
  /** Every point light in the scene (CSS-frame absolute positions), used to
   *  compute the SHADED shadow color — a shadow shows the receiver lit by all
   *  lights EXCEPT the blocked one, so a spot shadowed from one colored light
   *  still shows the others' color (Three.js parity). Includes non-shadow-
   *  casting lights, since they still illuminate the shadowed region. */
  allPointLights?: ReadonlyArray<{ position: Vec3; color?: string; intensity?: number }>;
  /** For a point-light pass, the index into `allPointLights` of the light
   *  being shadowed (excluded from the remaining-light fill). Undefined for
   *  the directional pass (which instead excludes the directional light). */
  thisPointIndex?: number;
  /** Camera cull rotation (rotX/rotY + receiver mesh rotation) so back-
   *  facing receiver faces can be skipped. */
  cameraRot: CameraCullRotation;
  /** Ambient light (used for solid-receiver shadow tint via shadePolygon). */
  ambientLight?: PolyAmbientLight;
  /** Directional light (used for textured-darken opacity calc). */
  directionalLight?: PolyDirectionalLight;
  /** Scene shadow options. */
  shadow?: { color?: string; opacity?: number; maxExtend?: number };
  /** Also bleed member clip outlines along CREASE edges (neighbour in a
   *  different, non-coplanar face group). Cross-group bleed makes shadow
   *  regions OVERLAP between two SVGs, which only composites correctly when
   *  the caller paints the pre-blended color opaque (see
   *  `computeMergedReceiverShadows`) — so it is opt-in and additionally gated
   *  per face on `preblendEligible`. */
  creaseBleed?: boolean;
}

/**
 * The pure per-frame algorithm. Returns one ReceiverShadowFaceSpec for each
 * visible receiver face that catches at least one caster's shadow. Skips
 * back-facing faces. Caller mounts SVGs per spec.
 */
export function computeReceiverShadowFaces<T = unknown>(
  input: ComputeReceiverShadowFacesInput<T>,
): ReceiverShadowFaceSpec<T>[] {
  const {
    receiverPlanes, receiverPolygons, receiverHasTexture, casters,
    lightDir, lightPos, allPointLights, thisPointIndex,
    cameraRot, ambientLight, directionalLight, shadow, creaseBleed,
  } = input;

  const llen = Math.hypot(lightDir[0], lightDir[1], lightDir[2]) || 1;
  const Lx = lightDir[0] / llen;
  const Ly = lightDir[1] / llen;
  const Lz = lightDir[2] / llen;
  // Per-point to-source direction. Directional lights ignore the argument
  // and return the constant `[Lx, Ly, Lz]` so the directional code path is
  // byte-identical; point lights return the normalized vector from the
  // shading point toward the light position.
  const isPoint = !!lightPos;
  const dirAt = isPoint
    ? (p: Vec3): Vec3 => {
        const dx = lightPos![0] - p[0];
        const dy = lightPos![1] - p[1];
        const dz = lightPos![2] - p[2];
        const len = Math.hypot(dx, dy, dz) || 1;
        return [dx / len, dy / len, dz / len];
      }
    : (_p: Vec3): Vec3 => [Lx, Ly, Lz];
  const ambColor = ambientLight?.color ?? "#ffffff";
  const ambIntensity = ambientLight?.intensity ?? 0.4;
  const dirIntensity = directionalLight?.intensity ?? 1;
  const dirColor = directionalLight?.color ?? "#ffffff";
  const userShadowColor = shadow?.color ?? "#000000";
  const opacity = shadow?.opacity ?? 0.25;
  // This pass excludes one light from the receiver's lit color: the directional
  // light when it's the directional pass (no lightPos), else the point light at
  // `thisPointIndex`. The shadow then paints the "remaining light" color so a
  // region blocked from one colored light still shows the others (Three.js
  // colored shadows). A lone directional light → remaining = ambient only,
  // identical to the previous flat fill (no regression).
  const isDirPass = !isPoint;
  // `maxExtend` ("shadow reach") caps how far a shadow can stretch beyond
  // the caster's perpendicular footprint on the receiver plane — matches
  // the semantic already applied in groundShadow.ts to the infinite-ground
  // path. Without it, low-angle lights on a large receiver mesh project
  // shadows across the receiver's full outline (apple-on-floor was ~6k px).
  const maxExtend = shadow?.maxExtend ?? 2000;

  const out: ReceiverShadowFaceSpec<T>[] = [];

  // Per-caster silhouette precompute. For caster meshes that pass the
  // gate (have a cached edgeOwners map, aren't the receiver, have enough
  // polygons, have plane normals on most items), extract the closed
  // silhouette loops in world frame ONCE per frame. The per-receiver-face
  // loop below projects these loops onto each face's (u,v) basis instead
  // of fan-triangulating every front-facing caster polygon. See H9 in
  // `bench/notes/SHADOW_PERF_LOG.md`.
  //
  // `silhouetteByCaster[i]` is `null` when the caster doesn't qualify
  // (fall through to per-poly path) or `Vec3[][]` when it does (use
  // silhouette path; may be `[]` meaning "light fully behind mesh →
  // emit no shadow at all").
  // Per-caster flag: cast DOUBLE-SIDED (skip the light-back-face cull in the
  // per-poly path). Set only for cross-mesh casters that QUALIFIED for the
  // silhouette fast path but were rejected as unreliable — i.e. messy /
  // imported geometry (inconsistent winding, single-sided interior walls).
  // There, single-sided casting drops light-back-facing occluder faces and
  // leaves holes in the receiver's shadow (matches three.js DoubleSide).
  // Clean closed meshes keep single-sided casting (correct + cheaper).
  const doubleSidedByCaster: boolean[] = new Array(casters.length).fill(false);
  const silhouetteByCaster: Array<Vec3[][] | null> = casters.map((casterEntry, casterIdx) => {
    // Parametric-shadow override: low-res silhouette loops the projector casts
    // onto each receiver face. A point pass uses the per-light RADIAL loops
    // (`overridePointSilhouettes[thisPointIndex]`) — the directional loops are
    // the wrong outline for a finite-distance light. An undefined per-point
    // entry means this caster skipped parametric (flat/convex) → fall through
    // to the exact point path.
    if (isPoint) {
      if (casterEntry.overridePointSilhouettes) {
        const o = casterEntry.overridePointSilhouettes[thisPointIndex ?? -1];
        if (o) return o;
      } else if (casterEntry.overrideSilhouette) {
        return casterEntry.overrideSilhouette;
      }
    } else if (casterEntry.overrideSilhouette) {
      return casterEntry.overrideSilhouette;
    }
    // Point lights: project the caster SILHOUETTE (its outline as seen from
    // the light), not individual back-faces. An object resting on the
    // receiver casts a FILLED contact shadow; the per-poly back-face union
    // only produces a thin frame (side faces are edge-on to an overhead
    // light, the contact face is coplanar and culled), leaving the interior
    // unshadowed. Facing is per-polygon here (each face's normal vs the
    // direction to the light position), unlike the directional constant.
    if (isPoint) {
      if (casterEntry.selfShadowEdgeMap) { doubleSidedByCaster[casterIdx] = true; return null; }
      const edgeOwners = casterEntry.edgeOwners;
      if (!edgeOwners) return null;
      const N = casterEntry.casterPolygonCount ?? 0;
      if (N === 0) return null;
      const facing: boolean[] = new Array(N).fill(true);
      for (const item of casterEntry.items) {
        if (item.polygonIndex >= N) continue;
        const nrm = item.planeN;
        if (!nrm) { facing[item.polygonIndex] = true; continue; }
        let cx = 0, cy = 0, cz = 0;
        for (const w of item.wv) { cx += w[0]; cy += w[1]; cz += w[2]; }
        const inv = item.wv.length > 0 ? 1 / item.wv.length : 0;
        const d = dirAt([cx * inv, cy * inv, cz * inv]);
        // Caster (inside silhouette) when the normal points away from the
        // light, matching classifyFacing's directional convention.
        facing[item.polygonIndex] = nrm[0] * d[0] + nrm[1] * d[1] + nrm[2] * d[2] < -1e-6;
      }
      if (!silhouetteReliable(edgeOwners, facing)) { doubleSidedByCaster[casterIdx] = true; return null; }
      return extractSilhouetteLoops(edgeOwners, facing);
    }
    const edgeOwners = casterEntry.edgeOwners;
    // Self-shadow (caster IS the receiver mesh): use the per-poly path AND
    // cast double-sided. Imported meshes have occluder faces that point away
    // from the light yet sit between the light and a LIT receiver face;
    // single-sided casting drops them and leaves holes (e.g. flight poly 46
    // lost 353 occluders). Closed meshes are unaffected — their far back-faces
    // sit below each lit receiver's plane and get above-plane-culled, so this
    // adds no spurious self-shadow (verified: apple unchanged).
    if (casterEntry.selfShadowEdgeMap) { doubleSidedByCaster[casterIdx] = true; return null; }
    if (!edgeOwners) return null;
    const N = casterEntry.casterPolygonCount ?? 0;
    if (N < SILHOUETTE_MIN_POLYS) return null;
    if (casterEntry.items.length < SILHOUETTE_MIN_POLYS) return null;
    // At least 50% of items must have a planeN — otherwise the mesh is
    // degenerate (scribble / zero-area polys) and the silhouette would be
    // unreliable. Fall back to per-poly.
    let withNormals = 0;
    for (const item of casterEntry.items) if (item.planeN) withNormals++;
    if (withNormals * 2 < casterEntry.items.length) return null;

    // Build facing[polygonIndex] from items. Polygons NOT in items (atlas-
    // filtered out) get treated as not-facing — their edges contribute as
    // boundary against included neighbours, which is the conservative
    // choice (slightly larger silhouette but never smaller than real).
    const normals: Array<Vec3 | null> = new Array(N).fill(null);
    for (const item of casterEntry.items) {
      if (item.planeN && item.polygonIndex < N) {
        normals[item.polygonIndex] = item.planeN;
      }
    }
    const facing = classifyFacing(normals, lightDir);
    // Only take the silhouette fast path when the silhouette is a clean
    // union of simple closed loops. For meshes whose silhouette has
    // non-manifold / T-junction / open-boundary vertices (imported
    // architecture like the castle), the loop walk mis-chains and the
    // projection leaves visible gaps in the cast shadow — fall back to the
    // per-poly union (returned null), which is gap-free for any topology.
    // Such meshes also cast double-sided (see doubleSidedByCaster) so the
    // per-poly fallback doesn't drop light-back-facing occluder faces.
    if (!silhouetteReliable(edgeOwners, facing)) {
      doubleSidedByCaster[casterIdx] = true;
      return null;
    }
    return extractSilhouetteLoops(edgeOwners, facing);
  });

  // 3D half-space clip: keep the portion of `loop` where planeDist > eps.
  // Sutherland-Hodgman style — used to clip silhouette loops that dip
  // below the receiver plane before projection. Returns `[]` if the loop
  // ends up fully below.
  const clipLoopAbovePlane = (
    loop: ReadonlyArray<Vec3>,
    O: Vec3, n: Vec3, eps: number,
  ): Vec3[] => {
    if (loop.length < 3) return [];
    const out: Vec3[] = [];
    const dist = (p: Vec3) =>
      (p[0] - O[0]) * n[0] + (p[1] - O[1]) * n[1] + (p[2] - O[2]) * n[2];
    const cross = (a: Vec3, b: Vec3, da: number, db: number): Vec3 => {
      const s = (da - eps) / (da - db);
      return [
        a[0] + s * (b[0] - a[0]),
        a[1] + s * (b[1] - a[1]),
        a[2] + s * (b[2] - a[2]),
      ];
    };
    for (let i = 0; i < loop.length; i++) {
      const curr = loop[i]!;
      const prev = loop[(i + loop.length - 1) % loop.length]!;
      const dCurr = dist(curr);
      const dPrev = dist(prev);
      const inCurr = dCurr > eps;
      const inPrev = dPrev > eps;
      if (inCurr) {
        if (!inPrev) out.push(cross(prev, curr, dPrev, dCurr));
        out.push(curr);
      } else if (inPrev) {
        out.push(cross(prev, curr, dPrev, dCurr));
      }
    }
    return out;
  };

  // The face-plane normals `group.n` are already in world frame (the
  // worldCss wrap in prepareReceiverFacePlanes applies the mesh rotation
  // before the plane is built). Pass a camera-only rotation to
  // normalFacesCamera so it doesn't re-apply mesh rotation a second time
  // — otherwise certain mesh orientations spuriously back-face-cull
  // visible receiver faces (the abrupt cliff at e.g. orz=-61 on the
  // flight model where ~10 face planes vanished together).
  const cameraOnlyRot: CameraCullRotation = { rotX: cameraRot.rotX, rotY: cameraRot.rotY };
  for (const group of receiverPlanes) {
    const { O, n, u, v, outlineUv, minU, minV, width, height } = group;
    // Back-facing receiver face → can't receive light → skip. For point
    // lights the representative direction is the to-source vector at the
    // face origin.
    const faceDir = dirAt(O);
    const Ldotn = faceDir[0] * n[0] + faceDir[1] * n[1] + faceDir[2] * n[2];
    if (Ldotn <= 1e-6) continue;
    // Camera back-face cull. SVGs don't honor CSS backface-visibility
    // reliably, so a back-of-camera receiver-face SVG would still paint.
    if (!normalFacesCamera(n, cameraOnlyRot)) continue;

    // Per-face light scalars for the SHADED shadow color. `dirDot` is the
    // directional Lambert term (always vs the directional vector, not the
    // pass's faceDir). Point dots use the to-source direction from the face
    // CENTROID — matching the baked surface shading (per-polygon centroid), so
    // the shadow's full-lit base color equals the painted receiver and the SVG
    // leaves no visible base-color box. (Projection still uses per-vertex
    // radial directions; only the flat per-face color uses the centroid.)
    const dirDot = Math.max(0, Lx * n[0] + Ly * n[1] + Lz * n[2]);
    let cMeanU = 0, cMeanV = 0;
    for (const pt of outlineUv) { cMeanU += pt[0]; cMeanV += pt[1]; }
    const cInv = outlineUv.length > 0 ? 1 / outlineUv.length : 0;
    cMeanU *= cInv; cMeanV *= cInv;
    const cen: Vec3 = [
      O[0] + cMeanU * u[0] + cMeanV * v[0],
      O[1] + cMeanU * u[1] + cMeanV * v[1],
      O[2] + cMeanU * u[2] + cMeanV * v[2],
    ];
    const pointDots: number[] = [];
    let pointTotalScale = 0;
    if (allPointLights) {
      for (let k = 0; k < allPointLights.length; k++) {
        const pl = allPointLights[k]!;
        const dx = pl.position[0] - cen[0];
        const dy = pl.position[1] - cen[1];
        const dz = pl.position[2] - cen[2];
        const len = Math.hypot(dx, dy, dz) || 1;
        const dot = Math.max(0, (dx / len) * n[0] + (dy / len) * n[1] + (dz / len) * n[2]);
        pointDots[k] = dot;
        pointTotalScale += (pl.intensity ?? 1) * dot;
      }
    }

    const planeDist = (w: Vec3): number =>
      (w[0] - O[0]) * n[0] + (w[1] - O[1]) * n[1] + (w[2] - O[2]) * n[2];
    const planeCross = (a: Vec3, b: Vec3, da: number, db: number): Vec3 => {
      const s = da / (da - db);
      return [a[0] + s * (b[0] - a[0]), a[1] + s * (b[1] - a[1]), a[2] + s * (b[2] - a[2])];
    };
    const projectOntoPlane = (w: Vec3): [number, number] => {
      const VmOx = w[0] - O[0];
      const VmOy = w[1] - O[1];
      const VmOz = w[2] - O[2];
      // Directional: constant to-source L, denom = Ldotn. Point: per-vertex
      // to-source direction, denom = d·n. Clamp denom to a small positive so
      // a grazing point-light vertex projects far (then gets reach/outline
      // clipped) instead of dividing by ~0.
      const d = isPoint ? dirAt(w) : ([Lx, Ly, Lz] as Vec3);
      const denomRaw = isPoint ? d[0] * n[0] + d[1] * n[1] + d[2] * n[2] : Ldotn;
      const denom = denomRaw > 1e-3 ? denomRaw : 1e-3;
      const t = (VmOx * n[0] + VmOy * n[1] + VmOz * n[2]) / denom;
      const Px = w[0] - t * d[0];
      const Py = w[1] - t * d[1];
      const Pz = w[2] - t * d[2];
      const dx = Px - O[0];
      const dy = Py - O[1];
      const dz = Pz - O[2];
      return [dx * u[0] + dy * u[1] + dz * u[2], dx * v[0] + dy * v[1] + dz * v[2]];
    };

    type PerCasterClip = {
      id: T;
      verts: Array<Array<[number, number]>>;
      subPolygonIndices: number[];
    };
    const clippedByCaster = new Map<T, PerCasterClip>();
    let totalClipped = 0;

    // Per-plane shadow-reach rect: union of all casters' perpendicular
    // footprints on this receiver face in (u,v), expanded by maxExtend.
    // Mirrors groundShadow.ts's `clipBounds = fp ± maxExtend` semantic so
    // `shadow.maxExtend` caps shadow reach uniformly across the ground
    // path and the receiver-mesh path.
    let footMinU = Infinity, footMinV = Infinity;
    let footMaxU = -Infinity, footMaxV = -Infinity;
    for (const casterEntry of casters) {
      for (const item of casterEntry.items) {
        for (const w of item.wv) {
          const dx = w[0] - O[0];
          const dy = w[1] - O[1];
          const dz = w[2] - O[2];
          const cu = dx * u[0] + dy * u[1] + dz * u[2];
          const cv = dx * v[0] + dy * v[1] + dz * v[2];
          if (cu < footMinU) footMinU = cu;
          if (cu > footMaxU) footMaxU = cu;
          if (cv < footMinV) footMinV = cv;
          if (cv > footMaxV) footMaxV = cv;
        }
      }
    }
    const reachRect: Array<[number, number]> = Number.isFinite(footMinU) ? [
      [footMinU - maxExtend, footMinV - maxExtend],
      [footMaxU + maxExtend, footMinV - maxExtend],
      [footMaxU + maxExtend, footMaxV + maxExtend],
      [footMinU - maxExtend, footMaxV + maxExtend],
    ] : [];
    const SELF_SHADOW_EPS = 0.05;
    const receiverPlaneOffset = n[0] * O[0] + n[1] * O[1] + n[2] * O[2];
    const COPLANAR_NORMAL_TOL = 0.0025;
    const COPLANAR_OFFSET_TOL = 5.0;
    // Seam cull fires only when the caster face is within ~20° of coplanar
    // with the receiver face (|n·n| > cos 20°). Edge-neighbours on a smooth
    // mesh sit a few degrees apart (culled as sub-pixel slivers); a faceted
    // occluder across a hard edge is far more angled (kept as a real shadow).
    const SEAM_COPLANAR_TOL = 0.94;
    // ── Per-face colors ──────────────────────────────────────────────────
    // Resolved BEFORE the clips are built: the crease bleed expands clip
    // geometry only where the caller will then paint an opaque pre-blend, and
    // that decision needs the final colors. Deciding it afterwards let a
    // silently-failing pre-blend (translucent receiver → `rgba(...)`, which
    // `blendShadowOverLitBase` cannot represent) emit EXPANDED clips at
    // fractional alpha, which double-darkens exactly where the design relies
    // on idempotence.

    // Intensity removed by THIS pass (the blocked light) and the scene total.
    const thisScale = isDirPass
      ? dirIntensity * dirDot
      : (allPointLights?.[thisPointIndex ?? -1]?.intensity ?? 1) * (pointDots[thisPointIndex ?? -1] ?? 0);
    const totalScale = dirIntensity * dirDot + pointTotalScale + Math.max(0, ambIntensity);

    // Per-group opacity for textured receivers. The shadow leaves the receiver
    // lit by everything EXCEPT this pass's light: shadow_linear =
    // lit_linear × remaining/total. A black overlay at sRGB opacity o gives
    // lit_srgb × (1 − o), so o = 1 − (remaining/total)^(1/2.4). For a lone
    // directional light remaining = ambient, matching the previous formula.
    let effOp = opacity;
    if (receiverHasTexture) {
      if (totalScale > 0) {
        const remainingRatio = Math.max(0, (totalScale - thisScale) / totalScale);
        effOp = opacity * (1 - Math.pow(remainingRatio, 1 / 2.4));
      } else {
        effOp = 0;
      }
    }

    // Per-face shadow tint. Each receiver face uses ITS OWN polygon color
    // (one material per coplanar group). The fill is the receiver lit by
    // every light EXCEPT this pass's blocked light — so a region shadowed
    // from one colored light still shows the others' color. A lone
    // directional light → remaining = ambient only (unchanged from before).
    const groupPolyIdx = group.memberPolyIndices[0] ?? 0;
    const groupColor = receiverPolygons[groupPolyIdx]?.color ?? "#cccccc";
    const remDirScale = isDirPass ? 0 : dirIntensity * dirDot;
    const remPointContribs: { color: string; scale: number }[] = [];
    if (allPointLights) {
      for (let k = 0; k < allPointLights.length; k++) {
        if (isPoint && k === thisPointIndex) continue;
        const dot = pointDots[k] ?? 0;
        if (dot <= 0) continue;
        const pl = allPointLights[k]!;
        remPointContribs.push({ color: pl.color ?? "#ffffff", scale: (pl.intensity ?? 1) * dot });
      }
    }
    const fillColor = receiverHasTexture
      ? userShadowColor
      : shadePolygon(groupColor, remDirScale, dirColor, ambColor, ambIntensity, remPointContribs);

    // Full-lit face color C (every light) for the multi-light merge — callers
    // multiply C by each pass's `fill/C` so overlapping shadows composite to
    // the both-blocked color. Empty for textured (per-pixel base).
    const fullPointContribs: { color: string; scale: number }[] = [];
    if (allPointLights) {
      for (let k = 0; k < allPointLights.length; k++) {
        const dot = pointDots[k] ?? 0;
        if (dot <= 0) continue;
        const pl = allPointLights[k]!;
        fullPointContribs.push({ color: pl.color ?? "#ffffff", scale: (pl.intensity ?? 1) * dot });
      }
    }
    const fullLitFill = receiverHasTexture
      ? ""
      : shadePolygon(groupColor, dirIntensity * dirDot, dirColor, ambColor, ambIntensity, fullPointContribs);

    // A face group is formed by plane + adjacency, never by material and never
    // by exact normal: `fullLitFill` uses member[0]'s color and the GROUP
    // plane's Lambert term, while each leaf is baked from its OWN normal (and,
    // under point lights, its own centroid). The opaque pre-blend is a pixel
    // identity only where those agree for every member, so that is checked
    // directly rather than assumed — and the pre-blend must additionally be
    // representable at all (see above).
    const preblendEligible = !receiverHasTexture
      && groupMembersShareLitColor(
        group, receiverPolygons, fullLitFill,
        [Lx, Ly, Lz], dirIntensity, dirColor, ambColor, ambIntensity, allPointLights,
      )
      && blendShadowOverLitBase(fullLitFill, fillColor, effOp) !== null;
    // Member clip polygons with seam bleed: each member's CCW outline is
    // expanded outward by SHADOW_CLIP_SEAM_BLEED along the edges it SHARES
    // with another member of this group (non-shared edges stay put), so the
    // clipped shadow subpaths of abutting members overlap across the seam
    // instead of leaving a hairline light strip under SVG antialiasing.
    // Overlapping pieces land in the same nonzero compound path, so they
    // cannot double-darken. `safePlanSeamBleedAmount` fits each edge's
    // amount to the polygon (tiny/degenerate members fall back to 0), and
    // `offsetConvexPolygonPointsByEdgeAmounts` returns the input unchanged
    // for non-convex/degenerate outlines — the unexpanded member is the
    // fallback in every failure mode.
    //
    // CREASE edges (neighbour in a different, non-coplanar group) are unioned
    // into the same expansion when `applyCreaseBleed` holds. Those two groups
    // are separate SVGs, so their expanded clips OVERLAP rather than landing in
    // one nonzero path — safe only because the caller then paints the
    // pre-blended color opaque (idempotent under overlap).
    //
    // A crease is bled only when the neighbour across it FACES THE CAMERA. The
    // expansion runs outward in the expanding face's OWN plane, so it lands on
    // the neighbour only while the neighbour is drawn on the far side of the
    // crease; at a crease that lies on the camera silhouette (neighbour
    // back-facing) the same expansion hangs in free space past the model's
    // outline. On a closed mesh EVERY edge has a neighbour, so "has a
    // neighbour" alone does not imply "not a silhouette edge" — measured as a
    // 0.5 CSS px dark fringe outside the outline on a cube at every camera
    // angle once the solid leaves' own `seamBleed` overscan was removed. A
    // silhouette crease also has no abutting SVG to seam against, so skipping
    // it costs nothing.
    const applyCreaseBleed = creaseBleed === true && preblendEligible;
    const creaseBleedsIntoNeighbour = (normals: Vec3[] | undefined): boolean => {
      if (!normals) return false;
      for (const nn of normals) if (normalFacesCamera(nn, cameraOnlyRot)) return true;
      return false;
    };
    let anyCreaseBled = false;
    const memberClipsUv: Array<Array<[number, number]>> = group.memberPolysUv.map(
      (memberPoly, mi) => {
        const ccw = ensureCcw2D(memberPoly);
        const shared = group.memberSharedEdges?.[mi];
        const crease = applyCreaseBleed ? group.memberCreaseEdges?.[mi] : undefined;
        const sharedCount = shared?.size ?? 0;
        const creaseCount = crease?.size ?? 0;
        if ((sharedCount === 0 && creaseCount === 0) || ccw.length < 3) return ccw;
        const flat: number[] = [];
        for (const p of ccw) flat.push(p[0], p[1]);
        let bledCrease = false;
        const amounts = ccw.map((_, e) => {
          const isCrease = creaseBleedsIntoNeighbour(crease?.get(e));
          if (!shared?.has(e) && !isCrease) return 0;
          const amount = safePlanSeamBleedAmount(flat, e, SHADOW_CLIP_SEAM_BLEED);
          if (amount > 0 && isCrease) bledCrease = true;
          return amount;
        });
        let any = false;
        for (const a of amounts) if (a > 0) { any = true; break; }
        if (!any) return ccw;
        const expanded = offsetConvexPolygonPointsByEdgeAmounts(flat, amounts);
        if (expanded === flat || expanded.length !== flat.length) return ccw;
        if (bledCrease) anyCreaseBled = true;
        const out2: Array<[number, number]> = [];
        for (let i = 0; i < expanded.length; i += 2) {
          out2.push([expanded[i]!, expanded[i + 1]!]);
        }
        return out2;
      },
    );
    // Widen the PRE-CLIP copy of the group hull so it cannot cap a bled member
    // edge (see CLIP_OUTLINE_EXTRA). Only where a crease edge was actually
    // bled: everywhere else the stored outline must be used verbatim or
    // multi-light and textured receivers would shift. Within-group shared edges
    // are interior to the hull and never need it. The stored `outlineUv` — and
    // therefore the face plane's box and matrix — is never touched either way.
    const clipOutlineUv = anyCreaseBled && CLIP_OUTLINE_EXTRA > 0
      ? expandConvexHullOutward(outlineUv, CLIP_OUTLINE_EXTRA)
      : outlineUv;
    const clipPad = clipOutlineUv === outlineUv ? 0 : CLIP_OUTLINE_EXTRA;
    // Projection prefilter bounds. Padded with the clip widening so a caster
    // whose footprint only reaches into the bled margin is not rejected here.
    const fMinU = minU - clipPad, fMinV = minV - clipPad;
    const fMaxU = group.minU + width + clipPad;
    const fMaxV = group.minV + height + clipPad;
    for (let casterIdx = 0; casterIdx < casters.length; casterIdx++) {
      const casterEntry = casters[casterIdx]!;
      const sharedEdgeMap = casterEntry.selfShadowEdgeMap;

      // Silhouette path: when the caster qualified for silhouette
      // extraction, project each closed loop onto this receiver face
      // instead of fan-triangulating every front-facing polygon. One
      // sub-path per loop replaces O(items) sub-paths.
      const silhouette = silhouetteByCaster[casterIdx];
      if (silhouette !== null) {
        // Empty loop set means "light fully behind mesh" → no shadow on
        // this receiver from this caster.
        if (silhouette.length === 0) continue;
        // Parametric (override) loops carry coverage holes (courtyards, the
        // coliseum arena) as opposite-wound loops. Preserving that relative
        // winding lets them subtract under the path's nonzero fill. The
        // (u,v) basis may flip handedness, so pick one global orientation from
        // the largest loop (→ outer CCW) and apply it uniformly. The exact
        // silhouette path keeps per-loop `ensureCcw2D` (no holes there).
        const isOverride = !!casterEntry.overrideSilhouette;
        let overrideFlip = false;
        if (isOverride) {
          let bestAbs = 0;
          for (const loop of silhouette) {
            if (loop.length < 3) continue;
            const ab = clipLoopAbovePlane(loop, O, n, SELF_SHADOW_EPS);
            if (ab.length < 3) continue;
            const pr = ab.map(projectOntoPlane);
            let area = 0;
            for (let i = 0; i < pr.length; i++) {
              const p = pr[i]!, q = pr[(i + 1) % pr.length]!;
              area += p[0] * q[1] - q[0] * p[1];
            }
            if (Math.abs(area) > bestAbs) { bestAbs = Math.abs(area); overrideFlip = area < 0; }
          }
        }
        for (const loop of silhouette) {
          if (loop.length < 3) continue;
          // 3D clip against the receiver plane half-space first — silhouette
          // vertices that sit BELOW the receiver project to the wrong side
          // of the (u,v) basis and produce inverted shadows.
          const above3D = clipLoopAbovePlane(loop, O, n, SELF_SHADOW_EPS);
          if (above3D.length < 3) continue;
          const projected = above3D.map(projectOntoPlane);
          const subjectCcw = isOverride
            ? (overrideFlip ? [...projected].reverse() : projected)
            : ensureCcw2D(projected);
          const reachClipped = reachRect.length === 4
            ? clipPolygonToConvex2D(subjectCcw, reachRect)
            : subjectCcw;
          if (reachClipped.length < 3) continue;
          const clip = clipPolygonToConvex2D(reachClipped, clipOutlineUv);
          if (clip.length < 3) continue;
          let bucket: { id: T; verts: Vec2[][]; subPolygonIndices: number[] } | undefined;
          for (const memberClipPoly of memberClipsUv) {
            const memberClip = clipPolygonToConvex2D(clip, memberClipPoly);
            if (memberClip.length < 3) continue;
            if (!bucket) {
              bucket = clippedByCaster.get(casterEntry.id);
              if (!bucket) {
                bucket = { id: casterEntry.id, verts: [], subPolygonIndices: [] };
                clippedByCaster.set(casterEntry.id, bucket);
              }
            }
            bucket.verts.push(memberClip);
            // Silhouette path has no source-polygon attribution; use -1
            // so DevTools tooling can tell it apart from per-poly indices.
            bucket.subPolygonIndices.push(-1);
            totalClipped++;
          }
        }
        continue;
      }

      for (const item of casterEntry.items) {
        // Seam-shadow cull: if this caster polygon shares an edge with ANY
        // of the receiver face's member polygons, skip — projecting a
        // shared-edge poly always produces a thin sliver along the seam,
        // independent of plane angle. Without this cull, smooth-shaded
        // GLB meshes (apple, sphere, teapot) get a dark spiderweb of
        // shadow streaks at every vertex.
        if (sharedEdgeMap) {
          const adj = sharedEdgeMap.get(item.polygonIndex);
          if (adj) {
            let sharesEdge = false;
            for (const memberIdx of group.memberPolyIndices) {
              if (adj.has(memberIdx)) { sharesEdge = true; break; }
            }
            // Seam-shadow cull, but ONLY when the caster is near-COPLANAR with
            // the receiver face. That's the smooth-shaded-mesh case the cull is
            // for: edge-neighbour faces a few degrees apart project sub-pixel
            // slivers (the apple/sphere/teapot "spiderweb"). A caster at a real
            // angle to the receiver across a shared edge — a wing over a
            // fuselage, a wall meeting a floor — casts a genuine self-shadow and
            // must be kept (culling it left big holes on faceted meshes).
            if (sharesEdge) {
              const cn = item.planeN;
              const coplanar = !cn ||
                Math.abs(cn[0] * n[0] + cn[1] * n[1] + cn[2] * n[2]) > SEAM_COPLANAR_TOL;
              if (coplanar) continue;
            }
          }
        }
        // Light back-face cull: a caster polygon whose normal points AWAY
        // from the light cannot cast shadow on anything beyond what the
        // matching front-facing polygons (across the same closed mesh
        // silhouette) already cover. For convex closed meshes the projected
        // shadow is unchanged; for concave closed meshes the union under
        // fill-rule=nonzero collapses to the same silhouette. For open
        // one-sided meshes lit from behind the shadow disappears — this
        // is the "single-sided material" semantic that most pipelines
        // default to. Use a small epsilon so polygons exactly edge-on
        // (grazing the light) still cast — they're the silhouette edge
        // of a closed mesh.
        if (item.planeN && !doubleSidedByCaster[casterIdx]) {
          let lx = Lx, ly = Ly, lz = Lz;
          if (isPoint) {
            // To-source direction from the caster polygon's centroid.
            let cx = 0, cy = 0, cz = 0;
            for (const w of item.wv) { cx += w[0]; cy += w[1]; cz += w[2]; }
            const inv = item.wv.length > 0 ? 1 / item.wv.length : 0;
            const d = dirAt([cx * inv, cy * inv, cz * inv]);
            lx = d[0]; ly = d[1]; lz = d[2];
          }
          const cnDotL = item.planeN[0] * lx + item.planeN[1] * ly + item.planeN[2] * lz;
          if (cnDotL > -1e-6) continue;
        }
        // Coplanar caster skip.
        if (item.planeN) {
          const cn = item.planeN;
          const dot = cn[0] * n[0] + cn[1] * n[1] + cn[2] * n[2];
          if (Math.abs(dot) > 1 - COPLANAR_NORMAL_TOL) {
            const sign = dot > 0 ? 1 : -1;
            if (Math.abs(item.planeOffset - sign * receiverPlaneOffset) < COPLANAR_OFFSET_TOL) {
              continue;
            }
          }
        }
        // 8-projection bbox prefilter, also confirms ≥ 1 corner ABOVE plane.
        const corners = item.bboxCorners;
        let anyAbove = false;
        let pMinU = Infinity, pMinV = Infinity, pMaxU = -Infinity, pMaxV = -Infinity;
        for (let ci = 0; ci < 8; ci++) {
          const c = corners[ci]!;
          if (planeDist(c) > SELF_SHADOW_EPS) anyAbove = true;
          const pr = projectOntoPlane(c);
          if (pr[0] < pMinU) pMinU = pr[0];
          if (pr[0] > pMaxU) pMaxU = pr[0];
          if (pr[1] < pMinV) pMinV = pr[1];
          if (pr[1] > pMaxV) pMaxV = pr[1];
        }
        if (!anyAbove) continue;
        if (pMaxU < fMinU || pMinU > fMaxU || pMaxV < fMinV || pMinV > fMaxV) continue;
        const wv = item.wv;
        // Fan-triangulate.
        for (let triIdx = 1; triIdx < wv.length - 1; triIdx++) {
          const tA = wv[0]!, tB = wv[triIdx]!, tC = wv[triIdx + 1]!;
          const dA = planeDist(tA), dB = planeDist(tB), dC = planeDist(tC);
          const above: Vec3[] = [];
          const cycle: Array<[Vec3, number]> = [[tA, dA], [tB, dB], [tC, dC]];
          for (let k = 0; k < 3; k++) {
            const [p, dp] = cycle[k]!;
            const [q, dq] = cycle[(k + 1) % 3]!;
            const pAbove = dp > SELF_SHADOW_EPS;
            const qAbove = dq > SELF_SHADOW_EPS;
            if (pAbove) above.push(p);
            if (pAbove !== qAbove) above.push(planeCross(p, q, dp, dq));
          }
          if (above.length < 3) continue;
          const projected = above.map(projectOntoPlane);
          const subjectCcw = ensureCcw2D(projected);
          // Shadow-reach clip: cap how far the projected shadow can stretch
          // beyond the caster mesh's perpendicular footprint on this face,
          // before the (potentially expensive) outline + member clips.
          const reachClipped = reachRect.length === 4
            ? clipPolygonToConvex2D(subjectCcw, reachRect)
            : subjectCcw;
          if (reachClipped.length < 3) continue;
          const clip = clipPolygonToConvex2D(reachClipped, clipOutlineUv);
          if (clip.length < 3) continue;
          // Clip the projected shadow against each MEMBER polygon of the
          // receiver face group, not just the group's outer outline. The
          // outline can span concave regions / holes / disconnected
          // coplanar islands where the mesh has no actual surface;
          // clipping against the union of members keeps shadow pixels
          // strictly over real mesh polygons.
          //
          // Self-shadow sliver cull is applied PER MEMBER-CLIP (not on the
          // outline-clip): smooth-shaded GLBs produce many near-coplanar
          // adjacent polys whose individual member-clips come out as long
          // thin sub-pixel-adjacent streaks the user reads as visual
          // noise. Earlier the cull ran on the outline-clip and would
          // drop legitimate thin shadows landing on a thin-but-real
          // member polygon (e.g. flight-system poly 38, a long diagonal
          // slab receiving a thin shadow from the outer ring). Moving the
          // cull onto each member-clip lets real thin shadows through
          // while still discarding tiny-area / extreme-aspect noise.
          let bucket: { id: T; verts: Vec2[][]; subPolygonIndices: number[] } | undefined;
          for (const memberClipPoly of memberClipsUv) {
            const memberClip = clipPolygonToConvex2D(clip, memberClipPoly);
            if (memberClip.length < 3) continue;
            if (sharedEdgeMap) {
              let twiceArea = 0;
              let minClipX = Infinity, maxClipX = -Infinity;
              let minClipY = Infinity, maxClipY = -Infinity;
              for (let pi = 0; pi < memberClip.length; pi++) {
                const p1 = memberClip[pi]!;
                const p2 = memberClip[(pi + 1) % memberClip.length]!;
                twiceArea += p1[0] * p2[1] - p2[0] * p1[1];
                if (p1[0] < minClipX) minClipX = p1[0];
                if (p1[0] > maxClipX) maxClipX = p1[0];
                if (p1[1] < minClipY) minClipY = p1[1];
                if (p1[1] > maxClipY) maxClipY = p1[1];
              }
              const clipArea = Math.abs(twiceArea) * 0.5;
              // Pure tiny-area noise → drop. Aspect-only filter is gone:
              // legitimate thin shadows (poly 38) trip it; member-clip is
              // the geometric guard against bridging-region false positives.
              if (clipArea < 5) continue;
            }
            if (!bucket) {
              bucket = clippedByCaster.get(casterEntry.id);
              if (!bucket) {
                bucket = { id: casterEntry.id, verts: [], subPolygonIndices: [] };
                clippedByCaster.set(casterEntry.id, bucket);
              }
            }
            bucket.verts.push(memberClip);
            bucket.subPolygonIndices.push(item.polygonIndex);
            totalClipped++;
          }
        }
      }
    }

    if (totalClipped === 0 || !(width > 0) || !(height > 0)) continue;

    // Tight shadow-content bbox in (u, v). The receiver face outline can be
    // huge (e.g. a 17500×17500 CSS-px floor at world units × BASE_TILE), but
    // the actual shadow content typically covers a fraction of that area.
    // Sizing the SVG to the receiver outline made Chrome's compositor drop
    // the entire layer past certain perspective angles (the projected
    // trapezoid grew unboundedly when one corner approached the horizon).
    // Clipping the SVG to the shadow's tight bbox keeps the layer small
    // enough that compositor heuristics keep painting it at every camera
    // orientation. The on-screen geometry is unchanged: matrix3d is rebased
    // to the tight bbox and path coordinates are emitted relative to it.
    let shMinU = Infinity, shMinV = Infinity, shMaxU = -Infinity, shMaxV = -Infinity;
    for (const entry of clippedByCaster.values()) {
      for (const verts of entry.verts) {
        for (const pt of verts) {
          if (pt[0] < shMinU) shMinU = pt[0];
          if (pt[0] > shMaxU) shMaxU = pt[0];
          if (pt[1] < shMinV) shMinV = pt[1];
          if (pt[1] > shMaxV) shMaxV = pt[1];
        }
      }
    }
    // Round outward to whole pixels so the SVG covers the path with one px
    // of slack on each side (matches the path's `.toFixed(1)` precision).
    shMinU = Math.floor(shMinU - 1);
    shMinV = Math.floor(shMinV - 1);
    shMaxU = Math.ceil(shMaxU + 1);
    shMaxV = Math.ceil(shMaxV + 1);
    // Clamp the tight bbox to the face outline so we never extend the SVG
    // past the receiver surface (would let a stray pixel render off-face).
    if (shMinU < minU - clipPad) shMinU = minU - clipPad;
    if (shMinV < minV - clipPad) shMinV = minV - clipPad;
    if (shMaxU > minU + width + clipPad) shMaxU = minU + width + clipPad;
    if (shMaxV > minV + height + clipPad) shMaxV = minV + height + clipPad;
    const tightW = shMaxU - shMinU;
    const tightH = shMaxV - shMinV;
    if (!(tightW > 0) || !(tightH > 0)) continue;

    // matrix3d for the tight SVG: O + shMinU*u + shMinV*v + lift*n
    const liftN = group.lift;
    const tx = O[0] + shMinU * u[0] + shMinV * v[0] + liftN * n[0];
    const ty = O[1] + shMinU * u[1] + shMinV * v[1] + liftN * n[1];
    const tz = O[2] + shMinU * u[2] + shMinV * v[2] + liftN * n[2];
    const tm = [
      u[0], u[1], u[2], 0,
      v[0], v[1], v[2], 0,
      n[0], n[1], n[2], 0,
      tx,   ty,   tz,   1,
    ];
    const tightMatrixCss = `matrix3d(${tm.map((x) => x.toFixed(4)).join(",")})`;

    const paths: Array<ReceiverShadowPath<T>> = [];
    const facePolysUv: Array<Array<[number, number]>> = [];
    for (const entry of clippedByCaster.values()) {
      let d = "";
      for (const verts of entry.verts) {
        d += `M${(verts[0]![0] - shMinU).toFixed(1)},${(verts[0]![1] - shMinV).toFixed(1)}`;
        for (let j = 1; j < verts.length; j++) {
          d += `L${(verts[j]![0] - shMinU).toFixed(1)},${(verts[j]![1] - shMinV).toFixed(1)}`;
        }
        d += "Z";
        facePolysUv.push(verts.map((p) => [p[0], p[1]] as [number, number]));
      }
      paths.push({ casterId: entry.id, d, casterPolygonIndices: entry.subPolygonIndices });
    }

    out.push({
      faceIndex: group.faceIndex,
      memberPolyIndices: group.memberPolyIndices,
      matrixCss: tightMatrixCss,
      width: tightW,
      height: tightH,
      fill: fillColor,
      opacity: effOp,
      paths,
      fullLitFill,
      facePolysUv,
      preblendEligible,
      creaseBled: anyCreaseBled,
    });
  }

  return out;
}

// ── Multi-light per-face merge ──────────────────────────────────────────────
// All renderers share this so a receiver FACE's lights merge into ONE SVG:
// overlapping shadows then composite correctly (single light → one path with
// the remaining-light color; multi-light solid → a full-lit base + one
// `mix-blend-mode: multiply` layer per light, so the both-blocked overlap
// becomes base·∏factor). Pure data in → DOM-ready descriptors out; each
// renderer only emits the <svg>/<path> nodes.

/** One path inside a merged face SVG. */
export interface MergedShadowLayer {
  /** Path data (`M…L…Z`, already offset to the SVG's tight bbox). */
  d: string;
  /** Fill color (remaining-light color for a single layer, multiply factor for
   *  a merged solid layer, dark shadow color for textured). */
  fill: string;
  /** Apply `mix-blend-mode: multiply` (merged solid layers only). */
  multiply: boolean;
  /** Per-path opacity (1 for merged solid layers, which carry strength on the
   *  SVG; the pass's own opacity otherwise). */
  opacity: number;
}

/** One receiver FACE's merged shadow, ready to mount as a single SVG. */
export interface MergedShadowFace {
  faceIndex: number;
  memberPolyIndices: number[];
  matrixCss: string;
  width: number;
  height: number;
  /** SVG-level opacity (shadow strength for merged solid faces, else 1). */
  svgOpacity: number;
  /** Full-lit base path (merged solid faces only); null otherwise. */
  baseFill: string | null;
  baseD: string | null;
  layers: MergedShadowLayer[];
}

/** Inputs for `computeMergedReceiverShadows` — the full light set for one
 *  receiver, plus its prepared face planes and casters. */
export interface MergedReceiverShadowInput<T = unknown> {
  receiverPlanes: ReceiverFacePlane[];
  receiverPolygons: readonly Polygon[];
  receiverHasTexture: boolean;
  casters: ReceiverCasterInput<T>[];
  /** Directional light vector in CSS frame (to-source). */
  lightDir: Vec3;
  /** Run the directional pass (caller gates on a real, nonzero-intensity
   *  directional light). */
  runDirectional: boolean;
  /** One pass per shadow-casting point light: CSS position + index into
   *  `allPointLights`. Empty in dynamic mode (point lights are baked-only). */
  pointPasses: ReadonlyArray<{ lightPos: Vec3; index: number }>;
  /** All point lights (CSS positions) for the shaded shadow color; empty in
   *  dynamic mode. */
  allPointLights?: ReadonlyArray<{ position: Vec3; color?: string; intensity?: number }>;
  cameraRot: CameraCullRotation;
  ambientLight?: PolyAmbientLight;
  directionalLight?: PolyDirectionalLight;
  shadow?: { color?: string; opacity?: number; maxExtend?: number };
}

/** Per-channel multiply factor `remaining / full` (both sRGB hex) as `rgb(...)`.
 *  Painting the base = `full` then this with `mix-blend-mode: multiply`
 *  reproduces `remaining`; overlapping factors multiply to the both-removed
 *  color. */
function shadowMultiplyFactor(remaining: string, full: string): string {
  const a = parseHexColor(remaining)?.rgb ?? [0, 0, 0];
  const b = parseHexColor(full)?.rgb ?? [255, 255, 255];
  const f = (i: number): number => {
    const c = b[i] ?? 0;
    if (c <= 0) return 255;
    return Math.max(0, Math.min(255, Math.round((a[i]! / c) * 255)));
  };
  return `rgb(${f(0)},${f(1)},${f(2)})`;
}

/**
 * `blend(litFaceColor, shadowedColor, opacity)` in sRGB — the exact pixel an
 * SVG path of `fill` at `opacity` produces over a receiver painted `base`.
 *
 * Emitting THIS opaque is pixel-identical to the alpha version, edges
 * included: at antialiased coverage `c` the alpha version gives
 * `base·(1 − o·c) + fill·o·c`, and painting the pre-blend at coverage `c`
 * gives `base·(1 − c) + (base·(1 − o) + fill·o)·c` — the same expression.
 * What changes is OVERLAP: two overlapping opaque paints of one color are that
 * color, where two overlapping alpha paints darken twice. That idempotence is
 * what lets a face's clip bleed across a crease into its neighbour's SVG.
 *
 * Returns `null` when either color is not a plain hex (a translucent receiver
 * makes `shadePolygon` return `rgba(...)`, whose alpha the blend cannot
 * represent) — the caller then keeps the alpha form.
 */
function blendShadowOverLitBase(base: string, fill: string, opacity: number): string | null {
  const b = parseHexColor(base);
  const f = parseHexColor(fill);
  if (!b || !f || b.alpha !== 1 || f.alpha !== 1) return null;
  const o = Math.max(0, Math.min(1, opacity));
  const mix = (i: number): number => {
    const bc = b.rgb[i] ?? 0;
    const fc = f.rgb[i] ?? 0;
    return Math.max(0, Math.min(255, Math.round(bc + (fc - bc) * o)));
  };
  return `rgb(${mix(0)},${mix(1)},${mix(2)})`;
}

/** A stored member polygon's own surface normal, in the same world-CSS frame
 *  and with the same fan accumulation the face plane was built with. The
 *  stored world list may have been reversed to make the (u, v) copy CCW, so
 *  the result is oriented onto the group normal's hemisphere — grouping
 *  already guarantees every member sits within `RECEIVER_NORMAL_TOL` of it,
 *  which makes that orientation unambiguous. Null for a degenerate member. */
function memberWorldNormal(ws: readonly Vec3[], groupN: Vec3): Vec3 | null {
  if (ws.length < 3) return null;
  const O = ws[0]!;
  let nx = 0, ny = 0, nz = 0;
  for (let k = 1; k + 1 < ws.length; k++) {
    const a = ws[k]!, b = ws[k + 1]!;
    const e1x = a[0] - O[0], e1y = a[1] - O[1], e1z = a[2] - O[2];
    const e2x = b[0] - O[0], e2y = b[1] - O[1], e2z = b[2] - O[2];
    nx += e2y * e1z - e2z * e1y;
    ny += e2z * e1x - e2x * e1z;
    nz += e2x * e1y - e2y * e1x;
  }
  const len = Math.hypot(nx, ny, nz);
  if (len < 1e-9) return null;
  const s = (nx * groupN[0] + ny * groupN[1] + nz * groupN[2]) >= 0 ? 1 / len : -1 / len;
  return [nx * s, ny * s, nz * s];
}

/**
 * True when EVERY member of a face group paints exactly `fullLitFill`.
 *
 * `fullLitFill` is one color per GROUP: member[0]'s base color shaded with the
 * group plane's normal (and, for point lights, the group hull centroid). The
 * renderer bakes each leaf from its OWN normal and centroid, and a group is
 * formed by plane + adjacency — not by material, and not by exact normal
 * (`RECEIVER_NORMAL_TOL` admits ~2.5°). So this reproduces the renderer's
 * per-leaf shading and compares, instead of assuming.
 *
 * The pre-blend replaces `leaf·(1−o) + fill·o` with `fullLit·(1−o) + fill·o`
 * painted opaque; the residual is `(leaf − fullLit)·(1−o)`. Requiring exact
 * equality makes it zero for every member, at every opacity — which is what
 * "pixel-identical" has to mean before a face's clip may bleed into a
 * neighbouring SVG.
 */
function groupMembersShareLitColor(
  group: ReceiverFacePlane,
  receiverPolygons: readonly Polygon[],
  fullLitFill: string,
  L: Vec3,
  dirIntensity: number,
  dirColor: string,
  ambColor: string,
  ambIntensity: number,
  allPointLights: ReadonlyArray<{ position: Vec3; color?: string; intensity?: number }> | undefined,
): boolean {
  if (fullLitFill === "") return false;
  const members = group.memberPolysWorld;
  if (!members || members.length === 0) return false;
  const hasPoints = !!allPointLights && allPointLights.length > 0;
  const litCache = new Map<string, string>();
  for (let mi = 0; mi < members.length; mi++) {
    const ws = members[mi]!;
    const color = receiverPolygons[group.memberPolyIndices[mi] ?? -1]?.color ?? "#cccccc";
    const nm = memberWorldNormal(ws, group.n);
    if (!nm) return false;
    const dot = Math.max(0, L[0] * nm[0] + L[1] * nm[1] + L[2] * nm[2]);
    const contribs: { color: string; scale: number }[] = [];
    if (hasPoints) {
      let cx = 0, cy = 0, cz = 0;
      for (const w of ws) { cx += w[0]; cy += w[1]; cz += w[2]; }
      const inv = 1 / ws.length;
      cx *= inv; cy *= inv; cz *= inv;
      for (const pl of allPointLights!) {
        const dx = pl.position[0] - cx, dy = pl.position[1] - cy, dz = pl.position[2] - cz;
        const len = Math.hypot(dx, dy, dz) || 1;
        const d = Math.max(0, (dx / len) * nm[0] + (dy / len) * nm[1] + (dz / len) * nm[2]);
        if (d <= 0) continue;
        contribs.push({ color: pl.color ?? "#ffffff", scale: (pl.intensity ?? 1) * d });
      }
    }
    const key = `${color}|${dot.toFixed(6)}|${contribs.map((c) => `${c.color}:${c.scale.toFixed(6)}`).join(",")}`;
    let lit = litCache.get(key);
    if (lit === undefined) {
      lit = shadePolygon(color, dirIntensity * dot, dirColor, ambColor, ambIntensity, contribs);
      litCache.set(key, lit);
    }
    if (lit !== fullLitFill) return false;
  }
  return true;
}

/** Build an `M…L…Z` path from face-(u,v) polygons offset to (minU, minV). */
function polysToPathD(
  polys: ReadonlyArray<ReadonlyArray<readonly [number, number]>>,
  minU: number,
  minV: number,
): string {
  let d = "";
  for (const poly of polys) {
    if (poly.length < 3) continue;
    d += `M${(poly[0]![0] - minU).toFixed(1)},${(poly[0]![1] - minV).toFixed(1)}`;
    for (let j = 1; j < poly.length; j++) {
      d += `L${(poly[j]![0] - minU).toFixed(1)},${(poly[j]![1] - minV).toFixed(1)}`;
    }
    d += "Z";
  }
  return d;
}

/**
 * Run every light pass for one receiver and merge each face's passes into a
 * single SVG descriptor. Shared by all three renderers so multi-light shadow
 * overlap is identical everywhere.
 */
export function computeMergedReceiverShadows<T = unknown>(
  input: MergedReceiverShadowInput<T>,
): MergedShadowFace[] {
  const {
    receiverPlanes, receiverPolygons, receiverHasTexture, casters,
    lightDir, runDirectional, pointPasses, allPointLights,
    cameraRot, ambientLight, directionalLight, shadow,
  } = input;
  const shadowOpacity = shadow?.opacity ?? 0.25;

  const planeByFace = new Map<number, ReceiverFacePlane>();
  for (const pl of receiverPlanes) planeByFace.set(pl.faceIndex, pl);

  type Layer = { polys: Array<Array<[number, number]>>; fill: string; opacity: number };
  type FaceAgg = {
    memberPolyIndices: number[];
    base: string;
    solid: boolean;
    preblendEligible: boolean;
    creaseBled: boolean;
    layers: Layer[];
  };
  const perFace = new Map<number, FaceAgg>();

  // Crease bleed is only safe where the opaque pre-blend applies, and the
  // pre-blend only applies to a SINGLE-pass solid face. With more than one
  // light pass a face may aggregate two layers and take the base + multiply
  // path, whose layers do NOT compose across separate SVGs and are not
  // idempotent — so multi-light receivers keep today's geometry and behavior
  // exactly. Gating on the pass count (rather than per-face layer count) is
  // required because the clips are built during the passes, before the
  // per-face layer count is known.
  const creaseBleed = !receiverHasTexture && (runDirectional ? 1 : 0) + pointPasses.length === 1;

  const runPass = (lightPos: Vec3 | undefined, thisPointIndex: number | undefined): void => {
    const specs = computeReceiverShadowFaces<T>({
      receiverPlanes, receiverPolygons, receiverHasTexture, casters,
      lightDir, lightPos, allPointLights, thisPointIndex,
      cameraRot, ambientLight, directionalLight, shadow, creaseBleed,
    });
    for (const spec of specs) {
      if (spec.facePolysUv.length === 0) continue;
      const solid = spec.fullLitFill !== "";
      let agg = perFace.get(spec.faceIndex);
      if (!agg) {
        agg = {
          memberPolyIndices: spec.memberPolyIndices,
          base: spec.fullLitFill,
          solid,
          preblendEligible: spec.preblendEligible,
          creaseBled: false,
          layers: [],
        };
        perFace.set(spec.faceIndex, agg);
      }
      if (spec.creaseBled) agg.creaseBled = true;
      agg.layers.push({ polys: spec.facePolysUv, fill: spec.fill, opacity: spec.opacity });
    }
  };
  if (runDirectional) runPass(undefined, undefined);
  for (const p of pointPasses) runPass(p.lightPos, p.index);

  const out: MergedShadowFace[] = [];
  for (const [faceIndex, agg] of perFace) {
    const plane = planeByFace.get(faceIndex);
    if (!plane || agg.layers.length === 0) continue;
    let minU = Infinity, minV = Infinity, maxU = -Infinity, maxV = -Infinity;
    for (const layer of agg.layers) for (const poly of layer.polys) for (const pt of poly) {
      if (pt[0] < minU) minU = pt[0];
      if (pt[0] > maxU) maxU = pt[0];
      if (pt[1] < minV) minV = pt[1];
      if (pt[1] > maxV) maxV = pt[1];
    }
    if (!Number.isFinite(minU)) continue;
    minU = Math.floor(minU - 1); minV = Math.floor(minV - 1);
    maxU = Math.ceil(maxU + 1); maxV = Math.ceil(maxV + 1);
    const width = maxU - minU, height = maxV - minV;
    if (!(width > 0) || !(height > 0)) continue;

    const { O, u, v, n, lift } = plane;
    const tx = O[0] + minU * u[0] + minV * v[0] + lift * n[0];
    const ty = O[1] + minU * u[1] + minV * v[1] + lift * n[1];
    const tz = O[2] + minU * u[2] + minV * v[2] + lift * n[2];
    const m = [u[0], u[1], u[2], 0, v[0], v[1], v[2], 0, n[0], n[1], n[2], 0, tx, ty, tz, 1];
    const matrixCss = `matrix3d(${m.map((x) => x.toFixed(4)).join(",")})`;

    // Merge (base + multiply) only when a SOLID face has ≥2 lights; otherwise
    // one path per pass at its own alpha (single light, or textured).
    const merged = agg.solid && agg.layers.length > 1;
    let baseFill: string | null = null;
    let baseD: string | null = null;
    const layers: MergedShadowLayer[] = [];
    if (merged) {
      baseFill = agg.base;
      baseD = "";
      for (const layer of agg.layers) baseD += polysToPathD(layer.polys, minU, minV);
      for (const layer of agg.layers) {
        layers.push({
          d: polysToPathD(layer.polys, minU, minV),
          fill: shadowMultiplyFactor(layer.fill, agg.base),
          multiply: true,
          opacity: 1,
        });
      }
    } else {
      // Single-pass SOLID face whose clip actually bled across a crease: emit
      // the pre-blended color opaque so the overlap with the neighbouring
      // face's SVG is idempotent (see blendShadowOverLitBase). Every other
      // face keeps the shadow color at its own alpha — the opaque form is
      // pixel-identical ON the surface but far more visible OFF it, where
      // `shadow.lift` parallax hangs the card past the silhouette at grazing
      // angles (measured ~4× the deviation from backdrop at opacity 0.25), so
      // it is paid only where it buys the seam fix. Textured receivers have a
      // per-pixel base — no lit color to blend against — and never pre-blend.
      for (const layer of agg.layers) {
        const preblend = agg.solid && agg.preblendEligible && agg.creaseBled && agg.layers.length === 1
          ? blendShadowOverLitBase(agg.base, layer.fill, layer.opacity)
          : null;
        layers.push({
          d: polysToPathD(layer.polys, minU, minV),
          fill: preblend ?? layer.fill,
          multiply: false,
          opacity: preblend ? 1 : layer.opacity,
        });
      }
    }
    out.push({
      faceIndex,
      memberPolyIndices: agg.memberPolyIndices,
      matrixCss,
      width,
      height,
      svgOpacity: merged ? shadowOpacity : 1,
      baseFill,
      baseD,
      layers,
    });
  }
  return out;
}

/** Re-export caster scale helper for caller convenience. */
export { meshScaleVec3 };
