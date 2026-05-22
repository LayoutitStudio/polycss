/**
 * Feature tests: getSolidPaintDefaultsFromPlans wrapper (React atlasBrowser copy)
 *
 * Mirrors polycss's solidPaintDefaults.test.ts.
 * Imports from the React-local copy so drift surfaces immediately.
 */
import { describe, it, expect } from "vitest";
import type { Polygon } from "@layoutit/polycss-core";
import { computeTextureAtlasPlanPublic } from "@layoutit/polycss-core";
import { getSolidPaintDefaultsFromPlans } from "./detection";

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
