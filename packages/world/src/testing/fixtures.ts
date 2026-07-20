import type { Vec3 } from "@layoutit/polycss-core";
import {
  compilePolyWorldBsp,
  createPolyWorldBspPvsIndex,
  createPolyWorldBspTree,
  createPolyWorldChunkTree,
  type PolyWorldBspPortal,
  type PolyWorldBspTree,
  type PolyWorldBspViewSurfaceElement,
  type PolyWorldChunkTree,
} from "../profiles";
import {
  createPolyWorldTopology,
  type PolyWorldBounds,
  type PolyWorldDocumentInput,
  type PolyWorldLink,
  type PolyWorldRegion,
  type PolyWorldTopology,
  type PolyWorldTopologyInput,
} from "../topology";

export interface PolyWorldPartitionGalleryFixture {
  topologyInput: PolyWorldTopologyInput;
  topology: PolyWorldTopology;
  documentInput: PolyWorldDocumentInput;
  tree: PolyWorldBspTree;
  surfaces: readonly PolyWorldBspViewSurfaceElement[];
  rooms: readonly PolyWorldRegion[];
  links: readonly PolyWorldLink[];
  points: {
    gallery: Vec3;
    westView: Vec3;
    eastView: Vec3;
    engine: Vec3;
  };
  expected: {
    broadFromGallery: readonly string[];
    summaryBroadFromGallery: readonly string[];
    westViewRegions: readonly string[];
    summaryWestViewRegions: readonly string[];
    eastViewRegions: readonly string[];
    summaryEastViewRegions: readonly string[];
  };
}

export interface PolyWorldFakeRoomGraphFixture {
  topologyInput: PolyWorldTopologyInput;
  topology: PolyWorldTopology;
  documentInput: PolyWorldDocumentInput;
}

export interface PolyWorldExactPvsFixture {
  tree: PolyWorldBspTree;
  point: Vec3;
  expectedLeafIds: readonly string[];
  expectedRegionIds: readonly string[];
}

export interface PolyWorldChunkTrackFixture {
  topologyInput: PolyWorldTopologyInput;
  topology: PolyWorldTopology;
  chunkTree: PolyWorldChunkTree;
  camera: {
    point: Vec3;
    forward: Vec3;
    up: Vec3;
    fovDegrees: number;
    aspect: number;
    viewportHeight: number;
  };
}

const galleryRoomBounds: Record<string, PolyWorldBounds> = {
  studio: { min: [-12, -4, 0], max: [-4, 4, 3] },
  gallery: { min: [-4, -4, 0], max: [4, 4, 3] },
  vault: { min: [4, -4, 0], max: [12, 4, 3] },
  observatory: { min: [-4, 4, 0], max: [4, 12, 3] },
  engine: { min: [4, -12, 0], max: [12, -4, 3] },
  archive: { min: [4, 4, 0], max: [12, 12, 3] },
};

const galleryLinkSpecs = [
  ["studio-gallery", "studio", "gallery", "east", "west"],
  ["gallery-vault", "gallery", "vault", "east", "west"],
  ["gallery-observatory", "gallery", "observatory", "north", "south"],
  ["vault-engine", "vault", "engine", "south", "north"],
  ["vault-archive", "vault", "archive", "north", "south"],
] as const;

export function createPolyWorldPartitionGalleryFixture(): PolyWorldPartitionGalleryFixture {
  const rooms = Object.entries(galleryRoomBounds).map(([id, bounds]) => ({
    id,
    bounds,
    center: boundsCenter(bounds),
    selectionKeys: [`room:${id}`],
  }));
  const links = galleryLinkSpecs.map(([id, fromRegionId, toRegionId]) => ({
    id,
    fromRegionId,
    toRegionId,
    selectionKeys: [`portal:${id}`],
  }));
  const surfaces = createPartitionGallerySurfaces();
  const topologyInput: PolyWorldTopologyInput = {
    validation: {
      strict: true,
      requireRegionBounds: true,
      requireElementLayers: true,
    },
    regions: rooms,
    links,
    elements: surfaces.map((surface) => ({
      id: surface.elementId ?? surface.id,
      path: `/World/PartitionGallery/${surface.regionId}/${surface.id}`,
      regionIds: surface.regionId === undefined ? undefined : [surface.regionId],
      layers: ["world"],
      purposes: surface.role === "prop" ? ["render"] : ["render", "occluder"],
      resourceIds: [`mesh:${surface.elementId ?? surface.id}`],
    })),
    spatialElements: surfaces.map((surface) => ({
      id: surface.id,
      elementId: surface.elementId,
      regionId: surface.regionId,
      role: surface.role,
      visibility: surface.visibility,
      vertices: surface.vertices,
      resourceIds: [`mesh:${surface.elementId ?? surface.id}`],
    })),
  };
  const topology = createPolyWorldTopology(topologyInput);
  const tree = compilePolyWorldBsp({
    regions: rooms.map((room) => ({
      id: room.id,
      regionId: room.id,
      bounds: room.bounds,
      elementIds: surfaces
        .filter((surface) => surface.regionId === room.id)
        .map((surface) => surface.elementId ?? surface.id),
    })),
    portals: galleryLinkSpecs.map(([id, fromRegionId, toRegionId, fromSide]) => ({
      id,
      fromRegionId,
      toRegionId,
      linkId: id,
      vertices: portalVertices(galleryRoomBounds[fromRegionId], fromSide),
      selectionKeys: [`portal:${id}`],
    })),
    pvs: { projection: "xy", sampleInset: 0.25 },
    data: {
      fixture: "partition-gallery",
    },
  });
  const documentInput: PolyWorldDocumentInput = {
    id: "partition-gallery",
    topology: topologyInput,
    capabilityIds: ["world-ir", "compiled-bsp-pvs", "resource-readiness", "dom-planning"],
    profileArtifacts: [
      {
        id: "partition-gallery-bsp",
        profile: "bsp-pvs",
        artifactKind: "compiled-bsp-pvs",
        sourceKind: "compiled",
        producedBy: "bounds-bsp",
        elementIds: topologyInput.elements?.map((element) => element.id),
        spatialElementIds: topologyInput.spatialElements?.map((spatialElement) => spatialElement.id),
      },
    ],
    resources: surfaces.map((surface) => ({
      id: `mesh:${surface.elementId ?? surface.id}`,
      state: surface.role === "prop" ? "stale" : "ready",
      renderBlocking: surface.role !== "prop",
      elementIds: surface.elementId === undefined ? undefined : [surface.elementId],
      spatialElementIds: [surface.id],
    })),
    planPolicies: [
      {
        id: "render-world",
        layer: "world",
        elementLayers: ["world"],
      },
    ],
  };

  return {
    topologyInput,
    topology,
    documentInput,
    tree,
    surfaces,
    rooms,
    links,
    points: {
      gallery: [0, 0, 1.2],
      westView: [-1, 0, 0],
      eastView: [1, 0, 0],
      engine: [8, -8, 1.2],
    },
    expected: {
      broadFromGallery: ["studio", "gallery", "vault", "observatory", "engine", "archive"],
      summaryBroadFromGallery: ["archive", "engine", "gallery", "observatory", "studio", "vault"],
      westViewRegions: ["studio", "gallery"],
      summaryWestViewRegions: ["gallery", "studio"],
      eastViewRegions: ["gallery", "vault"],
      summaryEastViewRegions: ["gallery", "vault"],
    },
  };
}

export function createPolyWorldFakeRoomGraphFixture(): PolyWorldFakeRoomGraphFixture {
  const topologyInput: PolyWorldTopologyInput = {
    regions: [
      { id: "studio", bounds: galleryRoomBounds.studio },
      { id: "gallery", bounds: galleryRoomBounds.gallery },
      { id: "vault", bounds: galleryRoomBounds.vault },
    ],
    links: [
      { id: "studio-gallery", fromRegionId: "studio", toRegionId: "gallery" },
      { id: "gallery-vault", fromRegionId: "gallery", toRegionId: "vault" },
    ],
    elements: [
      { id: "studio-shell", regionIds: ["studio"], layers: ["world"] },
      { id: "gallery-shell", regionIds: ["gallery"], layers: ["world"] },
      { id: "vault-shell", regionIds: ["vault"], layers: ["world"] },
    ],
  };
  return {
    topologyInput,
    topology: createPolyWorldTopology(topologyInput),
    documentInput: {
      id: "fake-room-graph",
      topology: topologyInput,
      capabilityIds: ["world-ir", "area-portals"],
      profileArtifacts: [
        {
          id: "fake-portal-flow",
          profile: "portal-flow",
          artifactKind: "authored-area-portal-flow",
          sourceKind: "authored-runtime-selection",
          producedBy: "authored-links",
        },
      ],
    },
  };
}

export function createPolyWorldExactPvsFixture(): PolyWorldExactPvsFixture {
  const portals: readonly PolyWorldBspPortal[] = [
    {
      id: "left-middle",
      fromLeafId: "left",
      toLeafId: "middle",
      linkId: "left-middle",
      vertices: [[-2, -1, 0], [-2, 1, 0], [-2, 1, 2], [-2, -1, 2]],
    },
    {
      id: "middle-right",
      fromLeafId: "middle",
      toLeafId: "right",
      linkId: "middle-right",
      vertices: [[2, -1, 0], [2, 1, 0], [2, 1, 2], [2, -1, 2]],
    },
  ];
  const index = createPolyWorldBspPvsIndex({
    leaves: [
      { id: "left" },
      { id: "middle" },
      { id: "right" },
    ],
    portals,
  });
  const tree = createPolyWorldBspTree({
    root: {
      id: "root-x",
      plane: { normal: [1, 0, 0], distance: 0 },
      back: { leafId: "left" },
      front: {
        id: "right-split",
        plane: { normal: [1, 0, 0], distance: 4 },
        back: { leafId: "middle" },
        front: { leafId: "right" },
      },
    },
    leaves: [
      exactPvsLeaf("left", "left", index, [0, 1], [0]),
      exactPvsLeaf("middle", "middle", index, [0, 1, 2], [0, 1]),
      exactPvsLeaf("right", "right", index, [1, 2], [1]),
    ],
    portals,
    pvsIndex: index,
    data: {
      compiled: true,
      compiler: "fixture-vis",
      pvsMethod: "exact-baked",
      pvsSource: "fixture-vis",
    },
  });

  return {
    tree,
    point: [0.5, 0, 1],
    expectedLeafIds: ["left", "middle", "right"],
    expectedRegionIds: ["left", "middle", "right"],
  };
}

export function createPolyWorldChunkTrackFixture(): PolyWorldChunkTrackFixture {
  const topologyInput: PolyWorldTopologyInput = {
    regions: [
      chunkRegion("track-world", -2, 8),
      chunkRegion("track-sector", 0, 8),
      chunkRegion("track-a", 0, 2),
      chunkRegion("track-b", 2, 4),
      chunkRegion("track-c", 4, 6),
      chunkRegion("track-c-detail", 4.5, 5.5),
      chunkRegion("track-request-gated", 1, 2),
      chunkRegion("track-side", 2, 4, 5),
      chunkRegion("track-unavailable", 6, 8),
    ],
    elements: [
      "track-world",
      "track-sector",
      "track-a",
      "track-b",
      "track-c",
      "track-c-detail",
      "track-request-gated",
      "track-side",
      "track-unavailable",
    ].map((regionId) => ({
      id: `${regionId}-mesh`,
      regionIds: [regionId],
      layers: ["world"],
      resourceIds: [`mesh:${regionId}`],
    })),
  };
  const topology = createPolyWorldTopology(topologyInput);
  const chunkTree = createPolyWorldChunkTree({
    chunks: [
      {
        id: "track-world",
        regionId: "track-world",
        childIds: ["track-sector", "track-side", "track-unavailable"],
        bounds: { min: [-2, -1, -0.25], max: [8, 6, 1] },
        available: true,
        contentAvailable: true,
        refinement: "add",
        geometricError: 16,
        cost: 1,
      },
      {
        id: "track-sector",
        regionId: "track-sector",
        parentId: "track-world",
        childIds: ["track-a", "track-b", "track-request-gated", "track-c"],
        bounds: { min: [0, -1, -0.25], max: [6, 1, 1] },
        available: true,
        contentAvailable: true,
        refinement: "replace",
        geometricError: 8,
        cost: 1,
      },
      {
        id: "track-a",
        regionId: "track-a",
        parentId: "track-sector",
        bounds: { min: [0, -1, -0.25], max: [2, 1, 1] },
        available: true,
        contentAvailable: true,
        priority: 10,
        cost: 2,
      },
      {
        id: "track-b",
        regionId: "track-b",
        parentId: "track-sector",
        bounds: { min: [2, -1, -0.25], max: [4, 1, 1] },
        viewerRequestBounds: { min: [-3, -2, -1], max: [5, 2, 2] },
        available: true,
        contentAvailable: false,
        priority: 8,
        cost: 1,
      },
      {
        id: "track-request-gated",
        regionId: "track-request-gated",
        parentId: "track-sector",
        bounds: { min: [1, -0.5, -0.25], max: [2, 0.5, 1] },
        viewerRequestBounds: { min: [20, -2, -1], max: [24, 2, 2] },
        available: true,
        contentAvailable: true,
        priority: 6,
        cost: 1,
      },
      {
        id: "track-c",
        regionId: "track-c",
        parentId: "track-sector",
        childIds: ["track-c-detail"],
        bounds: { min: [4, -1, -0.25], max: [6, 1, 1] },
        available: true,
        contentAvailable: true,
        geometricError: 1,
        priority: 3,
        cost: 3,
      },
      {
        id: "track-c-detail",
        regionId: "track-c-detail",
        parentId: "track-c",
        bounds: { min: [4.5, -0.5, -0.25], max: [5.5, 0.5, 0.75] },
        available: true,
        contentAvailable: true,
        cost: 1,
      },
      {
        id: "track-side",
        regionId: "track-side",
        parentId: "track-world",
        bounds: { min: [2, 5, -0.25], max: [4, 6, 1] },
        contentBounds: { min: [2, 5, -0.25], max: [4, 6, 1] },
        available: true,
        contentAvailable: true,
        priority: 1,
        cost: 1,
      },
      {
        id: "track-unavailable",
        regionId: "track-unavailable",
        parentId: "track-world",
        bounds: { min: [6, -1, -0.25], max: [8, 1, 1] },
        available: false,
        contentAvailable: false,
        cost: 1,
      },
    ],
  }, { topology });

  return {
    topologyInput,
    topology,
    chunkTree,
    camera: {
      point: [-2, 0, 0.5],
      forward: [1, 0, 0],
      up: [0, 0, 1],
      fovDegrees: 55,
      aspect: 1.4,
      viewportHeight: 420,
    },
  };
}

function createPartitionGallerySurfaces(): PolyWorldBspViewSurfaceElement[] {
  return Object.entries(galleryRoomBounds).flatMap(([roomId, bounds]) => [
    surface(`${roomId}-floor`, roomId, "shell", "structural", [
      [bounds.min[0], bounds.min[1], bounds.min[2]],
      [bounds.max[0], bounds.min[1], bounds.min[2]],
      [bounds.max[0], bounds.max[1], bounds.min[2]],
      [bounds.min[0], bounds.max[1], bounds.min[2]],
    ]),
    surface(`${roomId}-ceiling`, roomId, "shell", "structural", [
      [bounds.min[0], bounds.min[1], bounds.max[2]],
      [bounds.min[0], bounds.max[1], bounds.max[2]],
      [bounds.max[0], bounds.max[1], bounds.max[2]],
      [bounds.max[0], bounds.min[1], bounds.max[2]],
    ]),
    surface(`${roomId}-opening-frame`, roomId, "opening", "structural", [
      [bounds.max[0], -1, 0],
      [bounds.max[0], 1, 0],
      [bounds.max[0], 1, 2],
      [bounds.max[0], -1, 2],
    ]),
    surface(`${roomId}-prop`, roomId, "prop", "detail", [
      [bounds.max[0] - 0.8, bounds.max[1] - 0.8, 0],
      [bounds.max[0] - 0.2, bounds.max[1] - 0.8, 0],
      [bounds.max[0] - 0.2, bounds.max[1] - 0.8, 1],
      [bounds.max[0] - 0.8, bounds.max[1] - 0.8, 1],
    ]),
  ]);
}

function surface(
  id: string,
  regionId: string,
  role: NonNullable<PolyWorldBspViewSurfaceElement["role"]>,
  visibility: NonNullable<PolyWorldBspViewSurfaceElement["visibility"]>,
  vertices: readonly Vec3[],
): PolyWorldBspViewSurfaceElement {
  return {
    id,
    elementId: `${id}-element`,
    regionId,
    role,
    visibility,
    vertices: vertices.map((vertex) => [...vertex] as Vec3),
  };
}

function portalVertices(bounds: PolyWorldBounds | undefined, side: "north" | "south" | "east" | "west"): Vec3[] {
  if (bounds === undefined) throw new Error(`Missing bounds for portal side "${side}".`);
  const z0 = 0.4;
  const z1 = 2.4;
  if (side === "east" || side === "west") {
    const x = side === "east" ? bounds.max[0] : bounds.min[0];
    const y0 = (bounds.min[1] + bounds.max[1]) / 2 - 1;
    const y1 = (bounds.min[1] + bounds.max[1]) / 2 + 1;
    return [[x, y0, z0], [x, y1, z0], [x, y1, z1], [x, y0, z1]];
  }
  const y = side === "north" ? bounds.max[1] : bounds.min[1];
  const x0 = (bounds.min[0] + bounds.max[0]) / 2 - 1;
  const x1 = (bounds.min[0] + bounds.max[0]) / 2 + 1;
  return [[x0, y, z0], [x1, y, z0], [x1, y, z1], [x0, y, z1]];
}

function boundsCenter(bounds: PolyWorldBounds): Vec3 {
  return [
    (bounds.min[0] + bounds.max[0]) / 2,
    (bounds.min[1] + bounds.max[1]) / 2,
    (bounds.min[2] + bounds.max[2]) / 2,
  ];
}

function exactPvsLeaf(
  id: string,
  regionId: string,
  index: ReturnType<typeof createPolyWorldBspPvsIndex>,
  leafIndexes: readonly number[],
  portalIndexes: readonly number[],
) {
  return {
    id,
    regionId,
    bounds: exactLeafBounds(id),
    pvs: {
      leafBits: bitset(index.leafIds.length, leafIndexes),
      portalBits: bitset(index.portalIds.length, portalIndexes),
      regionIds: leafIndexes.map((leafIndex) => index.leafIds[leafIndex]),
      linkIds: portalIndexes.map((portalIndex) => index.portalIds[portalIndex]),
      selectionKeys: [],
      elementIds: leafIndexes.map((leafIndex) => `${index.leafIds[leafIndex]}-shell`),
    },
    elementIds: [`${id}-shell`],
  };
}

function exactLeafBounds(id: string): PolyWorldBounds {
  if (id === "left") return { min: [-6, -2, 0], max: [-2, 2, 2] };
  if (id === "middle") return { min: [-2, -2, 0], max: [2, 2, 2] };
  return { min: [2, -2, 0], max: [6, 2, 2] };
}

function bitset(length: number, indexes: readonly number[]): Uint32Array {
  const bits = new Uint32Array(Math.ceil(length / 32));
  for (const index of indexes) bits[index >> 5] |= 1 << (index & 31);
  return bits;
}

function chunkRegion(id: string, minX: number, maxX: number, y = 0): PolyWorldRegion {
  return {
    id,
    bounds: { min: [minX, y - 1, -0.25], max: [maxX, y + 1, 1] },
    selectionKeys: [`chunk:${id}`],
  };
}
