import {
  POLY_MORPH_MODEL_SCHEMA,
  type PolyMorphJointDeformation,
  type PolyMorphMat4,
  type PolyMorphModel,
  type PolyMorphPlayback,
  type PolyMorphProfile,
  type PolyMorphRegionDeformation,
} from "../contracts/index.js";
import type { PolyMorphDeepMutable } from "./mutable.js";

export const POLY_MORPH_IDENTITY_MATRIX: PolyMorphMat4 = [
  1, 0, 0, 0,
  0, 1, 0, 0,
  0, 0, 1, 0,
  0, 0, 0, 1,
];

// Fresh mutable identity matrix for tests that write individual cells.
// (Spreading the readonly constant widens to number[], losing the tuple.)
export function polyMorphIdentityMatrix(): PolyMorphDeepMutable<PolyMorphMat4> {
  return [
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    0, 0, 0, 1,
  ];
}

export function clonePolyMorphFixture<T>(value: T): PolyMorphDeepMutable<T> {
  return JSON.parse(JSON.stringify(value)) as PolyMorphDeepMutable<T>;
}

// Profile-narrowed fixture shapes so tests can probe the profile-specific
// deformation/playback sections without re-narrowing the union at every site.
export interface PolyMorphRegionModelFixture extends PolyMorphModel {
  readonly deformation: PolyMorphRegionDeformation;
}

export interface PolyMorphJointModelFixture extends PolyMorphModel {
  readonly deformation: PolyMorphJointDeformation;
}

export interface PolyMorphPlaybackModelFixture extends PolyMorphModel {
  readonly playback: PolyMorphPlayback;
}

export function createPolyMorphModelFixture(
  profile: "morph-regions",
): PolyMorphRegionModelFixture;
export function createPolyMorphModelFixture(
  profile: "joint-skin",
): PolyMorphJointModelFixture;
export function createPolyMorphModelFixture(
  profile: "prepared-playback",
): PolyMorphPlaybackModelFixture;
export function createPolyMorphModelFixture(
  profile?: PolyMorphProfile,
): PolyMorphModel;
export function createPolyMorphModelFixture(
  profile: PolyMorphProfile = "static-prepared",
): PolyMorphModel {
  const base: PolyMorphModel = {
    schema: POLY_MORPH_MODEL_SCHEMA,
    identity: {
      id: "morph-gem",
      name: "Morph Gem",
      revision: "1.0.0",
    },
    profile,
    capabilities: ["retained-render"],
    budgets: {
      maxVertices: 16,
      maxPolygons: 8,
      maxLeaves: 8,
      maxFrames: 8,
      maxJoints: 8,
      maxResources: 4,
      maxBytes: 1_000_000,
    },
    topology: {
      vertices: [
        [0, 0, 0],
        [1, 0, 0],
        [0, 1, 0],
      ],
      normals: [
        [0, 0, 1],
        [0, 0, 1],
        [0, 0, 1],
      ],
      polygons: [
        {
          id: "gem-panel",
          vertexIndices: [0, 1, 2],
          normalIndices: [0, 1, 2],
        },
      ],
    },
    materials: [
      {
        id: "amber",
        color: [1, 0.5, 0.1, 1],
      },
    ],
    render: {
      modelMatrix: POLY_MORPH_IDENTITY_MATRIX,
      shapes: [
        {
          id: "gem",
          matrix: POLY_MORPH_IDENTITY_MATRIX,
        },
      ],
      leaves: [
        {
          id: "gem-panel-leaf",
          polygonId: "gem-panel",
          shapeId: "gem",
          materialId: "amber",
          strategy: "solid-triangle",
          width: 32,
          height: 32,
          matrix: POLY_MORPH_IDENTITY_MATRIX,
          atlas: null,
          fallback: null,
        },
      ],
    },
    deformation: { kind: "none" },
    controls: [],
    springs: [],
    animations: [],
    playback: null,
    provenance: {
      generator: "polycss-morph",
      generatorVersion: "1.0.0",
      sources: [
        {
          id: "authored-gem",
          kind: "authored",
          uri: "urn:polycss:morph-gem",
          sha256: null,
          license: "MIT",
        },
      ],
    },
  };
  if (profile === "morph-regions") {
    return {
      ...base,
      capabilities: ["morph-targets", "retained-render", "sparse-updates"],
      deformation: {
        kind: "morph-regions",
        targets: [
          {
            id: "stretch",
            deltas: [
              {
                vertexIndex: 2,
                position: [0, 0.5, 0],
                normal: null,
              },
            ],
          },
        ],
      },
    };
  }
  if (profile === "joint-skin") {
    return {
      ...base,
      capabilities: ["joint-skinning", "retained-render", "sparse-updates"],
      deformation: {
        kind: "joint-skin",
        joints: [
          {
            id: "root",
            parentId: null,
            restMatrix: POLY_MORPH_IDENTITY_MATRIX,
            inverseBindMatrix: POLY_MORPH_IDENTITY_MATRIX,
          },
          {
            id: "tip",
            parentId: "root",
            restMatrix: POLY_MORPH_IDENTITY_MATRIX,
            inverseBindMatrix: POLY_MORPH_IDENTITY_MATRIX,
          },
        ],
        vertices: [
          {
            vertexIndex: 0,
            influences: [{ jointId: "root", weight: 1 }],
          },
          {
            vertexIndex: 1,
            influences: [{ jointId: "root", weight: 0.5 }, { jointId: "tip", weight: 0.5 }],
          },
          {
            vertexIndex: 2,
            influences: [{ jointId: "tip", weight: 1 }],
          },
        ],
      },
    };
  }
  if (profile === "prepared-playback") {
    return {
      ...base,
      capabilities: ["prepared-playback", "retained-render", "sparse-updates"],
      playback: {
        durationMs: 1000,
        loop: true,
        frames: [
          {
            timeMs: 0,
            modelMatrix: null,
            shapes: [],
            leaves: [
              {
                leafId: "gem-panel-leaf",
                matrix: null,
                visible: true,
                opacity: 1,
                atlasRow: null,
              },
            ],
          },
        ],
      },
    };
  }
  return base;
}
