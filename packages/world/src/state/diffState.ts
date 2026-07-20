import type { PolyWorldIdDiff, PolyWorldState, PolyWorldStateDiff } from "./types";

export function diffPolyWorldState(
  previous: PolyWorldState,
  next: PolyWorldState,
): PolyWorldStateDiff {
  return {
    previous,
    next,
    changed: previous.signature !== next.signature,
    previousSignature: previous.signature,
    nextSignature: next.signature,
    regions: diffIds(previous.selectedRegionIds, next.selectedRegionIds),
    links: diffIds(previous.selectedLinkIds, next.selectedLinkIds),
    selectionKeys: diffIds(previous.selectedSelectionKeys, next.selectedSelectionKeys),
    selectedElements: diffIds(previous.selectedElementIds, next.selectedElementIds),
    sourceIds: diffIds(previous.selectedSourceIds, next.selectedSourceIds),
    aliases: diffIds(previous.selectedAliases, next.selectedAliases),
    resolvedElements: diffIds(previous.resolvedElementIds, next.resolvedElementIds),
    layers: diffIds(previous.layers, next.layers),
  };
}

export function diffPolyWorldIds(
  previousIds: readonly string[],
  nextIds: readonly string[],
): PolyWorldIdDiff {
  return diffIds(previousIds, nextIds);
}

function diffIds(previousIds: readonly string[], nextIds: readonly string[]): PolyWorldIdDiff {
  const previous = new Set(previousIds);
  const next = new Set(nextIds);
  return {
    added: nextIds.filter((id) => !previous.has(id)),
    removed: previousIds.filter((id) => !next.has(id)),
    retained: nextIds.filter((id) => previous.has(id)),
  };
}
