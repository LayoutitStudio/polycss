/**
 * Regular icosahedron geometry — 20 equilateral triangular faces.
 *
 * Vertices are placed on a sphere of radius `size` centered at the origin.
 * Faces wind CCW from the outside.
 *
 * PolyCSS world space: +X right, +Y forward, +Z up.
 */
import type { Polygon, Vec3 } from "../types";

export interface IcosahedronPolygonsOptions {
  /** Circumradius: distance from center to each vertex. Default 100. */
  size?: number;
  /** Fill color applied to all 20 faces. */
  color?: string;
}

export function icosahedronPolygons(options: IcosahedronPolygonsOptions = {}): Polygon[] {
  const { size = 100, color = "#cccccc" } = options;

  // Icosahedron vertices via the golden-ratio construction.
  // Three orthogonal golden rectangles yield 12 vertices on the unit sphere.
  const phi = (1 + Math.sqrt(5)) / 2;
  // Normalization so all vertices sit exactly at radius `size`.
  const scale = size / Math.sqrt(1 + phi * phi);

  const v: Vec3[] = [
    [-1,  phi, 0],  //  0
    [ 1,  phi, 0],  //  1
    [-1, -phi, 0],  //  2
    [ 1, -phi, 0],  //  3
    [0, -1,  phi],  //  4
    [0,  1,  phi],  //  5
    [0, -1, -phi],  //  6
    [0,  1, -phi],  //  7
    [ phi, 0, -1],  //  8
    [ phi, 0,  1],  //  9
    [-phi, 0, -1],  // 10
    [-phi, 0,  1],  // 11
  ].map(([x, y, z]) => [x * scale, y * scale, z * scale] as Vec3);

  // 20 triangular faces, wound CCW from outside.
  const faces: [number, number, number][] = [
    // Top cap (around vertex 1, the north pole)
    [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11],
    // Upper ring
    [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
    // Lower ring
    [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9],
    // Bottom cap (around vertex 3, the south pole)
    [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1],
  ];

  return faces.map(([a, b, c]) => ({
    vertices: [v[a], v[b], v[c]],
    color,
  }));
}
