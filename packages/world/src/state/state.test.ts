import { describe, expect, it } from "vitest";
import {
  createPolyWorldTopology,
  resolvePolyWorldElements,
} from "../topology";
import {
  createPolyWorldState,
  diffPolyWorldState,
  snapshotPolyWorldState,
} from "./index";

function groupTopology() {
  return createPolyWorldTopology({
    regions: [
      { id: "group-45", selectionKeys: ["group:45"] },
      { id: "group-14", selectionKeys: ["group:14"] },
      { id: "group-15", selectionKeys: ["group:15"] },
      { id: "group-36", selectionKeys: ["group:36"] },
    ],
    links: [
      {
        id: "portal-45-14",
        fromRegionId: "group-45",
        toRegionId: "group-14",
        selectionKeys: ["portal:45:0:14"],
      },
    ],
    elements: [
      { id: "shell-45", regionIds: ["group-45"], layers: ["render"], tags: ["solid"] },
      { id: "shell-14", regionIds: ["group-14"], layers: ["render"], tags: ["solid"] },
      { id: "shell-15", regionIds: ["group-15"], layers: ["render"], tags: ["solid"] },
      { id: "portal-marker", selectionKeys: ["portal:45:0:14"], layers: ["debug"], tags: ["portal"] },
      {
        id: "shared-door-volume",
        regionIds: ["group-45", "group-14"],
        regionMatch: "all",
        layers: ["render", "collision"],
        tags: ["connector"],
      },
    ],
  });
}

describe("createPolyWorldState", () => {
  it("normalizes selection and resolution into deterministic state signatures", () => {
    const topology = groupTopology();
    const selection = {
      regionIds: ["group-14", "group-45", "group-14"],
      selectionKeys: ["group:45", "portal:45:0:14"],
      reasons: [{ label: "front-facing-portal" }],
    };
    const resolution = resolvePolyWorldElements(topology, selection);
    const a = createPolyWorldState(topology, { id: "product", selection, resolution });
    const b = createPolyWorldState(topology, { id: "rear-view", selection, resolution });

    expect(a.selectedRegionIds).toEqual(["group-14", "group-45"]);
    expect(a.selectedSelectionKeys).toEqual(["group:45", "portal:45:0:14"]);
    expect(a.resolvedElementIds).toEqual(["portal-marker", "shared-door-volume", "shell-14", "shell-45"]);
    expect(a.layers).toEqual(["collision", "debug", "render"]);
    expect(a.reasonLabels).toEqual(["front-facing-portal"]);
    expect(a.unresolved.selectionKeys).toEqual([]);
    expect(a.signature).toBe(b.signature);
    expect(a.id).toBe("product");
    expect(b.id).toBe("rear-view");
  });

  it("preserves known topology keys that do not resolve elements without marking them unresolved", () => {
    const topology = groupTopology();
    const state = createPolyWorldState(topology, {
      selection: {
        selectionKeys: ["group:36"],
      },
    });

    expect(state.selectedSelectionKeys).toEqual(["group:36"]);
    expect(state.resolvedElementIds).toEqual([]);
    expect(state.unresolved.selectionKeys).toEqual([]);
  });

  it("copies state snapshots so callers can keep independent applied states", () => {
    const topology = groupTopology();
    const state = createPolyWorldState(topology, {
      selection: { regionIds: ["group-45"] },
      data: { owner: "product" },
    });
    const snapshot = snapshotPolyWorldState(state);

    expect(snapshot).toEqual(state);
    expect(snapshot.selectedRegionIds).not.toBe(state.selectedRegionIds);
    expect(snapshot.unresolved).not.toBe(state.unresolved);
  });
});

describe("diffPolyWorldState", () => {
  it("diffs group and portal shaped selections into added, removed, and retained ids", () => {
    const topology = groupTopology();
    const previous = createPolyWorldState(topology, {
      selection: { regionIds: ["group-45"] },
    });
    const next = createPolyWorldState(topology, {
      selection: {
        regionIds: ["group-45", "group-14", "group-15"],
        linkIds: ["portal-45-14"],
        selectionKeys: ["portal:45:0:14"],
      },
    });
    const diff = diffPolyWorldState(previous, next);

    expect(diff.changed).toBe(true);
    expect(diff.regions).toEqual({
      added: ["group-14", "group-15"],
      removed: [],
      retained: ["group-45"],
    });
    expect(diff.links.added).toEqual(["portal-45-14"]);
    expect(diff.selectionKeys.added).toEqual(["portal:45:0:14"]);
    expect(diff.resolvedElements).toEqual({
      added: ["portal-marker", "shared-door-volume", "shell-14", "shell-15"],
      removed: [],
      retained: ["shell-45"],
    });
    expect(diff.previousSignature).toBe(previous.signature);
    expect(diff.nextSignature).toBe(next.signature);
  });

  it("reports unchanged states as retained-only diffs", () => {
    const topology = groupTopology();
    const state = createPolyWorldState(topology, {
      selection: { regionIds: ["group-45"] },
    });
    const diff = diffPolyWorldState(state, createPolyWorldState(topology, {
      selection: { regionIds: ["group-45"] },
    }));

    expect(diff.changed).toBe(false);
    expect(diff.resolvedElements).toEqual({
      added: [],
      removed: [],
      retained: ["shell-45"],
    });
  });
});
