import type { PolyWorldChunkStreamingDebugSnapshot, PolyWorldChunkStreamingDebugSnapshotOptions } from "../debug";
import {
  createPolyWorldChunkStreamingArtifactProof,
  createPolyWorldChunkStreamingDebugSnapshot,
} from "../debug/chunkSnapshot";
import type {
  PolyWorldLayerPlanPolicy,
  PolyWorldTransition,
  PolyWorldTransitionDebugOptions,
  PolyWorldTransitionReadinessOptions,
  PolyWorldTransitionStateOptions,
} from "../planner";
import { planPolyWorldTransition } from "../planner";
import type { PolyWorldState } from "../state";
import type { PolyWorldSelectionElementRelationExpansionOptions, PolyWorldTopology } from "../topology";
import type { PolyWorldProfileArtifactProof } from "./artifact";
import {
  createPolyWorldProfileFrameSummary,
  type PolyWorldProfileFrameSummary,
} from "./frameSummary";
import type {
  PolyWorldChunkStreamingSelection,
  PolyWorldChunkStreamingSelectionOptions,
  PolyWorldChunkStreamingStateName,
  PolyWorldChunkStreamingStateSelectionOptions,
} from "./chunk";
import {
  selectPolyWorldChunkStreaming,
  selectPolyWorldChunkStreamingState,
} from "./chunk";

export type PolyWorldChunkStreamingFrameStateOptions = PolyWorldTransitionStateOptions;

export type PolyWorldChunkStreamingFramePlanDebugOptions = PolyWorldTransitionDebugOptions;

export type PolyWorldChunkStreamingFrameDebugOptions = PolyWorldChunkStreamingDebugSnapshotOptions;

export interface PolyWorldChunkStreamingFrameOptions extends PolyWorldChunkStreamingSelectionOptions {
  previousState: PolyWorldState;
  policies: readonly PolyWorldLayerPlanPolicy[];
  renderState?: PolyWorldChunkStreamingStateName;
  renderSelection?: PolyWorldChunkStreamingStateSelectionOptions;
  relations?: false | PolyWorldSelectionElementRelationExpansionOptions;
  readiness?: PolyWorldTransitionReadinessOptions;
  state?: PolyWorldChunkStreamingFrameStateOptions;
  planDebug?: false | PolyWorldChunkStreamingFramePlanDebugOptions;
  debug?: false | PolyWorldChunkStreamingFrameDebugOptions;
}

export interface PolyWorldChunkStreamingFrameSets {
  currentChunkId?: string;
  selectedChunkIds: readonly string[];
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
  plannedElementIds: readonly string[];
}

export interface PolyWorldChunkStreamingFrame extends PolyWorldTransition {
  artifact: PolyWorldProfileArtifactProof;
  streamingSelection: PolyWorldChunkStreamingSelection;
  streamingSets: PolyWorldChunkStreamingFrameSets;
  frameSummary: PolyWorldProfileFrameSummary;
  chunkDebug?: PolyWorldChunkStreamingDebugSnapshot;
}

export function planPolyWorldChunkStreamingFrame(
  topology: PolyWorldTopology,
  options: PolyWorldChunkStreamingFrameOptions,
): PolyWorldChunkStreamingFrame {
  const streamingSelection = selectPolyWorldChunkStreaming(topology, options);
  const selection = selectPolyWorldChunkStreamingState(
    topology,
    streamingSelection,
    options.renderState ?? "rendered",
    options.renderSelection,
  );
  const transition = planPolyWorldTransition(topology, {
    previousState: options.previousState,
    policies: options.policies,
    selection,
    relations: options.relations,
    readiness: options.readiness,
    state: options.state,
    debug: options.planDebug,
  });
  const artifact = createPolyWorldChunkStreamingArtifactProof(streamingSelection);
  const streamingSets = createChunkStreamingFrameSets(streamingSelection, transition);

  return {
    artifact,
    streamingSelection,
    streamingSets,
    frameSummary: createPolyWorldProfileFrameSummary({
      artifact,
      transition,
      current: {
        chunkIds: streamingSets.currentChunkId === undefined ? [] : [streamingSets.currentChunkId],
      },
      candidate: {
        chunkIds: streamingSets.selectedChunkIds,
        regionIds: streamingSets.selectedRegionIds,
      },
      broad: {
        chunkIds: streamingSets.loadedChunkIds,
        regionIds: streamingSets.loadedRegionIds,
      },
      view: {
        chunkIds: streamingSets.renderedChunkIds,
        regionIds: streamingSets.renderedRegionIds,
      },
      retained: {
        chunkIds: streamingSets.heldChunkIds,
        regionIds: streamingSets.residentRegionIds,
      },
      rejected: {
        chunkIds: uniqueStrings([
          ...streamingSets.unavailableChunkIds,
          ...streamingSets.viewCulledChunkIds,
          ...streamingSets.outsideRequestVolumeChunkIds,
          ...streamingSets.skippedChunkIds,
          ...streamingSets.budgetClippedChunkIds,
        ]),
        reasonCounts: {
          unavailable: streamingSets.unavailableChunkIds.length,
          "view-culled": streamingSets.viewCulledChunkIds.length,
          "outside-request-volume": streamingSets.outsideRequestVolumeChunkIds.length,
          skipped: streamingSets.skippedChunkIds.length,
          "budget-clipped": streamingSets.budgetClippedChunkIds.length,
        },
      },
    }),
    ...(options.debug === false ? {} : {
      chunkDebug: createPolyWorldChunkStreamingDebugSnapshot(streamingSelection, options.debug),
    }),
    ...transition,
  };
}

function createChunkStreamingFrameSets(
  streamingSelection: PolyWorldChunkStreamingSelection,
  transition: PolyWorldTransition,
): PolyWorldChunkStreamingFrameSets {
  const traversal = streamingSelection.streaming.chunkTraversal;
  return {
    ...(traversal?.currentChunkId === undefined ? {} : { currentChunkId: traversal.currentChunkId }),
    selectedChunkIds: [...(traversal?.selectedChunkIds ?? [])],
    renderedChunkIds: [...(traversal?.renderedChunkIds ?? [])],
    loadedChunkIds: [...(traversal?.loadedChunkIds ?? [])],
    residentChunkIds: [...(traversal?.residentChunkIds ?? [])],
    requestedChunkIds: [...(traversal?.requestedChunkIds ?? [])],
    heldChunkIds: [...(traversal?.heldChunkIds ?? [])],
    unavailableChunkIds: [...(traversal?.unavailableChunkIds ?? [])],
    viewCulledChunkIds: [...(traversal?.viewCulledChunkIds ?? [])],
    outsideRequestVolumeChunkIds: [...(traversal?.outsideRequestVolumeChunkIds ?? [])],
    skippedChunkIds: [...(traversal?.skippedChunkIds ?? [])],
    budgetClippedChunkIds: [...(traversal?.budgetClippedChunkIds ?? [])],
    selectedRegionIds: [...(traversal?.selectedRegionIds ?? streamingSelection.regionIds ?? [])],
    renderedRegionIds: [...(traversal?.renderedRegionIds ?? streamingSelection.streaming.renderedRegionIds)],
    loadedRegionIds: [...(traversal?.loadedRegionIds ?? streamingSelection.streaming.loadedRegionIds)],
    residentRegionIds: [...(traversal?.residentRegionIds ?? streamingSelection.streaming.residentRegionIds)],
    requestedRegionIds: [...(traversal?.requestedRegionIds ?? streamingSelection.streaming.requestedRegionIds)],
    plannedElementIds: uniqueStrings(transition.plan.entries.flatMap((entry) =>
      entry.elementId === undefined ? [] : [entry.elementId]
    )),
  };
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values)];
}
