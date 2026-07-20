import type {
  PolyWorldLayerPlan,
  PolyWorldPlanActionCounts,
  PolyWorldTransition,
} from "../planner";
import type {
  PolyWorldResourceLoadSetSummary,
  PolyWorldResourceReadinessSummary,
} from "../planner/resources";
import type {
  PolyWorldState,
  PolyWorldStateDiff,
} from "../state";
import type { PolyWorldSelection } from "../topology";
import type {
  PolyWorldProfileArtifactKind,
  PolyWorldProfileArtifactProfile,
  PolyWorldProfileArtifactProof,
} from "./artifact";

export type PolyWorldProfileFrameSummaryProfile = PolyWorldProfileArtifactProfile;

export interface PolyWorldProfileFrameSummarySet {
  leafIds: readonly string[];
  regionIds: readonly string[];
  linkIds: readonly string[];
  portalIds: readonly string[];
  chunkIds: readonly string[];
  surfaceIds: readonly string[];
  elementIds: readonly string[];
  selectionKeys: readonly string[];
  reasonCounts?: Readonly<Record<string, number>>;
}

export interface PolyWorldProfileFrameSummarySetInput {
  leafIds?: readonly string[];
  regionIds?: readonly string[];
  linkIds?: readonly string[];
  portalIds?: readonly string[];
  chunkIds?: readonly string[];
  surfaceIds?: readonly string[];
  elementIds?: readonly string[];
  selectionKeys?: readonly string[];
  reasonCounts?: Readonly<Record<string, number | undefined>>;
}

export interface PolyWorldProfileFrameSummaryReadiness {
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
}

export interface PolyWorldProfileFrameSummaryLoadSet {
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
}

export interface PolyWorldProfileFrameSummaryState {
  selectedRegionIds: readonly string[];
  selectedLinkIds: readonly string[];
  selectedSelectionKeys: readonly string[];
  selectedElementIds: readonly string[];
  resolvedElementIds: readonly string[];
  layers: readonly string[];
  reasonLabels: readonly string[];
}

export interface PolyWorldProfileFrameSummaryDiff {
  changed: boolean;
  addedRegionIds: readonly string[];
  removedRegionIds: readonly string[];
  retainedRegionIds: readonly string[];
  addedElementIds: readonly string[];
  removedElementIds: readonly string[];
  retainedElementIds: readonly string[];
}

export interface PolyWorldProfileFrameSummaryPlan {
  changed: boolean;
  entryCount: number;
  plannedElementIds: readonly string[];
  blockedElementIds: readonly string[];
  actionCounts: PolyWorldPlanActionCounts;
}

export interface PolyWorldProfileFrameSummary {
  schemaVersion: 1;
  profile: PolyWorldProfileFrameSummaryProfile;
  artifactKind: PolyWorldProfileArtifactKind;
  producedBy: string;
  current: PolyWorldProfileFrameSummarySet;
  candidate: PolyWorldProfileFrameSummarySet;
  broad: PolyWorldProfileFrameSummarySet;
  view: PolyWorldProfileFrameSummarySet;
  retained: PolyWorldProfileFrameSummarySet;
  rejected: PolyWorldProfileFrameSummarySet;
  readiness?: PolyWorldProfileFrameSummaryReadiness;
  loadSet?: PolyWorldProfileFrameSummaryLoadSet;
  planning: PolyWorldProfileFrameSummarySet;
  state: PolyWorldProfileFrameSummaryState;
  diff: PolyWorldProfileFrameSummaryDiff;
  plan: PolyWorldProfileFrameSummaryPlan;
}

export interface PolyWorldProfileFrameSummaryInput {
  artifact: PolyWorldProfileArtifactProof;
  transition: PolyWorldTransition;
  current?: PolyWorldProfileFrameSummarySetInput;
  candidate?: PolyWorldProfileFrameSummarySetInput;
  broad?: PolyWorldProfileFrameSummarySetInput;
  view?: PolyWorldProfileFrameSummarySetInput;
  retained?: PolyWorldProfileFrameSummarySetInput;
  rejected?: PolyWorldProfileFrameSummarySetInput;
}

export function createPolyWorldProfileFrameSummary(
  input: PolyWorldProfileFrameSummaryInput,
): PolyWorldProfileFrameSummary {
  return {
    schemaVersion: 1,
    profile: input.artifact.profile,
    artifactKind: input.artifact.artifactKind,
    producedBy: input.artifact.producedBy,
    current: createSummarySet(input.current),
    candidate: createSummarySet(input.candidate),
    broad: createSummarySet(input.broad),
    view: createSummarySet(input.view),
    retained: createSummarySet(input.retained),
    rejected: createSummarySet(input.rejected),
    ...(input.transition.readiness === undefined ? {} : {
      readiness: summarizeReadiness(input.transition.readiness),
    }),
    ...(input.transition.loadSet === undefined ? {} : {
      loadSet: summarizeLoadSet(input.transition.loadSet),
    }),
    planning: createSummarySet(setFromSelection(input.transition.planningSelection)),
    state: summarizeState(input.transition.nextState),
    diff: summarizeDiff(input.transition.diff),
    plan: summarizePlan(input.transition.plan),
  };
}

function createSummarySet(
  input: PolyWorldProfileFrameSummarySetInput | undefined,
): PolyWorldProfileFrameSummarySet {
  return {
    leafIds: uniqueStrings(input?.leafIds ?? []),
    regionIds: uniqueStrings(input?.regionIds ?? []),
    linkIds: uniqueStrings(input?.linkIds ?? []),
    portalIds: uniqueStrings(input?.portalIds ?? []),
    chunkIds: uniqueStrings(input?.chunkIds ?? []),
    surfaceIds: uniqueStrings(input?.surfaceIds ?? []),
    elementIds: uniqueStrings(input?.elementIds ?? []),
    selectionKeys: uniqueStrings(input?.selectionKeys ?? []),
    ...finiteReasonCounts(input?.reasonCounts),
  };
}

function setFromSelection(
  selection: PolyWorldSelection | undefined,
): PolyWorldProfileFrameSummarySetInput {
  return {
    regionIds: selection?.regionIds,
    linkIds: selection?.linkIds,
    elementIds: selection?.elementIds,
    selectionKeys: selection?.selectionKeys,
  };
}

function summarizeReadiness(
  readiness: PolyWorldResourceReadinessSummary,
): PolyWorldProfileFrameSummaryReadiness {
  return {
    resourceIds: [...readiness.resourceIds],
    readyResourceIds: [...readiness.readyResourceIds],
    missingResourceIds: [...readiness.missingResourceIds],
    requestedResourceIds: [...readiness.requestedResourceIds],
    loadingResourceIds: [...readiness.loadingResourceIds],
    failedResourceIds: [...readiness.failedResourceIds],
    staleResourceIds: [...readiness.staleResourceIds],
    renderBlockingResourceIds: [...readiness.renderBlockingResourceIds],
    preloadOnlyResourceIds: [...readiness.preloadOnlyResourceIds],
    nonBlockingResourceIds: [...readiness.nonBlockingResourceIds],
    blockedResourceIds: [...readiness.blockedResourceIds],
    blockedElementIds: [...readiness.blockedElementIds],
  };
}

function summarizeLoadSet(
  loadSet: PolyWorldResourceLoadSetSummary,
): PolyWorldProfileFrameSummaryLoadSet {
  return {
    previousResourceIds: [...loadSet.previousResourceIds],
    nextResourceIds: [...loadSet.nextResourceIds],
    requestResourceIds: [...loadSet.requestResourceIds],
    retainResourceIds: [...loadSet.retainResourceIds],
    releaseCandidateResourceIds: [...loadSet.releaseCandidateResourceIds],
    readyButNotVisibleResourceIds: [...loadSet.readyButNotVisibleResourceIds],
    preloadOnlyResourceIds: [...loadSet.preloadOnlyResourceIds],
    renderBlockingResourceIds: [...loadSet.renderBlockingResourceIds],
    staleAllowedResourceIds: [...loadSet.staleAllowedResourceIds],
    nonBlockingResourceIds: [...loadSet.nonBlockingResourceIds],
    blockedResourceIds: [...loadSet.blockedResourceIds],
    blockedElementIds: [...loadSet.blockedElementIds],
  };
}

function summarizeState(state: PolyWorldState): PolyWorldProfileFrameSummaryState {
  return {
    selectedRegionIds: [...state.selectedRegionIds],
    selectedLinkIds: [...state.selectedLinkIds],
    selectedSelectionKeys: [...state.selectedSelectionKeys],
    selectedElementIds: [...state.selectedElementIds],
    resolvedElementIds: [...state.resolvedElementIds],
    layers: [...state.layers],
    reasonLabels: [...state.reasonLabels],
  };
}

function summarizeDiff(diff: PolyWorldStateDiff): PolyWorldProfileFrameSummaryDiff {
  return {
    changed: diff.changed,
    addedRegionIds: [...diff.regions.added],
    removedRegionIds: [...diff.regions.removed],
    retainedRegionIds: [...diff.regions.retained],
    addedElementIds: [...diff.resolvedElements.added],
    removedElementIds: [...diff.resolvedElements.removed],
    retainedElementIds: [...diff.resolvedElements.retained],
  };
}

function summarizePlan(plan: PolyWorldLayerPlan): PolyWorldProfileFrameSummaryPlan {
  return {
    changed: plan.changed,
    entryCount: plan.entries.length,
    plannedElementIds: uniqueStrings(plan.entries.flatMap((entry) =>
      entry.elementId === undefined ? [] : [entry.elementId]
    )),
    blockedElementIds: uniqueStrings(plan.entries.flatMap((entry) =>
      entry.blocked === true && entry.elementId !== undefined ? [entry.elementId] : []
    )),
    actionCounts: { ...plan.actionCounts },
  };
}

function finiteReasonCounts(
  reasonCounts: Readonly<Record<string, number | undefined>> | undefined,
): { reasonCounts?: Readonly<Record<string, number>> } {
  if (reasonCounts === undefined) return {};
  const entries = Object.entries(reasonCounts)
    .filter((entry): entry is [string, number] => Number.isFinite(entry[1]));
  if (entries.length === 0) return {};
  entries.sort(([a], [b]) => compareStrings(a, b));
  return { reasonCounts: Object.fromEntries(entries) };
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values)].sort(compareStrings);
}

function compareStrings(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}
