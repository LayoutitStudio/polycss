/**
 * Feature tests: getSolidPaintDefaultsFromPlans wrapper (Vue atlasBrowser copy)
 *
 * Mirrors React's atlasBrowser.paintDefaults.test.ts.
 * Imports from the Vue-local copy so drift surfaces immediately.
 */
import { afterEach, describe, it, expect } from "vitest";
import type { Polygon, ProjectiveQuadGuardGlobal } from "@layoutit/polycss-core";
import { computeTextureAtlasPlanPublic, DEFAULT_SEAM_BLEED } from "@layoutit/polycss-core";
import { getSolidPaintDefaultsFromPlans } from "./detection";
import { computeTextureAtlasPlan } from "./paintDefaults";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDoc(): Document {
  return {
    defaultView: {
      navigator: { userAgent: "Mozilla/5.0 Chrome/120" },
      CSS: { supports: () => false },
      matchMedia: (query: string) => ({
        matches: query.includes("pointer: fine") || query.includes("hover: hover"),
      }),
    },
  } as unknown as Document;
}

function makeRects(color: string, count: number): Polygon[] {
  return Array.from({ length: count }, (_, i): Polygon => ({
    vertices: [[i, 0, 0], [i + 1, 0, 0], [i + 1, 1, 0], [i, 1, 0]],
    color,
  }));
}

// ---------------------------------------------------------------------------
// Tests: getSolidPaintDefaultsFromPlans
// ---------------------------------------------------------------------------

describe("getSolidPaintDefaultsFromPlans — plan-array variant", () => {
  it("returns a valid object for a uniform-color plan list", () => {
    const polygons = makeRects("#aaaaaa", 3);
    const doc = makeDoc();
    const plans = polygons.map((p, i) => computeTextureAtlasPlanPublic(p, i));
    const defaults = getSolidPaintDefaultsFromPlans(plans, "baked", new Set(), doc);
    expect(typeof defaults).toBe("object");
  });

  it("null plans in the array are skipped without error", () => {
    const plan = computeTextureAtlasPlanPublic(
      { vertices: [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0]], color: "#ffffff" },
      0,
    );
    const defaults = getSolidPaintDefaultsFromPlans([null, plan, null], "baked", new Set(), makeDoc());
    expect(typeof defaults).toBe("object");
  });

  it("returns empty object when doc is null", () => {
    const plan = computeTextureAtlasPlanPublic(
      { vertices: [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0]], color: "#ff0000" },
      0,
    );
    const defaults = getSolidPaintDefaultsFromPlans([plan], "baked", new Set(), null);
    expect(defaults).toEqual({});
  });

  it("single dominant color produces a defined paintColor in baked mode", () => {
    const polygons = makeRects("#ff0000", 5);
    const plans = polygons.map((p, i) => computeTextureAtlasPlanPublic(p, i));
    const defaults = getSolidPaintDefaultsFromPlans(plans, "baked", new Set(), makeDoc());
    expect(defaults.paintColor).toBeDefined();
  });

  it("dynamic mode produces dynamicColor rather than paintColor", () => {
    const polygons = makeRects("#0000ff", 4);
    const plans = polygons.map((p, i) => computeTextureAtlasPlanPublic(p, i));
    const defaults = getSolidPaintDefaultsFromPlans(plans, "dynamic", new Set(), makeDoc());
    expect(defaults.dynamicColor).toBeDefined();
    expect(defaults.paintColor).toBeUndefined();
  });

  it("disabling b does not crash and returns a valid object", () => {
    const polygons = makeRects("#cccccc", 5);
    const plans = polygons.map((p, i) => computeTextureAtlasPlanPublic(p, i));
    const withoutB = getSolidPaintDefaultsFromPlans(plans, "baked", new Set(["b"]), makeDoc());
    expect(typeof withoutB).toBe("object");
  });

  it("all-null input array returns a valid (possibly empty) object", () => {
    const defaults = getSolidPaintDefaultsFromPlans([null, null], "baked", new Set(), makeDoc());
    expect(typeof defaults).toBe("object");
  });

  it("dominant color is consistent with majority when one color appears most often", () => {
    const majority = makeRects("#0000ff", 5);
    const minority = makeRects("#ff0000", 1);
    const plans = [...majority, ...minority].map((p, i) => computeTextureAtlasPlanPublic(p, i));
    const defaults = getSolidPaintDefaultsFromPlans(plans, "baked", new Set(), makeDoc());
    const majorityDefaults = getSolidPaintDefaultsFromPlans(
      majority.map((p, i) => computeTextureAtlasPlanPublic(p, i)),
      "baked",
      new Set(),
      makeDoc(),
    );
    expect(defaults.paintColor).toBe(majorityDefaults.paintColor);
  });
});

// ---------------------------------------------------------------------------
// Tests: unified seamBleed semantics through the local computeTextureAtlasPlan
// wrapper (raw option resolved in core + vanilla-parity projective guards)
// ---------------------------------------------------------------------------

describe("computeTextureAtlasPlan — unified seamBleed semantics", () => {
  const SEAM_RECT: Polygon = {
    vertices: [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0]],
    color: "#ff0000",
  };
  const LONE_QUAD: Polygon = {
    vertices: [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 3, 0]],
    color: "#00ff00",
  };
  const seamEdges = new Set([1]);

  afterEach(() => {
    delete (window as Window & ProjectiveQuadGuardGlobal).__polycssProjectiveQuadGuards;
  });

  it("'auto' now yields the full 1.5px shared-edge overscan (was none)", () => {
    const plan = computeTextureAtlasPlan(SEAM_RECT, 0, { seamBleed: "auto", seamEdges });
    expect(plan?.seamBleedEdgeAmounts?.get(1)).toBe(DEFAULT_SEAM_BLEED);
    expect(plan?.bleedRatio).toBe(1);
  });

  it("numbers are raw px: above the default uncapped, 0 disables everything", () => {
    const raised = computeTextureAtlasPlan(SEAM_RECT, 0, { seamBleed: 3, seamEdges });
    expect(raised?.seamBleedEdgeAmounts?.get(1)).toBe(3);
    expect(raised?.bleedRatio).toBe(1);
    const disabled = computeTextureAtlasPlan(SEAM_RECT, 0, { seamBleed: 0, seamEdges });
    expect(disabled?.seamBleedEdgeAmounts).toBeUndefined();
    expect(disabled?.bleedRatio).toBe(0);
  });

  it("sub-1.5 numbers scale primitive bleeds by px / 1.5 (was clamp(v,0,1))", () => {
    const plan = computeTextureAtlasPlan(SEAM_RECT, 0, { seamBleed: 0.5, seamEdges });
    expect(plan?.seamBleedEdgeAmounts?.get(1)).toBe(0.5);
    expect(plan?.bleedRatio).toBeCloseTo(0.5 / 1.5, 10);
  });

  it("scales the projective-quad guard bleed by seamBleed (was fixed 0.6)", () => {
    const full = computeTextureAtlasPlan(LONE_QUAD, 0, {});
    const none = computeTextureAtlasPlan(LONE_QUAD, 0, { seamBleed: 0 });
    expect(full?.projectiveMatrix).toBeTruthy();
    expect(none?.projectiveMatrix).toBeTruthy();
    expect(none?.projectiveMatrix).not.toEqual(full?.projectiveMatrix);
  });

  it("honors the window.__polycssProjectiveQuadGuards debug override (was ignored)", () => {
    const none = computeTextureAtlasPlan(LONE_QUAD, 0, { seamBleed: 0 });
    (window as Window & ProjectiveQuadGuardGlobal).__polycssProjectiveQuadGuards = { bleed: 0 };
    const overridden = computeTextureAtlasPlan(LONE_QUAD, 0, {});
    expect(overridden?.projectiveMatrix).toEqual(none?.projectiveMatrix);
  });
});
