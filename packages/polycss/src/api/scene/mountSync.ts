/**
 * Mount synchronization composites — (re)mounting a mesh entry's rendered
 * leaves against the current camera-cull set, with optional Lambert
 * bucketing in dynamic lighting mode and a chunked async variant for large
 * meshes.
 *
 * Sits above cameraCull + mountLifecycle and below the render orchestration
 * in createPolyScene. Extracted verbatim; closure-captured scene state comes
 * in through the SceneContext.
 */
import type { Vec3 } from "@layoutit/polycss-core";
import { CAMERA_BACKFACE_CULL_EPS } from "@layoutit/polycss-core";
import type { RenderedPoly } from "../../render/textureAtlas";
import { quantizeNormalKey } from "./transforms";
import {
  clearMountedRendered,
  clearShadowLeaves,
  firstPreservedChild,
  mountRenderedFragment,
} from "./mountLifecycle";
import {
  cameraCullRotation,
  cameraCullSignature,
  canDomCullCamera,
  patchMountedRenderedForCamera,
  renderedItemsForCamera,
  restoreInlineDynamicNormalVars,
  syncCameraCullSignature,
} from "./cameraCull";
import { emitShadowLeaves } from "./shadowOrchestrator";
import type { SceneContext } from "./sceneContext";
import type { MeshEntry } from "./internalTypes";

// Used only by the internal async mesh update path. Batching DOM insertion
// keeps large gallery meshes below Chrome's long-task warning threshold
// without changing the synchronous public setPolygons() contract.
const ASYNC_MOUNT_BATCH_SIZE = 750;

export function syncMountedRendered(ctx: SceneContext, entry: MeshEntry): void {
  const doc = ctx.doc;
  clearMountedRendered(entry);
  entry.hasBuckets = false;
  const skipBucketNormalCleanup = entry.skipBucketNormalCleanupOnce;
  entry.skipBucketNormalCleanupOnce = false;
  const fragment = doc.createDocumentFragment();

  // Lambert-bucketing only pays off in dynamic mode, where the cascade
  // recomputes lambert per polygon every frame. Baked mode bakes lambert
  // into atlas pixels at parse time — no per-frame computation to save.
  const useBuckets =
    ctx.options.current.textureLighting === "dynamic" && !entry.stableDom;

  interface BucketGroup {
    vec: Vec3;
    items: RenderedPoly[];
  }
  const groups = new Map<string, BucketGroup>();
  const soloItems: RenderedPoly[] = [];

  // Pass 1 — gather per (quantized-normal × color) keys.
  for (const item of renderedItemsForCamera(ctx, entry)) {
    const poly = entry.polygons[item.polygonIndex];
    const q = useBuckets && poly ? quantizeNormalKey(poly) : null;
    if (!q) {
      soloItems.push(item);
      continue;
    }
    const key = q.key + "|" + (poly.color ?? "");
    let group = groups.get(key);
    if (!group) {
      group = { vec: q.vec, items: [] };
      groups.set(key, group);
    }
    group.items.push(item);
  }

  // Pass 2 — wrap groups of ≥ 2 (where one bucket-level lambert calc
  // beats the per-poly calcs it replaces). Singletons fall back to the
  // per-poly path so we don't add a wrapper that costs more than it saves.
  for (const item of soloItems) {
    restoreInlineDynamicNormalVars(ctx, entry, item);
    fragment.appendChild(item.element);
  }
  for (const group of groups.values()) {
    if (group.items.length < 2) {
      for (const item of group.items) {
        restoreInlineDynamicNormalVars(ctx, entry, item);
        fragment.appendChild(item.element);
      }
      continue;
    }
    const bucketEl = doc.createElement("div");
    bucketEl.className = "polycss-bucket";
    entry.hasBuckets = true;
    bucketEl.style.setProperty("--pnx", String(group.vec[0]));
    bucketEl.style.setProperty("--pny", String(group.vec[1]));
    bucketEl.style.setProperty("--pnz", String(group.vec[2]));
    for (const item of group.items) {
      bucketEl.appendChild(item.element);
      // Atlas sets per-poly --pnx/y/z inline (for the non-bucketed
      // dynamic-lighting path used by other consumers). Inside a bucket
      // those inline values are dead weight — the lambert is computed at
      // the wrapper and inherited. Strip them.
      if (!skipBucketNormalCleanup || item.kind === "triangle") {
        item.element.style.removeProperty("--pnx");
        item.element.style.removeProperty("--pny");
        item.element.style.removeProperty("--pnz");
      }
    }
    fragment.appendChild(bucketEl);
  }

  mountRenderedFragment(entry, fragment, firstPreservedChild(entry));
  syncCameraCullSignature(ctx, entry);
}

function yieldToMainThread(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

export async function syncMountedRenderedChunked(
  ctx: SceneContext,
  entry: MeshEntry,
  shouldCancel: () => boolean,
): Promise<boolean> {
  const doc = ctx.doc;
  const useBuckets =
    ctx.options.current.textureLighting === "dynamic" && !entry.stableDom;
  if (useBuckets) {
    syncMountedRendered(ctx, entry);
    return !shouldCancel();
  }

  clearMountedRendered(entry);
  let fragment = doc.createDocumentFragment();
  const before = firstPreservedChild(entry);
  let count = 0;
  for (const item of renderedItemsForCamera(ctx, entry)) {
    if (shouldCancel()) return false;
    restoreInlineDynamicNormalVars(ctx, entry, item);
    fragment.appendChild(item.element);
    count++;
    if (count % ASYNC_MOUNT_BATCH_SIZE === 0) {
      mountRenderedFragment(entry, fragment, before);
      fragment = doc.createDocumentFragment();
      await yieldToMainThread();
    }
  }
  if (fragment.childNodes.length > 0) mountRenderedFragment(entry, fragment, before);
  syncCameraCullSignature(ctx, entry);
  return !shouldCancel();
}

export function syncMountedRenderedForCameraChange(
  ctx: SceneContext,
  entry: MeshEntry,
  force = false,
): void {
  if (entry.voxelRenderer) {
    if (force) entry.voxelRenderer.render(cameraCullRotation(ctx, entry));
    else entry.voxelRenderer.syncCamera(cameraCullRotation(ctx, entry));
    entry.cameraCullSignature = "voxel-direct";
    return;
  }

  if (!canDomCullCamera(entry)) {
    const wasCulled = entry.cameraCullSignature !== "all";
    entry.cameraCullSignature = "all";
    if (wasCulled) remountEntry(ctx, entry);
    return;
  }

  if (entry.hasBuckets) {
    remountEntryIfCullSignatureChanged(ctx, entry, force);
    return;
  }

  const nextSignature = cameraCullSignature(ctx, entry);
  if (!force && nextSignature === entry.cameraCullSignature) return;

  const changed = patchMountedRenderedForCamera(ctx, entry, CAMERA_BACKFACE_CULL_EPS);
  entry.cameraCullSignature = nextSignature;
  if (changed) emitShadowLeaves(ctx, entry);
}

export function remountEntryIfCullSignatureChanged(
  ctx: SceneContext,
  entry: MeshEntry,
  force = false,
): void {
  const next = canDomCullCamera(entry)
    ? cameraCullSignature(ctx, entry)
    : "all";
  if (!force && next === entry.cameraCullSignature) return;
  remountEntry(ctx, entry);
}

export function remountEntry(ctx: SceneContext, entry: MeshEntry): void {
  if (entry.voxelRenderer) {
    entry.voxelRenderer.render(cameraCullRotation(ctx, entry));
    entry.cameraCullSignature = "voxel-direct";
    return;
  }
  clearShadowLeaves(ctx, entry);
  syncMountedRendered(ctx, entry);
  emitShadowLeaves(ctx, entry);
}
