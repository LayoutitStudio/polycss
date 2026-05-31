import { memo } from "react";
import type React from "react";
import type { CSSProperties } from "react";
import type {
  PackedTextureAtlasEntry,
  TextureAtlasPage,
  PolyTextureLightingMode,
  SolidPaintDefaults,
} from "@layoutit/polycss-core";
import { formatMatrix3d, formatCssLengthPx } from "@layoutit/polycss-core";

export const TextureAtlasPoly = memo(function TextureAtlasPoly({
  entry,
  page,
  textureLighting,
  solidPaintDefaults: _solidPaintDefaults,
  className,
  style: styleProp,
  domAttrs,
  domEventHandlers,
  pointerEvents = "auto",
}: {
  entry: PackedTextureAtlasEntry;
  page: TextureAtlasPage | undefined;
  textureLighting: PolyTextureLightingMode;
  solidPaintDefaults?: SolidPaintDefaults;
  className?: string;
  style?: CSSProperties;
  domAttrs?: Record<string, unknown>;
  domEventHandlers?: React.DOMAttributes<Element>;
  pointerEvents?: "auto" | "none";
}) {
  const ATLAS_CANONICAL_SIZE_EXPLICIT = 64;
  const dynamic = textureLighting === "dynamic";
  const atlasCanonicalSize = entry.atlasCanonicalSize ?? ATLAS_CANONICAL_SIZE_EXPLICIT;
  const atlasWidth = entry.canvasW || 1;
  const atlasHeight = entry.canvasH || 1;
  const atlasPosition = page
    ? `${formatCssLengthPx((-entry.x / atlasWidth) * atlasCanonicalSize)} ${formatCssLengthPx((-entry.y / atlasHeight) * atlasCanonicalSize)}`
    : undefined;
  const atlasSize = page
    ? `${formatCssLengthPx((page.width / atlasWidth) * atlasCanonicalSize)} ${formatCssLengthPx((page.height / atlasHeight) * atlasCanonicalSize)}`
    : undefined;

  const dynamicMask = dynamic && page?.url ? `url(${page.url})` : undefined;
  const background = !dynamic && page?.url
    ? `url(${page.url}) ${atlasPosition} / ${atlasSize} no-repeat`
    : undefined;

  const style: CSSProperties = {
    transform: formatMatrix3d(entry.atlasMatrix),
    ["--polycss-atlas-size" as string]: `${atlasCanonicalSize}px`,
    // Listing the `background` shorthand alongside the `background-*` longhands
    // in one inline style object makes React warn on every update (mixing
    // shorthand and non-shorthand for the same property). Branch so only the
    // current mode's keys are assigned — baked gets `background`, dynamic gets
    // the longhands.
    ...(dynamic
      ? {
          backgroundImage: page?.url ? `url(${page.url})` : undefined,
          backgroundPosition: atlasPosition,
          backgroundSize: atlasSize,
        }
      : { background }),
    ...(dynamic
      ? {
          ["--pnx" as string]: entry.normal[0].toFixed(4),
          ["--pny" as string]: entry.normal[1].toFixed(4),
          ["--pnz" as string]: entry.normal[2].toFixed(4),
        }
      : null),
    ...(dynamic && dynamicMask
      ? {
          maskImage: dynamicMask,
          maskMode: "alpha" as const,
          maskPosition: atlasPosition,
          maskSize: atlasSize,
          maskRepeat: "no-repeat" as const,
          WebkitMaskImage: dynamicMask,
          WebkitMaskPosition: atlasPosition,
          WebkitMaskSize: atlasSize,
          WebkitMaskRepeat: "no-repeat" as const,
        }
      : null),
    opacity: page?.url ? undefined : 0,
    pointerEvents: pointerEvents === "none" ? "none" : undefined,
    ...styleProp,
  };

  const dataAttrs = entry.polygon.data
    ? Object.fromEntries(
        Object.entries(entry.polygon.data).map(([k, v]) => [`data-${k}`, String(v)]),
      )
    : {};
  const elementClassName = className?.trim() || undefined;

  return (
    <s
      className={elementClassName}
      style={style}
      {...domEventHandlers}
      {...dataAttrs}
      {...domAttrs}
    />
  );
});
