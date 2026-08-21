import {
  clonePolyMorphFixture,
  createPolyMorphModelFixture,
  type PolyMorphJointModelFixture,
} from "./modelFixture.js";

export function createPolyMorphSkinningFixture(): PolyMorphJointModelFixture {
  const fixture = clonePolyMorphFixture(createPolyMorphModelFixture("joint-skin"));
  fixture.capabilities = [
    "animation",
    "joint-skinning",
    "retained-render",
    "sparse-updates",
  ];
  fixture.animations = [
    {
      id: "tip-rise",
      durationMs: 1000,
      loop: false,
      channels: [
        {
          target: "joint-translation",
          targetId: "tip",
          interpolation: "linear",
          timesMs: [0, 1000],
          values: [[0, 0, 0], [0, 2, 0]],
        },
      ],
    },
  ];
  return fixture;
}
