import { useMemo } from "react";
import { optimizeMeshPolygons } from "@layoutit/polycss-react";
import type { Polygon } from "@layoutit/polycss-react";
import { interiorShellPolygons as buildInteriorShellPolygons } from "../../helpers/interiorShell";
import { activeMeshResolution, type WorkbenchMeshResolution } from "../../types";
import type { LoadedModel } from "../types";

export interface UseScenePolygonsOptions {
  loaded: LoadedModel | null;
  hasActiveAnimation: boolean;
  meshResolution: WorkbenchMeshResolution;
  renderer: "react" | "vanilla";
  reactAnimatedPolygons: Polygon[] | null;
  interiorFill: boolean;
}

export interface UseScenePolygonsResult {
  modelPolygons: Polygon[];
  interiorShellPolygons: Polygon[];
  scenePolygons: Polygon[];
  helperBbox: { minX: number; minY: number; minZ: number; maxX: number; maxY: number; maxZ: number } | null;
  helperScale: number;
  helperTarget: [number, number, number];
}

export function useScenePolygons({
  loaded,
  hasActiveAnimation,
  meshResolution,
  renderer,
  reactAnimatedPolygons,
  interiorFill,
}: UseScenePolygonsOptions): UseScenePolygonsResult {
  const effectiveMeshResolution = activeMeshResolution(meshResolution);
  const modelPolygons = useMemo(() => {
    if (!loaded) return [];
    if (hasActiveAnimation) {
      return renderer === "react" && reactAnimatedPolygons
        ? reactAnimatedPolygons
        : loaded.rawPolygons;
    }
    if (loaded.parseResult.voxelSource) return loaded.rawPolygons;
    return optimizeMeshPolygons(loaded.rawPolygons, {
      meshResolution: effectiveMeshResolution,
    });
  }, [
    loaded,
    hasActiveAnimation,
    effectiveMeshResolution,
    renderer,
    reactAnimatedPolygons,
  ]);

  const interiorShellPolygons = useMemo(
    () => interiorFill && !hasActiveAnimation && !loaded?.parseResult.voxelSource
      ? buildInteriorShellPolygons(modelPolygons)
      : [],
    [
      modelPolygons,
      interiorFill,
      hasActiveAnimation,
      loaded,
    ],
  );

  const helperBbox = useMemo(() => {
    const polygons = modelPolygons;
    if (polygons.length === 0) return null;
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (const polygon of polygons) {
      for (const v of polygon.vertices) {
        if (v[0] < minX) minX = v[0]; if (v[0] > maxX) maxX = v[0];
        if (v[1] < minY) minY = v[1]; if (v[1] > maxY) maxY = v[1];
        if (v[2] < minZ) minZ = v[2]; if (v[2] > maxZ) maxZ = v[2];
      }
    }
    return { minX, minY, minZ, maxX, maxY, maxZ };
  }, [modelPolygons]);

  const helperScale = useMemo(() => {
    if (!helperBbox) return 30;
    return Math.max(
      helperBbox.maxX - helperBbox.minX,
      helperBbox.maxY - helperBbox.minY,
      helperBbox.maxZ - helperBbox.minZ,
      1,
    );
  }, [helperBbox]);

  const helperTarget = useMemo<[number, number, number]>(() => {
    if (!helperBbox) return [0, 0, 0];
    return [
      (helperBbox.minX + helperBbox.maxX) / 2,
      (helperBbox.minY + helperBbox.maxY) / 2,
      (helperBbox.minZ + helperBbox.maxZ) / 2,
    ];
  }, [helperBbox]);

  return {
    modelPolygons,
    interiorShellPolygons,
    scenePolygons: modelPolygons,
    helperBbox,
    helperScale,
    helperTarget,
  };
}
