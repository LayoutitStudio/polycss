import { h, type VNode } from "vue";
import type {
  TextureAtlasPlan,
  CornerShapeGeometry,
  PolyTextureLightingMode,
  SolidPaintDefaults,
} from "@layoutit/polycss-core";
import { formatCornerShapeElementStyle } from "@layoutit/polycss-core";
import { solidTriangleStyle } from "./solidTriangleStyle";

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
  const paintStyle = solidTriangleStyle(entry, textureLighting, pointerEvents, solidPaintDefaults);

  const apply = (el: unknown): void => {
    if (!el || !(el instanceof HTMLElement)) return;
    // Vanilla stamps the cornerShape geometry CSS via setAttribute('style', ...)
    // — preserve exact ordering so output is byte-identical.
    el.setAttribute("style", cornerShapeCss);
    if (paintStyle) {
      for (const [k, v] of Object.entries(paintStyle)) {
        if (v === undefined || v === null) continue;
        if (k.startsWith("--")) el.style.setProperty(k, String(v));
        else (el.style as unknown as Record<string, string>)[k] = String(v);
      }
    }
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
