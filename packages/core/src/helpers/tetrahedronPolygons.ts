/**
 * Regular tetrahedron geometry — four equilateral triangular faces.
 *
 * Vertices are placed so the tetrahedron is centered at the origin.
 * Faces wind CCW from the outside.
 *
 * Polycss world space: +X right, +Y forward, +Z up.
 */
import type { Polygon, Vec3 } from "../types";

export interface TetrahedronPolygonsOptions {
  /** Circumradius: distance from center to each vertex. Default 100. */
  size?: number;
  /** Fill color applied to all four faces. */
  color?: string;
}

export function tetrahedronPolygons(options: TetrahedronPolygonsOptions = {}): Polygon[] {
  const { size = 100, color = "#cccccc" } = options;

  // Four vertices of a regular tetrahedron inscribed in a sphere of radius `size`.
  // Coordinates chosen so the solid is roughly upright (+Z dominant top vertex).
  //
  // Standard derivation: place two base vertices in the XY plane and two
  // at +/-X, then lift the apex.
  //
  // Using the canonical form:
  //   v0 = ( 1,  1,  1) * k
  //   v1 = ( 1, -1, -1) * k
  //   v2 = (-1,  1, -1) * k
  //   v3 = (-1, -1,  1) * k
  // Each has magnitude sqrt(3)*k, so k = size / sqrt(3).
  const k = size / Math.sqrt(3);
  const v: Vec3[] = [
    [ k,  k,  k],  // 0
    [ k, -k, -k],  // 1
    [-k,  k, -k],  // 2
    [-k, -k,  k],  // 3
  ];

  // Four triangular faces, wound CCW from outside.
  // Winding verified by checking that cross(e01, e02) points away from the
  // origin (the centroid of the centered tetrahedron).
  const faces: [number, number, number][] = [
    [0, 1, 2],  // bottom
    [0, 3, 1],  // right
    [0, 2, 3],  // left
    [1, 3, 2],  // back
  ];

  return faces.map(([a, b, c]) => ({
    vertices: [v[a], v[b], v[c]],
    color,
  }));
}
