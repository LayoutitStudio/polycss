/**
 * INTERNAL types — the per-mesh state, per-receiver-face cache record, and
 * per-caster cache record that `createPolyScene` maintains across emits.
 *
 * These aren't part of the public API surface (none of them appear on the
 * `polycss` package exports), but they're shared structurally between
 * createPolyScene.ts and the extracted scene/* helpers, so they live here
 * rather than in either one.
 */
import type {
  CameraCullNormalGroup,
  ParseResult,
  Polygon,
  Vec3,
} from "@layoutit/polycss-core";
import type { PolyVoxelRenderer } from "../../render/voxelRenderer";
import type { RenderedPoly } from "../../render/textureAtlas";
import type { PolyMeshHandle } from "./types";

/**
 * The per-mesh state record threaded through every scene operation. Owned by
 * `createPolyScene` (it lives in a `Set<MeshEntry>` on the scene context),
 * created in `add()`, mutated by render/update/setOptions paths, freed by
 * `dispose()`.
 */
export interface MeshEntry {
  handle: PolyMeshHandle;
  wrapper: HTMLDivElement;
  parseResult: ParseResult;
  rendered: RenderedPoly[];
  renderedByPolygonIndex: Array<RenderedPoly | undefined>;
  /** Dynamic-mode shadow `<q>` leaves, one per non-deduped casting polygon.
   *  Empty in baked mode (which uses scene-level shadow SVGs instead). */
  shadowRendered: HTMLElement[];
  voxelRenderer?: PolyVoxelRenderer;
  disposeAtlas?: () => void;
  polygons: Polygon[];
  voxelSource: ParseResult["voxelSource"];
  disposed: boolean;
  stableDom: boolean;
  hasBuckets: boolean;
  skipBucketNormalCleanupOnce: boolean;
  excludeFromAutoCenter: boolean;
  castShadow: boolean;
  receiveShadow: boolean;
  /** Polygon bbox CENTER in CSS world coords. Same value the wrapper's
   *  `--origin` CSS variable carries — i.e. the pivot point that the
   *  wrapper's scale3d and rotation use. Cached so shadow geometry can apply
   *  scale around the same pivot. */
  bboxCenterCss: Vec3 | null;
  cameraCullGroups: CameraCullNormalGroup[];
  cameraCullSignature: string;
  lightOverrideSignature: string;
  stableTriangleColorFrame: number;
  solidLightingPreviewPrepared: boolean;
  solidLightingPreviewActive: boolean;
  /** Rotation snapshot used by the baked atlas baker. Advances only when
   *  `rebakeAtlas()` is called — not on every `setTransform`. */
  bakedRotation: Vec3;
  /** Auto-assigned, scene-unique identifier (`polycss-mesh-<N>`). Reflected
   *  on the wrapper as `data-poly-mesh-index` and used as the fallback
   *  shadow-debug id when the caller didn't pass an explicit `transform.id`.
   *  Lets DevTools queries pinpoint a mesh and its cast shadows even when no
   *  id was set up front. */
  autoMeshId: string;
  /** rebakeAtlas serialization. Each tick of a fast slider drag triggers a
   *  rebake; without serialization multiple in-flight atlases finish out-of-
   *  order and the visible bitmap rapidly swaps between intermediate light
   *  directions — perceived as flicker. With serialization, only one rebake
   *  runs at a time; intermediate ticks just update the queued target. */
  rebakeInFlight: boolean;
  rebakeQueuedLightDir: Vec3 | null;
  /** Cached light-visibility raytrace result. Keyed by the polygon array
   *  reference (changes on `setPolygons`) plus the quantized mesh-local
   *  light direction. Recomputed on cache miss only — not per frame. Forces
   *  directScale=0 for occluded polygons via `lightOccludedPolyIndices` on
   *  atlas options, so baked shading drops to ambient-only on faces a
   *  shadow-map would cull. */
  lightOcclusionCache?: {
    polygons: Polygon[];
    lightDirKey: string;
    occluded: ReadonlySet<number>;
    /** Cached `findOverlappingPolygonDuplicates` drop-set for this mesh.
     *  Invariant under light direction, so it's computed once per polygons
     *  identity and reused on every cache-miss recompute. */
    dedupDropped: ReadonlySet<number>;
  };
}

/**
 * Per-receiver cached face geometry. Each entry holds one record per
 * coplanar face group on the receiver: plane (O, n, u, v), outline polygon
 * (Sutherland-Hodgman clip), bbox in (u, v) for SVG sizing, and the
 * pre-stringified matrix3d transform that places an SVG on that face plane.
 *
 * All of this is invariant under light/caster changes. Per light tick we
 * just re-run the per-tri SH and build the path `d` — never recompute
 * groups or basis. Cache invalidated when the receiver's polygon count or
 * position changes.
 */
export interface ReceiverFacePlane {
  O: Vec3;
  n: Vec3;
  u: Vec3;
  v: Vec3;
  outlineUv: Array<[number, number]>;
  /** Per-constituent-polygon (u,v) outlines used to post-filter
   *  Sutherland-Hodgman-clipped sub-shadows that fall inside the convex hull
   *  but outside the actual polygon union (concave bridging regions). */
  memberPolysUv: Array<Array<[number, number]>>;
  /** Receiver-mesh polygon indices for the polygons in memberPolysUv, in
   *  matching order. */
  memberPolyIndices: number[];
  minU: number;
  minV: number;
  width: number;
  height: number;
  matrixCss: string;
  /** Index of this face group within the receiver's plane list, set on the
   *  SVG as `data-poly-shadow-receiver-face` so a specific receiving surface
   *  can be addressed directly in DevTools. */
  faceIndex: number;
  /** Mount-once SVG: created on first non-empty frame for this face, then
   *  kept in the DOM. Per-frame we sync its <path> children (one per
   *  contributing caster) and toggle `display`. Avoids per-frame
   *  createElementNS + insertBefore + layer churn. */
  svg: SVGSVGElement | null;
  visible: boolean;
}

/**
 * Per-caster cached per-polygon data: world-space vertices + 3D AABB
 * corners. Invariant under light direction; depends only on the caster
 * mesh's geometry and position. Reused across every receiver-face SH-clip
 * in a frame and across frames within a drag, so the caching pays for
 * itself many times over.
 */
export interface CasterPolyItem {
  wv: Vec3[];
  bboxCorners: Vec3[];
  /** Outward CSS-space normal (unit) and plane offset (n·O) of the caster
   *  polygon. Used by the receiver-shadow path to skip casters that are
   *  coplanar with a receiver face. */
  planeN: Vec3 | null;
  planeOffset: number;
  /** Source polygon index in caster.polygons. Reflected on the corresponding
   *  shadow `<path>` as `data-poly-shadow-caster-poly` so DevTools can
   *  pinpoint which caster polygon produced any given sub-shadow. */
  polygonIndex: number;
}
