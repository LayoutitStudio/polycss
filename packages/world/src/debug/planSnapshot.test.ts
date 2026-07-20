import { describe, expect, it } from "vitest";
import { planPolyWorldLayers, summarizePolyWorldResourceReadiness } from "../planner";
import { createPolyWorldState, diffPolyWorldState } from "../state";
import { createPolyWorldTopology } from "../topology";
import {
  adaptPolyWorldPlanDebugSnapshot,
  createPolyWorldPlanDebugSnapshot,
} from "./index";

function topologyFixture() {
  return createPolyWorldTopology({
    regions: [
      { id: "group-45" },
      { id: "group-14" },
      { id: "group-15" },
    ],
    links: [
      {
        id: "portal-45-14",
        fromRegionId: "group-45",
        toRegionId: "group-14",
        selectionKeys: ["portal:45:14"],
      },
    ],
    elements: [
      { id: "shell-45", regionIds: ["group-45"], kind: "mesh", layers: ["render"], tags: ["solid"] },
      {
        id: "shell-14",
        regionIds: ["group-14"],
        kind: "mesh",
        layers: ["render"],
        tags: ["solid"],
        resourceIds: ["mesh:shell-14", "texture:shell-14"],
      },
      {
        id: "shell-15",
        regionIds: ["group-15"],
        kind: "mesh",
        layers: ["render"],
        tags: ["solid"],
        resourceIds: ["mesh:shell-15"],
      },
      {
        id: "portal-marker",
        selectionKeys: ["portal:45:14"],
        kind: "marker",
        layers: ["debug"],
        tags: ["portal"],
      },
    ],
  });
}

describe("createPolyWorldPlanDebugSnapshot", () => {
  it("summarizes selected, resolved, planned, and applied state without DOM reads", () => {
    const topology = topologyFixture();
    const previous = createPolyWorldState(topology, {
      id: "previous",
      selection: { regionIds: ["group-45"], reasons: [{ label: "current-group" }] },
    });
    const next = createPolyWorldState(topology, {
      id: "next",
      selection: {
        regionIds: ["group-45", "group-14", "group-15"],
        linkIds: ["portal-45-14"],
        selectionKeys: ["portal:45:14", "missing:key"],
        reasons: [{ label: "visible-through-portal" }],
      },
    });
    const applied = createPolyWorldState(topology, {
      id: "applied",
      selection: {
        regionIds: ["group-45", "group-14"],
        linkIds: ["portal-45-14"],
        selectionKeys: ["portal:45:14"],
      },
    });
    const diff = diffPolyWorldState(previous, next);
    const plan = planPolyWorldLayers(topology, diff, [
      {
        id: "render",
        layer: "render",
        elementLayers: ["render"],
        tags: ["solid"],
        guards: ({ elementId }) => [{ id: "ready", ok: elementId !== "shell-15" }],
      },
      { id: "debug", layer: "debug", tags: ["portal"], actions: { retained: "noop" } },
    ]);
    const snapshot = createPolyWorldPlanDebugSnapshot(diff, plan, {
      planningSelection: {
        regionIds: ["group-45", "group-14", "group-15"],
        linkIds: ["portal-45-14"],
        selectionKeys: ["portal:45:14", "missing:key"],
        reasons: [{ label: "visibility-source" }],
      },
      appliedState: applied,
      metadata: { view: "product" },
    });

    expect(snapshot.changed).toBe(true);
    expect(snapshot.planningSelection?.regionIds).toEqual(["group-45", "group-14", "group-15"]);
    expect(snapshot.planningSelection?.linkIds).toEqual(["portal-45-14"]);
    expect(snapshot.planningSelection?.selectionKeys).toEqual(["portal:45:14", "missing:key"]);
    expect(snapshot.planningSelection?.reasonLabels).toEqual(["visibility-source"]);
    expect(snapshot.previous.counts.resolvedElements).toBe(1);
    expect(snapshot.next.selectedRegionIds).toEqual(["group-14", "group-15", "group-45"]);
    expect(snapshot.next.unresolved.selectionKeys).toEqual(["missing:key"]);
    expect(snapshot.diff.resolvedElements.counts).toEqual({
      added: 3,
      removed: 0,
      retained: 1,
    });
    expect(snapshot.plan.actionCounts).toEqual({
      show: 3,
      hide: 0,
      retain: 1,
      preload: 0,
      noop: 0,
    });
    expect(snapshot.plan.blockedEntryCount).toBe(1);
    expect(snapshot.plan.guardFailureEntryCount).toBe(1);
    expect(snapshot.plan.dependencyFailureEntryCount).toBe(0);
    expect(snapshot.plan.entries?.map((entry) => [entry.elementId, entry.action, entry.reason])).toEqual([
      ["shell-14", "show", "added"],
      ["shell-15", "show", "added"],
      ["shell-45", "retain", "retained"],
      ["portal-marker", "show", "added"],
    ]);
    expect(snapshot.applied?.matchesNext).toBe(false);
    expect(snapshot.applied?.missingElementIds).toEqual(["shell-15"]);
    expect(snapshot.applied?.extraElementIds).toEqual([]);
    expect(snapshot.metadata).toEqual({ view: "product" });
  });

  it("lets apps expose culling-shaped debug without adding game-specific exported fields", () => {
    const topology = topologyFixture();
    const previous = createPolyWorldState(topology, {
      selection: { regionIds: ["group-45"] },
    });
    const next = createPolyWorldState(topology, {
      selection: {
        regionIds: ["group-45", "group-14"],
        linkIds: ["portal-45-14"],
        selectionKeys: ["portal:45:14"],
      },
    });
    const diff = diffPolyWorldState(previous, next);
    const plan = planPolyWorldLayers(topology, diff, [
      { id: "render", layer: "render", elementLayers: ["render"] },
      { id: "debug", layer: "debug", tags: ["portal"] },
    ]);
    const snapshot = createPolyWorldPlanDebugSnapshot(diff, plan, {
      appliedState: previous,
      includeEntries: false,
    });

    expect(
      adaptPolyWorldPlanDebugSnapshot(snapshot, (value) => ({
        visibleGroups: value.next.selectedRegionIds,
        selectedPortalKeys: value.next.selectedSelectionKeys,
        mountedElementCount: value.applied?.state.counts.resolvedElements ?? 0,
        hiddenElementCount: value.applied?.missingElementIds.length ?? 0,
        parityClaim: false,
      })),
    ).toEqual({
      visibleGroups: ["group-14", "group-45"],
      selectedPortalKeys: ["portal:45:14"],
      mountedElementCount: 1,
      hiddenElementCount: 2,
      parityClaim: false,
    });
    expect(snapshot.plan.entries).toBeUndefined();
  });

  it("can cap plan entries and id lists while preserving full counts", () => {
    const topology = topologyFixture();
    const previous = createPolyWorldState(topology, {
      selection: { regionIds: ["group-45"] },
    });
    const next = createPolyWorldState(topology, {
      selection: {
        regionIds: ["group-45", "group-14", "group-15"],
        linkIds: ["portal-45-14"],
        selectionKeys: ["portal:45:14"],
        reasons: [{ label: "current" }, { label: "linked" }],
      },
    });
    const diff = diffPolyWorldState(previous, next);
    const plan = planPolyWorldLayers(topology, diff, [
      { id: "render", layer: "render", elementLayers: ["render"] },
      { id: "debug", layer: "debug", tags: ["portal"] },
    ]);
    const snapshot = createPolyWorldPlanDebugSnapshot(diff, plan, {
      planningSelection: {
        regionIds: ["group-45", "group-14", "group-15"],
        linkIds: ["portal-45-14"],
        selectionKeys: ["portal:45:14"],
        elementIds: ["shell-45", "shell-14"],
        reasons: [{ label: "current" }, { label: "linked" }],
      },
      entryLimit: 2,
      listLimit: 1,
      appliedState: previous,
    });

    expect(snapshot.planningSelection?.regionIds).toEqual(["group-45"]);
    expect(snapshot.planningSelection?.counts.regions).toBe(3);
    expect(snapshot.planningSelection?.omitted.regionIds).toBe(2);
    expect(snapshot.planningSelection?.elementIds).toEqual(["shell-45"]);
    expect(snapshot.planningSelection?.counts.elements).toBe(2);
    expect(snapshot.planningSelection?.omitted.elementIds).toBe(1);
    expect(snapshot.next.selectedRegionIds).toEqual(["group-14"]);
    expect(snapshot.next.counts.regions).toBe(3);
    expect(snapshot.next.omitted.selectedRegionIds).toBe(2);
    expect(snapshot.next.reasonLabels).toEqual(["current"]);
    expect(snapshot.next.omitted.reasonLabels).toBe(1);
    expect(snapshot.diff.resolvedElements.added).toEqual(["portal-marker"]);
    expect(snapshot.diff.resolvedElements.counts.added).toBe(3);
    expect(snapshot.diff.resolvedElements.omitted.added).toBe(2);
    expect(snapshot.plan.entryCount).toBe(4);
    expect(snapshot.plan.includedEntryCount).toBe(2);
    expect(snapshot.plan.omittedEntryCount).toBe(2);
    expect(snapshot.applied?.missingElementIds).toEqual(["portal-marker"]);
    expect(snapshot.applied?.counts.missingElementIds).toBe(3);
    expect(snapshot.applied?.omitted.missingElementIds).toBe(2);
  });

  it("summarizes resource readiness in plan debug snapshots", () => {
    const topology = topologyFixture();
    const previous = createPolyWorldState(topology, {
      selection: { regionIds: ["group-45"] },
    });
    const next = createPolyWorldState(topology, {
      selection: { regionIds: ["group-14", "group-15"] },
    });
    const diff = diffPolyWorldState(previous, next);
    const plan = planPolyWorldLayers(topology, diff, [
      { id: "render", layer: "render", elementLayers: ["render"] },
    ]);
    const readiness = summarizePolyWorldResourceReadiness(
      topology,
      next.resolvedElementIds,
      {
        "mesh:shell-14": "ready",
        "texture:shell-14": "stale",
        "mesh:shell-15": "loading",
      },
    );
    const snapshot = createPolyWorldPlanDebugSnapshot(diff, plan, {
      readiness,
      listLimit: 1,
      includeEntries: false,
    });

    expect(snapshot.readiness?.resourceIds).toEqual(["mesh:shell-14"]);
    expect(snapshot.readiness?.readyResourceIds).toEqual(["mesh:shell-14"]);
    expect(snapshot.readiness?.staleResourceIds).toEqual(["texture:shell-14"]);
    expect(snapshot.readiness?.loadingResourceIds).toEqual(["mesh:shell-15"]);
    expect(snapshot.readiness?.renderBlockingResourceIds).toEqual(["mesh:shell-14"]);
    expect(snapshot.readiness?.preloadOnlyResourceIds).toEqual([]);
    expect(snapshot.readiness?.nonBlockingResourceIds).toEqual([]);
    expect(snapshot.readiness?.blockedResourceIds).toEqual(["texture:shell-14"]);
    expect(snapshot.readiness?.blockedElementIds).toEqual(["shell-14"]);
    expect(snapshot.readiness?.counts).toEqual({
      resources: 3,
      readyResources: 1,
      missingResources: 0,
      requestedResources: 0,
      loadingResources: 1,
      failedResources: 0,
      staleResources: 1,
      renderBlockingResources: 3,
      preloadOnlyResources: 0,
      nonBlockingResources: 0,
      blockedResources: 2,
      blockedElements: 2,
    });
    expect(snapshot.readiness?.omitted.renderBlockingResourceIds).toBe(2);
    expect(snapshot.readiness?.omitted.preloadOnlyResourceIds).toBe(0);
    expect(snapshot.readiness?.omitted.nonBlockingResourceIds).toBe(0);
    expect(snapshot.readiness?.omitted.blockedResourceIds).toBe(1);
    expect(snapshot.readiness?.omitted.blockedElementIds).toBe(1);
    expect(snapshot.readiness?.stateCounts).toEqual({
      ready: 1,
      missing: 0,
      requested: 0,
      loading: 1,
      failed: 0,
      stale: 1,
    });
  });
});
