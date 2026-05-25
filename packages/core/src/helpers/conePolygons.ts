/**
 * Z-axis cone geometry — a cylinder with `radiusTop: 0`.
 *
 * This is a thin wrapper around `cylinderPolygons` with `radiusTop` forced
 * to zero. The top cap is omitted (no area at the tip), and side faces are
 * emitted as triangles.
 *
 * PolyCSS world space: +X right, +Y forward, +Z up. Cone axis is Z; the apex
 * is at Z = +height/2 and the base at Z = -height/2.
 */
import type { Polygon } from "../types";
import { cylinderPolygons } from "./cylinderPolygons";

export interface ConePolygonsOptions {
  /** Base radius. Default 50. */
  radius?: number;
  /** Height along the Z axis. Default 100. */
  height?: number;
  /** Number of radial segments. Default 12. */
  radialSegments?: number;
  /** Fill color applied to all polygons. */
  color?: string;
}

export function conePolygons(options: ConePolygonsOptions = {}): Polygon[] {
  return cylinderPolygons({ ...options, radiusTop: 0 });
}
