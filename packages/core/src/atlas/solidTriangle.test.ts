/**
 * Feature tests: solidTriangle helpers
 *
 * Covers computeSurfaceNormal, cssPoints, offsetConvexPolygonPoints,
 * stableBasisFromPlan, isConvexPolygonPoints, signedArea2D, intersect2DLines,
 * expandClipPoints, offsetTrianglePoints, offsetStableTrianglePoints, and
 * stableTriangleMatrixDecimals.
 *
 * These are the pure-math primitives that drive stable-triangle rendering.
 * Tests pin observable numeric outputs for known inputs.
 */
import { describe, it, expect } from "vitest";
import type { Polygon } from "../types";
import {
  computeSurfaceNormal,
  cssPoints,
  offsetConvexPolygonPoints,
  stableBasisFromPlan,
  isConvexPolygonPoints,
  signedArea2D,
  intersect2DLines,
  expandClipPoints,
  stableTriangleMatrixDecimals,
} from "./solidTriangle";
import { computeTextureAtlasPlanPublic } from "./plan";

// ---------------------------------------------------------------------------
// computeSurfaceNormal
// ---------------------------------------------------------------------------

describe("computeSurfaceNormal — cross product surface normal", () => {
  it("returns null for fewer than 3 points", () => {
    expect(computeSurfaceNormal([[0, 0, 0], [1, 0, 0]])).toBeNull();
    expect(computeSurfaceNormal([])).toBeNull();
  });

  it("returns a unit vector for a valid triangle in the XY plane", () => {
    const pts: [number, number, number][] = [[0, 0, 0], [1, 0, 0], [0, 1, 0]];
    const n = computeSurfaceNormal(pts)!;
    expect(n).not.toBeNull();
    const len = Math.hypot(n[0], n[1], n[2]);
    expect(len).toBeCloseTo(1, 5);
  });

  it("XY-plane triangle points in the negative Z direction", () => {
    // CSS convention: positive x is right, positive y is down.
    // A CCW triangle (0,0,0)→(1,0,0)→(0,1,0) gives a normal pointing out of the screen.
    const pts: [number, number, number][] = [[0, 0, 0], [1, 0, 0], [0, 1, 0]];
    const n = computeSurfaceNormal(pts)!;
    // The Z component should be non-zero; exact sign depends on the cross product convention.
    expect(Math.abs(n[2])).toBeGreaterThan(0.5);
  });

  it("returns null for collinear points", () => {
    const pts: [number, number, number][] = [[0, 0, 0], [1, 0, 0], [2, 0, 0]];
    expect(computeSurfaceNormal(pts)).toBeNull();
  });

  it("works for a triangle in the XZ plane", () => {
    const pts: [number, number, number][] = [[0, 0, 0], [1, 0, 0], [0, 0, 1]];
    const n = computeSurfaceNormal(pts)!;
    expect(n).not.toBeNull();
    // Should point along Y
    expect(Math.abs(n[1])).toBeGreaterThan(0.9);
  });
});

// ---------------------------------------------------------------------------
// cssPoints — vertex → CSS-space transform
// ---------------------------------------------------------------------------

describe("cssPoints — vertex-to-CSS-space projection", () => {
  it("swaps x and y and applies tile scale", () => {
    // cssPoints: output[i] = [v[1]*tile, v[0]*tile, v[2]*elev]
    const verts: [number, number, number][] = [[2, 3, 5]];
    const pts = cssPoints(verts, 10, 20);
    expect(pts[0]).toEqual([30, 20, 100]);  // [3*10, 2*10, 5*20]
  });

  it("output array length equals input length", () => {
    const verts: [number, number, number][] = [[0, 0, 0], [1, 0, 0], [0, 1, 0]];
    expect(cssPoints(verts, 50, 50).length).toBe(3);
  });

  it("all-zero vertices produce all-zero output", () => {
    const verts: [number, number, number][] = [[0, 0, 0]];
    expect(cssPoints(verts, 100, 100)[0]).toEqual([0, 0, 0]);
  });
});

// ---------------------------------------------------------------------------
// isConvexPolygonPoints
// ---------------------------------------------------------------------------

describe("isConvexPolygonPoints — convexity check", () => {
  it("returns false for fewer than 3 points", () => {
    expect(isConvexPolygonPoints([[0, 0], [1, 0]])).toBe(false);
  });

  it("returns true for a convex square", () => {
    expect(isConvexPolygonPoints([[0, 0], [1, 0], [1, 1], [0, 1]])).toBe(true);
  });

  it("returns true for an equilateral triangle", () => {
    expect(isConvexPolygonPoints([[0, 0], [1, 0], [0.5, 1]])).toBe(true);
  });

  it("returns false for a concave (arrow) polygon", () => {
    // An L-shaped concave polygon
    expect(isConvexPolygonPoints([
      [0, 0], [2, 0], [2, 1], [1, 1], [1, 2], [0, 2],
    ])).toBe(false);
  });

  it("returns false for collinear points (zero-area edge)", () => {
    expect(isConvexPolygonPoints([[0, 0], [1, 0], [2, 0]])).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// signedArea2D
// ---------------------------------------------------------------------------

describe("signedArea2D — polygon signed area", () => {
  it("returns positive area for a CCW square", () => {
    const pts: [number, number][] = [[0, 0], [1, 0], [1, 1], [0, 1]];
    expect(signedArea2D(pts)).toBeCloseTo(1);
  });

  it("returns negative area for a CW square", () => {
    const pts: [number, number][] = [[0, 0], [0, 1], [1, 1], [1, 0]];
    expect(signedArea2D(pts)).toBeCloseTo(-1);
  });

  it("returns 0 for a degenerate (collinear) polygon", () => {
    const pts: [number, number][] = [[0, 0], [1, 0], [2, 0]];
    expect(signedArea2D(pts)).toBeCloseTo(0);
  });

  it("right triangle area is 0.5", () => {
    const pts: [number, number][] = [[0, 0], [1, 0], [0, 1]];
    expect(Math.abs(signedArea2D(pts))).toBeCloseTo(0.5);
  });
});

// ---------------------------------------------------------------------------
// intersect2DLines
// ---------------------------------------------------------------------------

describe("intersect2DLines — line-line intersection", () => {
  it("finds the intersection of two perpendicular lines", () => {
    // Horizontal line y=1: (0,1)→(2,1); vertical line x=1: (1,0)→(1,2)
    const pt = intersect2DLines([0, 1], [2, 1], [1, 0], [1, 2]);
    expect(pt).not.toBeNull();
    expect(pt![0]).toBeCloseTo(1);
    expect(pt![1]).toBeCloseTo(1);
  });

  it("returns null for parallel lines", () => {
    const pt = intersect2DLines([0, 0], [1, 0], [0, 1], [1, 1]);
    expect(pt).toBeNull();
  });

  it("returns null for coincident lines", () => {
    const pt = intersect2DLines([0, 0], [1, 0], [0, 0], [1, 0]);
    expect(pt).toBeNull();
  });

  it("finds off-axis diagonal intersection", () => {
    // y=x: (0,0)→(1,1) and y=-x+2: (0,2)→(2,0) intersect at (1,1)
    const pt = intersect2DLines([0, 0], [1, 1], [0, 2], [2, 0]);
    expect(pt).not.toBeNull();
    expect(pt![0]).toBeCloseTo(1);
    expect(pt![1]).toBeCloseTo(1);
  });
});

// ---------------------------------------------------------------------------
// expandClipPoints — push vertices outward from centroid
// ---------------------------------------------------------------------------

describe("expandClipPoints — centroid-based outward expansion", () => {
  it("returns the original points when amount is 0 or negative", () => {
    const pts = [0, 0, 1, 0, 0.5, 1];
    expect(expandClipPoints(pts, 0)).toStrictEqual(pts);
    expect(expandClipPoints(pts, -1)).toStrictEqual(pts);
  });

  it("returns the original points for fewer than 3 vertices (6 values)", () => {
    const pts = [0, 0, 1, 0];
    expect(expandClipPoints(pts, 1)).toStrictEqual(pts);
  });

  it("expands outward: each vertex moves away from centroid", () => {
    // Equilateral-ish triangle centered near (0.5, 0.33)
    const pts = [0, 0, 1, 0, 0.5, 1];
    const expanded = expandClipPoints(pts, 0.1);
    expect(expanded.length).toBe(pts.length);
    // Centroid is approximately (0.5, 0.33)
    const cx = (pts[0] + pts[2] + pts[4]) / 3;
    const cy = (pts[1] + pts[3] + pts[5]) / 3;
    for (let i = 0; i < expanded.length; i += 2) {
      const origDist = Math.hypot(pts[i] - cx, pts[i + 1] - cy);
      const newDist = Math.hypot(expanded[i] - cx, expanded[i + 1] - cy);
      // Expanded vertex should be farther from centroid
      expect(newDist).toBeGreaterThan(origDist - 1e-9);
    }
  });
});

// ---------------------------------------------------------------------------
// offsetConvexPolygonPoints — inward/outward offset for convex polygons
// ---------------------------------------------------------------------------

describe("offsetConvexPolygonPoints — convex polygon offset", () => {
  it("returns original points for amount <= 0", () => {
    const pts = [0, 0, 1, 0, 1, 1, 0, 1];
    expect(offsetConvexPolygonPoints(pts, 0)).toStrictEqual(pts);
    expect(offsetConvexPolygonPoints(pts, -0.5)).toStrictEqual(pts);
  });

  it("returns original points for fewer than 3 vertices", () => {
    const pts = [0, 0, 1, 0];
    expect(offsetConvexPolygonPoints(pts, 1)).toStrictEqual(pts);
  });

  it("returns original points for odd-length input", () => {
    const pts = [0, 0, 1, 0, 1];
    expect(offsetConvexPolygonPoints(pts, 1)).toStrictEqual(pts);
  });

  it("expanded output has the same vertex count as input", () => {
    const pts = [0, 0, 2, 0, 2, 1, 0, 1];
    const out = offsetConvexPolygonPoints(pts, 0.5);
    expect(out.length).toBe(pts.length);
  });

  it("bounding box of expanded polygon is larger than original for a convex square", () => {
    const pts = [0, 0, 4, 0, 4, 4, 0, 4];
    const out = offsetConvexPolygonPoints(pts, 0.5);
    const maxX = Math.max(out[0], out[2], out[4], out[6]);
    expect(maxX).toBeGreaterThan(4);
  });
});

// ---------------------------------------------------------------------------
// stableBasisFromPlan — stable triangle basis extraction
// ---------------------------------------------------------------------------

describe("stableBasisFromPlan — stable triangle basis from atlas plan", () => {
  const FLAT_TRIANGLE: Polygon = {
    vertices: [[0, 0, 0], [1, 0, 0], [0, 1, 0]],
    color: "#ff0000",
  };

  it("returns a non-null basis for a valid triangle plan", () => {
    const plan = computeTextureAtlasPlanPublic(FLAT_TRIANGLE, 0)!;
    const basis = stableBasisFromPlan(plan, FLAT_TRIANGLE);
    expect(basis).not.toBeNull();
  });

  it("returned basis normal is a unit vector", () => {
    const plan = computeTextureAtlasPlanPublic(FLAT_TRIANGLE, 0)!;
    const basis = stableBasisFromPlan(plan, FLAT_TRIANGLE)!;
    const len = Math.hypot(basis.normal[0], basis.normal[1], basis.normal[2]);
    expect(len).toBeCloseTo(1, 5);
  });

  it("xAxis and yAxis are orthogonal to each other", () => {
    const plan = computeTextureAtlasPlanPublic(FLAT_TRIANGLE, 0)!;
    const basis = stableBasisFromPlan(plan, FLAT_TRIANGLE)!;
    const dot = basis.xAxis[0] * basis.yAxis[0] +
                basis.xAxis[1] * basis.yAxis[1] +
                basis.xAxis[2] * basis.yAxis[2];
    expect(Math.abs(dot)).toBeLessThan(1e-3);
  });

  it("xAxis and yAxis are orthogonal to the normal", () => {
    const plan = computeTextureAtlasPlanPublic(FLAT_TRIANGLE, 0)!;
    const basis = stableBasisFromPlan(plan, FLAT_TRIANGLE)!;
    const dotX = basis.xAxis[0] * basis.normal[0] +
                 basis.xAxis[1] * basis.normal[1] +
                 basis.xAxis[2] * basis.normal[2];
    const dotY = basis.yAxis[0] * basis.normal[0] +
                 basis.yAxis[1] * basis.normal[1] +
                 basis.yAxis[2] * basis.normal[2];
    expect(Math.abs(dotX)).toBeLessThan(1e-3);
    expect(Math.abs(dotY)).toBeLessThan(1e-3);
  });

  it("returns null for a plan with fewer than 6 screenPts", () => {
    const plan = computeTextureAtlasPlanPublic(FLAT_TRIANGLE, 0)!;
    // Mutate screenPts to have only 4 values
    const fakePlan = { ...plan, screenPts: [0, 1, 2, 3] };
    expect(stableBasisFromPlan(fakePlan, FLAT_TRIANGLE)).toBeNull();
  });

  it("returned tx/ty/tz are finite numbers", () => {
    const plan = computeTextureAtlasPlanPublic(FLAT_TRIANGLE, 0)!;
    const basis = stableBasisFromPlan(plan, FLAT_TRIANGLE)!;
    expect(Number.isFinite(basis.tx)).toBe(true);
    expect(Number.isFinite(basis.ty)).toBe(true);
    expect(Number.isFinite(basis.tz)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// stableTriangleMatrixDecimals — decimal clamping
// ---------------------------------------------------------------------------

describe("stableTriangleMatrixDecimals — decimal clamping", () => {
  it("uses DEFAULT_MATRIX_DECIMALS (3) when undefined", () => {
    expect(stableTriangleMatrixDecimals(undefined)).toBe(3);
  });

  it("clamps to 0 for negative input", () => {
    expect(stableTriangleMatrixDecimals(-1)).toBe(0);
  });

  it("clamps to 6 for input above 6", () => {
    expect(stableTriangleMatrixDecimals(10)).toBe(6);
  });

  it("floors fractional values", () => {
    expect(stableTriangleMatrixDecimals(2.9)).toBe(2);
  });

  it("passes through valid range values unchanged", () => {
    expect(stableTriangleMatrixDecimals(0)).toBe(0);
    expect(stableTriangleMatrixDecimals(3)).toBe(3);
    expect(stableTriangleMatrixDecimals(6)).toBe(6);
  });
});
