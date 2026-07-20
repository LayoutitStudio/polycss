import { describe, expect, it } from "vitest";
import { createPolyWorldState, diffPolyWorldState } from "../state";
import { createPolyWorldTopology } from "../topology";
import {
  createPolyWorldResourceLoadSet,
  createPolyWorldResourceReadinessGuards,
  planPolyWorldElementSet,
  planPolyWorldLayers,
  planPolyWorldTransition,
  summarizePolyWorldResourceReadiness,
} from "./index";

function topologyFixture() {
  return createPolyWorldTopology({
    regions: [
      { id: "group-45" },
      { id: "group-14" },
      { id: "group-15", selectionKeys: ["known-empty"] },
    ],
    elements: [
      { id: "shell-45", regionIds: ["group-45"], kind: "mesh", layers: ["render"], tags: ["solid"] },
      { id: "shell-14", regionIds: ["group-14"], kind: "mesh", layers: ["render"], tags: ["solid"] },
      { id: "shell-15", regionIds: ["group-15"], kind: "mesh", layers: ["render"], tags: ["solid"] },
      {
        id: "door-volume",
        regionIds: ["group-45", "group-14"],
        regionMatch: "all",
        kind: "volume",
        layers: ["collision"],
        tags: ["connector"],
      },
      {
        id: "portal-debug",
        selectionKeys: ["portal:45:14"],
        kind: "marker",
        layers: ["debug"],
        tags: ["debug", "portal"],
      },
    ],
  });
}

describe("planPolyWorldLayers", () => {
  it("plans directly from an external visible element set", () => {
    const plan = planPolyWorldElementSet({
      previousElementIds: ["face-4", "face-2", "face-0", "face-2"],
      nextElementIds: ["face-2", "face-1", "face-3"],
      layer: "render",
      policyId: "quake-pvs",
      reasonLabels: ["quake-pvs:e1m1:leaf-42"],
    });

    expect(plan.previousSignature).toBe("elements:face-0|face-2|face-4");
    expect(plan.nextSignature).toBe("elements:face-1|face-2|face-3");
    expect(plan.changed).toBe(true);
    expect(plan.entries.map((entry) => [
      entry.key,
      entry.elementId,
      entry.action,
      entry.reason,
      entry.phase,
      entry.targetState,
      entry.reasonLabels,
    ])).toEqual([
      [
        "quake-pvs:face-0",
        "face-0",
        "hide",
        "removed",
        "cleanup",
        { visible: false, rendered: false },
        ["quake-pvs:e1m1:leaf-42"],
      ],
      [
        "quake-pvs:face-4",
        "face-4",
        "hide",
        "removed",
        "cleanup",
        { visible: false, rendered: false },
        ["quake-pvs:e1m1:leaf-42"],
      ],
      [
        "quake-pvs:face-1",
        "face-1",
        "show",
        "added",
        "render",
        { visible: true, rendered: true },
        ["quake-pvs:e1m1:leaf-42"],
      ],
      [
        "quake-pvs:face-3",
        "face-3",
        "show",
        "added",
        "render",
        { visible: true, rendered: true },
        ["quake-pvs:e1m1:leaf-42"],
      ],
      [
        "quake-pvs:face-2",
        "face-2",
        "retain",
        "retained",
        "render",
        { visible: true, rendered: true },
        ["quake-pvs:e1m1:leaf-42"],
      ],
    ]);
    expect(plan.actionCounts).toEqual({
      show: 2,
      hide: 2,
      retain: 1,
      preload: 0,
      noop: 0,
    });
    expect(plan.layerCounts.render).toEqual(plan.actionCounts);
  });

  it("can plan resident/preload policy from the same external element set vocabulary", () => {
    const plan = planPolyWorldElementSet({
      previousElementIds: ["chunk-1"],
      nextElementIds: ["chunk-1", "chunk-2"],
      layer: "resident",
      policyId: "stream-resident",
      phase: "mount",
      actions: { added: "preload", retained: "retain" },
      targetStates: {
        added: { loaded: true, resident: true, visible: false, rendered: false },
        retained: { loaded: true, resident: true, visible: true, rendered: true },
      },
    });

    expect(plan.entries.map((entry) => [entry.elementId, entry.action, entry.phase, entry.targetState])).toEqual([
      [
        "chunk-2",
        "preload",
        "mount",
        { preloaded: true, loaded: true, resident: true, visible: false, rendered: false },
      ],
      [
        "chunk-1",
        "retain",
        "mount",
        { visible: true, rendered: true, loaded: true, resident: true },
      ],
    ]);
  });

  it("plans different actions for render, collision, and preload layers from one state diff", () => {
    const topology = topologyFixture();
    const previous = createPolyWorldState(topology, {
      selection: { regionIds: ["group-45"], reasons: [{ label: "current-group" }] },
    });
    const next = createPolyWorldState(topology, {
      selection: {
        regionIds: ["group-45", "group-14", "group-15"],
        selectionKeys: ["portal:45:14"],
        reasons: [{ label: "visible-through-portal" }],
      },
    });
    const plan = planPolyWorldLayers(topology, diffPolyWorldState(previous, next), [
      { id: "render", layer: "render", elementLayers: ["render"], tags: ["solid"] },
      { id: "collision", layer: "collision", elementLayers: ["collision"], elementKinds: ["volume"] },
      {
        id: "preload",
        layer: "preload",
        elementLayers: ["render"],
        actions: { added: "preload", retained: "noop" },
      },
    ]);

    expect(plan.entries.map((entry) => [entry.layer, entry.elementId, entry.action, entry.reason])).toEqual([
      ["render", "shell-14", "show", "added"],
      ["render", "shell-15", "show", "added"],
      ["render", "shell-45", "retain", "retained"],
      ["collision", "door-volume", "show", "added"],
      ["preload", "shell-14", "preload", "added"],
      ["preload", "shell-15", "preload", "added"],
      ["preload", "shell-45", "noop", "retained"],
    ]);
    expect(plan.entries[0]?.key).toBe("render:shell-14");
    expect(plan.entries.map((entry) => [entry.elementId, entry.phase, entry.targetState])).toEqual([
      ["shell-14", "render", { visible: true, rendered: true }],
      ["shell-15", "render", { visible: true, rendered: true }],
      ["shell-45", "render", { visible: true, rendered: true }],
      ["door-volume", "render", { visible: true, rendered: true }],
      ["shell-14", "preload", { preloaded: true }],
      ["shell-15", "preload", { preloaded: true }],
      ["shell-45", undefined, {}],
    ]);
    expect(plan.actionCounts).toEqual({
      show: 3,
      hide: 0,
      retain: 1,
      preload: 2,
      noop: 1,
    });
    expect(plan.layerCounts.render.show).toBe(2);
    expect(plan.layerCounts.preload.preload).toBe(2);
  });

  it("keeps debug and persistent elements out of plans unless policies target them", () => {
    const topology = topologyFixture();
    const previous = createPolyWorldState(topology, {
      selection: { regionIds: ["group-45"] },
    });
    const next = createPolyWorldState(topology, {
      selection: { regionIds: ["group-45"], selectionKeys: ["portal:45:14"] },
    });

    expect(
      planPolyWorldLayers(topology, diffPolyWorldState(previous, next), [
        { id: "render", layer: "render", elementLayers: ["render"], tags: ["solid"] },
      ]).entries.map((entry) => entry.elementId),
    ).toEqual(["shell-45"]);

    expect(
      planPolyWorldLayers(topology, diffPolyWorldState(previous, next), [
        { id: "debug", layer: "debug", tags: ["portal"] },
      ]).entries.map((entry) => [entry.elementId, entry.action]),
    ).toEqual([["portal-debug", "show"]]);
  });

  it("can emit summary-only noop plans when no element matches a policy", () => {
    const topology = topologyFixture();
    const previous = createPolyWorldState(topology, {
      selection: { selectionKeys: ["known-empty"], reasons: [{ label: "known-empty-key" }] },
    });
    const next = createPolyWorldState(topology, {
      selection: { selectionKeys: ["known-empty"], reasons: [{ label: "known-empty-key" }] },
    });
    const plan = planPolyWorldLayers(topology, diffPolyWorldState(previous, next), [
      { id: "render", layer: "render", tags: ["missing-tag"], emitNoop: true },
    ]);

    expect(plan.entries).toEqual([
      {
        key: "render:noop",
        policyId: "render",
        layer: "render",
        action: "noop",
        reason: "no-match",
        targetState: {},
        guards: [],
        dependencies: [],
        blocked: false,
        reasonLabels: ["known-empty-key"],
        data: undefined,
      },
    ]);
    expect(plan.actionCounts.noop).toBe(1);
  });

  it("lets policies override target states and phase without changing the action vocabulary", () => {
    const topology = topologyFixture();
    const previous = createPolyWorldState(topology, {
      selection: { regionIds: ["group-45"] },
    });
    const next = createPolyWorldState(topology, {
      selection: { regionIds: ["group-45", "group-14"] },
    });
    const plan = planPolyWorldLayers(topology, diffPolyWorldState(previous, next), [
      {
        id: "resident",
        layer: "resident",
        phase: "mount",
        elementLayers: ["render"],
        actions: { added: "show", retained: "retain", removed: "hide" },
        targetStates: {
          added: { loaded: true, resident: true, visible: false, rendered: false },
          retained: { loaded: true, resident: true, visible: true, rendered: true },
          removed: { resident: false, visible: false, rendered: false },
        },
      },
    ]);

    expect(plan.entries.map((entry) => [entry.elementId, entry.action, entry.phase, entry.targetState])).toEqual([
      [
        "shell-14",
        "show",
        "mount",
        { visible: false, rendered: false, loaded: true, resident: true },
      ],
      [
        "shell-45",
        "retain",
        "mount",
        { visible: true, rendered: true, loaded: true, resident: true },
      ],
    ]);
  });

  it("resolves policy guards and dependencies onto plan entries", () => {
    const topology = topologyFixture();
    const previous = createPolyWorldState(topology, {
      selection: { regionIds: ["group-45"] },
    });
    const next = createPolyWorldState(topology, {
      selection: { regionIds: ["group-45", "group-14"] },
    });
    const plan = planPolyWorldLayers(topology, diffPolyWorldState(previous, next), [
      {
        id: "render",
        layer: "render",
        elementLayers: ["render"],
        guards: ({ elementId }) => [
          {
            id: "asset-ready",
            ok: elementId !== "shell-14",
            message: elementId === "shell-14" ? "Waiting for shell-14 resources." : undefined,
          },
        ],
        dependencies: [{ id: "chunk-root", ok: true }],
      },
    ]);

    expect(plan.entries.map((entry) => [
      entry.elementId,
      entry.blocked,
      entry.guards?.map((guard) => [guard.id, guard.ok, guard.message]),
      entry.dependencies?.map((dependency) => [dependency.id, dependency.ok]),
    ])).toEqual([
      [
        "shell-14",
        true,
        [["asset-ready", false, "Waiting for shell-14 resources."]],
        [["chunk-root", true]],
      ],
      [
        "shell-45",
        false,
        [["asset-ready", true, undefined]],
        [["chunk-root", true]],
      ],
    ]);
  });

  it("plans a state transition from a next selection", () => {
    const topology = topologyFixture();
    const previous = createPolyWorldState(topology, {
      selection: { regionIds: ["group-45"], reasons: [{ label: "current-group" }] },
    });
    const transition = planPolyWorldTransition(topology, {
      previousState: previous,
      selection: { regionIds: ["group-14"], reasons: [{ label: "camera-region" }] },
      policies: [
        { id: "render", layer: "render", elementLayers: ["render"], tags: ["solid"] },
      ],
      debug: { includeEntries: false, listLimit: 2 },
    });

    expect(transition.nextState.selectedRegionIds).toEqual(["group-14"]);
    expect(transition.planningSelection?.regionIds).toEqual(["group-14"]);
    expect(transition.planningSelection?.reasons?.map((reason) => reason.label)).toEqual(["camera-region"]);
    expect(transition.nextState.resolvedElementIds).toEqual(["shell-14"]);
    expect(transition.diff.resolvedElements.added).toEqual(["shell-14"]);
    expect(transition.diff.resolvedElements.removed).toEqual(["shell-45"]);
    expect(transition.plan.actionCounts).toEqual({
      show: 1,
      hide: 1,
      retain: 0,
      preload: 0,
      noop: 0,
    });
    expect(transition.debug?.next.reasonLabels).toEqual(["camera-region"]);
    expect(transition.debug?.planningSelection?.regionIds).toEqual(["group-14"]);
    expect(transition.debug?.planningSelection?.reasonLabels).toEqual(["camera-region"]);
    expect(transition.debug?.plan.entryCount).toBe(2);
    expect(transition.debug?.plan.includedEntryCount).toBe(0);
  });

  it("summarizes resource readiness for transition next-state elements", () => {
    const topology = createPolyWorldTopology({
      regions: [{ id: "old-room" }, { id: "new-room" }],
      elements: [
        { id: "old-shell", regionIds: ["old-room"], layers: ["render"], resourceIds: ["mesh:old"] },
        { id: "new-shell", regionIds: ["new-room"], layers: ["render"], resourceIds: ["mesh:new", "texture:new"] },
      ],
      spatialElements: [
        {
          id: "new-shell-surface",
          elementId: "new-shell",
          regionId: "new-room",
          role: "shell",
          resourceIds: ["lightmap:new"],
          vertices: [
            [0, 0, 0],
            [1, 0, 0],
            [1, 1, 0],
            [0, 1, 0],
          ],
        },
      ],
    });
    const previous = createPolyWorldState(topology, { selection: { regionIds: ["old-room"] } });
    const transition = planPolyWorldTransition(topology, {
      previousState: previous,
      selection: { regionIds: ["new-room"] },
      policies: [{ id: "render", layer: "render", elementLayers: ["render"] }],
      readiness: {
        resources: {
          "mesh:old": "failed",
          "mesh:new": "ready",
          "texture:new": "stale",
          "lightmap:new": "loading",
        },
      },
      debug: { includeEntries: false },
    });

    expect(transition.nextState.resolvedElementIds).toEqual(["new-shell"]);
    expect(transition.readiness?.resourceIds).toEqual(["mesh:new", "texture:new", "lightmap:new"]);
    expect(transition.readiness?.readyResourceIds).toEqual(["mesh:new"]);
    expect(transition.readiness?.staleResourceIds).toEqual(["texture:new"]);
    expect(transition.readiness?.loadingResourceIds).toEqual(["lightmap:new"]);
    expect(transition.readiness?.failedResourceIds).toEqual([]);
    expect(transition.readiness?.blockedResourceIds).toEqual(["texture:new", "lightmap:new"]);
    expect(transition.readiness?.blockedElementIds).toEqual(["new-shell"]);
    expect(transition.debug?.readiness?.blockedResourceIds).toEqual(["texture:new", "lightmap:new"]);
    expect(transition.debug?.readiness?.counts.blockedElements).toBe(1);
  });

  it("can expand transition selections with parent and container roots before planning", () => {
    const topology = createPolyWorldTopology({
      regions: [{ id: "gallery" }],
      elements: [
        { id: "scene-root", selectionKeys: ["root:scene"], layers: ["resident"] },
        {
          id: "gallery-root",
          selectionKeys: ["root:gallery"],
          containerId: "scene-root",
          layers: ["resident"],
        },
        {
          id: "gallery-wall",
          regionIds: ["gallery"],
          parentId: "gallery-root",
          containerId: "gallery-root",
          layers: ["render"],
        },
      ],
    });
    const previous = createPolyWorldState(topology);

    const transition = planPolyWorldTransition(topology, {
      previousState: previous,
      selection: { regionIds: ["gallery"], reasons: [{ label: "view-pvs" }] },
      relations: { reasonLabel: "resident-roots" },
      policies: [
        {
          id: "resident",
          layer: "resident",
          elementLayers: ["resident"],
          phase: "mount",
          targetStates: {
            added: { loaded: true, resident: true, visible: false, rendered: false },
          },
        },
        { id: "render", layer: "render", elementLayers: ["render"] },
      ],
      debug: { includeEntries: true },
    });

    expect(transition.nextState.selectedRegionIds).toEqual(["gallery"]);
    expect(transition.planningSelection?.regionIds).toEqual(["gallery"]);
    expect(transition.planningSelection?.elementIds).toEqual(["scene-root", "gallery-root"]);
    expect(transition.nextState.selectedElementIds).toEqual(["gallery-root", "scene-root"]);
    expect(transition.nextState.reasonLabels).toEqual(["resident-roots", "view-pvs"]);
    expect(transition.debug?.planningSelection?.regionIds).toEqual(["gallery"]);
    expect(transition.debug?.planningSelection?.elementIds).toEqual(["scene-root", "gallery-root"]);
    expect(transition.debug?.planningSelection?.reasonLabels).toEqual(["view-pvs", "resident-roots"]);
    expect(transition.nextState.resolvedElementIds).toEqual(["gallery-root", "gallery-wall", "scene-root"]);
    expect(transition.plan.entries.map((entry) => [
      entry.layer,
      entry.elementId,
      entry.action,
      entry.phase,
      entry.targetState,
    ])).toEqual([
      [
        "resident",
        "gallery-root",
        "show",
        "mount",
        { visible: false, rendered: false, loaded: true, resident: true },
      ],
      [
        "resident",
        "scene-root",
        "show",
        "mount",
        { visible: false, rendered: false, loaded: true, resident: true },
      ],
      ["render", "gallery-wall", "show", "render", { visible: true, rendered: true }],
    ]);
    expect(transition.debug?.next.reasonLabels).toEqual(["resident-roots", "view-pvs"]);
  });

  it("creates resource readiness guards from spatial element resource refs without loading resources", () => {
    const topology = createPolyWorldTopology({
      regions: [{ id: "room" }],
      elements: [
        { id: "room-shell", regionIds: ["room"], layers: ["render"] },
        { id: "room-prop", regionIds: ["room"], layers: ["render"] },
      ],
      spatialElements: [
        {
          id: "room-shell-surface",
          elementId: "room-shell",
          regionId: "room",
          role: "shell",
          resourceIds: ["texture:wall", "mesh:room"],
          vertices: [
            [0, 0, 0],
            [1, 0, 0],
            [1, 1, 0],
            [0, 1, 0],
          ],
        },
        {
          id: "room-prop-surface",
          elementId: "room-prop",
          regionId: "room",
          role: "prop",
          resourceIds: ["mesh:prop"],
          vertices: [
            [0, 0, 1],
            [1, 0, 1],
            [1, 1, 1],
            [0, 1, 1],
          ],
        },
      ],
    });
    const previous = createPolyWorldState(topology, { selection: {} });
    const next = createPolyWorldState(topology, { selection: { regionIds: ["room"] } });
    const plan = planPolyWorldLayers(topology, diffPolyWorldState(previous, next), [
      {
        id: "render",
        layer: "render",
        elementLayers: ["render"],
        guards: createPolyWorldResourceReadinessGuards(topology, {
          "texture:wall": "ready",
          "mesh:room": "loading",
          "mesh:prop": { state: "failed", message: "missing prepared mesh" },
        }),
      },
      {
        id: "preload",
        layer: "preload",
        elementLayers: ["render"],
        actions: { added: "preload" },
        guards: createPolyWorldResourceReadinessGuards(topology, {
          "texture:wall": "loading",
          "mesh:room": "loading",
          "mesh:prop": "requested",
        }),
      },
    ]);

    expect(plan.entries.map((entry) => [entry.layer, entry.elementId, entry.action, entry.blocked])).toEqual([
      ["render", "room-prop", "show", true],
      ["render", "room-shell", "show", true],
      ["preload", "room-prop", "preload", false],
      ["preload", "room-shell", "preload", false],
    ]);
    expect(plan.entries.find((entry) => entry.elementId === "room-shell" && entry.layer === "render")?.guards).toEqual([
      expect.objectContaining({
        id: "resource-ready:texture:wall",
        ok: true,
        data: expect.objectContaining({
          resourceId: "texture:wall",
          state: "ready",
          spatialElementIds: ["room-shell-surface"],
        }),
      }),
      expect.objectContaining({
        id: "resource-ready:mesh:room",
        ok: false,
        message: 'Resource "mesh:room" is loading.',
        data: expect.objectContaining({
          resourceId: "mesh:room",
          state: "loading",
          elementId: "room-shell",
        }),
      }),
    ]);
    expect(plan.entries.find((entry) => entry.elementId === "room-prop" && entry.layer === "render")?.guards).toEqual([
      expect.objectContaining({
        id: "resource-ready:mesh:prop",
        ok: false,
        message: "missing prepared mesh",
      }),
    ]);
    expect(plan.entries.find((entry) => entry.elementId === "room-shell" && entry.layer === "preload")?.guards).toEqual([]);
  });

  it("summarizes direct and spatial resource readiness without loading resources", () => {
    const topology = createPolyWorldTopology({
      regions: [{ id: "room" }],
      elements: [
        {
          id: "room-shell",
          regionIds: ["room"],
          layers: ["render"],
          resourceIds: ["mesh:shell", "texture:shared"],
        },
        {
          id: "room-prop",
          regionIds: ["room"],
          layers: ["render"],
          resourceIds: ["mesh:prop", "sound:ambience"],
        },
      ],
      spatialElements: [
        {
          id: "room-shell-surface",
          elementId: "room-shell",
          regionId: "room",
          role: "shell",
          resourceIds: ["texture:shared", "lightmap:shell"],
          vertices: [
            [0, 0, 0],
            [1, 0, 0],
            [1, 1, 0],
            [0, 1, 0],
          ],
        },
        {
          id: "room-prop-surface",
          elementId: "room-prop",
          regionId: "room",
          role: "prop",
          resourceIds: ["texture:prop"],
          vertices: [
            [0, 0, 1],
            [1, 0, 1],
            [1, 1, 1],
            [0, 1, 1],
          ],
        },
      ],
    });
    const resources = {
      "mesh:shell": "ready",
      "texture:shared": "stale",
      "lightmap:shell": "loading",
      "mesh:prop": { state: "failed", message: "mesh prepare failed" },
      "texture:prop": "requested",
    } as const;
    const summary = summarizePolyWorldResourceReadiness(topology, ["room-shell", "room-prop"], resources);

    expect(summary.resourceIds).toEqual([
      "mesh:shell",
      "texture:shared",
      "lightmap:shell",
      "mesh:prop",
      "sound:ambience",
      "texture:prop",
    ]);
    expect(summary.readyResourceIds).toEqual(["mesh:shell"]);
    expect(summary.staleResourceIds).toEqual(["texture:shared"]);
    expect(summary.loadingResourceIds).toEqual(["lightmap:shell"]);
    expect(summary.failedResourceIds).toEqual(["mesh:prop"]);
    expect(summary.missingResourceIds).toEqual(["sound:ambience"]);
    expect(summary.requestedResourceIds).toEqual(["texture:prop"]);
    expect(summary.blockedResourceIds).toEqual([
      "texture:shared",
      "lightmap:shell",
      "mesh:prop",
      "sound:ambience",
      "texture:prop",
    ]);
    expect(summary.renderBlockingResourceIds).toEqual([
      "mesh:shell",
      "texture:shared",
      "lightmap:shell",
      "mesh:prop",
      "sound:ambience",
      "texture:prop",
    ]);
    expect(summary.preloadOnlyResourceIds).toEqual([]);
    expect(summary.nonBlockingResourceIds).toEqual([]);
    expect(summary.blockedElementIds).toEqual(["room-shell", "room-prop"]);
    expect(summary.elementIdsByResourceState).toEqual({
      ready: ["room-shell"],
      stale: ["room-shell"],
      loading: ["room-shell"],
      failed: ["room-prop"],
      missing: ["room-prop"],
      requested: ["room-prop"],
    });
    expect(summary.records.find((record) => record.resourceId === "texture:shared")).toEqual({
      resourceId: "texture:shared",
      state: "stale",
      elementIds: ["room-shell"],
      spatialElementIds: ["room-shell-surface"],
      renderBlocking: true,
      preloadOnly: false,
    });

    const previous = createPolyWorldState(topology, { selection: {} });
    const next = createPolyWorldState(topology, { selection: { regionIds: ["room"] } });
    const plan = planPolyWorldLayers(topology, diffPolyWorldState(previous, next), [
      {
        id: "render",
        layer: "render",
        elementLayers: ["render"],
        guards: createPolyWorldResourceReadinessGuards(topology, resources),
      },
    ]);

    expect(plan.entries.map((entry) => [entry.elementId, entry.blocked])).toEqual([
      ["room-prop", true],
      ["room-shell", true],
    ]);
    expect(plan.entries.find((entry) => entry.elementId === "room-shell")?.guards).toEqual([
      expect.objectContaining({
        id: "resource-ready:mesh:shell",
        ok: true,
        data: expect.objectContaining({
          elementIds: ["room-shell"],
          spatialElementIds: [],
        }),
      }),
      expect.objectContaining({
        id: "resource-ready:texture:shared",
        ok: false,
        message: 'Resource "texture:shared" is stale.',
        data: expect.objectContaining({
          state: "stale",
          elementIds: ["room-shell"],
          spatialElementIds: ["room-shell-surface"],
        }),
      }),
      expect.objectContaining({
        id: "resource-ready:lightmap:shell",
        ok: false,
        message: 'Resource "lightmap:shell" is loading.',
      }),
    ]);
  });

  it("uses declaration metadata for render-blocking and preload-only resource readiness", () => {
    const topology = createPolyWorldTopology({
      regions: [{ id: "room" }],
      elements: [
        { id: "room-shell", regionIds: ["room"], layers: ["render"] },
        { id: "room-prop", regionIds: ["room"], layers: ["render"] },
      ],
      spatialElements: [
        {
          id: "room-prop-surface",
          elementId: "room-prop",
          regionId: "room",
          role: "prop",
          vertices: [
            [0, 0, 0],
            [1, 0, 0],
            [1, 1, 0],
          ],
        },
      ],
    });
    const resourceDeclarations = [
      {
        id: "mesh:shell",
        state: "loading",
        renderBlocking: true,
        elementIds: ["room-shell"],
      },
      {
        id: "texture:prop-preview",
        state: "requested",
        renderBlocking: false,
        spatialElementIds: ["room-prop-surface"],
      },
      {
        id: "audio:ambience",
        state: "missing",
        preloadOnly: true,
        elementIds: ["room-shell", "room-prop"],
      },
    ] as const;
    const summary = summarizePolyWorldResourceReadiness(topology, ["room-shell", "room-prop"], {}, {
      resourceDeclarations,
    });

    expect(summary.resourceIds).toEqual(["mesh:shell", "texture:prop-preview", "audio:ambience"]);
    expect(summary.loadingResourceIds).toEqual(["mesh:shell"]);
    expect(summary.requestedResourceIds).toEqual(["texture:prop-preview"]);
    expect(summary.missingResourceIds).toEqual(["audio:ambience"]);
    expect(summary.renderBlockingResourceIds).toEqual(["mesh:shell"]);
    expect(summary.preloadOnlyResourceIds).toEqual(["audio:ambience"]);
    expect(summary.nonBlockingResourceIds).toEqual(["texture:prop-preview", "audio:ambience"]);
    expect(summary.blockedResourceIds).toEqual(["mesh:shell"]);
    expect(summary.blockedElementIds).toEqual(["room-shell"]);
    expect(summary.records.find((record) => record.resourceId === "texture:prop-preview")).toEqual({
      resourceId: "texture:prop-preview",
      state: "requested",
      elementIds: ["room-prop"],
      spatialElementIds: ["room-prop-surface"],
      renderBlocking: false,
      preloadOnly: false,
    });

    const previous = createPolyWorldState(topology, { selection: {} });
    const next = createPolyWorldState(topology, { selection: { regionIds: ["room"] } });
    const plan = planPolyWorldLayers(topology, diffPolyWorldState(previous, next), [
      {
        id: "render",
        layer: "render",
        elementLayers: ["render"],
        guards: createPolyWorldResourceReadinessGuards(topology, {}, { resourceDeclarations }),
      },
    ]);

    expect(plan.entries.map((entry) => [entry.elementId, entry.blocked])).toEqual([
      ["room-prop", false],
      ["room-shell", true],
    ]);
    expect(plan.entries.find((entry) => entry.elementId === "room-prop")?.guards).toEqual([
      expect.objectContaining({
        id: "resource-ready:texture:prop-preview",
        ok: true,
        data: expect.objectContaining({
          renderBlocking: false,
          preloadOnly: false,
        }),
      }),
      expect.objectContaining({
        id: "resource-ready:audio:ambience",
        ok: true,
        data: expect.objectContaining({
          renderBlocking: false,
          preloadOnly: true,
        }),
      }),
    ]);
    expect(plan.entries.find((entry) => entry.elementId === "room-shell")?.guards).toEqual([
      expect.objectContaining({
        id: "resource-ready:mesh:shell",
        ok: false,
      }),
      expect.objectContaining({
        id: "resource-ready:audio:ambience",
        ok: true,
      }),
    ]);
  });

  it("summarizes resource load sets without taking ownership of loading", () => {
    const topology = createPolyWorldTopology({
      regions: [{ id: "old-room" }, { id: "new-room" }],
      elements: [
        { id: "old-shell", regionIds: ["old-room"], layers: ["render"], resourceIds: ["mesh:old", "texture:shared"] },
        {
          id: "new-shell",
          regionIds: ["new-room"],
          layers: ["render"],
          resourceIds: ["mesh:new", "texture:shared", "texture:new", "mesh:missing"],
        },
      ],
    });
    const previous = createPolyWorldState(topology, { selection: { regionIds: ["old-room"] } });
    const next = createPolyWorldState(topology, { selection: { regionIds: ["new-room"] } });
    const resources = {
      "mesh:old": "ready",
      "texture:shared": "ready",
      "mesh:new": "ready",
      "texture:new": "stale",
    } as const;
    const resourceDeclarations = [
      {
        id: "texture:preview",
        state: "requested",
        renderBlocking: false,
        elementIds: ["new-shell"],
      },
      {
        id: "audio:ambience",
        state: "requested",
        preloadOnly: true,
        elementIds: ["new-shell"],
      },
    ] as const;

    const loadSet = createPolyWorldResourceLoadSet(topology, {
      previousElementIds: previous.resolvedElementIds,
      nextElementIds: next.resolvedElementIds,
      resources,
      readyStates: ["ready", "stale"],
      resourceDeclarations,
    });

    expect(loadSet.previousResourceIds).toEqual(["mesh:old", "texture:shared"]);
    expect(loadSet.nextResourceIds).toEqual([
      "mesh:new",
      "texture:shared",
      "texture:new",
      "mesh:missing",
      "texture:preview",
      "audio:ambience",
    ]);
    expect(loadSet.requestResourceIds).toEqual(["mesh:missing", "texture:preview", "audio:ambience"]);
    expect(loadSet.retainResourceIds).toEqual(["texture:shared"]);
    expect(loadSet.releaseCandidateResourceIds).toEqual(["mesh:old"]);
    expect(loadSet.readyButNotVisibleResourceIds).toEqual(["mesh:old"]);
    expect(loadSet.preloadOnlyResourceIds).toEqual(["audio:ambience"]);
    expect(loadSet.renderBlockingResourceIds).toEqual(["mesh:new", "texture:shared", "texture:new", "mesh:missing"]);
    expect(loadSet.staleAllowedResourceIds).toEqual(["texture:new"]);
    expect(loadSet.nonBlockingResourceIds).toEqual(["texture:preview", "audio:ambience"]);
    expect(loadSet.blockedResourceIds).toEqual(["mesh:missing"]);
    expect(loadSet.blockedElementIds).toEqual(["new-shell"]);

    const transition = planPolyWorldTransition(topology, {
      previousState: previous,
      selection: { regionIds: ["new-room"] },
      policies: [{ id: "render", layer: "render", elementLayers: ["render"] }],
      readiness: {
        resources,
        readyStates: ["ready", "stale"],
        resourceDeclarations,
      },
      debug: { includeEntries: false, listLimit: 3 },
    });

    expect(transition.readiness?.resourceIds).toEqual(loadSet.nextResourceIds);
    expect(transition.readiness?.staleResourceIds).toEqual(["texture:new"]);
    expect(transition.readiness?.blockedResourceIds).toEqual(["mesh:missing"]);
    expect(transition.loadSet?.requestResourceIds).toEqual(loadSet.requestResourceIds);
    expect(transition.loadSet?.releaseCandidateResourceIds).toEqual(["mesh:old"]);
    expect(transition.debug?.loadSet?.requestResourceIds).toEqual(["mesh:missing", "texture:preview", "audio:ambience"]);
    expect(transition.debug?.loadSet?.counts).toMatchObject({
      requestResources: 3,
      retainResources: 1,
      releaseCandidateResources: 1,
      staleAllowedResources: 1,
      blockedElements: 1,
    });
  });
});
