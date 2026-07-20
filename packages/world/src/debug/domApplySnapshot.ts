import type {
  PolyWorldDomApplyCounts,
  PolyWorldDomApplyEntry,
  PolyWorldDomApplyResult,
  PolyWorldDomElementLike,
} from "../dom";
import type {
  PolyWorldPlanActionCounts,
  PolyWorldPlanCheckResult,
  PolyWorldPlanPhase,
  PolyWorldPlanTargetState,
} from "../planner";
import { limitPolyWorldDebugList } from "./limits";

export interface PolyWorldDomApplyDebugSnapshotOptions {
  includeEntries?: boolean;
  entryLimit?: number;
  listLimit?: number;
  metadata?: Record<string, unknown>;
}

export interface PolyWorldDomApplyDebugEntry {
  key: string;
  layer: string;
  action: string;
  status: string;
  elementId?: string;
  policyId?: string;
  phase?: PolyWorldPlanPhase;
  targetState: PolyWorldPlanTargetState;
  guards: readonly PolyWorldPlanCheckResult[];
  dependencies: readonly PolyWorldPlanCheckResult[];
  failedGuards: readonly PolyWorldPlanCheckResult[];
  failedDependencies: readonly PolyWorldPlanCheckResult[];
  mounted: boolean;
  changed: boolean;
  reasonLabels: readonly string[];
  message?: string;
}

export interface PolyWorldDomApplyDebugSnapshot {
  schemaVersion: 1;
  plan: {
    previousSignature?: string;
    nextSignature?: string;
    changed?: boolean;
    entryCount: number;
    includedEntryCount: number;
    omittedEntryCount: number;
    actionCounts: PolyWorldPlanActionCounts;
  };
  apply: {
    counts: PolyWorldDomApplyCounts;
    plannedElementIds: readonly string[];
    addedElementIds: readonly string[];
    hiddenAppliedElementIds: readonly string[];
    removedElementIds: readonly string[];
    retainedElementIds: readonly string[];
    noopElementIds: readonly string[];
    changedElementIds: readonly string[];
    missingElementIds: readonly string[];
    blockedElementIds: readonly string[];
    mountBlockedElementIds: readonly string[];
    guardFailureElementIds: readonly string[];
    dependencyFailureElementIds: readonly string[];
    unsupportedElementIds: readonly string[];
    mountedElementIds: readonly string[];
    hiddenElementIds: readonly string[];
    omitted: {
      plannedElementIds: number;
      addedElementIds: number;
      hiddenAppliedElementIds: number;
      removedElementIds: number;
      retainedElementIds: number;
      noopElementIds: number;
      changedElementIds: number;
      missingElementIds: number;
      blockedElementIds: number;
      mountBlockedElementIds: number;
      guardFailureElementIds: number;
      dependencyFailureElementIds: number;
      unsupportedElementIds: number;
      mountedElementIds: number;
      hiddenElementIds: number;
    };
  };
  entries?: readonly PolyWorldDomApplyDebugEntry[];
  metadata?: Record<string, unknown>;
}

export function createPolyWorldDomApplyDebugSnapshot<
  TElement extends PolyWorldDomElementLike = PolyWorldDomElementLike,
>(
  result: PolyWorldDomApplyResult<TElement>,
  options: PolyWorldDomApplyDebugSnapshotOptions = {},
): PolyWorldDomApplyDebugSnapshot {
  const limitedEntries = options.includeEntries === false
    ? undefined
    : limitPolyWorldDebugList(result.entries.map(summarizeEntry), options.entryLimit);
  const plannedElementIds = limitPolyWorldDebugList(result.plannedElementIds, options.listLimit);
  const addedElementIds = limitPolyWorldDebugList(result.addedElementIds, options.listLimit);
  const hiddenAppliedElementIds = limitPolyWorldDebugList(result.hiddenAppliedElementIds, options.listLimit);
  const removedElementIds = limitPolyWorldDebugList(result.removedElementIds, options.listLimit);
  const retainedElementIds = limitPolyWorldDebugList(result.retainedElementIds, options.listLimit);
  const noopElementIds = limitPolyWorldDebugList(result.noopElementIds, options.listLimit);
  const changedElementIds = limitPolyWorldDebugList(result.changedElementIds, options.listLimit);
  const missingElementIds = limitPolyWorldDebugList(result.missingElementIds, options.listLimit);
  const blockedElementIds = limitPolyWorldDebugList(result.blockedElementIds, options.listLimit);
  const mountBlockedElementIds = limitPolyWorldDebugList(result.mountBlockedElementIds, options.listLimit);
  const guardFailureElementIds = limitPolyWorldDebugList(result.guardFailureElementIds, options.listLimit);
  const dependencyFailureElementIds = limitPolyWorldDebugList(result.dependencyFailureElementIds, options.listLimit);
  const unsupportedElementIds = limitPolyWorldDebugList(result.unsupportedElementIds, options.listLimit);
  const mountedElementIds = limitPolyWorldDebugList(result.mountedElementIds, options.listLimit);
  const hiddenElementIds = limitPolyWorldDebugList(result.hiddenElementIds, options.listLimit);

  return {
    schemaVersion: 1,
    plan: {
      previousSignature: result.previousSignature,
      nextSignature: result.nextSignature,
      changed: result.planChanged,
      entryCount: result.entries.length,
      includedEntryCount: limitedEntries?.values.length ?? 0,
      omittedEntryCount: limitedEntries?.omitted ?? result.entries.length,
      actionCounts: result.actionCounts,
    },
    apply: {
      counts: result.counts,
      plannedElementIds: plannedElementIds.values,
      addedElementIds: addedElementIds.values,
      hiddenAppliedElementIds: hiddenAppliedElementIds.values,
      removedElementIds: removedElementIds.values,
      retainedElementIds: retainedElementIds.values,
      noopElementIds: noopElementIds.values,
      changedElementIds: changedElementIds.values,
      missingElementIds: missingElementIds.values,
      blockedElementIds: blockedElementIds.values,
      mountBlockedElementIds: mountBlockedElementIds.values,
      guardFailureElementIds: guardFailureElementIds.values,
      dependencyFailureElementIds: dependencyFailureElementIds.values,
      unsupportedElementIds: unsupportedElementIds.values,
      mountedElementIds: mountedElementIds.values,
      hiddenElementIds: hiddenElementIds.values,
      omitted: {
        plannedElementIds: plannedElementIds.omitted,
        addedElementIds: addedElementIds.omitted,
        hiddenAppliedElementIds: hiddenAppliedElementIds.omitted,
        removedElementIds: removedElementIds.omitted,
        retainedElementIds: retainedElementIds.omitted,
        noopElementIds: noopElementIds.omitted,
        changedElementIds: changedElementIds.omitted,
        missingElementIds: missingElementIds.omitted,
        blockedElementIds: blockedElementIds.omitted,
        mountBlockedElementIds: mountBlockedElementIds.omitted,
        guardFailureElementIds: guardFailureElementIds.omitted,
        dependencyFailureElementIds: dependencyFailureElementIds.omitted,
        unsupportedElementIds: unsupportedElementIds.omitted,
        mountedElementIds: mountedElementIds.omitted,
        hiddenElementIds: hiddenElementIds.omitted,
      },
    },
    entries: limitedEntries?.values,
    metadata: options.metadata,
  };
}

export function adaptPolyWorldDomApplyDebugSnapshot<T>(
  snapshot: PolyWorldDomApplyDebugSnapshot,
  adapter: (snapshot: PolyWorldDomApplyDebugSnapshot) => T,
): T {
  return adapter(snapshot);
}

function summarizeEntry(entry: PolyWorldDomApplyEntry): PolyWorldDomApplyDebugEntry {
  return {
    key: entry.key,
    layer: entry.layer,
    action: entry.action,
    status: entry.status,
    elementId: entry.elementId,
    policyId: entry.policyId,
    phase: entry.planEntry.phase,
    targetState: entry.planEntry.targetState ?? {},
    guards: entry.guards,
    dependencies: entry.dependencies,
    failedGuards: entry.failedGuards,
    failedDependencies: entry.failedDependencies,
    mounted: entry.mounted,
    changed: entry.changed,
    reasonLabels: entry.reasonLabels,
    message: entry.message,
  };
}
