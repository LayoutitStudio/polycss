import { describe, expect, it } from "vitest";
import {
  collectPolyRenderStats,
  collectPolyTextureReadiness,
  queryPolyLeaves,
} from "./renderStats";

describe("collectPolyRenderStats", () => {
  it("counts mounted leaves and texture readiness", () => {
    const root = document.createElement("div");
    root.innerHTML = `
      <div class="polycss-scene">
        <b></b>
        <i></i>
        <s data-polycss-texture-backend="atlas" data-polycss-texture-ready="true"></s>
        <s data-polycss-texture-backend="atlas" data-polycss-texture-ready="false" style="opacity:0"></s>
        <u></u>
        <q></q>
        <div class="polycss-bucket"><b></b></div>
      </div>
    `;

    expect(collectPolyRenderStats(root, { polygonCount: 9 })).toMatchObject({
      polygonCount: 9,
      mountedPolygonLeafCount: 6,
      shadowLeafCount: 1,
      surfaceLeafCounts: { quad: 2, clippedSolid: 1, atlas: 2, stableTriangle: 1 },
      textureReadiness: {
        ready: false,
        textureLeafCount: 2,
        readyTextureLeafCount: 1,
        pendingTextureLeafCount: 1,
        atlasTextureLeafCount: 2,
        imageTextureLeafCount: 0,
      },
      bucketCount: 1,
    });
  });
});

describe("queryPolyLeaves", () => {
  it("returns strategy and texture metadata", () => {
    const root = document.createElement("div");
    root.innerHTML = `
      <b data-poly-index="0"></b>
      <s
        data-poly-index="1"
        data-polycss-texture-backend="image"
        data-polycss-texture-ready="true"
        data-polycss-texture-leaf-sizing="local"
        data-polycss-texture-image-rendering="pixelated"
        data-polycss-texture-projection="projective"
        data-polycss-texture-leaf-width="100"
        data-polycss-texture-leaf-height="50"
        data-polycss-double-sided="true"
      ></s>
    `;

    expect(queryPolyLeaves(root).map((leaf) => ({
      strategy: leaf.strategy,
      polygonIndex: leaf.polygonIndex,
      textureBackend: leaf.textureBackend,
      textureReady: leaf.textureReady,
      textureLeafSizing: leaf.textureLeafSizing,
      textureImageRendering: leaf.textureImageRendering,
      textureProjection: leaf.textureProjection,
      textureLeafWidth: leaf.textureLeafWidth,
      textureLeafHeight: leaf.textureLeafHeight,
      doubleSided: leaf.doubleSided,
    }))).toEqual([
      {
        strategy: "quad",
        polygonIndex: 0,
        textureBackend: undefined,
        textureReady: undefined,
        textureLeafSizing: undefined,
        textureImageRendering: undefined,
        textureProjection: undefined,
        textureLeafWidth: undefined,
        textureLeafHeight: undefined,
        doubleSided: false,
      },
      {
        strategy: "atlas",
        polygonIndex: 1,
        textureBackend: "image",
        textureReady: true,
        textureLeafSizing: "local",
        textureImageRendering: "pixelated",
        textureProjection: "projective",
        textureLeafWidth: 100,
        textureLeafHeight: 50,
        doubleSided: true,
      },
    ]);
  });

  it("collects texture and snapshot diagnostics", () => {
    const root = document.createElement("div");
    root.innerHTML = `
      <s
        data-polycss-texture-backend="atlas"
        data-polycss-texture-ready="false"
        data-polycss-texture-leaf-sizing="local"
        data-polycss-texture-image-rendering="pixelated"
        data-polycss-texture-projection="affine"
        data-polycss-texture-leaf-width="100"
        data-polycss-texture-leaf-height="50"
        style="opacity:0;--polycss-atlas-url:url(blob:test)"
      ></s>
      <s
        data-polycss-texture-backend="image"
        data-polycss-texture-ready="true"
        data-polycss-texture-leaf-sizing="image"
        data-polycss-texture-image-rendering="auto"
        data-polycss-texture-projection="projective"
        data-polycss-texture-leaf-width="320"
        data-polycss-texture-leaf-height="200"
        data-polycss-double-sided="true"
      ></s>
      <div style='background-image:url("blob:baked-atlas")'></div>
      <div style='background-image:url("data:image/png;base64,already")'></div>
      <div data-polycss-snapshot-atlas="0"></div>
      <div data-polycss-snapshot-bg="data:image/png;base64,abc"></div>
    `;

    const stats = collectPolyRenderStats(root);
    expect(stats.textureStats).toMatchObject({
      ready: false,
      leafCount: 2,
      atlasCount: 1,
      imageCount: 1,
      pendingCount: 1,
      minLeafWidth: 100,
      maxLeafWidth: 320,
      minLeafHeight: 50,
      maxLeafHeight: 200,
      doubleSidedCount: 1,
    });
    expect(stats.textureStats.sizingCounts).toEqual({ canonical: 0, local: 1, raster: 0, image: 1, unknown: 0 });
    expect(stats.textureStats.imageRenderingCounts).toEqual({ auto: 1, pixelated: 1, unknown: 0 });
    expect(stats.textureStats.projectionCounts).toEqual({ affine: 1, projective: 1, fallback: 0, unknown: 0 });
    expect(stats.snapshotStats).toEqual({
      runtimeAtlasUrlCount: 2,
      snapshotAtlasCount: 1,
      snapshotBackgroundCount: 1,
      selfContained: false,
    });
  });

  it("collects camera snapshot diagnostics from PolyCSS-owned markers", () => {
    const root = document.createElement("div");
    root.innerHTML = `
      <div
        class="polycss-camera"
        data-polycss-camera-projection="orthographic"
        data-polycss-camera-perspective="none"
        data-polycss-camera-applied-perspective="1000000px"
        data-polycss-camera-zoom="2"
        data-polycss-camera-distance="300"
        data-polycss-camera-rot-x="45"
        data-polycss-camera-rot-y="90"
        data-polycss-camera-target="1,2,3"
      >
        <div class="polycss-scene"></div>
      </div>
    `;

    expect(collectPolyRenderStats(root.querySelector(".polycss-scene")).cameraStats).toEqual({
      rootFound: true,
      projection: "orthographic",
      perspectiveStyle: "none",
      appliedPerspectiveStyle: "1000000px",
      zoom: 2,
      distance: 300,
      rotX: 45,
      rotY: 90,
      target: [1, 2, 3],
    });
  });
});

describe("collectPolyTextureReadiness", () => {
  it("treats missing roots as ready", () => {
    expect(collectPolyTextureReadiness(null)).toEqual({
      ready: true,
      textureLeafCount: 0,
      readyTextureLeafCount: 0,
      pendingTextureLeafCount: 0,
      atlasTextureLeafCount: 0,
      imageTextureLeafCount: 0,
    });
  });
});
