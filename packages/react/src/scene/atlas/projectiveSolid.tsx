import { memo } from "react";
import type React from "react";
import type { CSSProperties } from "react";
import type {
  TextureAtlasPlan,
  PolyTextureLightingMode,
  SolidPaintDefaults,
} from "@layoutit/polycss-core";
import { parseHex, rgbKey } from "@layoutit/polycss-core";

export const TextureProjectiveSolidPoly = memo(function TextureProjectiveSolidPoly({
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
    // Baked: always emit per-leaf shaded color (vanilla commit 0423777).
    color: dynamic ? undefined : entry.shadedColor,
    pointerEvents: pointerEvents === "none" ? "none" : undefined,
    // Dynamic mode always needs the surface normal — the @property initial
    // value is (0,0,1), so a leaf that skipped these vars would be lit as if
    // facing +Z. Only the base-color vars may fall back to the scene-level
    // dominant dynamic color.
    ...(dynamic
      ? {
          ["--pnx" as string]: entry.normal[0].toFixed(4),
          ["--pny" as string]: entry.normal[1].toFixed(4),
          ["--pnz" as string]: entry.normal[2].toFixed(4),
          ...(useDefaultDynamicColor ? null : {
            ["--psr" as string]: (base.r / 255).toFixed(4),
            ["--psg" as string]: (base.g / 255).toFixed(4),
            ["--psb" as string]: (base.b / 255).toFixed(4),
          }),
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
      data-poly-index={entry.index}
      {...domEventHandlers}
      {...dataAttrs}
      {...domAttrs}
    />
  );
});
