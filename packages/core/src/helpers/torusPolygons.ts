/**
 * Torus geometry — Z-axis ring plane.
 *
 * The torus is centered at the origin. The ring lies in the XY plane (the
 * ground plane in polycss world space, where Z is up). The donut hole points
 * along the Z axis.
 *
 * Geometry: `radialSegments × tubularSegments` quads on the surface.
 *
 * DOM cost note: at default settings (12 × 16 = 192 quads) this is the
 * heaviest of the built-in primitives. Reduce radialSegments / tubularSegments
 * if render budget is tight.
 *
 * Polycss world space: +X right, +Y forward, +Z up.
 */
import type { Polygon, Vec3 } from "../types";

export interface TorusPolygonsOptions {
  /** Distance from center of tube to center of torus. Default 50. */
  radius?: number;
  /** Radius of the tube. Default 15. */
  tube?: number;
  /** Number of segments around the main ring. Default 12. */
  radialSegments?: number;
  /** Number of segments around the tube cross-section. Default 16. */
  tubularSegments?: number;
  /** Fill color applied to all polygons. */
  color?: string;
}

/**
 * Compute one point on the torus surface.
 *
 * @param theta  Angle around the main ring (Z axis), in [0, 2π).
 * @param phi    Angle around the tube cross-section, in [0, 2π).
 * @param R      Main radius.
 * @param r      Tube radius.
 */
function torusPoint(theta: number, phi: number, R: number, r: number): Vec3 {
  // Ring lies in XY plane; tube sweeps around the Z axis.
  // Point on the tube cross-section at angle `theta` around the ring:
  //   ring center: (R·cos(θ), R·sin(θ), 0)
  //   tube outward radial: (cos(θ), sin(θ), 0)
  //   tube "up" (cross-section plane): (0, 0, 1)
  // Full point:
  //   x = (R + r·cos(φ)) · cos(θ)
  //   y = (R + r·cos(φ)) · sin(θ)
  //   z = r · sin(φ)
  const sinT = Math.sin(theta);
  const cosT = Math.cos(theta);
  const sinP = Math.sin(phi);
  const cosP = Math.cos(phi);
  return [
    (R + r * cosP) * cosT,
    (R + r * cosP) * sinT,
    r * sinP,
  ];
}

export function torusPolygons(options: TorusPolygonsOptions = {}): Polygon[] {
  const {
    radius = 50,
    tube = 15,
    radialSegments = 12,
    tubularSegments = 16,
    color = "#cccccc",
  } = options;

  const nr = Math.max(3, radialSegments);
  const nt = Math.max(3, tubularSegments);

  const polygons: Polygon[] = [];

  for (let i = 0; i < nr; i++) {
    const theta0 = (i / nr) * Math.PI * 2;
    const theta1 = ((i + 1) / nr) * Math.PI * 2;

    for (let j = 0; j < nt; j++) {
      const phi0 = (j / nt) * Math.PI * 2;
      const phi1 = ((j + 1) / nt) * Math.PI * 2;

      // Four corners of this quad on the torus surface.
      const p00 = torusPoint(theta0, phi0, radius, tube);
      const p10 = torusPoint(theta1, phi0, radius, tube);
      const p11 = torusPoint(theta1, phi1, radius, tube);
      const p01 = torusPoint(theta0, phi1, radius, tube);

      // CCW from outside in Z-up world space: ordering [p00, p10, p11, p01].
      // The outward normal at (θ, φ) is (cosφ·cosθ, cosφ·sinθ, sinφ); cross
      // of edges (p10−p00) × (p01−p00) points in that direction.
      polygons.push({ vertices: [p00, p10, p11, p01], color });
    }
  }

  return polygons;
}
