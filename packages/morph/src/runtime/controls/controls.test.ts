import { describe, expect, it } from "vitest";
import { createPolyMorphRuntimeFixture } from "../../testing/runtimeFixture.js";
import { PolyMorphRuntimeError } from "../runtimeError.js";
import {
  createPolyMorphControlRuntime,
  createPolyMorphControlState,
  pickPolyMorphControl,
  stepPolyMorphControls,
} from "./index.js";

describe("PolyMorph semantic controls", () => {
  it("picks the nearest bounded control", () => {
    const runtime = createPolyMorphControlRuntime(createPolyMorphRuntimeFixture());
    expect(pickPolyMorphControl(runtime, [0, 1, 0])).toBe("stretch-control");
    expect(pickPolyMorphControl(runtime, [10, 10, 10])).toBeNull();
  });

  it("tracks a held directional displacement and clamps its value", () => {
    const runtime = createPolyMorphControlRuntime(createPolyMorphRuntimeFixture());
    let state = createPolyMorphControlState(runtime);
    let step = stepPolyMorphControls(runtime, state, { point: [0, 1, 0], active: true });
    expect(step.pickedControlId).toBe("stretch-control");
    expect(step.heldTarget?.value).toBe(0);
    state = step.state;

    step = stepPolyMorphControls(runtime, state, { point: [0, 1.75, 0], active: true });
    expect(step.heldTarget?.value).toBe(0.75);
    state = step.state;

    step = stepPolyMorphControls(runtime, state, { point: [0, 4, 0], active: true });
    expect(step.heldTarget?.value).toBe(1);
  });

  it("supports spring release and explicit freeze release", () => {
    const runtime = createPolyMorphControlRuntime(createPolyMorphRuntimeFixture());
    let state = createPolyMorphControlState(runtime);
    state = stepPolyMorphControls(runtime, state, { point: [0, 1, 0], active: true }).state;
    state = stepPolyMorphControls(runtime, state, { point: [0, 1.5, 0], active: true }).state;
    const released = stepPolyMorphControls(runtime, state, {
      point: [0, 1.5, 0],
      active: false,
    });
    expect(released.releasedControlId).toBe("stretch-control");
    expect(released.state.frozenControlIds).toEqual([]);

    state = stepPolyMorphControls(runtime, released.state, { point: [0, 1, 0], active: true }).state;
    state = stepPolyMorphControls(runtime, state, { point: [0, 1.5, 0], active: true }).state;
    const frozen = stepPolyMorphControls(runtime, state, {
      point: [0, 1.5, 0],
      active: false,
      freezeOnRelease: true,
    });
    expect(frozen.state.frozenControlIds).toEqual(["stretch-control"]);
  });

  it("fails closed on malformed points and state", () => {
    const runtime = createPolyMorphControlRuntime(createPolyMorphRuntimeFixture());
    const state = createPolyMorphControlState(runtime);
    expect(() => stepPolyMorphControls(runtime, state, {
      point: [0, Number.NaN, 0],
      active: true,
    })).toThrowError(PolyMorphRuntimeError);
  });
});
