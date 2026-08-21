/* Shared lighting helpers for PolyCSS polygons.
 * Pure module — zero DOM dependencies.
 *
 * `computeShapeLighting(normal, baseColor, light?)` is a per-polygon Lambert
 * shader. Renderers may keep Lambert math inline for performance, but this
 * helper supports users who shade polygons outside the renderer, such as SSR,
 * validators, or alternate backends.
 */
import type { PolyAmbientLight, PolyDirectionalLight, Vec3 } from "../types";
import {
  type ParsedColor,
  parsePureColor,
  clampChannel,
  formatColor
} from "./color";
import { DEFAULT_LIGHT_DIR } from "../atlas/constants";

export type { ParsedColor };

const defaultColor: ParsedColor = { rgb: [204, 204, 204], alpha: 1 };
const colorCache = new Map<string, ParsedColor>();

export function parseColor(input: string): ParsedColor | null {
  if (!input) return null;
  const key = input.trim();
  const cached = colorCache.get(key);
  if (cached) return cached;

  const parsed = parsePureColor(key);
  if (parsed) {
    colorCache.set(key, parsed);
    return parsed;
  }

  return null;
}

/**
 * Lighten/darken a color by a flat per-channel delta. Used by the framework
 * wrappers for tinted-overlay debug renderers; per-polygon Lambert shading
 * goes through `computeShapeLighting` instead.
 */
export function shadeColor(base: string, delta: number): string {
  const parsed = parseColor(base) ?? defaultColor;
  const rgb: [number, number, number] = [
    clampChannel(parsed.rgb[0] + delta),
    clampChannel(parsed.rgb[1] + delta),
    clampChannel(parsed.rgb[2] + delta)
  ];
  return formatColor({ rgb, alpha: parsed.alpha });
}

// Default sun shared with the atlas pipeline (`DEFAULT_LIGHT_DIR`) so core
// has ONE default light direction everywhere.
const DEFAULT_DIRECTIONAL: Required<PolyDirectionalLight> = {
  direction: DEFAULT_LIGHT_DIR,
  color: "#ffffff",
  intensity: 1,
};

const DEFAULT_AMBIENT: Required<PolyAmbientLight> = {
  color: "#ffffff",
  intensity: 0.4,
};

function normalizeVec3(v: Vec3): Vec3 {
  const len = Math.hypot(v[0], v[1], v[2]);
  if (len < 1e-12) return [0, 0, 0];
  return [v[0] / len, v[1] / len, v[2] / len];
}

function tintChannel(base: number, tintHex: string, channel: 0 | 1 | 2): number {
  const tint = parseColor(tintHex) ?? defaultColor;
  // Per-channel multiply, normalized to 0..1, with the tint scaled into 0..1.
  return base * (tint.rgb[channel] / 255);
}

/**
 * Per-polygon Lambert shading. Given a polygon's outward normal and the
 * scene's lights, returns the shaded color as a CSS rgb string.
 *
 * Math (decoupled, three.js convention):
 *   tint = ambient.color · ambient.intensity
 *        + directional.color · directional.intensity · max(0, n · L)
 *   final = baseColor × tint
 *
 * Pass `directional` and/or `ambient` undefined to fall back to defaults
 * (white directional along the atlas pipeline's `DEFAULT_LIGHT_DIR` with
 * intensity 1, white ambient with intensity 0.4) — useful for static
 * SSR/validator renders.
 */
export function computeShapeLighting(
  normal: Vec3,
  baseColor: string,
  directional?: PolyDirectionalLight,
  ambient?: PolyAmbientLight,
): string {
  const base = parseColor(baseColor) ?? defaultColor;
  const dir = normalizeVec3(directional?.direction ?? DEFAULT_DIRECTIONAL.direction);
  const lightHex = directional?.color ?? DEFAULT_DIRECTIONAL.color;
  const lightIntensity = Math.max(0, directional?.intensity ?? DEFAULT_DIRECTIONAL.intensity);
  const ambientHex = ambient?.color ?? DEFAULT_AMBIENT.color;
  const ambientIntensity = Math.max(0, ambient?.intensity ?? DEFAULT_AMBIENT.intensity);

  const n = normalizeVec3(normal);
  const lambert = Math.max(0, n[0] * dir[0] + n[1] * dir[1] + n[2] * dir[2]);
  const directionalScale = lightIntensity * lambert;

  const out: [number, number, number] = [0, 0, 0];
  for (let c = 0 as 0 | 1 | 2; c < 3; c = (c + 1) as 0 | 1 | 2) {
    const baseC = base.rgb[c];
    const ambContrib = tintChannel(baseC, ambientHex, c) * ambientIntensity;
    const dirContrib = tintChannel(baseC, lightHex, c) * directionalScale;
    out[c] = clampChannel(ambContrib + dirContrib);
  }
  return formatColor({ rgb: out, alpha: base.alpha });
}
