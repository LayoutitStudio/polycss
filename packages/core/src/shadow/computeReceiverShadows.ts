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
import { rotateVec3InWrapperCssFrame } from "../math/rotation";
import { clipPolygonToConvex2D } from "./clipping";
import { ensureCcw2D } from "./projection";
import {
  groupReceiverFaceGroups,
  meshScaleVec3,
  worldCssForMesh,
  worldPositionToCss,
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
  memberPolyIndices: number[];
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
    const { O, n, u, v, outlineUv, memberPolysUv, memberPolyIndices } = group;
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
      O, n, u, v, outlineUv, memberPolysUv, memberPolyIndices,
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
  return planes;
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
  /** Directional light vector in CSS frame. */
  lightDir: Vec3;
  /** Camera cull rotation (rotX/rotY + receiver mesh rotation) so back-
   *  facing receiver faces can be skipped. */
  cameraRot: CameraCullRotation;
  /** Ambient light (used for solid-receiver shadow tint via shadePolygon). */
  ambientLight?: PolyAmbientLight;
  /** Directional light (used for textured-darken opacity calc). */
  directionalLight?: PolyDirectionalLight;
  /** Scene shadow options. */
  shadow?: { color?: string; opacity?: number; maxExtend?: number };
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
    lightDir, cameraRot, ambientLight, directionalLight, shadow,
  } = input;

  const llen = Math.hypot(lightDir[0], lightDir[1], lightDir[2]) || 1;
  const Lx = lightDir[0] / llen;
  const Ly = lightDir[1] / llen;
  const Lz = lightDir[2] / llen;
  const ambColor = ambientLight?.color ?? "#ffffff";
  const ambIntensity = ambientLight?.intensity ?? 0.4;
  const dirIntensity = directionalLight?.intensity ?? 1;
  const userShadowColor = shadow?.color ?? "#000000";
  const opacity = shadow?.opacity ?? 0.25;
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
    // Back-facing receiver face → can't receive light → skip.
    const Ldotn = Lx * n[0] + Ly * n[1] + Lz * n[2];
    if (Ldotn <= 1e-6) continue;
    // Camera back-face cull. SVGs don't honor CSS backface-visibility
    // reliably, so a back-of-camera receiver-face SVG would still paint.
    if (!normalFacesCamera(n, cameraOnlyRot)) continue;

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
      const t = (VmOx * n[0] + VmOy * n[1] + VmOz * n[2]) / Ldotn;
      const Px = w[0] - t * Lx;
      const Py = w[1] - t * Ly;
      const Pz = w[2] - t * Lz;
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
    const fMinU = minU, fMinV = minV;
    const fMaxU = group.minU + width;
    const fMaxV = group.minV + height;

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
        for (const loop of silhouette) {
          if (loop.length < 3) continue;
          // 3D clip against the receiver plane half-space first — silhouette
          // vertices that sit BELOW the receiver project to the wrong side
          // of the (u,v) basis and produce inverted shadows.
          const above3D = clipLoopAbovePlane(loop, O, n, SELF_SHADOW_EPS);
          if (above3D.length < 3) continue;
          const projected = above3D.map(projectOntoPlane);
          const subjectCcw = ensureCcw2D(projected);
          const reachClipped = reachRect.length === 4
            ? clipPolygonToConvex2D(subjectCcw, reachRect)
            : subjectCcw;
          if (reachClipped.length < 3) continue;
          const clip = clipPolygonToConvex2D(reachClipped, outlineUv);
          if (clip.length < 3) continue;
          let bucket: { id: T; verts: Vec2[][]; subPolygonIndices: number[] } | undefined;
          for (const memberPoly of group.memberPolysUv) {
            const memberClip = clipPolygonToConvex2D(clip, ensureCcw2D(memberPoly as Vec2[]));
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
          const cnDotL = item.planeN[0] * Lx + item.planeN[1] * Ly + item.planeN[2] * Lz;
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
          const clip = clipPolygonToConvex2D(reachClipped, outlineUv);
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
          for (const memberPoly of group.memberPolysUv) {
            const memberClip = clipPolygonToConvex2D(clip, ensureCcw2D(memberPoly as Vec2[]));
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

    // Per-group opacity for textured receivers. Three.js darkens linearly:
    // shadow_linear = lit_linear × ambient/(direct + ambient). CSS opacity
    // blends in sRGB, so apply a gamma-2.4 approximation to match.
    let effOp = opacity;
    if (receiverHasTexture) {
      const direct = dirIntensity * Math.max(0, Ldotn);
      const total = direct + Math.max(0, ambIntensity);
      if (total > 0) {
        const ratioLinear = Math.max(0, ambIntensity) / total;
        const ratioSrgb = Math.pow(ratioLinear, 1 / 2.4);
        effOp = opacity * (1 - ratioSrgb);
      } else {
        effOp = 0;
      }
    }

    // Per-face shadow tint. Each receiver face uses ITS OWN polygon color
    // for the ambient-only fill (one material per coplanar group).
    const groupPolyIdx = group.memberPolyIndices[0] ?? 0;
    const groupColor = receiverPolygons[groupPolyIdx]?.color ?? "#cccccc";
    const fillColor = receiverHasTexture
      ? userShadowColor
      : shadePolygon(groupColor, 0, "#000000", ambColor, ambIntensity);

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
    if (shMinU < minU) shMinU = minU;
    if (shMinV < minV) shMinV = minV;
    if (shMaxU > minU + width) shMaxU = minU + width;
    if (shMaxV > minV + height) shMaxV = minV + height;
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
    for (const entry of clippedByCaster.values()) {
      let d = "";
      for (const verts of entry.verts) {
        d += `M${(verts[0]![0] - shMinU).toFixed(1)},${(verts[0]![1] - shMinV).toFixed(1)}`;
        for (let j = 1; j < verts.length; j++) {
          d += `L${(verts[j]![0] - shMinU).toFixed(1)},${(verts[j]![1] - shMinV).toFixed(1)}`;
        }
        d += "Z";
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
    });
  }

  return out;
}

/** Re-export caster scale helper for caller convenience. */
export { meshScaleVec3 };
