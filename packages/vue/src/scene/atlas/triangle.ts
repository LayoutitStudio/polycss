import { h } from "vue";
import type { CSSProperties, VNode } from "vue";
import type {
  TextureAtlasPlan,
  PolyTextureLightingMode,
  SolidPaintDefaults,
} from "@layoutit/polycss-core";
import { solidTriangleStyle } from "./solidTriangleStyle";

export function renderTextureTrianglePoly({
  entry,
  textureLighting,
  solidPaintDefaults,
  className,
  style: styleProp,
  domAttrs,
  pointerEvents = "auto",
}: {
  entry: TextureAtlasPlan;
  textureLighting: PolyTextureLightingMode;
  solidPaintDefaults?: SolidPaintDefaults;
  className?: string;
  style?: CSSProperties;
  domAttrs?: Record<string, unknown>;
  pointerEvents?: "auto" | "none";
}): VNode | null {
  const triangleStyle = solidTriangleStyle(entry, textureLighting, pointerEvents, solidPaintDefaults);
  if (!triangleStyle) return null;

  const dataAttrs = entry.polygon.data
    ? Object.fromEntries(
        Object.entries(entry.polygon.data).map(([k, v]) => [`data-${k}`, String(v)]),
      )
    : {};
  const elementClassName = className?.trim() || undefined;

  return h("u", {
    class: elementClassName,
    style: {
      ...triangleStyle,
      ...styleProp,
    },
    ...dataAttrs,
    ...domAttrs,
  });
}
