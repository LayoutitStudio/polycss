/**
 * Feature tests: border-shape geometry computation
 *
 * Covers cssBorderShapeForPlan and formatBorderShapeEntryMatrix observable outputs.
 * We test through the public API surface (cssBorderShapeForPlan, computeTextureAtlasPlanPublic,
 * formatBorderShapeEntryMatrix) rather than the internal borderShapeGeometryForPlan,
 * which is not exported.
 *
 * These tests pin the CSS polygon(...) string structure and the bounding-box
 * invariants that define the <i> strategy rendering contract.
 */
import { describe, it, expect } from "vitest";
import type { Polygon } from "@layoutit/polycss-core";
import {
  cssBorderShapeForPlan,
  computeTextureAtlasPlanPublic,
  formatBorderShapeEntryMatrix,
} from "../textureAtlas";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseBorderShape(css: string): {
  polygon: Array<[number, number]>;
  innerShape: string;
} {
  // Format: "polygon(x1 y1,x2 y2,...) circle(0 [at x y])"
  const polygonMatch = css.match(/polygon\(([^)]+)\)/);
  const innerMatch = css.match(/\)\s+(circle\([^)]*\))/);
  if (!polygonMatch) throw new Error(`No polygon in: ${css}`);
  const polygon = polygonMatch[1].split(",").map((pair) => {
    const [x, y] = pair.trim().split(/\s+/).map((v) => parseFloat(v));
    return [x, y] as [number, number];
  });
  return { polygon, innerShape: innerMatch?.[1] ?? "" };
}

// ---------------------------------------------------------------------------
// Polygon fixtures
// ---------------------------------------------------------------------------

const FLAT_TRIANGLE: Polygon = {
  vertices: [[0, 0, 0], [1, 0, 0], [0, 1, 0]],
  color: "#ff0000",
};

const TRAPEZOID: Polygon = {
  vertices: [
    [0, 0, 0],
    [2, 0, 0],
    [1.5, 1, 0],
    [0.5, 1, 0],
  ],
  color: "#00ff00",
};

const PENTAGON: Polygon = {
  vertices: [
    [0, 1, 0],
    [0.951, 0.309, 0],
    [0.588, -0.809, 0],
    [-0.588, -0.809, 0],
    [-0.951, 0.309, 0],
  ],
  color: "#0000ff",
};

// ---------------------------------------------------------------------------
// Tests: polygon() output structure
// ---------------------------------------------------------------------------

describe("cssBorderShapeForPlan — border-shape string contracts", () => {
  it("output contains a polygon() followed by an inner shape (circle)", () => {
    const plan = computeTextureAtlasPlanPublic(FLAT_TRIANGLE, 0)!;
    const result = cssBorderShapeForPlan(plan);
    expect(result).toContain("polygon(");
    expect(result).toContain("circle(");
  });

  it("polygon point count matches vertex count of the polygon", () => {
    for (const [poly, count] of [[FLAT_TRIANGLE, 3], [TRAPEZOID, 4], [PENTAGON, 5]] as const) {
      const plan = computeTextureAtlasPlanPublic(poly as Polygon, 0)!;
      const result = cssBorderShapeForPlan(plan);
      const { polygon } = parseBorderShape(result);
      expect(polygon.length).toBe(count);
    }
  });

  it("all polygon percentage values are clamped to [0, 100]", () => {
    for (const poly of [FLAT_TRIANGLE, TRAPEZOID, PENTAGON]) {
      const plan = computeTextureAtlasPlanPublic(poly, 0)!;
      const result = cssBorderShapeForPlan(plan);
      const { polygon } = parseBorderShape(result);
      for (const [x, y] of polygon) {
        expect(x).toBeGreaterThanOrEqual(0);
        expect(x).toBeLessThanOrEqual(100);
        expect(y).toBeGreaterThanOrEqual(0);
        expect(y).toBeLessThanOrEqual(100);
      }
    }
  });

  it("polygon uses % units throughout", () => {
    const plan = computeTextureAtlasPlanPublic(FLAT_TRIANGLE, 0)!;
    const result = cssBorderShapeForPlan(plan);
    // All coordinate tokens in the polygon clause should end with %
    const polyMatch = result.match(/polygon\(([^)]+)\)/);
    const tokens = polyMatch![1].split(/[\s,]+/).filter(Boolean);
    for (const token of tokens) {
      expect(token).toMatch(/%$|^0$/);
    }
  });

  it("output is deterministic across repeated calls for the same plan", () => {
    const plan = computeTextureAtlasPlanPublic(FLAT_TRIANGLE, 0)!;
    expect(cssBorderShapeForPlan(plan)).toBe(cssBorderShapeForPlan(plan));
  });

  it("triangle and trapezoid produce different polygon() strings", () => {
    const triPlan = computeTextureAtlasPlanPublic(FLAT_TRIANGLE, 0)!;
    const trapPlan = computeTextureAtlasPlanPublic(TRAPEZOID, 0)!;
    expect(cssBorderShapeForPlan(triPlan)).not.toBe(cssBorderShapeForPlan(trapPlan));
  });

  it("inner shape is a circle(0 ...) collapsed hole", () => {
    const plan = computeTextureAtlasPlanPublic(FLAT_TRIANGLE, 0)!;
    const result = cssBorderShapeForPlan(plan);
    // The collapsed inner hole must be circle(0) or circle(0 at x y)
    expect(result).toMatch(/circle\(0(?:\s+at\s+[\d.]+%\s+[\d.]+%)?\)/);
  });
});

// ---------------------------------------------------------------------------
// Tests: border-shape matrix bounding box
// ---------------------------------------------------------------------------

describe("formatBorderShapeEntryMatrix — bounding box scale relationship", () => {
  it("matrix x-column magnitude grows when the polygon bounding box grows", () => {
    const narrow: Polygon = {
      vertices: [[0, 0, 0], [0.5, 0, 0], [0.5, 1, 0], [0, 1, 0]],
      color: "#aaaaaa",
    };
    const wide: Polygon = {
      vertices: [[0, 0, 0], [4, 0, 0], [4, 1, 0], [0, 1, 0]],
      color: "#aaaaaa",
    };
    const narrowPlan = computeTextureAtlasPlanPublic(narrow, 0)!;
    const widePlan = computeTextureAtlasPlanPublic(wide, 0)!;

    const xColMagnitude = (m: string) => {
      const inner = m.slice("matrix3d(".length, -1);
      const v = inner.split(",").map(Number);
      // First column of column-major matrix3d is [v[0], v[1], v[2]]
      return Math.hypot(v[0], v[1], v[2]);
    };
    const narrowScale = xColMagnitude(formatBorderShapeEntryMatrix(narrowPlan));
    const wideScale = xColMagnitude(formatBorderShapeEntryMatrix(widePlan));
    // Wider bounding box → larger x-column magnitude (more CSS-space coverage)
    expect(wideScale).toBeGreaterThan(narrowScale);
  });
});
