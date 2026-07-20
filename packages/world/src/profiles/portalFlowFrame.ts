import type {
  PolyWorldPortalFlowDebugSnapshot,
  PolyWorldPortalFlowDebugSnapshotOptions,
} from "../debug";
import {
  createPolyWorldPortalFlowArtifactProof,
  createPolyWorldPortalFlowDebugSnapshot,
} from "../debug/portalFlowSnapshot";
import type {
  PolyWorldLayerPlanPolicy,
  PolyWorldTransition,
  PolyWorldTransitionDebugOptions,
  PolyWorldTransitionReadinessOptions,
  PolyWorldTransitionStateOptions,
} from "../planner";
import { planPolyWorldTransition } from "../planner";
import type { PolyWorldState } from "../state";
import type {
  PolyWorldSelection,
  PolyWorldSelectionElementRelationExpansionOptions,
  PolyWorldTopology,
} from "../topology";
import type { PolyWorldProfileArtifactProof } from "./artifact";
import {
  createPolyWorldProfileFrameSummary,
  type PolyWorldProfileFrameSummary,
} from "./frameSummary";
import type {
  PolyWorldPortalActivityOptions,
  PolyWorldPortalActivityState,
  PolyWorldPortalActivityTargetState,
} from "./portal";
import { resolvePolyWorldPortalActivity } from "./portal";
import type {
  PolyWorldPortalFlow,
  PolyWorldPortalFlowOptions,
  PolyWorldPortalFlowTraceStatus,
} from "./portalFlow";
import { resolvePolyWorldPortalFlow } from "./portalFlow";

export type PolyWorldPortalFlowFrameStateOptions = PolyWorldTransitionStateOptions;

export type PolyWorldPortalFlowFramePlanDebugOptions = PolyWorldTransitionDebugOptions;

export type PolyWorldPortalFlowFrameDebugOptions = PolyWorldPortalFlowDebugSnapshotOptions;

export type PolyWorldPortalFlowFramePlanRegionState = "selected" | PolyWorldPortalActivityTargetState;

export interface PolyWorldPortalFlowFrameOptions extends PolyWorldPortalFlowOptions {
  previousState: PolyWorldState;
  policies: readonly PolyWorldLayerPlanPolicy[];
  activity?: false | PolyWorldPortalActivityOptions;
  planRegionState?: PolyWorldPortalFlowFramePlanRegionState;
  relations?: false | PolyWorldSelectionElementRelationExpansionOptions;
  readiness?: PolyWorldTransitionReadinessOptions;
  state?: PolyWorldPortalFlowFrameStateOptions;
  planDebug?: false | PolyWorldPortalFlowFramePlanDebugOptions;
  debug?: false | PolyWorldPortalFlowFrameDebugOptions;
}

export interface PolyWorldPortalFlowFrameSets {
  currentRegionId?: string;
  selectedRegionIds: readonly string[];
  selectedLinkIds: readonly string[];
  selectedPortalIds: readonly string[];
  tracedPortalIds: readonly string[];
  rejectedPortalIds: readonly string[];
  visiblePortalIds: readonly string[];
  closedLinkIds: readonly string[];
  blockedLinkIds: readonly string[];
  clippedPortalIds: readonly string[];
  traceStatusCounts: Partial<Record<PolyWorldPortalFlowTraceStatus, number>>;
  activitySelectedRegionIds: readonly string[];
  activityLoadedRegionIds: readonly string[];
  activityResidentRegionIds: readonly string[];
  activityActiveRegionIds: readonly string[];
  activityRenderedRegionIds: readonly string[];
  activityPreloadedRegionIds: readonly string[];
  activityInactiveRegionIds: readonly string[];
  plannedElementIds: readonly string[];
}

export interface PolyWorldPortalFlowFrame extends PolyWorldTransition {
  artifact: PolyWorldProfileArtifactProof;
  flow: PolyWorldPortalFlow;
  flowSets: PolyWorldPortalFlowFrameSets;
  frameSummary: PolyWorldProfileFrameSummary;
  activity?: PolyWorldPortalActivityState;
  portalFlowDebug?: PolyWorldPortalFlowDebugSnapshot;
}

export function planPolyWorldPortalFlowFrame(
  topology: PolyWorldTopology,
  options: PolyWorldPortalFlowFrameOptions,
): PolyWorldPortalFlowFrame {
  const flow = resolvePolyWorldPortalFlow(topology, {
    ...options,
    includeTrace: options.includeTrace ?? options.debug !== false,
  });
  const activity = options.activity === false
    ? undefined
    : resolvePolyWorldPortalActivity(topology, flow.selection, options.activity);
  const transitionSelection = selectionForPortalFlowFramePlan(
    topology,
    flow.selection,
    activity,
    options.planRegionState ?? "selected",
  );
  const transition = planPolyWorldTransition(topology, {
    previousState: options.previousState,
    policies: options.policies,
    selection: transitionSelection,
    relations: options.relations,
    readiness: options.readiness,
    state: options.state,
    debug: options.planDebug,
  });
  const artifact = createPolyWorldPortalFlowArtifactProof(topology, flow);
  const flowSets = createPortalFlowFrameSets(flow, activity, transition);

  return {
    artifact,
    flow,
    flowSets,
    frameSummary: createPolyWorldProfileFrameSummary({
      artifact,
      transition,
      current: {
        regionIds: flowSets.currentRegionId === undefined ? [] : [flowSets.currentRegionId],
      },
      candidate: {
        regionIds: flowSets.selectedRegionIds,
        linkIds: flowSets.selectedLinkIds,
        portalIds: flowSets.tracedPortalIds,
      },
      broad: {
        regionIds: flowSets.selectedRegionIds,
        linkIds: flowSets.selectedLinkIds,
        portalIds: flowSets.tracedPortalIds,
      },
      view: {
        regionIds: flowSets.selectedRegionIds,
        linkIds: flowSets.selectedLinkIds,
        portalIds: flowSets.visiblePortalIds,
      },
      retained: {
        regionIds: flowSets.activityResidentRegionIds,
      },
      rejected: {
        linkIds: uniqueStrings([...flowSets.closedLinkIds, ...flowSets.blockedLinkIds]),
        portalIds: uniqueStrings([...flowSets.rejectedPortalIds, ...flowSets.clippedPortalIds]),
        reasonCounts: flowSets.traceStatusCounts,
      },
    }),
    ...(activity === undefined ? {} : { activity }),
    ...(options.debug === false ? {} : {
      portalFlowDebug: createPolyWorldPortalFlowDebugSnapshot(topology, flow, options.debug),
    }),
    ...transition,
  };
}

function createPortalFlowFrameSets(
  flow: PolyWorldPortalFlow,
  activity: PolyWorldPortalActivityState | undefined,
  transition: PolyWorldTransition,
): PolyWorldPortalFlowFrameSets {
  const trace = flow.trace ?? [];
  const selectedPortalIds = uniqueStrings(flow.portalIds);
  const selectedPortalSet = new Set(selectedPortalIds);
  const tracedPortalIds = uniqueStrings(trace.map((entry) => entry.portalId));
  return {
    ...(flow.currentRegionId === undefined ? {} : { currentRegionId: flow.currentRegionId }),
    selectedRegionIds: uniqueStrings(flow.regionIds),
    selectedLinkIds: uniqueStrings(flow.linkIds),
    selectedPortalIds,
    tracedPortalIds,
    rejectedPortalIds: tracedPortalIds.filter((portalId) => !selectedPortalSet.has(portalId)),
    visiblePortalIds: uniqueStrings(trace.flatMap((entry) => entry.status === "visible" ? [entry.portalId] : [])),
    closedLinkIds: uniqueStrings(trace.flatMap((entry) => entry.status === "closed" ? [entry.linkId] : [])),
    blockedLinkIds: uniqueStrings(trace.flatMap((entry) => entry.status === "blocked" ? [entry.linkId] : [])),
    clippedPortalIds: uniqueStrings(trace.flatMap((entry) => entry.status === "clipped" ? [entry.portalId] : [])),
    traceStatusCounts: countTraceStatuses(trace),
    activitySelectedRegionIds: [...(activity?.selectedRegionIds ?? [])],
    activityLoadedRegionIds: [...(activity?.loadedRegionIds ?? [])],
    activityResidentRegionIds: [...(activity?.residentRegionIds ?? [])],
    activityActiveRegionIds: [...(activity?.activeRegionIds ?? [])],
    activityRenderedRegionIds: [...(activity?.renderedRegionIds ?? [])],
    activityPreloadedRegionIds: [...(activity?.preloadedRegionIds ?? [])],
    activityInactiveRegionIds: [...(activity?.inactiveRegionIds ?? [])],
    plannedElementIds: uniqueStrings(transition.plan.entries.flatMap((entry) =>
      entry.elementId === undefined ? [] : [entry.elementId]
    )),
  };
}

function countTraceStatuses(
  trace: readonly { status: PolyWorldPortalFlowTraceStatus }[],
): Partial<Record<PolyWorldPortalFlowTraceStatus, number>> {
  const counts: Partial<Record<PolyWorldPortalFlowTraceStatus, number>> = {};
  for (const entry of trace) counts[entry.status] = (counts[entry.status] ?? 0) + 1;
  return counts;
}

function selectionForPortalFlowFramePlan(
  topology: PolyWorldTopology,
  selection: PolyWorldSelection,
  activity: PolyWorldPortalActivityState | undefined,
  state: PolyWorldPortalFlowFramePlanRegionState,
): PolyWorldSelection {
  if (activity === undefined || state === "selected") return selection;
  const selectionWithoutDirectElementSelectors: PolyWorldSelection = {
    ...(selection.linkIds === undefined ? {} : { linkIds: selection.linkIds }),
    ...(selection.reasons === undefined ? {} : { reasons: selection.reasons }),
    ...(selection.data === undefined ? {} : { data: selection.data }),
  };
  const regionIds = portalActivityRegionIds(activity, state);
  const selectionKeys: string[] = [];
  for (const regionId of regionIds) {
    const region = topology.regionsById.get(regionId);
    for (const selectionKey of region?.selectionKeys ?? []) add(selectionKeys, selectionKey);
  }
  return {
    ...selectionWithoutDirectElementSelectors,
    regionIds,
    selectionKeys,
    reasons: [
      ...(selection.reasons ?? []),
      {
        id: `poly-world-portal-flow-frame-${state}`,
        kind: "portalFlowFrameState",
        label: state,
        regionIds,
        data: { state, profile: "portal-flow" },
      },
    ],
  };
}

function portalActivityRegionIds(
  activity: PolyWorldPortalActivityState,
  state: PolyWorldPortalFlowFramePlanRegionState,
): readonly string[] {
  if (state === "loaded") return activity.loadedRegionIds;
  if (state === "resident") return activity.residentRegionIds;
  if (state === "active") return activity.activeRegionIds;
  if (state === "rendered") return activity.renderedRegionIds;
  if (state === "preloaded") return activity.preloadedRegionIds;
  if (state === "inactive") return activity.inactiveRegionIds;
  return activity.selectedRegionIds;
}

function add(values: string[], value: string): void {
  if (!values.includes(value)) values.push(value);
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values)];
}
