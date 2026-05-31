/**
 * Lighting CSS-variable helpers extracted from createPolyScene.ts.
 *
 * These functions translate scene-level lighting state into the CSS custom
 * properties that the engine's shading + shadow-projection cascade in
 * `styles.ts` resolves at paint time. They are stateless — callers pass the
 * target element + scene options, and the function reads/writes only those.
 *
 * The "baked solid lighting preview" helpers are part of the slider-drag UX:
 * baked-solid leaves normally carry an inline `color` set at bake time; while
 * the user is dragging a light slider, we point each leaf's `color` at a
 * cascade expression so the visible color follows `--plx/y/z/--plr/g/b/...`
 * live. On commit, the bake re-runs and the cascade is torn down.
 */
import { parseHex, parseHexColor, parsePureColor } from "@layoutit/polycss-core";
import type { Polygon, Vec3 } from "@layoutit/polycss-core";
import {
  applySolidPaint,
} from "../../render/atlas/paintDefaults";
import { shadedSolidPlanForNormal } from "../../render/atlas/emit";
import type {
  RenderedPoly,
  SolidPaintDefaults,
} from "../../render/textureAtlas";
import { worldDirectionToCss, worldDirectionalLightToCss } from "./transforms";
import type { PolySceneOptions } from "./types";

/** Every CSS variable the lighting cascade reads. Clearing them all when
 *  switching out of dynamic mode prevents stale values from bleeding into
 *  baked-mode paints. */
export const LIGHTING_VAR_NAMES = [
  "--plx", "--ply", "--plz",
  "--plr", "--plg", "--plb", "--pli",
  "--par", "--pag", "--pab", "--pai",
  "--clx", "--cly", "--clz",
] as const;

/** Toggle CSS var (set on `.polycss-scene`) — 1 means "the slider-drag baked
 *  lighting preview is active". Each leaf's color uses a calc that mixes the
 *  baked color with the live preview color via this factor; the toggle lets
 *  us swap between baked and preview without recomputing every leaf's
 *  paint string. */
export const BAKED_SOLID_PREVIEW_ACTIVE_VAR = "--polycss-light-preview-active";
export const BAKED_SOLID_PREVIEW_ACTIVE = `var(${BAKED_SOLID_PREVIEW_ACTIVE_VAR}, 0)`;
export const BAKED_SOLID_PREVIEW_LAMBERT =
  "max(0, calc(var(--pnx, 0) * var(--plx, 0) + var(--pny, 0) * var(--ply, 0) + var(--pnz, 1) * var(--plz, 1)))";
export const BAKED_SOLID_PREVIEW_R =
  "calc(255 * var(--psr, 1) * (var(--par, 1) * var(--pai, 0.4) + var(--plr, 1) * var(--pli, 1) * var(--plam, 0)))";
export const BAKED_SOLID_PREVIEW_G =
  "calc(255 * var(--psg, 1) * (var(--pag, 1) * var(--pai, 0.4) + var(--plg, 1) * var(--pli, 1) * var(--plam, 0)))";
export const BAKED_SOLID_PREVIEW_B =
  "calc(255 * var(--psb, 1) * (var(--pab, 1) * var(--pai, 0.4) + var(--plb, 1) * var(--pli, 1) * var(--plam, 0)))";

/** Set a CSS custom property only if the new value differs from the current
 *  one. Returns true when a write actually happened. Used so the cascade
 *  doesn't churn on no-op updates during slider drag. */
export function setStylePropertyIfChanged(el: HTMLElement, name: string, value: string): boolean {
  if (el.style.getPropertyValue(name) === value) return false;
  el.style.setProperty(name, value);
  return true;
}

/** Remove every lighting CSS variable. Called when textureLighting flips out
 *  of dynamic mode so stale variables don't influence the baked path. */
export function clearLightingVars(el: HTMLElement): void {
  for (const v of LIGHTING_VAR_NAMES) {
    if (el.style.getPropertyValue(v)) el.style.removeProperty(v);
  }
}

/**
 * Set the full lighting CSS variable family on `el` from `opts`. The light
 * direction is converted to CSS frame; ambient/directional colors are
 * normalised per-channel (0..1). `--clz` (shadow-projection up-axis) is
 * clamped away from zero so a near-horizontal light doesn't divide by zero
 * inside the shadow projection matrix.
 */
export function applyLightingVars(el: HTMLElement, opts: Omit<PolySceneOptions, "camera">): void {
  const userDir = opts.directionalLight?.direction ?? [0.4, -0.7, 0.59];
  const dir = worldDirectionToCss(userDir as Vec3);
  const len = Math.hypot(dir[0], dir[1], dir[2]) || 1;
  const lx = dir[0] / len, ly = dir[1] / len, lz = dir[2] / len;
  const lightRgb = parseHexColor(opts.directionalLight?.color ?? "#ffffff")?.rgb ?? [255, 255, 255];
  const ambRgb = parseHexColor(opts.ambientLight?.color ?? "#ffffff")?.rgb ?? [255, 255, 255];
  const lightIntensity = opts.directionalLight?.intensity ?? 1;
  const ambientIntensity = opts.ambientLight?.intensity ?? 0.4;
  const ch = (n: number) => (n / 255).toFixed(4);
  setStylePropertyIfChanged(el, "--plx", lx.toFixed(4));
  setStylePropertyIfChanged(el, "--ply", ly.toFixed(4));
  setStylePropertyIfChanged(el, "--plz", lz.toFixed(4));
  setStylePropertyIfChanged(el, "--plr", ch(lightRgb[0]));
  setStylePropertyIfChanged(el, "--plg", ch(lightRgb[1]));
  setStylePropertyIfChanged(el, "--plb", ch(lightRgb[2]));
  setStylePropertyIfChanged(el, "--pli", lightIntensity.toFixed(4));
  setStylePropertyIfChanged(el, "--par", ch(ambRgb[0]));
  setStylePropertyIfChanged(el, "--pag", ch(ambRgb[1]));
  setStylePropertyIfChanged(el, "--pab", ch(ambRgb[2]));
  setStylePropertyIfChanged(el, "--pai", ambientIntensity.toFixed(4));
  // Clamp clz: shadow projection divides by clz (up-axis), so a near-
  // horizontal light would project shadows to infinity.
  const rawClz = lz;
  const clz = Math.sign(rawClz || 1) * Math.max(Math.abs(rawClz), 0.01);
  setStylePropertyIfChanged(el, "--clx", lx.toFixed(4));
  setStylePropertyIfChanged(el, "--cly", ly.toFixed(4));
  setStylePropertyIfChanged(el, "--clz", clz.toFixed(4));
}

/** Apply lighting vars only when in dynamic mode; clear them otherwise. Also
 *  sets the `data-polycss-lighting` attribute so cascade rules can branch on
 *  the current mode. */
export function applyDynamicLightVars(el: HTMLElement, opts: Omit<PolySceneOptions, "camera">): void {
  const dynamic = opts.textureLighting === "dynamic";
  el.dataset.polycssLighting = opts.textureLighting ?? "baked";
  if (!dynamic) {
    clearLightingVars(el);
    return;
  }
  applyLightingVars(el, opts);
}

/**
 * Write the per-leaf solid paint vars: the source color (`--polycss-paint`),
 * and the per-channel dynamic-mode RGB (`--psr/g/b`) used by the cascade.
 * Clears each var when its slot in `defaults` is empty so leaves don't
 * stay stuck on previously-applied values.
 */
export function applySolidPaintVars(wrapper: HTMLDivElement, defaults: SolidPaintDefaults): void {
  if (defaults.paintColor) {
    wrapper.style.setProperty("--polycss-paint", defaults.paintColor);
  } else if (wrapper.style.getPropertyValue("--polycss-paint")) {
    wrapper.style.removeProperty("--polycss-paint");
  }
  if (defaults.dynamicColor) {
    wrapper.style.setProperty("--psr", (defaults.dynamicColor.r / 255).toFixed(4));
    wrapper.style.setProperty("--psg", (defaults.dynamicColor.g / 255).toFixed(4));
    wrapper.style.setProperty("--psb", (defaults.dynamicColor.b / 255).toFixed(4));
  } else if (
    wrapper.style.getPropertyValue("--psr") ||
    wrapper.style.getPropertyValue("--psg") ||
    wrapper.style.getPropertyValue("--psb")
  ) {
    wrapper.style.removeProperty("--psr");
    wrapper.style.removeProperty("--psg");
    wrapper.style.removeProperty("--psb");
  }
}

/** Write the per-leaf `--psr/g/b` dynamic-mode RGB from a CSS color string. */
export function applyDynamicColorVars(el: HTMLElement, color: string | undefined): void {
  const rgb = parseHex(color ?? "#cccccc");
  el.style.setProperty("--psr", (rgb.r / 255).toFixed(4));
  el.style.setProperty("--psg", (rgb.g / 255).toFixed(4));
  el.style.setProperty("--psb", (rgb.b / 255).toFixed(4));
}

/**
 * Re-bake the inline `color` of a solid leaf using the given scene options
 * (used after a light change or `setOptions`). Returns true when the leaf
 * was a solid that we re-painted, false when it's an atlas leaf and the
 * caller should fall through to the texture path.
 */
export function applyBakedSolidColor(
  item: RenderedPoly,
  polygon: Polygon,
  options: Omit<PolySceneOptions, "camera">,
): boolean {
  if (!item.plan || item.kind === "atlas" || item.plan.texture) return false;
  const textureLighting = options.textureLighting ?? "baked";
  const renderOptions = {
    directionalLight: worldDirectionalLightToCss(options.directionalLight),
    ambientLight: options.ambientLight,
    textureLighting,
    textureQuality: options.textureQuality,
    seamBleed: options.seamBleed,
    strategies: options.strategies,
  };
  const shaded = shadedSolidPlanForNormal(
    item.plan,
    polygon,
    item.plan.normal,
    textureLighting,
    renderOptions,
  );
  applySolidPaint(item.element, shaded, textureLighting);
  if (textureLighting === "baked") clearBakedSolidPreviewPaintVars(item.element);
  return true;
}

/** Build the preview-mode `color` string for a baked-solid leaf. The string
 *  mixes the original baked color with the live cascade expression via the
 *  `BAKED_SOLID_PREVIEW_ACTIVE` toggle, so switching between baked and
 *  preview just flips one scene-root variable. */
export function bakedSolidPreviewPaintColor(bakedColor: string): string {
  const parsed = parsePureColor(bakedColor) ?? { rgb: [255, 255, 255] as [number, number, number], alpha: 1 };
  const [r, g, b] = parsed.rgb;
  const mix = (baked: number, previewVar: string) =>
    `calc(${baked} * (1 - ${BAKED_SOLID_PREVIEW_ACTIVE}) + var(${previewVar}, ${baked}) * ${BAKED_SOLID_PREVIEW_ACTIVE})`;
  const alpha = parsed.alpha < 1 ? ` / ${parsed.alpha}` : "";
  return `rgb(${mix(r, "--polycss-preview-r")} ${mix(g, "--polycss-preview-g")} ${mix(b, "--polycss-preview-b")}${alpha})`;
}

/**
 * Install the live preview cascade on a single baked-solid leaf: sets the
 * normal vars (`--pnx/y/z`), source color vars (`--psr/g/b`), per-channel
 * preview expressions, and rewrites the leaf's `--polycss-paint` to the
 * mix expression from `bakedSolidPreviewPaintColor`. Returns true when any
 * style mutation occurred. Atlas/textured leaves bail out (only baked solids
 * use this path).
 */
export function applyBakedSolidPreviewPaint(
  item: RenderedPoly,
  polygon: Polygon,
  bakedColor: string,
): boolean {
  if (!item.plan || item.kind === "atlas" || item.plan.texture) return false;
  const el = item.element;
  const normal = item.plan.normal;
  const rgb = parseHex(polygon.color ?? "#cccccc");
  let changed = false;
  changed = setStylePropertyIfChanged(el, "--pnx", normal[0].toFixed(4)) || changed;
  changed = setStylePropertyIfChanged(el, "--pny", normal[1].toFixed(4)) || changed;
  changed = setStylePropertyIfChanged(el, "--pnz", normal[2].toFixed(4)) || changed;
  changed = setStylePropertyIfChanged(el, "--psr", (rgb.r / 255).toFixed(4)) || changed;
  changed = setStylePropertyIfChanged(el, "--psg", (rgb.g / 255).toFixed(4)) || changed;
  changed = setStylePropertyIfChanged(el, "--psb", (rgb.b / 255).toFixed(4)) || changed;
  changed = setStylePropertyIfChanged(el, "--plam", BAKED_SOLID_PREVIEW_LAMBERT) || changed;
  changed = setStylePropertyIfChanged(el, "--polycss-preview-r", BAKED_SOLID_PREVIEW_R) || changed;
  changed = setStylePropertyIfChanged(el, "--polycss-preview-g", BAKED_SOLID_PREVIEW_G) || changed;
  changed = setStylePropertyIfChanged(el, "--polycss-preview-b", BAKED_SOLID_PREVIEW_B) || changed;
  changed = setStylePropertyIfChanged(el, "--polycss-paint", bakedSolidPreviewPaintColor(bakedColor)) || changed;
  if (el.style.getPropertyValue("color")) {
    el.style.removeProperty("color");
    changed = true;
  }
  return changed;
}

/** Drop every CSS var installed by `applyBakedSolidPreviewPaint`. Called on
 *  preview teardown when the baked color is committed back to the leaf's
 *  inline `color`. */
export function clearBakedSolidPreviewPaintVars(el: HTMLElement): void {
  el.style.removeProperty("--pnx");
  el.style.removeProperty("--pny");
  el.style.removeProperty("--pnz");
  el.style.removeProperty("--psr");
  el.style.removeProperty("--psg");
  el.style.removeProperty("--psb");
  el.style.removeProperty("--plam");
  el.style.removeProperty("--polycss-preview-r");
  el.style.removeProperty("--polycss-preview-g");
  el.style.removeProperty("--polycss-preview-b");
  el.style.removeProperty("--polycss-paint");
}
