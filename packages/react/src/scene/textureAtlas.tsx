// Thin re-export barrel — all implementation has moved to ./atlas/
export type {
  TextureAtlasPlan,
  PackedTextureAtlasEntry,
  TextureAtlasPage,
  SolidPaintDefaults,
  PolyRenderStrategy,
  PolyRenderStrategiesOption,
  TextureQuality,
} from "@layoutit/polycss-core";
export {
  isSolidTrianglePlan,
  isProjectiveQuadPlan,
  buildTextureEdgeRepairSets,
  cssBorderShapeForPlan,
} from "@layoutit/polycss-core";

export { getSolidPaintDefaults as getSolidPaintDefaultsFromPlans } from "./atlas/paintDefaults";
export { computeTextureAtlasPlan, getSolidPaintDefaults } from "./atlas/paintDefaults";
export { updateStableTriangleDom } from "./atlas/stableTriangleDom";
export type { StableTriangleDomUpdateOptions, TextureAtlasResult } from "./atlas";
export { useTextureAtlas } from "./atlas/useTextureAtlas";
export { TextureBorderShapePoly } from "./atlas/borderShape";
export { TextureProjectiveSolidPoly } from "./atlas/projectiveSolid";
export { TextureTrianglePoly } from "./atlas/triangle";
export { TextureAtlasPoly } from "./atlas/atlasPoly";
