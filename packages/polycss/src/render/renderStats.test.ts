import { describe, expect, it } from "vitest";
import { collectPolyRenderStats } from "./renderStats";

describe("collectPolyRenderStats", () => {
  it("returns an empty snapshot for a missing root", () => {
    expect(collectPolyRenderStats(null)).toEqual({
      polygonCount: 0,
      mountedPolygonLeafCount: 0,
      shadowLeafCount: 0,
      surfaceLeafCounts: { quad: 0, clippedSolid: 0, atlas: 0, stableTriangle: 0 },
      bucketCount: 0,
    });
  });

  it("counts mounted polygon leaves, shadows, and buckets", () => {
    const root = document.createElement("div");
    root.innerHTML = `
      <div class="polycss-scene">
        <b></b>
        <i></i>
        <s></s>
        <u></u>
        <q></q>
        <div class="polycss-bucket"><b></b><s></s></div>
      </div>
    `;

    expect(collectPolyRenderStats(root, { polygonCount: 12 })).toEqual({
      polygonCount: 12,
      mountedPolygonLeafCount: 6,
      shadowLeafCount: 1,
      surfaceLeafCounts: { quad: 2, clippedSolid: 1, atlas: 2, stableTriangle: 1 },
      bucketCount: 1,
    });
  });

  it("can scope counts to model subtrees", () => {
    const root = document.createElement("div");
    root.innerHTML = `
      <div class="dn-model-mesh"><b></b><s></s><q></q></div>
      <div class="polycss-helper"><b></b><u></u></div>
    `;

    expect(collectPolyRenderStats(root, { scopeSelector: ".dn-model-mesh" })).toEqual({
      polygonCount: 2,
      mountedPolygonLeafCount: 2,
      shadowLeafCount: 1,
      surfaceLeafCounts: { quad: 1, clippedSolid: 0, atlas: 1, stableTriangle: 0 },
      bucketCount: 0,
    });
  });

  it("includes the root when it matches the scope selector", () => {
    const root = document.createElement("div");
    root.className = "dn-model-mesh";
    root.innerHTML = "<b></b><i></i>";

    expect(collectPolyRenderStats(root, { scopeSelector: ".dn-model-mesh" })).toMatchObject({
      mountedPolygonLeafCount: 2,
      surfaceLeafCounts: { quad: 1, clippedSolid: 1, atlas: 0, stableTriangle: 0 },
    });
  });
});
