import {
  type PolyMorphModel,
} from "../contracts/index.js";
import {
  clonePolyMorphFixture,
  createPolyMorphModelFixture,
  POLY_MORPH_IDENTITY_MATRIX,
} from "./modelFixture.js";

export function createPolyMorphRuntimeFixture(): PolyMorphModel {
  const fixture = clonePolyMorphFixture(createPolyMorphModelFixture("morph-regions"));
  fixture.capabilities = [
    "animation",
    "morph-targets",
    "retained-render",
    "semantic-controls",
    "sparse-updates",
    "springs",
  ];
  fixture.topology.vertices.push(
    [3, 0, 0],
    [4, 0, 0],
    [3, 1, 0],
  );
  fixture.topology.normals.push(
    [0, 0, 1],
    [0, 0, 1],
    [0, 0, 1],
  );
  fixture.topology.polygons.push({
    id: "static-panel",
    vertexIndices: [3, 4, 5],
    normalIndices: [3, 4, 5],
  });
  fixture.render.leaves.push({
    id: "static-panel-leaf",
    polygonId: "static-panel",
    shapeId: "gem",
    materialId: "amber",
    strategy: "solid-triangle",
    width: 32,
    height: 32,
    matrix: POLY_MORPH_IDENTITY_MATRIX,
    atlas: null,
    fallback: null,
  });
  fixture.deformation.targets[0]!.deltas[0]!.normal = [0, 1, 0];
  fixture.controls = [
    {
      id: "stretch-control",
      anchor: [0, 1, 0],
      axis: [0, 1, 0],
      radius: 1,
      minimum: 0,
      maximum: 1,
      initial: 0,
      targets: [{ targetId: "stretch", scale: 1 }],
    },
  ];
  fixture.springs = [
    {
      id: "stretch-return",
      controlId: "stretch-control",
      stiffness: 80,
      damping: 12,
    },
  ];
  fixture.animations = [
    {
      id: "pulse",
      durationMs: 1000,
      loop: true,
      channels: [
        {
          target: "morph-weight",
          targetId: "stretch",
          interpolation: "linear",
          timesMs: [0, 500, 1000],
          values: [[0], [1], [0]],
        },
      ],
    },
  ];
  return fixture;
}
