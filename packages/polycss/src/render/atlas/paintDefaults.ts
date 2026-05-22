import {
  parseHex,
  rgbKey,
} from "@layoutit/polycss-core";
import type { PolyTextureLightingMode } from "@layoutit/polycss-core";
import type {
  TextureAtlasPlan,
  SolidPaintDefaults,
} from "@layoutit/polycss-core";

export function setInlineStyleProperty(el: HTMLElement, property: string, value: string): void {
  const current = el.getAttribute("style") ?? "";
  const declaration = `${property}:${value}`;
  const escaped = property.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`(^|;)\\s*${escaped}\\s*:[^;]*`, "i");
  const next = pattern.test(current)
    ? current.replace(pattern, (_match, prefix: string) => `${prefix}${declaration}`)
    : `${current}${current.trim() && !current.trim().endsWith(";") ? ";" : ""}${declaration}`;
  if (next !== current) el.setAttribute("style", next);
}

export function removeInlineStyleProperty(el: HTMLElement, property: string): void {
  const current = el.getAttribute("style") ?? "";
  if (!current) return;
  const escaped = property.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const matcher = new RegExp(`^\\s*${escaped}\\s*:`, "i");
  const next = current
    .split(";")
    .map((declaration) => declaration.trim())
    .filter((declaration) => declaration && !matcher.test(declaration))
    .join(";");
  if (next) el.setAttribute("style", next);
  else el.removeAttribute("style");
}

export function applyDynamicNormalVars(el: HTMLElement, entry: TextureAtlasPlan): void {
  // Dynamic mode: emit ONLY the per-polygon normal vars inline. The
  // calc-driven background-color + background-blend-mode multiply live
  // in the global stylesheet's
  // `.polycss-scene[data-polycss-lighting="dynamic"] i { ... }` rule, so
  // the per-element style stays tiny (~50 chars instead of ~600).
  setInlineStyleProperty(el, "--pnx", entry.normal[0].toFixed(4));
  setInlineStyleProperty(el, "--pny", entry.normal[1].toFixed(4));
  setInlineStyleProperty(el, "--pnz", entry.normal[2].toFixed(4));
}

export function applySolidPaint(
  el: HTMLElement,
  entry: TextureAtlasPlan,
  textureLighting: PolyTextureLightingMode,
  solidPaintDefaults?: SolidPaintDefaults,
): void {
  if (textureLighting === "dynamic") {
    removeInlineStyleProperty(el, "color");
    removeInlineStyleProperty(el, "background");
    applyDynamicNormalVars(el, entry);
    const base = parseHex(entry.polygon.color ?? "#cccccc");
    if (rgbKey(base) === solidPaintDefaults?.dynamicColorKey) {
      removeInlineStyleProperty(el, "--psr");
      removeInlineStyleProperty(el, "--psg");
      removeInlineStyleProperty(el, "--psb");
    } else {
      setInlineStyleProperty(el, "--psr", (base.r / 255).toFixed(4));
      setInlineStyleProperty(el, "--psg", (base.g / 255).toFixed(4));
      setInlineStyleProperty(el, "--psb", (base.b / 255).toFixed(4));
    }
  } else if (entry.shadedColor !== solidPaintDefaults?.paintColor) {
    removeInlineStyleProperty(el, "background");
    setInlineStyleProperty(el, "color", entry.shadedColor);
  } else {
    removeInlineStyleProperty(el, "background");
    removeInlineStyleProperty(el, "color");
  }
}
