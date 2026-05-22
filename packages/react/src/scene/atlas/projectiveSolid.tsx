import type React from "react";
import type { CSSProperties } from "react";
import type {
  TextureAtlasPlan,
  PolyTextureLightingMode,
  SolidPaintDefaults,
} from "@layoutit/polycss-core";
import { parseHex, rgbKey } from "./solidTriangleStyle";

export function TextureProjectiveSolidPoly({
  entry,
  textureLighting,
  solidPaintDefaults,
  className,
  style: styleProp,
  domAttrs,
  domEventHandlers,
  pointerEvents = "auto",
}: {
  entry: TextureAtlasPlan & { projectiveMatrix: string };
  textureLighting: PolyTextureLightingMode;
  solidPaintDefaults?: SolidPaintDefaults;
  className?: string;
  style?: CSSProperties;
  domAttrs?: Record<string, unknown>;
  domEventHandlers?: React.DOMAttributes<Element>;
  pointerEvents?: "auto" | "none";
}) {
  const dynamic = textureLighting === "dynamic";
  const base = parseHex(entry.polygon.color ?? "#cccccc");
  const useDefaultDynamicColor = dynamic && rgbKey(base) === solidPaintDefaults?.dynamicColorKey;
  const style: CSSProperties = {
    // Emit projectiveMatrix verbatim — it's already formatted with 6-decimal
    // precision by computeTextureAtlasPlan. Re-rounding via formatMatrix3d
    // would drop it to 3 decimals and leave visible seam gaps between
    // adjacent projective quads at zoom-out (matches vanilla scene.add).
    transform: `matrix3d(${entry.projectiveMatrix})`,
    color: dynamic || entry.shadedColor === solidPaintDefaults?.paintColor
      ? undefined
      : entry.shadedColor,
    pointerEvents: pointerEvents === "none" ? "none" : undefined,
    ...(dynamic && !useDefaultDynamicColor
      ? {
          ["--pnx" as string]: entry.normal[0].toFixed(4),
          ["--pny" as string]: entry.normal[1].toFixed(4),
          ["--pnz" as string]: entry.normal[2].toFixed(4),
          ["--psr" as string]: (base.r / 255).toFixed(4),
          ["--psg" as string]: (base.g / 255).toFixed(4),
          ["--psb" as string]: (base.b / 255).toFixed(4),
        }
      : dynamic
        ? {
            ["--pnx" as string]: entry.normal[0].toFixed(4),
            ["--pny" as string]: entry.normal[1].toFixed(4),
            ["--pnz" as string]: entry.normal[2].toFixed(4),
          }
        : null),
    ...styleProp,
  };

  const dataAttrs = entry.polygon.data
    ? Object.fromEntries(
        Object.entries(entry.polygon.data).map(([k, v]) => [`data-${k}`, String(v)]),
      )
    : {};
  const elementClassName = className?.trim() || undefined;

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
