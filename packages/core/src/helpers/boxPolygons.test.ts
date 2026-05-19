import { describe, expect, it } from "vitest";
import type { Polygon, Vec3 } from "../types";
import { boxPolygons } from "./boxPolygons";

function bounds(polygons: Polygon[]): { min: Vec3; max: Vec3 } {
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const polygon of polygons) {
    for (const vertex of polygon.vertices) {
      for (let axis = 0; axis < 3; axis += 1) {
        min[axis] = Math.min(min[axis], vertex[axis]);
        max[axis] = Math.max(max[axis], vertex[axis]);
      }
    }
  }
  return { min, max };
}

function normal(polygon: Polygon): Vec3 {
  const [a, b, c] = polygon.vertices;
  const ux = b[0] - a[0];
  const uy = b[1] - a[1];
  const uz = b[2] - a[2];
  const vx = c[0] - a[0];
  const vy = c[1] - a[1];
  const vz = c[2] - a[2];
  const nx = uy * vz - uz * vy;
  const ny = uz * vx - ux * vz;
  const nz = ux * vy - uy * vx;
  const len = Math.hypot(nx, ny, nz) || 1;
  return [
    Math.round(nx / len),
    Math.round(ny / len),
    Math.round(nz / len),
  ];
}

function hasNormal(polygons: Polygon[], expected: Vec3): boolean {
  return polygons.some((polygon) => {
    const n = normal(polygon);
    return n[0] === expected[0] && n[1] === expected[1] && n[2] === expected[2];
  });
}

describe("boxPolygons", () => {
  it("returns six white quads for the default unit box", () => {
    const polygons = boxPolygons();
    expect(polygons).toHaveLength(6);
    for (const polygon of polygons) {
      expect(polygon.vertices).toHaveLength(4);
      expect(polygon.color).toBe("#ffffff");
      expect(polygon.data).toBeUndefined();
    }
    expect(bounds(polygons)).toEqual({
      min: [-0.5, -0.5, -0.5],
      max: [0.5, 0.5, 0.5],
    });
  });

  it("supports size and center", () => {
    const polygons = boxPolygons({
      size: [2, 4, 6],
      center: [10, 20, 30],
    });
    expect(bounds(polygons)).toEqual({
      min: [9, 18, 27],
      max: [11, 22, 33],
    });
  });

  it("uses explicit min/max bounds and normalizes reversed axes", () => {
    const polygons = boxPolygons({
      min: [3, 8, 1],
      max: [-1, 2, 5],
    });
    expect(bounds(polygons)).toEqual({
      min: [-1, 2, 1],
      max: [3, 8, 5],
    });
  });

  it("winds all faces outward", () => {
    const polygons = boxPolygons();
    expect(hasNormal(polygons, [1, 0, 0])).toBe(true);
    expect(hasNormal(polygons, [-1, 0, 0])).toBe(true);
    expect(hasNormal(polygons, [0, 1, 0])).toBe(true);
    expect(hasNormal(polygons, [0, -1, 0])).toBe(true);
    expect(hasNormal(polygons, [0, 0, 1])).toBe(true);
    expect(hasNormal(polygons, [0, 0, -1])).toBe(true);
  });

  it("omits faces set to false", () => {
    const polygons = boxPolygons({
      faces: { bottom: false },
    });
    expect(polygons).toHaveLength(5);
    expect(hasNormal(polygons, [0, 0, -1])).toBe(false);
  });

  it("merges top-level and per-face material data", () => {
    const polygons = boxPolygons({
      color: "#999999",
      data: { tileId: "tile-1", kind: "tile" },
      faces: {
        top: {
          color: "#ff0000",
          texture: "/tile.png",
          data: { face: "top" },
        },
      },
    });
    const top = polygons.find((polygon) => {
      const n = normal(polygon);
      return n[0] === 0 && n[1] === 0 && n[2] === 1;
    });
    expect(top).toBeDefined();
    expect(top?.color).toBe("#ff0000");
    expect(top?.texture).toBe("/tile.png");
    expect(top?.data).toEqual({
      tileId: "tile-1",
      kind: "tile",
      face: "top",
    });
  });

  it("returns no polygons for degenerate boxes", () => {
    expect(boxPolygons({ size: [1, 0, 1] })).toHaveLength(0);
  });
});
