import type { PolyWorldData } from "../topology";
import type {
  PolyWorldLayerPlan,
  PolyWorldPlanAction,
  PolyWorldPlanActionCounts,
  PolyWorldPlanCheckResult,
  PolyWorldPlanEntry,
} from "../planner";

export interface PolyWorldDomParentLike<TElement extends PolyWorldDomElementLike = PolyWorldDomElementLike> {
  insertBefore(element: any, before: any): unknown;
}

export interface PolyWorldDomElementLike {
  parentNode?: unknown | null;
  hidden?: boolean;
  remove(): unknown;
  setAttribute?(name: string, value: string): unknown;
  removeAttribute?(name: string): unknown;
}

export interface PolyWorldDomRecordInput<
  TElement extends PolyWorldDomElementLike = PolyWorldDomElementLike,
> {
  elementId: string;
  element: TElement;
  parent?: PolyWorldDomParentLike<TElement> | null;
  mounted?: boolean;
  previousElementId?: string;
  nextElementId?: string;
  sourceIds?: readonly string[];
  aliases?: readonly string[];
  layers?: readonly string[];
  tags?: readonly string[];
  data?: PolyWorldData;
}

export interface PolyWorldDomRecord<
  TElement extends PolyWorldDomElementLike = PolyWorldDomElementLike,
> {
  elementId: string;
  element: TElement;
  parent: PolyWorldDomParentLike<TElement> | null;
  mounted: boolean;
  previousElementId?: string;
  nextElementId?: string;
  sourceIds: readonly string[];
  aliases: readonly string[];
  layers: readonly string[];
  tags: readonly string[];
  data?: PolyWorldData;
}

export interface PolyWorldDomValidationDiagnostic {
  code: string;
  message: string;
  elementId?: string;
  field?: string;
}

export type PolyWorldDomApplyStatus =
  | "added"
  | "hidden"
  | "removed"
  | "retained"
  | "noop"
  | "missing"
  | "blocked"
  | "unsupported";

export interface PolyWorldDomApplyCounts {
  added: number;
  hidden: number;
  removed: number;
  retained: number;
  noop: number;
  missing: number;
  blocked: number;
  unsupported: number;
  changed: number;
  mounted: number;
}

export interface PolyWorldDomApplyEntry<
  TElement extends PolyWorldDomElementLike = PolyWorldDomElementLike,
> {
  key: string;
  action: PolyWorldPlanAction;
  status: PolyWorldDomApplyStatus;
  layer: string;
  elementId?: string;
  policyId?: string;
  mounted: boolean;
  changed: boolean;
  guards: readonly PolyWorldPlanCheckResult[];
  dependencies: readonly PolyWorldPlanCheckResult[];
  failedGuards: readonly PolyWorldPlanCheckResult[];
  failedDependencies: readonly PolyWorldPlanCheckResult[];
  reasonLabels: readonly string[];
  message?: string;
  planEntry: PolyWorldPlanEntry;
  record?: PolyWorldDomRecord<TElement>;
}

export interface PolyWorldDomApplyResult<
  TElement extends PolyWorldDomElementLike = PolyWorldDomElementLike,
> {
  previousSignature?: string;
  nextSignature?: string;
  planChanged?: boolean;
  entries: readonly PolyWorldDomApplyEntry<TElement>[];
  actionCounts: PolyWorldPlanActionCounts;
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
}

export interface PolyWorldDomApplyOptions {
  hideMode?: "remove" | "hidden";
  syncHidden?: boolean;
}

export type PolyWorldDomPlanInput = PolyWorldLayerPlan | readonly PolyWorldPlanEntry[];
