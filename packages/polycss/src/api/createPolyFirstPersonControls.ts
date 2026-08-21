/**
 * createPolyFirstPersonControls — first-person camera input for a PolyScene.
 *
 * Mouselook on pointer-lock, WASD/arrow planar move in the yaw-aligned XY
 * plane, Space jump (parametric arc, no collision), Ctrl crouch. Each input
 * axis is independently toggleable so callers can mix-and-match (e.g.
 * mouselook-only on a model viewer, or move-only on a tour rail).
 *
 * For orbit semantics use `createPolyOrbitControls`. For pan/orbit map
 * semantics use `createPolyMapControls`.
 */

import type { PolySceneHandle } from "./createPolyScene";
import {
  BASE_TILE,
  FIRST_PERSON_DEFAULTS,
  JUMP_KEYS,
  CROUCH_KEYS,
  forwardDir,
  isFpvKey,
  resolveFirstPersonOptions,
  stepFirstPersonPhysics,
} from "@layoutit/polycss-core";
import type {
  PolyFirstPersonControlsOptions,
  PolyFirstPersonResolvedOptions,
} from "@layoutit/polycss-core";
import {
  makeListenerRegistry,
  makeCameraSnapshot,
  type PolyControlsEvent,
  type PolyControlsListener,
} from "./controls/common";

export type {
  PolyControlsCamera,
  PolyControlsChangeEvent,
  PolyControlsInteractionEvent,
  PolyControlsEvent,
  PolyControlsListener,
} from "./controls/common";

export type { PolyFirstPersonControlsOptions } from "@layoutit/polycss-core";

export interface PolyFirstPersonControlsHandle {
  update(partial: PolyFirstPersonControlsOptions): void;
  resume(): void;
  pause(): void;
  destroy(): void;
  /** Request pointer-lock now. Call from a user gesture (click). */
  lock(): void;
  /** Release pointer-lock. */
  unlock(): void;
  /** Whether pointer-lock is currently held. */
  isLocked(): boolean;
  /**
   * The camera's WORLD position (the eye). FPV maintains this separately
   * from the scene's `target` so mouselook rotates around it (in-place)
   * instead of orbiting around target. Snapshot — mutate via WASD / jump /
   * crouch, or by calling `setOrigin`.
   */
  getOrigin(): [number, number, number];
  /**
   * Move the camera origin to a specific world position. Re-derives the
   * scene's target so the perspective viewer follows. Use this to teleport,
   * spawn at a chosen spot, etc.
   */
  setOrigin(origin: [number, number, number]): void;
  addEventListener<T extends PolyControlsEvent["type"]>(
    type: T,
    listener: PolyControlsListener<Extract<PolyControlsEvent, { type: T }>>,
  ): void;
  removeEventListener<T extends PolyControlsEvent["type"]>(
    type: T,
    listener: PolyControlsListener<Extract<PolyControlsEvent, { type: T }>>,
  ): void;
  hasEventListener<T extends PolyControlsEvent["type"]>(
    type: T,
    listener: PolyControlsListener<Extract<PolyControlsEvent, { type: T }>>,
  ): boolean;
}

export function createPolyFirstPersonControls(
  scene: PolySceneHandle,
  options: PolyFirstPersonControlsOptions = {},
): PolyFirstPersonControlsHandle {
  let opts: PolyFirstPersonResolvedOptions = resolveFirstPersonOptions(FIRST_PERSON_DEFAULTS, options);
  const host = scene.host;
  // The camera wrapper carries CSS `perspective` — FPV class must live here
  // so `.polycss-fpv-host` overrides the wrapper's inline perspective value.
  const fpvHost = scene.cameraEl;
  const doc = host.ownerDocument ?? document;
  const win = (doc.defaultView ?? globalThis) as typeof globalThis;

  const registry = makeListenerRegistry();
  const snapshot = makeCameraSnapshot(scene);
  const { changeListeners, startListeners, endListeners, listenerArray, emitChange, emitInteraction } = registry;

  const keysHeld = new Set<string>();
  let pointerLocked = false;
  let stopped = false;

  // Vertical state (separate from origin.z so we can stack crouch + jump).
  // verticalVel is non-zero only mid-air; jumpOffset accumulates from gravity.
  let verticalVel = 0;
  let jumpOffset = 0;
  let interacting = false;

  // True first-person model (matches three.js PointerLockControls semantics):
  //   - `cameraOrigin` is the camera's WORLD position (the eye).
  //   - `target` is a DERIVED point ahead of the camera along its look
  //     direction at offset `perspective / tile`, so PolyCSS's perspective
  //     viewer (located at +CSS_Z from scene origin) mathematically coincides
  //     with `cameraOrigin` in world space.
  //   - Mouselook rotates `target` AROUND `cameraOrigin` (origin fixed) →
  //     in-place rotation, not orbit.
  //   - WASD moves `cameraOrigin` (target follows via the same offset).
  //
  // Without this separation, PolyCSS's rotation pivots around `target` itself,
  // which is camera position with distance=0 — that's orbit-style and reads
  // as "the camera circles a point in front of itself" when you mouselook.
  let cameraOrigin: [number, number, number] = [0, 0, opts.groundZ + opts.eyeHeight];

  function lookOffset(): number {
    // Distance from camera origin to derived target in world units. For the
    // polycss perspective viewer to coincide with `cameraOrigin`, this must
    // equal `perspective / tile`. If the camera is orthographic (perspectiveStyle
    // === "none") use a sane fallback so the camera doesn't end up infinitely
    // far from its target.
    const perspStyle = scene.camera.perspectiveStyle;
    const px = perspStyle === "none" ? 0 : parseFloat(perspStyle);
    const n = Number.isFinite(px) && px > 0 ? px : 2000;
    return n / BASE_TILE;
  }

  function deriveTarget(): [number, number, number] {
    const cameraState = scene.camera.state;
    const f = forwardDir(cameraState.rotX ?? 90, cameraState.rotY ?? 0);
    const d = lookOffset();
    return [
      cameraOrigin[0] + f[0] * d,
      cameraOrigin[1] + f[1] * d,
      cameraOrigin[2] + f[2] * d,
    ];
  }

  function syncTargetFromOrigin(): void {
    const t = deriveTarget();
    scene.camera.update({ target: t });
    scene.applyCamera();
  }

  // On attach, seed `cameraOrigin` from whatever the camera currently has as
  // target — the user's previous control mode (orbit/pan) was treating target
  // as the visual center. We adopt that as the FPV camera position, then snap
  // its Z to eye height above the ground plane. After this, FPV is fully
  // authoritative: we only ever write target as a derived value.
  function initializeOriginFromTarget(): void {
    const t = scene.camera.state.target ?? [0, 0, 0];
    cameraOrigin = [t[0], t[1], opts.groundZ + opts.eyeHeight];
    syncTargetFromOrigin();
  }

  // ── Pointer-lock ─────────────────────────────────────────────────────────
  const onHostClick = (): void => {
    if (!opts.enabled || !opts.lookEnabled || stopped || pointerLocked) return;
    try { host.requestPointerLock(); } catch { /* ignore */ }
  };

  const onPointerLockChange = (): void => {
    const locked = doc.pointerLockElement === host;
    if (locked === pointerLocked) return;
    pointerLocked = locked;
    if (pointerLocked) {
      interacting = true;
      emitInteraction("start", snapshot);
    } else {
      if (interacting) {
        interacting = false;
        emitInteraction("end", snapshot);
      }
    }
  };

  const onMouseMove = (e: MouseEvent): void => {
    if (!pointerLocked || !opts.enabled || !opts.lookEnabled || stopped) return;
    const dx = e.movementX ?? 0;
    const dy = e.movementY ?? 0;
    if (dx === 0 && dy === 0) return;
    const cameraState = scene.camera.state;
    const sens = opts.lookSensitivity;
    const dyDir = opts.invertY ? -1 : 1;
    // Yaw: mouse right → look right → rotY decreases (world rotates CW, camera CCW).
    const rotY = ((((cameraState.rotY ?? 0) - dx * sens) % 360) + 360) % 360;
    // Pitch: mouse down → look down → rotX decreases below 90 (rotX=90 horizontal).
    let rotX = (cameraState.rotX ?? 90) - dy * sens * dyDir;
    if (rotX < opts.minPitch) rotX = opts.minPitch;
    else if (rotX > opts.maxPitch) rotX = opts.maxPitch;
    // Update rotation first, then re-derive target so it lives at
    // `cameraOrigin + new_lookDir * lookOffset`. Result: target swings around
    // the fixed origin = camera rotates in place (true first-person), instead
    // of orbiting some point in front of itself.
    const f = forwardDir(rotX, rotY);
    const d = lookOffset();
    const target: [number, number, number] = [
      cameraOrigin[0] + f[0] * d,
      cameraOrigin[1] + f[1] * d,
      cameraOrigin[2] + f[2] * d,
    ];
    scene.camera.update({ rotX, rotY, target });
    scene.applyCamera();
    emitChange(snapshot);
  };

  // ── Keyboard ─────────────────────────────────────────────────────────────
  const onKeyDown = (e: KeyboardEvent): void => {
    if (!opts.enabled || stopped) return;
    if (!isFpvKey(e.code)) return;
    // Only intercept while pointer-locked OR moving — otherwise let the
    // page handle Space/Ctrl normally (page scroll, browser shortcuts).
    if (!pointerLocked && !opts.moveEnabled) return;
    if (JUMP_KEYS.has(e.code)) {
      if (!opts.jumpEnabled) return;
      e.preventDefault();
      // Jump only when grounded (no held velocity, no offset).
      if (!keysHeld.has(e.code) && verticalVel === 0 && jumpOffset === 0) {
        verticalVel = opts.jumpVelocity;
      }
      keysHeld.add(e.code);
      return;
    }
    if (CROUCH_KEYS.has(e.code) && !opts.crouchEnabled) return;
    if (!opts.moveEnabled && !CROUCH_KEYS.has(e.code)) return;
    e.preventDefault();
    keysHeld.add(e.code);
  };

  const onKeyUp = (e: KeyboardEvent): void => {
    if (!isFpvKey(e.code)) return;
    keysHeld.delete(e.code);
  };

  const onBlur = (): void => {
    keysHeld.clear();
  };

  // ── RAF tick ──────────────────────────────────────────────────────────────
  let rafId: number | null = null;
  let lastTime = 0;
  const ANIM_DT_CLAMP = 0.05; // 50 ms

  const tick = (now: number): void => {
    if (rafId === null || stopped) return;
    const dt = Math.min(ANIM_DT_CLAMP, lastTime ? (now - lastTime) / 1000 : 0.0167);
    lastTime = now;

    if (opts.enabled) {
      const cameraState = scene.camera.state;
      const res = stepFirstPersonPhysics(
        { origin: cameraOrigin, verticalVel, jumpOffset },
        keysHeld,
        cameraState.rotY ?? 0,
        dt,
        opts,
      );
      cameraOrigin[0] = res.origin[0];
      cameraOrigin[1] = res.origin[1];
      cameraOrigin[2] = res.origin[2];
      verticalVel = res.verticalVel;
      jumpOffset = res.jumpOffset;

      if (res.dirty) {
        // Re-derive target from the new origin so PolyCSS's perspective viewer
        // tracks the camera. Without this, walking forward would move
        // `cameraOrigin` but target would stay put, and the visible center
        // would drift behind us.
        const target = deriveTarget();
        scene.camera.update({ target });
        scene.applyCamera();
        emitChange(snapshot);
      }
    }

    rafId = win.requestAnimationFrame(tick);
  };

  function startLoop(): void {
    if (rafId !== null || stopped) return;
    lastTime = 0;
    rafId = win.requestAnimationFrame(tick);
  }

  function stopLoop(): void {
    if (rafId === null) return;
    win.cancelAnimationFrame(rafId);
    rafId = null;
  }

  // FPV needs a perspective context on the camera wrapper so scene Z motion
  // shows as depth, not as a planar pan. We honor whatever perspective the
  // wrapper already has (e.g. user picked a value via sceneOptions.perspective);
  // when the wrapper has none (orthographic mode), fall back to 2000px to
  // match lookOffset's fallback so the math and visual stay in sync.
  // Applied via `.polycss-fpv-host` (see styles.ts) so the class's
  // `!important` overrides any inline `perspective: none`.
  function applyFpvHostPerspective(): void {
    const view = fpvHost.ownerDocument?.defaultView;
    const current = view?.getComputedStyle(fpvHost).perspective ?? "";
    const n = parseFloat(current);
    const effective = Number.isFinite(n) && n > 0 ? n : 2000;
    fpvHost.style.setProperty("--polycss-fpv-perspective", `${effective}px`);
    fpvHost.classList.add("polycss-fpv-host");
  }

  function clearFpvHostPerspective(): void {
    fpvHost.classList.remove("polycss-fpv-host");
    fpvHost.style.removeProperty("--polycss-fpv-perspective");
  }

  function attach(): void {
    host.addEventListener("click", onHostClick);
    doc.addEventListener("pointerlockchange", onPointerLockChange);
    doc.addEventListener("mousemove", onMouseMove);
    win.addEventListener("keydown", onKeyDown);
    win.addEventListener("keyup", onKeyUp);
    win.addEventListener("blur", onBlur);
    host.style.cursor = opts.lookEnabled ? "crosshair" : "";
    applyFpvHostPerspective();
  }

  function detach(): void {
    host.removeEventListener("click", onHostClick);
    doc.removeEventListener("pointerlockchange", onPointerLockChange);
    doc.removeEventListener("mousemove", onMouseMove);
    win.removeEventListener("keydown", onKeyDown);
    win.removeEventListener("keyup", onKeyUp);
    win.removeEventListener("blur", onBlur);
    host.style.cursor = "";
    keysHeld.clear();
    if (pointerLocked) {
      try { doc.exitPointerLock(); } catch { /* ignore */ }
    }
    clearFpvHostPerspective();
  }

  initializeOriginFromTarget();
  attach();
  startLoop();

  function update(partial: PolyFirstPersonControlsOptions): void {
    const prevHeight = opts.eyeHeight;
    const prevGround = opts.groundZ;
    opts = resolveFirstPersonOptions(opts, partial);
    if (!stopped) host.style.cursor = opts.lookEnabled ? "crosshair" : "";
    if (opts.eyeHeight !== prevHeight || opts.groundZ !== prevGround) {
      // Re-snap the camera's vertical position when the floor or standing
      // height changes (e.g. slider drag). Horizontal position is preserved.
      cameraOrigin[2] = opts.groundZ + opts.eyeHeight;
      syncTargetFromOrigin();
      emitChange(snapshot);
    }
  }

  function resume(): void {
    if (!stopped) return;
    stopped = false;
    attach();
    startLoop();
  }

  function pause(): void {
    if (stopped) return;
    stopped = true;
    detach();
    stopLoop();
    if (interacting) {
      interacting = false;
      emitInteraction("end", snapshot);
    }
  }

  function destroy(): void {
    pause();
    changeListeners.length = 0;
    startListeners.length = 0;
    endListeners.length = 0;
  }

  function lock(): void {
    if (!opts.enabled || !opts.lookEnabled || stopped) return;
    try { host.requestPointerLock(); } catch { /* ignore */ }
  }

  function unlock(): void {
    if (pointerLocked) {
      try { doc.exitPointerLock(); } catch { /* ignore */ }
    }
  }

  function isLocked(): boolean {
    return pointerLocked;
  }

  function addEventListener<T extends PolyControlsEvent["type"]>(
    type: T,
    listener: PolyControlsListener<Extract<PolyControlsEvent, { type: T }>>,
  ): void {
    const arr = listenerArray(type);
    if (!arr.includes(listener as PolyControlsListener)) arr.push(listener as PolyControlsListener);
  }

  function removeEventListener<T extends PolyControlsEvent["type"]>(
    type: T,
    listener: PolyControlsListener<Extract<PolyControlsEvent, { type: T }>>,
  ): void {
    const arr = listenerArray(type);
    const idx = arr.indexOf(listener as PolyControlsListener);
    if (idx >= 0) arr.splice(idx, 1);
  }

  function hasEventListener<T extends PolyControlsEvent["type"]>(
    type: T,
    listener: PolyControlsListener<Extract<PolyControlsEvent, { type: T }>>,
  ): boolean {
    return listenerArray(type).includes(listener as PolyControlsListener);
  }

  function getOrigin(): [number, number, number] {
    return [cameraOrigin[0], cameraOrigin[1], cameraOrigin[2]];
  }

  function setOrigin(origin: [number, number, number]): void {
    cameraOrigin[0] = origin[0];
    cameraOrigin[1] = origin[1];
    cameraOrigin[2] = origin[2];
    syncTargetFromOrigin();
    emitChange(snapshot);
  }

  return {
    update,
    resume,
    pause,
    destroy,
    lock,
    unlock,
    isLocked,
    getOrigin,
    setOrigin,
    addEventListener,
    removeEventListener,
    hasEventListener,
  };
}
