/**
 * Screen → world inverse projection helpers.
 *
 * The camera transform a CameraHandle emits is:
 *
 *   `translateZ(-distance) scale(zoom/tile) rotateX(rotX) rotate(rotY) translate3d(-cssX, -cssY, -cssZ)`
 *
 * (right-to-left for point transforms). For an orthographic camera the
 * depth component drops out at projection time, so a screen position
 * (mx, my) unprojects to a 3D RAY in world space — every depth value
 * along that ray maps to the same screen position. Callers pick a
 * specific 3D point by intersecting the ray with a surface they care
 * about (here: a sphere).
 *
 * `screenToWorldOnSphere` is the common case: given a mouse position,
 * find where on a fixed sphere (e.g. the draggable light marker's
 * sphere of constant radius) the cursor is pointing. Returns null
 * when the ray misses the sphere.
 */
import type { Vec3 } from "../types";
import type { CameraState } from "./camera";

const DEG = Math.PI / 180;

export interface ScreenToWorldOptions {
  /** Camera state — rotX/rotY/zoom/target, same shape `CameraHandle.state` exposes. */
  camera: CameraState;
  /** World-units → CSS-px factor. Pass `DEFAULT_TILE` from the renderer. */
  tileSize: number;
  /** Viewport center in CSS pixels (screen coordinates). The mouse position
   *  is interpreted relative to this point. */
  viewportCenterX: number;
  viewportCenterY: number;
  /** Mouse screen position (CSS pixels). */
  mouseX: number;
  mouseY: number;
}

/**
 * Unproject the cursor to a ray in world coordinates.
 *
 *   `ray(t) = origin + t · direction`
 *
 * `origin` is the world point that screen-coincides with the mouse at
 * depth t=0; `direction` is the camera-forward axis in world frame.
 * For orthographic cameras the ray is parallel — every point along it
 * projects to the same screen position.
 */
export function screenToWorldRay(opts: ScreenToWorldOptions): { origin: Vec3; direction: Vec3 } {
  const { camera, tileSize, viewportCenterX, viewportCenterY, mouseX, mouseY } = opts;
  const rotXR = camera.rotX * DEG;
  const rotYR = camera.rotY * DEG;
  const cssScale = camera.zoom / tileSize;
  const target = camera.target;

  // Cursor offset from viewport center, in CSS-px (pre-camera-scale).
  const mx = mouseX - viewportCenterX;
  const my = mouseY - viewportCenterY;

  // Step 1 — undo the camera's scale().
  const ux = mx / cssScale;
  const uy = my / cssScale;
  // Camera-Z depth is free; we propagate it as the ray parameter `t`.

  // Step 2 — undo rotateX(rotX). RotX(θ) maps (x,y,z) → (x, y·cos − z·sin, y·sin + z·cos);
  // its inverse RotX(-θ) gives the base/direction below (basePoint uses uz=0;
  // direction is the partial derivative w.r.t. uz).
  const cosRX = Math.cos(rotXR);
  const sinRX = Math.sin(rotXR);
  const baseRX_x = ux;
  const baseRX_y = uy * cosRX;
  const baseRX_z = -uy * sinRX;
  const dirRX_x = 0;
  const dirRX_y = sinRX;
  const dirRX_z = cosRX;

  // Step 3 — undo rotate() (= rotateZ in 3D context). RotZ(θ) maps (x,y,z) →
  // (x·cos − y·sin, x·sin + y·cos, z); inverse is the formula below.
  const cosRY = Math.cos(rotYR);
  const sinRY = Math.sin(rotYR);
  const baseCss_x = baseRX_x * cosRY + baseRX_y * sinRY;
  const baseCss_y = -baseRX_x * sinRY + baseRX_y * cosRY;
  const baseCss_z = baseRX_z;
  const dirCss_x = dirRX_x * cosRY + dirRX_y * sinRY;
  const dirCss_y = -dirRX_x * sinRY + dirRX_y * cosRY;
  const dirCss_z = dirRX_z;

  // Step 4 — undo translate3d(-target_css) and axis swap (world.x↔world.y).
  // The scene transform's translate3d uses cssX=target.y*tile, cssY=target.x*tile;
  // adding it back here gives the CSS-frame world position.
  const targetCss_x = target[1] * tileSize;
  const targetCss_y = target[0] * tileSize;
  const targetCss_z = target[2] * tileSize;

  const originCss_x = baseCss_x + targetCss_x;
  const originCss_y = baseCss_y + targetCss_y;
  const originCss_z = baseCss_z + targetCss_z;

  // Unswap axis to user-world coords and unscale by tile.
  const origin: Vec3 = [originCss_y / tileSize, originCss_x / tileSize, originCss_z / tileSize];
  const direction: Vec3 = [dirCss_y / tileSize, dirCss_x / tileSize, dirCss_z / tileSize];

  return { origin, direction };
}

/**
 * Unproject the cursor and intersect with a sphere in world coords.
 * Returns the FRONT intersection (the one closer to the camera) when
 * the ray hits the sphere. When the ray misses (cursor outside the
 * projected silhouette), returns the point on the sphere's silhouette
 * closest to the cursor — that way callers like draggable helpers keep
 * tracking the cursor along the rim instead of freezing in place.
 */
export function screenToWorldOnSphere(
  opts: ScreenToWorldOptions & { sphereCenter: Vec3; sphereRadius: number },
): Vec3 | null {
  const { origin, direction } = screenToWorldRay(opts);
  const { sphereCenter, sphereRadius } = opts;

  // Ray-sphere intersection. P(t) = origin + t·direction; |P − C|² = R².
  const Ox = origin[0] - sphereCenter[0];
  const Oy = origin[1] - sphereCenter[1];
  const Oz = origin[2] - sphereCenter[2];
  const Dx = direction[0];
  const Dy = direction[1];
  const Dz = direction[2];

  const a = Dx * Dx + Dy * Dy + Dz * Dz;
  if (a === 0) return null;
  const b = 2 * (Ox * Dx + Oy * Dy + Oz * Dz);
  const c = Ox * Ox + Oy * Oy + Oz * Oz - sphereRadius * sphereRadius;
  const disc = b * b - 4 * a * c;

  if (disc >= 0) {
    const sqrtD = Math.sqrt(disc);
    const t1 = (-b - sqrtD) / (2 * a);
    const t2 = (-b + sqrtD) / (2 * a);
    // Pick the FRONT intersection — after axis swap world-Z aligns with
    // CSS-Z and +Z is toward the viewer; greater t·dirZ wins.
    const tFront = direction[2] >= 0 ? Math.max(t1, t2) : Math.min(t1, t2);
    return [
      origin[0] + tFront * direction[0],
      origin[1] + tFront * direction[1],
      origin[2] + tFront * direction[2],
    ];
  }

  // Ray missed the sphere — find the point on the sphere closest to the
  // ray (foot of perpendicular from center → ray, then snap to surface).
  // t* = (C - O) · D / |D|² minimises distance along the ray.
  const tStar = -(Ox * Dx + Oy * Dy + Oz * Dz) / a;
  const footX = origin[0] + tStar * Dx;
  const footY = origin[1] + tStar * Dy;
  const footZ = origin[2] + tStar * Dz;
  const fx = footX - sphereCenter[0];
  const fy = footY - sphereCenter[1];
  const fz = footZ - sphereCenter[2];
  const flen = Math.hypot(fx, fy, fz);
  if (flen === 0) return null;
  return [
    sphereCenter[0] + (fx / flen) * sphereRadius,
    sphereCenter[1] + (fy / flen) * sphereRadius,
    sphereCenter[2] + (fz / flen) * sphereRadius,
  ];
}
