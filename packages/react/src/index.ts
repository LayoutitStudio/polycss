// Register DOM-based color resolver for named CSS colors
import { setColorResolver } from "@layoutit/voxcss-core";
import { resolveColor } from "./colorResolver";
setColorResolver(resolveColor);

export { VoxCamera } from "./VoxCamera";
export type { VoxCameraProps } from "./VoxCamera";
export { VoxScene } from "./VoxScene";
export type { VoxSceneProps } from "./VoxScene";
export { useSliceBrushes, SliceZBrushes, SliceAxisHost } from "./VoxSliceRenderer";
export type { VoxSliceRendererProps, SliceBrushData } from "./VoxSliceRenderer";
export { VoxLayer } from "./VoxLayer";
export { VoxCube } from "./VoxCube";
export { VoxShape } from "./VoxShape";
export { useCamera } from "./useCamera";
export type { UseCameraOptions, UseCameraResult } from "./useCamera";
export { useSceneContext } from "./useSceneContext";
export type { UseSceneContextOptions } from "./useSceneContext";
export { VoxCameraContext, useCameraContext } from "./context";
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
