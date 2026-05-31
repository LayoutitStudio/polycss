import { describe, expect, it } from "vitest";
import type { Polygon } from "@layoutit/polycss-core";
import {
  RECEIVER_NORMAL_TOL,
  RECEIVER_OFFSET_TOL,
  RECEIVER_OUTLINE_EXPAND,
  expandConvexHullOutward,
  groupReceiverFaceGroups,
  meshScaleVec3,
  worldCssForMesh,
} from "./shadowGeometry";
import { DEFAULT_TILE } from "./transforms";

describe("meshScaleVec3", () => {
  it("undefined → [1,1,1]", () => {
    expect(meshScaleVec3(undefined)).toEqual([1, 1, 1]);
  });
  it("null → [1,1,1]", () => {
    expect(meshScaleVec3(null)).toEqual([1, 1, 1]);
  });
  it("number → uniform vec3", () => {
    expect(meshScaleVec3(2.5)).toEqual([2.5, 2.5, 2.5]);
  });
  it("vec3 → as-is", () => {
    expect(meshScaleVec3([1, 2, 3])).toEqual([1, 2, 3]);
  });
  it("vec3 with holes → default 1 per axis", () => {
    expect(meshScaleVec3([undefined as any, 5, undefined as any])).toEqual([1, 5, 1]);
  });
});

describe("worldCssForMesh", () => {
  it("scale=1 short-circuits the per-axis multiply (output equals translated)", () => {
    const fn = worldCssForMesh(1);
    // vert.x → CSS.y, vert.y → CSS.x, vert.z → CSS.z, all × tile, then + pos×tile (swapped)
    const out = fn([1, 0, 0], [0, 0, 0]);
    expect(out).toEqual([0, 1 * DEFAULT_TILE, 0]);
  });
  it("pos translates the result via worldPositionToCss swap", () => {
    const fn = worldCssForMesh(1);
    const out = fn([0, 0, 0], [3, 5, 7]);
    expect(out).toEqual([5 * DEFAULT_TILE, 3 * DEFAULT_TILE, 7 * DEFAULT_TILE]);
  });
  it("scale=2 doubles vertex distance from the mesh origin (pivots from origin)", () => {
    const fn = worldCssForMesh(2);
    const out = fn([1, 0, 0], [0, 0, 0]);
    // x0=0, y0=tile, z0=0; scaled: y = tile*2 = 100; pos contribution 0
    expect(out).toEqual([0, DEFAULT_TILE * 2, 0]);
  });
  it("vector scale applies per axis (in vertex order x,y,z)", () => {
    const fn = worldCssForMesh([2, 3, 4]);
    // Vec [1, 1, 1]: x0 = 1*tile (vert.y), y0 = 1*tile (vert.x), z0 = 1*tile;
    // CSS-frame scale axes match: x0 * scale[0], y0 * scale[1], z0 * scale[2]
    const out = fn([1, 1, 1], [0, 0, 0]);
    expect(out).toEqual([DEFAULT_TILE * 2, DEFAULT_TILE * 3, DEFAULT_TILE * 4]);
  });
});

describe("expandConvexHullOutward", () => {
  it("returns input when expand=0", () => {
    const sq: Array<[number, number]> = [[0, 0], [1, 0], [1, 1], [0, 1]];
    expect(expandConvexHullOutward(sq, 0)).toBe(sq);
  });
  it("returns input when polygon has <3 vertices", () => {
    const line: Array<[number, number]> = [[0, 0], [1, 0]];
    expect(expandConvexHullOutward(line, 5)).toBe(line);
  });
  it("inflates a CCW square by the requested amount on every side", () => {
    const sq: Array<[number, number]> = [[0, 0], [10, 0], [10, 10], [0, 10]];
    const out = expandConvexHullOutward(sq, 1);
    // Each corner moves diagonally outward by sqrt(2)
    expect(out[0]![0]).toBeCloseTo(-1, 5);
    expect(out[0]![1]).toBeCloseTo(-1, 5);
    expect(out[1]![0]).toBeCloseTo(11, 5);
    expect(out[1]![1]).toBeCloseTo(-1, 5);
    expect(out[2]![0]).toBeCloseTo(11, 5);
    expect(out[2]![1]).toBeCloseTo(11, 5);
    expect(out[3]![0]).toBeCloseTo(-1, 5);
    expect(out[3]![1]).toBeCloseTo(11, 5);
  });
  it("RECEIVER_OUTLINE_EXPAND is 0.5 (expected default)", () => {
    expect(RECEIVER_OUTLINE_EXPAND).toBe(0.5);
  });
});

describe("groupReceiverFaceGroups", () => {
  const identityWorld = (vert: any, _pos: any) => vert as [number, number, number];

  it("returns empty when polygons is empty", () => {
    expect(groupReceiverFaceGroups([], [0, 0, 0], identityWorld, new Set())).toEqual([]);
  });

  it("a single triangle becomes one plane group", () => {
    const tri: Polygon = {
      vertices: [[0, 0, 0], [1, 0, 0], [0, 1, 0]],
      color: "#fff",
    } as any;
    const out = groupReceiverFaceGroups([tri], [0, 0, 0], identityWorld, new Set());
    expect(out).toHaveLength(1);
    expect(out[0]!.outlineUv.length).toBeGreaterThanOrEqual(3);
    expect(out[0]!.memberPolyIndices).toEqual([0]);
  });

  it("two coplanar triangles sharing an edge collapse into one group", () => {
    // Two right triangles forming a unit square in the XY plane (z=0)
    const t1: Polygon = { vertices: [[0, 0, 0], [1, 0, 0], [0, 1, 0]], color: "#fff" } as any;
    const t2: Polygon = { vertices: [[1, 0, 0], [1, 1, 0], [0, 1, 0]], color: "#fff" } as any;
    const out = groupReceiverFaceGroups([t1, t2], [0, 0, 0], identityWorld, new Set());
    expect(out).toHaveLength(1);
    expect(out[0]!.memberPolyIndices).toEqual([0, 1]);
  });

  it("two coplanar but DISJOINT triangles stay in separate groups (connected-component split)", () => {
    const t1: Polygon = { vertices: [[0, 0, 0], [1, 0, 0], [0, 1, 0]], color: "#fff" } as any;
    const tFar: Polygon = { vertices: [[10, 10, 0], [11, 10, 0], [10, 11, 0]], color: "#fff" } as any;
    const out = groupReceiverFaceGroups([t1, tFar], [0, 0, 0], identityWorld, new Set());
    expect(out).toHaveLength(2);
    // Each group should claim exactly one of the source polygons.
    const indices = out.map((g) => g.memberPolyIndices).flat().sort();
    expect(indices).toEqual([0, 1]);
  });

  it("two triangles on DIFFERENT planes end up in different groups", () => {
    const flat: Polygon = { vertices: [[0, 0, 0], [1, 0, 0], [0, 1, 0]], color: "#fff" } as any;
    const wall: Polygon = { vertices: [[0, 0, 0], [1, 0, 0], [0, 0, 1]], color: "#fff" } as any;
    const out = groupReceiverFaceGroups([flat, wall], [0, 0, 0], identityWorld, new Set());
    expect(out).toHaveLength(2);
  });

  it("polys in dedupDrop are skipped", () => {
    const tri: Polygon = { vertices: [[0, 0, 0], [1, 0, 0], [0, 1, 0]], color: "#fff" } as any;
    const out = groupReceiverFaceGroups([tri], [0, 0, 0], identityWorld, new Set([0]));
    expect(out).toEqual([]);
  });

  it("degenerate (collinear) triangle is skipped", () => {
    const collinear: Polygon = { vertices: [[0, 0, 0], [1, 0, 0], [2, 0, 0]], color: "#fff" } as any;
    const out = groupReceiverFaceGroups([collinear], [0, 0, 0], identityWorld, new Set());
    expect(out).toEqual([]);
  });

  it("polygon with <3 vertices is skipped", () => {
    const tooFew: Polygon = { vertices: [[0, 0, 0], [1, 0, 0]], color: "#fff" } as any;
    const out = groupReceiverFaceGroups([tooFew], [0, 0, 0], identityWorld, new Set());
    expect(out).toEqual([]);
  });
});

describe("tolerance constants", () => {
  it("RECEIVER_NORMAL_TOL is small (~2.5° angular tolerance via 1-dot)", () => {
    expect(RECEIVER_NORMAL_TOL).toBe(0.001);
  });
  it("RECEIVER_OFFSET_TOL allows sub-px coplanarity drift", () => {
    expect(RECEIVER_OFFSET_TOL).toBe(0.5);
  });
});
