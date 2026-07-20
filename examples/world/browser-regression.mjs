import { chromium } from "playwright";
import { createServer } from "vite";

const root = new URL(".", import.meta.url).pathname;
const server = await createServer({
  root,
  logLevel: "error",
  server: {
    host: "127.0.0.1",
    port: 0,
  },
});

let browser;

try {
  await server.listen();
  const address = server.httpServer?.address();
  if (typeof address !== "object" || address === null) {
    throw new Error("Vite did not expose a local server address.");
  }

  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 820 } });
  await page.goto(`http://127.0.0.1:${address.port}/`, { waitUntil: "networkidle" });
  await page.waitForFunction(() => window.__polycssWorldDebug?.portal !== undefined);
  await page.waitForFunction(() => window.__polycssWorldDebug?.chunk !== undefined);

  const west = await setPortalView(page, "gallery", 0);
  assertNoWholeRoomElements(west);
  assertPortalStructuralShell(west, ["studio", "gallery"], ["vault"]);
  assertMountedPrefix(west, "studio-");
  assertMountedPrefix(west, "gallery-");
  assertMountedPrefix(west, "studio-detail-door-east-");
  assertMountedPrefix(west, "gallery-detail-door-west-");
  assertUnmountedPrefix(west, "vault-");
  assertDebugListContains(west, ["bspDebug", "current", "viewPvs", "regionIds", "values"], "studio");
  assertBspProof(west);
  assertDebugListContains(west, ["viewSurfaceRegions"], "studio");
  assertDebugRoleCount(west, "shell");
  assertDebugRoleCount(west, "opening");
  assertDebugRoleCount(west, "prop");
  assertBspSurfaceSets(west);
  assertPortalReadiness(west);
  assertDebugStatusCount(west, "visible");
  assertDebugListContains(west, ["portalDebug", "regions", "selectedRegionIds", "values"], "studio");
  assertDebugListContains(west, ["portalDebug", "regions", "hiddenRegionIds", "values"], "vault");
  assertPortalMiniMap(west, {
    activeRegionId: "gallery",
    visibleRegionIds: ["studio", "gallery"],
    hiddenRegionIds: ["vault"],
    visibleLinkIds: ["studio-gallery"],
    hiddenLinkIds: ["gallery-vault", "gallery-observatory"],
  });

  const east = await setPortalView(page, "gallery", 180);
  assertNoWholeRoomElements(east);
  assertPortalStructuralShell(east, ["gallery", "vault"], ["studio"]);
  assertMountedPrefix(east, "gallery-");
  assertMountedPrefix(east, "vault-");
  assertMountedPrefix(east, "gallery-detail-door-east-");
  assertMountedPrefix(east, "vault-detail-door-west-");
  assertUnmountedPrefix(east, "studio-");
  assertDebugListContains(east, ["bspDebug", "current", "viewPvs", "regionIds", "values"], "vault");
  assertBspProof(east);
  assertDebugListContains(east, ["viewSurfaceRegions"], "vault");
  assertDebugRoleCount(east, "shell");
  assertDebugRoleCount(east, "opening");
  assertDebugRoleCount(east, "prop");
  assertBspSurfaceSets(east);
  assertPortalReadiness(east);
  assertDebugStatusCount(east, "visible");
  assertDebugBroadPhaseCoversView(east);
  assertDebugListContains(east, ["portalDebug", "regions", "selectedRegionIds", "values"], "vault");
  assertDebugListContains(east, ["portalDebug", "regions", "hiddenRegionIds", "values"], "studio");
  assertPortalMiniMap(east, {
    activeRegionId: "gallery",
    visibleRegionIds: ["gallery", "vault"],
    hiddenRegionIds: ["studio"],
    visibleLinkIds: ["gallery-vault"],
    hiddenLinkIds: ["studio-gallery", "gallery-observatory"],
  });

  const engine = await setPortalView(page, "engine", -90);
  assertNoWholeRoomElements(engine);
  assertPortalStructuralShell(engine, ["engine", "vault", "archive"], ["gallery"]);
  assertMountedPrefix(engine, "engine-");
  assertMountedPrefix(engine, "vault-");
  assertMountedPrefix(engine, "archive-");
  assertMountedPrefix(engine, "engine-detail-door-north-");
  assertMountedPrefix(engine, "vault-detail-door-south-");
  assertMountedPrefix(engine, "vault-detail-door-north-");
  assertMountedPrefix(engine, "archive-detail-door-south-");
  assertUnmountedPrefix(engine, "gallery-");
  assertDebugListContains(engine, ["viewSurfaceRegions"], "engine");
  assertBspProof(engine);
  assertDebugListContains(engine, ["viewSurfaceRegions"], "vault");
  assertDebugRoleCount(engine, "shell");
  assertDebugRoleCount(engine, "opening");
  assertDebugRoleCount(engine, "prop");
  assertBspSurfaceSets(engine);
  assertPortalReadiness(engine);
  assertDebugBroadPhaseCoversView(engine);
  assertDebugListContains(engine, ["portalDebug", "regions", "selectedRegionIds", "values"], "engine");
  assertDebugListContains(engine, ["portalDebug", "regions", "hiddenRegionIds", "values"], "gallery");
  assertPortalMiniMap(engine, {
    activeRegionId: "engine",
    visibleRegionIds: ["engine", "vault", "archive"],
    hiddenRegionIds: ["gallery"],
    visibleLinkIds: ["vault-engine", "vault-archive"],
    hiddenLinkIds: ["gallery-vault", "gallery-observatory"],
  });

  const chunk = await page.evaluate(async () => {
    const chunkDebug = window.__polycssWorldDebug?.chunk;
    if (chunkDebug === undefined) throw new Error("Missing chunk debug API.");
    return chunkDebug.setChunk(8);
  });
  assertMountedPrefix(chunk, "chunk-5-");
  assertMountedPrefix(chunk, "chunk-12-");
  assertUnmountedPrefix(chunk, "chunk-14-");
  assertDebugListContains(chunk, ["chunkDebug", "streaming", "loadedRegionIds", "values"], "chunk-14");
  assertDebugListContains(chunk, ["chunkDebug", "streaming", "renderedRegionIds", "values"], "chunk-12");
  assertDebugListDoesNotContain(chunk, ["chunkDebug", "streaming", "renderedRegionIds", "values"], "chunk-14");
  assertDebugGreaterThan(chunk, ["chunkDebug", "streaming", "loadedRegionIds", "count"], ["chunkDebug", "streaming", "renderedRegionIds", "count"]);
  assertDebugEquals(chunk, ["chunkDebug", "streaming", "chunkTree", "chunkCount"], 17);
  assertDebugEquals(chunk, ["chunkDebug", "streaming", "chunkTree", "maxDepth"], 16);
  assertDebugListContains(chunk, ["chunkDebug", "streaming", "chunkTree", "rootChunkIds", "values"], "chunk-0");
  assertDebugListContains(chunk, ["chunkDebug", "streaming", "chunkTree", "contentChunkIds", "values"], "chunk-0");
  assertDebugListContains(chunk, ["chunkDebug", "proof", "guarantees"], "screen-space-error-traversal");
  assertDebugEquals(chunk, ["chunkDebug", "streaming", "chunkTraversal", "currentChunkId"], "chunk-8");
  assertDebugEquals(chunk, ["chunkDebug", "streaming", "chunkTraversal", "budget", "maxRenderedChunks"], 10);
  assertDebugEquals(chunk, ["chunkDebug", "streaming", "chunkTraversal", "budget", "maxScreenSpaceError"], 16);
  assertDebugEquals(chunk, ["chunkDebug", "streaming", "chunkTraversal", "screenSpaceError", "maxError"], 16);
  assertDebugPositive(chunk, ["chunkDebug", "streaming", "chunkTraversal", "screenSpaceError", "viewportHeight"]);
  assertDebugPositive(chunk, ["chunkDebug", "streaming", "chunkTraversal", "entries", 0, "distanceToCamera"]);
  assertDebugPositive(chunk, ["chunkDebug", "streaming", "chunkTraversal", "entries", 0, "screenSpaceError"]);
  assertDebugEquals(chunk, ["chunkDebug", "streaming", "chunkTraversal", "renderedChunkIds", "count"], 10);
  assertDebugListContains(chunk, ["chunkDebug", "streaming", "chunkTraversal", "renderedChunkIds", "values"], "chunk-8");
  assertDebugListContains(chunk, ["chunkDebug", "streaming", "chunkTraversal", "renderedChunkIds", "values"], "chunk-9");
  assertDebugListContains(chunk, ["chunkDebug", "streaming", "chunkTraversal", "heldChunkIds", "values"], "chunk-10");
  assertDebugListContains(chunk, ["chunkDebug", "streaming", "chunkTraversal", "budgetClippedChunkIds", "values"], "chunk-10");
  assertDebugListContains(chunk, ["chunkDebug", "streaming", "chunkTraversal", "viewCulledChunkIds", "values"], "chunk-13");
  assertDebugListContains(chunk, ["chunkDebug", "streaming", "chunkTraversal", "viewCulledChunkIds", "values"], "chunk-14");
  assertDebugListContains(chunk, ["chunkDebug", "streaming", "chunkTraversal", "skippedChunkIds", "values"], "chunk-13");
  assertDebugGreaterThan(chunk, ["chunkDebug", "streaming", "chunkTraversal", "entryCount"], ["chunkDebug", "streaming", "chunkTraversal", "entries", "length"]);
  assertDebugEquals(chunk, ["streamingSets", "currentChunkId"], "chunk-8");
  assertDebugListContains(chunk, ["streamingSets", "loadedChunkIds"], "chunk-8");
  assertDebugListContains(chunk, ["streamingSets", "renderedChunkIds"], "chunk-8");
  assertDebugListContains(chunk, ["streamingSets", "heldChunkIds"], "chunk-10");
  assertDebugListContains(chunk, ["streamingSets", "budgetClippedChunkIds"], "chunk-10");
  assertDebugListContains(chunk, ["streamingSets", "viewCulledChunkIds"], "chunk-14");
  assertDebugListContains(chunk, ["streamingSets", "skippedChunkIds"], "chunk-13");
  assertDebugListContains(chunk, ["streamingSets", "plannedElementIds"], "chunk-5-road");
  assertDebugEquals(chunk, ["frameSummary", "profile"], "chunk-traversal");
  assertDebugEquals(chunk, ["frameSummary", "current", "chunkIds", 0], "chunk-8");
  assertDebugListContains(chunk, ["frameSummary", "candidate", "chunkIds"], "chunk-8");
  assertDebugListContains(chunk, ["frameSummary", "view", "chunkIds"], "chunk-8");
  assertDebugListContains(chunk, ["frameSummary", "retained", "chunkIds"], "chunk-10");
  assertDebugListContains(chunk, ["frameSummary", "rejected", "chunkIds"], "chunk-14");
  assertDebugEquals(chunk, ["frameSummary", "rejected", "reasonCounts", "view-culled"], 4);
  assertDebugListContains(chunk, ["frameSummary", "plan", "plannedElementIds"], "chunk-5-road");

  console.log(JSON.stringify({
    west: {
      mountedCount: west.mountedElementIds.length,
      unmountedCount: west.unmountedElementIds.length,
      mountedPrefixes: countPrefixes(west.mountedElementIds),
      traceStatusCounts: west.debug?.bspDebug?.trace?.statusCounts,
      viewSurfaceRegions: west.debug?.viewSurfaceRegions,
      viewSurfaceRoles: summarizeRoles(west.debug?.viewSurfaceRoles),
      viewSurfaceElementCount: west.debug?.viewSurfaceElementCount,
      structuralSurfaceCount: west.debug?.structuralSurfaceIds?.length,
      detailSurfaceCount: west.debug?.detailSurfaceIds?.length,
      blockedResourceCount: west.debug?.readiness?.blockedResourceIds?.length,
    },
    east: {
      mountedCount: east.mountedElementIds.length,
      unmountedCount: east.unmountedElementIds.length,
      mountedPrefixes: countPrefixes(east.mountedElementIds),
      traceStatusCounts: east.debug?.bspDebug?.trace?.statusCounts,
      viewSurfaceRegions: east.debug?.viewSurfaceRegions,
      viewSurfaceRoles: summarizeRoles(east.debug?.viewSurfaceRoles),
      viewSurfaceElementCount: east.debug?.viewSurfaceElementCount,
      structuralSurfaceCount: east.debug?.structuralSurfaceIds?.length,
      detailSurfaceCount: east.debug?.detailSurfaceIds?.length,
      blockedResourceCount: east.debug?.readiness?.blockedResourceIds?.length,
    },
    engine: {
      mountedCount: engine.mountedElementIds.length,
      unmountedCount: engine.unmountedElementIds.length,
      mountedPrefixes: countPrefixes(engine.mountedElementIds),
      traceStatusCounts: engine.debug?.bspDebug?.trace?.statusCounts,
      viewSurfaceRegions: engine.debug?.viewSurfaceRegions,
      viewSurfaceRoles: summarizeRoles(engine.debug?.viewSurfaceRoles),
      viewSurfaceElementCount: engine.debug?.viewSurfaceElementCount,
      structuralSurfaceCount: engine.debug?.structuralSurfaceIds?.length,
      detailSurfaceCount: engine.debug?.detailSurfaceIds?.length,
      blockedResourceCount: engine.debug?.readiness?.blockedResourceIds?.length,
    },
    chunk: {
      mountedCount: chunk.mountedElementIds.length,
      unmountedCount: chunk.unmountedElementIds.length,
      loadedCount: chunk.debug?.chunkDebug?.streaming?.loadedRegionIds?.count,
      renderedCount: chunk.debug?.chunkDebug?.streaming?.renderedRegionIds?.count,
      activeCount: chunk.debug?.chunkDebug?.streaming?.activeRegionIds?.count,
      chunkTree: chunk.debug?.chunkDebug?.streaming?.chunkTree,
      chunkTraversal: {
        currentChunkId: chunk.debug?.chunkDebug?.streaming?.chunkTraversal?.currentChunkId,
        renderedCount: chunk.debug?.chunkDebug?.streaming?.chunkTraversal?.renderedChunkIds?.count,
        viewCulledCount: chunk.debug?.chunkDebug?.streaming?.chunkTraversal?.viewCulledChunkIds?.count,
        budgetClippedCount: chunk.debug?.chunkDebug?.streaming?.chunkTraversal?.budgetClippedChunkIds?.count,
        skippedCount: chunk.debug?.chunkDebug?.streaming?.chunkTraversal?.skippedChunkIds?.count,
      },
      streamingSets: {
        plannedElementCount: chunk.debug?.streamingSets?.plannedElementIds?.length,
        renderedChunkCount: chunk.debug?.streamingSets?.renderedChunkIds?.length,
        heldChunkCount: chunk.debug?.streamingSets?.heldChunkIds?.length,
        viewCulledChunkCount: chunk.debug?.streamingSets?.viewCulledChunkIds?.length,
        budgetClippedChunkCount: chunk.debug?.streamingSets?.budgetClippedChunkIds?.length,
      },
    },
  }, null, 2));
} finally {
  await browser?.close();
  await server.close();
}

async function setPortalView(page, regionId, rotY) {
  return page.evaluate(async ({ regionId, rotY }) => {
    const portal = window.__polycssWorldDebug?.portal;
    if (portal === undefined) throw new Error("Missing portal debug API.");
    await portal.placeCamera(regionId);
    const snapshot = await portal.setCameraRotation(88, rotY);
    const readPortalMiniMapState = () => ({
      rooms: [...document.querySelectorAll(".portal-minimap-room")].map((room) => ({
        regionId: room.getAttribute("data-region-id"),
        visible: room.classList.contains("is-visible"),
        active: room.classList.contains("is-active"),
      })),
      links: [...document.querySelectorAll(".portal-minimap-link")].map((link) => ({
        linkId: link.getAttribute("data-link-id"),
        visible: link.classList.contains("is-visible"),
      })),
      cameraTransform: document.querySelector(".portal-minimap-camera")?.getAttribute("transform") ?? "",
    });
    return {
      ...snapshot,
      miniMap: readPortalMiniMapState(),
    };
  }, { regionId, rotY });
}

function assertMounted(snapshot, elementId) {
  if (!snapshot.mountedElementIds.includes(elementId)) {
    throw new Error(`Expected ${elementId} to be mounted. Mounted: ${snapshot.mountedElementIds.join(", ")}`);
  }
}

function assertMountedPrefix(snapshot, prefix) {
  if (!snapshot.mountedElementIds.some((elementId) => elementId.startsWith(prefix))) {
    throw new Error(`Expected a mounted element with prefix ${prefix}. Mounted: ${snapshot.mountedElementIds.join(", ")}`);
  }
}

function assertMountedMatch(snapshot, pattern, label) {
  if (!snapshot.mountedElementIds.some((elementId) => pattern.test(elementId))) {
    throw new Error(`Expected mounted ${label}. Mounted: ${snapshot.mountedElementIds.join(", ")}`);
  }
}

function assertNoMountedPrefix(snapshot, prefix) {
  const mounted = snapshot.mountedElementIds.filter((elementId) => elementId.startsWith(prefix));
  if (mounted.length > 0) {
    throw new Error(`Expected no mounted elements with prefix ${prefix}. Mounted matches: ${mounted.join(", ")}`);
  }
}

function assertUnmounted(snapshot, elementId) {
  if (snapshot.mountedElementIds.includes(elementId)) {
    throw new Error(`Expected ${elementId} to be unmounted. Mounted: ${snapshot.mountedElementIds.join(", ")}`);
  }
  if (!snapshot.unmountedElementIds.includes(elementId)) {
    throw new Error(`Expected ${elementId} in unmounted ids. Unmounted: ${snapshot.unmountedElementIds.join(", ")}`);
  }
}

function assertUnmountedPrefix(snapshot, prefix) {
  const mounted = snapshot.mountedElementIds.filter((elementId) => elementId.startsWith(prefix));
  if (mounted.length > 0) {
    throw new Error(`Expected no mounted elements with prefix ${prefix}. Mounted matches: ${mounted.join(", ")}`);
  }
  if (!snapshot.unmountedElementIds.some((elementId) => elementId.startsWith(prefix))) {
    throw new Error(`Expected unmounted elements with prefix ${prefix}. Unmounted: ${snapshot.unmountedElementIds.join(", ")}`);
  }
}

function assertNoWholeRoomElements(snapshot) {
  const roomElements = snapshot.mountedElementIds.filter((elementId) => elementId.endsWith("-room"));
  if (roomElements.length > 0) {
    throw new Error(`Expected surface-level BSP elements, not whole rooms. Mounted rooms: ${roomElements.join(", ")}`);
  }
}

function assertPortalStructuralShell(snapshot, visibleRegionIds, hiddenRegionIds) {
  for (const regionId of visibleRegionIds) {
    assertMountedMatch(snapshot, new RegExp(`^${regionId}-leaf-.+-top$`), `${regionId} ceiling shell`);
    assertMountedMatch(snapshot, new RegExp(`^${regionId}-leaf-.+-bottom$`), `${regionId} floor shell`);
  }
  for (const regionId of hiddenRegionIds) {
    assertNoMountedPrefix(snapshot, `${regionId}-leaf-`);
    assertNoMountedPrefix(snapshot, `${regionId}-detail-`);
  }
}

function assertPortalMiniMap(snapshot, expected) {
  const miniMap = snapshot.miniMap;
  if (miniMap === undefined) throw new Error("Expected portal minimap debug state.");
  const rooms = new Map(miniMap.rooms.map((room) => [room.regionId, room]));
  const links = new Map(miniMap.links.map((link) => [link.linkId, link]));
  const cameraRegion = readPath(snapshot.debug, ["cameraRegion"]);
  if (cameraRegion !== expected.activeRegionId) {
    throw new Error(`Expected debug cameraRegion ${expected.activeRegionId}, got ${JSON.stringify(cameraRegion)}.`);
  }
  for (const regionId of expected.visibleRegionIds) {
    const room = rooms.get(regionId);
    if (room?.visible !== true) throw new Error(`Expected minimap room ${regionId} to be visible. Rooms: ${JSON.stringify(miniMap.rooms)}`);
  }
  for (const regionId of expected.hiddenRegionIds) {
    const room = rooms.get(regionId);
    if (room?.visible !== false) throw new Error(`Expected minimap room ${regionId} to be hidden. Rooms: ${JSON.stringify(miniMap.rooms)}`);
  }
  const active = rooms.get(expected.activeRegionId);
  if (active?.active !== true) throw new Error(`Expected minimap room ${expected.activeRegionId} to be active. Rooms: ${JSON.stringify(miniMap.rooms)}`);
  for (const linkId of expected.visibleLinkIds) {
    const link = links.get(linkId);
    if (link?.visible !== true) throw new Error(`Expected minimap link ${linkId} to be visible. Links: ${JSON.stringify(miniMap.links)}`);
  }
  for (const linkId of expected.hiddenLinkIds) {
    const link = links.get(linkId);
    if (link?.visible !== false) throw new Error(`Expected minimap link ${linkId} to be hidden. Links: ${JSON.stringify(miniMap.links)}`);
  }
}

function assertDebugListContains(snapshot, path, value) {
  const list = readPath(snapshot.debug, path);
  if (!Array.isArray(list) || !list.includes(value)) {
    throw new Error(`Expected debug path ${path.join(".")} to include ${value}. Value: ${JSON.stringify(list)}`);
  }
}

function assertDebugListDoesNotContain(snapshot, path, value) {
  const list = readPath(snapshot.debug, path);
  if (!Array.isArray(list) || list.includes(value)) {
    throw new Error(`Expected debug path ${path.join(".")} not to include ${value}. Value: ${JSON.stringify(list)}`);
  }
}

function assertDebugGreaterThan(snapshot, leftPath, rightPath) {
  const left = readPath(snapshot.debug, leftPath);
  const right = readPath(snapshot.debug, rightPath);
  if (typeof left !== "number" || typeof right !== "number" || left <= right) {
    throw new Error(`Expected ${leftPath.join(".")} > ${rightPath.join(".")}. Values: ${JSON.stringify({ left, right })}`);
  }
}

function assertDebugEquals(snapshot, path, expected) {
  const actual = readPath(snapshot.debug, path);
  if (actual !== expected) {
    throw new Error(`Expected debug path ${path.join(".")} to equal ${JSON.stringify(expected)}. Value: ${JSON.stringify(actual)}`);
  }
}

function assertDebugStatusCount(snapshot, status) {
  const count = readPath(snapshot.debug, ["bspDebug", "trace", "statusCounts", status]);
  if (typeof count !== "number" || count <= 0) {
    throw new Error(`Expected BSP trace status ${status} to be counted. Value: ${JSON.stringify(count)}`);
  }
}

function assertBspProof(snapshot) {
  assertDebugEquals(snapshot, ["bspProof", "profile"], "bsp-pvs");
  assertDebugEquals(snapshot, ["bspProof", "compiler", "id"], "brush-bsp");
  assertDebugEquals(snapshot, ["bspProof", "compiler", "compiled"], true);
  assertDebugEquals(snapshot, ["bspProof", "compiler", "partition"], "recursive-plane");
  assertDebugEquals(snapshot, ["bspProof", "compiler", "leafBuilder"], "recursive-convex-halfspace");
  assertDebugEquals(snapshot, ["bspProof", "compiler", "portalBuilder"], "leaf-face-overlap");
  assertDebugEquals(snapshot, ["bspProof", "tree", "referencesEveryLeafOnce"], true);
  assertDebugEquals(snapshot, ["bspProof", "pvs", "level"], "portal-clipped-baked-pvs");
  assertDebugEquals(snapshot, ["bspProof", "pvs", "method"], "portal-clipped-baked");
  assertDebugEquals(snapshot, ["bspProof", "pvs", "source"], "polycss-world");
  assertDebugEquals(snapshot, ["bspProof", "pvs", "completeness"], "complete");
  assertDebugEquals(snapshot, ["bspProof", "pvs", "indexed"], true);
  assertDebugEquals(snapshot, ["bspProof", "pvs", "complete"], true);
  assertDebugPositive(snapshot, ["bspProof", "leaves", "renderableCount"]);
  assertDebugPositive(snapshot, ["bspProof", "leaves", "solidCount"]);
  assertDebugListContains(snapshot, ["bspProof", "evidence", "guarantees"], "validated-pvs-metadata");
  assertDebugListContains(snapshot, ["bspProof", "artifact", "guarantees"], "portal-clipped-baked-pvs");
}

function assertDebugPositive(snapshot, path) {
  const value = readPath(snapshot.debug, path);
  if (typeof value !== "number" || value <= 0) {
    throw new Error(`Expected debug path ${path.join(".")} to be positive. Value: ${JSON.stringify(value)}`);
  }
}

function assertDebugRoleCount(snapshot, role) {
  const roles = readPath(snapshot.debug, ["viewSurfaceRoles"]);
  if (!Array.isArray(roles)) {
    throw new Error(`Expected viewSurfaceRoles debug array. Value: ${JSON.stringify(roles)}`);
  }
  const summary = roles.find((entry) => entry?.role === role);
  if (typeof summary?.count !== "number" || summary.count <= 0) {
    throw new Error(`Expected BSP surface role ${role} to be counted. Roles: ${JSON.stringify(roles)}`);
  }
}

function assertBspSurfaceSets(snapshot) {
  assertDebugArrayNotEmpty(snapshot, ["structuralSurfaceIds"]);
  assertDebugArrayNotEmpty(snapshot, ["structuralElementIds"]);
  assertDebugArrayNotEmpty(snapshot, ["detailSurfaceIds"]);
  assertDebugArrayNotEmpty(snapshot, ["detailElementIds"]);
  assertDebugArrayNotEmpty(snapshot, ["visibilitySets", "structuralSurfaceIds"]);
  assertDebugArrayNotEmpty(snapshot, ["visibilitySets", "structuralElementIds"]);
  assertDebugArrayNotEmpty(snapshot, ["visibilitySets", "detailSurfaceIds"]);
  assertDebugArrayNotEmpty(snapshot, ["visibilitySets", "detailElementIds"]);
  assertDebugArrayNotEmpty(snapshot, ["visibilitySets", "plannedElementIds"]);
  assertDebugEquals(snapshot, ["frameSummary", "profile"], "bsp-pvs");
  assertDebugArrayNotEmpty(snapshot, ["frameSummary", "broad", "leafIds"]);
  assertDebugArrayNotEmpty(snapshot, ["frameSummary", "view", "leafIds"]);
  assertDebugArrayNotEmpty(snapshot, ["frameSummary", "view", "surfaceIds"]);
  assertDebugArrayNotEmpty(snapshot, ["frameSummary", "retained", "surfaceIds"]);
  assertDebugArrayNotEmpty(snapshot, ["frameSummary", "planning", "elementIds"]);
}

function assertPortalReadiness(snapshot) {
  assertDebugArrayNotEmpty(snapshot, ["readiness", "resourceIds"]);
  assertDebugArrayNotEmpty(snapshot, ["readiness", "readyResourceIds"]);
  assertDebugArrayNotEmpty(snapshot, ["readiness", "staleResourceIds"]);
  assertDebugArrayNotEmpty(snapshot, ["readiness", "blockedResourceIds"]);
  assertDebugArrayNotEmpty(snapshot, ["readiness", "blockedElementIds"]);
  const missing = readPath(snapshot.debug, ["readiness", "missingResourceIds"]);
  if (!Array.isArray(missing) || missing.length !== 0) {
    throw new Error(`Expected no missing portal resources. Value: ${JSON.stringify(missing)}`);
  }
  assertDebugArrayNotEmpty(snapshot, ["frameSummary", "readiness", "resourceIds"]);
  assertDebugArrayNotEmpty(snapshot, ["frameSummary", "readiness", "blockedResourceIds"]);
  assertDebugArrayNotEmpty(snapshot, ["frameSummary", "readiness", "blockedElementIds"]);
}

function assertDebugArrayNotEmpty(snapshot, path) {
  const value = readPath(snapshot.debug, path);
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`Expected debug path ${path.join(".")} to be a non-empty array. Value: ${JSON.stringify(value)}`);
  }
}

function assertDebugBroadPhaseCoversView(snapshot) {
  const broadCount = readPath(snapshot.debug, ["bspDebug", "current", "viewPvs", "broadPhaseLeafIds", "count"]);
  const viewCount = readPath(snapshot.debug, ["bspDebug", "current", "viewPvs", "leafIds", "count"]);
  if (typeof broadCount !== "number" || typeof viewCount !== "number" || broadCount < viewCount) {
    throw new Error(`Expected broad PVS to cover view PVS. broad=${JSON.stringify(broadCount)} view=${JSON.stringify(viewCount)}`);
  }
}

function readPath(value, path) {
  return path.reduce((current, key) => current?.[key], value);
}

function countPrefixes(elementIds) {
  const counts = {};
  for (const elementId of elementIds) {
    const prefix = elementId
      .replace(/-leaf-.+$/, "-leaf-*")
      .replace(/-detail-.+$/, "-detail-*")
      .replace(/surface-.+$/, "surface-*");
    counts[prefix] = (counts[prefix] ?? 0) + 1;
  }
  return counts;
}

function summarizeRoles(roles) {
  if (!Array.isArray(roles)) return [];
  return roles.map((role) => ({
    role: role.role,
    count: role.count,
  }));
}
