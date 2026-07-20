import { describe, expect, it } from "vitest";
import { planPolyWorldBspVisibilityFrame } from "../profiles";
import { planPolyWorldElementSet, planPolyWorldLayers } from "../planner";
import { createPolyWorldState, diffPolyWorldState } from "../state";
import { createPolyWorldPartitionGalleryFixture } from "../testing/fixtures";
import { createPolyWorldTopology } from "../topology";
import {
  PolyWorldDomRegistryError,
  applyPolyWorldDomPlan,
  createPolyWorldDomRegistry,
} from "./index";
import type { PolyWorldDomElementLike, PolyWorldDomParentLike } from "./index";

class FakeElement implements PolyWorldDomElementLike {
  parentNode: FakeParent | null = null;
  hidden = false;
  readonly attributes = new Map<string, string>();

  constructor(readonly id: string) {}

  remove(): void {
    this.parentNode?.removeChild(this);
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }

  removeAttribute(name: string): void {
    this.attributes.delete(name);
  }
}

class FakeParent implements PolyWorldDomParentLike<FakeElement> {
  readonly children: FakeElement[] = [];

  insertBefore(element: FakeElement, before: FakeElement | null): void {
    this.removeChild(element);
    const index = before === null ? -1 : this.children.indexOf(before);
    if (index === -1) {
      this.children.push(element);
    } else {
      this.children.splice(index, 0, element);
    }
    element.parentNode = this;
  }

  removeChild(element: FakeElement): void {
    const index = this.children.indexOf(element);
    if (index !== -1) this.children.splice(index, 1);
    if (element.parentNode === this) element.parentNode = null;
  }

  ids(): string[] {
    return this.children.map((element) => element.id);
  }
}

describe("createPolyWorldDomRegistry", () => {
  it("registers DOM-like records and indexes element, source, alias, layer, and tag lookups", () => {
    const parent = new FakeParent();
    const shell45 = new FakeElement("shell-45");
    parent.insertBefore(shell45, null);

    const registry = createPolyWorldDomRegistry([
      {
        elementId: "shell-45",
        element: shell45,
        parent,
        sourceIds: ["face:45", "face:45"],
        aliases: ["group:45"],
        layers: ["render"],
        tags: ["solid", "visible"],
      },
      {
        elementId: "portal-debug",
        element: new FakeElement("portal-debug"),
        sourceIds: ["portal:45:14"],
        aliases: ["portal:45:14"],
        layers: ["debug"],
        tags: ["portal"],
      },
    ]);

    expect(registry.getByElementId("shell-45")?.mounted).toBe(true);
    expect(registry.getByElementId("shell-45")?.sourceIds).toEqual(["face:45"]);
    expect(registry.getBySourceId("face:45").map((record) => record.elementId)).toEqual(["shell-45"]);
    expect(registry.getByAlias("group:45").map((record) => record.elementId)).toEqual(["shell-45"]);
    expect(registry.getByLayer("render").map((record) => record.elementId)).toEqual(["shell-45"]);
    expect(registry.getByTag("portal").map((record) => record.elementId)).toEqual(["portal-debug"]);
    expect(registry.mountedElementIds()).toEqual(["shell-45"]);
  });

  it("rejects duplicate element ids but lets update replace a record and rebuild indexes", () => {
    const registry = createPolyWorldDomRegistry([
      {
        elementId: "track-1",
        element: new FakeElement("track-1"),
        sourceIds: ["source:old"],
        layers: ["old"],
      },
    ]);

    expect(() =>
      registry.register({
        elementId: "track-1",
        element: new FakeElement("track-1-copy"),
      }),
    ).toThrow(PolyWorldDomRegistryError);

    registry.update({
      elementId: "track-1",
      element: new FakeElement("track-1-next"),
      sourceIds: ["source:new"],
      layers: ["render"],
    });

    expect(registry.getBySourceId("source:old")).toEqual([]);
    expect(registry.getBySourceId("source:new").map((record) => record.elementId)).toEqual(["track-1"]);
    expect(registry.getByLayer("old")).toEqual([]);
    expect(registry.getByLayer("render").map((record) => record.elementId)).toEqual(["track-1"]);
  });
});

describe("applyPolyWorldDomPlan", () => {
  it("applies external BSP/PVS face visibility without requiring a topology graph", () => {
    const parent = new FakeParent();
    const face0 = new FakeElement("face-0");
    const face1 = new FakeElement("face-1");
    const face2 = new FakeElement("face-2");
    const face3 = new FakeElement("face-3");
    const face4 = new FakeElement("face-4");
    parent.insertBefore(face0, null);
    parent.insertBefore(face2, null);
    parent.insertBefore(face4, null);
    const registry = createPolyWorldDomRegistry([
      {
        elementId: "face-0",
        element: face0,
        parent,
        mounted: true,
        nextElementId: "face-1",
        sourceIds: ["quake-face:0"],
        layers: ["render"],
        tags: ["quake-leaf", "world"],
      },
      {
        elementId: "face-1",
        element: face1,
        parent,
        previousElementId: "face-0",
        nextElementId: "face-2",
        sourceIds: ["quake-face:1"],
        layers: ["render"],
        tags: ["quake-leaf", "world"],
      },
      {
        elementId: "face-2",
        element: face2,
        parent,
        mounted: true,
        previousElementId: "face-1",
        nextElementId: "face-3",
        sourceIds: ["quake-face:2"],
        layers: ["render"],
        tags: ["quake-leaf", "world"],
      },
      {
        elementId: "face-3",
        element: face3,
        parent,
        previousElementId: "face-2",
        nextElementId: "face-4",
        sourceIds: ["quake-face:3"],
        layers: ["render"],
        tags: ["quake-leaf", "world"],
      },
      {
        elementId: "face-4",
        element: face4,
        parent,
        mounted: true,
        previousElementId: "face-3",
        sourceIds: ["quake-face:4"],
        layers: ["render"],
        tags: ["quake-leaf", "world"],
      },
    ]);
    const plan = planPolyWorldElementSet({
      previousElementIds: ["face-0", "face-2", "face-4"],
      nextElementIds: ["face-1", "face-2", "face-3"],
      policyId: "quake-pvs",
      reasonLabels: ["quake-pvs:e1m1:leaf-42"],
    });

    const result = applyPolyWorldDomPlan(registry, plan);

    expect(parent.ids()).toEqual(["face-1", "face-2", "face-3"]);
    expect(result.entries.map((entry) => [entry.elementId, entry.action, entry.status, entry.reasonLabels])).toEqual([
      ["face-0", "hide", "removed", ["quake-pvs:e1m1:leaf-42"]],
      ["face-4", "hide", "removed", ["quake-pvs:e1m1:leaf-42"]],
      ["face-1", "show", "added", ["quake-pvs:e1m1:leaf-42"]],
      ["face-3", "show", "added", ["quake-pvs:e1m1:leaf-42"]],
      ["face-2", "retain", "retained", ["quake-pvs:e1m1:leaf-42"]],
    ]);
    expect(result.removedElementIds).toEqual(["face-0", "face-4"]);
    expect(result.addedElementIds).toEqual(["face-1", "face-3"]);
    expect(result.retainedElementIds).toEqual(["face-2"]);
    expect(result.mountedElementIds).toEqual(["face-1", "face-2", "face-3"]);
  });

  it("applies portal-room visibility with stable prepared order", () => {
    const topology = createPolyWorldTopology({
      regions: [
        { id: "group-45" },
        { id: "group-14" },
        { id: "group-15" },
      ],
      elements: [
        { id: "shell-14", regionIds: ["group-14"], layers: ["render"], tags: ["solid"] },
        { id: "shell-15", regionIds: ["group-15"], layers: ["render"], tags: ["solid"] },
        { id: "shell-45", regionIds: ["group-45"], layers: ["render"], tags: ["solid"] },
      ],
    });
    const previous = createPolyWorldState(topology, { selection: { regionIds: ["group-45"] } });
    const next = createPolyWorldState(topology, {
      selection: { regionIds: ["group-45", "group-14", "group-15"] },
    });
    const plan = planPolyWorldLayers(topology, diffPolyWorldState(previous, next), [
      { id: "render", layer: "render", elementLayers: ["render"] },
    ]);

    const parent = new FakeParent();
    const shell14 = new FakeElement("shell-14");
    const shell15 = new FakeElement("shell-15");
    const shell45 = new FakeElement("shell-45");
    parent.insertBefore(shell45, null);
    const registry = createPolyWorldDomRegistry([
      {
        elementId: "shell-14",
        element: shell14,
        parent,
        previousElementId: undefined,
        nextElementId: "shell-15",
        sourceIds: ["group:14"],
        layers: ["render"],
        tags: ["solid"],
      },
      {
        elementId: "shell-15",
        element: shell15,
        parent,
        previousElementId: "shell-14",
        nextElementId: "shell-45",
        sourceIds: ["group:15"],
        layers: ["render"],
        tags: ["solid"],
      },
      {
        elementId: "shell-45",
        element: shell45,
        parent,
        mounted: true,
        previousElementId: "shell-15",
        sourceIds: ["group:45"],
        layers: ["render"],
        tags: ["solid"],
      },
    ]);

    const result = applyPolyWorldDomPlan(registry, plan);

    expect(parent.ids()).toEqual(["shell-14", "shell-15", "shell-45"]);
    expect(result.entries.map((entry) => [entry.elementId, entry.action, entry.status])).toEqual([
      ["shell-14", "show", "added"],
      ["shell-15", "show", "added"],
      ["shell-45", "retain", "retained"],
    ]);
    expect(result.counts).toEqual({
      added: 2,
      hidden: 0,
      removed: 0,
      retained: 1,
      noop: 0,
      missing: 0,
      blocked: 0,
      unsupported: 0,
      changed: 2,
      mounted: 3,
    });
    expect(result.actionCounts).toEqual({
      show: 2,
      hide: 0,
      retain: 1,
      preload: 0,
      noop: 0,
    });
    expect(result.plannedElementIds).toEqual(["shell-14", "shell-15", "shell-45"]);
    expect(result.addedElementIds).toEqual(["shell-14", "shell-15"]);
    expect(result.retainedElementIds).toEqual(["shell-45"]);
    expect(result.changedElementIds).toEqual(["shell-14", "shell-15"]);
    expect(result.mountedElementIds).toEqual(["shell-14", "shell-15", "shell-45"]);
    expect(shell14.hidden).toBe(false);
    expect(shell15.hidden).toBe(false);
  });

  it("removes hidden elements and keeps retained elements mounted", () => {
    const topology = createPolyWorldTopology({
      regions: [
        { id: "group-45" },
        { id: "group-14" },
        { id: "group-15" },
      ],
      elements: [
        { id: "shell-14", regionIds: ["group-14"], layers: ["render"] },
        { id: "shell-15", regionIds: ["group-15"], layers: ["render"] },
        { id: "shell-45", regionIds: ["group-45"], layers: ["render"] },
      ],
    });
    const previous = createPolyWorldState(topology, {
      selection: { regionIds: ["group-45", "group-14", "group-15"] },
    });
    const next = createPolyWorldState(topology, { selection: { regionIds: ["group-45"] } });
    const plan = planPolyWorldLayers(topology, diffPolyWorldState(previous, next), [
      { id: "render", layer: "render", elementLayers: ["render"] },
    ]);
    const parent = new FakeParent();
    const shell14 = new FakeElement("shell-14");
    const shell15 = new FakeElement("shell-15");
    const shell45 = new FakeElement("shell-45");
    parent.insertBefore(shell14, null);
    parent.insertBefore(shell15, null);
    parent.insertBefore(shell45, null);
    const registry = createPolyWorldDomRegistry([
      { elementId: "shell-14", element: shell14, parent, mounted: true, layers: ["render"] },
      { elementId: "shell-15", element: shell15, parent, mounted: true, layers: ["render"] },
      { elementId: "shell-45", element: shell45, parent, mounted: true, layers: ["render"] },
    ]);

    const result = applyPolyWorldDomPlan(registry, plan);

    expect(parent.ids()).toEqual(["shell-45"]);
    expect(result.entries.map((entry) => [entry.elementId, entry.action, entry.status, entry.mounted])).toEqual([
      ["shell-14", "hide", "removed", false],
      ["shell-15", "hide", "removed", false],
      ["shell-45", "retain", "retained", true],
    ]);
    expect(result.counts.removed).toBe(2);
    expect(result.counts.mounted).toBe(1);
    expect(result.removedElementIds).toEqual(["shell-14", "shell-15"]);
    expect(result.retainedElementIds).toEqual(["shell-45"]);
    expect(result.changedElementIds).toEqual(["shell-14", "shell-15"]);
    expect(shell14.hidden).toBe(true);
    expect(shell14.attributes.get("hidden")).toBe("");
    expect(shell15.hidden).toBe(true);
  });

  it("can hide elements without detaching prepared DOM elements", () => {
    const topology = createPolyWorldTopology({
      regions: [
        { id: "region-road" },
        { id: "region-overlay" },
      ],
      elements: [
        { id: "road-leaf", regionIds: ["region-road"], layers: ["render"], tags: ["prepared-leaf"] },
        { id: "overlay-leaf", regionIds: ["region-overlay"], layers: ["render"], tags: ["prepared-leaf"] },
      ],
    });
    const previous = createPolyWorldState(topology, {
      selection: { regionIds: ["region-road", "region-overlay"] },
    });
    const next = createPolyWorldState(topology, { selection: { regionIds: ["region-road"] } });
    const plan = planPolyWorldLayers(topology, diffPolyWorldState(previous, next), [
      { id: "prepared-leaves", layer: "render", elementLayers: ["render"], tags: ["prepared-leaf"] },
    ]);
    const parent = new FakeParent();
    const road = new FakeElement("road-leaf");
    const overlay = new FakeElement("overlay-leaf");
    parent.insertBefore(road, null);
    parent.insertBefore(overlay, null);
    const registry = createPolyWorldDomRegistry([
      { elementId: "road-leaf", element: road, parent, mounted: true, layers: ["render"], tags: ["prepared-leaf"] },
      { elementId: "overlay-leaf", element: overlay, parent, mounted: true, layers: ["render"], tags: ["prepared-leaf"] },
    ]);

    const hiddenResult = applyPolyWorldDomPlan(registry, plan, { hideMode: "hidden" });

    expect(parent.ids()).toEqual(["road-leaf", "overlay-leaf"]);
    expect(hiddenResult.entries.map((entry) => [entry.elementId, entry.action, entry.status, entry.mounted])).toEqual([
      ["overlay-leaf", "hide", "hidden", true],
      ["road-leaf", "retain", "retained", true],
    ]);
    expect(hiddenResult.counts.hidden).toBe(1);
    expect(hiddenResult.counts.removed).toBe(0);
    expect(hiddenResult.counts.mounted).toBe(2);
    expect(hiddenResult.counts.changed).toBe(1);
    expect(hiddenResult.mountedElementIds).toEqual(["road-leaf", "overlay-leaf"]);
    expect(hiddenResult.hiddenElementIds).toEqual(["overlay-leaf"]);
    expect(overlay.hidden).toBe(true);
    expect(overlay.attributes.get("hidden")).toBe("");

    const restoredPlan = planPolyWorldLayers(topology, diffPolyWorldState(next, previous), [
      { id: "prepared-leaves", layer: "render", elementLayers: ["render"], tags: ["prepared-leaf"] },
    ]);
    const restoredResult = applyPolyWorldDomPlan(registry, restoredPlan, { hideMode: "hidden" });

    expect(parent.ids()).toEqual(["road-leaf", "overlay-leaf"]);
    expect(restoredResult.entries.map((entry) => [entry.elementId, entry.action, entry.status, entry.mounted])).toEqual([
      ["overlay-leaf", "show", "retained", true],
      ["road-leaf", "retain", "retained", true],
    ]);
    expect(restoredResult.counts.changed).toBe(1);
    expect(restoredResult.hiddenElementIds).toEqual([]);
    expect(overlay.hidden).toBe(false);
    expect(overlay.attributes.has("hidden")).toBe(false);
  });

  it("applies chunk-window visibility while app-owned dynamic records stay out of plan policy", () => {
    const topology = createPolyWorldTopology({
      regions: [
        { id: "chunk-1" },
        { id: "chunk-2" },
        { id: "chunk-3" },
      ],
      elements: [
        { id: "track-1", regionIds: ["chunk-1"], layers: ["render"], tags: ["source-track"], sourceIds: ["track:1"] },
        { id: "track-2", regionIds: ["chunk-2"], layers: ["render"], tags: ["source-track"], sourceIds: ["track:2"] },
        { id: "track-3", regionIds: ["chunk-3"], layers: ["render"], tags: ["source-track"], sourceIds: ["track:3"] },
        { id: "car", regionIds: ["chunk-2"], layers: ["dynamic"], tags: ["dynamic"] },
        { id: "sky", regionIds: ["chunk-2"], layers: ["persistent"], tags: ["persistent"] },
      ],
    });
    const previous = createPolyWorldState(topology, { selection: { regionIds: ["chunk-1"] } });
    const next = createPolyWorldState(topology, {
      selection: { regionIds: ["chunk-1", "chunk-2", "chunk-3"] },
    });
    const plan = planPolyWorldLayers(topology, diffPolyWorldState(previous, next), [
      { id: "track-window", layer: "render", elementLayers: ["render"], tags: ["source-track"] },
    ]);
    const parent = new FakeParent();
    const track1 = new FakeElement("track-1");
    const track2 = new FakeElement("track-2");
    const track3 = new FakeElement("track-3");
    const car = new FakeElement("car");
    parent.insertBefore(track1, null);
    parent.insertBefore(car, null);
    const registry = createPolyWorldDomRegistry([
      {
        elementId: "track-1",
        element: track1,
        parent,
        mounted: true,
        nextElementId: "track-2",
        sourceIds: ["track:1"],
        layers: ["render"],
        tags: ["source-track"],
      },
      {
        elementId: "track-2",
        element: track2,
        parent,
        previousElementId: "track-1",
        nextElementId: "track-3",
        sourceIds: ["track:2"],
        layers: ["render"],
        tags: ["source-track"],
      },
      {
        elementId: "track-3",
        element: track3,
        parent,
        previousElementId: "track-2",
        sourceIds: ["track:3"],
        layers: ["render"],
        tags: ["source-track"],
      },
      { elementId: "car", element: car, parent, mounted: true, layers: ["dynamic"], tags: ["dynamic"] },
      { elementId: "sky", element: new FakeElement("sky"), layers: ["persistent"], tags: ["persistent"] },
    ]);

    const result = applyPolyWorldDomPlan(registry, plan);

    expect(result.entries.map((entry) => [entry.elementId, entry.action, entry.status])).toEqual([
      ["track-2", "show", "added"],
      ["track-3", "show", "added"],
      ["track-1", "retain", "retained"],
    ]);
    expect(parent.ids()).toEqual(["track-1", "car", "track-2", "track-3"]);
    expect(registry.getBySourceId("track:2").map((record) => record.elementId)).toEqual(["track-2"]);
    expect(result.mountedElementIds).toEqual(["track-1", "track-2", "track-3", "car"]);
    expect(result.entries.some((entry) => entry.elementId === "car")).toBe(false);
    expect(result.entries.some((entry) => entry.elementId === "sky")).toBe(false);
  });

  it("reports missing, blocked, and unsupported preload entries without mutation", () => {
    const blocked = new FakeElement("blocked");
    const mounted = new FakeElement("mounted");
    const parent = new FakeParent();
    parent.insertBefore(mounted, null);
    const registry = createPolyWorldDomRegistry([
      { elementId: "blocked", element: blocked },
      { elementId: "mounted", element: mounted, parent, mounted: true },
    ]);

    const result = applyPolyWorldDomPlan(registry, [
      planEntry("missing", "show"),
      planEntry("missing-noop", "noop"),
      planEntry("blocked", "show"),
      planEntry("mounted", "preload"),
      planEntry("mounted", "noop"),
      {
        key: "summary:noop",
        policyId: "summary",
        layer: "summary",
        action: "noop",
        reason: "no-match",
        reasonLabels: [],
      },
    ]);

    expect(parent.ids()).toEqual(["mounted"]);
    expect(result.entries.map((entry) => [
      entry.elementId,
      entry.action,
      entry.status,
      entry.mounted,
      entry.message,
    ])).toEqual([
      ["missing", "show", "missing", false, "No DOM record is registered for this element."],
      ["missing-noop", "noop", "missing", false, "No DOM record is registered for this element."],
      ["blocked", "show", "blocked", false, "Cannot mount record without a parent."],
      ["mounted", "preload", "unsupported", true, "preload is not applied by the DOM layer."],
      ["mounted", "noop", "noop", true, undefined],
      [undefined, "noop", "noop", false, undefined],
    ]);
    expect(result.counts).toEqual({
      added: 0,
      hidden: 0,
      removed: 0,
      retained: 0,
      noop: 2,
      missing: 2,
      blocked: 1,
      unsupported: 1,
      changed: 0,
      mounted: 1,
    });
    expect(result.actionCounts).toEqual({
      show: 2,
      hide: 0,
      retain: 0,
      preload: 1,
      noop: 3,
    });
    expect(result.missingElementIds).toEqual(["missing", "missing-noop"]);
    expect(result.blockedElementIds).toEqual(["blocked"]);
    expect(result.mountBlockedElementIds).toEqual(["blocked"]);
    expect(result.unsupportedElementIds).toEqual(["mounted"]);
  });

  it("blocks guarded and dependency-gated entries without mutating DOM records", () => {
    const guarded = new FakeElement("guarded");
    const dependent = new FakeElement("dependent");
    const parent = new FakeParent();
    const registry = createPolyWorldDomRegistry([
      { elementId: "guarded", element: guarded, parent },
      { elementId: "dependent", element: dependent, parent },
    ]);

    const result = applyPolyWorldDomPlan(registry, [
      {
        ...planEntry("guarded", "show"),
        guards: [
          { id: "asset-ready", ok: false, message: "Texture group is not ready." },
        ],
      },
      {
        ...planEntry("dependent", "show"),
        dependencies: [
          { id: "parent-mounted", ok: false, message: "Chunk root is not mounted." },
        ],
      },
    ]);

    expect(parent.ids()).toEqual([]);
    expect(result.entries.map((entry) => [
      entry.elementId,
      entry.status,
      entry.message,
      entry.failedGuards.map((guard) => guard.id),
      entry.failedDependencies.map((dependency) => dependency.id),
    ])).toEqual([
      ["guarded", "blocked", "Plan entry guard failed.", ["asset-ready"], []],
      ["dependent", "blocked", "Plan entry dependency failed.", [], ["parent-mounted"]],
    ]);
    expect(result.blockedElementIds).toEqual(["dependent", "guarded"]);
    expect(result.mountBlockedElementIds).toEqual([]);
    expect(result.guardFailureElementIds).toEqual(["guarded"]);
    expect(result.dependencyFailureElementIds).toEqual(["dependent"]);
    expect(result.mountedElementIds).toEqual([]);
  });

  it("applies partition-gallery BSP frames while retaining shared structure and hiding detail", () => {
    const fixture = createPolyWorldPartitionGalleryFixture();
    const parent = new FakeParent();
    const registry = createPolyWorldDomRegistry(fixture.topology.elements.map((element) => ({
      elementId: element.id,
      element: new FakeElement(element.id),
      parent,
      layers: element.layers,
      tags: element.tags,
    })));
    const previousState = createPolyWorldState(fixture.topology);
    const policies = [{ id: "render-world", layer: "world", elementLayers: ["world"] }];

    const westFrame = planPolyWorldBspVisibilityFrame(fixture.topology, fixture.tree, {
      previousState,
      policies,
      leafId: "gallery",
      point: fixture.points.gallery,
      forward: fixture.points.westView,
      up: [0, 0, 1],
      aspect: 1,
      fovDegrees: 68,
      projection: "xy",
      includeTrace: true,
      surfaces: fixture.surfaces,
    });
    const westApply = applyPolyWorldDomPlan(registry, westFrame.plan, { hideMode: "hidden" });

    expect(westApply.addedElementIds).toEqual(expect.arrayContaining([
      "gallery-floor-element",
      "studio-floor-element",
      "studio-prop-element",
    ]));
    expect(westApply.removedElementIds).toEqual([]);

    const eastFrame = planPolyWorldBspVisibilityFrame(fixture.topology, fixture.tree, {
      previousState: westFrame.nextState,
      policies,
      leafId: "gallery",
      point: fixture.points.gallery,
      forward: fixture.points.eastView,
      up: [0, 0, 1],
      aspect: 1,
      fovDegrees: 68,
      projection: "xy",
      includeTrace: true,
      surfaces: fixture.surfaces,
    });
    const eastApply = applyPolyWorldDomPlan(registry, eastFrame.plan, { hideMode: "hidden" });

    expect(eastApply.retainedElementIds).toEqual(expect.arrayContaining([
      "gallery-floor-element",
      "gallery-ceiling-element",
    ]));
    expect(eastApply.addedElementIds).toEqual(expect.arrayContaining([
      "vault-floor-element",
      "vault-ceiling-element",
    ]));
    expect(eastApply.hiddenAppliedElementIds).toEqual(expect.arrayContaining([
      "studio-prop-element",
    ]));
    expect(eastApply.removedElementIds).toEqual([]);
    expect(eastApply.hiddenElementIds).toEqual(expect.arrayContaining([
      "studio-prop-element",
    ]));
    expect(eastApply.mountedElementIds).toEqual(expect.arrayContaining([
      "gallery-floor-element",
      "studio-prop-element",
      "vault-floor-element",
    ]));
  });
});

function planEntry(elementId: string, action: "show" | "hide" | "retain" | "preload" | "noop") {
  return {
    key: `render:${elementId}:${action}`,
    policyId: "render",
    layer: "render",
    elementId,
    action,
    reason: action === "hide" ? "removed" : "added",
    reasonLabels: [],
  } as const;
}
