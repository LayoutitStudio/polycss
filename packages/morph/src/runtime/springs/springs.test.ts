import { describe, expect, it } from "vitest";
import { createPolyMorphRuntimeFixture } from "../../testing/runtimeFixture.js";
import { PolyMorphRuntimeError } from "../runtimeError.js";
import {
  createPolyMorphSpringRuntime,
  createPolyMorphSpringState,
  stepPolyMorphSprings,
} from "./index.js";

describe("PolyMorph springs", () => {
  it("holds an exact target without integration drift", () => {
    const runtime = createPolyMorphSpringRuntime(createPolyMorphRuntimeFixture());
    const state = createPolyMorphSpringState(runtime);
    const held = stepPolyMorphSprings(runtime, state, {
      deltaMs: 16,
      heldTarget: { controlId: "stretch-control", value: 0.75 },
    });
    expect(held.values["stretch-control"]).toBe(0.75);
    expect(held.velocities["stretch-control"]).toBe(0);
  });

  it("converges deterministically to the authored initial value", () => {
    const runtime = createPolyMorphSpringRuntime(createPolyMorphRuntimeFixture());
    let left = createPolyMorphSpringState(runtime, { "stretch-control": 1 });
    let right = createPolyMorphSpringState(runtime, { "stretch-control": 1 });
    for (let index = 0; index < 500; index += 1) {
      left = stepPolyMorphSprings(runtime, left, { deltaMs: 16 });
      right = stepPolyMorphSprings(runtime, right, { deltaMs: 16 });
    }
    expect(left).toEqual(right);
    expect(left.values["stretch-control"]).toBe(0);
    expect(left.velocities["stretch-control"]).toBe(0);
    expect(left.atRest).toBe(true);
  });

  it("stays stable for large caller steps and clears velocity at a bound", () => {
    const runtime = createPolyMorphSpringRuntime(createPolyMorphRuntimeFixture());
    const state = createPolyMorphSpringState(runtime, { "stretch-control": 1 });
    const largeStep = stepPolyMorphSprings(runtime, state, { deltaMs: 1000 });
    expect(largeStep.values["stretch-control"]).toBeGreaterThanOrEqual(0);
    expect(largeStep.values["stretch-control"]).toBeLessThanOrEqual(1);
    expect(Number.isFinite(largeStep.velocities["stretch-control"]!)).toBe(true);

    const clamped = stepPolyMorphSprings(runtime, state, { deltaMs: 500 });
    expect(clamped.values["stretch-control"]).toBe(0);
    expect(clamped.velocities["stretch-control"]).toBe(0);
    expect(clamped.atRest).toBe(true);
  });

  it("leaves explicitly frozen controls unchanged", () => {
    const runtime = createPolyMorphSpringRuntime(createPolyMorphRuntimeFixture());
    const state = createPolyMorphSpringState(runtime, { "stretch-control": 0.6 });
    const frozen = stepPolyMorphSprings(runtime, state, {
      deltaMs: 16,
      frozenControlIds: ["stretch-control"],
    });
    expect(frozen.values["stretch-control"]).toBe(0.6);
    expect(frozen.velocities["stretch-control"]).toBe(0);
  });

  it("fails closed on invalid time, ids, and held values", () => {
    const runtime = createPolyMorphSpringRuntime(createPolyMorphRuntimeFixture());
    const state = createPolyMorphSpringState(runtime);
    expect(() => stepPolyMorphSprings(runtime, state, { deltaMs: 0 }))
      .toThrowError(PolyMorphRuntimeError);
    expect(() => stepPolyMorphSprings(runtime, state, {
      deltaMs: 16,
      frozenControlIds: ["missing"],
    })).toThrowError(PolyMorphRuntimeError);
    expect(() => stepPolyMorphSprings(runtime, state, {
      deltaMs: 16,
      heldTarget: { controlId: "stretch-control", value: 2 },
    })).toThrowError(PolyMorphRuntimeError);
  });
});
