import { memo } from "react";
import type React from "react";
import type { CSSProperties } from "react";
import type {
  TextureAtlasPlan,
  PolyTextureLightingMode,
  SolidPaintDefaults,
} from "@layoutit/polycss-core";
import { solidTriangleStyle } from "./solidTriangleStyle";

export const TextureTrianglePoly = memo(function TextureTrianglePoly({
  entry,
  textureLighting,
  solidPaintDefaults,
  className,
  style: styleProp,
  domAttrs,
  domEventHandlers,
  pointerEvents = "auto",
}: {
  entry: TextureAtlasPlan;
  textureLighting: PolyTextureLightingMode;
  solidPaintDefaults?: SolidPaintDefaults;
  className?: string;
  style?: CSSProperties;
  domAttrs?: Record<string, unknown>;
  domEventHandlers?: React.DOMAttributes<Element>;
  pointerEvents?: "auto" | "none";
}) {
  // Diagnostic
  {
    const diag = (typeof window !== "undefined" ? (window as Record<string, unknown>).__polycssDiag : null) as Record<string, number> | null;
    if (diag) diag.trianglePolyRender = (diag.trianglePolyRender ?? 0) + 1;
  }
  const triangleStyle = solidTriangleStyle(entry, textureLighting, pointerEvents, solidPaintDefaults);
  if (!triangleStyle) return null;

  const dataAttrs = entry.polygon.data
    ? Object.fromEntries(
        Object.entries(entry.polygon.data).map(([k, v]) => [`data-${k}`, String(v)]),
      )
    : {};
  const elementClassName = className?.trim() || undefined;

  return (
    <u
      className={elementClassName}
      style={{ ...triangleStyle, ...styleProp }}
      {...domEventHandlers}
      {...dataAttrs}
      {...domAttrs}
    />
  );
});
