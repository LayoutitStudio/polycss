/**
 * Regular dodecahedron geometry — 12 regular pentagonal faces.
 *
 * Vertices are placed on a sphere of radius `size` centered at the origin.
 * Each face is a pentagon (5 vertices) wound CCW from the outside.
 *
 * All 12 pentagonal faces of a regular dodecahedron are truly planar — each
 * lies on a single tangent plane. No triangulation is needed. The renderer
 * uses <i> (border-shape) on Chromium and <s> elsewhere for non-quad polygons.
 *
 * Polycss world space: +X right, +Y forward, +Z up.
 */
import type { Polygon, Vec3 } from "../types";

export interface DodecahedronPolygonsOptions {
  /** Circumradius: distance from center to each vertex. Default 100. */
  size?: number;
  /** Fill color applied to all 12 faces. */
  color?: string;
}

export function dodecahedronPolygons(options: DodecahedronPolygonsOptions = {}): Polygon[] {
  const { size = 100, color = "#cccccc" } = options;

  // A regular dodecahedron has 20 vertices built from three classes:
  //
  //   • 8 cube corners:             (±1, ±1, ±1)
  //   • 4 on the YZ golden rect:    (0,  ±q, ±φ)
  //   • 4 on the XZ golden rect:    (±q, ±φ,  0)
  //   • 4 on the XY golden rect:    (±φ,  0, ±q)
  //
  // where φ = golden ratio ≈ 1.618 and q = 1/φ ≈ 0.618.
  // All 20 raw vertices lie on a sphere of radius √3; we scale to `size`.
  const phi = (1 + Math.sqrt(5)) / 2;
  const q = 1 / phi;

  const scale = size / Math.sqrt(3);

  const raw: Vec3[] = [
    // cube corners
    [ 1,  1,  1],  //  0
    [ 1,  1, -1],  //  1
    [ 1, -1,  1],  //  2
    [ 1, -1, -1],  //  3
    [-1,  1,  1],  //  4
    [-1,  1, -1],  //  5
    [-1, -1,  1],  //  6
    [-1, -1, -1],  //  7
    // golden-rectangle class A: (0, ±q, ±φ)
    [0,  q,  phi],  //  8
    [0, -q,  phi],  //  9
    [0,  q, -phi],  // 10
    [0, -q, -phi],  // 11
    // golden-rectangle class B: (±q, ±φ, 0)
    [ q,  phi, 0],  // 12
    [-q,  phi, 0],  // 13
    [ q, -phi, 0],  // 14
    [-q, -phi, 0],  // 15
    // golden-rectangle class C: (±φ, 0, ±q)
    [ phi, 0,  q],  // 16
    [ phi, 0, -q],  // 17
    [-phi, 0,  q],  // 18
    [-phi, 0, -q],  // 19
  ];

  const v: Vec3[] = raw.map(([x, y, z]) => [x * scale, y * scale, z * scale]);

  // 12 pentagonal faces, each with 5 vertex indices ordered CCW from outside.
  // Derived by graph-traversal on the edge adjacency of the dodecahedron
  // (edges connect vertices at distance 2/φ ≈ 1.236 in the raw unit coordinates).
  const faceIndices: number[][] = [
    [12, 13,  4,  8,  0],
    [ 0,  8,  9,  2, 16],
    [16, 17,  1, 12,  0],
    [ 1, 10,  5, 13, 12],
    [17,  3, 11, 10,  1],
    [ 2,  9,  6, 15, 14],
    [ 2, 14,  3, 17, 16],
    [14, 15,  7, 11,  3],
    [18,  6,  9,  8,  4],
    [ 4, 13,  5, 19, 18],
    [ 5, 10, 11,  7, 19],
    [18, 19,  7, 15,  6],
  ];

  return faceIndices.map((indices) => ({
    vertices: indices.map((i) => v[i]),
    color,
  }));
}
