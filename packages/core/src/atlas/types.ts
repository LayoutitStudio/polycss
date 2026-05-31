import type { Vec2, Vec3, Polygon } from "../types";

export interface RGB { r: number; g: number; b: number; }
export interface RGBFactors { r: number; g: number; b: number; }

export interface UvAffine {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
}

export interface UvSampleRect {
  minU: number;
  minV: number;
  maxU: number;
  maxV: number;
}

export interface TextureTrianglePlan {
  screenPts: number[];
  uvAffine: UvAffine | null;
  uvSampleRect: UvSampleRect | null;
}

export interface TextureAtlasPlan {
  index: number;
  polygon: Polygon;
  texture?: string;
  tileSize: number;
  layerElevation: number;
  matrix: string;
  canonicalMatrix: string;
  atlasMatrix: string;
  atlasCanonicalSize?: number;
  projectiveMatrix: string | null;
  canvasW: number;
  canvasH: number;
  screenPts: number[];
  uvAffine: UvAffine | null;
  uvSampleRect: UvSampleRect | null;
  textureTriangles: TextureTrianglePlan[] | null;
  textureEdgeRepairEdges: Set<number> | null;
  textureEdgeRepair: boolean;
  seamBleed?: number;
  seamBleedEdges?: Set<number>;
  seamBleedEdgeAmounts?: Map<number, number>;
  seamBleedInsets?: SeamBleedInsets;
  /** Resolved per-strategy bleed multiplier (0..1, default 1). Populated
   *  at plan construction from `options.seamBleed` via `resolveBleedRatio`.
   *  Downstream emitters (borderShapeGeometryForPlan, projective-quad
   *  rasteriser, etc.) read this and multiply their hardcoded per-strategy
   *  bleed constants by it. Single knob for "scale down all my bleeds". */
  bleedRatio?: number;
  /** World-space surface normal — stable across light changes, used by dynamic mode. */
  normal: Vec3;
  textureTint: RGBFactors;
  shadedColor: string;
}

export interface BorderShapeBounds {
  minX: number;
  minY: number;
  width: number;
  height: number;
}

export interface BorderShapeGeometry {
  bounds: BorderShapeBounds;
  points: Array<[number, number]>;
}

export type CornerShapeCorner = "topLeft" | "topRight" | "bottomRight" | "bottomLeft";
export type CornerShapeSide = "left" | "right" | "top" | "bottom";

export interface CornerShapeRadius {
  x: number;
  y: number;
}

export interface CornerShapeGeometry {
  bounds: BorderShapeBounds;
  radii: Partial<Record<CornerShapeCorner, CornerShapeRadius>>;
}

export type TextureQuality = number | "auto";
export type PolySeamBleed = number | "auto";
export type PolySeamBleedEdgeValue = ReadonlySet<number> | ReadonlyMap<number, number>;
export type PolySeamBleedEdges =
  | ReadonlyMap<number, PolySeamBleedEdgeValue>
  | readonly (PolySeamBleedEdgeValue | undefined)[];

export type PolyRenderStrategy = "b" | "i" | "u";
export type SolidTrianglePrimitive = "border" | "border-large" | "corner-bevel";

export interface PolyRenderStrategiesOption {
  /** Strategies to skip; polygons that would normally use them fall through
   *  the chain (b → i → s, u → i → s, i → s). `<s>` is the universal
   *  fallback and cannot be disabled — textured polys have no other path. */
  disable?: readonly PolyRenderStrategy[];
}

export interface SeamBleedInsets {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export interface PackedTextureAtlasEntry extends TextureAtlasPlan {
  pageIndex: number;
  x: number;
  y: number;
}

export interface PackedPage {
  width: number;
  height: number;
  entries: PackedTextureAtlasEntry[];
}

export interface PackingShelf {
  x: number;
  y: number;
  height: number;
}

export interface PackingPage extends PackedPage {
  shelves: PackingShelf[];
  sealed?: boolean;
}

export interface PackedAtlas {
  entries: Array<PackedTextureAtlasEntry | null>;
  pages: PackedPage[];
}

export interface SolidTriangleBasis {
  a: number;
  b: number;
  c: number;
}

export interface SolidTriangleColorPlan {
  index: number;
  polygon: Polygon;
  colorComputed: boolean;
  bakedColor?: string;
  bakedRgb?: RGB;
  bakedAlpha?: number;
  dynamicVars?: string;
}

export interface SolidTrianglePlan extends SolidTriangleColorPlan {
  styleText: string;
  transformText: string;
  basis: SolidTriangleBasis;
  primitive: SolidTrianglePrimitive;
}

export interface SolidTriangleComputeOptions {
  basis?: SolidTriangleBasis;
  includeColor?: boolean;
  matrixDecimals?: number;
  color?: string;
  primitive?: SolidTrianglePrimitive;
  /** Pre-resolved primitive used when `primitive` is not set — replaces the
   *  browser-global resolution that formerly happened inside the function. */
  resolvedPrimitive?: SolidTrianglePrimitive | null;
}

export interface StableTriangleColorState {
  updatesDisabled: boolean;
  freezeFrames: number;
  colorFrame: number;
  maxStep: number;
}

export interface SolidTriangleFrame {
  polygonCount: number;
  vertices: ArrayLike<number>;
  colors?: readonly (string | undefined)[];
}

export interface SolidPaintDefaults {
  paintColor?: string;
  dynamicColor?: { r: number; g: number; b: number };
  dynamicColorKey?: string;
}

export interface TextureAtlasPage {
  width: number;
  height: number;
  url: string | null;
}

export interface RectBrush {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface LocalBasis {
  xAxis: Vec3;
  yAxis: Vec3;
  local2D: Vec2[];
  shiftX: number;
  shiftY: number;
  canvasW: number;
  canvasH: number;
  pixelArea: number;
  rawArea: number;
}

export interface BasisOptions {
  optimize: boolean;
  fixedXAxis?: Vec3;
  boundsOrigin?: Vec3;
  snapBounds?: boolean;
  seamEdges?: Set<number>;
}

export interface BasisHint {
  xAxis?: Vec3;
  boundsOrigin?: Vec3;
  seamEdges: Set<number>;
  textureEdgeRepairEdges?: Set<number>;
}

export interface PolygonBasisInfo {
  pts: Vec3[];
  normal: Vec3;
  planeD: number;
  optimizable: boolean;
}

export interface ProjectiveQuadGuardSettings {
  denomEps: number;
  maxWeightRatio: number;
  bleed: number;
  disableGuards: boolean;
}

export interface ProjectiveQuadGuardOverrides {
  denomEps?: number;
  maxWeightRatio?: number;
  bleed?: number;
  disableGuards?: boolean;
}

export interface ProjectiveQuadGuardGlobal {
  __polycssProjectiveQuadGuards?: ProjectiveQuadGuardOverrides;
}

export interface ProjectiveQuadCoefficients {
  g: number;
  h: number;
  w1: number;
  w3: number;
}

export interface StablePlanBasis {
  normal: Vec3;
  xAxis: Vec3;
  yAxis: Vec3;
  tx: number;
  ty: number;
  tz: number;
}

/** Options for solidTrianglePlan computation — the pure-math subset of
 *  RenderTextureAtlasOptions with no DOM reference. */
export interface SolidTrianglePlanOptions {
  tileSize?: number;
  layerElevation?: number;
  directionalLight?: import("../types").PolyDirectionalLight;
  ambientLight?: import("../types").PolyAmbientLight;
  textureLighting?: import("../types").PolyTextureLightingMode;
  solidPaintDefaults?: SolidPaintDefaults;
  strategies?: PolyRenderStrategiesOption;
  seamBleed?: PolySeamBleed;
  seamEdges?: Set<number>;
  /** Per-strategy bleed multiplier (0..1, default 1). Scales the
   *  hardcoded SOLID_TRIANGLE_BLEED used as the seamBleed fallback when
   *  no shared-edge bleed is present. Populated upstream from
   *  `resolveBleedRatio(publicOptions.seamBleed)`. */
  bleedRatio?: number;
  /**
   * Indices (into the polygon array being planned) of polygons that the
   * directional light cannot physically reach because another polygon of
   * the same mesh is between them and the light source. Per-polygon
   * directScale is forced to 0 for indices in this set, so they receive
   * ambient lighting only — matching what a shadow-map-equivalent pass
   * would produce.
   */
  lightOccludedPolyIndices?: ReadonlySet<number>;
}

/** Internal solid-triangle plan options (extends SolidTrianglePlanOptions). */
export interface InternalSolidTrianglePlanOptions extends SolidTrianglePlanOptions {
  optimizeStableTriangleStyle?: boolean;
  stableTriangleColorSteps?: number;
  stableTriangleMatrixDecimals?: number;
}

/** Options accepted by the public {@link computeTextureAtlasPlanPublic} wrapper. */
export interface ComputeTextureAtlasPlanOptions {
  tileSize?: number;
  layerElevation?: number;
  directionalLight?: import("../types").PolyDirectionalLight;
  ambientLight?: import("../types").PolyAmbientLight;
  /** Shared-edge set returned by {@link buildTextureEdgeRepairSets}. */
  textureEdgeRepairEdges?: Set<number>;
  seamBleed?: PolySeamBleed;
  seamEdges?: Set<number>;
}
