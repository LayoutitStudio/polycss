import type {
  Vec2,
  Vec3,
  PolyDirectionalLight,
  PolyTextureBackend,
  PolyTextureImageRendering,
  PolyTextureImageSource,
  PolyTextureLeafSizing,
  PolyTextureLightingMode,
  PolyTextureProjection,
  PolyMaterial,
  PolyTexturePresentation,
} from "@layoutit/polycss-core";
import type {
  CSSProperties,
  MouseEventHandler,
  PointerEventHandler,
  FocusEventHandler,
  KeyboardEventHandler,
} from "react";
import type { TextureQuality } from "../scene/atlas";

// ── TransformProps ──────────────────────────────────────────────────────────

/** Three.js-style transform props accepted by every PolyCSS component. */
export interface TransformProps {
  position?: Vec3;
  scale?: number | Vec3;
  rotation?: Vec3; // euler degrees [x, y, z]
}

// ── DOMPassthroughProps ────────────────────────────────────────────────────

/**
 * DOM event handlers, ARIA, and style props forwarded to the rendered
 * element by every Poly component.
 *
 * This is the DOM-native pitch: polygons are real DOM nodes you can
 * target with CSS, attach event handlers to, and inspect in DevTools.
 */
export interface DOMPassthroughProps {
  className?: string;
  style?: CSSProperties;
  id?: string;
  // Mouse / pointer
  onClick?: MouseEventHandler<HTMLElement>;
  onDoubleClick?: MouseEventHandler<HTMLElement>;
  onMouseEnter?: MouseEventHandler<HTMLElement>;
  onMouseLeave?: MouseEventHandler<HTMLElement>;
  onMouseMove?: MouseEventHandler<HTMLElement>;
  onPointerDown?: PointerEventHandler<HTMLElement>;
  onPointerUp?: PointerEventHandler<HTMLElement>;
  onPointerEnter?: PointerEventHandler<HTMLElement>;
  onPointerLeave?: PointerEventHandler<HTMLElement>;
  // Focus
  onFocus?: FocusEventHandler<HTMLElement>;
  onBlur?: FocusEventHandler<HTMLElement>;
  // Keyboard
  onKeyDown?: KeyboardEventHandler<HTMLElement>;
  // ARIA
  tabIndex?: number;
  role?: string;
  "aria-label"?: string;
  "aria-hidden"?: boolean;
  // Pointer-events escape hatch — default "auto" (DOM-native receives events).
  // Set to "none" for purely decorative polygons that should be click-through.
  pointerEvents?: "auto" | "none";
  // data-* attributes forwarded directly. Polygon.data is also reflected as
  // data-* attributes automatically; use this for attrs not in Polygon.data.
  [dataAttr: `data-${string}`]: string | number | boolean | undefined;
}

// ── PolyProps ──────────────────────────────────────────────────────────────

/**
 * Props for the `<Poly>` component — the atomic polygon primitive.
 *
 * Extends TransformProps + DOMPassthroughProps with the polygon's own fields.
 * This is the canonical Poly component API.
 */
export interface PolyProps extends TransformProps, DOMPassthroughProps {
  // Polygon fields (from Polygon type)
  vertices: Vec3[];
  color?: string;
  texture?: string;
  textureImageSource?: PolyTextureImageSource;
  texturePresentation?: PolyTexturePresentation;
  uvs?: Vec2[];
  data?: Record<string, string | number | boolean>;
  doubleSided?: boolean;
  /** Shared material. When set AND the polygon's UVs form an axis-aligned
   *  rectangle, renders via `background-image` directly — no per-polygon
   *  canvas rasterization. Falls back to the atlas path otherwise. */
  material?: PolyMaterial;

  // Internal props forwarded from parent scene/context.
  // These are set by PolyScene, not by end users.
  context?: {
    tileSize?: number;
    layerElevation?: number;
    directionalLight?: PolyDirectionalLight;
    textureLighting?: PolyTextureLightingMode;
    textureQuality?: TextureQuality;
    textureLeafSizing?: PolyTextureLeafSizing;
    textureImageRendering?: PolyTextureImageRendering;
    textureBackend?: PolyTextureBackend;
    textureProjection?: PolyTextureProjection;
    debugShowBackfaces?: boolean;
    [key: string]: unknown;
  };
  /** Textured polygon lighting mode. Defaults to scene context, then "baked". */
  textureLighting?: PolyTextureLightingMode;
  /** Atlas bitmap budget and CSS sprite size. `"auto"` (default) uses a
   *  device-appropriate memory budget and desktop/mobile sprite sizing. */
  textureQuality?: TextureQuality;
  /** Atlas leaf CSS primitive sizing. Defaults to scene context, then canonical. */
  textureLeafSizing?: PolyTextureLeafSizing;
  /** Default image filtering for atlas and direct image texture leaves. */
  textureImageRendering?: PolyTextureImageRendering;
  /** Default texture backend request. Defaults to scene context, then "auto". */
  textureBackend?: PolyTextureBackend;
  /** Default texture projection request. Defaults to scene context, then "affine". */
  textureProjection?: PolyTextureProjection;
  /** Pre-computed shaded base color from the parent (optional override). */
  baseColor?: string;
}
