/**
 * Pure orbit / pan / zoom / dolly math shared by the orbit and map camera
 * controls in every renderer (vanilla `createPolyOrbitControls` /
 * `createPolyMapControls`, React `<PolyOrbitControls>` / `<PolyMapControls>`,
 * Vue `<PolyOrbitControls>` / `<PolyMapControls>`).
 *
 * Pointer-event wiring, cursor styling, wheel-idle timers, and rAF loops stay
 * in the renderers — this module only owns the camera-state arithmetic and
 * the shared numeric tunables.
 */
import { BASE_TILE } from "../camera/camera";
import type { Vec3 } from "../types";

// ── Wheel idle threshold ──────────────────────────────────────────────────
// Fires `end` once no new wheel event has arrived for this many milliseconds.
// Matches Three.js's internal idle threshold.
export const WHEEL_IDLE_END_MS = 150;

// ── Tunables ──────────────────────────────────────────────────────────────
export const POINTER_DRAG_SPEED = 4; // px per degree
// Three.js OrbitControls-style zoom curve (Math.pow(0.95, |delta|*0.01)).
// Translated to exp-based: Math.exp(-|delta|*0.01*ln(1/0.95)) = exp(-|delta|*0.000513).
export const ZOOM_STEP = 0.000513; // wheel sensitivity
// macOS trackpad pinch-to-zoom sends wheel events with ctrlKey=true and small
// deltaY values. Without amplification they barely move the zoom — three.js
// multiplies by 10 to make pinch responsive.
export const PINCH_AMP = 10; // macOS trackpad pinch amplification
// Two-finger trackpad scroll fires many more events per gesture than pinch,
// but each event has a smaller delta. Without amplification scroll feels much
// weaker than pinch for the same physical gesture. ×3 brings them in line.
export const SCROLL_AMP = 3; // two-finger scroll amplification
export const ANIM_FRAME_MS = 16.67; // 60 Hz reference for dt normalization
export const ANIM_DT_CLAMP_MS = 50; // cap dt per tick
// Distance step in CSS pixels per unit wheel delta — analogous to ZOOM_STEP
// but additive (distance is in pixels, not a multiplier).
export const DOLLY_STEP = 0.05; // CSS pixels per unit wheel delta

// ── Shared animate options ────────────────────────────────────────────────
export interface PolyControlsAnimateOptions {
  /**
   * Rotation rate in degrees per 60 Hz-equivalent frame. The tick is
   * dt-clamped so 0.3 deg/frame ≈ 18 deg/sec on every refresh rate.
   * Default: 0.3.
   */
  speed?: number;
  /** Rotation axis. Default: "y" (yaw, rotates around vertical world Z). */
  axis?: "x" | "y";
  /** Halt the loop while a pointer drag is in progress. Default: true. */
  pauseOnInteraction?: boolean;
}

// ── Camera snapshot ───────────────────────────────────────────────────────
export interface PolyControlsCamera {
  rotX: number;
  rotY: number;
  zoom: number;
  target: Vec3;
  distance: number;
}

export function invertFactor(invert: boolean | number | undefined): number {
  if (invert === true) return -1;
  if (invert === undefined || invert === false) return 1;
  return invert;
}

/**
 * Apply orbit (rotate rotX / rotY) from screen-space drag delta.
 * Drag tracks the pointer — visible object follows the user's mouse.
 */
export function applyOrbit(
  dx: number,
  dy: number,
  rotX: number,
  rotY: number,
  invert: boolean | number | undefined,
): { rotX: number; rotY: number } {
  const f = invertFactor(invert);
  const dX = (dx / POINTER_DRAG_SPEED) * f;
  const dY = (dy / POINTER_DRAG_SPEED) * f;
  return {
    rotX: rotX - dY,
    rotY: (((rotY - dX) % 360) + 360) % 360,
  };
}

/**
 * Solve world-space pan target deltas from a screen-space drag delta.
 *
 * Slippy-map semantics: a drag (dx, dy) in screen pixels makes the terrain
 * appear to follow the finger by exactly (dx, dy) on screen, regardless of
 * camera rotation.
 *
 * Derivation: the scene transform composes as
 *   scale(zoom) · rotateX(rotX) · rotate(rotY) · translate3d(-targetCss)
 * so a target shift Δt translates scene-local (pre-rotation) coords by -Δtcss,
 * which after rotateZ(rotY) and rotateX(rotX) and scale(zoom) produces a
 * screen shift. Solving the inverse — given desired screen shift (dx, dy),
 * find Δt such that the scene shifts by (dx, dy) on screen, with Δt[2]=0
 * (ground-plane pan) — yields:
 *
 *   Δt[0] = ( dx·sin(rotY) - dy·cos(rotY)/cos(rotX)) / (zoom·tile)
 *   Δt[1] = -(dx·cos(rotY) + dy·sin(rotY)/cos(rotX)) / (zoom·tile)
 *
 * The cos(rotX) divisor compensates for tilt foreshortening of the world Y
 * axis (= scene-local CSS Y, which rotateX rotates toward the viewer).
 */
export function applyPan(
  dx: number,
  dy: number,
  zoom: number,
  rotX: number,
  rotY: number,
): { targetD0: number; targetD1: number } {
  const z = Math.max(0.01, zoom);
  // Preserve the sign of cos(rotX) — at rotX > 90° the camera is upside-down
  // relative to the scene, so the dy term must flip. A magnitude clamp of
  // 0.1 keeps things stable through the rotX≈90° edge-on singularity.
  const cosRotXRaw = Math.cos((rotX * Math.PI) / 180);
  const cosRotX = cosRotXRaw >= 0 ? Math.max(0.1, cosRotXRaw) : Math.min(-0.1, cosRotXRaw);
  const cZ = Math.cos((rotY * Math.PI) / 180);
  const sZ = Math.sin((rotY * Math.PI) / 180);
  const k = z * BASE_TILE;
  return {
    targetD0:  (dx * sZ - dy * cZ / cosRotX) / k,
    targetD1: -(dx * cZ + dy * sZ / cosRotX) / k,
  };
}

/**
 * Normalise a wheel event's deltaY into the shared gesture scale:
 * deltaMode line/page factors (three.js convention: line×16, page×100),
 * then pinch (ctrlKey) or two-finger-scroll amplification.
 */
export function normalizeWheelDelta(
  deltaY: number,
  deltaMode: number,
  ctrlKey: boolean,
): number {
  const lineFactor = deltaMode === 1 ? 16 : deltaMode === 2 ? 100 : 1;
  let delta = deltaY * lineFactor;
  if (ctrlKey) delta *= PINCH_AMP;
  else delta *= SCROLL_AMP;
  return delta;
}

/** Zoom mode: multiply the CSS scale by the exp zoom curve, clamped. */
export function applyWheelZoom(
  zoom: number,
  delta: number,
  minZoom: number,
  maxZoom: number,
): number {
  const factor = Math.exp(-delta * ZOOM_STEP);
  return Math.max(minZoom, Math.min(maxZoom, zoom * factor));
}

/** Dolly mode: change distance (camera pull-back) instead of zoom.
 *  Positive delta (scroll down) → dolly out (increase distance). */
export function applyWheelDolly(
  distance: number,
  delta: number,
  minDistance: number,
  maxDistance: number,
): number {
  return Math.max(minDistance, Math.min(maxDistance, distance + delta * DOLLY_STEP));
}
