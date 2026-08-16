import { useMemo } from "react";
import type {
  Polygon,
  Vec3,
} from "@layoutit/polycss-core";
import { buildSceneContext, mergePolygons } from "@layoutit/polycss-core";

export interface UseSceneContextResult {
  polygons: Polygon[];
  sceneBbox: { min: Vec3; max: Vec3 };
}

/**
 * React hook that runs the PolyCSS scene-context pipeline:
 *   normalizePolygons → mergePolygons by default → bbox compute.
 *
 * Returns the processed polygons + the scene-wide axis-aligned bbox. Memoized
 * on input identity.
 */
export function usePolySceneContext(polygons: Polygon[]): UseSceneContextResult {
  return useMemo(() => {
    // Normalize first via buildSceneContext (it runs normalizePolygons),
    // then merge. Merge runs AFTER normalize so it sees a clean polygon
    // list (no degenerates, valid UVs).
    const built = buildSceneContext({ polygons });
    const finalPolygons = mergePolygons(built.context.polygons);

    return {
      polygons: finalPolygons,
      sceneBbox: built.context.sceneBbox,
    };
  }, [polygons]);
}
