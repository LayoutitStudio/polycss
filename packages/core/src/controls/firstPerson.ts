/**
 * Pure first-person controls math shared by every renderer's FPV controls
 * (vanilla `createPolyFirstPersonControls`, React / Vue
 * `<PolyFirstPersonControls>`): key sets, option defaults + resolution, the
 * look-direction vector, and the per-tick movement / jump / crouch physics
 * step.
 *
 * Pointer-lock, keyboard listeners, rAF scheduling, and target derivation
 * from the DOM perspective value stay in the renderers.
 */

// ── Key sets ──────────────────────────────────────────────────────────────

export const FORWARD_KEYS = new Set(["KeyW", "ArrowUp"]);
export const BACK_KEYS = new Set(["KeyS", "ArrowDown"]);
export const LEFT_KEYS = new Set(["KeyA", "ArrowLeft"]);
export const RIGHT_KEYS = new Set(["KeyD", "ArrowRight"]);
export const JUMP_KEYS = new Set(["Space"]);
export const CROUCH_KEYS = new Set(["ControlLeft", "ControlRight"]);

export function isFpvKey(code: string): boolean {
  return (
    FORWARD_KEYS.has(code) ||
    BACK_KEYS.has(code) ||
    LEFT_KEYS.has(code) ||
    RIGHT_KEYS.has(code) ||
    JUMP_KEYS.has(code) ||
    CROUCH_KEYS.has(code)
  );
}

// ── Options ───────────────────────────────────────────────────────────────

export interface PolyFirstPersonControlsOptions {
  /** Master switch. When `false`, all sub-controls are inert. Default: `true`. */
  enabled?: boolean;
  /** Pointer-lock mouselook (rotX = pitch, rotY = yaw). Default: `true`. */
  lookEnabled?: boolean;
  /** WASD / arrow-key planar movement on world XY. Default: `true`. */
  moveEnabled?: boolean;
  /** Space-bar parametric jump arc on world Z. Default: `true`. */
  jumpEnabled?: boolean;
  /** Ctrl crouch (lowers eye height while held). Default: `true`. */
  crouchEnabled?: boolean;
  /** Mouselook sensitivity in degrees per pixel. Default: `0.15`. */
  lookSensitivity?: number;
  /** Invert vertical mouselook. Default: `false`. */
  invertY?: boolean;
  /** Movement speed in world units per second. Default: `5`. */
  moveSpeed?: number;
  /** Initial vertical velocity for a jump, world units per second. Default: `7`. */
  jumpVelocity?: number;
  /** Gravity acceleration in world units per second squared. Default: `18`. */
  gravity?: number;
  /** Standing eye height above the ground plane. Default: `1.7`. */
  eyeHeight?: number;
  /** Eye height while crouching. Default: `1`. */
  crouchHeight?: number;
  /** World Z of the ground plane the player walks on. Default: `0`. */
  groundZ?: number;
  /** Min pitch (rotX) angle in degrees. Default: `5`. */
  minPitch?: number;
  /** Max pitch (rotX) angle in degrees. Default: `175`. */
  maxPitch?: number;
}

export interface PolyFirstPersonResolvedOptions {
  enabled: boolean;
  lookEnabled: boolean;
  moveEnabled: boolean;
  jumpEnabled: boolean;
  crouchEnabled: boolean;
  lookSensitivity: number;
  invertY: boolean;
  moveSpeed: number;
  jumpVelocity: number;
  gravity: number;
  eyeHeight: number;
  crouchHeight: number;
  groundZ: number;
  minPitch: number;
  maxPitch: number;
}

export const FIRST_PERSON_DEFAULTS: PolyFirstPersonResolvedOptions = {
  enabled: true,
  lookEnabled: true,
  moveEnabled: true,
  jumpEnabled: true,
  crouchEnabled: true,
  lookSensitivity: 0.15,
  invertY: false,
  moveSpeed: 5,
  jumpVelocity: 7,
  gravity: 18,
  eyeHeight: 1.7,
  crouchHeight: 1,
  groundZ: 0,
  minPitch: 5,
  maxPitch: 175,
};

export function resolveFirstPersonOptions(
  base: PolyFirstPersonResolvedOptions,
  partial: PolyFirstPersonControlsOptions,
): PolyFirstPersonResolvedOptions {
  return {
    enabled: partial.enabled ?? base.enabled,
    lookEnabled: partial.lookEnabled ?? base.lookEnabled,
    moveEnabled: partial.moveEnabled ?? base.moveEnabled,
    jumpEnabled: partial.jumpEnabled ?? base.jumpEnabled,
    crouchEnabled: partial.crouchEnabled ?? base.crouchEnabled,
    lookSensitivity: partial.lookSensitivity ?? base.lookSensitivity,
    invertY: partial.invertY ?? base.invertY,
    moveSpeed: partial.moveSpeed ?? base.moveSpeed,
    jumpVelocity: partial.jumpVelocity ?? base.jumpVelocity,
    gravity: partial.gravity ?? base.gravity,
    eyeHeight: partial.eyeHeight ?? base.eyeHeight,
    crouchHeight: partial.crouchHeight ?? base.crouchHeight,
    groundZ: partial.groundZ ?? base.groundZ,
    minPitch: partial.minPitch ?? base.minPitch,
    maxPitch: partial.maxPitch ?? base.maxPitch,
  };
}

// ── Look direction ────────────────────────────────────────────────────────

/**
 * World direction the camera looks along for a given pitch / yaw. Derived
 * from PolyCSS's scene transform inverse: the world direction that maps to
 * CSS -Z (into the screen) under `rotateX(rotX) rotate(rotY)` + the axis
 * swap (worldY→CSS X, worldX→CSS Y).
 */
export function forwardDir(rotX: number, rotY: number): [number, number, number] {
  const rx = (rotX * Math.PI) / 180;
  const ry = (rotY * Math.PI) / 180;
  return [
    -Math.sin(rx) * Math.cos(ry),
    -Math.sin(rx) * Math.sin(ry),
    -Math.cos(rx),
  ];
}

// ── Per-tick physics step ─────────────────────────────────────────────────

export interface PolyFirstPersonPhysicsState {
  /** Camera origin (eye position) in world coordinates. */
  origin: readonly [number, number, number];
  /** Vertical velocity — non-zero only mid-air. */
  verticalVel: number;
  /** Jump height above the standing/crouching base, accumulated from gravity. */
  jumpOffset: number;
}

export interface PolyFirstPersonPhysicsResult {
  origin: [number, number, number];
  verticalVel: number;
  jumpOffset: number;
  /** True when the origin changed this tick (caller re-derives the target). */
  dirty: boolean;
}

/**
 * One movement / jump / crouch physics tick, pure over
 * (state, held keys, yaw, dt, resolved options). `dt` is in SECONDS
 * (renderers clamp it before calling).
 */
export function stepFirstPersonPhysics(
  state: PolyFirstPersonPhysicsState,
  keysHeld: ReadonlySet<string>,
  rotYDeg: number,
  dt: number,
  opts: PolyFirstPersonResolvedOptions,
): PolyFirstPersonPhysicsResult {
  const origin: [number, number, number] = [state.origin[0], state.origin[1], state.origin[2]];
  let verticalVel = state.verticalVel;
  let jumpOffset = state.jumpOffset;
  let dirty = false;

  // ── Move (horizontal): WASD walks the camera origin on the XY plane. ──
  if (opts.moveEnabled) {
    let mf = 0; // forward axis
    let mr = 0; // right axis
    for (const code of keysHeld) {
      if (FORWARD_KEYS.has(code)) mf += 1;
      else if (BACK_KEYS.has(code)) mf -= 1;
      else if (RIGHT_KEYS.has(code)) mr += 1;
      else if (LEFT_KEYS.has(code)) mr -= 1;
    }
    if (mf !== 0 || mr !== 0) {
      const r = (rotYDeg * Math.PI) / 180;
      // Horizontal forward (yaw projection onto world XY), independent of
      // pitch — matches three.js PointerLockControls.moveForward which
      // crosses camera.up with camera.right to drop the vertical
      // component. WASD always walks the floor, never flies.
      const fx = -Math.cos(r);
      const fy = -Math.sin(r);
      const rx = -Math.sin(r);
      const ry = Math.cos(r);
      const len = Math.hypot(mf, mr) || 1;
      const step = opts.moveSpeed * dt;
      origin[0] += ((fx * mf + rx * mr) / len) * step;
      origin[1] += ((fy * mf + ry * mr) / len) * step;
      dirty = true;
    }
  }

  // ── Vertical: jump + gravity + crouch (mutates origin.z). ──
  const crouched = opts.crouchEnabled
    && (keysHeld.has("ControlLeft") || keysHeld.has("ControlRight"));
  const baseHeight = crouched ? opts.crouchHeight : opts.eyeHeight;
  if (opts.jumpEnabled && (verticalVel !== 0 || jumpOffset > 0)) {
    verticalVel -= opts.gravity * dt;
    jumpOffset += verticalVel * dt;
    if (jumpOffset <= 0) {
      jumpOffset = 0;
      verticalVel = 0;
    }
  } else if (!opts.jumpEnabled) {
    jumpOffset = 0;
    verticalVel = 0;
  }
  const originZ = opts.groundZ + baseHeight + jumpOffset;
  if (Math.abs(origin[2] - originZ) > 1e-4) {
    origin[2] = originZ;
    dirty = true;
  }

  return { origin, verticalVel, jumpOffset, dirty };
}
