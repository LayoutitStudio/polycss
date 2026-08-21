/**
 * useMeshAtlas — per-polygon texture atlas plan computation, the atlas
 * bitmap composable, texture-readiness waiters, solid paint defaults, and
 * the atomic-mode onFrameReady notification. Extracted verbatim from
 * PolyMesh.ts.
 */
import { computed, onBeforeUnmount, watch } from "vue";
import type { ComputedRef } from "vue";
import type { Polygon } from "@layoutit/polycss-core";
import { buildBasisHints, resolveSeamBleedPx } from "@layoutit/polycss-core";
import {
  buildSeamBleedPolygonEdges,
  buildTextureEdgeRepairSets,
  computeTextureAtlasPlan,
  getSolidPaintDefaults,
  type SolidPaintDefaults,
  type TextureQuality,
  useTextureAtlas,
} from "../atlas";
import { solidPaintVars, type MeshLighting } from "./useMeshLighting";

export interface MeshAtlasProps {
  textureQuality?: TextureQuality;
  atomicAtlas: boolean;
  onFrameReady?: () => void;
}

export function useMeshAtlas({
  props,
  atlasAutoRender,
  directVoxelEnabled,
  polygons,
  lighting,
}: {
  props: MeshAtlasProps;
  atlasAutoRender: boolean;
  directVoxelEnabled: ComputedRef<boolean>;
  polygons: ComputedRef<Polygon[]>;
  lighting: MeshLighting;
}) {
  const {
    atlasTextureLighting,
    atlasStrategies,
    atlasSeamBleed,
    atlasTextureLeafSizing,
    atlasTextureImageRendering,
    atlasTextureBackend,
    atlasTextureProjection,
    atlasAmbient,
    bakedDirectional,
    bakedPointLights,
    lightOccludedPolyIndices,
  } = lighting;

  const textureAtlasPlans = computed(() => {
    if (!atlasAutoRender || directVoxelEnabled.value) return [];
    const repairEdges = buildTextureEdgeRepairSets(polygons.value);
    // Core owns seamBleed resolution (resolveSeamBleedPx): "auto"/undefined
    // → the 1.5px default, numbers are absolute px. Skip the seam-edge map
    // only when the resolved overscan is 0.
    const seamBleedEdges = resolveSeamBleedPx(atlasSeamBleed.value) > 0
      ? buildSeamBleedPolygonEdges(polygons.value, {
          directionalLight: bakedDirectional.value,
          ambientLight: atlasAmbient.value,
        })
      : null;
    // Cross-polygon basis hints — vanilla's renderer always passes these,
    // and the stable-solid-triangle classification depends on them.
    // Without, ~8 polygons in a castle-class mesh fall through to atlas
    // bitmap instead of <u>, diverging from vanilla.
    const basisHints = buildBasisHints(polygons.value, {
      directionalLight: bakedDirectional.value,
      ambientLight: atlasAmbient.value,
    });
    return polygons.value.map((p, i) =>
      computeTextureAtlasPlan(
        p,
        i,
        {
          directionalLight: bakedDirectional.value,
          pointLights: bakedPointLights.value,
          ambientLight: atlasAmbient.value,
          seamBleed: atlasSeamBleed.value,
          seamEdges: seamBleedEdges?.get(i),
          textureEdgeRepairEdges: repairEdges[i],
          lightOccludedPolyIndices,
        },
        basisHints[i],
      ),
    );
  });
  const atlasTextureQuality = computed(() => props.textureQuality);
  const atomicAtlas = computed(() => props.atomicAtlas);
  const textureAtlas = useTextureAtlas(
    textureAtlasPlans,
    atlasTextureLighting,
    atlasTextureQuality,
    atlasTextureLeafSizing,
    atlasTextureBackend,
    atlasTextureImageRendering,
    atlasTextureProjection,
    atlasStrategies,
    atomicAtlas,
  );
  const textureReadyWaiters: Array<() => void> = [];
  const resolveTextureReadyWaiters = (): void => {
    const waiters = textureReadyWaiters.splice(0);
    for (const resolve of waiters) resolve();
  };
  watch(
    () => textureAtlas.ready.value,
    (ready) => { if (ready) resolveTextureReadyWaiters(); },
    { immediate: true },
  );
  onBeforeUnmount(resolveTextureReadyWaiters);
  // Stable promise accessor for PolyMeshHandle.whenTexturesReady — reads the
  // ready flag / waiter list at call time so the handle can delegate to it.
  const whenTexturesReady = (): Promise<void> => {
    if (textureAtlas.ready.value) return Promise.resolve();
    return new Promise<void>((resolve) => {
      textureReadyWaiters.push(resolve);
    });
  };
  // Use the displayed plans (which lag in atomic mode) so solid leaves swap in
  // lockstep with the textured ones.
  const solidPaintDefaults = computed<SolidPaintDefaults>(() =>
    atlasAutoRender ? getSolidPaintDefaults(textureAtlas.plans.value, atlasTextureLighting.value, atlasStrategies.value) : {},
  );
  // Fire onFrameReady when the displayed atlas frame swaps (atomic mode) — used
  // by consumers to hand off a preview transform without a one-frame overshoot.
  watch(
    () => textureAtlas.entries.value,
    () => { if (props.atomicAtlas && textureAtlas.ready.value) props.onFrameReady?.(); },
    { flush: "sync" },
  );
  const defaultPaintVars = computed(() => solidPaintVars(solidPaintDefaults.value));

  return { textureAtlasPlans, textureAtlas, whenTexturesReady, solidPaintDefaults, defaultPaintVars };
}
