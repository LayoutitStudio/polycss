import { describe, expect, it } from "vitest";
import { selectPolyWorldChunkStreaming } from "../profiles";
import { createPolyWorldTopology } from "../topology";
import {
  adaptPolyWorldChunkStreamingDebugSnapshot,
  createPolyWorldChunkStreamingDebugSnapshot,
} from "./index";

describe("createPolyWorldChunkStreamingDebugSnapshot", () => {
  it("summarizes streaming chunks, source decisions, and omitted detail", () => {
    const topology = createPolyWorldTopology({
      regions: [
        { id: "chunk-0", bounds: { min: [0, 0, 0], max: [1, 1, 1] }, selectionKeys: ["chunk-key:0"] },
        { id: "chunk-1", bounds: { min: [1, 0, 0], max: [2, 1, 1] }, selectionKeys: ["chunk-key:1"] },
        { id: "chunk-2", bounds: { min: [2, 0, 0], max: [3, 1, 1] }, selectionKeys: ["chunk-key:2"] },
        { id: "chunk-3", bounds: { min: [3, 0, 0], max: [4, 1, 1] }, selectionKeys: ["chunk-key:3"] },
      ],
      elements: [
        { id: "chunk-1-world", regionIds: ["chunk-1"] },
        { id: "chunk-2-world", regionIds: ["chunk-2"] },
        { id: "chunk-3-world", regionIds: ["chunk-3"] },
      ],
    });
    const selection = selectPolyWorldChunkStreaming(topology, {
      orderedRegionIds: ["chunk-0", "chunk-1", "chunk-2", "chunk-3"],
      chunkTree: {
        chunks: [
          { id: "root", regionId: "chunk-0", childIds: ["chunk-1"], available: true, contentAvailable: true },
          { id: "chunk-1", regionId: "chunk-1", parentId: "root", available: true, contentAvailable: true },
          { id: "chunk-2", regionId: "chunk-2", available: true, contentAvailable: false },
          { id: "chunk-3", regionId: "chunk-3", available: false, contentAvailable: false },
        ],
      },
      loadedRegionIds: ["chunk-1"],
      residentRegionIds: ["chunk-1"],
      preloadedRegionIds: ["chunk-0"],
      sources: [
        {
          id: "car",
          regionId: "chunk-2",
          before: 1,
          after: 1,
          targetState: "rendered",
          priority: 10,
          label: "car-stream",
        },
        {
          id: "preload",
          regionId: "chunk-3",
          targetState: "preloaded",
          label: "preload-next",
        },
      ],
    });
    const snapshot = createPolyWorldChunkStreamingDebugSnapshot(selection, {
      listLimit: 2,
      sourceLimit: 1,
      metadata: { example: "chunk-follow" },
    });

    expect(snapshot.selection.regionIds).toEqual({
      values: ["chunk-1", "chunk-2"],
      count: 3,
      omitted: 1,
    });
    expect(snapshot.proof).toMatchObject({
      profile: "chunk-traversal",
      artifactKind: "chunk-working-set",
      sourceKind: "authored-runtime-selection",
      producedBy: "selectPolyWorldChunkStreaming",
      counts: {
        selectedRegionCount: 3,
        sourceCount: 2,
        chunkCount: 4,
        availableChunkCount: 3,
        contentChunkCount: 2,
      },
      coverage: {
        availableChunkCoverage: 0.75,
        contentChunkCoverage: 0.5,
      },
    });
    expect(snapshot.proof.guarantees).toContain("availability-state-reporting");
    expect(snapshot.proof.knownWeaknesses).toContain("not-fetch-scheduler");
    expect(snapshot.selection.selectionKeys.count).toBe(3);
    expect(snapshot.streaming.loadedRegionIds).toEqual({
      values: ["chunk-1", "chunk-2"],
      count: 3,
      omitted: 1,
    });
    expect(snapshot.streaming.renderedRegionIds.count).toBe(3);
    expect(snapshot.streaming.preloadedRegionIds).toEqual({
      values: ["chunk-0", "chunk-3"],
      count: 2,
      omitted: 0,
    });
    expect(snapshot.streaming.sourceCount).toBe(2);
    expect(snapshot.streaming.chunkTree).toEqual({
      chunkCount: 4,
      maxDepth: 1,
      rootChunkIds: { values: ["root", "chunk-2"], count: 3, omitted: 1 },
      availableChunkIds: { values: ["root", "chunk-1"], count: 3, omitted: 1 },
      contentChunkIds: { values: ["root", "chunk-1"], count: 2, omitted: 0 },
    });
    expect(snapshot.streaming.sources).toEqual([
      {
        sourceId: "car",
        currentRegionId: "chunk-2",
        selectedRegionIds: { values: ["chunk-1", "chunk-2"], count: 3, omitted: 1 },
        targetState: "rendered",
        priority: 10,
        label: "car-stream",
        tags: undefined,
        missingRegionId: undefined,
      },
    ]);
    expect(snapshot.streaming.omittedSources).toBe(1);
    expect(snapshot.metadata).toEqual({ example: "chunk-follow" });
    expect(
      adaptPolyWorldChunkStreamingDebugSnapshot(snapshot, (value) => ({
        activeChunks: value.streaming.activeRegionIds.count,
        residentChunks: value.streaming.residentRegionIds.count,
        renderedChunks: value.streaming.renderedRegionIds.count,
        parityClaim: false,
      })),
    ).toEqual({
      activeChunks: 3,
      residentChunks: 3,
      renderedChunks: 3,
      parityClaim: false,
    });
  });

  it("summarizes budgeted chunk tree traversal decisions and capped entries", () => {
    const topology = createPolyWorldTopology({
      regions: [
        { id: "world", selectionKeys: ["chunk:world"] },
        { id: "tile-a", selectionKeys: ["chunk:tile-a"] },
        { id: "tile-b", selectionKeys: ["chunk:tile-b"] },
        { id: "tile-c", selectionKeys: ["chunk:tile-c"] },
      ],
      elements: [
        { id: "world-root", regionIds: ["world"] },
        { id: "tile-a-world", regionIds: ["tile-a"] },
        { id: "tile-b-world", regionIds: ["tile-b"] },
      ],
    });
    const selection = selectPolyWorldChunkStreaming(topology, {
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
    });
    const snapshot = createPolyWorldChunkStreamingDebugSnapshot(selection, {
      listLimit: 2,
      includeTraversalEntries: true,
      traversalEntryLimit: 2,
    });

    expect(snapshot.proof).toMatchObject({
      profile: "chunk-traversal",
      artifactKind: "chunk-working-set",
      sourceKind: "authored-runtime-selection",
      producedBy: "resolvePolyWorldChunkTreeTraversal",
      counts: {
        selectedChunkCount: 3,
        renderedChunkCount: 1,
        requestedChunkCount: 1,
        heldChunkCount: 1,
        unavailableChunkCount: 1,
        viewCulledChunkCount: 0,
        outsideRequestVolumeChunkCount: 0,
        budgetClippedChunkCount: 1,
        traversalEntryCount: 4,
      },
    });
    expect(snapshot.proof.guarantees).toContain("budgeted-traversal");
    expect(snapshot.proof.knownWeaknesses).toContain("not-renderer-lod-swap");
    expect(snapshot.streaming.chunkTraversal?.currentChunkId).toBe("tile-a");
    expect(snapshot.streaming.chunkTraversal?.selectedChunkIds).toEqual({
      values: ["world", "tile-a"],
      count: 3,
      omitted: 1,
    });
    expect(snapshot.streaming.chunkTraversal?.renderedChunkIds).toEqual({
      values: ["world"],
      count: 1,
      omitted: 0,
    });
    expect(snapshot.streaming.chunkTraversal?.requestedChunkIds.values).toEqual(["tile-b"]);
    expect(snapshot.streaming.chunkTraversal?.unavailableChunkIds.values).toEqual(["tile-c"]);
    expect(snapshot.streaming.chunkTraversal?.viewCulledChunkIds.values).toEqual([]);
    expect(snapshot.streaming.chunkTraversal?.outsideRequestVolumeChunkIds.values).toEqual([]);
    expect(snapshot.streaming.chunkTraversal?.budgetClippedChunkIds.values).toEqual(["tile-a"]);
    expect(snapshot.streaming.chunkTraversal?.budget).toEqual({
      maxRenderedChunks: 1,
      maxLoadedChunks: 2,
    });
    expect(snapshot.streaming.chunkTraversal?.entryCount).toBe(4);
    expect(snapshot.streaming.chunkTraversal?.entries?.map((entry) => [entry.chunkId, entry.reasons])).toEqual([
      ["world", ["root", "ancestor", "refined", "loaded", "rendered"]],
      ["tile-a", ["current", "loaded", "budget-clipped", "held"]],
    ]);
    expect(snapshot.streaming.chunkTraversal?.omittedEntries).toBe(2);
  });

  it("reports viewer request volume filtering separately from generic skipped chunks", () => {
    const topology = createPolyWorldTopology({
      regions: [
        { id: "world", selectionKeys: ["chunk:world"] },
        { id: "front", selectionKeys: ["chunk:front"] },
        { id: "gated", selectionKeys: ["chunk:gated"] },
      ],
    });
    const selection = selectPolyWorldChunkStreaming(topology, {
      chunkTree: {
        chunks: [
          {
            id: "world",
            regionId: "world",
            childIds: ["front", "gated"],
            bounds: { min: [-1, -1, -1], max: [6, 1, 1] },
            available: true,
            contentAvailable: true,
            refinement: "add",
          },
          {
            id: "front",
            regionId: "front",
            parentId: "world",
            bounds: { min: [2, -0.5, -0.5], max: [3, 0.5, 0.5] },
            available: true,
            contentAvailable: true,
            priority: 2,
          },
          {
            id: "gated",
            regionId: "gated",
            parentId: "world",
            bounds: { min: [3, -0.5, -0.5], max: [4, 0.5, 0.5] },
            viewerRequestBounds: { min: [20, -1, -1], max: [22, 1, 1] },
            available: true,
            contentAvailable: true,
            priority: 1,
          },
        ],
      },
      chunkTraversal: {
        currentRegionId: "front",
        point: [0, 0, 0],
        forward: [1, 0, 0],
        fovDegrees: 60,
        aspect: 1,
      },
    });
    const snapshot = createPolyWorldChunkStreamingDebugSnapshot(selection, {
      includeTraversalEntries: true,
    });

    expect(snapshot.proof.guarantees).toContain("viewer-request-volume-filtering");
    expect(snapshot.proof.counts).toMatchObject({
      selectedChunkCount: 2,
      outsideRequestVolumeChunkCount: 1,
      skippedChunkCount: 1,
    });
    expect(snapshot.streaming.chunkTraversal?.outsideRequestVolumeChunkIds.values).toEqual(["gated"]);
    expect(snapshot.streaming.chunkTraversal?.skippedChunkIds.values).toEqual(["gated"]);
    expect(snapshot.streaming.chunkTraversal?.entries?.find((entry) => entry.chunkId === "gated")?.reasons).toEqual([
      "outside-request-volume",
      "skipped",
    ]);
  });

  it("reports screen-space-error traversal proof and entry metrics", () => {
    const topology = createPolyWorldTopology({
      regions: [
        { id: "sector", selectionKeys: ["chunk:sector"] },
        { id: "tile", selectionKeys: ["chunk:tile"] },
      ],
      elements: [
        { id: "sector-world", regionIds: ["sector"] },
        { id: "tile-world", regionIds: ["tile"] },
      ],
    });
    const selection = selectPolyWorldChunkStreaming(topology, {
      chunkTree: {
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
      },
      chunkTraversal: {
        point: [0, 0, 0],
        forward: [1, 0, 0],
        fovDegrees: 90,
        aspect: 1,
        viewportHeight: 100,
        budget: {
          maxScreenSpaceError: 40,
        },
      },
    });
    const snapshot = createPolyWorldChunkStreamingDebugSnapshot(selection, {
      includeTraversalEntries: true,
    });

    expect(snapshot.proof.guarantees).toContain("screen-space-error-traversal");
    expect(snapshot.streaming.chunkTraversal?.screenSpaceError).toEqual({
      viewportHeight: 100,
      fovDegrees: 90,
      maxError: 40,
      distanceFloor: 0.0001,
    });
    expect(snapshot.streaming.chunkTraversal?.budget).toEqual({
      maxScreenSpaceError: 40,
    });
    expect(snapshot.streaming.chunkTraversal?.refinedChunkIds.values).toEqual(["sector"]);
    expect(snapshot.streaming.chunkTraversal?.renderedChunkIds.values).toEqual(["sector", "tile"]);
    const sectorEntry = snapshot.streaming.chunkTraversal?.entries?.[0];
    expect(sectorEntry?.chunkId).toBe("sector");
    expect(sectorEntry?.distanceToCamera).toBe(10);
    expect(sectorEntry?.screenSpaceError).toBeCloseTo(50);
  });
});
