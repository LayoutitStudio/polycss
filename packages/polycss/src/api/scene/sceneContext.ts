/**
 * Bundled scene state passed to every extracted helper instead of relying on
 * closure capture. Functionally equivalent to the original createPolyScene
 * closure — `ctx.options.current` is the same mutable reference the original
 * code wrote through `currentOptions`, `ctx.meshes` is the same `Set`, etc.
 *
 * Why bother: lifting the big shadow/render functions into separate files
 * was blocked by their 20-40 unbound closure references. With the context
 * threaded explicitly, those functions become regular module exports that
 * take `(ctx, ...args)` and do exactly what they did before.
 *
 * Mutable fields live inside containers (`options`, `autoCenter`) so
 * extracted helpers can both READ the current value AND WRITE a new one
 * without trying to mutate a primitive.
 */
import type { Vec3 } from "@layoutit/polycss-core";
import type {
  PolyOrthographicCameraHandle,
  PolyPerspectiveCameraHandle,
} from "../createPolyCamera";
import { ShadowSvgState } from "./shadowSvg";
import type {
  CasterPolyItem,
  ReceiverFacePlane,
} from "@layoutit/polycss-core";
import type { MeshEntry } from "./internalTypes";
import type { PolySceneOptions } from "./types";

/** Lazily-initialised counter wrapper for monotonic IDs (`polycss-mesh-N`). */
export interface IdCounter {
  next: number;
}

/** Container for the scene-options reference. The reference itself is what
 *  changes (via `setOptions`) — `.current` is reassigned, and any later
 *  reader picks up the new options object. */
export interface OptionsRef {
  current: Omit<PolySceneOptions, "camera">;
}

/** Container for the auto-center bbox offset, which is recomputed when
 *  meshes are added or removed. */
export interface AutoCenterRef {
  offset: Vec3;
}

/**
 * The everything-bag passed to extracted scene helpers. Created once per
 * `createPolyScene` call and threaded through every extracted function.
 */
export interface SceneContext {
  // Host + scene element handles. Static for the scene's lifetime.
  host: HTMLElement;
  doc: Document;
  cameraEl: HTMLDivElement;
  sceneEl: HTMLDivElement;

  // Camera handle the scene is bound to.
  camera: PolyPerspectiveCameraHandle | PolyOrthographicCameraHandle;
  /** Compensates parent CSS `zoom` on the scene root; resampled when the
   *  host moves between containers with different zoom factors. */
  layoutScale: number;

  // Mutable scene state.
  options: OptionsRef;
  meshes: Set<MeshEntry>;
  meshAutoCounter: IdCounter;
  autoCenter: AutoCenterRef;
  /** Mesh bbox cache used as the auto-center pivot. */
  bboxCenterCssCache: { value: Vec3 | null };

  // Shadow state — ground SVG + caches.
  shadowSvgState: ShadowSvgState;
  receiverShadowCache: Map<MeshEntry, ReceiverFacePlane[]>;
  receiverShadowCacheKey: Map<MeshEntry, string>;
  casterItemsCache: Map<MeshEntry, CasterPolyItem[]>;
  casterItemsCacheKey: Map<MeshEntry, string>;
  /** Set during a progressive (light-drag) shadow emit so the receiver
   *  projector uses `shadow.dragDefinition` instead of full `definition`.
   *  Cleared for the debounced full-quality refine. */
  shadowDragActive: boolean;
}

/** Build a fresh SceneContext for a new scene. The mutable containers
 *  start in their default state; the caller (createPolyScene) populates
 *  the elements + camera before passing to helpers. */
export function createSceneContext(input: {
  host: HTMLElement;
  doc: Document;
  cameraEl: HTMLDivElement;
  sceneEl: HTMLDivElement;
  camera: PolyPerspectiveCameraHandle | PolyOrthographicCameraHandle;
  layoutScale: number;
  options: Omit<PolySceneOptions, "camera">;
}): SceneContext {
  return {
    host: input.host,
    doc: input.doc,
    cameraEl: input.cameraEl,
    sceneEl: input.sceneEl,
    camera: input.camera,
    layoutScale: input.layoutScale,
    options: { current: input.options },
    meshes: new Set(),
    meshAutoCounter: { next: 0 },
    autoCenter: { offset: [0, 0, 0] },
    bboxCenterCssCache: { value: null },
    shadowSvgState: new ShadowSvgState(),
    receiverShadowCache: new Map(),
    receiverShadowCacheKey: new Map(),
    casterItemsCache: new Map(),
    casterItemsCacheKey: new Map(),
    shadowDragActive: false,
  };
}
