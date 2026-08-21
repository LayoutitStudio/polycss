import test from "node:test";
import assert from "node:assert/strict";
import { createPolycssPlayback } from "../src/state/polycss.js";
import { createPolycssPublicationDiagnostics } from "../src/state/paged-state.js";

function base64Integers(values, width) {
  const bytes = new Uint8Array(values.length * width);
  for (let index = 0; index < values.length; index += 1) {
    for (let byte = 0; byte < width; byte += 1) bytes[index * width + byte] = Math.floor(values[index] / 2 ** (byte * 8)) & 255;
  }
  return Buffer.from(bytes).toString("base64");
}

function target(id, writes) {
  const element = { id, classes: [] };
  element.style = new Proxy({}, {
    set(styles, property, value) {
      styles[property] = value;
      writes.push([id, String(property), String(value)]);
      return true;
    },
  });
  element.classList = {
    add(token) {
      if (element.classes.includes(token)) return;
      element.classes.push(token);
      writes.push([id, "class:add", token]);
    },
    remove(token) {
      const index = element.classes.indexOf(token);
      if (index < 0) return;
      element.classes.splice(index, 1);
      writes.push([id, "class:remove", token]);
    },
  };
  return element;
}

function createFixture(options = {}) {
  const writes = [];
  const model = target("model", writes);
  const leaves = [target("leaf:0", writes), target("leaf:1", writes)];
  const frameCount = 4;
  const visibilityOffsets = options.visibilityOffsets ?? [0, 1, 1, 1, 2];
  const initialVisibleBits = options.initialVisibleBits ?? (options.initiallyHidden === "both" ? 0 : 2);
  const zeroOffsets = base64Integers(new Array(frameCount + 1).fill(0), 4);
  const lightingOffsets = base64Integers(options.lightingOffsets ?? new Array(frameCount + 1).fill(0), 4);
  const surfaceFaces = options.surfaceFaces ?? [
    { stateOffset: 0, stateCount: 1 },
    { stateOffset: 1, stateCount: 1 },
  ];
  const surfaceSourceFrames = options.surfaceSourceFrames ?? [0, 0];
  const surfacePositions = options.surfacePositions ?? new Array(surfaceSourceFrames.length).fill("0px");
  const materialized = {
    playback: {
      kind: "inline",
      shapeCount: 0,
      leafCount: 2,
      appearances: [["default", 1, 0]],
      timeline: {
        introTicks: 0,
        loopTicks: options.timeline?.length ?? frameCount,
        frames: options.timeline ?? [1, 2, 3, 4],
      },
      profileTimelines: options.profileTimelines,
      initialBankId: options.initialBankId,
      banks: options.banks,
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
          ...surfaceFaces,
        ],
        statePacking: {
          stateCount: surfaceSourceFrames.length,
          sourceFramesBase64: base64Integers(surfaceSourceFrames, 2),
          positionProperty: "backgroundPositionY",
          positions: surfacePositions,
        },
      },
      transitions: {
        initialFrame: 1,
        sequential: {
          offsetsBase64: lightingOffsets,
          faceIndicesBase64: base64Integers(options.lightingFaces ?? [], 2),
          stateIndicesBase64: base64Integers(options.lightingStates ?? [], 2),
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
  if (options.variants) {
    leaves[0].classes.push("material-a");
    materialized.variants = {
      classes: ["material-a", "material-b"],
      frameCount,
      initial: Uint16Array.of(0),
      sequentialOffsets: Uint32Array.of(0, 1, 2, 3, 4),
      sequentialTargets: Uint16Array.of(0, 0, 0, 0),
      sequentialClasses: Uint16Array.of(0, 1, 0, 1),
      jumps: new Map(),
    };
  }
  if (options.viewportProfiles) {
    materialized.viewportProfiles = {
      selectionMode: "presentation-profile",
      transforms: ["profile-transform"],
      profiles: [
        {
          id: "mobile",
          transformIndices: Uint16Array.of(0, 0),
          visible: Uint8Array.of(0, 1),
          visibilityOffsets: options.dynamicViewportProfiles ? Uint32Array.of(0, 1, 2, 2, 2) : null,
          visibilityLeaves: options.dynamicViewportProfiles ? Uint16Array.of(0, 0) : null,
          responsiveAffine: null,
        },
        {
          id: "desktop",
          transformIndices: Uint16Array.of(0xffff, 0xffff),
          visible: Uint8Array.of(1, 1),
          visibilityOffsets: null,
          visibilityLeaves: null,
          responsiveAffine: options.dynamicViewportProfiles ? {
            scale: { baseWidth: 320, baseHeight: 240, multiplier: 1, max: 1 },
            present: Uint8Array.of(1, 0),
            coefficients: Float64Array.of(0, 0, 0, 2, 0, -3, 0, 0, 0, 0.1, 0, 4, 5, 0, 0.2, 6),
          } : null,
        },
      ],
    };
  }
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
  if (options.variants) bindings.channels.push({ id: "variants", interpreter: "polycss-variants@0", targets: { nodes: [leaves[0].id] } });
  if (options.viewportProfiles) bindings.channels.push({ id: "viewport-profiles", interpreter: "polycss-viewport-profiles@0", targets: { leaves: leaves.map((leaf) => leaf.id) } });
  const mounted = { byId: new Map([[model.id, model], ...leaves.map((leaf) => [leaf.id, leaf])]) };
  const playback = createPolycssPlayback(materialized, bindings, mounted, { publishAppearance() {}, diagnostics: options.diagnostics });
  playback.publishInitial();
  if (options.viewportProfiles) playback.applyViewportProfile(320, 240, "mobile");
  writes.splice(0);
  return { leaves, playback, writes };
}

test("sequential surface publication visits only scheduled lighting and visibility targets", () => {
  const diagnostics = createPolycssPublicationDiagnostics();
  const { playback } = createFixture({
    diagnostics,
    initialVisibleBits: 3,
    visibilityOffsets: [0, 0, 1, 1, 2],
    lightingOffsets: [0, 0, 1, 1, 1],
    lightingFaces: [0],
    lightingStates: [1],
    surfaceFaces: [
      { stateOffset: 0, stateCount: 2 },
      { stateOffset: 2, stateCount: 1 },
    ],
    surfaceSourceFrames: [0, 1, 0],
    surfacePositions: ["0px", "-16px", "0px"],
  });
  for (const key of Object.keys(diagnostics)) diagnostics[key] = 0;
  const OriginalMap = globalThis.Map;
  const OriginalSet = globalThis.Set;
  globalThis.Map = class extends OriginalMap { constructor() { throw new Error("sequential surface publication allocated a Map"); } };
  globalThis.Set = class extends OriginalSet { constructor() { throw new Error("sequential surface publication allocated a Set"); } };
  try {
    assert.equal(playback.applySurfaceFrame(2), 2);
  } finally {
    globalThis.Map = OriginalMap;
    globalThis.Set = OriginalSet;
  }
  assert.equal(diagnostics.surfaceLightingTargetVisits, 1);
  assert.equal(diagnostics.surfaceVisibilityTargetVisits, 1);
  assert.equal(diagnostics.surfaceFullReconstructions, 0);
});

test("sequential surface publication supports a forced uint16-maximum leaf outside the scheduled range", () => {
  const leafCount = 0x10000;
  const diagnostics = createPolycssPublicationDiagnostics();
  const writes = [];
  const classList = { add() {}, remove() {} };
  const model = { id: "model", style: {}, classList };
  const leaves = Array.from({ length: leafCount }, (_, index) => ({ id: `leaf:${index}`, style: {}, classList }));
  leaves[0xffff].style = new Proxy({}, {
    set(styles, property, value) {
      styles[property] = value;
      writes.push([String(property), String(value)]);
      return true;
    },
  });
  const initialLeaves = new Uint32Array(leafCount * 2);
  const surfaceFaces = new Array(leafCount);
  for (let index = 0; index < leafCount; index += 1) {
    initialLeaves[index * 2] = index;
    initialLeaves[index * 2 + 1] = 1;
    surfaceFaces[index] = { stateOffset: index, stateCount: index === 0xffff ? 2 : 1 };
  }
  const sourceFrames = new Uint16Array(leafCount + 1);
  sourceFrames[0x10000] = 1;
  const offsets = base64Integers([0, 0, 0], 4);
  const materialized = {
    playback: {
      kind: "inline",
      shapeCount: 0,
      leafCount,
      appearances: [["default", 1, 0]],
      timeline: { introTicks: 0, loopTicks: 2, frames: [1, 2] },
      initial: { sourceFrame: 1, appearance: 0, modelTransform: 0, shapes: [], leaves: initialLeaves },
      frameRows: [[1, 0, -1, 0, 0, 0, 0], [2, 0, -1, 0, 0, 0, 0]],
      shapeChanges: [],
      leafChanges: [],
      transforms: ["", "leaf-transform"],
    },
    lighting: {
      surface: {
        faces: surfaceFaces,
        statePacking: {
          stateCount: leafCount + 1,
          sourceFramesBase64: base64Integers(sourceFrames, 2),
          positionProperty: "backgroundPositionY",
          positions: [...new Array(leafCount).fill("0px"), "-16px"],
        },
      },
      transitions: {
        initialFrame: 1,
        sequential: { offsetsBase64: offsets, faceIndicesBase64: "", stateIndicesBase64: "" },
        nonInteractiveJumps: [],
      },
      visibilityCulling: {
        initialFrame: 1,
        initialVisibleBitsBase64: Buffer.alloc(leafCount / 8).toString("base64"),
        sequential: { offsetsBase64: offsets, faceIndicesBase64: "" },
        nonInteractiveJumps: [],
      },
    },
  };
  const leafIds = leaves.map((leaf) => leaf.id);
  const bindings = {
    channels: [
      { id: "playback", interpreter: "polycss-playback@0", targets: { model: model.id, shapes: [], leaves: leafIds }, parameters: { baseSceneTransform: "", frameCount: 2, tickRateHz: 30 } },
      { id: "surface", interpreter: "polycss-surface@0", targets: { leaves: leafIds } },
    ],
  };
  const mounted = { byId: new Map([[model.id, model], ...leaves.map((leaf) => [leaf.id, leaf])]) };
  const playback = createPolycssPlayback(materialized, bindings, mounted, { publishAppearance() {}, diagnostics });
  playback.publishInitial();
  playback.forceVisible([0xffff]);
  for (const key of Object.keys(diagnostics)) diagnostics[key] = 0;
  writes.splice(0);

  assert.equal(playback.advance(), 2);
  assert.deepEqual(writes, [["backgroundPositionY", "-16px"]]);
  assert.equal(leaves[0xffff].style.visibility, "visible");
  assert.equal(diagnostics.surfaceLightingTargetVisits, 1);
  assert.equal(diagnostics.surfaceVisibilityTargetVisits, 0);
  assert.equal(diagnostics.surfaceFullReconstructions, 0);
});

test("profile timeline selection uses prepared overrides with canonical baseline fallback", () => {
  const { playback } = createFixture({
    profileTimelines: [
      { profileId: "mobile", introTicks: 1, loopTicks: 2, frames: [1, 3, 4] },
    ],
  });
  assert.equal(playback.selectProfileTimeline("mobile"), true);
  assert.equal(playback.restart(), 1);
  assert.equal(playback.frameAfter(1), 3);
  assert.equal(playback.advance(), 3);
  assert.equal(playback.advance(), 4);
  assert.equal(playback.advance(), 3);

  assert.equal(playback.selectProfileTimeline("desktop"), true);
  assert.equal(playback.restart(), 1);
  assert.equal(playback.frameAfter(1), 2);
  assert.equal(playback.selectProfileTimeline("unprepared-profile"), false);
});

test("host-selected prepared banks restart canonical timelines without replacing retained nodes", () => {
  const banks = [
    { id: "alpha", entryFrame: 1, timeline: { introTicks: 0, loopTicks: 2, frames: [1, 2] } },
    {
      id: "beta",
      entryFrame: 3,
      timeline: { introTicks: 0, loopTicks: 2, frames: [3, 4] },
      profileTimelines: [{ profileId: "mobile", introTicks: 0, loopTicks: 1, frames: [3] }],
    },
    { id: "gamma", entryFrame: 4, timeline: { introTicks: 0, loopTicks: 1, frames: [4] } },
  ];
  const { leaves, playback } = createFixture({
    initialBankId: "alpha",
    banks,
    timeline: banks[0].timeline.frames,
    variants: true,
    initialVisibleBits: 3,
  });
  const identities = [...leaves];

  assert.equal(playback.bankId, "alpha");
  assert.equal(playback.advance(), 2);
  assert.equal(playback.selectBank("beta"), 3);
  assert.equal(playback.bankId, "beta");
  assert.equal(playback.tick, 0);
  assert.equal(playback.selectProfileTimeline("mobile"), true);
  assert.equal(playback.advance(), 3);
  assert.equal(playback.selectBank("alpha"), 1);
  assert.equal(playback.selectBank("gamma"), 4);
  assert.equal(playback.restart(), 4);
  assert.deepEqual(leaves, identities);
  assert.throws(() => playback.selectBank("missing"), { code: "UNKNOWN_PREPARED_BANK" });
});

test("viewport profile publication composes transforms and visibility with the reveal barrier", () => {
  const { leaves, playback, writes } = createFixture({
    viewportProfiles: true,
    initialVisibleBits: 3,
    visibilityOffsets: [0, 0, 0, 0, 0],
    lightingOffsets: [0, 0, 1, 1, 1],
    lightingFaces: [0],
    lightingStates: [1],
    surfaceFaces: [
      { stateOffset: 0, stateCount: 2 },
      { stateOffset: 2, stateCount: 1 },
    ],
    surfaceSourceFrames: [0, 1, 0],
    surfacePositions: ["0px", "-16px", "0px"],
  });
  assert.equal(leaves[0].style.visibility, "hidden");
  assert.equal(leaves[1].style.transform, "profile-transform");
  playback.seek(2);
  writes.splice(0);

  assert.equal(playback.applyViewportProfile(640, 480, "desktop"), "desktop");
  assert.deepEqual(writes.filter(([id]) => id === "leaf:0"), [
    ["leaf:0", "transform", "leaf-0-frame-2"],
    ["leaf:0", "backgroundPositionY", "-16px"],
    ["leaf:0", "visibility", "visible"],
  ]);
  writes.splice(0);
  assert.equal(playback.applyViewportProfile(800, 600, "desktop"), "desktop");
  assert.deepEqual(writes, []);
});

test("viewport profiles advance sparse visibility and recompute responsive affine rows without changing identity", () => {
  const { leaves, playback, writes } = createFixture({
    viewportProfiles: true,
    dynamicViewportProfiles: true,
    initialVisibleBits: 3,
    visibilityOffsets: [0, 0, 0, 0, 0],
  });
  const identities = [...leaves];
  assert.equal(leaves[0].style.visibility, "hidden");

  assert.equal(playback.advance(), 2);
  assert.equal(leaves[0].style.visibility, "visible");
  assert.ok(writes.findIndex(([id, property]) => id === "leaf:0" && property === "transform") < writes.findIndex(([id, property, value]) => id === "leaf:0" && property === "visibility" && value === "visible"));

  writes.splice(0);
  assert.equal(playback.applyViewportProfile(160, 120, "desktop"), "desktop");
  assert.equal(leaves[0].style.transform, "matrix(0,1,-1.5,0,18,32)");
  assert.deepEqual(leaves, identities);

  writes.splice(0);
  assert.equal(playback.applyViewportProfile(200, 120, "desktop"), "desktop");
  assert.equal(leaves[0].style.transform, "matrix(0,1,-1.5,0,22,32)");
  assert.deepEqual(writes.filter(([id, property]) => id === "leaf:0" && property === "transform"), [["leaf:0", "transform", "matrix(0,1,-1.5,0,22,32)"]]);

  playback.seek(1);
  writes.splice(0);
  playback.applyViewportProfile(320, 240, "mobile");
  assert.equal(leaves[0].style.visibility, "hidden");
  assert.deepEqual(leaves, identities);
});

test("responsive viewport publication rejects dimensions outside the validated numeric envelope", () => {
  const { playback } = createFixture({ viewportProfiles: true, dynamicViewportProfiles: true });
  assert.throws(() => playback.applyViewportProfile(Number.MAX_VALUE, 480, "desktop"), { code: "INVALID_VIEWPORT_PROFILE_PUBLICATION" });
  assert.throws(() => playback.applyViewportProfile(640, Number.MAX_VALUE, "desktop"), { code: "INVALID_VIEWPORT_PROFILE_PUBLICATION" });
});

test("playback defers hidden transforms and flushes the latest value before reveal", () => {
    const { leaves, playback, writes } = createFixture();
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

  test("playback publishes a prepared atlas address before revealing its retained leaf", () => {
    const { playback, writes } = createFixture({
      visibilityOffsets: [0, 0, 1, 1, 2],
      lightingOffsets: [0, 0, 1, 1, 1],
      lightingFaces: [0],
      lightingStates: [1],
      surfaceFaces: [
        { stateOffset: 0, stateCount: 2 },
        { stateOffset: 2, stateCount: 1 },
      ],
      surfaceSourceFrames: [0, 1, 0],
      surfacePositions: ["0px", "-16px", "0px"],
    });
    playback.seek(2);
    const address = writes.findIndex(([id, property]) => id === "leaf:0" && property === "backgroundPositionY");
    const reveal = writes.findIndex(([id, property, value]) => id === "leaf:0" && property === "visibility" && value === "visible");
    assert.ok(address >= 0 && reveal > address);
  });

  test("same-frame seek restores canonical variant and surface state", () => {
    const { leaves, playback, writes } = createFixture({
      variants: true,
      initialVisibleBits: 3,
      surfaceFaces: [
        { stateOffset: 0, stateCount: 2 },
        { stateOffset: 2, stateCount: 1 },
      ],
      surfaceSourceFrames: [0, 1, 0],
      surfacePositions: ["0px", "-16px", "0px"],
      lightingOffsets: [0, 0, 1, 1, 1],
      lightingFaces: [0],
      lightingStates: [1],
    });
    playback.applySurfaceFrame(2);
    assert.deepEqual(leaves[0].classes, ["material-b"]);
    assert.equal(leaves[0].style.backgroundPositionY, "-16px");
    writes.splice(0);

    assert.equal(playback.seek(1), 1);
    assert.deepEqual(leaves[0].classes, ["material-a"]);
    assert.equal(leaves[0].style.backgroundPositionY, "0px");
    assert.deepEqual(writes, [
      ["leaf:0", "class:remove", "material-b"],
      ["leaf:0", "class:add", "material-a"],
      ["leaf:0", "backgroundPositionY", "0px"],
    ]);
  });

  test("surface publication retry does not invert an already-staged visibility transition", () => {
    const { leaves, playback, writes } = createFixture({
      initialVisibleBits: 2,
      visibilityOffsets: [0, 0, 1, 1, 1],
      lightingOffsets: [0, 0, 1, 1, 1],
      lightingFaces: [0],
      lightingStates: [1],
      surfaceFaces: [
        { stateOffset: 0, stateCount: 2 },
        { stateOffset: 2, stateCount: 1 },
      ],
      surfaceSourceFrames: [0, 1, 0],
      surfacePositions: ["0px", "-16px", "0px"],
    });
    const style = { ...leaves[0].style };
    let failAddressWrite = true;
    leaves[0].style = new Proxy(style, {
      set(styles, property, value) {
        const outcome = failAddressWrite && property === "backgroundPositionY" ? "throw" : "set";
        writes.push(["leaf:0", String(property), String(value), outcome]);
        if (outcome === "throw") {
          failAddressWrite = false;
          throw new Error("injected address failure");
        }
        styles[property] = value;
        return true;
      },
    });
    writes.splice(0);

    assert.throws(() => playback.applySurfaceFrame(2), /injected address failure/u);
    assert.deepEqual(writes, [["leaf:0", "backgroundPositionY", "-16px", "throw"]]);
    writes.splice(0);

    assert.equal(playback.applySurfaceFrame(2), 2);
    assert.deepEqual(writes, [
      ["leaf:0", "backgroundPositionY", "-16px", "set"],
      ["leaf:0", "visibility", "visible", "set"],
    ]);
    assert.equal(leaves[0].style.visibility, "visible");
  });

  test("skipped variant frames coalesce each touched target to one final class write", () => {
    const { leaves, playback, writes } = createFixture({ variants: true, initialVisibleBits: 3 });
    const identity = leaves[0];

    assert.deepEqual(playback.advanceMany(3), [2, 3, 4]);
    assert.deepEqual(writes.filter(([, property]) => property.startsWith("class:")), [
      ["leaf:0", "class:remove", "material-a"],
      ["leaf:0", "class:add", "material-b"],
    ]);
    assert.deepEqual(leaves[0].classes, ["material-b"]);

    writes.splice(0);
    assert.equal(playback.applySurfaceFrame(3), 3);
    assert.deepEqual(writes.filter(([, property]) => property.startsWith("class:")), [
      ["leaf:0", "class:remove", "material-b"],
      ["leaf:0", "class:add", "material-a"],
    ]);
    assert.deepEqual(leaves[0].classes, ["material-a"]);
    assert.equal(leaves[0], identity);
  });

  test("skipped surface frames publish only each touched face's final address and visibility", () => {
    const { leaves, playback, writes } = createFixture({
      initialVisibleBits: 3,
      visibilityOffsets: [0, 0, 1, 2, 2],
      lightingOffsets: [0, 1, 1, 2, 3],
      lightingFaces: [0, 0, 0],
      lightingStates: [0, 2, 3],
      surfaceFaces: [
        { stateOffset: 0, stateCount: 4 },
        { stateOffset: 4, stateCount: 1 },
      ],
      surfaceSourceFrames: [0, 1, 2, 3, 0],
      surfacePositions: ["0px", "-16px", "-32px", "-48px", "0px"],
    });
    const identity = leaves[0];

    assert.deepEqual(playback.advanceMany(3), [2, 3, 4]);
    assert.deepEqual(writes.filter(([id, property]) => id === "leaf:0" && ["backgroundPositionY", "visibility"].includes(property)), [
      ["leaf:0", "backgroundPositionY", "-48px"],
    ]);
    assert.equal(leaves[0].style.visibility, "visible");
    assert.equal(leaves[0], identity);
  });

  test("a forced-visible hidden face remains address-current without a prepared visible-face row", () => {
    const { leaves, playback, writes } = createFixture({
      visibilityOffsets: [0, 0, 0, 0, 0],
      surfaceFaces: [
        { stateOffset: 0, stateCount: 4 },
        { stateOffset: 4, stateCount: 1 },
      ],
      surfaceSourceFrames: [0, 1, 2, 3, 0],
      surfacePositions: ["0px", "-16px", "-32px", "-48px", "0px"],
    });
    playback.forceVisible([0]);
    writes.splice(0);

    assert.equal(playback.advance(), 2);
    assert.equal(leaves[0].style.backgroundPositionY, "-16px");
    assert.deepEqual(writes.filter(([id, property]) => id === "leaf:0" && property === "backgroundPositionY"), [
      ["leaf:0", "backgroundPositionY", "-16px"],
    ]);
  });

  test("randomized forced-visible histories match a fresh canonical surface publication", () => {
    const fixture = () => createFixture({
      initialVisibleBits: 2,
      visibilityOffsets: [0, 1, 1, 2, 2],
      lightingOffsets: [0, 1, 1, 3, 4],
      lightingFaces: [1, 0, 1, 0],
      lightingStates: [0, 2, 1, 3],
      surfaceFaces: [
        { stateOffset: 0, stateCount: 4 },
        { stateOffset: 4, stateCount: 2 },
      ],
      surfaceSourceFrames: [0, 1, 2, 3, 0, 2],
      surfacePositions: ["0px", "-16px", "-32px", "-48px", "0px", "-16px"],
    });
    const actual = fixture();
    let frame = 1;
    let forced = [];
    let random = 0x5eed1234;
    for (let step = 0; step < 128; step += 1) {
      random = (Math.imul(random, 1664525) + 1013904223) >>> 0;
      if ((random & 1) === 0) {
        frame = (random >>> 8) % 4 + 1;
        actual.playback.applySurfaceFrame(frame);
      } else {
        forced = (random & 2) === 0 ? [] : [0];
        actual.playback.forceVisible(forced);
      }

      const expected = fixture();
      expected.playback.forceVisible(forced);
      expected.playback.applySurfaceFrame(frame);
      for (let leaf = 0; leaf < actual.leaves.length; leaf += 1) {
        assert.equal(actual.leaves[leaf].style.visibility, expected.leaves[leaf].style.visibility, `step ${step} leaf ${leaf} visibility`);
        if (actual.leaves[leaf].style.visibility === "visible") {
          assert.equal(actual.leaves[leaf].style.backgroundPositionY, expected.leaves[leaf].style.backgroundPositionY, `step ${step} leaf ${leaf} address`);
        }
      }
    }
  });

  test("forced reveal flushes a deferred address after its transform and before visibility", () => {
    const { playback, writes } = createFixture({
      surfaceFaces: [
        { stateOffset: 0, stateCount: 2 },
        { stateOffset: 2, stateCount: 1 },
      ],
      surfaceSourceFrames: [0, 1, 0],
      surfacePositions: ["0px", "-16px", "0px"],
      lightingOffsets: [0, 0, 1, 1, 1],
      lightingFaces: [0],
      lightingStates: [1],
    });
    playback.advance();
    writes.splice(0);
    playback.forceVisible([0]);
    assert.deepEqual(writes, [
      ["leaf:0", "transform", "leaf-0-frame-2"],
      ["leaf:0", "backgroundPositionY", "-16px"],
      ["leaf:0", "visibility", "visible"],
    ]);
  });

  test("public same-frame seek synchronizes dirty hidden transforms once in target order", () => {
    const { leaves, playback, writes } = createFixture({ initiallyHidden: "both" });

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

  test("automatic nonsequential advance keeps hidden transforms deferred", () => {
    const { leaves, playback, writes } = createFixture({ timeline: [1, 3, 4, 1] });

    assert.equal(playback.advance(), 3);
    assert.equal(leaves[0].style.transform, "leaf-0-frame-1");
    assert.deepEqual(writes, [["leaf:1", "transform", "leaf-1-frame-2"]]);

    writes.splice(0);
    assert.equal(playback.seek(3), 3);
    assert.deepEqual(writes, [["leaf:0", "transform", "leaf-0-frame-3"]]);
  });

  test("public seek synchronizes old and newly dirty transforms in target order", () => {
    const { playback, writes } = createFixture({
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

  test("public seek restores interaction-owned physical transforms exactly once", () => {
    const { leaves, playback, writes } = createFixture();
    playback.applyInteractionLeaf(1, "interaction-transform");
    assert.equal(leaves[1].style.transform, "interaction-transform");
    writes.splice(0);

    assert.equal(playback.seek(1), 1);
    assert.equal(leaves[1].style.transform, "leaf-1-frame-1");
    assert.deepEqual(writes, [["leaf:1", "transform", "leaf-1-frame-1"]]);

    writes.splice(0);
    assert.equal(playback.seek(1), 1);
    assert.deepEqual(writes, []);
  });

  test("restart clears forced interaction visibility without method receiver state", () => {
    const { leaves, playback, writes } = createFixture();
    playback.forceVisible([0]);
    assert.equal(leaves[0].style.visibility, "visible");
    writes.splice(0);

    assert.equal(playback.restart(), 1);
    assert.equal(leaves[0].style.visibility, "hidden");
    assert.deepEqual(writes, [["leaf:0", "visibility", "hidden"]]);
  });

  test("forced reveal flushes prepared state and restore clears hidden dirt", () => {
    const forced = createFixture();
    assert.equal(forced.playback.advance(), 2);
    forced.writes.splice(0);
    forced.playback.forceVisible([0]);
    assert.deepEqual(forced.writes, [
      ["leaf:0", "transform", "leaf-0-frame-2"],
      ["leaf:0", "visibility", "visible"],
    ]);

    const restored = createFixture();
    assert.equal(restored.playback.advance(), 2);
    restored.writes.splice(0);
    restored.playback.restoreInteraction([], [0]);
    assert.deepEqual(restored.writes, [["leaf:0", "transform", "leaf-0-frame-2"]]);
    restored.writes.splice(0);
    restored.playback.forceVisible([0]);
    assert.deepEqual(restored.writes, [["leaf:0", "visibility", "visible"]]);
  });

  test("playback catch-up advances every tick and publishes only the final paint state", () => {
    const sequential = createFixture();
    const batched = createFixture();
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
