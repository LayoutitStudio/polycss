import type { MeshResolution, Polygon, Vec3 } from "../types";
import type { ParseAnimationController, ParseResult } from "../parser/types";
import { cullInteriorPolygons } from "../cull/cullInteriorPolygons";
import { filterGltfAnimationController } from "../parser/parseGltf";
import { getSolidTextureBakedAnimationInfo } from "../parser/solidTextureSamples";

const POLY_ANIMATION_TRIANGLE_FRAME_SOURCE = Symbol.for("polycss.animation.triangleFrameSource");

interface PolyAnimationTriangleFrame {
  polygonCount: number;
  vertices: Float64Array;
  colors?: readonly (string | undefined)[];
  textureFlags?: readonly boolean[];
  solidTriangles?: boolean;
}

interface PolyAnimationTriangleFrameSource {
  [POLY_ANIMATION_TRIANGLE_FRAME_SOURCE]?: (
    clip: number | string,
    timeSeconds: number,
  ) => PolyAnimationTriangleFrame | null | undefined;
}

export interface OptimizeAnimatedMeshPolygonsOptions {
  /** Public quality/resolution intent. Defaults to "lossy". */
  meshResolution?: MeshResolution;
}

interface PlannedPolygon {
  rest: Polygon;
  originalIndex: number;
  sourceRefs: number[];
}

function plannedOriginalPolygon(polygons: Polygon[], index: number): PlannedPolygon | null {
  const polygon = polygons[index];
  if (!polygon) return null;
  const sourceRefs: number[] = [];
  for (let vertexIndex = 0; vertexIndex < polygon.vertices.length; vertexIndex++) {
    sourceRefs.push(index, vertexIndex);
  }
  return {
    rest: polygon,
    originalIndex: index,
    sourceRefs,
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

function applyPlanToFrame(frame: Polygon[], plan: PlannedPolygon[], useRestColor = false): Polygon[] {
  const out: Polygon[] = new Array(plan.length);
  for (let planIndex = 0; planIndex < plan.length; planIndex++) {
    const item = plan[planIndex]!;
    const refs = item.sourceRefs;
    const vertices: Vec3[] = new Array(refs.length / 2);
    for (let refIndex = 0, vertexOut = 0; refIndex < refs.length; refIndex += 2, vertexOut++) {
      const sourcePolygon = frame[refs[refIndex]!];
      const vertex = sourcePolygon?.vertices[refs[refIndex + 1]!];
      if (!vertex) return frame;
      const x = vertex[0];
      const y = vertex[1];
      const z = vertex[2];
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return frame;
      vertices[vertexOut] = [x, y, z];
    }
    const color = useRestColor ? item.rest.color : frame[refs[0] ?? -1]?.color ?? item.rest.color;
    out[planIndex] = {
      ...item.rest,
      vertices,
      color,
    };
  }
  return out;
}

function planForFilteredFrame(plan: PlannedPolygon[], sourceIndices: readonly number[]): PlannedPolygon[] {
  const indexMap = new Map<number, number>();
  sourceIndices.forEach((sourceIndex, filteredIndex) => {
    indexMap.set(sourceIndex, filteredIndex);
  });
  return plan.map((item, index) => ({
    ...item,
    sourceRefs: item.sourceRefs.map((value, sourceRefIndex) =>
      sourceRefIndex % 2 === 0 ? indexMap.get(value) ?? -1 : value
    ),
  }));
}

function applyRestColorsToFilteredFrame(frame: Polygon[], plan: PlannedPolygon[]): Polygon[] | null {
  if (frame.length < plan.length) return null;
  const out: Polygon[] = new Array(plan.length);
  for (let i = 0; i < plan.length; i++) {
    const polygon = frame[i];
    const item = plan[i]!;
    if (!polygon || polygon.vertices.length !== item.rest.vertices.length) return null;
    out[i] = {
      ...item.rest,
      vertices: polygon.vertices,
      color: item.rest.color,
    };
  }
  return out;
}

function hasTexture(polygon: Polygon): boolean {
  return !!(polygon.texture || polygon.material?.texture);
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
  const bakedAnimationInfo = getSolidTextureBakedAnimationInfo(result.animation);
  const sampleSource = bakedAnimationInfo?.source ?? result.animation;
  const sourceIndices = culledPlan.map((item) => item.originalIndex);
  const filteredSource = filterGltfAnimationController(
    sampleSource,
    sourceIndices,
  );
  const frameSource = filteredSource ?? sampleSource;
  const framePlan = filteredSource ? planForFilteredFrame(culledPlan, sourceIndices) : culledPlan;
  const restColors = culledPlan.map((item) => item.rest.color);
  const restSolidTriangles = culledPlan.every((item) => item.rest.vertices.length === 3 && !hasTexture(item.rest));
  const filteredFrameDirect = filteredSource &&
    !bakedAnimationInfo &&
    culledPlan.length === sourceIndices.length &&
    culledPlan.every((item, index) =>
      item.rest.vertices.length === 3 &&
      item.sourceRefs.length === 6 &&
      item.sourceRefs[0] === sourceIndices[index] &&
      item.sourceRefs[2] === sourceIndices[index] &&
      item.sourceRefs[4] === sourceIndices[index]
    );
  const sourceFrameSampler =
    (frameSource as ParseAnimationController & PolyAnimationTriangleFrameSource)[POLY_ANIMATION_TRIANGLE_FRAME_SOURCE];
  let optimizedVertices = new Float64Array(culledPlan.length * 9);
  let optimizedColors: Array<string | undefined> = restColors.slice();
  let optimizedTextureFlags: boolean[] = new Array(culledPlan.length).fill(false);
  const optimizedFrame: PolyAnimationTriangleFrame = {
    polygonCount: culledPlan.length,
    vertices: optimizedVertices,
    colors: optimizedColors,
    textureFlags: optimizedTextureFlags,
    solidTriangles: restSolidTriangles,
  };

  const animation = {
    ...result.animation,
    sample(clip, timeSeconds) {
      const frame = frameSource!.sample(clip, timeSeconds);
      if (filteredFrameDirect) return frame;
      if (filteredSource && bakedAnimationInfo) {
        return restSolidTriangles && culledPlan.length === sourceIndices.length
          ? applyRestColorsToFilteredFrame(frame, culledPlan) ??
            applyPlanToFrame(frame, framePlan, true)
          : applyPlanToFrame(frame, framePlan, true);
      }
      return applyPlanToFrame(frame, framePlan, !!bakedAnimationInfo);
    },
  } as ParseAnimationController & PolyAnimationTriangleFrameSource;

  if (sourceFrameSampler && restSolidTriangles) {
    animation[POLY_ANIMATION_TRIANGLE_FRAME_SOURCE] = (clip, timeSeconds) => {
      const frame = sourceFrameSampler(clip, timeSeconds);
      if (!frame) return frame;
      if (filteredSource) {
        if (frame.polygonCount < culledPlan.length || frame.vertices.length < culledPlan.length * 9) {
          return null;
        }
        optimizedFrame.polygonCount = culledPlan.length;
        optimizedFrame.vertices = frame.vertices;
        optimizedFrame.colors = bakedAnimationInfo ? restColors : frame.colors;
        optimizedFrame.textureFlags = bakedAnimationInfo ? optimizedTextureFlags : frame.textureFlags;
        optimizedFrame.solidTriangles = bakedAnimationInfo
          ? restSolidTriangles
          : frame.solidTriangles === true;
        return optimizedFrame;
      }

      if (optimizedVertices.length < culledPlan.length * 9) {
        optimizedVertices = new Float64Array(culledPlan.length * 9);
        optimizedFrame.vertices = optimizedVertices;
      }
      if (optimizedColors.length < culledPlan.length) {
        optimizedColors = new Array(culledPlan.length);
        optimizedFrame.colors = optimizedColors;
      }
      if (optimizedTextureFlags.length < culledPlan.length) {
        optimizedTextureFlags = new Array(culledPlan.length).fill(false);
        optimizedFrame.textureFlags = optimizedTextureFlags;
      }

      let solidTriangles = restSolidTriangles && frame.solidTriangles !== false;
      for (let planIndex = 0; planIndex < framePlan.length; planIndex++) {
        const item = framePlan[planIndex]!;
        const refs = item.sourceRefs;
        for (let refIndex = 0, vertexOut = 0; refIndex < refs.length; refIndex += 2, vertexOut++) {
          const sourcePolygonIndex = refs[refIndex]!;
          const sourceVertexIndex = refs[refIndex + 1]!;
          if (sourcePolygonIndex < 0 || sourcePolygonIndex >= frame.polygonCount) return null;
          const sourceOffset = sourcePolygonIndex * 9 + sourceVertexIndex * 3;
          const targetOffset = planIndex * 9 + vertexOut * 3;
          if (sourceOffset + 2 >= frame.vertices.length) return null;
          optimizedVertices[targetOffset] = frame.vertices[sourceOffset]!;
          optimizedVertices[targetOffset + 1] = frame.vertices[sourceOffset + 1]!;
          optimizedVertices[targetOffset + 2] = frame.vertices[sourceOffset + 2]!;
        }
        const sourcePolygonIndex = refs[0]!;
        const textureFlag = !!frame.textureFlags?.[sourcePolygonIndex];
        optimizedTextureFlags[planIndex] = textureFlag;
        optimizedColors[planIndex] = bakedAnimationInfo
          ? item.rest.color
          : frame.colors?.[sourcePolygonIndex] ?? item.rest.color;
        if (!bakedAnimationInfo && textureFlag) solidTriangles = false;
      }

      optimizedFrame.polygonCount = culledPlan.length;
      optimizedFrame.vertices = optimizedVertices;
      optimizedFrame.colors = optimizedColors;
      optimizedFrame.textureFlags = optimizedTextureFlags;
      optimizedFrame.solidTriangles = bakedAnimationInfo ? restSolidTriangles : solidTriangles;
      return optimizedFrame;
    };
  }


  return {
    ...result,
    polygons: culledPlan.map((item) => item.rest),
    animation,
    metadata: {
      ...result.metadata,
      triangleCount: culledPlan.length,
    },
  };
}
