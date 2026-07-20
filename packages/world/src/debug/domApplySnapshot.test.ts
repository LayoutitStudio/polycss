import { describe, expect, it } from "vitest";
import { applyPolyWorldDomPlan, createPolyWorldDomRegistry } from "../dom";
import {
  adaptPolyWorldDomApplyDebugSnapshot,
  createPolyWorldDomApplyDebugSnapshot,
} from "./index";
import type { PolyWorldDomElementLike, PolyWorldDomParentLike } from "../dom";

class FakeElement implements PolyWorldDomElementLike {
  parentNode: FakeParent | null = null;

  constructor(readonly id: string) {}

  remove(): void {
    this.parentNode?.removeChild(this);
  }
}

class FakeParent implements PolyWorldDomParentLike<FakeElement> {
  readonly children: FakeElement[] = [];

  insertBefore(element: FakeElement, before: FakeElement | null): void {
    this.removeChild(element);
    const index = before === null ? -1 : this.children.indexOf(before);
    if (index === -1) this.children.push(element);
    else this.children.splice(index, 0, element);
    element.parentNode = this;
  }

  removeChild(element: FakeElement): void {
    const index = this.children.indexOf(element);
    if (index !== -1) this.children.splice(index, 1);
    if (element.parentNode === this) element.parentNode = null;
  }
}

describe("createPolyWorldDomApplyDebugSnapshot", () => {
  it("summarizes apply status counts and app-owned debug adapters without DOM reads", () => {
    const parent = new FakeParent();
    const group45 = new FakeElement("group-45");
    parent.insertBefore(group45, null);
    const registry = createPolyWorldDomRegistry([
      { elementId: "group-14", element: new FakeElement("group-14"), parent, nextElementId: "group-45" },
      { elementId: "group-45", element: group45, parent, mounted: true },
      { elementId: "blocked", element: new FakeElement("blocked") },
      { elementId: "guarded", element: new FakeElement("guarded"), parent },
    ]);
    const result = applyPolyWorldDomPlan(registry, [
      planEntry("render:group-14", "group-14", "show"),
      planEntry("render:group-45", "group-45", "retain"),
      planEntry("render:missing", "missing", "show"),
      planEntry("render:blocked", "blocked", "show"),
      {
        ...planEntry("render:guarded", "guarded", "show"),
        guards: [{ id: "ready", ok: false, message: "Resource is not ready." }],
      },
      planEntry("preload:group-45", "group-45", "preload"),
    ]);
    const snapshot = createPolyWorldDomApplyDebugSnapshot(result, {
      metadata: { view: "product" },
    });

    expect(snapshot.apply.counts).toEqual({
      added: 1,
      hidden: 0,
      removed: 0,
      retained: 1,
      noop: 0,
      missing: 1,
      blocked: 2,
      unsupported: 1,
      changed: 1,
      mounted: 2,
    });
    expect(snapshot.plan.actionCounts).toEqual({
      show: 4,
      hide: 0,
      retain: 1,
      preload: 1,
      noop: 0,
    });
    expect(snapshot.apply.missingElementIds).toEqual(["missing"]);
    expect(snapshot.apply.plannedElementIds).toEqual(["blocked", "group-14", "group-45", "guarded", "missing"]);
    expect(snapshot.apply.addedElementIds).toEqual(["group-14"]);
    expect(snapshot.apply.retainedElementIds).toEqual(["group-45"]);
    expect(snapshot.apply.changedElementIds).toEqual(["group-14"]);
    expect(snapshot.apply.blockedElementIds).toEqual(["blocked", "guarded"]);
    expect(snapshot.apply.mountBlockedElementIds).toEqual(["blocked"]);
    expect(snapshot.apply.guardFailureElementIds).toEqual(["guarded"]);
    expect(snapshot.apply.dependencyFailureElementIds).toEqual([]);
    expect(snapshot.apply.unsupportedElementIds).toEqual(["group-45"]);
    expect(snapshot.apply.mountedElementIds).toEqual(["group-14", "group-45"]);
    expect(snapshot.entries?.map((entry) => [entry.elementId, entry.status])).toEqual([
      ["group-14", "added"],
      ["group-45", "retained"],
      ["missing", "missing"],
      ["blocked", "blocked"],
      ["guarded", "blocked"],
      ["group-45", "unsupported"],
    ]);
    expect(snapshot.entries?.map((entry) => [entry.elementId, entry.phase, entry.targetState])).toEqual([
      ["group-14", "render", { visible: true, rendered: true }],
      ["group-45", "render", { visible: true, rendered: true }],
      ["missing", "render", { visible: true, rendered: true }],
      ["blocked", "render", { visible: true, rendered: true }],
      ["guarded", "render", { visible: true, rendered: true }],
      ["group-45", "preload", { preloaded: true }],
    ]);
    expect(snapshot.entries?.find((entry) => entry.elementId === "guarded")?.failedGuards).toEqual([
      { id: "ready", ok: false, message: "Resource is not ready." },
    ]);
    expect(snapshot.metadata).toEqual({ view: "product" });

    expect(
      adaptPolyWorldDomApplyDebugSnapshot(snapshot, (value) => ({
        visibleGroups: value.apply.mountedElementIds,
        mountedLeafCount: value.apply.counts.mounted,
        hiddenLeafCount: value.apply.counts.removed + value.apply.counts.missing,
        blockedLeafCount: value.apply.blockedElementIds.length,
        mountBlockedLeafCount: value.apply.mountBlockedElementIds.length,
        guardBlockedCount: value.apply.guardFailureElementIds.length,
      })),
    ).toEqual({
      visibleGroups: ["group-14", "group-45"],
      mountedLeafCount: 2,
      hiddenLeafCount: 1,
      blockedLeafCount: 2,
      mountBlockedLeafCount: 1,
      guardBlockedCount: 1,
    });
  });

  it("can omit per-entry detail for compact render-visibility debug", () => {
    const parent = new FakeParent();
    const track = new FakeElement("track-1");
    parent.insertBefore(track, null);
    const registry = createPolyWorldDomRegistry([
      { elementId: "track-1", element: track, parent, mounted: true, sourceIds: ["track:1"] },
    ]);
    const result = applyPolyWorldDomPlan(registry, [
      planEntry("track:track-1", "track-1", "retain"),
    ]);
    const snapshot = createPolyWorldDomApplyDebugSnapshot(result, {
      includeEntries: false,
      metadata: { policy: "source-track-window" },
    });

    expect(snapshot.entries).toBeUndefined();
    expect(snapshot.apply.counts.retained).toBe(1);
    expect(snapshot.metadata).toEqual({ policy: "source-track-window" });
  });

  it("can cap entries and element id lists while preserving counts", () => {
    const parent = new FakeParent();
    const leafA = new FakeElement("leaf-a");
    const leafB = new FakeElement("leaf-b");
    const leafC = new FakeElement("leaf-c");
    parent.insertBefore(leafA, null);
    parent.insertBefore(leafB, null);
    parent.insertBefore(leafC, null);
    const registry = createPolyWorldDomRegistry([
      { elementId: "leaf-a", element: leafA, parent, mounted: true },
      { elementId: "leaf-b", element: leafB, parent, mounted: true },
      { elementId: "leaf-c", element: leafC, parent, mounted: true },
    ]);
    const result = applyPolyWorldDomPlan(
      registry,
      [
        planEntry("render:leaf-b", "leaf-b", "hide"),
        planEntry("render:leaf-c", "leaf-c", "hide"),
        planEntry("render:leaf-a", "leaf-a", "retain"),
        planEntry("render:missing", "missing", "show"),
      ],
      { hideMode: "hidden" },
    );
    const snapshot = createPolyWorldDomApplyDebugSnapshot(result, {
      entryLimit: 2,
      listLimit: 1,
    });

    expect(snapshot.plan.entryCount).toBe(4);
    expect(snapshot.plan.includedEntryCount).toBe(2);
    expect(snapshot.plan.omittedEntryCount).toBe(2);
    expect(snapshot.entries?.map((entry) => entry.elementId)).toEqual(["leaf-b", "leaf-c"]);
    expect(snapshot.apply.counts.hidden).toBe(2);
    expect(snapshot.apply.plannedElementIds).toEqual(["leaf-a"]);
    expect(snapshot.apply.hiddenAppliedElementIds).toEqual(["leaf-b"]);
    expect(snapshot.apply.retainedElementIds).toEqual(["leaf-a"]);
    expect(snapshot.apply.changedElementIds).toEqual(["leaf-b"]);
    expect(snapshot.apply.mountedElementIds).toEqual(["leaf-a"]);
    expect(snapshot.apply.hiddenElementIds).toEqual(["leaf-b"]);
    expect(snapshot.apply.omitted.mountedElementIds).toBe(2);
    expect(snapshot.apply.omitted.hiddenElementIds).toBe(1);
    expect(snapshot.apply.omitted.plannedElementIds).toBe(3);
    expect(snapshot.apply.omitted.hiddenAppliedElementIds).toBe(1);
    expect(snapshot.apply.omitted.changedElementIds).toBe(1);
    expect(snapshot.apply.missingElementIds).toEqual(["missing"]);
    expect(snapshot.apply.mountBlockedElementIds).toEqual([]);
  });
});

function planEntry(key: string, elementId: string, action: "show" | "hide" | "retain" | "preload" | "noop") {
  const targetState = action === "show" || action === "retain"
    ? { visible: true, rendered: true }
    : action === "hide"
      ? { visible: false, rendered: false }
      : action === "preload"
        ? { preloaded: true }
        : {};
  const phase = action === "show" || action === "retain"
    ? "render"
    : action === "hide"
      ? "cleanup"
      : action === "preload"
        ? "preload"
        : undefined;
  return {
    key,
    policyId: "render",
    layer: "render",
    elementId,
    action,
    reason: action === "hide" ? "removed" : "added",
    ...(phase === undefined ? {} : { phase }),
    targetState,
    reasonLabels: [],
  } as const;
}
