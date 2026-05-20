/**
 * Icosphere (subdivided icosahedron) geometry — approximates a sphere with
 * triangular faces. Each subdivision step quadruples the face count:
 *   subdivisions 0 → 20, 1 → 80, 2 → 320, 3 → 1280 (capped).
 *
 * Vertex coordinates use polycss world space: +X right, +Y forward, +Z up.
 * The sphere is centered at the origin; all vertices sit at distance `radius`.
 * Faces wind CCW from the outside (outward normal = away from origin).
 */
import type { Polygon, Vec3 } from "../types";

export interface SpherePolygonsOptions {
  /** Radius of the sphere. Default 50. */
  radius?: number;
  /** Subdivision level (0 = bare icosahedron, 20 triangles; each +1 quadruples count). Default 1 → 80 triangles. Cap at 3 (1280 triangles). */
  subdivisions?: number;
  /** Fill color applied to all faces. */
  color?: string;
}

export function spherePolygons(options: SpherePolygonsOptions = {}): Polygon[] {
  const { radius = 50, color = "#cccccc" } = options;
  // Cap subdivisions at 3 (1280 triangles) to prevent accidental extreme DOM cost.
  const subdivisions = Math.min(Math.max(0, Math.floor(options.subdivisions ?? 1)), 3);

  const phi = (1 + Math.sqrt(5)) / 2;

  // 12 vertices of a regular icosahedron, normalized to the unit sphere.
  let verts: Vec3[] = [
    [-1,  phi, 0],
    [ 1,  phi, 0],
    [-1, -phi, 0],
    [ 1, -phi, 0],
    [0, -1,  phi],
    [0,  1,  phi],
    [0, -1, -phi],
    [0,  1, -phi],
    [ phi, 0, -1],
    [ phi, 0,  1],
    [-phi, 0, -1],
    [-phi, 0,  1],
  ].map(([x, y, z]) => {
    const l = Math.sqrt(x * x + y * y + z * z);
    return [x / l, y / l, z / l] as Vec3;
  });

  // 20 triangular faces wound CCW from the outside.
  let faces: [number, number, number][] = [
    [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11],
    [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
    [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9],
    [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1],
  ];

  // Subdivide: each triangle is split into 4 by inserting midpoints on each
  // edge. Midpoints are projected back onto the unit sphere to preserve the
  // spherical shape.
  for (let s = 0; s < subdivisions; s++) {
    const newVerts: Vec3[] = [...verts];
    const newFaces: [number, number, number][] = [];
    const midCache = new Map<string, number>();

    const midpoint = (i: number, j: number): number => {
      const key = i < j ? `${i}-${j}` : `${j}-${i}`;
      const cached = midCache.get(key);
      if (cached !== undefined) return cached;
      const a = verts[i], b = verts[j];
      let mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2, mz = (a[2] + b[2]) / 2;
      const l = Math.sqrt(mx * mx + my * my + mz * mz);
      mx /= l; my /= l; mz /= l;
      const idx = newVerts.length;
      newVerts.push([mx, my, mz]);
      midCache.set(key, idx);
      return idx;
    };

    for (const [a, b, c] of faces) {
      const ab = midpoint(a, b);
      const bc = midpoint(b, c);
      const ca = midpoint(c, a);
      newFaces.push([a, ab, ca]);
      newFaces.push([b, bc, ab]);
      newFaces.push([c, ca, bc]);
      newFaces.push([ab, bc, ca]);
    }

    verts = newVerts;
    faces = newFaces;
  }

  // Scale from unit sphere to the requested radius.
  const scaled: Vec3[] = verts.map(([x, y, z]) => [x * radius, y * radius, z * radius]);

  return faces.map(([a, b, c]) => ({
    vertices: [scaled[a], scaled[b], scaled[c]],
    color,
  }));
}
