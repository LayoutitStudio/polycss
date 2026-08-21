/**
 * Atlas rebake — the serialised in-place light-rebake used by
 * `mesh.rebakeAtlas()` and the baked-lighting commit path, plus the small
 * render-eligibility helpers it shares with `renderEntry`.
 *
 * Extracted verbatim from createPolyScene.ts. `renderEntry` stays in
 * createPolyScene (it orchestrates the full destructive render), so the
 * fallback paths here receive it as an explicit, typed function parameter —
 * the one genuine inversion in this module.
 */
import type { PolyPointLight, Vec3 } from "@layoutit/polycss-core";
import { inverseRotateVec3 } from "@layoutit/polycss-core";
import {
  renderPolygonsWithTextureAtlas,
  type SolidPaintDefaults,
} from "../../render/textureAtlas";
import { applySolidPaintVars } from "./lightingVars";
import { worldDirectionalLightToCss } from "./transforms";
import { emitShadowLeaves } from "./shadowOrchestrator";
import type { SceneContext } from "./sceneContext";
import type { MeshEntry } from "./internalTypes";

/** The full destructive per-entry render owned by createPolyScene. Passed
 *  into the rebake paths for their fallback cases. */
export type RenderEntryFn = (entry: MeshEntry, lightDirectionOverride?: Vec3) => void;

export function canRenderVoxelDirect(ctx: SceneContext, entry: MeshEntry): boolean {
  return !!entry.voxelSource &&
    ctx.options.current.textureLighting !== "dynamic" &&
    !entry.stableDom &&
    !entry.castShadow;
}

// Convert the scene's world-space point lights into a mesh's LOCAL frame
// (subtract the mesh position, inverse-rotate by the mesh rotation) so they
// match the local vertex frame the atlas plan shades in. The atlas plan
// applies the CSS axis-swap × tile itself (computePointContribs). Returns
// undefined when there are no point lights so the shading fast path holds.
export function localPointLightsForEntry(
  ctx: SceneContext,
  entry: MeshEntry,
): PolyPointLight[] | undefined {
  const pls = ctx.options.current.pointLights;
  if (!pls || pls.length === 0) return undefined;
  const pos = entry.handle.transform.position ?? [0, 0, 0];
  const rot = entry.handle.transform.rotation ?? [0, 0, 0];
  const hasRot = rot[0] !== 0 || rot[1] !== 0 || rot[2] !== 0;
  return pls.map((pl) => {
    const rel: Vec3 = [pl.position[0] - pos[0], pl.position[1] - pos[1], pl.position[2] - pos[2]];
    const local = hasRot ? inverseRotateVec3(rel, rot as Vec3) : rel;
    return { ...pl, position: local };
  });
}

// Light-only rebake that mutates the existing leaves in place instead
// of tearing them down. Used by `rebakeAtlas` so dragging the directional
// light slider doesn't flash a frame of unstyled mesh on every tick.
//
// Polygon vertices are unchanged → `matrix3d` is unchanged → element
// positions are unchanged. Only the baked Lambert color (inline `color`
// / `background-color` for solid leaves, atlas bitmap URL for textured
// <s> leaves) differs. We build a throw-away atlas off-DOM, wait for
// its bitmap URLs to be applied to its (never-mounted) elements, then
// copy each new element's `style` attribute onto the existing leaf with
// the matching polygon index. The new elements are never inserted; the
// old leaves keep painting with their previous bitmap until the swap.
//
// Falls back to plain `renderEntry` for cases where the in-place swap
// can't safely match (initial render, voxel-direct path, stable-DOM
// skeletal animation, topology mismatch).
export function rebakeRenderEntryInPlace(
  ctx: SceneContext,
  entry: MeshEntry,
  renderEntry: RenderEntryFn,
  lightDirectionOverride?: Vec3,
): void {
  const currentOptions = ctx.options.current;
  if (
    entry.rendered.length === 0 ||
    entry.voxelRenderer ||
    entry.stableDom ||
    canRenderVoxelDirect(ctx, entry)
  ) {
    renderEntry(entry, lightDirectionOverride);
    return;
  }
  // If the wrapper was emptied externally (e.g. by a test, or a
  // consumer reaching into the DOM), entry.rendered still references
  // the detached leaves. Mutating their styles wouldn't put them back
  // in the DOM — fall back to the destructive rebuild instead.
  if (entry.rendered[0]?.element.parentNode === null) {
    renderEntry(entry, lightDirectionOverride);
    return;
  }

  const baseDirLight = currentOptions.directionalLight;
  const userDirLight: typeof baseDirLight = lightDirectionOverride
    ? { ...baseDirLight, direction: lightDirectionOverride }
    : baseDirLight;
  const directionalLight = worldDirectionalLightToCss(userDirLight);
  const renderOptions = {
    doc: ctx.doc,
    directionalLight,
    pointLights: localPointLightsForEntry(ctx, entry),
    ambientLight: currentOptions.ambientLight,
    textureLighting: currentOptions.textureLighting,
    textureQuality: currentOptions.textureQuality,
    textureLeafSizing: currentOptions.textureLeafSizing,
    textureImageRendering: currentOptions.textureImageRendering,
    textureBackend: currentOptions.textureBackend,
    textureProjection: currentOptions.textureProjection,
    seamBleed: currentOptions.seamBleed,
    strategies: currentOptions.strategies,
    computeSolidPaintDefaults: true,
    skipDynamicNormalVars: currentOptions.textureLighting === "dynamic",
  };
  const newAtlas = renderPolygonsWithTextureAtlas(
    entry.polygons,
    renderOptions as Parameters<typeof renderPolygonsWithTextureAtlas>[1],
  );

  const finish = (): void => {
    entry.rebakeInFlight = false;
    const queued = entry.rebakeQueuedLightDir;
    if (queued !== null) {
      entry.rebakeQueuedLightDir = null;
      rebakeRenderEntryInPlace(ctx, entry, renderEntry, queued);
    }
  };
  const apply = (): void => {
    if (entry.disposed) {
      newAtlas.dispose();
      finish();
      return;
    }
    // Topology mismatch (shouldn't happen for a pure light rebake but
    // guards against pathological cases) → drop the new atlas and let
    // the full destructive renderEntry path rebuild from scratch.
    if (newAtlas.rendered.length !== entry.rendered.length) {
      newAtlas.dispose();
      renderEntry(entry, lightDirectionOverride);
      finish();
      return;
    }
    for (const item of newAtlas.rendered) {
      const existing = entry.renderedByPolygonIndex[item.polygonIndex];
      if (!existing) continue;
      const nextStyle = item.element.getAttribute("style");
      if (nextStyle !== null) existing.element.setAttribute("style", nextStyle);
    }
    const spd = (newAtlas as { solidPaintDefaults?: SolidPaintDefaults })
      .solidPaintDefaults;
    if (spd) applySolidPaintVars(entry.wrapper, spd);
    // Hand off the Blob URL: revoke the previous atlas's URLs only
    // AFTER the existing leaves have been re-styled to point at the
    // new ones. Defer one animation frame so the browser has a chance
    // to commit a paint with the new URL before the old one is freed.
    const previousDisposeAtlas = entry.disposeAtlas;
    entry.disposeAtlas = newAtlas.dispose;
    if (previousDisposeAtlas) {
      const schedule: (cb: () => void) => void =
        typeof requestAnimationFrame === "function"
          ? (cb) => { requestAnimationFrame(cb); }
          : (cb) => { setTimeout(cb, 0); };
      schedule(previousDisposeAtlas);
    }
    // <q> shadow leaves still need to follow the new light direction.
    emitShadowLeaves(ctx, entry);
    finish();
  };

  const ready = (newAtlas as { pagesReady?: Promise<void> }).pagesReady;
  if (ready && typeof ready.then === "function") {
    entry.textureReadyPromise = ready.catch(() => undefined);
    // Pre-decode the new atlas bitmaps BEFORE swapping styles. Until
    // a Blob URL is paint-committed at least once the browser hasn't
    // decoded it; copying that URL into a mounted element triggers
    // decode lazily on the next paint, which is exactly the visible
    // blank frame. `Image.decode()` forces decode upfront so the
    // first paint after the style swap composites the bitmap
    // immediately.
    ready
      .then(() => collectAtlasUrlsFromRendered(newAtlas.rendered))
      .then(decodeAtlasUrls)
      .then(apply, () => {
        newAtlas.dispose();
        if (!entry.disposed) renderEntry(entry, lightDirectionOverride);
        finish();
      });
  } else {
    apply();
  }
}

// Serialised entry point for rebakeRenderEntryInPlace. Coalesces
// rapid back-to-back calls: while a rebake is in flight, the latest
// requested light direction is queued (overwriting any prior queued
// value) and applied as soon as the in-flight rebake's apply()
// resolves. The visible bitmap therefore only ever advances to the
// LATEST-requested direction in order — no out-of-order swaps that
// would visually flicker between intermediate light directions.
export function requestRebakeAtlas(
  ctx: SceneContext,
  entry: MeshEntry,
  renderEntry: RenderEntryFn,
  lightDir: Vec3,
): void {
  if (entry.rebakeInFlight) {
    entry.rebakeQueuedLightDir = lightDir;
    return;
  }
  entry.rebakeInFlight = true;
  rebakeRenderEntryInPlace(ctx, entry, renderEntry, lightDir);
}

function collectAtlasUrlsFromRendered(
  rendered: ReturnType<typeof renderPolygonsWithTextureAtlas>["rendered"],
): string[] {
  const urls = new Set<string>();
  for (const item of rendered) {
    const style = item.element.getAttribute("style") ?? "";
    // Match `background:url(blob:...)` or `--polycss-atlas-url:url(blob:...)`.
    const re = /url\((blob:[^)]+)\)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(style)) !== null) urls.add(m[1]);
  }
  return Array.from(urls);
}

function decodeAtlasUrls(urls: string[]): Promise<void> {
  if (urls.length === 0 || typeof Image === "undefined") return Promise.resolve();
  return Promise.all(urls.map((url) => {
    const img = new Image();
    img.src = url;
    const decoded = img.decode?.();
    return decoded ? decoded.catch(() => {}) : Promise.resolve();
  })).then(() => undefined);
}
