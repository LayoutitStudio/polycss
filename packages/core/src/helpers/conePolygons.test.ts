import { describe, expect, it } from "vitest";
import type { Vec3 } from "../types";
import { conePolygons } from "./conePolygons";

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

function isCoplanar(vertices: Vec3[], eps = 1e-4): boolean {
  if (vertices.length <= 3) return true;
  const [a, b, c, ...rest] = vertices;
  const n = cross(sub(b, a), sub(c, a));
  const nl = len(n);
  if (nl < 1e-10) return false;
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

function uniqueVertexCount(vertices: Vec3[]): number {
  return new Set(vertices.map((v) => v.map((x) => x.toFixed(6)).join(","))).size;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("conePolygons", () => {
  it("returns n side triangles + n bottom triangles for default 12 segments (no top cap)", () => {
    // 12 sides + 12 bottom (radiusTop = 0 → no top cap) = 24
    const polygons = conePolygons();
    expect(polygons).toHaveLength(24);
  });

  it("side polygons and cap polygons are triangles", () => {
    const n = 6;
    const polygons = conePolygons({ radialSegments: n });
    for (let i = 0; i < n; i++) expect(polygons[i].vertices).toHaveLength(3);
    for (let i = n; i < 2 * n; i++) expect(polygons[i].vertices).toHaveLength(3);
  });

  it("uses default radius 50, height 100, color #cccccc", () => {
    const polygons = conePolygons();
    for (const p of polygons) expect(p.color).toBe("#cccccc");
    const zVals = polygons.flatMap((p) => p.vertices.map((v) => v[2]));
    expect(Math.min(...zVals)).toBeCloseTo(-50, 5);
    expect(Math.max(...zVals)).toBeCloseTo(50, 5);
  });

  it("apex is a single point at the top (+Z)", () => {
    const polygons = conePolygons({ radialSegments: 6 });
    // Side triangles are ordered [bl, br, apex].
    const apexPoints = new Set<string>();
    for (let i = 0; i < 6; i++) {
      const apex = polygons[i].vertices[2];
      apexPoints.add(apex.map((x) => x.toFixed(6)).join(","));
    }
    // All apex vertices collapse to one point (0, 0, +height/2) = (0, 0, 50).
    expect(apexPoints.size).toBe(1);
    const apex = polygons[0].vertices[2];
    expect(apex[0]).toBeCloseTo(0, 5);
    expect(apex[1]).toBeCloseTo(0, 5);
    expect(apex[2]).toBeCloseTo(50, 5);
  });

  it("does not emit degenerate duplicate-vertex side polygons", () => {
    const n = 12;
    const polygons = conePolygons({ radialSegments: n });
    for (let i = 0; i < n; i++) expect(uniqueVertexCount(polygons[i].vertices)).toBe(3);
  });

  it("every face is coplanar within epsilon", () => {
    const polygons = conePolygons({ radialSegments: 12 });
    for (const p of polygons) expect(isCoplanar(p.vertices, 1e-4)).toBe(true);
  });

  it("all faces wind CCW from outside", () => {
    const polygons = conePolygons({ radialSegments: 8 });
    const centroid: Vec3 = [0, 0, 0];
    for (const p of polygons) {
      expect(isCCWFromOutside(p.vertices, centroid)).toBe(true);
    }
  });
});
