import type {
  PolyAmbientLight,
  PolyDirectionalLight,
  Polygon,
  PolyTextureLightingMode,
} from "@layoutit/polycss-core";

export interface RenderTextureAtlasOptions {
  doc?: Document;
  tileSize?: number;
  layerElevation?: number;
  directionalLight?: PolyDirectionalLight;
  ambientLight?: PolyAmbientLight;
  textureLighting?: PolyTextureLightingMode;
  /**
   * Atlas bitmap budget and CSS sprite size. Numeric values are clamped to
   * 0.1..1 and keep the 64px sprite. Omitted / `"auto"` picks a raster scale
   * from packed atlas area, caps oversized runtime bitmaps by side length and
   * decoded-memory budget, and uses a 128px sprite on desktop-class documents
   * or a 64px sprite on mobile-class documents.
   */
  textureQuality?: import("@layoutit/polycss-core").TextureQuality;
  solidPaintDefaults?: import("@layoutit/polycss-core").SolidPaintDefaults;
  strategies?: import("@layoutit/polycss-core").PolyRenderStrategiesOption;
  /**
   * Indices of polygons that the directional light cannot reach (precomputed
   * by createPolyScene via {@link computeLightVisibility}). Atlas + solid
   * planning forces directScale to 0 for these polys so they render with
   * ambient-only color, matching what a shadow-map pass would output.
   */
  lightOccludedPolyIndices?: ReadonlySet<number>;
}

export interface InternalRenderTextureAtlasOptions extends RenderTextureAtlasOptions {
  seamBleed?: number;
  seamEdges?: Set<number>;
  computeSolidPaintDefaults?: boolean;
  skipDynamicNormalVars?: boolean;
  optimizeStableTriangleStyle?: boolean;
  stableTriangleDebug?: "transform-only" | "plan-only";
  stableTriangleUpdateMode?: "full" | "transform-only" | "color-only";
  stableTriangleColorPolicy?: "cadence" | "adaptive";
  stableTriangleColorSteps?: number;
  stableTriangleColorFreezeFrames?: number;
  stableTriangleColorBudget?: number;
  stableTriangleColorMaxAge?: number;
  stableTriangleColorMaxStep?: number;
  stableTriangleColorFrame?: number;
  stableTriangleMatrixDecimals?: number;
}

export interface SolidTriangleElement extends HTMLElement {
  __polycssSolidTriangleBasis?: import("@layoutit/polycss-core").SolidTriangleBasis;
  __polycssSolidTrianglePrimitive?: import("@layoutit/polycss-core").SolidTrianglePrimitive;
  __polycssSolidTriangleColor?: string;
  __polycssSolidTriangleColorRgb?: import("@layoutit/polycss-core").RGB;
  __polycssSolidTriangleColorAlpha?: number;
  __polycssSolidTriangleColorFrame?: number;
  __polycssSolidTriangleHidden?: boolean;
  __polycssHasDataAttrs?: boolean;
}

export interface RenderedPoly {
  polygonIndex: number;
  element: HTMLElement;
  kind?: "atlas" | "solid" | "border" | "corner" | "triangle";
  plan?: import("@layoutit/polycss-core").TextureAtlasPlan;
  dispose(): void;
}

export interface RenderTextureAtlasResult {
  rendered: RenderedPoly[];
  dispose(): void;
  /**
   * Resolves once every textured `<s>` leaf has its `background-image`
   * applied (i.e. the atlas canvas → Blob → URL chain has completed and
   * the apply-bg pass has run). For meshes with no textured leaves this
   * resolves immediately. Callers doing stale-while-revalidate swaps
   * await this before disposing the previous render — without it, the
   * fresh leaves mount with empty backgrounds and the prior frame's
   * bitmaps would be needed underneath to avoid a transparent flash.
   */
  pagesReady?: Promise<void>;
}

export interface RenderTextureAtlasAsyncResult extends RenderTextureAtlasResult {
  solidPaintDefaults: import("@layoutit/polycss-core").SolidPaintDefaults;
}
