/**
 * useMeshAtlas — per-polygon texture atlas plan computation, the atlas
 * bitmap hook, texture-readiness waiters, solid paint defaults, and the
 * atomic-mode onFrameReady notification. Extracted verbatim from
 * PolyMesh.tsx.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from "react";
import type { ReactNode } from "react";
import type { Polygon } from "@layoutit/polycss-core";
import { buildBasisHints, resolveSeamBleedPx } from "@layoutit/polycss-core";
import {
  buildSeamBleedPolygonEdges,
  buildTextureEdgeRepairSets,
  computeTextureAtlasPlan,
  getSolidPaintDefaults,
  type TextureQuality,
  useTextureAtlas,
} from "../atlas";
import { solidPaintVars, type MeshLighting } from "./useMeshLighting";

export interface UseMeshAtlasOptions {
  renderPolygon: ((polygon: Polygon, index: number) => ReactNode) | null;
  directVoxelEnabled: boolean;
  polygons: Polygon[];
  lighting: MeshLighting;
  textureQuality?: TextureQuality;
  atomicAtlas?: boolean;
  onFrameReady?: () => void;
}

export function useMeshAtlas({
  renderPolygon,
  directVoxelEnabled,
  polygons,
  lighting,
  textureQuality,
  atomicAtlas,
  onFrameReady,
}: UseMeshAtlasOptions) {
  const {
    effectiveTextureLighting,
    effectiveStrategies,
    effectiveSeamBleed,
    effectiveTextureLeafSizing,
    effectiveTextureImageRendering,
    effectiveTextureBackend,
    effectiveTextureProjection,
    effectiveAmbient,
    bakedDirectional,
    bakedPointLights,
    lightOccludedPolyIndices,
  } = lighting;

  const textureReadyRef = useRef(true);
  const textureReadyWaitersRef = useRef<Array<() => void>>([]);

  const resolveTextureReadyWaiters = useCallback(() => {
    const waiters = textureReadyWaitersRef.current.splice(0);
    for (const resolve of waiters) resolve();
  }, []);

  const atlasPlans = useMemo(
    () => {
      if (renderPolygon || directVoxelEnabled) return [];
      const repairEdges = buildTextureEdgeRepairSets(polygons);
      // Core owns seamBleed resolution (resolveSeamBleedPx): "auto"/undefined
      // → the 1.5px default, numbers are absolute px. Skip the seam-edge map
      // only when the resolved overscan is 0.
      const seamBleedEdges = resolveSeamBleedPx(effectiveSeamBleed) > 0
        ? buildSeamBleedPolygonEdges(polygons, {
            directionalLight: bakedDirectional,
            ambientLight: effectiveAmbient,
          })
        : null;
      // Cross-polygon basis hints (shared-edge adjacency, connected
      // components) — vanilla's renderer always computes these because they
      // affect which polygons qualify for the stable-solid-triangle path.
      // Without them, ~8 polygons in a typical castle mesh fall through to
      // the atlas bitmap path instead of <u>, producing visible parity
      // drift vs vanilla in dynamic mode.
      const basisHints = buildBasisHints(polygons, {
        directionalLight: bakedDirectional,
        ambientLight: effectiveAmbient,
      });
      return polygons.map((p, i) => computeTextureAtlasPlan(
        p,
        i,
        {
          directionalLight: bakedDirectional,
          pointLights: bakedPointLights,
          ambientLight: effectiveAmbient,
          seamBleed: effectiveSeamBleed,
          seamEdges: seamBleedEdges?.get(i),
          textureEdgeRepairEdges: repairEdges[i],
          lightOccludedPolyIndices,
        },
        basisHints[i],
      ));
    },
    [renderPolygon, directVoxelEnabled, polygons, bakedDirectional, bakedPointLights, effectiveAmbient, effectiveSeamBleed, lightOccludedPolyIndices],
  );
  const textureAtlas = useTextureAtlas(
    atlasPlans,
    effectiveTextureLighting,
    textureQuality,
    effectiveTextureLeafSizing,
    effectiveTextureBackend,
    effectiveTextureImageRendering,
    effectiveTextureProjection,
    effectiveStrategies,
    atomicAtlas,
  );
  textureReadyRef.current = textureAtlas.ready;
  useEffect(() => {
    if (textureAtlas.ready) resolveTextureReadyWaiters();
  }, [textureAtlas.ready, resolveTextureReadyWaiters]);
  useEffect(() => resolveTextureReadyWaiters, [resolveTextureReadyWaiters]);
  // Stable promise accessor for PolyMeshHandle.whenTexturesReady — reads the
  // ready ref / waiter list at call time, so the identity never changes and
  // the handle memo (deps [id]) can capture it safely.
  const whenTexturesReady = useCallback(() => {
    if (textureReadyRef.current) return Promise.resolve();
    return new Promise<void>((resolve) => {
      textureReadyWaitersRef.current.push(resolve);
    });
  }, []);
  // Use the displayed plans (which lag in atomic mode) so solid leaves swap in
  // lockstep with the textured ones.
  const solidPaintDefaults = useMemo(
    () => !renderPolygon ? getSolidPaintDefaults(textureAtlas.plans, effectiveTextureLighting, effectiveStrategies) : {},
    [renderPolygon, textureAtlas.plans, effectiveTextureLighting, effectiveStrategies],
  );
  // In atomic mode the returned entries reference only changes when the frame
  // actually swaps (decoded), so fire onFrameReady there for preview handoff.
  // useLayoutEffect (not useEffect) so a consumer that resets a preview
  // transform does it BEFORE the swapped frame paints — otherwise the new
  // geometry paints one frame with the stale preview scale still applied.
  const onFrameReadyRef = useRef(onFrameReady);
  onFrameReadyRef.current = onFrameReady;
  useLayoutEffect(() => {
    if (atomicAtlas && textureAtlas.ready) onFrameReadyRef.current?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [textureAtlas.entries]);
  const defaultPaintVars = useMemo(
    () => solidPaintVars(solidPaintDefaults),
    [solidPaintDefaults],
  );

  return { atlasPlans, textureAtlas, whenTexturesReady, solidPaintDefaults, defaultPaintVars };
}
