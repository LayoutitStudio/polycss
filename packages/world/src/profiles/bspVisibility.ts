import type {
  PolyWorldSelection,
  PolyWorldSelectionElementRelationExpansionOptions,
  PolyWorldTopology,
} from "../topology";
import type {
  PolyWorldLayerPlanPolicy,
  PolyWorldTransition,
  PolyWorldTransitionDebugOptions,
  PolyWorldTransitionReadinessOptions,
  PolyWorldTransitionStateOptions,
} from "../planner";
import { planPolyWorldTransition } from "../planner";
import type { PolyWorldState } from "../state";
import {
  createPolyWorldBspDebugSnapshot,
  type PolyWorldBspDebugSnapshot,
  type PolyWorldBspDebugSnapshotOptions,
} from "../debug/bspSnapshot";
import type { PolyWorldProfileArtifactProof } from "./artifact";
import {
  resolvePolyWorldBspBakedPvs,
  resolvePolyWorldBspLeaf,
  resolvePolyWorldBspPvs,
  resolvePolyWorldBspViewSurfaceElements,
  resolvePolyWorldBspViewPvs,
  selectPolyWorldBspPvs,
  selectPolyWorldBspViewPvs,
  tracePolyWorldBspViewPvs,
  type PolyWorldBspLeafResolution,
  type PolyWorldBspResolvedPvs,
  type PolyWorldBspResolvedViewPvs,
  type PolyWorldBspResolvedViewSurfaceElements,
  type PolyWorldBspTree,
  type PolyWorldBspViewPvsSelectionOptions,
  type PolyWorldBspViewPvsTrace,
  type PolyWorldBspViewSurfaceElement,
} from "./bsp";
import { summarizePolyWorldBspTopologyProof } from "./bspProof";
import type { Vec3 } from "@layoutit/polycss-core";
import {
  createPolyWorldProfileFrameSummary,
  type PolyWorldProfileFrameSummary,
} from "./frameSummary";

export type PolyWorldBspVisibilityDebugOptions = Omit<
  PolyWorldBspDebugSnapshotOptions,
  "leafId" | "broadPvs" | "viewPvs" | "trace"
>;

export interface PolyWorldBspVisibilityOptions extends PolyWorldBspViewPvsSelectionOptions {
  includeTrace?: boolean;
  debug?: false | PolyWorldBspVisibilityDebugOptions;
}

export interface PolyWorldBspVisibility {
  leaf?: PolyWorldBspLeafResolution;
  broadPvs?: PolyWorldBspResolvedPvs;
  viewPvs?: PolyWorldBspResolvedViewPvs;
  trace?: PolyWorldBspViewPvsTrace;
  selection: PolyWorldSelection;
  debug?: PolyWorldBspDebugSnapshot;
}

export type PolyWorldBspVisibilityFrameStateOptions = PolyWorldTransitionStateOptions;

export type PolyWorldBspVisibilityFrameDebugOptions = PolyWorldTransitionDebugOptions;

export interface PolyWorldBspVisibilityFrameOptions extends PolyWorldBspVisibilityOptions {
  previousState: PolyWorldState;
  policies: readonly PolyWorldLayerPlanPolicy[];
  surfaces?: readonly PolyWorldBspViewSurfaceElement[];
  relations?: false | PolyWorldSelectionElementRelationExpansionOptions;
  readiness?: PolyWorldTransitionReadinessOptions;
  state?: PolyWorldBspVisibilityFrameStateOptions;
  planDebug?: false | PolyWorldBspVisibilityFrameDebugOptions;
}

export interface PolyWorldBspVisibilityFrameSets {
  currentLeafId?: string;
  broadPvsLeafIds: readonly string[];
  viewPvsLeafIds: readonly string[];
  structuralSurfaceIds: readonly string[];
  structuralElementIds: readonly string[];
  detailSurfaceIds: readonly string[];
  detailElementIds: readonly string[];
  plannedElementIds: readonly string[];
}

export interface PolyWorldBspVisibilityFrame extends PolyWorldTransition {
  artifact: PolyWorldProfileArtifactProof;
  visibility: PolyWorldBspVisibility;
  surfaceElements?: PolyWorldBspResolvedViewSurfaceElements;
  visibilitySets: PolyWorldBspVisibilityFrameSets;
  frameSummary: PolyWorldProfileFrameSummary;
}

export function resolvePolyWorldBspVisibility(
  topology: PolyWorldTopology,
  tree: PolyWorldBspTree,
  options: PolyWorldBspVisibilityOptions,
): PolyWorldBspVisibility {
  const leaf = resolveBspVisibilityLeaf(tree, options);
  if (leaf === undefined) {
    const selection = selectPolyWorldBspPvs(topology, tree, fallbackBspVisibilitySelectionOptions(options));
    return {
      selection,
      ...(options.debug === false ? {} : {
        debug: createPolyWorldBspDebugSnapshot(tree, options.debug),
      }),
    };
  }

  const broadPvs = resolveBspVisibilityBroadPvs(tree, leaf.leafId, options);
  const includeTrace = options.includeTrace === true;
  const trace = includeTrace
    ? tracePolyWorldBspViewPvs(tree, { ...options, leafId: leaf.leafId })
    : undefined;
  const viewPvs = trace ?? resolvePolyWorldBspViewPvs(tree, { ...options, leafId: leaf.leafId });
  const selection = selectPolyWorldBspViewPvs(topology, tree, { ...options, leafId: leaf.leafId });

  return {
    leaf,
    broadPvs,
    viewPvs,
    ...(trace === undefined ? {} : { trace }),
    selection,
    ...(options.debug === false ? {} : {
      debug: createPolyWorldBspDebugSnapshot(tree, {
        ...options.debug,
        leafId: leaf.leafId,
        broadPvs,
        viewPvs,
        ...(trace === undefined ? {} : { trace }),
      }),
    }),
  };
}

export function planPolyWorldBspVisibilityFrame(
  topology: PolyWorldTopology,
  tree: PolyWorldBspTree,
  options: PolyWorldBspVisibilityFrameOptions,
): PolyWorldBspVisibilityFrame {
  const visibility = resolvePolyWorldBspVisibility(topology, tree, options);
  const surfaceElements = visibility.leaf === undefined || options.surfaces === undefined
    ? undefined
    : resolvePolyWorldBspViewSurfaceElements(tree, {
      ...options,
      leafId: visibility.leaf.leafId,
      surfaces: options.surfaces,
    });
  const transition = planPolyWorldTransition(topology, {
    previousState: options.previousState,
    policies: options.policies,
    state: options.state,
    relations: options.relations,
    readiness: options.readiness,
    selection: surfaceElements === undefined
      ? visibility.selection
      : selectionWithBspSurfaceElements(visibility.selection, surfaceElements),
    debug: options.planDebug,
  });
  const artifact = summarizePolyWorldBspTopologyProof(tree).artifact;
  const visibilitySets = createBspVisibilityFrameSets(visibility, surfaceElements, transition);
  return {
    artifact,
    visibility,
    ...(surfaceElements === undefined ? {} : { surfaceElements }),
    visibilitySets,
    frameSummary: createPolyWorldProfileFrameSummary({
      artifact,
      transition,
      current: {
        leafIds: visibility.leaf?.leafId === undefined ? [] : [visibility.leaf.leafId],
        regionIds: visibility.leaf?.leaf.regionId === undefined ? [] : [visibility.leaf.leaf.regionId],
      },
      candidate: {
        leafIds: visibility.broadPvs?.leafIds,
        regionIds: visibility.selection.regionIds,
        linkIds: visibility.selection.linkIds,
        portalIds: visibility.broadPvs?.portalIds,
        elementIds: visibility.selection.elementIds,
        selectionKeys: visibility.selection.selectionKeys,
      },
      broad: {
        leafIds: visibility.broadPvs?.leafIds,
        regionIds: visibility.broadPvs?.regionIds,
        linkIds: visibility.broadPvs?.linkIds,
        portalIds: visibility.broadPvs?.portalIds,
        elementIds: visibility.broadPvs?.elementIds,
        selectionKeys: visibility.broadPvs?.selectionKeys,
      },
      view: {
        leafIds: visibility.viewPvs?.leafIds,
        regionIds: visibility.viewPvs?.regionIds,
        linkIds: visibility.viewPvs?.linkIds,
        portalIds: visibility.viewPvs?.portalIds,
        surfaceIds: surfaceElements?.surfaceIds,
        elementIds: surfaceElements?.elementIds ?? visibility.viewPvs?.elementIds,
        selectionKeys: visibility.viewPvs?.selectionKeys,
      },
      retained: {
        surfaceIds: visibilitySets.structuralSurfaceIds,
        elementIds: visibilitySets.structuralElementIds,
      },
      rejected: {
        portalIds: visibility.trace?.entries.flatMap((entry) => entry.status === "visible" ? [] : [entry.portalId]),
        reasonCounts: visibility.trace === undefined ? undefined : countBspTraceStatuses(visibility.trace.entries),
      },
    }),
    ...transition,
  };
}

function createBspVisibilityFrameSets(
  visibility: PolyWorldBspVisibility,
  surfaceElements: PolyWorldBspResolvedViewSurfaceElements | undefined,
  transition: PolyWorldTransition,
): PolyWorldBspVisibilityFrameSets {
  return {
    ...(visibility.leaf?.leafId === undefined ? {} : { currentLeafId: visibility.leaf.leafId }),
    broadPvsLeafIds: [...(visibility.broadPvs?.leafIds ?? [])],
    viewPvsLeafIds: [...(visibility.viewPvs?.leafIds ?? [])],
    structuralSurfaceIds: [...(surfaceElements?.structuralSurfaceIds ?? [])],
    structuralElementIds: [...(surfaceElements?.structuralElementIds ?? [])],
    detailSurfaceIds: [...(surfaceElements?.detailSurfaceIds ?? [])],
    detailElementIds: [...(surfaceElements?.detailElementIds ?? [])],
    plannedElementIds: uniqueStrings(transition.plan.entries.flatMap((entry) =>
      entry.elementId === undefined ? [] : [entry.elementId]
    )),
  };
}

function selectionWithBspSurfaceElements(
  selection: PolyWorldSelection,
  surfaceElements: PolyWorldBspResolvedViewSurfaceElements,
): PolyWorldSelection {
  const elementIds = uniqueStrings([
    ...(selection.elementIds ?? []),
    ...surfaceElements.elementIds,
  ]);
  return {
    ...selection,
    elementIds,
    reasons: [
      ...(selection.reasons ?? []),
      {
        id: "poly-world-bsp-view-surfaces",
        kind: "viewSurfaceElements",
        label: "view-surfaces",
        data: {
          elementIds,
          surfaceIds: surfaceElements.surfaceIds,
          leafIds: surfaceElements.leafIds,
          regionIds: surfaceElements.regionIds,
          roles: surfaceElements.roles,
        },
      },
    ],
  };
}

function resolveBspVisibilityLeaf(
  tree: PolyWorldBspTree,
  options: PolyWorldBspVisibilityOptions,
): PolyWorldBspLeafResolution | undefined {
  if (options.leafId !== undefined) {
    const leaf = tree.leavesById.get(options.leafId);
    return leaf === undefined ? undefined : { leaf, leafId: leaf.id, path: [] };
  }
  const leaf = resolvePolyWorldBspLeaf(tree, options.point);
  if (leaf?.leaf.bounds !== undefined && !boundsContainsPoint(leaf.leaf.bounds, options.point)) return undefined;
  return leaf;
}

function resolveBspVisibilityBroadPvs(
  tree: PolyWorldBspTree,
  leafId: string,
  options: PolyWorldBspVisibilityOptions,
): PolyWorldBspResolvedPvs {
  if (options.portalState === undefined) {
    const baked = resolvePolyWorldBspBakedPvs(tree, leafId);
    if (baked !== undefined) return baked;
  }
  return resolvePolyWorldBspPvs(tree, leafId, options);
}

function fallbackBspVisibilitySelectionOptions(
  options: PolyWorldBspVisibilityOptions,
): Parameters<typeof selectPolyWorldBspPvs>[2] {
  return {
    projection: options.projection,
    sampleInset: options.sampleInset,
    maxDepth: options.maxDepth,
    includePortalSelectionKeys: options.includePortalSelectionKeys,
    portalState: options.portalState,
    includeLeafRegion: options.includeLeafRegion,
    includePvs: options.includePvs,
    regionIds: options.regionIds,
    linkIds: options.linkIds,
    selectionKeys: options.selectionKeys,
    elementIds: options.elementIds,
    reasonLabels: options.reasonLabels,
    reasons: options.reasons,
    data: options.data,
  };
}

function boundsContainsPoint(bounds: { min: Vec3; max: Vec3 }, point: Vec3): boolean {
  return point.every((value, axis) =>
    value >= bounds.min[axis] - 0.0001 && value <= bounds.max[axis] + 0.0001
  );
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values)].sort(compareStrings);
}

function countBspTraceStatuses(
  entries: readonly { status: string }[],
): Readonly<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const entry of entries) counts[entry.status] = (counts[entry.status] ?? 0) + 1;
  return counts;
}

function compareStrings(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}
