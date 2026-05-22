import { h } from "vue";
import type { CSSProperties, VNode } from "vue";
import type {
  PackedTextureAtlasEntry,
  TextureAtlasPage,
  PolyTextureLightingMode,
  SolidPaintDefaults,
} from "@layoutit/polycss-core";
import { formatMatrix3d, formatCssLengthPx } from "@layoutit/polycss-core";

const ATLAS_CANONICAL_SIZE_FALLBACK = 64;

export function renderTextureAtlasPoly({
  entry,
  page,
  textureLighting,
  solidPaintDefaults: _solidPaintDefaults,
  className,
  style: styleProp,
  domAttrs,
  pointerEvents = "auto",
}: {
  entry: PackedTextureAtlasEntry;
  page: TextureAtlasPage | undefined;
  textureLighting: PolyTextureLightingMode;
  solidPaintDefaults?: SolidPaintDefaults;
  className?: string;
  style?: CSSProperties;
  domAttrs?: Record<string, unknown>;
  pointerEvents?: "auto" | "none";
}): VNode {
  const dynamic = textureLighting === "dynamic";
  const atlasCanonicalSize = entry.atlasCanonicalSize ?? ATLAS_CANONICAL_SIZE_FALLBACK;
  const atlasWidth = entry.canvasW || 1;
  const atlasHeight = entry.canvasH || 1;
  const atlasPosition = page
    ? `${formatCssLengthPx((-entry.x / atlasWidth) * atlasCanonicalSize)} ${formatCssLengthPx((-entry.y / atlasHeight) * atlasCanonicalSize)}`
    : undefined;
  const atlasSize = page
    ? `${formatCssLengthPx((page.width / atlasWidth) * atlasCanonicalSize)} ${formatCssLengthPx((page.height / atlasHeight) * atlasCanonicalSize)}`
    : undefined;

  // Dynamic mode: emit ONLY the per-polygon surface normal vars + the
  // alpha mask inline. The calc-driven background-color + blend-mode
  // multiply live in the global stylesheet's
  // `.polycss-scene[data-polycss-lighting="dynamic"] s { ... }` rule, so
  // each <s>'s style stays tiny (~50 chars instead of ~600 — ~12× smaller
  // payload on big meshes). The mask still has to be inline because each
  // polygon has its own atlas position/size.
  const dynamicMask = dynamic && page?.url ? `url(${page.url})` : undefined;
  const background = !dynamic && page?.url
    ? `url(${page.url}) ${atlasPosition} / ${atlasSize} no-repeat`
    : undefined;

  const style: CSSProperties = {
    transform: formatMatrix3d(entry.atlasMatrix),
    "--polycss-atlas-size": `${atlasCanonicalSize}px`,
    // Vue note: setting `background` shorthand alongside `backgroundImage:
    // undefined` (or the other longhand undefined values) makes Vue clear
    // the longhand pieces of the just-applied shorthand, leaving only
    // `no-repeat` and dropping the image URL. Branch instead so only the
    // properties relevant to the current mode get assigned.
    ...(dynamic
      ? {
          backgroundImage: page?.url ? `url(${page.url})` : undefined,
          backgroundPosition: atlasPosition,
          backgroundSize: atlasSize,
        }
      : { background }),
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
    ...dataAttrs,
    ...domAttrs,
  });
}
