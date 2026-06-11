/**
 * PolyCSS — vanilla / custom-elements / imperative entry point.
 *
 * Public surface:
 *   - `createPolyScene(host, options)` — imperative scene API
 *   - `PolySceneElement`, `PolyMeshElement`, `PolyPolygonElement` —
 *     custom element classes (importing this entry does NOT auto-register
 *     them; use `@layoutit/polycss/elements` for that side effect).
 *   - Re-exports everything from `@layoutit/polycss-core` so vanilla users only
 *     need `npm install @layoutit/polycss`.
 */

// ── Imperative scene API ──────────────────────────────────────────
export { createPolyScene } from "./api/createPolyScene";
export type {
  PolySceneHandle,
  PolyMeshHandle,
  PolyMeshTransform,
  PolySceneOptions,
} from "./api/createPolyScene";
export {
  buildPolyMeshTransform,
  buildPolySceneTransform,
  cssDistanceToWorld,
  cssDistanceToWorld as polyCssDistanceToWorld,
  cssPositionToWorld,
  cssPositionToWorld as polyCssPositionToWorld,
  worldDistanceToCss,
  worldDistanceToCss as worldDistanceToPolyCss,
  worldDirectionalLightToCss as worldDirectionalLightToPolyCss,
  worldDirectionToPolyCss,
  worldPositionToPolyCss,
} from "@layoutit/polycss-core";
export type {
  PolyMeshTransformInput,
  PolySceneTransformInput,
} from "@layoutit/polycss-core";

// ── Camera factories ──────────────────────────────────────────────
export { createPolyPerspectiveCamera, createPolyOrthographicCamera, createPolyCamera } from "./api/createPolyCamera";
export type {
  PolyCameraOptions,
  PolyPerspectiveCameraOptions,
  PolyOrthographicCameraOptions,
  PolyPerspectiveCameraHandle,
  PolyOrthographicCameraHandle,
} from "./api/createPolyCamera";

// ── Camera input (additive, optional layers) ──────────────────────
export { createPolyOrbitControls } from "./api/createPolyOrbitControls";
export type {
  PolyOrbitControlsOptions,
  PolyOrbitControlsHandle,
} from "./api/createPolyOrbitControls";

export { createPolyMapControls } from "./api/createPolyMapControls";
export type {
  PolyMapControlsOptions,
  PolyMapControlsHandle,
} from "./api/createPolyMapControls";

export { createPolyFirstPersonControls } from "./api/createPolyFirstPersonControls";
export type {
  PolyFirstPersonControlsOptions,
  PolyFirstPersonControlsHandle,
} from "./api/createPolyFirstPersonControls";

export type {
  PolyControlsHandle,
  PolyControlsBaseOptions,
  PolyControlsAnimateOptions,
  PolyControlsCamera,
  PolyControlsChangeEvent,
  PolyControlsInteractionEvent,
  PolyControlsEvent,
  PolyControlsListener,
} from "./api/controls/common";

// ── Mesh selection (additive, optional layer) ─────────────────────
export { createSelect } from "./api/createSelect";
export type { PolySelectOptions, PolySelectionHandle } from "./api/createSelect";

// ── Transform gizmo (additive, optional layer) ────────────────────
export { createTransformControls } from "./api/createTransformControls";
export type {
  PolyTransformControlsOptions,
  PolyTransformControlsHandle,
  PolyTransformControlsObjectChangeEvent,
} from "./api/createTransformControls";

// ── Custom element classes (without auto-registering — that's @layoutit/polycss/elements) ──
export { PolySceneElement } from "./elements/PolySceneElement";
export { PolyMeshElement } from "./elements/PolyMeshElement";
export { PolyIframeElement } from "./elements/PolyIframeElement";
export { PolyPolygonElement } from "./elements/PolyPolygonElement";
export { PolyOrbitControlsElement } from "./elements/PolyOrbitControlsElement";
export { PolyMapControlsElement } from "./elements/PolyMapControlsElement";
export { PolyFirstPersonControlsElement } from "./elements/PolyFirstPersonControlsElement";
export { PolyPerspectiveCameraElement } from "./elements/PolyPerspectiveCameraElement";
export { PolyOrthographicCameraElement } from "./elements/PolyOrthographicCameraElement";
export { PolyCameraElement } from "./elements/PolyCameraElement";
export { PolyTransformControlsElement } from "./elements/PolyTransformControlsElement";
export { PolySelectElement } from "./elements/PolySelectElement";

// ── Render strategy options ───────────────────────────────────────
export type {
  PolyRenderStrategy,
  PolyRenderStrategiesOption,
  TextureQuality,
  TextureAtlasPlan,
  PackedTextureAtlasEntry,
  TextureAtlasPage,
  ComputeTextureAtlasPlanOptions,
  SolidPaintDefaults,
  RenderedPoly,
  RenderTextureAtlasOptions,
  RenderTextureAtlasResult,
  RenderTextureAtlasAsyncResult,
  SolidTriangleFrame,
} from "./render/textureAtlas";
export {
  isSolidTrianglePlan,
  isProjectiveQuadPlan,
  isFullRectSolid,
  buildTextureEdgeRepairSets,
  computeTextureAtlasPlanPublic,
  getSolidPaintDefaultsFromPlans,
  getSolidPaintDefaults,
  cssBorderShapeForPlan,
  formatMatrix3d,
  formatCssLengthPx,
  formatSolidQuadEntryMatrix,
  formatBorderShapeEntryMatrix,
  isBorderShapeSupported,
  isSolidTriangleSupported,
  filterAtlasPlans,
  packTextureAtlasPlansWithScale,
  buildAtlasPages,
  renderPolygonsWithTextureAtlas,
  renderPolygonsWithTextureAtlasAsync,
  updateStableTriangleFrame,
  renderPolygonsWithStableTriangles,
  updatePolygonsWithStableTriangles,
  updatePolygonsWithStableTopology,
} from "./render/textureAtlas";
export type {
  PackedAtlas,
  PackedPage,
} from "./render/textureAtlas";

// ── Render diagnostics ───────────────────────────────────────────
export { collectPolyRenderStats } from "./render/renderStats";
export type {
  PolyRenderStats,
  PolyRenderStatsOptions,
  PolyRenderSurfaceLeafCounts,
} from "./render/renderStats";

// ── Standalone scene snapshots ───────────────────────────────────
export {
  exportPolySceneSnapshot,
  PolySceneSnapshotError,
} from "./snapshot/exportPolySceneSnapshot";
export type {
  PolySceneSnapshotErrorCode,
} from "./snapshot/exportPolySceneSnapshot";

// ── Primitive shape factories ─────────────────────────────────────
export {
  createPolyBox,
  createPolyPlane,
  createPolyRing,
  createPolyOctahedron,
  createPolySphere,
  createPolyTetrahedron,
  createPolyIcosahedron,
  createPolyDodecahedron,
  createPolyCylinder,
  createPolyCone,
  createPolyTorus,
} from "./api/createPolyShapes";
export type { PolyShapeResult } from "./api/createPolyShapes";

// ── Primitive shape element classes ──────────────────────────────
export {
  PolyBoxElement,
  PolyPlaneElement,
  PolyRingElement,
  PolyOctahedronElement,
  PolySphereElement,
  PolyTetrahedronElement,
  PolyIcosahedronElement,
  PolyDodecahedronElement,
  PolyCylinderElement,
  PolyConeElement,
  PolyTorusElement,
} from "./elements/PolyShapeElements";

// ── Style injection ───────────────────────────────────────────────
export { injectPolyBaseStyles } from "./styles/styles";

// ── Re-exports from @layoutit/polycss-core ─────────────────────────────────
export * from "@layoutit/polycss-core";
