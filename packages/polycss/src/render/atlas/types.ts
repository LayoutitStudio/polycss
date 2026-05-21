import type {
  PolyAmbientLight,
  PolyDirectionalLight,
  Polygon,
  PolyTextureLightingMode,
} from "@layoutit/polycss-core";

// Pure types re-exported from core — no DOM dependency.
export type {
  TextureQuality,
  PolyRenderStrategy,
  SolidTrianglePrimitive,
  PolyRenderStrategiesOption,
  RGB,
  RGBFactors,
  UvAffine,
  UvSampleRect,
  TextureAtlasPlan,
  TextureTrianglePlan,
  PackedTextureAtlasEntry,
  PackedPage,
  PackingShelf,
  PackingPage,
  PackedAtlas,
  SolidTriangleBasis,
  SolidTriangleColorPlan,
  SolidTrianglePlan,
  SolidTriangleComputeOptions,
  StableTriangleColorState,
  SolidTriangleFrame,
  SolidPaintDefaults,
  TextureAtlasPage,
  RectBrush,
  LocalBasis,
  BasisOptions,
  BasisHint,
  PolygonBasisInfo,
  ProjectiveQuadGuardSettings,
  ProjectiveQuadGuardOverrides,
  ProjectiveQuadGuardGlobal,
  ProjectiveQuadCoefficients,
  StablePlanBasis,
  ComputeTextureAtlasPlanOptions,
  BorderShapeBounds,
  BorderShapeGeometry,
  CornerShapeCorner,
  CornerShapeSide,
  CornerShapeRadius,
  CornerShapeGeometry,
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
}

export interface InternalRenderTextureAtlasOptions extends RenderTextureAtlasOptions {
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
}

export interface RenderTextureAtlasAsyncResult extends RenderTextureAtlasResult {
  solidPaintDefaults: import("@layoutit/polycss-core").SolidPaintDefaults;
}
