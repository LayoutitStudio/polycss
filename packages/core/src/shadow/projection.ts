// Pure-math helpers for baked-mode shadow projection.
//
// Dynamic mode keeps the shadow projection in CSS (--shadow-proj on the
// scene root, driven by --clx/--cly/--clz + --shadow-ground-cssz) so the
// browser recomputes it whenever the light moves. Baked mode skips that
// machinery entirely: the light is fixed, so the projection matrix can
// be CPU-computed once at scene build time and reused inline on every
// shadow leaf. No CSS vars, no @property dependency, no per-paint calc
// chain — and back-facing polygons are dropped from the DOM instead of
// being emitted with opacity 0.
import type { Vec3 } from "../types";

/** Tiny non-zero scale collapsed into the projection's Z column to keep
 *  the matrix invertible. Chromium skips elements whose composed
 *  transform is singular (m22 = 0 would make this a true projection
 *  matrix, but Chromium would refuse to paint it), so we crush Z to 1%
 *  of its input instead of exactly zero. The result still looks flat
 *  to the eye — sub-pixel drift on any realistic scene size. */
export const BAKED_SHADOW_Z_SQUASH = 0.01;

/** Minimum absolute value of the up-axis light component before the
 *  projection blows up (we divide by it). Matches the --clz clamp in
 *  the dynamic-mode applyDynamicLightVars helper so baked + dynamic
 *  behave identically when the light is near-horizontal. */
export const BAKED_SHADOW_MIN_UP = 0.01;

/**
 * Build the CSS-space shadow projection matrix for a fixed light + ground
 * plane. The 16-element output mirrors the matrix3d expression in the
 * dynamic-mode `--shadow-proj` CSS custom property, but with literal
 * numbers — ready to be formatted into a single `matrix3d(...)` per
 * shadow leaf.
 *
 * `lightDir` is the direction the light TRAVELS (e.g. `[0, 0, -1]` is
 * straight down). PolyCSS world Z is up, and the world→CSS axis swap
 * leaves Z alone — see styles.ts for the full convention.
 *
 * `groundCssZ` is the receiver plane in CSS-Z (= world-Z) coordinates,
 * already in unit-less form (matrix3d entries must be dimensionless).
 */
export function buildBakedShadowProjectionMatrix(
  lightDir: Vec3,
  groundCssZ: number,
): number[] {
  const len = Math.hypot(lightDir[0], lightDir[1], lightDir[2]) || 1;
  const lx = lightDir[0] / len;
  const ly = lightDir[1] / len;
  const lzRaw = lightDir[2] / len;
  const lz =
    Math.sign(lzRaw || 1) * Math.max(Math.abs(lzRaw), BAKED_SHADOW_MIN_UP);
  const G = groundCssZ;
  const Z = BAKED_SHADOW_Z_SQUASH;
  // Column-major 4×4, identical layout to CSS matrix3d.
  return [
    1, 0, 0, 0,
    0, 1, 0, 0,
    -lx / lz, -ly / lz, Z, 0,
    (G * lx) / lz, (G * ly) / lz, G * (1 - Z), 1,
  ];
}

/**
 * Decides whether a polygon should cast a shadow given its outward
 * normal and the light's travel direction.
 *
 * True for polygons whose normals point in the same direction as the
 * light travels — i.e., on the far/dark side of the mesh from the
 * light's POV. Those define the silhouette of the cast shadow.
 *
 * False for front-facing polygons whose projection would land inside
 * the silhouette and only add overdraw. Dynamic mode hides these with
 * a Lambert opacity gate; baked mode skips the DOM emission entirely.
 */
export function isBakedShadowCaster(
  normal: Vec3,
  lightDir: Vec3,
): boolean {
  const len = Math.hypot(lightDir[0], lightDir[1], lightDir[2]) || 1;
  const lx = lightDir[0] / len;
  const ly = lightDir[1] / len;
  const lz = lightDir[2] / len;
  return normal[0] * lx + normal[1] * ly + normal[2] * lz > 0;
}

/**
 * 2D convex hull (Andrew's monotone chain, O(n log n)). Returns the
 * hull vertices in CCW order. Used to compute a receiver mesh's XY
 * footprint when subtracting it from the global ground shadow.
 */
export function convexHull2D(
  points: ReadonlyArray<readonly [number, number]>,
): Array<[number, number]> {
  const n = points.length;
  if (n <= 1) return points.map((p) => [p[0], p[1]]);
  const sorted = points.map((p) => [p[0], p[1]] as [number, number]);
  sorted.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (
    o: [number, number],
    a: [number, number],
    b: [number, number],
  ): number => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: Array<[number, number]> = [];
  for (const p of sorted) {
    while (lower.length >= 2 &&
      cross(lower[lower.length - 2]!, lower[lower.length - 1]!, p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: Array<[number, number]> = [];
  for (let i = sorted.length - 1; i >= 0; i--) {
    const p = sorted[i]!;
    while (upper.length >= 2 &&
      cross(upper[upper.length - 2]!, upper[upper.length - 1]!, p) <= 0) upper.pop();
    upper.push(p);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

/**
 * Signed area of a 2D polygon (positive for CCW vertex order, negative
 * for CW). Used by `ensureCcw2D` to normalize winding before concatenating
 * polygons into a compound SVG path under `fill-rule="nonzero"`: mixed
 * CCW/CW subpaths would cancel each other's winding in the overlap
 * region and paint an unintended hole.
 */
export function polygonSignedArea2D(
  vertices: ReadonlyArray<readonly [number, number]>,
): number {
  let a = 0;
  const n = vertices.length;
  for (let i = 0; i < n; i++) {
    const p = vertices[i]!;
    const q = vertices[(i + 1) % n]!;
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a / 2;
}

/**
 * Returns the polygon's vertices in CCW order, reversing if necessary.
 * Operates on a copy — input is left unmodified.
 */
export function ensureCcw2D(
  vertices: ReadonlyArray<readonly [number, number]>,
): Array<[number, number]> {
  const copy = vertices.map((v) => [v[0], v[1]] as [number, number]);
  if (polygonSignedArea2D(copy) < 0) copy.reverse();
  return copy;
}

/**
 * Projects a single CSS-3D vertex onto the shadow ground plane, returning
 * the resulting 2D point in CSS coordinates. Mirrors the per-element
 * matrix3d that the dynamic-mode `--shadow-proj` builds, but evaluated on
 * the CPU for a fixed light + ground — handy when many projected vertices
 * are needed at once (e.g. rendering shadow outlines into a single SVG
 * per mesh instead of one DOM leaf per casting polygon).
 *
 * `cssVertex` is a 3D point that has already been through the world→CSS
 * axis swap and unit scale (so its components are dimensionless CSS-space
 * coordinates). `lightDir` follows the same `--clx/--cly/--clz` convention
 * as `buildBakedShadowProjectionMatrix`.
 */
export function projectCssVertexToGround(
  cssVertex: Vec3,
  lightDir: Vec3,
  groundCssZ: number,
): [number, number] {
  const len = Math.hypot(lightDir[0], lightDir[1], lightDir[2]) || 1;
  const lx = lightDir[0] / len;
  const ly = lightDir[1] / len;
  const lzRaw = lightDir[2] / len;
  const lz =
    Math.sign(lzRaw || 1) * Math.max(Math.abs(lzRaw), BAKED_SHADOW_MIN_UP);
  const zDelta = cssVertex[2] - groundCssZ;
  return [
    cssVertex[0] - (lx / lz) * zDelta,
    cssVertex[1] - (ly / lz) * zDelta,
  ];
}
