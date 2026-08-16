import { describe, expect, it } from "vitest";
import {
  collectPolyRenderStats,
  collectPolyTextureReadiness,
  queryPolyLeaves,
} from "./renderStats";

// Pins the package-local re-export of the core render-stats module; the full
// behavioral suite lives in @layoutit/polycss-core.
describe("renderStats re-export", () => {
  it("computes render stats through the package-local module", () => {
    const root = document.createElement("div");
    root.innerHTML = `
      <b></b>
      <s data-polycss-texture-backend="atlas" data-polycss-texture-ready="false" style="opacity:0"></s>
      <u></u>
    `;

    expect(collectPolyRenderStats(root, { polygonCount: 3 })).toMatchObject({
      polygonCount: 3,
      mountedPolygonLeafCount: 3,
      surfaceLeafCounts: { quad: 1, clippedSolid: 0, atlas: 1, stableTriangle: 1 },
    });
    expect(collectPolyTextureReadiness(root)).toMatchObject({
      ready: false,
      textureLeafCount: 1,
      pendingTextureLeafCount: 1,
    });
    expect(queryPolyLeaves(root).map((leaf) => leaf.strategy)).toEqual([
      "quad",
      "atlas",
      "stableTriangle",
    ]);
  });
});
