// @layoutit/voxcss-html — CSS-based voxel rendering engine for the browser

// Re-export core types and utilities for convenience
export type {
  Voxel,
  VoxelGrid,
  CubeFace,
  GridContext,
  ProjectionMode
} from "@layoutit/voxcss-core/types";
export type { AutoRotateOption } from "@layoutit/voxcss-core/camera/camera";
export type { MergeVoxelsOption } from "@layoutit/voxcss-core/merge/mergeVoxelsOption";
export type { MagicaVoxelParseResult } from "@layoutit/voxcss-core/parser/parseMagicaVoxel";

export { parseMagicaVoxel } from "@layoutit/voxcss-core/parser/parseMagicaVoxel";
export { mergeVoxels } from "@layoutit/voxcss-core/merge/mergeVoxels";
export {
  normalizeMergeVoxelsOption,
  is2dMerge,
  is3dMerge
} from "@layoutit/voxcss-core/merge/mergeVoxelsOption";
export { sceneController } from "@layoutit/voxcss-core/controller/sceneController";
export type { SceneController, SceneControllerOptions } from "@layoutit/voxcss-core/controller/sceneController";
export { createIsometricCamera } from "@layoutit/voxcss-core/camera/camera";

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
  ensureCameraController,
  CAMERA_HOST_CLASS
} from "./bindings/domBindings";
export type {
  CameraComponentProps,
  CameraSlotProps,
  CameraBindingSnapshot
} from "./bindings/domBindings";

export { rgbaToPngBlob, rgbToPngBlob } from "./pngBlob";
