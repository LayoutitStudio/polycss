import { h, type VNode } from "vue";
import type {
  TextureAtlasPlan,
  CornerShapeGeometry,
  PolyTextureLightingMode,
  SolidPaintDefaults,
} from "@layoutit/polycss-core";
import {
  formatCornerShapeElementStyle,
  parseHex,
  rgbKey,
} from "@layoutit/polycss-core";

// Same as React's CornerShapeSolidPoly paint-only transcription.
function formatPaintCss(
  entry: TextureAtlasPlan,
  textureLighting: PolyTextureLightingMode,
  solidPaintDefaults: SolidPaintDefaults | undefined,
): string {
  if (textureLighting === "dynamic") {
    const base = parseHex(entry.polygon.color ?? "#cccccc");
    let style =
      `;--pnx:${entry.normal[0].toFixed(4)}` +
      `;--pny:${entry.normal[1].toFixed(4)}` +
      `;--pnz:${entry.normal[2].toFixed(4)}`;
    if (rgbKey(base) !== solidPaintDefaults?.dynamicColorKey) {
      style +=
        `;--psr:${(base.r / 255).toFixed(4)}` +
        `;--psg:${(base.g / 255).toFixed(4)}` +
        `;--psb:${(base.b / 255).toFixed(4)}`;
    }
    return style;
  }
  return entry.shadedColor && entry.shadedColor !== solidPaintDefaults?.paintColor
    ? `;color:${entry.shadedColor}`
    : "";
}

/**
 * Renders a non-rect non-triangle solid polygon as a `<u>` leaf with CSS
 * `corner-*-shape: bevel`. Mirrors vanilla's `createCornerShapeSolidElement`
 * and React's `TextureCornerShapeSolidPoly`. Without this, multi-vertex
 * polygons (e.g. 12-vertex tower caps) fall through to the atlas bitmap
 * path and drift from vanilla in dynamic mode.
 */
export function renderTextureCornerShapeSolidPoly({
  entry,
  geometry,
  textureLighting,
  solidPaintDefaults,
  className,
  pointerEvents = "auto",
}: {
  entry: TextureAtlasPlan;
  geometry: CornerShapeGeometry;
  textureLighting: PolyTextureLightingMode;
  solidPaintDefaults?: SolidPaintDefaults;
  className?: string;
  pointerEvents?: "auto" | "none";
}): VNode {
  const cornerShapeCss = formatCornerShapeElementStyle(entry, geometry);
  const paintCss = formatPaintCss(entry, textureLighting, solidPaintDefaults);
  const pointerCss = pointerEvents === "none" ? ";pointer-events:none" : "";
  const fullCss = cornerShapeCss + paintCss + pointerCss;

  const apply = (el: unknown): void => {
    if (!el || !(el instanceof HTMLElement)) return;
    // Mirror vanilla createCornerShapeSolidElement: concatenate cornerShape
    // geometry CSS with paint CSS and apply as a single setAttribute.
    el.setAttribute("style", fullCss);
  };

  const dataAttrs = entry.polygon.data
    ? Object.fromEntries(
        Object.entries(entry.polygon.data).map(([k, v]) => [`data-${k}`, String(v)]),
      )
    : {};

  return h("u", {
    class: className?.trim() || undefined,
    "data-poly-index": String(entry.index),
    ...dataAttrs,
    onVnodeMounted: ({ el }) => apply(el),
    onVnodeUpdated: ({ el }) => apply(el),
  });
}
