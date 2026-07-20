import type { PolyWorldLayerPlan, PolyWorldPlanEntry } from "../planner";
import type { PolyWorldPlanAction, PolyWorldPlanActionCounts, PolyWorldPlanCheckResult } from "../planner";
import type {
  PolyWorldDomApplyCounts,
  PolyWorldDomApplyEntry,
  PolyWorldDomApplyOptions,
  PolyWorldDomApplyResult,
  PolyWorldDomApplyStatus,
  PolyWorldDomElementLike,
  PolyWorldDomPlanInput,
  PolyWorldDomRecord,
} from "./types";
import type { PolyWorldDomRegistry } from "./registry";

const defaultApplyOptions: Required<PolyWorldDomApplyOptions> = {
  hideMode: "remove",
  syncHidden: true,
};
const planActions: readonly PolyWorldPlanAction[] = ["show", "hide", "retain", "preload", "noop"];

export function applyPolyWorldDomPlan<
  TElement extends PolyWorldDomElementLike = PolyWorldDomElementLike,
>(
  registry: PolyWorldDomRegistry<TElement>,
  plan: PolyWorldDomPlanInput,
  options: PolyWorldDomApplyOptions = {},
): PolyWorldDomApplyResult<TElement> {
  const resolvedOptions = { ...defaultApplyOptions, ...options };
  const entries = planEntries(plan).map((entry) => applyEntry(registry, entry, resolvedOptions));
  const counts = countApplyEntries(entries, registry.mountedElementIds().length);

  return {
    previousSignature: isLayerPlan(plan) ? plan.previousSignature : undefined,
    nextSignature: isLayerPlan(plan) ? plan.nextSignature : undefined,
    planChanged: isLayerPlan(plan) ? plan.changed : undefined,
    entries,
    actionCounts: countPlanActions(entries),
    counts,
    plannedElementIds: uniqueSorted(entries.map((entry) => entry.elementId).filter(isString)),
    addedElementIds: statusElementIds(entries, "added"),
    hiddenAppliedElementIds: statusElementIds(entries, "hidden"),
    removedElementIds: statusElementIds(entries, "removed"),
    retainedElementIds: statusElementIds(entries, "retained"),
    noopElementIds: statusElementIds(entries, "noop"),
    changedElementIds: uniqueSorted(
      entries.filter((entry) => entry.changed).map((entry) => entry.elementId).filter(isString),
    ),
    missingElementIds: uniqueSorted(
      entries.filter((entry) => entry.status === "missing").map((entry) => entry.elementId).filter(isString),
    ),
    blockedElementIds: uniqueSorted(
      entries.filter((entry) => entry.status === "blocked").map((entry) => entry.elementId).filter(isString),
    ),
    mountBlockedElementIds: uniqueSorted(
      entries
        .filter((entry) =>
          entry.status === "blocked" &&
          entry.failedGuards.length === 0 &&
          entry.failedDependencies.length === 0
        )
        .map((entry) => entry.elementId)
        .filter(isString),
    ),
    guardFailureElementIds: uniqueSorted(
      entries.filter((entry) => entry.failedGuards.length > 0).map((entry) => entry.elementId).filter(isString),
    ),
    dependencyFailureElementIds: uniqueSorted(
      entries.filter((entry) => entry.failedDependencies.length > 0).map((entry) => entry.elementId).filter(isString),
    ),
    unsupportedElementIds: uniqueSorted(
      entries.filter((entry) => entry.status === "unsupported").map((entry) => entry.elementId).filter(isString),
    ),
    mountedElementIds: registry.mountedElementIds(),
    hiddenElementIds: registry.hiddenElementIds(),
  };
}

function applyEntry<TElement extends PolyWorldDomElementLike>(
  registry: PolyWorldDomRegistry<TElement>,
  planEntry: PolyWorldPlanEntry,
  options: Required<PolyWorldDomApplyOptions>,
): PolyWorldDomApplyEntry<TElement> {
  const elementId = planEntry.elementId;
  const record = elementId === undefined ? undefined : registry.getByElementId(elementId);
  const failedGuards = failedChecks(planEntry.guards);
  const failedDependencies = failedChecks(planEntry.dependencies);

  if (failedGuards.length > 0 || failedDependencies.length > 0) {
    return entryResult(
      planEntry,
      record,
      "blocked",
      false,
      record?.mounted ?? false,
      failedGuards.length > 0
        ? "Plan entry guard failed."
        : "Plan entry dependency failed.",
    );
  }

  if (planEntry.action === "noop") {
    if (elementId !== undefined && record === undefined) {
      return entryResult(planEntry, undefined, "missing", false, false, "No DOM record is registered for this element.");
    }
    return entryResult(planEntry, record, "noop", false, record?.mounted ?? false);
  }

  if (planEntry.action === "preload") {
    return entryResult(
      planEntry,
      record,
      "unsupported",
      false,
      record?.mounted ?? false,
      "preload is not applied by the DOM layer.",
    );
  }

  if (elementId === undefined) {
    return entryResult(planEntry, undefined, "missing", false, false, "Plan entry has no elementId.");
  }
  if (record === undefined) {
    return entryResult(planEntry, undefined, "missing", false, false, "No DOM record is registered for this element.");
  }

  if (planEntry.action === "show") return showRecord(registry, planEntry, record, options);
  if (planEntry.action === "hide") return hideRecord(planEntry, record, options);
  if (planEntry.action === "retain") {
    if (options.syncHidden && record.mounted) setHidden(record.element, false);
    return entryResult(planEntry, record, "retained", false, record.mounted);
  }

  return entryResult(planEntry, record, "noop", false, record.mounted);
}

function showRecord<TElement extends PolyWorldDomElementLike>(
  registry: PolyWorldDomRegistry<TElement>,
  planEntry: PolyWorldPlanEntry,
  record: PolyWorldDomRecord<TElement>,
  options: Required<PolyWorldDomApplyOptions>,
): PolyWorldDomApplyEntry<TElement> {
  if (record.mounted) {
    const changed = options.syncHidden && isHidden(record.element);
    if (options.syncHidden) setHidden(record.element, false);
    return entryResult(planEntry, record, "retained", changed, true);
  }

  if (record.parent === null) {
    return entryResult(planEntry, record, "blocked", false, false, "Cannot mount record without a parent.");
  }

  const before = findNextMountedElement(registry, record);
  record.parent.insertBefore(record.element, before);
  record.mounted = true;
  if (options.syncHidden) setHidden(record.element, false);

  return entryResult(planEntry, record, "added", true, true);
}

function hideRecord<TElement extends PolyWorldDomElementLike>(
  planEntry: PolyWorldPlanEntry,
  record: PolyWorldDomRecord<TElement>,
  options: Required<PolyWorldDomApplyOptions>,
): PolyWorldDomApplyEntry<TElement> {
  if (!record.mounted) {
    if (options.syncHidden) setHidden(record.element, true);
    return entryResult(planEntry, record, "noop", false, false);
  }

  if (options.hideMode === "hidden") {
    const changed = options.syncHidden && !isHidden(record.element);
    if (options.syncHidden) setHidden(record.element, true);
    return entryResult(planEntry, record, "hidden", changed, true);
  }

  if (options.syncHidden) setHidden(record.element, true);
  record.element.remove();
  record.mounted = false;

  return entryResult(planEntry, record, "removed", true, false);
}

function findNextMountedElement<TElement extends PolyWorldDomElementLike>(
  registry: PolyWorldDomRegistry<TElement>,
  record: PolyWorldDomRecord<TElement>,
): TElement | null {
  const visited = new Set<string>();
  let nextElementId = record.nextElementId;

  while (nextElementId !== undefined && !visited.has(nextElementId)) {
    visited.add(nextElementId);
    const nextRecord = registry.getByElementId(nextElementId);
    if (nextRecord === undefined) return null;
    if (nextRecord.mounted && nextRecord.parent === record.parent) return nextRecord.element;
    nextElementId = nextRecord.nextElementId;
  }

  return null;
}

function setHidden(element: PolyWorldDomElementLike, hidden: boolean): void {
  element.hidden = hidden;
  if (hidden) {
    element.setAttribute?.("hidden", "");
    return;
  }
  element.removeAttribute?.("hidden");
}

function isHidden(element: PolyWorldDomElementLike): boolean {
  return element.hidden === true;
}

function entryResult<TElement extends PolyWorldDomElementLike>(
  planEntry: PolyWorldPlanEntry,
  record: PolyWorldDomRecord<TElement> | undefined,
  status: PolyWorldDomApplyStatus,
  changed: boolean,
  mounted: boolean,
  message?: string,
): PolyWorldDomApplyEntry<TElement> {
  return {
    key: planEntry.key,
    action: planEntry.action,
    status,
    layer: planEntry.layer,
    elementId: planEntry.elementId,
    policyId: planEntry.policyId,
    mounted,
    changed,
    guards: [...(planEntry.guards ?? [])],
    dependencies: [...(planEntry.dependencies ?? [])],
    failedGuards: failedChecks(planEntry.guards),
    failedDependencies: failedChecks(planEntry.dependencies),
    reasonLabels: planEntry.reasonLabels,
    message,
    planEntry,
    record,
  };
}

function countApplyEntries(
  entries: readonly PolyWorldDomApplyEntry[],
  mountedCount: number,
): PolyWorldDomApplyCounts {
  const counts = emptyCounts();
  for (const entry of entries) {
    counts[entry.status] += 1;
    if (entry.changed) counts.changed += 1;
  }
  counts.mounted = mountedCount;
  return counts;
}

function statusElementIds(
  entries: readonly PolyWorldDomApplyEntry[],
  status: PolyWorldDomApplyStatus,
): readonly string[] {
  return uniqueSorted(
    entries.filter((entry) => entry.status === status).map((entry) => entry.elementId).filter(isString),
  );
}

function failedChecks(
  checks: readonly PolyWorldPlanCheckResult[] | undefined,
): readonly PolyWorldPlanCheckResult[] {
  return checks?.filter((check) => check.ok === false) ?? [];
}

function countPlanActions(entries: readonly PolyWorldDomApplyEntry[]): PolyWorldPlanActionCounts {
  const counts = emptyActionCounts();
  for (const entry of entries) counts[entry.action] += 1;
  return counts;
}

function emptyCounts(): PolyWorldDomApplyCounts {
  return {
    added: 0,
    hidden: 0,
    removed: 0,
    retained: 0,
    noop: 0,
    missing: 0,
    blocked: 0,
    unsupported: 0,
    changed: 0,
    mounted: 0,
  };
}

function emptyActionCounts(): PolyWorldPlanActionCounts {
  return Object.fromEntries(planActions.map((action) => [action, 0])) as PolyWorldPlanActionCounts;
}

function planEntries(plan: PolyWorldDomPlanInput): readonly PolyWorldPlanEntry[] {
  return isLayerPlan(plan) ? plan.entries : plan;
}

function isLayerPlan(plan: PolyWorldDomPlanInput): plan is PolyWorldLayerPlan {
  return !Array.isArray(plan) && "entries" in plan;
}

function uniqueSorted(values: readonly string[]): readonly string[] {
  return [...new Set(values)].sort(compareStrings);
}

function compareStrings(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function isString(value: string | undefined): value is string {
  return value !== undefined;
}
