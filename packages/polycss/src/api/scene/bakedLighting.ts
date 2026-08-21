/**
 * Baked-solid lighting preview/commit state machine + the per-mesh dynamic
 * light-var override. Drives the interactive light-drag flow: preview via
 * CSS cascade vars, then either commit (re-bake solids in place + atlas
 * swap) or clear (restore the pre-preview paint).
 *
 * Extracted verbatim from createPolyScene.ts. `renderEntry` stays in
 * createPolyScene, so `commitBakedSolidLighting` receives it as an explicit
 * typed parameter for the rebake fallback path.
 */
import type { Vec3 } from "@layoutit/polycss-core";
import { inverseRotateVec3 } from "@layoutit/polycss-core";
import type { RenderedPoly } from "../../render/textureAtlas";
import {
  BAKED_SOLID_PREVIEW_ACTIVE_VAR,
  applyBakedSolidColor,
  applyBakedSolidPreviewPaint,
  applyLightingVars,
  clearLightingVars,
  setStylePropertyIfChanged,
} from "./lightingVars";
import { worldDirectionToCss } from "./transforms";
import { rebakeRenderEntryInPlace, type RenderEntryFn } from "./rebake";
import {
  emitSceneShadows,
  invalidateShadowLightCache,
} from "./shadowOrchestrator";
import type { SceneContext } from "./sceneContext";
import type { MeshEntry } from "./internalTypes";
import type { PolySceneOptions } from "./types";

// Dynamic-mode per-mesh light override: when the mesh has a non-zero rotation
// and the scene is in dynamic lighting mode, emit --plx/ly/lz on the
// wrapper element, computed by inverse-rotating the world-space light into the
// mesh's local frame. The cascade means these override the scene-level vars
// only for polygons inside this wrapper. Cleared when conditions are not met.
export function applyMeshLightVarOverride(
  ctx: SceneContext,
  entry: MeshEntry,
  rotation: Vec3 | undefined,
): void {
  const currentOptions = ctx.options.current;
  const isDynamic = currentOptions.textureLighting === "dynamic";
  const dir = currentOptions.directionalLight?.direction;
  const hasNonZeroRotation = rotation && (rotation[0] !== 0 || rotation[1] !== 0 || rotation[2] !== 0);

  if (!isDynamic || !hasNonZeroRotation || !dir) {
    if (entry.lightOverrideSignature === "clear") return;
    entry.wrapper.style.removeProperty("--plx");
    entry.wrapper.style.removeProperty("--ply");
    entry.wrapper.style.removeProperty("--plz");
    entry.lightOverrideSignature = "clear";
    return;
  }

  // dir is user-frame; rotation is also user-frame (Euler). Apply the
  // inverse rotation first, then swap to CSS frame so the result dots
  // correctly with the leaf's --pnx/--pny/--pnz (also CSS-frame).
  const localDirUser = inverseRotateVec3(dir as Vec3, rotation as Vec3);
  const localDir = worldDirectionToCss(localDirUser);
  const len = Math.hypot(localDir[0], localDir[1], localDir[2]) || 1;
  // H10: quantize to 0.01 (~0.57° angular resolution) matching the
  // scene-root writes in lightingVars.applyLightingVars, so per-mesh
  // overrides don't trigger style recalc on sub-quantum light changes.
  const plx = (localDir[0] / len).toFixed(2);
  const ply = (localDir[1] / len).toFixed(2);
  const plz = (localDir[2] / len).toFixed(2);
  const signature = `${plx}|${ply}|${plz}`;
  if (entry.lightOverrideSignature === signature) return;
  entry.wrapper.style.setProperty("--plx", plx);
  entry.wrapper.style.setProperty("--ply", ply);
  entry.wrapper.style.setProperty("--plz", plz);
  entry.lightOverrideSignature = signature;
}

export function restoreBakedSolidPaint(ctx: SceneContext, entry: MeshEntry): boolean {
  let changed = false;
  for (const item of entry.rendered) {
    if (!item.plan || item.kind === "atlas" || item.plan.texture) continue;
    const polygon = entry.polygons[item.polygonIndex];
    if (!polygon) continue;
    changed = applyBakedSolidColor(item, polygon, ctx.options.current) || changed;
  }
  entry.solidLightingPreviewPrepared = false;
  entry.solidLightingPreviewActive = false;
  return changed;
}

export function prepareBakedSolidLightingPreview(ctx: SceneContext, entry: MeshEntry): boolean {
  if ((ctx.options.current.textureLighting ?? "baked") !== "baked") return false;
  let prepared = false;
  for (const item of entry.rendered) {
    if (!item.plan || item.kind === "atlas" || item.plan.texture) continue;
    const polygon = entry.polygons[item.polygonIndex];
    if (!polygon) continue;
    applyBakedSolidPreviewPaint(item, polygon, item.plan.shadedColor);
    prepared = true;
  }
  entry.solidLightingPreviewPrepared = prepared;
  return prepared;
}

export function installBakedSolidLightingPreview(ctx: SceneContext, entry: MeshEntry): boolean {
  if ((ctx.options.current.textureLighting ?? "baked") !== "baked") return false;
  if (!entry.solidLightingPreviewPrepared && !prepareBakedSolidLightingPreview(ctx, entry)) return false;
  entry.solidLightingPreviewActive = true;
  return true;
}

export function needsBakedAtlasCommit(item: RenderedPoly): boolean {
  return item.kind === "atlas" || !!item.plan?.texture;
}

export function commitBakedSolidLighting(ctx: SceneContext, renderEntry: RenderEntryFn): boolean {
  const meshes = ctx.meshes;
  const sceneEl = ctx.sceneEl;
  if ((ctx.options.current.textureLighting ?? "baked") !== "baked") return false;
  let updated = false;
  for (const entry of meshes) {
    // Solid leaves (the bulk of the castle / cottage / etc.) always need
    // their inline `color` re-baked at the new light direction — the
    // preview-cascade was making them brighter than the pre-commit
    // baseline, so without this they snap back to the OLD baked color on
    // release and read as "the face just darkened/disappeared." This is
    // CHEAP — `restoreBakedSolidPaint` walks the entry's solid leaves and
    // updates inline color/--polycss-paint in place.
    const solidChanged = restoreBakedSolidPaint(ctx, entry);
    updated = solidChanged || updated;
    if (entry.rendered.some(needsBakedAtlasCommit)) {
      // In-place atlas swap (same path `mesh.rebakeAtlas()` uses) instead
      // of the destructive `renderEntry()`. The destructive path calls
      // `clearRendered(entry)` which removes EVERY leaf from the DOM and
      // then asynchronously rebuilds the atlas — during that window the
      // mesh's faces disappear visually. `rebakeRenderEntryInPlace` keeps
      // the existing leaves mounted and only swaps the atlas bitmap URL
      // on textured leaves.
      rebakeRenderEntryInPlace(ctx, entry, renderEntry);
      updated = true;
    }
  }
  sceneEl.style.removeProperty(BAKED_SOLID_PREVIEW_ACTIVE_VAR);
  for (const entry of meshes) {
    clearLightingVars(entry.wrapper);
    entry.solidLightingPreviewActive = false;
  }
  clearLightingVars(sceneEl);
  return updated;
}

export function clearBakedSolidLightingPreview(ctx: SceneContext): void {
  ctx.sceneEl.style.removeProperty(BAKED_SOLID_PREVIEW_ACTIVE_VAR);
  for (const entry of ctx.meshes) {
    if (!entry.solidLightingPreviewActive) continue;
    restoreBakedSolidPaint(ctx, entry);
    clearLightingVars(entry.wrapper);
  }
  if ((ctx.options.current.textureLighting ?? "baked") !== "dynamic") {
    clearLightingVars(ctx.sceneEl);
    // Preview shadow may have used a different light direction than the
    // committed currentOptions; bust the cache so the restored shadow
    // re-emits even if the quantized key happens to match.
    invalidateShadowLightCache(ctx);
    emitSceneShadows(ctx);
  }
}

export function applyPreviewMeshLightVars(
  ctx: SceneContext,
  entry: MeshEntry,
  next: Pick<Omit<PolySceneOptions, "camera">, "directionalLight" | "ambientLight">,
): void {
  const currentOptions = ctx.options.current;
  const rotation = entry.handle.transform.rotation;
  const dir = next.directionalLight?.direction ?? currentOptions.directionalLight?.direction;
  const hasNonZeroRotation = rotation && (rotation[0] !== 0 || rotation[1] !== 0 || rotation[2] !== 0);
  if (!hasNonZeroRotation || !dir) {
    clearLightingVars(entry.wrapper);
    return;
  }
  const localDir = inverseRotateVec3(dir as Vec3, rotation as Vec3);
  applyLightingVars(entry.wrapper, {
    ...currentOptions,
    ...next,
    directionalLight: {
      ...currentOptions.directionalLight,
      ...next.directionalLight,
      direction: localDir,
    },
  });
}

export function previewBakedSolidLighting(
  ctx: SceneContext,
  next: Pick<Omit<PolySceneOptions, "camera">, "directionalLight" | "ambientLight"> & {
    skipShadows?: boolean;
  },
): boolean {
  const currentOptions = ctx.options.current;
  const sceneEl = ctx.sceneEl;
  if ((currentOptions.textureLighting ?? "baked") !== "baked") return false;
  applyLightingVars(sceneEl, { ...currentOptions, ...next });
  if (!next.skipShadows && next.directionalLight?.direction) {
    // Interactive light preview = motion → progressive drag definition.
    emitSceneShadows(ctx, next.directionalLight.direction as Vec3, { progressive: true });
  }
  let installed = false;
  for (const entry of ctx.meshes) {
    applyPreviewMeshLightVars(ctx, entry, next);
    installed = installBakedSolidLightingPreview(ctx, entry) || installed;
  }
  if (installed) setStylePropertyIfChanged(sceneEl, BAKED_SOLID_PREVIEW_ACTIVE_VAR, "1");
  else sceneEl.style.removeProperty(BAKED_SOLID_PREVIEW_ACTIVE_VAR);
  return installed;
}
