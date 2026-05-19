import { describe, expect, it } from "vitest";
import type { Vec3 } from "../types";
import { icosahedronPolygons } from "./icosahedronPolygons";

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

function isCCWFromOutside(vertices: Vec3[], solidCentroid: Vec3): boolean {
  const [a, b, c] = vertices;
  const n = cross(sub(b, a), sub(c, a));
  const fc: Vec3 = [0, 0, 0];
  for (const v of vertices) { fc[0] += v[0]; fc[1] += v[1]; fc[2] += v[2]; }
  fc[0] /= vertices.length; fc[1] /= vertices.length; fc[2] /= vertices.length;
  return dot(n, sub(fc, solidCentroid)) > 0;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("icosahedronPolygons", () => {
  it("returns exactly 20 triangular faces", () => {
    const polygons = icosahedronPolygons();
    expect(polygons).toHaveLength(20);
    for (const p of polygons) expect(p.vertices).toHaveLength(3);
  });

  it("uses default size 100 and color #cccccc", () => {
    const polygons = icosahedronPolygons();
    for (const p of polygons) {
      expect(p.color).toBe("#cccccc");
    }
    // All 12 unique vertices should sit at radius ~100.
    const seen = new Set<string>();
    for (const p of polygons) {
      for (const v of p.vertices) {
        const key = v.map((x) => x.toFixed(6)).join(",");
        if (!seen.has(key)) {
          seen.add(key);
          expect(len(v)).toBeCloseTo(100, 4);
        }
      }
    }
    expect(seen.size).toBe(12); // exactly 12 distinct vertices
  });

  it("respects custom size and color", () => {
    const polygons = icosahedronPolygons({ size: 200, color: "#abcdef" });
    for (const p of polygons) {
      expect(p.color).toBe("#abcdef");
      for (const v of p.vertices) expect(len(v)).toBeCloseTo(200, 3);
    }
  });

  it("all faces wind CCW from outside", () => {
    const polygons = icosahedronPolygons({ size: 100 });
    const centroid: Vec3 = [0, 0, 0];
    for (const p of polygons) {
      expect(isCCWFromOutside(p.vertices, centroid)).toBe(true);
    }
  });

  it("all face normals point outward (dot with face center > 0)", () => {
    const polygons = icosahedronPolygons({ size: 100 });
    for (const p of polygons) {
      const [a, b, c] = p.vertices;
      const n = cross(sub(b, a), sub(c, a));
      const fc: Vec3 = [
        (a[0] + b[0] + c[0]) / 3,
        (a[1] + b[1] + c[1]) / 3,
        (a[2] + b[2] + c[2]) / 3,
      ];
      expect(dot(n, fc)).toBeGreaterThan(0);
    }
  });

  it("all faces are equilateral (equal edge lengths within epsilon)", () => {
    const polygons = icosahedronPolygons({ size: 100 });
    for (const p of polygons) {
      const [a, b, c] = p.vertices;
      const ab = len(sub(b, a));
      const bc = len(sub(c, b));
      const ca = len(sub(a, c));
      expect(ab).toBeCloseTo(bc, 4);
      expect(bc).toBeCloseTo(ca, 4);
    }
  });
});
