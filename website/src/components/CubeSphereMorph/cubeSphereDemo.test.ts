import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  createPolyMorphDeformationRuntime,
  validatePolyMorphModel,
} from "@layoutit/polycss-morph";

function loadModel() {
  const websiteRoot = process.cwd().endsWith("/website")
    ? process.cwd()
    : resolve(process.cwd(), "website");
  return validatePolyMorphModel(JSON.parse(readFileSync(
    resolve(
      websiteRoot,
      "src/components/CubeSphereMorph/assets/package/model.json",
    ),
    "utf8",
  )));
}

describe("Animated Morph Sphere demo", () => {
  it("prepares the CC0 source as one retained PolyCSS topology", () => {
    const model = loadModel();
    const runtime = createPolyMorphDeformationRuntime(model);
    const frame = runtime.sample({
      tick: 0,
      morphWeights: { blob: 1 },
    });

    expect(model.identity.id).toBe("animated-morph-sphere");
    expect(model.profile).toBe("morph-regions");
    expect(model.topology.vertices).toHaveLength(1876);
    expect(model.topology.polygons).toHaveLength(960);
    expect(model.render.leaves).toHaveLength(960);
    expect(model.deformation.kind).toBe("morph-regions");
    if (model.deformation.kind !== "morph-regions") return;
    expect(model.deformation.targets.map((target) => target.id)).toEqual([
      "ship",
      "blob",
    ]);
    expect(frame.dirtyLeafIds).toHaveLength(870);
    expect(frame.leafUpdates).toHaveLength(870);
    expect(frame.runtimeTopologyConstructions).toBe(0);
    expect(frame.runtimePolygonConstructions).toBe(0);
    expect(frame.atlasRedraws).toBe(0);
    expect(model.provenance.sources[0]).toMatchObject({
      id: "threejs-animated-morph-sphere",
      kind: "open-data",
      license: "CC0-1.0",
    });
  });
});
