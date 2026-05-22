/**
 * Feature tests: border-shape geometry computation
 *
 * Covers cssBorderShapeForPlan, formatBorderShapeEntryMatrix, cssBorderShapeForGeometry,
 * formatBorderShapeElementStyle, borderShapeGeometryForPlan (via the public surface),
 * polygonContainsPoint, borderShapeBoundsFromPoints, and cornerShapeGeometryForPlan.
 *
 * These pin the CSS polygon(...) string structure and the bounding-box invariants
 * that define the <i> and corner-shape solid strategies.
 */
import { describe, it, expect } from "vitest";
import type { Polygon } from "../types";
import {
  cssBorderShapeForPlan,
  cssBorderShapeForGeometry,
  formatBorderShapeEntryMatrix,
  formatBorderShapeElementStyle,
  cornerShapeGeometryForPlan,
  borderShapeGeometryForPlan,
  borderShapeBoundsFromPoints,
  polygonContainsPoint,
  simplifyCornerShapePoints,
} from "./borderShape";
import { formatPercent } from "./matrix";
import { computeTextureAtlasPlanPublic } from "./plan";

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

// ---------------------------------------------------------------------------
// formatPercent — percentage formatting
// ---------------------------------------------------------------------------

describe("formatPercent — CSS percentage formatting", () => {
  it("formats 0 as '0' (no % suffix)", () => {
    expect(formatPercent(0)).toBe("0");
  });

  it("formats 100 as '100%'", () => {
    expect(formatPercent(100)).toBe("100%");
  });

  it("formats a fractional value with default 2 decimal places", () => {
    const result = formatPercent(33.33333);
    expect(result).toBe("33.33%");
  });

  it("respects custom decimals argument", () => {
    expect(formatPercent(33.33333, 0)).toBe("33%");
    expect(formatPercent(33.33333, 4)).toBe("33.3333%");
  });

  it("rounds half-up", () => {
    expect(formatPercent(0.005, 2)).toBe("0.01%");
  });
});

// ---------------------------------------------------------------------------
// cssBorderShapeForGeometry — polygon points → CSS border-shape string
// ---------------------------------------------------------------------------

describe("cssBorderShapeForGeometry — CSS string structure", () => {
  it("produces a polygon() + circle() pair", () => {
    const points: Array<[number, number]> = [[0, 0], [100, 0], [50, 100]];
    const result = cssBorderShapeForGeometry(points);
    expect(result).toMatch(/^polygon\(.+\) circle\(/);
  });

  it("polygon has the correct number of points", () => {
    const points: Array<[number, number]> = [[0, 0], [100, 0], [100, 100], [0, 100]];
    const result = cssBorderShapeForGeometry(points);
    const match = result.match(/polygon\(([^)]+)\)/);
    const pairCount = match![1].split(",").length;
    expect(pairCount).toBe(4);
  });

  it("circle is collapsed (circle(0) or circle(0 at ...))", () => {
    const points: Array<[number, number]> = [[0, 0], [100, 0], [50, 100]];
    const result = cssBorderShapeForGeometry(points);
    expect(result).toMatch(/circle\(0(?:\s+at\s+[\d.%]+\s+[\d.%]+)?\)/);
  });
});

// ---------------------------------------------------------------------------
// borderShapeGeometryForPlan — bounding box and percentage clamping
// ---------------------------------------------------------------------------

describe("borderShapeGeometryForPlan — geometry extraction", () => {
  it("bounds.width and bounds.height are positive for a non-degenerate plan", () => {
    const plan = computeTextureAtlasPlanPublic(FLAT_TRIANGLE, 0)!;
    const geo = borderShapeGeometryForPlan(plan);
    expect(geo.bounds.width).toBeGreaterThan(0);
    expect(geo.bounds.height).toBeGreaterThan(0);
  });

  it("all percentage point values are clamped to [0, 100]", () => {
    const plan = computeTextureAtlasPlanPublic(TRAPEZOID, 0)!;
    const geo = borderShapeGeometryForPlan(plan);
    for (const [x, y] of geo.points) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(100);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(100);
    }
  });

  it("point count matches vertex count of the polygon", () => {
    const plan = computeTextureAtlasPlanPublic(PENTAGON, 0)!;
    const geo = borderShapeGeometryForPlan(plan);
    expect(geo.points.length).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// formatBorderShapeElementStyle — combined style string
// ---------------------------------------------------------------------------

describe("formatBorderShapeElementStyle — style string format", () => {
  it("contains both 'transform' and 'border-shape' properties", () => {
    const plan = computeTextureAtlasPlanPublic(FLAT_TRIANGLE, 0)!;
    const style = formatBorderShapeElementStyle(plan);
    expect(style).toContain("transform:");
    expect(style).toContain("border-shape:");
  });

  it("transform value is a matrix3d()", () => {
    const plan = computeTextureAtlasPlanPublic(TRAPEZOID, 0)!;
    const style = formatBorderShapeElementStyle(plan);
    expect(style).toContain("matrix3d(");
  });

  it("border-shape value contains polygon() + circle()", () => {
    const plan = computeTextureAtlasPlanPublic(PENTAGON, 0)!;
    const style = formatBorderShapeElementStyle(plan);
    expect(style).toContain("polygon(");
    expect(style).toContain("circle(");
  });
});

// ---------------------------------------------------------------------------
// borderShapeBoundsFromPoints — point bounding box computation
// ---------------------------------------------------------------------------

describe("borderShapeBoundsFromPoints — bounding box from flat point array", () => {
  it("computes min/max correctly for a simple set of points", () => {
    const bounds = borderShapeBoundsFromPoints([0, 5, 10, 0, 5, 10], 1, 1);
    expect(bounds.minX).toBeCloseTo(0);
    expect(bounds.minY).toBeCloseTo(0);
    expect(bounds.width).toBeCloseTo(10);
    expect(bounds.height).toBeCloseTo(10);
  });

  it("uses fallback when input has no finite values", () => {
    const bounds = borderShapeBoundsFromPoints([], 100, 200);
    expect(bounds.width).toBe(100);
    expect(bounds.height).toBe(200);
  });

  it("uses fallback when all points are the same (zero area)", () => {
    const bounds = borderShapeBoundsFromPoints([5, 5, 5, 5, 5, 5], 100, 200);
    // width and height are 0 → degenerate → fallback
    expect(bounds.width).toBe(100);
    expect(bounds.height).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// polygonContainsPoint — point-in-polygon test
// ---------------------------------------------------------------------------

describe("polygonContainsPoint — center-of-mass containment", () => {
  const square: Array<[number, number]> = [[0, 0], [100, 0], [100, 100], [0, 100]];

  it("returns true for a point known to be inside the polygon", () => {
    expect(polygonContainsPoint(square, 50, 50)).toBe(true);
  });

  it("returns false for a point clearly outside the polygon", () => {
    expect(polygonContainsPoint(square, 200, 200)).toBe(false);
  });

  it("default center (50,50) is inside a unit square spanning 0–100", () => {
    expect(polygonContainsPoint(square)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// simplifyCornerShapePoints — deduplication
// ---------------------------------------------------------------------------

describe("simplifyCornerShapePoints — duplicate point removal", () => {
  it("removes consecutive duplicate points", () => {
    const pts: Array<[number, number]> = [[0, 0], [0, 0], [100, 0], [100, 100]];
    const result = simplifyCornerShapePoints(pts);
    expect(result.length).toBe(3);
    expect(result[0]).toEqual([0, 0]);
  });

  it("removes wrap-around duplicate (last == first)", () => {
    const pts: Array<[number, number]> = [[0, 0], [100, 0], [100, 100], [0, 0]];
    const result = simplifyCornerShapePoints(pts);
    // The last point is a near-duplicate of the first, so it should be removed
    expect(result[0]).toEqual([0, 0]);
    expect(result[result.length - 1]).not.toEqual([0, 0]);
  });

  it("passes through non-duplicate points unchanged", () => {
    const pts: Array<[number, number]> = [[0, 0], [50, 0], [100, 100]];
    const result = simplifyCornerShapePoints(pts);
    expect(result).toEqual(pts);
  });
});

// ---------------------------------------------------------------------------
// cornerShapeGeometryForPlan — corner-shape solid detection
// ---------------------------------------------------------------------------

describe("cornerShapeGeometryForPlan — corner-shape geometry extraction", () => {
  it("returns null for a textured polygon", () => {
    const texturedPoly: Polygon = {
      vertices: [[0, 0, 0], [1, 0, 0], [0.5, 0.5, 0], [0, 1, 0]],
      texture: "https://example.com/t.png",
      color: "#ffffff",
    };
    const plan = computeTextureAtlasPlanPublic(texturedPoly, 0)!;
    expect(cornerShapeGeometryForPlan(plan)).toBeNull();
  });

  it("returns null for a solid triangle (too few sides for corner-shape)", () => {
    const plan = computeTextureAtlasPlanPublic(FLAT_TRIANGLE, 0)!;
    expect(cornerShapeGeometryForPlan(plan)).toBeNull();
  });

  it("returns null for a full-rect quad (not a beveled corner shape)", () => {
    const rectPoly: Polygon = {
      vertices: [[0, 0, 0], [2, 0, 0], [2, 1, 0], [0, 1, 0]],
      color: "#aaaaaa",
    };
    const plan = computeTextureAtlasPlanPublic(rectPoly, 0)!;
    expect(cornerShapeGeometryForPlan(plan)).toBeNull();
  });

  it("returns null or a geometry object for a pentagon (behavior depends on geometry — just verifies no throw)", () => {
    const plan = computeTextureAtlasPlanPublic(PENTAGON, 0)!;
    // A regular pentagon may or may not match the exact corner-shape contract.
    // We assert the function returns without throwing and produces null or a valid geometry.
    const result = cornerShapeGeometryForPlan(plan);
    expect(result === null || (typeof result === "object" && result !== null)).toBe(true);
  });
});
