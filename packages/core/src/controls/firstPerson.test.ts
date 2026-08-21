import { describe, it, expect } from "vitest";
import {
  FIRST_PERSON_DEFAULTS,
  forwardDir,
  isFpvKey,
  resolveFirstPersonOptions,
  stepFirstPersonPhysics,
  type PolyFirstPersonPhysicsState,
} from "./firstPerson";

describe("isFpvKey", () => {
  it("recognises WASD, arrows, Space, and Control", () => {
    for (const code of [
      "KeyW", "KeyA", "KeyS", "KeyD",
      "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight",
      "Space", "ControlLeft", "ControlRight",
    ]) {
      expect(isFpvKey(code)).toBe(true);
    }
    expect(isFpvKey("KeyQ")).toBe(false);
    expect(isFpvKey("Escape")).toBe(false);
  });
});

describe("resolveFirstPersonOptions", () => {
  it("keeps the documented defaults", () => {
    const o = resolveFirstPersonOptions(FIRST_PERSON_DEFAULTS, {});
    expect(o.moveSpeed).toBe(5);
    expect(o.jumpVelocity).toBe(7);
    expect(o.gravity).toBe(18);
    expect(o.eyeHeight).toBe(1.7);
    expect(o.crouchHeight).toBe(1);
    expect(o.groundZ).toBe(0);
    expect(o.minPitch).toBe(5);
    expect(o.maxPitch).toBe(175);
    expect(o.lookSensitivity).toBe(0.15);
    expect(o.enabled).toBe(true);
  });

  it("overrides only the provided fields", () => {
    const o = resolveFirstPersonOptions(FIRST_PERSON_DEFAULTS, { moveSpeed: 8, invertY: true });
    expect(o.moveSpeed).toBe(8);
    expect(o.invertY).toBe(true);
    expect(o.gravity).toBe(18);
  });
});

describe("forwardDir", () => {
  it("looks straight down at rotX=0 and horizontal at rotX=90", () => {
    const down = forwardDir(0, 0);
    expect(down[0]).toBeCloseTo(0, 10);
    expect(down[1]).toBeCloseTo(0, 10);
    expect(down[2]).toBeCloseTo(-1, 10);
    const horizontal = forwardDir(90, 0);
    expect(horizontal[0]).toBeCloseTo(-1, 10);
    expect(horizontal[1]).toBeCloseTo(0, 10);
    expect(horizontal[2]).toBeCloseTo(0, 10);
  });

  it("is a unit vector", () => {
    const f = forwardDir(63, 127);
    expect(Math.hypot(f[0], f[1], f[2])).toBeCloseTo(1, 10);
  });
});

describe("stepFirstPersonPhysics", () => {
  const opts = FIRST_PERSON_DEFAULTS;
  const grounded = (z: number): PolyFirstPersonPhysicsState => ({
    origin: [0, 0, z],
    verticalVel: 0,
    jumpOffset: 0,
  });

  it("clamps a grounded camera to groundZ + eyeHeight", () => {
    const res = stepFirstPersonPhysics(grounded(3), new Set(), 0, 0.016, opts);
    expect(res.origin[2]).toBeCloseTo(opts.groundZ + opts.eyeHeight, 10);
    expect(res.dirty).toBe(true);
  });

  it("reports dirty=false when already at rest height with no input", () => {
    const res = stepFirstPersonPhysics(grounded(1.7), new Set(), 0, 0.016, opts);
    expect(res.dirty).toBe(false);
    expect(res.origin).toEqual([0, 0, 1.7]);
  });

  it("lowers to crouchHeight while Control is held", () => {
    const res = stepFirstPersonPhysics(grounded(1.7), new Set(["ControlLeft"]), 0, 0.016, opts);
    expect(res.origin[2]).toBeCloseTo(opts.crouchHeight, 10);
    expect(res.dirty).toBe(true);
  });

  it("walks forward along -X at rotY=0 at moveSpeed·dt", () => {
    const res = stepFirstPersonPhysics(grounded(1.7), new Set(["KeyW"]), 0, 0.1, opts);
    expect(res.origin[0]).toBeCloseTo(-opts.moveSpeed * 0.1, 10);
    expect(res.origin[1]).toBeCloseTo(0, 10);
    expect(res.dirty).toBe(true);
  });

  it("normalises diagonal movement to the same speed", () => {
    const res = stepFirstPersonPhysics(grounded(1.7), new Set(["KeyW", "KeyD"]), 0, 0.1, opts);
    const dist = Math.hypot(res.origin[0], res.origin[1]);
    expect(dist).toBeCloseTo(opts.moveSpeed * 0.1, 10);
  });

  it("cancels opposing keys", () => {
    const res = stepFirstPersonPhysics(
      grounded(1.7),
      new Set(["KeyW", "KeyS", "KeyA", "KeyD"]),
      0,
      0.1,
      opts,
    );
    expect(res.dirty).toBe(false);
  });

  it("runs a deterministic jump arc that lands back at eye height", () => {
    // Seed the jump the way renderers do on keydown.
    let state: PolyFirstPersonPhysicsState = {
      origin: [0, 0, 1.7],
      verticalVel: opts.jumpVelocity,
      jumpOffset: 0,
    };
    const dt = 1 / 60;
    let peak = 0;
    let ticks = 0;
    do {
      const res = stepFirstPersonPhysics(state, new Set(), 0, dt, opts);
      state = res;
      peak = Math.max(peak, res.jumpOffset);
      ticks += 1;
    } while ((state.verticalVel !== 0 || state.jumpOffset > 0) && ticks < 1000);

    // Landed: vertical state fully reset, origin back at standing height.
    expect(state.verticalVel).toBe(0);
    expect(state.jumpOffset).toBe(0);
    expect(state.origin[2]).toBeCloseTo(opts.groundZ + opts.eyeHeight, 10);
    // Discrete Euler peak sits near the analytic v²/2g apex.
    expect(peak).toBeGreaterThan((opts.jumpVelocity ** 2) / (2 * opts.gravity) * 0.85);
    expect(peak).toBeLessThanOrEqual((opts.jumpVelocity ** 2) / (2 * opts.gravity) * 1.05);
    // Flight time ≈ 2v/g.
    expect(ticks * dt).toBeGreaterThan((2 * opts.jumpVelocity) / opts.gravity * 0.85);
    expect(ticks * dt).toBeLessThan((2 * opts.jumpVelocity) / opts.gravity * 1.15);
  });

  it("is deterministic for identical inputs", () => {
    const a = stepFirstPersonPhysics(
      { origin: [1, 2, 2.5], verticalVel: 3, jumpOffset: 0.8 },
      new Set(["KeyW"]),
      33,
      0.02,
      opts,
    );
    const b = stepFirstPersonPhysics(
      { origin: [1, 2, 2.5], verticalVel: 3, jumpOffset: 0.8 },
      new Set(["KeyW"]),
      33,
      0.02,
      opts,
    );
    expect(a).toEqual(b);
  });

  it("resets vertical state when jump is disabled", () => {
    const res = stepFirstPersonPhysics(
      { origin: [0, 0, 2.4], verticalVel: 5, jumpOffset: 0.7 },
      new Set(),
      0,
      0.016,
      { ...opts, jumpEnabled: false },
    );
    expect(res.verticalVel).toBe(0);
    expect(res.jumpOffset).toBe(0);
    expect(res.origin[2]).toBeCloseTo(opts.groundZ + opts.eyeHeight, 10);
  });

  it("ignores movement keys when moveEnabled=false", () => {
    const res = stepFirstPersonPhysics(
      grounded(1.7),
      new Set(["KeyW"]),
      0,
      0.1,
      { ...opts, moveEnabled: false },
    );
    expect(res.origin[0]).toBe(0);
    expect(res.origin[1]).toBe(0);
    expect(res.dirty).toBe(false);
  });

  it("does not mutate the input state", () => {
    const state: PolyFirstPersonPhysicsState = {
      origin: [0, 0, 3],
      verticalVel: 1,
      jumpOffset: 0.5,
    };
    stepFirstPersonPhysics(state, new Set(["KeyW"]), 0, 0.1, opts);
    expect(state.origin).toEqual([0, 0, 3]);
    expect(state.verticalVel).toBe(1);
    expect(state.jumpOffset).toBe(0.5);
  });
});
