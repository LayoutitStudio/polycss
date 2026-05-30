import type {
  MeshResolution,
  PolyRenderStrategy,
  PolyTextureLightingMode,
  Vec3 as ReactVec3,
} from "@layoutit/polycss-react";
import type { TextureQuality } from "@layoutit/polycss";

// Shared types used by GalleryWorkbench and scene components.

export type GizmoMode = "translate" | "rotate";

export type DragMode = "orbit" | "pan" | "fpv";

export type PerspectiveMode = "perspective" | "orthographic";

export const POLYCSS_DEFAULT_PERSPECTIVE = 32000;

export type WorkbenchMeshResolution = MeshResolution | "disabled";

export type BuilderGridTone = "gray" | "dark";

export function activeMeshResolution(meshResolution: WorkbenchMeshResolution): MeshResolution {
  return meshResolution === "disabled" ? "lossy" : meshResolution;
}

export function meshResolutionShowsMesh(meshResolution: WorkbenchMeshResolution): boolean {
  return meshResolution !== "disabled";
}

export interface DomMetrics {
  measuredAt: number;
  nodeCount: number;
  sprites: number;
  rects: number;
  triangles: number;
  irregular: number;
  overpaintPercent: number;
}

export interface SceneOptionsState {
  renderer: "react" | "vanilla";
  animationPaused: boolean;
  animationTimeScale: number;
  autoCenter: boolean;
  interactive: boolean;
  animate: boolean;
  showAxes: boolean;
  selection: boolean;
  hoverEffects: boolean;
  showLight: boolean;
  zoom: number;
  rotX: number;
  rotY: number;
  perspective: number | false | undefined;
  lightAzimuth: number;
  lightElevation: number;
  lightIntensity: number;
  lightColor: string;
  ambientIntensity: number;
  ambientColor: string;
  textureLighting: PolyTextureLightingMode;
  textureQuality: TextureQuality;
  solidMaterials: boolean;
  matrixPrecision: "exact" | "2" | "3" | "4" | "5" | "6";
  borderShapePrecision: "exact" | "2" | "3" | "4" | "5" | "6";
  meshResolution: WorkbenchMeshResolution;
  interiorFill: boolean;
  outlinePolygons: boolean;
  dragMode: "orbit" | "pan" | "fpv";
  target: ReactVec3;
  disableStrategies: PolyRenderStrategy[];
  castShadow: boolean;
  /** Maximum CSS pixels the shadow may extend beyond the mesh footprint.
   *  Caps the SVG backing store at low light elevations. */
  shadowMaxExtend: number;
  showGround: boolean;
  groundColor: string;
  fpvLook: boolean;
  fpvMove: boolean;
  fpvJump: boolean;
  fpvCrouch: boolean;
  fpvMoveSpeed: number;
  fpvJumpVelocity: number;
  fpvGravity: number;
  fpvEyeHeight: number;
  fpvCrouchHeight: number;
  fpvLookSensitivity: number;
  fpvInvertY: boolean;
  /** Distance-based mesh culling in FPV mode. Meshes farther than this
   *  many world units from the camera origin are unmounted. 0 disables
   *  culling (render everything). */
  fpvRenderDistance: number;
  /** Builder placement: snap the ghost to the floor grid before
   *  committing. */
  snapToGrid: boolean;
  /** Grid resolution in world units (cell side length). Drives both
   *  the rendered grid and snap-to-grid rounding. */
  gridResolution: number;
  /** Builder-only grid line color preset. */
  gridTone: BuilderGridTone;
}
