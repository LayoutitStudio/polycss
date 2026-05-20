import { describe, expect, it } from "vitest";
import type { Vec3 } from "../types";
import { tetrahedronPolygons } from "./tetrahedronPolygons";

// ── Test helpers ────────────────────────────────────────────────────────────

/** Cross product of two Vec3 vectors. */
function cross(a: Vec3, b: Vec3): Vec3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

/** Subtract b from a. */
function sub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

/** Dot product. */
function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

/** Length of a vector. */
function len(v: Vec3): number {
  return Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
}

/**
 * Returns true if winding is CCW from outside:
 * the cross product of the first two edges should point away from the
 * centroid of all vertices passed in (i.e. the origin for a centered solid).
 */
function isCCWFromOutside(vertices: Vec3[], solidCentroid: Vec3): boolean {
  const [a, b, c] = vertices;
  const e1 = sub(b, a);
  const e2 = sub(c, a);
  const n = cross(e1, e2);
  // Face center
  const fc: Vec3 = [0, 0, 0];
  for (const v of vertices) {
    fc[0] += v[0]; fc[1] += v[1]; fc[2] += v[2];
  }
  fc[0] /= vertices.length; fc[1] /= vertices.length; fc[2] /= vertices.length;
  // Vector from solid centroid to face center
  const outDir = sub(fc, solidCentroid);
  return dot(n, outDir) > 0;
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe("tetrahedronPolygons", () => {
  it("returns exactly 4 triangular faces", () => {
    const polygons = tetrahedronPolygons();
    expect(polygons).toHaveLength(4);
    for (const p of polygons) expect(p.vertices).toHaveLength(3);
  });

  it("uses default size 100 and color #cccccc", () => {
    const polygons = tetrahedronPolygons();
    for (const p of polygons) {
      expect(p.color).toBe("#cccccc");
    }
    // All vertices should be at distance ~100 from origin.
    for (const p of polygons) {
      for (const v of p.vertices) {
        expect(len(v)).toBeCloseTo(100, 4);
      }
    }
  });

  it("respects a custom size", () => {
    const polygons = tetrahedronPolygons({ size: 50 });
    for (const p of polygons) {
      for (const v of p.vertices) {
        expect(len(v)).toBeCloseTo(50, 4);
      }
    }
  });

  it("respects a custom color", () => {
    const polygons = tetrahedronPolygons({ color: "#ff0000" });
    for (const p of polygons) expect(p.color).toBe("#ff0000");
  });

  it("all faces are coplanar (triangles are always planar)", () => {
    // A triangle is always planar by definition — this test just confirms
    // vertex count doesn't accidentally introduce a 4th vertex.
    const polygons = tetrahedronPolygons({ size: 100 });
    for (const p of polygons) expect(p.vertices).toHaveLength(3);
  });

  it("all faces wind CCW from outside", () => {
    const polygons = tetrahedronPolygons({ size: 100 });
    const centroid: Vec3 = [0, 0, 0]; // tetrahedron is centered at origin
    for (const p of polygons) {
      expect(isCCWFromOutside(p.vertices, centroid)).toBe(true);
    }
  });

  it("all four face normals point in distinct directions", () => {
    const polygons = tetrahedronPolygons({ size: 100 });
    const normals = polygons.map((p) => {
      const [a, b, c] = p.vertices;
      const n = cross(sub(b, a), sub(c, a));
      const l = len(n);
      return [n[0] / l, n[1] / l, n[2] / l] as Vec3;
    });
    // No two normals should be identical (or antiparallel) — tetrahedron has 4 distinct faces.
    for (let i = 0; i < normals.length; i++) {
      for (let j = i + 1; j < normals.length; j++) {
        const d = Math.abs(dot(normals[i], normals[j]));
        // A regular tetrahedron has normals at ~109.5° apart, so |dot| ≈ 1/3.
        expect(d).toBeLessThan(0.99);
      }
    }
  });
});
