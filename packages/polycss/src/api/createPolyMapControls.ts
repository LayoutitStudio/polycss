/**
 * createPolyMapControls — map/pan-mode camera input for a PolyScene.
 *
 * Left-drag pans the target (slippy-map semantics — terrain follows pointer).
 * Right-drag or Shift+left-drag orbits. Wheel zooms or dollies.
 * Mirrors Three.js MapControls semantics.
 *
 * For orbit-only semantics (left-drag orbits) use `createPolyOrbitControls`
 * instead.
 */

import { applyOrbit, applyPan } from "@layoutit/polycss-core";
import type { PolySceneHandle } from "./createPolyScene";
import {
  BASE_DEFAULTS,
  resolveOptions,
  makeListenerRegistry,
  makeCameraSnapshot,
  makeWheelHandler,
  makeAnimLoop,
  type PolyControlsBaseOptions,
  type PolyControlsHandle,
  type PolyControlsEvent,
  type PolyControlsListener,
  type ResolvedOptions,
} from "./controls/common";

export type {
  PolyControlsAnimateOptions,
  PolyControlsCamera,
  PolyControlsChangeEvent,
  PolyControlsInteractionEvent,
  PolyControlsEvent,
  PolyControlsListener,
  PolyControlsHandle,
} from "./controls/common";

export type PolyMapControlsOptions = PolyControlsBaseOptions;
export type PolyMapControlsHandle = PolyControlsHandle;

export function createPolyMapControls(
  scene: PolySceneHandle,
  options: PolyMapControlsOptions = {},
): PolyMapControlsHandle {
  let opts: ResolvedOptions = resolveOptions(BASE_DEFAULTS, options);
  const host = scene.host;
  const win = host.ownerDocument?.defaultView ?? globalThis;

  let activePointerId: number | null = null;
  let pointer = { x: 0, y: 0 };
  let animPaused = false;
  let stopped = false;

  // Right-drag state for orbit via right button
  let rightDragActive = false;
  let rightPointer = { x: 0, y: 0 };

  const registry = makeListenerRegistry();
  const snapshot = makeCameraSnapshot(scene);
  const { changeListeners, startListeners, endListeners, listenerArray, emitChange, emitInteraction } = registry;

  const animLoop = makeAnimLoop(
    win as typeof globalThis,
    scene,
    () => opts,
    () => stopped,
    () => animPaused,
    snapshot,
    emitChange,
  );

  // ── Left-drag: pan ────────────────────────────────────────────────────────
  const onPointerDown = (e: PointerEvent): void => {
    if (!opts.drag || stopped) return;
    if (activePointerId !== null) return;
    if (e.isPrimary === false) return;
    e.preventDefault();
    activePointerId = e.pointerId;
    pointer = { x: e.clientX, y: e.clientY };
    host.style.cursor = "grabbing";
    try { (e.target as Element).setPointerCapture(e.pointerId); } catch { /* ignore */ }
    if (opts.animate && opts.animate.pauseOnInteraction) {
      animPaused = true;
    }
    emitInteraction("start", snapshot);
  };

  const onPointerMove = (e: PointerEvent): void => {
    if (activePointerId === null || e.pointerId !== activePointerId) return;
    if (!opts.drag || stopped) return;
    e.preventDefault();
    const dx = e.clientX - pointer.x;
    const dy = e.clientY - pointer.y;
    pointer = { x: e.clientX, y: e.clientY };
    const cameraState = scene.camera.state;

    if (e.shiftKey) {
      // Shift+left-drag orbits
      const next = applyOrbit(dx, dy, cameraState.rotX ?? 65, cameraState.rotY ?? 45, opts.invert);
      scene.camera.update({ rotX: next.rotX, rotY: next.rotY });
    } else {
      // Left-drag pans (slippy-map semantics)
      const { targetD0, targetD1 } = applyPan(
        dx,
        dy,
        cameraState.zoom ?? 1,
        cameraState.rotX ?? 65,
        cameraState.rotY ?? 45,
      );
      const t = cameraState.target ?? [0, 0, 0];
      scene.camera.update({ target: [t[0] + targetD0, t[1] + targetD1, t[2]] });
    }
    scene.applyCamera();
    emitChange(snapshot);
  };

  const onPointerUp = (e: PointerEvent): void => {
    if (activePointerId !== e.pointerId) return;
    activePointerId = null;
    host.style.cursor = opts.drag && !stopped ? "grab" : "";
    try { (e.target as Element).releasePointerCapture(e.pointerId); } catch { /* ignore */ }
    if (opts.animate && opts.animate.pauseOnInteraction) {
      animPaused = false;
    }
    emitInteraction("end", snapshot);
  };

  // ── Right-drag: orbit ────────────────────────────────────────────────────
  const onContextMenu = (e: Event): void => { e.preventDefault(); };

  const onMouseDown = (e: MouseEvent): void => {
    if (e.button !== 2) return;
    rightDragActive = true;
    rightPointer = { x: e.clientX, y: e.clientY };
    if (opts.animate && opts.animate.pauseOnInteraction) {
      animPaused = true;
    }
    emitInteraction("start", snapshot);
  };

  const onMouseMove = (e: MouseEvent): void => {
    if (!rightDragActive || !opts.drag) return;
    const dx = e.clientX - rightPointer.x;
    const dy = e.clientY - rightPointer.y;
    rightPointer = { x: e.clientX, y: e.clientY };
    const cameraState = scene.camera.state;
    const next = applyOrbit(dx, dy, cameraState.rotX ?? 65, cameraState.rotY ?? 45, opts.invert);
    scene.camera.update({ rotX: next.rotX, rotY: next.rotY });
    scene.applyCamera();
    emitChange(snapshot);
  };

  const onMouseUp = (e: MouseEvent): void => {
    if (e.button !== 2) return;
    if (rightDragActive) {
      rightDragActive = false;
      emitInteraction("end", snapshot);
    }
  };

  const wheelHandler = makeWheelHandler(
    scene,
    () => opts,
    () => stopped,
    snapshot,
    emitChange,
    emitInteraction,
  );

  function attach(): void {
    host.addEventListener("pointerdown", onPointerDown);
    host.addEventListener("pointermove", onPointerMove);
    host.addEventListener("pointerup", onPointerUp);
    host.addEventListener("pointercancel", onPointerUp);
    host.addEventListener("wheel", wheelHandler.onWheel, { passive: false });
    host.addEventListener("contextmenu", onContextMenu);
    host.addEventListener("mousedown", onMouseDown);
    host.addEventListener("mousemove", onMouseMove);
    host.addEventListener("mouseup", onMouseUp);
    host.style.cursor = opts.drag ? "grab" : "";
    host.style.touchAction = "none";
    host.style.userSelect = "none";
  }

  function detach(): void {
    host.removeEventListener("pointerdown", onPointerDown);
    host.removeEventListener("pointermove", onPointerMove);
    host.removeEventListener("pointerup", onPointerUp);
    host.removeEventListener("pointercancel", onPointerUp);
    host.removeEventListener("wheel", wheelHandler.onWheel);
    host.removeEventListener("contextmenu", onContextMenu);
    host.removeEventListener("mousedown", onMouseDown);
    host.removeEventListener("mousemove", onMouseMove);
    host.removeEventListener("mouseup", onMouseUp);
    host.style.cursor = "";
    host.style.touchAction = "";
    host.style.userSelect = "";
    wheelHandler.teardown();
  }

  attach();
  animLoop.start();

  function update(partial: PolyMapControlsOptions): void {
    const wasAnimating = !!opts.animate;
    opts = resolveOptions(opts, partial);
    if (!stopped && activePointerId === null) {
      host.style.cursor = opts.drag ? "grab" : "";
    }
    const isAnimating = !!opts.animate;
    if (wasAnimating && !isAnimating) {
      animLoop.stop();
    } else if (!wasAnimating && isAnimating) {
      animLoop.start();
    }
  }

  function resume(): void {
    if (!stopped) return;
    stopped = false;
    attach();
    animLoop.start();
  }

  function pause(): void {
    if (stopped) return;
    stopped = true;
    detach();
    animLoop.stop();
    activePointerId = null;
    animPaused = false;
    rightDragActive = false;
    wheelHandler.teardown();
  }

  function destroy(): void {
    pause();
    changeListeners.length = 0;
    startListeners.length = 0;
    endListeners.length = 0;
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

  return { update, resume, pause, destroy, addEventListener, removeEventListener, hasEventListener };
}
