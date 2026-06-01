import { parsePureColor } from "../color/color";
import { optimizeMeshPolygons } from "../merge/optimizePolygons";
import {
  simplifyTriangleMeshPolygons,
  type SimplifyTriangleMeshPolygonsOptions,
} from "../merge/simplifyTriangleMesh";
import type { MeshResolution, Polygon } from "../types";
import type { ParseResult } from "./types";

interface RgbColor {
  rgb: [number, number, number];
  alpha: number;
}

interface HsvColor {
  hue: number;
  saturation: number;
  value: number;
}

export interface OptimizeMeshParseResultOptions {
  /** Render-cost optimization intent. Defaults to "lossy". */
  meshResolution?: MeshResolution;
  /** Parse result before solid texture baking, used to identify baked swatch faces. */
  source?: ParseResult;
  /** Merge near-identical baked swatch colors in lossy mode. Default 36. */
  bakedTextureColorMergeDistance?: number;
  /** Try static triangle simplification before final polygon optimization. Default true. */
  simplifyTriangleMeshes?: boolean;
  /** Options for the static triangle simplifier. */
  simplifyTriangleMeshOptions?: SimplifyTriangleMeshPolygonsOptions;
  /** Candidate optimizer early-stop drop target. Default 0.15. */
  simplifyEarlyStopDropRatio?: number;
}

const DEFAULT_BAKED_TEXTURE_COLOR_MERGE_DISTANCE = 36;
const DEFAULT_SIMPLIFY_EARLY_STOP_DROP_RATIO = 0.15;
const MAX_STATIC_SIMPLIFY_TEXTURED_RATIO = 0.25;
const MIN_STATIC_SIMPLIFY_BASELINE_SOURCE_RATIO = 0.23;
const SOURCE_FIRST_MIN_BASELINE_POLYGONS = 2000;
const SOURCE_FIRST_MAX_RELAXED_RAW_DROP = 16;

function hasTexturePaint(polygon: Polygon): boolean {
  return Boolean(
    polygon.texture ||
    polygon.material?.texture ||
    polygon.uvs?.length ||
    polygon.textureTriangles?.length
  );
}

function colorKey(color: string): string {
  const parsed = parsePureColor(color);
  if (!parsed || parsed.alpha < 1) return color.trim().toLowerCase();
  return `#${parsed.rgb
    .map((channel) => Math.max(0, Math.min(255, Math.round(channel))).toString(16).padStart(2, "0"))
    .join("")}`;
}

function parseRgbColor(color: string): RgbColor | null {
  const parsed = parsePureColor(color);
  if (!parsed) return null;
  return {
    rgb: [
      Math.max(0, Math.min(255, Math.round(parsed.rgb[0]))),
      Math.max(0, Math.min(255, Math.round(parsed.rgb[1]))),
      Math.max(0, Math.min(255, Math.round(parsed.rgb[2]))),
    ],
    alpha: parsed.alpha,
  };
}

function colorDistance(a: RgbColor, b: RgbColor): number {
  return Math.hypot(
    a.rgb[0] - b.rgb[0],
    a.rgb[1] - b.rgb[1],
    a.rgb[2] - b.rgb[2],
  );
}

function hsvFromColor(color: RgbColor): HsvColor {
  const r = color.rgb[0] / 255;
  const g = color.rgb[1] / 255;
  const b = color.rgb[2] / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  let hue = 0;
  if (delta !== 0) {
    if (max === r) hue = 60 * (((g - b) / delta) % 6);
    else if (max === g) hue = 60 * ((b - r) / delta + 2);
    else hue = 60 * ((r - g) / delta + 4);
  }
  if (hue < 0) hue += 360;
  return {
    hue,
    saturation: max === 0 ? 0 : delta / max,
    value: max,
  };
}

function hueDistance(a: number, b: number): number {
  const delta = Math.abs(a - b) % 360;
  return delta > 180 ? 360 - delta : delta;
}

function compatibleColors(a: RgbColor, b: RgbColor): boolean {
  if (a.alpha < 1 || b.alpha < 1) return false;
  const ah = hsvFromColor(a);
  const bh = hsvFromColor(b);
  const aNeutral = ah.saturation < 0.08;
  const bNeutral = bh.saturation < 0.08;
  if (aNeutral || bNeutral) return aNeutral === bNeutral;
  const tolerance = Math.min(ah.value, bh.value) < 0.18 ? 32 : 18;
  return hueDistance(ah.hue, bh.hue) <= tolerance;
}

function buildColorMergeMap(colors: Map<string, number>, distance: number): Map<string, string> {
  const parsed = new Map<string, RgbColor>();
  for (const color of colors.keys()) {
    const value = parseRgbColor(color);
    if (value) parsed.set(color, value);
  }

  const representatives: Array<{ color: string; parsed: RgbColor }> = [];
  const remap = new Map<string, string>();
  const entries = Array.from(colors.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));

  for (const [color] of entries) {
    const value = parsed.get(color);
    if (!value) {
      remap.set(color, color);
      continue;
    }

    let best: { color: string; distance: number } | null = null;
    for (const representative of representatives) {
      if (!compatibleColors(value, representative.parsed)) continue;
      const candidateDistance = colorDistance(value, representative.parsed);
      if (candidateDistance > distance) continue;
      if (!best || candidateDistance < best.distance) {
        best = { color: representative.color, distance: candidateDistance };
      }
    }
    if (best) {
      remap.set(color, best.color);
    } else {
      representatives.push({ color, parsed: value });
      remap.set(color, color);
    }
  }

  return remap;
}

function cleanupLossyBakedTextureColors(
  result: ParseResult,
  options: OptimizeMeshParseResultOptions,
  meshResolution: MeshResolution,
): ParseResult {
  if (meshResolution !== "lossy" || result.animation) return result;
  const source = options.source;
  if (!source || source.polygons === result.polygons) return result;
  const distance = options.bakedTextureColorMergeDistance ?? DEFAULT_BAKED_TEXTURE_COLOR_MERGE_DISTANCE;
  if (!Number.isFinite(distance) || distance <= 0) return result;

  const candidateColors = new Map<string, number>();
  const candidateIndices: number[] = [];
  for (let index = 0; index < result.polygons.length; index += 1) {
    const before = source.polygons[index];
    const after = result.polygons[index];
    if (!before || !after || before === after || !after.color) continue;
    if (!hasTexturePaint(before) || hasTexturePaint(after)) continue;
    const key = colorKey(after.color);
    candidateIndices.push(index);
    candidateColors.set(key, (candidateColors.get(key) ?? 0) + 1);
  }

  if (candidateColors.size < 2) return result;
  const remap = buildColorMergeMap(candidateColors, distance);
  let changed = false;
  const polygons = result.polygons.slice();
  for (const index of candidateIndices) {
    const polygon = polygons[index]!;
    const sourceColor = colorKey(polygon.color!);
    const nextColor = remap.get(sourceColor) ?? sourceColor;
    if (nextColor === sourceColor) continue;
    polygons[index] = { ...polygon, color: nextColor };
    changed = true;
  }

  return changed ? { ...result, polygons } : result;
}

function earlyStopTarget(count: number, options: OptimizeMeshParseResultOptions): number {
  const ratio = Number.isFinite(options.simplifyEarlyStopDropRatio)
    ? Math.max(0, options.simplifyEarlyStopDropRatio!)
    : DEFAULT_SIMPLIFY_EARLY_STOP_DROP_RATIO;
  return Math.max(0, count - Math.max(1, Math.ceil(count * ratio)));
}

function hasSourceVertexKeys(polygons: Polygon[]): boolean {
  return polygons.some((polygon) => polygon.simplifySourceVertexKeys?.length === polygon.vertices.length);
}

function shouldTryStaticSimplification(polygons: Polygon[], baselineOptimized: Polygon[]): boolean {
  let textured = 0;
  for (const polygon of polygons) {
    if (hasTexturePaint(polygon)) textured += 1;
  }
  return polygons.length === 0 || (
    textured / polygons.length <= MAX_STATIC_SIMPLIFY_TEXTURED_RATIO &&
    baselineOptimized.length / polygons.length > MIN_STATIC_SIMPLIFY_BASELINE_SOURCE_RATIO
  );
}

function simplifiedOptimizedPolygons(
  polygons: Polygon[],
  baselineOptimized: Polygon[],
  options: OptimizeMeshParseResultOptions,
): Polygon[] | null {
  const simplify = (vertexKeyMode?: "relaxed" | "source"): Polygon[] | null => {
    const candidate = simplifyTriangleMeshPolygons(polygons, {
      ...options.simplifyTriangleMeshOptions,
      ...(vertexKeyMode ? { vertexKeyMode } : {}),
    });
    if (candidate === polygons || candidate.length >= polygons.length) return null;
    return candidate;
  };

  const optimize = (candidate: Polygon[]): Polygon[] => (
    optimizeMeshPolygons(candidate, {
      meshResolution: "lossy",
      stopAtPolygonCount: earlyStopTarget(baselineOptimized.length, options),
    })
  );

  const relaxed = simplify();
  if (!relaxed) return null;

  let sourceKeyed: Polygon[] | null | undefined;
  let sourceOptimized: Polygon[] | null | undefined;
  const hasSourceKeys = hasSourceVertexKeys(polygons);
  const relaxedRawDrop = polygons.length - relaxed.length;
  const shouldTrySourceKeys = (
    hasSourceKeys &&
    baselineOptimized.length >= SOURCE_FIRST_MIN_BASELINE_POLYGONS &&
    relaxedRawDrop <= SOURCE_FIRST_MAX_RELAXED_RAW_DROP
  );
  if (shouldTrySourceKeys) {
    sourceKeyed = simplify("source");
    if (sourceKeyed) {
      sourceOptimized = optimize(sourceKeyed);
      if (sourceOptimized.length < baselineOptimized.length) return sourceOptimized;
    }
  }

  const relaxedOptimized = optimize(relaxed);
  if (relaxedOptimized.length < baselineOptimized.length) return relaxedOptimized;

  sourceKeyed ??= shouldTrySourceKeys ? simplify("source") : null;
  if (sourceKeyed) {
    sourceOptimized ??= optimize(sourceKeyed);
    if (sourceOptimized.length < baselineOptimized.length) return sourceOptimized;
  }
  return null;
}

export function optimizeMeshParseResult(
  result: ParseResult,
  options: OptimizeMeshParseResultOptions = {},
): ParseResult {
  if (result.voxelSource || result.animation) return result;
  const meshResolution = options.meshResolution ?? "lossy";
  const cleaned = cleanupLossyBakedTextureColors(result, options, meshResolution);
  const baselineOptimized = optimizeMeshPolygons(cleaned.polygons, { meshResolution });
  const shouldSimplify = (
    meshResolution === "lossy" &&
    options.simplifyTriangleMeshes !== false &&
    !cleaned.animation &&
    shouldTryStaticSimplification(cleaned.polygons, baselineOptimized)
  );
  const polygons = shouldSimplify
    ? simplifiedOptimizedPolygons(cleaned.polygons, baselineOptimized, options) ?? baselineOptimized
    : baselineOptimized;
  return polygons === cleaned.polygons ? cleaned : { ...cleaned, polygons };
}
