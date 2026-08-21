/**
 * DOM mount/unmount lifecycle for a mesh entry's rendered leaves — the
 * low-level primitives shared by the render, camera-cull, and rebake paths.
 *
 * Extracted verbatim from createPolyScene.ts; closure-captured scene state
 * comes in through the SceneContext.
 */
import type { RenderedPoly } from "../../render/textureAtlas";
import { clearAllSceneShadows } from "./shadowCache";
import type { SceneContext } from "./sceneContext";
import type { MeshEntry } from "./internalTypes";

/** Shared resolved promise for entries with no pending texture work. */
export const TEXTURES_READY = Promise.resolve();

export function clearRendered(ctx: SceneContext, entry: MeshEntry): void {
  entry.textureReadyPromise = TEXTURES_READY;
  entry.voxelRenderer?.dispose();
  entry.voxelRenderer = undefined;
  disposeRendered(entry.rendered, entry.disposeAtlas);
  entry.disposeAtlas = undefined;
  entry.rendered.length = 0;
  entry.renderedByPolygonIndex = [];
  entry.cameraCullGroups = [];
  entry.cameraCullSignature = "";
  entry.solidLightingPreviewPrepared = false;
  entry.solidLightingPreviewActive = false;
  clearShadowLeaves(ctx, entry);
  for (const child of Array.from(entry.wrapper.children)) {
    if (child instanceof HTMLElement && child.classList.contains("polycss-bucket")) {
      child.remove();
    }
  }
  entry.hasBuckets = false;
}

export function firstPreservedChild(entry: MeshEntry): ChildNode | null {
  for (const child of Array.from(entry.wrapper.childNodes)) {
    if (!(child instanceof HTMLElement)) return child;
    if (child.classList.contains("polycss-bucket")) continue;
    if (child.classList.contains("polycss-shadow")) continue;
    const tag = child.tagName.toLowerCase();
    if (tag === "b" || tag === "i" || tag === "s" || tag === "u" || tag === "q") continue;
    return child;
  }
  return null;
}

export function mountRenderedFragment(entry: MeshEntry, fragment: DocumentFragment, before: ChildNode | null): void {
  if (before?.parentNode === entry.wrapper) {
    entry.wrapper.insertBefore(fragment, before);
  } else {
    entry.wrapper.appendChild(fragment);
  }
}

export function clearShadowLeaves(ctx: SceneContext, entry: MeshEntry): void {
  // Current shadows are scene-level SVGs, but retained internal `<q>` leaves
  // can still be present during cleanup of already-mounted entries.
  for (const el of entry.shadowRendered) {
    if (el.parentNode) el.parentNode.removeChild(el);
  }
  entry.shadowRendered.length = 0;
  // SVG shadow surfaces are scene-scoped (one per ground / receiver
  // face, aggregating every caster). Any per-entry trigger that asks
  // to clear leaves drops the whole scene-level set; emitSceneShadows
  // will rebuild it next.
  clearAllSceneShadows(ctx);
}

export function disposeRendered(rendered: RenderedPoly[], disposeAtlas?: () => void): void {
  disposeAtlas?.();
  for (const r of rendered) {
    try { r.dispose(); } catch { /* ignore */ }
    if (r.element.parentNode) r.element.parentNode.removeChild(r.element);
  }
}

export function setRendered(
  entry: MeshEntry,
  rendered: RenderedPoly[],
  disposeAtlas?: () => void,
  textureReadyPromise?: Promise<void>,
): void {
  entry.rendered = rendered;
  entry.renderedByPolygonIndex = [];
  for (const item of rendered) {
    entry.renderedByPolygonIndex[item.polygonIndex] = item;
  }
  entry.disposeAtlas = disposeAtlas;
  entry.textureReadyPromise = textureReadyPromise
    ? textureReadyPromise.catch(() => undefined)
    : TEXTURES_READY;
  entry.solidLightingPreviewPrepared = false;
}

export function clearMountedRendered(entry: MeshEntry): void {
  for (const child of Array.from(entry.wrapper.children)) {
    if (child instanceof HTMLElement && child.classList.contains("polycss-bucket")) {
      child.remove();
    }
  }
  entry.hasBuckets = false;
  for (const item of entry.rendered) {
    if (item.element.parentNode) item.element.parentNode.removeChild(item.element);
  }
}
