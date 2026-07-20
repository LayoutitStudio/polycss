import type {
  PolyWorldElement,
  PolyWorldElementResolution,
  PolyWorldElementResolutionOptions,
  PolyWorldSelection,
  PolyWorldTopology,
  PolyWorldUnresolvedSelection,
  PolyWorldValidationDiagnostic,
} from "../topology";
import { resolvePolyWorldElements } from "../topology";
import { limitPolyWorldDebugList } from "./limits";

export interface PolyWorldDebugSnapshotOptions {
  preparedOnly?: boolean;
  listLimit?: number;
  metadata?: Record<string, unknown>;
  resolution?: PolyWorldElementResolution;
  resolutionOptions?: PolyWorldElementResolutionOptions;
  validationDiagnostics?: readonly PolyWorldValidationDiagnostic[];
}

export interface PolyWorldDebugSnapshot {
  schemaVersion: 1;
  preparedOnly: boolean;
  topology: {
    regionCount: number;
    linkCount: number;
    elementCount: number;
  };
  selection: {
    regionIds: readonly string[];
    linkIds: readonly string[];
    selectionKeys: readonly string[];
    elementIds: readonly string[];
    sourceIds: readonly string[];
    aliases: readonly string[];
    reasonLabels: readonly string[];
    counts: {
      regions: number;
      links: number;
      selectionKeys: number;
      elementIds: number;
      sourceIds: number;
      aliases: number;
      reasonLabels: number;
    };
    omitted: {
      regionIds: number;
      linkIds: number;
      selectionKeys: number;
      elementIds: number;
      sourceIds: number;
      aliases: number;
      reasonLabels: number;
    };
  };
  elements: {
    elementIds: readonly string[];
    count: number;
    omittedElementIds: number;
    byKind: Record<string, number>;
    byLayer: Record<string, number>;
    byTag: Record<string, number>;
    relations: {
      parentElementIds: readonly string[];
      containerElementIds: readonly string[];
      parentCount: number;
      containerCount: number;
      omittedParentElementIds: number;
      omittedContainerElementIds: number;
    };
  };
  unresolved: PolyWorldUnresolvedSelection;
  validationDiagnostics: readonly PolyWorldValidationDiagnostic[];
  metadata?: Record<string, unknown>;
}

export function createPolyWorldDebugSnapshot(
  topology: PolyWorldTopology,
  selection: PolyWorldSelection,
  options: PolyWorldDebugSnapshotOptions = {},
): PolyWorldDebugSnapshot {
  const resolution = options.resolution ?? resolvePolyWorldElements(topology, selection, options.resolutionOptions);
  const selectedRegionIds = unique(selection.regionIds);
  const selectedLinkIds = unique(selection.linkIds);
  const selectedSelectionKeys = unique(selection.selectionKeys);
  const selectedElementIds = unique(selection.elementIds);
  const selectedSourceIds = unique(selection.sourceIds);
  const selectedAliases = unique(selection.aliases);
  const reasonLabels = unique(selection.reasons?.map((reason) => reason.label));
  const limitedRegionIds = limitPolyWorldDebugList(selectedRegionIds, options.listLimit);
  const limitedLinkIds = limitPolyWorldDebugList(selectedLinkIds, options.listLimit);
  const limitedSelectionKeys = limitPolyWorldDebugList(selectedSelectionKeys, options.listLimit);
  const limitedElementIds = limitPolyWorldDebugList(selectedElementIds, options.listLimit);
  const limitedSourceIds = limitPolyWorldDebugList(selectedSourceIds, options.listLimit);
  const limitedAliases = limitPolyWorldDebugList(selectedAliases, options.listLimit);
  const limitedReasonLabels = limitPolyWorldDebugList(reasonLabels, options.listLimit);
  const limitedResolutionElementIds = limitPolyWorldDebugList(resolution.elementIds, options.listLimit);
  const parentElementIds = unique(resolution.elements.flatMap((element) => element.parentId === undefined ? [] : [element.parentId]));
  const containerElementIds = unique(resolution.elements.flatMap((element) => element.containerId === undefined ? [] : [element.containerId]));
  const limitedParentElementIds = limitPolyWorldDebugList(parentElementIds, options.listLimit);
  const limitedContainerElementIds = limitPolyWorldDebugList(containerElementIds, options.listLimit);

  return {
    schemaVersion: 1,
    preparedOnly: options.preparedOnly ?? false,
    topology: {
      regionCount: topology.regions.length,
      linkCount: topology.links.length,
      elementCount: topology.elements.length,
    },
    selection: {
      regionIds: limitedRegionIds.values,
      linkIds: limitedLinkIds.values,
      selectionKeys: limitedSelectionKeys.values,
      elementIds: limitedElementIds.values,
      sourceIds: limitedSourceIds.values,
      aliases: limitedAliases.values,
      reasonLabels: limitedReasonLabels.values,
      counts: {
        regions: selectedRegionIds.length,
        links: selectedLinkIds.length,
        selectionKeys: selectedSelectionKeys.length,
        elementIds: selectedElementIds.length,
        sourceIds: selectedSourceIds.length,
        aliases: selectedAliases.length,
        reasonLabels: reasonLabels.length,
      },
      omitted: {
        regionIds: limitedRegionIds.omitted,
        linkIds: limitedLinkIds.omitted,
        selectionKeys: limitedSelectionKeys.omitted,
        elementIds: limitedElementIds.omitted,
        sourceIds: limitedSourceIds.omitted,
        aliases: limitedAliases.omitted,
        reasonLabels: limitedReasonLabels.omitted,
      },
    },
    elements: {
      elementIds: limitedResolutionElementIds.values,
      count: resolution.elements.length,
      omittedElementIds: limitedResolutionElementIds.omitted,
      byKind: countElements(resolution.elements, (element) => element.kind),
      byLayer: countElementValues(resolution.elements, (element) => element.layers),
      byTag: countElementValues(resolution.elements, (element) => element.tags),
      relations: {
        parentElementIds: limitedParentElementIds.values,
        containerElementIds: limitedContainerElementIds.values,
        parentCount: parentElementIds.length,
        containerCount: containerElementIds.length,
        omittedParentElementIds: limitedParentElementIds.omitted,
        omittedContainerElementIds: limitedContainerElementIds.omitted,
      },
    },
    unresolved: resolution.unresolved,
    validationDiagnostics: [...(options.validationDiagnostics ?? [])],
    metadata: options.metadata,
  };
}

export function adaptPolyWorldDebugSnapshot<T>(
  snapshot: PolyWorldDebugSnapshot,
  adapter: (snapshot: PolyWorldDebugSnapshot) => T,
): T {
  return adapter(snapshot);
}

function countElements(
  elements: readonly PolyWorldElement[],
  resolveKey: (element: PolyWorldElement) => string | undefined,
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const element of elements) {
    const key = resolveKey(element);
    if (key === undefined) continue;
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return sortRecord(counts);
}

function countElementValues(
  elements: readonly PolyWorldElement[],
  resolveValues: (element: PolyWorldElement) => readonly string[] | undefined,
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const element of elements) {
    for (const value of resolveValues(element) ?? []) {
      counts[value] = (counts[value] ?? 0) + 1;
    }
  }
  return sortRecord(counts);
}

function sortRecord(values: Record<string, number>): Record<string, number> {
  return Object.fromEntries(Object.entries(values).sort(([a], [b]) => compareStrings(a, b)));
}

function unique(values: readonly string[] | undefined): string[] {
  return [...new Set(values ?? [])];
}

function compareStrings(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}
