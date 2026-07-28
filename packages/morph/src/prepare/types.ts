import type {
  PolyMorphAnimationClip,
  PolyMorphBudgets,
  PolyMorphControl,
  PolyMorphMat4,
  PolyMorphModel,
  PolyMorphProfile,
  PolyMorphSpring,
  PolyMorphVec3,
} from "../contracts/index.js";
import type {
  PolyMorphBuiltPackage,
  PolyMorphPackageManifest,
} from "../package/index.js";

export const POLY_MORPH_PREPARE_SCHEMA = "polycss-morph.prepare@1" as const;

export type PolyMorphPrepareProfile = Extract<
  PolyMorphProfile,
  "morph-regions" | "static-prepared"
>;

export interface PolyMorphPrepareSource {
  readonly path: string;
  readonly id: string;
  readonly kind: "authored" | "generated" | "open-data";
  readonly uri: string;
  readonly license: string;
}

export interface PolyMorphPrepareTransform {
  readonly axes: readonly ["x" | "y" | "z", "x" | "y" | "z", "x" | "y" | "z"];
  readonly signs: readonly [-1 | 1, -1 | 1, -1 | 1];
  readonly scale: number;
  readonly center: boolean;
}

export interface PolyMorphPrepareConfig {
  readonly schema: typeof POLY_MORPH_PREPARE_SCHEMA;
  readonly identity: {
    readonly id: string;
    readonly name: string;
    readonly revision: string;
  };
  readonly profile: PolyMorphPrepareProfile;
  readonly source: PolyMorphPrepareSource;
  readonly transform: PolyMorphPrepareTransform;
  readonly morphAliases: Readonly<Record<string, string>>;
  readonly controls: readonly PolyMorphControl[];
  readonly springs: readonly PolyMorphSpring[];
  readonly animations: readonly PolyMorphAnimationClip[];
  readonly budgets: PolyMorphBudgets;
}

export interface PolyMorphGltfMaterial {
  readonly sourceIndex: number;
  readonly name: string;
  readonly color: readonly [number, number, number, number];
}

export interface PolyMorphGltfTarget {
  readonly index: number;
  readonly name: string;
  readonly positionDeltas: readonly PolyMorphVec3[];
}

export interface PolyMorphGltfPrimitive {
  readonly primitiveIndex: number;
  readonly materialIndex: number;
  readonly positions: readonly PolyMorphVec3[];
  readonly triangles: readonly (readonly [number, number, number])[];
  readonly targets: readonly PolyMorphGltfTarget[];
}

export interface PolyMorphGltfInstance {
  readonly nodeIndex: number;
  readonly nodeName: string;
  readonly meshIndex: number;
  readonly meshName: string;
  readonly matrix: PolyMorphMat4;
  readonly primitives: readonly PolyMorphGltfPrimitive[];
}

export interface PolyMorphGltfDocument {
  readonly format: "glb" | "gltf";
  readonly sourceBytes: number;
  readonly sourceSha256: string;
  readonly contentSha256: string;
  readonly materials: readonly PolyMorphGltfMaterial[];
  readonly instances: readonly PolyMorphGltfInstance[];
}

export interface PolyMorphPreparedSource {
  readonly model: PolyMorphModel;
  readonly fallbackAtlasPages: readonly {
    readonly path: string;
    readonly width: number;
    readonly height: number;
    readonly bytes: Uint8Array;
  }[];
}

export interface PolyMorphPrepareOptions {
  readonly configPath: string;
  readonly outputRoot: string;
  readonly check?: boolean;
}

export interface PolyMorphPrepareReport {
  readonly config: PolyMorphPrepareConfig;
  readonly source: PolyMorphGltfDocument;
  readonly model: PolyMorphModel;
  readonly manifest: PolyMorphPackageManifest;
  readonly manifestSha256: string;
  readonly outputRoot: string;
  readonly files: readonly string[];
  readonly writeOrder: readonly string[];
  readonly checked: boolean;
  readonly changed: boolean;
}

export interface PolyMorphPreparedPackage {
  readonly source: PolyMorphGltfDocument;
  readonly prepared: PolyMorphPreparedSource;
  readonly package: PolyMorphBuiltPackage;
}
