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
  // Find first non-degenerate triplet (some vertices may coincide at the cone apex).
  let n: Vec3 | null = null;
  let ref: Vec3 | null = null;
  for (let i = 0; i < vertices.length && n === null; i++) {
    for (let j = i + 1; j < vertices.length && n === null; j++) {
      for (let k = j + 1; k < vertices.length && n === null; k++) {
        const candidate = cross(sub(vertices[j], vertices[i]), sub(vertices[k], vertices[i]));
        if (len(candidate) > 1e-10) { n = candidate; ref = vertices[i]; }
      }
    }
  }
  if (n === null || ref === null) return true; // all points coincide — trivially coplanar
  const nl = len(n);
  for (const v of vertices) {
    const dist = Math.abs(dot(n, sub(v, ref!))) / nl;
    if (dist > eps) return false;
  }
  return true;
}

function isCCWFromOutside(vertices: Vec3[], solidCentroid: Vec3): boolean {
  // Find the first non-degenerate cross product (some quads are degenerate at cone apex).
  let n: Vec3 | null = null;
  for (let i = 0; i < vertices.length && n === null; i++) {
    const a = vertices[i];
    const b = vertices[(i + 1) % vertices.length];
    const c = vertices[(i + 2) % vertices.length];
    const candidate = cross(sub(b, a), sub(c, a));
    if (len(candidate) > 1e-10) n = candidate;
  }
  if (n === null) return true; // fully degenerate — skip
  const fc: Vec3 = [0, 0, 0];
  // Use only unique vertices for face center (avoid bias from duplicate apex point).
  const unique = vertices.filter((v, i) =>
    !vertices.slice(0, i).some((u) => u[0] === v[0] && u[1] === v[1] && u[2] === v[2]),
  );
  for (const v of unique) { fc[0] += v[0]; fc[1] += v[1]; fc[2] += v[2]; }
  fc[0] /= unique.length; fc[1] /= unique.length; fc[2] /= unique.length;
  return dot(n, sub(fc, solidCentroid)) > 0;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("conePolygons", () => {
  it("returns n side quads + n bottom triangles for default 12 segments (no top cap)", () => {
    // 12 sides + 12 bottom (radiusTop = 0 → no top cap) = 24
    const polygons = conePolygons();
    expect(polygons).toHaveLength(24);
  });

  it("side polygons have 4 vertices; cap triangles have 3 vertices", () => {
    const n = 6;
    const polygons = conePolygons({ radialSegments: n });
    for (let i = 0; i < n; i++) expect(polygons[i].vertices).toHaveLength(4);
    for (let i = n; i < 2 * n; i++) expect(polygons[i].vertices).toHaveLength(3);
  });

  it("uses default radius 50, height 100, color #cccccc", () => {
    const polygons = conePolygons();
    for (const p of polygons) expect(p.color).toBe("#cccccc");
    const yVals = polygons.flatMap((p) => p.vertices.map((v) => v[1]));
    expect(Math.min(...yVals)).toBeCloseTo(-50, 5);
    expect(Math.max(...yVals)).toBeCloseTo(50, 5);
  });

  it("apex is a single point at the top (+Y)", () => {
    const polygons = conePolygons({ radialSegments: 6 });
    // Side quads are ordered [bl, tl, tr, br] where tl and tr are the apex-level vertices.
    const apexPoints = new Set<string>();
    for (let i = 0; i < 6; i++) {
      // vertices[1] = tl, vertices[2] = tr — both collapse to apex when radiusTop = 0.
      const tl = polygons[i].vertices[1];
      const tr = polygons[i].vertices[2];
      apexPoints.add(tl.map((x) => x.toFixed(6)).join(","));
      apexPoints.add(tr.map((x) => x.toFixed(6)).join(","));
    }
    // All apex vertices collapse to one point (0, +height/2, 0) = (0, 50, 0).
    expect(apexPoints.size).toBe(1);
    const apex = polygons[0].vertices[1]; // tl of first side quad
    expect(apex[0]).toBeCloseTo(0, 5);
    expect(apex[1]).toBeCloseTo(50, 5);
    expect(apex[2]).toBeCloseTo(0, 5);
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
