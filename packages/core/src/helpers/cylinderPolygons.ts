/**
 * Y-axis cylinder geometry with optional radius taper.
 *
 * Geometry:
 *   - `radialSegments` side quads (one per angular segment).
 *   - `radialSegments` bottom-cap triangles (fan from center).
 *   - `radialSegments` top-cap triangles (fan from center), omitted when
 *     radiusTop ≈ 0 (i.e. cone tip).
 *
 * The cylinder sits centered at the origin, spanning Y = −height/2 to
 * Y = +height/2. Side quads are axis-aligned in the cylinder's own local
 * frame, which maximises the chance of hitting the <b> quad fast-path.
 *
 * Polycss world space: +X right, +Y forward, +Z up. The cylinder axis is
 * the Y axis so a typical upright pillar needs a 90° X-rotation in the mesh.
 */
import type { Polygon, Vec3 } from "../types";

export interface CylinderPolygonsOptions {
  /** Bottom-cap radius. Default 50. */
  radius?: number;
  /** Top-cap radius. Defaults to `radius` (straight cylinder).
   *  Set to 0 (or near 0) for a cone. */
  radiusTop?: number;
  /** Height along the Y axis. Default 100. */
  height?: number;
  /** Number of radial segments (quads on the side). Default 12. */
  radialSegments?: number;
  /** Fill color applied to all polygons. */
  color?: string;
}

/** Threshold below which `radiusTop` is treated as zero (cone tip, no cap). */
const RADIUS_ZERO_EPS = 1e-6;

export function cylinderPolygons(options: CylinderPolygonsOptions = {}): Polygon[] {
  const {
    radius = 50,
    height = 100,
    radialSegments = 12,
    color = "#cccccc",
  } = options;
  const radiusTop = options.radiusTop ?? radius;

  const halfH = height / 2;
  const yBottom = -halfH;
  const yTop = halfH;
  const n = Math.max(3, radialSegments);
  const polygons: Polygon[] = [];

  // Pre-compute the angle for each segment boundary.
  const angles: number[] = Array.from({ length: n + 1 }, (_, i) => (i / n) * Math.PI * 2);

  // ── Side quads ───────────────────────────────────────────────────────────
  // One quad per segment: [bottomLeft, topLeft, topRight, bottomRight] — CCW from outside.
  for (let i = 0; i < n; i++) {
    const a0 = angles[i];
    const a1 = angles[i + 1];
    const bx0 = Math.cos(a0) * radius;
    const bz0 = Math.sin(a0) * radius;
    const bx1 = Math.cos(a1) * radius;
    const bz1 = Math.sin(a1) * radius;
    const tx0 = Math.cos(a0) * radiusTop;
    const tz0 = Math.sin(a0) * radiusTop;
    const tx1 = Math.cos(a1) * radiusTop;
    const tz1 = Math.sin(a1) * radiusTop;

    const bl: Vec3 = [bx0, yBottom, bz0];
    const br: Vec3 = [bx1, yBottom, bz1];
    const tr: Vec3 = [tx1, yTop,    tz1];
    const tl: Vec3 = [tx0, yTop,    tz0];

    // CCW from outside: the outward normal points away from the cylinder axis.
    // Verified: cross(bl→tl, bl→br) must point outward, so the ordering is [bl, tl, tr, br].
    polygons.push({ vertices: [bl, tl, tr, br], color });
  }

  // ── Bottom cap (radius > 0) ──────────────────────────────────────────────
  // Triangle fan from the bottom center. Fan winds CCW looking from below (−Y),
  // i.e. [center, v[i+1], v[i]] so the outward normal is −Y.
  if (radius > RADIUS_ZERO_EPS) {
    const center: Vec3 = [0, yBottom, 0];
    for (let i = 0; i < n; i++) {
      const a0 = angles[i];
      const a1 = angles[i + 1];
      const p0: Vec3 = [Math.cos(a0) * radius, yBottom, Math.sin(a0) * radius];
      const p1: Vec3 = [Math.cos(a1) * radius, yBottom, Math.sin(a1) * radius];
      // CCW from outside (below) → outward normal is (0, -1, 0).
      // Verified: cross(center→p0, center→p1) = (0, -1, 0) for increasing angle.
      polygons.push({ vertices: [[...center], [...p0], [...p1]], color });
    }
  }

  // ── Top cap (radiusTop > 0) ──────────────────────────────────────────────
  // Triangle fan from the top center. CCW looking from above (+Y):
  // [center, v[i], v[i+1]].
  if (radiusTop > RADIUS_ZERO_EPS) {
    const center: Vec3 = [0, yTop, 0];
    for (let i = 0; i < n; i++) {
      const a0 = angles[i];
      const a1 = angles[i + 1];
      const p0: Vec3 = [Math.cos(a0) * radiusTop, yTop, Math.sin(a0) * radiusTop];
      const p1: Vec3 = [Math.cos(a1) * radiusTop, yTop, Math.sin(a1) * radiusTop];
      // CCW from outside (above) → outward normal is (0, +1, 0).
      // Verified: cross(center→p1, center→p0) = (0, +1, 0) for increasing angle.
      polygons.push({ vertices: [[...center], [...p1], [...p0]], color });
    }
  }

  return polygons;
}
