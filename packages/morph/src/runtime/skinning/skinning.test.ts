import { describe, expect, it } from "vitest";
import { PolyMorphContractError } from "../../contracts/index.js";
import { clonePolyMorphFixture } from "../../testing/modelFixture.js";
import { createPolyMorphSkinningFixture } from "../../testing/skinningFixture.js";
import {
  POLY_MORPH_EXECUTABLE_PROFILES,
  PolyMorphRuntimeError,
} from "../index.js";
import { createPolyMorphSkinningRuntime } from "./index.js";

describe("PolyMorph joint skinning", () => {
  it("keeps the exact rest pose without dirty rows", () => {
    const fixture = createPolyMorphSkinningFixture();
    const runtime = createPolyMorphSkinningRuntime(fixture);
    const frame = runtime.sample({ tick: 0 });
    expect(frame.positions).toEqual(fixture.topology.vertices);
    expect(frame.normals).toEqual(fixture.topology.normals);
    expect(frame.dirtyLeafIds).toEqual([]);
    expect(frame.leafUpdates).toEqual([]);
  });

  it("matches hand-computed parent-child and weighted deformation", () => {
    const runtime = createPolyMorphSkinningRuntime(createPolyMorphSkinningFixture());
    const frame = runtime.sample({
      tick: 1,
      jointTransforms: new Map([
        ["root", { translation: [2, 0, 0] }],
        ["tip", { translation: [0, 2, 0] }],
      ]),
    });
    expect(frame.positions[0]).toEqual([2, 0, 0]);
    expect(frame.positions[1]).toEqual([3, 1, 0]);
    expect(frame.positions[2]).toEqual([2, 3, 0]);
    expect(frame.normals).toEqual([
      [0, 0, 1],
      [0, 0, 1],
      [0, 0, 1],
    ]);
    expect(frame.dirtyLeafIds).toEqual(["gem-panel-leaf"]);
    expect(frame.leafUpdates[0]?.matrix).toHaveLength(16);
  });

  it("turns a repeated pose into a no-op", () => {
    const runtime = createPolyMorphSkinningRuntime(createPolyMorphSkinningFixture());
    const transforms = new Map([
      ["tip", { translation: [0, 1, 0] as const }],
    ]);
    expect(runtime.sample({ tick: 1, jointTransforms: transforms }).dirtyLeafIds)
      .toEqual(["gem-panel-leaf"]);
    expect(runtime.sample({ tick: 2, jointTransforms: transforms }).dirtyLeafIds)
      .toEqual([]);
  });

  it("samples joint clips at boundaries and applies them to prepared leaves", () => {
    const runtime = createPolyMorphSkinningRuntime(createPolyMorphSkinningFixture());
    const middle = runtime.sampleClip("tip-rise", 500, 1);
    expect(middle.positions[1]).toEqual([1, 0.5, 0]);
    expect(middle.positions[2]).toEqual([0, 2, 0]);
    expect(middle.dirtyLeafIds).toEqual(["gem-panel-leaf"]);
    const end = runtime.sampleClip("tip-rise", 1000, 2);
    expect(end.positions[2]).toEqual([0, 3, 0]);
  });

  it("respects deterministic clip looping", () => {
    const fixture = clonePolyMorphFixture(createPolyMorphSkinningFixture());
    fixture.animations[0]!.loop = true;
    const runtime = createPolyMorphSkinningRuntime(fixture);
    expect(runtime.sampleClip("tip-rise", 1000, 1).positions).toEqual(fixture.topology.vertices);
    expect(runtime.sampleClip("tip-rise", 1500, 2).positions[2]).toEqual([0, 2, 0]);
  });

  it("rejects invalid hierarchy, references, and weights through the contract gate", () => {
    const cyclic = clonePolyMorphFixture(createPolyMorphSkinningFixture());
    cyclic.deformation.joints[0]!.parentId = "tip";
    expect(() => createPolyMorphSkinningRuntime(cyclic)).toThrowError(PolyMorphContractError);

    const unknown = clonePolyMorphFixture(createPolyMorphSkinningFixture());
    unknown.deformation.vertices[0]!.influences[0]!.jointId = "missing";
    expect(() => createPolyMorphSkinningRuntime(unknown)).toThrowError(PolyMorphContractError);

    const weights = clonePolyMorphFixture(createPolyMorphSkinningFixture());
    weights.deformation.vertices[1]!.influences[0]!.weight = 0.75;
    expect(() => createPolyMorphSkinningRuntime(weights)).toThrowError(PolyMorphContractError);
  });

  it("rejects unknown joints and malformed pose transforms", () => {
    const runtime = createPolyMorphSkinningRuntime(createPolyMorphSkinningFixture());
    expect(() => runtime.sample({
      tick: 0,
      jointTransforms: new Map([["missing", { translation: [1, 0, 0] }]]),
    })).toThrowError(PolyMorphRuntimeError);
    expect(() => runtime.sample({
      tick: 0,
      jointTransforms: new Map([["tip", { rotation: [0, 0, 0, 0] }]]),
    })).toThrowError(PolyMorphRuntimeError);
    expect(() => runtime.sample({
      tick: 0,
      jointTransforms: new Map([["tip", { scale: [1, 0, 1] }]]),
    })).toThrowError(PolyMorphRuntimeError);
  });

  it("advertises joint-skin only with the executable runtime present", () => {
    expect(POLY_MORPH_EXECUTABLE_PROFILES).toContain("joint-skin");
    expect(createPolyMorphSkinningRuntime).toBeTypeOf("function");
  });
});
