/**
 * Feature tests: buildTextureEdgeRepairSets
 *
 * Pins the observable contract for shared-edge detection among textured polygons.
 * Non-textured polygons are excluded entirely. The returned sets track which edge
 * indices (per polygon) need alpha repair so the atlas rasterizer can blend away
 * seam artifacts at shared borders.
 */
import { describe, it, expect } from "vitest";
import type { Polygon } from "../types";
import { buildTextureEdgeRepairSets } from "./edgeRepair";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const sharedV1: [number, number, number] = [1, 0, 0];
const sharedV2: [number, number, number] = [1, 1, 0];

/** Two textured quads sharing edge sharedV1→sharedV2. */
const TEXTURED_LEFT: Polygon = {
  vertices: [[0, 0, 0], sharedV1, sharedV2, [0, 1, 0]],
  texture: "https://example.com/a.png",
  color: "#ffffff",
};
const TEXTURED_RIGHT: Polygon = {
  vertices: [sharedV1, [2, 0, 0], [2, 1, 0], sharedV2],
  texture: "https://example.com/b.png",
  color: "#ffffff",
};

/** A solid (non-textured) quad at the same positions as TEXTURED_LEFT. */
const SOLID_QUAD: Polygon = {
  vertices: [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0]],
  color: "#ff0000",
};

// ---------------------------------------------------------------------------
// Tests: output array length
// ---------------------------------------------------------------------------

describe("buildTextureEdgeRepairSets — output structure", () => {
  it("output array length equals input polygon count", () => {
    const sets = buildTextureEdgeRepairSets([TEXTURED_LEFT, TEXTURED_RIGHT, SOLID_QUAD]);
    expect(sets.length).toBe(3);
  });

  it("returns an empty array for an empty input", () => {
    expect(buildTextureEdgeRepairSets([])).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Tests: shared edges between textured polygons
// ---------------------------------------------------------------------------

describe("buildTextureEdgeRepairSets — shared textured edges", () => {
  it("two textured polygons sharing an edge both get a repair set", () => {
    const sets = buildTextureEdgeRepairSets([TEXTURED_LEFT, TEXTURED_RIGHT]);
    expect(sets[0]).toBeDefined();
    expect(sets[1]).toBeDefined();
  });

  it("shared-edge repair sets are non-empty", () => {
    const sets = buildTextureEdgeRepairSets([TEXTURED_LEFT, TEXTURED_RIGHT]);
    expect(sets[0]!.size).toBeGreaterThan(0);
    expect(sets[1]!.size).toBeGreaterThan(0);
  });

  it("edge indices in the repair set are valid indices for that polygon's vertex array", () => {
    const sets = buildTextureEdgeRepairSets([TEXTURED_LEFT, TEXTURED_RIGHT]);
    for (const edgeIdx of sets[0]!) {
      expect(edgeIdx).toBeGreaterThanOrEqual(0);
      expect(edgeIdx).toBeLessThan(TEXTURED_LEFT.vertices.length);
    }
    for (const edgeIdx of sets[1]!) {
      expect(edgeIdx).toBeGreaterThanOrEqual(0);
      expect(edgeIdx).toBeLessThan(TEXTURED_RIGHT.vertices.length);
    }
  });

  it("edge orientation [a,b] and [b,a] are recognized as the same shared edge", () => {
    // TEXTURED_LEFT has edge 1→2 which is sharedV1→sharedV2.
    // TEXTURED_RIGHT has edge 3→0 which is sharedV2→sharedV1 (reversed).
    // Both must be detected as shared.
    const sets = buildTextureEdgeRepairSets([TEXTURED_LEFT, TEXTURED_RIGHT]);
    expect(sets[0]).toBeDefined();
    expect(sets[1]).toBeDefined();
    expect(sets[0]!.size).toBeGreaterThan(0);
    expect(sets[1]!.size).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Tests: non-textured polygons are excluded
// ---------------------------------------------------------------------------

describe("buildTextureEdgeRepairSets — non-textured polygons", () => {
  it("non-textured polygons produce undefined repair sets even when adjacent", () => {
    const solid1: Polygon = {
      vertices: [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0]],
      color: "#ff0000",
    };
    const solid2: Polygon = {
      vertices: [[1, 0, 0], [2, 0, 0], [2, 1, 0], [1, 1, 0]],
      color: "#00ff00",
    };
    const sets = buildTextureEdgeRepairSets([solid1, solid2]);
    expect(sets[0]).toBeUndefined();
    expect(sets[1]).toBeUndefined();
  });

  it("mixed: textured polygons get sets, non-textured get undefined", () => {
    const sets = buildTextureEdgeRepairSets([TEXTURED_LEFT, SOLID_QUAD]);
    // TEXTURED_LEFT shares no edge with SOLID_QUAD (since SOLID_QUAD is not textured)
    expect(sets[0]).toBeUndefined();
    expect(sets[1]).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Tests: polygons with no shared edges
// ---------------------------------------------------------------------------

describe("buildTextureEdgeRepairSets — no shared edges", () => {
  it("textured polygons far apart produce undefined repair sets", () => {
    const farA: Polygon = {
      vertices: [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0]],
      texture: "https://example.com/a.png",
      color: "#ffffff",
    };
    const farB: Polygon = {
      vertices: [[10, 10, 0], [11, 10, 0], [11, 11, 0], [10, 11, 0]],
      texture: "https://example.com/b.png",
      color: "#ffffff",
    };
    const sets = buildTextureEdgeRepairSets([farA, farB]);
    expect(!sets[0] || sets[0].size === 0).toBe(true);
    expect(!sets[1] || sets[1].size === 0).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Tests: three-way shared vertex (edge shared by multiple polygons)
// ---------------------------------------------------------------------------

describe("buildTextureEdgeRepairSets — three-way adjacency", () => {
  it("three textured quads in a row produce repair sets for all three", () => {
    const v1: [number, number, number] = [1, 0, 0];
    const v2: [number, number, number] = [1, 1, 0];
    const v3: [number, number, number] = [2, 0, 0];
    const v4: [number, number, number] = [2, 1, 0];
    const polyA: Polygon = {
      vertices: [[0, 0, 0], v1, v2, [0, 1, 0]],
      texture: "https://example.com/a.png",
      color: "#fff",
    };
    const polyB: Polygon = {
      vertices: [v1, v3, v4, v2],
      texture: "https://example.com/b.png",
      color: "#fff",
    };
    const polyC: Polygon = {
      vertices: [v3, [3, 0, 0], [3, 1, 0], v4],
      texture: "https://example.com/c.png",
      color: "#fff",
    };
    const sets = buildTextureEdgeRepairSets([polyA, polyB, polyC]);
    // polyA and polyB share an edge; polyB and polyC share an edge
    expect(sets[0]).toBeDefined();
    expect(sets[1]).toBeDefined();
    expect(sets[2]).toBeDefined();
  });
});
