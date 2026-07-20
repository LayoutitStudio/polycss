import type { PolyWorldPlanDebugSnapshot, PolyWorldPlanDebugSnapshotOptions } from "../debug/planSnapshot";
import { createPolyWorldPlanDebugSnapshot } from "../debug/planSnapshot";
import type { PolyWorldState, PolyWorldStateDiff, PolyWorldStateInput } from "../state";
import { createPolyWorldState, diffPolyWorldState } from "../state";
import type {
  PolyWorldElementResolution,
  PolyWorldSelection,
  PolyWorldSelectionElementRelationExpansionOptions,
  PolyWorldTopology,
} from "../topology";
import { expandPolyWorldSelectionElementRelations } from "../topology";
import { planPolyWorldLayers } from "./plan";
import { createPolyWorldResourceLoadSet } from "./resources";
import type {
  PolyWorldResourceLoadSetSummary,
  PolyWorldResourceReadinessMap,
  PolyWorldResourceReadinessSummary,
  PolyWorldResourceReadinessSummaryOptions,
} from "./resources";
import type { PolyWorldLayerPlan, PolyWorldLayerPlanPolicy } from "./types";

export type PolyWorldTransitionStateOptions = Omit<PolyWorldStateInput, "selection" | "resolution">;

export type PolyWorldTransitionDebugOptions = Omit<
  PolyWorldPlanDebugSnapshotOptions,
  "appliedState" | "planningSelection"
>;

export interface PolyWorldTransitionReadinessOptions extends PolyWorldResourceReadinessSummaryOptions {
  resources: PolyWorldResourceReadinessMap;
  elementIds?: readonly string[];
}

export interface PolyWorldTransitionOptions {
  previousState: PolyWorldState;
  policies: readonly PolyWorldLayerPlanPolicy[];
  selection?: PolyWorldSelection;
  resolution?: PolyWorldElementResolution;
  relations?: false | PolyWorldSelectionElementRelationExpansionOptions;
  readiness?: PolyWorldTransitionReadinessOptions;
  state?: PolyWorldTransitionStateOptions;
  debug?: false | PolyWorldTransitionDebugOptions;
}

export interface PolyWorldTransition {
  planningSelection?: PolyWorldSelection;
  readiness?: PolyWorldResourceReadinessSummary;
  loadSet?: PolyWorldResourceLoadSetSummary;
  nextState: PolyWorldState;
  diff: PolyWorldStateDiff;
  plan: PolyWorldLayerPlan;
  debug?: PolyWorldPlanDebugSnapshot;
}

export function planPolyWorldTransition(
  topology: PolyWorldTopology,
  options: PolyWorldTransitionOptions,
): PolyWorldTransition {
  const selection = resolveTransitionSelection(topology, options);
  const nextState = createPolyWorldState(topology, {
    ...options.state,
    selection,
    resolution: options.resolution,
  });
  const diff = diffPolyWorldState(options.previousState, nextState);
  const plan = planPolyWorldLayers(topology, diff, options.policies);
  const loadSet = options.readiness === undefined
    ? undefined
    : createPolyWorldResourceLoadSet(
      topology,
      {
        previousElementIds: options.previousState.resolvedElementIds,
        nextElementIds: options.readiness.elementIds ?? nextState.resolvedElementIds,
        resources: options.readiness.resources,
        readyStates: options.readiness.readyStates,
        resourceDeclarations: options.readiness.resourceDeclarations,
      },
    );
  const readiness = loadSet?.nextReadiness;
  return {
    ...(selection === undefined ? {} : { planningSelection: selection }),
    ...(readiness === undefined ? {} : { readiness }),
    ...(loadSet === undefined ? {} : { loadSet }),
    nextState,
    diff,
    plan,
    ...(options.debug === false ? {} : {
      debug: createPolyWorldPlanDebugSnapshot(diff, plan, {
        ...options.debug,
        ...(readiness === undefined ? {} : { readiness }),
        ...(loadSet === undefined ? {} : { loadSet }),
        ...(selection === undefined ? {} : { planningSelection: selection }),
      }),
    }),
  };
}

function resolveTransitionSelection(
  topology: PolyWorldTopology,
  options: PolyWorldTransitionOptions,
): PolyWorldSelection | undefined {
  if (options.selection === undefined) return undefined;
  if (options.relations === undefined || options.relations === false) return options.selection;
  if (options.resolution !== undefined) return options.selection;
  return expandPolyWorldSelectionElementRelations(topology, options.selection, options.relations);
}
