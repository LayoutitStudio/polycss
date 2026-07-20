import { describe, expect, it } from "vitest";
import { resolvePolyWorldPortalActivity, selectPolyWorldPortalRegions } from "../profiles";
import { createPolyWorldTopology } from "../topology";
import {
  adaptPolyWorldPortalDebugSnapshot,
  createPolyWorldPortalDebugSnapshot,
} from "./index";

describe("createPolyWorldPortalDebugSnapshot", () => {
  it("summarizes selected, hidden, closed, and blocked portal rooms", () => {
    const topology = createPolyWorldTopology({
      regions: [
        { id: "studio" },
        { id: "gallery" },
        { id: "vault" },
        { id: "engine" },
      ],
      links: [
        { id: "studio-gallery", fromRegionId: "studio", toRegionId: "gallery", selectionKeys: ["portal:studio-gallery"] },
        { id: "gallery-vault", fromRegionId: "gallery", toRegionId: "vault", selectionKeys: ["portal:gallery-vault"] },
        { id: "gallery-engine", fromRegionId: "gallery", toRegionId: "engine", selectionKeys: ["portal:gallery-engine"] },
      ],
      elements: [
        { id: "studio-shell", regionIds: ["studio"] },
        { id: "gallery-shell", regionIds: ["gallery"] },
        { id: "vault-shell", regionIds: ["vault"] },
        { id: "engine-shell", regionIds: ["engine"] },
      ],
    });
    const selection = selectPolyWorldPortalRegions(topology, {
      currentRegionId: "studio",
      linkedDepth: 2,
      facingLinkIds: ["gallery-vault"],
      visibleRegionIds: ["vault"],
      linkState: {
        "gallery-vault": "closed",
        "gallery-engine": "blocked",
      },
    });
    const activity = resolvePolyWorldPortalActivity(topology, selection, {
      selectedTargetState: "resident",
      activeRegionIds: ["studio"],
      renderedRegionIds: ["gallery"],
      preloadedRegionIds: ["engine"],
    });
    const snapshot = createPolyWorldPortalDebugSnapshot(topology, selection, {
      currentRegionId: "studio",
      activity,
      listLimit: 2,
      metadata: { view: "portal-fpv" },
    });

    expect(snapshot.proof).toMatchObject({
      profile: "area-portals",
      artifactKind: "authored-area-portals",
      sourceKind: "authored-runtime-selection",
      producedBy: "selectPolyWorldPortalRegions",
      counts: {
        regionCount: 4,
        linkCount: 3,
        selectedRegionCount: 3,
        hiddenRegionCount: 1,
        selectedLinkCount: 2,
        hiddenLinkCount: 1,
        closedLinkCount: 1,
        blockedLinkCount: 1,
        facingLinkCount: 1,
      },
    });
    expect(snapshot.proof.guarantees).toContain("authored-region-link-traversal");
    expect(snapshot.proof.guarantees).toContain("closed-blocked-link-state");
    expect(snapshot.proof.knownWeaknesses).toContain("not-compiled-bsp-pvs");
    expect(snapshot.proof.knownWeaknesses).toContain("not-camera-frustum-portal-clipping");
    expect(snapshot.topology).toEqual({ regionCount: 4, linkCount: 3, profile: "area-portals" });
    expect(snapshot.current.regionId).toBe("studio");
    expect(snapshot.regions.selectedRegionIds).toEqual({
      values: ["studio", "gallery"],
      count: 3,
      omitted: 1,
    });
    expect(snapshot.regions.hiddenRegionIds).toEqual({
      values: ["engine"],
      count: 1,
      omitted: 0,
    });
    expect(activity).toEqual({
      selectedRegionIds: ["studio", "gallery", "vault"],
      hiddenRegionIds: ["engine"],
      loadedRegionIds: ["studio", "gallery", "vault"],
      residentRegionIds: ["studio", "gallery", "vault"],
      activeRegionIds: ["studio", "gallery"],
      renderedRegionIds: ["gallery"],
      preloadedRegionIds: ["engine"],
      inactiveRegionIds: ["vault", "engine"],
    });
    expect(snapshot.activity?.residentRegionIds).toEqual({
      values: ["studio", "gallery"],
      count: 3,
      omitted: 1,
    });
    expect(snapshot.activity?.activeRegionIds).toEqual({
      values: ["studio", "gallery"],
      count: 2,
      omitted: 0,
    });
    expect(snapshot.activity?.renderedRegionIds).toEqual({
      values: ["gallery"],
      count: 1,
      omitted: 0,
    });
    expect(snapshot.activity?.preloadedRegionIds).toEqual({
      values: ["engine"],
      count: 1,
      omitted: 0,
    });
    expect(snapshot.activity?.inactiveRegionIds).toEqual({
      values: ["vault", "engine"],
      count: 2,
      omitted: 0,
    });
    expect(snapshot.links.selectedLinkIds).toEqual({
      values: ["studio-gallery", "gallery-vault"],
      count: 2,
      omitted: 0,
    });
    expect(snapshot.links.closedLinkIds).toEqual({
      values: ["gallery-vault"],
      count: 1,
      omitted: 0,
    });
    expect(snapshot.links.blockedLinkIds).toEqual({
      values: ["gallery-engine"],
      count: 1,
      omitted: 0,
    });
    expect(snapshot.links.facingLinkIds.values).toEqual(["gallery-vault"]);
    expect(snapshot.selection.reasonKinds).toEqual({
      blocked: 1,
      closed: 1,
      current: 1,
      facing: 1,
      linked: 1,
      selectionKey: 1,
      visible: 1,
    });
    expect(snapshot.metadata).toEqual({ view: "portal-fpv" });
    expect(
      adaptPolyWorldPortalDebugSnapshot(snapshot, (value) => ({
        visibleRooms: value.regions.selectedRegionIds.count,
        hiddenRooms: value.regions.hiddenRegionIds.count,
        closedLinks: value.links.closedLinkIds.count,
        blockedLinks: value.links.blockedLinkIds.count,
      })),
    ).toEqual({
      visibleRooms: 3,
      hiddenRooms: 1,
      closedLinks: 1,
      blockedLinks: 1,
    });
  });
});
