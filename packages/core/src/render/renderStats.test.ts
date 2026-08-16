// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import {
  collectPolyRenderStats,
  collectPolyTextureReadiness,
  queryPolyLeaves,
} from "./renderStats";

describe("collectPolyRenderStats", () => {
  it("returns an empty snapshot for a missing root", () => {
    expect(collectPolyRenderStats(null)).toMatchObject({
      polygonCount: 0,
      mountedPolygonLeafCount: 0,
      shadowLeafCount: 0,
      surfaceLeafCounts: { quad: 0, clippedSolid: 0, atlas: 0, stableTriangle: 0 },
      textureReadiness: {
        ready: true,
        textureLeafCount: 0,
        readyTextureLeafCount: 0,
        pendingTextureLeafCount: 0,
        atlasTextureLeafCount: 0,
        imageTextureLeafCount: 0,
      },
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
        <u style="width:16px;height:16px;corner-bottom-left-shape:bevel"></u>
        <q></q>
        <svg class="polycss-shadow polycss-shadow-svg"></svg>
        <div class="polycss-bucket"><b></b><s></s></div>
      </div>
    `;

    expect(collectPolyRenderStats(root, { polygonCount: 12 })).toMatchObject({
      polygonCount: 12,
      mountedPolygonLeafCount: 7,
      shadowLeafCount: 2,
      surfaceLeafCounts: { quad: 2, clippedSolid: 1, atlas: 2, stableTriangle: 2 },
      textureReadiness: {
        ready: true,
        textureLeafCount: 2,
        readyTextureLeafCount: 2,
        pendingTextureLeafCount: 0,
        atlasTextureLeafCount: 2,
        imageTextureLeafCount: 0,
      },
      bucketCount: 1,
    });
  });

  it("can scope counts to model subtrees", () => {
    const root = document.createElement("div");
    root.innerHTML = `
      <div class="dn-model-mesh"><b></b><s></s><q></q><svg class="polycss-shadow polycss-shadow-svg"></svg></div>
      <div class="polycss-helper"><b></b><u></u></div>
    `;

    expect(collectPolyRenderStats(root, { scopeSelector: ".dn-model-mesh" })).toMatchObject({
      polygonCount: 2,
      mountedPolygonLeafCount: 2,
      shadowLeafCount: 2,
      surfaceLeafCounts: { quad: 1, clippedSolid: 0, atlas: 1, stableTriangle: 0 },
      textureReadiness: {
        ready: true,
        textureLeafCount: 1,
        readyTextureLeafCount: 1,
        pendingTextureLeafCount: 0,
        atlasTextureLeafCount: 1,
        imageTextureLeafCount: 0,
      },
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

  it("queries mounted polygon leaves with strategy and texture metadata", () => {
    const root = document.createElement("div");
    root.innerHTML = `
      <b data-poly-index="0"></b>
      <s
        data-poly-index="1"
        data-polycss-texture-backend="atlas"
        data-polycss-texture-ready="false"
        data-polycss-texture-leaf-sizing="local"
        data-polycss-texture-image-rendering="pixelated"
        data-polycss-texture-projection="projective"
        data-polycss-texture-leaf-width="100"
        data-polycss-texture-leaf-height="50"
        data-polycss-double-sided="true"
        style="opacity:0"
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
        textureBackend: "atlas",
        textureReady: false,
        textureLeafSizing: "local",
        textureImageRendering: "pixelated",
        textureProjection: "projective",
        textureLeafWidth: 100,
        textureLeafHeight: 50,
        doubleSided: true,
      },
    ]);
  });

  it("collects texture and snapshot diagnostics without style-string game code", () => {
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
    expect(stats.textureStats).toEqual({
      ready: false,
      leafCount: 2,
      atlasCount: 1,
      imageCount: 1,
      pendingCount: 1,
      sizingCounts: { canonical: 0, local: 1, raster: 0, image: 1, unknown: 0 },
      imageRenderingCounts: { auto: 1, pixelated: 1, unknown: 0 },
      projectionCounts: { affine: 1, projective: 1, fallback: 0, unknown: 0 },
      minLeafWidth: 100,
      maxLeafWidth: 320,
      minLeafHeight: 50,
      maxLeafHeight: 200,
      doubleSidedCount: 1,
    });
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

  it("collects texture readiness without computed style polling", () => {
    const root = document.createElement("div");
    root.innerHTML = `
      <s data-polycss-texture-backend="atlas" data-polycss-texture-ready="true"></s>
      <s data-polycss-texture-backend="atlas" data-polycss-texture-ready="false" style="opacity:0"></s>
      <s data-polycss-texture-backend="image" data-polycss-texture-ready="true"></s>
    `;

    expect(collectPolyTextureReadiness(root)).toEqual({
      ready: false,
      textureLeafCount: 3,
      readyTextureLeafCount: 2,
      pendingTextureLeafCount: 1,
      atlasTextureLeafCount: 2,
      imageTextureLeafCount: 1,
    });
  });
});
