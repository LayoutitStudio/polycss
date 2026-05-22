import { memo, useCallback } from "react";
import type React from "react";
import type { CSSProperties } from "react";
import type {
  TextureAtlasPlan,
  SolidPaintDefaults,
} from "@layoutit/polycss-core";
import {
  isFullRectSolid,
  cssBorderShapeForPlan,
  formatSolidQuadEntryMatrix,
  formatBorderShapeEntryMatrix,
} from "@layoutit/polycss-core";
import { isBorderShapeSupported } from "./detection";

// ---------------------------------------------------------------------------
// Brush-inline-style ordering helper (needed by TextureBorderShapePoly)
// ---------------------------------------------------------------------------

const BRUSH_INLINE_STYLE_ORDER = new Map([
  ["transform", 0],
  ["border-shape", 1],
  ["border-width", 2],
  ["width", 3],
  ["height", 4],
  ["color", 5],
]);

function orderBrushInlineStyle(el: HTMLElement): void {
  const current = el.getAttribute("style");
  if (!current) return;
  const declarations = current.split(";").map((d) => d.trim()).filter(Boolean);
  const next = declarations
    .map((declaration, index) => {
      const property = declaration.slice(0, declaration.indexOf(":")).trim().toLowerCase();
      return { declaration, index, order: BRUSH_INLINE_STYLE_ORDER.get(property) ?? Number.POSITIVE_INFINITY };
    })
    .sort((a, b) => a.order - b.order || a.index - b.index)
    .map(({ declaration }) => declaration)
    .join(";");
  if (next !== current) el.setAttribute("style", next);
}

export const TextureBorderShapePoly = memo(function TextureBorderShapePoly({
  entry,
  solidPaintDefaults,
  className,
  style: styleProp,
  domAttrs,
  domEventHandlers,
  pointerEvents = "auto",
  disabledStrategies,
}: {
  entry: TextureAtlasPlan;
  solidPaintDefaults?: SolidPaintDefaults;
  className?: string;
  style?: CSSProperties;
  domAttrs?: Record<string, unknown>;
  domEventHandlers?: React.DOMAttributes<Element>;
  pointerEvents?: "auto" | "none";
  disabledStrategies?: ReadonlySet<string>;
}) {
  const fullRect = !entry.texture && isFullRectSolid(entry);

  const bDisabled = disabledStrategies?.has("b") ?? false;
  const useIForFullRect = bDisabled && isBorderShapeSupported();
  const borderShape = (!fullRect || useIForFullRect) ? cssBorderShapeForPlan(entry) : null;
  const useDefaultPaint = entry.shadedColor === solidPaintDefaults?.paintColor;
  const setElementRef = useCallback((el: HTMLElement | null) => {
    if (!el) return;
    if (borderShape) el.style.setProperty("border-shape", borderShape);
    else el.style.removeProperty("border-shape");
    orderBrushInlineStyle(el);
  }, [borderShape]);
  // formatBorderShapeEntryMatrix / formatSolidQuadEntryMatrix already return a
  // wrapped `matrix3d(...)` string. Wrapping again via formatMatrix3d would
  // produce `matrix3d(matrix3d(...))` — invalid CSS, silently dropped by the
  // browser, leaving the leaf with no transform.
  const transform = borderShape ? formatBorderShapeEntryMatrix(entry) : formatSolidQuadEntryMatrix(entry);
  const style: CSSProperties = {
    transform,
    color: useDefaultPaint ? undefined : entry.shadedColor,
    pointerEvents: pointerEvents === "none" ? "none" : undefined,
    ...styleProp,
  };

  const dataAttrs = entry.polygon.data
    ? Object.fromEntries(
        Object.entries(entry.polygon.data).map(([k, v]) => [`data-${k}`, String(v)]),
      )
    : {};
  const elementClassName = className?.trim() || undefined;

  if (fullRect && !useIForFullRect) {
    return (
      <b
        className={elementClassName}
        style={style}
        {...domEventHandlers}
        {...dataAttrs}
        {...domAttrs}
      />
    );
  }

  return (
    <i
      ref={setElementRef}
      className={elementClassName}
      style={style}
      {...domEventHandlers}
      {...dataAttrs}
      {...domAttrs}
    />
  );
});
