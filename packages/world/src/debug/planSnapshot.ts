import type { PolyWorldLayerPlan, PolyWorldPlanActionCounts, PolyWorldPlanEntry } from "../planner";
import type {
  PolyWorldResourceLoadSetSummary,
  PolyWorldResourceReadinessState,
  PolyWorldResourceReadinessSummary,
} from "../planner/resources";
import { diffPolyWorldIds } from "../state";
import type { PolyWorldIdDiff, PolyWorldState, PolyWorldStateDiff } from "../state";
import type { PolyWorldSelection, PolyWorldUnresolvedSelection } from "../topology";
import { limitPolyWorldDebugList } from "./limits";

export interface PolyWorldPlanDebugSnapshotOptions {
  appliedState?: PolyWorldState;
  planningSelection?: PolyWorldSelection;
  includeEntries?: boolean;
  entryLimit?: number;
  listLimit?: number;
  readiness?: PolyWorldResourceReadinessSummary;
  loadSet?: PolyWorldResourceLoadSetSummary;
  metadata?: Record<string, unknown>;
}

export interface PolyWorldPlanDebugIdDiff {
  added: readonly string[];
  removed: readonly string[];
  retained: readonly string[];
  counts: {
    added: number;
    removed: number;
    retained: number;
  };
  omitted: {
    added: number;
    removed: number;
    retained: number;
  };
}

export interface PolyWorldPlanDebugStateSummary {
  id?: string;
  signature: string;
  selectionSignature: string;
  elementSignature: string;
  layerSignature: string;
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
  counts: {
    regions: number;
    links: number;
    selectionKeys: number;
    selectedElements: number;
    sourceIds: number;
    aliases: number;
    resolvedElements: number;
    layers: number;
    reasonLabels: number;
  };
  omitted: {
    selectedRegionIds: number;
    selectedLinkIds: number;
    selectedSelectionKeys: number;
    selectedElementIds: number;
    selectedSourceIds: number;
    selectedAliases: number;
    resolvedElementIds: number;
    layers: number;
    reasonLabels: number;
  };
}

export interface PolyWorldPlanDebugSelectionSummary {
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
    elements: number;
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
}

export interface PolyWorldPlanDebugAppliedComparison {
  state: PolyWorldPlanDebugStateSummary;
  matchesNext: boolean;
  matchesResolvedElements: boolean;
  matchesLayers: boolean;
  missingElementIds: readonly string[];
  extraElementIds: readonly string[];
  missingLayers: readonly string[];
  extraLayers: readonly string[];
  counts: {
    missingElementIds: number;
    extraElementIds: number;
    missingLayers: number;
    extraLayers: number;
  };
  omitted: {
    missingElementIds: number;
    extraElementIds: number;
    missingLayers: number;
    extraLayers: number;
  };
}

export interface PolyWorldPlanDebugResourceReadinessSummary {
  resourceIds: readonly string[];
  readyResourceIds: readonly string[];
  missingResourceIds: readonly string[];
  requestedResourceIds: readonly string[];
  loadingResourceIds: readonly string[];
  failedResourceIds: readonly string[];
  staleResourceIds: readonly string[];
  renderBlockingResourceIds: readonly string[];
  preloadOnlyResourceIds: readonly string[];
  nonBlockingResourceIds: readonly string[];
  blockedResourceIds: readonly string[];
  blockedElementIds: readonly string[];
  counts: {
    resources: number;
    readyResources: number;
    missingResources: number;
    requestedResources: number;
    loadingResources: number;
    failedResources: number;
    staleResources: number;
    renderBlockingResources: number;
    preloadOnlyResources: number;
    nonBlockingResources: number;
    blockedResources: number;
    blockedElements: number;
  };
  omitted: {
    resourceIds: number;
    readyResourceIds: number;
    missingResourceIds: number;
    requestedResourceIds: number;
    loadingResourceIds: number;
    failedResourceIds: number;
    staleResourceIds: number;
    renderBlockingResourceIds: number;
    preloadOnlyResourceIds: number;
    nonBlockingResourceIds: number;
    blockedResourceIds: number;
    blockedElementIds: number;
  };
  stateCounts: Readonly<Record<PolyWorldResourceReadinessState, number>>;
}

export interface PolyWorldPlanDebugResourceLoadSetSummary {
  previousResourceIds: readonly string[];
  nextResourceIds: readonly string[];
  requestResourceIds: readonly string[];
  retainResourceIds: readonly string[];
  releaseCandidateResourceIds: readonly string[];
  readyButNotVisibleResourceIds: readonly string[];
  preloadOnlyResourceIds: readonly string[];
  renderBlockingResourceIds: readonly string[];
  staleAllowedResourceIds: readonly string[];
  nonBlockingResourceIds: readonly string[];
  blockedResourceIds: readonly string[];
  blockedElementIds: readonly string[];
  counts: {
    previousResources: number;
    nextResources: number;
    requestResources: number;
    retainResources: number;
    releaseCandidateResources: number;
    readyButNotVisibleResources: number;
    preloadOnlyResources: number;
    renderBlockingResources: number;
    staleAllowedResources: number;
    nonBlockingResources: number;
    blockedResources: number;
    blockedElements: number;
  };
  omitted: {
    previousResourceIds: number;
    nextResourceIds: number;
    requestResourceIds: number;
    retainResourceIds: number;
    releaseCandidateResourceIds: number;
    readyButNotVisibleResourceIds: number;
    preloadOnlyResourceIds: number;
    renderBlockingResourceIds: number;
    staleAllowedResourceIds: number;
    nonBlockingResourceIds: number;
    blockedResourceIds: number;
    blockedElementIds: number;
  };
}

export interface PolyWorldPlanDebugSnapshot {
  schemaVersion: 1;
  changed: boolean;
  planningSelection?: PolyWorldPlanDebugSelectionSummary;
  previous: PolyWorldPlanDebugStateSummary;
  next: PolyWorldPlanDebugStateSummary;
  diff: {
    regions: PolyWorldPlanDebugIdDiff;
    links: PolyWorldPlanDebugIdDiff;
    selectionKeys: PolyWorldPlanDebugIdDiff;
    selectedElements: PolyWorldPlanDebugIdDiff;
    sourceIds: PolyWorldPlanDebugIdDiff;
    aliases: PolyWorldPlanDebugIdDiff;
    resolvedElements: PolyWorldPlanDebugIdDiff;
    layers: PolyWorldPlanDebugIdDiff;
  };
  plan: {
    previousSignature: string;
    nextSignature: string;
    changed: boolean;
    entryCount: number;
    includedEntryCount: number;
    omittedEntryCount: number;
    blockedEntryCount: number;
    guardFailureEntryCount: number;
    dependencyFailureEntryCount: number;
    actionCounts: PolyWorldPlanActionCounts;
    layerCounts: Readonly<Record<string, PolyWorldPlanActionCounts>>;
    entries?: readonly PolyWorldPlanEntry[];
  };
  readiness?: PolyWorldPlanDebugResourceReadinessSummary;
  loadSet?: PolyWorldPlanDebugResourceLoadSetSummary;
  applied?: PolyWorldPlanDebugAppliedComparison;
  metadata?: Record<string, unknown>;
}

export function createPolyWorldPlanDebugSnapshot(
  diff: PolyWorldStateDiff,
  plan: PolyWorldLayerPlan,
  options: PolyWorldPlanDebugSnapshotOptions = {},
): PolyWorldPlanDebugSnapshot {
  const limitedEntries = options.includeEntries === false
    ? undefined
    : limitPolyWorldDebugList(plan.entries, options.entryLimit);

  return {
    schemaVersion: 1,
    changed: diff.changed,
    planningSelection: options.planningSelection === undefined
      ? undefined
      : summarizeSelection(options.planningSelection, options.listLimit),
    previous: summarizeState(diff.previous, options.listLimit),
    next: summarizeState(diff.next, options.listLimit),
    diff: {
      regions: summarizeDiff(diff.regions, options.listLimit),
      links: summarizeDiff(diff.links, options.listLimit),
      selectionKeys: summarizeDiff(diff.selectionKeys, options.listLimit),
      selectedElements: summarizeDiff(diff.selectedElements, options.listLimit),
      sourceIds: summarizeDiff(diff.sourceIds, options.listLimit),
      aliases: summarizeDiff(diff.aliases, options.listLimit),
      resolvedElements: summarizeDiff(diff.resolvedElements, options.listLimit),
      layers: summarizeDiff(diff.layers, options.listLimit),
    },
    plan: {
      previousSignature: plan.previousSignature,
      nextSignature: plan.nextSignature,
      changed: plan.changed,
      entryCount: plan.entries.length,
      includedEntryCount: limitedEntries?.values.length ?? 0,
      omittedEntryCount: limitedEntries?.omitted ?? plan.entries.length,
      blockedEntryCount: plan.entries.filter((entry) => entry.blocked === true).length,
      guardFailureEntryCount: plan.entries.filter((entry) => hasFailedCheck(entry.guards)).length,
      dependencyFailureEntryCount: plan.entries.filter((entry) => hasFailedCheck(entry.dependencies)).length,
      actionCounts: plan.actionCounts,
      layerCounts: plan.layerCounts,
      entries: limitedEntries?.values,
    },
    readiness: options.readiness === undefined
      ? undefined
      : summarizeReadiness(options.readiness, options.listLimit),
    loadSet: options.loadSet === undefined
      ? undefined
      : summarizeLoadSet(options.loadSet, options.listLimit),
    applied: options.appliedState === undefined
      ? undefined
      : compareAppliedState(diff.next, options.appliedState, options.listLimit),
    metadata: options.metadata,
  };
}

function summarizeReadiness(
  readiness: PolyWorldResourceReadinessSummary,
  listLimit: number | undefined,
): PolyWorldPlanDebugResourceReadinessSummary {
  const resourceIds = limitPolyWorldDebugList(readiness.resourceIds, listLimit);
  const readyResourceIds = limitPolyWorldDebugList(readiness.readyResourceIds, listLimit);
  const missingResourceIds = limitPolyWorldDebugList(readiness.missingResourceIds, listLimit);
  const requestedResourceIds = limitPolyWorldDebugList(readiness.requestedResourceIds, listLimit);
  const loadingResourceIds = limitPolyWorldDebugList(readiness.loadingResourceIds, listLimit);
  const failedResourceIds = limitPolyWorldDebugList(readiness.failedResourceIds, listLimit);
  const staleResourceIds = limitPolyWorldDebugList(readiness.staleResourceIds, listLimit);
  const renderBlockingResourceIds = limitPolyWorldDebugList(readiness.renderBlockingResourceIds, listLimit);
  const preloadOnlyResourceIds = limitPolyWorldDebugList(readiness.preloadOnlyResourceIds, listLimit);
  const nonBlockingResourceIds = limitPolyWorldDebugList(readiness.nonBlockingResourceIds, listLimit);
  const blockedResourceIds = limitPolyWorldDebugList(readiness.blockedResourceIds, listLimit);
  const blockedElementIds = limitPolyWorldDebugList(readiness.blockedElementIds, listLimit);
  return {
    resourceIds: resourceIds.values,
    readyResourceIds: readyResourceIds.values,
    missingResourceIds: missingResourceIds.values,
    requestedResourceIds: requestedResourceIds.values,
    loadingResourceIds: loadingResourceIds.values,
    failedResourceIds: failedResourceIds.values,
    staleResourceIds: staleResourceIds.values,
    renderBlockingResourceIds: renderBlockingResourceIds.values,
    preloadOnlyResourceIds: preloadOnlyResourceIds.values,
    nonBlockingResourceIds: nonBlockingResourceIds.values,
    blockedResourceIds: blockedResourceIds.values,
    blockedElementIds: blockedElementIds.values,
    counts: {
      resources: readiness.resourceIds.length,
      readyResources: readiness.readyResourceIds.length,
      missingResources: readiness.missingResourceIds.length,
      requestedResources: readiness.requestedResourceIds.length,
      loadingResources: readiness.loadingResourceIds.length,
      failedResources: readiness.failedResourceIds.length,
      staleResources: readiness.staleResourceIds.length,
      renderBlockingResources: readiness.renderBlockingResourceIds.length,
      preloadOnlyResources: readiness.preloadOnlyResourceIds.length,
      nonBlockingResources: readiness.nonBlockingResourceIds.length,
      blockedResources: readiness.blockedResourceIds.length,
      blockedElements: readiness.blockedElementIds.length,
    },
    omitted: {
      resourceIds: resourceIds.omitted,
      readyResourceIds: readyResourceIds.omitted,
      missingResourceIds: missingResourceIds.omitted,
      requestedResourceIds: requestedResourceIds.omitted,
      loadingResourceIds: loadingResourceIds.omitted,
      failedResourceIds: failedResourceIds.omitted,
      staleResourceIds: staleResourceIds.omitted,
      renderBlockingResourceIds: renderBlockingResourceIds.omitted,
      preloadOnlyResourceIds: preloadOnlyResourceIds.omitted,
      nonBlockingResourceIds: nonBlockingResourceIds.omitted,
      blockedResourceIds: blockedResourceIds.omitted,
      blockedElementIds: blockedElementIds.omitted,
    },
    stateCounts: {
      ready: readiness.readyResourceIds.length,
      missing: readiness.missingResourceIds.length,
      requested: readiness.requestedResourceIds.length,
      loading: readiness.loadingResourceIds.length,
      failed: readiness.failedResourceIds.length,
      stale: readiness.staleResourceIds.length,
    },
  };
}

function summarizeLoadSet(
  loadSet: PolyWorldResourceLoadSetSummary,
  listLimit: number | undefined,
): PolyWorldPlanDebugResourceLoadSetSummary {
  const previousResourceIds = limitPolyWorldDebugList(loadSet.previousResourceIds, listLimit);
  const nextResourceIds = limitPolyWorldDebugList(loadSet.nextResourceIds, listLimit);
  const requestResourceIds = limitPolyWorldDebugList(loadSet.requestResourceIds, listLimit);
  const retainResourceIds = limitPolyWorldDebugList(loadSet.retainResourceIds, listLimit);
  const releaseCandidateResourceIds = limitPolyWorldDebugList(loadSet.releaseCandidateResourceIds, listLimit);
  const readyButNotVisibleResourceIds = limitPolyWorldDebugList(loadSet.readyButNotVisibleResourceIds, listLimit);
  const preloadOnlyResourceIds = limitPolyWorldDebugList(loadSet.preloadOnlyResourceIds, listLimit);
  const renderBlockingResourceIds = limitPolyWorldDebugList(loadSet.renderBlockingResourceIds, listLimit);
  const staleAllowedResourceIds = limitPolyWorldDebugList(loadSet.staleAllowedResourceIds, listLimit);
  const nonBlockingResourceIds = limitPolyWorldDebugList(loadSet.nonBlockingResourceIds, listLimit);
  const blockedResourceIds = limitPolyWorldDebugList(loadSet.blockedResourceIds, listLimit);
  const blockedElementIds = limitPolyWorldDebugList(loadSet.blockedElementIds, listLimit);
  return {
    previousResourceIds: previousResourceIds.values,
    nextResourceIds: nextResourceIds.values,
    requestResourceIds: requestResourceIds.values,
    retainResourceIds: retainResourceIds.values,
    releaseCandidateResourceIds: releaseCandidateResourceIds.values,
    readyButNotVisibleResourceIds: readyButNotVisibleResourceIds.values,
    preloadOnlyResourceIds: preloadOnlyResourceIds.values,
    renderBlockingResourceIds: renderBlockingResourceIds.values,
    staleAllowedResourceIds: staleAllowedResourceIds.values,
    nonBlockingResourceIds: nonBlockingResourceIds.values,
    blockedResourceIds: blockedResourceIds.values,
    blockedElementIds: blockedElementIds.values,
    counts: {
      previousResources: loadSet.previousResourceIds.length,
      nextResources: loadSet.nextResourceIds.length,
      requestResources: loadSet.requestResourceIds.length,
      retainResources: loadSet.retainResourceIds.length,
      releaseCandidateResources: loadSet.releaseCandidateResourceIds.length,
      readyButNotVisibleResources: loadSet.readyButNotVisibleResourceIds.length,
      preloadOnlyResources: loadSet.preloadOnlyResourceIds.length,
      renderBlockingResources: loadSet.renderBlockingResourceIds.length,
      staleAllowedResources: loadSet.staleAllowedResourceIds.length,
      nonBlockingResources: loadSet.nonBlockingResourceIds.length,
      blockedResources: loadSet.blockedResourceIds.length,
      blockedElements: loadSet.blockedElementIds.length,
    },
    omitted: {
      previousResourceIds: previousResourceIds.omitted,
      nextResourceIds: nextResourceIds.omitted,
      requestResourceIds: requestResourceIds.omitted,
      retainResourceIds: retainResourceIds.omitted,
      releaseCandidateResourceIds: releaseCandidateResourceIds.omitted,
      readyButNotVisibleResourceIds: readyButNotVisibleResourceIds.omitted,
      preloadOnlyResourceIds: preloadOnlyResourceIds.omitted,
      renderBlockingResourceIds: renderBlockingResourceIds.omitted,
      staleAllowedResourceIds: staleAllowedResourceIds.omitted,
      nonBlockingResourceIds: nonBlockingResourceIds.omitted,
      blockedResourceIds: blockedResourceIds.omitted,
      blockedElementIds: blockedElementIds.omitted,
    },
  };
}

function hasFailedCheck(checks: readonly { ok: boolean }[] | undefined): boolean {
  return checks?.some((check) => check.ok === false) ?? false;
}

export function adaptPolyWorldPlanDebugSnapshot<T>(
  snapshot: PolyWorldPlanDebugSnapshot,
  adapter: (snapshot: PolyWorldPlanDebugSnapshot) => T,
): T {
  return adapter(snapshot);
}

function summarizeSelection(
  selection: PolyWorldSelection,
  listLimit: number | undefined,
): PolyWorldPlanDebugSelectionSummary {
  const regionIds = limitPolyWorldDebugList(selection.regionIds ?? [], listLimit);
  const linkIds = limitPolyWorldDebugList(selection.linkIds ?? [], listLimit);
  const selectionKeys = limitPolyWorldDebugList(selection.selectionKeys ?? [], listLimit);
  const elementIds = limitPolyWorldDebugList(selection.elementIds ?? [], listLimit);
  const sourceIds = limitPolyWorldDebugList(selection.sourceIds ?? [], listLimit);
  const aliases = limitPolyWorldDebugList(selection.aliases ?? [], listLimit);
  const reasonLabels = limitPolyWorldDebugList(selection.reasons?.map((reason) => reason.label) ?? [], listLimit);

  return {
    regionIds: regionIds.values,
    linkIds: linkIds.values,
    selectionKeys: selectionKeys.values,
    elementIds: elementIds.values,
    sourceIds: sourceIds.values,
    aliases: aliases.values,
    reasonLabels: reasonLabels.values,
    counts: {
      regions: selection.regionIds?.length ?? 0,
      links: selection.linkIds?.length ?? 0,
      selectionKeys: selection.selectionKeys?.length ?? 0,
      elements: selection.elementIds?.length ?? 0,
      sourceIds: selection.sourceIds?.length ?? 0,
      aliases: selection.aliases?.length ?? 0,
      reasonLabels: selection.reasons?.length ?? 0,
    },
    omitted: {
      regionIds: regionIds.omitted,
      linkIds: linkIds.omitted,
      selectionKeys: selectionKeys.omitted,
      elementIds: elementIds.omitted,
      sourceIds: sourceIds.omitted,
      aliases: aliases.omitted,
      reasonLabels: reasonLabels.omitted,
    },
  };
}

function compareAppliedState(
  next: PolyWorldState,
  applied: PolyWorldState,
  listLimit: number | undefined,
): PolyWorldPlanDebugAppliedComparison {
  const elementDiff = diffPolyWorldIds(applied.resolvedElementIds, next.resolvedElementIds);
  const layerDiff = diffPolyWorldIds(applied.layers, next.layers);
  const missingElementIds = elementDiff.added;
  const extraElementIds = elementDiff.removed;
  const missingLayers = layerDiff.added;
  const extraLayers = layerDiff.removed;
  const limitedMissingElementIds = limitPolyWorldDebugList(missingElementIds, listLimit);
  const limitedExtraElementIds = limitPolyWorldDebugList(extraElementIds, listLimit);
  const limitedMissingLayers = limitPolyWorldDebugList(missingLayers, listLimit);
  const limitedExtraLayers = limitPolyWorldDebugList(extraLayers, listLimit);

  return {
    state: summarizeState(applied, listLimit),
    matchesNext: applied.signature === next.signature,
    matchesResolvedElements: missingElementIds.length === 0 && extraElementIds.length === 0,
    matchesLayers: missingLayers.length === 0 && extraLayers.length === 0,
    missingElementIds: limitedMissingElementIds.values,
    extraElementIds: limitedExtraElementIds.values,
    missingLayers: limitedMissingLayers.values,
    extraLayers: limitedExtraLayers.values,
    counts: {
      missingElementIds: missingElementIds.length,
      extraElementIds: extraElementIds.length,
      missingLayers: missingLayers.length,
      extraLayers: extraLayers.length,
    },
    omitted: {
      missingElementIds: limitedMissingElementIds.omitted,
      extraElementIds: limitedExtraElementIds.omitted,
      missingLayers: limitedMissingLayers.omitted,
      extraLayers: limitedExtraLayers.omitted,
    },
  };
}

function summarizeState(
  state: PolyWorldState,
  listLimit: number | undefined,
): PolyWorldPlanDebugStateSummary {
  const selectedRegionIds = limitPolyWorldDebugList(state.selectedRegionIds, listLimit);
  const selectedLinkIds = limitPolyWorldDebugList(state.selectedLinkIds, listLimit);
  const selectedSelectionKeys = limitPolyWorldDebugList(state.selectedSelectionKeys, listLimit);
  const selectedElementIds = limitPolyWorldDebugList(state.selectedElementIds, listLimit);
  const selectedSourceIds = limitPolyWorldDebugList(state.selectedSourceIds, listLimit);
  const selectedAliases = limitPolyWorldDebugList(state.selectedAliases, listLimit);
  const resolvedElementIds = limitPolyWorldDebugList(state.resolvedElementIds, listLimit);
  const layers = limitPolyWorldDebugList(state.layers, listLimit);
  const reasonLabels = limitPolyWorldDebugList(state.reasonLabels, listLimit);

  return {
    id: state.id,
    signature: state.signature,
    selectionSignature: state.selectionSignature,
    elementSignature: state.elementSignature,
    layerSignature: state.layerSignature,
    selectedRegionIds: selectedRegionIds.values,
    selectedLinkIds: selectedLinkIds.values,
    selectedSelectionKeys: selectedSelectionKeys.values,
    selectedElementIds: selectedElementIds.values,
    selectedSourceIds: selectedSourceIds.values,
    selectedAliases: selectedAliases.values,
    resolvedElementIds: resolvedElementIds.values,
    layers: layers.values,
    reasonLabels: reasonLabels.values,
    unresolved: state.unresolved,
    counts: {
      regions: state.selectedRegionIds.length,
      links: state.selectedLinkIds.length,
      selectionKeys: state.selectedSelectionKeys.length,
      selectedElements: state.selectedElementIds.length,
      sourceIds: state.selectedSourceIds.length,
      aliases: state.selectedAliases.length,
      resolvedElements: state.resolvedElementIds.length,
      layers: state.layers.length,
      reasonLabels: state.reasonLabels.length,
    },
    omitted: {
      selectedRegionIds: selectedRegionIds.omitted,
      selectedLinkIds: selectedLinkIds.omitted,
      selectedSelectionKeys: selectedSelectionKeys.omitted,
      selectedElementIds: selectedElementIds.omitted,
      selectedSourceIds: selectedSourceIds.omitted,
      selectedAliases: selectedAliases.omitted,
      resolvedElementIds: resolvedElementIds.omitted,
      layers: layers.omitted,
      reasonLabels: reasonLabels.omitted,
    },
  };
}

function summarizeDiff(
  diff: PolyWorldIdDiff,
  listLimit: number | undefined,
): PolyWorldPlanDebugIdDiff {
  const added = limitPolyWorldDebugList(diff.added, listLimit);
  const removed = limitPolyWorldDebugList(diff.removed, listLimit);
  const retained = limitPolyWorldDebugList(diff.retained, listLimit);

  return {
    added: added.values,
    removed: removed.values,
    retained: retained.values,
    counts: {
      added: diff.added.length,
      removed: diff.removed.length,
      retained: diff.retained.length,
    },
    omitted: {
      added: added.omitted,
      removed: removed.omitted,
      retained: retained.omitted,
    },
  };
}
