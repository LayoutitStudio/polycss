/**
 * Shared prop types and camera-handle glue for PolyOrbitControls and
 * PolyMapControls. The pan/orbit math itself lives in
 * `@layoutit/polycss-core` (`applyOrbit` / `applyPan`).
 */
import { applyOrbit, applyPan } from "@layoutit/polycss-core";
import type {
  CameraHandle,
  PolyControlsAnimateOptions,
  PolyControlsCamera,
} from "@layoutit/polycss-core";

export type { PolyControlsAnimateOptions, PolyControlsCamera } from "@layoutit/polycss-core";

/**
 * Apply orbit (rotate rotX / rotY) from screen-space drag delta.
 * Drag tracks the pointer — visible object follows the user's mouse.
 */
export function orbitCamera(
  dx: number,
  dy: number,
  handle: CameraHandle,
  invert: boolean | number | undefined,
): void {
  const s = handle.state;
  const { rotX, rotY } = applyOrbit(dx, dy, s.rotX, s.rotY, invert);
  handle.update({ rotX, rotY });
}

/** Apply world-space pan (slippy-map semantics) from screen-space drag delta. */
export function panCamera(dx: number, dy: number, handle: CameraHandle): void {
  const s = handle.state;
  const { targetD0, targetD1 } = applyPan(dx, dy, s.zoom, s.rotX, s.rotY);
  const t = s.target;
  handle.update({ target: [t[0] + targetD0, t[1] + targetD1, t[2]] });
}

export interface SharedControlsProps {
  /** Pointer-drag. Default true. */
  drag?: boolean;
  /** Wheel / pinch zoom. Default true. */
  wheel?: boolean;
  /**
   * Dolly mode: wheel changes `distance` (camera pull-back in CSS pixels)
   * instead of `zoom` (CSS scale). Mirrors three.js OrbitControls dolly.
   * Default false (wheel changes zoom). When true, use `minDistance` /
   * `maxDistance` to clamp the range.
   */
  dolly?: boolean;
  /** Drag-direction inversion. Number = sensitivity multiplier. Default false. */
  invert?: boolean | number;
  /** Minimum zoom (CSS scale). Default 0.1. */
  minZoom?: number;
  /** Maximum zoom (CSS scale). Default 10. */
  maxZoom?: number;
  /** Minimum camera distance in CSS pixels when dolly is enabled. Default 0. */
  minDistance?: number;
  /** Maximum camera distance in CSS pixels when dolly is enabled. Default Infinity (three.js OrbitControls parity). */
  maxDistance?: number;
  /** Auto-rotate. Pass false (or omit) to disable. */
  animate?: false | PolyControlsAnimateOptions;
  /**
   * Fires whenever the controls mutate camera state.
   */
  onChange?: (camera: PolyControlsCamera) => void;
  onInteractionStart?: (camera: PolyControlsCamera) => void;
  onInteractionEnd?: (camera: PolyControlsCamera) => void;
}
