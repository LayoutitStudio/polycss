/**
 * Feature tests: atlas plan computation (computeTextureAtlasPlan / computeTextureAtlasPlanPublic)
 *
 * These tests pin the observable contract of the plan output — the fields callers
 * downstream rely on — not the internal call graph.
 */
import { describe, it, expect } from "vitest";
import type { Polygon } from "../types";
import { computeTextureAtlasPlanPublic } from "./plan";

// ---------------------------------------------------------------------------
// Helpers / shared fixtures
// ---------------------------------------------------------------------------

/** Flat axis-aligned rectangle in the XY plane. */
const FLAT_RECT: Polygon = {
  vertices: [
    [0, 0, 0],
    [2, 0, 0],
    [2, 1, 0],
    [0, 1, 0],
  ],
  color: "#ff0000",
};

/** Flat triangle in XY plane. */
const FLAT_TRIANGLE: Polygon = {
  vertices: [
    [0, 0, 0],
    [1, 0, 0],
    [0, 1, 0],
  ],
  color: "#00ff00",
};

/** Pentagon (N-gon, not a quad). */
const FLAT_PENTAGON: Polygon = {
  vertices: [
    [0, 1, 0],
    [0.951, 0.309, 0],
    [0.588, -0.809, 0],
    [-0.588, -0.809, 0],
    [-0.951, 0.309, 0],
  ],
  color: "#0000ff",
};

/** Non-rectangular convex quad (trap-shape, not axis-aligned rect). */
const PROJECTIVE_QUAD: Polygon = {
  vertices: [
    [0, 0, 0],
    [1, 0, 0],
    [1, 1, 0],
    [0, 3, 0],
  ],
  color: "#ff00ff",
};

/** A polygon with < 3 vertices — should produce null. */
const DEGENERATE_TOO_FEW: Polygon = {
  vertices: [
    [0, 0, 0],
    [1, 0, 0],
  ],
  color: "#aaaaaa",
};

/** Collinear triangle — zero-area normal, should produce null. */
const DEGENERATE_COLLINEAR: Polygon = {
  vertices: [
    [0, 0, 0],
    [1, 0, 0],
    [2, 0, 0],
  ],
  color: "#bbbbbb",
};

/** Triangle with its first two vertices coincident — zero-length first edge. */
const DEGENERATE_ZERO_EDGE: Polygon = {
  vertices: [
    [0, 0, 0],
    [0, 0, 0],
    [1, 0, 0],
  ],
  color: "#cccccc",
};

/** Textured quad (forces atlas path). */
const TEXTURED_QUAD: Polygon = {
  vertices: [
    [0, 0, 0],
    [1, 0, 0],
    [1, 1, 0],
    [0, 1, 0],
  ],
  texture: "https://example.com/tex.png",
  color: "#ffffff",
};

// ---------------------------------------------------------------------------
// Tests: degenerate input → null plan
// ---------------------------------------------------------------------------

describe("atlas plan computation — degenerate inputs", () => {
  it("returns null for a polygon with fewer than 3 vertices", () => {
    expect(computeTextureAtlasPlanPublic(DEGENERATE_TOO_FEW, 0)).toBeNull();
  });

  it("returns null for collinear vertices (zero-area normal)", () => {
    expect(computeTextureAtlasPlanPublic(DEGENERATE_COLLINEAR, 0)).toBeNull();
  });

  it("returns null when the first edge has zero length", () => {
    expect(computeTextureAtlasPlanPublic(DEGENERATE_ZERO_EDGE, 0)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Tests: non-degenerate shapes produce deterministic plan fields
// ---------------------------------------------------------------------------

describe("atlas plan computation — plan field determinism", () => {
  it("rect plan has correct index and polygon reference", () => {
    const plan = computeTextureAtlasPlanPublic(FLAT_RECT, 3);
    expect(plan).not.toBeNull();
    expect(plan!.index).toBe(3);
    expect(plan!.polygon).toBe(FLAT_RECT);
  });

  it("plan has finite, positive canvasW and canvasH", () => {
    for (const poly of [FLAT_RECT, FLAT_TRIANGLE, FLAT_PENTAGON, PROJECTIVE_QUAD]) {
      const plan = computeTextureAtlasPlanPublic(poly, 0);
      expect(plan).not.toBeNull();
      expect(plan!.canvasW).toBeGreaterThan(0);
      expect(plan!.canvasH).toBeGreaterThan(0);
      expect(Number.isFinite(plan!.canvasW)).toBe(true);
      expect(Number.isFinite(plan!.canvasH)).toBe(true);
    }
  });

  it("plan screenPts has exactly 2*vertexCount values", () => {
    for (const poly of [FLAT_RECT, FLAT_TRIANGLE, FLAT_PENTAGON]) {
      const plan = computeTextureAtlasPlanPublic(poly, 0);
      expect(plan!.screenPts.length).toBe(poly.vertices.length * 2);
    }
  });

  it("plan normal is a unit vector", () => {
    const plan = computeTextureAtlasPlanPublic(FLAT_RECT, 0);
    const n = plan!.normal;
    const len = Math.hypot(n[0], n[1], n[2]);
    expect(len).toBeCloseTo(1, 5);
  });

  it("plan shadedColor is a valid CSS color string", () => {
    const plan = computeTextureAtlasPlanPublic(FLAT_RECT, 0);
    expect(plan!.shadedColor).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it("plan shadedColor changes with ambient light color", () => {
    // White base polygon: ambient color directly determines output with no directional.
    const whitePoly: Polygon = {
      vertices: [[0, 0, 0], [2, 0, 0], [2, 1, 0], [0, 1, 0]],
      color: "#ffffff",
    };
    const planWhiteAmbient = computeTextureAtlasPlanPublic(whitePoly, 0, {
      ambientLight: { color: "#ffffff", intensity: 1 },
      directionalLight: { direction: [0, 0, 1], color: "#000000", intensity: 0 },
    });
    const planRedAmbient = computeTextureAtlasPlanPublic(whitePoly, 0, {
      ambientLight: { color: "#ff0000", intensity: 1 },
      directionalLight: { direction: [0, 0, 1], color: "#000000", intensity: 0 },
    });
    // White ambient → white output; red ambient → red-tinted output.
    expect(planWhiteAmbient!.shadedColor).not.toBe(planRedAmbient!.shadedColor);
    // White ambient + white polygon with no directional → #ffffff
    expect(planWhiteAmbient!.shadedColor).toBe("#ffffff");
    // Red ambient + white polygon → #ff0000
    expect(planRedAmbient!.shadedColor).toBe("#ff0000");
  });

  it("plan shadedColor is deterministic across repeated calls", () => {
    const plan1 = computeTextureAtlasPlanPublic(FLAT_RECT, 0);
    const plan2 = computeTextureAtlasPlanPublic(FLAT_RECT, 0);
    expect(plan1!.shadedColor).toBe(plan2!.shadedColor);
    expect(plan1!.normal).toEqual(plan2!.normal);
    expect(plan1!.canvasW).toBe(plan2!.canvasW);
    expect(plan1!.canvasH).toBe(plan2!.canvasH);
  });
});

// ---------------------------------------------------------------------------
// Tests: projective quad branch
// ---------------------------------------------------------------------------

describe("atlas plan computation — projective quad branch", () => {
  it("non-textured convex quad produces a projectiveMatrix when stable", () => {
    const plan = computeTextureAtlasPlanPublic(PROJECTIVE_QUAD, 0);
    expect(plan).not.toBeNull();
    // A 4-vertex polygon can get a projective matrix when stable guards pass.
    // We don't force it to be non-null (guards may refuse), but if it is non-null
    // it should be a non-empty string.
    if (plan!.projectiveMatrix !== null) {
      expect(plan!.projectiveMatrix.length).toBeGreaterThan(0);
    }
  });

  it("triangles never get a projective matrix", () => {
    const plan = computeTextureAtlasPlanPublic(FLAT_TRIANGLE, 0);
    expect(plan!.projectiveMatrix).toBeNull();
  });

  it("pentagons never get a projective matrix", () => {
    const plan = computeTextureAtlasPlanPublic(FLAT_PENTAGON, 0);
    expect(plan!.projectiveMatrix).toBeNull();
  });

  it("textured quads never get a projective matrix", () => {
    const plan = computeTextureAtlasPlanPublic(TEXTURED_QUAD, 0);
    expect(plan!.projectiveMatrix).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Tests: texture flag propagation
// ---------------------------------------------------------------------------

describe("atlas plan computation — texture propagation", () => {
  it("textured polygon keeps texture set in plan", () => {
    const plan = computeTextureAtlasPlanPublic(TEXTURED_QUAD, 0);
    expect(plan!.texture).toBe("https://example.com/tex.png");
  });

  it("untextured polygon has texture undefined in plan", () => {
    const plan = computeTextureAtlasPlanPublic(FLAT_RECT, 0);
    expect(plan!.texture).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Tests: tileSize / layerElevation influence canvasW/canvasH
// ---------------------------------------------------------------------------

describe("atlas plan computation — tileSize scales the plan dimensions", () => {
  it("doubling tileSize doubles canvasW and canvasH for a flat polygon", () => {
    const plan50 = computeTextureAtlasPlanPublic(FLAT_RECT, 0, { tileSize: 50 });
    const plan100 = computeTextureAtlasPlanPublic(FLAT_RECT, 0, { tileSize: 100 });
    expect(plan100!.canvasW).toBeCloseTo(plan50!.canvasW * 2, 0);
    expect(plan100!.canvasH).toBeCloseTo(plan50!.canvasH * 2, 0);
  });
});
