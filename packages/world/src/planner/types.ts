import type { PolyWorldData, PolyWorldElement } from "../topology";

export type PolyWorldPlanAction = "show" | "hide" | "retain" | "preload" | "noop";
export type PolyWorldPlanReason = "added" | "removed" | "retained" | "no-match";
export type PolyWorldPlanPhase = "preload" | "mount" | "activate" | "render" | "order" | "cleanup";
export type PolyWorldPlanStateName =
  | "visible"
  | "loaded"
  | "resident"
  | "active"
  | "rendered"
  | "preloaded";

export type PolyWorldPlanReasonActions = Partial<Record<PolyWorldPlanReason, PolyWorldPlanAction>>;
export type PolyWorldPlanActionCounts = Record<PolyWorldPlanAction, number>;
export type PolyWorldPlanTargetState = Partial<Record<PolyWorldPlanStateName, boolean>>;
export type PolyWorldPlanReasonTargetStates = Partial<Record<PolyWorldPlanReason, PolyWorldPlanTargetState>>;

export interface PolyWorldPlanEntryCheckContext {
  policy: PolyWorldLayerPlanPolicy;
  layer: string;
  action: PolyWorldPlanAction;
  reason: PolyWorldPlanReason;
  element?: PolyWorldElement;
  elementId?: string;
}

export interface PolyWorldPlanCheckResult {
  id: string;
  ok: boolean;
  label?: string;
  message?: string;
  data?: PolyWorldData;
}

export type PolyWorldPlanCheckInput =
  | readonly PolyWorldPlanCheckResult[]
  | ((context: PolyWorldPlanEntryCheckContext) => readonly PolyWorldPlanCheckResult[] | undefined);

export interface PolyWorldLayerPlanPolicy {
  id?: string;
  layer: string;
  phase?: PolyWorldPlanPhase;
  elementLayers?: readonly string[];
  tags?: readonly string[];
  elementKinds?: readonly string[];
  elementIds?: readonly string[];
  actions?: PolyWorldPlanReasonActions;
  targetStates?: PolyWorldPlanReasonTargetStates;
  guards?: PolyWorldPlanCheckInput;
  dependencies?: PolyWorldPlanCheckInput;
  emitNoop?: boolean;
  data?: PolyWorldData;
}

export interface PolyWorldPlanEntry {
  key: string;
  policyId?: string;
  layer: string;
  elementId?: string;
  action: PolyWorldPlanAction;
  reason: PolyWorldPlanReason;
  phase?: PolyWorldPlanPhase;
  targetState: PolyWorldPlanTargetState;
  guards?: readonly PolyWorldPlanCheckResult[];
  dependencies?: readonly PolyWorldPlanCheckResult[];
  blocked?: boolean;
  reasonLabels: readonly string[];
  data?: PolyWorldData;
}

export interface PolyWorldLayerPlan {
  previousSignature: string;
  nextSignature: string;
  changed: boolean;
  entries: readonly PolyWorldPlanEntry[];
  actionCounts: PolyWorldPlanActionCounts;
  layerCounts: Readonly<Record<string, PolyWorldPlanActionCounts>>;
}
