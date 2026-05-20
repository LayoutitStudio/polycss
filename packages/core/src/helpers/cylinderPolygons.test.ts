import { describe, expect, it } from "vitest";
import type { Vec3 } from "../types";
import { cylinderPolygons } from "./cylinderPolygons";

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

function faceCenter(vertices: Vec3[]): Vec3 {
  const c: Vec3 = [0, 0, 0];
  for (const v of vertices) { c[0] += v[0]; c[1] += v[1]; c[2] += v[2]; }
  return [c[0] / vertices.length, c[1] / vertices.length, c[2] / vertices.length];
}

function isCCWFromOutside(vertices: Vec3[], solidCentroid: Vec3): boolean {
  const [a, b, c] = vertices;
  const n = cross(sub(b, a), sub(c, a));
  const fc = faceCenter(vertices);
  return dot(n, sub(fc, solidCentroid)) > 0;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("cylinderPolygons", () => {
  it("returns the correct polygon count for a closed cylinder (default: 12 segments)", () => {
    // 12 side quads + 12 bottom triangles + 12 top triangles = 36
    const polygons = cylinderPolygons();
    expect(polygons).toHaveLength(36);
  });

  it("side quads have 4 vertices; cap triangles have 3 vertices", () => {
    const n = 8;
    const polygons = cylinderPolygons({ radialSegments: n });
    // First n = 8 polygons are side quads.
    for (let i = 0; i < n; i++) expect(polygons[i].vertices).toHaveLength(4);
    // Next 2n are cap triangles.
    for (let i = n; i < 3 * n; i++) expect(polygons[i].vertices).toHaveLength(3);
  });

  it("uses default radius 50, height 100, color #cccccc", () => {
    const polygons = cylinderPolygons();
    for (const p of polygons) expect(p.color).toBe("#cccccc");
    // All vertices should have |z| ≤ 50 (half height) — axis is Z (up).
    for (const p of polygons) {
      for (const v of p.vertices) expect(Math.abs(v[2])).toBeLessThanOrEqual(50 + 1e-6);
    }
    // Bottom-cap center is at z = -50; top-cap center at z = +50.
    const zVals = polygons.flatMap((p) => p.vertices.map((v) => v[2]));
    expect(Math.min(...zVals)).toBeCloseTo(-50, 5);
    expect(Math.max(...zVals)).toBeCloseTo(50, 5);
  });

  it("respects custom radius, height, radialSegments, and color", () => {
    const polygons = cylinderPolygons({ radius: 30, height: 60, radialSegments: 6, color: "#112233" });
    // 6 sides + 6 bottom + 6 top = 18
    expect(polygons).toHaveLength(18);
    for (const p of polygons) expect(p.color).toBe("#112233");
    const zVals = polygons.flatMap((p) => p.vertices.map((v) => v[2]));
    expect(Math.min(...zVals)).toBeCloseTo(-30, 5);
    expect(Math.max(...zVals)).toBeCloseTo(30, 5);
  });

  it("every face is coplanar within epsilon", () => {
    const polygons = cylinderPolygons({ radialSegments: 12 });
    for (const p of polygons) expect(isCoplanar(p.vertices, 1e-4)).toBe(true);
  });

  it("all faces wind CCW from outside", () => {
    const polygons = cylinderPolygons({ radialSegments: 8 });
    const centroid: Vec3 = [0, 0, 0]; // cylinder centered at origin
    for (const p of polygons) {
      expect(isCCWFromOutside(p.vertices, centroid)).toBe(true);
    }
  });

  it("omits top cap when radiusTop is 0", () => {
    const n = 6;
    const polygons = cylinderPolygons({ radialSegments: n, radiusTop: 0 });
    // n sides + n bottom cap (no top cap) = 2n
    expect(polygons).toHaveLength(2 * n);
  });

  it("supports a tapered cylinder (frustum)", () => {
    const n = 6;
    const polygons = cylinderPolygons({ radius: 40, radiusTop: 20, radialSegments: n });
    // n sides + n bottom + n top = 3n
    expect(polygons).toHaveLength(3 * n);
  });
});
