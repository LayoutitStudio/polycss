import { h } from "vue";
import type { CSSProperties, VNode } from "vue";
import type {
  TextureAtlasPlan,
  PolyTextureLightingMode,
  SolidPaintDefaults,
} from "@layoutit/polycss-core";
import { parseHex, rgbKey } from "./solidTriangleStyle";

export function renderTextureProjectiveSolidPoly({
  entry,
  textureLighting,
  solidPaintDefaults,
  className,
  style: styleProp,
  domAttrs,
  pointerEvents = "auto",
}: {
  entry: TextureAtlasPlan & { projectiveMatrix: string };
  textureLighting: PolyTextureLightingMode;
  solidPaintDefaults?: SolidPaintDefaults;
  className?: string;
  style?: CSSProperties;
  domAttrs?: Record<string, unknown>;
  pointerEvents?: "auto" | "none";
}): VNode {
  const dynamic = textureLighting === "dynamic";
  const base = parseHex(entry.polygon.color ?? "#cccccc");
  const useDefaultDynamicColor = dynamic && rgbKey(base) === solidPaintDefaults?.dynamicColorKey;
  const style: CSSProperties = {
    // Emit projectiveMatrix verbatim — already 6-decimal-formatted by
    // computeTextureAtlasPlan. Re-rounding would leave visible seams between
    // adjacent projective quads.
    transform: `matrix3d(${entry.projectiveMatrix})`,
    color: dynamic || entry.shadedColor === solidPaintDefaults?.paintColor
      ? undefined
      : entry.shadedColor,
    pointerEvents: pointerEvents === "none" ? "none" : undefined,
    ...(dynamic && !useDefaultDynamicColor
      ? {
          "--pnx": entry.normal[0].toFixed(4),
          "--pny": entry.normal[1].toFixed(4),
          "--pnz": entry.normal[2].toFixed(4),
          "--psr": (base.r / 255).toFixed(4),
          "--psg": (base.g / 255).toFixed(4),
          "--psb": (base.b / 255).toFixed(4),
        }
      : dynamic
        ? {
            "--pnx": entry.normal[0].toFixed(4),
            "--pny": entry.normal[1].toFixed(4),
            "--pnz": entry.normal[2].toFixed(4),
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

  return h("b", {
    class: elementClassName,
    style,
    "data-poly-index": String(entry.index),
    ...dataAttrs,
    ...domAttrs,
  });
}
