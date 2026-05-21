/**
 * Feature tests: matrix formatting
 *
 * Covers formatMatrix3d, formatMatrix3dValues (via the public surface),
 * formatSolidQuadEntryMatrix, formatBorderShapeEntryMatrix, and formatCssLengthPx.
 *
 * These pin observable CSS string output contracts that drift silently when
 * internal primitive-size constants change — that's the category of bug we've
 * hit repeatedly (primitive size mismatch, matrix double-wrap).
 */
import { describe, it, expect } from "vitest";
import type { Polygon } from "@layoutit/polycss-core";
import {
  formatMatrix3d,
  formatCssLengthPx,
  formatSolidQuadEntryMatrix,
  formatBorderShapeEntryMatrix,
  computeTextureAtlasPlanPublic,
} from "../textureAtlas";

// ---------------------------------------------------------------------------
// formatMatrix3d
// ---------------------------------------------------------------------------

describe("formatMatrix3d — string wrapping and rounding", () => {
  it("wraps a comma-separated value string in matrix3d(...)", () => {
    const input = "1,0,0,0,0,1,0,0,0,0,1,0,10,20,30,1";
    const result = formatMatrix3d(input);
    expect(result).toMatch(/^matrix3d\(/);
    expect(result).toMatch(/\)$/);
  });

  it("rounds values to 3 decimal places by default", () => {
    const result = formatMatrix3d("1.23456789,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1");
    expect(result).toContain("1.235");
    expect(result).not.toContain("1.23456");
  });

  it("respects a custom decimals argument", () => {
    const result = formatMatrix3d("1.23456789,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1", 6);
    expect(result).toContain("1.234568");
  });

  it("collapses negative-zero to 0", () => {
    // -0 should round to '0', not '-0'
    const result = formatMatrix3d("-0,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1");
    expect(result.startsWith("matrix3d(0,")).toBe(true);
  });

  it("identity matrix produces identity output values", () => {
    const identity = "1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1";
    const result = formatMatrix3d(identity);
    expect(result).toBe("matrix3d(1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1)");
  });

  // Document the double-wrap hazard: formatMatrix3d is not idempotent on
  // already-wrapped inputs — feeding it "matrix3d(...)" produces broken CSS.
  // This test intentionally pins that behavior so callers know not to use it
  // on pre-wrapped strings.
  it("produces invalid CSS when given an already-wrapped matrix3d string (document, not a desired behavior)", () => {
    const preWrapped = "matrix3d(1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1)";
    const result = formatMatrix3d(preWrapped);
    // The pre-wrapped string contains "(" and ")" which fail to parse as numbers.
    // The result should contain "NaN" or pass the non-finite values as-is.
    // Either way it is NOT a valid matrix3d() string.
    expect(result).not.toBe("matrix3d(1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1)");
  });
});

// ---------------------------------------------------------------------------
// formatCssLengthPx
// ---------------------------------------------------------------------------

describe("formatCssLengthPx — pixel length formatting", () => {
  it("formats a positive pixel value with 'px' suffix", () => {
    expect(formatCssLengthPx(10)).toBe("10px");
    expect(formatCssLengthPx(12.5)).toBe("12.5px");
  });

  it("returns '0' (no px suffix) for zero", () => {
    expect(formatCssLengthPx(0)).toBe("0");
  });

  it("returns '0' for negative zero", () => {
    expect(formatCssLengthPx(-0)).toBe("0");
  });

  it("rounds to 4 decimal places by default", () => {
    const result = formatCssLengthPx(1.23456789);
    expect(result).toBe("1.2346px");
  });

  it("respects custom decimals", () => {
    const result = formatCssLengthPx(1.23456789, 2);
    expect(result).toBe("1.23px");
  });
});

// ---------------------------------------------------------------------------
// formatSolidQuadEntryMatrix — output contract
// ---------------------------------------------------------------------------

const FLAT_RECT: Polygon = {
  vertices: [[0, 0, 0], [2, 0, 0], [2, 1, 0], [0, 1, 0]],
  color: "#00ff00",
};

describe("formatSolidQuadEntryMatrix — canonical 64px quad wrap", () => {
  it("returns a matrix3d(...) wrapped string", () => {
    const plan = computeTextureAtlasPlanPublic(FLAT_RECT, 0)!;
    const result = formatSolidQuadEntryMatrix(plan);
    expect(result).toMatch(/^matrix3d\([^)]+\)$/);
  });

  it("the output is NOT double-wrapped (no nested matrix3d)", () => {
    const plan = computeTextureAtlasPlanPublic(FLAT_RECT, 0)!;
    const result = formatSolidQuadEntryMatrix(plan);
    // Should not contain matrix3d inside matrix3d
    const inner = result.replace(/^matrix3d\(/, "").replace(/\)$/, "");
    expect(inner).not.toContain("matrix3d");
  });

  it("contains exactly 16 comma-separated numeric values", () => {
    const plan = computeTextureAtlasPlanPublic(FLAT_RECT, 0)!;
    const result = formatSolidQuadEntryMatrix(plan);
    const inner = result.slice("matrix3d(".length, -1);
    const values = inner.split(",").map(Number);
    expect(values.length).toBe(16);
    expect(values.every(Number.isFinite)).toBe(true);
  });

  it("output is deterministic across repeated calls on the same plan", () => {
    const plan = computeTextureAtlasPlanPublic(FLAT_RECT, 0)!;
    expect(formatSolidQuadEntryMatrix(plan)).toBe(formatSolidQuadEntryMatrix(plan));
  });
});

// ---------------------------------------------------------------------------
// formatBorderShapeEntryMatrix — canonical 16px border-shape wrap
// ---------------------------------------------------------------------------

const NON_RECT_POLYGON: Polygon = {
  vertices: [
    [0, 0, 0],
    [1, 0, 0],
    [0.8, 1, 0],
    [0.2, 1, 0],
  ],
  color: "#0000ff",
};

describe("formatBorderShapeEntryMatrix — canonical 16px border-shape wrap", () => {
  it("returns a matrix3d(...) wrapped string", () => {
    const plan = computeTextureAtlasPlanPublic(NON_RECT_POLYGON, 0)!;
    const result = formatBorderShapeEntryMatrix(plan);
    expect(result).toMatch(/^matrix3d\([^)]+\)$/);
  });

  it("the output is NOT double-wrapped", () => {
    const plan = computeTextureAtlasPlanPublic(NON_RECT_POLYGON, 0)!;
    const result = formatBorderShapeEntryMatrix(plan);
    const inner = result.replace(/^matrix3d\(/, "").replace(/\)$/, "");
    expect(inner).not.toContain("matrix3d");
  });

  it("contains exactly 16 comma-separated numeric values", () => {
    const plan = computeTextureAtlasPlanPublic(NON_RECT_POLYGON, 0)!;
    const result = formatBorderShapeEntryMatrix(plan);
    const inner = result.slice("matrix3d(".length, -1);
    const values = inner.split(",").map(Number);
    expect(values.length).toBe(16);
    expect(values.every(Number.isFinite)).toBe(true);
  });

  it("solid-quad and border-shape matrices differ due to different canonical sizes (64px vs 16px)", () => {
    const plan = computeTextureAtlasPlanPublic(NON_RECT_POLYGON, 0)!;
    const quadMatrix = formatSolidQuadEntryMatrix(plan);
    const borderMatrix = formatBorderShapeEntryMatrix(plan);
    // Border-shape canonical size is 16, solid-quad is 64 — scale differs by 4x
    expect(quadMatrix).not.toBe(borderMatrix);
  });
});
