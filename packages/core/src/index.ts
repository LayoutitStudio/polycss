// @layoutit/polycss-core — Pure-math polygon rendering engine (zero browser globals).
//
// Public exports define the supported core package surface. Anything not
// exported here is implementation detail.

// ── Types ─────────────────────────────────────────────────────────
export type {
  Vec2,
  Vec3,
  TextureTriangle,
  PolyTextureAlphaMode,
  PolyTextureWrap,
  PolyTextureWrapMode,
  Polygon,
  PolyMaterial,
  PolyDirectionalLight,
  PolyAmbientLight,
  PolyTextureLightingMode,
  MeshResolution,
} from "./types";
export { DEFAULT_PROJECTION } from "./types";

// ── Scene context + normalization ────────────────────────────────
export {
  buildSceneContext,
  computeSceneBbox,
  normalizePolygons,
} from "./scene/context";
export type {
  SceneContext,
  SceneContextBuildArgs,
  SceneContextBuildResult,
  SceneBbox,
  NormalizeResult,
} from "./scene/context";

// ── Polygon geometry helper ──────────────────────────────────────
export { polygonFaces, computeTexturePaintMetrics } from "./scene/polygonGeometry";
export type {
  PolygonFace,
  TexturePaintMetrics,
  TexturePaintMetricsOptions,
} from "./scene/polygonGeometry";

// ── Rotation math ────────────────────────────────────────────────
export { rotateVec3, inverseRotateVec3 } from "./math/rotation";
export {
  quatFromAxisAngle,
  quatFromEulerXYZ,
  quatMultiply,
  eulerXYZFromQuat,
  QUAT_IDENTITY,
} from "./math/quaternion";
export type { Quat } from "./math/quaternion";

// ── Camera ────────────────────────────────────────────────────────
export {
  createIsometricCamera,
  normalizeInvertMultiplier,
  DEFAULT_CAMERA_STATE,
  BASE_TILE,
} from "./camera/camera";
export type {
  CameraState,
  CameraHandle,
  AutoRotateOption,
  AutoRotateConfig,
  CameraStyleInput,
} from "./camera/camera";

// ── Color & lighting ─────────────────────────────────────────────
export {
  parseColor,
  shadeColor,
  computeShapeLighting,
} from "./color/lighting";
export type { ParsedColor } from "./color/lighting";

export {
  parsePureColor,
  parseHexColor,
  parseRgbColor,
  clampChannel,
  formatColor,
} from "./color/color";

// ── Mesh post-processing ──────────────────────────────────────────
export { mergePolygons } from "./merge/mergePolygons";
export {
  dedupeOverlappingPolygons,
  findOverlappingPolygonDuplicates,
} from "./merge/dedupeOverlappingPolygons";
export type { DedupeOverlappingPolygonsOptions } from "./merge/dedupeOverlappingPolygons";
export { coverPlanarPolygons } from "./merge/coverPlanarPolygons";
export type { CoverPlanarPolygonsOptions } from "./merge/coverPlanarPolygons";
export { optimizeMeshPolygons } from "./merge/optimizePolygons";
export type {
  OptimizeMeshPolygonsOptions,
} from "./merge/optimizePolygons";
export {
  DEFAULT_SEAM_FACET_SPLIT_OPTIONS,
  DEFAULT_SEAM_OVERLAP_OPTIONS,
  repairMeshSeams,
  seamFacetSplitPolygons,
  seamFacetSplitReport,
  seamOverlapDiagnostics,
  seamOverlapPolygons,
  seamOverlapReport,
} from "./merge/seamRepair";
export type {
  SeamFacetSplitCandidate,
  SeamFacetSplitCandidateReason,
  SeamFacetSplitOptions,
  SeamFacetSplitReport,
  SeamOverlapCandidate,
  SeamOverlapCandidateKind,
  SeamOverlapDiagnostics,
  SeamOverlapOptions,
} from "./merge/seamRepair";
export { cullInteriorPolygons } from "./cull/cullInteriorPolygons";
export type { CullInteriorOptions } from "./cull/cullInteriorPolygons";
export {
  CAMERA_BACKFACE_CULL_EPS,
  VOXEL_CAMERA_CULL_AXIS_EPS,
  VOXEL_CAMERA_CULL_NORMAL_LIMIT,
  cameraCullNormalGroups,
  cameraCullNormalGroupsFromPolygons,
  cameraCullNormalKey,
  cameraCullVisibleSignature,
  cameraFacingDepth,
  isAxisAlignedSurfaceNormal,
  isVoxelCameraCullableNormalGroups,
  normalFacesCamera,
  polygonCssSurfaceNormal,
  polygonFacesCamera,
} from "./cull/cameraBackfaceCulling";
export type {
  CameraCullNormalGroup,
  CameraCullRotation,
} from "./cull/cameraBackfaceCulling";

// ── Helper geometry (boxes, axes, light marker, transform arrows / rings) ─
export { axesHelperPolygons, boxPolygons, arrowPolygons, ringPolygons, ringQuadPolygons, planePolygons, octahedronPolygons, spherePolygons, tetrahedronPolygons, icosahedronPolygons, dodecahedronPolygons, cylinderPolygons, conePolygons, torusPolygons } from "./helpers";
export type { AxesHelperOptions, BoxFace, BoxFaceOptions, BoxPolygonsOptions, ArrowPolygonsOptions, RingPolygonsOptions, RingQuadPolygonsOptions, PlanePolygonsOptions, OctahedronPolygonsOptions, SpherePolygonsOptions, TetrahedronPolygonsOptions, IcosahedronPolygonsOptions, DodecahedronPolygonsOptions, CylinderPolygonsOptions, ConePolygonsOptions, TorusPolygonsOptions } from "./helpers";

// ── Shadow ────────────────────────────────────────────────────────
export {
  BAKED_SHADOW_MIN_UP,
  BAKED_SHADOW_Z_SQUASH,
  buildBakedShadowProjectionMatrix,
  convexHull2D,
  ensureCcw2D,
  isBakedShadowCaster,
  polygonSignedArea2D,
  projectCssVertexToGround,
} from "./shadow/projection";
export { clipPolygonToConvex2D } from "./shadow/clipping";

// ── Animation ─────────────────────────────────────────────────────
export {
  createPolyAnimationMixer,
  LoopOnce,
  LoopRepeat,
  LoopPingPong,
} from "./animation";
export { optimizeAnimatedMeshPolygons } from "./animation/optimizeAnimatedMeshPolygons";
export type { OptimizeAnimatedMeshPolygonsOptions } from "./animation/optimizeAnimatedMeshPolygons";
export type {
  PolyAnimationClip,
  PolyAnimationAction,
  PolyAnimationMixer,
  PolyAnimationTarget,
  LoopMode,
} from "./animation";

// ── Parsers ───────────────────────────────────────────────────────
export type {
  ParseAnimationClip,
  ParseAnimationController,
  PolyVoxelCell,
  PolyVoxelSource,
  ParseResult,
} from "./parser/types";
export { parseObj } from "./parser/parseObj";
export type { ObjParseOptions } from "./parser/parseObj";
export { parseMtl } from "./parser/parseMtl";
export type { MtlParseResult } from "./parser/parseMtl";
export { parseGltf } from "./parser/parseGltf";
export type { GltfParseOptions } from "./parser/parseGltf";
export {
  bakeSolidTextureSamples,
  bakeSolidTextureSampledPolygons,
} from "./parser/solidTextureSamples";
export type { SolidTextureSampleOptions } from "./parser/solidTextureSamples";
export { parseVox } from "./parser/parseVox";
export type { VoxParseOptions } from "./parser/parseVox";
export { loadMesh } from "./parser/loadMesh";
export type { LoadMeshOptions } from "./parser/loadMesh";

// ── Atlas (pure math) ────────────────────────────────────────────
export {
  DEFAULT_TILE,
  DEFAULT_LIGHT_DIR,
  DEFAULT_LIGHT_COLOR,
  DEFAULT_LIGHT_INTENSITY,
  DEFAULT_AMBIENT_COLOR,
  DEFAULT_AMBIENT_INTENSITY,
  ATLAS_MAX_SIZE,
  ATLAS_PADDING,
  MIN_ATLAS_SCALE,
  MAX_ATLAS_SCALE,
  AUTO_ATLAS_LOW_AREA,
  AUTO_ATLAS_MEDIUM_AREA,
  AUTO_ATLAS_MAX_BITMAP_SIDE,
  AUTO_ATLAS_MAX_DECODED_BYTES_MOBILE,
  AUTO_ATLAS_MAX_DECODED_BYTES_DESKTOP,
  AUTO_ATLAS_SCALE_GUARD,
  COLOR_PARSE_CACHE_MAX,
  ASYNC_RENDER_BUDGET_MS,
  RECT_EPS,
  BASIS_EPS,
  SURFACE_NORMAL_EPS,
  SURFACE_DISTANCE_EPS,
  SEAM_LIGHT_EPS,
  TEXTURE_TRIANGLE_BLEED,
  TEXTURE_EDGE_REPAIR_ALPHA_MIN,
  TEXTURE_EDGE_REPAIR_SOURCE_ALPHA_MIN,
  TEXTURE_EDGE_REPAIR_RADIUS,
  SOLID_TRIANGLE_BLEED,
  DEFAULT_MATRIX_DECIMALS,
  DEFAULT_BORDER_SHAPE_DECIMALS,
  DEFAULT_ATLAS_CSS_DECIMALS,
  DECIMAL_SCALES,
  SOLID_QUAD_CANONICAL_SIZE,
  SOLID_TRIANGLE_CANONICAL_SIZE,
  SOLID_TRIANGLE_LARGE_BORDER_CANONICAL_SIZE,
  SOLID_TRIANGLE_CORNER_CLASS,
  SOLID_TRIANGLE_LARGE_BORDER_CLASS,
  ATLAS_CANONICAL_SIZE_EXPLICIT,
  ATLAS_CANONICAL_SIZE_AUTO_DESKTOP,
  BORDER_SHAPE_CENTER_PERCENT,
  BORDER_SHAPE_POINT_EPS,
  BORDER_SHAPE_CANONICAL_SIZE,
  BORDER_SHAPE_BLEED,
  CORNER_SHAPE_POINT_EPS,
  CORNER_SHAPE_DUPLICATE_EPS,
  PROJECTIVE_QUAD_DENOM_EPS,
  PROJECTIVE_QUAD_MAX_WEIGHT_RATIO,
  PROJECTIVE_QUAD_BLEED,
  DEFAULT_SEAM_BLEED,
} from "./atlas/constants";
export type {
  RGB,
  RGBFactors,
  UvAffine,
  UvSampleRect,
  TextureTrianglePlan,
  TextureAtlasPlan,
  BorderShapeBounds,
  BorderShapeGeometry,
  CornerShapeCorner,
  CornerShapeSide,
  CornerShapeRadius,
  CornerShapeGeometry,
  TextureQuality,
  PolySeamBleed,
  PolySeamBleedEdgeValue,
  PolySeamBleedEdges,
  PolyRenderStrategy,
  SolidTrianglePrimitive,
  PolyRenderStrategiesOption,
  SeamBleedInsets,
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
  SolidTrianglePlanOptions,
  InternalSolidTrianglePlanOptions,
} from "./atlas/types";
export {
  roundDecimal,
  formatCssLength,
  formatMatrix3dValues,
  formatAffineMatrix3dColumns,
  formatAffineMatrix3dScalars,
  formatAffineMatrix3dTransformScalars,
  formatScaledMatrixFromPlan,
  formatBorderShapeMatrix,
  formatSolidQuadMatrix,
  formatAtlasMatrix,
  formatPercent,
  formatMatrix3d,
  formatCssLengthPx,
  formatSolidQuadEntryMatrix,
} from "./atlas/matrix";
export {
  buildTextureEdgeRepairSets,
  resolveSeamBleed,
  normalizedSeamBleed,
  safePlanSeamBleedAmount,
  computePlanSeamBleedEdgeAmounts,
  seamBleedAmountArray,
  computeSeamBleedInsets,
  buildSeamBleedPolygonSet,
  buildSeamBleedPolygonEdges,
} from "./atlas/edgeRepair";
export {
  cachedParsePureColor,
  parseHex,
  rgbKey,
  parseAlpha,
  rgbToHex,
  textureTintFactors,
  tintToCss,
  shadePolygon,
  quantizeCssColor,
  rgbEqual,
  stepRgbToward,
  rgbToCss,
  colorErrorScore,
} from "./atlas/paintDefaults";
export {
  fullRectBounds,
  isFullRectSolid,
  isSolidTrianglePlan,
  isProjectiveQuadPlan,
  safariCssProjectiveUnsupported,
  incrementCount,
  dominantCountKey,
  filterAtlasPlans,
  getSolidPaintDefaultsForPlansCore,
} from "./atlas/strategy";
export type {
  FilterAtlasPlansEnv,
  GetSolidPaintDefaultsEnv,
} from "./atlas/strategy";
export {
  cssPoints,
  computeSurfaceNormal,
  isConvexPolygonPoints,
  signedArea2D,
  intersect2DLines,
  intersect2DLinesRaw,
  expandClipPoints,
  offsetConvexPolygonPoints,
  offsetConvexPolygonPointsByEdgeAmounts,
  offsetTrianglePoints,
  offsetStableTrianglePoints,
  stableBasisFromPlan,
  stableTriangleMatrixDecimals,
} from "./atlas/solidTriangle";
export {
  polygonContainsPoint,
  borderShapeBoundsFromPoints,
  borderShapeGeometryForPlan,
  simplifyCornerShapePoints,
  cornerShapePointSides,
  sharedCornerShapeSide,
  cornerShapeDiagonal,
  cornerShapeGeometryForPlan,
  cssBorderShapeForGeometry,
  cssBorderShapeForPlan,
  formatBorderShapeEntryMatrix,
  formatBorderShapeElementStyle,
  formatCornerShapeElementStyle,
} from "./atlas/borderShape";
export {
  computeSolidTriangleColorPlanFromNormal,
  computeSolidTriangleColorPlan,
  computeSolidTrianglePlan,
  computeSolidTrianglePlanFromCssPoints,
} from "./atlas/solidTrianglePlan";
export {
  resolveProjectiveQuadGuards,
  computeProjectiveQuadCoefficients,
  computeProjectiveQuadMatrix,
  dotVec,
  crossVec,
  isBasisOptimizable,
  getPolygonBasisInfo,
  compatibleSurface,
  compatibleBleedSurface,
  seamLightBrightness,
  basisAxisKey,
  makeLocalBasis,
  evaluateIslandAxis,
  chooseIslandXAxis,
  buildBasisHints,
  chooseLocalBasis,
  isFullRectBasis,
  computeUvAffine,
  computeUvSampleRect,
  projectTextureTriangle,
  computeTextureAtlasPlan,
  computeTextureAtlasPlanPublic,
} from "./atlas/plan";
export {
  normalizeAtlasScale,
  atlasArea,
  autoAtlasScaleCap,
  autoAtlasScale,
  atlasBitmapMaxSide,
  atlasDecodedBytes,
  autoAtlasBudgetFactor,
  autoAtlasMaxDecodedBytes,
  atlasCanonicalSizeForTextureQuality,
  applyPackedAtlasCanonicalSize,
  atlasCanonicalSizeForEntry,
  atlasPadding,
  packTextureAtlasPlans,
  packTextureAtlasPlansWithScaleCore,
} from "./atlas/packing";
