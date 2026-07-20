import type { PolyWorldElement, PolyWorldSelection, PolyWorldTopology } from "../topology";
import { resolvePolyWorldElements } from "../topology";
import type { PolyWorldState, PolyWorldStateInput } from "./types";

export function createPolyWorldState(
  topology: PolyWorldTopology,
  input: PolyWorldStateInput = {},
): PolyWorldState {
  const selection: PolyWorldSelection = input.selection ?? selectionFromResolution(input.resolution);
  const resolution = input.resolution ?? resolvePolyWorldElements(topology, selection, input.resolutionOptions);
  const selectedRegionIds = uniqueSorted(resolution.selectedRegionIds);
  const selectedLinkIds = uniqueSorted(resolution.selectedLinkIds);
  const selectedSelectionKeys = uniqueSorted(resolution.selectedSelectionKeys);
  const selectedElementIds = uniqueSorted(resolution.selectedElementIds);
  const selectedSourceIds = uniqueSorted(resolution.selectedSourceIds);
  const selectedAliases = uniqueSorted(resolution.selectedAliases);
  const resolvedElementIds = uniqueSorted(resolution.elementIds);
  const layers = uniqueSorted([
    ...(input.layers ?? []),
    ...resolution.elements.flatMap((element) => element.layers ?? []),
  ]);
  const reasonLabels = uniqueSorted(selection.reasons?.map((reason) => reason.label));
  const selectionSignature = signature([
    ["regions", selectedRegionIds],
    ["links", selectedLinkIds],
    ["keys", selectedSelectionKeys],
    ["elements", selectedElementIds],
    ["sources", selectedSourceIds],
    ["aliases", selectedAliases],
  ]);
  const elementSignature = resolvedElementIds.join(",");
  const layerSignature = layers.join(",");

  return {
    id: input.id,
    selectedRegionIds,
    selectedLinkIds,
    selectedSelectionKeys,
    selectedElementIds,
    selectedSourceIds,
    selectedAliases,
    resolvedElementIds,
    layers,
    reasonLabels,
    unresolved: {
      regionIds: uniqueSorted(resolution.unresolved.regionIds),
      linkIds: uniqueSorted(resolution.unresolved.linkIds),
      selectionKeys: uniqueSorted(resolution.unresolved.selectionKeys),
      elementIds: uniqueSorted(resolution.unresolved.elementIds),
      sourceIds: uniqueSorted(resolution.unresolved.sourceIds),
      aliases: uniqueSorted(resolution.unresolved.aliases),
    },
    selectionSignature,
    elementSignature,
    layerSignature,
    signature: signature([
      ["selection", [selectionSignature]],
      ["elements", [elementSignature]],
      ["layers", [layerSignature]],
    ]),
    data: input.data,
  };
}

export function snapshotPolyWorldState(state: PolyWorldState): PolyWorldState {
  return {
    ...state,
    selectedRegionIds: [...state.selectedRegionIds],
    selectedLinkIds: [...state.selectedLinkIds],
    selectedSelectionKeys: [...state.selectedSelectionKeys],
    selectedElementIds: [...state.selectedElementIds],
    selectedSourceIds: [...state.selectedSourceIds],
    selectedAliases: [...state.selectedAliases],
    resolvedElementIds: [...state.resolvedElementIds],
    layers: [...state.layers],
    reasonLabels: [...state.reasonLabels],
    unresolved: {
      regionIds: [...state.unresolved.regionIds],
      linkIds: [...state.unresolved.linkIds],
      selectionKeys: [...state.unresolved.selectionKeys],
      elementIds: [...state.unresolved.elementIds],
      sourceIds: [...state.unresolved.sourceIds],
      aliases: [...state.unresolved.aliases],
    },
  };
}

export function collectPolyWorldElementLayers(elements: readonly PolyWorldElement[]): string[] {
  return uniqueSorted(elements.flatMap((element) => element.layers ?? []));
}

function selectionFromResolution(resolution: PolyWorldStateInput["resolution"]): PolyWorldSelection {
  return {
    regionIds: resolution?.selectedRegionIds ?? [],
    linkIds: resolution?.selectedLinkIds ?? [],
    selectionKeys: resolution?.selectedSelectionKeys ?? [],
    elementIds: resolution?.selectedElementIds ?? [],
    sourceIds: resolution?.selectedSourceIds ?? [],
    aliases: resolution?.selectedAliases ?? [],
  };
}

function signature(parts: readonly [string, readonly string[]][]): string {
  return parts.map(([name, values]) => `${name}=${values.join(",")}`).join("|");
}

function uniqueSorted(values: readonly string[] | undefined): string[] {
  return [...new Set(values ?? [])].sort(compareStrings);
}

function compareStrings(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}
