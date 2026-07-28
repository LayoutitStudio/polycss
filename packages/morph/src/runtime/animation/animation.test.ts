import { describe, expect, it } from "vitest";
import { clonePolyMorphFixture } from "../../testing/modelFixture.js";
import { createPolyMorphRuntimeFixture } from "../../testing/runtimeFixture.js";
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
    expect(runtime.sample("pulse", 500).morphWeights.stretch).toBe(0);
    expect(runtime.sample("pulse", 501).morphWeights.stretch).toBe(1);
  });

  it("fails closed on unknown clips and invalid time", () => {
    const runtime = createPolyMorphAnimationRuntime(createPolyMorphRuntimeFixture());
    expect(() => runtime.sample("missing", 0)).toThrowError(PolyMorphRuntimeError);
    expect(() => runtime.sample("pulse", -1)).toThrowError(PolyMorphRuntimeError);
    expect(() => runtime.sample("pulse", Number.NaN)).toThrowError(PolyMorphRuntimeError);
  });
});
