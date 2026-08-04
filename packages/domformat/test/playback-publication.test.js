import test from "node:test";
import assert from "node:assert/strict";
import { createPolycssPlayback as createReferencePlayback } from "../src/state/polycss.js";
import { createPolycssPlayback as createIndependentPlayback } from "../conformance/viewer/playback.js";

const IMPLEMENTATIONS = [
  ["reference", createReferencePlayback],
  ["independent", createIndependentPlayback],
];

function base64Integers(values, width) {
  const bytes = new Uint8Array(values.length * width);
  for (let index = 0; index < values.length; index += 1) {
    for (let byte = 0; byte < width; byte += 1) bytes[index * width + byte] = Math.floor(values[index] / 2 ** (byte * 8)) & 255;
  }
  return Buffer.from(bytes).toString("base64");
}

function target(id, writes) {
  const element = { id };
  element.style = new Proxy({}, {
    set(styles, property, value) {
      styles[property] = value;
      writes.push([id, String(property), String(value)]);
      return true;
    },
  });
  return element;
}

function createFixture(createPlayback, options = {}) {
  const writes = [];
  const model = target("model", writes);
  const leaves = [target("leaf:0", writes), target("leaf:1", writes)];
  const frameCount = 4;
  const visibilityOffsets = options.visibilityOffsets ?? [0, 1, 1, 1, 2];
  const initialVisibleBits = options.initiallyHidden === "both" ? 0 : 2;
  const zeroOffsets = base64Integers(new Array(frameCount + 1).fill(0), 4);
  const materialized = {
    playback: {
      shapeCount: 0,
      leafCount: 2,
      appearances: [["default", 1, 0]],
      timeline: {
        introTicks: 0,
        loopTicks: options.timeline?.length ?? frameCount,
        frames: options.timeline ?? [1, 2, 3, 4],
      },
      initial: {
        sourceFrame: 1,
        appearance: 0,
        modelTransform: 0,
        shapes: [],
        leaves: [0, 1, 1, 4],
      },
      frameRows: options.frameRows ?? [
        [1, 0, -1, 0, 0, 0, 0],
        [2, 0, -1, 0, 0, 0, 2],
        [3, 0, -1, 0, 0, 2, 1],
        [4, 0, -1, 0, 0, 3, 0],
      ],
      shapeChanges: [],
      leafChanges: options.leafChanges ?? [0, 2, 1, 5, 0, 3],
      transforms: [
        "",
        "leaf-0-frame-1",
        "leaf-0-frame-2",
        "leaf-0-frame-3",
        "leaf-1-frame-1",
        "leaf-1-frame-2",
      ],
    },
    lighting: {
      surface: {
        faces: [
          { stateOffset: 0, stateCount: 1 },
          { stateOffset: 1, stateCount: 1 },
        ],
        statePacking: {
          stateCount: 2,
          sourceFramesBase64: base64Integers([0, 0], 2),
          backgroundPositionYs: ["0px", "0px"],
        },
      },
      transitions: {
        initialFrame: 1,
        sequential: {
          offsetsBase64: zeroOffsets,
          faceIndicesBase64: "",
          stateIndicesBase64: "",
        },
        nonInteractiveJumps: [],
      },
      visibilityCulling: {
        initialFrame: 1,
        initialVisibleBitsBase64: Buffer.from([initialVisibleBits]).toString("base64"),
        sequential: {
          offsetsBase64: base64Integers(visibilityOffsets, 4),
          faceIndicesBase64: base64Integers([0, 0], 2),
        },
        nonInteractiveJumps: [],
      },
    },
  };
  const playbackBinding = {
    id: "playback",
    interpreter: "polycss-playback@0",
    targets: { model: "model", shapes: [], leaves: leaves.map((leaf) => leaf.id) },
    parameters: { baseSceneTransform: "base-scene", frameCount, tickRateHz: 30 },
  };
  const bindings = {
    channels: [
      playbackBinding,
      { id: "surface", interpreter: "polycss-surface@0", targets: { leaves: leaves.map((leaf) => leaf.id) } },
    ],
  };
  const mounted = { byId: new Map([[model.id, model], ...leaves.map((leaf) => [leaf.id, leaf])]) };
  const playback = createPlayback(materialized, bindings, mounted);
  playback.publishInitial();
  writes.splice(0);
  return { leaves, playback, writes };
}

for (const [implementation, createPlayback] of IMPLEMENTATIONS) {
  test(`${implementation} playback defers hidden transforms and flushes the latest value before reveal`, () => {
    const { leaves, playback, writes } = createFixture(createPlayback);
    const identities = [...leaves];

    assert.equal(playback.advance(), 2);
    assert.equal(leaves[0].style.transform, "leaf-0-frame-1");
    assert.equal(leaves[1].style.transform, "leaf-1-frame-2");
    assert.deepEqual(writes, [["leaf:1", "transform", "leaf-1-frame-2"]]);

    writes.splice(0);
    assert.equal(playback.advance(), 3);
    assert.equal(leaves[0].style.transform, "leaf-0-frame-1");
    assert.deepEqual(writes, []);

    assert.equal(playback.advance(), 4);
    assert.deepEqual(writes, [
      ["leaf:0", "transform", "leaf-0-frame-3"],
      ["leaf:0", "visibility", "visible"],
    ]);
    assert.deepEqual(leaves, identities);
  });

  test(`${implementation} public same-frame seek synchronizes dirty hidden transforms once in target order`, () => {
    const { leaves, playback, writes } = createFixture(createPlayback, { initiallyHidden: "both" });

    assert.equal(playback.advance(), 2);
    assert.equal(leaves[0].style.transform, "leaf-0-frame-1");
    assert.equal(leaves[1].style.transform, "leaf-1-frame-1");
    assert.deepEqual(writes, []);

    assert.equal(playback.seek(2), 2);
    assert.deepEqual(writes, [
      ["leaf:0", "transform", "leaf-0-frame-2"],
      ["leaf:1", "transform", "leaf-1-frame-2"],
    ]);

    writes.splice(0);
    assert.equal(playback.seek(2), 2);
    assert.deepEqual(writes, []);
  });

  test(`${implementation} automatic nonsequential advance keeps hidden transforms deferred`, () => {
    const { leaves, playback, writes } = createFixture(createPlayback, { timeline: [1, 3, 4, 1] });

    assert.equal(playback.advance(), 3);
    assert.equal(leaves[0].style.transform, "leaf-0-frame-1");
    assert.deepEqual(writes, [["leaf:1", "transform", "leaf-1-frame-2"]]);

    writes.splice(0);
    assert.equal(playback.seek(3), 3);
    assert.deepEqual(writes, [["leaf:0", "transform", "leaf-0-frame-3"]]);
  });

  test(`${implementation} public seek synchronizes old and newly dirty transforms in target order`, () => {
    const { playback, writes } = createFixture(createPlayback, {
      initiallyHidden: "both",
      visibilityOffsets: [0, 0, 0, 0, 0],
      frameRows: [
        [1, 0, -1, 0, 0, 0, 0],
        [2, 0, -1, 0, 0, 0, 1],
        [3, 0, -1, 0, 0, 1, 1],
        [4, 0, -1, 0, 0, 2, 0],
      ],
      leafChanges: [0, 2, 1, 5],
    });

    assert.equal(playback.advance(), 2);
    assert.deepEqual(writes, []);
    assert.equal(playback.seek(3), 3);
    assert.deepEqual(writes, [
      ["leaf:0", "transform", "leaf-0-frame-2"],
      ["leaf:1", "transform", "leaf-1-frame-2"],
    ]);
  });

  test(`${implementation} forced reveal flushes prepared state and restore clears hidden dirt`, () => {
    const forced = createFixture(createPlayback);
    assert.equal(forced.playback.advance(), 2);
    forced.writes.splice(0);
    forced.playback.forceVisible([0]);
    assert.deepEqual(forced.writes, [
      ["leaf:0", "transform", "leaf-0-frame-2"],
      ["leaf:0", "visibility", "visible"],
    ]);

    const restored = createFixture(createPlayback);
    assert.equal(restored.playback.advance(), 2);
    restored.writes.splice(0);
    restored.playback.restoreInteraction([], [0]);
    assert.deepEqual(restored.writes, [["leaf:0", "transform", "leaf-0-frame-2"]]);
    restored.writes.splice(0);
    restored.playback.forceVisible([0]);
    assert.deepEqual(restored.writes, [["leaf:0", "visibility", "visible"]]);
  });

  test(`${implementation} playback catch-up advances every tick and publishes only the final paint state`, () => {
    const sequential = createFixture(createPlayback);
    const batched = createFixture(createPlayback);
    const identities = [...batched.leaves];

    for (let index = 0; index < 4; index += 1) sequential.playback.advance();
    assert.deepEqual(batched.playback.advanceMany(4), [2, 3, 4, 1]);
    assert.equal(batched.playback.tick, sequential.playback.tick);
    assert.equal(batched.playback.sourceFrame, sequential.playback.sourceFrame);
    assert.ok(batched.writes.length < sequential.writes.length);
    for (let index = 0; index < batched.leaves.length; index += 1) {
      assert.equal(batched.leaves[index].style.visibility, sequential.leaves[index].style.visibility);
      if (batched.leaves[index].style.visibility === "visible") {
        assert.equal(batched.leaves[index].style.transform, sequential.leaves[index].style.transform);
      }
      assert.equal(batched.leaves[index], identities[index]);
    }

    sequential.writes.splice(0);
    batched.writes.splice(0);
    sequential.playback.seek(sequential.playback.sourceFrame);
    batched.playback.seek(batched.playback.sourceFrame);
    assert.deepEqual(
      batched.leaves.map((leaf) => ({ ...leaf.style })),
      sequential.leaves.map((leaf) => ({ ...leaf.style })),
    );
  });
}
