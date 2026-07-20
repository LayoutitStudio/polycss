import type { PolyWorldStateDiff } from "../state";
import type { PolyWorldElement, PolyWorldTopology } from "../topology";
import type {
  PolyWorldLayerPlan,
  PolyWorldLayerPlanPolicy,
  PolyWorldPlanAction,
  PolyWorldPlanActionCounts,
  PolyWorldPlanCheckResult,
  PolyWorldPlanEntry,
  PolyWorldPlanEntryCheckContext,
  PolyWorldPlanPhase,
  PolyWorldPlanReason,
  PolyWorldPlanTargetState,
} from "./types";

const planActions: readonly PolyWorldPlanAction[] = ["show", "hide", "retain", "preload", "noop"];
const reasonOrder: readonly PolyWorldPlanReason[] = ["removed", "added", "retained"];
const defaultActions: Record<PolyWorldPlanReason, PolyWorldPlanAction> = {
  added: "show",
  removed: "hide",
  retained: "retain",
  "no-match": "noop",
};

export function planPolyWorldLayers(
  topology: PolyWorldTopology,
  diff: PolyWorldStateDiff,
  policies: readonly PolyWorldLayerPlanPolicy[],
): PolyWorldLayerPlan {
  const entries: PolyWorldPlanEntry[] = [];

  policies.forEach((policy, policyIndex) => {
    const policyEntries: PolyWorldPlanEntry[] = [];
    const policyKey = resolvePolicyKey(policy, policyIndex);

    for (const reason of reasonOrder) {
      for (const elementId of idsForReason(diff, reason)) {
        const element = topology.elementsById.get(elementId);
        if (element === undefined || !matchesPolicy(element, policy)) continue;
        const action = actionForReason(policy, reason);
        const checkContext: PolyWorldPlanEntryCheckContext = {
          policy,
          layer: policy.layer,
          action,
          reason,
          element,
          elementId,
        };
        const guards = checksForPolicy(policy.guards, checkContext);
        const dependencies = checksForPolicy(policy.dependencies, checkContext);

        policyEntries.push({
          key: `${policyKey}:${elementId}`,
          policyId: policy.id,
          layer: policy.layer,
          elementId,
          action,
          reason,
          ...phaseField(policy, action),
          targetState: targetStateForReason(policy, reason, action),
          guards,
          dependencies,
          blocked: hasFailedCheck(guards) || hasFailedCheck(dependencies),
          reasonLabels: reasonLabelsForReason(diff, reason),
          data: policy.data,
        });
      }
    }

    if (policyEntries.length === 0 && policy.emitNoop === true) {
      const action = actionForReason(policy, "no-match");
      const checkContext: PolyWorldPlanEntryCheckContext = {
        policy,
        layer: policy.layer,
        action,
        reason: "no-match",
      };
      const guards = checksForPolicy(policy.guards, checkContext);
      const dependencies = checksForPolicy(policy.dependencies, checkContext);
      policyEntries.push({
        key: `${policyKey}:noop`,
        policyId: policy.id,
        layer: policy.layer,
        action,
        reason: "no-match",
        ...phaseField(policy, action),
        targetState: targetStateForReason(policy, "no-match", action),
        guards,
        dependencies,
        blocked: hasFailedCheck(guards) || hasFailedCheck(dependencies),
        reasonLabels: diff.next.reasonLabels,
        data: policy.data,
      });
    }

    entries.push(...policyEntries);
  });

  return {
    previousSignature: diff.previousSignature,
    nextSignature: diff.nextSignature,
    changed: diff.changed,
    entries,
    actionCounts: countActions(entries),
    layerCounts: countLayerActions(entries),
  };
}

function idsForReason(diff: PolyWorldStateDiff, reason: PolyWorldPlanReason): readonly string[] {
  if (reason === "added") return diff.resolvedElements.added;
  if (reason === "removed") return diff.resolvedElements.removed;
  if (reason === "retained") return diff.resolvedElements.retained;
  return [];
}

function actionForReason(
  policy: PolyWorldLayerPlanPolicy,
  reason: PolyWorldPlanReason,
): PolyWorldPlanAction {
  return policy.actions?.[reason] ?? defaultActions[reason];
}

function targetStateForReason(
  policy: PolyWorldLayerPlanPolicy,
  reason: PolyWorldPlanReason,
  action: PolyWorldPlanAction,
): PolyWorldPlanTargetState {
  return {
    ...targetStateForAction(action),
    ...policy.targetStates?.[reason],
  };
}

function targetStateForAction(action: PolyWorldPlanAction): PolyWorldPlanTargetState {
  if (action === "show") return { visible: true, rendered: true };
  if (action === "hide") return { visible: false, rendered: false };
  if (action === "retain") return { visible: true, rendered: true };
  if (action === "preload") return { preloaded: true };
  return {};
}

function checksForPolicy(
  checks: PolyWorldLayerPlanPolicy["guards"],
  context: PolyWorldPlanEntryCheckContext,
): readonly PolyWorldPlanCheckResult[] {
  const resolved = typeof checks === "function" ? checks(context) : checks;
  return resolved?.map((check) => ({ ...check })) ?? [];
}

function hasFailedCheck(checks: readonly PolyWorldPlanCheckResult[]): boolean {
  return checks.some((check) => check.ok === false);
}

function phaseField(
  policy: PolyWorldLayerPlanPolicy,
  action: PolyWorldPlanAction,
): { phase?: PolyWorldPlanPhase } {
  const phase = policy.phase ?? phaseForAction(action);
  return phase === undefined ? {} : { phase };
}

function phaseForAction(action: PolyWorldPlanAction): PolyWorldPlanPhase | undefined {
  if (action === "preload") return "preload";
  if (action === "show") return "render";
  if (action === "retain") return "render";
  if (action === "hide") return "cleanup";
  return undefined;
}

function reasonLabelsForReason(
  diff: PolyWorldStateDiff,
  reason: PolyWorldPlanReason,
): readonly string[] {
  if (reason === "removed") return diff.previous.reasonLabels;
  return diff.next.reasonLabels;
}

function matchesPolicy(element: PolyWorldElement, policy: PolyWorldLayerPlanPolicy): boolean {
  if (!matchesOne(element.layers, policy.elementLayers)) return false;
  if (!matchesOne(element.tags, policy.tags)) return false;
  if (!matchesOne(element.kind === undefined ? undefined : [element.kind], policy.elementKinds)) return false;
  if (!matchesOne([element.id], policy.elementIds)) return false;
  return true;
}

function matchesOne(values: readonly string[] | undefined, filter: readonly string[] | undefined): boolean {
  if (filter === undefined) return true;
  if (filter.length === 0) return false;
  if (values === undefined) return false;
  return values.some((value) => filter.includes(value));
}

function resolvePolicyKey(policy: PolyWorldLayerPlanPolicy, policyIndex: number): string {
  return policy.id ?? `${policy.layer}:${policyIndex}`;
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

function compareStrings(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}
