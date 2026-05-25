/**
 * Z-axis cylinder geometry with optional radius taper.
 *
 * Geometry:
 *   - `radialSegments` side faces (quads for cylinders/frustums, triangles
 *     when one radius collapses to a cone tip).
 *   - `radialSegments` bottom-cap triangles (fan from center).
 *   - `radialSegments` top-cap triangles (fan from center), omitted when
 *     radiusTop ≈ 0 (i.e. cone tip).
 *
 * The cylinder sits centered at the origin, spanning Z = −height/2 to
 * Z = +height/2. Side quads are axis-aligned in the cylinder's own local
 * frame, which maximises the chance of hitting the <b> quad fast-path.
 *
 * PolyCSS world space: +X right, +Y forward, +Z up. The cylinder axis is
 * the Z axis so a typical upright pillar stands without any extra rotation.
 */
import type { Polygon, Vec3 } from "../types";

export interface CylinderPolygonsOptions {
  /** Bottom-cap radius. Default 50. */
  radius?: number;
  /** Top-cap radius. Defaults to `radius` (straight cylinder).
   *  Set to 0 (or near 0) for a cone. */
  radiusTop?: number;
  /** Height along the Z axis. Default 100. */
  height?: number;
  /** Number of radial segments. Default 12. */
  radialSegments?: number;
  /** Fill color applied to all polygons. */
  color?: string;
}

/** Threshold below which a radius is treated as zero (cone tip, no cap). */
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
  const zBottom = -halfH;
  const zTop = halfH;
  const n = Math.max(3, radialSegments);
  const polygons: Polygon[] = [];

  // Pre-compute the angle for each segment boundary.
  const angles: number[] = Array.from({ length: n + 1 }, (_, i) => (i / n) * Math.PI * 2);

  const bottomIsPoint = radius <= RADIUS_ZERO_EPS;
  const topIsPoint = radiusTop <= RADIUS_ZERO_EPS;

  // ── Side faces ───────────────────────────────────────────────────────────
  // One face per segment. Quads use [bl, br, tr, tl]; cone-tip sides use
  // triangles so renderers don't receive degenerate quads with duplicate apex
  // vertices.
  for (let i = 0; i < n; i++) {
    if (bottomIsPoint && topIsPoint) break;

    const a0 = angles[i];
    const a1 = angles[i + 1];
    const bx0 = Math.cos(a0) * radius;
    const by0 = Math.sin(a0) * radius;
    const bx1 = Math.cos(a1) * radius;
    const by1 = Math.sin(a1) * radius;
    const tx0 = Math.cos(a0) * radiusTop;
    const ty0 = Math.sin(a0) * radiusTop;
    const tx1 = Math.cos(a1) * radiusTop;
    const ty1 = Math.sin(a1) * radiusTop;

    const bl: Vec3 = [bx0, by0, zBottom];
    const br: Vec3 = [bx1, by1, zBottom];
    const tr: Vec3 = [tx1, ty1, zTop];
    const tl: Vec3 = [tx0, ty0, zTop];

    if (topIsPoint) {
      const apex: Vec3 = [0, 0, zTop];
      polygons.push({ vertices: [bl, br, apex], color });
    } else if (bottomIsPoint) {
      const apex: Vec3 = [0, 0, zBottom];
      polygons.push({ vertices: [apex, tr, tl], color });
    } else {
      // CCW from outside: cross((br - bl), (tr - bl)) points radially outward.
      polygons.push({ vertices: [bl, br, tr, tl], color });
    }
  }

  // ── Bottom cap (radius > 0) ──────────────────────────────────────────────
  // Triangle fan from the bottom center. Outward normal is −Z, so CCW order
  // viewed from below is [center, p1, p0] (the reverse of the ring sweep).
  if (radius > RADIUS_ZERO_EPS) {
    const center: Vec3 = [0, 0, zBottom];
    for (let i = 0; i < n; i++) {
      const a0 = angles[i];
      const a1 = angles[i + 1];
      const p0: Vec3 = [Math.cos(a0) * radius, Math.sin(a0) * radius, zBottom];
      const p1: Vec3 = [Math.cos(a1) * radius, Math.sin(a1) * radius, zBottom];
      polygons.push({ vertices: [[...center], [...p1], [...p0]], color });
    }
  }

  // ── Top cap (radiusTop > 0) ──────────────────────────────────────────────
  // Triangle fan from the top center. Outward normal is +Z, so CCW order
  // viewed from above is [center, p0, p1] (matching the ring sweep).
  if (radiusTop > RADIUS_ZERO_EPS) {
    const center: Vec3 = [0, 0, zTop];
    for (let i = 0; i < n; i++) {
      const a0 = angles[i];
      const a1 = angles[i + 1];
      const p0: Vec3 = [Math.cos(a0) * radiusTop, Math.sin(a0) * radiusTop, zTop];
      const p1: Vec3 = [Math.cos(a1) * radiusTop, Math.sin(a1) * radiusTop, zTop];
      polygons.push({ vertices: [[...center], [...p0], [...p1]], color });
    }
  }

  return polygons;
}
