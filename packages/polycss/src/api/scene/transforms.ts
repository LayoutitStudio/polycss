/**
 * Pure transform helpers extracted from createPolyScene.ts. No closures over
 * scene state — these functions take their inputs and return a value (string,
 * number, or vector). They handle:
 *
 *   - World→CSS coordinate conversion (axis swap + × DEFAULT_TILE).
 *   - Mesh wrapper transform string (scale-around-origin, rotate-around-bbox).
 *   - Scene-root transform string from a camera handle.
 *   - CSS `zoom` introspection + neutralization on the scene root.
 *   - Lambert-bucket normal quantization (for dynamic-mode grouping).
 *
 * Constants are exported so call sites can compare against them.
 */
import { BASE_TILE } from "@layoutit/polycss-core";
import type { Polygon, Vec3 } from "@layoutit/polycss-core";
import type {
  PolyPerspectiveCameraHandle,
  PolyOrthographicCameraHandle,
} from "../createPolyCamera";
import type { PolyMeshTransform } from "./types";

export const DEFAULT_ZOOM = 1;
export const DEFAULT_TILE = BASE_TILE;
export const LAMBERT_BUCKET_PRECISION = 0.1;

/**
 * Convert a world-frame position (`+X right, +Y forward, +Z up`, world units)
 * into the renderer's internal CSS-pixel frame (`world.y → CSS X`, `world.x →
 * CSS Y`, `world.z → CSS Z`, ×`DEFAULT_TILE`). This is the SAME swap+scale
 * that `buildSceneTransformFromCamera` already applies to `camera.target`, so
 * mesh positions and camera target share a coordinate system.
 *
 * The renderer's internal row/col swap is load-bearing (atlas normals, map
 * controls, voxel snapping); it stays. We just present a Three.js-shaped API
 * (standard XYZ in world units) and absorb the conversion at the boundary.
 */
export function worldPositionToCss(p: Vec3): Vec3 {
  return [p[1] * DEFAULT_TILE, p[0] * DEFAULT_TILE, p[2] * DEFAULT_TILE];
}

/**
 * Convert a world-frame direction (dimensionless XYZ in `+X right, +Y forward,
 * +Z up`) into the renderer's CSS-frame for the lambert dot product. The
 * polygon basis stores normals in the same swapped frame (see atlas/plan.ts
 * makeLocalBasis), so directions must match before dotting. No scale — these
 * are unit vectors.
 */
export function worldDirectionToCss(d: Vec3): Vec3 {
  return [d[1], d[0], d[2]];
}

export function worldDirectionalLightToCss<
  T extends { direction?: Vec3 } | undefined,
>(light: T): T {
  if (!light?.direction) return light;
  return { ...light, direction: worldDirectionToCss(light.direction) } as T;
}

/**
 * Build the CSS `matrix3d`-shaped transform string for a mesh wrapper.
 *
 * Target effective transform on mesh-local vertex p:
 *
 *   `p_world = T(meshPos) · S(scale, around origin) · R_around_bbox(rotation) · p`
 *
 * Scale pivots from mesh ORIGIN (Three.js mesh.scale semantics — vertex
 * at z=0 stays at z=0, so a scaled mesh "lands" on the floor instead of
 * floating). Rotation pivots from the polygon BBOX CENTER (PolyCSS UX —
 * rotating around the visible center feels right).
 *
 * The wrapper has `transform-origin: var(--origin)` = bbox-center, so the
 * browser computes `M_eff = T(bbox) · M_string · T(-bbox)`. Solving for
 * `M_string` and simplifying:
 *
 *   scale only / scale + position:  `M_string = T(pos - bbox) · S · T(bbox)`
 *   rotation only:                  `M_string = R`
 *   rotation + position:            `M_string = T(pos) · R`
 *   scale + rotation (± pos):       `M_string = T(pos - bbox) · S · T(bbox) · R`
 *   no transforms / position only:  `M_string = T(pos)`
 */
export function buildMeshTransform(
  t: PolyMeshTransform,
  bboxCenterCss?: Vec3 | null,
): string | undefined {
  const sx = typeof t.scale === "number" ? t.scale : (t.scale?.[0] ?? 1);
  const sy = typeof t.scale === "number" ? t.scale : (t.scale?.[1] ?? 1);
  const sz = typeof t.scale === "number" ? t.scale : (t.scale?.[2] ?? 1);
  const hasScale = sx !== 1 || sy !== 1 || sz !== 1;
  const hasRotation = !!t.rotation && (!!t.rotation[0] || !!t.rotation[1] || !!t.rotation[2]);
  const cssPos = t.position ? worldPositionToCss(t.position) : [0, 0, 0] as Vec3;
  const bx = bboxCenterCss?.[0] ?? 0;
  const by = bboxCenterCss?.[1] ?? 0;
  const bz = bboxCenterCss?.[2] ?? 0;
  const hasBbox = bx !== 0 || by !== 0 || bz !== 0;

  const parts: string[] = [];
  const tx = cssPos[0] - (hasScale && hasBbox ? bx : 0);
  const ty = cssPos[1] - (hasScale && hasBbox ? by : 0);
  const tz = cssPos[2] - (hasScale && hasBbox ? bz : 0);
  if (tx !== 0 || ty !== 0 || tz !== 0) {
    parts.push(`translate3d(${tx}px, ${ty}px, ${tz}px)`);
  }
  if (hasScale) {
    parts.push(`scale3d(${sx}, ${sy}, ${sz})`);
    if (hasBbox) parts.push(`translate3d(${bx}px, ${by}px, ${bz}px)`);
  }
  if (hasRotation) {
    if (t.rotation![0]) parts.push(`rotateX(${t.rotation![0]}deg)`);
    if (t.rotation![1]) parts.push(`rotateY(${t.rotation![1]}deg)`);
    if (t.rotation![2]) parts.push(`rotateZ(${t.rotation![2]}deg)`);
  }
  return parts.length > 0 ? parts.join(" ") : undefined;
}

/**
 * Build the scene-root CSS transform string from a camera handle's state.
 * Pulled out of createPolyScene so the camera→scene wiring can be unit-
 * tested without spinning up a full scene.
 *
 * Output shape (right-to-left for point transforms):
 *
 *   `translateZ(-distance) scale(zoom) rotateX(rotX) rotate(rotY) translate3d(-cssX, -cssY, -cssZ)`
 *
 * `autoCenterOffset` is the bbox-centre of all meshes (auto-managed); `target`
 * is the user-driven pan delta (orbit / map controls). Keeping them separate
 * means panning survives mesh add/remove and an automatic recenter doesn't
 * fight the user's chosen view target.
 */
export function buildSceneTransformFromCamera(
  camera: PolyPerspectiveCameraHandle | PolyOrthographicCameraHandle,
  autoCenterOffset: Vec3 = [0, 0, 0],
  layoutScale = 1,
): string {
  const state = camera.state;
  const rotX = state.rotX;
  const rotY = state.rotY;
  // User-facing zoom is "px per world unit" (Three.js OrthographicCamera.zoom
  // shape). Renderer geometry already lives at `× DEFAULT_TILE` CSS px, so
  // the scene-root CSS scale is `zoom / DEFAULT_TILE`. At `zoom=1` → 1 world
  // unit = 1 CSS px on screen.
  const userZoom = state.zoom ?? DEFAULT_ZOOM;
  const zoom = (userZoom / DEFAULT_TILE) * layoutScale;
  const distance = (state.distance ?? 0) * layoutScale;
  const target = state.target ?? [0, 0, 0];
  const wx = target[0] + autoCenterOffset[0];
  const wy = target[1] + autoCenterOffset[1];
  const wz = target[2] + autoCenterOffset[2];
  const cssX = wy * DEFAULT_TILE;
  const cssY = wx * DEFAULT_TILE;
  const cssZ = wz * DEFAULT_TILE;
  // rotate() (i.e. rotateZ) — NOT rotateY. After the rotateX tilt, the world's
  // Z axis is what reads as "spin in place"; rotateY rotates around an oblique
  // axis and makes the mesh wobble. translateZ(-distance) is outermost — pulls
  // the camera back from the target along the view axis.
  const distancePart = distance !== 0 ? `translateZ(${-distance}px) ` : "";
  return `${distancePart}scale(${zoom}) rotateX(${rotX}deg) rotate(${rotY}deg) translate3d(${-cssX}px, ${-cssY}px, ${-cssZ}px)`;
}

export function parseCssZoom(value: string): number {
  const text = value.trim();
  if (!text || text === "normal") return 1;
  const numeric = text.endsWith("%")
    ? Number(text.slice(0, -1)) / 100
    : Number(text);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : 1;
}

export function effectiveCssZoom(element: HTMLElement): number {
  const win = element.ownerDocument?.defaultView;
  if (!win) return 1;
  let zoom = 1;
  for (let current: HTMLElement | null = element; current; current = current.parentElement) {
    zoom *= parseCssZoom(win.getComputedStyle(current).getPropertyValue("zoom"));
  }
  return Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
}

export function applyCssZoomCompensation(el: HTMLElement, scale: number): void {
  // Chromium's CSS zoom can scale layout metrics without scaling the
  // preserve-3d rasterization path consistently. Neutralize zoom on the scene
  // root, then fold the same scale into scene geometry transforms explicitly.
  if (Math.abs(scale - 1) < 1e-6) {
    el.style.removeProperty("zoom");
  } else {
    el.style.setProperty("zoom", String(1 / scale));
  }
}

/**
 * For dynamic-mode scenes: group polygons by quantized face normal + color
 * into wrapper divs. The wrapper has the bucket's normal as inline CSS vars;
 * the per-bucket cascade rule computes `--plam` ONCE per wrapper. Polys
 * inside inherit the lambert and skip the per-poly dot product.
 *
 * Quantization: each normal component is rounded to the nearest
 * `LAMBERT_BUCKET_PRECISION` step then re-normalized. Voxel face normals
 * (±1, 0, 0) are already on the grid so they bucket exactly; curved-mesh
 * normals snap to the nearest cell on the unit sphere. With precision 0.1
 * the worst-case angular error is ~6° → cos delta < 0.005, visually
 * imperceptible.
 */
export function quantizeNormalKey(p: Polygon): { key: string; vec: Vec3 } | null {
  if (p.vertices.length < 3) return null;
  // CSS-space edges — must match `computeTextureAtlasPlan` exactly so the
  // bucket's normal sits in the same frame as `--plx/ly/lz`. The atlas
  // applies `toCss(v) = [v.y, v.x, v.z]` and then a NEGATED cross product.
  const v0 = p.vertices[0];
  let nx = 0;
  let ny = 0;
  let nz = 0;
  for (let i = 1; i + 1 < p.vertices.length; i++) {
    const v1 = p.vertices[i];
    const v2 = p.vertices[i + 1];
    const e1x = v1[1] - v0[1], e1y = v1[0] - v0[0], e1z = v1[2] - v0[2];
    const e2x = v2[1] - v0[1], e2y = v2[0] - v0[0], e2z = v2[2] - v0[2];
    nx -= e1y * e2z - e1z * e2y;
    ny -= e1z * e2x - e1x * e2z;
    nz -= e1x * e2y - e1y * e2x;
  }
  const len = Math.hypot(nx, ny, nz);
  if (len < 1e-9) return null;
  nx /= len; ny /= len; nz /= len;
  const inv = 1 / LAMBERT_BUCKET_PRECISION;
  const qx = Math.round(nx * inv) / inv;
  const qy = Math.round(ny * inv) / inv;
  const qz = Math.round(nz * inv) / inv;
  const qLen = Math.hypot(qx, qy, qz);
  if (qLen < 1e-9) return null;
  return {
    key: qx + "," + qy + "," + qz,
    vec: [qx / qLen, qy / qLen, qz / qLen],
  };
}
