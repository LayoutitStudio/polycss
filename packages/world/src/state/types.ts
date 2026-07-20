import type {
  PolyWorldData,
  PolyWorldElementResolution,
  PolyWorldElementResolutionOptions,
  PolyWorldSelection,
  PolyWorldUnresolvedSelection,
} from "../topology";

export interface PolyWorldStateInput {
  id?: string;
  selection?: PolyWorldSelection;
  resolution?: PolyWorldElementResolution;
  resolutionOptions?: PolyWorldElementResolutionOptions;
  layers?: readonly string[];
  data?: PolyWorldData;
}

export interface PolyWorldState {
  id?: string;
  selectedRegionIds: readonly string[];
  selectedLinkIds: readonly string[];
  selectedSelectionKeys: readonly string[];
  selectedElementIds: readonly string[];
  selectedSourceIds: readonly string[];
  selectedAliases: readonly string[];
  resolvedElementIds: readonly string[];
  layers: readonly string[];
  reasonLabels: readonly string[];
  unresolved: PolyWorldUnresolvedSelection;
  selectionSignature: string;
  elementSignature: string;
  layerSignature: string;
  signature: string;
  data?: PolyWorldData;
}

export type PolyWorldStateSnapshot = PolyWorldState;

export interface PolyWorldIdDiff {
  added: readonly string[];
  removed: readonly string[];
  retained: readonly string[];
}

export interface PolyWorldStateDiff {
  previous: PolyWorldState;
  next: PolyWorldState;
  changed: boolean;
  previousSignature: string;
  nextSignature: string;
  regions: PolyWorldIdDiff;
  links: PolyWorldIdDiff;
  selectionKeys: PolyWorldIdDiff;
  selectedElements: PolyWorldIdDiff;
  sourceIds: PolyWorldIdDiff;
  aliases: PolyWorldIdDiff;
  resolvedElements: PolyWorldIdDiff;
  layers: PolyWorldIdDiff;
}
