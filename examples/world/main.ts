import {
  boxPolygons,
  createPolyBox,
  createPolyFirstPersonControls,
  createPolyPerspectiveCamera,
  createPolyScene,
  type BoxFace,
  type Polygon,
  type Vec3,
} from "@layoutit/polycss";
import {
  applyPolyWorldDomPlan,
  compilePolyWorldBrushBsp,
  compilePolyWorldPolygonBsp,
  createPolyWorldDomRegistry,
  createPolyWorldChunkTree,
  createPolyWorldPortalDebugSnapshot,
  createPolyWorldState,
  createPolyWorldTopology,
  planPolyWorldBspVisibilityFrame,
  planPolyWorldChunkStreamingFrame,
  resolvePolyWorldBspLeaf,
  resolvePolyWorldRegionByPoint,
  type PolyWorldDomRegistry,
  type PolyWorldElement,
  type PolyWorldBspBrush,
  type PolyWorldBounds,
  type PolyWorldBspLeaf,
  type PolyWorldBspViewSurfaceElement,
  type PolyWorldBspViewSurfaceRole,
  type PolyWorldBspViewSurfaceVisibility,
  type PolyWorldResourceReadinessMap,
  type PolyWorldState,
  type PolyWorldTopology,
  type PolyWorldTransition,
} from "@layoutit/polycss-world";
import "./styles.css";

type SceneRuntime = {
  registry: PolyWorldDomRegistry<HTMLElement>;
  state: PolyWorldState;
  topology: PolyWorldTopology;
  debugEl: HTMLElement;
  visibleEl: HTMLElement;
  hiddenEl: HTMLElement;
};

type MeshEntry = {
  id: string;
  shape: ReturnType<typeof createPolyBox>;
  position: Vec3;
  rotation?: Vec3;
  scale?: Vec3;
};

type PortalSurfaceEntry = MeshEntry & PolyWorldBspViewSurfaceElement & {
  regionId: RegionId;
};

type RegionId = string;

type PortalDebugSnapshot = {
  mountedElementIds: readonly string[];
  hiddenElementIds: readonly string[];
  unmountedElementIds: readonly string[];
  visibleText: string;
  hiddenText: string;
  debug: unknown;
};

type WorldDebugSnapshot = PortalDebugSnapshot;

type PolycssWorldDebugApi = {
  portal?: {
    placeCamera: (regionId: RegionId) => Promise<PortalDebugSnapshot>;
    setCameraRotation: (rotX: number, rotY: number) => Promise<PortalDebugSnapshot>;
    snapshot: () => PortalDebugSnapshot;
  };
  chunk?: {
    setChunk: (index: number) => Promise<WorldDebugSnapshot>;
    snapshot: () => WorldDebugSnapshot;
  };
};

declare global {
  interface Window {
    __polycssWorldDebug?: PolycssWorldDebugApi;
  }
}

type PortalSide = "west" | "east" | "north" | "south";

type PortalRoomSpec = {
  id: RegionId;
  label: string;
  center: Vec3;
  yaw: number;
  floor: string;
  ceiling: string;
  wall: string;
  doorways: readonly PortalSide[];
};

type PortalLinkSpec = {
  id: string;
  from: RegionId;
  to: RegionId;
  fromSide: PortalSide;
  toSide: PortalSide;
  color: string;
};

type PortalMiniMap = {
  rooms: Map<RegionId, SVGRectElement>;
  labels: Map<RegionId, SVGTextElement>;
  links: Map<string, SVGLineElement>;
  camera: SVGGElement;
  project: (point: Vec3) => [number, number];
};

const portalRoomWidth = 8;
const portalRoomDepth = 8;
const portalWallHeight = 2.54;
const portalWallCenterZ = 1.2;
const portalWallThickness = 0.18;
const portalDoorWidth = 2.35;
const portalDoorHalf = portalDoorWidth / 2;
const portalDoorHeight = 2;
const portalFrameBaseInset = 0.05;
const portalFramePostHeight = portalDoorHeight - portalFrameBaseInset;
const portalFramePostCenterZ = portalFrameBaseInset + portalFramePostHeight / 2;
const portalLintelHeight = portalWallHeight - portalDoorHeight;
const portalEyeHeight = 1.2;
const portalPerspective = 900;
const portalLookSensitivity = 0.16;
const portalMinPitch = 62;
const portalMaxPitch = 116;
const portalLeafAdjacencySampleInset = 0.05;
const boxFaceOrder: readonly BoxFace[] = ["right", "left", "front", "back", "top", "bottom"];

const portalRooms: readonly PortalRoomSpec[] = [
  {
    id: "studio",
    label: "Studio",
    center: [-8, 0, 0],
    yaw: 180,
    floor: "#5c5248",
    ceiling: "#403a36",
    wall: "#7b7265",
    doorways: ["east"],
  },
  {
    id: "gallery",
    label: "Gallery",
    center: [0, 0, 0],
    yaw: 145,
    floor: "#46535d",
    ceiling: "#353946",
    wall: "#6f7f83",
    doorways: ["west", "east", "north"],
  },
  {
    id: "vault",
    label: "Vault",
    center: [8, 0, 0],
    yaw: -45,
    floor: "#4d5b48",
    ceiling: "#2f3540",
    wall: "#77835f",
    doorways: ["west", "north", "south"],
  },
  {
    id: "observatory",
    label: "Observatory",
    center: [0, 8, 0],
    yaw: 90,
    floor: "#46575d",
    ceiling: "#303947",
    wall: "#6f8589",
    doorways: ["south"],
  },
  {
    id: "engine",
    label: "Engine",
    center: [8, -8, 0],
    yaw: -90,
    floor: "#574940",
    ceiling: "#372f31",
    wall: "#80685c",
    doorways: ["north"],
  },
  {
    id: "archive",
    label: "Archive",
    center: [8, 8, 0],
    yaw: 90,
    floor: "#4d4f66",
    ceiling: "#30303f",
    wall: "#74708a",
    doorways: ["south"],
  },
];

const portalLinks: readonly PortalLinkSpec[] = [
  { id: "studio-gallery", from: "studio", to: "gallery", fromSide: "east", toSide: "west", color: "#c59a55" },
  { id: "gallery-vault", from: "gallery", to: "vault", fromSide: "east", toSide: "west", color: "#d56a4f" },
  { id: "gallery-observatory", from: "gallery", to: "observatory", fromSide: "north", toSide: "south", color: "#7fb2a8" },
  { id: "vault-archive", from: "vault", to: "archive", fromSide: "north", toSide: "south", color: "#a58ac0" },
  { id: "vault-engine", from: "vault", to: "engine", fromSide: "south", toSide: "north", color: "#b37b5d" },
];

const roomCenters: Record<RegionId, Vec3> = Object.fromEntries(
  portalRooms.map((room) => [room.id, room.center]),
) as Record<RegionId, Vec3>;
const portalRoomsById = new Map(portalRooms.map((room) => [room.id, room]));
const portalRegionIds = portalRooms.map((room) => room.id);

const portalBspBrushes = createPortalBspBrushes();
const portalBspResult = compilePolyWorldBrushBsp({
  worldBounds: createPortalWorldBounds(portalBspBrushes),
  brushes: portalBspBrushes,
  regions: portalRooms.map((room) => ({
    id: room.id,
    regionId: room.id,
    bounds: roomBounds(room),
  })),
  outside: "flood-fill",
  pvs: { projection: "xy", sampleInset: 0.35 },
  splitIdPrefix: "portal-brush",
});
const portalBspTree = portalBspResult.tree;
const portalBrushBspSolidLeaves = portalBspResult.solidLeafIds.length;
const portalBrushBspEmptyLeaves = portalBspResult.emptyLeafIds.length;
const portalBrushBspOutsideLeaves = portalBspResult.outsideLeafIds.length;
const portalSurfaceEntries = createPortalSurfaceEntries();
const portalResourceReadiness = Object.fromEntries(
  portalSurfaceEntries.map((entry) => [
    `mesh:${entry.id}`,
    entry.role === "prop" ? "stale" : "ready",
  ]),
) as PolyWorldResourceReadinessMap;
const portalGeometryBsp = compilePolyWorldPolygonBsp({
  surfaces: createPortalGeometrySurfaces(),
  splitIdPrefix: "portal-geometry",
  maxDepth: 72,
});
const chunkCount = 17;
const chunkStep = 5;
const chunkVisualWidth = 5.1;
const chunkRoadWidth = 3.8;
const chunkRailY = 2.06;
const chunkRunnerSpeed = 8.4;
const chunkCameraRotX = 58;
const chunkCameraRotY = -35;
const chunkCameraDistance = 440;
const chunkCameraZoom = 26;
const chunkWindowBefore = 3;
const chunkWindowAfter = 4;

function mountPortalDemo() {
  const article = document.querySelector<HTMLElement>('[data-demo="portal"]');
  if (!article) return;

  const host = article.querySelector<HTMLElement>(".scene-host");
  const visibleEl = article.querySelector<HTMLElement>("[data-visible]");
  const hiddenEl = article.querySelector<HTMLElement>("[data-hidden]");
  const debugEl = article.querySelector<HTMLElement>("[data-debug]");
  const controlsEl = article.querySelector<HTMLElement>("[data-controls]");
  if (!host || !visibleEl || !hiddenEl || !debugEl || !controlsEl) return;

  const topology = createPolyWorldTopology({
    regions: portalRooms.map((room) => ({
      id: room.id,
      bounds: roomBounds(room),
      center: room.center,
    })),
    links: portalLinks.map((link) => ({
      id: link.id,
      fromRegionId: link.from,
      toRegionId: link.to,
      selectionKeys: [`portal:${link.id}`],
    })),
    elements: [
      ...portalSurfaceEntries.map((entry) => portalSurfaceElement(entry.id)),
    ],
  });

  const camera = createPolyPerspectiveCamera({
    zoom: 26,
    rotX: 88,
    rotY: 0,
    distance: 0,
    perspective: portalPerspective,
  });
  const scene = createPolyScene(host, {
    camera,
    directionalLight: { direction: [0, 0, 1], intensity: 0 },
    ambientLight: { color: "#ffffff", intensity: Math.PI },
  });
  host.tabIndex = 0;
  const fpv = createPolyFirstPersonControls(scene, {
    eyeHeight: portalEyeHeight,
    groundZ: 0,
    jumpEnabled: false,
    crouchEnabled: false,
    lookSensitivity: portalLookSensitivity,
    moveSpeed: 4.8,
    minPitch: portalMinPitch,
    maxPitch: portalMaxPitch,
  });

  const registry = createPolyWorldDomRegistry<HTMLElement>();
  const runtime: SceneRuntime = {
    registry,
    state: createMountedWorldState(topology),
    topology,
    debugEl,
    visibleEl,
    hiddenEl,
  };
  const miniMap = createPortalMiniMap(host);

  for (const entry of portalSurfaceEntries) {
    const mesh = scene.add(entry.shape, {
      id: entry.id,
      merge: false,
      meshResolution: "lossless",
      excludeFromAutoCenter: true,
      position: entry.position,
      rotation: entry.rotation,
      scale: entry.scale,
    });
    registry.register({ elementId: entry.id, element: mesh.element, layers: ["render"], tags: ["world"] });
  }

  let activeRegionId: RegionId = "gallery";
  let syncing = false;
  let correctingOrigin = false;
  let softMouseLook = false;
  let softMousePoint: { x: number; y: number } | undefined;
  let lastValidOrigin: Vec3 = [roomCenters.gallery[0], roomCenters.gallery[1], portalEyeHeight];

  const setRoomButtons = (regionId: RegionId) => {
    for (const button of controlsEl.querySelectorAll<HTMLButtonElement>("[data-room]")) {
      button.classList.toggle("is-active", button.dataset.room === regionId);
    }
  };

  const syncFromCamera = () => {
    if (syncing) return;
    syncing = true;
    requestAnimationFrame(() => {
      syncing = false;
      let origin = fpv.getOrigin();
      const constrained = constrainPortalOrigin(origin, lastValidOrigin);
      if (!sameVec3(origin, constrained)) {
        correctingOrigin = true;
        fpv.setOrigin(constrained);
        correctingOrigin = false;
        origin = constrained;
      } else {
        lastValidOrigin = constrained;
      }
      const resolved = resolvePolyWorldRegionByPoint(topology, origin, { nearest: true });
      const cameraRotX = scene.camera.state.rotX ?? 0;
      const cameraRotY = scene.camera.state.rotY ?? 0;
      const viewForward = portalCameraForward(cameraRotX, cameraRotY);
      const viewFovDegrees = resolvePortalViewFovDegrees(host);
      const viewAspect = resolvePortalViewAspect(host);
      const fallbackRegionId = resolved?.regionId ?? activeRegionId;
      const frame = planPolyWorldBspVisibilityFrame(topology, portalBspTree, {
        previousState: runtime.state,
        policies: [{ id: "render", layer: "render", elementLayers: ["render"] }],
        point: origin,
        forward: viewForward,
        fovDegrees: viewFovDegrees,
        aspect: viewAspect,
        projection: "xy",
        regionIds: [fallbackRegionId],
        surfaces: portalSurfaceEntries,
        includeTrace: true,
        debug: { listLimit: 24 },
        planDebug: { includeEntries: false, listLimit: 8 },
        readiness: { resources: portalResourceReadiness },
      });
      const visibility = frame.visibility;
      const bspLeaf = visibility.leaf;
      const nextRegionId = bspLeaf?.leaf.regionId ?? fallbackRegionId;
      activeRegionId = nextRegionId;
      const bspDebug = visibility.debug;
      const portalDebug = createPolyWorldPortalDebugSnapshot(topology, visibility.selection, {
        currentRegionId: nextRegionId,
        listLimit: 24,
      });
      updatePortalMiniMap(
        miniMap,
        nextRegionId,
        visibility.selection.regionIds ?? [],
        origin,
        cameraRotY,
      );
      applyWorldTransition(runtime, frame, {
        cameraOrigin: formatVec(origin),
        cameraRegion: nextRegionId,
        cameraRotation: formatVec([cameraRotX, cameraRotY, 0]).slice(0, 2),
        mouseLookLocked: fpv.isLocked(),
        mouseLookStatus: article.dataset.mouseLook ?? "unlocked",
        bspLeaf: bspDebug?.current.leafId ?? null,
        bspPath: bspLeaf?.path ?? [],
        bspCompiler: bspDebug?.tree.compiler ?? null,
        bspPartition: bspDebug?.tree.partition ?? null,
        bspLeafBuilder: bspDebug?.tree.leafBuilder ?? null,
        bspPortalBuilder: bspDebug?.tree.portalBuilder ?? null,
        bspCompiled: portalBspTree.data?.compiled === true,
        bspLeaves: bspDebug?.tree.leafCount ?? portalBspTree.leaves.length,
        bspEmptyLeaves: bspDebug?.leaves.emptyCount ?? portalBrushBspEmptyLeaves,
        bspSolidLeaves: bspDebug?.leaves.solidCount ?? portalBrushBspSolidLeaves,
        bspOutsideLeaves: bspDebug?.leaves.outsideCount ?? portalBrushBspOutsideLeaves,
        bspGeneratedPortals: bspDebug?.portals.generatedCount ?? portalBspTree.portals.length,
        geometryBspCompiler: portalGeometryBsp.tree.data?.compiler ?? null,
        geometryBspSourceSurfaces: portalGeometryBsp.tree.data?.sourceSurfaceCount ?? null,
        geometryBspFragments: portalGeometryBsp.fragments.length,
        geometryBspLeaves: portalGeometryBsp.tree.leaves.length,
        pvsRegions: visibility.broadPvs?.regionIds ?? [],
        viewRegions: visibility.selection.regionIds ?? [],
        viewSurfaceCount: frame.surfaceElements?.surfaceIds.length ?? 0,
        viewSurfaceElementCount: frame.surfaceElements?.elementIds.length ?? 0,
        structuralSurfaceIds: frame.surfaceElements?.structuralSurfaceIds ?? [],
        structuralElementIds: frame.surfaceElements?.structuralElementIds ?? [],
        detailSurfaceIds: frame.surfaceElements?.detailSurfaceIds ?? [],
        detailElementIds: frame.surfaceElements?.detailElementIds ?? [],
        viewSurfaceRegions: frame.surfaceElements?.regionIds ?? [],
        viewSurfaceRoles: frame.surfaceElements?.roles ?? [],
        visibilitySets: frame.visibilitySets,
        frameSummary: frame.frameSummary,
        viewForward: formatVec(viewForward),
        viewFovDegrees: Math.round(viewFovDegrees * 100) / 100,
        pvsLeafCount: bspDebug?.current.broadPvs?.leafIds.count ?? visibility.broadPvs?.leafIds.length ?? 0,
        pvsPortalCount: bspDebug?.current.broadPvs?.portalIds.count ?? visibility.broadPvs?.portalIds.length ?? 0,
        pvsLeaves: bspDebug?.current.broadPvs?.leafIds.values ?? visibility.broadPvs?.leafIds.slice(0, 24) ?? [],
        pvsPortals: bspDebug?.current.broadPvs?.portalIds.values ?? visibility.broadPvs?.portalIds.slice(0, 24) ?? [],
        traceStatusCounts: bspDebug?.trace?.statusCounts ?? {},
        bspProof: bspDebug?.proof ?? null,
        bspDebug,
        portalDebug,
      });
      setRoomButtons(nextRegionId);
    });
  };

  const placeCamera = (regionId: RegionId) => {
    const room = portalRoomsById.get(regionId) ?? portalRoomsById.get("gallery");
    const origin = room?.center ?? roomCenters.gallery;
    activeRegionId = regionId;
    lastValidOrigin = [origin[0], origin[1], portalEyeHeight];
    scene.camera.update({
      rotX: 88,
      rotY: room?.yaw ?? 145,
      distance: 0,
    });
    scene.applyCamera();
    fpv.setOrigin(lastValidOrigin);
    syncLockState();
    syncFromCamera();
  };

  const syncLockState = () => {
    const locked = fpv.isLocked();
    article.dataset.mouseLook = locked ? "locked" : softMouseLook ? "fallback" : "unlocked";
    host.ownerDocument.documentElement.classList.toggle("polycss-world-mouselook", locked || softMouseLook);
    lookButton.setAttribute("aria-pressed", String(locked || softMouseLook));
    lookButton.textContent = locked || softMouseLook ? "Unlock Look" : "Mouse Look";
  };

  const enableSoftMouseLook = () => {
    if (fpv.isLocked()) return;
    softMouseLook = true;
    softMousePoint = undefined;
    syncLockState();
    syncFromCamera();
  };

  const disableSoftMouseLook = () => {
    softMouseLook = false;
    softMousePoint = undefined;
    syncLockState();
    syncFromCamera();
  };

  const requestMouseLook = () => {
    softMouseLook = false;
    host.focus({ preventScroll: true });
    fpv.lock();
    window.setTimeout(() => {
      if (!fpv.isLocked()) enableSoftMouseLook();
      else syncLockState();
    }, 120);
  };

  const applySoftMouseLook = (event: MouseEvent) => {
    if (!softMouseLook || fpv.isLocked()) return;
    const nextPoint = { x: event.clientX, y: event.clientY };
    const dx = event.movementX || (softMousePoint === undefined ? 0 : nextPoint.x - softMousePoint.x);
    const dy = event.movementY || (softMousePoint === undefined ? 0 : nextPoint.y - softMousePoint.y);
    softMousePoint = nextPoint;
    if (dx === 0 && dy === 0) return;
    const rotY = ((((scene.camera.state.rotY ?? 0) - dx * portalLookSensitivity) % 360) + 360) % 360;
    const nextRotX = (scene.camera.state.rotX ?? 90) - dy * portalLookSensitivity;
    const rotX = Math.max(portalMinPitch, Math.min(portalMaxPitch, nextRotX));
    scene.camera.update({ rotX, rotY });
    fpv.setOrigin(fpv.getOrigin());
  };

  const lookButton = makeButton("Mouse Look", () => {
    if (fpv.isLocked()) {
      fpv.unlock();
    } else if (softMouseLook) {
      disableSoftMouseLook();
    } else {
      requestMouseLook();
    }
    syncLockState();
  });
  lookButton.setAttribute("aria-pressed", "false");

  controlsEl.append(
    ...portalRooms.map((room) => makeButton(room.label, () => placeCamera(room.id), room.id)),
    lookButton,
  );

  const waitForPortalSync = () =>
    new Promise<PortalDebugSnapshot>((resolve) => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => resolve(portalDebugSnapshot(runtime)));
      });
    });

  window.__polycssWorldDebug = {
    ...window.__polycssWorldDebug,
    portal: {
      placeCamera: async (regionId) => {
        placeCamera(regionId);
        return waitForPortalSync();
      },
      setCameraRotation: async (rotX, rotY) => {
        scene.camera.update({ rotX, rotY });
        scene.applyCamera();
        fpv.setOrigin(fpv.getOrigin());
        syncFromCamera();
        return waitForPortalSync();
      },
      snapshot: () => portalDebugSnapshot(runtime),
    },
  };

  host.addEventListener("click", () => {
    softMouseLook = false;
    host.focus({ preventScroll: true });
    window.setTimeout(() => {
      if (!fpv.isLocked()) enableSoftMouseLook();
      else syncLockState();
    }, 120);
  });
  host.addEventListener("mousemove", (event) => {
    applySoftMouseLook(event);
  });
  host.ownerDocument.addEventListener("pointerlockerror", () => {
    if (host.ownerDocument.pointerLockElement === host) return;
    enableSoftMouseLook();
  });
  host.ownerDocument.addEventListener("keydown", (event) => {
    if (event.code === "Escape" && softMouseLook) disableSoftMouseLook();
  });
  fpv.addEventListener("change", () => {
    if (!correctingOrigin) syncFromCamera();
  });
  fpv.addEventListener("start", () => {
    softMouseLook = false;
    syncLockState();
  });
  fpv.addEventListener("end", () => syncLockState());
  placeCamera("engine");
}

function mountChunkDemo() {
  const article = document.querySelector<HTMLElement>('[data-demo="chunk"]');
  if (!article) return;

  const host = article.querySelector<HTMLElement>(".scene-host");
  const visibleEl = article.querySelector<HTMLElement>("[data-visible]");
  const hiddenEl = article.querySelector<HTMLElement>("[data-hidden]");
  const debugEl = article.querySelector<HTMLElement>("[data-debug]");
  const controlsEl = article.querySelector<HTMLElement>("[data-controls]");
  if (!host || !visibleEl || !hiddenEl || !debugEl || !controlsEl) return;

  const regions = Array.from({ length: chunkCount }, (_, index) => {
    const x = chunkX(index);
    return {
      id: `chunk-${index}`,
      bounds: {
        min: [x - chunkStep / 2, -chunkRailY - 0.35, -0.2] as Vec3,
        max: [x + chunkStep / 2, chunkRailY + 0.35, 2.1] as Vec3,
      },
    };
  });

  const topology = createPolyWorldTopology({
    regions,
    links: Array.from({ length: chunkCount - 1 }, (_, index) => ({
      id: `chunk-link-${index}`,
      fromRegionId: `chunk-${index}`,
      toRegionId: `chunk-${index + 1}`,
    })),
    elements: Array.from({ length: chunkCount }, (_, index) => {
      const regionId = `chunk-${index}`;
      const rootId = `${regionId}-root`;
      return [
        {
          id: rootId,
          regionIds: [regionId],
          layers: ["resident"],
          tags: ["chunk-root"],
        },
        worldElement(`${regionId}-road`, [regionId], [], rootId),
        worldElement(`${regionId}-number`, [regionId], [], rootId),
        worldElement(`${regionId}-left`, [regionId], [], rootId),
        worldElement(`${regionId}-right`, [regionId], [], rootId),
        worldElement(`${regionId}-gate`, [regionId], [], rootId),
      ];
    }).flat(),
  });
  const chunkTree = createPolyWorldChunkTree({
    chunks: regions.map((region, index) => ({
      id: region.id,
      regionId: region.id,
      ...(index === 0 ? {} : { parentId: `chunk-${index - 1}` }),
      ...(index === chunkCount - 1 ? {} : { childIds: [`chunk-${index + 1}`] }),
      bounds: region.bounds,
      available: true,
      contentAvailable: true,
      resourceIds: [`mesh:${region.id}`],
      refinement: "add",
      geometricError: Math.max(0, chunkCount - index - 1),
      priority: chunkCount - index,
      tags: ["track"],
    })),
  }, { topology });

  const camera = createPolyPerspectiveCamera({
    zoom: chunkCameraZoom,
    rotX: chunkCameraRotX,
    rotY: chunkCameraRotY,
    distance: chunkCameraDistance,
    perspective: 1350,
    target: [chunkX(2), 0, 0.55],
  });
  const scene = createPolyScene(host, {
    camera,
    directionalLight: { direction: [0, 0, 1], intensity: 0 },
    ambientLight: { color: "#ffffff", intensity: Math.PI },
  });

  const registry = createPolyWorldDomRegistry<HTMLElement>();
  const runtime: SceneRuntime = {
    registry,
    state: createMountedWorldState(topology),
    topology,
    debugEl,
    visibleEl,
    hiddenEl,
  };

  for (const entry of createChunkMeshes()) {
    const mesh = scene.add(entry.shape, {
      id: entry.id,
      position: entry.position,
      rotation: entry.rotation,
      scale: entry.scale,
    });
    registry.register({ elementId: entry.id, element: mesh.element, layers: ["render"], tags: ["world"] });
  }

  const runner = scene.add(createRunnerMesh(), {
    id: "third-person-runner",
    position: [chunkX(0), 0, 0.34],
    rotation: [0, 0, 0],
  });

  const trackMin = chunkX(0);
  const trackMax = chunkX(chunkCount - 1);
  let playerX = trackMin;
  let trackDirection = 1;
  let currentIndex = -1;
  let residentRegionIds: readonly string[] = [];
  let autoRunning = true;
  let frameId = 0;
  let lastFrameAt = 0;
  const readout = createReadout(`chunk 1/${chunkCount}`);

  const setRunnerPosition = (nextX: number, forceSelection = false) => {
    playerX = Math.max(trackMin, Math.min(trackMax, nextX));
    const bodyWobble = Math.sin(playerX * 1.15) * 1.6;
    runner.setTransform({
      position: [playerX, 0, 0.34],
      rotation: [0, 0, trackDirection > 0 ? bodyWobble : 180 - bodyWobble],
    });
    scene.camera.update({
      target: [playerX, 0, 0.55],
      rotX: chunkCameraRotX,
      rotY: chunkCameraRotY,
      distance: chunkCameraDistance,
      zoom: chunkCameraZoom,
    });
    scene.applyCamera();

    const resolved = resolvePolyWorldRegionByPoint(topology, [playerX, 0, 0.45], { nearest: true });
    const currentRegionId = resolved?.regionId ?? `chunk-${nearestChunkIndex(playerX)}`;
    const nextIndex = chunkIndexFromRegionId(currentRegionId);
    if (!forceSelection && nextIndex === currentIndex) return;

    currentIndex = nextIndex;
    const frame = planPolyWorldChunkStreamingFrame(topology, {
      previousState: runtime.state,
      orderedRegionIds: regions.map((region) => region.id),
      chunkTree,
      currentRegionId,
      loadedRegionIds: residentRegionIds,
      residentRegionIds,
      chunkTraversal: {
        point: [playerX, 0, 0.45],
        forward: [trackDirection, 0, 0],
        up: [0, 0, 1],
        fovDegrees: 62,
        aspect: 1.55,
        viewportHeight: Math.max(1, host.clientHeight || 420),
        far: 22,
        budget: {
          maxRenderedChunks: 10,
          maxLoadedChunks: 14,
          maxScreenSpaceError: 16,
        },
      },
      sources: [
        {
          id: "car",
          regionId: currentRegionId,
          before: chunkWindowBefore,
          after: chunkWindowAfter,
          targetState: "rendered",
          priority: 10,
          label: "car-stream",
        },
        {
          id: "lookahead",
          regionId: `chunk-${Math.min(chunkCount - 1, nextIndex + chunkWindowAfter + 2)}`,
          before: 0,
          after: 1,
          targetState: "loaded",
          priority: 1,
          label: "lookahead-load",
        },
      ],
      renderSelection: {
        reasonLabel: "rendered-chunks",
      },
      state: { resolutionOptions: { layers: ["render"] } },
      policies: [{ id: "render", layer: "render", elementLayers: ["render"] }],
      planDebug: { includeEntries: false, listLimit: 8 },
      debug: {
        includeSources: true,
        includeTraversalEntries: true,
        sourceLimit: 4,
        traversalEntryLimit: 10,
        listLimit: 12,
      },
    });
    const streamingSelection = frame.streamingSelection;
    applyWorldTransition(runtime, frame, {
      playerPosition: formatVec([playerX, 0, 0.45]),
      cameraTarget: formatVec([playerX, 0, 0.55]),
      playerRegion: currentRegionId,
      loadedRegionIds: streamingSelection.streaming.loadedRegionIds,
      loadingRegionIds: streamingSelection.streaming.loadingRegionIds,
      residentRegionIds: streamingSelection.streaming.residentRegionIds,
      activeRegionIds: streamingSelection.streaming.activeRegionIds,
      renderedRegionIds: streamingSelection.streaming.renderedRegionIds,
      preloadedRegionIds: streamingSelection.streaming.preloadedRegionIds,
      streamingSets: frame.streamingSets,
      frameSummary: frame.frameSummary,
      chunkDebug: frame.chunkDebug,
    });
    residentRegionIds = streamingSelection.streaming.residentRegionIds;

    readout.textContent = `chunk ${currentIndex + 1}/${chunkCount} - active ${streamingSelection.streaming.renderedRegionIds.length} - loaded ${streamingSelection.streaming.loadedRegionIds.length}`;
  };

  const scheduleRunner = () => {
    if (!autoRunning || frameId) return;
    frameId = window.requestAnimationFrame(runRunnerFrame);
  };

  const setAutoRunning = (nextRunning: boolean) => {
    autoRunning = nextRunning;
    toggleButton.textContent = autoRunning ? "Pause" : "Run";
    toggleButton.setAttribute("aria-pressed", String(autoRunning));
    if (autoRunning) {
      lastFrameAt = performance.now();
      scheduleRunner();
    }
  };

  const jumpRunner = (delta: number) => {
    setAutoRunning(false);
    const nextIndex = Math.max(0, Math.min(chunkCount - 1, currentIndex + delta));
    trackDirection = delta >= 0 ? 1 : -1;
    setRunnerPosition(chunkX(nextIndex), true);
  };

  const runRunnerFrame = (now: number) => {
    frameId = 0;
    const dt = Math.min(0.05, Math.max(0, (now - lastFrameAt) / 1000 || 0));
    lastFrameAt = now;
    let nextX = playerX + trackDirection * chunkRunnerSpeed * dt;
    if (nextX >= trackMax) {
      nextX = trackMax;
      trackDirection = -1;
    } else if (nextX <= trackMin) {
      nextX = trackMin;
      trackDirection = 1;
    }
    setRunnerPosition(nextX);
    scheduleRunner();
  };

  const toggleButton = makeButton("Pause", () => setAutoRunning(!autoRunning));
  toggleButton.setAttribute("aria-pressed", "true");
  controlsEl.append(
    toggleButton,
    makeButton("Back", () => jumpRunner(-1)),
    readout,
    makeButton("Forward", () => jumpRunner(1)),
  );

  const waitForChunkSync = () =>
    new Promise<WorldDebugSnapshot>((resolve) => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => resolve(worldDebugSnapshot(runtime)));
      });
    });

  window.__polycssWorldDebug = {
    ...window.__polycssWorldDebug,
    chunk: {
      setChunk: async (index) => {
        setAutoRunning(false);
        const nextIndex = Math.max(0, Math.min(chunkCount - 1, index));
        trackDirection = nextIndex >= currentIndex ? 1 : -1;
        setRunnerPosition(chunkX(nextIndex), true);
        return waitForChunkSync();
      },
      snapshot: () => worldDebugSnapshot(runtime),
    },
  };

  setRunnerPosition(playerX, true);
  lastFrameAt = performance.now();
  scheduleRunner();
}

function applyWorldTransition(
  runtime: SceneRuntime,
  transition: PolyWorldTransition,
  extraDebug: Record<string, unknown>,
) {
  const dom = applyPolyWorldDomPlan(runtime.registry, transition.plan, { hideMode: "remove" });
  runtime.state = transition.nextState;
  const visible = transition.nextState.resolvedElementIds.slice().sort();
  const hidden = unmountedWorldElementIds(runtime).slice().sort();
  runtime.visibleEl.textContent = visible.join(", ");
  runtime.hiddenEl.textContent = hidden.length ? hidden.join(", ") : "none";
  runtime.debugEl.textContent = JSON.stringify(
    {
      ...extraDebug,
      readiness: transition.readiness,
      added: transition.diff.resolvedElements.added,
      removed: transition.diff.resolvedElements.removed,
      plan: transition.plan.actionCounts,
      dom: dom.counts,
      snapshot: transition.debug,
    },
    null,
    2,
  );
}

function portalDebugSnapshot(runtime: SceneRuntime): PortalDebugSnapshot {
  return worldDebugSnapshot(runtime);
}

function worldDebugSnapshot(runtime: SceneRuntime): WorldDebugSnapshot {
  let debug: unknown;
  try {
    debug = JSON.parse(runtime.debugEl.textContent || "{}");
  } catch {
    debug = {};
  }
  return {
    mountedElementIds: runtime.registry.mountedElementIds().slice().sort(),
    hiddenElementIds: runtime.registry.hiddenElementIds().slice().sort(),
    unmountedElementIds: unmountedWorldElementIds(runtime).slice().sort(),
    visibleText: runtime.visibleEl.textContent ?? "",
    hiddenText: runtime.hiddenEl.textContent ?? "",
    debug,
  };
}

function unmountedWorldElementIds(runtime: SceneRuntime): string[] {
  return runtime.registry.records
    .filter((record) => !record.mounted)
    .map((record) => record.elementId);
}

function createMountedWorldState(topology: PolyWorldTopology): PolyWorldState {
  return createPolyWorldState(topology, {
    selection: { elementIds: topology.elements.map((element) => element.id) },
  });
}

function worldElement(
  id: string,
  regionIds: readonly string[],
  selectionKeys: readonly string[] = [],
  parentId?: string,
): PolyWorldElement {
  return {
    id,
    ...(parentId === undefined ? {} : { parentId, containerId: parentId }),
    regionIds,
    ...(regionIds.length > 1 ? { regionMatch: "any" as const } : {}),
    ...(selectionKeys.length > 0 ? { selectionKeys } : {}),
    layers: ["render"],
    tags: ["world"],
  };
}

function portalSurfaceElement(id: string): PolyWorldElement {
  return {
    id,
    selectionKeys: [`surface:${id}`],
    resourceIds: [`mesh:${id}`],
    layers: ["render"],
    tags: ["world", "surface"],
  };
}

function createPortalSurfaceEntries(): PortalSurfaceEntry[] {
  return [
    ...createPortalLeafShellEntries(),
    ...createPortalDetailSurfaceEntries(),
  ];
}

function createPortalDetailSurfaceEntries(): PortalSurfaceEntry[] {
  return portalRooms.flatMap((room) => {
    let boxIndex = 0;
    const regionId = room.id;
    return roomDetailBoxes(room).flatMap((box) =>
      boxPolygons({
        size: box.size,
        center: box.center,
        color: box.color,
      }).map((polygon, faceIndex) => {
        const face = boxFaceOrder[faceIndex] ?? `face-${faceIndex}`;
        const boxId = box.id ?? `prop-${boxIndex}`;
        const id = `${regionId}-detail-${boxId}-${face}`;
        if (faceIndex === boxFaceOrder.length - 1) boxIndex += 1;
        const vertices = polygon.vertices.map((vertex) => [...vertex] as Vec3);
        const role: PolyWorldBspViewSurfaceRole = boxId.startsWith("door-") ? "opening" : "prop";
        return portalSurfaceEntry(id, regionId, { ...polygon, vertices }, undefined, role);
      })
    );
  });
}

function createPortalLeafShellEntries(): PortalSurfaceEntry[] {
  const entries: PortalSurfaceEntry[] = [];
  for (const leaf of portalBspTree.leaves) {
    if (!isRenderablePortalLeaf(leaf)) continue;
    const room = portalRoomsById.get(leaf.regionId);
    if (room === undefined) continue;
    const polygons = boxPolygons({
      min: leaf.bounds.min,
      max: leaf.bounds.max,
      color: room.wall,
    });
    for (let faceIndex = 0; faceIndex < boxFaceOrder.length; faceIndex += 1) {
      const face = boxFaceOrder[faceIndex];
      const polygon = polygons[faceIndex];
      if (face === undefined || polygon === undefined) continue;
      if (!shouldRenderPortalLeafFace(leaf, face)) continue;
      const color = face === "bottom" ? room.floor : face === "top" ? room.ceiling : room.wall;
      entries.push(portalSurfaceEntry(
        `${leaf.regionId}-leaf-${leaf.id}-${face}`,
        leaf.regionId,
        { ...polygon, color },
        leaf.id,
        "shell",
      ));
    }
  }
  return entries;
}

function isRenderablePortalLeaf(leaf: PolyWorldBspLeaf): leaf is PolyWorldBspLeaf & {
  regionId: RegionId;
  bounds: PolyWorldBounds;
} {
  return leaf.regionId !== undefined &&
    leaf.bounds !== undefined &&
    leaf.data?.solid !== true &&
    leaf.data?.outside !== true;
}

function shouldRenderPortalLeafFace(leaf: PolyWorldBspLeaf & { bounds: PolyWorldBounds }, face: BoxFace): boolean {
  const sample = centerOfBounds(leaf.bounds);
  const { axis, side } = portalLeafFaceDirection(face);
  sample[axis] = side > 0
    ? leaf.bounds.max[axis] + portalLeafAdjacencySampleInset
    : leaf.bounds.min[axis] - portalLeafAdjacencySampleInset;
  const neighbor = resolvePolyWorldBspLeaf(portalBspTree, sample)?.leaf;
  if (neighbor === undefined) return true;
  if (neighbor.id === leaf.id) return false;
  if (neighbor.data?.solid === true || neighbor.data?.outside === true) return true;
  return false;
}

function portalLeafFaceDirection(face: BoxFace): { axis: 0 | 1 | 2; side: -1 | 1 } {
  switch (face) {
    case "right":
      return { axis: 0, side: 1 };
    case "left":
      return { axis: 0, side: -1 };
    case "front":
      return { axis: 1, side: 1 };
    case "back":
      return { axis: 1, side: -1 };
    case "top":
      return { axis: 2, side: 1 };
    case "bottom":
      return { axis: 2, side: -1 };
  }
}

function centerOfBounds(bounds: PolyWorldBounds): Vec3 {
  return [
    (bounds.min[0] + bounds.max[0]) / 2,
    (bounds.min[1] + bounds.max[1]) / 2,
    (bounds.min[2] + bounds.max[2]) / 2,
  ];
}

function portalSurfaceEntry(
  id: string,
  regionId: RegionId,
  polygon: Polygon,
  leafId?: string,
  role?: PolyWorldBspViewSurfaceRole,
  visibility?: PolyWorldBspViewSurfaceVisibility,
): PortalSurfaceEntry {
  const vertices = polygon.vertices.map((vertex) => [...vertex] as Vec3);
  return {
    id,
    elementId: id,
    regionId,
    vertices,
    ...(role === undefined ? {} : { role }),
    ...(visibility === undefined ? {} : { visibility }),
    ...(leafId === undefined ? {} : { leafId }),
    shape: shapeFromPolygons([{ ...polygon, vertices }]),
    position: [0, 0, 0] as Vec3,
    rotation: [0, 0, 0] as Vec3,
  };
}

function createPortalGeometrySurfaces(): PolyWorldBspViewSurfaceElement[] {
  return portalSurfaceEntries.map((entry) => ({
    id: entry.id,
    vertices: entry.vertices.map((vertex) => [...vertex] as Vec3),
    ...(entry.role === undefined ? {} : { role: entry.role }),
    ...(entry.visibility === undefined ? {} : { visibility: entry.visibility }),
    regionId: entry.regionId,
    elementId: entry.elementId,
  }));
}

function createPortalMiniMap(host: HTMLElement): PortalMiniMap {
  const mapWidth = 196;
  const mapHeight = 164;
  const svgNs = "http://www.w3.org/2000/svg";
  const bounds = unionBounds(portalRooms.map(roomBounds));
  const padding = 12;
  const spanX = bounds.max[0] - bounds.min[0];
  const spanY = bounds.max[1] - bounds.min[1];
  const scale = Math.min((mapWidth - padding * 2) / spanX, (mapHeight - padding * 2) / spanY);
  const offsetX = (mapWidth - spanX * scale) / 2;
  const offsetY = (mapHeight - spanY * scale) / 2;
  const project = (point: Vec3): [number, number] => [
    offsetX + (point[0] - bounds.min[0]) * scale,
    offsetY + (bounds.max[1] - point[1]) * scale,
  ];
  const wrapper = document.createElement("div");
  wrapper.className = "portal-minimap";
  wrapper.setAttribute("aria-label", "Portal room visibility map");

  const svg = document.createElementNS(svgNs, "svg");
  svg.setAttribute("viewBox", `0 0 ${mapWidth} ${mapHeight}`);
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-hidden", "true");
  wrapper.append(svg);

  const linkGroup = document.createElementNS(svgNs, "g");
  const roomGroup = document.createElementNS(svgNs, "g");
  const labelGroup = document.createElementNS(svgNs, "g");
  const camera = document.createElementNS(svgNs, "g");
  camera.classList.add("portal-minimap-camera");
  const cameraArrow = document.createElementNS(svgNs, "path");
  cameraArrow.setAttribute("d", "M0 -5 L4 5 L0 2.6 L-4 5 Z");
  camera.append(cameraArrow);
  svg.append(linkGroup, roomGroup, labelGroup, camera);

  const links = new Map<string, SVGLineElement>();
  for (const link of portalLinks) {
    const fromRoom = portalRoomsById.get(link.from);
    const toRoom = portalRoomsById.get(link.to);
    if (fromRoom === undefined || toRoom === undefined) continue;
    const [x1, y1] = project(portalCenterForRoomSide(fromRoom, link.fromSide));
    const [x2, y2] = project(portalCenterForRoomSide(toRoom, link.toSide));
    const line = document.createElementNS(svgNs, "line");
    line.classList.add("portal-minimap-link");
    line.setAttribute("data-link-id", link.id);
    line.style.setProperty("--link-color", link.color);
    line.setAttribute("x1", formatMiniMapNumber(x1));
    line.setAttribute("y1", formatMiniMapNumber(y1));
    line.setAttribute("x2", formatMiniMapNumber(x2));
    line.setAttribute("y2", formatMiniMapNumber(y2));
    linkGroup.append(line);
    links.set(link.id, line);
  }

  const rooms = new Map<RegionId, SVGRectElement>();
  const labels = new Map<RegionId, SVGTextElement>();
  for (const room of portalRooms) {
    const box = roomBounds(room);
    const [x, y] = project([box.min[0], box.max[1], 0]);
    const width = (box.max[0] - box.min[0]) * scale;
    const height = (box.max[1] - box.min[1]) * scale;
    const rect = document.createElementNS(svgNs, "rect");
    rect.classList.add("portal-minimap-room");
    rect.setAttribute("data-region-id", room.id);
    rect.style.setProperty("--room-color", room.wall);
    rect.setAttribute("x", formatMiniMapNumber(x));
    rect.setAttribute("y", formatMiniMapNumber(y));
    rect.setAttribute("width", formatMiniMapNumber(width));
    rect.setAttribute("height", formatMiniMapNumber(height));
    rect.setAttribute("rx", "3");
    rect.setAttribute("ry", "3");
    const title = document.createElementNS(svgNs, "title");
    title.textContent = room.label;
    rect.append(title);
    roomGroup.append(rect);
    rooms.set(room.id, rect);

    const [labelX, labelY] = project(room.center);
    const label = document.createElementNS(svgNs, "text");
    label.classList.add("portal-minimap-label");
    label.setAttribute("data-region-id", room.id);
    label.setAttribute("x", formatMiniMapNumber(labelX));
    label.setAttribute("y", formatMiniMapNumber(labelY));
    label.textContent = room.label;
    labelGroup.append(label);
    labels.set(room.id, label);
  }

  host.append(wrapper);
  return { rooms, labels, links, camera, project };
}

function updatePortalMiniMap(
  miniMap: PortalMiniMap,
  activeRegionId: RegionId,
  visibleRegionIds: readonly RegionId[],
  origin: Vec3,
  yaw: number,
): void {
  const visible = new Set(visibleRegionIds);
  for (const [regionId, rect] of miniMap.rooms) {
    const isActive = regionId === activeRegionId;
    const isVisible = visible.has(regionId);
    rect.classList.toggle("is-visible", isVisible);
    rect.classList.toggle("is-active", isActive);
    miniMap.labels.get(regionId)?.classList.toggle("is-visible", isVisible);
    miniMap.labels.get(regionId)?.classList.toggle("is-active", isActive);
  }
  for (const link of portalLinks) {
    const line = miniMap.links.get(link.id);
    if (line === undefined) continue;
    line.classList.toggle("is-visible", visible.has(link.from) && visible.has(link.to));
  }
  const [x, y] = miniMap.project(origin);
  miniMap.camera.setAttribute(
    "transform",
    `translate(${formatMiniMapNumber(x)} ${formatMiniMapNumber(y)}) rotate(${formatMiniMapNumber(270 - yaw)})`,
  );
}

function formatMiniMapNumber(value: number): string {
  return String(Math.round(value * 100) / 100);
}

function roomShellBoxes(room: PortalRoomSpec): BoxSpec[] {
  const [x, y] = room.center;
  const boxes: BoxSpec[] = [
    { size: [portalRoomWidth, portalRoomDepth, 0.14], center: [x, y, -0.07], color: room.floor },
    { size: [portalRoomWidth, portalRoomDepth, 0.14], center: [x, y, 2.52], color: room.ceiling },
  ];
  for (const side of ["west", "east", "north", "south"] as const) {
    pushRoomWall(boxes, room, side, room.doorways.includes(side));
  }
  return boxes;
}

type BoxSpec = {
  id?: string;
  size: Vec3;
  center: Vec3;
  color: string;
};

function pushRoomWall(
  boxes: BoxSpec[],
  room: PortalRoomSpec,
  side: PortalSide,
  hasDoorway: boolean,
): void {
  const [x, y] = room.center;
  const halfWidth = portalRoomWidth / 2;
  const halfDepth = portalRoomDepth / 2;
  const sideLength = side === "west" || side === "east" ? portalRoomDepth : portalRoomWidth;
  const sideSpan = (sideLength - portalDoorWidth) / 2;
  const wallZ = portalWallCenterZ;
  const lintelZ = portalDoorHeight + portalLintelHeight / 2;
  const sign = side === "east" || side === "north" ? 1 : -1;

  if (!hasDoorway) {
    boxes.push(
      side === "west" || side === "east"
        ? { size: [portalWallThickness, portalRoomDepth, portalWallHeight], center: [x + sign * halfWidth, y, wallZ], color: room.wall }
        : { size: [portalRoomWidth, portalWallThickness, portalWallHeight], center: [x, y + sign * halfDepth, wallZ], color: room.wall },
    );
    return;
  }

  const negativeOffset = -(portalDoorHalf + sideSpan / 2);
  const positiveOffset = portalDoorHalf + sideSpan / 2;
  if (side === "west" || side === "east") {
    const wallX = x + sign * halfWidth;
    boxes.push(
      { size: [portalWallThickness, sideSpan, portalWallHeight], center: [wallX, y + negativeOffset, wallZ], color: room.wall },
      { size: [portalWallThickness, sideSpan, portalWallHeight], center: [wallX, y + positiveOffset, wallZ], color: room.wall },
      { size: [portalWallThickness, portalDoorWidth, portalLintelHeight], center: [wallX, y, lintelZ], color: room.wall },
    );
  } else {
    const wallY = y + sign * halfDepth;
    boxes.push(
      { size: [sideSpan, portalWallThickness, portalWallHeight], center: [x + negativeOffset, wallY, wallZ], color: room.wall },
      { size: [sideSpan, portalWallThickness, portalWallHeight], center: [x + positiveOffset, wallY, wallZ], color: room.wall },
      { size: [portalDoorWidth, portalWallThickness, portalLintelHeight], center: [x, wallY, lintelZ], color: room.wall },
    );
  }
}

function pushDoorwayFrameX(boxes: BoxSpec[], x: number, y: number, color: string, idPrefix: string): void {
  boxes.push(
    { id: `${idPrefix}-post-a`, size: [0.44, 0.26, portalFramePostHeight], center: [x, y - portalDoorHalf, portalFramePostCenterZ], color },
    { id: `${idPrefix}-post-b`, size: [0.44, 0.26, portalFramePostHeight], center: [x, y + portalDoorHalf, portalFramePostCenterZ], color },
    { id: `${idPrefix}-lintel`, size: [0.44, portalDoorWidth + 0.28, 0.24], center: [x, y, 2.12], color },
  );
}

function pushDoorwayFrameY(boxes: BoxSpec[], x: number, y: number, color: string, idPrefix: string): void {
  boxes.push(
    { id: `${idPrefix}-post-a`, size: [0.26, 0.44, portalFramePostHeight], center: [x - portalDoorHalf, y, portalFramePostCenterZ], color },
    { id: `${idPrefix}-post-b`, size: [0.26, 0.44, portalFramePostHeight], center: [x + portalDoorHalf, y, portalFramePostCenterZ], color },
    { id: `${idPrefix}-lintel`, size: [portalDoorWidth + 0.28, 0.44, 0.24], center: [x, y, 2.12], color },
  );
}

function pushRoomProps(boxes: BoxSpec[], room: PortalRoomSpec): void {
  const [x, y] = room.center;
  switch (room.id) {
    case "studio":
      boxes.push(
        { size: [1.8, 0.42, 0.52], center: [x - 2.1, y - 2.65, 0.26], color: "#c89b5f" },
        { size: [0.42, 0.42, 1.28], center: [x - 3.05, y - 2.65, 0.64], color: "#8e6440" },
        { size: [0.42, 0.42, 1.28], center: [x - 1.15, y - 2.65, 0.64], color: "#8e6440" },
        { size: [0.7, 0.7, 0.7], center: [x - 2.7, y + 2.45, 0.35], color: "#b9864e" },
        { size: [0.58, 0.58, 1.02], center: [x - 1.75, y + 2.55, 0.51], color: "#6d5749" },
      );
      return;
    case "gallery":
      boxes.push(
        { size: [0.95, 0.95, 0.72], center: [x - 2.45, y - 2.45, 0.36], color: "#83bfb6" },
        { size: [0.62, 0.62, 1.18], center: [x - 2.45, y - 2.45, 0.95], color: "#d0b46d" },
        { size: [0.95, 0.95, 0.72], center: [x + 2.45, y - 2.45, 0.36], color: "#5e91a8" },
        { size: [0.62, 0.62, 1.18], center: [x + 2.45, y - 2.45, 0.95], color: "#c98774" },
        { size: [1.7, 0.22, 1.4], center: [x, y - 3.0, 0.7], color: "#91b7ba" },
      );
      return;
    case "vault":
      boxes.push(
        { size: [0.82, 0.82, 1.6], center: [x + 2.7, y - 2.2, 0.8], color: "#b99b4f" },
        { size: [0.82, 0.82, 1.6], center: [x + 2.7, y + 2.2, 0.8], color: "#b99b4f" },
        { size: [1.15, 1.15, 1.02], center: [x + 2.45, y, 0.51], color: "#d0b863" },
        { size: [0.76, 0.76, 0.54], center: [x + 2.45, y, 1.3], color: "#807c4d" },
        { size: [0.48, 2.8, 0.34], center: [x + 3.15, y, 0.17], color: "#6c7651" },
      );
      return;
    case "observatory":
      boxes.push(
        { size: [1.05, 1.05, 0.38], center: [x - 2.1, y + 2.25, 0.19], color: "#5aa7b5" },
        { size: [0.36, 0.36, 1.45], center: [x - 2.1, y + 2.25, 0.94], color: "#b7d0ce" },
        { size: [1.9, 0.34, 0.34], center: [x - 1.35, y + 2.25, 1.58], color: "#d6c48b" },
        { size: [0.62, 0.62, 0.62], center: [x + 2.55, y + 2.35, 0.31], color: "#77b5bf" },
        { size: [0.9, 0.28, 1.12], center: [x + 2.55, y + 1.75, 0.56], color: "#4e6d7b" },
      );
      return;
    case "engine":
      boxes.push(
        { size: [1.3, 0.9, 0.96], center: [x - 2.35, y - 2.35, 0.48], color: "#b45f49" },
        { size: [0.76, 0.76, 1.46], center: [x - 3.05, y - 1.55, 0.73], color: "#7f5148" },
        { size: [1.9, 0.28, 0.28], center: [x - 2.3, y + 2.65, 1.52], color: "#d08b55" },
        { size: [0.34, 1.9, 0.34], center: [x + 2.55, y - 2.2, 1.12], color: "#c46c4f" },
        { size: [1.1, 0.78, 0.72], center: [x + 2.4, y - 2.45, 0.36], color: "#6b5551" },
      );
      return;
    case "archive":
      boxes.push(
        { size: [0.44, 2.2, 1.85], center: [x - 3.0, y + 1.45, 0.93], color: "#6d6385" },
        { size: [0.5, 0.36, 1.32], center: [x - 2.4, y + 2.18, 0.66], color: "#c5a66b" },
        { size: [0.5, 0.36, 1.06], center: [x - 2.4, y + 1.42, 0.53], color: "#8e89b8" },
        { size: [0.5, 0.36, 1.52], center: [x - 2.4, y + 0.66, 0.76], color: "#a07092" },
        { size: [1.35, 0.82, 0.58], center: [x + 2.45, y + 2.45, 0.29], color: "#9075a8" },
      );
      return;
  }
}

function roomDetailBoxes(room: PortalRoomSpec): BoxSpec[] {
  const boxes: BoxSpec[] = [];
  for (const side of room.doorways) {
    pushRoomDoorFrame(boxes, room, side);
  }
  pushRoomProps(boxes, room);
  return boxes;
}

function pushRoomDoorFrame(boxes: BoxSpec[], room: PortalRoomSpec, side: PortalSide): void {
  const center = portalCenterForRoomSide(room, side);
  const link = portalLinkForRoomSide(room.id, side);
  const color = link?.color ?? "#c59a55";
  const idPrefix = `door-${side}`;
  if (side === "west" || side === "east") {
    pushDoorwayFrameX(boxes, center[0], center[1], color, idPrefix);
  } else {
    pushDoorwayFrameY(boxes, center[0], center[1], color, idPrefix);
  }
}

function portalLinkForRoomSide(regionId: RegionId, side: PortalSide): PortalLinkSpec | undefined {
  return portalLinks.find((link) =>
    (link.from === regionId && link.fromSide === side) ||
    (link.to === regionId && link.toSide === side)
  );
}

function roomBounds(room: PortalRoomSpec) {
  const halfWidth = portalRoomWidth / 2;
  const halfDepth = portalRoomDepth / 2;
  return {
    min: [room.center[0] - halfWidth, room.center[1] - halfDepth, -0.2] as Vec3,
    max: [room.center[0] + halfWidth, room.center[1] + halfDepth, 2.8] as Vec3,
  };
}

function portalCenterForLink(link: PortalLinkSpec): Vec3 {
  const from = portalRoomsById.get(link.from);
  if (!from) return [0, 0, portalEyeHeight];
  return portalCenterForRoomSide(from, link.fromSide);
}

function portalCenterForRoomSide(room: PortalRoomSpec, side: PortalSide): Vec3 {
  const halfWidth = portalRoomWidth / 2;
  const halfDepth = portalRoomDepth / 2;
  switch (side) {
    case "west":
      return [room.center[0] - halfWidth, room.center[1], portalEyeHeight];
    case "east":
      return [room.center[0] + halfWidth, room.center[1], portalEyeHeight];
    case "north":
      return [room.center[0], room.center[1] + halfDepth, portalEyeHeight];
    case "south":
      return [room.center[0], room.center[1] - halfDepth, portalEyeHeight];
  }
}

function createPortalBspBrushes(): PolyWorldBspBrush[] {
  const brushes: PolyWorldBspBrush[] = [];
  for (const room of portalRooms) {
    const boxes = roomShellBoxes(room);
    for (let index = 0; index < boxes.length; index += 1) {
      const box = boxes[index];
      if (box === undefined) continue;
      brushes.push({
        id: `${room.id}-wall-brush-${index}`,
        bounds: boundsFromBox(box),
      });
    }
  }
  return brushes;
}

function createPortalWorldBounds(brushes: readonly PolyWorldBspBrush[]): PolyWorldBounds {
  return unionBounds([
    ...portalRooms.map(roomBounds),
    ...brushes.map((brush) => brush.bounds),
  ]);
}

function boundsFromBox(box: BoxSpec): PolyWorldBounds {
  return {
    min: [
      box.center[0] - box.size[0] / 2,
      box.center[1] - box.size[1] / 2,
      box.center[2] - box.size[2] / 2,
    ] as Vec3,
    max: [
      box.center[0] + box.size[0] / 2,
      box.center[1] + box.size[1] / 2,
      box.center[2] + box.size[2] / 2,
    ] as Vec3,
  };
}

function unionBounds(boundsList: readonly PolyWorldBounds[]): PolyWorldBounds {
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const bounds of boundsList) {
    for (const axis of [0, 1, 2] as const) {
      min[axis] = Math.min(min[axis], bounds.min[axis]);
      max[axis] = Math.max(max[axis], bounds.max[axis]);
    }
  }
  return { min, max };
}

function createChunkMeshes(): MeshEntry[] {
  const entries: MeshEntry[] = [];
  for (let index = 0; index < chunkCount; index += 1) {
    const x = chunkX(index);
    const roadColors = ["#454d55", "#5d5146", "#485f58", "#5a495e", "#60613f", "#3f5a65", "#654642"];
    const leftColors = ["#b0834e", "#6f8456", "#9a674c", "#5f7b8c", "#8d6b9b", "#8e8c5a", "#b0675a"];
    const rightColors = ["#587999", "#9c6a5c", "#6f8d71", "#9f8253", "#66879c", "#966e8f", "#6b8c72"];
    const leftHeight = 0.85 + (index % 3) * 0.18;
    const rightHeight = 1.05 + ((index + 1) % 3) * 0.2;
    entries.push(
      boxEntry(`chunk-${index}-road`, [chunkVisualWidth, chunkRoadWidth, 0.12], roadColors[index % roadColors.length], [x, 0, -0.06]),
      chunkNumberEntry(index, x),
      boxEntry(`chunk-${index}-left`, [chunkVisualWidth, 0.18, leftHeight], leftColors[index % leftColors.length], [x, -chunkRailY, leftHeight / 2 - 0.06]),
      boxEntry(`chunk-${index}-right`, [chunkVisualWidth, 0.18, rightHeight], rightColors[index % rightColors.length], [x, chunkRailY, rightHeight / 2 - 0.06]),
      gateEntry(
        `chunk-${index}-gate`,
        x + chunkStep / 2 - 0.16,
        index === 0 || index === chunkCount - 1 ? "#d05648" : "#caa45d",
      ),
    );
  }
  return entries;
}

type DigitSegment = "a" | "b" | "c" | "d" | "e" | "f" | "g";

const digitSegments: Record<string, readonly DigitSegment[]> = {
  "0": ["a", "b", "c", "d", "e", "f"],
  "1": ["b", "c"],
  "2": ["a", "b", "g", "e", "d"],
  "3": ["a", "b", "g", "c", "d"],
  "4": ["f", "g", "b", "c"],
  "5": ["a", "f", "g", "c", "d"],
  "6": ["a", "f", "g", "e", "c", "d"],
  "7": ["a", "b", "c"],
  "8": ["a", "b", "c", "d", "e", "f", "g"],
  "9": ["a", "b", "c", "d", "f", "g"],
};

function chunkNumberEntry(index: number, x: number): MeshEntry {
  const label = String(index + 1).padStart(2, "0");
  const boxes: BoxSpec[] = [];
  const digitAdvance = 0.72;
  const start = -((label.length - 1) * digitAdvance) / 2;
  for (let digitIndex = 0; digitIndex < label.length; digitIndex += 1) {
    const digit = label[digitIndex] ?? "0";
    const digitX = x + start + digitIndex * digitAdvance;
    for (const segment of digitSegments[digit] ?? []) {
      boxes.push(numberSegmentBox(segment, digitX));
    }
  }
  return meshEntry(`chunk-${index}-number`, shapeFromBoxes(boxes), [0, 0, 0]);
}

function numberSegmentBox(segment: DigitSegment, x: number): BoxSpec {
  const z = 0.018;
  const color = "#c7c0a6";
  const horizontal: Vec3 = [0.48, 0.075, 0.022];
  const vertical: Vec3 = [0.075, 0.38, 0.022];
  switch (segment) {
    case "a":
      return { size: horizontal, center: [x, 0.52, z], color };
    case "b":
      return { size: vertical, center: [x + 0.28, 0.27, z], color };
    case "c":
      return { size: vertical, center: [x + 0.28, -0.27, z], color };
    case "d":
      return { size: horizontal, center: [x, -0.52, z], color };
    case "e":
      return { size: vertical, center: [x - 0.28, -0.27, z], color };
    case "f":
      return { size: vertical, center: [x - 0.28, 0.27, z], color };
    case "g":
      return { size: horizontal, center: [x, 0, z], color };
  }
}

function gateEntry(id: string, x: number, color: string): MeshEntry {
  return meshEntry(
    id,
    shapeFromBoxes([
      { size: [0.18, 0.24, 1.32], center: [x, -1.7, 0.6], color },
      { size: [0.18, 0.24, 1.32], center: [x, 1.7, 0.6], color },
      { size: [0.18, 3.76, 0.2], center: [x, 0, 1.24], color },
    ]),
    [0, 0, 0],
  );
}

function createRunnerMesh(): ReturnType<typeof createPolyBox> {
  return shapeFromBoxes([
    { size: [1.45, 0.88, 0.3], center: [0, 0, 0.18], color: "#d65a4d" },
    { size: [0.62, 0.7, 0.34], center: [-0.16, 0, 0.5], color: "#f0d98a" },
    { size: [0.44, 0.68, 0.14], center: [0.58, 0, 0.36], color: "#efcf67" },
    { size: [0.26, 0.16, 0.24], center: [0.48, -0.52, 0.04], color: "#20242a" },
    { size: [0.26, 0.16, 0.24], center: [0.48, 0.52, 0.04], color: "#20242a" },
    { size: [0.26, 0.16, 0.24], center: [-0.48, -0.52, 0.04], color: "#20242a" },
    { size: [0.26, 0.16, 0.24], center: [-0.48, 0.52, 0.04], color: "#20242a" },
    { size: [0.1, 0.56, 0.08], center: [0.77, 0, 0.22], color: "#f4efe0" },
  ]);
}

function shapeFromBoxes(boxes: readonly BoxSpec[]): ReturnType<typeof createPolyBox> {
  const polygons = boxes.flatMap((box) =>
    boxPolygons({
      size: box.size,
      center: box.center,
      color: box.color,
    }),
  );
  return shapeFromPolygons(polygons);
}

function shapeFromPolygons(polygons: readonly Polygon[]): ReturnType<typeof createPolyBox> {
  return {
    polygons: polygons.map((polygon) => ({ ...polygon, vertices: polygon.vertices.map((vertex) => [...vertex] as Vec3) })),
    elementUrls: [],
    warnings: [],
    dispose: () => {},
  };
}

function meshEntry(id: string, shape: ReturnType<typeof createPolyBox>, position: Vec3, rotation: Vec3 = [0, 0, 0]): MeshEntry {
  return { id, shape, position, rotation };
}

function boxEntry(id: string, size: Vec3, color: string, position: Vec3, rotation: Vec3 = [0, 0, 0]): MeshEntry {
  return meshEntry(id, createPolyBox({ size, color }), position, rotation);
}

function makeButton(label: string, onClick: () => void, roomId?: string) {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = label;
  if (roomId) button.dataset.room = roomId;
  button.addEventListener("click", onClick);
  return button;
}

function createReadout(text: string) {
  const readout = document.createElement("span");
  readout.className = "control-readout";
  readout.dataset.current = "";
  readout.textContent = text;
  return readout;
}

function constrainPortalOrigin(origin: Vec3, previous: Vec3): Vec3 {
  const candidate: Vec3 = [origin[0], origin[1], portalEyeHeight];
  if (isWalkableBspPoint(candidate) && isWalkableBspPath(previous, candidate)) {
    return candidate;
  }
  return [...previous] as Vec3;
}

function isWalkableBspPath(from: Vec3, to: Vec3): boolean {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const dz = to[2] - from[2];
  const distance = Math.hypot(dx, dy, dz);
  const steps = Math.max(1, Math.ceil(distance / 0.18));
  for (let step = 1; step <= steps; step += 1) {
    const t = step / steps;
    if (!isWalkableBspPoint([from[0] + dx * t, from[1] + dy * t, from[2] + dz * t])) return false;
  }
  return true;
}

function isWalkableBspPoint(point: Vec3): boolean {
  const leaf = resolvePolyWorldBspLeaf(portalBspTree, point)?.leaf;
  return leaf !== undefined && leaf.data?.solid !== true && leaf.regionId !== undefined;
}

function portalCameraForward(rotX: number, rotY: number): Vec3 {
  const rx = rotX * Math.PI / 180;
  const ry = rotY * Math.PI / 180;
  return [
    -Math.sin(rx) * Math.cos(ry),
    -Math.sin(rx) * Math.sin(ry),
    -Math.cos(rx),
  ];
}

function resolvePortalViewFovDegrees(host: HTMLElement): number {
  const width = host.getBoundingClientRect().width || 960;
  const fov = 2 * Math.atan(width / (2 * portalPerspective)) * 180 / Math.PI;
  return Math.max(58, Math.min(96, fov));
}

function resolvePortalViewAspect(host: HTMLElement): number {
  const rect = host.getBoundingClientRect();
  const width = rect.width || 960;
  const height = rect.height || 540;
  return Math.max(0.25, Math.min(4, width / height));
}

function sameVec3(a: Vec3, b: Vec3) {
  return Math.abs(a[0] - b[0]) < 0.001 && Math.abs(a[1] - b[1]) < 0.001 && Math.abs(a[2] - b[2]) < 0.001;
}

function nearestChunkIndex(x: number) {
  return Math.max(0, Math.min(chunkCount - 1, Math.round(x / chunkStep + Math.floor(chunkCount / 2))));
}

function chunkIndexFromRegionId(regionId: string) {
  const rawIndex = Number(regionId.replace("chunk-", ""));
  return Number.isFinite(rawIndex) ? Math.max(0, Math.min(chunkCount - 1, rawIndex)) : 0;
}

function chunkX(index: number) {
  return (index - Math.floor(chunkCount / 2)) * chunkStep;
}

function formatVec(value: Vec3) {
  return value.map((component) => Math.round(component * 10) / 10);
}

mountPortalDemo();
mountChunkDemo();
