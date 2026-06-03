/**
 * Cache management for scene-level shadow surfaces. Operates on the
 * `receiverShadowCache` / `casterItemsCache` maps living on the SceneContext.
 *
 * Receiver-face SVGs are mounted lazily and reused across light changes
 * (toggle `display: none` instead of remove/re-insert) so the compositor
 * layer count stays bounded. Per-caster precomputed world vertices and
 * plane data are reused across every receiver-face SH-clip inside a frame.
 */
import type { SceneContext } from "./sceneContext";
import { disposeGroundShadow } from "./shadowSvg";
import { disposeAllReceiverShadowMounts } from "./receiverShadow";
import type {
  MeshEntry,
  ReceiverFacePlane,
} from "./internalTypes";

/** Detach a list of receiver-face SVGs from the DOM and null the slot.
 *  Used both on per-entry invalidation and on full scene clear. */
export function disposeReceiverPlanes(planes: ReceiverFacePlane[]): void {
  for (const p of planes) {
    if (p.svg && p.svg.parentNode) p.svg.parentNode.removeChild(p.svg);
    p.svg = null;
  }
}

/**
 * Drop the receiver-face cache for a single entry (e.g. when its polygons
 * change). With no `entry`, drops the cache for every receiver in the scene.
 */
export function clearReceiverShadowCache(
  ctx: SceneContext,
  entry?: MeshEntry,
): void {
  if (entry) {
    const planes = ctx.receiverShadowCache.get(entry);
    if (planes) disposeReceiverPlanes(planes);
    ctx.receiverShadowCache.delete(entry);
    ctx.receiverShadowCacheKey.delete(entry);
  } else {
    for (const planes of ctx.receiverShadowCache.values()) disposeReceiverPlanes(planes);
    ctx.receiverShadowCache.clear();
    ctx.receiverShadowCacheKey.clear();
  }
}

/** Drop the per-caster precomputed-vertex cache for a single entry, or for
 *  every caster in the scene when `entry` is omitted. */
export function clearCasterItemsCache(
  ctx: SceneContext,
  entry?: MeshEntry,
): void {
  if (entry) {
    ctx.casterItemsCache.delete(entry);
    ctx.casterItemsCacheKey.delete(entry);
  } else {
    ctx.casterItemsCache.clear();
    ctx.casterItemsCacheKey.clear();
  }
}

/** Tear down every scene-level shadow surface: dispose the ground SVG and
 *  detach every receiver-face SVG mounted across the scene. Called by
 *  `clearShadowLeaves` and any path that wants a clean slate before the
 *  next emit (e.g. when the last caster toggles `castShadow` off). */
export function clearAllSceneShadows(ctx: SceneContext): void {
  disposeGroundShadow(ctx.shadowSvgState);
  disposeAllReceiverShadowMounts(ctx);
}

/** Stable id used to label a mesh in shadow `data-poly-shadow-casters` /
 *  `data-poly-shadow-receiver` attributes. Prefers the caller-supplied
 *  `transform.id` (so explicit, human-readable names survive); falls back
 *  to the auto-assigned `polycss-mesh-<N>` so every mesh is addressable. */
export function meshShadowId(entry: MeshEntry): string {
  return entry.handle.id ?? entry.autoMeshId;
}
