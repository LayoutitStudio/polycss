import { memo, useCallback } from "react";
import type React from "react";
import type { CSSProperties } from "react";
import type {
  TextureAtlasPlan,
  CornerShapeGeometry,
  PolyTextureLightingMode,
  SolidPaintDefaults,
} from "@layoutit/polycss-core";
import { formatCornerShapeElementStyle } from "@layoutit/polycss-core";
import { solidTriangleStyle } from "./solidTriangleStyle";

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
  // Vanilla applies the cornerShape style string via setAttribute("style",...).
  // React can't pass a raw style string through the JSX `style` prop, so we
  // use a ref callback to setAttribute on mount/update. The paint side
  // (color, lambert vars) is computed via solidTriangleStyle and merged on
  // top of the cornerShape geometry CSS — same property ordering as vanilla.
  const paintStyle = solidTriangleStyle(entry, textureLighting, pointerEvents, solidPaintDefaults);
  const cornerShapeCss = formatCornerShapeElementStyle(entry, geometry);
  const setRef = useCallback((el: HTMLElement | null) => {
    if (!el) return;
    // Stamp the cornerShape geometry CSS as a single setAttribute call,
    // then layer the paint properties on top via individual style sets.
    el.setAttribute("style", cornerShapeCss);
    if (paintStyle) {
      for (const [k, v] of Object.entries(paintStyle)) {
        if (v === undefined || v === null) continue;
        if (k.startsWith("--")) el.style.setProperty(k, String(v));
        else (el.style as unknown as Record<string, string>)[k] = String(v);
      }
    }
    if (styleProp) {
      for (const [k, v] of Object.entries(styleProp)) {
        if (v === undefined || v === null) continue;
        if (k.startsWith("--")) el.style.setProperty(k, String(v));
        else (el.style as unknown as Record<string, string>)[k] = String(v);
      }
    }
  }, [cornerShapeCss, paintStyle, styleProp]);

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
