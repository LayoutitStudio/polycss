import type {
  PolyWorldElement,
  PolyWorldElementMatch,
  PolyWorldElementResolution,
  PolyWorldElementResolutionOptions,
  PolyWorldSelection,
  PolyWorldTopology,
  PolyWorldUnresolvedSelection,
} from "./types";

export function resolvePolyWorldElements(
  topology: PolyWorldTopology,
  selection: PolyWorldSelection,
  options: PolyWorldElementResolutionOptions = {},
): PolyWorldElementResolution {
  const selectedRegionIds = unique(selection.regionIds);
  const selectedLinkIds = unique(selection.linkIds);
  const selectedSelectionKeys = unique(selection.selectionKeys);
  const selectedElementIds = unique(selection.elementIds);
  const selectedSourceIds = unique(selection.sourceIds);
  const selectedAliases = unique(selection.aliases);
  const selectedRegionIdSet = new Set(selectedRegionIds);
  const selectedSelectionKeySet = new Set(selectedSelectionKeys);
  const selectedElementIdSet = new Set(selectedElementIds);
  const selectedSourceIdSet = new Set(selectedSourceIds);
  const selectedAliasSet = new Set(selectedAliases);
  const layerFilter = options.layers === undefined ? undefined : new Set(options.layers);
  const tagFilter = options.tags === undefined ? undefined : new Set(options.tags);
  const resolved: Array<{
    element: PolyWorldElement;
    elementId: string;
    matches: PolyWorldElementMatch[];
  }> = [];

  for (const element of topology.elements) {
    if (!passesFilter(element.layers, layerFilter)) continue;
    if (!passesFilter(element.tags, tagFilter)) continue;

    const matches = collectElementMatches(
      element,
      selectedRegionIdSet,
      selectedSelectionKeySet,
      selectedElementIdSet,
      selectedSourceIdSet,
      selectedAliasSet,
    );
    if (matches.length > 0) {
      resolved.push({
        element,
        elementId: element.id,
        matches,
      });
    }
  }

  return {
    elements: resolved.map((entry) => entry.element),
    elementIds: resolved.map((entry) => entry.elementId),
    resolved,
    unresolved: unresolvedSelection(topology, {
      regionIds: selectedRegionIds,
      linkIds: selectedLinkIds,
      selectionKeys: selectedSelectionKeys,
      elementIds: selectedElementIds,
      sourceIds: selectedSourceIds,
      aliases: selectedAliases,
    }),
    selectedRegionIds,
    selectedLinkIds,
    selectedSelectionKeys,
    selectedElementIds,
    selectedSourceIds,
    selectedAliases,
  };
}

function collectElementMatches(
  element: PolyWorldElement,
  regionIds: ReadonlySet<string>,
  selectionKeys: ReadonlySet<string>,
  elementIds: ReadonlySet<string>,
  sourceIds: ReadonlySet<string>,
  aliases: ReadonlySet<string>,
): PolyWorldElementMatch[] {
  const matches: PolyWorldElementMatch[] = [];

  if (elementIds.has(element.id)) {
    matches.push({ kind: "elementId", value: element.id });
  }

  for (const sourceId of element.sourceIds ?? []) {
    if (sourceIds.has(sourceId)) matches.push({ kind: "sourceId", value: sourceId });
  }

  for (const alias of element.aliases ?? []) {
    if (aliases.has(alias)) matches.push({ kind: "alias", value: alias });
  }

  for (const selectionKey of element.selectionKeys ?? []) {
    if (selectionKeys.has(selectionKey)) matches.push({ kind: "selectionKey", value: selectionKey });
  }

  const elementRegionIds = element.regionIds ?? [];
  if (elementRegionIds.length > 0 && regionIds.size > 0) {
    const regionMatch = element.regionMatch ?? "any";
    if (regionMatch === "all") {
      const allRegionsSelected = elementRegionIds.every((regionId) => regionIds.has(regionId));
      if (allRegionsSelected) {
        for (const regionId of elementRegionIds) {
          matches.push({ kind: "region", value: regionId });
        }
      }
    } else {
      for (const regionId of elementRegionIds) {
        if (regionIds.has(regionId)) matches.push({ kind: "region", value: regionId });
      }
    }
  }

  return matches;
}

function unresolvedSelection(
  topology: PolyWorldTopology,
  selection: PolyWorldUnresolvedSelection,
): PolyWorldUnresolvedSelection {
  return {
    regionIds: selection.regionIds.filter((regionId) => !topology.regionsById.has(regionId)),
    linkIds: selection.linkIds.filter((linkId) => !topology.linksById.has(linkId)),
    selectionKeys: selection.selectionKeys.filter((selectionKey) => !topology.selectionKeyOwnersByKey.has(selectionKey)),
    elementIds: selection.elementIds.filter((elementId) => !topology.elementsById.has(elementId)),
    sourceIds: selection.sourceIds.filter((sourceId) => !topology.elementsBySourceId.has(sourceId)),
    aliases: selection.aliases.filter((alias) => !topology.elementsByAlias.has(alias)),
  };
}

function passesFilter(values: readonly string[] | undefined, filter: ReadonlySet<string> | undefined): boolean {
  if (filter === undefined) return true;
  if (values === undefined) return false;
  return values.some((value) => filter.has(value));
}

function unique(values: readonly string[] | undefined): string[] {
  return [...new Set(values ?? [])];
}
