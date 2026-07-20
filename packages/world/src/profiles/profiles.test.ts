import { describe, expect, it } from "vitest";
import { createPolyWorldBspDebugSnapshot, createPolyWorldPortalFlowDebugSnapshot } from "../debug";
import {
  createPolyWorldChunkTrackFixture,
  createPolyWorldExactPvsFixture,
  createPolyWorldFakeRoomGraphFixture,
  createPolyWorldPartitionGalleryFixture,
} from "../testing/fixtures";
import { createPolyWorldTopology, resolvePolyWorldElements } from "../topology";
import { createPolyWorldState } from "../state";
import {
  auditPolyWorldProfileArtifactProof,
  bakePolyWorldBspPvs,
  certifyPolyWorldBspTopology,
  compilePolyWorldBrushBsp,
  compilePolyWorldBsp,
  compilePolyWorldPolygonBsp,
  createPolyWorldBspTree,
  createPolyWorldChunkTree,
  createPolyWorldProfileArtifactBundle,
  createPolyWorldProfileArtifactProof,
  decodePolyWorldBspPvsLeafIds,
  decodePolyWorldBspPvsPortalIds,
  PolyWorldBspError,
  PolyWorldChunkTreeError,
  planPolyWorldBspVisibilityFrame,
  planPolyWorldChunkStreamingFrame,
  planPolyWorldPortalFlowFrame,
  planPolyWorldPortalFrame,
  resolvePolyWorldBspBakedPvs,
  resolvePolyWorldBspLeaf,
  resolvePolyWorldBspPvs,
  resolvePolyWorldBspViewSurfaceElements,
  resolvePolyWorldBspViewPvs,
  resolvePolyWorldBspVisibility,
  resolvePolyWorldChunkTreeTraversal,
  resolvePolyWorldPortalFlow,
  selectPolyWorldBspPvs,
  selectPolyWorldBspViewPvs,
  selectPolyWorldChunkStreaming,
  selectPolyWorldChunkStreamingState,
  selectPolyWorldChunkWindow,
  selectPolyWorldPortalRegions,
  summarizePolyWorldBspTopologyProof,
  tracePolyWorldBspViewPvs,
  type PolyWorldBspChild,
  type PolyWorldBspNode,
  type PolyWorldBspPortal,
} from "./index";

describe("selectPolyWorldPortalRegions", () => {
  it("canonicalizes profile artifact kind/source and strips forbidden BSP guarantees", () => {
    const portalProof = createPolyWorldProfileArtifactProof({
      profile: "portal-flow",
      artifactKind: "compiled-bsp-pvs",
      sourceKind: "compiled",
      producedBy: "test",
      guarantees: [
        "authored-region-link-traversal",
        "pvs-metadata-decode-audit",
        "tree-root-leaf-reference-audit",
      ],
    });
    const areaPortalProof = createPolyWorldProfileArtifactProof({
      profile: "area-portals",
      artifactKind: "compiled-bsp-pvs",
      sourceKind: "compiled",
      producedBy: "test",
      guarantees: [
        "authored-region-link-traversal",
        "camera-frustum-portal-clipping",
        "view-clipped-pvs-traversal",
      ],
    });
    const chunkProof = createPolyWorldProfileArtifactProof({
      profile: "chunk-traversal",
      artifactKind: "compiled-bsp-pvs",
      sourceKind: "authored",
      producedBy: "test",
      guarantees: [
        "working-set-state-reporting",
        "portal-clipped-baked-pvs",
        "view-clipped-pvs-traversal",
      ],
    });

    expect(portalProof).toMatchObject({
      profile: "portal-flow",
      artifactKind: "authored-area-portal-flow",
      sourceKind: "authored-runtime-selection",
      guarantees: ["authored-region-link-traversal"],
    });
    expect(portalProof.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      "poly-world-profile-artifact-kind-mismatch",
      "poly-world-profile-artifact-source-kind-mismatch",
      "poly-world-profile-artifact-forbidden-guarantee",
      "poly-world-profile-artifact-forbidden-guarantee",
    ]);
    expect(portalProof.diagnostics.map((diagnostic) => diagnostic.id).filter(Boolean)).toEqual([
      "pvs-metadata-decode-audit",
      "tree-root-leaf-reference-audit",
    ]);
    expect(areaPortalProof).toMatchObject({
      profile: "area-portals",
      artifactKind: "authored-area-portals",
      sourceKind: "authored-runtime-selection",
      guarantees: ["authored-region-link-traversal"],
    });
    expect(areaPortalProof.diagnostics.map((diagnostic) => diagnostic.id).filter(Boolean)).toEqual([
      "camera-frustum-portal-clipping",
      "view-clipped-pvs-traversal",
    ]);
    expect(chunkProof).toMatchObject({
      profile: "chunk-traversal",
      artifactKind: "chunk-working-set",
      sourceKind: "authored-runtime-selection",
      guarantees: ["working-set-state-reporting"],
    });
    expect(chunkProof.diagnostics.map((diagnostic) => diagnostic.id).filter(Boolean)).toEqual([
      "portal-clipped-baked-pvs",
      "view-clipped-pvs-traversal",
    ]);
    expect(auditPolyWorldProfileArtifactProof(portalProof)).toEqual({
      schemaVersion: 1,
      profile: "portal-flow",
      valid: true,
      diagnostics: [],
    });
    expect(auditPolyWorldProfileArtifactProof(areaPortalProof)).toEqual({
      schemaVersion: 1,
      profile: "area-portals",
      valid: true,
      diagnostics: [],
    });
    expect(auditPolyWorldProfileArtifactProof(chunkProof)).toEqual({
      schemaVersion: 1,
      profile: "chunk-traversal",
      valid: true,
      diagnostics: [],
    });
  });

  it("audits forged profile proof envelopes that overclaim reference guarantees", () => {
    const canonical = createPolyWorldProfileArtifactProof({
      profile: "portal-flow",
      artifactKind: "authored-area-portal-flow",
      sourceKind: "authored-runtime-selection",
      producedBy: "test",
      guarantees: ["authored-region-link-traversal", "camera-frustum-portal-clipping"],
      counts: { portalCount: 2 },
      coverage: { traceCoverage: 1 },
    });
    const forgedPortal = {
      ...canonical,
      artifactKind: "compiled-bsp-pvs",
      sourceKind: "compiled",
      guarantees: [...canonical.guarantees, "view-clipped-pvs-traversal"],
      counts: { ...canonical.counts, badCount: Number.NaN },
      coverage: { ...canonical.coverage, badCoverage: Number.POSITIVE_INFINITY },
    } as typeof canonical;
    const uncertifiedBsp = createPolyWorldProfileArtifactProof({
      profile: "bsp-pvs",
      artifactKind: "compiled-bsp-pvs",
      sourceKind: "compiled",
      producedBy: "test",
      guarantees: ["compiled-bsp-pvs"],
      knownWeaknesses: ["bsp-certification-failed"],
    });

    expect(auditPolyWorldProfileArtifactProof(canonical).valid).toBe(true);
    expect(auditPolyWorldProfileArtifactProof(forgedPortal)).toMatchObject({
      profile: "portal-flow",
      valid: false,
      diagnostics: [
        expect.objectContaining({ code: "poly-world-profile-artifact-kind-mismatch" }),
        expect.objectContaining({ code: "poly-world-profile-artifact-source-kind-mismatch" }),
        expect.objectContaining({
          code: "poly-world-profile-artifact-forbidden-guarantee",
          id: "view-clipped-pvs-traversal",
        }),
        expect.objectContaining({
          code: "poly-world-profile-artifact-nonfinite-counts",
          id: "badCount",
        }),
        expect.objectContaining({
          code: "poly-world-profile-artifact-nonfinite-coverage",
          id: "badCoverage",
        }),
      ],
    });
    expect(auditPolyWorldProfileArtifactProof(uncertifiedBsp)).toMatchObject({
      profile: "bsp-pvs",
      valid: false,
      diagnostics: [
        expect.objectContaining({
          code: "poly-world-profile-artifact-uncertified-bsp-guarantees",
        }),
      ],
    });
  });

  it("binds document artifact refs to audited profile proofs before frames trust them", () => {
    const fixture = createPolyWorldPartitionGalleryFixture();
    const artifactRef = fixture.documentInput.profileArtifacts?.[0];
    if (artifactRef === undefined) throw new Error("Missing partition-gallery artifact ref.");
    const proof = summarizePolyWorldBspTopologyProof(fixture.tree).artifact;
    const bundle = createPolyWorldProfileArtifactBundle({
      entries: [
        {
          ref: artifactRef,
          proof,
        },
      ],
    });

    expect(bundle.valid).toBe(true);
    expect(bundle.diagnostics).toEqual([]);
    expect(bundle.entries.map((entry) => entry.id)).toEqual(["partition-gallery-bsp"]);
    expect(bundle.entriesById.get("partition-gallery-bsp")).toMatchObject({
      valid: true,
      ref: {
        profile: "bsp-pvs",
        artifactKind: "compiled-bsp-pvs",
        sourceKind: "compiled",
      },
      proof: {
        profile: "bsp-pvs",
        artifactKind: "compiled-bsp-pvs",
        sourceKind: "compiled",
      },
      audit: {
        valid: true,
      },
    });
    expect(bundle.entryIdsByProfile.get("bsp-pvs")).toEqual(["partition-gallery-bsp"]);
    expect(bundle.entriesById.get("partition-gallery-bsp")?.proof.guarantees)
      .toContain("portal-clipped-baked-pvs");
  });

  it("rejects artifact bundles when document refs do not match the proof they are handed", () => {
    const fakeGraph = createPolyWorldFakeRoomGraphFixture();
    const exactPvs = createPolyWorldExactPvsFixture();
    const artifactRef = fakeGraph.documentInput.profileArtifacts?.[0];
    if (artifactRef === undefined) throw new Error("Missing fake graph artifact ref.");
    const proof = summarizePolyWorldBspTopologyProof(exactPvs.tree).artifact;
    const bundle = createPolyWorldProfileArtifactBundle({
      entries: [
        {
          id: "fake-portal-flow",
          ref: artifactRef,
          proof,
        },
        {
          id: "fake-portal-flow",
          ref: artifactRef,
          proof,
        },
      ],
    });

    expect(bundle.valid).toBe(false);
    expect(bundle.entriesById.get("fake-portal-flow")?.valid).toBe(false);
    expect(bundle.entryIdsByProfile.get("bsp-pvs")).toEqual(["fake-portal-flow", "fake-portal-flow"]);
    expect(bundle.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: "poly-world-profile-artifact-bundle-profile-mismatch",
        id: "fake-portal-flow",
      }),
      expect.objectContaining({
        code: "poly-world-profile-artifact-bundle-kind-mismatch",
        id: "fake-portal-flow",
      }),
      expect.objectContaining({
        code: "poly-world-profile-artifact-bundle-source-kind-mismatch",
        id: "fake-portal-flow",
      }),
      expect.objectContaining({
        code: "poly-world-profile-artifact-bundle-producer-mismatch",
        id: "fake-portal-flow",
      }),
      expect.objectContaining({
        code: "poly-world-profile-artifact-bundle-duplicate-id",
        id: "fake-portal-flow",
      }),
    ]));
  });

  it("selects current, linked, app-visible, and facing-link regions with diagnostic reasons", () => {
    const topology = createPolyWorldTopology({
      regions: [
        { id: "start", selectionKeys: ["faces:start"] },
        { id: "bend", selectionKeys: ["faces:bend"] },
        { id: "vault", selectionKeys: ["faces:vault"] },
        { id: "sky", selectionKeys: ["faces:sky"] },
      ],
      links: [
        { id: "start-bend", fromRegionId: "start", toRegionId: "bend", selectionKeys: ["portal:start-bend"] },
        { id: "bend-vault", fromRegionId: "bend", toRegionId: "vault", selectionKeys: ["portal:bend-vault"] },
      ],
      elements: [
        { id: "start-world", regionIds: ["start"], layers: ["world"] },
        { id: "bend-world", regionIds: ["bend"], layers: ["world"] },
        { id: "vault-keyed-faces", selectionKeys: ["faces:vault"], layers: ["world"] },
        { id: "two-region-door", regionIds: ["start", "bend"], regionMatch: "all", layers: ["world"] },
        { id: "sky-faces", selectionKeys: ["faces:sky"], layers: ["sky"] },
      ],
    });

    const selection = selectPolyWorldPortalRegions(topology, {
      currentRegionId: "start",
      visibleRegionIds: ["vault"],
      facingLinkIds: ["bend-vault"],
      reasonLabels: {
        current: "camera-region",
        linked: "connected-region",
        visible: "source-visible-region",
        facing: "facing-link",
      },
    });
    const resolution = resolvePolyWorldElements(topology, selection);

    expect(selection.regionIds).toEqual(["start", "bend", "vault"]);
    expect(selection.linkIds).toEqual(["start-bend", "bend-vault"]);
    expect(selection.selectionKeys).toEqual([
      "portal:start-bend",
      "portal:bend-vault",
      "faces:start",
      "faces:bend",
      "faces:vault",
    ]);
    expect(selection.reasons?.map((reason) => reason.label)).toEqual([
      "camera-region",
      "connected-region",
      "source-visible-region",
      "facing-link",
      "selection-key",
    ]);
    expect(resolution.elementIds).toEqual([
      "start-world",
      "bend-world",
      "vault-keyed-faces",
      "two-region-door",
    ]);
  });

  it("keeps closed and blocked room links out of linked traversal while reporting diagnostics", () => {
    const topology = createPolyWorldTopology({
      regions: [
        { id: "studio", selectionKeys: ["faces:studio"] },
        { id: "gallery", selectionKeys: ["faces:gallery"] },
        { id: "vault", selectionKeys: ["faces:vault"] },
        { id: "engine", selectionKeys: ["faces:engine"] },
      ],
      links: [
        { id: "studio-gallery", fromRegionId: "studio", toRegionId: "gallery", selectionKeys: ["portal:studio-gallery"] },
        { id: "gallery-vault", fromRegionId: "gallery", toRegionId: "vault", selectionKeys: ["portal:gallery-vault"] },
        { id: "gallery-engine", fromRegionId: "gallery", toRegionId: "engine", selectionKeys: ["portal:gallery-engine"] },
      ],
      elements: [
        { id: "studio-shell", regionIds: ["studio"], layers: ["world"] },
        { id: "gallery-shell", regionIds: ["gallery"], layers: ["world"] },
        { id: "vault-shell", regionIds: ["vault"], layers: ["world"] },
        { id: "engine-shell", regionIds: ["engine"], layers: ["world"] },
        { id: "gallery-vault-frame", selectionKeys: ["portal:gallery-vault"], layers: ["world"] },
      ],
    });

    const selection = selectPolyWorldPortalRegions(topology, {
      currentRegionId: "studio",
      linkedDepth: 2,
      linkState: {
        "gallery-vault": "closed",
        "gallery-engine": "blocked",
      },
    });
    const resolution = resolvePolyWorldElements(topology, selection);
    const forced = selectPolyWorldPortalRegions(topology, {
      currentRegionId: "studio",
      linkedDepth: 2,
      includeClosedLinks: true,
      linkState: () => "closed",
    });

    expect(selection.regionIds).toEqual(["studio", "gallery"]);
    expect(selection.linkIds).toEqual(["studio-gallery"]);
    expect(selection.selectionKeys).toEqual(["portal:studio-gallery", "faces:studio", "faces:gallery"]);
    expect(selection.reasons?.map((reason) => [reason.kind, reason.linkIds])).toEqual([
      ["current", undefined],
      ["linked", ["studio-gallery"]],
      ["closed", ["gallery-vault"]],
      ["blocked", ["gallery-engine"]],
      ["selectionKey", undefined],
    ]);
    expect(resolution.elementIds).toEqual(["studio-shell", "gallery-shell"]);
    expect(forced.regionIds).toEqual(["studio", "gallery", "vault", "engine"]);
    expect(forced.linkIds).toEqual(["studio-gallery", "gallery-vault", "gallery-engine"]);
  });

  it("merges an external visibility selection into authored portal selection", () => {
    const topology = createPolyWorldTopology({
      regions: [
        { id: "studio", selectionKeys: ["faces:studio"] },
        { id: "vault", selectionKeys: ["faces:vault"] },
      ],
      elements: [
        { id: "studio-shell", regionIds: ["studio"], layers: ["world"] },
        { id: "vault-marker", selectionKeys: ["marker:vault"], layers: ["debug"] },
      ],
    });

    const selection = selectPolyWorldPortalRegions(topology, {
      currentRegionId: "studio",
      includeLinked: false,
      visibilitySelection: {
        regionIds: ["vault"],
        selectionKeys: ["marker:vault"],
        elementIds: ["vault-marker"],
        reasons: [
          {
            id: "bsp-view",
            kind: "viewPvs",
            label: "bsp-view",
            regionIds: ["vault"],
          },
        ],
      },
      reasonLabels: {
        visibilitySelection: "external-visible",
      },
    });
    const resolution = resolvePolyWorldElements(topology, selection);

    expect(selection.regionIds).toEqual(["studio", "vault"]);
    expect(selection.selectionKeys).toEqual(["marker:vault", "faces:studio", "faces:vault"]);
    expect(selection.elementIds).toEqual(["vault-marker"]);
    expect(selection.reasons?.map((reason) => [reason.kind, reason.label])).toEqual([
      ["current", "current"],
      ["viewPvs", "bsp-view"],
      ["visibilitySelection", "external-visible"],
      ["selectionKey", "selection-key"],
    ]);
    expect(resolution.elementIds).toEqual(["studio-shell", "vault-marker"]);
  });

  it("plans a portal frame from rendered activity while keeping selected and activity debug separate", () => {
    const topology = createPolyWorldTopology({
      regions: [
        { id: "studio", selectionKeys: ["faces:studio"] },
        { id: "gallery", selectionKeys: ["faces:gallery"] },
        { id: "vault", selectionKeys: ["faces:vault"] },
      ],
      links: [
        { id: "studio-gallery", fromRegionId: "studio", toRegionId: "gallery" },
        { id: "gallery-vault", fromRegionId: "gallery", toRegionId: "vault" },
      ],
      elements: [
        { id: "resident-root", selectionKeys: ["root:resident"], layers: ["resident"] },
        {
          id: "studio-shell",
          regionIds: ["studio"],
          selectionKeys: ["faces:studio"],
          containerId: "resident-root",
          layers: ["render"],
        },
        {
          id: "gallery-shell",
          regionIds: ["gallery"],
          selectionKeys: ["faces:gallery"],
          containerId: "resident-root",
          layers: ["render"],
        },
        {
          id: "vault-shell",
          regionIds: ["vault"],
          selectionKeys: ["faces:vault"],
          containerId: "resident-root",
          layers: ["render"],
        },
      ],
    });
    const previousState = createPolyWorldState(topology, { selection: { regionIds: ["studio"] } });

    const frame = planPolyWorldPortalFrame(topology, {
      previousState,
      currentRegionId: "studio",
      linkedDepth: 2,
      activity: {
        selectedTargetState: "resident",
        renderedRegionIds: ["studio", "gallery"],
      },
      planRegionState: "rendered",
      relations: {},
      policies: [
        { id: "resident", layer: "resident", elementLayers: ["resident"], phase: "mount" },
        { id: "render", layer: "render", elementLayers: ["render"] },
      ],
      planDebug: { includeEntries: false },
      debug: { listLimit: 8 },
    });

    expect(frame.selection.regionIds).toEqual(["studio", "gallery", "vault"]);
    expect(frame.artifact).toMatchObject({
      profile: "area-portals",
      artifactKind: "authored-area-portals",
      sourceKind: "authored-runtime-selection",
      producedBy: "selectPolyWorldPortalRegions",
      counts: {
        selectedRegionCount: 3,
        selectedLinkCount: 2,
      },
    });
    expect(frame.artifact.knownWeaknesses).toContain("not-camera-frustum-portal-clipping");
    expect(frame.activity?.residentRegionIds).toEqual(["studio", "gallery", "vault"]);
    expect(frame.activity?.renderedRegionIds).toEqual(["studio", "gallery"]);
    expect(frame.planningSelection?.regionIds).toEqual(["studio", "gallery"]);
    expect(frame.planningSelection?.elementIds).toEqual(["resident-root"]);
    expect(frame.debug?.planningSelection?.regionIds).toEqual(["studio", "gallery"]);
    expect(frame.debug?.planningSelection?.elementIds).toEqual(["resident-root"]);
    expect(frame.nextState.selectedRegionIds).toEqual(["gallery", "studio"]);
    expect(frame.nextState.selectedElementIds).toEqual(["resident-root"]);
    expect(frame.nextState.resolvedElementIds).toEqual(["gallery-shell", "resident-root", "studio-shell"]);
    expect(frame.portalSets).toEqual({
      currentRegionId: "studio",
      selectedRegionIds: ["studio", "gallery", "vault"],
      selectedLinkIds: ["studio-gallery", "gallery-vault"],
      selectedSelectionKeys: ["faces:studio", "faces:gallery", "faces:vault"],
      selectedElementIds: [],
      currentRegionIds: ["studio"],
      linkedRegionIds: ["gallery", "vault"],
      linkedLinkIds: ["studio-gallery", "gallery-vault"],
      visibleRegionIds: [],
      visibilitySelectionRegionIds: [],
      visibilitySelectionElementIds: [],
      explicitLinkIds: [],
      facingLinkIds: [],
      closedLinkIds: [],
      blockedLinkIds: [],
      activitySelectedRegionIds: ["studio", "gallery", "vault"],
      activityLoadedRegionIds: ["studio", "gallery", "vault"],
      activityResidentRegionIds: ["studio", "gallery", "vault"],
      activityActiveRegionIds: ["studio", "gallery"],
      activityRenderedRegionIds: ["studio", "gallery"],
      activityPreloadedRegionIds: [],
      activityInactiveRegionIds: ["vault"],
      plannedElementIds: ["resident-root", "gallery-shell", "studio-shell"],
    });
    expect(frame.frameSummary).toMatchObject({
      profile: "area-portals",
      artifactKind: "authored-area-portals",
      current: { regionIds: ["studio"] },
      candidate: { regionIds: ["gallery", "studio", "vault"] },
      broad: { regionIds: ["gallery", "studio", "vault"] },
      retained: { regionIds: ["gallery", "studio", "vault"] },
      planning: {
        regionIds: ["gallery", "studio"],
        elementIds: ["resident-root"],
      },
      state: {
        selectedRegionIds: ["gallery", "studio"],
        resolvedElementIds: ["gallery-shell", "resident-root", "studio-shell"],
      },
      plan: {
        entryCount: 3,
        plannedElementIds: ["gallery-shell", "resident-root", "studio-shell"],
      },
    });
    expect(frame.plan.entries.map((entry) => [entry.layer, entry.elementId, entry.action])).toEqual([
      ["resident", "resident-root", "show"],
      ["render", "gallery-shell", "show"],
      ["render", "studio-shell", "retain"],
    ]);
    expect(frame.portalDebug?.regions.selectedRegionIds.count).toBe(3);
    expect(frame.portalDebug?.activity?.renderedRegionIds.values).toEqual(["studio", "gallery"]);
    expect(frame.debug?.plan.entryCount).toBe(3);
  });

  it("plans from external BSP visibility without leaking non-rendered direct elements", () => {
    const topology = createPolyWorldTopology({
      regions: [
        { id: "studio", selectionKeys: ["faces:studio"] },
        { id: "gallery", selectionKeys: ["faces:gallery"] },
        { id: "vault", selectionKeys: ["faces:vault"] },
      ],
      links: [
        { id: "studio-gallery", fromRegionId: "studio", toRegionId: "gallery" },
        { id: "gallery-vault", fromRegionId: "gallery", toRegionId: "vault" },
      ],
      elements: [
        { id: "studio-shell", regionIds: ["studio"], layers: ["render"] },
        { id: "gallery-shell", regionIds: ["gallery"], layers: ["render"] },
        { id: "vault-shell", regionIds: ["vault"], layers: ["render"] },
        { id: "vault-direct-marker", selectionKeys: ["marker:vault"], layers: ["render"] },
      ],
    });
    const previousState = createPolyWorldState(topology, { selection: { regionIds: ["studio"] } });

    const frame = planPolyWorldPortalFrame(topology, {
      previousState,
      currentRegionId: "studio",
      linkedDepth: 2,
      visibilitySelection: {
        regionIds: ["vault"],
        elementIds: ["vault-direct-marker"],
        reasons: [
          {
            id: "bsp-view",
            kind: "viewPvs",
            label: "bsp-view",
            regionIds: ["vault"],
            elementIds: ["vault-direct-marker"],
          },
        ],
      },
      activity: {
        selectedTargetState: "resident",
        renderedRegionIds: ["studio", "gallery"],
      },
      planRegionState: "rendered",
      policies: [{ id: "render", layer: "render", elementLayers: ["render"] }],
      debug: { listLimit: 8 },
    });

    expect(frame.selection.regionIds).toEqual(["studio", "gallery", "vault"]);
    expect(frame.selection.elementIds).toEqual(["vault-direct-marker"]);
    expect(frame.portalDebug?.selection.reasonKinds).toMatchObject({
      current: 1,
      linked: 1,
      viewPvs: 1,
      visibilitySelection: 1,
    });
    expect(frame.planningSelection?.regionIds).toEqual(["studio", "gallery"]);
    expect(frame.planningSelection?.elementIds).toBeUndefined();
    expect(frame.debug?.planningSelection?.regionIds).toEqual(["studio", "gallery"]);
    expect(frame.debug?.planningSelection?.elementIds).toEqual([]);
    expect(frame.nextState.selectedRegionIds).toEqual(["gallery", "studio"]);
    expect(frame.nextState.resolvedElementIds).toEqual(["gallery-shell", "studio-shell"]);
    expect(frame.nextState.resolvedElementIds).not.toContain("vault-direct-marker");
    expect(frame.nextState.resolvedElementIds).not.toContain("vault-shell");
    expect(frame.portalSets.visibilitySelectionRegionIds).toEqual(["vault"]);
    expect(frame.portalSets.visibilitySelectionElementIds).toEqual(["vault-direct-marker"]);
    expect(frame.portalSets.plannedElementIds).toEqual(["gallery-shell", "studio-shell"]);
  });
});

describe("resolvePolyWorldPortalFlow", () => {
  const flowPortals = [
    {
      id: "studio-gallery-portal",
      linkId: "studio-gallery",
      bounds: { min: [4, 1.5, 0], max: [4, 2.5, 2] },
      selectionKeys: ["portal:studio-gallery"],
    },
    {
      id: "gallery-vault-portal",
      linkId: "gallery-vault",
      bounds: { min: [8, 1, 0], max: [8, 3, 2] },
      selectionKeys: ["portal:gallery-vault"],
    },
    {
      id: "gallery-archive-portal",
      linkId: "gallery-archive",
      bounds: { min: [5, 4, 0], max: [7, 4, 2] },
      selectionKeys: ["portal:gallery-archive"],
    },
  ];

  function portalFlowTopology() {
    return createPolyWorldTopology({
      regions: [
        { id: "studio", bounds: { min: [0, 0, 0], max: [4, 4, 3] }, selectionKeys: ["faces:studio"] },
        { id: "gallery", bounds: { min: [4, 0, 0], max: [8, 4, 3] }, selectionKeys: ["faces:gallery"] },
        { id: "vault", bounds: { min: [8, 0, 0], max: [12, 4, 3] }, selectionKeys: ["faces:vault"] },
        { id: "archive", bounds: { min: [4, 4, 0], max: [8, 8, 3] }, selectionKeys: ["faces:archive"] },
      ],
      links: [
        { id: "studio-gallery", fromRegionId: "studio", toRegionId: "gallery", selectionKeys: ["link:studio-gallery"] },
        { id: "gallery-vault", fromRegionId: "gallery", toRegionId: "vault", selectionKeys: ["link:gallery-vault"] },
        { id: "gallery-archive", fromRegionId: "gallery", toRegionId: "archive", selectionKeys: ["link:gallery-archive"] },
      ],
      elements: [
        { id: "studio-shell", regionIds: ["studio"], layers: ["render"] },
        { id: "gallery-shell", regionIds: ["gallery"], layers: ["render"] },
        { id: "vault-shell", regionIds: ["vault"], layers: ["render"] },
        { id: "archive-shell", regionIds: ["archive"], layers: ["render"] },
      ],
    });
  }

  it("clips authored region portals through the camera view before selecting regions", () => {
    const topology = portalFlowTopology();
    const flow = resolvePolyWorldPortalFlow(topology, {
      point: [2, 2, 1],
      currentRegionId: "studio",
      forward: [1, 0, 0],
      up: [0, 0, 1],
      fovDegrees: 70,
      aspect: 1,
      maxDepth: 4,
      portals: flowPortals,
      includeTrace: true,
    });
    const resolution = resolvePolyWorldElements(topology, flow.selection);

    expect(flow.currentRegionId).toBe("studio");
    expect(flow.regionIds).toEqual(["studio", "gallery", "vault"]);
    expect(flow.linkIds).toEqual(["studio-gallery", "gallery-vault"]);
    expect(flow.portalIds).toEqual(["studio-gallery-portal", "gallery-vault-portal"]);
    expect(flow.selectionKeys).toEqual([
      "link:studio-gallery",
      "portal:studio-gallery",
      "link:gallery-vault",
      "portal:gallery-vault",
      "faces:studio",
      "faces:gallery",
      "faces:vault",
    ]);
    expect(flow.trace?.map((entry) => [entry.linkId, entry.status])).toEqual([
      ["studio-gallery", "visible"],
      ["gallery-vault", "visible"],
      ["gallery-archive", "clipped"],
    ]);
    expect(resolution.elementIds).toEqual(["studio-shell", "gallery-shell", "vault-shell"]);
  });

  it("keeps authored portal flow separate from broad phase, closed links, and looking away", () => {
    const topology = portalFlowTopology();
    const away = resolvePolyWorldPortalFlow(topology, {
      point: [2, 2, 1],
      currentRegionId: "studio",
      forward: [-1, 0, 0],
      portals: flowPortals,
      includeTrace: true,
    });
    const closed = resolvePolyWorldPortalFlow(topology, {
      point: [2, 2, 1],
      currentRegionId: "studio",
      forward: [1, 0, 0],
      portals: flowPortals,
      portalState: { "studio-gallery": "closed" },
      includeTrace: true,
    });
    const broad = resolvePolyWorldPortalFlow(topology, {
      point: [2, 2, 1],
      currentRegionId: "studio",
      forward: [1, 0, 0],
      portals: flowPortals,
      broadRegionIds: ["studio", "gallery"],
      includeTrace: true,
    });

    expect(away.regionIds).toEqual(["studio"]);
    expect(away.trace?.map((entry) => [entry.linkId, entry.status])).toEqual([
      ["studio-gallery", "clipped"],
    ]);
    expect(closed.regionIds).toEqual(["studio"]);
    expect(closed.trace?.map((entry) => [entry.linkId, entry.status])).toEqual([
      ["studio-gallery", "closed"],
    ]);
    expect(closed.selection.reasons?.map((reason) => [reason.kind, reason.linkIds])).toEqual([
      ["current", undefined],
      ["visible", []],
      ["closed", ["studio-gallery"]],
      ["selectionKey", undefined],
    ]);
    expect(broad.regionIds).toEqual(["studio", "gallery"]);
    expect(broad.trace?.map((entry) => [entry.linkId, entry.status])).toEqual([
      ["studio-gallery", "visible"],
      ["gallery-vault", "outside-broad-phase"],
      ["gallery-archive", "outside-broad-phase"],
    ]);
  });

  it("summarizes authored portal flow traces without presenting them as BSP", () => {
    const topology = portalFlowTopology();
    const flow = resolvePolyWorldPortalFlow(topology, {
      point: [2, 2, 1],
      currentRegionId: "studio",
      forward: [1, 0, 0],
      up: [0, 0, 1],
      fovDegrees: 70,
      aspect: 1,
      maxDepth: 4,
      portals: flowPortals,
      includeTrace: true,
    });
    const snapshot = createPolyWorldPortalFlowDebugSnapshot(topology, flow, {
      listLimit: 2,
      includeTraceEntries: true,
      entryLimit: 2,
      metadata: { example: "portal-flow" },
    });

    expect(snapshot.topology).toEqual({
      regionCount: 4,
      linkCount: 3,
      profile: "portal-flow",
    });
    expect(snapshot.proof).toMatchObject({
      profile: "portal-flow",
      artifactKind: "authored-area-portal-flow",
      sourceKind: "authored-runtime-selection",
      producedBy: "resolvePolyWorldPortalFlow",
      counts: {
        regionCount: 4,
        linkCount: 3,
        selectedRegionCount: 3,
        hiddenRegionCount: 1,
        selectedPortalCount: 2,
        rejectedPortalCount: 1,
        traceEntryCount: 3,
      },
    });
    expect(snapshot.proof.guarantees).toContain("camera-frustum-portal-clipping");
    expect(snapshot.proof.knownWeaknesses).toContain("not-compiled-bsp-pvs");
    expect(snapshot.current.regionId).toBe("studio");
    expect(snapshot.regions.selectedRegionIds).toEqual({
      values: ["studio", "gallery"],
      count: 3,
      omitted: 1,
    });
    expect(snapshot.regions.hiddenRegionIds).toEqual({
      values: ["archive"],
      count: 1,
      omitted: 0,
    });
    expect(snapshot.links.selectedLinkIds.count).toBe(2);
    expect(snapshot.portals.selectedPortalIds.count).toBe(2);
    expect(snapshot.portals.rejectedPortalIds.values).toEqual(["gallery-archive-portal"]);
    expect(snapshot.selection.reasonKinds).toMatchObject({
      current: 1,
      visible: 1,
      selectionKey: 1,
    });
    expect(snapshot.trace?.statusCounts).toEqual({
      visible: 2,
      clipped: 1,
    });
    expect(snapshot.trace?.entries?.map((entry) => [entry.linkId, entry.status])).toEqual([
      ["studio-gallery", "visible"],
      ["gallery-vault", "visible"],
    ]);
    expect(snapshot.trace?.omittedEntries).toBe(1);
    expect(snapshot.metadata).toEqual({ example: "portal-flow" });
  });

  it("plans authored portal-flow frames with activity-narrowed render selection", () => {
    const topology = portalFlowTopology();
    const previousState = createPolyWorldState(topology, {
      selection: { regionIds: ["studio"] },
    });
    const frame = planPolyWorldPortalFlowFrame(topology, {
      previousState,
      policies: [{ id: "render", layer: "render", elementLayers: ["render"] }],
      point: [2, 2, 1],
      currentRegionId: "studio",
      forward: [1, 0, 0],
      up: [0, 0, 1],
      fovDegrees: 70,
      aspect: 1,
      maxDepth: 4,
      portals: flowPortals,
      activity: {
        selectedTargetState: "resident",
        renderedRegionIds: ["studio", "gallery"],
      },
      planRegionState: "rendered",
      debug: { includeTraceEntries: true, entryLimit: 4 },
      planDebug: { includeEntries: false },
    });

    expect(frame.flow.regionIds).toEqual(["studio", "gallery", "vault"]);
    expect(frame.artifact).toMatchObject({
      profile: "portal-flow",
      artifactKind: "authored-area-portal-flow",
      sourceKind: "authored-runtime-selection",
      producedBy: "resolvePolyWorldPortalFlow",
      counts: {
        selectedRegionCount: 3,
        selectedPortalCount: 2,
        rejectedPortalCount: 1,
      },
    });
    expect(frame.artifact.guarantees).toContain("camera-frustum-portal-clipping");
    expect(frame.activity?.residentRegionIds).toEqual(["studio", "gallery", "vault"]);
    expect(frame.activity?.renderedRegionIds).toEqual(["studio", "gallery"]);
    expect(frame.planningSelection?.regionIds).toEqual(["studio", "gallery"]);
    expect(frame.planningSelection?.selectionKeys).toEqual(["faces:studio", "faces:gallery"]);
    expect(frame.nextState.selectedRegionIds).toEqual(["gallery", "studio"]);
    expect(frame.nextState.resolvedElementIds).toEqual(["gallery-shell", "studio-shell"]);
    expect(frame.nextState.resolvedElementIds).not.toContain("vault-shell");
    expect(frame.flowSets).toEqual({
      currentRegionId: "studio",
      selectedRegionIds: ["studio", "gallery", "vault"],
      selectedLinkIds: ["studio-gallery", "gallery-vault"],
      selectedPortalIds: ["studio-gallery-portal", "gallery-vault-portal"],
      tracedPortalIds: ["studio-gallery-portal", "gallery-vault-portal", "gallery-archive-portal"],
      rejectedPortalIds: ["gallery-archive-portal"],
      visiblePortalIds: ["studio-gallery-portal", "gallery-vault-portal"],
      closedLinkIds: [],
      blockedLinkIds: [],
      clippedPortalIds: ["gallery-archive-portal"],
      traceStatusCounts: {
        visible: 2,
        clipped: 1,
      },
      activitySelectedRegionIds: ["studio", "gallery", "vault"],
      activityLoadedRegionIds: ["studio", "gallery", "vault"],
      activityResidentRegionIds: ["studio", "gallery", "vault"],
      activityActiveRegionIds: ["studio", "gallery"],
      activityRenderedRegionIds: ["studio", "gallery"],
      activityPreloadedRegionIds: [],
      activityInactiveRegionIds: ["vault", "archive"],
      plannedElementIds: ["gallery-shell", "studio-shell"],
    });
    expect(frame.frameSummary).toMatchObject({
      profile: "portal-flow",
      artifactKind: "authored-area-portal-flow",
      current: { regionIds: ["studio"] },
      candidate: {
        regionIds: ["gallery", "studio", "vault"],
        portalIds: ["gallery-archive-portal", "gallery-vault-portal", "studio-gallery-portal"],
      },
      view: {
        regionIds: ["gallery", "studio", "vault"],
        portalIds: ["gallery-vault-portal", "studio-gallery-portal"],
      },
      rejected: {
        portalIds: ["gallery-archive-portal"],
        reasonCounts: { clipped: 1, visible: 2 },
      },
      planning: {
        regionIds: ["gallery", "studio"],
        selectionKeys: ["faces:gallery", "faces:studio"],
      },
      plan: {
        plannedElementIds: ["gallery-shell", "studio-shell"],
      },
    });
    expect(frame.portalFlowDebug?.topology.profile).toBe("portal-flow");
    expect(frame.portalFlowDebug?.trace?.statusCounts).toEqual({
      visible: 2,
      clipped: 1,
    });
    expect(frame.portalFlowDebug?.trace?.entries?.map((entry) => [entry.linkId, entry.status])).toEqual([
      ["studio-gallery", "visible"],
      ["gallery-vault", "visible"],
      ["gallery-archive", "clipped"],
    ]);
    expect(frame.debug?.planningSelection?.regionIds).toEqual(["studio", "gallery"]);
    expect(frame.debug?.planningSelection?.selectionKeys).toEqual(["faces:studio", "faces:gallery"]);
  });
});

describe("selectPolyWorldBspPvs", () => {
  it("compiles solid brush bounds into empty and solid BSP leaves without portals through blockers", () => {
    const result = compilePolyWorldBrushBsp({
      worldBounds: { min: [0, 0, 0], max: [3, 1, 1] },
      brushes: [{ id: "block", bounds: { min: [1, 0, 0], max: [2, 1, 1] } }],
      regions: [
        { id: "left", bounds: { min: [0, 0, 0], max: [1, 1, 1] }, elementIds: ["left-room"] },
        { id: "right", bounds: { min: [2, 0, 0], max: [3, 1, 1] }, elementIds: ["right-room"] },
      ],
      splitIdPrefix: "test-brush",
      pvs: { projection: "xy" },
    });

    const left = resolvePolyWorldBspLeaf(result.tree, [0.5, 0.5, 0.5]);
    const solid = resolvePolyWorldBspLeaf(result.tree, [1.5, 0.5, 0.5]);
    const right = resolvePolyWorldBspLeaf(result.tree, [2.5, 0.5, 0.5]);

    const gridNode = findBspNode(result.tree.root, (node) =>
      node.data?.axis !== undefined || !node.id.includes("-plane-")
    );
    const nodes = collectBspNodes(result.tree.root);

    expect(result.tree.data).toMatchObject({
      compiled: true,
      compiler: "brush-bsp",
      partition: "recursive-plane",
      leafBuilder: "recursive-convex-halfspace",
      portalBuilder: "leaf-face-overlap",
    });
    const certification = certifyPolyWorldBspTopology(result.tree);
    expect(certification).toMatchObject({
      profile: "bsp-pvs",
      certified: true,
      diagnostics: [],
      proof: {
        artifact: {
          profile: "bsp-pvs",
          artifactKind: "compiled-bsp-pvs",
          sourceKind: "compiled",
          producedBy: "brush-bsp",
          counts: {
            leafCount: 3,
            portalCount: 0,
            bakedPvsCount: 3,
          },
          coverage: {
            rootLeafReferenceCoverage: 1,
            bakedPvsCoverage: 1,
          },
        },
      },
    });
    expect(certification.proof.artifact.guarantees).toContain("tree-root-leaf-reference-audit");
    expect(certification.proof.artifact.guarantees).toContain("compiled-bsp-pvs");
    expect(certification.proof.artifact.guarantees).toContain("portal-clipped-baked-pvs");
    expect(certification.proof.artifact.guarantees).not.toContain("baked-pvs-bitsets");
    expect(certification.proof.artifact.guarantees).toContain("pvs-direct-adjacency-audit");
    expect(certification.proof.artifact.knownWeaknesses).toContain("not-full-qbsp-vis-parity");
    expect(summarizePolyWorldBspTopologyProof(result.tree)).toMatchObject({
      profile: "bsp-pvs",
      compiler: {
        id: "brush-bsp",
        compiled: true,
        partition: "recursive-plane",
        leafBuilder: "recursive-convex-halfspace",
        portalBuilder: "leaf-face-overlap",
      },
      tree: {
        leafCount: 3,
        portalCount: 0,
        rootLeafRefCount: 3,
        uniqueRootLeafRefCount: 3,
        referencesEveryLeafOnce: true,
      },
      leaves: {
        solidCount: 1,
        emptyCount: 2,
        renderableCount: 2,
        bakedPvsCount: 3,
        bakedPvsCoverage: 1,
      },
      portals: {
        generatedCount: 0,
        candidateCount: 0,
        rejectedCandidateCount: 0,
      },
      pvs: {
        level: "portal-clipped-baked-pvs",
        method: "portal-clipped-baked",
        source: "polycss-world",
        completeness: "complete",
        indexed: true,
        indexLeafCount: 3,
        indexPortalCount: 0,
        indexLeafCoverage: 1,
        indexPortalCoverage: 0,
        bakedLeafCount: 3,
        bakedLeafCoverage: 1,
        complete: true,
      },
      evidence: {
        validatedBy: "createPolyWorldBspTree",
        guarantees: [
          "validated-tree-root-references",
          "validated-portal-endpoints",
          "validated-portal-leaf-adjacency",
          "validated-pvs-bitset-widths",
          "validated-pvs-direct-adjacency",
          "validated-pvs-metadata",
        ],
      },
    });
    expect(result.emptyLeafIds).toHaveLength(2);
    expect(result.solidLeafIds).toHaveLength(1);
    expect(result.portals).toHaveLength(0);
    expect(gridNode).toBeUndefined();
    expect(nodes.length).toBeGreaterThan(0);
    expect(nodes.every((node) => node.data?.compiler === "brush-bsp")).toBe(true);
    expect(nodes.every((node) => node.data?.partition === "recursive-plane")).toBe(true);
    expect(nodes.some((node) =>
      node.data?.splitterSource === "brush" && node.data?.splitterSourceId === "block"
    )).toBe(true);
    expect(nodes.every((node) =>
      node.data?.splitterSource === "brush" || node.data?.splitterSource === "region"
    )).toBe(true);
    expect(result.tree.leaves.every((leaf) => /^test-brush-leaf-\d+$/.test(leaf.id))).toBe(true);
    expect(left?.leaf.regionId).toBe("left");
    expect(left?.leaf.elementIds).toEqual(["left-room"]);
    expect(solid?.leaf.data?.solid).toBe(true);
    expect(solid?.leaf.data?.brushIds).toEqual(["block"]);
    expect(right?.leaf.regionId).toBe("right");
    expect(decodeTestBitset(result.tree.pvsIndex?.leafIds ?? [], left?.leaf.pvs?.leafBits)).toEqual([left?.leafId]);
    expect(decodeTestBitset(result.tree.pvsIndex?.leafIds ?? [], right?.leaf.pvs?.leafBits)).toEqual([right?.leafId]);
    expect(left?.leaf.elementIds).toEqual(["left-room"]);
  });

  it("labels authored loose and unavailable PVS without compiled or baked guarantees", () => {
    const pvsIndex = createTestPvsIndex(["a", "b"], []);
    const authoredLooseTree = createPolyWorldBspTree({
      root: {
        id: "root",
        plane: { normal: [1, 0, 0], distance: 1 },
        back: { leafId: "a" },
        front: { leafId: "b" },
      },
      leaves: [
        {
          id: "a",
          regionId: "a",
          pvs: {
            leafBits: testBitset(2, [0]),
            portalBits: testBitset(0, []),
            regionIds: ["a"],
            linkIds: [],
            selectionKeys: [],
            elementIds: [],
          },
        },
        { id: "b", regionId: "b" },
      ],
      pvsIndex,
      data: { compiler: "authored" },
    });
    const noPvsTree = createPolyWorldBspTree({
      root: {
        id: "root",
        plane: { normal: [1, 0, 0], distance: 1 },
        back: { leafId: "a" },
        front: { leafId: "b" },
      },
      leaves: [
        { id: "a", regionId: "a" },
        { id: "b", regionId: "b" },
      ],
      data: { compiler: "authored" },
    });

    const looseProof = summarizePolyWorldBspTopologyProof(authoredLooseTree);
    const noPvsProof = summarizePolyWorldBspTopologyProof(noPvsTree);

    expect(looseProof.pvs).toMatchObject({
      level: "authored-loose-pvs",
      method: "authored-loose",
      source: "authored",
      completeness: "partial",
      indexed: true,
      bakedLeafCount: 1,
      complete: false,
    });
    expect(looseProof.artifact.guarantees).toEqual([
      "tree-root-leaf-reference-audit",
      "portal-endpoint-audit",
      "portal-leaf-adjacency-audit",
      "pvs-bitset-width-audit",
      "pvs-direct-adjacency-audit",
      "pvs-metadata-decode-audit",
    ]);
    expect(looseProof.artifact.guarantees).not.toContain("compiled-bsp-pvs");
    expect(looseProof.artifact.guarantees).not.toContain("baked-pvs-bitsets");
    expect(looseProof.artifact.guarantees).not.toContain("portal-clipped-baked-pvs");
    expect(looseProof.artifact.knownWeaknesses).toEqual(expect.arrayContaining([
      "loose-pvs-not-full-vis",
      "partial-pvs-coverage",
    ]));

    expect(noPvsProof.pvs).toMatchObject({
      level: "certified-tree-only",
      method: "none",
      source: "none",
      completeness: "none",
      indexed: false,
      bakedLeafCount: 0,
      complete: false,
    });
    expect(noPvsProof.artifact.guarantees).toEqual([
      "tree-root-leaf-reference-audit",
      "portal-endpoint-audit",
      "portal-leaf-adjacency-audit",
    ]);
    expect(noPvsProof.evidence.guarantees).toEqual([
      "validated-tree-root-references",
      "validated-portal-endpoints",
      "validated-portal-leaf-adjacency",
    ]);
    expect(noPvsProof.artifact.knownWeaknesses).toContain("pvs-unavailable");
  });

  it("allows imported exact baked PVS to claim baked bitsets when coverage is complete", () => {
    const pvsIndex = createTestPvsIndex(["a", "b"], ["ab"]);
    const tree = createPolyWorldBspTree({
      root: {
        id: "root",
        plane: { normal: [1, 0, 0], distance: 1 },
        back: { leafId: "a" },
        front: { leafId: "b" },
      },
      leaves: [
        {
          id: "a",
          regionId: "a",
          pvs: {
            leafBits: testBitset(2, [0, 1]),
            portalBits: testBitset(1, [0]),
            regionIds: ["a", "b"],
            linkIds: ["ab"],
            selectionKeys: [],
            elementIds: [],
          },
        },
        {
          id: "b",
          regionId: "b",
          pvs: {
            leafBits: testBitset(2, [0, 1]),
            portalBits: testBitset(1, [0]),
            regionIds: ["a", "b"],
            linkIds: ["ab"],
            selectionKeys: [],
            elementIds: [],
          },
        },
      ],
      portals: [
        {
          id: "ab",
          fromLeafId: "a",
          toLeafId: "b",
          linkId: "ab",
          vertices: [[1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0, 1]],
        },
      ],
      pvsIndex,
      data: {
        compiled: true,
        compiler: "test-vis",
        pvsMethod: "exact-baked",
        pvsSource: "test-vis",
      },
    });
    const proof = summarizePolyWorldBspTopologyProof(tree);

    expect(proof.pvs).toMatchObject({
      level: "exact-baked-pvs",
      method: "exact-baked",
      source: "test-vis",
      completeness: "complete",
      complete: true,
    });
    expect(proof.artifact.guarantees).toEqual(expect.arrayContaining([
      "compiled-bsp-pvs",
      "baked-pvs-bitsets",
      "pvs-bitset-width-audit",
      "pvs-direct-adjacency-audit",
      "pvs-metadata-decode-audit",
    ]));
    expect(proof.artifact.guarantees).not.toContain("portal-clipped-baked-pvs");
    expect(proof.artifact.knownWeaknesses).not.toContain("portal-flood-pvs-not-full-vis");
  });

  it("uses the exact-PVS fixture as a complete imported bitset artifact", () => {
    const fixture = createPolyWorldExactPvsFixture();
    const proof = summarizePolyWorldBspTopologyProof(fixture.tree);
    const baked = resolvePolyWorldBspBakedPvs(fixture.tree, "middle");

    expect(proof.pvs).toMatchObject({
      level: "exact-baked-pvs",
      method: "exact-baked",
      source: "fixture-vis",
      completeness: "complete",
      complete: true,
    });
    expect(proof.artifact.guarantees).toEqual(expect.arrayContaining([
      "compiled-bsp-pvs",
      "baked-pvs-bitsets",
      "pvs-metadata-decode-audit",
    ]));
    expect(baked?.leafIds).toEqual(fixture.expectedLeafIds);
    expect(baked?.regionIds).toEqual(fixture.expectedRegionIds);
  });

  it("labels partial imported baked PVS without complete baked-bitset claims", () => {
    const pvsIndex = createTestPvsIndex(["a", "b"], []);
    const tree = createPolyWorldBspTree({
      root: {
        id: "root",
        plane: { normal: [1, 0, 0], distance: 1 },
        back: { leafId: "a" },
        front: { leafId: "b" },
      },
      leaves: [
        {
          id: "a",
          regionId: "a",
          pvs: {
            leafBits: testBitset(2, [0]),
            portalBits: testBitset(0, []),
            regionIds: ["a"],
            linkIds: [],
            selectionKeys: [],
            elementIds: [],
          },
        },
        { id: "b", regionId: "b" },
      ],
      pvsIndex,
      data: {
        compiled: true,
        compiler: "partial-vis",
        pvsMethod: "exact-baked",
        pvsSource: "partial-vis",
      },
    });
    const proof = summarizePolyWorldBspTopologyProof(tree);

    expect(proof.pvs).toMatchObject({
      level: "partial-baked-pvs",
      method: "exact-baked",
      source: "partial-vis",
      completeness: "partial",
      complete: false,
    });
    expect(proof.artifact.guarantees).toContain("compiled-bsp-pvs");
    expect(proof.artifact.guarantees).not.toContain("baked-pvs-bitsets");
    expect(proof.artifact.knownWeaknesses).toContain("partial-pvs-coverage");
  });

  it("compiles empty brush BSP portals around a partial blocker", () => {
    const result = compilePolyWorldBrushBsp({
      worldBounds: { min: [0, 0, 0], max: [3, 2, 1] },
      brushes: [{ id: "block", bounds: { min: [1, 0, 0], max: [2, 1, 1] } }],
      regions: [
        { id: "left", bounds: { min: [0, 0, 0], max: [1, 2, 1] } },
        { id: "right", bounds: { min: [2, 0, 0], max: [3, 2, 1] } },
        { id: "upper-route", regionId: "route", bounds: { min: [1, 1, 0], max: [2, 2, 1] } },
      ],
      splitIdPrefix: "test-brush-open",
      pvs: { projection: "xy" },
    });
    const leftLower = resolvePolyWorldBspLeaf(result.tree, [0.5, 0.5, 0.5]);
    const rightLower = resolvePolyWorldBspLeaf(result.tree, [2.5, 0.5, 0.5]);
    const solid = resolvePolyWorldBspLeaf(result.tree, [1.5, 0.5, 0.5]);
    const reachable = new Set<string>();
    const queue = leftLower === undefined ? [] : [leftLower.leafId];
    while (queue.length > 0) {
      const leafId = queue.shift();
      if (leafId === undefined || reachable.has(leafId)) continue;
      reachable.add(leafId);
      for (const portal of result.portals) {
        if (portal.fromLeafId === leafId && !reachable.has(portal.toLeafId)) queue.push(portal.toLeafId);
        if (portal.toLeafId === leafId && !reachable.has(portal.fromLeafId)) queue.push(portal.fromLeafId);
      }
    }

    expect(result.emptyLeafIds).toHaveLength(5);
    expect(result.solidLeafIds).toHaveLength(1);
    expect(result.portals.length).toBeGreaterThan(0);
    expect(result.portals.every((portal) =>
      portal.vertices !== undefined &&
      portal.vertices.length >= 3 &&
      portal.data?.compiler === "brush-bsp" &&
      portal.data?.partition === "recursive-plane" &&
      portal.data?.portalBuilder === "leaf-face-overlap"
    )).toBe(true);
    expect(result.tree.data?.portalCandidateCount).toBeGreaterThan(result.portals.length);
    expect(result.tree.data?.rejectedPortalCandidateCount).toBeGreaterThan(0);
    expect(result.portals.some((portal) =>
      portal.fromLeafId === leftLower?.leafId && portal.toLeafId === rightLower?.leafId ||
      portal.fromLeafId === rightLower?.leafId && portal.toLeafId === leftLower?.leafId
    )).toBe(false);
    expect(solid?.leaf.data?.solid).toBe(true);
    expect(reachable.has(rightLower?.leafId ?? "")).toBe(true);
    expect(decodeTestBitset(result.tree.pvsIndex?.leafIds ?? [], leftLower?.leaf.pvs?.leafBits)).toContain(leftLower?.leafId);
  });

  it("can mark space outside authored brush BSP regions as solid", () => {
    const result = compilePolyWorldBrushBsp({
      worldBounds: { min: [0, 0, 0], max: [2, 1, 1] },
      brushes: [],
      regions: [
        { id: "room", bounds: { min: [0, 0, 0], max: [1, 1, 1] }, elementIds: ["room-shell"] },
      ],
      outside: "solid",
      splitIdPrefix: "test-outside-solid",
      pvs: { projection: "xy" },
    });
    const room = resolvePolyWorldBspLeaf(result.tree, [0.5, 0.5, 0.5]);
    const outside = resolvePolyWorldBspLeaf(result.tree, [1.5, 0.5, 0.5]);

    expect(result.emptyLeafIds).toEqual([room?.leafId]);
    expect(result.solidLeafIds).toEqual([outside?.leafId]);
    expect(result.portals).toHaveLength(0);
    expect(room?.leaf.regionId).toBe("room");
    expect(room?.leaf.elementIds).toEqual(["room-shell"]);
    expect(outside?.leaf.data).toMatchObject({ solid: true, outside: true });
    expect(result.outsideLeafIds).toEqual([outside?.leafId]);
  });

  it("flood-fills exterior brush BSP space without leaking into a sealed room", () => {
    const result = compilePolyWorldBrushBsp({
      worldBounds: { min: [0, 0, 0], max: [3, 3, 3] },
      brushes: [
        { id: "west-wall", bounds: { min: [0.9, 0.9, 0.9], max: [1, 2.1, 2.1] } },
        { id: "east-wall", bounds: { min: [2, 0.9, 0.9], max: [2.1, 2.1, 2.1] } },
        { id: "south-wall", bounds: { min: [0.9, 0.9, 0.9], max: [2.1, 1, 2.1] } },
        { id: "north-wall", bounds: { min: [0.9, 2, 0.9], max: [2.1, 2.1, 2.1] } },
        { id: "floor", bounds: { min: [0.9, 0.9, 0.9], max: [2.1, 2.1, 1] } },
        { id: "ceiling", bounds: { min: [0.9, 0.9, 2], max: [2.1, 2.1, 2.1] } },
      ],
      regions: [
        {
          id: "sealed",
          bounds: { min: [1, 1, 1], max: [2, 2, 2] },
          elementIds: ["sealed-room"],
        },
      ],
      outside: "flood-fill",
      splitIdPrefix: "test-sealed-room",
      bakePvs: false,
    });
    const sealed = resolvePolyWorldBspLeaf(result.tree, [1.5, 1.5, 1.5]);
    const exterior = resolvePolyWorldBspLeaf(result.tree, [0.5, 0.5, 0.5]);
    const exteriorReachable = reachableLeafIds(result.portals, exterior?.leafId);

    expect(sealed?.leaf.data?.solid).toBe(false);
    expect(sealed?.leaf.regionId).toBe("sealed");
    expect(sealed?.leaf.elementIds).toEqual(["sealed-room"]);
    expect(exterior?.leaf.data).toMatchObject({ solid: true, outside: true, outsideFill: true });
    expect(result.outsideLeafIds).toContain(exterior?.leafId);
    expect(result.outsideLeafIds).not.toContain(sealed?.leafId);
    expect(exteriorReachable.has(sealed?.leafId ?? "")).toBe(false);
  });

  it("flood-fills leaked brush BSP regions as outside space", () => {
    const result = compilePolyWorldBrushBsp({
      worldBounds: { min: [0, 0, 0], max: [3, 3, 3] },
      brushes: [
        { id: "west-wall", bounds: { min: [0.9, 0.9, 0.9], max: [1, 2.1, 2.1] } },
        { id: "east-wall", bounds: { min: [2, 0.9, 0.9], max: [2.1, 2.1, 2.1] } },
        { id: "south-wall", bounds: { min: [0.9, 0.9, 0.9], max: [2.1, 1, 2.1] } },
        { id: "floor", bounds: { min: [0.9, 0.9, 0.9], max: [2.1, 2.1, 1] } },
        { id: "ceiling", bounds: { min: [0.9, 0.9, 2], max: [2.1, 2.1, 2.1] } },
      ],
      regions: [
        {
          id: "leaked",
          bounds: { min: [1, 1, 1], max: [2, 2, 2] },
          elementIds: ["leaked-room"],
        },
      ],
      outside: "flood-fill",
      splitIdPrefix: "test-leaked-room",
      bakePvs: false,
    });
    const leaked = resolvePolyWorldBspLeaf(result.tree, [1.5, 1.5, 1.5]);

    expect(leaked?.leaf.data).toMatchObject({ solid: true, outside: true, outsideFill: true });
    expect(leaked?.leaf.regionId).toBeUndefined();
    expect(leaked?.leaf.elementIds ?? []).toEqual([]);
    expect(result.outsideLeafIds).toContain(leaked?.leafId);
    expect(result.emptyLeafIds).not.toContain(leaked?.leafId ?? "");
  });

  it("compiles sloped brush planes into non-axis solid and empty BSP leaves", () => {
    const result = compilePolyWorldBrushBsp({
      worldBounds: { min: [0, 0, 0], max: [2, 2, 1] },
      brushes: [
        {
          id: "diagonal-solid",
          bounds: { min: [0, 0, 0], max: [2, 2, 1] },
          planes: [{ normal: [-1, -1, 0], distance: -2 }],
        },
      ],
      regions: [
        {
          id: "walkable",
          bounds: { min: [0, 0, 0], max: [2, 2, 1] },
          elementIds: ["walkable-room"],
        },
      ],
      splitIdPrefix: "test-sloped-brush",
      bakePvs: false,
    });
    const empty = resolvePolyWorldBspLeaf(result.tree, [0.5, 0.5, 0.5]);
    const solid = resolvePolyWorldBspLeaf(result.tree, [1.5, 1, 0.5]);
    const diagonalNode = findBspNode(result.tree.root, (node) =>
      Math.abs(node.plane.normal[0]) > 0.5 && Math.abs(node.plane.normal[1]) > 0.5
    );

    expect(empty?.leaf.data?.solid).toBe(false);
    expect(empty?.leaf.regionId).toBe("walkable");
    expect(empty?.leaf.elementIds).toEqual(["walkable-room"]);
    expect(solid?.leaf.data?.solid).toBe(true);
    expect(solid?.leaf.data?.brushIds).toEqual(["diagonal-solid"]);
    expect(empty?.leafId).not.toBe(solid?.leafId);
    expect(diagonalNode?.plane.normal[0]).toBeCloseTo(-Math.SQRT1_2);
    expect(diagonalNode?.plane.normal[1]).toBeCloseTo(-Math.SQRT1_2);
    expect(diagonalNode?.plane.normal[2]).toBeCloseTo(0);
    expect(diagonalNode?.data).toMatchObject({
      compiler: "brush-bsp",
      partition: "recursive-plane",
      splitterSource: "brush",
      splitterSourceId: "diagonal-solid",
    });
  });

  it("generates empty BSP portals around sloped brush solids", () => {
    const result = compilePolyWorldBrushBsp({
      worldBounds: { min: [0, 0, 0], max: [3, 2, 1] },
      brushes: [
        {
          id: "sloped-block",
          bounds: { min: [1, 0, 0], max: [2, 1, 1] },
          planes: [{ normal: [-1, -1, 0], distance: -2.4 }],
        },
      ],
      regions: [
        { id: "left", bounds: { min: [0, 0, 0], max: [1, 2, 1] } },
        { id: "route", bounds: { min: [1, 1, 0], max: [2, 2, 1] } },
        { id: "right", bounds: { min: [2, 0, 0], max: [3, 2, 1] } },
      ],
      splitIdPrefix: "test-sloped-route",
      bakePvs: false,
    });
    const leftLower = resolvePolyWorldBspLeaf(result.tree, [0.5, 0.5, 0.5]);
    const rightLower = resolvePolyWorldBspLeaf(result.tree, [2.5, 0.5, 0.5]);
    const solid = resolvePolyWorldBspLeaf(result.tree, [1.8, 0.8, 0.5]);
    const openInsideBrushBounds = resolvePolyWorldBspLeaf(result.tree, [1.1, 0.1, 0.5]);
    const reachable = reachableLeafIds(result.portals, leftLower?.leafId);

    expect(result.portals.length).toBeGreaterThan(0);
    expect(solid?.leaf.data?.solid).toBe(true);
    expect(openInsideBrushBounds?.leaf.data?.solid).toBe(false);
    expect(reachable.has(rightLower?.leafId ?? "")).toBe(true);
  });

  it("rejects malformed brush BSP compiler input", () => {
    expect(() =>
      compilePolyWorldBrushBsp({
        worldBounds: { min: [0, 0, 0], max: [1, 1, 1] },
        brushes: [
          { id: "dup", bounds: { min: [0, 0, 0], max: [0.5, 0.5, 0.5] } },
          { id: "dup", bounds: { min: [0.5, 0.5, 0.5], max: [1.5, 1, 1] } },
        ],
      }),
    ).toThrow(PolyWorldBspError);
    expect(() =>
      compilePolyWorldBrushBsp({
        worldBounds: { min: [0, 0, 0], max: [1, 1, 1] },
        brushes: [{ id: "bad-plane", planes: [{ normal: [0, 0, 0], distance: 0 }] }],
      }),
    ).toThrow(PolyWorldBspError);
    expect(() =>
      compilePolyWorldBrushBsp({
        worldBounds: { min: [0, 0, 0], max: [1, 1, 1] },
        brushes: [],
        outside: "invalid" as never,
      }),
    ).toThrow(PolyWorldBspError);
  });

  it("compiles polygon geometry into a plane BSP and splits spanning surfaces", () => {
    const result = compilePolyWorldPolygonBsp({
      surfaces: [
        {
          id: "splitter-wall",
          vertices: [
            [0, -1, 0],
            [0, 1, 0],
            [0, 1, 1],
            [0, -1, 1],
          ],
        },
        {
          id: "spanning-floor",
          vertices: [
            [-2, -1, 0.5],
            [2, -1, 0.5],
            [2, 1, 0.5],
            [-2, 1, 0.5],
          ],
        },
      ],
      splitIdPrefix: "test-poly",
    });

    const leftLeaf = resolvePolyWorldBspLeaf(result.tree, [-1, 0, 0.5]);
    const rightLeaf = resolvePolyWorldBspLeaf(result.tree, [1, 0, 0.5]);

    expect(result.tree.data).toMatchObject({
      compiled: true,
      compiler: "polygon-bsp",
      sourceSurfaceCount: 2,
    });
    expect(result.fragments.length).toBeGreaterThan(2);
    expect(result.fragments.some((fragment) => fragment.id.startsWith("spanning-floor#"))).toBe(true);
    expect(leftLeaf?.leafId).toBeDefined();
    expect(rightLeaf?.leafId).toBeDefined();
    expect(leftLeaf?.leafId).not.toBe(rightLeaf?.leafId);
  });

  it("rejects degenerate polygon BSP surfaces", () => {
    expect(() =>
      compilePolyWorldPolygonBsp({
        surfaces: [
          {
            id: "line",
            vertices: [
              [0, 0, 0],
              [1, 0, 0],
              [2, 0, 0],
            ],
          },
        ],
      }),
    ).toThrow(PolyWorldBspError);
  });

  it("compiles region bounds and portal openings into a BSP tree with baked PVS", () => {
    const topology = createPolyWorldTopology({
      regions: [
        { id: "left" },
        { id: "middle" },
        { id: "right" },
        { id: "side" },
      ],
      links: [
        { id: "left-middle", fromRegionId: "left", toRegionId: "middle", selectionKeys: ["portal:left-middle"] },
        { id: "middle-right", fromRegionId: "middle", toRegionId: "right", selectionKeys: ["portal:middle-right"] },
        { id: "middle-side", fromRegionId: "middle", toRegionId: "side", selectionKeys: ["portal:middle-side"] },
      ],
      elements: [
        { id: "left-shell", regionIds: ["left"], layers: ["world"] },
        { id: "middle-shell", regionIds: ["middle"], layers: ["world"] },
        { id: "right-shell", regionIds: ["right"], layers: ["world"] },
        { id: "side-shell", regionIds: ["side"], layers: ["world"] },
        { id: "left-door", selectionKeys: ["portal:left-middle"], layers: ["world"] },
        { id: "right-door", selectionKeys: ["portal:middle-right"], layers: ["world"] },
        { id: "side-door", selectionKeys: ["portal:middle-side"], layers: ["world"] },
      ],
    });
    const tree = compilePolyWorldBsp({
      regions: [
        {
          id: "left",
          bounds: { min: [-8, -2, 0], max: [-4, 2, 2] },
          pvsSamplePoints: [[-6, 0, 1]],
        },
        { id: "middle", bounds: { min: [-4, -4, 0], max: [4, 4, 2] } },
        { id: "right", bounds: { min: [4, -2, 0], max: [8, 2, 2] } },
        { id: "side", bounds: { min: [-2, 4, 0], max: [2, 8, 2] } },
      ],
      portals: [
        {
          id: "left-middle",
          fromRegionId: "left",
          toRegionId: "middle",
          linkId: "left-middle",
          bounds: { min: [-4, -1, 0], max: [-4, 1, 2] },
        },
        {
          id: "middle-right",
          fromRegionId: "middle",
          toRegionId: "right",
          linkId: "middle-right",
          bounds: { min: [4, -1, 0], max: [4, 1, 2] },
        },
        {
          id: "middle-side",
          fromRegionId: "middle",
          toRegionId: "side",
          linkId: "middle-side",
          bounds: { min: [-1, 4, 0], max: [1, 4, 2] },
        },
      ],
      pvs: { projection: "xy" },
    });

    const leaf = resolvePolyWorldBspLeaf(tree, [-6, 0, 1]);
    const leftPvs = resolvePolyWorldBspPvs(tree, "left", { projection: "xy" });
    const selection = selectPolyWorldBspPvs(topology, tree, { point: [-6, 0, 1] });
    const resolution = resolvePolyWorldElements(topology, selection);

    expect(tree.data).toMatchObject({ compiled: true, compiler: "bounds-bsp" });
    expect(tree.portals).toHaveLength(3);
    expect(tree.portals.every((portal) => portal.data?.compiled === true)).toBe(true);
    expect(leaf?.leafId).toBe("left");
    expect(leaf?.path.length).toBeGreaterThan(0);
    expect(leftPvs.leafIds).toEqual(["left", "middle", "right"]);
    expect(leftPvs.portalIds).toEqual(["left-middle", "middle-right"]);
    expect(selection.regionIds).toEqual(["left", "middle", "right"]);
    expect(selection.linkIds).toEqual(["left-middle", "middle-right"]);
    expect(resolution.elementIds).toEqual([
      "left-shell",
      "middle-shell",
      "right-shell",
      "left-door",
      "right-door",
    ]);
  });

  it("bakes BSP leaf PVS from portal geometry before selecting visible elements", () => {
    const topology = createPolyWorldTopology({
      regions: [
        { id: "left" },
        { id: "middle" },
        { id: "right" },
        { id: "side" },
      ],
      links: [
        { id: "left-middle", fromRegionId: "left", toRegionId: "middle", selectionKeys: ["portal:left-middle"] },
        { id: "middle-right", fromRegionId: "middle", toRegionId: "right", selectionKeys: ["portal:middle-right"] },
        { id: "middle-side", fromRegionId: "middle", toRegionId: "side", selectionKeys: ["portal:middle-side"] },
      ],
      elements: [
        { id: "left-shell", regionIds: ["left"], layers: ["world"] },
        { id: "middle-shell", regionIds: ["middle"], layers: ["world"] },
        { id: "right-shell", regionIds: ["right"], layers: ["world"] },
        { id: "side-shell", regionIds: ["side"], layers: ["world"] },
        { id: "left-door", selectionKeys: ["portal:left-middle"], layers: ["world"] },
        { id: "right-door", selectionKeys: ["portal:middle-right"], layers: ["world"] },
        { id: "side-door", selectionKeys: ["portal:middle-side"], layers: ["world"] },
      ],
    });
    const tree = bakePolyWorldBspPvs(createPolyWorldBspTree({
      root: {
        id: "split-left",
        plane: { normal: [1, 0, 0], distance: -4 },
        back: { leafId: "left-leaf" },
        front: {
          id: "split-right",
          plane: { normal: [1, 0, 0], distance: 4 },
          front: { leafId: "right-leaf" },
          back: {
            id: "split-side",
            plane: { normal: [0, 1, 0], distance: 4 },
            front: { leafId: "side-leaf" },
            back: { leafId: "middle-leaf" },
          },
        },
      },
      leaves: [
        {
          id: "left-leaf",
          regionId: "left",
          clusterId: "cluster-left",
          bounds: { min: [-8, -2, 0], max: [-4, 2, 2] },
          pvsSamplePoints: [[-6, 0, 1]],
        },
        { id: "middle-leaf", regionId: "middle", clusterId: "cluster-middle", bounds: { min: [-4, -4, 0], max: [4, 4, 2] } },
        { id: "right-leaf", regionId: "right", clusterId: "cluster-right", bounds: { min: [4, -2, 0], max: [8, 2, 2] } },
        { id: "side-leaf", regionId: "side", clusterId: "cluster-side", bounds: { min: [-2, 4, 0], max: [2, 8, 2] } },
      ],
      portals: [
        {
          id: "portal-left-middle",
          fromLeafId: "left-leaf",
          toLeafId: "middle-leaf",
          linkId: "left-middle",
          vertices: [[-4, -1, 0], [-4, 1, 0], [-4, 1, 2], [-4, -1, 2]],
        },
        {
          id: "portal-middle-right",
          fromLeafId: "middle-leaf",
          toLeafId: "right-leaf",
          linkId: "middle-right",
          vertices: [[4, -1, 0], [4, 1, 0], [4, 1, 2], [4, -1, 2]],
        },
        {
          id: "portal-middle-side",
          fromLeafId: "middle-leaf",
          toLeafId: "side-leaf",
          linkId: "middle-side",
          vertices: [[-1, 4, 0], [1, 4, 0], [1, 4, 2], [-1, 4, 2]],
        },
      ],
    }), { projection: "xy" });

    const leftPvs = resolvePolyWorldBspPvs(tree, "left-leaf", { projection: "xy" });
    const bakedLeftPvs = resolvePolyWorldBspBakedPvs(tree, "left-leaf");
    const proof = summarizePolyWorldBspTopologyProof(tree);
    const selection = selectPolyWorldBspPvs(topology, tree, { point: [-6, 0, 1] });
    const resolution = resolvePolyWorldElements(topology, selection);

    expect(tree.portals.map((portal) => portal.linkId)).toContain("middle-side");
    expect(proof.pvs).toMatchObject({
      level: "portal-clipped-baked-pvs",
      method: "portal-clipped-baked",
      source: "polycss-world",
      completeness: "complete",
    });
    expect(proof.artifact.guarantees).toContain("portal-clipped-baked-pvs");
    expect(proof.artifact.knownWeaknesses).toContain("not-full-qbsp-vis-parity");
    expect(leftPvs.leafIds).toEqual(["left-leaf", "middle-leaf", "right-leaf"]);
    expect(leftPvs.leafIds).not.toContain("side-leaf");
    expect(leftPvs.clusterIds).toEqual(["cluster-left", "cluster-middle", "cluster-right"]);
    expect(leftPvs.portalIds).toEqual(["portal-left-middle", "portal-middle-right"]);
    expect(leftPvs.portalIds).not.toContain("portal-middle-side");
    expect(bakedLeftPvs?.leafIds).toEqual(["left-leaf", "middle-leaf", "right-leaf"]);
    expect(bakedLeftPvs?.clusterIds).toEqual(["cluster-left", "cluster-middle", "cluster-right"]);
    expect(bakedLeftPvs?.portalIds).toEqual(["portal-left-middle", "portal-middle-right"]);
    expect(leftPvs.regionIds).toEqual(["left", "middle", "right"]);
    expect(leftPvs.linkIds).toEqual(["left-middle", "middle-right"]);
    expect(tree.leavesById.get("left-leaf")?.pvs?.regionIds).toEqual(["left", "middle", "right"]);
    expect(tree.leavesById.get("left-leaf")?.pvs?.leafBits).toBeInstanceOf(Uint32Array);
    expect(decodePolyWorldBspPvsLeafIds(tree.pvsIndex!, tree.leavesById.get("left-leaf")!.pvs!)).toEqual([
      "left-leaf",
      "middle-leaf",
      "right-leaf",
    ]);
    expect(decodePolyWorldBspPvsPortalIds(tree.pvsIndex!, tree.leavesById.get("left-leaf")!.pvs!)).toEqual([
      "portal-left-middle",
      "portal-middle-right",
    ]);
    expect(selection.regionIds).toEqual(["left", "middle", "right"]);
    expect(selection.linkIds).toEqual(["left-middle", "middle-right"]);
    expect(selection.selectionKeys).toEqual(["portal:left-middle", "portal:middle-right"]);
    expect(selection.reasons?.find((reason) => reason.kind === "pvs")?.data).toEqual({
      leafId: "left-leaf",
      portalIds: ["portal-left-middle", "portal-middle-right"],
      leafIds: ["left-leaf", "middle-leaf", "right-leaf"],
      clusterIds: ["cluster-left", "cluster-middle", "cluster-right"],
    });
    expect(resolution.elementIds).toEqual([
      "left-shell",
      "middle-shell",
      "right-shell",
      "left-door",
      "right-door",
    ]);
  });

  it("clips a baked BSP PVS through the current camera view before selecting elements", () => {
    const topology = createPolyWorldTopology({
      regions: [
        { id: "left" },
        { id: "middle" },
        { id: "right" },
      ],
      links: [
        { id: "left-middle", fromRegionId: "left", toRegionId: "middle", selectionKeys: ["portal:left-middle"] },
        { id: "middle-right", fromRegionId: "middle", toRegionId: "right", selectionKeys: ["portal:middle-right"] },
      ],
      elements: [
        { id: "left-shell", regionIds: ["left"], layers: ["world"] },
        { id: "middle-shell", regionIds: ["middle"], layers: ["world"] },
        { id: "right-shell", regionIds: ["right"], layers: ["world"] },
      ],
    });
    const tree = compilePolyWorldBsp({
      regions: [
        { id: "left", bounds: { min: [-8, -2, 0], max: [-4, 2, 2] } },
        { id: "middle", bounds: { min: [-4, -2, 0], max: [4, 2, 2] } },
        { id: "right", bounds: { min: [4, -2, 0], max: [8, 2, 2] } },
      ],
      portals: [
        {
          id: "left-middle",
          fromRegionId: "left",
          toRegionId: "middle",
          linkId: "left-middle",
          bounds: { min: [-4, -1, 0], max: [-4, 1, 2] },
        },
        {
          id: "middle-right",
          fromRegionId: "middle",
          toRegionId: "right",
          linkId: "middle-right",
          bounds: { min: [4, -1, 0], max: [4, 1, 2] },
        },
      ],
      pvs: { projection: "xy" },
    });
    const broad = resolvePolyWorldBspPvs(tree, "middle", { projection: "xy" });
    const view = resolvePolyWorldBspViewPvs(tree, {
      leafId: "middle",
      point: [0, 0, 1],
      forward: [-1, 0, 0],
      fovDegrees: 90,
      projection: "xy",
    });
    const trace = tracePolyWorldBspViewPvs(tree, {
      leafId: "middle",
      point: [0, 0, 1],
      forward: [-1, 0, 0],
      fovDegrees: 90,
      projection: "xy",
    });
    const selection = selectPolyWorldBspViewPvs(topology, tree, {
      point: [0, 0, 1],
      forward: [-1, 0, 0],
      fovDegrees: 90,
      projection: "xy",
    });
    const resolution = resolvePolyWorldElements(topology, selection);

    expect(broad.regionIds).toEqual(["left", "middle", "right"]);
    expect(view.broadPhaseLeafIds).toEqual(["left", "middle", "right"]);
    expect(view.regionIds).toEqual(["left", "middle"]);
    expect(view.regionIds).not.toContain("right");
    expect(view.portalIds).toEqual(["left-middle"]);
    expect(trace.regionIds).toEqual(view.regionIds);
    expect(trace.entries.map((entry) => [entry.portalId, entry.fromLeafId, entry.toLeafId, entry.status])).toEqual([
      ["left-middle", "middle", "left", "visible"],
      ["middle-right", "middle", "right", "clipped"],
    ]);
    expect(trace.entries[0]).toMatchObject({
      inputVertexCount: 4,
      clippedVertexCount: 4,
      clipPlaneCount: 9,
      linkId: "left-middle",
    });
    expect(selection.regionIds).toEqual(["middle", "left"]);
    expect(selection.reasons?.find((reason) => reason.kind === "viewPvs")?.data).toMatchObject({
      leafId: "middle",
      leafIds: ["left", "middle"],
      broadPhaseLeafIds: ["left", "middle", "right"],
    });
    expect(resolution.elementIds).toEqual(["left-shell", "middle-shell"]);
  });

  it("resolves a complete BSP visibility frame for authored-world camera updates", () => {
    const topology = createPolyWorldTopology({
      regions: [
        { id: "left" },
        { id: "middle" },
        { id: "right" },
      ],
      links: [
        { id: "left-middle", fromRegionId: "left", toRegionId: "middle", selectionKeys: ["portal:left-middle"] },
        { id: "middle-right", fromRegionId: "middle", toRegionId: "right", selectionKeys: ["portal:middle-right"] },
      ],
      elements: [
        { id: "left-shell", regionIds: ["left"], layers: ["world"] },
        { id: "middle-shell", regionIds: ["middle"], layers: ["world"] },
        { id: "right-shell", regionIds: ["right"], layers: ["world"] },
      ],
    });
    const tree = compilePolyWorldBsp({
      regions: [
        { id: "left", bounds: { min: [-8, -2, 0], max: [-4, 2, 2] } },
        { id: "middle", bounds: { min: [-4, -2, 0], max: [4, 2, 2] } },
        { id: "right", bounds: { min: [4, -2, 0], max: [8, 2, 2] } },
      ],
      portals: [
        {
          id: "left-middle",
          fromRegionId: "left",
          toRegionId: "middle",
          linkId: "left-middle",
          bounds: { min: [-4, -1, 0], max: [-4, 1, 2] },
        },
        {
          id: "middle-right",
          fromRegionId: "middle",
          toRegionId: "right",
          linkId: "middle-right",
          bounds: { min: [4, -1, 0], max: [4, 1, 2] },
        },
      ],
      pvs: { projection: "xy" },
    });

    const visibility = resolvePolyWorldBspVisibility(topology, tree, {
      leafId: "middle",
      point: [0, 0, 1],
      forward: [-1, 0, 0],
      fovDegrees: 90,
      projection: "xy",
      includeTrace: true,
      debug: { listLimit: 2 },
    });
    const fallback = resolvePolyWorldBspVisibility(topology, tree, {
      point: [99, 99, 1],
      forward: [-1, 0, 0],
      fovDegrees: 90,
      projection: "xy",
      regionIds: ["right"],
      debug: false,
    });

    expect(visibility.leaf?.leafId).toBe("middle");
    expect(visibility.broadPvs?.regionIds).toEqual(["left", "middle", "right"]);
    expect(visibility.viewPvs?.regionIds).toEqual(["left", "middle"]);
    expect(visibility.selection.regionIds).toEqual(["middle", "left"]);
    expect(visibility.trace?.entries.map((entry) => [entry.portalId, entry.status])).toEqual([
      ["left-middle", "visible"],
      ["middle-right", "clipped"],
    ]);
    expect(visibility.debug?.current.broadPvs?.regionIds).toEqual({
      values: ["left", "middle"],
      count: 3,
      omitted: 1,
    });
    expect(visibility.debug?.trace?.statusCounts).toEqual({
      visible: 1,
      clipped: 1,
    });
    expect(fallback.leaf).toBeUndefined();
    expect(fallback.selection.regionIds).toEqual(["right"]);
    expect(fallback.debug).toBeUndefined();
  });

  it("plans a BSP visibility frame into state diff and layer actions", () => {
    const topology = createPolyWorldTopology({
      regions: [
        { id: "left" },
        { id: "middle" },
        { id: "right" },
      ],
      links: [
        { id: "left-middle", fromRegionId: "left", toRegionId: "middle" },
        { id: "middle-right", fromRegionId: "middle", toRegionId: "right" },
      ],
      elements: [
        { id: "left-front-surface", selectionKeys: ["surface:left-front"], layers: ["render"], resourceIds: ["mesh:left-front"] },
        { id: "left-side-surface", selectionKeys: ["surface:left-side"], layers: ["render"] },
        { id: "right-surface", selectionKeys: ["surface:right"], layers: ["render"] },
      ],
    });
    const tree = compilePolyWorldBsp({
      regions: [
        { id: "left", bounds: { min: [-8, -2, 0], max: [-4, 2, 2] } },
        { id: "middle", bounds: { min: [-4, -2, 0], max: [4, 2, 2] } },
        { id: "right", bounds: { min: [4, -2, 0], max: [8, 2, 2] } },
      ],
      portals: [
        {
          id: "left-middle",
          fromRegionId: "left",
          toRegionId: "middle",
          bounds: { min: [-4, -1, 0], max: [-4, 1, 2] },
        },
        {
          id: "middle-right",
          fromRegionId: "middle",
          toRegionId: "right",
          bounds: { min: [4, -1, 0], max: [4, 1, 2] },
        },
      ],
      pvs: { projection: "xy" },
    });
    const previousState = createPolyWorldState(topology, { selection: { regionIds: ["middle", "right"] } });
    const surfaces = [
      {
        id: "left-front",
        elementId: "left-front-surface",
        regionId: "left",
        vertices: [[-5, -0.5, 0], [-5, 0.5, 0], [-5, 0.5, 2], [-5, -0.5, 2]],
      },
      {
        id: "left-side",
        elementId: "left-side-surface",
        regionId: "left",
        vertices: [[-5, 1.6, 0], [-5, 1.9, 0], [-5, 1.9, 2], [-5, 1.6, 2]],
      },
      {
        id: "right",
        elementId: "right-surface",
        regionId: "right",
        vertices: [[5, -0.5, 0], [5, 0.5, 0], [5, 0.5, 2], [5, -0.5, 2]],
      },
    ] as const;
    const surfaceElements = resolvePolyWorldBspViewSurfaceElements(tree, {
      leafId: "middle",
      point: [0, 0, 1],
      forward: [-1, 0, 0],
      fovDegrees: 24,
      projection: "xy",
      surfaces,
    });

    const frame = planPolyWorldBspVisibilityFrame(topology, tree, {
      previousState,
      policies: [{ id: "render", layer: "render", elementLayers: ["render"] }],
      leafId: "middle",
      point: [0, 0, 1],
      forward: [-1, 0, 0],
      fovDegrees: 24,
      projection: "xy",
      surfaces,
      includeTrace: true,
      debug: { listLimit: 3 },
      planDebug: { includeEntries: true, listLimit: 3 },
      readiness: {
        resources: {
          "mesh:left-front": "stale",
          "mesh:right": "failed",
        },
      },
    });

    expect(frame.visibility.viewPvs?.regionIds).toEqual(["left", "middle"]);
    expect(frame.artifact).toMatchObject({
      profile: "bsp-pvs",
      artifactKind: "compiled-bsp-pvs",
      sourceKind: "compiled",
      producedBy: "bounds-bsp",
      counts: {
        leafCount: 3,
        portalCount: 2,
      },
    });
    expect(frame.artifact.guarantees).toContain("pvs-metadata-decode-audit");
    expect(surfaceElements.elementIds).toEqual(["left-front-surface"]);
    expect(surfaceElements.structuralElementIds).toEqual([]);
    expect(surfaceElements.detailElementIds).toEqual(["left-front-surface"]);
    expect(frame.surfaceElements?.elementIds).toEqual(["left-front-surface"]);
    expect(frame.visibilitySets).toEqual({
      currentLeafId: "middle",
      broadPvsLeafIds: ["left", "middle", "right"],
      viewPvsLeafIds: ["left", "middle"],
      structuralSurfaceIds: [],
      structuralElementIds: [],
      detailSurfaceIds: ["left-front"],
      detailElementIds: ["left-front-surface"],
      plannedElementIds: ["left-front-surface"],
    });
    expect(frame.frameSummary).toMatchObject({
      profile: "bsp-pvs",
      artifactKind: "compiled-bsp-pvs",
      current: {
        leafIds: ["middle"],
        regionIds: ["middle"],
      },
      broad: {
        leafIds: ["left", "middle", "right"],
      },
      view: {
        leafIds: ["left", "middle"],
        surfaceIds: ["left-front"],
        elementIds: ["left-front-surface"],
      },
      planning: {
        elementIds: ["left-front-surface"],
      },
      readiness: {
        resourceIds: ["mesh:left-front"],
        staleResourceIds: ["mesh:left-front"],
        blockedElementIds: ["left-front-surface"],
      },
      plan: {
        plannedElementIds: ["left-front-surface"],
        blockedElementIds: [],
      },
    });
    expect(frame.planningSelection?.elementIds).toEqual(["left-front-surface"]);
    expect(frame.readiness?.resourceIds).toEqual(["mesh:left-front"]);
    expect(frame.readiness?.staleResourceIds).toEqual(["mesh:left-front"]);
    expect(frame.readiness?.blockedElementIds).toEqual(["left-front-surface"]);
    expect(frame.debug?.planningSelection?.elementIds).toEqual(["left-front-surface"]);
    expect(frame.nextState.resolvedElementIds).toEqual(["left-front-surface"]);
    expect(frame.diff.resolvedElements.added).toEqual(["left-front-surface"]);
    expect(frame.diff.resolvedElements.removed).toEqual([]);
    expect(frame.diff.resolvedElements.retained).toEqual([]);
    expect(frame.plan.actionCounts).toEqual({
      show: 1,
      hide: 0,
      retain: 0,
      preload: 0,
      noop: 0,
    });
    expect(frame.debug?.plan.entryCount).toBe(1);
  });

  it("uses the partition-gallery fixture for broad PVS, view PVS, and structural retention", () => {
    const fixture = createPolyWorldPartitionGalleryFixture();
    const previousState = createPolyWorldState(fixture.topology);
    const frame = planPolyWorldBspVisibilityFrame(fixture.topology, fixture.tree, {
      previousState,
      policies: [{ id: "render-world", layer: "world", elementLayers: ["world"] }],
      leafId: "gallery",
      point: fixture.points.gallery,
      forward: fixture.points.westView,
      up: [0, 0, 1],
      aspect: 1,
      fovDegrees: 68,
      projection: "xy",
      includeTrace: true,
      surfaces: fixture.surfaces,
      readiness: {
        resources: {},
        resourceDeclarations: fixture.documentInput.resources,
      },
      debug: { listLimit: 12 },
    });

    expect(frame.visibility.broadPvs?.regionIds).toEqual(fixture.expected.broadFromGallery);
    expect(frame.visibility.viewPvs?.regionIds).toEqual(fixture.expected.westViewRegions);
    expect(frame.visibilitySets.structuralSurfaceIds).toEqual(expect.arrayContaining([
      "studio-floor",
      "studio-ceiling",
      "gallery-floor",
      "gallery-ceiling",
      "gallery-opening-frame",
    ]));
    expect(frame.visibilitySets.detailSurfaceIds).not.toContain("vault-prop");
    expect(frame.frameSummary.broad.regionIds).toEqual(fixture.expected.summaryBroadFromGallery);
    expect(frame.frameSummary.view.regionIds).toEqual(fixture.expected.summaryWestViewRegions);
    expect(frame.frameSummary.retained.surfaceIds).toEqual(expect.arrayContaining([
      "studio-floor",
      "gallery-ceiling",
    ]));
    expect(frame.readiness?.renderBlockingResourceIds).toEqual(expect.arrayContaining([
      "mesh:studio-floor-element",
      "mesh:gallery-ceiling-element",
    ]));
    expect(frame.readiness?.staleResourceIds).toEqual([
      "mesh:gallery-prop-element",
      "mesh:studio-prop-element",
    ]);
    expect(frame.readiness?.nonBlockingResourceIds).toEqual([
      "mesh:gallery-prop-element",
      "mesh:studio-prop-element",
    ]);
    expect(frame.readiness?.blockedResourceIds).toEqual([]);
    expect(frame.loadSet?.requestResourceIds).toEqual([
      "mesh:gallery-prop-element",
      "mesh:studio-prop-element",
    ]);
    expect(frame.frameSummary.loadSet?.requestResourceIds).toEqual([
      "mesh:gallery-prop-element",
      "mesh:studio-prop-element",
    ]);
    expect(frame.artifact.guarantees).toContain("portal-clipped-baked-pvs");
    expect(frame.artifact.knownWeaknesses).toContain("not-full-qbsp-vis-parity");
  });

  it("keeps large floor and ceiling surfaces when the view footprint is inside the polygon", () => {
    const tree = createPolyWorldBspTree({
      root: { leafId: "room" },
      leaves: [
        {
          id: "room",
          regionId: "room",
          bounds: { min: [-16, -16, 0], max: [16, 16, 3] },
        },
      ],
    });
    const floor = {
      id: "floor",
      elementId: "floor-surface",
      regionId: "room",
      vertices: [[-16, -16, 0], [16, -16, 0], [16, 16, 0], [-16, 16, 0]],
    } as const;
    const ceiling = {
      id: "ceiling",
      elementId: "ceiling-surface",
      regionId: "room",
      vertices: [[-16, -16, 3], [-16, 16, 3], [16, 16, 3], [16, -16, 3]],
    } as const;

    expect(resolvePolyWorldBspViewSurfaceElements(tree, {
      point: [0, 0, 1.2],
      forward: [1, 0, -0.35],
      fovDegrees: 48,
      surfaces: [floor],
    }).elementIds).toEqual(["floor-surface"]);
    expect(resolvePolyWorldBspViewSurfaceElements(tree, {
      point: [0, 0, 1.2],
      forward: [1, 0, 0.35],
      fovDegrees: 48,
      surfaces: [ceiling],
    }).elementIds).toEqual(["ceiling-surface"]);
  });

  it("keeps BSP leaf-owned surfaces by visible leaf membership", () => {
    const tree = createPolyWorldBspTree({
      root: { leafId: "room" },
      leaves: [
        {
          id: "room",
          regionId: "room",
          bounds: { min: [-8, -8, 0], max: [8, 8, 3] },
        },
      ],
    });
    const vertices = [[-4, 7, 0], [-3, 7, 0], [-3, 7, 2], [-4, 7, 2]] as const;

    expect(resolvePolyWorldBspViewSurfaceElements(tree, {
      point: [0, 0, 1],
      forward: [-1, 0, 0],
      fovDegrees: 16,
      projection: "xy",
      surfaces: [
        {
          id: "leaf-side",
          elementId: "leaf-side-surface",
          regionId: "room",
          leafId: "room",
          vertices,
        },
        {
          id: "generic-side",
          elementId: "generic-side-surface",
          regionId: "room",
          vertices,
        },
      ],
    }).elementIds).toEqual(["leaf-side-surface"]);
  });

  it("keeps structural BSP surfaces by visible leaf while clipping detail surfaces", () => {
    const tree = createPolyWorldBspTree({
      root: { leafId: "room" },
      leaves: [
        {
          id: "room",
          regionId: "room",
          bounds: { min: [-8, -8, 0], max: [8, 8, 3] },
        },
      ],
    });
    const behindCameraWall = [[7, -1, 0], [7, 1, 0], [7, 1, 2], [7, -1, 2]] as const;

    const result = resolvePolyWorldBspViewSurfaceElements(tree, {
      point: [0, 0, 1],
      forward: [-1, 0, 0],
      fovDegrees: 24,
      projection: "xy",
      surfaces: [
        {
          id: "structural-wall",
          elementId: "structural-wall-surface",
          regionId: "room",
          visibility: "structural",
          vertices: behindCameraWall,
        },
        {
          id: "detail-wall",
          elementId: "detail-wall-surface",
          regionId: "room",
          visibility: "detail",
          vertices: behindCameraWall,
        },
      ],
    });

    expect(result.elementIds).toEqual(["structural-wall-surface"]);
    expect(result.structuralSurfaceIds).toEqual(["structural-wall"]);
    expect(result.structuralElementIds).toEqual(["structural-wall-surface"]);
    expect(result.detailSurfaceIds).toEqual([]);
    expect(result.detailElementIds).toEqual([]);
  });

  it("uses BSP surface roles to keep openings stable while clipping props", () => {
    const tree = createPolyWorldBspTree({
      root: { leafId: "room" },
      leaves: [
        {
          id: "room",
          regionId: "room",
          bounds: { min: [-8, -8, 0], max: [8, 8, 3] },
        },
      ],
    });
    const behindCameraWall = [[7, -1, 0], [7, 1, 0], [7, 1, 2], [7, -1, 2]] as const;
    const result = resolvePolyWorldBspViewSurfaceElements(tree, {
      point: [0, 0, 1],
      forward: [-1, 0, 0],
      fovDegrees: 24,
      projection: "xy",
      surfaces: [
        {
          id: "door-frame",
          elementId: "door-frame-surface",
          regionId: "room",
          role: "opening",
          vertices: behindCameraWall,
        },
        {
          id: "crate",
          elementId: "crate-surface",
          regionId: "room",
          role: "prop",
          vertices: behindCameraWall,
        },
      ],
    });

    expect(result.elementIds).toEqual(["door-frame-surface"]);
    expect(result.structuralSurfaceIds).toEqual(["door-frame"]);
    expect(result.structuralElementIds).toEqual(["door-frame-surface"]);
    expect(result.detailSurfaceIds).toEqual([]);
    expect(result.detailElementIds).toEqual([]);
    expect(result.roles).toEqual([
      {
        role: "opening",
        count: 1,
        surfaceIds: ["door-frame"],
        elementIds: ["door-frame-surface"],
      },
    ]);
  });

  it("clips BSP view PVS in 3D instead of only by projected yaw", () => {
    const tree = bakePolyWorldBspPvs(createPolyWorldBspTree({
      root: {
        id: "split-middle",
        plane: { normal: [1, 0, 0], distance: -3 },
        front: { leafId: "middle" },
        back: {
          id: "split-front-high",
          plane: { normal: [0, 0, 1], distance: 5 },
          front: { leafId: "high" },
          back: { leafId: "front" },
        },
      },
      leaves: [
        { id: "middle", regionId: "middle", center: [0, 0, 1] },
        { id: "front", regionId: "front", center: [-6, 0, 1] },
        { id: "high", regionId: "high", center: [-6, 0, 9] },
      ],
      portals: [
        {
          id: "middle-front",
          fromLeafId: "middle",
          toLeafId: "front",
          vertices: [[-4, -1, 0], [-4, 1, 0], [-4, 1, 2], [-4, -1, 2]],
        },
        {
          id: "middle-high",
          fromLeafId: "middle",
          toLeafId: "high",
          vertices: [[-4, -1, 8], [-4, 1, 8], [-4, 1, 10], [-4, -1, 10]],
        },
      ],
    }), { projection: "xy" });

    const broad = resolvePolyWorldBspPvs(tree, "middle", { projection: "xy" });
    const view = resolvePolyWorldBspViewPvs(tree, {
      leafId: "middle",
      point: [0, 0, 1],
      forward: [-1, 0, 0],
      up: [0, 0, 1],
      aspect: 1,
      fovDegrees: 60,
      projection: "xy",
    });

    expect(broad.regionIds).toEqual(["middle", "front", "high"]);
    expect(view.regionIds).toEqual(["middle", "front"]);
    expect(view.regionIds).not.toContain("high");
    expect(view.portalIds).toEqual(["middle-front"]);
  });

  it("canonicalizes unordered manual BSP portal vertices before 3D PVS traversal", () => {
    const tree = bakePolyWorldBspPvs(createPolyWorldBspTree({
      root: {
        id: "split-middle-front",
        plane: { normal: [1, 0, 0], distance: -3 },
        front: { leafId: "middle" },
        back: { leafId: "front" },
      },
      leaves: [
        { id: "middle", regionId: "middle", center: [0, 0, 1] },
        { id: "front", regionId: "front", center: [-6, 0, 1] },
      ],
      portals: [
        {
          id: "middle-front",
          fromLeafId: "middle",
          toLeafId: "front",
          vertices: [[-4, 1, 2], [-4, -1, 0], [-4, -1, 2], [-4, 1, 0]],
        },
      ],
    }), { projection: "xy" });

    const view = resolvePolyWorldBspViewPvs(tree, {
      leafId: "middle",
      point: [0, 0, 1],
      forward: [-1, 0, 0],
      fovDegrees: 70,
      projection: "xy",
    });

    expect(tree.portalsById.get("middle-front")?.vertices).toEqual([
      [-4, -1, 0],
      [-4, -1, 2],
      [-4, 1, 2],
      [-4, 1, 0],
    ]);
    expect(view.regionIds).toEqual(["middle", "front"]);
    expect(view.portalIds).toEqual(["middle-front"]);
  });

  it("filters baked BSP PVS through dynamic portal state", () => {
    const topology = createPolyWorldTopology({
      regions: [
        { id: "left" },
        { id: "middle" },
        { id: "right" },
      ],
      links: [
        { id: "left-middle", fromRegionId: "left", toRegionId: "middle", selectionKeys: ["portal:left-middle"] },
        { id: "middle-right", fromRegionId: "middle", toRegionId: "right", selectionKeys: ["portal:middle-right"] },
      ],
      elements: [
        { id: "left-shell", regionIds: ["left"], layers: ["world"] },
        { id: "middle-shell", regionIds: ["middle"], layers: ["world"] },
        { id: "right-shell", regionIds: ["right"], layers: ["world"] },
      ],
    });
    const tree = compilePolyWorldBsp({
      regions: [
        { id: "left", bounds: { min: [-8, -2, 0], max: [-4, 2, 2] } },
        { id: "middle", bounds: { min: [-4, -2, 0], max: [4, 2, 2] } },
        { id: "right", bounds: { min: [4, -2, 0], max: [8, 2, 2] } },
      ],
      portals: [
        {
          id: "portal-left-middle",
          fromRegionId: "left",
          toRegionId: "middle",
          linkId: "left-middle",
          bounds: { min: [-4, -1, 0], max: [-4, 1, 2] },
        },
        {
          id: "portal-middle-right",
          fromRegionId: "middle",
          toRegionId: "right",
          linkId: "middle-right",
          bounds: { min: [4, -1, 0], max: [4, 1, 2] },
        },
      ],
      pvs: { projection: "xy" },
    });

    const baked = resolvePolyWorldBspPvs(tree, "middle", { projection: "xy" });
    const closed = resolvePolyWorldBspViewPvs(tree, {
      leafId: "middle",
      point: [0, 0, 1],
      forward: [-1, 0, 0],
      fovDegrees: 90,
      projection: "xy",
      portalState: { "left-middle": "closed" },
    });
    const closedTrace = tracePolyWorldBspViewPvs(tree, {
      leafId: "middle",
      point: [0, 0, 1],
      forward: [-1, 0, 0],
      fovDegrees: 90,
      projection: "xy",
      portalState: { "left-middle": "closed" },
    });
    const selection = selectPolyWorldBspViewPvs(topology, tree, {
      leafId: "middle",
      point: [0, 0, 1],
      forward: [-1, 0, 0],
      fovDegrees: 90,
      projection: "xy",
      portalState: { "left-middle": false },
    });
    const resolution = resolvePolyWorldElements(topology, selection);

    expect(baked.regionIds).toEqual(["left", "middle", "right"]);
    expect(closed.regionIds).toEqual(["middle"]);
    expect(closed.portalIds).toEqual([]);
    expect(closedTrace.entries.map((entry) => [entry.portalId, entry.status])).toEqual([
      ["portal-left-middle", "closed"],
      ["portal-middle-right", "clipped"],
    ]);
    expect(resolution.elementIds).toEqual(["middle-shell"]);
  });

  it("distinguishes blocked BSP portals and depth-capped traversal in traces", () => {
    const tree = compilePolyWorldBsp({
      regions: [
        { id: "left", bounds: { min: [-8, -2, 0], max: [-4, 2, 2] } },
        { id: "middle", bounds: { min: [-4, -2, 0], max: [4, 2, 2] } },
        { id: "right", bounds: { min: [4, -2, 0], max: [8, 2, 2] } },
      ],
      portals: [
        {
          id: "portal-left-middle",
          fromRegionId: "left",
          toRegionId: "middle",
          linkId: "left-middle",
          bounds: { min: [-4, -1, 0], max: [-4, 1, 2] },
        },
        {
          id: "portal-middle-right",
          fromRegionId: "middle",
          toRegionId: "right",
          linkId: "middle-right",
          bounds: { min: [4, -1, 0], max: [4, 1, 2] },
        },
      ],
      pvs: { projection: "xy" },
    });

    const blockedTrace = tracePolyWorldBspViewPvs(tree, {
      leafId: "middle",
      point: [0, 0, 1],
      forward: [-1, 0, 0],
      fovDegrees: 90,
      projection: "xy",
      portalState: { "left-middle": "blocked" },
    });
    const depthCappedTrace = tracePolyWorldBspViewPvs(tree, {
      leafId: "left",
      point: [-6, 0, 1],
      forward: [1, 0, 0],
      fovDegrees: 360,
      projection: "xy",
      maxDepth: 1,
    });

    expect(blockedTrace.regionIds).toEqual(["middle"]);
    expect(blockedTrace.entries.map((entry) => [entry.portalId, entry.status])).toEqual([
      ["portal-left-middle", "blocked"],
      ["portal-middle-right", "clipped"],
    ]);
    expect(depthCappedTrace.regionIds).toEqual(["left", "middle"]);
    expect(depthCappedTrace.entries.map((entry) => [entry.portalId, entry.fromLeafId, entry.toLeafId, entry.depth, entry.status])).toEqual([
      ["portal-left-middle", "left", "middle", 0, "visible"],
      ["portal-middle-right", "middle", "right", 1, "depth-capped"],
    ]);
  });

  it("reports portals outside the baked broad phase during deeper view traces", () => {
    const tree = compilePolyWorldBsp({
      regions: [
        { id: "far", bounds: { min: [-12, -2, 0], max: [-8, 2, 2] } },
        { id: "left", bounds: { min: [-8, -2, 0], max: [-4, 2, 2] } },
        { id: "middle", bounds: { min: [-4, -2, 0], max: [4, 2, 2] } },
      ],
      portals: [
        {
          id: "middle-left",
          fromRegionId: "middle",
          toRegionId: "left",
          linkId: "middle-left",
          bounds: { min: [-4, -1, 0], max: [-4, 1, 2] },
        },
        {
          id: "left-far",
          fromRegionId: "left",
          toRegionId: "far",
          linkId: "left-far",
          bounds: { min: [-8, -1, 0], max: [-8, 1, 2] },
        },
      ],
      pvs: { projection: "xy", maxDepth: 1 },
    });

    const baked = resolvePolyWorldBspBakedPvs(tree, "middle");
    const trace = tracePolyWorldBspViewPvs(tree, {
      leafId: "middle",
      point: [0, 0, 1],
      forward: [-1, 0, 0],
      fovDegrees: 360,
      projection: "xy",
      maxDepth: 4,
    });
    const debug = createPolyWorldBspDebugSnapshot(tree, {
      trace,
      includeTraceEntries: true,
    });

    expect(baked?.leafIds).toEqual(["left", "middle"]);
    expect(trace.regionIds).toEqual(["left", "middle"]);
    expect(trace.entries.map((entry) => [entry.portalId, entry.fromLeafId, entry.toLeafId, entry.status])).toEqual([
      ["middle-left", "middle", "left", "visible"],
      ["left-far", "left", "far", "outside-broad-phase"],
    ]);
    expect(debug.trace?.statusCounts).toEqual({
      visible: 1,
      "outside-broad-phase": 1,
    });
    expect(debug.trace?.entries?.map((entry) => [entry.portalId, entry.status])).toEqual([
      ["middle-left", "visible"],
      ["left-far", "outside-broad-phase"],
    ]);
  });

  it("rejects malformed BSP portal graphs", () => {
    expect(() =>
      createPolyWorldBspTree({
        root: { leafId: "a" },
        leaves: [{ id: "a" }],
        portals: [
          {
            id: "bad-portal",
            fromLeafId: "a",
            toLeafId: "missing",
            vertices: [[0, 0, 0]],
          },
        ],
      }),
    ).toThrow(PolyWorldBspError);
    expect(() =>
      createPolyWorldBspTree({
        root: { leafId: "a" },
        leaves: [{ id: "a" }, { id: "b" }],
        portals: [
          {
            id: "non-coplanar",
            fromLeafId: "a",
            toLeafId: "b",
            vertices: [[0, 0, 0], [1, 0, 0], [1, 1, 0.2], [0, 1, 0]],
          },
        ],
      }),
    ).toThrow(PolyWorldBspError);
    expect(() =>
      createPolyWorldBspTree({
        root: { leafId: "a" },
        leaves: [{ id: "a" }, { id: "b" }],
        portals: [
          {
            id: "concave",
            fromLeafId: "a",
            toLeafId: "b",
            vertices: [[0, 0, 0], [2, 0, 0], [1, 1, 0], [2, 2, 0], [0, 2, 0]],
          },
        ],
      }),
    ).toThrow(PolyWorldBspError);
  });

  it("certifies malformed BSP topology without throwing so debug can report failed guarantees", () => {
    const certification = certifyPolyWorldBspTopology({
      root: { leafId: "a" },
      leaves: [{ id: "a" }, { id: "orphan" }],
      portals: [],
      leavesById: new Map([
        ["a", { id: "a" }],
        ["orphan", { id: "orphan" }],
      ]),
      portalsById: new Map(),
      portalsByLeafId: new Map(),
    });

    expect(certification.certified).toBe(false);
    expect(certification.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      "poly-world-unreferenced-bsp-leaf",
      "poly-world-unreachable-bsp-leaf",
    ]);
    expect(certification.proof.artifact.guarantees).toEqual([]);
    expect(certification.proof.artifact.knownWeaknesses).toContain("bsp-certification-failed");
    expect(certification.proof.pvs.level).toBe("uncertified");
    expect(certification.proof.artifact.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      "poly-world-unreferenced-bsp-leaf",
      "poly-world-unreachable-bsp-leaf",
    ]);
  });

  it("rejects BSP leaves that cannot be reached from the root or portal graph", () => {
    const diagnostics = expectBspErrorCodes(() =>
      createPolyWorldBspTree({
        root: { leafId: "a" },
        leaves: [{ id: "a" }, { id: "orphan" }],
      }), ["poly-world-unreachable-bsp-leaf"]);

    expect(diagnostics.find((diagnostic) => diagnostic.code === "poly-world-unreachable-bsp-leaf")).toMatchObject({
      id: "orphan",
    });
  });

  it("rejects BSP roots that do not reference each leaf exactly once", () => {
    const diagnostics = expectBspErrorCodes(() =>
      createPolyWorldBspTree({
        root: {
          id: "duplicate-root",
          plane: { normal: [1, 0, 0], distance: 0 },
          back: { leafId: "a" },
          front: { leafId: "a" },
        },
        leaves: [
          { id: "a", bounds: { min: [-1, -1, 0], max: [0, 1, 1] } },
          { id: "b", bounds: { min: [0, -1, 0], max: [1, 1, 1] } },
        ],
        portals: [
          {
            id: "a-b",
            fromLeafId: "a",
            toLeafId: "b",
            vertices: [[0, -1, 0], [0, 1, 0], [0, 1, 1], [0, -1, 1]],
          },
        ],
      }), [
      "poly-world-duplicate-bsp-leaf-ref",
      "poly-world-unreferenced-bsp-leaf",
    ]);

    expect(diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: "poly-world-duplicate-bsp-leaf-ref",
        id: "a",
        field: "root",
      }),
      expect.objectContaining({
        code: "poly-world-unreferenced-bsp-leaf",
        id: "b",
        field: "root",
      }),
    ]));
  });

  it("rejects stale BSP PVS indices and bitsets with mismatched widths", () => {
    expectBspErrorCodes(() =>
      createPolyWorldBspTree({
        root: {
          id: "split",
          plane: { normal: [1, 0, 0], distance: 0 },
          back: { leafId: "a" },
          front: { leafId: "b" },
        },
        leaves: [
          {
            id: "a",
            pvs: {
              leafBits: new Uint32Array(0),
              portalBits: new Uint32Array(0),
              regionIds: [],
              linkIds: [],
              selectionKeys: [],
              elementIds: [],
            },
          },
          { id: "b" },
        ],
        portals: [
          {
            id: "ab",
            fromLeafId: "a",
            toLeafId: "b",
            vertices: [[0, -1, 0], [0, 1, 0], [0, 1, 1], [0, -1, 1]],
          },
        ],
        pvsIndex: {
          leafIds: ["a", "b"],
          portalIds: ["ab"],
          leafIndexById: new Map([["a", 1], ["b", 0]]),
          portalIndexById: new Map([["ab", 0]]),
        },
      }), [
      "poly-world-invalid-bsp-pvs-index-leaf-map",
      "poly-world-invalid-bsp-pvs-leaf-bits-length",
      "poly-world-invalid-bsp-pvs-portal-bits-length",
    ]);
  });

  it("rejects baked BSP PVS metadata that disagrees with decoded bitsets", () => {
    expectBspErrorCodes(() =>
      createPolyWorldBspTree({
        root: {
          id: "split",
          plane: { normal: [1, 0, 0], distance: 0 },
          back: { leafId: "a" },
          front: { leafId: "b" },
        },
        leaves: [
          {
            id: "a",
            regionId: "room-a",
            elementIds: ["room-a-shell"],
            pvs: {
              leafBits: new Uint32Array([1]),
              portalBits: new Uint32Array([0]),
              regionIds: ["room-b"],
              linkIds: ["a-b"],
              selectionKeys: ["portal:a-b"],
              elementIds: ["stale-shell"],
            },
          },
          { id: "b", regionId: "room-b", elementIds: ["room-b-shell"] },
        ],
        portals: [
          {
            id: "a-b",
            fromLeafId: "a",
            toLeafId: "b",
            linkId: "a-b",
            selectionKeys: ["portal:a-b"],
            vertices: [[0, -1, 0], [0, 1, 0], [0, 1, 1], [0, -1, 1]],
          },
        ],
        pvsIndex: {
          leafIds: ["a", "b"],
          portalIds: ["a-b"],
          leafIndexById: new Map([["a", 0], ["b", 1]]),
          portalIndexById: new Map([["a-b", 0]]),
        },
      }), [
      "poly-world-bsp-pvs-region-ids-metadata-mismatch",
      "poly-world-bsp-pvs-link-ids-metadata-mismatch",
      "poly-world-bsp-pvs-selection-keys-metadata-mismatch",
      "poly-world-bsp-pvs-element-ids-metadata-mismatch",
    ]);
  });

  it("rejects baked BSP PVS bitsets that do not match portal reachability", () => {
    expectBspErrorCodes(() =>
      createPolyWorldBspTree({
        root: {
          id: "split-a",
          plane: { normal: [1, 0, 0], distance: 0 },
          back: { leafId: "a" },
          front: {
            id: "split-b",
            plane: { normal: [1, 0, 0], distance: 1 },
            back: { leafId: "b" },
            front: { leafId: "c" },
          },
        },
        leaves: [
          {
            id: "a",
            regionId: "room-a",
            elementIds: ["room-a-shell"],
            pvs: {
              leafBits: testBitset(3, [0, 2]),
              portalBits: testBitset(2, []),
              regionIds: ["room-a", "room-c"],
              linkIds: [],
              selectionKeys: [],
              elementIds: ["room-a-shell", "room-c-shell"],
            },
          },
          { id: "b", regionId: "room-b", elementIds: ["room-b-shell"] },
          { id: "c", regionId: "room-c", elementIds: ["room-c-shell"] },
        ],
        portals: [
          {
            id: "a-b",
            fromLeafId: "a",
            toLeafId: "b",
            linkId: "a-b",
            vertices: [[0, -1, 0], [0, 1, 0], [0, 1, 1], [0, -1, 1]],
          },
          {
            id: "b-c",
            fromLeafId: "b",
            toLeafId: "c",
            linkId: "b-c",
            vertices: [[1, -1, 0], [1, 1, 0], [1, 1, 1], [1, -1, 1]],
          },
        ],
        pvsIndex: createTestPvsIndex(["a", "b", "c"], ["a-b", "b-c"]),
      }), ["poly-world-bsp-pvs-unreachable-leaf"]);

    expectBspErrorCodes(() =>
      createPolyWorldBspTree({
        root: {
          id: "split",
          plane: { normal: [1, 0, 0], distance: 0 },
          back: { leafId: "a" },
          front: { leafId: "b" },
        },
        leaves: [
          {
            id: "a",
            regionId: "room-a",
            elementIds: ["room-a-shell"],
            pvs: {
              leafBits: testBitset(2, [1]),
              portalBits: testBitset(1, [0]),
              regionIds: ["room-b"],
              linkIds: ["a-b"],
              selectionKeys: [],
              elementIds: ["room-b-shell"],
            },
          },
          { id: "b", regionId: "room-b", elementIds: ["room-b-shell"] },
        ],
        portals: [
          {
            id: "a-b",
            fromLeafId: "a",
            toLeafId: "b",
            linkId: "a-b",
            vertices: [[0, -1, 0], [0, 1, 0], [0, 1, 1], [0, -1, 1]],
          },
        ],
        pvsIndex: createTestPvsIndex(["a", "b"], ["a-b"]),
      }), [
      "poly-world-bsp-pvs-missing-source-leaf",
      "poly-world-bsp-pvs-portal-outside-leaf-set",
    ]);

    expectBspErrorCodes(() =>
      createPolyWorldBspTree({
        root: {
          id: "split",
          plane: { normal: [1, 0, 0], distance: 0 },
          back: { leafId: "a" },
          front: { leafId: "b" },
        },
        leaves: [
          {
            id: "a",
            regionId: "room-a",
            elementIds: ["room-a-shell"],
            pvs: {
              leafBits: testBitset(2, [0]),
              portalBits: testBitset(1, []),
              regionIds: ["room-a"],
              linkIds: [],
              selectionKeys: [],
              elementIds: ["room-a-shell"],
            },
          },
          { id: "b", regionId: "room-b", elementIds: ["room-b-shell"] },
        ],
        portals: [
          {
            id: "a-b",
            fromLeafId: "a",
            toLeafId: "b",
            linkId: "a-b",
            vertices: [[0, -1, 0], [0, 1, 0], [0, 1, 1], [0, -1, 1]],
          },
        ],
        pvsIndex: createTestPvsIndex(["a", "b"], ["a-b"]),
      }), [
      "poly-world-bsp-pvs-missing-adjacent-portal",
      "poly-world-bsp-pvs-missing-adjacent-leaf",
    ]);
  });

  it("rejects BSP portals through solid leaves or outside adjacent leaf bounds", () => {
    expectBspErrorCodes(() =>
      createPolyWorldBspTree({
        root: {
          id: "split",
          plane: { normal: [1, 0, 0], distance: 0 },
          back: { leafId: "a" },
          front: { leafId: "b" },
        },
        leaves: [
          { id: "a", bounds: { min: [-1, -1, 0], max: [0, 1, 1] } },
          { id: "b", bounds: { min: [0, -1, 0], max: [1, 1, 1] }, data: { solid: true } },
        ],
        portals: [
          {
            id: "solid-portal",
            fromLeafId: "a",
            toLeafId: "b",
            vertices: [[0, -0.5, 0], [0, 0.5, 0], [0, 0.5, 1], [0, -0.5, 1]],
          },
        ],
      }), ["poly-world-bsp-portal-solid-leaf"]);

    expectBspErrorCodes(() =>
      createPolyWorldBspTree({
        root: {
          id: "split",
          plane: { normal: [1, 0, 0], distance: 0 },
          back: { leafId: "a" },
          front: { leafId: "b" },
        },
        leaves: [
          { id: "a", bounds: { min: [-1, -1, 0], max: [0, 1, 1] } },
          { id: "b", bounds: { min: [0, -1, 0], max: [1, 1, 1] } },
        ],
        portals: [
          {
            id: "offset-portal",
            fromLeafId: "a",
            toLeafId: "b",
            vertices: [[0.5, -0.5, 0], [0.5, 0.5, 0], [0.5, 0.5, 1], [0.5, -0.5, 1]],
          },
        ],
      }), [
      "poly-world-bsp-portal-vertices-outside-leaf-bounds",
      "poly-world-bsp-portal-not-on-shared-bounds-face",
    ]);
  });

  it("rejects malformed BSP compiler input", () => {
    expect(() =>
      compilePolyWorldBsp({
        regions: [
          { id: "a", bounds: { min: [0, 0, 0], max: [4, 4, 2] } },
        ],
        portals: [
          { id: "bad", fromRegionId: "a", toRegionId: "missing" },
        ],
      }),
    ).toThrow(PolyWorldBspError);
  });

  it("resolves a BSP leaf and selects its precomputed visibility set", () => {
    const topology = createPolyWorldTopology({
      regions: [
        { id: "left" },
        { id: "middle" },
        { id: "right" },
      ],
      links: [
        { id: "left-middle", fromRegionId: "left", toRegionId: "middle", selectionKeys: ["portal:left-middle"] },
        { id: "middle-right", fromRegionId: "middle", toRegionId: "right", selectionKeys: ["portal:middle-right"] },
      ],
      elements: [
        { id: "left-shell", regionIds: ["left"], layers: ["world"] },
        { id: "middle-shell", regionIds: ["middle"], layers: ["world"] },
        { id: "right-shell", regionIds: ["right"], layers: ["world"] },
        { id: "left-door", selectionKeys: ["portal:left-middle"], layers: ["world"] },
        { id: "right-door", selectionKeys: ["portal:middle-right"], layers: ["world"] },
      ],
    });
    const pvsIndex = createTestPvsIndex(["left-leaf", "middle-leaf", "right-leaf"], [
      "portal-left-middle",
      "portal-middle-right",
    ]);
    const tree = createPolyWorldBspTree({
      root: {
        id: "split-left",
        plane: { normal: [1, 0, 0], distance: -4 },
        back: { leafId: "left-leaf" },
        front: {
          id: "split-right",
          plane: { normal: [1, 0, 0], distance: 4 },
          back: { leafId: "middle-leaf" },
          front: { leafId: "right-leaf" },
        },
      },
      leaves: [
        {
          id: "left-leaf",
          regionId: "left",
          elementIds: ["left-shell"],
          pvs: {
            leafBits: testBitset(3, [0, 1]),
            portalBits: testBitset(2, [0]),
            regionIds: ["left", "middle"],
            linkIds: ["left-middle"],
            selectionKeys: ["portal:left-middle"],
            elementIds: ["left-shell", "middle-shell"],
          },
        },
        {
          id: "middle-leaf",
          regionId: "middle",
          elementIds: ["middle-shell"],
          pvs: {
            leafBits: testBitset(3, [0, 1, 2]),
            portalBits: testBitset(2, [0, 1]),
            regionIds: ["left", "middle", "right"],
            linkIds: ["left-middle", "middle-right"],
            selectionKeys: ["portal:left-middle", "portal:middle-right"],
            elementIds: ["left-shell", "middle-shell", "right-shell"],
          },
        },
        {
          id: "right-leaf",
          regionId: "right",
          elementIds: ["right-shell"],
          pvs: {
            leafBits: testBitset(3, [1, 2]),
            portalBits: testBitset(2, [1]),
            regionIds: ["middle", "right"],
            linkIds: ["middle-right"],
            selectionKeys: ["portal:middle-right"],
            elementIds: ["middle-shell", "right-shell"],
          },
        },
      ],
      portals: [
        {
          id: "portal-left-middle",
          fromLeafId: "left-leaf",
          toLeafId: "middle-leaf",
          linkId: "left-middle",
          selectionKeys: ["portal:left-middle"],
          vertices: [[-4, -1, 0], [-4, 1, 0], [-4, 1, 2], [-4, -1, 2]],
        },
        {
          id: "portal-middle-right",
          fromLeafId: "middle-leaf",
          toLeafId: "right-leaf",
          linkId: "middle-right",
          selectionKeys: ["portal:middle-right"],
          vertices: [[4, -1, 0], [4, 1, 0], [4, 1, 2], [4, -1, 2]],
        },
      ],
      pvsIndex,
    });

    const leaf = resolvePolyWorldBspLeaf(tree, [-5, 0, 0]);
    const selection = selectPolyWorldBspPvs(topology, tree, { point: [-5, 0, 0] });
    const resolution = resolvePolyWorldElements(topology, selection);

    expect(leaf?.leafId).toBe("left-leaf");
    expect(leaf?.path).toEqual(["split-left"]);
    expect(selection.regionIds).toEqual(["left", "middle"]);
    expect(selection.linkIds).toEqual(["left-middle"]);
    expect(selection.selectionKeys).toEqual(["portal:left-middle"]);
    expect(selection.reasons?.map((reason) => reason.label)).toEqual([
      "bsp-leaf",
      "pvs",
      "selection-key",
    ]);
    expect(resolution.elementIds).toEqual(["left-shell", "middle-shell", "left-door"]);
  });
});

describe("selectPolyWorldChunkWindow", () => {
  it("selects an ordered chunk window, active chunks, tagged regions, and region-derived selection keys", () => {
    const topology = createPolyWorldTopology({
      regions: [
        { id: "chunk-0" },
        { id: "chunk-1" },
        { id: "chunk-2" },
        { id: "chunk-3" },
        { id: "chunk-4" },
      ],
      elements: [
        { id: "road-1", regionIds: ["chunk-1"], layers: ["world"], tags: ["road"] },
        { id: "road-2", regionIds: ["chunk-2"], layers: ["world"], tags: ["road"] },
        { id: "road-3", regionIds: ["chunk-3"], layers: ["world"], tags: ["road"] },
        { id: "track-3", selectionKeys: ["track:chunk-3"], layers: ["track"], tags: ["source-track"] },
        {
          id: "shared-sky",
          regionIds: ["chunk-1", "chunk-2", "chunk-3"],
          regionMatch: "any",
          layers: ["sky"],
        },
      ],
    });

    const selection = selectPolyWorldChunkWindow(topology, {
      currentRegionId: "chunk-2",
      before: 1,
      after: 1,
      activeRegionIds: ["chunk-0"],
      taggedRegionSelections: [
        {
          kind: "overscan",
          label: "safety-overscan",
          regionIds: ["chunk-4"],
          tags: ["safety"],
          selectionKeys: ["track:chunk-3"],
        },
      ],
      regionSelectionKeys: {
        "chunk-1": ["section:1"],
        "chunk-2": ["section:2"],
        "chunk-3": ["section:3"],
      },
    });
    const resolution = resolvePolyWorldElements(topology, selection);

    expect(selection.regionIds).toEqual(["chunk-0", "chunk-2", "chunk-1", "chunk-3", "chunk-4"]);
    expect(selection.selectionKeys).toEqual(["track:chunk-3", "section:2", "section:1", "section:3"]);
    expect(selection.reasons?.map((reason) => reason.label)).toEqual([
      "active",
      "current",
      "window",
      "safety-overscan",
      "selection-key",
    ]);
    expect(resolution.elementIds).toEqual(["road-1", "road-2", "road-3", "track-3", "shared-sky"]);
  });

  it("selects streaming-source chunk ranges with separate loaded, resident, active, rendered, and preloaded sets", () => {
    const topology = createPolyWorldTopology({
      regions: [
        { id: "chunk-0", bounds: { min: [0, 0, 0], max: [1, 1, 1] }, selectionKeys: ["chunk:0"] },
        { id: "chunk-1", bounds: { min: [1, 0, 0], max: [2, 1, 1] }, selectionKeys: ["chunk:1"] },
        { id: "chunk-2", bounds: { min: [2, 0, 0], max: [3, 1, 1] }, selectionKeys: ["chunk:2"] },
        { id: "chunk-3", bounds: { min: [3, 0, 0], max: [4, 1, 1] }, selectionKeys: ["chunk:3"] },
        { id: "chunk-4", bounds: { min: [4, 0, 0], max: [5, 1, 1] }, selectionKeys: ["chunk:4"] },
        { id: "chunk-5", bounds: { min: [5, 0, 0], max: [6, 1, 1] }, selectionKeys: ["chunk:5"] },
      ],
      elements: [
        { id: "road-1", regionIds: ["chunk-1"], layers: ["world"], tags: ["road"] },
        { id: "road-2", regionIds: ["chunk-2"], layers: ["world"], tags: ["road"] },
        { id: "road-3", regionIds: ["chunk-3"], layers: ["world"], tags: ["road"] },
        { id: "road-4", regionIds: ["chunk-4"], layers: ["world"], tags: ["road"] },
        { id: "road-5", regionIds: ["chunk-5"], layers: ["world"], tags: ["road"] },
        {
          id: "distant-banner",
          regionIds: ["chunk-4", "chunk-5"],
          regionMatch: "any",
          layers: ["world"],
          tags: ["decor"],
        },
      ],
    });

    const selection = selectPolyWorldChunkStreaming(topology, {
      orderedRegionIds: ["chunk-0", "chunk-1", "chunk-2", "chunk-3", "chunk-4", "chunk-5"],
      loadedRegionIds: ["chunk-1"],
      residentRegionIds: ["chunk-1"],
      preloadedRegionIds: ["chunk-0"],
      sources: [
        {
          id: "player-car",
          point: [2.25, 0.5, 0.5],
          before: 1,
          after: 2,
          targetState: "rendered",
          priority: 10,
          label: "player-stream",
          selectionKeys: ["car:player"],
        },
        {
          id: "far-interest",
          regionId: "chunk-5",
          targetState: "loaded",
          label: "far-load",
        },
        {
          id: "missing",
          regionId: "chunk-x",
          targetState: "loaded",
        },
      ],
    });
    const resolution = resolvePolyWorldElements(topology, selection);
    const renderSelection = selectPolyWorldChunkStreamingState(topology, selection, "rendered", {
      reasonLabel: "rendered-chunks",
    });
    const renderResolution = resolvePolyWorldElements(topology, renderSelection);

    expect(selection.regionIds).toEqual(["chunk-1", "chunk-2", "chunk-3", "chunk-4", "chunk-5"]);
    expect(selection.selectionKeys).toEqual([
      "car:player",
      "chunk:1",
      "chunk:2",
      "chunk:3",
      "chunk:4",
      "chunk:5",
    ]);
    expect(selection.streaming).toEqual({
      requestedRegionIds: ["chunk-1", "chunk-2", "chunk-3", "chunk-4", "chunk-5"],
      loadingRegionIds: ["chunk-2", "chunk-3", "chunk-4", "chunk-5"],
      loadedRegionIds: ["chunk-1", "chunk-2", "chunk-3", "chunk-4", "chunk-5"],
      residentRegionIds: ["chunk-1", "chunk-2", "chunk-3", "chunk-4"],
      activeRegionIds: ["chunk-1", "chunk-2", "chunk-3", "chunk-4"],
      renderedRegionIds: ["chunk-1", "chunk-2", "chunk-3", "chunk-4"],
      preloadedRegionIds: ["chunk-0"],
      missingRegionIds: ["chunk-x"],
      sources: [
        {
          sourceId: "player-car",
          currentRegionId: "chunk-2",
          selectedRegionIds: ["chunk-1", "chunk-2", "chunk-3", "chunk-4"],
          targetState: "rendered",
          priority: 10,
          label: "player-stream",
          tags: undefined,
          data: undefined,
        },
        {
          sourceId: "far-interest",
          currentRegionId: "chunk-5",
          selectedRegionIds: ["chunk-5"],
          targetState: "loaded",
          priority: 0,
          label: "far-load",
          tags: undefined,
          data: undefined,
        },
        {
          sourceId: "missing",
          selectedRegionIds: [],
          targetState: "loaded",
          priority: 0,
          label: "streaming-source",
          tags: undefined,
          missingRegionId: "chunk-x",
          data: undefined,
        },
      ],
    });
    expect(selection.reasons?.map((reason) => reason.label)).toEqual([
      "player-stream",
      "far-load",
      "selection-key",
    ]);
    expect(resolution.elementIds).toEqual([
      "road-1",
      "road-2",
      "road-3",
      "road-4",
      "road-5",
      "distant-banner",
    ]);
    expect(renderSelection.regionIds).toEqual(["chunk-1", "chunk-2", "chunk-3", "chunk-4"]);
    expect(renderSelection.selectionKeys).toEqual(["chunk:1", "chunk:2", "chunk:3", "chunk:4"]);
    expect(renderSelection.reasons?.map((reason) => reason.label)).toEqual(["rendered-chunks"]);
    expect(renderResolution.elementIds).toEqual([
      "road-1",
      "road-2",
      "road-3",
      "road-4",
      "distant-banner",
    ]);
  });

  it("expands streaming sources through a chunk graph without collapsing rendered state", () => {
    const topology = createPolyWorldTopology({
      regions: [
        { id: "world", selectionKeys: ["chunk:world"] },
        { id: "sector-a", selectionKeys: ["chunk:sector-a"] },
        { id: "tile-a", selectionKeys: ["chunk:tile-a"] },
        { id: "tile-b", selectionKeys: ["chunk:tile-b"] },
        { id: "tile-c", selectionKeys: ["chunk:tile-c"] },
      ],
      elements: [
        { id: "world-root", regionIds: ["world"], layers: ["world"] },
        { id: "sector-a-shell", regionIds: ["sector-a"], layers: ["world"] },
        { id: "tile-a-road", regionIds: ["tile-a"], layers: ["world"] },
        { id: "tile-b-road", regionIds: ["tile-b"], layers: ["world"] },
        { id: "tile-c-prop", regionIds: ["tile-c"], layers: ["world"] },
      ],
    });

    const selection = selectPolyWorldChunkStreaming(topology, {
      chunkGraph: {
        parentRegionIds: {
          "sector-a": "world",
          "tile-a": "sector-a",
        },
        childRegionIds: {
          "sector-a": ["tile-a", "tile-b"],
        },
        relatedRegionIds: {
          "tile-a": ["tile-c", "missing-tile"],
        },
      },
      sources: [
        {
          id: "camera",
          regionId: "tile-a",
          targetState: "resident",
          priority: 10,
          chunkGraphExpansion: { includeParents: true, includeRelated: true, recursive: true },
        },
        {
          id: "sector-render",
          regionId: "sector-a",
          targetState: "rendered",
          priority: 5,
          chunkGraphExpansion: { includeChildren: true },
        },
      ],
    });
    const rendered = selectPolyWorldChunkStreamingState(topology, selection, "rendered");
    const residentResolution = resolvePolyWorldElements(topology, selection);
    const renderedResolution = resolvePolyWorldElements(topology, rendered);

    expect(selection.regionIds).toEqual(["tile-a", "sector-a", "tile-c", "world", "tile-b"]);
    expect(selection.selectionKeys).toEqual([
      "chunk:tile-a",
      "chunk:sector-a",
      "chunk:tile-c",
      "chunk:world",
      "chunk:tile-b",
    ]);
    expect(selection.streaming.loadedRegionIds).toEqual(["sector-a", "tile-a", "tile-b", "tile-c", "world"]);
    expect(selection.streaming.residentRegionIds).toEqual(["sector-a", "tile-a", "tile-b", "tile-c", "world"]);
    expect(selection.streaming.renderedRegionIds).toEqual(["sector-a", "tile-a", "tile-b"]);
    expect(selection.streaming.missingRegionIds).toEqual(["missing-tile"]);
    expect(selection.streaming.sources[0]?.graphRegionIds).toEqual(["sector-a", "tile-c", "world"]);
    expect(selection.streaming.sources[0]?.missingRegionIds).toEqual(["missing-tile"]);
    expect(selection.streaming.sources[1]?.graphRegionIds).toEqual(["tile-a", "tile-b"]);
    expect(residentResolution.elementIds).toEqual([
      "world-root",
      "sector-a-shell",
      "tile-a-road",
      "tile-b-road",
      "tile-c-prop",
    ]);
    expect(rendered.regionIds).toEqual(["sector-a", "tile-a", "tile-b"]);
    expect(renderedResolution.elementIds).toEqual(["sector-a-shell", "tile-a-road", "tile-b-road"]);
  });

  it("uses a validated chunk tree as the streaming graph source", () => {
    const topology = createPolyWorldTopology({
      regions: [
        { id: "world", bounds: { min: [0, 0, 0], max: [8, 8, 4] }, selectionKeys: ["chunk:world"] },
        { id: "sector-a", bounds: { min: [0, 0, 0], max: [4, 4, 3] }, selectionKeys: ["chunk:sector-a"] },
        { id: "tile-a", bounds: { min: [0, 0, 0], max: [2, 2, 2] }, selectionKeys: ["chunk:tile-a"] },
        { id: "tile-b", bounds: { min: [2, 0, 0], max: [4, 2, 2] }, selectionKeys: ["chunk:tile-b"] },
      ],
      elements: [
        { id: "world-root", regionIds: ["world"], layers: ["world"] },
        { id: "sector-shell", regionIds: ["sector-a"], layers: ["world"] },
        { id: "tile-a-road", regionIds: ["tile-a"], layers: ["world"] },
        { id: "tile-b-road", regionIds: ["tile-b"], layers: ["world"] },
      ],
    });
    const chunkTree = createPolyWorldChunkTree({
      chunks: [
        {
          id: "world",
          regionId: "world",
          childIds: ["sector-a"],
          available: true,
          contentAvailable: true,
          refinement: "add",
        },
        {
          id: "sector-a",
          regionId: "sector-a",
          parentId: "world",
          childIds: ["tile-a", "tile-b"],
          available: true,
          contentAvailable: true,
          geometricError: 2,
        },
        {
          id: "tile-a",
          regionId: "tile-a",
          parentId: "sector-a",
          available: true,
          contentAvailable: true,
          resourceIds: ["mesh:tile-a"],
        },
        {
          id: "tile-b",
          regionId: "tile-b",
          parentId: "sector-a",
          available: true,
          contentAvailable: false,
        },
      ],
    }, { topology });

    const selection = selectPolyWorldChunkStreaming(topology, {
      chunkTree,
      sources: [
        {
          id: "camera",
          regionId: "tile-a",
          targetState: "rendered",
          chunkGraphExpansion: {
            includeParents: true,
            recursive: true,
            targetState: "resident",
          },
        },
        {
          id: "sector",
          regionId: "sector-a",
          targetState: "rendered",
          chunkGraphExpansion: { includeChildren: true },
        },
      ],
    });
    const rendered = selectPolyWorldChunkStreamingState(topology, selection, "rendered");
    const renderedResolution = resolvePolyWorldElements(topology, rendered);

    expect(chunkTree.rootChunkIds).toEqual(["world"]);
    expect(chunkTree.availableChunkIds).toEqual(["world", "sector-a", "tile-a", "tile-b"]);
    expect(chunkTree.contentChunkIds).toEqual(["world", "sector-a", "tile-a"]);
    expect(selection.regionIds).toEqual(["tile-a", "sector-a", "world", "tile-b"]);
    expect(selection.streaming.loadedRegionIds).toEqual(["sector-a", "tile-a", "tile-b", "world"]);
    expect(selection.streaming.residentRegionIds).toEqual(["sector-a", "tile-a", "tile-b", "world"]);
    expect(selection.streaming.renderedRegionIds).toEqual(["sector-a", "tile-a", "tile-b"]);
    expect(selection.streaming.chunkTree).toEqual({
      chunkCount: 4,
      rootChunkIds: ["world"],
      availableChunkIds: ["world", "sector-a", "tile-a", "tile-b"],
      contentChunkIds: ["world", "sector-a", "tile-a"],
      maxDepth: 2,
    });
    expect(selection.streaming.sources[0]).toMatchObject({
      sourceId: "camera",
      selectedRegionIds: ["tile-a", "sector-a", "world"],
      graphRegionIds: ["sector-a", "world"],
      graphTargetState: "resident",
    });
    expect(selection.streaming.sources[1]).toMatchObject({
      sourceId: "sector",
      selectedRegionIds: ["sector-a", "tile-a", "tile-b"],
      graphRegionIds: ["tile-a", "tile-b"],
    });
    expect(rendered.regionIds).toEqual(["sector-a", "tile-a", "tile-b"]);
    expect(renderedResolution.elementIds).toEqual(["sector-shell", "tile-a-road", "tile-b-road"]);
  });

  it("resolves budgeted chunk tree traversal with requested, held, skipped, unavailable, and clipped chunks", () => {
    const chunkTree = createPolyWorldChunkTree({
      chunks: [
        {
          id: "world",
          regionId: "world",
          childIds: ["sector-a", "sector-b"],
          available: true,
          contentAvailable: true,
          refinement: "add",
          cost: 1,
        },
        {
          id: "sector-a",
          regionId: "sector-a",
          parentId: "world",
          childIds: ["tile-a", "tile-b", "tile-c"],
          available: true,
          contentAvailable: true,
          refinement: "replace",
          geometricError: 4,
          cost: 1,
        },
        {
          id: "tile-a",
          regionId: "tile-a",
          parentId: "sector-a",
          available: true,
          contentAvailable: true,
          priority: 10,
          cost: 2,
        },
        {
          id: "tile-b",
          regionId: "tile-b",
          parentId: "sector-a",
          available: true,
          contentAvailable: false,
          priority: 5,
          cost: 1,
        },
        {
          id: "tile-c",
          regionId: "tile-c",
          parentId: "sector-a",
          childIds: ["tile-c-detail"],
          available: true,
          contentAvailable: true,
          priority: 1,
          geometricError: 0.5,
          cost: 3,
        },
        {
          id: "tile-c-detail",
          regionId: "tile-c-detail",
          parentId: "tile-c",
          available: true,
          contentAvailable: true,
          cost: 1,
        },
        {
          id: "sector-b",
          regionId: "sector-b",
          parentId: "world",
          available: false,
          contentAvailable: false,
        },
      ],
    });

    const traversal = resolvePolyWorldChunkTreeTraversal(chunkTree, {
      currentRegionId: "tile-a",
      budget: {
        maxRenderedChunks: 2,
        maxLoadedChunks: 4,
        maxRenderCost: 3,
        maxLoadCost: 10,
        targetGeometricError: 1,
      },
    });

    expect(traversal.currentChunkId).toBe("tile-a");
    expect(traversal.refinedChunkIds).toEqual(["world", "sector-a"]);
    expect(traversal.renderedChunkIds).toEqual(["world", "tile-a"]);
    expect(traversal.loadedChunkIds).toEqual(["world", "sector-a", "tile-a", "tile-c"]);
    expect(traversal.residentChunkIds).toEqual(["world", "sector-a", "tile-a", "tile-c"]);
    expect(traversal.requestedChunkIds).toEqual(["tile-b"]);
    expect(traversal.heldChunkIds).toEqual(["sector-a", "tile-c"]);
    expect(traversal.unavailableChunkIds).toEqual(["sector-b"]);
    expect(traversal.viewCulledChunkIds).toEqual([]);
    expect(traversal.outsideRequestVolumeChunkIds).toEqual([]);
    expect(traversal.skippedChunkIds).toEqual(["tile-c-detail"]);
    expect(traversal.budgetClippedChunkIds).toEqual(["tile-c"]);
    expect(traversal.selectedRegionIds).toEqual(["world", "sector-a", "tile-a", "tile-b", "tile-c"]);
    expect(traversal.renderedRegionIds).toEqual(["world", "tile-a"]);
    expect(traversal.requestedRegionIds).toEqual(["tile-b"]);
    expect(traversal.totalRenderCost).toBe(3);
    expect(traversal.totalLoadCost).toBe(7);
    expect(traversal.entries.find((entry) => entry.chunkId === "sector-a")?.reasons).toEqual([
      "ancestor",
      "refined",
      "loaded",
      "held",
      "resident",
    ]);
    expect(traversal.entries.find((entry) => entry.chunkId === "tile-c")?.reasons).toEqual([
      "loaded",
      "budget-clipped",
      "held",
    ]);
    expect(traversal.entries.find((entry) => entry.chunkId === "tile-c-detail")?.reasons).toEqual(["skipped"]);
  });

  it("uses the chunk-track fixture for SSE, hold, request, cull, and unavailable states", () => {
    const fixture = createPolyWorldChunkTrackFixture();
    const traversal = resolvePolyWorldChunkTreeTraversal(fixture.chunkTree, {
      currentRegionId: "track-a",
      ...fixture.camera,
      budget: {
        maxRenderedChunks: 2,
        maxLoadedChunks: 5,
        maxRenderCost: 3,
        maxScreenSpaceError: 24,
      },
    });

    expect(traversal.currentChunkId).toBe("track-a");
    expect(traversal.screenSpaceError).toMatchObject({
      viewportHeight: 420,
      maxError: 24,
    });
    expect(traversal.refinedChunkIds).toEqual(["track-world", "track-sector", "track-c"]);
    expect(traversal.renderedChunkIds).toEqual(["track-world", "track-a"]);
    expect(traversal.loadedChunkIds).toEqual([
      "track-world",
      "track-sector",
      "track-a",
      "track-c",
      "track-c-detail",
    ]);
    expect(traversal.requestedChunkIds).toEqual(["track-b"]);
    expect(traversal.heldChunkIds).toEqual(["track-sector", "track-c", "track-c-detail"]);
    expect(traversal.unavailableChunkIds).toEqual(["track-unavailable"]);
    expect(traversal.viewCulledChunkIds).toEqual(["track-side"]);
    expect(traversal.outsideRequestVolumeChunkIds).toEqual(["track-request-gated"]);
    expect(traversal.skippedChunkIds).toEqual(["track-side", "track-request-gated"]);
    expect(traversal.budgetClippedChunkIds).toEqual(["track-c-detail"]);
    expect(traversal.entries.find((entry) => entry.chunkId === "track-sector")?.reasons).toEqual([
      "ancestor",
      "refined",
      "loaded",
      "held",
      "resident",
    ]);
    expect(traversal.entries.find((entry) => entry.chunkId === "track-b")?.reasons).toEqual([
      "requested",
    ]);
    expect(traversal.entries.find((entry) => entry.chunkId === "track-c")?.reasons).toEqual([
      "refined",
      "loaded",
      "held",
      "resident",
    ]);
    expect(traversal.entries.find((entry) => entry.chunkId === "track-c-detail")?.reasons).toEqual([
      "loaded",
      "budget-clipped",
      "held",
    ]);
    expect(traversal.entries.find((entry) => entry.chunkId === "track-side")?.reasons).toEqual([
      "view-culled",
      "skipped",
    ]);
    expect(traversal.entries.find((entry) => entry.chunkId === "track-request-gated")?.reasons).toEqual([
      "outside-request-volume",
      "skipped",
    ]);
  });

  it("refines chunk trees by screen-space error when viewport data is available", () => {
    const chunkTree = createPolyWorldChunkTree({
      chunks: [
        {
          id: "sector",
          regionId: "sector",
          childIds: ["tile"],
          bounds: { min: [10, -1, -1], max: [30, 1, 1] },
          available: true,
          contentAvailable: true,
          refinement: "add",
          geometricError: 10,
        },
        {
          id: "tile",
          regionId: "tile",
          parentId: "sector",
          bounds: { min: [12, -1, -1], max: [14, 1, 1] },
          available: true,
          contentAvailable: true,
          geometricError: 0.5,
        },
      ],
    });

    const traversal = resolvePolyWorldChunkTreeTraversal(chunkTree, {
      point: [0, 0, 0],
      forward: [1, 0, 0],
      fovDegrees: 90,
      aspect: 1,
      viewportHeight: 100,
      budget: {
        maxScreenSpaceError: 40,
        targetGeometricError: 0,
      },
    });
    const sectorEntry = traversal.entries.find((entry) => entry.chunkId === "sector");
    const tileEntry = traversal.entries.find((entry) => entry.chunkId === "tile");

    expect(traversal.screenSpaceError).toEqual({
      viewportHeight: 100,
      fovDegrees: 90,
      maxError: 40,
      distanceFloor: 0.0001,
    });
    expect(traversal.budget).toEqual({
      maxScreenSpaceError: 40,
      targetGeometricError: 0,
    });
    expect(traversal.refinedChunkIds).toEqual(["sector"]);
    expect(traversal.renderedChunkIds).toEqual(["sector", "tile"]);
    expect(sectorEntry?.distanceToCamera).toBe(10);
    expect(sectorEntry?.screenSpaceError).toBeCloseTo(50);
    expect(sectorEntry?.reasons).toEqual(["root", "refined", "loaded", "rendered"]);
    expect(tileEntry?.distanceToCamera).toBe(12);
    expect(tileEntry?.screenSpaceError).toBeCloseTo(2.083333, 5);

    const belowThreshold = resolvePolyWorldChunkTreeTraversal(chunkTree, {
      point: [0, 0, 0],
      forward: [1, 0, 0],
      fovDegrees: 90,
      aspect: 1,
      viewportHeight: 100,
      budget: {
        maxScreenSpaceError: 60,
        targetGeometricError: 0,
      },
    });
    expect(belowThreshold.refinedChunkIds).toEqual([]);
    expect(belowThreshold.renderedChunkIds).toEqual(["sector"]);
    expect(belowThreshold.skippedChunkIds).toEqual(["tile"]);

    const fallback = resolvePolyWorldChunkTreeTraversal(chunkTree, {
      budget: {
        targetGeometricError: 5,
      },
    });
    expect(fallback.screenSpaceError).toBeUndefined();
    expect(fallback.refinedChunkIds).toEqual(["sector"]);
  });

  it("filters chunk tree traversal with camera frustum data while keeping the active path", () => {
    const chunkTree = createPolyWorldChunkTree({
      chunks: [
        {
          id: "world",
          regionId: "world",
          childIds: ["front", "side"],
          bounds: { min: [-1, -2, -1], max: [8, 8, 1] },
          available: true,
          contentAvailable: true,
          refinement: "add",
          cost: 1,
        },
        {
          id: "front",
          regionId: "front",
          parentId: "world",
          bounds: { min: [2, -0.5, -0.5], max: [3, 0.5, 0.5] },
          available: true,
          contentAvailable: true,
          priority: 2,
          cost: 1,
        },
        {
          id: "side",
          regionId: "side",
          parentId: "world",
          bounds: { min: [2, 5, -0.5], max: [3, 6, 0.5] },
          available: true,
          contentAvailable: true,
          priority: 1,
          cost: 1,
        },
      ],
    });

    const traversal = resolvePolyWorldChunkTreeTraversal(chunkTree, {
      currentRegionId: "front",
      point: [0, 0, 0],
      forward: [1, 0, 0],
      up: [0, 0, 1],
      fovDegrees: 50,
      aspect: 1,
      far: 10,
    });

    expect(traversal.currentChunkId).toBe("front");
    expect(traversal.selectedChunkIds).toEqual(["world", "front"]);
    expect(traversal.renderedChunkIds).toEqual(["world", "front"]);
    expect(traversal.viewCulledChunkIds).toEqual(["side"]);
    expect(traversal.outsideRequestVolumeChunkIds).toEqual([]);
    expect(traversal.skippedChunkIds).toEqual(["side"]);
    expect(traversal.selectedRegionIds).toEqual(["world", "front"]);
    expect(traversal.entries.find((entry) => entry.chunkId === "world")?.reasons).toEqual([
      "root",
      "ancestor",
      "refined",
      "loaded",
      "rendered",
    ]);
    expect(traversal.entries.find((entry) => entry.chunkId === "front")?.reasons).toEqual([
      "current",
      "loaded",
      "rendered",
    ]);
    expect(traversal.entries.find((entry) => entry.chunkId === "side")?.reasons).toEqual([
      "view-culled",
      "skipped",
    ]);
  });

  it("uses chunk content bounds for view culling and viewer request bounds for request eligibility", () => {
    const chunkTree = createPolyWorldChunkTree({
      chunks: [
        {
          id: "world",
          regionId: "world",
          childIds: ["front", "content-side", "request-only"],
          bounds: { min: [-1, -2, -1], max: [8, 8, 1] },
          available: true,
          contentAvailable: true,
          refinement: "add",
          cost: 1,
        },
        {
          id: "front",
          regionId: "front",
          parentId: "world",
          bounds: { min: [2, -0.5, -0.5], max: [3, 0.5, 0.5] },
          available: true,
          contentAvailable: true,
          priority: 3,
          cost: 1,
        },
        {
          id: "content-side",
          regionId: "content-side",
          parentId: "world",
          bounds: { min: [2, -0.5, -0.5], max: [3, 0.5, 0.5] },
          contentBounds: { min: [2, 5, -0.5], max: [3, 6, 0.5] },
          available: true,
          contentAvailable: true,
          priority: 2,
          cost: 1,
        },
        {
          id: "request-only",
          regionId: "request-only",
          parentId: "world",
          bounds: { min: [2, -0.5, -0.5], max: [3, 0.5, 0.5] },
          viewerRequestBounds: { min: [50, -1, -1], max: [60, 1, 1] },
          available: true,
          contentAvailable: true,
          priority: 1,
          cost: 1,
        },
      ],
    });

    const traversal = resolvePolyWorldChunkTreeTraversal(chunkTree, {
      currentRegionId: "front",
      point: [0, 0, 0],
      forward: [1, 0, 0],
      up: [0, 0, 1],
      fovDegrees: 50,
      aspect: 1,
      far: 10,
    });

    expect(traversal.renderedChunkIds).toEqual(["world", "front"]);
    expect(traversal.viewCulledChunkIds).toEqual(["content-side"]);
    expect(traversal.outsideRequestVolumeChunkIds).toEqual(["request-only"]);
    expect(traversal.skippedChunkIds).toEqual(["content-side", "request-only"]);
    expect(traversal.selectedRegionIds).toEqual(["world", "front"]);
    expect(traversal.entries.find((entry) => entry.chunkId === "content-side")?.reasons).toEqual([
      "view-culled",
      "skipped",
    ]);
    expect(traversal.entries.find((entry) => entry.chunkId === "request-only")?.reasons).toEqual([
      "outside-request-volume",
      "skipped",
    ]);
  });

  it("can drive streaming state from explicit chunk tree traversal without changing fetch policy", () => {
    const topology = createPolyWorldTopology({
      regions: [
        { id: "world", selectionKeys: ["chunk:world"] },
        { id: "sector-a", selectionKeys: ["chunk:sector-a"] },
        { id: "tile-a", selectionKeys: ["chunk:tile-a"] },
        { id: "tile-b", selectionKeys: ["chunk:tile-b"] },
        { id: "tile-c", selectionKeys: ["chunk:tile-c"] },
      ],
      elements: [
        { id: "world-root", regionIds: ["world"], layers: ["world"] },
        { id: "sector-shell", regionIds: ["sector-a"], layers: ["world"] },
        { id: "tile-a-road", regionIds: ["tile-a"], layers: ["world"] },
        { id: "tile-b-road", regionIds: ["tile-b"], layers: ["world"] },
        { id: "tile-c-prop", regionIds: ["tile-c"], layers: ["world"] },
      ],
    });
    const chunkTree = createPolyWorldChunkTree({
      chunks: [
        { id: "world", regionId: "world", childIds: ["sector-a"], available: true, contentAvailable: true, refinement: "add", cost: 1 },
        { id: "sector-a", regionId: "sector-a", parentId: "world", childIds: ["tile-a", "tile-b", "tile-c"], available: true, contentAvailable: true, refinement: "replace", geometricError: 4, cost: 1 },
        { id: "tile-a", regionId: "tile-a", parentId: "sector-a", available: true, contentAvailable: true, priority: 10, cost: 2 },
        { id: "tile-b", regionId: "tile-b", parentId: "sector-a", available: true, contentAvailable: false, priority: 5, cost: 1 },
        { id: "tile-c", regionId: "tile-c", parentId: "sector-a", available: true, contentAvailable: true, priority: 1, cost: 3 },
      ],
    }, { topology });

    const selection = selectPolyWorldChunkStreaming(topology, {
      chunkTree,
      currentRegionId: "tile-a",
      chunkTraversal: {
        budget: {
          maxRenderedChunks: 2,
          maxLoadedChunks: 4,
          maxRenderCost: 3,
        },
      },
      reasonLabels: { chunkTreeTraversal: "budgeted-tree" },
    });
    const rendered = selectPolyWorldChunkStreamingState(topology, selection, "rendered");
    const renderedResolution = resolvePolyWorldElements(topology, rendered);

    expect(selection.regionIds).toEqual(["world", "sector-a", "tile-a", "tile-b", "tile-c"]);
    expect(selection.streaming.chunkTraversal?.renderedChunkIds).toEqual(["world", "tile-a"]);
    expect(selection.streaming.requestedRegionIds).toEqual(["world", "sector-a", "tile-a", "tile-b", "tile-c"]);
    expect(selection.streaming.loadedRegionIds).toEqual(["sector-a", "tile-a", "tile-c", "world"]);
    expect(selection.streaming.residentRegionIds).toEqual(["sector-a", "tile-a", "tile-c", "world"]);
    expect(selection.streaming.renderedRegionIds).toEqual(["tile-a", "world"]);
    expect(selection.streaming.chunkTraversal?.budgetClippedChunkIds).toEqual(["tile-c"]);
    expect(selection.reasons?.find((reason) => reason.kind === "chunkTreeTraversal")?.label).toBe("budgeted-tree");
    expect(rendered.regionIds).toEqual(["tile-a", "world"]);
    expect(renderedResolution.elementIds).toEqual(["world-root", "tile-a-road"]);
  });

  it("rejects invalid chunk trees before streaming selection uses them", () => {
    const topology = createPolyWorldTopology({
      regions: [{ id: "root" }, { id: "child" }],
    });

    expect(() => createPolyWorldChunkTree({
      chunks: [
        {
          id: "root",
          regionId: "root",
          available: false,
          contentAvailable: true,
          childIds: ["child", "missing"],
        },
        {
          id: "child",
          regionId: "missing-region",
          parentId: "root",
          available: true,
          bounds: { min: [1, 1, 1], max: [0, 1, 1] },
          contentBounds: { min: [0, 2, 0], max: [1, 1, 1] },
          viewerRequestBounds: { min: [0, 0, 2], max: [1, 1, 1] },
        },
        {
          id: "cycle-a",
          parentId: "cycle-b",
        },
        {
          id: "cycle-b",
          parentId: "cycle-a",
        },
      ],
    }, { topology })).toThrow(PolyWorldChunkTreeError);

    try {
      createPolyWorldChunkTree({
        chunks: [
          {
            id: "root",
            regionId: "root",
            available: false,
            contentAvailable: true,
            childIds: ["child", "missing"],
          },
          {
            id: "child",
            regionId: "missing-region",
            parentId: "root",
            available: true,
            bounds: { min: [1, 1, 1], max: [0, 1, 1] },
            contentBounds: { min: [0, 2, 0], max: [1, 1, 1] },
            viewerRequestBounds: { min: [0, 0, 2], max: [1, 1, 1] },
          },
          {
            id: "cycle-a",
            parentId: "cycle-b",
          },
          {
            id: "cycle-b",
            parentId: "cycle-a",
          },
        ],
      }, { topology });
    } catch (error) {
      const diagnostics = (error as PolyWorldChunkTreeError).diagnostics;
      expect(diagnostics).toEqual(expect.arrayContaining([
        expect.objectContaining({ code: "poly-world-unavailable-chunk-content", id: "root" }),
        expect.objectContaining({ code: "poly-world-missing-chunk-child", id: "root", field: "childIds" }),
        expect.objectContaining({ code: "poly-world-missing-chunk-region", id: "child", field: "regionId" }),
        expect.objectContaining({ code: "poly-world-unavailable-chunk-parent", id: "child", field: "available" }),
        expect.objectContaining({ code: "poly-world-invalid-chunk-bounds", id: "child", field: "bounds" }),
        expect.objectContaining({ code: "poly-world-invalid-chunk-bounds", id: "child", field: "contentBounds" }),
        expect.objectContaining({ code: "poly-world-invalid-chunk-bounds", id: "child", field: "viewerRequestBounds" }),
        expect.objectContaining({ code: "poly-world-chunk-tree-cycle", id: "cycle-a", field: "parentId" }),
      ]));
    }
  });

  it("can render a child chunk while keeping graph-expanded parents resident", () => {
    const topology = createPolyWorldTopology({
      regions: [
        { id: "world", selectionKeys: ["chunk:world"] },
        { id: "sector-a", selectionKeys: ["chunk:sector-a"] },
        { id: "tile-a", selectionKeys: ["chunk:tile-a"] },
      ],
      elements: [
        { id: "world-root", regionIds: ["world"], layers: ["world"] },
        { id: "sector-a-shell", regionIds: ["sector-a"], layers: ["world"] },
        { id: "tile-a-road", regionIds: ["tile-a"], layers: ["world"] },
      ],
    });

    const selection = selectPolyWorldChunkStreaming(topology, {
      chunkGraph: {
        parentRegionIds: {
          "sector-a": "world",
          "tile-a": "sector-a",
        },
      },
      sources: [
        {
          id: "camera",
          regionId: "tile-a",
          targetState: "rendered",
          chunkGraphExpansion: {
            includeParents: true,
            recursive: true,
            targetState: "resident",
          },
        },
      ],
    });
    const rendered = selectPolyWorldChunkStreamingState(topology, selection, "rendered");
    const residentResolution = resolvePolyWorldElements(topology, selection);
    const renderedResolution = resolvePolyWorldElements(topology, rendered);

    expect(selection.regionIds).toEqual(["tile-a", "sector-a", "world"]);
    expect(selection.streaming.loadedRegionIds).toEqual(["sector-a", "tile-a", "world"]);
    expect(selection.streaming.residentRegionIds).toEqual(["sector-a", "tile-a", "world"]);
    expect(selection.streaming.renderedRegionIds).toEqual(["tile-a"]);
    expect(selection.streaming.sources[0]).toMatchObject({
      sourceId: "camera",
      selectedRegionIds: ["tile-a", "sector-a", "world"],
      graphRegionIds: ["sector-a", "world"],
      graphTargetState: "resident",
      targetState: "rendered",
    });
    expect(residentResolution.elementIds).toEqual(["world-root", "sector-a-shell", "tile-a-road"]);
    expect(rendered.regionIds).toEqual(["tile-a"]);
    expect(renderedResolution.elementIds).toEqual(["tile-a-road"]);
  });

  it("plans a chunk streaming frame from rendered chunks while preserving wider loaded state", () => {
    const topology = createPolyWorldTopology({
      regions: [
        { id: "chunk-0", bounds: { min: [0, 0, 0], max: [1, 1, 1] }, selectionKeys: ["chunk:0"] },
        { id: "chunk-1", bounds: { min: [1, 0, 0], max: [2, 1, 1] }, selectionKeys: ["chunk:1"] },
        { id: "chunk-2", bounds: { min: [2, 0, 0], max: [3, 1, 1] }, selectionKeys: ["chunk:2"] },
        { id: "chunk-3", bounds: { min: [3, 0, 0], max: [4, 1, 1] }, selectionKeys: ["chunk:3"] },
        { id: "chunk-4", bounds: { min: [4, 0, 0], max: [5, 1, 1] }, selectionKeys: ["chunk:4"] },
        { id: "chunk-5", bounds: { min: [5, 0, 0], max: [6, 1, 1] }, selectionKeys: ["chunk:5"] },
      ],
      elements: [
        { id: "road-1", regionIds: ["chunk-1"], layers: ["world"], tags: ["road"] },
        { id: "road-2", regionIds: ["chunk-2"], layers: ["world"], tags: ["road"] },
        { id: "road-3", regionIds: ["chunk-3"], layers: ["world"], tags: ["road"] },
        { id: "road-4", regionIds: ["chunk-4"], layers: ["world"], tags: ["road"] },
        { id: "road-5", regionIds: ["chunk-5"], layers: ["world"], tags: ["road"] },
        {
          id: "distant-banner",
          regionIds: ["chunk-4", "chunk-5"],
          regionMatch: "any",
          layers: ["world"],
          tags: ["decor"],
        },
      ],
    });
    const previousState = createPolyWorldState(topology, {
      selection: { regionIds: ["chunk-1"] },
      resolutionOptions: { layers: ["world"] },
    });

    const frame = planPolyWorldChunkStreamingFrame(topology, {
      previousState,
      orderedRegionIds: ["chunk-0", "chunk-1", "chunk-2", "chunk-3", "chunk-4", "chunk-5"],
      loadedRegionIds: ["chunk-1"],
      residentRegionIds: ["chunk-1"],
      sources: [
        {
          id: "player-car",
          point: [2.25, 0.5, 0.5],
          before: 1,
          after: 2,
          targetState: "rendered",
          priority: 10,
          label: "player-stream",
        },
        {
          id: "far-interest",
          regionId: "chunk-5",
          targetState: "loaded",
          label: "far-load",
        },
      ],
      renderSelection: { reasonLabel: "rendered-chunks" },
      state: { resolutionOptions: { layers: ["world"] } },
      policies: [{ id: "render", layer: "render", elementLayers: ["world"] }],
      planDebug: { includeEntries: false },
      debug: { includeSources: true, listLimit: 8 },
    });

    expect(frame.streamingSelection.streaming.loadedRegionIds).toEqual([
      "chunk-1",
      "chunk-2",
      "chunk-3",
      "chunk-4",
      "chunk-5",
    ]);
    expect(frame.artifact).toMatchObject({
      profile: "chunk-traversal",
      artifactKind: "chunk-working-set",
      sourceKind: "authored-runtime-selection",
      producedBy: "selectPolyWorldChunkStreaming",
      counts: {
        selectedRegionCount: 5,
        loadedRegionCount: 5,
        renderedRegionCount: 4,
      },
    });
    expect(frame.artifact.guarantees).toContain("streaming-state-separation");
    expect(frame.streamingSelection.streaming.renderedRegionIds).toEqual(["chunk-1", "chunk-2", "chunk-3", "chunk-4"]);
    expect(frame.streamingSets).toEqual({
      selectedChunkIds: [],
      renderedChunkIds: [],
      loadedChunkIds: [],
      residentChunkIds: [],
      requestedChunkIds: [],
      heldChunkIds: [],
      unavailableChunkIds: [],
      viewCulledChunkIds: [],
      outsideRequestVolumeChunkIds: [],
      skippedChunkIds: [],
      budgetClippedChunkIds: [],
      selectedRegionIds: ["chunk-1", "chunk-2", "chunk-3", "chunk-4", "chunk-5"],
      renderedRegionIds: ["chunk-1", "chunk-2", "chunk-3", "chunk-4"],
      loadedRegionIds: ["chunk-1", "chunk-2", "chunk-3", "chunk-4", "chunk-5"],
      residentRegionIds: ["chunk-1", "chunk-2", "chunk-3", "chunk-4"],
      requestedRegionIds: ["chunk-1", "chunk-2", "chunk-3", "chunk-4", "chunk-5"],
      plannedElementIds: ["distant-banner", "road-2", "road-3", "road-4", "road-1"],
    });
    expect(frame.frameSummary).toMatchObject({
      profile: "chunk-traversal",
      artifactKind: "chunk-working-set",
      candidate: {
        regionIds: ["chunk-1", "chunk-2", "chunk-3", "chunk-4", "chunk-5"],
      },
      broad: {
        regionIds: ["chunk-1", "chunk-2", "chunk-3", "chunk-4", "chunk-5"],
      },
      view: {
        regionIds: ["chunk-1", "chunk-2", "chunk-3", "chunk-4"],
      },
      retained: {
        regionIds: ["chunk-1", "chunk-2", "chunk-3", "chunk-4"],
      },
      planning: {
        regionIds: ["chunk-1", "chunk-2", "chunk-3", "chunk-4"],
      },
      state: {
        resolvedElementIds: ["distant-banner", "road-1", "road-2", "road-3", "road-4"],
      },
      plan: {
        entryCount: 5,
        plannedElementIds: ["distant-banner", "road-1", "road-2", "road-3", "road-4"],
      },
    });
    expect(frame.planningSelection?.regionIds).toEqual(["chunk-1", "chunk-2", "chunk-3", "chunk-4"]);
    expect(frame.debug?.planningSelection?.regionIds).toEqual(["chunk-1", "chunk-2", "chunk-3", "chunk-4"]);
    expect(frame.nextState.selectedRegionIds).toEqual(["chunk-1", "chunk-2", "chunk-3", "chunk-4"]);
    expect(frame.nextState.resolvedElementIds).toEqual([
      "distant-banner",
      "road-1",
      "road-2",
      "road-3",
      "road-4",
    ]);
    expect(frame.plan.entries.map((entry) => [entry.elementId, entry.action])).toEqual([
      ["distant-banner", "show"],
      ["road-2", "show"],
      ["road-3", "show"],
      ["road-4", "show"],
      ["road-1", "retain"],
    ]);
    expect(frame.chunkDebug?.streaming.loadedRegionIds.count).toBe(5);
    expect(frame.chunkDebug?.streaming.renderedRegionIds.count).toBe(4);
    expect(frame.debug?.plan.entryCount).toBe(5);
  });

  it("summarizes traversal-backed chunk frame working sets", () => {
    const topology = createPolyWorldTopology({
      regions: [
        { id: "world" },
        { id: "tile-a" },
        { id: "tile-b" },
        { id: "tile-c" },
      ],
      elements: [
        { id: "world-root", regionIds: ["world"], layers: ["world"] },
        { id: "tile-a-road", regionIds: ["tile-a"], layers: ["world"] },
        { id: "tile-b-road", regionIds: ["tile-b"], layers: ["world"] },
        { id: "tile-c-road", regionIds: ["tile-c"], layers: ["world"] },
      ],
    });
    const previousState = createPolyWorldState(topology, {
      selection: { regionIds: ["world"] },
      resolutionOptions: { layers: ["world"] },
    });
    const frame = planPolyWorldChunkStreamingFrame(topology, {
      previousState,
      chunkTree: {
        chunks: [
          { id: "world", regionId: "world", childIds: ["tile-a", "tile-b", "tile-c"], available: true, contentAvailable: true, refinement: "add", cost: 1 },
          { id: "tile-a", regionId: "tile-a", parentId: "world", available: true, contentAvailable: true, priority: 10, cost: 2 },
          { id: "tile-b", regionId: "tile-b", parentId: "world", available: true, contentAvailable: false, priority: 5, cost: 1 },
          { id: "tile-c", regionId: "tile-c", parentId: "world", available: false, contentAvailable: false, priority: 1 },
        ],
      },
      currentRegionId: "tile-a",
      chunkTraversal: {
        budget: {
          maxRenderedChunks: 1,
          maxLoadedChunks: 2,
        },
      },
      state: { resolutionOptions: { layers: ["world"] } },
      policies: [{ id: "render", layer: "render", elementLayers: ["world"] }],
      planDebug: { includeEntries: false },
      debug: { includeTraversalEntries: true, traversalEntryLimit: 2 },
    });

    expect(frame.streamingSets).toEqual({
      currentChunkId: "tile-a",
      selectedChunkIds: ["world", "tile-a", "tile-b"],
      renderedChunkIds: ["world"],
      loadedChunkIds: ["world", "tile-a"],
      residentChunkIds: ["world", "tile-a"],
      requestedChunkIds: ["tile-b"],
      heldChunkIds: ["tile-a"],
      unavailableChunkIds: ["tile-c"],
      viewCulledChunkIds: [],
      outsideRequestVolumeChunkIds: [],
      skippedChunkIds: [],
      budgetClippedChunkIds: ["tile-a"],
      selectedRegionIds: ["world", "tile-a", "tile-b"],
      renderedRegionIds: ["world"],
      loadedRegionIds: ["world", "tile-a"],
      residentRegionIds: ["world", "tile-a"],
      requestedRegionIds: ["tile-b"],
      plannedElementIds: ["world-root"],
    });
    expect(frame.artifact).toMatchObject({
      profile: "chunk-traversal",
      artifactKind: "chunk-working-set",
      sourceKind: "authored-runtime-selection",
      producedBy: "resolvePolyWorldChunkTreeTraversal",
      counts: {
        selectedChunkCount: 3,
        heldChunkCount: 1,
        budgetClippedChunkCount: 1,
      },
    });
    expect(frame.artifact.guarantees).toContain("budgeted-traversal");
    expect(frame.nextState.resolvedElementIds).toEqual(["world-root"]);
    expect(frame.chunkDebug?.streaming.chunkTraversal?.currentChunkId).toBe("tile-a");
  });

  it("orders streaming sources by priority and expands loading ranges from bounds-only regions", () => {
    const topology = createPolyWorldTopology({
      regions: [
        { id: "chunk-0", bounds: { min: [0, 0, 0], max: [1, 1, 1] }, selectionKeys: ["chunk:0"] },
        { id: "chunk-1", bounds: { min: [1, 0, 0], max: [2, 1, 1] }, selectionKeys: ["chunk:1"] },
        { id: "chunk-2", bounds: { min: [2, 0, 0], max: [3, 1, 1] }, selectionKeys: ["chunk:2"] },
        { id: "chunk-3", bounds: { min: [3, 0, 0], max: [4, 1, 1] }, selectionKeys: ["chunk:3"] },
      ],
    });

    const selection = selectPolyWorldChunkStreaming(topology, {
      orderedRegionIds: ["chunk-0", "chunk-1", "chunk-2", "chunk-3"],
      sources: [
        {
          id: "low-far-load",
          regionId: "chunk-3",
          targetState: "loaded",
          priority: 1,
          label: "far-load",
        },
        {
          id: "high-resident-window",
          regionId: "chunk-1",
          targetState: "resident",
          loadingRange: 1.1,
          priority: 20,
          label: "resident-range",
        },
      ],
    });

    expect(selection.regionIds).toEqual(["chunk-1", "chunk-0", "chunk-2", "chunk-3"]);
    expect(selection.selectionKeys).toEqual(["chunk:1", "chunk:0", "chunk:2", "chunk:3"]);
    expect(selection.reasons?.map((reason) => reason.label)).toEqual([
      "resident-range",
      "far-load",
      "selection-key",
    ]);
    expect(selection.streaming.requestedRegionIds).toEqual(["chunk-1", "chunk-0", "chunk-2", "chunk-3"]);
    expect(selection.streaming.loadingRegionIds).toEqual(["chunk-1", "chunk-0", "chunk-2", "chunk-3"]);
    expect(selection.streaming.loadedRegionIds).toEqual(["chunk-0", "chunk-1", "chunk-2", "chunk-3"]);
    expect(selection.streaming.residentRegionIds).toEqual(["chunk-0", "chunk-1", "chunk-2"]);
    expect(selection.streaming.activeRegionIds).toEqual([]);
    expect(selection.streaming.renderedRegionIds).toEqual([]);
    expect(selection.streaming.sources.map((source) => [source.sourceId, source.selectedRegionIds, source.priority])).toEqual([
      ["high-resident-window", ["chunk-1", "chunk-0", "chunk-2"], 20],
      ["low-far-load", ["chunk-3"], 1],
    ]);
  });
});

function findBspNode(
  child: PolyWorldBspChild,
  predicate: (node: PolyWorldBspNode) => boolean,
): PolyWorldBspNode | undefined {
  if ("leafId" in child) return undefined;
  if (predicate(child)) return child;
  return findBspNode(child.back, predicate) ?? findBspNode(child.front, predicate);
}

function collectBspNodes(child: PolyWorldBspChild): PolyWorldBspNode[] {
  if ("leafId" in child) return [];
  return [child, ...collectBspNodes(child.back), ...collectBspNodes(child.front)];
}

function reachableLeafIds(
  portals: readonly PolyWorldBspPortal[],
  startLeafId: string | undefined,
): Set<string> {
  const reachable = new Set<string>();
  const queue = startLeafId === undefined ? [] : [startLeafId];
  while (queue.length > 0) {
    const leafId = queue.shift();
    if (leafId === undefined || reachable.has(leafId)) continue;
    reachable.add(leafId);
    for (const portal of portals) {
      if (portal.fromLeafId === leafId && !reachable.has(portal.toLeafId)) queue.push(portal.toLeafId);
      if (portal.toLeafId === leafId && !reachable.has(portal.fromLeafId)) queue.push(portal.fromLeafId);
    }
  }
  return reachable;
}

function createTestPvsIndex(leafIds: readonly string[], portalIds: readonly string[]) {
  return {
    leafIds,
    portalIds,
    leafIndexById: new Map(leafIds.map((leafId, index) => [leafId, index])),
    portalIndexById: new Map(portalIds.map((portalId, index) => [portalId, index])),
  };
}

function testBitset(size: number, indices: readonly number[]): Uint32Array {
  const bits = new Uint32Array(Math.ceil(size / 32));
  for (const index of indices) bits[index >> 5] |= 1 << (index & 31);
  return bits;
}

function decodeTestBitset(ids: readonly string[], bits: Uint32Array | undefined): string[] {
  if (bits === undefined) return [];
  return ids.filter((_, index) => (bits[index >> 5] & (1 << (index & 31))) !== 0);
}

function expectBspErrorCodes(
  action: () => unknown,
  codes: readonly string[],
): readonly { code: string; id?: string }[] {
  try {
    action();
  } catch (error) {
    expect(error).toBeInstanceOf(PolyWorldBspError);
    const diagnostics = (error as PolyWorldBspError).diagnostics;
    expect(diagnostics.map((diagnostic) => diagnostic.code)).toEqual(expect.arrayContaining([...codes]));
    return diagnostics;
  }
  throw new Error("Expected PolyWorldBspError.");
}
