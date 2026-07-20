import type { PolyWorldPortalDebugSnapshot, PolyWorldPortalDebugSnapshotOptions } from "../debug";
import {
  createPolyWorldPortalArtifactProof,
  createPolyWorldPortalDebugSnapshot,
} from "../debug/portalSnapshot";
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
  PolyWorldSelectionReason,
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
  PolyWorldPortalSelectionOptions,
} from "./portal";
import {
  resolvePolyWorldPortalActivity,
  selectPolyWorldPortalRegions,
} from "./portal";

export type PolyWorldPortalFrameStateOptions = PolyWorldTransitionStateOptions;

export type PolyWorldPortalFramePlanDebugOptions = PolyWorldTransitionDebugOptions;

export type PolyWorldPortalFrameDebugOptions = Omit<
  PolyWorldPortalDebugSnapshotOptions,
  "currentRegionId" | "activity"
>;

export type PolyWorldPortalFramePlanRegionState = "selected" | PolyWorldPortalActivityTargetState;

export interface PolyWorldPortalFrameOptions extends PolyWorldPortalSelectionOptions {
  previousState: PolyWorldState;
  policies: readonly PolyWorldLayerPlanPolicy[];
  activity?: false | PolyWorldPortalActivityOptions;
  planRegionState?: PolyWorldPortalFramePlanRegionState;
  relations?: false | PolyWorldSelectionElementRelationExpansionOptions;
  readiness?: PolyWorldTransitionReadinessOptions;
  state?: PolyWorldPortalFrameStateOptions;
  planDebug?: false | PolyWorldPortalFramePlanDebugOptions;
  debug?: false | PolyWorldPortalFrameDebugOptions;
}

export interface PolyWorldPortalFrameSets {
  currentRegionId?: string;
  selectedRegionIds: readonly string[];
  selectedLinkIds: readonly string[];
  selectedSelectionKeys: readonly string[];
  selectedElementIds: readonly string[];
  currentRegionIds: readonly string[];
  linkedRegionIds: readonly string[];
  linkedLinkIds: readonly string[];
  visibleRegionIds: readonly string[];
  visibilitySelectionRegionIds: readonly string[];
  visibilitySelectionElementIds: readonly string[];
  explicitLinkIds: readonly string[];
  facingLinkIds: readonly string[];
  closedLinkIds: readonly string[];
  blockedLinkIds: readonly string[];
  activitySelectedRegionIds: readonly string[];
  activityLoadedRegionIds: readonly string[];
  activityResidentRegionIds: readonly string[];
  activityActiveRegionIds: readonly string[];
  activityRenderedRegionIds: readonly string[];
  activityPreloadedRegionIds: readonly string[];
  activityInactiveRegionIds: readonly string[];
  plannedElementIds: readonly string[];
}

export interface PolyWorldPortalFrame extends PolyWorldTransition {
  artifact: PolyWorldProfileArtifactProof;
  selection: PolyWorldSelection;
  portalSets: PolyWorldPortalFrameSets;
  frameSummary: PolyWorldProfileFrameSummary;
  activity?: PolyWorldPortalActivityState;
  portalDebug?: PolyWorldPortalDebugSnapshot;
}

export function planPolyWorldPortalFrame(
  topology: PolyWorldTopology,
  options: PolyWorldPortalFrameOptions,
): PolyWorldPortalFrame {
  const selection = selectPolyWorldPortalRegions(topology, options);
  const activity = options.activity === false
    ? undefined
    : resolvePolyWorldPortalActivity(topology, selection, options.activity);
  const transitionSelection = selectionForPortalFramePlan(
    topology,
    selection,
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
  const artifact = createPolyWorldPortalArtifactProof(topology, selection);
  const portalSets = createPortalFrameSets(options, selection, activity, transition);

  return {
    artifact,
    selection,
    portalSets,
    frameSummary: createPolyWorldProfileFrameSummary({
      artifact,
      transition,
      current: {
        regionIds: portalSets.currentRegionId === undefined ? [] : [portalSets.currentRegionId],
      },
      candidate: {
        regionIds: portalSets.selectedRegionIds,
        linkIds: portalSets.selectedLinkIds,
        elementIds: portalSets.selectedElementIds,
        selectionKeys: portalSets.selectedSelectionKeys,
      },
      broad: {
        regionIds: portalSets.selectedRegionIds,
        linkIds: portalSets.selectedLinkIds,
        elementIds: portalSets.selectedElementIds,
        selectionKeys: portalSets.selectedSelectionKeys,
      },
      view: {
        regionIds: portalSets.visibleRegionIds.length === 0 ? portalSets.selectedRegionIds : portalSets.visibleRegionIds,
        linkIds: portalSets.facingLinkIds,
        elementIds: portalSets.visibilitySelectionElementIds,
      },
      retained: {
        regionIds: portalSets.activityResidentRegionIds,
      },
      rejected: {
        linkIds: uniqueStrings([...portalSets.closedLinkIds, ...portalSets.blockedLinkIds]),
        reasonCounts: {
          closed: portalSets.closedLinkIds.length,
          blocked: portalSets.blockedLinkIds.length,
        },
      },
    }),
    ...(activity === undefined ? {} : { activity }),
    ...(options.debug === false ? {} : {
      portalDebug: createPolyWorldPortalDebugSnapshot(topology, selection, {
        ...options.debug,
        currentRegionId: options.currentRegionId,
        activity,
      }),
    }),
    ...transition,
  };
}

function createPortalFrameSets(
  options: PolyWorldPortalFrameOptions,
  selection: PolyWorldSelection,
  activity: PolyWorldPortalActivityState | undefined,
  transition: PolyWorldTransition,
): PolyWorldPortalFrameSets {
  const reasons = selection.reasons ?? [];
  return {
    ...(options.currentRegionId === undefined ? {} : { currentRegionId: options.currentRegionId }),
    selectedRegionIds: uniqueStrings(selection.regionIds ?? []),
    selectedLinkIds: uniqueStrings(selection.linkIds ?? []),
    selectedSelectionKeys: uniqueStrings(selection.selectionKeys ?? []),
    selectedElementIds: uniqueStrings(selection.elementIds ?? []),
    currentRegionIds: reasonStrings(reasons, "current", "regionIds"),
    linkedRegionIds: reasonStrings(reasons, "linked", "regionIds"),
    linkedLinkIds: reasonStrings(reasons, "linked", "linkIds"),
    visibleRegionIds: reasonStrings(reasons, "visible", "regionIds"),
    visibilitySelectionRegionIds: reasonStrings(reasons, "visibilitySelection", "regionIds"),
    visibilitySelectionElementIds: reasonStrings(reasons, "visibilitySelection", "elementIds"),
    explicitLinkIds: reasonStrings(reasons, "link", "linkIds"),
    facingLinkIds: reasonStrings(reasons, "facing", "linkIds"),
    closedLinkIds: reasonStrings(reasons, "closed", "linkIds"),
    blockedLinkIds: reasonStrings(reasons, "blocked", "linkIds"),
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

function selectionForPortalFramePlan(
  topology: PolyWorldTopology,
  selection: PolyWorldSelection,
  activity: PolyWorldPortalActivityState | undefined,
  state: PolyWorldPortalFramePlanRegionState,
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
        id: `poly-world-portal-frame-${state}`,
        kind: "portalFrameState",
        label: state,
        regionIds,
        data: { state },
      },
    ],
  };
}

function portalActivityRegionIds(
  activity: PolyWorldPortalActivityState,
  state: PolyWorldPortalFramePlanRegionState,
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

function reasonStrings(
  reasons: readonly PolyWorldSelectionReason[],
  kind: string,
  field: "regionIds" | "linkIds" | "elementIds",
): string[] {
  return uniqueStrings(reasons.flatMap((reason) => reason.kind === kind ? reason[field] ?? [] : []));
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values)];
}
