import { parsePureColor } from "@layoutit/polycss";
import type { ParseResult, Polygon } from "@layoutit/polycss";
import { activeMeshResolution, type WorkbenchMeshResolution } from "../../types";

interface RgbColor {
  rgb: [number, number, number];
  alpha: number;
}

interface HsvColor {
  hue: number;
  saturation: number;
  value: number;
}

export interface LossyBakedTextureColorOptions {
  meshResolution: WorkbenchMeshResolution;
  distance?: number;
}

const DEFAULT_DISTANCE = 36;

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

function parseColor(color: string): RgbColor | null {
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
    const value = parseColor(color);
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

export function cleanupLossyBakedTextureColors(
  source: ParseResult,
  baked: ParseResult,
  options: LossyBakedTextureColorOptions,
): ParseResult {
  if (activeMeshResolution(options.meshResolution) !== "lossy") return baked;
  if (baked.animation) return baked;
  const distance = options.distance ?? DEFAULT_DISTANCE;
  if (!Number.isFinite(distance) || distance <= 0) return baked;

  const candidateColors = new Map<string, number>();
  const candidateIndices: number[] = [];
  for (let index = 0; index < baked.polygons.length; index += 1) {
    const before = source.polygons[index];
    const after = baked.polygons[index];
    if (!before || !after || before === after || !after.color) continue;
    if (!hasTexturePaint(before) || hasTexturePaint(after)) continue;
    const key = colorKey(after.color);
    candidateIndices.push(index);
    candidateColors.set(key, (candidateColors.get(key) ?? 0) + 1);
  }

  if (candidateColors.size < 2) return baked;
  const remap = buildColorMergeMap(candidateColors, distance);
  let changed = false;
  const polygons = baked.polygons.slice();
  for (const index of candidateIndices) {
    const polygon = polygons[index]!;
    const sourceColor = colorKey(polygon.color!);
    const nextColor = remap.get(sourceColor) ?? sourceColor;
    if (nextColor === sourceColor) continue;
    polygons[index] = { ...polygon, color: nextColor };
    changed = true;
  }

  return changed ? { ...baked, polygons } : baked;
}
