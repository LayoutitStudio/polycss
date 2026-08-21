/**
 * <PolyFirstPersonControls> — Vue 3 first-person camera controls for polycss.
 *
 * Pointer-lock mouselook (click to acquire), WASD/arrow planar move, Space
 * jump, Ctrl crouch. Each input axis is independently toggled via props.
 *
 *   <PolyCamera>
 *     <PolyScene>
 *       <PolyFirstPersonControls />
 *       <PolyMesh :polygons="..." />
 *     </PolyScene>
 *   </PolyCamera>
 *
 * The handle (with getOrigin/setOrigin/lock/unlock/etc.) is accessible via
 * template ref:
 *
 *   <PolyFirstPersonControls ref="fpvRef" />
 *   fpvRef.value.setOrigin([10, 5, 0])
 */
import {
  defineComponent,
  inject,
  onMounted,
  onBeforeUnmount,
  watch,
} from "vue";
import {
  BASE_TILE,
  CROUCH_KEYS,
  FIRST_PERSON_DEFAULTS,
  JUMP_KEYS,
  forwardDir,
  isFpvKey,
  resolveFirstPersonOptions,
  stepFirstPersonPhysics,
} from "@layoutit/polycss-core";
import type {
  PolyFirstPersonControlsOptions,
  PolyFirstPersonResolvedOptions,
} from "@layoutit/polycss-core";
import { PolyCameraContextKey } from "../camera/context";

// ── Public types (mirror React names/shapes) ──────────────────────────────────

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
   * The camera's WORLD position (the eye). Snapshot — mutate via WASD /
   * jump / crouch, or by calling `setOrigin`.
   */
  getOrigin(): [number, number, number];
  /**
   * Move the camera origin to a specific world position. Re-derives the
   * scene's target so the perspective viewer follows.
   */
  setOrigin(origin: [number, number, number]): void;
  addEventListener(type: "change" | "start" | "end", listener: () => void): void;
  removeEventListener(type: "change" | "start" | "end", listener: () => void): void;
  hasEventListener(type: "change" | "start" | "end", listener: () => void): boolean;
}

// ── Listener registry ─────────────────────────────────────────────────────────

type EventType = "change" | "start" | "end";

interface ListenerRegistry {
  change: Array<() => void>;
  start: Array<() => void>;
  end: Array<() => void>;
}

function makeRegistry(): ListenerRegistry {
  return { change: [], start: [], end: [] };
}

function emitEvent(registry: ListenerRegistry, type: EventType): void {
  const list = [...registry[type]]; // snapshot to avoid mutation during iteration
  for (const fn of list) {
    try { fn(); } catch { /* ignore */ }
  }
}

// ── Component ─────────────────────────────────────────────────────────────────

export const PolyFirstPersonControls = defineComponent({
  name: "PolyFirstPersonControls",
  props: {
    enabled: { type: Boolean, default: true },
    lookEnabled: { type: Boolean, default: true },
    moveEnabled: { type: Boolean, default: true },
    jumpEnabled: { type: Boolean, default: true },
    crouchEnabled: { type: Boolean, default: true },
    lookSensitivity: { type: Number, default: 0.15 },
    invertY: { type: Boolean, default: false },
    moveSpeed: { type: Number, default: 5 },
    jumpVelocity: { type: Number, default: 7 },
    gravity: { type: Number, default: 18 },
    eyeHeight: { type: Number, default: 1.7 },
    crouchHeight: { type: Number, default: 1 },
    groundZ: { type: Number, default: 0 },
    minPitch: { type: Number, default: 5 },
    maxPitch: { type: Number, default: 175 },
  },
  emits: {
    change: (_origin: [number, number, number]) => true,
    "interaction-start": (_origin: [number, number, number]) => true,
    "interaction-end": (_origin: [number, number, number]) => true,
  },
  setup(props, { emit, expose }) {
    const ctx = inject(PolyCameraContextKey, null);
    if (!ctx) {
      if (typeof console !== "undefined") {
        console.warn("[polycss] <PolyFirstPersonControls> must be used inside <PolyCamera>.");
      }
      expose({});
      return () => null;
    }

    const { store, cameraRef, cameraElRef, applyTransformDirect } = ctx;

    // Mutable options — prop changes are forwarded here without tearing down listeners.
    let opts: PolyFirstPersonResolvedOptions = resolveFirstPersonOptions(FIRST_PERSON_DEFAULTS, props);

    // Camera origin (eye position in world coords).
    const cameraOrigin: [number, number, number] = [0, 0, 0];

    // RAF state
    let rafId: number | null = null;
    let lastTime = 0;
    let stopped = false;

    // Pointer-lock + interaction state
    let pointerLocked = false;
    let interacting = false;

    // Keys held
    const keysHeld = new Set<string>();

    // Vertical state for jump/gravity
    let verticalVel = 0;
    let jumpOffset = 0;

    // Listener registry for the imperative handle's event API
    const registry = makeRegistry();

    // ── Helpers ────────────────────────────────────────────────────────────────

    function lookOffset(): number {
      const host = cameraElRef.value;
      const perspStr = host ? getComputedStyle(host).perspective : "";
      const n = parseFloat(perspStr);
      return (Number.isFinite(n) && n > 0 ? n : 32000) / BASE_TILE;
    }

    function deriveTarget(): [number, number, number] {
      const s = cameraRef.value.state;
      const f = forwardDir(s.rotX ?? 90, s.rotY ?? 0);
      const d = lookOffset();
      return [
        cameraOrigin[0] + f[0] * d,
        cameraOrigin[1] + f[1] * d,
        cameraOrigin[2] + f[2] * d,
      ];
    }

    function syncTargetFromOrigin(): void {
      const t = deriveTarget();
      const handle = cameraRef.value;
      handle.update({ target: t });
      applyTransformDirect();
      store.updateCameraFromRef(handle);
    }

    // ── RAF tick ───────────────────────────────────────────────────────────────

    const ANIM_DT_CLAMP = 0.05;

    function tick(now: number): void {
      if (rafId === null || stopped) return;
      const dt = Math.min(ANIM_DT_CLAMP, lastTime ? (now - lastTime) / 1000 : 0.0167);
      lastTime = now;

      if (opts.enabled) {
        const s = cameraRef.value.state;

        const res = stepFirstPersonPhysics(
          { origin: cameraOrigin, verticalVel, jumpOffset },
          keysHeld,
          s.rotY ?? 0,
          dt,
          opts,
        );
        cameraOrigin[0] = res.origin[0];
        cameraOrigin[1] = res.origin[1];
        cameraOrigin[2] = res.origin[2];
        verticalVel = res.verticalVel;
        jumpOffset = res.jumpOffset;

        if (res.dirty) {
          const t = deriveTarget();
          const handle = cameraRef.value;
          handle.update({ target: t });
          applyTransformDirect();
          store.updateCameraFromRef(handle);
          emitEvent(registry, "change");
          try { emit("change", [cameraOrigin[0], cameraOrigin[1], cameraOrigin[2]]); } catch { /* ignore */ }
        }
      }

      rafId = requestAnimationFrame(tick);
    }

    function startLoop(): void {
      if (rafId !== null || stopped) return;
      lastTime = 0;
      rafId = requestAnimationFrame(tick);
    }

    function stopLoop(): void {
      if (rafId === null) return;
      cancelAnimationFrame(rafId);
      rafId = null;
    }

    // ── Event listeners ────────────────────────────────────────────────────────

    let cleanupListeners: (() => void) | null = null;

    function attachListeners(): void {
      const host = cameraElRef.value;
      if (!host) return;

      const doc = host.ownerDocument ?? document;
      const win = (doc.defaultView ?? globalThis) as typeof globalThis;

      const onHostClick = (): void => {
        if (!opts.enabled || !opts.lookEnabled || stopped || pointerLocked) return;
        try { host.requestPointerLock(); } catch { /* ignore */ }
      };

      const onPointerLockChange = (): void => {
        const locked = doc.pointerLockElement === host;
        if (locked === pointerLocked) return;
        pointerLocked = locked;
        if (locked) {
          interacting = true;
          emitEvent(registry, "start");
          try { emit("interaction-start", [cameraOrigin[0], cameraOrigin[1], cameraOrigin[2]]); } catch { /* ignore */ }
        } else {
          if (interacting) {
            interacting = false;
            emitEvent(registry, "end");
            try { emit("interaction-end", [cameraOrigin[0], cameraOrigin[1], cameraOrigin[2]]); } catch { /* ignore */ }
          }
        }
      };

      const onMouseMove = (e: MouseEvent): void => {
        if (!pointerLocked || stopped) return;
        if (!opts.enabled || !opts.lookEnabled) return;
        const dx = e.movementX ?? 0;
        const dy = e.movementY ?? 0;
        if (dx === 0 && dy === 0) return;
        const handle = cameraRef.value;
        const sceneOpts = handle.state;
        const sens = opts.lookSensitivity;
        const dyDir = opts.invertY ? -1 : 1;
        const rotY = ((((sceneOpts.rotY ?? 0) - dx * sens) % 360) + 360) % 360;
        let rotX = (sceneOpts.rotX ?? 90) - dy * sens * dyDir;
        if (rotX < opts.minPitch) rotX = opts.minPitch;
        else if (rotX > opts.maxPitch) rotX = opts.maxPitch;
        const f = forwardDir(rotX, rotY);
        const d = lookOffset();
        const target: [number, number, number] = [
          cameraOrigin[0] + f[0] * d,
          cameraOrigin[1] + f[1] * d,
          cameraOrigin[2] + f[2] * d,
        ];
        handle.update({ rotX, rotY, target });
        applyTransformDirect();
        store.updateCameraFromRef(handle);
        emitEvent(registry, "change");
        try { emit("change", [cameraOrigin[0], cameraOrigin[1], cameraOrigin[2]]); } catch { /* ignore */ }
      };

      const onKeyDown = (e: KeyboardEvent): void => {
        if (!opts.enabled || stopped) return;
        if (!isFpvKey(e.code)) return;
        if (!pointerLocked && !opts.moveEnabled) return;
        if (JUMP_KEYS.has(e.code)) {
          if (!opts.jumpEnabled) return;
          e.preventDefault();
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

      host.addEventListener("click", onHostClick);
      doc.addEventListener("pointerlockchange", onPointerLockChange);
      doc.addEventListener("mousemove", onMouseMove);
      win.addEventListener("keydown", onKeyDown);
      win.addEventListener("keyup", onKeyUp);
      win.addEventListener("blur", onBlur);

      // FPV needs a perspective context on the host so scene Z motion shows
      // as depth, not as a planar pan. Read the current effective perspective
      // BEFORE adding the class so we honor any value the camera component
      // set; fall back to 2000px for orthographic so the FPV math and visual
      // stay in sync. The `.polycss-fpv-host` class uses `!important` to
      // override inline `perspective: none`.
      const computedPersp = win.getComputedStyle(host).perspective;
      const persp = parseFloat(computedPersp);
      const effectivePersp = Number.isFinite(persp) && persp > 0 ? persp : 2000;
      host.style.setProperty("--polycss-fpv-perspective", `${effectivePersp}px`);
      host.classList.add("polycss-fpv-host");

      cleanupListeners = (): void => {
        host.removeEventListener("click", onHostClick);
        doc.removeEventListener("pointerlockchange", onPointerLockChange);
        doc.removeEventListener("mousemove", onMouseMove);
        win.removeEventListener("keydown", onKeyDown);
        win.removeEventListener("keyup", onKeyUp);
        win.removeEventListener("blur", onBlur);
        host.style.cursor = "";
        host.classList.remove("polycss-fpv-host");
        host.style.removeProperty("--polycss-fpv-perspective");
        keysHeld.clear();
        if (pointerLocked) {
          try { doc.exitPointerLock(); } catch { /* ignore */ }
        }
      };
    }

    // ── Exposed imperative handle ──────────────────────────────────────────────

    expose({
      update(partial: PolyFirstPersonControlsOptions): void {
        opts = resolveFirstPersonOptions(opts, partial);
        const host = cameraElRef.value;
        if (host && !stopped) {
          host.style.cursor = opts.lookEnabled ? "crosshair" : "";
        }
      },
      resume(): void {
        if (!stopped) return;
        stopped = false;
        const host = cameraElRef.value;
        if (host) host.style.cursor = opts.lookEnabled ? "crosshair" : "";
        startLoop();
      },
      pause(): void {
        if (stopped) return;
        stopped = true;
        stopLoop();
        const host = cameraElRef.value;
        if (host) host.style.cursor = "";
        if (interacting) {
          interacting = false;
          emitEvent(registry, "end");
          try { emit("interaction-end", [cameraOrigin[0], cameraOrigin[1], cameraOrigin[2]]); } catch { /* ignore */ }
        }
      },
      destroy(): void {
        stopped = true;
        stopLoop();
      },
      lock(): void {
        if (!opts.enabled || !opts.lookEnabled || stopped) return;
        const host = cameraElRef.value;
        try { host?.requestPointerLock(); } catch { /* ignore */ }
      },
      unlock(): void {
        if (pointerLocked) {
          const host = cameraElRef.value;
          try { host?.ownerDocument?.exitPointerLock(); } catch { /* ignore */ }
        }
      },
      isLocked(): boolean {
        return pointerLocked;
      },
      getOrigin(): [number, number, number] {
        return [cameraOrigin[0], cameraOrigin[1], cameraOrigin[2]];
      },
      setOrigin(origin: [number, number, number]): void {
        cameraOrigin[0] = origin[0];
        cameraOrigin[1] = origin[1];
        cameraOrigin[2] = origin[2];
        syncTargetFromOrigin();
        emitEvent(registry, "change");
        try { emit("change", [cameraOrigin[0], cameraOrigin[1], cameraOrigin[2]]); } catch { /* ignore */ }
      },
      addEventListener(type: EventType, listener: () => void): void {
        const arr = registry[type];
        if (!arr.includes(listener)) arr.push(listener);
      },
      removeEventListener(type: EventType, listener: () => void): void {
        const arr = registry[type];
        const idx = arr.indexOf(listener);
        if (idx >= 0) arr.splice(idx, 1);
      },
      hasEventListener(type: EventType, listener: () => void): boolean {
        return registry[type].includes(listener);
      },
    } satisfies PolyFirstPersonControlsHandle);

    // ── Lifecycle ──────────────────────────────────────────────────────────────

    onMounted(() => {
      const host = cameraElRef.value;
      if (!host) return;

      stopped = false;
      pointerLocked = false;
      interacting = false;
      keysHeld.clear();
      verticalVel = 0;
      jumpOffset = 0;

      // Seed camera origin from current target, snapped to eye height.
      const s = cameraRef.value.state;
      const t = s.target ?? [0, 0, 0];
      cameraOrigin[0] = t[0];
      cameraOrigin[1] = t[1];
      cameraOrigin[2] = opts.groundZ + opts.eyeHeight;
      syncTargetFromOrigin();

      host.style.cursor = opts.lookEnabled ? "crosshair" : "";

      attachListeners();
      startLoop();
    });

    onBeforeUnmount(() => {
      stopped = true;
      stopLoop();
      cleanupListeners?.();
      cleanupListeners = null;
    });

    // Forward prop changes to the live opts without tearing down listeners.
    const PROP_KEYS = [
      "enabled", "lookEnabled", "moveEnabled", "jumpEnabled", "crouchEnabled",
      "lookSensitivity", "invertY", "moveSpeed", "jumpVelocity", "gravity",
      "eyeHeight", "crouchHeight", "groundZ", "minPitch", "maxPitch",
    ] as const;
    for (const key of PROP_KEYS) {
      watch(
        () => props[key],
        () => {
          opts = resolveFirstPersonOptions(opts, props);
          const host = cameraElRef.value;
          if (host && !stopped) {
            host.style.cursor = opts.lookEnabled ? "crosshair" : "";
          }
        },
      );
    }

    return () => null;
  },
});
