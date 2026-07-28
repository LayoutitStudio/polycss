import type {
  PolyMorphMat4,
  PolyMorphModel,
  PolyMorphVec3,
} from "../../contracts/index.js";
import type { PolyMorphLeafUpdate } from "../../render/index.js";

export interface PolyMorphDeformationInput {
  readonly tick: number;
  readonly morphWeights?: Readonly<Record<string, number>>;
  readonly controlValues?: Readonly<Record<string, number>>;
}

export interface PolyMorphDeformationFrame {
  readonly tick: number;
  readonly positions: readonly PolyMorphVec3[];
  readonly normals: readonly PolyMorphVec3[];
  readonly morphWeights: Readonly<Record<string, number>>;
  readonly controlValues: Readonly<Record<string, number>>;
  readonly dirtyLeafIds: readonly string[];
  readonly leafUpdates: readonly PolyMorphLeafUpdate[];
  readonly runtimePolygonConstructions: 0;
  readonly runtimeTopologyConstructions: 0;
  readonly atlasRedraws: 0;
}

export interface PolyMorphDeformationRuntime {
  readonly model: PolyMorphModel;
  readonly targetIds: readonly string[];
  readonly controlIds: readonly string[];
  readonly basePositions: readonly PolyMorphVec3[];
  readonly baseNormals: readonly PolyMorphVec3[];
  sample(input: PolyMorphDeformationInput): PolyMorphDeformationFrame;
  reset(): void;
}

export interface PolyMorphPreparedLeafMatrix {
  readonly leafId: string;
  readonly matrix: PolyMorphMat4 | null;
  readonly visible: boolean;
}
