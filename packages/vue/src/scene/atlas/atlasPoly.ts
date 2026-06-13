import { h } from "vue";
import type { CSSProperties, VNode } from "vue";
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

const ATLAS_CANONICAL_SIZE_FALLBACK = 64;

export function renderTextureAtlasPoly({
  entry,
  page,
  textureLighting,
  textureImageRendering,
  solidPaintDefaults: _solidPaintDefaults,
  className,
  style: styleProp,
  domAttrs,
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
  pointerEvents?: "auto" | "none";
}): VNode {
  const dynamic = textureLighting === "dynamic";
  const resolvedImageRendering = resolvePolyTextureImageRendering(entry.polygon, textureImageRendering);
  const atlasCanonicalSize = entry.atlasCanonicalSize ?? ATLAS_CANONICAL_SIZE_FALLBACK;
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

  // Dynamic mode: emit ONLY the per-polygon surface normal vars + the
  // alpha mask inline. The calc-driven background-color + blend-mode
  // multiply live in the global stylesheet's
  // `.polycss-scene[data-polycss-lighting="dynamic"] s { ... }` rule, so
  // each <s>'s style stays tiny (~50 chars instead of ~600 — ~12× smaller
  // payload on big meshes). The mask still has to be inline because each
  // polygon has its own atlas position/size.
  const dynamicMask = dynamic && page?.url ? `url(${page.url})` : undefined;
  const style: CSSProperties = {
    transform: formatMatrix3d(entry.atlasMatrix),
    "--polycss-atlas-size": `${atlasCanonicalSize}px`,
    "--polycss-atlas-width": formatCssLengthPx(atlasLeafWidth),
    "--polycss-atlas-height": formatCssLengthPx(atlasLeafHeight),
    "--polycss-atlas-leaf-sizing": entry.atlasLeafSizing ?? "canonical",
    backgroundImage: page?.url ? `url(${page.url})` : undefined,
    backgroundPosition: atlasPosition,
    backgroundSize: atlasSize,
    backgroundRepeat: page?.url ? "no-repeat" : undefined,
    imageRendering: resolvedImageRendering === "pixelated" ? "pixelated" : undefined,
    ...(dynamic
      ? {
          "--pnx": entry.normal[0].toFixed(4),
          "--pny": entry.normal[1].toFixed(4),
          "--pnz": entry.normal[2].toFixed(4),
        }
      : null),
    ...(dynamic && dynamicMask
      ? {
          maskImage: dynamicMask,
          maskMode: "alpha",
          maskPosition: atlasPosition,
          maskSize: atlasSize,
          maskRepeat: "no-repeat",
          WebkitMaskImage: dynamicMask,
          WebkitMaskPosition: atlasPosition,
          WebkitMaskSize: atlasSize,
          WebkitMaskRepeat: "no-repeat",
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

  return h("s", {
    class: elementClassName,
    style,
    "data-poly-index": String(entry.index),
    "data-polycss-leaf": "polygon",
    "data-polycss-texture-backend": "atlas",
    "data-polycss-texture-leaf-sizing": entry.atlasLeafSizing ?? "canonical",
    "data-polycss-texture-ready": page?.url ? "true" : "false",
    "data-polycss-texture-image-rendering": resolvedImageRendering,
    "data-polycss-texture-projection": "affine",
    "data-polycss-texture-lighting": textureLighting,
    "data-polycss-texture-leaf-width": String(atlasLeafWidth),
    "data-polycss-texture-leaf-height": String(atlasLeafHeight),
    "data-polycss-double-sided": entry.polygon.doubleSided ? "true" : undefined,
    ...dataAttrs,
    ...domAttrs,
  });
}

export function renderTextureImagePoly({
  plan,
  geometry,
  className,
  style: styleProp,
  domAttrs,
  pointerEvents = "auto",
}: {
  plan: TextureAtlasPlan;
  geometry: PolyTextureLeafGeometry;
  className?: string;
  style?: CSSProperties;
  domAttrs?: Record<string, unknown>;
  pointerEvents?: "auto" | "none";
}): VNode {
  const style: CSSProperties = {
    transform: formatMatrix3d(geometry.matrix),
    "--polycss-atlas-width": formatCssLengthPx(geometry.leafWidth),
    "--polycss-atlas-height": formatCssLengthPx(geometry.leafHeight),
    "--polycss-atlas-leaf-sizing": "image",
    backgroundImage: `url(${geometry.url})`,
    backgroundPosition: `${formatCssLengthPx(geometry.backgroundPosition[0])} ${formatCssLengthPx(geometry.backgroundPosition[1])}`,
    backgroundSize: `${formatCssLengthPx(geometry.backgroundSize[0])} ${formatCssLengthPx(geometry.backgroundSize[1])}`,
    backgroundRepeat: "no-repeat",
    backgroundBlendMode: "normal",
    maskImage: "none",
    WebkitMaskImage: "none",
    imageRendering: geometry.imageRendering === "pixelated" ? "pixelated" : undefined,
    "--pnx": plan.normal[0].toFixed(4),
    "--pny": plan.normal[1].toFixed(4),
    "--pnz": plan.normal[2].toFixed(4),
    pointerEvents: pointerEvents === "none" ? "none" : undefined,
    ...styleProp,
  };

  const dataAttrs = plan.polygon.data
    ? Object.fromEntries(
        Object.entries(plan.polygon.data).map(([k, v]) => [`data-${k}`, String(v)]),
      )
    : {};
  const elementClassName = className?.trim() || undefined;

  return h("s", {
    class: elementClassName,
    style,
    "data-poly-index": String(plan.index),
    "data-polycss-leaf": "polygon",
    "data-polycss-texture-backend": "image",
    "data-polycss-texture-leaf-sizing": "image",
    "data-polycss-texture-ready": "true",
    "data-polycss-texture-image-rendering": geometry.imageRendering,
    "data-polycss-texture-projection": geometry.projection,
    "data-polycss-texture-lighting": geometry.lighting,
    "data-polycss-texture-leaf-width": String(geometry.leafWidth),
    "data-polycss-texture-leaf-height": String(geometry.leafHeight),
    "data-polycss-double-sided": plan.polygon.doubleSided ? "true" : undefined,
    "data-polycss-texture-source-x": String(geometry.sourceRect.x),
    "data-polycss-texture-source-y": String(geometry.sourceRect.y),
    "data-polycss-texture-source-width": String(geometry.sourceRect.width),
    "data-polycss-texture-source-height": String(geometry.sourceRect.height),
    ...dataAttrs,
    ...domAttrs,
  });
}
