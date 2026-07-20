import type {
  PolyWorldChunkStreamingSelection,
  PolyWorldChunkStreamingSourceSummary,
  PolyWorldChunkTreeTraversal,
  PolyWorldChunkTreeTraversalBudget,
  PolyWorldChunkTreeTraversalEntry,
  PolyWorldChunkTreeTraversalScreenSpaceError,
  PolyWorldChunkTreeSummary,
} from "../profiles/chunk";
import {
  createPolyWorldProfileArtifactProof,
  type PolyWorldProfileArtifactProof,
} from "../profiles/artifact";
import { limitPolyWorldDebugList } from "./limits";

export interface PolyWorldChunkStreamingDebugSnapshotOptions {
  includeSources?: boolean;
  includeTraversalEntries?: boolean;
  sourceLimit?: number;
  traversalEntryLimit?: number;
  listLimit?: number;
  metadata?: Record<string, unknown>;
}

export interface PolyWorldChunkStreamingDebugListSummary {
  values: readonly string[];
  count: number;
  omitted: number;
}

export interface PolyWorldChunkStreamingDebugSourceSummary {
  sourceId: string;
  currentRegionId?: string;
  selectedRegionIds: PolyWorldChunkStreamingDebugListSummary;
  graphRegionIds?: PolyWorldChunkStreamingDebugListSummary;
  graphTargetState?: string;
  targetState: string;
  priority: number;
  label: string;
  tags?: readonly string[];
  missingRegionId?: string;
  missingRegionIds?: PolyWorldChunkStreamingDebugListSummary;
}

export interface PolyWorldChunkTreeDebugSummary {
  chunkCount: number;
  maxDepth: number;
  rootChunkIds: PolyWorldChunkStreamingDebugListSummary;
  availableChunkIds: PolyWorldChunkStreamingDebugListSummary;
  contentChunkIds: PolyWorldChunkStreamingDebugListSummary;
}

export interface PolyWorldChunkTreeTraversalDebugEntry {
  chunkId: string;
  regionId?: string;
  parentId?: string;
  depth: number;
  reasons: readonly string[];
  cost: number;
  priority: number;
  available: boolean;
  contentAvailable: boolean;
  geometricError?: number;
  distanceToCamera?: number;
  screenSpaceError?: number;
}

export interface PolyWorldChunkTreeTraversalDebugSummary {
  currentChunkId?: string;
  rootChunkIds: PolyWorldChunkStreamingDebugListSummary;
  selectedChunkIds: PolyWorldChunkStreamingDebugListSummary;
  refinedChunkIds: PolyWorldChunkStreamingDebugListSummary;
  renderedChunkIds: PolyWorldChunkStreamingDebugListSummary;
  loadedChunkIds: PolyWorldChunkStreamingDebugListSummary;
  residentChunkIds: PolyWorldChunkStreamingDebugListSummary;
  requestedChunkIds: PolyWorldChunkStreamingDebugListSummary;
  heldChunkIds: PolyWorldChunkStreamingDebugListSummary;
  unavailableChunkIds: PolyWorldChunkStreamingDebugListSummary;
  viewCulledChunkIds: PolyWorldChunkStreamingDebugListSummary;
  outsideRequestVolumeChunkIds: PolyWorldChunkStreamingDebugListSummary;
  skippedChunkIds: PolyWorldChunkStreamingDebugListSummary;
  budgetClippedChunkIds: PolyWorldChunkStreamingDebugListSummary;
  selectedRegionIds: PolyWorldChunkStreamingDebugListSummary;
  renderedRegionIds: PolyWorldChunkStreamingDebugListSummary;
  requestedRegionIds: PolyWorldChunkStreamingDebugListSummary;
  totalRenderCost: number;
  totalLoadCost: number;
  budget: PolyWorldChunkTreeTraversalBudget;
  screenSpaceError?: PolyWorldChunkTreeTraversalScreenSpaceError;
  entryCount: number;
  entries?: readonly PolyWorldChunkTreeTraversalDebugEntry[];
  omittedEntries?: number;
}

export interface PolyWorldChunkStreamingDebugSnapshot {
  schemaVersion: 1;
  proof: PolyWorldProfileArtifactProof;
  selection: {
    regionIds: PolyWorldChunkStreamingDebugListSummary;
    selectionKeys: PolyWorldChunkStreamingDebugListSummary;
    reasonLabels: PolyWorldChunkStreamingDebugListSummary;
  };
  streaming: {
    requestedRegionIds: PolyWorldChunkStreamingDebugListSummary;
    loadingRegionIds: PolyWorldChunkStreamingDebugListSummary;
    loadedRegionIds: PolyWorldChunkStreamingDebugListSummary;
    residentRegionIds: PolyWorldChunkStreamingDebugListSummary;
    activeRegionIds: PolyWorldChunkStreamingDebugListSummary;
    renderedRegionIds: PolyWorldChunkStreamingDebugListSummary;
    preloadedRegionIds: PolyWorldChunkStreamingDebugListSummary;
    missingRegionIds: PolyWorldChunkStreamingDebugListSummary;
    sourceCount: number;
    sources?: readonly PolyWorldChunkStreamingDebugSourceSummary[];
    omittedSources?: number;
    chunkTree?: PolyWorldChunkTreeDebugSummary;
    chunkTraversal?: PolyWorldChunkTreeTraversalDebugSummary;
  };
  metadata?: Record<string, unknown>;
}

export function createPolyWorldChunkStreamingDebugSnapshot(
  selection: PolyWorldChunkStreamingSelection,
  options: PolyWorldChunkStreamingDebugSnapshotOptions = {},
): PolyWorldChunkStreamingDebugSnapshot {
  const sources = options.includeSources === false
    ? undefined
    : limitPolyWorldDebugList(selection.streaming.sources, options.sourceLimit);

  return {
    schemaVersion: 1,
    proof: createPolyWorldChunkStreamingArtifactProof(selection),
    selection: {
      regionIds: summarizeList(selection.regionIds ?? [], options.listLimit),
      selectionKeys: summarizeList(selection.selectionKeys ?? [], options.listLimit),
      reasonLabels: summarizeList(selection.reasons?.map((reason) => reason.label) ?? [], options.listLimit),
    },
    streaming: {
      requestedRegionIds: summarizeList(selection.streaming.requestedRegionIds, options.listLimit),
      loadingRegionIds: summarizeList(selection.streaming.loadingRegionIds, options.listLimit),
      loadedRegionIds: summarizeList(selection.streaming.loadedRegionIds, options.listLimit),
      residentRegionIds: summarizeList(selection.streaming.residentRegionIds, options.listLimit),
      activeRegionIds: summarizeList(selection.streaming.activeRegionIds, options.listLimit),
      renderedRegionIds: summarizeList(selection.streaming.renderedRegionIds, options.listLimit),
      preloadedRegionIds: summarizeList(selection.streaming.preloadedRegionIds, options.listLimit),
      missingRegionIds: summarizeList(selection.streaming.missingRegionIds, options.listLimit),
      sourceCount: selection.streaming.sources.length,
      sources: sources?.values.map((source) => summarizeSource(source, options.listLimit)),
      omittedSources: sources?.omitted,
      chunkTree: selection.streaming.chunkTree === undefined
        ? undefined
        : summarizeChunkTree(selection.streaming.chunkTree, options.listLimit),
      chunkTraversal: selection.streaming.chunkTraversal === undefined
        ? undefined
        : summarizeChunkTreeTraversal(selection.streaming.chunkTraversal, options),
    },
    metadata: options.metadata,
  };
}

export function createPolyWorldChunkStreamingArtifactProof(
  selection: PolyWorldChunkStreamingSelection,
): PolyWorldProfileArtifactProof {
  const chunkTree = selection.streaming.chunkTree;
  const traversal = selection.streaming.chunkTraversal;
  return createPolyWorldProfileArtifactProof({
    profile: "chunk-traversal",
    artifactKind: "chunk-working-set",
    sourceKind: "authored-runtime-selection",
    producedBy: traversal === undefined
      ? "selectPolyWorldChunkStreaming"
      : "resolvePolyWorldChunkTreeTraversal",
    guarantees: [
      "streaming-state-separation",
      "deterministic-selection-order",
      ...(chunkTree === undefined ? [] : [
        "chunk-tree-summary",
        "availability-state-reporting",
        "content-availability-state-reporting",
      ]),
      ...(traversal === undefined ? [] : [
        "budgeted-traversal",
        "working-set-state-reporting",
        "budget-clipping-reasons",
        ...(traversal.outsideRequestVolumeChunkIds.length === 0 ? [] : ["viewer-request-volume-filtering"]),
        ...(traversal.screenSpaceError === undefined ? [] : ["screen-space-error-traversal"]),
        ...(traversal.viewCulledChunkIds.length === 0 ? [] : ["view-frustum-culling"]),
      ]),
    ],
    knownWeaknesses: [
      "not-visibility-occlusion",
      "not-fetch-scheduler",
      "not-cache-eviction",
      "not-renderer-lod-swap",
    ],
    counts: {
      selectedRegionCount: selection.regionIds?.length ?? 0,
      requestedRegionCount: selection.streaming.requestedRegionIds.length,
      loadingRegionCount: selection.streaming.loadingRegionIds.length,
      loadedRegionCount: selection.streaming.loadedRegionIds.length,
      residentRegionCount: selection.streaming.residentRegionIds.length,
      activeRegionCount: selection.streaming.activeRegionIds.length,
      renderedRegionCount: selection.streaming.renderedRegionIds.length,
      preloadedRegionCount: selection.streaming.preloadedRegionIds.length,
      missingRegionCount: selection.streaming.missingRegionIds.length,
      sourceCount: selection.streaming.sources.length,
      chunkCount: chunkTree?.chunkCount,
      rootChunkCount: chunkTree?.rootChunkIds.length,
      availableChunkCount: chunkTree?.availableChunkIds.length,
      contentChunkCount: chunkTree?.contentChunkIds.length,
      selectedChunkCount: traversal?.selectedChunkIds.length,
      renderedChunkCount: traversal?.renderedChunkIds.length,
      loadedChunkCount: traversal?.loadedChunkIds.length,
      residentChunkCount: traversal?.residentChunkIds.length,
      requestedChunkCount: traversal?.requestedChunkIds.length,
      heldChunkCount: traversal?.heldChunkIds.length,
      unavailableChunkCount: traversal?.unavailableChunkIds.length,
      viewCulledChunkCount: traversal?.viewCulledChunkIds.length,
      outsideRequestVolumeChunkCount: traversal?.outsideRequestVolumeChunkIds.length,
      skippedChunkCount: traversal?.skippedChunkIds.length,
      budgetClippedChunkCount: traversal?.budgetClippedChunkIds.length,
      traversalEntryCount: traversal?.entries.length,
    },
    coverage: {
      renderedRegionCoverage: coverage(selection.streaming.renderedRegionIds.length, selection.streaming.loadedRegionIds.length),
      residentRegionCoverage: coverage(selection.streaming.residentRegionIds.length, selection.streaming.loadedRegionIds.length),
      availableChunkCoverage: coverage(chunkTree?.availableChunkIds.length ?? 0, chunkTree?.chunkCount ?? 0),
      contentChunkCoverage: coverage(chunkTree?.contentChunkIds.length ?? 0, chunkTree?.chunkCount ?? 0),
      renderedChunkCoverage: coverage(traversal?.renderedChunkIds.length ?? 0, traversal?.selectedChunkIds.length ?? 0),
      loadedChunkCoverage: coverage(traversal?.loadedChunkIds.length ?? 0, traversal?.selectedChunkIds.length ?? 0),
    },
  });
}

function summarizeChunkTree(
  chunkTree: PolyWorldChunkTreeSummary,
  listLimit: number | undefined,
): PolyWorldChunkTreeDebugSummary {
  return {
    chunkCount: chunkTree.chunkCount,
    maxDepth: chunkTree.maxDepth,
    rootChunkIds: summarizeList(chunkTree.rootChunkIds, listLimit),
    availableChunkIds: summarizeList(chunkTree.availableChunkIds, listLimit),
    contentChunkIds: summarizeList(chunkTree.contentChunkIds, listLimit),
  };
}

function summarizeChunkTreeTraversal(
  traversal: PolyWorldChunkTreeTraversal,
  options: PolyWorldChunkStreamingDebugSnapshotOptions,
): PolyWorldChunkTreeTraversalDebugSummary {
  const entries = options.includeTraversalEntries === true
    ? limitPolyWorldDebugList(traversal.entries, options.traversalEntryLimit)
    : undefined;
  return {
    currentChunkId: traversal.currentChunkId,
    rootChunkIds: summarizeList(traversal.rootChunkIds, options.listLimit),
    selectedChunkIds: summarizeList(traversal.selectedChunkIds, options.listLimit),
    refinedChunkIds: summarizeList(traversal.refinedChunkIds, options.listLimit),
    renderedChunkIds: summarizeList(traversal.renderedChunkIds, options.listLimit),
    loadedChunkIds: summarizeList(traversal.loadedChunkIds, options.listLimit),
    residentChunkIds: summarizeList(traversal.residentChunkIds, options.listLimit),
    requestedChunkIds: summarizeList(traversal.requestedChunkIds, options.listLimit),
    heldChunkIds: summarizeList(traversal.heldChunkIds, options.listLimit),
    unavailableChunkIds: summarizeList(traversal.unavailableChunkIds, options.listLimit),
    viewCulledChunkIds: summarizeList(traversal.viewCulledChunkIds, options.listLimit),
    outsideRequestVolumeChunkIds: summarizeList(traversal.outsideRequestVolumeChunkIds, options.listLimit),
    skippedChunkIds: summarizeList(traversal.skippedChunkIds, options.listLimit),
    budgetClippedChunkIds: summarizeList(traversal.budgetClippedChunkIds, options.listLimit),
    selectedRegionIds: summarizeList(traversal.selectedRegionIds, options.listLimit),
    renderedRegionIds: summarizeList(traversal.renderedRegionIds, options.listLimit),
    requestedRegionIds: summarizeList(traversal.requestedRegionIds, options.listLimit),
    totalRenderCost: traversal.totalRenderCost,
    totalLoadCost: traversal.totalLoadCost,
    budget: traversal.budget,
    screenSpaceError: traversal.screenSpaceError,
    entryCount: traversal.entries.length,
    entries: entries?.values.map(summarizeTraversalEntry),
    omittedEntries: entries?.omitted,
  };
}

function summarizeTraversalEntry(
  entry: PolyWorldChunkTreeTraversalEntry,
): PolyWorldChunkTreeTraversalDebugEntry {
  return {
    chunkId: entry.chunkId,
    regionId: entry.regionId,
    parentId: entry.parentId,
    depth: entry.depth,
    reasons: entry.reasons,
    cost: entry.cost,
    priority: entry.priority,
    available: entry.available,
    contentAvailable: entry.contentAvailable,
    geometricError: entry.geometricError,
    distanceToCamera: entry.distanceToCamera,
    screenSpaceError: entry.screenSpaceError,
  };
}

export function adaptPolyWorldChunkStreamingDebugSnapshot<T>(
  snapshot: PolyWorldChunkStreamingDebugSnapshot,
  adapter: (snapshot: PolyWorldChunkStreamingDebugSnapshot) => T,
): T {
  return adapter(snapshot);
}

function summarizeSource(
  source: PolyWorldChunkStreamingSourceSummary,
  listLimit: number | undefined,
): PolyWorldChunkStreamingDebugSourceSummary {
  return {
    sourceId: source.sourceId,
    currentRegionId: source.currentRegionId,
    selectedRegionIds: summarizeList(source.selectedRegionIds, listLimit),
    graphRegionIds: source.graphRegionIds === undefined ? undefined : summarizeList(source.graphRegionIds, listLimit),
    graphTargetState: source.graphTargetState,
    targetState: source.targetState,
    priority: source.priority,
    label: source.label,
    tags: source.tags,
    missingRegionId: source.missingRegionId,
    missingRegionIds: source.missingRegionIds === undefined ? undefined : summarizeList(source.missingRegionIds, listLimit),
  };
}

function summarizeList(
  values: readonly string[],
  limit: number | undefined,
): PolyWorldChunkStreamingDebugListSummary {
  const limited = limitPolyWorldDebugList(values, limit);
  return {
    values: limited.values,
    count: values.length,
    omitted: limited.omitted,
  };
}

function coverage(count: number, total: number): number {
  if (total === 0) return 0;
  return count / total;
}
