import { describe, it, expect } from "vitest";
import {
  BAKED_SHADOW_MIN_UP,
  BAKED_SHADOW_Z_SQUASH,
  buildBakedShadowProjectionMatrix,
  ensureCcw2D,
  isBakedShadowCaster,
  isPointShadowCaster,
  polygonSignedArea2D,
  projectCssVertexToGround,
  projectCssVertexToGroundFromPoint,
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

describe("projectCssVertexToGroundFromPoint", () => {
  it("projects radially: a point halfway between light and ground doubles its offset", () => {
    // Light directly above origin at z=100; vertex at (10,0,50) sits halfway
    // down. The shadow ray from (0,0,100) through (10,0,50) hits z=0 at
    // x=20 (similar triangles: 10 grows to 20 as height halves to zero).
    const p = projectCssVertexToGroundFromPoint([10, 0, 50], [0, 0, 100], 0);
    expect(p).not.toBeNull();
    expect(p![0]).toBeCloseTo(20, 6);
    expect(p![1]).toBeCloseTo(0, 6);
  });

  it("returns the vertex XY when the vertex sits on the ground plane", () => {
    const p = projectCssVertexToGroundFromPoint([10, 20, 0], [0, 0, 100], 0);
    expect(p).not.toBeNull();
    expect(p![0]).toBeCloseTo(10, 6);
    expect(p![1]).toBeCloseTo(20, 6);
  });

  it("returns null when the vertex is above the light (no forward intersection)", () => {
    // Light at z=10, vertex at z=50 → ground (z=0) is on the light's side.
    expect(projectCssVertexToGroundFromPoint([5, 5, 50], [0, 0, 10], 0)).toBeNull();
  });

  it("returns null when the shadow ray runs parallel to the ground", () => {
    expect(projectCssVertexToGroundFromPoint([5, 5, 50], [0, 0, 50], 0)).toBeNull();
  });
});

describe("isPointShadowCaster", () => {
  it("is true when the face normal points away from the light", () => {
    // Light above at z=100; face centroid below it with normal pointing down
    // (away from the light) → casts.
    expect(isPointShadowCaster([0, 0, 0], [0, 0, -1], [0, 0, 100])).toBe(true);
  });

  it("is false when the face normal points toward the light", () => {
    expect(isPointShadowCaster([0, 0, 0], [0, 0, 1], [0, 0, 100])).toBe(false);
  });
});

describe("polygonSignedArea2D", () => {
  it("returns +1 for a unit square in CCW order", () => {
    expect(polygonSignedArea2D([[0, 0], [1, 0], [1, 1], [0, 1]])).toBeCloseTo(1, 9);
  });

  it("returns -1 for a unit square in CW order", () => {
    expect(polygonSignedArea2D([[0, 0], [0, 1], [1, 1], [1, 0]])).toBeCloseTo(-1, 9);
  });

  it("returns 0.5 for the standard CCW right triangle", () => {
    expect(polygonSignedArea2D([[0, 0], [1, 0], [0, 1]])).toBeCloseTo(0.5, 9);
  });
});

describe("ensureCcw2D", () => {
  it("leaves CCW input unchanged", () => {
    const input: Array<[number, number]> = [[0, 0], [1, 0], [1, 1], [0, 1]];
    expect(ensureCcw2D(input)).toEqual(input);
  });

  it("reverses CW input to CCW", () => {
    const input: Array<[number, number]> = [[0, 0], [0, 1], [1, 1], [1, 0]];
    const out = ensureCcw2D(input);
    expect(polygonSignedArea2D(out)).toBeGreaterThan(0);
    expect(out).toEqual([[1, 0], [1, 1], [0, 1], [0, 0]]);
  });

  it("does not mutate input", () => {
    const input: Array<[number, number]> = [[0, 0], [0, 1], [1, 1], [1, 0]];
    const snap = JSON.stringify(input);
    ensureCcw2D(input);
    expect(JSON.stringify(input)).toBe(snap);
  });
});
