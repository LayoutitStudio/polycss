// @layoutit/voxcss — CSS-based voxel rendering engine for the browser

// Re-export core types and utilities for convenience
export type {
  Voxel,
  VoxelGrid,
  CubeFace,
  GridContext,
  ProjectionMode
} from "@voxcss-core/types";
export type { AutoRotateOption } from "@voxcss-core/camera/camera";
export type { MergeVoxelsOption } from "@voxcss-core/merge/mergeVoxelsOption";
export type { MagicaVoxelParseResult } from "@voxcss-core/parser/parseMagicaVoxel";

export { parseMagicaVoxel } from "@voxcss-core/parser/parseMagicaVoxel";
export { mergeVoxels } from "@voxcss-core/merge/mergeVoxels";
export {
  normalizeMergeVoxelsOption,
  is2dMerge,
  is3dMerge
} from "@voxcss-core/merge/mergeVoxelsOption";
export { sceneController } from "@voxcss-core/controller/sceneController";
export type { SceneController, SceneControllerOptions } from "@voxcss-core/controller/sceneController";
export { createIsometricCamera } from "@voxcss-core/camera/camera";

// HTML-specific exports
export {
  createCamera,
  createScene,
  renderScene
} from "./headless";
export type {
  HeadlessCameraOptions,
  HeadlessCameraHandle,
  HeadlessCameraConfig,
  HeadlessSceneOptions,
  HeadlessSceneConfig,
  HeadlessRenderOptions,
  HeadlessRenderHandle
} from "./headless";

export {
  mountScene,
  normalizeSceneState,
  SCENE_HOST_CLASS
} from "./bindings/sceneBindings";
export type { SceneState, SceneComponentProps } from "./bindings/sceneBindings";

export {
  mountCameraBinding,
  CAMERA_HOST_CLASS
} from "./bindings/domBindings";
export type {
  CameraComponentProps,
  CameraSlotProps,
  CameraBindingSnapshot
} from "./bindings/domBindings";
