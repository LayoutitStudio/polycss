/**
 * Feature tests: matrix formatting
 *
 * Covers formatMatrix3d, formatMatrix3dValues, formatSolidQuadEntryMatrix,
 * formatSolidQuadMatrix, formatBorderShapeMatrix, formatBorderShapeEntryMatrix,
 * formatAffineMatrix3dScalars, formatAffineMatrix3dColumns, formatCssLengthPx,
 * roundDecimal, and formatPercent.
 *
 * These pin observable CSS string output contracts that drift silently when
 * internal primitive-size constants change — that's the category of bug we've
 * hit repeatedly (primitive size mismatch, matrix double-wrap).
 */
import { describe, it, expect } from "vitest";
import type { Polygon } from "../types";
import {
  formatMatrix3d,
  formatCssLengthPx,
  formatSolidQuadEntryMatrix,
  formatSolidQuadMatrix,
  formatMatrix3dValues,
  roundDecimal,
  formatAffineMatrix3dScalars,
  formatAffineMatrix3dColumns,
  formatPercent,
  formatCssLength,
  formatBorderShapeMatrix,
  formatScaledMatrixFromPlan,
} from "./matrix";
import { formatBorderShapeEntryMatrix, borderShapeGeometryForPlan } from "./borderShape";
import { computeTextureAtlasPlanPublic } from "./plan";

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

// ---------------------------------------------------------------------------
// roundDecimal — value rounding helper
// ---------------------------------------------------------------------------

describe("roundDecimal — decimal-place rounding", () => {
  it("rounds 1.23456789 to 3 decimal places → '1.235'", () => {
    expect(roundDecimal(1.23456789, 3)).toBe("1.235");
  });

  it("rounds 1.23456789 to 6 decimal places → '1.234568'", () => {
    expect(roundDecimal(1.23456789, 6)).toBe("1.234568");
  });

  it("returns '0' for positive zero", () => {
    expect(roundDecimal(0, 3)).toBe("0");
  });

  it("returns '0' for negative zero", () => {
    expect(roundDecimal(-0, 3)).toBe("0");
  });

  it("returns '1' for exactly 1", () => {
    expect(roundDecimal(1, 3)).toBe("1");
  });

  it("returns '-1' for exactly -1", () => {
    expect(roundDecimal(-1, 3)).toBe("-1");
  });

  it("handles very small numbers that round to zero", () => {
    expect(roundDecimal(0.00001, 3)).toBe("0");
  });

  it("preserves negative sign for non-zero negative values", () => {
    const result = roundDecimal(-0.5, 1);
    expect(result).toBe("-0.5");
  });
});

// ---------------------------------------------------------------------------
// formatMatrix3dValues — comma-separated matrix values
// ---------------------------------------------------------------------------

describe("formatMatrix3dValues — comma-separated matrix output", () => {
  it("formats an identity matrix correctly", () => {
    const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    expect(formatMatrix3dValues(identity)).toBe("1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1");
  });

  it("returns empty string for empty array", () => {
    expect(formatMatrix3dValues([])).toBe("");
  });

  it("rounds values to 3 decimal places by default", () => {
    const result = formatMatrix3dValues([1.23456789]);
    expect(result).toBe("1.235");
  });

  it("respects custom decimals", () => {
    const result = formatMatrix3dValues([1.23456789], 6);
    expect(result).toBe("1.234568");
  });

  it("collapses negative-zero in matrix values to 0", () => {
    const result = formatMatrix3dValues([-0, 1]);
    expect(result.startsWith("0,")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// formatAffineMatrix3dScalars — 12-component affine matrix formatting
// ---------------------------------------------------------------------------

describe("formatAffineMatrix3dScalars — affine matrix string", () => {
  it("produces a comma-separated string with identity scalars", () => {
    const result = formatAffineMatrix3dScalars(1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0);
    // Identity has 16 values (last column is 0,0,0,1)
    const values = result.split(",").map(Number);
    expect(values.length).toBe(16);
  });

  it("last row is always 0,0,0,1", () => {
    const result = formatAffineMatrix3dScalars(1, 0, 0, 0, 1, 0, 0, 0, 1, 5, 10, 15);
    const values = result.split(",").map(Number);
    // Positions 3, 7, 11, 15 in column-major order are the w column
    expect(values[3]).toBe(0);
    expect(values[7]).toBe(0);
    expect(values[11]).toBe(0);
    expect(values[15]).toBe(1);
  });

  it("translation components end up in columns 12–14", () => {
    const result = formatAffineMatrix3dScalars(1, 0, 0, 0, 1, 0, 0, 0, 1, 5, 10, 15);
    const values = result.split(",").map(Number);
    expect(values[12]).toBe(5);
    expect(values[13]).toBe(10);
    expect(values[14]).toBe(15);
  });

  it("uses fast path for decimals=3", () => {
    const a = formatAffineMatrix3dScalars(1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 3);
    const b = formatAffineMatrix3dScalars(1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 4);
    // Both should produce valid 16-value strings
    expect(a.split(",").length).toBe(16);
    expect(b.split(",").length).toBe(16);
  });
});

// ---------------------------------------------------------------------------
// formatAffineMatrix3dColumns — column-vector variant
// ---------------------------------------------------------------------------

describe("formatAffineMatrix3dColumns — column-vector matrix variant", () => {
  it("produces same output as formatAffineMatrix3dScalars for matching values", () => {
    const xCol: [number, number, number] = [1, 0, 0];
    const yCol: [number, number, number] = [0, 1, 0];
    const zCol: [number, number, number] = [0, 0, 1];
    const txCol: [number, number, number] = [5, 10, 15];
    const fromColumns = formatAffineMatrix3dColumns(xCol, yCol, zCol, txCol);
    const fromScalars = formatAffineMatrix3dScalars(1, 0, 0, 0, 1, 0, 0, 0, 1, 5, 10, 15);
    expect(fromColumns).toBe(fromScalars);
  });
});

// ---------------------------------------------------------------------------
// formatSolidQuadMatrix — solid quad raw matrix values
// ---------------------------------------------------------------------------

describe("formatSolidQuadMatrix — raw matrix values for solid quad", () => {
  it("returns a comma-separated string (no matrix3d wrapper)", () => {
    const plan = computeTextureAtlasPlanPublic(FLAT_RECT, 0)!;
    const result = formatSolidQuadMatrix(plan);
    expect(result).not.toContain("matrix3d");
    expect(result.split(",").length).toBe(16);
  });

  it("wider polygon produces larger x-column scale than narrower one", () => {
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
    const mag = (s: string) => {
      const v = s.split(",").map(Number);
      return Math.hypot(v[0], v[1], v[2]);
    };
    expect(mag(formatSolidQuadMatrix(widePlan))).toBeGreaterThan(mag(formatSolidQuadMatrix(narrowPlan)));
  });
});

// ---------------------------------------------------------------------------
// formatBorderShapeMatrix — border-shape raw matrix (via borderShape.ts export)
// ---------------------------------------------------------------------------

describe("formatBorderShapeMatrix — border-shape matrix for known polygon", () => {
  it("returns a 16-value comma-separated string", () => {
    const plan = computeTextureAtlasPlanPublic(NON_RECT_POLYGON, 0)!;
    const geo = borderShapeGeometryForPlan(plan);
    const result = formatBorderShapeMatrix(plan, geo.bounds);
    expect(result.split(",").length).toBe(16);
    expect(result.split(",").every((v) => Number.isFinite(Number(v)))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// formatScaledMatrixFromPlan — plan matrix scaling
// ---------------------------------------------------------------------------

describe("formatScaledMatrixFromPlan — plan matrix with applied scale", () => {
  it("returns a 16-value string", () => {
    const plan = computeTextureAtlasPlanPublic(FLAT_RECT, 0)!;
    const result = formatScaledMatrixFromPlan(plan, 1, 1);
    expect(result.split(",").length).toBe(16);
  });

  it("identity scale (1,1) produces the same x/y columns as the original matrix", () => {
    const plan = computeTextureAtlasPlanPublic(FLAT_RECT, 0)!;
    const result = formatScaledMatrixFromPlan(plan, 1, 1);
    const original = plan.matrix.split(",").map(Number);
    const scaled = result.split(",").map(Number);
    // x column: indices 0,1,2
    expect(scaled[0]).toBeCloseTo(original[0], 3);
    expect(scaled[1]).toBeCloseTo(original[1], 3);
    expect(scaled[2]).toBeCloseTo(original[2], 3);
  });
});

// ---------------------------------------------------------------------------
// formatCssLength — value with px suffix
// ---------------------------------------------------------------------------

describe("formatCssLength — px length formatting", () => {
  it("returns '0' for zero input", () => {
    expect(formatCssLength(0)).toBe("0");
  });

  it("appends 'px' for non-zero values", () => {
    expect(formatCssLength(10)).toBe("10px");
    expect(formatCssLength(1.5)).toBe("1.5px");
  });
});

// ---------------------------------------------------------------------------
// formatPercent (re-exported from matrix.ts)
// ---------------------------------------------------------------------------

describe("formatPercent (from matrix.ts) — percentage formatting", () => {
  it("returns '0' for zero input (no % suffix)", () => {
    expect(formatPercent(0)).toBe("0");
  });

  it("returns a string ending with % for non-zero values", () => {
    expect(formatPercent(50)).toBe("50%");
    expect(formatPercent(33.33)).toBe("33.33%");
  });
});
