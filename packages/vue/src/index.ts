// Register DOM-based color resolver for named CSS colors
import { setColorResolver } from "@layoutit/voxcss-core";
import { resolveColor } from "./colorResolver";
setColorResolver(resolveColor);

export { VoxCamera } from "./VoxCamera";
export { VoxScene } from "./VoxScene";
export { VoxLayer } from "./VoxLayer";
export { VoxCube } from "./VoxCube";
export { VoxShape } from "./VoxShape";
export { useSliceBrushes, SliceZBrushes, SliceAxisHost } from "./VoxSliceRenderer";
export { useCamera } from "./composables/useCamera";
export type { UseCameraOptions, UseCameraResult } from "./composables/useCamera";
export { useSceneContext } from "./composables/useSceneContext";
export type { UseSceneContextOptions } from "./composables/useSceneContext";
export { VoxCameraContextKey } from "./context";
export type { VoxCameraContextValue } from "./context";
export { injectBaseStyles } from "./styles";

// Re-export commonly used core types for convenience
export type {
  Voxel,
  VoxelGrid,
  CubeFace,
  GridContext,
  ProjectionMode,
  WallsMask,
} from "@layoutit/voxcss-core";
export type { CameraState, AutoRotateOption } from "@layoutit/voxcss-core";
export type { MergeVoxelsOption } from "@layoutit/voxcss-core";
