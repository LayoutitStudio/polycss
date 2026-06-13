import { memo } from "react";
import type React from "react";
import type { CSSProperties } from "react";
import type {
  PackedTextureAtlasEntry,
  PolyTextureImageRendering,
  PolyTextureLeafGeometry,
  TextureAtlasPage,
  PolyTextureLightingMode,
  SolidPaintDefaults,
  TextureAtlasPlan,
} from "@layoutit/polycss-core";
import { formatMatrix3d, formatCssLengthPx, resolvePolyTextureImageRendering } from "@layoutit/polycss-core";

export const TextureAtlasPoly = memo(function TextureAtlasPoly({
  entry,
  page,
  textureLighting,
  textureImageRendering,
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
  textureImageRendering?: PolyTextureImageRendering;
  solidPaintDefaults?: SolidPaintDefaults;
  className?: string;
  style?: CSSProperties;
  domAttrs?: Record<string, unknown>;
  domEventHandlers?: React.DOMAttributes<Element>;
  pointerEvents?: "auto" | "none";
}) {
  const ATLAS_CANONICAL_SIZE_EXPLICIT = 64;
  const dynamic = textureLighting === "dynamic";
  const resolvedImageRendering = resolvePolyTextureImageRendering(entry.polygon, textureImageRendering);
  const atlasCanonicalSize = entry.atlasCanonicalSize ?? ATLAS_CANONICAL_SIZE_EXPLICIT;
  const atlasLeafWidth = entry.atlasLeafWidth ?? atlasCanonicalSize;
  const atlasLeafHeight = entry.atlasLeafHeight ?? atlasCanonicalSize;
  const atlasWidth = entry.canvasW || 1;
  const atlasHeight = entry.canvasH || 1;
  const atlasPosition = page
    ? `${formatCssLengthPx((-entry.x / atlasWidth) * atlasLeafWidth)} ${formatCssLengthPx((-entry.y / atlasHeight) * atlasLeafHeight)}`
    : undefined;
  const atlasSize = page
    ? `${formatCssLengthPx((page.width / atlasWidth) * atlasLeafWidth)} ${formatCssLengthPx((page.height / atlasHeight) * atlasLeafHeight)}`
    : undefined;

  const dynamicMask = dynamic && page?.url ? `url(${page.url})` : undefined;
  const style: CSSProperties = {
    transform: formatMatrix3d(entry.atlasMatrix),
    ["--polycss-atlas-size" as string]: `${atlasCanonicalSize}px`,
    ["--polycss-atlas-width" as string]: formatCssLengthPx(atlasLeafWidth),
    ["--polycss-atlas-height" as string]: formatCssLengthPx(atlasLeafHeight),
    ["--polycss-atlas-leaf-sizing" as string]: entry.atlasLeafSizing ?? "canonical",
    backgroundImage: page?.url ? `url(${page.url})` : undefined,
    backgroundPosition: atlasPosition,
    backgroundSize: atlasSize,
    backgroundRepeat: page?.url ? "no-repeat" : undefined,
    imageRendering: resolvedImageRendering === "pixelated" ? "pixelated" : undefined,
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
      data-poly-index={entry.index}
      data-polycss-leaf="polygon"
      data-polycss-texture-backend="atlas"
      data-polycss-texture-leaf-sizing={entry.atlasLeafSizing ?? "canonical"}
      data-polycss-texture-ready={page?.url ? "true" : "false"}
      data-polycss-texture-image-rendering={resolvedImageRendering}
      data-polycss-texture-projection="affine"
      data-polycss-texture-lighting={textureLighting}
      data-polycss-texture-leaf-width={atlasLeafWidth}
      data-polycss-texture-leaf-height={atlasLeafHeight}
      data-polycss-double-sided={entry.polygon.doubleSided ? "true" : undefined}
      {...domEventHandlers}
      {...dataAttrs}
      {...domAttrs}
    />
  );
});

export const TextureImagePoly = memo(function TextureImagePoly({
  plan,
  geometry,
  className,
  style: styleProp,
  domAttrs,
  domEventHandlers,
  pointerEvents = "auto",
}: {
  plan: TextureAtlasPlan;
  geometry: PolyTextureLeafGeometry;
  className?: string;
  style?: CSSProperties;
  domAttrs?: Record<string, unknown>;
  domEventHandlers?: React.DOMAttributes<Element>;
  pointerEvents?: "auto" | "none";
}) {
  const style: CSSProperties = {
    transform: formatMatrix3d(geometry.matrix),
    ["--polycss-atlas-width" as string]: formatCssLengthPx(geometry.leafWidth),
    ["--polycss-atlas-height" as string]: formatCssLengthPx(geometry.leafHeight),
    ["--polycss-atlas-leaf-sizing" as string]: "image",
    backgroundImage: `url(${geometry.url})`,
    backgroundPosition: `${formatCssLengthPx(geometry.backgroundPosition[0])} ${formatCssLengthPx(geometry.backgroundPosition[1])}`,
    backgroundSize: `${formatCssLengthPx(geometry.backgroundSize[0])} ${formatCssLengthPx(geometry.backgroundSize[1])}`,
    backgroundRepeat: "no-repeat",
    backgroundBlendMode: "normal",
    maskImage: "none",
    WebkitMaskImage: "none",
    imageRendering: geometry.imageRendering === "pixelated" ? "pixelated" : undefined,
    ["--pnx" as string]: plan.normal[0].toFixed(4),
    ["--pny" as string]: plan.normal[1].toFixed(4),
    ["--pnz" as string]: plan.normal[2].toFixed(4),
    pointerEvents: pointerEvents === "none" ? "none" : undefined,
    ...styleProp,
  };

  const dataAttrs = plan.polygon.data
    ? Object.fromEntries(
        Object.entries(plan.polygon.data).map(([k, v]) => [`data-${k}`, String(v)]),
      )
    : {};
  const elementClassName = className?.trim() || undefined;

  return (
    <s
      className={elementClassName}
      style={style}
      data-poly-index={plan.index}
      data-polycss-leaf="polygon"
      data-polycss-texture-backend="image"
      data-polycss-texture-leaf-sizing="image"
      data-polycss-texture-ready="true"
      data-polycss-texture-image-rendering={geometry.imageRendering}
      data-polycss-texture-projection={geometry.projection}
      data-polycss-texture-lighting={geometry.lighting}
      data-polycss-texture-leaf-width={geometry.leafWidth}
      data-polycss-texture-leaf-height={geometry.leafHeight}
      data-polycss-double-sided={plan.polygon.doubleSided ? "true" : undefined}
      data-polycss-texture-source-x={geometry.sourceRect.x}
      data-polycss-texture-source-y={geometry.sourceRect.y}
      data-polycss-texture-source-width={geometry.sourceRect.width}
      data-polycss-texture-source-height={geometry.sourceRect.height}
      {...domEventHandlers}
      {...dataAttrs}
      {...domAttrs}
    />
  );
});
