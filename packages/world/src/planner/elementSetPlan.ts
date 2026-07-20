import type { PolyWorldData } from "../topology";
import type {
  PolyWorldLayerPlan,
  PolyWorldPlanAction,
  PolyWorldPlanActionCounts,
  PolyWorldPlanCheckResult,
  PolyWorldPlanEntry,
  PolyWorldPlanPhase,
  PolyWorldPlanReason,
  PolyWorldPlanReasonActions,
  PolyWorldPlanReasonTargetStates,
  PolyWorldPlanTargetState,
} from "./types";

const planActions: readonly PolyWorldPlanAction[] = ["show", "hide", "retain", "preload", "noop"];
type PolyWorldElementSetPlanReason = Exclude<PolyWorldPlanReason, "no-match">;

const reasonOrder: readonly PolyWorldElementSetPlanReason[] = ["removed", "added", "retained"];
const defaultActions: Record<PolyWorldPlanReason, PolyWorldPlanAction> = {
  added: "show",
  removed: "hide",
  retained: "retain",
  "no-match": "noop",
};

export interface PolyWorldElementSetPlanOptions {
  previousElementIds?: Iterable<string>;
  nextElementIds: Iterable<string>;
  layer?: string;
  policyId?: string;
  keyPrefix?: string;
  phase?: PolyWorldPlanPhase;
  reasonLabels?: readonly string[];
  actions?: PolyWorldPlanReasonActions;
  targetStates?: PolyWorldPlanReasonTargetStates;
  guards?: readonly PolyWorldPlanCheckResult[];
  dependencies?: readonly PolyWorldPlanCheckResult[];
  data?: PolyWorldData;
}

export function planPolyWorldElementSet(options: PolyWorldElementSetPlanOptions): PolyWorldLayerPlan {
  const previousElementIds = uniqueSorted(options.previousElementIds ?? []);
  const nextElementIds = uniqueSorted(options.nextElementIds);
  const previousSet = new Set(previousElementIds);
  const nextSet = new Set(nextElementIds);
  const byReason: Record<PolyWorldElementSetPlanReason, readonly string[]> = {
    removed: previousElementIds.filter((elementId) => !nextSet.has(elementId)),
    added: nextElementIds.filter((elementId) => !previousSet.has(elementId)),
    retained: nextElementIds.filter((elementId) => previousSet.has(elementId)),
  };
  const layer = options.layer ?? "render";
  const policyKey = options.policyId ?? options.keyPrefix ?? layer;
  const entries: PolyWorldPlanEntry[] = [];

  for (const reason of reasonOrder) {
    for (const elementId of byReason[reason]) {
      const action = actionForReason(options.actions, reason);
      entries.push({
        key: `${policyKey}:${elementId}`,
        policyId: options.policyId,
        layer,
        elementId,
        action,
        reason,
        ...phaseField(options.phase, action),
        targetState: targetStateForReason(options.targetStates, reason, action),
        guards: options.guards?.map((guard) => ({ ...guard })) ?? [],
        dependencies: options.dependencies?.map((dependency) => ({ ...dependency })) ?? [],
        blocked: hasFailedCheck(options.guards) || hasFailedCheck(options.dependencies),
        reasonLabels: [...(options.reasonLabels ?? [])],
        data: options.data,
      });
    }
  }

  return {
    previousSignature: elementSetSignature(previousElementIds),
    nextSignature: elementSetSignature(nextElementIds),
    changed: !sameOrdered(previousElementIds, nextElementIds),
    entries,
    actionCounts: countActions(entries),
    layerCounts: countLayerActions(entries),
  };
}

function actionForReason(
  actions: PolyWorldPlanReasonActions | undefined,
  reason: PolyWorldPlanReason,
): PolyWorldPlanAction {
  return actions?.[reason] ?? defaultActions[reason];
}

function targetStateForReason(
  targetStates: PolyWorldPlanReasonTargetStates | undefined,
  reason: PolyWorldPlanReason,
  action: PolyWorldPlanAction,
): PolyWorldPlanTargetState {
  return {
    ...targetStateForAction(action),
    ...targetStates?.[reason],
  };
}

function targetStateForAction(action: PolyWorldPlanAction): PolyWorldPlanTargetState {
  if (action === "show") return { visible: true, rendered: true };
  if (action === "hide") return { visible: false, rendered: false };
  if (action === "retain") return { visible: true, rendered: true };
  if (action === "preload") return { preloaded: true };
  return {};
}

function phaseField(
  phase: PolyWorldPlanPhase | undefined,
  action: PolyWorldPlanAction,
): { phase?: PolyWorldPlanPhase } {
  const resolved = phase ?? phaseForAction(action);
  return resolved === undefined ? {} : { phase: resolved };
}

function phaseForAction(action: PolyWorldPlanAction): PolyWorldPlanPhase | undefined {
  if (action === "preload") return "preload";
  if (action === "show") return "render";
  if (action === "retain") return "render";
  if (action === "hide") return "cleanup";
  return undefined;
}

function hasFailedCheck(checks: readonly PolyWorldPlanCheckResult[] | undefined): boolean {
  return checks?.some((check) => check.ok === false) ?? false;
}

function countActions(entries: readonly PolyWorldPlanEntry[]): PolyWorldPlanActionCounts {
  const counts = emptyActionCounts();
  for (const entry of entries) counts[entry.action] += 1;
  return counts;
}

function countLayerActions(
  entries: readonly PolyWorldPlanEntry[],
): Record<string, PolyWorldPlanActionCounts> {
  const counts: Record<string, PolyWorldPlanActionCounts> = {};
  for (const entry of entries) {
    counts[entry.layer] ??= emptyActionCounts();
    counts[entry.layer][entry.action] += 1;
  }
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => compareStrings(a, b)));
}

function emptyActionCounts(): PolyWorldPlanActionCounts {
  return Object.fromEntries(planActions.map((action) => [action, 0])) as PolyWorldPlanActionCounts;
}

function uniqueSorted(values: Iterable<string>): readonly string[] {
  return [...new Set(values)].sort(compareStrings);
}

function elementSetSignature(elementIds: readonly string[]): string {
  return `elements:${elementIds.join("|")}`;
}

function sameOrdered(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function compareStrings(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}
