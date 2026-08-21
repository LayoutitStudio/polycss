/**
 * Shared wheel-zoom and animate-loop effect factories for
 * PolyOrbitControls and PolyMapControls.
 */
import type { MutableRefObject } from "react";
import {
  ANIM_DT_CLAMP_MS,
  ANIM_FRAME_MS,
  WHEEL_IDLE_END_MS,
  applyWheelDolly,
  applyWheelZoom,
  normalizeWheelDelta,
} from "@layoutit/polycss-core";
import type { CameraHandle } from "@layoutit/polycss-core";
import type { SceneStore } from "../store/sceneStore";
import type { PolyControlsAnimateOptions } from "./sharedControls";

const DEFAULT_ANIMATE_SPEED = 0.3;

interface WheelEffectArgs {
  wheel: boolean;
  dollyRef: MutableRefObject<boolean>;
  wheelRef: MutableRefObject<boolean>;
  zoomMinRef: MutableRefObject<number>;
  zoomMaxRef: MutableRefObject<number>;
  distanceMinRef: MutableRefObject<number>;
  distanceMaxRef: MutableRefObject<number>;
  cameraElRef: MutableRefObject<HTMLElement | null>;
  cameraRef: MutableRefObject<CameraHandle>;
  applyTransformDirect: () => void;
  store: SceneStore;
  fireStart: () => void;
  fireChange: () => void;
  fireEnd: () => void;
}

export function makeWheelEffect({
  wheel,
  dollyRef,
  wheelRef,
  zoomMinRef,
  zoomMaxRef,
  distanceMinRef,
  distanceMaxRef,
  cameraElRef,
  cameraRef,
  applyTransformDirect,
  store,
  fireStart,
  fireChange,
  fireEnd,
}: WheelEffectArgs): (() => void) | void {
  if (!wheel) return;
  const el = cameraElRef.current;
  if (!el) return;

  let wheelActive = false;
  let wheelIdleTimer: ReturnType<typeof setTimeout> | null = null;

  const onWheel = (e: WheelEvent): void => {
    if (!wheelRef.current) return;
    e.preventDefault();
    const delta = normalizeWheelDelta(e.deltaY, e.deltaMode, e.ctrlKey);
    const handle = cameraRef.current;
    if (dollyRef.current) {
      const nextDist = applyWheelDolly(
        handle.state.distance,
        delta,
        distanceMinRef.current,
        distanceMaxRef.current,
      );
      handle.update({ distance: nextDist });
    } else {
      // Zoom mode: change CSS scale.
      const next = applyWheelZoom(
        handle.state.zoom,
        delta,
        zoomMinRef.current,
        zoomMaxRef.current,
      );
      handle.update({ zoom: next });
    }
    applyTransformDirect();
    store.updateCameraFromRef(handle);
    if (!wheelActive) {
      wheelActive = true;
      fireStart();
    }
    fireChange();
    if (wheelIdleTimer !== null) clearTimeout(wheelIdleTimer);
    wheelIdleTimer = setTimeout(() => {
      wheelIdleTimer = null;
      wheelActive = false;
      fireEnd();
    }, WHEEL_IDLE_END_MS);
  };

  el.addEventListener("wheel", onWheel, { passive: false });
  return () => {
    el.removeEventListener("wheel", onWheel);
    if (wheelIdleTimer !== null) clearTimeout(wheelIdleTimer);
  };
}

interface AnimateEffectArgs {
  animateOn: boolean;
  animateRef: MutableRefObject<false | PolyControlsAnimateOptions>;
  animationPausedShared: { value: boolean };
  applyTransformDirect: () => void;
  cameraRef: MutableRefObject<CameraHandle>;
  store: SceneStore;
  fireChange: () => void;
}

export function makeAnimateEffect({
  animateOn,
  animateRef,
  animationPausedShared,
  applyTransformDirect,
  cameraRef,
  store,
  fireChange,
}: AnimateEffectArgs): (() => void) | void {
  if (!animateOn) return;
  let rafId: number | null = null;
  let stopped = false;
  let lastTime = 0;
  const tick = (now: number): void => {
    if (stopped) return;
    const a = animateRef.current;
    if (!a) {
      rafId = requestAnimationFrame(tick);
      return;
    }
    if (!animationPausedShared.value) {
      const dt = Math.min(ANIM_DT_CLAMP_MS, lastTime ? now - lastTime : ANIM_FRAME_MS);
      lastTime = now;
      const speed = a.speed ?? DEFAULT_ANIMATE_SPEED;
      const delta = speed * (dt / ANIM_FRAME_MS);
      const handle = cameraRef.current;
      const s = handle.state;
      if (a.axis === "x") {
        const rotX = (((s.rotX + delta) % 360) + 360) % 360;
        handle.update({ rotX });
      } else {
        const rotY = (((s.rotY + delta) % 360) + 360) % 360;
        handle.update({ rotY });
      }
      applyTransformDirect();
      store.updateCameraFromRef(handle);
      fireChange();
    } else {
      lastTime = now;
    }
    rafId = requestAnimationFrame(tick);
  };
  rafId = requestAnimationFrame(tick);
  return () => {
    stopped = true;
    if (rafId !== null) cancelAnimationFrame(rafId);
  };
}
