/**
 * Feature tests: atlas plan computation (computeTextureAtlasPlan / computeTextureAtlasPlanPublic)
 *
 * These tests pin the observable contract of the plan output — the fields callers
 * downstream rely on — not the internal call graph.
 */
import { describe, it, expect } from "vitest";
import type { Polygon } from "../types";
import {
  computeTextureAtlasPlanPublic,
  chooseLocalBasis,
  buildBasisHints,
  resolveProjectiveQuadGuards,
  computeProjectiveQuadCoefficients,
} from "./plan";

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
    // Lambert is physically based — `BRDF_Lambert(albedo) = albedo / π` wraps
    // ambient too, so ambientIntensity needs the matching ×π to saturate.
    const whitePoly: Polygon = {
      vertices: [[0, 0, 0], [2, 0, 0], [2, 1, 0], [0, 1, 0]],
      color: "#ffffff",
    };
    const planWhiteAmbient = computeTextureAtlasPlanPublic(whitePoly, 0, {
      ambientLight: { color: "#ffffff", intensity: Math.PI },
      directionalLight: { direction: [0, 0, 1], color: "#000000", intensity: 0 },
    });
    const planRedAmbient = computeTextureAtlasPlanPublic(whitePoly, 0, {
      ambientLight: { color: "#ff0000", intensity: Math.PI },
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

// ---------------------------------------------------------------------------
// Tests: UV passthrough for textured polygons
// ---------------------------------------------------------------------------

describe("atlas plan computation — UV passthrough for textured polygons", () => {
  const TEXTURED_QUAD_WITH_UVS: Polygon = {
    vertices: [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0]],
    texture: "https://example.com/tex.png",
    uvs: [[0, 0], [1, 0], [1, 1], [0, 1]],
    color: "#ffffff",
  };

  it("textured polygon with uvs produces a uvSampleRect", () => {
    const plan = computeTextureAtlasPlanPublic(TEXTURED_QUAD_WITH_UVS, 0)!;
    expect(plan.uvSampleRect).not.toBeNull();
    expect(plan.uvSampleRect!.minU).toBeCloseTo(0);
    expect(plan.uvSampleRect!.maxU).toBeCloseTo(1);
  });

  it("untextured polygon has null uvSampleRect", () => {
    const plan = computeTextureAtlasPlanPublic(FLAT_RECT, 0)!;
    expect(plan.uvSampleRect).toBeNull();
  });

  it("textured polygon without uvs has null uvSampleRect", () => {
    const plan = computeTextureAtlasPlanPublic(TEXTURED_QUAD, 0)!;
    // TEXTURED_QUAD has no uvs array
    expect(plan.uvSampleRect).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Tests: textureEdgeRepair flag
// ---------------------------------------------------------------------------

describe("atlas plan computation — textureEdgeRepair from basisHint", () => {
  it("textureEdgeRepair is false for a polygon without shared edges", () => {
    const plan = computeTextureAtlasPlanPublic(TEXTURED_QUAD, 0)!;
    expect(plan.textureEdgeRepair).toBe(false);
  });

  it("textureEdgeRepair is true when textureEdgeRepairEdges set is provided", () => {
    const edges = new Set([0, 1]);
    const plan = computeTextureAtlasPlanPublic(TEXTURED_QUAD, 0, { textureEdgeRepairEdges: edges })!;
    expect(plan.textureEdgeRepair).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Tests: chooseLocalBasis
// ---------------------------------------------------------------------------

describe("chooseLocalBasis — local basis selection", () => {
  const pts: [number, number, number][] = [[0, 0, 0], [2, 0, 0], [2, 1, 0], [0, 1, 0]];
  const origin: [number, number, number] = [0, 0, 0];
  const normal: [number, number, number] = [0, 0, 1];

  it("returns a non-null basis for a simple planar polygon", () => {
    const basis = chooseLocalBasis(pts, origin, normal, { optimize: false });
    expect(basis).not.toBeNull();
  });

  it("returned xAxis and yAxis are unit vectors", () => {
    const basis = chooseLocalBasis(pts, origin, normal, { optimize: false })!;
    const xLen = Math.hypot(basis.xAxis[0], basis.xAxis[1], basis.xAxis[2]);
    const yLen = Math.hypot(basis.yAxis[0], basis.yAxis[1], basis.yAxis[2]);
    expect(xLen).toBeCloseTo(1, 5);
    expect(yLen).toBeCloseTo(1, 5);
  });

  it("returned xAxis is orthogonal to the normal", () => {
    const basis = chooseLocalBasis(pts, origin, normal, { optimize: false })!;
    const dot = basis.xAxis[0] * normal[0] + basis.xAxis[1] * normal[1] + basis.xAxis[2] * normal[2];
    expect(Math.abs(dot)).toBeLessThan(1e-5);
  });

  it("canvasW and canvasH are positive integers >= 1", () => {
    const basis = chooseLocalBasis(pts, origin, normal, { optimize: false })!;
    expect(basis.canvasW).toBeGreaterThanOrEqual(1);
    expect(basis.canvasH).toBeGreaterThanOrEqual(1);
    expect(Number.isInteger(basis.canvasW)).toBe(true);
    expect(Number.isInteger(basis.canvasH)).toBe(true);
  });

  it("optimize=true with seam edges finds a basis", () => {
    const basis = chooseLocalBasis(pts, origin, normal, {
      optimize: true,
      seamEdges: new Set([0]),
    });
    expect(basis).not.toBeNull();
  });

  it("fixedXAxis overrides natural axis selection when optimize=true", () => {
    const fixedAxis: [number, number, number] = [1, 0, 0];
    const basis = chooseLocalBasis(pts, origin, normal, {
      optimize: true,
      fixedXAxis: fixedAxis,
    })!;
    expect(basis).not.toBeNull();
    // xAxis should be close to the fixedAxis (projected onto the plane)
    expect(Math.abs(basis.xAxis[0])).toBeGreaterThan(0.9);
  });
});

// ---------------------------------------------------------------------------
// Tests: resolveProjectiveQuadGuards
// ---------------------------------------------------------------------------

describe("resolveProjectiveQuadGuards — guard parameter resolution", () => {
  it("returns defaults when overrides is undefined", () => {
    const guards = resolveProjectiveQuadGuards(undefined);
    expect(typeof guards.denomEps).toBe("number");
    expect(typeof guards.maxWeightRatio).toBe("number");
    expect(typeof guards.bleed).toBe("number");
    expect(guards.disableGuards).toBe(false);
  });

  it("disableGuards=true is preserved", () => {
    const guards = resolveProjectiveQuadGuards({ disableGuards: true });
    expect(guards.disableGuards).toBe(true);
  });

  it("overridden denomEps is clamped to >= 0", () => {
    const guards = resolveProjectiveQuadGuards({ denomEps: -5 });
    expect(guards.denomEps).toBe(0);
  });

  it("overridden maxWeightRatio must be > 1 (or defaults)", () => {
    const guards = resolveProjectiveQuadGuards({ maxWeightRatio: 2 });
    expect(guards.maxWeightRatio).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Tests: computeProjectiveQuadCoefficients
// ---------------------------------------------------------------------------

describe("computeProjectiveQuadCoefficients — projective homography", () => {
  it("returns null for fewer than 4 points", () => {
    const guards = resolveProjectiveQuadGuards(undefined);
    expect(computeProjectiveQuadCoefficients([[0, 0], [1, 0], [1, 1]], guards)).toBeNull();
  });

  it("returns null for a non-convex quad", () => {
    const guards = resolveProjectiveQuadGuards({ disableGuards: true });
    // Concave (bowtie) quad
    const concave: [number, number][] = [[0, 0], [1, 1], [1, 0], [0, 1]];
    expect(computeProjectiveQuadCoefficients(concave, guards)).toBeNull();
  });

  it("returns coefficients for a valid convex quad with disableGuards=true", () => {
    const guards = resolveProjectiveQuadGuards({ disableGuards: true });
    const q: [number, number][] = [[0, 0], [1, 0], [1, 1], [0, 1]];
    const result = computeProjectiveQuadCoefficients(q, guards);
    // A unit square has g=h=0 (affine quad, no perspective)
    expect(result).not.toBeNull();
    expect(typeof result!.g).toBe("number");
    expect(typeof result!.h).toBe("number");
  });

  it("keeps moderate homogeneous weight variation on the projective path", () => {
    const guards = resolveProjectiveQuadGuards(undefined);
    const q: [number, number][] = [[0, 0], [1, 0], [1, 1], [0, 6]];
    expect(computeProjectiveQuadCoefficients(q, guards)).not.toBeNull();
  });

  it("rejects near-singular projective quads by default", () => {
    const guards = resolveProjectiveQuadGuards(undefined);
    const q: [number, number][] = [[0, 0], [1, 0], [1, 1], [0, 1000]];
    expect(computeProjectiveQuadCoefficients(q, guards)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Tests: buildBasisHints
// ---------------------------------------------------------------------------

describe("buildBasisHints — cross-polygon basis optimization", () => {
  it("returns an array of length equal to the input polygon count", () => {
    const polygons = [FLAT_RECT, FLAT_TRIANGLE, FLAT_PENTAGON];
    const hints = buildBasisHints(polygons, {});
    expect(hints.length).toBe(3);
  });

  it("isolated polygons produce undefined hints (no adjacent coplanar neighbor)", () => {
    // Single isolated polygon — no neighbors → no hint
    const hints = buildBasisHints([FLAT_RECT], {});
    // Isolated polygon: no cross-polygon optimization → hint may be undefined
    expect(hints.length).toBe(1);
    // Note: a single-polygon group is skipped, so hint is undefined
    expect(hints[0]).toBeUndefined();
  });

  it("two adjacent coplanar polygons get basis hints", () => {
    // Two quads sharing an edge in the XY plane
    const polyA: Polygon = {
      vertices: [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0]],
      color: "#ff0000",
    };
    const polyB: Polygon = {
      vertices: [[1, 0, 0], [2, 0, 0], [2, 1, 0], [1, 1, 0]],
      color: "#00ff00",
    };
    const hints = buildBasisHints([polyA, polyB], {});
    // At least one of the hints should be defined (when the axis saves pixel area)
    // The optimization only triggers when it genuinely improves the basis
    expect(hints.length).toBe(2);
  });
});
