import { describe, expect, it } from "vitest";
import type { Vec3 } from "../types";
import { torusPolygons } from "./torusPolygons";

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

function isCoplanar(vertices: Vec3[], eps = 1e-3): boolean {
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

/**
 * Returns true if the outward normal of the face (from first-edge cross product)
 * points away from the torus surface interior.
 *
 * For a torus quad, "outward" means the normal points away from the nearest
 * point on the ring axis circle. The outward direction at face center fc is
 * (fc - ringPoint) where ringPoint = (|fc.xz| * normalized(fc.xz), 0) projected
 * onto the XZ plane. Simplified: the component perpendicular to the ring axis
 * circle at that angular position.
 */
function isCCWFromOutside(vertices: Vec3[], radius: number): boolean {
  const [a, b, c] = vertices;
  const n = cross(sub(b, a), sub(c, a));
  const fc: Vec3 = [0, 0, 0];
  for (const v of vertices) { fc[0] += v[0]; fc[1] += v[1]; fc[2] += v[2]; }
  fc[0] /= vertices.length; fc[1] /= vertices.length; fc[2] /= vertices.length;
  // Ring center at the same angular position as fc (in XZ plane).
  const fcXZ = Math.sqrt(fc[0] * fc[0] + fc[2] * fc[2]);
  if (fcXZ < 1e-10) return true; // degenerate — skip
  const ringX = (fc[0] / fcXZ) * radius;
  const ringZ = (fc[2] / fcXZ) * radius;
  const outDir: Vec3 = [fc[0] - ringX, fc[1], fc[2] - ringZ];
  return dot(n, outDir) > 0;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("torusPolygons", () => {
  it("returns radialSegments × tubularSegments quads (default: 12 × 16 = 192)", () => {
    const polygons = torusPolygons();
    expect(polygons).toHaveLength(192);
    for (const p of polygons) expect(p.vertices).toHaveLength(4);
  });

  it("uses default color #cccccc", () => {
    const polygons = torusPolygons();
    for (const p of polygons) expect(p.color).toBe("#cccccc");
  });

  it("respects custom segment counts", () => {
    const polygons = torusPolygons({ radialSegments: 6, tubularSegments: 8 });
    expect(polygons).toHaveLength(48);
  });

  it("respects custom radius, tube, and color", () => {
    const polygons = torusPolygons({ radius: 80, tube: 20, color: "#aabbcc", radialSegments: 4, tubularSegments: 4 });
    expect(polygons).toHaveLength(16);
    for (const p of polygons) expect(p.color).toBe("#aabbcc");
    // All vertices should be within [radius - tube, radius + tube] of the Y axis.
    for (const p of polygons) {
      for (const [x, , z] of p.vertices) {
        const rDist = Math.sqrt(x * x + z * z);
        expect(rDist).toBeGreaterThanOrEqual(80 - 20 - 1e-4);
        expect(rDist).toBeLessThanOrEqual(80 + 20 + 1e-4);
      }
    }
  });

  it("every quad is coplanar within epsilon", () => {
    // Torus quads are constructed by sampling at equal angular steps; each quad
    // is exactly planar (bilinear patch with zero twist at symmetric parametric spacing).
    const polygons = torusPolygons({ radialSegments: 12, tubularSegments: 16 });
    for (const p of polygons) {
      expect(isCoplanar(p.vertices, 1e-3)).toBe(true);
    }
  });

  it("all faces wind CCW from outside (outward normal points away from tube axis)", () => {
    const r = 50;
    const polygons = torusPolygons({ radius: r, radialSegments: 8, tubularSegments: 8 });
    for (const p of polygons) {
      expect(isCCWFromOutside(p.vertices, r)).toBe(true);
    }
  });

  it("Y coordinates span the tube diameter (−tube to +tube)", () => {
    const polygons = torusPolygons({ tube: 20, radialSegments: 4, tubularSegments: 16 });
    const yVals = polygons.flatMap((p) => p.vertices.map((v) => v[1]));
    expect(Math.min(...yVals)).toBeCloseTo(-20, 4);
    expect(Math.max(...yVals)).toBeCloseTo(20, 4);
  });
});
