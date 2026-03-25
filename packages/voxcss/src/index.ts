export {
  sceneController,
  type SceneController,
  type SceneControllerOptions
} from "../../core/src/controller/sceneController";

export {
  mountScene,
  normalizeSceneState,
  SCENE_HOST_CLASS,
  type SceneState,
  type SceneComponentProps
} from "../../html/src/bindings/sceneBindings";

export {
  mountCameraBinding,
  CAMERA_HOST_CLASS,
  type CameraComponentProps,
  type CameraSlotProps,
  type CameraBindingSnapshot
} from "../../html/src/bindings/domBindings";

export {
  createCamera,
  createScene,
  renderScene,
  type HeadlessCameraOptions,
  type HeadlessCameraHandle,
  type HeadlessCameraConfig,
  type HeadlessSceneOptions,
  type HeadlessSceneConfig,
  type HeadlessRenderOptions,
  type HeadlessRenderHandle
} from "../../html/src/headless";

export { type AutoRotateOption } from "../../core/src/camera/camera";
export type { ProjectionMode, VoxelGrid } from "../../core/src/types";
export { parseMagicaVoxel, type MagicaVoxelParseResult } from "../../core/src/parser/parseMagicaVoxel";
export { mergeVoxels } from "../../core/src/merge/mergeVoxels";
export {
  normalizeMergeVoxelsOption,
  is2dMerge,
  is3dMerge,
  type MergeVoxelsOption
} from "../../core/src/merge/mergeVoxelsOption";
