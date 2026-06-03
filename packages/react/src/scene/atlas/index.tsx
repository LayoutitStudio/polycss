// Re-exports from @layoutit/polycss-core needed by callers of this barrel
export type {
  TextureAtlasPlan,
  PackedTextureAtlasEntry,
  TextureAtlasPage,
  SolidPaintDefaults,
  PolyRenderStrategy,
  PolyRenderStrategiesOption,
  PolySeamBleed,
  TextureQuality,
} from "@layoutit/polycss-core";
export {
  isSolidTrianglePlan,
  isProjectiveQuadPlan,
  buildTextureEdgeRepairSets,
  buildSeamBleedPolygonEdges,
  buildSeamBleedPolygonSet,
  cssBorderShapeForPlan,
} from "@layoutit/polycss-core";

// Detection
export {
  borderShapeSupported,
  solidTriangleSupported,
  cornerShapeSupported,
  cornerTriangleSupported,
  projectiveQuadSupported,
  getSolidPaintDefaultsForPlans,
  getSolidPaintDefaultsFromPlans,
  isBorderShapeSupported,
  isSolidTriangleSupported,
} from "./detection";

// Filter plans
export { filterAtlasPlans } from "./filterPlans";

// Packing
export { isMobileDocument, packTextureAtlasPlansWithScale } from "./packing";

// Build atlas pages
export {
  TEXTURE_IMAGE_CACHE,
  loadTextureImage,
  setCssTransform,
  applyTextureTint,
  drawImageCover,
  drawImageUvSample,
  tracePolygonPath,
  traceOffsetPolygonPath,
  paintSolidAtlasEntry,
  drawTexturedAtlasEntry,
  repairTextureEdgeAlpha,
  canvasToUrl,
  buildAtlasPages,
} from "./buildAtlasPages";

// Solid triangle style math
export { solidTriangleStyle } from "./solidTriangleStyle";

// Stable triangle DOM
export { updateStableTriangleDom } from "./stableTriangleDom";
export type { StableTriangleDomUpdateOptions } from "./stableTriangleDom";

// Paint defaults + computeTextureAtlasPlan
export { computeTextureAtlasPlan, getSolidPaintDefaults } from "./paintDefaults";

// Hook
export { useTextureAtlas } from "./useTextureAtlas";
export type { TextureAtlasResult } from "./useTextureAtlas";

// Components
export { TextureTrianglePoly } from "./triangle";
export { TextureBorderShapePoly } from "./borderShape";
export { TextureProjectiveSolidPoly } from "./projectiveSolid";
export { TextureCornerShapeSolidPoly } from "./cornerShapeSolid";
export { TextureAtlasPoly } from "./atlasPoly";
