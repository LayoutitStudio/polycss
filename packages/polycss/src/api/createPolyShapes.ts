/**
 * Primitive shape factories — thin wrappers over the polygon generators in
 * @layoutit/polycss-core. Each returns a `ParseResult`-compatible object so
 * it composes directly with `scene.add(createPolyBox({ size: 100 }))`.
 */
import type { ParseResult, Polygon } from "@layoutit/polycss-core";
import {
  boxPolygons,
  planePolygons,
  ringPolygons,
  octahedronPolygons,
  spherePolygons,
  tetrahedronPolygons,
  icosahedronPolygons,
  dodecahedronPolygons,
  cylinderPolygons,
  conePolygons,
  torusPolygons,
  type BoxPolygonsOptions,
  type PlanePolygonsOptions,
  type RingPolygonsOptions,
  type OctahedronPolygonsOptions,
  type SpherePolygonsOptions,
  type TetrahedronPolygonsOptions,
  type IcosahedronPolygonsOptions,
  type DodecahedronPolygonsOptions,
  type CylinderPolygonsOptions,
  type ConePolygonsOptions,
  type TorusPolygonsOptions,
} from "@layoutit/polycss-core";

export type { BoxPolygonsOptions, PlanePolygonsOptions, RingPolygonsOptions, OctahedronPolygonsOptions, SpherePolygonsOptions, TetrahedronPolygonsOptions, IcosahedronPolygonsOptions, DodecahedronPolygonsOptions, CylinderPolygonsOptions, ConePolygonsOptions, TorusPolygonsOptions };

// Re-export ParseResult so callers can type the return value without a
// separate import from polycss-core.
export type { ParseResult as PolyShapeResult };

function shapeResult(polygons: Polygon[]): ParseResult {
  return { polygons, objectUrls: [], warnings: [], dispose: () => { /* no URLs to revoke */ } };
}

export function createPolyBox(options: BoxPolygonsOptions = {}): ParseResult {
  return shapeResult(boxPolygons(options));
}

export function createPolyPlane(options: PlanePolygonsOptions): ParseResult {
  return shapeResult(planePolygons(options));
}

export function createPolyRing(options: RingPolygonsOptions): ParseResult {
  return shapeResult(ringPolygons(options));
}

export function createPolyOctahedron(options: OctahedronPolygonsOptions): ParseResult {
  return shapeResult(octahedronPolygons(options));
}

export function createPolySphere(options: SpherePolygonsOptions = {}): ParseResult {
  return shapeResult(spherePolygons(options));
}

export function createPolyTetrahedron(options: TetrahedronPolygonsOptions = {}): ParseResult {
  return shapeResult(tetrahedronPolygons(options));
}

export function createPolyIcosahedron(options: IcosahedronPolygonsOptions = {}): ParseResult {
  return shapeResult(icosahedronPolygons(options));
}

export function createPolyDodecahedron(options: DodecahedronPolygonsOptions = {}): ParseResult {
  return shapeResult(dodecahedronPolygons(options));
}

export function createPolyCylinder(options: CylinderPolygonsOptions = {}): ParseResult {
  return shapeResult(cylinderPolygons(options));
}

export function createPolyCone(options: ConePolygonsOptions = {}): ParseResult {
  return shapeResult(conePolygons(options));
}

export function createPolyTorus(options: TorusPolygonsOptions = {}): ParseResult {
  return shapeResult(torusPolygons(options));
}
