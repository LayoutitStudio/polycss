import { describe, expect, it } from "vitest";
import {
  PolyWorldDocumentError,
  PolyWorldTopologyError,
  createPolyWorldDocument,
  createPolyWorldTopologyCapabilityContract,
  createPolyWorldTopology,
  expandPolyWorldSelectionElementRelations,
  resolvePolyWorldElementSubtree,
  resolvePolyWorldElementRelations,
  resolvePolyWorldElements,
  resolvePolyWorldRegionByPoint,
  selectPolyWorldElementsByPurpose,
} from "./index";
import type { PolyWorldDocumentInput, PolyWorldTopologyInput } from "./index";
import {
  createPolyWorldFakeRoomGraphFixture,
  createPolyWorldPartitionGalleryFixture,
} from "../testing/fixtures";

function baseTopology(): PolyWorldTopologyInput {
  return {
    regions: [
      {
        id: "atrium",
        kind: "room",
        bounds: { min: [0, 0, 0], max: [10, 10, 4] },
        selectionKeys: ["faces:atrium"],
        aliases: ["room:0"],
      },
      {
        id: "hall",
        kind: "room",
        bounds: { min: [10, 0, 0], max: [20, 10, 4] },
        selectionKeys: ["faces:hall"],
      },
      {
        id: "service",
        kind: "room",
        center: [30, 0, 0],
      },
    ],
    links: [
      {
        id: "atrium-hall",
        fromRegionId: "atrium",
        toRegionId: "hall",
        kind: "portal",
        selectionKeys: ["portal:atrium-hall"],
      },
    ],
    elements: [
      {
        id: "atrium-shell",
        kind: "mesh",
        path: "/World/Atrium/Shell",
        regionIds: ["atrium"],
        bounds: { min: [0, 0, 0], max: [10, 10, 4] },
        purposes: ["render", "occluder"],
        resourceIds: ["mesh:atrium-shell"],
        layers: ["world"],
        tags: ["solid"],
        sourceIds: ["src:room-a"],
        aliases: ["mesh:atrium"],
      },
      {
        id: "door-frame",
        kind: "mesh",
        path: "/World/Atrium/DoorFrame",
        parentId: "atrium-shell",
        containerId: "atrium-shell",
        regionIds: ["atrium", "hall"],
        regionMatch: "all",
        transform: { position: [10, 5, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
        purposes: ["render", "portal"],
        layers: ["world"],
        tags: ["connector"],
      },
      {
        id: "hall-lights",
        kind: "lights",
        path: "/World/Hall/Lights",
        regionIds: ["hall"],
        purposes: ["debug"],
        layers: ["effects"],
        tags: ["dynamic"],
      },
      {
        id: "sky-banner",
        kind: "mesh",
        selectionKeys: ["faces:sky"],
        layers: ["sky"],
      },
    ],
    spatialElements: [
      {
        id: "atrium-floor-surface",
        elementId: "atrium-shell",
        regionId: "atrium",
        leafId: "atrium-leaf",
        role: "shell",
        visibility: "structural",
        resourceIds: ["texture:stone"],
        vertices: [
          [0, 0, 0],
          [10, 0, 0],
          [10, 10, 0],
          [0, 10, 0],
        ],
      },
      {
        id: "atrium-door-opening",
        elementId: "door-frame",
        regionId: "atrium",
        role: "opening",
        bounds: { min: [9.9, 3, 0], max: [10, 7, 3] },
      },
    ],
  };
}

describe("createPolyWorldTopology", () => {
  it("exposes the V10 package capability contract without taking app-owned runtime work", () => {
    const contract = createPolyWorldTopologyCapabilityContract();

    expect(contract).toMatchObject({
      schemaVersion: 1,
      packageName: "@layoutit/polycss-world",
    });
    expect(contract.references.map((reference) => reference.id)).toEqual([
      "polycss",
      "x3d",
      "openusd",
      "quake-bsp-pvs",
      "quake-qbsp",
      "3d-tiles",
      "gltf-lod",
    ]);
    const referencesById = new Map(contract.references.map((reference) => [reference.id, reference]));
    expect(referencesById.get("polycss")).toMatchObject({
      claimLevel: "renderer-target",
      sourceUrls: ["https://github.com/LayoutitStudio/polycss"],
    });
    expect(referencesById.get("x3d")).toMatchObject({
      claimLevel: "structure-reference",
    });
    expect(referencesById.get("x3d")?.sourceUrls).toContain(
      "https://www.web3d.org/specifications/X3Dv4/ISO-IEC19775-1v4-IS/Part01/concepts.html",
    );
    expect(referencesById.get("x3d")?.outOfScope).toContain("visibility proof from grouping bounds alone");
    expect(referencesById.get("openusd")).toMatchObject({
      claimLevel: "structure-reference",
    });
    expect(referencesById.get("openusd")?.outOfScope).toContain("USD payload loading");
    const quakeReference = contract.references.find((reference) => reference.id === "quake-bsp-pvs");
    expect(quakeReference?.claimLevel).toBe("topology-proof");
    expect(quakeReference?.sourceUrls).toContain("https://github.com/id-Software/Quake");
    expect(quakeReference?.packageUses).toContain("camera leaf lookup");
    expect(quakeReference?.outOfScope).toContain("Quake BSP file parsing");
    expect(quakeReference?.compatibilityClaim).toContain("not Quake BSP format compatibility");
    expect(referencesById.get("quake-qbsp")).toMatchObject({
      claimLevel: "compiler-boundary",
      outOfScope: expect.arrayContaining(["full vis solver parity"]),
    });
    const usdReference = contract.references.find((reference) => reference.id === "openusd");
    expect(usdReference?.packageUses).toContain("stable element paths");
    expect(usdReference?.outOfScope).toContain("USD composition arcs");
    const tilesReference = contract.references.find((reference) => reference.id === "3d-tiles");
    expect(tilesReference?.claimLevel).toBe("working-set-reference");
    expect(tilesReference?.packageUses).toContain("refinement and geometric-error planning");
    expect(tilesReference?.outOfScope).toContain("network scheduling");
    expect(tilesReference?.sourceUrls).toContain(
      "https://github.com/CesiumGS/3d-tiles/blob/main/specification/README.adoc",
    );
    expect(referencesById.get("gltf-lod")).toMatchObject({
      claimLevel: "asset-boundary",
      outOfScope: expect.arrayContaining(["glTF loading", "mesh selection or replacement"]),
    });
    expect(contract.capabilities.map((capability) => capability.id)).toEqual([
      "world-ir",
      "compiled-bsp-pvs",
      "area-portals",
      "chunk-hierarchy",
      "resource-readiness",
      "dom-planning",
      "debug-proof",
    ]);

    const bsp = contract.capabilities.find((capability) => capability.id === "compiled-bsp-pvs");
    expect(bsp?.references).toEqual(["quake-bsp-pvs", "quake-qbsp"]);
    expect(bsp?.packageOwns).toContain("view-clipped PVS traversal");
    expect(bsp?.publicExports).toContain("planPolyWorldBspVisibilityFrame");
    expect(bsp?.appOwns).toContain("first-person controls");
    expect(bsp?.appOwns).toContain("Quake-compatible qbsp/vis parity");

    const chunks = contract.capabilities.find((capability) => capability.id === "chunk-hierarchy");
    expect(chunks?.references).toEqual(["3d-tiles", "gltf-lod"]);
    expect(chunks?.packageOwns).toContain("budgeted traversal");
    expect(chunks?.appOwns).toContain("fetch scheduling");
    expect(chunks?.appOwns).toContain("renderer LOD swaps");

    const areaPortals = contract.capabilities.find((capability) => capability.id === "area-portals");
    expect(areaPortals?.publicExports).toContain("planPolyWorldPortalFlowFrame");
    expect(areaPortals?.packageOwns).toContain("authored portal flow");

    expect(contract.nonGoals).toContain("format loaders");
    expect(contract.nonGoals).toContain("renderer imports");
    expect(contract.nonGoals).toContain("source-engine parity claims without source-compatible compilers");
  });

  it("creates a canonical authored-world document with topology, profiles, resources, and policies", () => {
    const document = createPolyWorldDocument({
      id: "atrium-world",
      label: "Atrium World",
      topology: baseTopology(),
      capabilityIds: ["world-ir", "compiled-bsp-pvs", "chunk-hierarchy", "resource-readiness"],
      profileArtifacts: [
        {
          id: "atrium-bsp",
          profile: "bsp-pvs",
          artifactKind: "compiled-bsp-pvs",
          sourceKind: "compiled",
          producedBy: "brush-bsp",
          elementIds: ["atrium-shell"],
          spatialElementIds: ["atrium-floor-surface"],
          resourceIds: ["mesh:atrium-shell", "texture:stone"],
        },
        {
          id: "atrium-chunks",
          profile: "chunk-traversal",
          artifactKind: "chunk-working-set",
          sourceKind: "authored-runtime-selection",
          producedBy: "authored-track",
        },
      ],
      resources: [
        {
          id: "mesh:atrium-shell",
          state: "ready",
          renderBlocking: true,
          elementIds: ["atrium-shell"],
        },
        {
          id: "texture:stone",
          state: "stale",
          renderBlocking: false,
          spatialElementIds: ["atrium-floor-surface"],
        },
      ],
      planPolicies: [
        {
          id: "render-world",
          layer: "world",
          phase: "render",
          elementLayers: ["world"],
          targetStates: {
            added: { rendered: true },
            retained: { rendered: true },
          },
        },
      ],
      data: { source: "test" },
    });

    expect(document).toMatchObject({
      schemaVersion: 1,
      id: "atrium-world",
      label: "Atrium World",
      summary: {
        regionCount: 3,
        linkCount: 1,
        elementCount: 4,
        spatialElementCount: 2,
        profileArtifactCount: 2,
        resourceCount: 2,
        planPolicyCount: 1,
        capabilityIds: ["world-ir", "compiled-bsp-pvs", "chunk-hierarchy", "resource-readiness"],
      },
      data: { source: "test" },
    });
    expect(document.topology.regionsById.get("atrium")?.center).toEqual([5, 5, 2]);
    expect(document.capabilities.map((capability) => capability.id)).toEqual([
      "world-ir",
      "compiled-bsp-pvs",
      "chunk-hierarchy",
      "resource-readiness",
    ]);
    expect(document.profileArtifactsById.get("atrium-bsp")?.producedBy).toBe("brush-bsp");
    expect(document.profileArtifactIdsByProfile.get("bsp-pvs")).toEqual(["atrium-bsp"]);
    expect(document.profileArtifactIdsByProfile.get("chunk-traversal")).toEqual(["atrium-chunks"]);
    expect(document.resourcesById.get("texture:stone")).toMatchObject({
      state: "stale",
      spatialElementIds: ["atrium-floor-surface"],
    });
    expect(document.planPoliciesById.get("render-world")?.elementLayers).toEqual(["world"]);
  });

  it("creates the partition-gallery fixture as a document-owned authored world boundary", () => {
    const fixture = createPolyWorldPartitionGalleryFixture();
    const document = createPolyWorldDocument(fixture.documentInput);

    expect(document).toMatchObject({
      schemaVersion: 1,
      id: "partition-gallery",
      summary: {
        regionCount: 6,
        linkCount: 5,
        elementCount: 24,
        spatialElementCount: 24,
        profileArtifactCount: 1,
        resourceCount: 24,
        planPolicyCount: 1,
        capabilityIds: ["world-ir", "compiled-bsp-pvs", "resource-readiness", "dom-planning"],
      },
    });
    expect(document.profileArtifactsById.get("partition-gallery-bsp")).toMatchObject({
      profile: "bsp-pvs",
      artifactKind: "compiled-bsp-pvs",
      sourceKind: "compiled",
      producedBy: "bounds-bsp",
    });
    expect(document.profileArtifactIdsByProfile.get("bsp-pvs")).toEqual(["partition-gallery-bsp"]);
    expect(document.topology.elementsByPath.get("/World/PartitionGallery/gallery/gallery-floor")?.id)
      .toBe("gallery-floor-element");
    expect(document.topology.spatialElementsByRole.get("shell")?.map((element) => element.id))
      .toContain("gallery-floor");
    expect(document.topology.spatialElementsByVisibility.get("structural")?.map((element) => element.id))
      .toEqual(expect.arrayContaining([
      "studio-floor",
      "studio-ceiling",
      "gallery-opening-frame",
    ]));
    expect(document.resourcesById.get("mesh:gallery-prop-element")).toMatchObject({
      state: "stale",
      renderBlocking: false,
      spatialElementIds: ["gallery-prop"],
    });
    expect(document.planPoliciesById.get("render-world")?.elementLayers).toEqual(["world"]);
  });

  it("keeps a fake room graph in the portal-flow profile instead of letting it masquerade as BSP/PVS", () => {
    const fixture = createPolyWorldFakeRoomGraphFixture();
    const document = createPolyWorldDocument(fixture.documentInput);

    expect(document.capabilityIds).toEqual(["world-ir", "area-portals"]);
    expect(document.profileArtifactsById.get("fake-portal-flow")).toMatchObject({
      profile: "portal-flow",
      artifactKind: "authored-area-portal-flow",
      sourceKind: "authored-runtime-selection",
      producedBy: "authored-links",
    });
    expect(document.profileArtifactIdsByProfile.get("bsp-pvs")).toBeUndefined();
    expect(() => createPolyWorldDocument({
      ...fixture.documentInput,
      profileArtifacts: [
        ...(fixture.documentInput.profileArtifacts ?? []),
        {
          id: "fake-bsp",
          profile: "bsp-pvs",
          artifactKind: "compiled-bsp-pvs",
          sourceKind: "authored",
          producedBy: "authored-links",
        },
      ],
    })).toThrow(PolyWorldDocumentError);
  });

  it("rejects profile artifact refs when their topology capability is disabled", () => {
    const input: PolyWorldDocumentInput = {
      topology: baseTopology(),
      capabilityIds: ["world-ir", "resource-readiness"],
      profileArtifacts: [
        {
          id: "atrium-bsp",
          profile: "bsp-pvs",
          artifactKind: "compiled-bsp-pvs",
        },
        {
          id: "atrium-flow",
          profile: "portal-flow",
          artifactKind: "authored-area-portal-flow",
        },
        {
          id: "atrium-chunks",
          profile: "chunk-traversal",
          artifactKind: "chunk-working-set",
        },
      ],
    };

    expect(() => createPolyWorldDocument(input)).toThrow(PolyWorldDocumentError);
    try {
      createPolyWorldDocument(input);
    } catch (error) {
      expect((error as PolyWorldDocumentError).diagnostics).toEqual(expect.arrayContaining([
        expect.objectContaining({
          code: "poly-world-document-profile-artifact-capability-disabled",
          id: "atrium-bsp",
          field: "profileArtifacts.profile",
          kind: "profileArtifact",
        }),
        expect.objectContaining({
          code: "poly-world-document-profile-artifact-capability-disabled",
          id: "atrium-flow",
          field: "profileArtifacts.profile",
          kind: "profileArtifact",
        }),
        expect.objectContaining({
          code: "poly-world-document-profile-artifact-capability-disabled",
          id: "atrium-chunks",
          field: "profileArtifacts.profile",
          kind: "profileArtifact",
        }),
      ]));
    }
  });

  it("rejects malformed authored-world document references before profile frames use them", () => {
    const input: PolyWorldDocumentInput = {
      id: "",
      topology: baseTopology(),
      capabilityIds: ["world-ir", "world-ir", "missing-capability" as never],
      profileArtifacts: [
        {
          id: "bad-profile",
          profile: "bsp-pvs",
          artifactKind: "chunk-working-set",
          sourceKind: "compiled",
          elementIds: ["missing-element"],
          spatialElementIds: ["missing-spatial"],
        },
        {
          id: "bad-profile",
          profile: "not-a-profile" as never,
          sourceKind: "not-a-source" as never,
        },
      ],
      resources: [
        {
          id: "resource-a",
          state: "ready",
          elementIds: ["atrium-shell"],
        },
        {
          id: "resource-a",
          state: "not-ready" as never,
          spatialElementIds: ["missing-spatial"],
        },
      ],
      planPolicies: [
        {
          id: "render-world",
          layer: "world",
          elementIds: ["missing-element"],
        },
        {
          id: "render-world",
          layer: "",
        },
      ],
    };

    expect(() => createPolyWorldDocument(input)).toThrow(PolyWorldDocumentError);
    try {
      createPolyWorldDocument(input);
    } catch (error) {
      const diagnostics = (error as PolyWorldDocumentError).diagnostics;
      expect(diagnostics).toEqual(expect.arrayContaining([
        expect.objectContaining({ code: "poly-world-document-empty-id", kind: "document" }),
        expect.objectContaining({ code: "poly-world-document-duplicate-capability-id", id: "world-ir" }),
        expect.objectContaining({ code: "poly-world-document-invalid-capability-id", id: "missing-capability" }),
        expect.objectContaining({ code: "poly-world-document-duplicate-profile-artifact-id", id: "bad-profile" }),
        expect.objectContaining({ code: "poly-world-document-profile-artifact-kind-mismatch", id: "bad-profile" }),
        expect.objectContaining({ code: "poly-world-document-invalid-profile-artifact-profile", id: "bad-profile" }),
        expect.objectContaining({ code: "poly-world-document-invalid-profile-artifact-source-kind", id: "bad-profile" }),
        expect.objectContaining({ code: "poly-world-document-missing-element", id: "bad-profile", field: "profileArtifacts.elementIds" }),
        expect.objectContaining({ code: "poly-world-document-missing-spatial-element", id: "bad-profile", field: "profileArtifacts.spatialElementIds" }),
        expect.objectContaining({ code: "poly-world-document-duplicate-resource-id", id: "resource-a" }),
        expect.objectContaining({ code: "poly-world-document-invalid-resource-state", id: "resource-a" }),
        expect.objectContaining({ code: "poly-world-document-missing-spatial-element", id: "resource-a", field: "resources.spatialElementIds" }),
        expect.objectContaining({ code: "poly-world-document-duplicate-plan-policy-id", id: "render-world" }),
        expect.objectContaining({ code: "poly-world-document-empty-plan-policy-layer", id: "render-world" }),
        expect.objectContaining({ code: "poly-world-document-missing-element", id: "render-world", field: "planPolicies.elementIds" }),
      ]));
    }
  });

  it("surfaces topology validation through the document gate", () => {
    const input: PolyWorldDocumentInput = {
      topology: {
        regions: [],
      },
    };

    expect(() => createPolyWorldDocument(input)).toThrow(PolyWorldDocumentError);
    try {
      createPolyWorldDocument(input);
    } catch (error) {
      expect((error as PolyWorldDocumentError).diagnostics).toEqual(expect.arrayContaining([
        expect.objectContaining({
          code: "poly-world-empty-regions",
          field: "regions",
          kind: "topology",
        }),
      ]));
    }
  });

  it("normalizes indexes and derives region centers from bounds", () => {
    const topology = createPolyWorldTopology(baseTopology());

    expect(topology.regionsById.get("atrium")?.center).toEqual([5, 5, 2]);
    expect(topology.linksByRegionId.get("atrium")?.map((link) => link.id)).toEqual(["atrium-hall"]);
    expect(topology.elementsByRegionId.get("atrium")?.map((element) => element.id)).toEqual([
      "atrium-shell",
      "door-frame",
    ]);
    expect(topology.elementsByPath.get("/World/Atrium/Shell")?.id).toBe("atrium-shell");
    expect(topology.elementsBySelectionKey.get("faces:sky")?.map((element) => element.id)).toEqual(["sky-banner"]);
    expect(topology.selectionKeyOwnersByKey.get("faces:atrium")).toEqual([
      { kind: "region", id: "atrium" },
    ]);
    expect(topology.selectionKeyOwnersByKey.get("faces:sky")).toEqual([
      { kind: "element", id: "sky-banner" },
    ]);
    expect(topology.elementsBySourceId.get("src:room-a")?.map((element) => element.id)).toEqual(["atrium-shell"]);
    expect(topology.elementsByAlias.get("mesh:atrium")?.map((element) => element.id)).toEqual(["atrium-shell"]);
    expect(topology.elementsByPurpose.get("render")?.map((element) => element.id)).toEqual([
      "atrium-shell",
      "door-frame",
    ]);
    expect(topology.elementsByPurpose.get("portal")?.map((element) => element.id)).toEqual(["door-frame"]);
    expect(topology.elementsByResourceId.get("mesh:atrium-shell")?.map((element) => element.id)).toEqual([
      "atrium-shell",
    ]);
    expect(topology.elementsByParentId.get("atrium-shell")?.map((element) => element.id)).toEqual(["door-frame"]);
    expect(topology.elementsByContainerId.get("atrium-shell")?.map((element) => element.id)).toEqual(["door-frame"]);
    expect(topology.spatialElementsByElementId.get("atrium-shell")?.map((spatialElement) => spatialElement.id)).toEqual([
      "atrium-floor-surface",
    ]);
    expect(topology.spatialElementsByRegionId.get("atrium")?.map((spatialElement) => spatialElement.id)).toEqual([
      "atrium-floor-surface",
      "atrium-door-opening",
    ]);
    expect(topology.spatialElementsByLeafId.get("atrium-leaf")?.map((spatialElement) => spatialElement.id)).toEqual([
      "atrium-floor-surface",
    ]);
    expect(topology.spatialElementsByRole.get("opening")?.map((spatialElement) => spatialElement.id)).toEqual([
      "atrium-door-opening",
    ]);
    expect(topology.spatialElementsByVisibility.get("structural")?.map((spatialElement) => spatialElement.id)).toEqual([
      "atrium-floor-surface",
    ]);
    expect(topology.spatialElementsByResourceId.get("texture:stone")?.map((spatialElement) => spatialElement.id)).toEqual([
      "atrium-floor-surface",
    ]);
  });

  it("rejects duplicate ids, missing endpoints, ambiguous multi-region elements, and empty arrays", () => {
    const input: PolyWorldTopologyInput = {
      regions: [
        { id: "a" },
        { id: "a" },
      ],
      links: [
        { id: "bad-link", fromRegionId: "a", toRegionId: "missing" },
      ],
      elements: [
        { id: "ambiguous", regionIds: ["a", "missing"] },
        { id: "empty-key", selectionKeys: [] },
        { id: "missing-parent", regionIds: ["a"], parentId: "nope" },
        { id: "self-container", regionIds: ["a"], containerId: "self-container" },
      ],
    };

    expect(() => createPolyWorldTopology(input)).toThrow(PolyWorldTopologyError);
    try {
      createPolyWorldTopology(input);
    } catch (error) {
      const codes = (error as PolyWorldTopologyError).diagnostics.map((diagnostic) => diagnostic.code);
      expect(codes).toContain("poly-world-duplicate-region-id");
      expect(codes).toContain("poly-world-missing-link-region");
      expect(codes).toContain("poly-world-missing-element-region");
      expect(codes).toContain("poly-world-ambiguous-region-match");
      expect(codes).toContain("poly-world-empty-array");
      expect(codes).toContain("poly-world-missing-element-relation");
      expect(codes).toContain("poly-world-self-element-relation");
    }
  });

  it("indexes element parent and container relations even when the parent appears later", () => {
    const topology = createPolyWorldTopology({
      regions: [{ id: "chunk" }],
      elements: [
        { id: "chunk-leaf", regionIds: ["chunk"], parentId: "chunk-root", containerId: "chunk-root" },
        { id: "chunk-root", regionIds: ["chunk"], layers: ["resident"] },
      ],
    });

    expect(topology.elementsByParentId.get("chunk-root")?.map((element) => element.id)).toEqual(["chunk-leaf"]);
    expect(topology.elementsByContainerId.get("chunk-root")?.map((element) => element.id)).toEqual(["chunk-leaf"]);
  });

  it("resolves element graph subtrees and purpose-filtered selections without touching DOM", () => {
    const topology = createPolyWorldTopology({
      regions: [{ id: "room" }],
      elements: [
        { id: "scene-root", selectionKeys: ["root:scene"], purposes: ["render"], layers: ["resident"] },
        { id: "room-root", parentId: "scene-root", containerId: "scene-root", selectionKeys: ["root:room"], purposes: ["render"], layers: ["resident"] },
        { id: "room-wall", parentId: "room-root", containerId: "room-root", regionIds: ["room"], purposes: ["render", "occluder"], layers: ["render"] },
        { id: "room-collider", parentId: "room-root", containerId: "room-root", regionIds: ["room"], purposes: ["collision"], layers: ["collision"] },
        { id: "room-debug", parentId: "room-root", selectionKeys: ["debug:room"], purposes: ["debug"], layers: ["debug"] },
      ],
    });

    expect(resolvePolyWorldElementSubtree(topology, ["room-root"], { purposes: ["render"] })).toEqual({
      seedElementIds: ["room-root"],
      relation: "parent",
      elementIds: ["room-root", "room-wall"],
      descendantElementIds: ["room-wall"],
      missingElementIds: [],
    });
    expect(resolvePolyWorldElementSubtree(topology, ["missing", "scene-root"], {
      relation: "container",
      includeSeeds: false,
      recursive: false,
    })).toEqual({
      seedElementIds: ["missing", "scene-root"],
      relation: "container",
      elementIds: ["room-root"],
      descendantElementIds: ["room-root"],
      missingElementIds: ["missing"],
    });

    const selection = selectPolyWorldElementsByPurpose(topology, ["render"], {
      includeDescendants: true,
      reasonLabel: "render-purpose",
    });

    expect(selection.elementIds).toEqual(["scene-root", "room-root", "room-wall"]);
    expect(selection.reasons).toEqual([
      expect.objectContaining({
        label: "render-purpose",
        kind: "element-purpose",
        elementIds: ["scene-root", "room-root", "room-wall"],
        data: {
          purposes: ["render"],
          match: "any",
          relation: "parent",
          descendantElementIds: ["room-root", "room-wall"],
        },
      }),
    ]);
  });

  it("keeps authored-world strict validation opt-in", () => {
    const topology = createPolyWorldTopology({
      regions: [
        { id: "entry", bounds: { min: [0, 0, 0], max: [4, 4, 3] } },
        { id: "loose" },
      ],
      elements: [
        { id: "entry-shell", regionIds: ["entry"] },
      ],
    });

    expect(topology.regions.map((region) => region.id)).toEqual(["entry", "loose"]);
    expect(topology.elements.map((element) => element.id)).toEqual(["entry-shell"]);
  });

  it("rejects malformed authored worlds when strict topology validation is enabled", () => {
    const input: PolyWorldTopologyInput = {
      validation: { strict: true },
      regions: [
        { id: "entry", bounds: { min: [0, 0, 0], max: [4, 4, 3] } },
        { id: "gallery" },
        { id: "vault", center: [12, 0, 0] },
      ],
      links: [
        { id: "entry-gallery", fromRegionId: "entry", toRegionId: "gallery" },
      ],
      elements: [
        { id: "entry-shell", regionIds: ["entry"] },
        { id: "gallery-shell", regionIds: ["gallery"], layers: ["world"] },
      ],
    };

    expect(() => createPolyWorldTopology(input)).toThrow(PolyWorldTopologyError);
    try {
      createPolyWorldTopology(input);
    } catch (error) {
      const diagnostics = (error as PolyWorldTopologyError).diagnostics;
      expect(diagnostics).toEqual(expect.arrayContaining([
        expect.objectContaining({
          code: "poly-world-missing-region-spatial-reference",
          id: "gallery",
          field: "bounds",
          kind: "region",
        }),
        expect.objectContaining({
          code: "poly-world-unreachable-region",
          id: "vault",
          field: "links",
          kind: "region",
        }),
        expect.objectContaining({
          code: "poly-world-missing-element-layers",
          id: "entry-shell",
          field: "layers",
          kind: "element",
        }),
      ]));
    }
  });

  it("lets strict authored validation disable specific checks", () => {
    const topology = createPolyWorldTopology({
      validation: {
        strict: true,
        requireConnectedRegions: false,
        requireElementLayers: false,
      },
      regions: [
        { id: "entry", bounds: { min: [0, 0, 0], max: [4, 4, 3] } },
        { id: "remote", center: [100, 0, 0] },
      ],
      elements: [
        { id: "entry-shell", regionIds: ["entry"] },
      ],
    });

    expect(topology.regions.map((region) => region.id)).toEqual(["entry", "remote"]);
    expect(topology.elementsByRegionId.get("entry")?.map((element) => element.id)).toEqual(["entry-shell"]);
  });

  it("can require explicit region bounds for compiler-owned authored topology", () => {
    const input: PolyWorldTopologyInput = {
      validation: { requireRegionBounds: true },
      regions: [
        { id: "entry", bounds: { min: [0, 0, 0], max: [4, 4, 3] } },
        { id: "marker-only", center: [8, 0, 0] },
      ],
    };

    expect(() => createPolyWorldTopology(input)).toThrow(PolyWorldTopologyError);
    try {
      createPolyWorldTopology(input);
    } catch (error) {
      expect((error as PolyWorldTopologyError).diagnostics).toEqual(expect.arrayContaining([
        expect.objectContaining({
          code: "poly-world-missing-region-bounds",
          id: "marker-only",
          field: "bounds",
          kind: "region",
        }),
      ]));
    }
  });

  it("rejects parent and container cycles before they reach planning or DOM apply", () => {
    const input: PolyWorldTopologyInput = {
      regions: [{ id: "room" }],
      elements: [
        { id: "parent-a", regionIds: ["room"], parentId: "parent-b" },
        { id: "parent-b", regionIds: ["room"], parentId: "parent-a" },
        { id: "container-a", regionIds: ["room"], containerId: "container-b" },
        { id: "container-b", regionIds: ["room"], containerId: "container-a" },
      ],
    };

    expect(() => createPolyWorldTopology(input)).toThrow(PolyWorldTopologyError);
    try {
      createPolyWorldTopology(input);
    } catch (error) {
      const diagnostics = (error as PolyWorldTopologyError).diagnostics;
      expect(diagnostics.filter((diagnostic) => diagnostic.code === "poly-world-element-relation-cycle")).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: "parent-a", field: "parentId" }),
          expect.objectContaining({ id: "container-a", field: "containerId" }),
        ]),
      );
    }
  });

  it("rejects malformed element graph metadata before planning uses it", () => {
    const input: PolyWorldTopologyInput = {
      regions: [{ id: "room" }],
      elements: [
        {
          id: "bad-path-a",
          path: "World/Bad",
          regionIds: ["room"],
          bounds: { min: [2, 0, 0], max: [1, 1, 1] },
          transform: { matrix: [1, 0, 0] },
          purposes: ["render", "proxy"],
        },
        {
          id: "bad-path-b",
          path: "World/Bad",
          selectionKeys: ["bad:path"],
          transform: { position: [0, Number.NaN, 0] },
          purposes: ["sound" as never],
        },
      ],
    };

    expect(() => createPolyWorldTopology(input)).toThrow(PolyWorldTopologyError);
    try {
      createPolyWorldTopology(input);
    } catch (error) {
      const diagnostics = (error as PolyWorldTopologyError).diagnostics;
      expect(diagnostics).toEqual(expect.arrayContaining([
        expect.objectContaining({ code: "poly-world-invalid-element-path", id: "bad-path-a", field: "path" }),
        expect.objectContaining({ code: "poly-world-duplicate-element-path", id: "bad-path-b", field: "path" }),
        expect.objectContaining({ code: "poly-world-invalid-bounds", id: "bad-path-a", field: "bounds" }),
        expect.objectContaining({ code: "poly-world-invalid-element-transform-matrix", id: "bad-path-a", field: "transform.matrix" }),
        expect.objectContaining({ code: "poly-world-conflicting-element-purposes", id: "bad-path-a", field: "purposes" }),
        expect.objectContaining({ code: "poly-world-invalid-vec3", id: "bad-path-b", field: "transform.position" }),
        expect.objectContaining({ code: "poly-world-invalid-element-purpose", id: "bad-path-b", field: "purposes" }),
      ]));
    }
  });

  it("rejects malformed spatial element catalog entries", () => {
    const input: PolyWorldTopologyInput = {
      regions: [{ id: "room" }],
      elements: [{ id: "room-shell", regionIds: ["room"] }],
      spatialElements: [
        {
          id: "room-surface",
          elementId: "missing-element",
          regionId: "missing-region",
          role: "portal" as never,
          vertices: [
            [0, 0, 0],
            [1, 0, 0],
            [1, 1, 1],
            [0, 1, 0],
          ],
        },
        {
          id: "empty-ref",
          bounds: { min: [1, 1, 1], max: [0, 1, 1] },
        },
      ],
    };

    expect(() => createPolyWorldTopology(input)).toThrow(PolyWorldTopologyError);
    try {
      createPolyWorldTopology(input);
    } catch (error) {
      const diagnostics = (error as PolyWorldTopologyError).diagnostics;
      expect(diagnostics).toEqual(expect.arrayContaining([
        expect.objectContaining({
          code: "poly-world-missing-spatial-element-element",
          id: "room-surface",
          field: "elementId",
          kind: "spatialElement",
        }),
        expect.objectContaining({
          code: "poly-world-missing-spatial-element-region",
          id: "room-surface",
          field: "regionId",
          kind: "spatialElement",
        }),
        expect.objectContaining({
          code: "poly-world-invalid-spatial-element-role",
          id: "room-surface",
          field: "role",
          kind: "spatialElement",
        }),
        expect.objectContaining({
          code: "poly-world-non-coplanar-spatial-element-polygon",
          id: "room-surface",
          field: "vertices",
          kind: "spatialElement",
        }),
        expect.objectContaining({
          code: "poly-world-missing-spatial-element-reference",
          id: "empty-ref",
          kind: "spatialElement",
        }),
        expect.objectContaining({
          code: "poly-world-invalid-bounds",
          id: "empty-ref",
          field: "bounds",
          kind: "spatialElement",
        }),
      ]));
    }
  });
});

describe("resolvePolyWorldElements", () => {
  it("resolves single-region elements by region and requires all selected regions for all-match elements", () => {
    const topology = createPolyWorldTopology(baseTopology());

    expect(resolvePolyWorldElements(topology, { regionIds: ["atrium"] }).elementIds).toEqual(["atrium-shell"]);
    expect(resolvePolyWorldElements(topology, { regionIds: ["atrium", "hall"] }).elementIds).toEqual([
      "atrium-shell",
      "door-frame",
      "hall-lights",
    ]);
  });

  it("resolves by selection key, element id, source id, and alias independent of region selection", () => {
    const topology = createPolyWorldTopology(baseTopology());
    const resolution = resolvePolyWorldElements(topology, {
      selectionKeys: ["faces:sky"],
      elementIds: ["hall-lights"],
      sourceIds: ["src:room-a"],
      aliases: ["mesh:atrium"],
    });

    expect(resolution.elementIds).toEqual(["atrium-shell", "hall-lights", "sky-banner"]);
    expect(resolution.resolved.find((entry) => entry.elementId === "atrium-shell")?.matches).toEqual([
      { kind: "sourceId", value: "src:room-a" },
      { kind: "alias", value: "mesh:atrium" },
    ]);
  });

  it("filters resolved elements by layer and tag", () => {
    const topology = createPolyWorldTopology(baseTopology());

    expect(
      resolvePolyWorldElements(topology, { regionIds: ["atrium", "hall"] }, { layers: ["effects"] }).elementIds,
    ).toEqual(["hall-lights"]);
    expect(
      resolvePolyWorldElements(topology, { regionIds: ["atrium", "hall"] }, { tags: ["connector"] }).elementIds,
    ).toEqual(["door-frame"]);
  });

  it("reports unknown selectors without treating known topology keys as element resolution errors", () => {
    const topology = createPolyWorldTopology(baseTopology());
    const resolution = resolvePolyWorldElements(topology, {
      regionIds: ["missing-region"],
      linkIds: ["missing-link"],
      selectionKeys: ["faces:atrium", "missing-key"],
      elementIds: ["missing-element"],
      sourceIds: ["missing-source"],
      aliases: ["missing-alias"],
    });

    expect(resolution.unresolved).toEqual({
      regionIds: ["missing-region"],
      linkIds: ["missing-link"],
      selectionKeys: ["missing-key"],
      elementIds: ["missing-element"],
      sourceIds: ["missing-source"],
      aliases: ["missing-alias"],
    });
  });
});

describe("resolvePolyWorldElementRelations", () => {
  it("expands selected detail elements to stable parent and container roots", () => {
    const topology = createPolyWorldTopology({
      regions: [{ id: "room" }],
      elements: [
        { id: "scene-root", selectionKeys: ["root:scene"], layers: ["resident"] },
        {
          id: "room-root",
          selectionKeys: ["root:room"],
          containerId: "scene-root",
          layers: ["resident"],
        },
        {
          id: "room-wall",
          regionIds: ["room"],
          parentId: "room-root",
          containerId: "room-root",
          layers: ["render"],
        },
      ],
    });

    const expansion = resolvePolyWorldElementRelations(topology, ["room-wall"]);

    expect(expansion).toEqual({
      seedElementIds: ["room-wall"],
      elementIds: ["scene-root", "room-root", "room-wall"],
      relatedElementIds: ["scene-root", "room-root"],
      parentElementIds: ["room-root"],
      containerElementIds: ["scene-root", "room-root"],
      missingElementIds: [],
      missingRelations: [],
      relations: [
        { kind: "parent", elementId: "room-wall", relatedElementId: "room-root", depth: 1 },
        { kind: "container", elementId: "room-wall", relatedElementId: "room-root", depth: 1 },
        { kind: "container", elementId: "room-root", relatedElementId: "scene-root", depth: 2 },
      ],
    });
  });

  it("can expand a region selection with relation element ids while preserving the original selection", () => {
    const topology = createPolyWorldTopology({
      regions: [{ id: "room" }],
      elements: [
        { id: "scene-root", selectionKeys: ["root:scene"], layers: ["resident"] },
        {
          id: "room-root",
          selectionKeys: ["root:room"],
          containerId: "scene-root",
          layers: ["resident"],
        },
        {
          id: "room-wall",
          regionIds: ["room"],
          parentId: "room-root",
          containerId: "room-root",
          layers: ["render"],
        },
      ],
    });

    const selection = expandPolyWorldSelectionElementRelations(topology, {
      regionIds: ["room"],
      reasons: [{ label: "view-pvs" }],
    });
    const resolution = resolvePolyWorldElements(topology, selection);

    expect(selection.regionIds).toEqual(["room"]);
    expect(selection.elementIds).toEqual(["scene-root", "room-root"]);
    expect(selection.reasons?.map((reason) => reason.label)).toEqual(["view-pvs", "element-relations"]);
    expect(selection.reasons?.[1]?.data).toEqual({
      parentElementIds: ["room-root"],
      containerElementIds: ["scene-root", "room-root"],
    });
    expect(resolution.elementIds).toEqual(["scene-root", "room-root", "room-wall"]);
  });

  it("reports missing seed ids while preserving deterministic known relation order", () => {
    const topology = createPolyWorldTopology({
      regions: [{ id: "room" }],
      elements: [
        { id: "root", selectionKeys: ["root"], layers: ["resident"] },
        { id: "leaf", regionIds: ["room"], parentId: "root", layers: ["render"] },
      ],
    });

    const expansion = resolvePolyWorldElementRelations(topology, ["missing", "leaf"]);

    expect(expansion.elementIds).toEqual(["root", "leaf", "missing"]);
    expect(expansion.relatedElementIds).toEqual(["root"]);
    expect(expansion.missingElementIds).toEqual(["missing"]);
  });
});

describe("resolvePolyWorldRegionByPoint", () => {
  it("prefers the smallest containing bounds", () => {
    const topology = createPolyWorldTopology({
      regions: [
        { id: "district", bounds: { min: [0, 0, 0], max: [100, 100, 10] } },
        { id: "room", bounds: { min: [10, 10, 0], max: [20, 20, 4] } },
      ],
      elements: [{ id: "district-shell", regionIds: ["district"] }],
    });

    expect(resolvePolyWorldRegionByPoint(topology, [15, 15, 2])?.regionId).toBe("room");
  });

  it("falls back to nearest center only when requested", () => {
    const topology = createPolyWorldTopology(baseTopology());

    expect(resolvePolyWorldRegionByPoint(topology, [28, 1, 0])).toBeUndefined();
    expect(resolvePolyWorldRegionByPoint(topology, [28, 1, 0], { nearest: true })?.regionId).toBe("service");
  });
});
