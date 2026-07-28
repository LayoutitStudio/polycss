import { describe, expect, it } from "vitest";
import { clonePolyMorphFixture } from "../../testing/modelFixture.js";
import { createPolyMorphRuntimeFixture } from "../../testing/runtimeFixture.js";
import { createPolyMorphSkinningFixture } from "../../testing/skinningFixture.js";
import { PolyMorphRuntimeError } from "../runtimeError.js";
import { createPolyMorphAnimationRuntime } from "./index.js";

describe("PolyMorph animation sampling", () => {
  it("samples exact boundaries and deterministic linear interpolation", () => {
    const runtime = createPolyMorphAnimationRuntime(createPolyMorphRuntimeFixture());
    expect(runtime.sample("pulse", 0).morphWeights.stretch).toBe(0);
    expect(runtime.sample("pulse", 250).morphWeights.stretch).toBe(0.5);
    expect(runtime.sample("pulse", 500).morphWeights.stretch).toBe(1);
    expect(runtime.sample("pulse", 750).morphWeights.stretch).toBe(0.5);
  });

  it("wraps loops and clamps non-looping clips", () => {
    const looping = createPolyMorphAnimationRuntime(createPolyMorphRuntimeFixture());
    expect(looping.sample("pulse", 1000).sampledTimeMs).toBe(0);
    expect(looping.sample("pulse", 1250).morphWeights.stretch).toBe(0.5);

    const fixture = clonePolyMorphFixture(createPolyMorphRuntimeFixture());
    fixture.animations[0]!.loop = false;
    const clamped = createPolyMorphAnimationRuntime(fixture);
    expect(clamped.sample("pulse", 1250).sampledTimeMs).toBe(1000);
    expect(clamped.sample("pulse", 1250).morphWeights.stretch).toBe(0);
  });

  it("honors step interpolation", () => {
    const fixture = clonePolyMorphFixture(createPolyMorphRuntimeFixture());
    fixture.animations[0]!.channels[0]!.interpolation = "step";
    const runtime = createPolyMorphAnimationRuntime(fixture);
    expect(runtime.sample("pulse", 499).morphWeights.stretch).toBe(0);
    expect(runtime.sample("pulse", 500).morphWeights.stretch).toBe(1);
    expect(runtime.sample("pulse", 501).morphWeights.stretch).toBe(1);
  });

  it("takes the shortest quaternion path and freezes sampled vectors", () => {
    const fixture = clonePolyMorphFixture(createPolyMorphSkinningFixture());
    fixture.animations[0]!.channels = [{
      target: "joint-rotation",
      targetId: "tip",
      interpolation: "linear",
      timesMs: [0, 1000],
      values: [[0, 0, 0, 1], [0, 0, 0, -1]],
    }];
    const runtime = createPolyMorphAnimationRuntime(fixture);
    const rotation = runtime.sample("tip-rise", 500)
      .jointTransforms.get("tip")!.rotation!;
    expect(rotation).toEqual([0, 0, 0, 1]);
    expect(Object.isFrozen(rotation)).toBe(true);

    fixture.animations[0]!.channels = [{
      target: "joint-translation",
      targetId: "tip",
      interpolation: "linear",
      timesMs: [0, 1000],
      values: [[0, 0, 0], [0, 2, 0]],
    }];
    const translation = createPolyMorphAnimationRuntime(fixture)
      .sample("tip-rise", 500).jointTransforms.get("tip")!.translation!;
    expect(translation).toEqual([0, 1, 0]);
    expect(Object.isFrozen(translation)).toBe(true);
  });

  it("fails closed on unknown clips and invalid time", () => {
    const runtime = createPolyMorphAnimationRuntime(createPolyMorphRuntimeFixture());
    expect(() => runtime.sample("missing", 0)).toThrowError(PolyMorphRuntimeError);
    expect(() => runtime.sample("pulse", -1)).toThrowError(PolyMorphRuntimeError);
    expect(() => runtime.sample("pulse", Number.NaN)).toThrowError(PolyMorphRuntimeError);
  });
});
