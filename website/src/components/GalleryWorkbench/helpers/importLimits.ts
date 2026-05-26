import {
  optimizeAnimatedMeshPolygons,
  optimizeMeshPolygons,
} from "@layoutit/polycss";
import type { ParseResult } from "@layoutit/polycss";
import { activeMeshResolution, type WorkbenchMeshResolution } from "../../types";

export const IMPORTED_MODEL_RENDERED_POLYGON_LIMIT = 4000;

function formatCount(value: number): string {
  return Math.round(value).toLocaleString("en-US");
}

export function countImportedRenderedPolygons(
  result: ParseResult,
  meshResolution: WorkbenchMeshResolution,
): number {
  if (result.voxelSource) return result.polygons.length;

  const effectiveMeshResolution = activeMeshResolution(meshResolution);
  const staticPolygons = optimizeMeshPolygons(result.polygons, {
    meshResolution: effectiveMeshResolution,
  }).length;
  if (!result.animation || effectiveMeshResolution !== "lossy") return staticPolygons;

  const animatedPolygons = optimizeAnimatedMeshPolygons(result, {
    meshResolution: effectiveMeshResolution,
  }).polygons.length;
  return Math.max(staticPolygons, animatedPolygons);
}

export function assertImportedRenderedPolygonLimit(
  result: ParseResult,
  meshResolution: WorkbenchMeshResolution,
  label: string,
  limit = IMPORTED_MODEL_RENDERED_POLYGON_LIMIT,
): void {
  const count = countImportedRenderedPolygons(result, meshResolution);
  if (count <= limit) return;
  throw new Error(
    `${label} renders ${formatCount(count)} DOM polygons after optimization; import limit is ${formatCount(limit)}. ` +
    "Reduce the model or import a lower-poly version.",
  );
}
