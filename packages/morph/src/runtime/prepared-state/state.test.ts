import { describe, expect, it } from "vitest";
import { createPolyMorphPlaybackFixture } from "../../testing/playbackFixture.js";
import {
  applyPolyMorphPlaybackFrame,
  createPolyMorphPreparedState,
  diffPolyMorphPreparedStates,
} from "./index.js";

describe("PolyMorph prepared state", () => {
  it("applies sparse frames without changing topology or source order", () => {
    const fixture = createPolyMorphPlaybackFixture();
    const initial = createPolyMorphPreparedState(fixture);
    const next = applyPolyMorphPlaybackFrame(initial, fixture.playback!.frames[1]!);
    expect(next.shapes.map((shape) => shape.shapeId)).toEqual(["gem"]);
    expect(next.leaves.map((leaf) => leaf.leafId)).toEqual([
      "gem-panel-leaf",
      "static-panel-leaf",
    ]);
    expect(next.leaves[0]).toMatchObject({
      visible: false,
      opacity: 0.5,
      atlasRow: 1,
    });
    expect(next.leaves[1]).toBe(initial.leaves[1]);
  });

  it("diffs only changed model, shape, and leaf fields", () => {
    const fixture = createPolyMorphPlaybackFixture();
    const initial = createPolyMorphPreparedState(fixture);
    const next = applyPolyMorphPlaybackFrame(initial, fixture.playback!.frames[1]!);
    const diff = diffPolyMorphPreparedStates(initial, next);
    expect(diff.modelChanged).toBe(true);
    expect(diff.dirtyShapeIds).toEqual(["gem"]);
    expect(diff.dirtyLeafIds).toEqual(["gem-panel-leaf"]);
    expect(diff.update.shapes).toHaveLength(1);
    expect(diff.update.leaves).toHaveLength(1);
    expect(diffPolyMorphPreparedStates(next, next).update).toEqual({});
  });
});
