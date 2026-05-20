import type { MeshResolution, Polygon, Vec3 } from "../types";
import type { ParseResult } from "../parser/types";
import { cullInteriorPolygons } from "../cull/cullInteriorPolygons";

export interface OptimizeAnimatedMeshPolygonsOptions {
  /** Public quality/resolution intent. Defaults to "lossy". */
  meshResolution?: MeshResolution;
}

interface SourceVertex {
  polygonIndex: number;
  vertexIndex: number;
}

interface PlannedPolygon {
  rest: Polygon;
  sources: SourceVertex[];
}

function mappedVertices(frame: Polygon[], sources: SourceVertex[]): Vec3[] | null {
  const vertices: Vec3[] = [];
  for (const source of sources) {
    const vertex = frame[source.polygonIndex]?.vertices[source.vertexIndex];
    if (!vertex || vertex.some((value) => !Number.isFinite(value))) return null;
    vertices.push([vertex[0], vertex[1], vertex[2]]);
  }
  return vertices;
}

function plannedOriginalPolygon(polygons: Polygon[], index: number): PlannedPolygon | null {
  const polygon = polygons[index];
  if (!polygon) return null;
  return {
    rest: polygon,
    sources: polygon.vertices.map((_, vertexIndex) => ({ polygonIndex: index, vertexIndex })),
  };
}

function buildCulledTrianglePlan(polygons: Polygon[]): PlannedPolygon[] {
  const culled = cullInteriorPolygons(polygons);
  if (culled.length >= polygons.length) return [];
  const sourceIndex = new Map<Polygon, number>();
  polygons.forEach((polygon, index) => sourceIndex.set(polygon, index));
  const plan: PlannedPolygon[] = [];
  for (const polygon of culled) {
    const index = sourceIndex.get(polygon);
    if (index === undefined) return [];
    const original = plannedOriginalPolygon(polygons, index);
    if (!original) return [];
    plan.push(original);
  }
  return plan;
}

function applyPlanToFrame(frame: Polygon[], plan: PlannedPolygon[]): Polygon[] {
  const out: Polygon[] = [];
  for (const item of plan) {
    const vertices = mappedVertices(frame, item.sources);
    if (!vertices) return frame;
    const color = frame[item.sources[0]?.polygonIndex]?.color ?? item.rest.color;
    out.push({
      ...item.rest,
      vertices,
      color,
    });
  }
  return out;
}

export function optimizeAnimatedMeshPolygons(
  result: ParseResult,
  options: OptimizeAnimatedMeshPolygonsOptions = {},
): ParseResult {
  if (!result.animation || result.polygons.length === 0 || options.meshResolution === "lossless") {
    return result;
  }

  const culledPlan = buildCulledTrianglePlan(result.polygons);
  if (culledPlan.length === 0 || culledPlan.length >= result.polygons.length) return result;

  return {
    ...result,
    polygons: culledPlan.map((item) => item.rest),
    animation: {
      ...result.animation,
      sample(clip, timeSeconds) {
        return applyPlanToFrame(result.animation!.sample(clip, timeSeconds), culledPlan);
      },
    },
    metadata: {
      ...result.metadata,
      triangleCount: culledPlan.length,
    },
  };
}
