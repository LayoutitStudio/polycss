import { describe, expect, it } from "vitest";
import type { Vec3 } from "../types";
import { dodecahedronPolygons } from "./dodecahedronPolygons";

// ── Test helpers ─────────────────────────────────────────────────────────────

function cross(a: Vec3, b: Vec3): Vec3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function sub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function len(v: Vec3): number {
  return Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
}

/**
 * Returns true if all vertices of a polygon lie on the same plane within
 * the given epsilon. Uses the plane defined by the first three vertices.
 */
function isCoplanar(vertices: Vec3[], eps = 1e-4): boolean {
  if (vertices.length <= 3) return true;
  const [a, b, c, ...rest] = vertices;
  const n = cross(sub(b, a), sub(c, a));
  const nl = len(n);
  if (nl < 1e-10) return false; // degenerate
  for (const v of rest) {
    const dist = Math.abs(dot(n, sub(v, a))) / nl;
    if (dist > eps) return false;
  }
  return true;
}

function isCCWFromOutside(vertices: Vec3[], solidCentroid: Vec3): boolean {
  const [a, b, c] = vertices;
  const n = cross(sub(b, a), sub(c, a));
  const fc: Vec3 = [0, 0, 0];
  for (const v of vertices) { fc[0] += v[0]; fc[1] += v[1]; fc[2] += v[2]; }
  fc[0] /= vertices.length; fc[1] /= vertices.length; fc[2] /= vertices.length;
  return dot(n, sub(fc, solidCentroid)) > 0;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("dodecahedronPolygons", () => {
  it("returns exactly 12 faces", () => {
    const polygons = dodecahedronPolygons();
    expect(polygons).toHaveLength(12);
  });

  it("each face has exactly 5 vertices (pentagons)", () => {
    const polygons = dodecahedronPolygons();
    for (const p of polygons) expect(p.vertices).toHaveLength(5);
  });

  it("uses default size 100 and color #cccccc", () => {
    const polygons = dodecahedronPolygons();
    for (const p of polygons) expect(p.color).toBe("#cccccc");
    // All 20 unique vertices should sit at radius ~100.
    const seen = new Set<string>();
    for (const p of polygons) {
      for (const v of p.vertices) {
        const key = v.map((x) => x.toFixed(5)).join(",");
        if (!seen.has(key)) {
          seen.add(key);
          expect(len(v)).toBeCloseTo(100, 3);
        }
      }
    }
    expect(seen.size).toBe(20);
  });

  it("respects custom size and color", () => {
    const polygons = dodecahedronPolygons({ size: 50, color: "#123456" });
    for (const p of polygons) {
      expect(p.color).toBe("#123456");
      for (const v of p.vertices) expect(len(v)).toBeCloseTo(50, 3);
    }
  });

  it("every face is coplanar within epsilon", () => {
    const polygons = dodecahedronPolygons({ size: 100 });
    for (const p of polygons) {
      expect(isCoplanar(p.vertices, 1e-3)).toBe(true);
    }
  });

  it("all faces wind CCW from outside", () => {
    const polygons = dodecahedronPolygons({ size: 100 });
    const centroid: Vec3 = [0, 0, 0];
    for (const p of polygons) {
      expect(isCCWFromOutside(p.vertices, centroid)).toBe(true);
    }
  });
});
