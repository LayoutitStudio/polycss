/**
 * Torus geometry — Y-axis ring plane.
 *
 * The torus is centered at the origin. The ring lies in the XZ plane (the
 * horizontal plane in polycss world space, where Y is forward/depth). The
 * tube sweeps around the Y axis.
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
 * @param theta  Angle around the main ring (Y axis), in [0, 2π).
 * @param phi    Angle around the tube cross-section, in [0, 2π).
 * @param R      Main radius.
 * @param r      Tube radius.
 */
function torusPoint(theta: number, phi: number, R: number, r: number): Vec3 {
  // Ring lies in XZ plane; tube sweeps around Y axis.
  // Point on the tube cross-section at angle `theta` around the ring:
  //   ring center: (R·cos(θ), 0, R·sin(θ))
  //   tube offset: outward radial direction is (cos(θ), 0, sin(θ))
  //                tube "up" direction (in the cross-section plane) is (0, 1, 0)
  // So the full point is:
  //   x = (R + r·cos(φ)) · cos(θ)
  //   y = r · sin(φ)
  //   z = (R + r·cos(φ)) · sin(θ)
  const sinT = Math.sin(theta);
  const cosT = Math.cos(theta);
  const sinP = Math.sin(phi);
  const cosP = Math.cos(phi);
  return [
    (R + r * cosP) * cosT,
    r * sinP,
    (R + r * cosP) * sinT,
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

  const R = Math.max(0, radialSegments);   // re-use var name below
  const nr = Math.max(3, radialSegments);
  const nt = Math.max(3, tubularSegments);
  void R; // suppress unused warning; use nr/nt below

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

      // Wind CCW from outside. The outward normal at point (theta, phi) is
      // (cos(phi)·cos(theta), sin(phi), cos(phi)·sin(theta)).
      // Verified: cross((p00→p01), (p00→p10)) opposes this, so the correct
      // CCW ordering (outward normal = cross(e1, e2) where e1=p00→first, e2=p00→second)
      // is [p00, p01, p11, p10].
      polygons.push({ vertices: [p00, p01, p11, p10], color });
    }
  }

  return polygons;
}
