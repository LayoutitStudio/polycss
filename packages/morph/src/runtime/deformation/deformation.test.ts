import { describe, expect, it } from "vitest";
import { mountPolyMorphModel } from "../../render/index.js";
import {
  clonePolyMorphFixture,
  createPolyMorphModelFixture,
} from "../../testing/modelFixture.js";
import { createPolyMorphRuntimeFixture } from "../../testing/runtimeFixture.js";
import { PolyMorphRuntimeError } from "../runtimeError.js";
import { createPolyMorphDeformationRuntime } from "./index.js";

describe("PolyMorph deformation runtime", () => {
  it("emits no writes for static steps", () => {
    const runtime = createPolyMorphDeformationRuntime(createPolyMorphModelFixture());
    const first = runtime.sample({ tick: 0 });
    const second = runtime.sample({ tick: 1 });
    expect(first.positions).toEqual(runtime.basePositions);
    expect(first.leafUpdates).toEqual([]);
    expect(second.leafUpdates).toEqual([]);
    expect(second).toMatchObject({
      runtimePolygonConstructions: 0,
      runtimeTopologyConstructions: 0,
      atlasRedraws: 0,
    });
  });

  it("matches hand-computed sparse vertex and normal deltas", () => {
    const runtime = createPolyMorphDeformationRuntime(createPolyMorphRuntimeFixture());
    const frame = runtime.sample({
      tick: 1,
      morphWeights: { stretch: 0.5 },
    });
    expect(frame.positions[2]).toEqual([0, 1.25, 0]);
    expect(frame.normals[2]![0]).toBe(0);
    expect(frame.normals[2]![1]).toBeCloseTo(0.4472135955);
    expect(frame.normals[2]![2]).toBeCloseTo(0.894427191);
    expect(frame.dirtyLeafIds).toEqual(["gem-panel-leaf"]);
    expect(frame.leafUpdates).toHaveLength(1);
    expect(frame.leafUpdates[0]?.matrix).toHaveLength(16);
    expect(Object.isFrozen(frame.positions)).toBe(true);
    expect(Object.isFrozen(frame.positions[2]!)).toBe(true);
    expect(Object.isFrozen(frame.normals[2]!)).toBe(true);
  });

  it("combines bounded semantic control values with explicit morph weights", () => {
    const runtime = createPolyMorphDeformationRuntime(createPolyMorphRuntimeFixture());
    const frame = runtime.sample({
      tick: 1,
      morphWeights: { stretch: 0.25 },
      controlValues: { "stretch-control": 0.25 },
    });
    expect(frame.morphWeights.stretch).toBe(0.5);
    expect(frame.positions[2]).toEqual([0, 1.25, 0]);
  });

  it("turns repeated samples into no-op dirty rows", () => {
    const runtime = createPolyMorphDeformationRuntime(createPolyMorphRuntimeFixture());
    const input = {
      tick: 1,
      morphWeights: { stretch: 0.75 },
      controlValues: { "stretch-control": 0 },
    };
    expect(runtime.sample(input).dirtyLeafIds).toEqual(["gem-panel-leaf"]);
    expect(runtime.sample({ ...input, tick: 2 }).dirtyLeafIds).toEqual([]);
    expect(runtime.sample({ ...input, tick: 3 }).leafUpdates).toEqual([]);
  });

  it("feeds only changed leaves into the retained mount", () => {
    const model = createPolyMorphRuntimeFixture();
    const runtime = createPolyMorphDeformationRuntime(model);
    const host = document.createElement("div");
    document.body.appendChild(host);
    const mounted = mountPolyMorphModel(host, model);
    const changedIdentity = mounted.leafHandles.get("gem-panel-leaf")!.element;
    const staticIdentity = mounted.leafHandles.get("static-panel-leaf")!.element;
    const staticTransform = staticIdentity.style.transform;
    const frame = runtime.sample({ tick: 1, morphWeights: { stretch: 1 } });
    const result = mounted.apply({ leaves: frame.leafUpdates });
    expect(result.dirtyLeavesVisited).toBe(1);
    expect(mounted.leafHandles.get("gem-panel-leaf")!.element).toBe(changedIdentity);
    expect(mounted.leafHandles.get("static-panel-leaf")!.element).toBe(staticIdentity);
    expect(staticIdentity.style.transform).toBe(staticTransform);
    expect(mounted.apply({
      leaves: runtime.sample({ tick: 2, morphWeights: { stretch: 1 } }).leafUpdates,
    }).dirtyLeavesVisited).toBe(0);
  });

  it("fails closed on unknown ids, out-of-range values, and unsupported profiles", () => {
    const runtime = createPolyMorphDeformationRuntime(createPolyMorphRuntimeFixture());
    expect(() => runtime.sample({
      tick: 0,
      morphWeights: { unknown: 1 },
    })).toThrowError(PolyMorphRuntimeError);
    expect(() => runtime.sample({
      tick: 0,
      morphWeights: { stretch: 1.1 },
    })).toThrowError(PolyMorphRuntimeError);
    expect(() => runtime.sample({
      tick: 0,
      controlValues: { "stretch-control": -0.1 },
    })).toThrowError(PolyMorphRuntimeError);
    expect(() =>
      createPolyMorphDeformationRuntime(createPolyMorphModelFixture("joint-skin")))
      .toThrowError(PolyMorphRuntimeError);
  });

  it("hides and restores a temporarily degenerate triangle", () => {
    const fixture = clonePolyMorphFixture(createPolyMorphModelFixture("morph-regions"));
    fixture.deformation.targets[0]!.deltas[0]!.position = [0, -1, 0];
    const runtime = createPolyMorphDeformationRuntime(fixture);
    expect(runtime.sample({ tick: 1, morphWeights: { stretch: 1 } }).leafUpdates[0])
      .toMatchObject({ visible: false });
    expect(runtime.sample({ tick: 2, morphWeights: { stretch: 0 } }).leafUpdates[0])
      .toMatchObject({ visible: true });
  });

  it("does not publish failed quad geometry into the next sample", () => {
    const fixture = clonePolyMorphFixture(
      createPolyMorphModelFixture("morph-regions"),
    );
    fixture.topology.vertices.push([1, 1, 0]);
    fixture.topology.normals.push([0, 0, 1]);
    fixture.topology.polygons[0]!.vertexIndices = [0, 1, 3, 2];
    fixture.topology.polygons[0]!.normalIndices = [0, 1, 3, 2];
    fixture.render.leaves[0]!.strategy = "solid-quad";
    fixture.render.leaves[0]!.width = 1;
    fixture.render.leaves[0]!.height = 1;
    const runtime = createPolyMorphDeformationRuntime(fixture);

    expect(() => runtime.sample({
      tick: 1,
      morphWeights: { stretch: 1 },
    })).toThrowError(PolyMorphRuntimeError);
    const recovered = runtime.sample({
      tick: 2,
      morphWeights: { stretch: 0 },
    });
    expect(recovered.positions).toEqual(fixture.topology.vertices);
    expect(recovered.dirtyLeafIds).toEqual([]);
  });
});
