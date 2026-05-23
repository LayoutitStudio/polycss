import { describe, it, expect } from "vitest";
import {
  BAKED_SHADOW_MIN_UP,
  BAKED_SHADOW_Z_SQUASH,
  buildBakedShadowProjectionMatrix,
  convexHull2D,
  isBakedShadowCaster,
  projectCssVertexToGround,
} from "./projection";

describe("buildBakedShadowProjectionMatrix", () => {
  it("produces the identity transform for axis-aligned top-down light at ground=0", () => {
    const m = buildBakedShadowProjectionMatrix([0, 0, -1], 0);
    // col1 = [1,0,0,0], col2 = [0,1,0,0]
    expect(m.slice(0, 4)).toEqual([1, 0, 0, 0]);
    expect(m.slice(4, 8)).toEqual([0, 1, 0, 0]);
    // -lx/lz = 0/-1 = 0, -ly/lz = 0/-1 = 0
    expect(m[8]).toBeCloseTo(0, 6);
    expect(m[9]).toBeCloseTo(0, 6);
    expect(m[10]).toBeCloseTo(BAKED_SHADOW_Z_SQUASH, 6);
    expect(m[11]).toBe(0);
    // Ground = 0: col4 = [0, 0, 0, 1]
    expect(m[12]).toBeCloseTo(0, 6);
    expect(m[13]).toBeCloseTo(0, 6);
    expect(m[14]).toBeCloseTo(0, 6);
    expect(m[15]).toBe(1);
  });

  it("offsets translation by groundCssZ", () => {
    const m = buildBakedShadowProjectionMatrix([0, 0, -1], 100);
    // With lx=ly=0, the only G-dependent entry left is m[14] = G*(1-Z)
    expect(m[14]).toBeCloseTo(100 * (1 - BAKED_SHADOW_Z_SQUASH), 6);
  });

  it("encodes the shear from an oblique light direction", () => {
    const m = buildBakedShadowProjectionMatrix([1, 0, -1], 0);
    // After normalize: lx ≈ 0.7071, ly = 0, lz ≈ -0.7071
    // -lx/lz = -(0.7071)/(-0.7071) = +1
    expect(m[8]).toBeCloseTo(1, 5);
    expect(m[9]).toBeCloseTo(0, 5);
  });

  it("clamps near-horizontal light up-axis to BAKED_SHADOW_MIN_UP", () => {
    // lz = -0.0001 should be clamped to -BAKED_SHADOW_MIN_UP
    const m = buildBakedShadowProjectionMatrix([0, 0, -0.0001], 0);
    // The unnormalized direction [0,0,-0.0001] normalizes to [0,0,-1] (len 0.0001 > 0)
    // So lz_normalized = -1, no clamp needed in this case.
    // Use a tilted near-horizontal vector instead to actually exercise the clamp:
    const m2 = buildBakedShadowProjectionMatrix([1, 0, -0.001], 0);
    // After normalize lz ≈ -0.001 / 1.0000005 ≈ -0.001 → clamped to -0.01
    // -lx/lz with lx≈1, lz=-0.01 → +100
    expect(Math.abs(m2[8])).toBeLessThanOrEqual(100 + 1e-3);
    expect(Math.abs(m2[8])).toBeGreaterThan(10);
    // Use the public min directly to make the expectation obvious.
    expect(BAKED_SHADOW_MIN_UP).toBe(0.01);
    // Also exercise the variable so the unused-import linter is happy in
    // a separate assertion path.
    expect(m[10]).toBeCloseTo(BAKED_SHADOW_Z_SQUASH, 6);
  });
});

describe("isBakedShadowCaster", () => {
  it("returns true for polygons whose normal points along the light direction (far side)", () => {
    // Top-down light, bottom face of a cube (normal pointing down) → silhouette
    expect(isBakedShadowCaster([0, 0, -1], [0, 0, -1])).toBe(true);
  });

  it("returns false for polygons whose normal opposes the light direction (lit side)", () => {
    // Top-down light, top face of a cube (normal pointing up) → lit, not a caster
    expect(isBakedShadowCaster([0, 0, 1], [0, 0, -1])).toBe(false);
  });

  it("returns false for polygons whose normal is perpendicular to the light", () => {
    // Vertical wall under a top-down light: doesn't add to the silhouette
    expect(isBakedShadowCaster([1, 0, 0], [0, 0, -1])).toBe(false);
  });

  it("handles oblique lights", () => {
    // Light going down-and-right; a face whose normal also points down-and-right is a caster
    expect(isBakedShadowCaster([1, 0, -1], [1, 0, -1])).toBe(true);
    // Opposite normal → not a caster
    expect(isBakedShadowCaster([-1, 0, 1], [1, 0, -1])).toBe(false);
  });

  it("is robust to an un-normalized light direction", () => {
    expect(isBakedShadowCaster([0, 0, -1], [0, 0, -10])).toBe(true);
  });
});

describe("projectCssVertexToGround", () => {
  it("returns the vertex's own XY when it sits on the ground plane", () => {
    const [x, y] = projectCssVertexToGround([10, 20, 50], [0, 0, 1], 50);
    expect(x).toBeCloseTo(10, 6);
    expect(y).toBeCloseTo(20, 6);
  });

  it("returns the vertex's own XY for a straight top-down light regardless of height", () => {
    // Light TO-source = [0, 0, 1] (sun directly overhead) → no shear; the
    // shadow of any point lands directly below it on the ground.
    const [x, y] = projectCssVertexToGround([10, 20, 150], [0, 0, 1], 0);
    expect(x).toBeCloseTo(10, 6);
    expect(y).toBeCloseTo(20, 6);
  });

  it("shears the XY proportionally to height above ground for oblique lights", () => {
    // Light TO-source = [1, 0, 1] (up-right). For a point at height H above
    // the ground, the shadow lands at x - H (because lx/lz = 1) and y unchanged.
    const [x, y] = projectCssVertexToGround([100, 50, 25], [1, 0, 1], 0);
    expect(x).toBeCloseTo(75, 6); // 100 - 25*(1/1)
    expect(y).toBeCloseTo(50, 6);
  });

  it("clamps near-horizontal light's up-axis to BAKED_SHADOW_MIN_UP", () => {
    // Very near-horizontal light: lz ≈ 0.001 → clamped to 0.01. For a point
    // 25 above ground, x-shear is 25 * (1 / 0.01) = 2500. With clamp this is
    // bounded; without it the projection would shoot to infinity.
    const [x] = projectCssVertexToGround([100, 0, 25], [1, 0, 0.001], 0);
    expect(Math.abs(x - 100)).toBeLessThanOrEqual(25 / BAKED_SHADOW_MIN_UP + 1);
    expect(Math.abs(x - 100)).toBeGreaterThan(100);
  });
});

describe("convexHull2D", () => {
  it("returns input unchanged for ≤ 1 points", () => {
    expect(convexHull2D([])).toEqual([]);
    expect(convexHull2D([[5, 7]])).toEqual([[5, 7]]);
  });

  it("returns the unit square's 4 corners for a dense interior cloud", () => {
    const pts: Array<[number, number]> = [
      [0, 0], [1, 0], [1, 1], [0, 1],
      [0.5, 0.5], [0.25, 0.75], [0.8, 0.2], [0.3, 0.3],
    ];
    const hull = convexHull2D(pts);
    expect(hull.length).toBe(4);
    // Must contain all 4 corners (in some CCW rotation).
    const set = new Set(hull.map((p) => p.join(",")));
    expect(set.has("0,0")).toBe(true);
    expect(set.has("1,0")).toBe(true);
    expect(set.has("1,1")).toBe(true);
    expect(set.has("0,1")).toBe(true);
  });

  it("drops collinear-edge points", () => {
    // Square with an extra collinear point on the bottom edge. The hull
    // should still be the 4 corners.
    const hull = convexHull2D([[0, 0], [0.5, 0], [1, 0], [1, 1], [0, 1]]);
    expect(hull.length).toBe(4);
    const set = new Set(hull.map((p) => p.join(",")));
    expect(set.has("0.5,0")).toBe(false);
  });

  it("handles a tilted parallelogram", () => {
    // The convex hull of a sheared square (typical baked-shadow output)
    // should still be 4 corners.
    const hull = convexHull2D([[0, 0], [10, 5], [12, 9], [2, 4]]);
    expect(hull.length).toBe(4);
  });

  it("returns the vertices CCW", () => {
    const hull = convexHull2D([[0, 0], [1, 0], [1, 1], [0, 1]]);
    // Sum of signed cross products of consecutive edges → positive for CCW.
    let signedArea = 0;
    for (let i = 0; i < hull.length; i++) {
      const a = hull[i]!;
      const b = hull[(i + 1) % hull.length]!;
      signedArea += a[0] * b[1] - b[0] * a[1];
    }
    expect(signedArea).toBeGreaterThan(0);
  });
});
