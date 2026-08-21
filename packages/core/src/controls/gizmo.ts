/**
 * Pure transform-gizmo constants and solvers shared by every renderer's
 * transform controls (vanilla `createTransformControls`, React / Vue
 * `<PolyTransformControls>`). Core already owns the gizmo GEOMETRY builders
 * (`arrowPolygons`, `ringQuadPolygons`, `planePolygons`); this module owns
 * the constant table and the screen-space drag solve math.
 *
 * DOM probes (screen-axis measurement via `getBoundingClientRect`), pointer
 * listeners, and hit-testing stay in the renderers.
 */
import type { Polygon, Vec3 } from "../types";

// Three.js convention: X red, Y green, Z blue. Kept identical so muscle
// memory carries over.
export const COLOR_X = "#ff3653";
export const COLOR_Y = "#8adb00";
export const COLOR_Z = "#2c8fff";

// Alpha applied to the base colors at idle / hover / dragging states.
// Translucency is baked into each polygon's color (rgba) rather than a
// CSS `opacity` on the gizmo wrapper — `opacity` creates a flattened
// stacking context, which would collapse the arrow's 3D depth into a
// single 2D image and break the way the cuboid + pyramid compose with
// the rest of the scene. Per-polygon rgba leaves the 3D pipeline alone.
export const ALPHA_IDLE = 0.6;
export const ALPHA_HOVER = 0.8;
export const ALPHA_DRAGGING = 1.0;

// PolyScene's default `tileSize` (50 px / world unit). Polygon vertex
// coords are world units; the scene renderer multiplies by tileSize to
// place them in scene-CSS pixel space.
export const SCENE_TILE_SIZE = 50;

// Fallback shaft length (in scene-CSS px) used only when the target
// mesh has no polygons to bbox-derive from.
export const FALLBACK_SHAFT_LENGTH = 60;

// Shaft length as a fraction of the mesh's largest bbox extent. ~60%
// makes arrows clearly stick out of the silhouette without dwarfing it.
export const SHAFT_LENGTH_RATIO = 0.6;

// Arrow visual proportions — fractions of the shaft length, expressed
// as HALF-extents (the value passed to arrowPolygons is `…HalfThickness`).
// Shaft full-width = 2.5% of length, matching <PolyAxesHelper>'s
// `thickness=0.025` so the gizmo arrows visually weigh the same as
// the axes overlay. Heads are ~3× wider than the shaft so the 3D
// pyramid reads as a clear arrowhead at any size.
export const SHAFT_HALF_THICKNESS_RATIO = 0.0125; // → 2.5% full
export const HEAD_LENGTH_RATIO = 0.15;
export const HEAD_HALF_THICKNESS_RATIO = 0.04; // → 8% full

// Rotate-mode rings. Radius matches the arrow length so translate /
// rotate gizmos look the same scale.
export const RING_RADIUS_RATIO = 1.0;
// Visible band half-width relative to the ring's mid-radius. Drives ONLY
// the CSS mask; the underlying click target (quad bbox) is sized separately
// by RING_QUAD_OUTER_RATIO so we can show a thin ring without shrinking
// the hit area. Keep small for a clean look.
export const RING_HALF_THICKNESS_RATIO = 0.02;
// Outer radius of the ring's quad polygon as a multiple of mid-radius. The
// quad's bbox IS the click target — generous quad = generous click margin
// even when the visible band is very thin. 1.04 leaves a 2% margin past the
// visible ring's outer edge while keeping the previous hit footprint.
export const RING_QUAD_OUTER_RATIO = 1.04;

// Plane handle proportions, relative to the arrow's shaft length: the square
// sits at ~25% of the arrow length and is ~20% of the arrow length wide.
export const PLANE_HALF_SIZE_RATIO = 0.1;
export const PLANE_OFFSET_RATIO = 0.25;

// Squared length (in screen-px-per-scene-px) below which the axis is
// considered edge-on — its on-screen projection is too short for stable
// dragging. 0.0001 ≈ scene must shrink an axis-unit to ≥ 0.01 screen
// pixels for drags to engage; below that, a 1-pixel pointer drag would
// produce 100+ scene-px of mesh movement.
export const SCREEN_AXIS_DEAD_ZONE_SQ = 0.0001;

/**
 * PolyCSS world→CSS axis remap (world-Y → CSS-x, world-X → CSS-y,
 * world-Z → CSS-z). Used when generating polygon geometry from CSS-axis
 * gizmo specs; involutive, so it also maps CSS axes back to world axes.
 */
export const WORLD_AXIS_FOR_CSS: Record<0 | 1 | 2, 0 | 1 | 2> = { 0: 1, 1: 0, 2: 2 };

/** Six arrow specs (translate mode). `cssAxis` is the visible direction
 *  the arrow points and the CSS-axis index the drag updates. */
export const ARROW_SPECS: Array<{ cssAxis: 0 | 1 | 2; sign: 1 | -1; key: string; color: string }> = [
  { cssAxis: 0, sign:  1, key:  "x", color: COLOR_X },
  { cssAxis: 0, sign: -1, key: "-x", color: COLOR_X },
  { cssAxis: 1, sign:  1, key:  "y", color: COLOR_Y },
  { cssAxis: 1, sign: -1, key: "-y", color: COLOR_Y },
  { cssAxis: 2, sign:  1, key:  "z", color: COLOR_Z },
  { cssAxis: 2, sign: -1, key: "-z", color: COLOR_Z },
];

/** Three ring specs (rotate mode). `cssAxis` is the rotation axis in CSS
 *  coords; the ring lies in the plane perpendicular to that axis. */
export const RING_SPECS: Array<{ cssAxis: 0 | 1 | 2; key: string; color: string }> = [
  { cssAxis: 0, key: "x", color: COLOR_X },
  { cssAxis: 1, key: "y", color: COLOR_Y },
  { cssAxis: 2, key: "z", color: COLOR_Z },
];

/** Three plane specs (translate mode — planar drag). `perpAxis` is the
 *  axis perpendicular to the plane (the one the drag does NOT move along);
 *  `axisA` and `axisB` are the two CSS axes the drag DOES update. */
// Each plane handle is colored with the axis it's PERPENDICULAR to — so the
// XY plane (containing the red+green arrows) reads as the blue (Z) handle,
// the XZ plane as the green (Y) handle, and the YZ plane as the red (X)
// handle. Inversion of three.js's convention but maps cleanly to "the axis
// you can't drag along is this color".
export const PLANE_SPECS: Array<{
  perpAxis: 0 | 1 | 2;
  axisA: 0 | 1 | 2;
  axisB: 0 | 1 | 2;
  key: "xy" | "xz" | "yz";
  color: string;
}> = [
  { perpAxis: 2, axisA: 0, axisB: 1, key: "xy", color: COLOR_Z },
  { perpAxis: 1, axisA: 0, axisB: 2, key: "xz", color: COLOR_Y },
  { perpAxis: 0, axisA: 1, axisB: 2, key: "yz", color: COLOR_X },
];

/** Resolve a user-facing axis letter from an ARROW_SPECS key. */
export function userAxisLetterOf(key: string): "x" | "y" | "z" {
  return key.replace("-", "")[0] as "x" | "y" | "z";
}

/** Convert a `#rrggbb` color to `rgba(r, g, b, a)`. Falls back to the
 *  input string unchanged if it doesn't look like a 6-digit hex. */
export function withAlpha(hex: string, alpha: number): string {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return hex;
  const r = parseInt(m[1], 16);
  const g = parseInt(m[2], 16);
  const b = parseInt(m[3], 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function snap(value: number, step: number | null | undefined): number {
  if (!step || step <= 0) return value;
  return Math.round(value / step) * step;
}

/** Returns true when the given signed CSS-space axis points AWAY from the
 *  viewer under the scene's current rotation (rotateZ(rotY) · rotateX(rotX)).
 *  Computed from screen-Z: a CSS-Z component < 0 after applying the scene
 *  rotation = into the screen = back-facing. Used to drop the shaft on the
 *  back-facing axis of each pair so the gizmo doesn't double-paint at the
 *  gizmo center. */
export function isAxisBackFacing(
  cssAxis: 0 | 1 | 2,
  sign: 1 | -1,
  rotXDeg: number,
  rotYDeg: number,
): boolean {
  const rx = (rotXDeg * Math.PI) / 180;
  const ry = (rotYDeg * Math.PI) / 180;
  const a: [number, number, number] = [0, 0, 0];
  a[cssAxis] = sign;
  // rotateZ(rotY)
  const by = a[0] * Math.sin(ry) + a[1] * Math.cos(ry);
  const bz = a[2];
  // rotateX(rotX) — only Y and Z change
  const cz = by * Math.sin(rx) + bz * Math.cos(rx);
  return cz < 0;
}

/** Return the largest bbox extent of `polygons` in scene-CSS pixels. */
export function gizmoLengthForMesh(polygons: Polygon[]): number {
  if (polygons.length === 0) return FALLBACK_SHAFT_LENGTH;
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (const poly of polygons) {
    for (const v of poly.vertices) {
      if (v[0] < minX) minX = v[0];
      if (v[0] > maxX) maxX = v[0];
      if (v[1] < minY) minY = v[1];
      if (v[1] > maxY) maxY = v[1];
      if (v[2] < minZ) minZ = v[2];
      if (v[2] > maxZ) maxZ = v[2];
    }
  }
  if (!Number.isFinite(minX)) return FALLBACK_SHAFT_LENGTH;
  const extent = Math.max(maxX - minX, maxY - minY, maxZ - minZ);
  return extent * SCENE_TILE_SIZE * SHAFT_LENGTH_RATIO;
}

/**
 * Return the bbox center of `polygons` in scene-CSS pixels, mapped via the
 * standard PolyCSS world→CSS axis remap (vertex[1]→CSS X, vertex[0]→CSS Y,
 * vertex[2]→CSS Z).
 *
 * Used to offset the gizmo wrapper so it sits at the mesh's visual center
 * rather than at its wrapper origin. When the mesh's vertices live at their
 * native positions (PolyMesh.autoCenter unset, e.g. when PolyScene's
 * autoCenter is doing the centering) the wrapper origin is OFFSET from the
 * visible mesh by -bboxCenter; without this compensation the gizmo would
 * sit where world (0,0,0) ends up on screen, not on the mesh.
 */
export function gizmoCenterForMesh(polygons: Polygon[]): Vec3 {
  if (polygons.length === 0) return [0, 0, 0];
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (const poly of polygons) {
    for (const v of poly.vertices) {
      if (v[0] < minX) minX = v[0];
      if (v[0] > maxX) maxX = v[0];
      if (v[1] < minY) minY = v[1];
      if (v[1] > maxY) maxY = v[1];
      if (v[2] < minZ) minZ = v[2];
      if (v[2] > maxZ) maxZ = v[2];
    }
  }
  if (!Number.isFinite(minX)) return [0, 0, 0];
  return [
    ((minY + maxY) / 2) * SCENE_TILE_SIZE,
    ((minX + maxX) / 2) * SCENE_TILE_SIZE,
    ((minZ + maxZ) / 2) * SCENE_TILE_SIZE,
  ];
}

// ── Drag solve math ───────────────────────────────────────────────────────
// Renderers measure the screen projection of each drag axis with a DOM
// probe (a 0×0 element placed `axis × dist` from the gizmo wrapper, bbox
// delta divided by `dist`); the solves below turn pointer-px deltas into
// scene-px axis motion from those measured projections.

/** Screen projection of a world/CSS axis, in screen px per scene px. */
export interface GizmoScreenAxis {
  x: number;
  y: number;
}

/** Project a pointer screen-px delta onto the screen projection of one
 *  axis: t = (dx·ax + dy·ay) / |axis|², i.e. the scene-px motion along
 *  the axis that best explains the pointer delta. */
export function solveAxisDragDelta(
  dx: number,
  dy: number,
  screenAxisX: number,
  screenAxisY: number,
): number {
  const screenAxisLenSq = screenAxisX * screenAxisX + screenAxisY * screenAxisY;
  return (dx * screenAxisX + dy * screenAxisY) / screenAxisLenSq;
}

/** Determinant of the 2×2 screen-projection basis [pA pB]. Renderers treat
 *  |det| < SCREEN_AXIS_DEAD_ZONE_SQ as plane-edge-on-to-camera. */
export function screenPlaneDet(pA: GizmoScreenAxis, pB: GizmoScreenAxis): number {
  return pA.x * pB.y - pB.x * pA.y;
}

/** Cramer's rule on the 2x2: [pA.x pB.x; pA.y pB.y] * [tA tB]' = [dx dy]' */
export function solvePlaneDragDeltas(
  dx: number,
  dy: number,
  pA: GizmoScreenAxis,
  pB: GizmoScreenAxis,
  det: number,
): { tA: number; tB: number } {
  return {
    tA: (pB.y * dx - pB.x * dy) / det,
    tB: (-pA.y * dx + pA.x * dy) / det,
  };
}

/** Unwrap one pointer-angle step so a drag that crosses the ±π boundary
 *  doesn't jump by 2π. */
export function unwrapAngleDelta(angle: number, lastAngle: number): number {
  let d = angle - lastAngle;
  if (d > Math.PI) d -= 2 * Math.PI;
  else if (d < -Math.PI) d += 2 * Math.PI;
  return d;
}
