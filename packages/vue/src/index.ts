// ── Components & composables ─────────────────────────────────────────────────

export { PolyCamera } from "./camera";
export type { PolyCameraProps } from "./camera";
export { PolyPerspectiveCamera } from "./camera";
export type { PolyPerspectiveCameraProps } from "./camera";
export { PolyOrthographicCamera } from "./camera";
export type { PolyOrthographicCameraProps } from "./camera";
export { usePolyCamera } from "./camera";
export type { UseCameraOptions, UseCameraResult } from "./camera";
export { PolyCameraContextKey } from "./camera";
export type { PolyCameraContextValue } from "./camera";

export { PolyScene } from "./scene";
export type { PolySceneProps } from "./scene";
export type { PolyRenderStrategy, PolyRenderStrategiesOption } from "@layoutit/polycss-core";
export { PolyMesh } from "./scene";
export type { PolyMeshProps } from "./scene";
export { PolyIframe } from "./scene";
export type { PolyIframeProps } from "./scene";
export { PolyGround } from "./scene";
export type { PolyGroundProps } from "./scene";
export { usePolySceneContext } from "./scene";
export type { UseSceneContextOptions, UseSceneContextResult } from "./scene";
export { usePolyMesh } from "./scene";
export type { UseMeshOptions, UseMeshResult } from "./scene";
export { usePolyMaterial } from "./scene/usePolyMaterial";

export { Poly } from "./shapes";
export type { PolyProps, PolyContext } from "./shapes";
export {
  PolyBox,
  PolyPlane,
  PolyRing,
  PolyOctahedron,
  PolySphere,
  PolyTetrahedron,
  PolyIcosahedron,
  PolyDodecahedron,
  PolyCylinder,
  PolyCone,
  PolyTorus,
} from "./shapes";
export type {
  PolyBoxProps,
  PolyPlaneProps,
  PolyRingProps,
  PolyOctahedronProps,
  PolySphereProps,
  PolyTetrahedronProps,
  PolyIcosahedronProps,
  PolyDodecahedronProps,
  PolyCylinderProps,
  PolyConeProps,
  PolyTorusProps,
} from "./shapes";

export { PolyOrbitControls, PolyMapControls, PolyTransformControls, PolyFirstPersonControls } from "./controls";
export type {
  PolyOrbitControlsProps,
  PolyOrbitControlsCamera,
  PolyMapControlsProps,
  PolyMapControlsCamera,
  PolyControlsAnimateOptions,
  PolyTransformControlsObject,
  PolyTransformControlsObjectChangeEvent,
  PolyTransformControlsProps,
  PolyFirstPersonControlsOptions,
  PolyFirstPersonControlsHandle,
} from "./controls";

export { PolySelect, usePolySelect, usePolySelectionApi, PolySelectionContextKey } from "./select";
export type { PolySelectionApi, PolySelectProps } from "./select";

export { findPolyMeshHandle, findMeshUnderPoint, pointInMeshElement } from "./scene/events";
export type {
  PolyMeshHandle,
  PolyPointerEvent,
  PolyMouseEvent,
  PolyWheelEvent,
  PolyEventHandler,
  InteractionProps,
} from "./scene/events";

export { PolyAxesHelper, PolyDirectionalLightHelper } from "./helpers";
export type {
  PolyAxesHelperProps,
  PolyDirectionalLightHelperProps,
} from "./helpers";

export { injectPolyBaseStyles } from "./styles";

export { collectPolyRenderStats } from "./renderStats";
export type {
  PolyRenderStats,
  PolyRenderStatsOptions,
  PolyRenderSurfaceLeafCounts,
} from "./renderStats";

export { usePolyAnimation } from "./animation/usePolyAnimation";
export type { UsePolyAnimationResultVue } from "./animation/usePolyAnimation";

// ── Re-exports from @layoutit/polycss-core ─────────────────────────────────────────────
export type {
  Polygon,
  PolyMaterial,
  Vec2,
  Vec3,
  PolyDirectionalLight,
  PolyAmbientLight,
  PolyTextureLightingMode,
  MeshResolution,
  ParseResult,
  ParseAnimationClip,
  ParseAnimationController,
  PolyAnimationClip,
  PolyAnimationAction,
  PolyAnimationMixer,
  PolyAnimationTarget,
  LoopMode,
  ObjParseOptions,
  GltfParseOptions,
  MtlParseResult,
  NormalizeResult,
  ParsedColor,
  TextureTriangle,
  PolygonFace,
  SceneBbox,
  SceneContext,
  SceneContextBuildArgs,
  SceneContextBuildResult,
  CameraState,
  CameraHandle,
  CameraStyleInput,
  AutoRotateOption,
  AutoRotateConfig,
  AxesHelperOptions,
  BoxFace,
  BoxFaceOptions,
  BoxPolygonsOptions,
  ArrowPolygonsOptions,
  RingPolygonsOptions,
  OctahedronPolygonsOptions,
  TetrahedronPolygonsOptions,
  IcosahedronPolygonsOptions,
  DodecahedronPolygonsOptions,
  CylinderPolygonsOptions,
  ConePolygonsOptions,
  TorusPolygonsOptions,
  PlanePolygonsOptions,
  LoadMeshOptions,
  VoxParseOptions,
  StlParseOptions,
  ParseStlColor,
  ParseStlSolid,
  ParseStlTopology,
  SolidTextureSampleOptions,
  TexturePaintMetrics,
  TexturePaintMetricsOptions,
  CoverPlanarPolygonsOptions,
  CullInteriorOptions,
  SeamFacetSplitCandidate,
  SeamFacetSplitCandidateReason,
  SeamFacetSplitOptions,
  SeamFacetSplitReport,
  SeamOverlapCandidate,
  SeamOverlapCandidateKind,
  SeamOverlapDiagnostics,
  SeamOverlapOptions,
  CameraCullNormalGroup,
  CameraCullRotation,
  OptimizeMeshPolygonsOptions,
  OptimizeMeshParseResultOptions,
  OptimizeAnimatedMeshPolygonsOptions,
  SimplifyTriangleMeshPolygonsOptions,
  PolyMeshTransformInput,
  PolySceneTransformInput,
} from "@layoutit/polycss-core";
export {
  CAMERA_BACKFACE_CULL_EPS,
  VOXEL_CAMERA_CULL_AXIS_EPS,
  VOXEL_CAMERA_CULL_NORMAL_LIMIT,
  normalizePolygons,
  mergePolygons,
  coverPlanarPolygons,
  optimizeMeshPolygons,
  optimizeMeshParseResult,
  simplifyTriangleMeshPolygons,
  repairMeshSeams,
  seamFacetSplitPolygons,
  seamFacetSplitReport,
  seamOverlapDiagnostics,
  seamOverlapPolygons,
  seamOverlapReport,
  cullInteriorPolygons,
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
  parseObj,
  parseMtl,
  parseGltf,
  parseStl,
  bakeSolidTextureSamples,
  bakeSolidTextureSampledPolygons,
  loadMesh,
  createIsometricCamera,
  parseVox,
  polygonFaces,
  computeTexturePaintMetrics,
  computeShapeLighting,
  parseColor,
  parsePureColor,
  parseHexColor,
  parseRgbColor,
  formatColor,
  clampChannel,
  shadeColor,
  rotateVec3,
  inverseRotateVec3,
  axesHelperPolygons,
  boxPolygons,
  arrowPolygons,
  ringPolygons,
  octahedronPolygons,
  tetrahedronPolygons,
  icosahedronPolygons,
  dodecahedronPolygons,
  cylinderPolygons,
  conePolygons,
  torusPolygons,
  planePolygons,
  buildSceneContext,
  buildPolyMeshTransform,
  buildPolySceneTransform,
  computeSceneBbox,
  BASE_TILE,
  DEFAULT_CAMERA_STATE,
  DEFAULT_PROJECTION,
  normalizeInvertMultiplier,
  createPolyAnimationMixer,
  optimizeAnimatedMeshPolygons,
  DEFAULT_SEAM_FACET_SPLIT_OPTIONS,
  DEFAULT_SEAM_OVERLAP_OPTIONS,
  LoopOnce,
  LoopRepeat,
  LoopPingPong,
  cssDistanceToWorld as polyCssDistanceToWorld,
  cssPositionToWorld as polyCssPositionToWorld,
  worldDistanceToCss as worldDistanceToPolyCss,
  worldDirectionToCss as worldDirectionToPolyCss,
  worldDirectionalLightToCss as worldDirectionalLightToPolyCss,
  worldPositionToCss as worldPositionToPolyCss,
} from "@layoutit/polycss-core";
