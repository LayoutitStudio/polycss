import { describe, expect, it, vi } from "vitest";
import { PolyMorphContractError } from "../../contracts/index.js";
import { mountPolyMorphModel } from "../../render/index.js";
import {
  clonePolyMorphFixture,
  createPolyMorphModelFixture,
} from "../../testing/modelFixture.js";
import { createPolyMorphPlaybackFixture } from "../../testing/playbackFixture.js";
import {
  POLY_MORPH_EXECUTABLE_PROFILES,
  PolyMorphRuntimeError,
} from "../index.js";
import { createPolyMorphPlaybackRuntime } from "./index.js";

describe("PolyMorph prepared playback", () => {
  it("samples exact frame boundaries and constant intervals", () => {
    const runtime = createPolyMorphPlaybackRuntime(createPolyMorphPlaybackFixture());
    expect(runtime.sample(0)).toMatchObject({
      sampledTimeMs: 0,
      frameIndex: 0,
      dirtyLeafIds: [],
    });
    expect(runtime.sample(249)).toMatchObject({
      sampledTimeMs: 249,
      frameIndex: 0,
      dirtyLeafIds: [],
    });
    const changed = runtime.sample(250);
    expect(changed.frameIndex).toBe(1);
    expect(changed.modelChanged).toBe(true);
    expect(changed.dirtyShapeIds).toEqual(["gem"]);
    expect(changed.dirtyLeafIds).toEqual(["gem-panel-leaf"]);
    expect(changed.state.leaves[0]).toMatchObject({
      visible: false,
      opacity: 0.5,
      atlasRow: 1,
    });
    runtime.commit(changed);
    expect(runtime.sample(500).update).toEqual({});
  });

  it("loops deterministically and diffs a backwards wrap", () => {
    const left = createPolyMorphPlaybackRuntime(createPolyMorphPlaybackFixture());
    const right = createPolyMorphPlaybackRuntime(createPolyMorphPlaybackFixture());
    const times = [250, 500, 750, 1250, 2000];
    const leftSamples = times.map((time) => {
      const sample = left.sample(time);
      left.commit(sample);
      return sample;
    });
    const rightSamples = times.map((time) => {
      const sample = right.sample(time);
      right.commit(sample);
      return sample;
    });
    expect(leftSamples).toEqual(rightSamples);
    expect(leftSamples[3]).toMatchObject({
      sampledTimeMs: 250,
      frameIndex: 1,
      dirtyLeafIds: ["gem-panel-leaf"],
    });
    expect(leftSamples[4]?.sampledTimeMs).toBe(0);
  });

  it("feeds sparse state into the retained mount without remounting", () => {
    const fixture = createPolyMorphPlaybackFixture();
    const runtime = createPolyMorphPlaybackRuntime(fixture);
    const host = document.createElement("div");
    document.body.appendChild(host);
    const mounted = mountPolyMorphModel(host, fixture, {
      resources: new Map([[
        "assets/gem.webp",
        {
          descriptor: {
            path: "assets/gem.webp",
            role: "image",
            mediaType: "image/webp",
            bytes: 1,
            sha256: "0".repeat(64),
          },
          bytes: new Uint8Array([1]),
        },
      ]]),
    });
    const animated = mounted.leafHandles.get("gem-panel-leaf")!.element;
    const stable = mounted.leafHandles.get("static-panel-leaf")!.element;
    const sample = runtime.sample(250);
    const result = mounted.apply(sample.update);
    runtime.commit(sample);
    expect(result).toMatchObject({
      dirtyLeavesVisited: 1,
      modelTransformWrites: 1,
      shapeTransformWrites: 1,
      leafTransformWrites: 1,
      visibilityWrites: 1,
      opacityWrites: 1,
      atlasRowWrites: 1,
      domCreations: 0,
      domRemovals: 0,
      topologyConstructions: 0,
      atlasRedraws: 0,
    });
    expect(mounted.leafHandles.get("gem-panel-leaf")!.element).toBe(animated);
    expect(mounted.leafHandles.get("static-panel-leaf")!.element).toBe(stable);
    expect(runtime.sample(500).dirtyLeafIds).toEqual([]);
  });

  it("commits playback state only after the caller applies a sample", () => {
    const runtime = createPolyMorphPlaybackRuntime(
      createPolyMorphPlaybackFixture(),
    );
    const first = runtime.sample(250);
    const retry = runtime.sample(250);
    expect(retry.update).toEqual(first.update);
    expect(() => runtime.commit(first)).toThrowError(PolyMorphRuntimeError);
    runtime.commit(retry);
    expect(runtime.sample(250).update).toEqual({});
  });

  it("rejects malformed packets and invalid image rows", () => {
    const unknown = clonePolyMorphFixture(createPolyMorphPlaybackFixture());
    unknown.playback!.frames[1]!.leaves[0]!.leafId = "missing-leaf";
    expect(() => createPolyMorphPlaybackRuntime(unknown)).toThrowError(PolyMorphContractError);

    const unordered = clonePolyMorphFixture(createPolyMorphPlaybackFixture());
    unordered.playback!.frames[1]!.timeMs = 0;
    expect(() => createPolyMorphPlaybackRuntime(unordered)).toThrowError(PolyMorphContractError);

    const row = clonePolyMorphFixture(createPolyMorphPlaybackFixture());
    row.playback!.frames[1]!.leaves[0]!.atlasRow = 2;
    expect(() => createPolyMorphPlaybackRuntime(row)).toThrowError(PolyMorphRuntimeError);

    expect(() => createPolyMorphPlaybackRuntime(createPolyMorphModelFixture()))
      .toThrowError(PolyMorphRuntimeError);
  });

  it("rejects invalid sample time and never owns a scheduler", () => {
    const requestFrame = vi.fn(() => 1);
    const previous = globalThis.requestAnimationFrame;
    Object.defineProperty(globalThis, "requestAnimationFrame", {
      configurable: true,
      value: requestFrame,
    });
    try {
      const runtime = createPolyMorphPlaybackRuntime(createPolyMorphPlaybackFixture());
      expect(() => runtime.sample(-1)).toThrowError(PolyMorphRuntimeError);
      expect(() => runtime.sample(Number.NaN)).toThrowError(PolyMorphRuntimeError);
      runtime.sample(250);
      expect(requestFrame).not.toHaveBeenCalled();
    } finally {
      Object.defineProperty(globalThis, "requestAnimationFrame", {
        configurable: true,
        value: previous,
      });
    }
  });

  it("advertises prepared playback only with the executable runtime present", () => {
    expect(POLY_MORPH_EXECUTABLE_PROFILES).toContain("prepared-playback");
    expect(createPolyMorphPlaybackRuntime).toBeTypeOf("function");
  });
});
