/**
 * Feature tests: filterAtlasPlans wrapper (Vue atlasBrowser copy)
 *
 * Mirrors React's atlasBrowser.filterPlans.test.ts.
 * Imports from the Vue-local copy so drift surfaces immediately.
 */
import { describe, it, expect } from "vitest";
import type { Polygon } from "@layoutit/polycss-core";
import { computeTextureAtlasPlanPublic } from "@layoutit/polycss-core";
import { filterAtlasPlans } from "../atlasBrowser";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDoc(options: {
  borderShape?: boolean;
  userAgent?: string;
  pointer?: "fine" | "coarse";
}): Document {
  const pointer = options.pointer ?? "fine";
  const ua = options.userAgent ?? "Mozilla/5.0 Chrome/120";
  return {
    defaultView: {
      navigator: { userAgent: ua },
      CSS: {
        supports: (property: string) => {
          if (property === "border-shape") return options.borderShape === true;
          return false;
        },
      },
      matchMedia: (query: string) => ({
        matches: pointer === "fine"
          ? (query.includes("pointer: fine") || query.includes("hover: hover"))
          : (query.includes("pointer: coarse") || query.includes("hover: none")),
      }),
    },
  } as unknown as Document;
}

const SAFARI_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15";

// ---------------------------------------------------------------------------
// Polygon fixtures
// ---------------------------------------------------------------------------

const FLAT_RECT: Polygon = {
  vertices: [[0, 0, 0], [2, 0, 0], [2, 1, 0], [0, 1, 0]],
  color: "#00ff00",
};

const FLAT_TRIANGLE: Polygon = {
  vertices: [[0, 0, 0], [1, 0, 0], [0, 1, 0]],
  color: "#ff0000",
};

const TEXTURED_QUAD: Polygon = {
  vertices: [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0]],
  texture: "https://example.com/tex.png",
  color: "#ffffff",
};

// ---------------------------------------------------------------------------
// Tests: filterAtlasPlans contract
// ---------------------------------------------------------------------------

describe("filterAtlasPlans — strategy filter contracts", () => {
  const noDisable = new Set<"b" | "i" | "u">();

  it("full-rect solid plan filters OUT of atlas when b is enabled (Chrome doc)", () => {
    const plan = computeTextureAtlasPlanPublic(FLAT_RECT, 0);
    const doc = makeDoc({});
    const filtered = filterAtlasPlans([plan], "baked", noDisable, doc);
    // full-rect → hits <b> path → excluded from atlas
    expect(filtered[0]).toBeNull();
  });

  it("triangle plan filters OUT of atlas on Chrome doc (u is supported)", () => {
    const plan = computeTextureAtlasPlanPublic(FLAT_TRIANGLE, 0);
    const doc = makeDoc({});
    const filtered = filterAtlasPlans([plan], "baked", noDisable, doc);
    expect(filtered[0]).toBeNull();
  });

  it("triangle plan stays in atlas on Safari doc (u is not supported)", () => {
    const plan = computeTextureAtlasPlanPublic(FLAT_TRIANGLE, 0);
    const doc = makeDoc({ userAgent: SAFARI_UA });
    const filtered = filterAtlasPlans([plan], "baked", noDisable, doc);
    // Safari: solid triangles unsupported → <u> not available → stays in atlas
    expect(filtered[0]).not.toBeNull();
  });

  it("textured polygon is never excluded from atlas", () => {
    const plan = computeTextureAtlasPlanPublic(TEXTURED_QUAD, 0);
    const allDisabled = new Set<"b" | "i" | "u">(["b", "i", "u"]);
    const doc = makeDoc({});
    const filtered = filterAtlasPlans([plan], "baked", allDisabled, doc);
    expect(filtered[0]).not.toBeNull();
    expect(filtered[0]).toBe(plan);
  });

  it("null plans in the input remain null in the output", () => {
    const doc = makeDoc({});
    const filtered = filterAtlasPlans([null, null], "baked", noDisable, doc);
    expect(filtered[0]).toBeNull();
    expect(filtered[1]).toBeNull();
  });

  it("disabling b keeps rect in atlas even on Chrome", () => {
    const plan = computeTextureAtlasPlanPublic(FLAT_RECT, 0);
    const disableB = new Set<"b" | "i" | "u">(["b"]);
    const doc = makeDoc({ borderShape: false });
    const filtered = filterAtlasPlans([plan], "baked", disableB, doc);
    // b disabled, no border-shape → falls through to <s>; stays in atlas
    expect(filtered[0]).not.toBeNull();
  });

  it("disabling b and i keeps rect in atlas (falls to s)", () => {
    const plan = computeTextureAtlasPlanPublic(FLAT_RECT, 0);
    const disableBI = new Set<"b" | "i" | "u">(["b", "i"]);
    const doc = makeDoc({});
    const filtered = filterAtlasPlans([plan], "baked", disableBI, doc);
    expect(filtered[0]).not.toBeNull();
  });

  it("dynamic lighting mode keeps non-rect polygon in atlas", () => {
    const pentagon: Polygon = {
      vertices: [
        [0, 1, 0], [0.951, 0.309, 0], [0.588, -0.809, 0],
        [-0.588, -0.809, 0], [-0.951, 0.309, 0],
      ],
      color: "#0000ff",
    };
    const plan = computeTextureAtlasPlanPublic(pentagon, 0);
    const doc = makeDoc({});
    const filtered = filterAtlasPlans([plan], "dynamic", noDisable, doc);
    // dynamic mode suppresses border-shape; 5-vertex polygon → stays in atlas
    expect(filtered[0]).not.toBeNull();
  });

  it("output length matches input length", () => {
    const plans = [
      computeTextureAtlasPlanPublic(FLAT_RECT, 0),
      computeTextureAtlasPlanPublic(FLAT_TRIANGLE, 1),
      null,
    ];
    const doc = makeDoc({});
    const filtered = filterAtlasPlans(plans, "baked", noDisable, doc);
    expect(filtered.length).toBe(3);
  });
});
