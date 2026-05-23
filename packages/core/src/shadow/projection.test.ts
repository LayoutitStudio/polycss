import { describe, it, expect } from "vitest";
import {
  BAKED_SHADOW_MIN_UP,
  BAKED_SHADOW_Z_SQUASH,
  buildBakedShadowProjectionMatrix,
  isBakedShadowCaster,
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
