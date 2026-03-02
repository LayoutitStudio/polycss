// @layoutit/voxcss-core — Pure-math voxel rendering engine (zero browser globals)

export type {
  Voxel,
  VoxelGrid,
  CubeFace,
  GridContext,
  WallsMask,
  OffsetMap,
  RenderState,
  ProjectionMode
} from "./types";
export { CUBE_FACES, DEFAULT_WALLS, DEFAULT_OFFSETS, BASE_TILE, SCENE_CLASS } from "./types";

export { buildSceneContext, getVoxelBounds } from "./scene/context";
export { computeVisibleFaces } from "./scene/visibility";

export { createIsometricCamera, normalizeInvertMultiplier } from "./camera/camera";
export type { CameraState, AutoRotateOption } from "./camera/camera";

export {
  parseColor,
  shadeColor,
  shadeCubeFace,
  shadeWallFace,
  getCubeFaceLightDelta,
  computeShapeLighting
} from "./color/lighting";
export type { ParsedColor, ShapeType, ShapeSurfaceLighting } from "./color/lighting";

export {
  parsePureColor,
  parseHexColor,
  parseRgbColor,
  clampChannel,
  formatColor
} from "./color/color";

export {
  computeCubeFaceAppearance,
  getCubeFaceAppearanceSignature,
  applyCubeFaceAppearance
} from "./color/faceAppearance";
export type { CubeFaceAppearance } from "./color/faceAppearance";

export { mergeVoxels } from "./merge/mergeVoxels";
export {
  normalizeMergeVoxelsOption,
  is2dMerge,
  is3dMerge
} from "./merge/mergeVoxelsOption";
export type { MergeVoxelsOption } from "./merge/mergeVoxelsOption";

export {
  buildSlicePlan,
  buildFaceDataFromSnapshot,
  buildSliceCacheKey,
  buffersEqual,
  holeFillVariants,
  runRects,
  mergeAlignedRects,
  verify,
  wallsToSig,
  SLICE_RENDERER_VERSION,
  AXIS_ORDER,
  FACE_ORDER,
  NEXT_LAYER_STEP
} from "./merge/slicePlanner";
export type {
  PlaneAxis,
  FaceKey,
  FaceBuffer,
  FaceData,
  Brush,
  SlicePlan
} from "./merge/slicePlanner";

export { parseMagicaVoxel } from "./parser/parseMagicaVoxel";
export type { MagicaVoxelParseResult } from "./parser/parseMagicaVoxel";

export {
  encodeRgbaToPng,
  encodeRgbToPng,
  rgbaToPngBlob,
  rgbToPngBlob
} from "./encoding/png";

export {
  sceneController
} from "./controller/sceneController";
export type {
  SceneController,
  SceneControllerOptions
} from "./controller/sceneController";
