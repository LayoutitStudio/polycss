import { describe, expect, it } from "vitest";
import type { Polygon, Vec3 } from "../types";
import { computeTextureAtlasPlanPublic } from "../atlas/plan";
import { arrowPolygons } from "./arrowPolygons";
import { axesHelperPolygons } from "./axesPolygons";
import { boxPolygons } from "./boxPolygons";
import { conePolygons } from "./conePolygons";
import { cylinderPolygons } from "./cylinderPolygons";
import { dodecahedronPolygons } from "./dodecahedronPolygons";
import { icosahedronPolygons } from "./icosahedronPolygons";
import { octahedronPolygons } from "./octahedronPolygons";
import { planePolygons } from "./planePolygons";
import { ringPolygons } from "./ringPolygons";
import { ringQuadPolygons } from "./ringQuadPolygons";
import { spherePolygons } from "./spherePolygons";
import { tetrahedronPolygons } from "./tetrahedronPolygons";
import { torusPolygons } from "./torusPolygons";

const EPS = 1e-8;
const PLANAR_EPS = 1e-4;

function sub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function len(v: Vec3): number {
  return Math.hypot(v[0], v[1], v[2]);
}

function faceNormal(vertices: Vec3[]): Vec3 | null {
  const origin = vertices[0];
  for (let i = 1; i + 1 < vertices.length; i += 1) {
    const n = cross(sub(vertices[i], origin), sub(vertices[i + 1], origin));
    const nLen = len(n);
    if (nLen > EPS) return [n[0] / nLen, n[1] / nLen, n[2] / nLen];
  }
  return null;
}

function faceArea(vertices: Vec3[]): number {
  const n = faceNormal(vertices);
  if (!n) return 0;
  const sum: Vec3 = [0, 0, 0];
  for (let i = 0; i < vertices.length; i += 1) {
    const c = cross(vertices[i], vertices[(i + 1) % vertices.length]);
    sum[0] += c[0];
    sum[1] += c[1];
    sum[2] += c[2];
  }
  return Math.abs(dot(sum, n)) / 2;
}

function uniqueVertexCount(vertices: Vec3[]): number {
  return new Set(vertices.map((v) => v.map((x) => x.toFixed(9)).join(","))).size;
}

function maxPlaneDistance(vertices: Vec3[]): number {
  const n = faceNormal(vertices);
  if (!n) return Infinity;
  const origin = vertices[0];
  let max = 0;
  for (const v of vertices) {
    max = Math.max(max, Math.abs(dot(n, sub(v, origin))));
  }
  return max;
}

function expectRenderablePrimitive(name: string, polygons: Polygon[]): void {
  expect(polygons.length, `${name} polygon count`).toBeGreaterThan(0);
  for (let i = 0; i < polygons.length; i += 1) {
    const polygon = polygons[i];
    expect(polygon.vertices.length, `${name}[${i}] vertex count`).toBeGreaterThanOrEqual(3);
    for (const vertex of polygon.vertices) {
      expect(vertex.every(Number.isFinite), `${name}[${i}] finite vertex`).toBe(true);
    }
    expect(uniqueVertexCount(polygon.vertices), `${name}[${i}] duplicate vertices`).toBe(polygon.vertices.length);
    expect(faceArea(polygon.vertices), `${name}[${i}] face area`).toBeGreaterThan(EPS);
    if (polygon.vertices.length > 3) {
      expect(maxPlaneDistance(polygon.vertices), `${name}[${i}] coplanarity`).toBeLessThanOrEqual(PLANAR_EPS);
    }
    expect(computeTextureAtlasPlanPublic(polygon, i), `${name}[${i}] atlas plan`).not.toBeNull();
  }
}

describe("primitive geometry invariants", () => {
  const cases: Array<[string, () => Polygon[]]> = [
    ["box", () => boxPolygons()],
    ["plane x", () => planePolygons({ axis: 0 })],
    ["plane y", () => planePolygons({ axis: 1 })],
    ["plane z", () => planePolygons({ axis: 2 })],
    ["ring x", () => ringPolygons({ axis: 0, radius: 2 })],
    ["ring y", () => ringPolygons({ axis: 1, radius: 2 })],
    ["ring z", () => ringPolygons({ axis: 2, radius: 2 })],
    ["ring quad x", () => ringQuadPolygons({ axis: 0, outerRadius: 2 })],
    ["ring quad y", () => ringQuadPolygons({ axis: 1, outerRadius: 2 })],
    ["ring quad z", () => ringQuadPolygons({ axis: 2, outerRadius: 2 })],
    ["cylinder", () => cylinderPolygons()],
    ["cylinder top cone-tip", () => cylinderPolygons({ radiusTop: 0 })],
    ["cylinder bottom cone-tip", () => cylinderPolygons({ radius: 0, radiusTop: 50 })],
    ["cone", () => conePolygons()],
    ["tetrahedron", () => tetrahedronPolygons()],
    ["octahedron", () => octahedronPolygons({ center: [0, 0, 0], size: 100 })],
    ["icosahedron", () => icosahedronPolygons()],
    ["dodecahedron", () => dodecahedronPolygons()],
    ["sphere", () => spherePolygons()],
    ["torus", () => torusPolygons()],
    ["axes helper", () => axesHelperPolygons()],
    ["arrow x", () => arrowPolygons({ axis: 0 })],
    ["arrow y", () => arrowPolygons({ axis: 1 })],
    ["arrow z", () => arrowPolygons({ axis: 2 })],
    ["arrow negative x", () => arrowPolygons({ axis: 0, sign: -1 })],
    ["arrow negative y", () => arrowPolygons({ axis: 1, sign: -1 })],
    ["arrow negative z", () => arrowPolygons({ axis: 2, sign: -1 })],
  ];

  it.each(cases)("%s emits renderable non-degenerate polygons", (name, build) => {
    expectRenderablePrimitive(name, build());
  });
});
