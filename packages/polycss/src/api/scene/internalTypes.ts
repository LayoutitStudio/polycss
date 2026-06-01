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

// ReceiverFacePlane + CasterPolyItem now live in @layoutit/polycss-core.
// The vanilla scene caches store them as-is and import the types directly
// from core where needed.
