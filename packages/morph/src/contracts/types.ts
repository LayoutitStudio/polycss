export const POLY_MORPH_MODEL_SCHEMA = "polycss-morph.model@1" as const;
export const POLY_MORPH_CATALOG_SCHEMA = "polycss-morph.catalog@1" as const;
export const POLY_MORPH_PACKAGE_SCHEMA = "polycss-morph.package@1" as const;

export type PolyMorphProfile =
  | "joint-skin"
  | "morph-regions"
  | "prepared-playback"
  | "static-prepared";

export type PolyMorphCapability =
  | "animation"
  | "joint-skinning"
  | "morph-targets"
  | "prepared-playback"
  | "retained-render"
  | "semantic-controls"
  | "sparse-updates"
  | "springs";

export type PolyMorphVec3 = readonly [number, number, number];
export type PolyMorphQuat = readonly [number, number, number, number];
export type PolyMorphMat4 = readonly [
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
];
export type PolyMorphColor = readonly [number, number, number, number];

export interface PolyMorphModelIdentity {
  readonly id: string;
  readonly name: string;
  readonly revision: string;
}

export interface PolyMorphPolygon {
  readonly id: string;
  readonly vertexIndices: readonly number[];
  readonly normalIndices: readonly number[];
}

export interface PolyMorphTopology {
  readonly vertices: readonly PolyMorphVec3[];
  readonly normals: readonly PolyMorphVec3[];
  readonly polygons: readonly PolyMorphPolygon[];
}

export interface PolyMorphMaterial {
  readonly id: string;
  readonly color: PolyMorphColor;
}

export type PolyMorphRenderStrategy =
  | "atlas-slice"
  | "direct-image"
  | "solid-quad"
  | "solid-triangle";

export interface PolyMorphAtlasSlice {
  readonly resourcePath: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly pageWidth: number;
  readonly pageHeight: number;
}

export interface PolyMorphRenderShape {
  readonly id: string;
  readonly matrix: PolyMorphMat4;
}

export interface PolyMorphRenderFallback {
  readonly width: number;
  readonly height: number;
  readonly matrixFromLeaf: PolyMorphMat4;
  readonly atlas: PolyMorphAtlasSlice;
}

export interface PolyMorphRenderLeaf {
  readonly id: string;
  readonly polygonId: string;
  readonly shapeId: string;
  readonly materialId: string;
  readonly strategy: PolyMorphRenderStrategy;
  readonly width: number;
  readonly height: number;
  readonly matrix: PolyMorphMat4;
  readonly atlas: PolyMorphAtlasSlice | null;
  readonly fallback: PolyMorphRenderFallback | null;
}

export interface PolyMorphRenderPlan {
  readonly modelMatrix: PolyMorphMat4;
  readonly shapes: readonly PolyMorphRenderShape[];
  readonly leaves: readonly PolyMorphRenderLeaf[];
}

export interface PolyMorphSparseDelta {
  readonly vertexIndex: number;
  readonly position: PolyMorphVec3 | null;
  readonly normal: PolyMorphVec3 | null;
}

export interface PolyMorphTarget {
  readonly id: string;
  readonly deltas: readonly PolyMorphSparseDelta[];
}

export interface PolyMorphNoDeformation {
  readonly kind: "none";
}

export interface PolyMorphRegionDeformation {
  readonly kind: "morph-regions";
  readonly targets: readonly PolyMorphTarget[];
}

export interface PolyMorphJoint {
  readonly id: string;
  readonly parentId: string | null;
  readonly restMatrix: PolyMorphMat4;
  readonly inverseBindMatrix: PolyMorphMat4;
}

export interface PolyMorphJointInfluence {
  readonly jointId: string;
  readonly weight: number;
}

export interface PolyMorphSkinVertex {
  readonly vertexIndex: number;
  readonly influences: readonly PolyMorphJointInfluence[];
}

export interface PolyMorphJointDeformation {
  readonly kind: "joint-skin";
  readonly joints: readonly PolyMorphJoint[];
  readonly vertices: readonly PolyMorphSkinVertex[];
}

export type PolyMorphDeformation =
  | PolyMorphJointDeformation
  | PolyMorphNoDeformation
  | PolyMorphRegionDeformation;

export interface PolyMorphControlTarget {
  readonly targetId: string;
  readonly scale: number;
}

export interface PolyMorphControl {
  readonly id: string;
  readonly anchor: PolyMorphVec3;
  readonly axis: PolyMorphVec3;
  readonly radius: number;
  readonly minimum: number;
  readonly maximum: number;
  readonly initial: number;
  readonly targets: readonly PolyMorphControlTarget[];
}

export interface PolyMorphSpring {
  readonly id: string;
  readonly controlId: string;
  readonly stiffness: number;
  readonly damping: number;
}

export type PolyMorphAnimationTarget =
  | "control-value"
  | "joint-rotation"
  | "joint-scale"
  | "joint-translation"
  | "morph-weight"
  | "shape-matrix";

export interface PolyMorphAnimationChannel {
  readonly target: PolyMorphAnimationTarget;
  readonly targetId: string;
  readonly interpolation: "linear" | "step";
  readonly timesMs: readonly number[];
  readonly values: readonly (readonly number[])[];
}

export interface PolyMorphAnimationClip {
  readonly id: string;
  readonly durationMs: number;
  readonly loop: boolean;
  readonly channels: readonly PolyMorphAnimationChannel[];
}

export interface PolyMorphPlaybackShapeUpdate {
  readonly shapeId: string;
  readonly matrix: PolyMorphMat4;
}

export interface PolyMorphPlaybackLeafUpdate {
  readonly leafId: string;
  readonly matrix: PolyMorphMat4 | null;
  readonly visible: boolean | null;
  readonly opacity: number | null;
  readonly atlasRow: number | null;
}

export interface PolyMorphPlaybackFrame {
  readonly timeMs: number;
  readonly modelMatrix: PolyMorphMat4 | null;
  readonly shapes: readonly PolyMorphPlaybackShapeUpdate[];
  readonly leaves: readonly PolyMorphPlaybackLeafUpdate[];
}

export interface PolyMorphPlayback {
  readonly durationMs: number;
  readonly loop: boolean;
  readonly frames: readonly PolyMorphPlaybackFrame[];
}

export interface PolyMorphBudgets {
  readonly maxVertices: number;
  readonly maxPolygons: number;
  readonly maxLeaves: number;
  readonly maxFrames: number;
  readonly maxJoints: number;
  readonly maxResources: number;
  readonly maxBytes: number;
}

export interface PolyMorphProvenanceSource {
  readonly id: string;
  readonly kind: "authored" | "generated" | "open-data";
  readonly uri: string;
  readonly sha256: string | null;
  readonly license: string;
}

export interface PolyMorphProvenance {
  readonly generator: string;
  readonly generatorVersion: string;
  readonly sources: readonly PolyMorphProvenanceSource[];
}

export interface PolyMorphModel {
  readonly schema: typeof POLY_MORPH_MODEL_SCHEMA;
  readonly identity: PolyMorphModelIdentity;
  readonly profile: PolyMorphProfile;
  readonly capabilities: readonly PolyMorphCapability[];
  readonly budgets: PolyMorphBudgets;
  readonly topology: PolyMorphTopology;
  readonly materials: readonly PolyMorphMaterial[];
  readonly render: PolyMorphRenderPlan;
  readonly deformation: PolyMorphDeformation;
  readonly controls: readonly PolyMorphControl[];
  readonly springs: readonly PolyMorphSpring[];
  readonly animations: readonly PolyMorphAnimationClip[];
  readonly playback: PolyMorphPlayback | null;
  readonly provenance: PolyMorphProvenance;
}
