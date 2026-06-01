import { memo, useCallback } from "react";
import type React from "react";
import type { CSSProperties } from "react";
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

// Vanilla emit.ts uses formatInitialSolidPaintStyle to append paint-only CSS
// (color in baked, --pn*/--ps* vars in dynamic) AFTER the cornerShape
// geometry string. solidTriangleStyle would inject its own `transform: matrix3d`
// which clobbers the cornerShape geometry transform, so cornerShape can't
// reuse it. This is a transcription of formatInitialSolidPaintStyle for the
// renderer-owned glue boundary.
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
 * Renders a non-rect non-triangle solid polygon as a `<u>` leaf with
 * CSS `corner-*-shape: bevel` applied via the cornerShape geometry. Mirrors
 * vanilla's `createCornerShapeSolidElement`. Without this component, multi-
 * vertex polygons (e.g. 12-vertex tower caps) would fall through to the
 * atlas bitmap path and produce light-baked pixels that drift from the
 * runtime CSS lambert in dynamic mode.
 */
export const TextureCornerShapeSolidPoly = memo(function TextureCornerShapeSolidPoly({
  entry,
  geometry,
  textureLighting,
  solidPaintDefaults,
  className,
  style: styleProp,
  domAttrs,
  domEventHandlers,
  pointerEvents = "auto",
}: {
  entry: TextureAtlasPlan;
  geometry: CornerShapeGeometry;
  textureLighting: PolyTextureLightingMode;
  solidPaintDefaults?: SolidPaintDefaults;
  className?: string;
  style?: CSSProperties;
  domAttrs?: Record<string, unknown>;
  domEventHandlers?: React.DOMAttributes<Element>;
  pointerEvents?: "auto" | "none";
}) {
  // Mirror vanilla createCornerShapeSolidElement: concatenate the cornerShape
  // geometry CSS (transform + width/height + corner-shape props) with the
  // paint CSS (color in baked, --pn*/--ps* vars in dynamic) and apply as a
  // single setAttribute("style", ...). Earlier React used solidTriangleStyle
  // which injected `transform: matrix3d(...)` for a TRIANGLE primitive,
  // clobbering the cornerShape geometry transform with a triangle one and
  // visually mirroring/transposing the leaf.
  const cornerShapeCss = formatCornerShapeElementStyle(entry, geometry);
  const paintCss = formatPaintCss(entry, textureLighting, solidPaintDefaults);
  const pointerCss = pointerEvents === "none" ? ";pointer-events:none" : "";
  const fullCss = cornerShapeCss + paintCss + pointerCss;
  const setRef = useCallback((el: HTMLElement | null) => {
    if (!el) return;
    el.setAttribute("style", fullCss);
    if (styleProp) {
      for (const [k, v] of Object.entries(styleProp)) {
        if (v === undefined || v === null) continue;
        if (k.startsWith("--")) el.style.setProperty(k, String(v));
        else (el.style as unknown as Record<string, string>)[k] = String(v);
      }
    }
  }, [fullCss, styleProp]);

  const dataAttrs = entry.polygon.data
    ? Object.fromEntries(
        Object.entries(entry.polygon.data).map(([k, v]) => [`data-${k}`, String(v)]),
      )
    : {};
  const elementClassName = className?.trim() || undefined;

  return (
    <u
      ref={setRef}
      className={elementClassName}
      data-poly-index={entry.index}
      {...domEventHandlers}
      {...dataAttrs}
      {...domAttrs}
    />
  );
});
