import { describe, expect, it } from "vitest";
import { createPolyWorldTopology, resolvePolyWorldElements } from "../topology";
import {
  compilePolyWorldBsp,
  resolvePolyWorldBspPvs,
  tracePolyWorldBspViewPvs,
} from "../profiles";
import {
  adaptPolyWorldBspDebugSnapshot,
  adaptPolyWorldDebugSnapshot,
  createPolyWorldBspDebugSnapshot,
  createPolyWorldDebugSnapshot,
} from "./index";

describe("createPolyWorldDebugSnapshot", () => {
  it("summarizes prepared-only selections without DOM or apply state", () => {
    const topology = createPolyWorldTopology({
      regions: [
        { id: "room-a" },
        { id: "room-b" },
      ],
      links: [
        { id: "door-a-b", fromRegionId: "room-a", toRegionId: "room-b" },
      ],
      elements: [
        { id: "room-a-shell", regionIds: ["room-a"], kind: "mesh", layers: ["world"], tags: ["solid"] },
        {
          id: "native-visible-faces",
          selectionKeys: ["visible:room-b"],
          parentId: "room-a-shell",
          containerId: "room-a-shell",
          kind: "mesh",
          layers: ["world"],
        },
        { id: "source-note", sourceIds: ["source:room-b"], kind: "metadata", layers: ["debug"], tags: ["source"] },
      ],
    });
    const selection = {
      regionIds: ["room-a"],
      linkIds: ["door-a-b"],
      selectionKeys: ["visible:room-b", "missing:key"],
      sourceIds: ["source:room-b"],
      reasons: [
        {
          label: "prepared-room",
          kind: "prepared",
          regionIds: ["room-a"],
        },
        {
          label: "native-visible-room",
          kind: "source-visible",
          selectionKeys: ["visible:room-b"],
        },
      ],
    };
    const resolution = resolvePolyWorldElements(topology, selection);
    const snapshot = createPolyWorldDebugSnapshot(topology, selection, {
      preparedOnly: true,
      resolution,
      metadata: { app: "fixture" },
    });

    expect(snapshot.preparedOnly).toBe(true);
    expect(snapshot.topology).toEqual({
      regionCount: 2,
      linkCount: 1,
      elementCount: 3,
    });
    expect(snapshot.selection.reasonLabels).toEqual(["prepared-room", "native-visible-room"]);
    expect(snapshot.selection.counts.reasonLabels).toBe(2);
    expect(snapshot.selection.omitted).toEqual({
      regionIds: 0,
      linkIds: 0,
      selectionKeys: 0,
      elementIds: 0,
      sourceIds: 0,
      aliases: 0,
      reasonLabels: 0,
    });
    expect(snapshot.elements).toEqual({
      elementIds: ["room-a-shell", "native-visible-faces", "source-note"],
      count: 3,
      omittedElementIds: 0,
      byKind: { mesh: 2, metadata: 1 },
      byLayer: { debug: 1, world: 2 },
      byTag: { solid: 1, source: 1 },
      relations: {
        parentElementIds: ["room-a-shell"],
        containerElementIds: ["room-a-shell"],
        parentCount: 1,
        containerCount: 1,
        omittedParentElementIds: 0,
        omittedContainerElementIds: 0,
      },
    });
    expect(snapshot.unresolved.selectionKeys).toEqual(["missing:key"]);
    expect(snapshot.metadata).toEqual({ app: "fixture" });
  });

  it("lets apps adapt debug snapshots without adding compatibility fields to generic types", () => {
    const topology = createPolyWorldTopology({
      regions: [{ id: "zone-a" }],
      elements: [{ id: "zone-a-shell", regionIds: ["zone-a"], sourceIds: ["src:a"] }],
    });
    const snapshot = createPolyWorldDebugSnapshot(topology, { regionIds: ["zone-a"] });

    expect(
      adaptPolyWorldDebugSnapshot(snapshot, (value) => ({
        selectedZone: value.selection.regionIds[0],
        sourceBacked: value.elements.elementIds.length > 0,
        parityClaim: false,
      })),
    ).toEqual({
      selectedZone: "zone-a",
      sourceBacked: true,
      parityClaim: false,
    });
  });

  it("can cap debug lists while preserving full counts", () => {
    const topology = createPolyWorldTopology({
      regions: [{ id: "zone-a" }, { id: "zone-b" }],
      elements: [
        { id: "zone-a-shell", regionIds: ["zone-a"] },
        { id: "zone-b-shell", regionIds: ["zone-b"] },
      ],
    });
    const snapshot = createPolyWorldDebugSnapshot(
      topology,
      {
        regionIds: ["zone-a", "zone-b"],
        reasons: [{ label: "current" }, { label: "linked" }],
      },
      { listLimit: 1 },
    );

    expect(snapshot.selection.regionIds).toEqual(["zone-a"]);
    expect(snapshot.selection.counts.regions).toBe(2);
    expect(snapshot.selection.omitted.regionIds).toBe(1);
    expect(snapshot.selection.reasonLabels).toEqual(["current"]);
    expect(snapshot.selection.omitted.reasonLabels).toBe(1);
    expect(snapshot.elements.elementIds).toEqual(["zone-a-shell"]);
    expect(snapshot.elements.count).toBe(2);
    expect(snapshot.elements.omittedElementIds).toBe(1);
  });
});

describe("createPolyWorldBspDebugSnapshot", () => {
  it("summarizes BSP tree shape, PVS density, current visibility, and trace statuses", () => {
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
    const broadPvs = resolvePolyWorldBspPvs(tree, "middle", { projection: "xy" });
    const trace = tracePolyWorldBspViewPvs(tree, {
      leafId: "middle",
      point: [0, 0, 1],
      forward: [-1, 0, 0],
      fovDegrees: 90,
      projection: "xy",
    });
    const snapshot = createPolyWorldBspDebugSnapshot(tree, {
      leafId: "middle",
      broadPvs,
      trace,
      includeTraceEntries: true,
      listLimit: 1,
      entryLimit: 1,
      metadata: { view: "west" },
    });

    expect(snapshot.tree).toMatchObject({
      leafCount: 3,
      portalCount: 2,
      compiler: "bounds-bsp",
    });
    expect(snapshot.tree.nodeCount).toBeGreaterThan(0);
    expect(snapshot.proof).toMatchObject({
      profile: "bsp-pvs",
      compiler: {
        id: "bounds-bsp",
        compiled: true,
      },
      tree: {
        leafCount: 3,
        portalCount: 2,
        rootLeafRefCount: 3,
        uniqueRootLeafRefCount: 3,
        referencesEveryLeafOnce: true,
      },
      leaves: {
        bakedPvsCount: 3,
        bakedPvsCoverage: 1,
        renderableCount: 3,
      },
      pvs: {
        method: "portal-clipped-baked",
        source: "polycss-world",
        completeness: "complete",
        indexed: true,
        indexLeafCount: 3,
        indexPortalCount: 2,
        indexLeafCoverage: 1,
        indexPortalCoverage: 1,
        bakedLeafCount: 3,
        bakedLeafCoverage: 1,
        complete: true,
      },
      evidence: {
        validatedBy: "createPolyWorldBspTree",
      },
    });
    expect(snapshot.proof.evidence.guarantees).toContain("validated-pvs-metadata");
    expect(snapshot.proof.artifact.guarantees).toContain("portal-clipped-baked-pvs");
    expect(snapshot.proof.artifact.guarantees).not.toContain("baked-pvs-bitsets");
    expect(snapshot.artifact).toMatchObject({
      profile: "bsp-pvs",
      artifactKind: "compiled-bsp-pvs",
      sourceKind: "compiled",
      producedBy: "bounds-bsp",
      counts: {
        leafCount: 3,
        portalCount: 2,
        bakedPvsCount: 3,
        indexLeafCount: 3,
        indexPortalCount: 2,
      },
      coverage: {
        bakedPvsCoverage: 1,
        indexLeafCoverage: 1,
        indexPortalCoverage: 1,
      },
    });
    expect(snapshot.artifact.guarantees).toContain("pvs-metadata-decode-audit");
    expect(snapshot.artifact.knownWeaknesses).toContain("not-full-qbsp-vis-parity");
    expect(snapshot.proof.artifact).toEqual(snapshot.artifact);
    expect(snapshot.leaves.bakedPvsCount).toBe(3);
    expect(snapshot.leaves.pvsDensity).toBeGreaterThan(0);
    expect(snapshot.current.leafId).toBe("middle");
    expect(snapshot.current.broadPvs?.leafIds).toEqual({
      values: ["left"],
      count: 3,
      omitted: 2,
    });
    expect(snapshot.current.viewPvs?.leafIds).toEqual({
      values: ["left"],
      count: 2,
      omitted: 1,
    });
    expect(snapshot.current.viewPvs?.broadPhaseLeafIds.count).toBe(3);
    expect(snapshot.trace?.statusCounts).toEqual({
      visible: 1,
      clipped: 1,
    });
    expect(snapshot.trace?.entries).toEqual([
      {
        portalId: "left-middle",
        fromLeafId: "middle",
        toLeafId: "left",
        depth: 0,
        status: "visible",
        inputVertexCount: 4,
        clippedVertexCount: 4,
        clipPlaneCount: 9,
        linkId: "left-middle",
      },
    ]);
    expect(snapshot.trace?.omittedEntries).toBe(1);
    expect(snapshot.metadata).toEqual({ view: "west" });
    expect(adaptPolyWorldBspDebugSnapshot(snapshot, (value) => value.current.viewPvs?.portalIds.count)).toBe(1);
  });
});
