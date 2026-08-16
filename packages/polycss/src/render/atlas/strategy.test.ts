/**
 * Feature tests: strategy selection and filter
 *
 * Covers filterAtlasPlans, isFullRectSolid, isProjectiveQuadPlan,
 * isSolidTrianglePlan, and the dispatch table in renderPolygonsWithTextureAtlas.
 *
 * The key invariant: the HTML tag emitted for a polygon is the cheapest
 * strategy that is (a) supported by the browser, (b) not explicitly disabled,
 * and (c) applicable to the polygon's shape and material.
 *
 * Strategy chain: b → i → s   (triangles: u → i → s)
 *
 * We drive strategy through supportDoc helpers that mock CSS.supports /
 * matchMedia, matching the pattern already established in polyDOM.test.ts.
 */
import { describe, it, expect } from "vitest";
import type { Polygon } from "@layoutit/polycss-core";
import {
  filterAtlasPlans,
  isFullRectSolid,
  isProjectiveQuadPlan,
  isSolidTrianglePlan,
  projectiveQuadSupported,
} from "./strategy";
import { computeTextureAtlasPlanPublic } from "@layoutit/polycss-core";
import { renderPolygonsWithTextureAtlas } from "./renderPolygons";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDoc(options: {
  borderShape?: boolean;
  cornerShape?: boolean;
  pointer?: "fine" | "coarse";
  userAgent?: string;
}): Document {
  const pointer = options.pointer ?? "fine";
  return {
    defaultView: {
      navigator: { userAgent: options.userAgent ?? "Mozilla/5.0 Chrome/120" },
      CSS: {
        supports: (property: string, value?: string) => {
          if (property === "border-shape") return options.borderShape === true;
          if (property.startsWith("corner-") && value === "bevel") return options.cornerShape === true;
          return false;
        },
      },
      matchMedia: (query: string) => ({
        matches: pointer === "fine"
          ? (query.includes("pointer: fine") || query.includes("hover: hover"))
          : (query.includes("pointer: coarse") || query.includes("hover: none")),
      }),
    },
    createElement(tagName: string) {
      if (tagName === "canvas") return { width: 0, height: 0, getContext: () => null };
      return document.createElement(tagName);
    },
  } as unknown as Document;
}

/** Count leaf HTML tags in a rendered result. */
function tagCounts(result: ReturnType<typeof renderPolygonsWithTextureAtlas>): Record<string, number> {
  const counts: Record<string, number> = { b: 0, i: 0, s: 0, u: 0 };
  for (const { element } of result.rendered) {
    const tag = element.tagName.toLowerCase();
    counts[tag] = (counts[tag] ?? 0) + 1;
  }
  return counts;
}

// ---------------------------------------------------------------------------
// Shared polygon fixtures
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

const NON_RECT_QUAD: Polygon = {
  vertices: [[0, 0, 0], [2, 0, 0], [2, 1, 0], [0, 2, 0]],
  color: "#00ffff",
};

// ---------------------------------------------------------------------------
// isFullRectSolid / isProjectiveQuadPlan / isSolidTrianglePlan
// ---------------------------------------------------------------------------

describe("plan predicate functions", () => {
  it("isFullRectSolid is true for an axis-aligned rect plan", () => {
    const plan = computeTextureAtlasPlanPublic(FLAT_RECT, 0);
    expect(plan).not.toBeNull();
    expect(isFullRectSolid(plan!)).toBe(true);
  });

  it("isFullRectSolid is false for a triangle plan", () => {
    const plan = computeTextureAtlasPlanPublic(FLAT_TRIANGLE, 0);
    expect(isFullRectSolid(plan!)).toBe(false);
  });

  it("isSolidTrianglePlan is true for a 3-vertex untextured polygon", () => {
    const plan = computeTextureAtlasPlanPublic(FLAT_TRIANGLE, 0);
    expect(isSolidTrianglePlan(plan!)).toBe(true);
  });

  it("isSolidTrianglePlan is false for a rect polygon", () => {
    const plan = computeTextureAtlasPlanPublic(FLAT_RECT, 0);
    expect(isSolidTrianglePlan(plan!)).toBe(false);
  });

  it("isSolidTrianglePlan is false for a textured 3-vertex polygon", () => {
    const texturedTriangle: Polygon = {
      vertices: [[0, 0, 0], [1, 0, 0], [0, 1, 0]],
      texture: "https://example.com/t.png",
      color: "#aaaaaa",
    };
    const plan = computeTextureAtlasPlanPublic(texturedTriangle, 0);
    expect(isSolidTrianglePlan(plan!)).toBe(false);
  });

  it("isProjectiveQuadPlan is false for a full-rect plan", () => {
    const plan = computeTextureAtlasPlanPublic(FLAT_RECT, 0);
    expect(isProjectiveQuadPlan(plan!)).toBe(false);
  });
});

describe("projectiveQuadSupported", () => {
  it("returns false for an iOS AppleWebKit browser shell", () => {
    const userAgent = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/128.0.6613.98 Mobile/15E148 Safari/604.1";
    expect(projectiveQuadSupported(makeDoc({ userAgent }))).toBe(false);
  });

  it("returns true for desktop Chromium", () => {
    const userAgent = "Mozilla/5.0 AppleWebKit/537.36 Chrome/128.0.0.0 Safari/537.36";
    expect(projectiveQuadSupported(makeDoc({ userAgent }))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// filterAtlasPlans — strategy disable combinations
// ---------------------------------------------------------------------------

describe("filterAtlasPlans — strategy filter contracts", () => {
  const noDisable = new Set<"b" | "i" | "u">();

  it("full-rect solid plan filters OUT of atlas when b is enabled", () => {
    const plan = computeTextureAtlasPlanPublic(FLAT_RECT, 0);
    const filtered = filterAtlasPlans([plan], "baked", noDisable);
    expect(filtered[0]).toBeNull();
  });

  it("triangle plan filters OUT of atlas when u is supported (no-Safari doc)", () => {
    const plan = computeTextureAtlasPlanPublic(FLAT_TRIANGLE, 0);
    // document is a Chrome UA in happy-dom → u is supported
    const filtered = filterAtlasPlans([plan], "baked", noDisable, document);
    expect(filtered[0]).toBeNull();
  });

  it("textured polygon NEVER filters out of atlas regardless of strategy", () => {
    const plan = computeTextureAtlasPlanPublic(TEXTURED_QUAD, 0);
    const allStrategiesDisabled = new Set<"b" | "i" | "u">(["b", "i", "u"]);
    const filtered = filterAtlasPlans([plan], "baked", allStrategiesDisabled);
    expect(filtered[0]).not.toBeNull();
    expect(filtered[0]).toBe(plan);
  });

  it("null plans in the input remain null in the output", () => {
    const filtered = filterAtlasPlans([null, null], "baked", noDisable);
    expect(filtered[0]).toBeNull();
    expect(filtered[1]).toBeNull();
  });

  it("disabling b and i keeps full-rect solid in atlas (falls to s)", () => {
    const plan = computeTextureAtlasPlanPublic(FLAT_RECT, 0);
    const disableBI = new Set<"b" | "i" | "u">(["b", "i"]);
    const filtered = filterAtlasPlans([plan], "baked", disableBI, document);
    // b disabled, i disabled → no solid path → stays in atlas
    expect(filtered[0]).not.toBeNull();
  });

  it("dynamic lighting mode keeps border-shape filter active (vanilla parity)", () => {
    // A pentagon has no projective matrix and is not a full-rect. The
    // borderShape strategy applies in BOTH lighting modes — vanilla never
    // gates it on textureLighting, and the dynamic CSS calc shades the
    // <i> border-shape leaf directly. Earlier core filterAtlasPlans
    // disabled borderShape in dynamic mode, which routed these polys
    // through the atlas bitmap (visible parity drift on castle dynamic).
    const pentagon: Polygon = {
      vertices: [
        [0, 1, 0],
        [0.951, 0.309, 0],
        [0.588, -0.809, 0],
        [-0.588, -0.809, 0],
        [-0.951, 0.309, 0],
      ],
      color: "#0000ff",
    };
    const plan = computeTextureAtlasPlanPublic(pentagon, 0);
    const filtered = filterAtlasPlans([plan], "dynamic", noDisable, document);
    // dynamic mode → useBorderShape=true; 5-vertex polygon has no projective matrix
    // and is not a full rect → borderShape catches it → excluded from atlas
    expect(filtered[0]).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// renderPolygonsWithTextureAtlas dispatch — tag emitted per strategy
// ---------------------------------------------------------------------------

describe("renderPolygonsWithTextureAtlas — strategy dispatch", () => {
  it("axis-aligned rect emits <b> when b is enabled", () => {
    const doc = makeDoc({ borderShape: false });
    const result = renderPolygonsWithTextureAtlas([FLAT_RECT], { doc });
    expect(tagCounts(result).b).toBe(1);
    expect(tagCounts(result).s).toBe(0);
    result.dispose();
  });

  it("triangle emits <u> when u is supported (non-Safari)", () => {
    const doc = makeDoc({ borderShape: false });
    const result = renderPolygonsWithTextureAtlas([FLAT_TRIANGLE], { doc });
    expect(tagCounts(result).u).toBe(1);
    result.dispose();
  });

  it("disabling b forces rect to fall through to <i> when border-shape is supported", () => {
    const doc = makeDoc({ borderShape: true });
    const result = renderPolygonsWithTextureAtlas([FLAT_RECT], {
      doc,
      strategies: { disable: ["b"] },
    });
    // b disabled + border-shape supported → <i>
    expect(tagCounts(result).i).toBe(1);
    expect(tagCounts(result).b).toBe(0);
    result.dispose();
  });

  it("disabling b and i forces rect to atlas <s>", () => {
    const doc = makeDoc({ borderShape: false });
    const result = renderPolygonsWithTextureAtlas([FLAT_RECT], {
      doc,
      strategies: { disable: ["b", "i"] },
    });
    expect(tagCounts(result).s).toBe(1);
    expect(tagCounts(result).b).toBe(0);
    result.dispose();
  });

  it("disabling u forces triangle to <i> when border-shape supported", () => {
    const doc = makeDoc({ borderShape: true });
    const result = renderPolygonsWithTextureAtlas([FLAT_TRIANGLE], {
      doc,
      strategies: { disable: ["u"] },
    });
    expect(tagCounts(result).u).toBe(0);
    expect(tagCounts(result).i).toBe(1);
    result.dispose();
  });

  it("textured quad always emits <s> regardless of strategy flags", () => {
    const doc = makeDoc({ borderShape: true });
    const result = renderPolygonsWithTextureAtlas([TEXTURED_QUAD], { doc });
    expect(tagCounts(result).s).toBe(1);
    result.dispose();
  });

  it("dynamic lighting mode suppresses border-shape (<i>); rect stays <b>", () => {
    const doc = makeDoc({ borderShape: true });
    const result = renderPolygonsWithTextureAtlas([FLAT_RECT], {
      doc,
      textureLighting: "dynamic",
    });
    // dynamic mode: <i> is suppressed → full-rect falls to <b>
    expect(tagCounts(result).b).toBe(1);
    expect(tagCounts(result).i).toBe(0);
    result.dispose();
  });
});

// ---------------------------------------------------------------------------
// filterAtlasPlans — extended env parity (react/vue mirror)
// ---------------------------------------------------------------------------

describe("filterAtlasPlans — extended env parity (react/vue mirror)", () => {
  const noDisable = new Set<"b" | "i" | "u">();

  // Axis-aligned rect with one beveled corner — corner-shape solid eligible.
  const BEVELED_RECT: Polygon = {
    vertices: [[0, 0, 0], [2, 0, 0], [2, 2, 0], [0.5, 2, 0], [0, 1.5, 0]],
    color: "#aaaaaa",
  };

  // Source-exact direct-image polygon (no texturePresentation — relies on the
  // scene-level textureBackend/textureProjection defaults reaching the core
  // filter env).
  const DIRECT_IMAGE_QUAD: Polygon = {
    vertices: [[0, 0, 0], [2, 0, 0], [2, 1, 0], [0, 1, 0]],
    textureImageSource: {
      url: "https://example.com/source.png",
      width: 320,
      height: 200,
      sourceRect: { x: 16, y: 24, width: 80, height: 40 },
    },
  };

  it("passes cornerShapeSupported to the core filter (beveled rect leaves the atlas)", () => {
    const plan = computeTextureAtlasPlanPublic(BEVELED_RECT, 0);
    const withCorner = filterAtlasPlans([plan], "baked", noDisable, makeDoc({ cornerShape: true }));
    const withoutCorner = filterAtlasPlans([plan], "baked", noDisable, makeDoc({ cornerShape: false, borderShape: false, userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15" }));
    expect(withCorner[0]).toBeNull();
    expect(withoutCorner[0]).not.toBeNull();
  });

  it("passes textureBackend/textureProjection so direct-image leaves leave the atlas", () => {
    const plan = computeTextureAtlasPlanPublic(DIRECT_IMAGE_QUAD, 0);
    const doc = makeDoc({});
    const withoutBackend = filterAtlasPlans([plan], "baked", noDisable, doc);
    const withBackend = filterAtlasPlans([plan], "baked", noDisable, doc, "image", undefined, "affine");
    expect(withoutBackend[0]).toBe(plan);
    expect(withBackend[0]).toBeNull();
  });
});
