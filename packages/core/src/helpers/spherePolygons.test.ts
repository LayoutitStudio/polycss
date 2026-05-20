import { describe, expect, it } from "vitest";
import type { Vec3 } from "../types";
import { spherePolygons } from "./spherePolygons";

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

describe("spherePolygons", () => {
  it("default polygon count is 80 (icosahedron 20 × 4 at subdivisions 1)", () => {
    expect(spherePolygons()).toHaveLength(80);
  });

  it("returns correct counts at subdivisions 0/1/2/3", () => {
    expect(spherePolygons({ subdivisions: 0 })).toHaveLength(20);
    expect(spherePolygons({ subdivisions: 1 })).toHaveLength(80);
    expect(spherePolygons({ subdivisions: 2 })).toHaveLength(320);
    expect(spherePolygons({ subdivisions: 3 })).toHaveLength(1280);
  });

  it("every face is a triangle", () => {
    for (const p of spherePolygons()) {
      expect(p.vertices).toHaveLength(3);
    }
  });

  it("every face is coplanar (trivially true for triangles)", () => {
    // Three points always define a plane, so this is an invariant by definition.
    for (const p of spherePolygons()) {
      expect(p.vertices).toHaveLength(3);
    }
  });

  it("every face winds CCW from outside (outward normal = away from origin)", () => {
    const centroid: Vec3 = [0, 0, 0];
    for (const p of spherePolygons()) {
      expect(isCCWFromOutside(p.vertices, centroid)).toBe(true);
    }
  });

  it("default radius is 50, vertex magnitude ≈ 50 for every vertex", () => {
    const polygons = spherePolygons();
    for (const p of polygons) {
      for (const v of p.vertices) {
        expect(len(v)).toBeCloseTo(50, 4);
      }
    }
  });

  it("respects custom radius", () => {
    const polygons = spherePolygons({ radius: 200 });
    for (const p of polygons) {
      for (const v of p.vertices) {
        expect(len(v)).toBeCloseTo(200, 3);
      }
    }
  });

  it("respects custom color", () => {
    const polygons = spherePolygons({ color: "#abcdef" });
    for (const p of polygons) {
      expect(p.color).toBe("#abcdef");
    }
  });

  it("uses default color #cccccc", () => {
    const polygons = spherePolygons();
    for (const p of polygons) {
      expect(p.color).toBe("#cccccc");
    }
  });

  it("custom radius and subdivisions round-trip correctly", () => {
    const polygons = spherePolygons({ radius: 75, subdivisions: 2, color: "#112233" });
    expect(polygons).toHaveLength(320);
    for (const p of polygons) {
      expect(p.color).toBe("#112233");
      for (const v of p.vertices) {
        expect(len(v)).toBeCloseTo(75, 3);
      }
    }
  });

  it("subdivisions > 3 is clamped to 3", () => {
    expect(spherePolygons({ subdivisions: 5 })).toHaveLength(1280);
    expect(spherePolygons({ subdivisions: 10 })).toHaveLength(1280);
  });

  it("all face normals point outward (dot with face centroid > 0)", () => {
    const polygons = spherePolygons({ subdivisions: 1 });
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
});
