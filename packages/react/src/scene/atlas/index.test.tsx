import { afterEach, describe, it, expect, vi } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import {
  buildTextureEdgeRepairSets,
  computeTextureAtlasPlan,
  isSolidTrianglePlan,
  solidTriangleStyle,
  updateStableTriangleDom,
  useTextureAtlas,
  type TextureQuality,
  type TextureAtlasPlan,
  type TextureAtlasResult,
} from "./index";
import type { Polygon } from "@layoutit/polycss-core";
import { computeSolidTriangleColorPlanFromNormal } from "@layoutit/polycss-core";

const originalMatchMedia = window.matchMedia;
const originalUserAgent = window.navigator.userAgent;
const FIREFOX_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:146.0) Gecko/20100101 Firefox/146.0";

const TEXTURED_QUAD_60: Polygon = {
  vertices: [
    [0, 0, 0],
    [60, 0, 0],
    [60, 60, 0],
    [0, 60, 0],
  ],
  color: "#ffffff",
  texture: "https://example.com/crate.png",
};

function planFor(polygon: Polygon, index = 0): TextureAtlasPlan | null {
  return computeTextureAtlasPlan(polygon, index, {});
}

function Harness({
  plans,
  textureQuality,
  onResult,
}: {
  plans: Array<TextureAtlasPlan | null>;
  textureQuality?: TextureQuality;
  onResult: (result: TextureAtlasResult) => void;
}) {
  const atlas = useTextureAtlas(plans, "baked", textureQuality);
  onResult(atlas);
  return null;
}

function renderAtlas(plans: Array<TextureAtlasPlan | null>, textureQuality?: TextureQuality): TextureAtlasResult {
  let captured: TextureAtlasResult | null = null;
  const container = document.createElement("div");
  const root = createRoot(container);
  act(() =>
    root.render(
      React.createElement(Harness, {
        plans,
        textureQuality,
        onResult: (r) => {
          captured = r;
        },
      }),
    ),
  );
  act(() => root.unmount());
  return captured!;
}

function stubMatchMedia(mobile: boolean): void {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: vi.fn((query: string) => ({
      matches: mobile && (query.includes("pointer: coarse") || query.includes("hover: none")),
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

function stubUserAgent(userAgent: string): void {
  Object.defineProperty(window.navigator, "userAgent", {
    configurable: true,
    value: userAgent,
  });
}

function stubBorderShapeUnsupported(): void {
  vi.stubGlobal("CSS", { supports: () => false });
}

function stubCornerTriangleSupported(): void {
  vi.stubGlobal("CSS", {
    supports: (property: string, value?: string) =>
      value === "bevel" &&
      (property === "corner-top-left-shape" || property === "corner-top-right-shape"),
  });
}

afterEach(() => {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: originalMatchMedia,
  });
  Object.defineProperty(window.navigator, "userAgent", {
    configurable: true,
    value: originalUserAgent,
  });
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("computeTextureAtlasPlan", () => {
  it("returns a plan for a textured quad", () => {
    const plan = planFor(TEXTURED_QUAD_60);
    expect(plan).not.toBeNull();
    expect(plan!.texture).toBe("https://example.com/crate.png");
    expect(plan!.canvasW).toBeGreaterThan(0);
    expect(plan!.canvasH).toBeGreaterThan(0);
  });

  it("returns a plan for an untextured solid quad too", () => {
    const quad: Polygon = { ...TEXTURED_QUAD_60, texture: undefined };
    const plan = planFor(quad);
    expect(plan).not.toBeNull();
    expect(plan!.texture).toBeUndefined();
  });

  it("enables textured edge repair without changing geometry", () => {
    const normal = computeTextureAtlasPlan(TEXTURED_QUAD_60, 0, {});
    const repaired = computeTextureAtlasPlan(TEXTURED_QUAD_60, 0, {
      textureEdgeRepairEdges: new Set([1]),
    });

    expect(repaired).not.toBeNull();
    expect(normal).not.toBeNull();
    expect(repaired!.canvasW).toBe(normal!.canvasW);
    expect(repaired!.canvasH).toBe(normal!.canvasH);
    expect(repaired!.textureEdgeRepair).toBe(true);
  });

  it("keeps textured edge repair disabled when there are no shared texture edges", () => {
    const repaired = computeTextureAtlasPlan(TEXTURED_QUAD_60, 0, {});

    expect(repaired).not.toBeNull();
    expect(repaired!.textureEdgeRepair).toBe(false);
  });
});

describe("buildTextureEdgeRepairSets", () => {
  it("returns only shared edges between textured polygons", () => {
    const left: Polygon = {
      vertices: [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0]],
      texture: "https://example.com/a.png",
    };
    const right: Polygon = {
      vertices: [[1, 0, 0], [2, 0, 0], [2, 1, 0], [1, 1, 0]],
      texture: "https://example.com/b.png",
    };
    const isolated: Polygon = {
      vertices: [[3, 0, 0], [4, 0, 0], [4, 1, 0], [3, 1, 0]],
      texture: "https://example.com/c.png",
    };

    const repairEdges = buildTextureEdgeRepairSets([left, right, isolated]);

    expect(repairEdges[0]).toEqual(new Set([1]));
    expect(repairEdges[1]).toEqual(new Set([3]));
    expect(repairEdges[2]).toBeUndefined();
  });
});

describe("isSolidTrianglePlan", () => {
  it("true for an untextured 3-vertex polygon", () => {
    const tri: Polygon = {
      vertices: [[0, 0, 0], [1, 0, 0], [0, 1, 0]],
      color: "#ff0000",
    };
    const plan = planFor(tri)!;
    expect(isSolidTrianglePlan(plan)).toBe(true);
  });

  it("false for a textured 3-vertex polygon", () => {
    const tri: Polygon = {
      vertices: [[0, 0, 0], [1, 0, 0], [0, 1, 0]],
      texture: "https://example.com/t.png",
    };
    const plan = planFor(tri)!;
    expect(isSolidTrianglePlan(plan)).toBe(false);
  });

  it("false for an untextured quad (4 vertices)", () => {
    const quad: Polygon = { ...TEXTURED_QUAD_60, texture: undefined };
    const plan = planFor(quad)!;
    expect(isSolidTrianglePlan(plan)).toBe(false);
  });
});

describe("updateStableTriangleDom", () => {
  it("leaves corner triangle paint to base CSS when corner-shape is supported", () => {
    stubCornerTriangleSupported();
    const tri: Polygon = {
      vertices: [[0, 0, 0], [1, 0, 0], [0, 1, 0]],
      color: "#ff0000",
    };
    const plan = planFor(tri)!;

    const style = solidTriangleStyle(plan, "baked", "auto")!;

    expect(style.borderWidth).toBeUndefined();
    expect(style.backgroundColor).toBeUndefined();
    expect((style as Record<string, unknown>).cornerTopLeftShape).toBeUndefined();
  });

  it("applies the large border triangle primitive on Firefox", () => {
    stubBorderShapeUnsupported();
    stubUserAgent(FIREFOX_UA);
    const root = document.createElement("div");
    const leaf = document.createElement("u");
    root.append(leaf);
    const tri: Polygon = {
      vertices: [[0, 0, 0], [1, 0, 0], [0, 1, 0]],
      color: "#ff0000",
    };

    expect(updateStableTriangleDom(root, [tri])).toBe(true);
    expect(leaf.style.borderWidth).toBe("0px 48px 96px");
  });
});

describe("useTextureAtlas", () => {
  function buildSixFaceCrateScene(): TextureAtlasPlan[] {
    const polys = Array.from({ length: 6 }, () => ({ ...TEXTURED_QUAD_60 }));
    return polys.map((p, i) => computeTextureAtlasPlan(p, i, {})!);
  }

  it("packs a multi-face textured scene into atlas pages", () => {
    const atlas = renderAtlas(buildSixFaceCrateScene());
    expect(atlas.pages.length).toBeGreaterThan(0);
    // One entry per input polygon (null when not atlas-eligible).
    expect(atlas.entries.length).toBe(6);
    // Textured polys must end up in the atlas — none should be null.
    expect(atlas.entries.every((e) => e !== null)).toBe(true);
  });

  it("returns an empty atlas for empty input", () => {
    const atlas = renderAtlas([]);
    expect(atlas.pages.length).toBe(0);
    expect(atlas.entries.length).toBe(0);
  });

  it("packs solid triangles into the atlas on WebKit", () => {
    stubUserAgent("Mozilla/5.0 AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15");
    stubBorderShapeUnsupported();
    const tri: Polygon = {
      vertices: [[0, 0, 0], [1, 0, 0], [0, 1, 0]],
      color: "#ff0000",
    };

    const atlas = renderAtlas([planFor(tri)]);
    expect(atlas.entries[0]).not.toBeNull();
  });

  it("filters out null plan entries (degenerate polygons)", () => {
    const plans: Array<TextureAtlasPlan | null> = [...buildSixFaceCrateScene(), null];
    const atlas = renderAtlas(plans);
    // The trailing null produces a null entry, not a packed one.
    expect(atlas.entries.length).toBe(plans.length);
    expect(atlas.entries[atlas.entries.length - 1]).toBeNull();
  });

  it("sets the atlas primitive from auto and numeric textureQuality", () => {
    const plans = [planFor(TEXTURED_QUAD_60)];

    stubMatchMedia(false);
    const desktop = renderAtlas(plans, "auto");
    expect(desktop.entries[0]?.atlasCanonicalSize).toBe(128);

    stubMatchMedia(true);
    const mobile = renderAtlas(plans, "auto");
    expect(mobile.entries[0]?.atlasCanonicalSize).toBe(64);

    const explicit = renderAtlas(plans, 1);
    expect(explicit.entries[0]?.atlasCanonicalSize).toBe(64);
  });
});

describe("updateStableTriangleDom — strategies + point lights (vanilla parity)", () => {
  const TRI: Polygon = {
    vertices: [[0, 0, 0], [1, 0, 0], [0, 1, 0]],
    color: "#808080",
  };
  const DIRECTIONAL = { direction: [0, 0, 1] as [number, number, number], color: "#ffffff", intensity: 1 };
  const AMBIENT = { color: "#ffffff", intensity: 0.4 };
  const POINT_LIGHTS = [{ position: [0, 0, 5] as [number, number, number], color: "#ff0000", intensity: 3 }];

  function runUpdate(options: Parameters<typeof updateStableTriangleDom>[2]): { handled: boolean; leaf: HTMLElement } {
    const root = document.createElement("div");
    const leaf = document.createElement("u");
    root.append(leaf);
    return { handled: updateStableTriangleDom(root, [TRI], options), leaf };
  }

  it("rejects the fast path when strategies disable u (mirrors vanilla's gate)", () => {
    stubCornerTriangleSupported();
    expect(runUpdate({}).handled).toBe(true);
    expect(runUpdate({ strategies: { disable: ["u"] } }).handled).toBe(false);
  });

  it("folds point-light contributions into the baked solid-triangle color", () => {
    stubCornerTriangleSupported();
    const lit = runUpdate({ directionalLight: DIRECTIONAL, ambientLight: AMBIENT, pointLights: POINT_LIGHTS });
    const unlit = runUpdate({ directionalLight: DIRECTIONAL, ambientLight: AMBIENT });
    expect(lit.handled).toBe(true);
    expect(unlit.handled).toBe(true);
    expect(lit.leaf.style.color).not.toBe(unlit.leaf.style.color);

    // Exact parity with core's color plan — the same plumbing vanilla's
    // computeSolidTrianglePlanFromCssPoints path uses. Normal for TRI in the
    // CSS frame is (0, 0, 1).
    const expected = computeSolidTriangleColorPlanFromNormal(TRI, 0, 0, 0, 1, {
      directionalLight: DIRECTIONAL,
      ambientLight: AMBIENT,
      pointLights: POINT_LIGHTS,
      tileSize: 50,
      layerElevation: 50,
    }, true).bakedColor!;
    const probe = document.createElement("u");
    probe.style.color = expected;
    expect(lit.leaf.style.color).toBe(probe.style.color);
  });
});
