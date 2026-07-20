import type {
  PolyWorldBounds,
  PolyWorldData,
  PolyWorldSelection,
  PolyWorldSelectionReason,
  PolyWorldTopology,
} from "../topology";
import { resolvePolyWorldRegionByPoint } from "../topology";
import type { PolyWorldRegionSelectionKeys } from "./portal";
import { resolvePolyWorldRegionSelectionKeys } from "./portal";
import type { Vec3 } from "@layoutit/polycss-core";

export interface PolyWorldTaggedRegionSelection {
  regionIds: readonly string[];
  label: string;
  kind?: string;
  tags?: readonly string[];
  selectionKeys?: readonly string[];
  data?: Record<string, unknown>;
}

export interface PolyWorldChunkReasonLabels {
  current?: string;
  active?: string;
  window?: string;
  tagged?: string;
  selectionKey?: string;
}

export type PolyWorldChunkTargetState = "preloaded" | "loaded" | "resident" | "active" | "rendered";
export type PolyWorldChunkStreamingStateName =
  | "requested"
  | "loading"
  | "loaded"
  | "resident"
  | "active"
  | "rendered"
  | "preloaded";
export type PolyWorldChunkRefinement = "replace" | "add";

export interface PolyWorldChunkTreeNode {
  id: string;
  regionId?: string;
  parentId?: string;
  childIds?: readonly string[];
  bounds?: PolyWorldBounds;
  contentBounds?: PolyWorldBounds;
  viewerRequestBounds?: PolyWorldBounds;
  available?: boolean;
  contentAvailable?: boolean;
  resourceIds?: readonly string[];
  refinement?: PolyWorldChunkRefinement;
  geometricError?: number;
  cost?: number;
  priority?: number;
  tags?: readonly string[];
  data?: PolyWorldData;
}

export interface PolyWorldChunkTreeInput {
  chunks: readonly PolyWorldChunkTreeNode[];
  rootChunkIds?: readonly string[];
  data?: PolyWorldData;
}

export interface PolyWorldChunkTreeOptions {
  topology?: PolyWorldTopology;
}

export interface PolyWorldChunkTree {
  chunks: readonly PolyWorldChunkTreeNode[];
  rootChunkIds: readonly string[];
  data?: PolyWorldData;
  chunksById: ReadonlyMap<string, PolyWorldChunkTreeNode>;
  chunksByRegionId: ReadonlyMap<string, PolyWorldChunkTreeNode>;
  childIdsById: ReadonlyMap<string, readonly string[]>;
  parentIdById: ReadonlyMap<string, string>;
  availableChunkIds: readonly string[];
  contentChunkIds: readonly string[];
}

export interface PolyWorldChunkTreeDiagnostic {
  code: string;
  message: string;
  id?: string;
  field?: string;
}

export interface PolyWorldChunkTreeSummary {
  chunkCount: number;
  rootChunkIds: readonly string[];
  availableChunkIds: readonly string[];
  contentChunkIds: readonly string[];
  maxDepth: number;
}

export type PolyWorldChunkTreeTraversalReason =
  | "root"
  | "current"
  | "ancestor"
  | "refined"
  | "rendered"
  | "loaded"
  | "resident"
  | "requested"
  | "held"
  | "unavailable"
  | "outside-request-volume"
  | "view-culled"
  | "budget-clipped"
  | "skipped";

export interface PolyWorldChunkTreeTraversalBudget {
  maxRenderedChunks?: number;
  maxLoadedChunks?: number;
  maxRenderCost?: number;
  maxLoadCost?: number;
  targetGeometricError?: number;
  maxScreenSpaceError?: number;
  maxDepth?: number;
}

export interface PolyWorldChunkTreeTraversalScreenSpaceError {
  viewportHeight: number;
  fovDegrees: number;
  maxError?: number;
  distanceFloor: number;
}

export interface PolyWorldChunkTreeTraversalPlane {
  normal: Vec3;
  distance: number;
}

export interface PolyWorldChunkTreeTraversalOptions {
  currentChunkId?: string;
  currentRegionId?: string;
  point?: Vec3;
  forward?: Vec3;
  up?: Vec3;
  fovDegrees?: number;
  aspect?: number;
  near?: number;
  far?: number;
  viewportHeight?: number;
  screenSpaceErrorDistanceFloor?: number;
  frustum?: readonly PolyWorldChunkTreeTraversalPlane[];
  nearest?: boolean;
  rootChunkIds?: readonly string[];
  budget?: PolyWorldChunkTreeTraversalBudget;
}

export interface PolyWorldChunkTreeTraversalEntry {
  chunkId: string;
  regionId?: string;
  parentId?: string;
  depth: number;
  available: boolean;
  contentAvailable: boolean;
  refinement?: PolyWorldChunkRefinement;
  geometricError?: number;
  distanceToCamera?: number;
  screenSpaceError?: number;
  cost: number;
  priority: number;
  reasons: readonly PolyWorldChunkTreeTraversalReason[];
}

export interface PolyWorldChunkTreeTraversal {
  currentChunkId?: string;
  rootChunkIds: readonly string[];
  selectedChunkIds: readonly string[];
  refinedChunkIds: readonly string[];
  renderedChunkIds: readonly string[];
  loadedChunkIds: readonly string[];
  residentChunkIds: readonly string[];
  requestedChunkIds: readonly string[];
  heldChunkIds: readonly string[];
  unavailableChunkIds: readonly string[];
  viewCulledChunkIds: readonly string[];
  outsideRequestVolumeChunkIds: readonly string[];
  skippedChunkIds: readonly string[];
  budgetClippedChunkIds: readonly string[];
  selectedRegionIds: readonly string[];
  renderedRegionIds: readonly string[];
  loadedRegionIds: readonly string[];
  residentRegionIds: readonly string[];
  requestedRegionIds: readonly string[];
  totalRenderCost: number;
  totalLoadCost: number;
  budget: PolyWorldChunkTreeTraversalBudget;
  screenSpaceError?: PolyWorldChunkTreeTraversalScreenSpaceError;
  entries: readonly PolyWorldChunkTreeTraversalEntry[];
}

export class PolyWorldChunkTreeError extends Error {
  readonly diagnostics: readonly PolyWorldChunkTreeDiagnostic[];

  constructor(diagnostics: readonly PolyWorldChunkTreeDiagnostic[]) {
    super(diagnostics.map((diagnostic) => diagnostic.message).join("\n"));
    this.name = "PolyWorldChunkTreeError";
    this.diagnostics = diagnostics;
  }
}

export interface PolyWorldChunkGraph {
  parentRegionIds?: Readonly<Record<string, string | readonly string[]>>;
  childRegionIds?: Readonly<Record<string, readonly string[]>>;
  relatedRegionIds?: Readonly<Record<string, readonly string[]>>;
}

export interface PolyWorldChunkGraphExpansionOptions {
  includeParents?: boolean;
  includeChildren?: boolean;
  includeRelated?: boolean;
  recursive?: boolean;
  targetState?: PolyWorldChunkTargetState;
}

export interface PolyWorldChunkStreamingSource {
  id: string;
  regionId?: string;
  point?: Vec3;
  position?: Vec3;
  orderedRegionIds?: readonly string[];
  before?: number;
  after?: number;
  windowRadius?: number;
  loadingRange?: number;
  nearest?: boolean;
  targetState?: PolyWorldChunkTargetState;
  priority?: number;
  chunkGraphExpansion?: false | PolyWorldChunkGraphExpansionOptions;
  label?: string;
  tags?: readonly string[];
  selectionKeys?: readonly string[];
  data?: Record<string, unknown>;
}

export interface PolyWorldChunkStreamingReasonLabels extends PolyWorldChunkReasonLabels {
  streamingSource?: string;
  chunkTreeTraversal?: string;
}

export interface PolyWorldChunkStreamingSelectionOptions {
  orderedRegionIds?: readonly string[];
  chunkTree?: PolyWorldChunkTree | PolyWorldChunkTreeInput;
  currentRegionId?: string;
  before?: number;
  after?: number;
  windowRadius?: number;
  loadingRange?: number;
  nearest?: boolean;
  targetState?: PolyWorldChunkTargetState;
  activeRegionIds?: readonly string[];
  loadedRegionIds?: readonly string[];
  residentRegionIds?: readonly string[];
  renderedRegionIds?: readonly string[];
  preloadedRegionIds?: readonly string[];
  selectionKeys?: readonly string[];
  sources?: readonly PolyWorldChunkStreamingSource[];
  chunkGraph?: PolyWorldChunkGraph;
  chunkGraphExpansion?: false | PolyWorldChunkGraphExpansionOptions;
  chunkTraversal?: false | PolyWorldChunkTreeTraversalOptions;
  taggedRegionSelections?: readonly PolyWorldTaggedRegionSelection[];
  regionSelectionKeys?: PolyWorldRegionSelectionKeys;
  reasonLabels?: PolyWorldChunkStreamingReasonLabels;
  reasons?: readonly PolyWorldSelectionReason[];
  data?: Record<string, unknown>;
}

export interface PolyWorldChunkStreamingSourceSummary {
  sourceId: string;
  currentRegionId?: string;
  selectedRegionIds: readonly string[];
  graphRegionIds?: readonly string[];
  graphTargetState?: PolyWorldChunkTargetState;
  targetState: PolyWorldChunkTargetState;
  priority: number;
  label: string;
  tags?: readonly string[];
  missingRegionId?: string;
  missingRegionIds?: readonly string[];
  data?: Record<string, unknown>;
}

export interface PolyWorldChunkStreamingState {
  requestedRegionIds: readonly string[];
  loadingRegionIds: readonly string[];
  loadedRegionIds: readonly string[];
  residentRegionIds: readonly string[];
  activeRegionIds: readonly string[];
  renderedRegionIds: readonly string[];
  preloadedRegionIds: readonly string[];
  missingRegionIds: readonly string[];
  sources: readonly PolyWorldChunkStreamingSourceSummary[];
  chunkTree?: PolyWorldChunkTreeSummary;
  chunkTraversal?: PolyWorldChunkTreeTraversal;
}

export interface PolyWorldChunkStreamingSelection extends PolyWorldSelection {
  streaming: PolyWorldChunkStreamingState;
}

export interface PolyWorldChunkStreamingStateSelectionOptions {
  regionSelectionKeys?: PolyWorldRegionSelectionKeys;
  selectionKeys?: readonly string[];
  reasonLabel?: string;
  reasons?: readonly PolyWorldSelectionReason[];
  data?: Record<string, unknown>;
}

export interface PolyWorldChunkWindowSelectionOptions {
  orderedRegionIds?: readonly string[];
  currentRegionId?: string;
  before?: number;
  after?: number;
  windowRadius?: number;
  activeRegionIds?: readonly string[];
  selectionKeys?: readonly string[];
  taggedRegionSelections?: readonly PolyWorldTaggedRegionSelection[];
  regionSelectionKeys?: PolyWorldRegionSelectionKeys;
  reasonLabels?: PolyWorldChunkReasonLabels;
  reasons?: readonly PolyWorldSelectionReason[];
  data?: Record<string, unknown>;
}

export function validatePolyWorldChunkTree(
  input: PolyWorldChunkTreeInput,
  options: PolyWorldChunkTreeOptions = {},
): PolyWorldChunkTreeDiagnostic[] {
  const diagnostics: PolyWorldChunkTreeDiagnostic[] = [];
  const chunks = input.chunks ?? [];
  const chunkIds = new Set<string>();

  if (chunks.length === 0) {
    diagnostics.push({
      code: "poly-world-empty-chunk-tree",
      message: "PolyWorld chunk tree requires at least one chunk.",
      field: "chunks",
    });
  }

  for (const chunk of chunks) {
    validateChunkTreeId("chunk", chunk.id, "id", diagnostics);
    if (chunk.id && chunkIds.has(chunk.id)) {
      diagnostics.push({
        code: "poly-world-duplicate-chunk-id",
        message: `Duplicate PolyWorld chunk id "${chunk.id}".`,
        id: chunk.id,
        field: "id",
      });
    }
    if (chunk.id) chunkIds.add(chunk.id);
  }

  for (const chunk of chunks) {
    validateChunkTreeNode(chunk, chunkIds, options.topology, diagnostics);
  }
  for (const rootChunkId of input.rootChunkIds ?? []) {
    validateChunkTreeId("root chunk", rootChunkId, "rootChunkIds", diagnostics);
    if (!chunkIds.has(rootChunkId)) {
      diagnostics.push({
        code: "poly-world-missing-root-chunk",
        message: `PolyWorld chunk tree rootChunkIds references missing chunk "${rootChunkId}".`,
        id: rootChunkId,
        field: "rootChunkIds",
      });
    }
  }
  validateChunkTreeAvailability(chunks, diagnostics);
  validateChunkTreeCycles(chunks, diagnostics);
  return diagnostics;
}

export function createPolyWorldChunkTree(
  input: PolyWorldChunkTreeInput,
  options: PolyWorldChunkTreeOptions = {},
): PolyWorldChunkTree {
  const diagnostics = validatePolyWorldChunkTree(input, options);
  if (diagnostics.length > 0) throw new PolyWorldChunkTreeError(diagnostics);

  const chunks = input.chunks.map((chunk) => normalizeChunkTreeNode(chunk));
  const chunksById = new Map<string, PolyWorldChunkTreeNode>();
  const chunksByRegionId = new Map<string, PolyWorldChunkTreeNode>();
  const childIdsById = new Map<string, string[]>();
  const parentIdById = new Map<string, string>();

  for (const chunk of chunks) {
    chunksById.set(chunk.id, chunk);
    if (chunk.regionId !== undefined) chunksByRegionId.set(chunk.regionId, chunk);
  }

  for (const chunk of chunks) {
    if (chunk.parentId !== undefined) {
      parentIdById.set(chunk.id, chunk.parentId);
      pushUniqueMap(childIdsById, chunk.parentId, chunk.id);
    }
    for (const childId of chunk.childIds ?? []) {
      pushUniqueMap(childIdsById, chunk.id, childId);
      if (!parentIdById.has(childId)) parentIdById.set(childId, chunk.id);
    }
  }

  const rootChunkIds = input.rootChunkIds === undefined
    ? chunks.filter((chunk) => !parentIdById.has(chunk.id)).map((chunk) => chunk.id)
    : unique(input.rootChunkIds);

  return {
    chunks,
    rootChunkIds,
    data: input.data,
    chunksById,
    chunksByRegionId,
    childIdsById,
    parentIdById,
    availableChunkIds: chunks.filter((chunk) => chunk.available !== false).map((chunk) => chunk.id),
    contentChunkIds: chunks.filter((chunk) => chunk.contentAvailable === true).map((chunk) => chunk.id),
  };
}

export function createPolyWorldChunkGraphFromTree(tree: PolyWorldChunkTree): PolyWorldChunkGraph {
  const parentRegionIds: Record<string, string | string[]> = {};
  const childRegionIds: Record<string, string[]> = {};

  for (const chunk of tree.chunks) {
    if (chunk.regionId === undefined) continue;
    const parentId = tree.parentIdById.get(chunk.id);
    const parentRegionId = parentId === undefined ? undefined : tree.chunksById.get(parentId)?.regionId;
    if (parentRegionId !== undefined) parentRegionIds[chunk.regionId] = parentRegionId;

    const childRegionIdsForChunk = (tree.childIdsById.get(chunk.id) ?? [])
      .flatMap((childId) => {
        const childRegionId = tree.chunksById.get(childId)?.regionId;
        return childRegionId === undefined ? [] : [childRegionId];
      });
    if (childRegionIdsForChunk.length > 0) childRegionIds[chunk.regionId] = unique(childRegionIdsForChunk);
  }

  return { parentRegionIds, childRegionIds };
}

export function summarizePolyWorldChunkTree(tree: PolyWorldChunkTree): PolyWorldChunkTreeSummary {
  return {
    chunkCount: tree.chunks.length,
    rootChunkIds: tree.rootChunkIds,
    availableChunkIds: tree.availableChunkIds,
    contentChunkIds: tree.contentChunkIds,
    maxDepth: resolveChunkTreeMaxDepth(tree),
  };
}

export function resolvePolyWorldChunkTreeTraversal(
  tree: PolyWorldChunkTree,
  options: PolyWorldChunkTreeTraversalOptions = {},
): PolyWorldChunkTreeTraversal {
  const rootChunkIds = unique(options.rootChunkIds ?? tree.rootChunkIds)
    .filter((chunkId) => tree.chunksById.has(chunkId));
  const currentChunkId = resolveChunkTraversalCurrentChunkId(tree, options);
  const activePath = new Set(currentChunkId === undefined ? [] : resolveChunkAncestorIds(tree, currentChunkId));
  if (currentChunkId !== undefined) activePath.add(currentChunkId);

  const state: ChunkTreeTraversalState = {
    tree,
    budget: normalizeChunkTraversalBudget(options.budget),
    viewPlanes: resolveChunkTraversalViewPlanes(options),
    ...optionalChunkTraversalScreenSpaceError(options),
    ...(options.point === undefined ? {} : { point: options.point }),
    currentChunkId,
    activePath,
    entries: [],
    selectedChunkIds: [],
    refinedChunkIds: [],
    renderedChunkIds: [],
    loadedChunkIds: [],
    residentChunkIds: [],
    requestedChunkIds: [],
    heldChunkIds: [],
    unavailableChunkIds: [],
    viewCulledChunkIds: [],
    outsideRequestVolumeChunkIds: [],
    skippedChunkIds: [],
    budgetClippedChunkIds: [],
    selectedRegionIds: [],
    renderedRegionIds: [],
    loadedRegionIds: [],
    residentRegionIds: [],
    requestedRegionIds: [],
    totalRenderCost: 0,
    totalLoadCost: 0,
    renderedCount: 0,
    loadedCount: 0,
    visited: new Set(),
  };

  for (const rootChunkId of rootChunkIds) visitChunkTreeTraversal(rootChunkId, 0, ["root"], state);

  return {
    ...(currentChunkId === undefined ? {} : { currentChunkId }),
    rootChunkIds,
    selectedChunkIds: state.selectedChunkIds,
    refinedChunkIds: state.refinedChunkIds,
    renderedChunkIds: state.renderedChunkIds,
    loadedChunkIds: state.loadedChunkIds,
    residentChunkIds: state.residentChunkIds,
    requestedChunkIds: state.requestedChunkIds,
    heldChunkIds: state.heldChunkIds,
    unavailableChunkIds: state.unavailableChunkIds,
    viewCulledChunkIds: state.viewCulledChunkIds,
    outsideRequestVolumeChunkIds: state.outsideRequestVolumeChunkIds,
    skippedChunkIds: state.skippedChunkIds,
    budgetClippedChunkIds: state.budgetClippedChunkIds,
    selectedRegionIds: state.selectedRegionIds,
    renderedRegionIds: state.renderedRegionIds,
    loadedRegionIds: state.loadedRegionIds,
    residentRegionIds: state.residentRegionIds,
    requestedRegionIds: state.requestedRegionIds,
    totalRenderCost: state.totalRenderCost,
    totalLoadCost: state.totalLoadCost,
    budget: state.budget.publicBudget,
    ...(state.screenSpaceError === undefined ? {} : { screenSpaceError: state.screenSpaceError }),
    entries: state.entries,
  };
}

export function selectPolyWorldChunkWindow(
  topology: PolyWorldTopology,
  options: PolyWorldChunkWindowSelectionOptions = {},
): PolyWorldSelection {
  const labels = {
    current: "current",
    active: "active",
    window: "window",
    tagged: "tagged",
    selectionKey: "selection-key",
    ...options.reasonLabels,
  };
  const orderedRegionIds = options.orderedRegionIds ?? topology.regions.map((region) => region.id);
  const before = options.windowRadius ?? options.before ?? 0;
  const after = options.windowRadius ?? options.after ?? 0;
  const regionIds: string[] = [];
  const selectionKeys: string[] = [];
  const reasons: PolyWorldSelectionReason[] = [...(options.reasons ?? [])];

  for (const activeRegionId of options.activeRegionIds ?? []) add(regionIds, activeRegionId);
  if ((options.activeRegionIds?.length ?? 0) > 0) {
    reasons.push({
      id: "poly-world-chunk-active",
      kind: "active",
      label: labels.active,
      regionIds: unique(options.activeRegionIds),
    });
  }

  if (options.currentRegionId !== undefined) {
    add(regionIds, options.currentRegionId);
    reasons.push({
      id: "poly-world-chunk-current",
      kind: "current",
      label: labels.current,
      regionIds: [options.currentRegionId],
    });
    const windowRegionIds = windowAround(orderedRegionIds, options.currentRegionId, before, after);
    for (const windowRegionId of windowRegionIds) add(regionIds, windowRegionId);
    if (windowRegionIds.length > 0) {
      reasons.push({
        id: "poly-world-chunk-window",
        kind: "window",
        label: labels.window,
        regionIds: windowRegionIds,
      });
    }
  }

  for (const tagged of options.taggedRegionSelections ?? []) {
    for (const regionId of tagged.regionIds) add(regionIds, regionId);
    for (const selectionKey of tagged.selectionKeys ?? []) add(selectionKeys, selectionKey);
    reasons.push({
      id: tagged.kind === undefined ? undefined : `poly-world-chunk-${tagged.kind}`,
      kind: tagged.kind ?? "tagged",
      label: tagged.label || labels.tagged,
      regionIds: unique(tagged.regionIds),
      selectionKeys: unique(tagged.selectionKeys),
      tags: tagged.tags,
      data: tagged.data,
    });
  }

  for (const regionId of regionIds) {
    const region = topology.regionsById.get(regionId);
    for (const selectionKey of region?.selectionKeys ?? []) add(selectionKeys, selectionKey);
    for (const selectionKey of resolvePolyWorldRegionSelectionKeys(options.regionSelectionKeys, regionId, topology)) {
      add(selectionKeys, selectionKey);
    }
  }

  for (const selectionKey of options.selectionKeys ?? []) add(selectionKeys, selectionKey);
  if (selectionKeys.length > 0) {
    reasons.push({
      id: "poly-world-chunk-selection-key",
      kind: "selectionKey",
      label: labels.selectionKey,
      selectionKeys,
    });
  }

  return {
    regionIds,
    selectionKeys,
    reasons,
    data: options.data,
  };
}

export function selectPolyWorldChunkStreaming(
  topology: PolyWorldTopology,
  options: PolyWorldChunkStreamingSelectionOptions = {},
): PolyWorldChunkStreamingSelection {
  const labels = {
    current: "current",
    active: "active",
    window: "window",
    tagged: "tagged",
    selectionKey: "selection-key",
    streamingSource: "streaming-source",
    chunkTreeTraversal: "chunk-tree-traversal",
    ...options.reasonLabels,
  };
  const chunkTree = resolveChunkTreeOption(options.chunkTree, topology);
  const chunkGraph = options.chunkGraph ?? (chunkTree === undefined ? undefined : createPolyWorldChunkGraphFromTree(chunkTree));
  const orderedRegionIds = options.orderedRegionIds ?? topology.regions.map((region) => region.id);
  const before = options.windowRadius ?? options.before ?? 0;
  const after = options.windowRadius ?? options.after ?? 0;
  const targetState = options.targetState ?? "active";
  const regionIds: string[] = [];
  const selectionKeys: string[] = [];
  const requestedRegionIds: string[] = [];
  const missingRegionIds: string[] = [];
  const reasons: PolyWorldSelectionReason[] = [...(options.reasons ?? [])];
  const sourceSummaries: PolyWorldChunkStreamingSourceSummary[] = [];
  const initiallyLoaded = new Set(options.loadedRegionIds ?? []);
  const loadedRegionIds = new Set(options.loadedRegionIds ?? []);
  const residentRegionIds = new Set(options.residentRegionIds ?? []);
  const activeRegionIds = new Set(options.activeRegionIds ?? []);
  const renderedRegionIds = new Set(options.renderedRegionIds ?? []);
  const preloadedRegionIds = new Set(options.preloadedRegionIds ?? []);
  const chunkTraversal = chunkTree === undefined || options.chunkTraversal === undefined || options.chunkTraversal === false
    ? undefined
    : resolvePolyWorldChunkTreeTraversal(chunkTree, {
      currentRegionId: options.currentRegionId,
      nearest: options.nearest,
      ...options.chunkTraversal,
    });

  for (const activeRegionId of options.activeRegionIds ?? []) add(regionIds, activeRegionId);
  if ((options.activeRegionIds?.length ?? 0) > 0) {
    reasons.push({
      id: "poly-world-chunk-active",
      kind: "active",
      label: labels.active,
      regionIds: unique(options.activeRegionIds),
    });
  }

  const sources = [...normalizeStreamingSources(options)].sort(compareStreamingSources);
  for (const source of sources) {
    const sourceRegionId = resolveStreamingSourceRegionId(topology, source, options);
    const sourceTargetState = source.targetState ?? targetState;
    const priority = source.priority ?? 0;
    const label = source.label ?? labels.streamingSource;

    if (sourceRegionId === undefined) {
      const missingRegionId = source.regionId;
      if (missingRegionId !== undefined) add(missingRegionIds, missingRegionId);
      sourceSummaries.push({
        sourceId: source.id,
        selectedRegionIds: [],
        targetState: sourceTargetState,
        priority,
        label,
        tags: source.tags,
        missingRegionId,
        data: source.data,
      });
      continue;
    }

    const sourceSelection = selectedRegionsForStreamingSource(topology, source, sourceRegionId, {
      orderedRegionIds,
      before,
      after,
      loadingRange: options.loadingRange,
      chunkGraph,
      chunkGraphExpansion: options.chunkGraphExpansion,
    });
    const selectedRegionIds = sourceSelection.regionIds;
    for (const missingRegionId of sourceSelection.missingRegionIds) add(missingRegionIds, missingRegionId);
    const graphRegionIds = new Set(sourceSelection.graphRegionIds);
    for (const selectedRegionId of selectedRegionIds) {
      add(regionIds, selectedRegionId);
      add(requestedRegionIds, selectedRegionId);
      const selectedTargetState = sourceSelection.graphTargetState !== undefined && graphRegionIds.has(selectedRegionId)
        ? sourceSelection.graphTargetState
        : sourceTargetState;
      addTargetState(selectedRegionId, selectedTargetState, {
        loadedRegionIds,
        residentRegionIds,
        activeRegionIds,
        renderedRegionIds,
        preloadedRegionIds,
      });
    }
    for (const selectionKey of source.selectionKeys ?? []) add(selectionKeys, selectionKey);

    sourceSummaries.push({
      sourceId: source.id,
      currentRegionId: sourceRegionId,
      selectedRegionIds,
      ...(sourceSelection.graphRegionIds.length === 0 ? {} : { graphRegionIds: sourceSelection.graphRegionIds }),
      ...(sourceSelection.graphTargetState === undefined ? {} : { graphTargetState: sourceSelection.graphTargetState }),
      targetState: sourceTargetState,
      priority,
      label,
      tags: source.tags,
      ...(sourceSelection.missingRegionIds.length === 0 ? {} : { missingRegionIds: sourceSelection.missingRegionIds }),
      data: source.data,
    });
    reasons.push({
      id: `poly-world-chunk-source-${source.id}`,
      kind: "streamingSource",
      label,
      regionIds: selectedRegionIds,
      selectionKeys: unique(source.selectionKeys),
      tags: source.tags,
      data: {
        sourceId: source.id,
        currentRegionId: sourceRegionId,
        targetState: sourceTargetState,
        priority,
        ...(source.data ?? {}),
      },
    });
  }

  for (const tagged of options.taggedRegionSelections ?? []) {
    for (const regionId of tagged.regionIds) {
      add(regionIds, regionId);
      add(requestedRegionIds, regionId);
    }
    for (const selectionKey of tagged.selectionKeys ?? []) add(selectionKeys, selectionKey);
    reasons.push({
      id: tagged.kind === undefined ? undefined : `poly-world-chunk-${tagged.kind}`,
      kind: tagged.kind ?? "tagged",
      label: tagged.label || labels.tagged,
      regionIds: unique(tagged.regionIds),
      selectionKeys: unique(tagged.selectionKeys),
      tags: tagged.tags,
      data: tagged.data,
    });
  }

  if (chunkTraversal !== undefined) {
    for (const regionId of chunkTraversal.selectedRegionIds) {
      add(regionIds, regionId);
      add(requestedRegionIds, regionId);
    }
    for (const regionId of chunkTraversal.requestedRegionIds) add(requestedRegionIds, regionId);
    for (const regionId of chunkTraversal.loadedRegionIds) {
      addTargetState(regionId, "loaded", {
        loadedRegionIds,
        residentRegionIds,
        activeRegionIds,
        renderedRegionIds,
        preloadedRegionIds,
      });
    }
    for (const regionId of chunkTraversal.residentRegionIds) {
      addTargetState(regionId, "resident", {
        loadedRegionIds,
        residentRegionIds,
        activeRegionIds,
        renderedRegionIds,
        preloadedRegionIds,
      });
    }
    for (const regionId of chunkTraversal.renderedRegionIds) {
      addTargetState(regionId, "rendered", {
        loadedRegionIds,
        residentRegionIds,
        activeRegionIds,
        renderedRegionIds,
        preloadedRegionIds,
      });
    }
    reasons.push({
      id: "poly-world-chunk-tree-traversal",
      kind: "chunkTreeTraversal",
      label: labels.chunkTreeTraversal,
      regionIds: chunkTraversal.selectedRegionIds,
      data: {
        currentChunkId: chunkTraversal.currentChunkId,
        selectedChunkIds: chunkTraversal.selectedChunkIds,
        renderedChunkIds: chunkTraversal.renderedChunkIds,
        requestedChunkIds: chunkTraversal.requestedChunkIds,
        budgetClippedChunkIds: chunkTraversal.budgetClippedChunkIds,
        totalRenderCost: chunkTraversal.totalRenderCost,
        totalLoadCost: chunkTraversal.totalLoadCost,
      },
    });
  }

  for (const regionId of regionIds) {
    const region = topology.regionsById.get(regionId);
    for (const selectionKey of region?.selectionKeys ?? []) add(selectionKeys, selectionKey);
    for (const selectionKey of resolvePolyWorldRegionSelectionKeys(options.regionSelectionKeys, regionId, topology)) {
      add(selectionKeys, selectionKey);
    }
  }

  for (const selectionKey of options.selectionKeys ?? []) add(selectionKeys, selectionKey);
  if (selectionKeys.length > 0) {
    reasons.push({
      id: "poly-world-chunk-selection-key",
      kind: "selectionKey",
      label: labels.selectionKey,
      selectionKeys,
    });
  }

  const loadedIds = uniqueSorted([...loadedRegionIds]);

  return {
    regionIds,
    selectionKeys,
    reasons,
    data: options.data,
    streaming: {
      requestedRegionIds,
      loadingRegionIds: requestedRegionIds.filter((regionId) => !initiallyLoaded.has(regionId)),
      loadedRegionIds: loadedIds,
      residentRegionIds: uniqueSorted([...residentRegionIds]),
      activeRegionIds: uniqueSorted([...activeRegionIds]),
      renderedRegionIds: uniqueSorted([...renderedRegionIds]),
      preloadedRegionIds: uniqueSorted([...preloadedRegionIds]),
      missingRegionIds,
      sources: sourceSummaries.sort((a, b) => compareSourceSummaries(a, b)),
      ...(chunkTree === undefined ? {} : { chunkTree: summarizePolyWorldChunkTree(chunkTree) }),
      ...(chunkTraversal === undefined ? {} : { chunkTraversal }),
    },
  };
}

export function selectPolyWorldChunkStreamingState(
  topology: PolyWorldTopology,
  selection: PolyWorldChunkStreamingSelection,
  state: PolyWorldChunkStreamingStateName,
  options: PolyWorldChunkStreamingStateSelectionOptions = {},
): PolyWorldSelection {
  const regionIds = regionIdsForStreamingState(selection.streaming, state);
  const selectionKeys: string[] = [];
  for (const regionId of regionIds) {
    const region = topology.regionsById.get(regionId);
    for (const selectionKey of region?.selectionKeys ?? []) add(selectionKeys, selectionKey);
    for (const selectionKey of resolvePolyWorldRegionSelectionKeys(options.regionSelectionKeys, regionId, topology)) {
      add(selectionKeys, selectionKey);
    }
  }
  for (const selectionKey of options.selectionKeys ?? []) add(selectionKeys, selectionKey);
  return {
    regionIds,
    selectionKeys,
    reasons: [
      ...(options.reasons ?? []),
      {
        id: `poly-world-chunk-streaming-${state}`,
        kind: "streamingState",
        label: options.reasonLabel ?? state,
        regionIds,
        selectionKeys,
        data: { state },
      },
    ],
    data: options.data,
  };
}

function regionIdsForStreamingState(
  state: PolyWorldChunkStreamingState,
  stateName: PolyWorldChunkStreamingStateName,
): readonly string[] {
  if (stateName === "requested") return state.requestedRegionIds;
  if (stateName === "loading") return state.loadingRegionIds;
  if (stateName === "loaded") return state.loadedRegionIds;
  if (stateName === "resident") return state.residentRegionIds;
  if (stateName === "active") return state.activeRegionIds;
  if (stateName === "rendered") return state.renderedRegionIds;
  return state.preloadedRegionIds;
}

interface NormalizedChunkTreeTraversalBudget {
  publicBudget: PolyWorldChunkTreeTraversalBudget;
  maxRenderedChunks?: number;
  maxLoadedChunks?: number;
  maxRenderCost?: number;
  maxLoadCost?: number;
  targetGeometricError?: number;
  maxScreenSpaceError?: number;
  maxDepth?: number;
}

interface ChunkTreeTraversalState {
  tree: PolyWorldChunkTree;
  budget: NormalizedChunkTreeTraversalBudget;
  viewPlanes: readonly PolyWorldChunkTreeTraversalPlane[];
  screenSpaceError?: PolyWorldChunkTreeTraversalScreenSpaceError;
  point?: Vec3;
  currentChunkId?: string;
  activePath: ReadonlySet<string>;
  entries: PolyWorldChunkTreeTraversalEntry[];
  selectedChunkIds: string[];
  refinedChunkIds: string[];
  renderedChunkIds: string[];
  loadedChunkIds: string[];
  residentChunkIds: string[];
  requestedChunkIds: string[];
  heldChunkIds: string[];
  unavailableChunkIds: string[];
  viewCulledChunkIds: string[];
  outsideRequestVolumeChunkIds: string[];
  skippedChunkIds: string[];
  budgetClippedChunkIds: string[];
  selectedRegionIds: string[];
  renderedRegionIds: string[];
  loadedRegionIds: string[];
  residentRegionIds: string[];
  requestedRegionIds: string[];
  totalRenderCost: number;
  totalLoadCost: number;
  renderedCount: number;
  loadedCount: number;
  visited: Set<string>;
}

function visitChunkTreeTraversal(
  chunkId: string,
  depth: number,
  baseReasons: readonly PolyWorldChunkTreeTraversalReason[],
  state: ChunkTreeTraversalState,
): void {
  const chunk = state.tree.chunksById.get(chunkId);
  if (chunk === undefined || state.visited.has(chunkId)) return;
  state.visited.add(chunkId);

  const reasons: PolyWorldChunkTreeTraversalReason[] = [...baseReasons];
  if (chunk.id === state.currentChunkId) addReason(reasons, "current");
  else if (state.activePath.has(chunk.id)) addReason(reasons, "ancestor");

  const available = chunk.available !== false;
  const contentAvailable = chunk.contentAvailable === true;
  const cost = chunk.cost ?? 1;
  const priority = chunk.priority ?? 0;
  const childIds = state.tree.childIdsById.get(chunk.id) ?? [];

  if (!state.activePath.has(chunk.id) && isChunkOutsideViewerRequestBounds(chunk, state.point)) {
    addReason(reasons, "outside-request-volume");
    addReason(reasons, "skipped");
    add(state.outsideRequestVolumeChunkIds, chunk.id);
    add(state.skippedChunkIds, chunk.id);
    addTraversalEntry(state, chunk, depth, available, contentAvailable, cost, priority, reasons);
    markSkippedChunkSubtree(state, childIds, depth + 1, ["outside-request-volume"]);
    return;
  }

  if (!state.activePath.has(chunk.id) && isChunkOutsideTraversalView(chunk, state.viewPlanes)) {
    addReason(reasons, "view-culled");
    addReason(reasons, "skipped");
    add(state.viewCulledChunkIds, chunk.id);
    add(state.skippedChunkIds, chunk.id);
    addTraversalEntry(state, chunk, depth, available, contentAvailable, cost, priority, reasons);
    markSkippedChunkSubtree(state, childIds, depth + 1, ["view-culled"]);
    return;
  }

  if (!available) {
    addReason(reasons, "unavailable");
    add(state.unavailableChunkIds, chunk.id);
    addTraversalEntry(state, chunk, depth, available, contentAvailable, cost, priority, reasons);
    markSkippedChunkSubtree(state, childIds, depth + 1);
    return;
  }

  const depthCapped = state.budget.maxDepth !== undefined && depth >= state.budget.maxDepth;
  const shouldRefine = childIds.length > 0 && !depthCapped && shouldRefineChunk(chunk, state);

  if (shouldRefine) {
    addReason(reasons, "refined");
    add(state.refinedChunkIds, chunk.id);
    if (contentAvailable) {
      if (chunk.refinement === "add") renderChunkTraversalEntry(state, chunk, cost, reasons);
      else holdChunkTraversalEntry(state, chunk, cost, reasons);
    } else {
      requestChunkTraversalEntry(state, chunk, reasons);
    }
    addTraversalEntry(state, chunk, depth, available, contentAvailable, cost, priority, reasons);
    for (const childId of sortChunkTraversalChildIds(state.tree, childIds)) {
      visitChunkTreeTraversal(childId, depth + 1, [], state);
    }
    return;
  }

  if (contentAvailable) renderChunkTraversalEntry(state, chunk, cost, reasons);
  else requestChunkTraversalEntry(state, chunk, reasons);
  addTraversalEntry(state, chunk, depth, available, contentAvailable, cost, priority, reasons);
  if (childIds.length > 0) markSkippedChunkSubtree(state, childIds, depth + 1);
}

function shouldRefineChunk(
  chunk: PolyWorldChunkTreeNode,
  state: ChunkTreeTraversalState,
): boolean {
  if (state.activePath.has(chunk.id)) return true;
  const screenSpaceError = resolveChunkTraversalScreenSpaceError(state, chunk);
  if (screenSpaceError !== undefined && state.budget.maxScreenSpaceError !== undefined) {
    return screenSpaceError > state.budget.maxScreenSpaceError;
  }
  const targetGeometricError = state.budget.targetGeometricError;
  return targetGeometricError !== undefined && (chunk.geometricError ?? 0) > targetGeometricError;
}

function renderChunkTraversalEntry(
  state: ChunkTreeTraversalState,
  chunk: PolyWorldChunkTreeNode,
  cost: number,
  reasons: PolyWorldChunkTreeTraversalReason[],
): void {
  if (!loadChunkTraversalEntry(state, chunk, cost, reasons)) return;
  if (
    exceedsBudget(state.renderedCount + 1, state.budget.maxRenderedChunks) ||
    exceedsBudget(state.totalRenderCost + cost, state.budget.maxRenderCost)
  ) {
    addReason(reasons, "budget-clipped");
    addReason(reasons, "held");
    add(state.budgetClippedChunkIds, chunk.id);
    add(state.heldChunkIds, chunk.id);
    add(state.residentChunkIds, chunk.id);
    addRegion(state.residentRegionIds, chunk);
    return;
  }
  addReason(reasons, "rendered");
  state.renderedCount += 1;
  state.totalRenderCost += cost;
  add(state.renderedChunkIds, chunk.id);
  add(state.residentChunkIds, chunk.id);
  addRegion(state.renderedRegionIds, chunk);
  addRegion(state.residentRegionIds, chunk);
}

function holdChunkTraversalEntry(
  state: ChunkTreeTraversalState,
  chunk: PolyWorldChunkTreeNode,
  cost: number,
  reasons: PolyWorldChunkTreeTraversalReason[],
): void {
  if (!loadChunkTraversalEntry(state, chunk, cost, reasons)) return;
  addReason(reasons, "held");
  addReason(reasons, "resident");
  add(state.heldChunkIds, chunk.id);
  add(state.residentChunkIds, chunk.id);
  addRegion(state.residentRegionIds, chunk);
}

function loadChunkTraversalEntry(
  state: ChunkTreeTraversalState,
  chunk: PolyWorldChunkTreeNode,
  cost: number,
  reasons: PolyWorldChunkTreeTraversalReason[],
): boolean {
  if (
    exceedsBudget(state.loadedCount + 1, state.budget.maxLoadedChunks) ||
    exceedsBudget(state.totalLoadCost + cost, state.budget.maxLoadCost)
  ) {
    addReason(reasons, "budget-clipped");
    add(state.budgetClippedChunkIds, chunk.id);
    return false;
  }
  addReason(reasons, "loaded");
  state.loadedCount += 1;
  state.totalLoadCost += cost;
  add(state.loadedChunkIds, chunk.id);
  add(state.selectedChunkIds, chunk.id);
  addRegion(state.loadedRegionIds, chunk);
  addRegion(state.selectedRegionIds, chunk);
  return true;
}

function requestChunkTraversalEntry(
  state: ChunkTreeTraversalState,
  chunk: PolyWorldChunkTreeNode,
  reasons: PolyWorldChunkTreeTraversalReason[],
): void {
  addReason(reasons, "requested");
  add(state.requestedChunkIds, chunk.id);
  add(state.selectedChunkIds, chunk.id);
  addRegion(state.requestedRegionIds, chunk);
  addRegion(state.selectedRegionIds, chunk);
}

function addTraversalEntry(
  state: ChunkTreeTraversalState,
  chunk: PolyWorldChunkTreeNode,
  depth: number,
  available: boolean,
  contentAvailable: boolean,
  cost: number,
  priority: number,
  reasons: readonly PolyWorldChunkTreeTraversalReason[],
): void {
  const distanceToCamera = resolveChunkTraversalDistanceToCamera(state, chunk);
  const screenSpaceError = resolveChunkTraversalScreenSpaceError(state, chunk, distanceToCamera);
  state.entries.push({
    chunkId: chunk.id,
    ...(chunk.regionId === undefined ? {} : { regionId: chunk.regionId }),
    ...(chunk.parentId === undefined ? {} : { parentId: chunk.parentId }),
    depth,
    available,
    contentAvailable,
    ...(chunk.refinement === undefined ? {} : { refinement: chunk.refinement }),
    ...(chunk.geometricError === undefined ? {} : { geometricError: chunk.geometricError }),
    ...(distanceToCamera === undefined ? {} : { distanceToCamera }),
    ...(screenSpaceError === undefined ? {} : { screenSpaceError }),
    cost,
    priority,
    reasons: uniqueReasons(reasons),
  });
}

function markSkippedChunkSubtree(
  state: ChunkTreeTraversalState,
  chunkIds: readonly string[],
  depth: number,
  extraReasons: readonly PolyWorldChunkTreeTraversalReason[] = [],
): void {
  for (const chunkId of sortChunkTraversalChildIds(state.tree, chunkIds)) {
    const chunk = state.tree.chunksById.get(chunkId);
    if (chunk === undefined || state.visited.has(chunk.id)) continue;
    state.visited.add(chunk.id);
    const reasons: PolyWorldChunkTreeTraversalReason[] = [...extraReasons, "skipped"];
    if (extraReasons.includes("view-culled")) add(state.viewCulledChunkIds, chunk.id);
    if (extraReasons.includes("outside-request-volume")) add(state.outsideRequestVolumeChunkIds, chunk.id);
    add(state.skippedChunkIds, chunk.id);
    addTraversalEntry(
      state,
      chunk,
      depth,
      chunk.available !== false,
      chunk.contentAvailable === true,
      chunk.cost ?? 1,
      chunk.priority ?? 0,
      reasons,
    );
    markSkippedChunkSubtree(state, state.tree.childIdsById.get(chunk.id) ?? [], depth + 1, extraReasons);
  }
}

function normalizeChunkTraversalBudget(
  budget: PolyWorldChunkTreeTraversalBudget | undefined,
): NormalizedChunkTreeTraversalBudget {
  return {
    publicBudget: {
      ...optionalNonNegativeInteger("maxRenderedChunks", budget?.maxRenderedChunks),
      ...optionalNonNegativeInteger("maxLoadedChunks", budget?.maxLoadedChunks),
      ...optionalNonNegativeNumber("maxRenderCost", budget?.maxRenderCost),
      ...optionalNonNegativeNumber("maxLoadCost", budget?.maxLoadCost),
      ...optionalNonNegativeNumber("targetGeometricError", budget?.targetGeometricError),
      ...optionalNonNegativeNumber("maxScreenSpaceError", budget?.maxScreenSpaceError),
      ...optionalNonNegativeInteger("maxDepth", budget?.maxDepth),
    },
    maxRenderedChunks: normalizeNonNegativeInteger(budget?.maxRenderedChunks),
    maxLoadedChunks: normalizeNonNegativeInteger(budget?.maxLoadedChunks),
    maxRenderCost: normalizeNonNegativeNumber(budget?.maxRenderCost),
    maxLoadCost: normalizeNonNegativeNumber(budget?.maxLoadCost),
    targetGeometricError: normalizeNonNegativeNumber(budget?.targetGeometricError),
    maxScreenSpaceError: normalizeNonNegativeNumber(budget?.maxScreenSpaceError),
    maxDepth: normalizeNonNegativeInteger(budget?.maxDepth),
  };
}

function optionalChunkTraversalScreenSpaceError(
  options: PolyWorldChunkTreeTraversalOptions,
): { screenSpaceError?: PolyWorldChunkTreeTraversalScreenSpaceError } {
  const viewportHeight = normalizePositiveNumber(options.viewportHeight);
  if (viewportHeight === undefined || options.point === undefined) return {};
  const fovDegrees = normalizePositiveNumber(options.fovDegrees ?? 90);
  if (fovDegrees === undefined) return {};
  const aspect = normalizePositiveNumber(options.aspect);
  const verticalFovDegrees = aspect === undefined
    ? fovDegrees
    : horizontalFovToVerticalFovDegrees(fovDegrees, aspect);
  const distanceFloor = normalizePositiveNumber(options.screenSpaceErrorDistanceFloor)
    ?? Math.max(normalizeNonNegativeNumber(options.near) ?? 0, 0.0001);
  const maxError = normalizeNonNegativeNumber(options.budget?.maxScreenSpaceError);
  return {
    screenSpaceError: {
      viewportHeight,
      fovDegrees: verticalFovDegrees,
      ...(maxError === undefined ? {} : { maxError }),
      distanceFloor,
    },
  };
}

function resolveChunkTraversalScreenSpaceError(
  state: ChunkTreeTraversalState,
  chunk: PolyWorldChunkTreeNode,
  distanceToCamera = resolveChunkTraversalDistanceToCamera(state, chunk),
): number | undefined {
  if (
    state.screenSpaceError === undefined ||
    distanceToCamera === undefined ||
    chunk.geometricError === undefined
  ) {
    return undefined;
  }
  const distance = Math.max(distanceToCamera, state.screenSpaceError.distanceFloor);
  const verticalFovRadians = state.screenSpaceError.fovDegrees * Math.PI / 180;
  const denominator = 2 * distance * Math.tan(verticalFovRadians / 2);
  if (!Number.isFinite(denominator) || denominator <= 0) return undefined;
  return chunk.geometricError * state.screenSpaceError.viewportHeight / denominator;
}

function resolveChunkTraversalDistanceToCamera(
  state: ChunkTreeTraversalState,
  chunk: PolyWorldChunkTreeNode,
): number | undefined {
  if (state.point === undefined) return undefined;
  const bounds = chunk.contentBounds ?? chunk.bounds;
  if (bounds === undefined) return undefined;
  return Math.sqrt(distanceSqToBounds(state.point, bounds));
}

function distanceSqToBounds(point: Vec3, bounds: PolyWorldBounds): number {
  let total = 0;
  for (let axis = 0; axis < 3; axis += 1) {
    const min = bounds.min[axis] ?? 0;
    const max = bounds.max[axis] ?? 0;
    const coordinate = point[axis] ?? 0;
    const delta = coordinate < min ? min - coordinate : coordinate > max ? coordinate - max : 0;
    total += delta * delta;
  }
  return total;
}

function horizontalFovToVerticalFovDegrees(horizontalFovDegrees: number, aspect: number): number {
  const horizontal = horizontalFovDegrees * Math.PI / 180;
  const vertical = 2 * Math.atan(Math.tan(horizontal / 2) / aspect);
  return vertical * 180 / Math.PI;
}

function resolveChunkTraversalViewPlanes(
  options: PolyWorldChunkTreeTraversalOptions,
): readonly PolyWorldChunkTreeTraversalPlane[] {
  if (options.frustum !== undefined) {
    return options.frustum
      .map((plane) => normalizeChunkTraversalPlane(plane))
      .filter((plane): plane is PolyWorldChunkTreeTraversalPlane => plane !== undefined);
  }
  if (options.point === undefined || options.forward === undefined) return [];
  return createChunkTraversalViewPlanes(options.point, options.forward, {
    up: options.up,
    fovDegrees: options.fovDegrees ?? 90,
    aspect: options.aspect,
    near: options.near,
    far: options.far,
  });
}

function normalizeChunkTraversalPlane(
  plane: PolyWorldChunkTreeTraversalPlane,
): PolyWorldChunkTreeTraversalPlane | undefined {
  const normal = normalizeVec3(plane.normal);
  if (normal === undefined || !Number.isFinite(plane.distance)) return undefined;
  return { normal, distance: plane.distance };
}

function createChunkTraversalViewPlanes(
  origin: Vec3,
  forward: Vec3,
  options: {
    up?: Vec3;
    fovDegrees: number;
    aspect?: number;
    near?: number;
    far?: number;
  },
): readonly PolyWorldChunkTreeTraversalPlane[] {
  if (!isFiniteChunkTreeVec3(origin)) return [];
  const forwardDirection = normalizeVec3(forward);
  if (forwardDirection === undefined) return [];
  const aspect = Number.isFinite(options.aspect) && (options.aspect ?? 0) > 0 ? options.aspect as number : 1;
  const near = Number.isFinite(options.near) ? Math.max(0, options.near as number) : 0;
  const planes: PolyWorldChunkTreeTraversalPlane[] = [];
  if (near > 0) {
    planes.push({
      normal: forwardDirection,
      distance: dotVec3(forwardDirection, origin) + near,
    });
  }
  if (options.far !== undefined && Number.isFinite(options.far) && options.far > near) {
    const farNormal = scaleVec3(forwardDirection, -1);
    planes.push({
      normal: farNormal,
      distance: dotVec3(farNormal, addVec3(origin, scaleVec3(forwardDirection, options.far))),
    });
  }
  const fovDegrees = Number.isFinite(options.fovDegrees) && options.fovDegrees > 0
    ? Math.min(options.fovDegrees, 360)
    : 90;
  if (fovDegrees >= 359.999) return planes;

  const basis = createChunkTraversalViewBasis(forwardDirection, options.up);
  const halfHorizontal = fovDegrees * Math.PI / 360;
  const halfVertical = Math.atan(Math.tan(halfHorizontal) / aspect);
  const horizontal = Math.tan(halfHorizontal);
  const vertical = Math.tan(halfVertical);
  const topLeft = normalizeVec3(addVec3(addVec3(forwardDirection, scaleVec3(basis.up, vertical)), scaleVec3(basis.right, -horizontal)));
  const topRight = normalizeVec3(addVec3(addVec3(forwardDirection, scaleVec3(basis.up, vertical)), scaleVec3(basis.right, horizontal)));
  const bottomRight = normalizeVec3(addVec3(addVec3(forwardDirection, scaleVec3(basis.up, -vertical)), scaleVec3(basis.right, horizontal)));
  const bottomLeft = normalizeVec3(addVec3(addVec3(forwardDirection, scaleVec3(basis.up, -vertical)), scaleVec3(basis.right, -horizontal)));
  for (const plane of [
    createChunkTraversalRayPlane(origin, topLeft, topRight, forwardDirection),
    createChunkTraversalRayPlane(origin, topRight, bottomRight, forwardDirection),
    createChunkTraversalRayPlane(origin, bottomRight, bottomLeft, forwardDirection),
    createChunkTraversalRayPlane(origin, bottomLeft, topLeft, forwardDirection),
  ]) {
    if (plane !== undefined) planes.push(plane);
  }
  return planes;
}

function createChunkTraversalViewBasis(forward: Vec3, up: Vec3 | undefined): { right: Vec3; up: Vec3 } {
  const worldUp = normalizeVec3(up ?? [0, 0, 1]) ?? [0, 0, 1];
  let right = normalizeVec3(crossVec3(forward, worldUp));
  if (right === undefined) right = normalizeVec3(crossVec3(forward, [0, 1, 0])) ?? [1, 0, 0];
  const viewUp = normalizeVec3(crossVec3(right, forward)) ?? worldUp;
  return { right, up: viewUp };
}

function createChunkTraversalRayPlane(
  origin: Vec3,
  a: Vec3 | undefined,
  b: Vec3 | undefined,
  forward: Vec3,
): PolyWorldChunkTreeTraversalPlane | undefined {
  if (a === undefined || b === undefined) return undefined;
  let normal = normalizeVec3(crossVec3(a, b));
  if (normal === undefined) return undefined;
  if (dotVec3(normal, forward) < 0) normal = scaleVec3(normal, -1);
  return {
    normal,
    distance: dotVec3(normal, origin),
  };
}

function isChunkOutsideTraversalView(
  chunk: PolyWorldChunkTreeNode,
  planes: readonly PolyWorldChunkTreeTraversalPlane[],
): boolean {
  const bounds = chunk.contentBounds ?? chunk.bounds;
  if (planes.length === 0 || bounds === undefined) return false;
  const corners = boundsCorners(bounds);
  return planes.some((plane) =>
    corners.every((corner) => signedChunkTraversalPlaneDistance(plane, corner) < -0.0001)
  );
}

function isChunkOutsideViewerRequestBounds(
  chunk: PolyWorldChunkTreeNode,
  point: Vec3 | undefined,
): boolean {
  if (point === undefined || chunk.viewerRequestBounds === undefined) return false;
  return !boundsContainsPoint(chunk.viewerRequestBounds, point);
}

function signedChunkTraversalPlaneDistance(
  plane: PolyWorldChunkTreeTraversalPlane,
  point: Vec3,
): number {
  return dotVec3(plane.normal, point) - plane.distance;
}

function resolveChunkTraversalCurrentChunkId(
  tree: PolyWorldChunkTree,
  options: PolyWorldChunkTreeTraversalOptions,
): string | undefined {
  if (options.currentChunkId !== undefined && tree.chunksById.has(options.currentChunkId)) return options.currentChunkId;
  if (options.currentRegionId !== undefined) return tree.chunksByRegionId.get(options.currentRegionId)?.id;
  if (options.point === undefined) return undefined;
  const containing = tree.chunks
    .filter((chunk) => chunk.bounds !== undefined && boundsContainsPoint(chunk.bounds, options.point as Vec3))
    .sort((a, b) => boundsVolume(a.bounds) - boundsVolume(b.bounds) || compareChunkTraversalNodes(a, b));
  if (containing.length > 0) return containing[0]?.id;
  if (options.nearest !== true) return undefined;
  return tree.chunks
    .filter((chunk) => chunk.bounds !== undefined)
    .sort((a, b) =>
      distanceSq(centerFromBounds(a.bounds) as Vec3, options.point as Vec3) -
      distanceSq(centerFromBounds(b.bounds) as Vec3, options.point as Vec3) ||
      compareChunkTraversalNodes(a, b)
    )[0]?.id;
}

function resolveChunkAncestorIds(tree: PolyWorldChunkTree, chunkId: string): string[] {
  const ancestorIds: string[] = [];
  let currentId = tree.parentIdById.get(chunkId);
  while (currentId !== undefined) {
    ancestorIds.unshift(currentId);
    currentId = tree.parentIdById.get(currentId);
  }
  return ancestorIds;
}

function sortChunkTraversalChildIds(
  tree: PolyWorldChunkTree,
  childIds: readonly string[],
): string[] {
  return [...childIds].sort((a, b) => {
    const chunkA = tree.chunksById.get(a);
    const chunkB = tree.chunksById.get(b);
    if (chunkA === undefined || chunkB === undefined) return compareStrings(a, b);
    return compareChunkTraversalNodes(chunkA, chunkB);
  });
}

function compareChunkTraversalNodes(
  a: PolyWorldChunkTreeNode,
  b: PolyWorldChunkTreeNode,
): number {
  return (b.priority ?? 0) - (a.priority ?? 0) ||
    (b.geometricError ?? 0) - (a.geometricError ?? 0) ||
    compareStrings(a.id, b.id);
}

function addRegion(values: string[], chunk: PolyWorldChunkTreeNode): void {
  if (chunk.regionId !== undefined) add(values, chunk.regionId);
}

function addReason(values: PolyWorldChunkTreeTraversalReason[], value: PolyWorldChunkTreeTraversalReason): void {
  if (!values.includes(value)) values.push(value);
}

function uniqueReasons(values: readonly PolyWorldChunkTreeTraversalReason[]): PolyWorldChunkTreeTraversalReason[] {
  return [...new Set(values)];
}

function exceedsBudget(value: number, budget: number | undefined): boolean {
  return budget !== undefined && value > budget;
}

function resolveChunkTreeOption(
  input: PolyWorldChunkTree | PolyWorldChunkTreeInput | undefined,
  topology: PolyWorldTopology,
): PolyWorldChunkTree | undefined {
  if (input === undefined) return undefined;
  if ("chunksById" in input) return input;
  return createPolyWorldChunkTree(input, { topology });
}

function normalizeStreamingSources(
  options: PolyWorldChunkStreamingSelectionOptions,
): readonly PolyWorldChunkStreamingSource[] {
  if (options.sources !== undefined) return options.sources;
  if (options.chunkTraversal !== undefined && options.chunkTraversal !== false) return [];
  if (options.currentRegionId === undefined) return [];
  return [{
    id: "current",
    regionId: options.currentRegionId,
    before: options.before,
    after: options.after,
    windowRadius: options.windowRadius,
    loadingRange: options.loadingRange,
    nearest: options.nearest,
    targetState: options.targetState,
    label: options.reasonLabels?.current ?? "current",
  }];
}

function validateChunkTreeNode(
  chunk: PolyWorldChunkTreeNode,
  chunkIds: ReadonlySet<string>,
  topology: PolyWorldTopology | undefined,
  diagnostics: PolyWorldChunkTreeDiagnostic[],
): void {
  if (chunk.regionId !== undefined) {
    validateChunkTreeId("chunk", chunk.regionId, "regionId", diagnostics, chunk.id);
    if (topology !== undefined && !topology.regionsById.has(chunk.regionId)) {
      diagnostics.push({
        code: "poly-world-missing-chunk-region",
        message: `PolyWorld chunk "${chunk.id}" references missing region "${chunk.regionId}".`,
        id: chunk.id,
        field: "regionId",
      });
    }
  }
  if (chunk.parentId !== undefined) {
    validateChunkTreeId("chunk", chunk.parentId, "parentId", diagnostics, chunk.id);
    if (chunk.parentId === chunk.id) {
      diagnostics.push({
        code: "poly-world-self-chunk-parent",
        message: `PolyWorld chunk "${chunk.id}" cannot be its own parent.`,
        id: chunk.id,
        field: "parentId",
      });
    } else if (!chunkIds.has(chunk.parentId)) {
      diagnostics.push({
        code: "poly-world-missing-chunk-parent",
        message: `PolyWorld chunk "${chunk.id}" references missing parent chunk "${chunk.parentId}".`,
        id: chunk.id,
        field: "parentId",
      });
    }
  }
  for (const childId of chunk.childIds ?? []) {
    validateChunkTreeId("chunk", childId, "childIds", diagnostics, chunk.id);
    if (childId === chunk.id) {
      diagnostics.push({
        code: "poly-world-self-chunk-child",
        message: `PolyWorld chunk "${chunk.id}" cannot be its own child.`,
        id: chunk.id,
        field: "childIds",
      });
    } else if (!chunkIds.has(childId)) {
      diagnostics.push({
        code: "poly-world-missing-chunk-child",
        message: `PolyWorld chunk "${chunk.id}" references missing child chunk "${childId}".`,
        id: chunk.id,
        field: "childIds",
      });
    }
  }
  validateChunkTreeBounds(chunk, "bounds", chunk.bounds, diagnostics);
  validateChunkTreeBounds(chunk, "contentBounds", chunk.contentBounds, diagnostics);
  validateChunkTreeBounds(chunk, "viewerRequestBounds", chunk.viewerRequestBounds, diagnostics);
  validateChunkTreeStringArray(chunk, "resourceIds", chunk.resourceIds, diagnostics);
  validateChunkTreeStringArray(chunk, "tags", chunk.tags, diagnostics);
  if (chunk.refinement !== undefined && chunk.refinement !== "replace" && chunk.refinement !== "add") {
    diagnostics.push({
      code: "poly-world-invalid-chunk-refinement",
      message: `PolyWorld chunk "${chunk.id}" has invalid refinement "${String(chunk.refinement)}".`,
      id: chunk.id,
      field: "refinement",
    });
  }
  validateFiniteNonNegative(chunk, "geometricError", chunk.geometricError, diagnostics);
  validateFiniteNonNegative(chunk, "cost", chunk.cost, diagnostics);
  validateFiniteNumber(chunk, "priority", chunk.priority, diagnostics);
}

function validateChunkTreeAvailability(
  chunks: readonly PolyWorldChunkTreeNode[],
  diagnostics: PolyWorldChunkTreeDiagnostic[],
): void {
  const chunksById = new Map(chunks.map((chunk) => [chunk.id, chunk]));
  for (const chunk of chunks) {
    if (chunk.available === false && chunk.contentAvailable === true) {
      diagnostics.push({
        code: "poly-world-unavailable-chunk-content",
        message: `PolyWorld chunk "${chunk.id}" cannot have content when it is unavailable.`,
        id: chunk.id,
        field: "contentAvailable",
      });
    }
    const parent = chunk.parentId === undefined ? undefined : chunksById.get(chunk.parentId);
    if (chunk.available !== false && parent?.available === false) {
      diagnostics.push({
        code: "poly-world-unavailable-chunk-parent",
        message: `PolyWorld chunk "${chunk.id}" cannot be available when parent chunk "${parent.id}" is unavailable.`,
        id: chunk.id,
        field: "available",
      });
    }
    for (const childId of chunk.childIds ?? []) {
      const child = chunksById.get(childId);
      if (chunk.available === false && child !== undefined && child.available !== false) {
        diagnostics.push({
          code: "poly-world-unavailable-chunk-parent",
          message: `PolyWorld chunk "${child.id}" cannot be available when parent chunk "${chunk.id}" is unavailable.`,
          id: child.id,
          field: "available",
        });
      }
    }
  }
}

function validateChunkTreeCycles(
  chunks: readonly PolyWorldChunkTreeNode[],
  diagnostics: PolyWorldChunkTreeDiagnostic[],
): void {
  const chunksById = new Map(chunks.map((chunk) => [chunk.id, chunk]));
  for (const chunk of chunks) {
    const path: string[] = [];
    let current: PolyWorldChunkTreeNode | undefined = chunk;
    while (current !== undefined) {
      if (path.includes(current.id)) {
        const cycle = [...path.slice(path.indexOf(current.id)), current.id];
        diagnostics.push({
          code: "poly-world-chunk-tree-cycle",
          message: `PolyWorld chunk "${chunk.id}" has a parent cycle: ${cycle.join(" -> ")}.`,
          id: chunk.id,
          field: "parentId",
        });
        break;
      }
      path.push(current.id);
      current = current.parentId === undefined ? undefined : chunksById.get(current.parentId);
    }
  }
}

function validateChunkTreeId(
  kind: string,
  value: string,
  field: string,
  diagnostics: PolyWorldChunkTreeDiagnostic[],
  id?: string,
): void {
  if (typeof value !== "string" || value.length === 0) {
    diagnostics.push({
      code: "poly-world-empty-chunk-id",
      message: `PolyWorld ${kind} requires a non-empty ${field}.`,
      id,
      field,
    });
  }
}

function validateChunkTreeBounds(
  chunk: PolyWorldChunkTreeNode,
  field: "bounds" | "contentBounds" | "viewerRequestBounds",
  bounds: PolyWorldBounds | undefined,
  diagnostics: PolyWorldChunkTreeDiagnostic[],
): void {
  if (bounds === undefined) return;
  validateChunkTreeVec3(chunk, `${field}.min`, bounds.min, diagnostics);
  validateChunkTreeVec3(chunk, `${field}.max`, bounds.max, diagnostics);
  if (!isFiniteChunkTreeVec3(bounds.min) || !isFiniteChunkTreeVec3(bounds.max)) return;
  for (let axis = 0; axis < 3; axis += 1) {
    if (bounds.min[axis] <= bounds.max[axis]) continue;
    diagnostics.push({
      code: "poly-world-invalid-chunk-bounds",
      message: `PolyWorld chunk "${chunk.id}" has ${field}.min greater than ${field}.max.`,
      id: chunk.id,
      field,
    });
    break;
  }
}

function validateChunkTreeVec3(
  chunk: PolyWorldChunkTreeNode,
  field: string,
  value: readonly number[],
  diagnostics: PolyWorldChunkTreeDiagnostic[],
): void {
  if (!isFiniteChunkTreeVec3(value)) {
    diagnostics.push({
      code: "poly-world-invalid-chunk-vec3",
      message: `PolyWorld chunk "${chunk.id}" has invalid ${field}.`,
      id: chunk.id,
      field,
    });
  }
}

function validateChunkTreeStringArray(
  chunk: PolyWorldChunkTreeNode,
  field: string,
  values: readonly string[] | undefined,
  diagnostics: PolyWorldChunkTreeDiagnostic[],
): void {
  if (values === undefined) return;
  if (values.length === 0) {
    diagnostics.push({
      code: "poly-world-empty-chunk-array",
      message: `PolyWorld chunk "${chunk.id}" has empty ${field}.`,
      id: chunk.id,
      field,
    });
    return;
  }
  for (const value of values) {
    if (typeof value === "string" && value.length > 0) continue;
    diagnostics.push({
      code: "poly-world-empty-chunk-array-value",
      message: `PolyWorld chunk "${chunk.id}" has an empty value in ${field}.`,
      id: chunk.id,
      field,
    });
  }
}

function validateFiniteNonNegative(
  chunk: PolyWorldChunkTreeNode,
  field: "geometricError" | "cost",
  value: number | undefined,
  diagnostics: PolyWorldChunkTreeDiagnostic[],
): void {
  if (value === undefined) return;
  if (Number.isFinite(value) && value >= 0) return;
  diagnostics.push({
    code: "poly-world-invalid-chunk-number",
    message: `PolyWorld chunk "${chunk.id}" ${field} must be a finite non-negative number.`,
    id: chunk.id,
    field,
  });
}

function validateFiniteNumber(
  chunk: PolyWorldChunkTreeNode,
  field: "priority",
  value: number | undefined,
  diagnostics: PolyWorldChunkTreeDiagnostic[],
): void {
  if (value === undefined || Number.isFinite(value)) return;
  diagnostics.push({
    code: "poly-world-invalid-chunk-number",
    message: `PolyWorld chunk "${chunk.id}" ${field} must be finite.`,
    id: chunk.id,
    field,
  });
}

function normalizeChunkTreeNode(chunk: PolyWorldChunkTreeNode): PolyWorldChunkTreeNode {
  return {
    ...chunk,
    bounds: chunk.bounds === undefined ? undefined : {
      min: [...chunk.bounds.min] as Vec3,
      max: [...chunk.bounds.max] as Vec3,
    },
    contentBounds: chunk.contentBounds === undefined ? undefined : {
      min: [...chunk.contentBounds.min] as Vec3,
      max: [...chunk.contentBounds.max] as Vec3,
    },
    viewerRequestBounds: chunk.viewerRequestBounds === undefined ? undefined : {
      min: [...chunk.viewerRequestBounds.min] as Vec3,
      max: [...chunk.viewerRequestBounds.max] as Vec3,
    },
    childIds: chunk.childIds === undefined ? undefined : unique(chunk.childIds),
    resourceIds: chunk.resourceIds === undefined ? undefined : unique(chunk.resourceIds),
    tags: chunk.tags === undefined ? undefined : unique(chunk.tags),
  };
}

function resolveChunkTreeMaxDepth(tree: PolyWorldChunkTree): number {
  let maxDepth = 0;
  const queue = tree.rootChunkIds.map((chunkId) => ({ chunkId, depth: 0 }));
  const visited = new Set<string>();
  while (queue.length > 0) {
    const item = queue.shift();
    if (item === undefined || visited.has(item.chunkId)) continue;
    visited.add(item.chunkId);
    maxDepth = Math.max(maxDepth, item.depth);
    for (const childId of tree.childIdsById.get(item.chunkId) ?? []) {
      queue.push({ chunkId: childId, depth: item.depth + 1 });
    }
  }
  return maxDepth;
}

function isFiniteChunkTreeVec3(value: readonly number[]): boolean {
  return value.length === 3 && value.every((coordinate) => Number.isFinite(coordinate));
}

function pushUniqueMap<T>(map: Map<string, T[]>, key: string, value: T): void {
  const values = map.get(key);
  if (values === undefined) {
    map.set(key, [value]);
    return;
  }
  if (!values.includes(value)) values.push(value);
}

function resolveStreamingSourceRegionId(
  topology: PolyWorldTopology,
  source: PolyWorldChunkStreamingSource,
  options: PolyWorldChunkStreamingSelectionOptions,
): string | undefined {
  if (source.regionId !== undefined) {
    return topology.regionsById.has(source.regionId) ? source.regionId : undefined;
  }
  const point = source.point ?? source.position;
  if (point === undefined) return undefined;
  return resolvePolyWorldRegionByPoint(topology, point, {
    nearest: source.nearest ?? options.nearest,
  })?.regionId;
}

function selectedRegionsForStreamingSource(
  topology: PolyWorldTopology,
  source: PolyWorldChunkStreamingSource,
  currentRegionId: string,
  defaults: {
    orderedRegionIds: readonly string[];
    before: number;
    after: number;
    loadingRange?: number;
    chunkGraph?: PolyWorldChunkGraph;
    chunkGraphExpansion?: false | PolyWorldChunkGraphExpansionOptions;
  },
): {
  regionIds: string[];
  graphRegionIds: string[];
  graphTargetState?: PolyWorldChunkTargetState;
  missingRegionIds: string[];
} {
  const orderedRegionIds = source.orderedRegionIds ?? defaults.orderedRegionIds;
  const before = source.windowRadius ?? source.before ?? defaults.before;
  const after = source.windowRadius ?? source.after ?? defaults.after;
  const selectedRegionIds = windowAround(orderedRegionIds, currentRegionId, before, after);
  if (selectedRegionIds.length === 0) add(selectedRegionIds, currentRegionId);

  const currentRegion = topology.regionsById.get(currentRegionId);
  const point = source.point ?? source.position ?? currentRegion?.center ?? centerFromBounds(currentRegion?.bounds);
  const loadingRange = source.loadingRange ?? defaults.loadingRange;
  if (point !== undefined && loadingRange !== undefined) {
    for (const regionId of regionsWithinRange(topology, point, loadingRange)) add(selectedRegionIds, regionId);
  }

  const graphExpansion = source.chunkGraphExpansion ?? defaults.chunkGraphExpansion;
  const graph = graphExpansion === false ? undefined : defaults.chunkGraph;
  if (graph === undefined || graphExpansion === undefined || graphExpansion === false) {
    return { regionIds: selectedRegionIds, graphRegionIds: [], missingRegionIds: [] };
  }

  const graphSelection = expandChunkGraphRegionIds(topology, selectedRegionIds, graph, graphExpansion);
  for (const regionId of graphSelection.regionIds) add(selectedRegionIds, regionId);
  return {
    regionIds: selectedRegionIds,
    graphRegionIds: graphSelection.regionIds,
    ...(graphExpansion.targetState === undefined ? {} : { graphTargetState: graphExpansion.targetState }),
    missingRegionIds: graphSelection.missingRegionIds,
  };
}

function expandChunkGraphRegionIds(
  topology: PolyWorldTopology,
  seedRegionIds: readonly string[],
  graph: PolyWorldChunkGraph,
  options: PolyWorldChunkGraphExpansionOptions,
): { regionIds: string[]; missingRegionIds: string[] } {
  const regionIds: string[] = [];
  const missingRegionIds: string[] = [];
  const visited = new Set(seedRegionIds);
  const queue = seedRegionIds.map((regionId) => ({ regionId, depth: 0 }));

  while (queue.length > 0) {
    const item = queue.shift();
    if (item === undefined) break;
    if (!options.recursive && item.depth > 0) continue;

    const nextRegionIds: string[] = [];
    if (options.includeParents === true) {
      for (const regionId of resolveChunkParentRegionIds(graph, item.regionId)) add(nextRegionIds, regionId);
    }
    if (options.includeChildren === true) {
      for (const regionId of resolveChunkChildRegionIds(graph, item.regionId)) add(nextRegionIds, regionId);
    }
    if (options.includeRelated === true) {
      for (const regionId of graph.relatedRegionIds?.[item.regionId] ?? []) add(nextRegionIds, regionId);
    }

    for (const regionId of nextRegionIds) {
      if (!topology.regionsById.has(regionId)) {
        add(missingRegionIds, regionId);
        continue;
      }
      if (visited.has(regionId)) continue;
      visited.add(regionId);
      add(regionIds, regionId);
      if (options.recursive === true) queue.push({ regionId, depth: item.depth + 1 });
    }
  }

  return { regionIds, missingRegionIds };
}

function resolveChunkParentRegionIds(graph: PolyWorldChunkGraph, regionId: string): string[] {
  const regionIds: string[] = [];
  for (const parentRegionId of normalizeChunkGraphIds(graph.parentRegionIds?.[regionId])) add(regionIds, parentRegionId);
  for (const [parentRegionId, childRegionIds] of Object.entries(graph.childRegionIds ?? {})) {
    if (childRegionIds.includes(regionId)) add(regionIds, parentRegionId);
  }
  return regionIds;
}

function resolveChunkChildRegionIds(graph: PolyWorldChunkGraph, regionId: string): string[] {
  const regionIds: string[] = [];
  for (const childRegionId of graph.childRegionIds?.[regionId] ?? []) add(regionIds, childRegionId);
  for (const [childRegionId, parentRegionIds] of Object.entries(graph.parentRegionIds ?? {})) {
    if (normalizeChunkGraphIds(parentRegionIds).includes(regionId)) add(regionIds, childRegionId);
  }
  return regionIds;
}

function normalizeChunkGraphIds(value: string | readonly string[] | undefined): readonly string[] {
  if (value === undefined) return [];
  return typeof value === "string" ? [value] : value;
}

function regionsWithinRange(
  topology: PolyWorldTopology,
  point: Vec3,
  range: number,
): string[] {
  const maxDistanceSq = Math.max(0, range) * Math.max(0, range);
  const regionIds: string[] = [];
  for (const region of topology.regions) {
    const center = region.center ?? centerFromBounds(region.bounds);
    if (center === undefined) continue;
    if (distanceSq(point, center) <= maxDistanceSq) regionIds.push(region.id);
  }
  return regionIds;
}

function addTargetState(
  regionId: string,
  targetState: PolyWorldChunkTargetState,
  sets: {
    loadedRegionIds: Set<string>;
    residentRegionIds: Set<string>;
    activeRegionIds: Set<string>;
    renderedRegionIds: Set<string>;
    preloadedRegionIds: Set<string>;
  },
): void {
  if (targetState === "preloaded") {
    sets.preloadedRegionIds.add(regionId);
    return;
  }
  sets.loadedRegionIds.add(regionId);
  if (targetState === "resident" || targetState === "active" || targetState === "rendered") {
    sets.residentRegionIds.add(regionId);
  }
  if (targetState === "active" || targetState === "rendered") {
    sets.activeRegionIds.add(regionId);
  }
  if (targetState === "rendered") {
    sets.renderedRegionIds.add(regionId);
  }
}

function windowAround(
  orderedRegionIds: readonly string[],
  currentRegionId: string,
  before: number,
  after: number,
): string[] {
  const currentIndex = orderedRegionIds.indexOf(currentRegionId);
  if (currentIndex === -1) return [];
  const start = Math.max(0, currentIndex - Math.max(0, before));
  const end = Math.min(orderedRegionIds.length - 1, currentIndex + Math.max(0, after));
  return orderedRegionIds.slice(start, end + 1);
}

function add(values: string[], value: string): void {
  if (!values.includes(value)) values.push(value);
}

function unique(values: readonly string[] | undefined): string[] {
  return [...new Set(values ?? [])];
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort(compareStrings);
}

function compareSourceSummaries(
  a: PolyWorldChunkStreamingSourceSummary,
  b: PolyWorldChunkStreamingSourceSummary,
): number {
  return b.priority - a.priority || compareStrings(a.sourceId, b.sourceId);
}

function compareStreamingSources(
  a: PolyWorldChunkStreamingSource,
  b: PolyWorldChunkStreamingSource,
): number {
  return (b.priority ?? 0) - (a.priority ?? 0) || compareStrings(a.id, b.id);
}

function compareStrings(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function distanceSq(a: Vec3, b: Vec3): number {
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  const dz = a[2] - b[2];
  return dx * dx + dy * dy + dz * dz;
}

function boundsContainsPoint(bounds: PolyWorldBounds, point: Vec3): boolean {
  return point.every((coordinate, axis) =>
    coordinate >= bounds.min[axis] && coordinate <= bounds.max[axis]
  );
}

function boundsVolume(bounds: PolyWorldBounds | undefined): number {
  if (bounds === undefined) return Number.POSITIVE_INFINITY;
  return Math.max(0, bounds.max[0] - bounds.min[0]) *
    Math.max(0, bounds.max[1] - bounds.min[1]) *
    Math.max(0, bounds.max[2] - bounds.min[2]);
}

function centerFromBounds(bounds: PolyWorldBounds | undefined): Vec3 | undefined {
  if (bounds === undefined) return undefined;
  return [
    (bounds.min[0] + bounds.max[0]) / 2,
    (bounds.min[1] + bounds.max[1]) / 2,
    (bounds.min[2] + bounds.max[2]) / 2,
  ];
}

function boundsCorners(bounds: PolyWorldBounds): Vec3[] {
  return [
    [bounds.min[0], bounds.min[1], bounds.min[2]],
    [bounds.max[0], bounds.min[1], bounds.min[2]],
    [bounds.min[0], bounds.max[1], bounds.min[2]],
    [bounds.max[0], bounds.max[1], bounds.min[2]],
    [bounds.min[0], bounds.min[1], bounds.max[2]],
    [bounds.max[0], bounds.min[1], bounds.max[2]],
    [bounds.min[0], bounds.max[1], bounds.max[2]],
    [bounds.max[0], bounds.max[1], bounds.max[2]],
  ];
}

function addVec3(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function scaleVec3(value: Vec3, scale: number): Vec3 {
  return [value[0] * scale, value[1] * scale, value[2] * scale];
}

function dotVec3(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function crossVec3(a: Vec3, b: Vec3): Vec3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function normalizeVec3(value: readonly number[] | undefined): Vec3 | undefined {
  if (value === undefined || !isFiniteChunkTreeVec3(value)) return undefined;
  const length = Math.hypot(value[0], value[1], value[2]);
  if (length <= 0.000001) return undefined;
  return [value[0] / length, value[1] / length, value[2] / length];
}

function normalizeNonNegativeInteger(value: number | undefined): number | undefined {
  if (value === undefined || !Number.isFinite(value)) return undefined;
  return Math.max(0, Math.floor(value));
}

function normalizeNonNegativeNumber(value: number | undefined): number | undefined {
  if (value === undefined || !Number.isFinite(value)) return undefined;
  return Math.max(0, value);
}

function normalizePositiveNumber(value: number | undefined): number | undefined {
  if (value === undefined || !Number.isFinite(value) || value <= 0) return undefined;
  return value;
}

function optionalNonNegativeInteger(key: string, value: number | undefined): Record<string, number> {
  const normalized = normalizeNonNegativeInteger(value);
  return normalized === undefined ? {} : { [key]: normalized };
}

function optionalNonNegativeNumber(key: string, value: number | undefined): Record<string, number> {
  const normalized = normalizeNonNegativeNumber(value);
  return normalized === undefined ? {} : { [key]: normalized };
}
