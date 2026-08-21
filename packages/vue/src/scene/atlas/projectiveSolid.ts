import { h } from "vue";
import type { CSSProperties, VNode } from "vue";
import type {
  TextureAtlasPlan,
  PolyTextureLightingMode,
  SolidPaintDefaults,
} from "@layoutit/polycss-core";
import { parseHex, rgbKey } from "@layoutit/polycss-core";

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
    // Baked: always emit per-leaf shaded color (vanilla commit 0423777).
    color: dynamic ? undefined : entry.shadedColor,
    pointerEvents: pointerEvents === "none" ? "none" : undefined,
    // Dynamic mode always needs the surface normal — the @property initial
    // value is (0,0,1), so a leaf that skipped these vars would be lit as if
    // facing +Z. Only the base-color vars may fall back to the scene-level
    // dominant dynamic color.
    ...(dynamic
      ? {
          "--pnx": entry.normal[0].toFixed(4),
          "--pny": entry.normal[1].toFixed(4),
          "--pnz": entry.normal[2].toFixed(4),
          ...(useDefaultDynamicColor ? null : {
            "--psr": (base.r / 255).toFixed(4),
            "--psg": (base.g / 255).toFixed(4),
            "--psb": (base.b / 255).toFixed(4),
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

  return h("b", {
    class: elementClassName,
    style,
    "data-poly-index": String(entry.index),
    ...dataAttrs,
    ...domAttrs,
  });
}
