import { parsePureColor } from "../color/color";
import { COLOR_PARSE_CACHE_MAX } from "./constants";
import type { RGB, RGBFactors } from "./types";

type PureColorParseResult = ReturnType<typeof parsePureColor>;

const PURE_COLOR_CACHE = new Map<string, PureColorParseResult>();

export function cachedParsePureColor(input: string): PureColorParseResult {
  if (PURE_COLOR_CACHE.has(input)) {
    const cached = PURE_COLOR_CACHE.get(input);
    return cached === undefined ? null : cached;
  }
  const parsed = parsePureColor(input);
  if (PURE_COLOR_CACHE.size >= COLOR_PARSE_CACHE_MAX) PURE_COLOR_CACHE.clear();
  PURE_COLOR_CACHE.set(input, parsed);
  return parsed;
}

export function parseHex(hex: string): RGB {
  // Tolerate any CSS color string the renderer hands us — hex, rgb(),
  // or rgba(). createTransformControls passes rgba() colors to fade
  // arrows on hover/drag.
  const parsed = cachedParsePureColor(hex);
  if (!parsed) return { r: 255, g: 255, b: 255 };
  return { r: parsed.rgb[0], g: parsed.rgb[1], b: parsed.rgb[2] };
}

export function rgbKey({ r, g, b }: RGB): string {
  return `${r},${g},${b}`;
}

/** Returns the parsed alpha for a color string (1.0 default). */
export function parseAlpha(input: string): number {
  return cachedParsePureColor(input)?.alpha ?? 1;
}

export function rgbToHex({ r, g, b }: RGB): string {
  const f = (n: number) =>
    Math.round(Math.max(0, Math.min(255, n))).toString(16).padStart(2, "0");
  return `#${f(r)}${f(g)}${f(b)}`;
}

export function textureTintFactors(
  directScale: number,
  lightColor: string,
  ambientColor: string,
  ambientIntensity: number,
): RGBFactors {
  const light = parseHex(lightColor);
  const amb = parseHex(ambientColor);
  return {
    r: (amb.r / 255) * ambientIntensity + (light.r / 255) * directScale,
    g: (amb.g / 255) * ambientIntensity + (light.g / 255) * directScale,
    b: (amb.b / 255) * ambientIntensity + (light.b / 255) * directScale,
  };
}

export function tintToCss({ r, g, b }: RGBFactors): string {
  const f = (n: number) => Math.round(Math.max(0, Math.min(1, n)) * 255);
  return `rgb(${f(r)} ${f(g)} ${f(b)})`;
}

export function shadePolygon(
  baseColor: string,
  directScale: number,
  lightColor: string,
  ambientColor: string,
  ambientIntensity: number,
): string {
  const base = parseHex(baseColor);
  const light = parseHex(lightColor);
  const amb = parseHex(ambientColor);
  const tintR = (amb.r / 255) * ambientIntensity + (light.r / 255) * directScale;
  const tintG = (amb.g / 255) * ambientIntensity + (light.g / 255) * directScale;
  const tintB = (amb.b / 255) * ambientIntensity + (light.b / 255) * directScale;
  const r = Math.max(0, Math.min(255, Math.round(base.r * tintR)));
  const g = Math.max(0, Math.min(255, Math.round(base.g * tintG)));
  const b = Math.max(0, Math.min(255, Math.round(base.b * tintB)));
  // Preserve the base polygon's alpha. Lighting only modulates RGB —
  // a translucent input (e.g. createTransformControls arrows at idle)
  // must keep its alpha so the gizmo stays see-through after shading.
  const alpha = parseAlpha(baseColor);
  return alpha < 1
    ? `rgba(${r}, ${g}, ${b}, ${alpha})`
    : rgbToHex({ r, g, b });
}

export function quantizeCssColor(input: string, steps: number): string {
  if (!Number.isFinite(steps) || steps <= 1) return input;
  const parsed = cachedParsePureColor(input);
  if (!parsed) return input;
  const channelStep = 255 / Math.max(1, Math.round(steps) - 1);
  const quantize = (value: number) =>
    Math.max(0, Math.min(255, Math.round(Math.round(value / channelStep) * channelStep)));
  const rgb = {
    r: quantize(parsed.rgb[0]),
    g: quantize(parsed.rgb[1]),
    b: quantize(parsed.rgb[2]),
  };
  return parsed.alpha < 1
    ? `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${parsed.alpha})`
    : rgbToHex(rgb);
}

export function rgbEqual(a: RGB | undefined, b: RGB | undefined): boolean {
  return !!a && !!b && a.r === b.r && a.g === b.g && a.b === b.b;
}

export function stepRgbToward(current: RGB, target: RGB, maxStep: number): RGB {
  const step = (from: number, to: number) => {
    const delta = to - from;
    if (Math.abs(delta) <= maxStep) return to;
    return from + Math.sign(delta) * maxStep;
  };
  return {
    r: step(current.r, target.r),
    g: step(current.g, target.g),
    b: step(current.b, target.b),
  };
}

export function rgbToCss(rgb: RGB, alpha = 1): string {
  return alpha < 1
    ? `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha})`
    : rgbToHex(rgb);
}

export function colorErrorScore(current: string | undefined, next: string): number {
  if (current === undefined) return Number.POSITIVE_INFINITY;
  if (current === next) return 0;
  const currentColor = cachedParsePureColor(current);
  const nextColor = cachedParsePureColor(next);
  if (!currentColor || !nextColor) return 1;
  const dr = currentColor.rgb[0] - nextColor.rgb[0];
  const dg = currentColor.rgb[1] - nextColor.rgb[1];
  const db = currentColor.rgb[2] - nextColor.rgb[2];
  const da = (currentColor.alpha - nextColor.alpha) * 255;
  return Math.sqrt(dr * dr + dg * dg + db * db + da * da) / 510;
}
