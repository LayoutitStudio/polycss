import type {
  PolyMorphMat4,
  PolyMorphModel,
  PolyMorphRenderLeaf,
} from "../contracts/index.js";
import type {
  PolyOrthographicCameraHandle,
  PolyPerspectiveCameraHandle,
} from "@layoutit/polycss";

export type PolyMorphCamera =
  | PolyOrthographicCameraHandle
  | PolyPerspectiveCameraHandle;

export interface PolyMorphMountOptions {
  readonly camera?: PolyMorphCamera;
  readonly resolveResourceUrl?: (path: string) => string;
}

export interface PolyMorphShapeUpdate {
  readonly shapeId: string;
  readonly matrix: PolyMorphMat4;
}

export interface PolyMorphLeafUpdate {
  readonly leafId: string;
  readonly matrix?: PolyMorphMat4;
  readonly visible?: boolean;
  readonly opacity?: number;
  readonly atlasRow?: number;
}

export interface PolyMorphRetainedUpdate {
  readonly modelMatrix?: PolyMorphMat4;
  readonly shapes?: readonly PolyMorphShapeUpdate[];
  readonly leaves?: readonly PolyMorphLeafUpdate[];
}

export interface PolyMorphApplyResult {
  readonly modelTransformWrites: number;
  readonly shapeTransformWrites: number;
  readonly leafTransformWrites: number;
  readonly visibilityWrites: number;
  readonly opacityWrites: number;
  readonly atlasRowWrites: number;
  readonly dirtyLeavesVisited: number;
  readonly domCreations: 0;
  readonly domRemovals: 0;
  readonly topologyConstructions: 0;
  readonly atlasRedraws: 0;
  readonly schedulerCallbacks: 0;
}

export interface PolyMorphRenderStats {
  readonly mountCount: 1;
  readonly shapeRoots: number;
  readonly leafCount: number;
  readonly topologyConstructions: 1;
  readonly atlasConstructions: 0;
  readonly schedulerCount: 0;
  readonly applyCount: number;
  readonly totalTransformWrites: number;
  readonly totalVisibilityWrites: number;
  readonly totalOpacityWrites: number;
  readonly totalAtlasRowWrites: number;
}

export interface PolyMorphLeafHandle {
  readonly id: string;
  readonly plan: PolyMorphRenderLeaf;
  readonly element: HTMLElement;
}

export interface PolyMorphMountedModel {
  readonly model: PolyMorphModel;
  readonly camera: PolyMorphCamera;
  readonly cameraElement: HTMLElement;
  readonly sceneElement: HTMLElement;
  readonly modelElement: HTMLElement;
  readonly shapeElements: ReadonlyMap<string, HTMLElement>;
  readonly leafHandles: ReadonlyMap<string, PolyMorphLeafHandle>;
  readonly stats: PolyMorphRenderStats;
  readonly destroyed: boolean;
  apply(update: PolyMorphRetainedUpdate): PolyMorphApplyResult;
  updateCamera(): boolean;
  assertStableDomIdentity(): void;
  destroy(): void;
}
