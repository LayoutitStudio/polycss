import { describe, expect, it } from "vitest";
import type { Polygon, Vec3 } from "../types";
import { simplifyTriangleMeshPolygons } from "./simplifyTriangleMesh";

function grid(size: number): Polygon[] {
  const polygons: Polygon[] = [];
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const a: Vec3 = [x, y, 0];
      const b: Vec3 = [x + 1, y, 0];
      const c: Vec3 = [x + 1, y + 1, 0];
      const d: Vec3 = [x, y + 1, 0];
      polygons.push(
        { vertices: [a, b, c], color: "#fff" },
        { vertices: [a, c, d], color: "#fff" },
      );
    }
  }
  return polygons;
}

function vertexKeys(polygons: Polygon[]): Set<string> {
  const keys = new Set<string>();
  for (const polygon of polygons) {
    for (const vertex of polygon.vertices) keys.add(vertex.join(","));
  }
  return keys;
}

function withSeamLayer(polygons: Polygon[], layer: string): Polygon[] {
  return polygons.map((polygon) => ({
    ...polygon,
    vertices: polygon.vertices.map((vertex) => [...vertex] as Vec3),
    simplifyVertexKeys: polygon.vertices.map((vertex) => `${layer}:${vertex.join(",")}`),
  }));
}

function translate(polygons: Polygon[], offset: Vec3): Polygon[] {
  return polygons.map((polygon) => ({
    ...polygon,
    vertices: polygon.vertices.map(([x, y, z]) => [
      x + offset[0],
      y + offset[1],
      z + offset[2],
    ] as Vec3),
  }));
}

describe("simplifyTriangleMeshPolygons", () => {
  it("reduces eligible solid triangle groups", () => {
    const source = grid(10);
    const simplified = simplifyTriangleMeshPolygons(source, {
      minGroupTriangles: 3,
      ratio: 0.5,
    });

    expect(simplified.length).toBeLessThan(source.length);
    expect(simplified.every((polygon) => polygon.vertices.length === 3)).toBe(true);
  });

  it("preserves original vertex positions by default", () => {
    const source = grid(10);
    const sourceKeys = vertexKeys(source);
    const simplified = simplifyTriangleMeshPolygons(source, {
      minGroupTriangles: 3,
      ratio: 0.5,
    });

    expect(simplified.length).toBeLessThan(source.length);
    for (const polygon of simplified) {
      for (const vertex of polygon.vertices) {
        expect(sourceKeys.has(vertex.join(","))).toBe(true);
      }
    }
  });

  it("skips non-manifold triangle groups", () => {
    const source: Polygon[] = [];
    const a: Vec3 = [0, 0, 0];
    const b: Vec3 = [1, 0, 0];
    for (let index = 0; index < 40; index += 1) {
      const angle = (index / 40) * Math.PI * 2;
      const c: Vec3 = [0.5, Math.cos(angle), Math.sin(angle)];
      source.push({ vertices: [a, b, c], color: "#fff" });
    }

    const simplified = simplifyTriangleMeshPolygons(source, {
      minGroupTriangles: 3,
      ratio: 0.5,
    });

    expect(simplified).toBe(source);
  });

  it("locks non-manifold vertices without skipping separate manifold regions", () => {
    const fan: Polygon[] = [];
    const a: Vec3 = [0, 0, 0];
    const b: Vec3 = [1, 0, 0];
    for (let index = 0; index < 40; index += 1) {
      const angle = (index / 40) * Math.PI * 2;
      const c: Vec3 = [0.5, Math.cos(angle), Math.sin(angle)];
      fan.push({ vertices: [a, b, c], color: "#fff" });
    }
    const source = [
      ...fan,
      ...translate(grid(8), [4, 0, 0]),
    ];

    const simplified = simplifyTriangleMeshPolygons(source, {
      minGroupTriangles: 3,
      ratio: 0.5,
    });

    expect(simplified).not.toBe(source);
    expect(simplified.length).toBeLessThan(source.length);
  });

  it("uses simplifier seam keys to keep overlapping islands manifold", () => {
    const source = [
      ...withSeamLayer(grid(8), "a"),
      ...withSeamLayer(grid(8), "b"),
    ];
    const simplified = simplifyTriangleMeshPolygons(source, {
      minGroupTriangles: 3,
      ratio: 0.5,
    });

    expect(simplified).not.toBe(source);
    expect(simplified.length).toBeLessThan(source.length);
  });

  it("can switch to stricter source vertex keys", () => {
    const source = grid(8).map((polygon) => ({
      ...polygon,
      simplifyVertexKeys: polygon.vertices.map((vertex) => `shared:${vertex.join(",")}`),
      simplifySourceVertexKeys: polygon.vertices.map((vertex) => `source:${vertex.join(",")}`),
    }));
    const relaxed = simplifyTriangleMeshPolygons(source, {
      minGroupTriangles: 3,
      ratio: 0.5,
    });
    const sourceKeyed = simplifyTriangleMeshPolygons(source, {
      minGroupTriangles: 3,
      ratio: 0.5,
      vertexKeyMode: "source",
    });

    expect(relaxed.length).toBeLessThan(source.length);
    expect(sourceKeyed.length).toBeLessThan(source.length);
  });

  it("keeps textured polygons out of the collapse graph", () => {
    const source = grid(10).map((polygon): Polygon => ({
      ...polygon,
      texture: "/texture.png",
      uvs: [[0, 0], [1, 0], [1, 1]],
    }));
    const simplified = simplifyTriangleMeshPolygons(source, {
      minGroupTriangles: 3,
      ratio: 0.5,
    });

    expect(simplified).toBe(source);
  });

  it("does not simplify across color boundaries", () => {
    const source = [
      ...grid(7).map((polygon) => ({ ...polygon, color: "#fff" })),
      ...grid(7).map((polygon) => ({
        ...polygon,
        vertices: polygon.vertices.map(([x, y, z]) => [x + 20, y, z] as Vec3),
        color: "#000",
      })),
    ];
    const simplified = simplifyTriangleMeshPolygons(source, {
      minGroupTriangles: 3,
      ratio: 0.5,
    });

    expect(simplified.some((polygon) => polygon.color === "#fff")).toBe(true);
    expect(simplified.some((polygon) => polygon.color === "#000")).toBe(true);
  });
});
