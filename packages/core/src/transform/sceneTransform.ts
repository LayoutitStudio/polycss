import { BASE_TILE, DEFAULT_CAMERA_STATE } from "../camera/camera";
import type { Vec3 } from "../types";
import { worldPositionToCss } from "../shadow/receiverFaceGroups";

export interface PolySceneTransformInput {
  /** World point that should appear at the viewport center. */
  target?: Vec3;
  /** Scene orbit tilt in degrees. */
  rotX?: number;
  /** Scene orbit rotation around world up in degrees. */
  rotY?: number;
  /** User-facing zoom in CSS pixels per world unit. */
  zoom?: number;
  /** Camera pull-back from target in CSS pixels. */
  distance?: number;
  /** Auto-center offset added to target before world→CSS conversion. */
  autoCenterOffset?: Vec3;
  /** Extra scale folded into zoom and distance for CSS zoom compensation. */
  layoutScale?: number;
  /** CSS pixels per PolyCSS world unit. Defaults to the renderer base tile. */
  worldUnitPx?: number;
}

/**
 * Build the scene-root transform used by PolyCSS renderers:
 *
 * `translateZ(-distance) scale(zoom / worldUnitPx) rotateX(rotX) rotate(rotY) translate3d(-targetCss)`
 */
export function buildPolySceneTransform(
  input: PolySceneTransformInput = {},
): string {
  const target = input.target ?? DEFAULT_CAMERA_STATE.target;
  const autoCenterOffset = input.autoCenterOffset ?? [0, 0, 0] as Vec3;
  const layoutScale = input.layoutScale ?? 1;
  const worldUnitPx = input.worldUnitPx ?? BASE_TILE;
  const zoom = ((input.zoom ?? DEFAULT_CAMERA_STATE.zoom) / worldUnitPx) * layoutScale;
  const distance = (input.distance ?? DEFAULT_CAMERA_STATE.distance) * layoutScale;
  const cssTarget = worldPositionToCss([
    target[0] + autoCenterOffset[0],
    target[1] + autoCenterOffset[1],
    target[2] + autoCenterOffset[2],
  ], worldUnitPx);
  const distancePart = distance !== 0 ? `translateZ(${-distance}px) ` : "";
  return `${distancePart}scale(${zoom}) rotateX(${input.rotX ?? DEFAULT_CAMERA_STATE.rotX}deg) rotate(${input.rotY ?? DEFAULT_CAMERA_STATE.rotY}deg) translate3d(${-cssTarget[0]}px, ${-cssTarget[1]}px, ${-cssTarget[2]}px)`;
}
