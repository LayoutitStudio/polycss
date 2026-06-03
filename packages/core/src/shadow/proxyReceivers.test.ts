import { describe, expect, it } from "vitest";
import { prepareProxyReceiverPlanes } from "./proxyReceivers";
import type { Polygon, Vec3 } from "../types";

/** Axis-aligned unit cube centered at origin in world frame (no scale).
 *  Same geometry pattern as silhouette.test.ts so proxy + silhouette
 *  unit suites describe the same canonical shape. */
function unitCubeQuads(): Polygon[] {
  const h = 0.5;
  const v = (x: number, y: number, z: number): Vec3 => [x, y, z];
  return [
    // +Z top
    { vertices: [v(-h,-h, h), v( h,-h, h), v( h, h, h), v(-h, h, h)], color: "#fff" },
    // -Z bottom
    { vertices: [v(-h, h,-h), v( h, h,-h), v( h,-h,-h), v(-h,-h,-h)], color: "#fff" },
    // +X right
    { vertices: [v( h,-h,-h), v( h, h,-h), v( h, h, h), v( h,-h, h)], color: "#fff" },
    // -X left
    { vertices: [v(-h, h,-h), v(-h,-h,-h), v(-h,-h, h), v(-h, h, h)], color: "#fff" },
    // +Y front
    { vertices: [v(-h, h,-h), v(-h, h, h), v( h, h, h), v( h, h,-h)], color: "#fff" },
    // -Y back
    { vertices: [v( h,-h,-h), v( h,-h, h), v(-h,-h, h), v(-h,-h,-h)], color: "#fff" },
  ];
}

describe("prepareProxyReceiverPlanes", () => {
  it("emits 6 axis-aligned proxy planes for a cube, one polygon each", () => {
    const cube = unitCubeQuads();
    const planes = prepareProxyReceiverPlanes(cube, [0, 0, 0], 1, new Set(), 0);
    expect(planes.length).toBe(6);
    // Each plane normal is axis-aligned (one component = ±1, other two = 0).
    for (const p of planes) {
      const absSum = Math.abs(p.n[0]) + Math.abs(p.n[1]) + Math.abs(p.n[2]);
      expect(absSum).toBeCloseTo(1, 6);
      const compsNearZero = p.n.filter((c) => Math.abs(c) < 1e-9).length;
      expect(compsNearZero).toBe(2);
      // Cube has 1 face per axis direction → 1 member polygon per proxy.
      expect(p.memberPolyIndices.length).toBe(1);
    }
    // The set of normals spans ±X, ±Y, ±Z.
    const sigs = new Set(planes.map((p) =>
      `${Math.sign(p.n[0])},${Math.sign(p.n[1])},${Math.sign(p.n[2])}`));
    expect(sigs.size).toBe(6);
  });

  it("respects dedupDrop", () => {
    const cube = unitCubeQuads();
    // Drop the +Z top face (poly 0).
    const planes = prepareProxyReceiverPlanes(cube, [0, 0, 0], 1, new Set([0]), 0);
    // The +Z proxy should have no member polygons → dropped from output.
    expect(planes.length).toBe(5);
    for (const p of planes) {
      expect(p.memberPolyIndices).not.toContain(0);
    }
  });

  it("returns empty for a mesh with fewer than 3 vertices per polygon", () => {
    const degen: Polygon[] = [{ vertices: [[0, 0, 0], [1, 0, 0]], color: "#fff" }];
    expect(prepareProxyReceiverPlanes(degen, [0, 0, 0], 1, new Set(), 0)).toEqual([]);
  });

  it("computes a matrixCss with finite numeric components", () => {
    const cube = unitCubeQuads();
    const planes = prepareProxyReceiverPlanes(cube, [0, 0, 0], 1, new Set(), 0);
    for (const p of planes) {
      expect(p.matrixCss.startsWith("matrix3d(")).toBe(true);
      const nums = p.matrixCss
        .slice("matrix3d(".length, -1)
        .split(",")
        .map(Number);
      expect(nums.length).toBe(16);
      for (const n of nums) expect(Number.isFinite(n)).toBe(true);
    }
  });

  it("groups multiple coplanar faces onto a single proxy when they share a normal", () => {
    // Build a 2×2 grid of quads on the +Z plane (4 polygons all facing +Z),
    // plus the rest of an enclosing cube (5 other faces).
    const v = (x: number, y: number, z: number): Vec3 => [x, y, z];
    const h = 1;
    const topQuads: Polygon[] = [];
    // Subdivide +Z face into 4 quads.
    for (let i = 0; i < 2; i++) {
      for (let j = 0; j < 2; j++) {
        const x0 = -h + i, x1 = -h + i + 1;
        const y0 = -h + j, y1 = -h + j + 1;
        topQuads.push({
          vertices: [v(x0, y0, h), v(x1, y0, h), v(x1, y1, h), v(x0, y1, h)],
          color: "#fff",
        });
      }
    }
    // Add a single bottom quad for AABB establishment.
    topQuads.push({
      vertices: [v(-h, h, -h), v(h, h, -h), v(h, -h, -h), v(-h, -h, -h)],
      color: "#000",
    });
    const planes = prepareProxyReceiverPlanes(topQuads, [0, 0, 0], 1, new Set(), 0);
    const zPlus = planes.find((p) => p.n[2] > 0.5);
    expect(zPlus).toBeDefined();
    expect(zPlus!.memberPolyIndices.length).toBe(4);
  });
});
