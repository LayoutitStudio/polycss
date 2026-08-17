import test from "node:test";
import assert from "node:assert/strict";
import { buildDom } from "../src/writer.js";
import { crc32 } from "../src/crc32.js";
import { materializeCss } from "../src/resources.js";
import { cssScopeAttribute } from "../src/css.js";
import { decodeJson, encodeCanonicalJson } from "../src/canonical-json.js";
import { validateDocument } from "../src/schema.js";
import {
  errorCode,
  syntheticAdapterTechniquesInput,
  syntheticAspectProfileTimelinesInput,
  syntheticCompositorTimingInput,
  syntheticDynamicViewportProfilesInput,
  syntheticAnimationWithoutEffectsInput,
  syntheticEffectsWithoutPlaybackInput,
  syntheticEmptySurfaceInput,
  syntheticExactTimingInput,
  syntheticExecutableInteractionInput,
  syntheticInput,
  syntheticOrbitInput,
  syntheticPagedVariantsInput,
  syntheticPagedPlaybackInput,
  syntheticPlaybackWithoutSurfaceInput,
  syntheticPolycssInput,
  syntheticProfileTimelinesInput,
  syntheticResponsivePresentationInput,
  syntheticStaticPresentationInput,
  syntheticTwoFramePolycssInput,
  syntheticViewportProfilesInput,
} from "./helpers.js";

function copy(value) {
  return globalThis.structuredClone(value);
}

function packedIntegers(values, width) {
  const bytes = new Uint8Array(values.length * width);
  for (let index = 0; index < values.length; index += 1) {
    for (let byte = 0; byte < width; byte += 1) bytes[index * width + byte] = Math.floor(values[index] / 2 ** (byte * 8)) & 255;
  }
  return Buffer.from(bytes).toString("base64");
}

function insertPngChunk(bytes, type, payload) {
  const chunk = new Uint8Array(12 + payload.length);
  const view = new DataView(chunk.buffer);
  view.setUint32(0, payload.length, false);
  chunk.set(new TextEncoder().encode(type), 4);
  chunk.set(payload, 8);
  view.setUint32(8 + payload.length, crc32(chunk.subarray(4, 8 + payload.length)), false);
  const afterIhdr = 8 + 12 + 13;
  const output = new Uint8Array(bytes.length + chunk.length);
  output.set(bytes.subarray(0, afterIhdr));
  output.set(chunk, afterIhdr);
  output.set(bytes.subarray(afterIhdr), afterIhdr + chunk.length);
  return output;
}

test("public document validation exposes no internal maps or limits", async () => {
  const built = buildDom(await syntheticInput());
  assert.equal(validateDocument(built.document), undefined);
});

test("rejects duplicate ids, invalid parents, forbidden elements, and event attributes", async () => {
  const input = await syntheticInput();
  const duplicate = copy(input);
  duplicate.tree.nodes[2].id = duplicate.tree.nodes[1].id;
  assert.throws(() => buildDom(duplicate), errorCode("DUPLICATE_NODE_ID"));
  const parent = copy(input);
  parent.tree.nodes[1].parent = 2;
  assert.throws(() => buildDom(parent), errorCode("INVALID_PARENT"));
  const script = copy(input);
  script.tree.nodes[2].name = "script";
  assert.throws(() => buildDom(script), errorCode("FORBIDDEN_ELEMENT"));
  const handler = copy(input);
  handler.tree.nodes[2].attributes.onclick = "alert(1)";
  assert.throws(() => buildDom(handler), errorCode("UNSAFE_ATTRIBUTE"));
  const globalId = copy(input);
  globalId.tree.nodes[2].attributes.id = "host-visible-id";
  assert.throws(() => buildDom(globalId), errorCode("UNSAFE_ATTRIBUTE"));
  const fixedMount = copy(input);
  fixedMount.tree.mount.styles.position = "fixed";
  assert.throws(() => buildDom(fixedMount), errorCode("INVALID_MOUNT"));
  const transformedMount = copy(input);
  transformedMount.tree.mount.styles.transform = "scale(2)";
  assert.throws(() => buildDom(transformedMount), errorCode("UNSAFE_STYLE_PROPERTY"));
  const duplicateClassSource = copy(input);
  duplicateClassSource.tree.nodes[0].attributes.class = "overrides-classes";
  assert.throws(() => buildDom(duplicateClassSource), errorCode("UNSAFE_ATTRIBUTE"));
});

test("accepts the closed PolyCSS strategy element and inline style vocabulary", async () => {
  const input = await syntheticInput();
  const leaf = input.tree.nodes.find((node) => !input.tree.nodes.some((candidate) => candidate.parent === node.index));
  leaf.name = "b";
  Object.assign(leaf.styles, {
    borderBottomLeftRadius: "0",
    borderBottomRightRadius: "25%",
    borderShape: "polygon(0 0, 100% 0, 100% 100%)",
    borderTopLeftRadius: "50% 100%",
    borderTopRightRadius: "50% 100%",
    color: "rgb(12, 34, 56)",
    cornerBottomLeftShape: "initial",
    cornerBottomRightShape: "bevel",
    cornerTopLeftShape: "bevel",
    cornerTopRightShape: "initial",
  });
  assert.doesNotThrow(() => buildDom(input));
});

test("accepts an empty prepared surface for retained documents without surface leaves", async () => {
  const input = await syntheticEmptySurfaceInput();
  assert.doesNotThrow(() => buildDom(input));
});

test("accepts static presentation, animation without effects, and leafless playback without surface", async () => {
  for (const input of await Promise.all([
    syntheticStaticPresentationInput(),
    syntheticAnimationWithoutEffectsInput(),
    syntheticPlaybackWithoutSurfaceInput(),
  ])) assert.doesNotThrow(() => buildDom(input));
});

test("validates closed paged variant coverage, residency, and page payloads", async () => {
  for (const encoding of ["identity", "gzip"]) {
    const input = await syntheticPagedVariantsInput(encoding);
    assert.doesNotThrow(() => buildDom(input));
  }
  const base = await syntheticPagedVariantsInput();
  const packet = base.state.channels.find((channel) => channel.codec === "polycss-paged-variants@0").data.packet;
  const cases = [
    ["gap", (input) => { input.state.channels.find((channel) => channel.codec === "polycss-paged-variants@0").data.packet.pages[1].startFrame += 1; }, "STATE_PAGE_COVERAGE_MISMATCH"],
    ["overlap", (input) => { input.state.channels.find((channel) => channel.codec === "polycss-paged-variants@0").data.packet.pages[1].startFrame -= 1; }, "STATE_PAGE_COVERAGE_MISMATCH"],
    ["duplicate", (input) => { const value = input.state.channels.find((channel) => channel.codec === "polycss-paged-variants@0").data.packet.pages; value[1].resource = value[0].resource; }, "INVALID_PAGED_VARIANT_STATE"],
    ["lookahead", (input) => { input.state.channels.find((channel) => channel.codec === "polycss-paged-variants@0").data.packet.lookaheadPages = 5; }, "STATE_PAGE_RESIDENCY_LIMIT"],
    ["resident", (input) => { input.state.channels.find((channel) => channel.codec === "polycss-paged-variants@0").data.packet.maxResidentPages = 1; }, "STATE_PAGE_RESIDENCY_LIMIT"],
    ["disjoint playback and interaction reserves", (input) => { input.state.channels.find((channel) => channel.codec === "polycss-paged-variants@0").data.packet.maxResidentPages = 3; }, "STATE_PAGE_RESIDENCY_LIMIT"],
    ["unsafe frame count", (input) => { input.state.channels.find((channel) => channel.codec === "polycss-paged-variants@0").data.packet.frameCount = Number.MAX_SAFE_INTEGER; }, "STATE_PAGE_COVERAGE_MISMATCH"],
  ];
  for (const [label, mutate, code] of cases) {
    const input = copy(base);
    mutate(input);
    assert.throws(() => buildDom(input), errorCode(code), label);
  }
  assert.equal(packet.pages.length, 4);

  const wrongCodec = copy(base);
  wrongCodec.resourceInputs.find((resource) => resource.kind === "state-page").codec = "custom@0";
  assert.throws(() => buildDom(wrongCodec), errorCode("INVALID_STATE_PAGE_RESOURCE"));
  const noncanonical = copy(base);
  const firstPage = noncanonical.resourceInputs.find((resource) => resource.kind === "state-page");
  firstPage.bytes = Uint8Array.from([...firstPage.bytes, 0x20]);
  assert.throws(() => buildDom(noncanonical), errorCode("NONCANONICAL_STATE_PAGE"));
});

test("validates closed paged playback pages, canonical transforms, and exclusive ownership", async () => {
  for (const encoding of ["identity", "gzip"]) {
    const input = await syntheticPagedPlaybackInput({ encoding, variants: true });
    assert.doesNotThrow(() => buildDom(input));
  }

  const base = await syntheticPagedPlaybackInput();
  const explicitIdentity = copy(base);
  const identityPage = explicitIdentity.resourceInputs.find((resource) => resource.id === "playback-page-1");
  const identityPayload = decodeJson(identityPage.bytes);
  const identityIndex = identityPayload.transforms.findIndex((transform) => transform === null);
  assert.notEqual(identityIndex, -1);
  identityPayload.transforms[identityIndex] = "matrix3d(1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1)";
  identityPage.bytes = encodeCanonicalJson(identityPayload);
  assert.throws(() => buildDom(explicitIdentity), errorCode("INVALID_STATE_PAGE"));

  const fraction = copy(base);
  const fractionalTransform = "matrix3d(0.333333,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1)";
  const fractionPacket = fraction.state.channels.find((channel) => channel.codec === "polycss-paged-playback@0").data.packet;
  for (const descriptor of fractionPacket.pages) {
    const resource = fraction.resourceInputs.find((entry) => entry.id === descriptor.resource);
    const payload = decodeJson(resource.bytes);
    const index = payload.keyframe.modelTransform;
    assert.equal(payload.transforms[index], null);
    payload.transforms[index] = fractionalTransform;
    descriptor.materializedByteLength += fractionalTransform.length * 2;
    resource.bytes = encodeCanonicalJson(payload);
  }
  const fractionBinding = fraction.bindings.channels.find((channel) => channel.interpreter === "polycss-paged-playback@0");
  fraction.tree.nodes.find((node) => node.id === fractionBinding.targets.model).styles.transform = `${fractionBinding.parameters.baseSceneTransform} ${fractionalTransform}`;
  assert.doesNotThrow(() => buildDom(fraction));
  const initialMismatch = copy(fraction);
  initialMismatch.tree.nodes.find((node) => node.id === fractionBinding.targets.model).styles.transform = fractionBinding.parameters.baseSceneTransform;
  assert.throws(() => buildDom(initialMismatch), errorCode("STATE_PAGE_INITIAL_MISMATCH"));

  const overprecision = copy(fraction);
  const precisionPage = overprecision.resourceInputs.find((resource) => resource.id === "playback-page-1");
  const precisionPayload = decodeJson(precisionPage.bytes);
  const transformIndex = precisionPayload.transforms.findIndex((transform) => transform === fractionalTransform);
  assert.notEqual(transformIndex, -1);
  precisionPayload.transforms[transformIndex] = precisionPayload.transforms[transformIndex].replace("0.333333", "0.3333331");
  precisionPage.bytes = encodeCanonicalJson(precisionPayload);
  assert.throws(() => buildDom(overprecision), errorCode("INVALID_STATE_PAGE"));

  const inline = await syntheticExecutableInteractionInput();
  const mixed = copy(base);
  const inlineState = inline.state.channels.find((channel) => channel.codec === "polycss-playback-packed@0");
  const inlineBinding = inline.bindings.channels.find((channel) => channel.interpreter === "polycss-playback@0");
  inlineState.id = "inline-playback";
  inlineBinding.id = "inline-playback";
  inlineBinding.state = "inline-playback";
  mixed.state.channels.push(inlineState);
  mixed.bindings.channels.push(inlineBinding);
  mixed.state.channels.sort((left, right) => left.id.localeCompare(right.id));
  mixed.bindings.channels.sort((left, right) => left.id.localeCompare(right.id));
  assert.throws(() => buildDom(mixed), errorCode("TARGET_OWNERSHIP_CONFLICT"));

  const compositorSource = await syntheticCompositorTimingInput();
  const compositor = copy(base);
  compositor.state.channels.push(compositorSource.state.channels.find((channel) => channel.codec === "polycss-compositor-timing-prepared@0"));
  compositor.bindings.channels.push(compositorSource.bindings.channels.find((channel) => channel.interpreter === "polycss-compositor-timing@0"));
  compositor.state.channels.sort((left, right) => left.id.localeCompare(right.id));
  compositor.bindings.channels.sort((left, right) => left.id.localeCompare(right.id));
  assert.throws(() => buildDom(compositor), errorCode("TARGET_OWNERSHIP_CONFLICT"));

  const presentationOverlap = copy(base);
  const pagedBinding = presentationOverlap.bindings.channels.find((channel) => channel.interpreter === "polycss-paged-playback@0");
  presentationOverlap.bindings.channels.find((channel) => channel.interpreter === "static-presentation@0").targets.camera = pagedBinding.targets.model;
  assert.throws(() => buildDom(presentationOverlap), errorCode("TARGET_OWNERSHIP_CONFLICT"));
});

test("validates closed responsive root presentation profiles", async () => {
  const base = await syntheticResponsivePresentationInput();
  assert.doesNotThrow(() => buildDom(base));

  const cover = copy(base);
  const coverProfiles = [{ id: "cover", fit: "cover", quarterTurns: 0, bounds: [0, 0, 320, 240], safeInset: 0, bias: [0, 0] }];
  cover.state.channels[0].data.packet.camera.profiles = copy(coverProfiles);
  cover.bindings.channels[0].parameters.profiles = copy(coverProfiles);
  assert.doesNotThrow(() => buildDom(cover));

  const aspect = await syntheticAspectProfileTimelinesInput();
  assert.doesNotThrow(() => buildDom(aspect));

  for (const [label, mutate, code] of [
    ["profile mismatch", (input) => { input.state.channels[0].data.packet.camera.profiles[0].bias[1] = 0; }, "INVALID_PRESENTATION_STATE"],
    ["bounded final profile", (input) => { input.bindings.channels[0].parameters.profiles[1].maxViewportWidth = 900; }, "INVALID_PRESENTATION_BINDING"],
    ["unbounded nonfinal profile", (input) => { delete input.bindings.channels[0].parameters.profiles[0].maxViewportWidth; }, "INVALID_PRESENTATION_BINDING"],
    ["unsupported capped fit", (input) => { input.bindings.channels[0].parameters.profiles[0].fit = "capped-contain"; }, "INVALID_PRESENTATION_BINDING"],
    ["invalid prepared bounds", (input) => { input.bindings.channels[0].parameters.profiles[0].bounds = [0, 0, 0, 1]; }, "INVALID_PRESENTATION_BINDING"],
    ["invalid quarter turn", (input) => { input.bindings.channels[0].parameters.profiles[0].quarterTurns = 4; }, "INVALID_PRESENTATION_BINDING"],
    ["profiles without selector", (input) => { delete input.bindings.channels[0].parameters.profileSelection; }, "INVALID_PRESENTATION_BINDING"],
    ["selector without profiles", (input) => { delete input.bindings.channels[0].parameters.profiles; }, "INVALID_PRESENTATION_BINDING"],
    ["null profiles", (input) => { input.bindings.channels[0].parameters.profiles = null; }, "INVALID_PRESENTATION_BINDING"],
    ["null selector", (input) => { input.bindings.channels[0].parameters.profileSelection = null; }, "INVALID_PRESENTATION_BINDING"],
    ["unsupported selector", (input) => { input.bindings.channels[0].parameters.profileSelection = "media-query"; }, "INVALID_PRESENTATION_BINDING"],
  ]) {
    const invalid = copy(base);
    mutate(invalid);
    assert.throws(() => buildDom(invalid), errorCode(code), label);
  }


  for (const [label, mutate] of [
    ["bounded landscape row", (input) => { input.bindings.channels.find((channel) => channel.id === "presentation").parameters.profiles[0].maxViewportWidth = 519; }],
    ["unbounded nonfinal portrait row", (input) => { delete input.bindings.channels.find((channel) => channel.id === "presentation").parameters.profiles[1].maxViewportWidth; }],
    ["non-increasing portrait maxima", (input) => { input.bindings.channels.find((channel) => channel.id === "presentation").parameters.profiles[2].maxViewportWidth = 500; }],
    ["bounded final portrait row", (input) => { input.bindings.channels.find((channel) => channel.id === "presentation").parameters.profiles.at(-1).maxViewportWidth = 1000; }],
    ["single-row landscape-first bank", (input) => { const parameters = input.bindings.channels.find((channel) => channel.id === "presentation").parameters; parameters.profiles = [parameters.profiles[0]]; }],
  ]) {
    const invalid = copy(aspect);
    mutate(invalid);
    assert.throws(() => buildDom(invalid), errorCode("INVALID_PRESENTATION_BINDING"), label);
  }

  const mismatchedSelector = copy(base);
  const camera = mismatchedSelector.state.channels[0].data.packet.camera;
  camera.profileSelection = "landscape-first-portrait-width";
  camera.profiles = copy(aspect.state.channels.find((channel) => channel.id === "presentation").data.packet.camera.profiles);
  assert.throws(() => buildDom(mismatchedSelector), errorCode("INVALID_PRESENTATION_STATE"), "camera and binding selectors differ");
});

test("validates bounded playback timelines selected by static-presentation profile", async () => {
  const base = await syntheticProfileTimelinesInput();
  assert.doesNotThrow(() => buildDom(base));
  assert.throws(() => buildDom(copy(base), { limits: { maxTimelineTicks: 9 } }), errorCode("TIMELINE_LIMIT"), "aggregate baseline and override budget");

  const cases = [
    ["unknown field", (input) => { input.state.channels.find((channel) => channel.id === "playback").data.packet.profileTimelines[0].tickRateHz = 24; }, "INVALID_PLAYBACK_STATE"],
    ["empty bank", (input) => { input.state.channels.find((channel) => channel.id === "playback").data.packet.profileTimelines = []; }, "INVALID_PLAYBACK_STATE"],
    ["duplicate id", (input) => { const rows = input.state.channels.find((channel) => channel.id === "playback").data.packet.profileTimelines; rows.push(copy(rows[0])); }, "INVALID_PLAYBACK_STATE"],
    ["unknown presentation id", (input) => { input.state.channels.find((channel) => channel.id === "playback").data.packet.profileTimelines[0].profileId = "phone"; }, "INVALID_PLAYBACK_STATE"],
    ["initial frame mismatch", (input) => { input.state.channels.find((channel) => channel.id === "playback").data.packet.profileTimelines[0].frames[0] = 2; }, "TIMELINE_LIMIT"],
    ["presentation order mismatch", (input) => {
      input.state.channels.find((channel) => channel.id === "playback").data.packet.profileTimelines = [
        { profileId: "desktop", introTicks: 0, loopTicks: 2, frames: [1, 2] },
        { profileId: "mobile", introTicks: 0, loopTicks: 2, frames: [1, 3] },
      ];
    }, "INVALID_PLAYBACK_STATE"],
    ["missing presentation profile bank", (input) => {
      delete input.state.channels.find((channel) => channel.id === "presentation").data.packet.camera.profiles;
      delete input.state.channels.find((channel) => channel.id === "presentation").data.packet.camera.profileSelection;
      delete input.bindings.channels.find((channel) => channel.id === "presentation").parameters.profiles;
      delete input.bindings.channels.find((channel) => channel.id === "presentation").parameters.profileSelection;
    }, "MISSING_POLYCSS_CHANNEL"],
    ["missing presentation", (input) => {
      input.state.channels = input.state.channels.filter((channel) => channel.id !== "presentation");
      input.bindings.channels = input.bindings.channels.filter((channel) => channel.id !== "presentation");
      input.meta.conformance.executable = input.meta.conformance.executable.filter((role) => role !== "presentation");
    }, "MISSING_POLYCSS_CHANNEL"],
  ];
  for (const [label, mutate, code] of cases) {
    const invalid = copy(base);
    mutate(invalid);
    assert.throws(() => buildDom(invalid), errorCode(code), label);
  }
});

test("validates bounded same-topology viewport profile banks", async () => {
  const base = await syntheticViewportProfilesInput();
  assert.doesNotThrow(() => buildDom(base));
  const validCovering = await syntheticViewportProfilesInput("smallest-covering");
  assert.doesNotThrow(() => buildDom(validCovering));

  const cases = [
    ["unsupported selection", (input) => { input.state.channels.find((channel) => channel.id === "viewport-profiles").data.packet.selection.mode = "media-query"; }, "INVALID_VIEWPORT_PROFILE_STATE"],
    ["target mismatch", (input) => { input.bindings.channels.find((channel) => channel.id === "viewport-profiles").targets.leaves.reverse(); }, "TARGET_CARDINALITY_MISMATCH"],
    ["bad matrix", (input) => { input.state.channels.find((channel) => channel.id === "viewport-profiles").data.packet.transforms[0].pop(); }, "INVALID_VIEWPORT_PROFILE_STATE"],
    ["truncated transforms", (input) => { input.state.channels.find((channel) => channel.id === "viewport-profiles").data.packet.profiles[0].transformIndicesBase64 = packedIntegers([0], 2); }, "STATE_COLUMN_MISMATCH"],
    ["nonzero unused visibility bits", (input) => { input.state.channels.find((channel) => channel.id === "viewport-profiles").data.packet.profiles[0].visibleBitsBase64 = Buffer.from([0x82]).toString("base64"); }, "INVALID_VIEWPORT_PROFILE_STATE"],
    ["presentation profile mismatch", (input) => { input.state.channels.find((channel) => channel.id === "viewport-profiles").data.packet.profiles[0].id = "phone"; }, "INVALID_VIEWPORT_PROFILE_STATE"],
    ["unreferenced transform", (input) => { input.state.channels.find((channel) => channel.id === "viewport-profiles").data.packet.profiles[0].transformIndicesBase64 = packedIntegers([0xffff, 0xffff], 2); }, "INVALID_VIEWPORT_PROFILE_STATE"],
  ];
  for (const [label, mutate, code] of cases) {
    const invalid = copy(base);
    mutate(invalid);
    assert.throws(() => buildDom(invalid), errorCode(code), label);
  }

  const covering = await syntheticViewportProfilesInput("smallest-covering");
  covering.state.channels.find((channel) => channel.id === "viewport-profiles").data.packet.profiles.reverse();
  assert.throws(() => buildDom(covering), errorCode("INVALID_VIEWPORT_PROFILE_STATE"), "noncanonical smallest-covering order");

  const missingPresentation = copy(base);
  missingPresentation.state.channels = missingPresentation.state.channels.filter((channel) => channel.id !== "presentation");
  missingPresentation.bindings.channels = missingPresentation.bindings.channels.filter((channel) => channel.id !== "presentation");
  missingPresentation.meta.conformance.executable = missingPresentation.meta.conformance.executable.filter((role) => role !== "presentation");
  assert.throws(() => buildDom(missingPresentation), errorCode("MISSING_POLYCSS_CHANNEL"));
});

test("validates sparse profile-frame visibility and closed responsive affine rows", async () => {
  const base = await syntheticDynamicViewportProfilesInput();
  assert.doesNotThrow(() => buildDom(base));
  const cases = [
    ["open visibility cycle", (profile) => {
      profile.visibilityChanges.offsetsBase64 = packedIntegers([0, 0, 1, 1, 1, 1, 1, 1, 1], 4);
      profile.visibilityChanges.leafIndicesBase64 = packedIntegers([0], 2);
    }, "INVALID_VIEWPORT_PROFILE_STATE"],
    ["unsorted visibility row", (profile) => {
      profile.visibilityChanges.offsetsBase64 = packedIntegers([0, 0, 2, 2, 2, 2, 2, 2, 4], 4);
      profile.visibilityChanges.leafIndicesBase64 = packedIntegers([1, 0, 1, 0], 2);
    }, "INVALID_VIEWPORT_PROFILE_STATE"],
    ["zero affine scale", (_profile, desktop) => { desktop.responsiveAffine.scale.multiplier = 0; }, "INVALID_VIEWPORT_PROFILE_STATE"],
    ["truncated affine coefficients", (_profile, desktop) => { desktop.responsiveAffine.coefficientsBase64 = ""; }, "INVALID_VIEWPORT_PROFILE_STATE"],
    ["empty affine target set", (_profile, desktop) => { desktop.responsiveAffine.presentBitsBase64 = Buffer.from([0]).toString("base64"); }, "INVALID_VIEWPORT_PROFILE_STATE"],
  ];
  for (const [label, mutate, code] of cases) {
    const invalid = copy(base);
    const profiles = invalid.state.channels.find((channel) => channel.id === "viewport-profiles").data.packet.profiles;
    mutate(profiles[0], profiles[1]);
    assert.throws(() => buildDom(invalid), errorCode(code), label);
  }
});

test("validates fixed typed orbit input and closed cyclic surface rows", async () => {
  const base = await syntheticOrbitInput();
  assert.doesNotThrow(() => buildDom(base));
  assert.throws(() => buildDom(copy(base), { limits: { maxVisibilityCells: 119 } }), errorCode("ORBIT_STATE_LIMIT"));
  const cases = [
    ["boolean packet version", (input) => { input.state.channels[0].data.packet.version = false; }, "INVALID_ORBIT_STATE"],
    ["input default mismatch", (input) => { input.bindings.inputs.find((definition) => definition.id === "orbit.pitch").default = 1; }, "INVALID_ORBIT_BINDING"],
    ["unbounded pitch", (input) => { input.state.channels[0].data.packet.ranges.pitch[0] = -91; }, "INVALID_ORBIT_STATE"],
    ["model TREE mismatch", (input) => { input.tree.nodes.find((node) => node.id === "synthetic-polycss/model").styles.transform = "none"; }, "ORBIT_TREE_MISMATCH"],
    ["leaf TREE mismatch", (input) => { input.tree.nodes.find((node) => node.id === "synthetic-polycss/leaf").styles.backgroundPosition = "0 -16px"; }, "ORBIT_TREE_MISMATCH"],
    ["truncated initial row", (input) => { input.state.channels[0].data.packet.surface.initialPositionIndicesBase64 = ""; }, "STATE_COLUMN_MISMATCH"],
    ["forward row out of range", (input) => { input.state.channels[0].data.packet.surface.transitions.forwardPositionIndicesBase64 = packedIntegers(new Array(120).fill(120), 2); }, "STATE_COLUMN_MISMATCH"],
    ["backward contradiction", (input) => {
      const packet = input.state.channels[0].data.packet.surface.transitions;
      const values = Array.from({ length: 120 }, (_, state) => 119 - state);
      packet.backwardPositionIndicesBase64 = packedIntegers(values, 2);
    }, "INVALID_ORBIT_STATE"],
  ];
  for (const [label, mutate, code] of cases) {
    const invalid = copy(base);
    mutate(invalid);
    assert.throws(() => buildDom(invalid), errorCode(code), label);
  }
});

test("validates closed linear compositor cycles and prepared transform transitions", async () => {
  const base = await syntheticCompositorTimingInput();
  assert.doesNotThrow(() => buildDom(base));
  const cases = [
    ["easing", (input) => { input.state.channels.find((channel) => channel.codec === "polycss-compositor-timing-prepared@0").data.packet.timing = "ease"; }, "INVALID_COMPOSITOR_TIMING_STATE"],
    ["open cycle", (input) => { input.state.channels.find((channel) => channel.codec === "polycss-compositor-timing-prepared@0").data.packet.targets[0].keyframes[2].transformIndex = 3; }, "INVALID_COMPOSITOR_TIMING_STATE"],
    ["arbitrary keyframe CSS", (input) => { input.state.channels.find((channel) => channel.codec === "polycss-compositor-timing-prepared@0").data.packet.targets[0].keyframes[1].transform = "rotate(1deg)"; }, "INVALID_COMPOSITOR_TIMING_STATE"],
    ["wrong owner", (input) => { input.bindings.channels.find((channel) => channel.interpreter === "polycss-compositor-timing@0").targets.nodes[1] = "synthetic/eye-leaf"; }, "INVALID_COMPOSITOR_TIMING_BINDING"],
    ["excess transition", (input) => { input.state.channels.find((channel) => channel.codec === "polycss-compositor-timing-prepared@0").data.packet.targets[1].durationTicks = 9; }, "INVALID_COMPOSITOR_TIMING_STATE"],
    ["model race", (input) => { input.state.channels.find((channel) => channel.codec === "polycss-playback-packed@0").data.packet.frameRows[1][2] = 0; }, "TARGET_OWNERSHIP_CONFLICT"],
  ];
  for (const [label, mutate, code] of cases) {
    const input = copy(base);
    mutate(input);
    assert.throws(() => buildDom(input), errorCode(code), label);
  }
});

test("validates exact rational cadence, explicit deadlines, and closed catch-up policies", async () => {
  const exact = await syntheticExactTimingInput();
  assert.doesNotThrow(() => buildDom(exact));
  const explicit = await syntheticExactTimingInput({ catchUpPolicy: "elapsed", deadlineMicros: [0, 20_000, 50_000] });
  assert.doesNotThrow(() => buildDom(explicit));
  const cases = [
    ["missing cadence", (input) => { delete input.bindings.channels.find((channel) => channel.interpreter === "polycss-playback@0").parameters.tickIntervalUs; }, "INVALID_PLAYBACK_BINDING"],
    ["duplicate cadence", (input) => { input.bindings.channels.find((channel) => channel.interpreter === "polycss-playback@0").parameters.tickRateHz = 30; }, "INVALID_PLAYBACK_BINDING"],
    ["unreduced cadence", (input) => { input.bindings.channels.find((channel) => channel.interpreter === "polycss-playback@0").parameters.tickIntervalUs = [60_000, 2]; }, "INVALID_PLAYBACK_BINDING"],
    ["unknown catch-up", (input) => { input.bindings.channels.find((channel) => channel.interpreter === "polycss-playback@0").parameters.catchUpPolicy = "all"; }, "INVALID_PLAYBACK_BINDING"],
    ["truncated deadlines", (input) => { input.state.channels.find((channel) => channel.codec === "polycss-playback-packed@0").data.packet.timeline.deadlineMicros.pop(); }, "TIMELINE_LIMIT"],
    ["unordered deadlines", (input) => { input.state.channels.find((channel) => channel.codec === "polycss-playback-packed@0").data.packet.timeline.deadlineMicros[2] = 20_000; }, "TIMELINE_LIMIT"],
  ];
  for (const [label, mutate, code] of cases) {
    const input = copy(explicit);
    mutate(input);
    assert.throws(() => buildDom(input), errorCode(code), label);
  }
  const historyDependentEffects = await syntheticTwoFramePolycssInput();
  historyDependentEffects.bindings.channels.find((channel) => channel.interpreter === "polycss-playback@0").parameters.catchUpPolicy = "elapsed";
  assert.throws(() => buildDom(historyDependentEffects), errorCode("INVALID_EFFECTS_BINDING"));

  const interaction = await syntheticExecutableInteractionInput();
  const interactionPlayback = interaction.bindings.channels.find((channel) => channel.interpreter === "polycss-playback@0").parameters;
  const interactionTiming = interaction.bindings.channels.find((channel) => channel.interpreter === "polycss-pointer-grab@0").parameters;
  delete interactionPlayback.tickRateHz;
  delete interactionTiming.tickRateHz;
  interactionPlayback.tickIntervalUs = [50_000, 3];
  interactionPlayback.catchUpPolicy = "single-step";
  interactionTiming.tickIntervalUs = [50_000, 3];
  assert.doesNotThrow(() => buildDom(interaction));
  interactionTiming.tickIntervalUs = [30_000, 1];
  assert.throws(() => buildDom(interaction), errorCode("INVALID_INTERACTION_BINDING"));

  const compositor = await syntheticCompositorTimingInput();
  const compositorPlayback = compositor.bindings.channels.find((channel) => channel.interpreter === "polycss-playback@0").parameters;
  const compositorTiming = compositor.bindings.channels.find((channel) => channel.interpreter === "polycss-compositor-timing@0").parameters;
  const compositorInteraction = compositor.bindings.channels.find((channel) => channel.interpreter === "polycss-pointer-grab@0").parameters;
  delete compositorPlayback.tickRateHz;
  delete compositorTiming.tickRateHz;
  delete compositorInteraction.tickRateHz;
  compositorPlayback.tickIntervalUs = [30_000, 1];
  compositorTiming.tickIntervalUs = [30_000, 1];
  compositorInteraction.tickIntervalUs = [30_000, 1];
  assert.doesNotThrow(() => buildDom(compositor));
  compositor.state.channels.find((channel) => channel.codec === "polycss-playback-packed@0").data.packet.timeline.deadlineMicros = [0, 30_000, 60_000, 90_000, 120_000, 150_000, 180_000, 210_000, 240_000];
  assert.throws(() => buildDom(compositor), errorCode("INVALID_COMPOSITOR_TIMING_BINDING"));
});

test("rejects missing playback tick rate and incomplete optional presentation groups", async () => {
  const tickRate = await syntheticPolycssInput();
  delete tickRate.bindings.channels.find((channel) => channel.interpreter === "polycss-playback@0").parameters.tickRateHz;
  assert.throws(() => buildDom(tickRate), errorCode("INVALID_PLAYBACK_BINDING"));

  const cursor = await syntheticStaticPresentationInput();
  cursor.bindings.channels[0].targets.cursorLayer = "synthetic-polycss/model";
  assert.throws(() => buildDom(cursor), errorCode("INVALID_PRESENTATION_BINDING"));

  const background = await syntheticStaticPresentationInput();
  background.state.channels[0].data.packet.background = null;
  assert.throws(() => buildDom(background), errorCode("INVALID_PRESENTATION_STATE"));
});

test("rejects inert effects without executable playback", async () => {
  const input = await syntheticEffectsWithoutPlaybackInput();
  assert.throws(() => buildDom(input), errorCode("MISSING_POLYCSS_CHANNEL"));
});

test("attribute and CSS scope identifiers have closed length bounds", async () => {
  const input = await syntheticInput();
  const exact = copy(input);
  exact.tree.nodes[0].attributes[`data-${"a".repeat(64)}`] = "v";
  assert.doesNotThrow(() => buildDom(exact));

  const excessive = copy(input);
  excessive.tree.nodes[0].attributes[`data-${"a".repeat(65)}`] = "v";
  assert.throws(() => buildDom(excessive), errorCode("UNSAFE_ATTRIBUTE"));
  assert.deepEqual(cssScopeAttribute(`[data-${"a".repeat(64)}="v"]`), { name: `data-${"a".repeat(64)}`, value: "v" });
  assert.throws(() => cssScopeAttribute(`[data-${"a".repeat(65)}="v"]`), errorCode("INVALID_CSS_SCOPE"));
});

test("rejects unsafe paths, URLs, imports, and CSS scope escapes", async () => {
  const input = await syntheticInput();
  const path = copy(input);
  path.resourceInputs[0].path = "../escape.ppm";
  assert.throws(() => buildDom(path), errorCode("UNSAFE_RESOURCE_PATH"));
  const url = copy(input);
  url.resourceInputs.find((resource) => resource.kind === "stylesheet").bytes = new TextEncoder().encode('[data-domformat-root="synthetic"]{background:url("https://example.test/a")}' + "\n");
  assert.throws(() => buildDom(url), errorCode("UNSAFE_CSS"));
  const imported = copy(input);
  imported.resourceInputs.find((resource) => resource.kind === "stylesheet").bytes = new TextEncoder().encode('@import "other.css";' + "\n");
  assert.throws(() => buildDom(imported), errorCode("UNSAFE_CSS"));
  const escaped = copy(input);
  escaped.resourceInputs.find((resource) => resource.kind === "stylesheet").bytes = new TextEncoder().encode('body { color: red }' + "\n");
  assert.throws(() => buildDom(escaped), errorCode("CSS_SCOPE_ESCAPE"));
  const duplicatePath = copy(input);
  duplicatePath.resourceInputs[1].path = duplicatePath.resourceInputs[0].path;
  assert.throws(() => buildDom(duplicatePath), errorCode("DUPLICATE_RESOURCE_PATH"));
  const caseAlias = copy(input);
  caseAlias.resourceInputs[1].path = caseAlias.resourceInputs[0].path.toUpperCase();
  assert.throws(() => buildDom(caseAlias), errorCode("DUPLICATE_RESOURCE_PATH"));
  const prefixCollision = copy(input);
  prefixCollision.resourceInputs[1].path = `${prefixCollision.resourceInputs[0].path}/model.css`;
  assert.throws(() => buildDom(prefixCollision), errorCode("RESOURCE_PATH_COLLISION"));
  for (const unsafe of ["assets/CON.png", "assets/trailing."]) {
    const nonportable = copy(input);
    nonportable.resourceInputs[0].path = unsafe;
    assert.throws(() => buildDom(nonportable), errorCode("UNSAFE_RESOURCE_PATH"));
  }
});

test("terminal visual nodes require an explicit aria-hidden contract", async () => {
  const input = await syntheticInput();
  const terminal = input.tree.nodes.find((node) => !input.tree.nodes.some((candidate) => candidate.parent === node.index));
  delete terminal.attributes["aria-hidden"];
  assert.throws(() => buildDom(input), errorCode("ACCESSIBILITY_REQUIRED"));
});

test("CSS closure rejects indirect networking, escapes, sibling scope exits, and mismatched mounts", async () => {
  const input = await syntheticInput();
  const cssResource = (value) => {
    const changed = copy(input);
    changed.resourceInputs.find((resource) => resource.kind === "stylesheet").bytes = new TextEncoder().encode(`${value}\n`);
    return changed;
  };
  assert.throws(
    () => buildDom(cssResource('[data-domformat-root="synthetic"]{background-image:image-set("https://example.test/a" 1x)}')),
    errorCode("UNSAFE_CSS_FUNCTION"),
  );
  assert.throws(
    () => buildDom(cssResource('[data-domformat-root="synthetic"]{background-image:u\\72l("https://example.test/a")}')),
    errorCode("UNSAFE_CSS_ESCAPE"),
  );
  assert.throws(
    () => buildDom(cssResource('[data-domformat-root="synthetic"]{background-image:url ("https://example.test/a")}')),
    errorCode("UNSAFE_CSS"),
  );
  assert.throws(
    () => buildDom(cssResource('[data-domformat-root="synthetic"] ~ *{color:red}')),
    errorCode("CSS_SCOPE_ESCAPE"),
  );
  const mismatch = copy(input);
  mismatch.cssBinding.stylesheets[0].scope = '[data-domformat-root="other"]';
  assert.throws(() => buildDom(mismatch), errorCode("CSS_SCOPE_MISMATCH"));
  const reserved = copy(input);
  reserved.tree.mount.attributes.push(["data-domformat-instance", "package-controlled"]);
  assert.throws(() => buildDom(reserved), errorCode("UNSAFE_ATTRIBUTE"));
  const surface = copy(input);
  surface.tree.mount.attributes.push(["data-domformat-mount-surface", "package-controlled"]);
  assert.throws(() => buildDom(surface), errorCode("UNSAFE_ATTRIBUTE"));
  const nodeSurface = copy(input);
  nodeSurface.tree.nodes[0].attributes["data-domformat-mount-surface"] = "package-controlled";
  assert.throws(() => buildDom(nodeSurface), errorCode("UNSAFE_ATTRIBUTE"));
  const spacedInlineFunction = copy(input);
  spacedInlineFunction.tree.nodes[0].styles.transform = "matrix3d (1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1)";
  assert.throws(() => buildDom(spacedInlineFunction), errorCode("UNSAFE_STYLE_VALUE"));
});

test("CSS materialization rewrites exact token and scope spans in one pass", () => {
  const scope = '[data-domformat-root="synthetic"]';
  const binding = {
    id: "model-css",
    scope,
    assetTokens: [
      { token: "dom-asset:foo", resource: "foo" },
      { token: "dom-asset:foo-bar", resource: "foo-bar" },
    ],
  };
  const css = `${scope}{background-image:url("dom-asset:foo"),url(dom-asset:foo-bar)}`;
  const output = materializeCss(css, binding, new Map([
    ["foo", "blob:short"],
    ["foo-bar", "blob:long"],
  ]), { scope: '[data-domformat-instance="d0"]' });
  assert.equal(output, '[data-domformat-instance="d0"]{background-image:url("blob:short"),url("blob:long")}');
});

test("CSS and binding cardinality limits reject unused or excessive declarations", async () => {
  const input = await syntheticInput();
  assert.throws(() => buildDom(input, { limits: { maxCssRules: 1 } }), errorCode("CSS_RULE_LIMIT"));
  assert.throws(() => buildDom(input, { limits: { maxCssAssetTokens: 0 } }), errorCode("CSS_TOKEN_LIMIT"));
  const executable = await syntheticPolycssInput();
  assert.throws(() => buildDom(executable, { limits: { maxBindingInputs: 0 } }), errorCode("BINDING_INPUT_LIMIT"));
  const unused = copy(executable);
  unused.bindings.inputs.push({ id: "zz-unused", type: "boolean", default: false });
  assert.throws(() => buildDom(unused), errorCode("UNUSED_INPUT"));
});

test("rejects unsupported format and profile declarations", async () => {
  const input = await syntheticInput();
  const built = buildDom(input);
  const document = copy(built.document);
  document.meta.profile = "private-producer-adapter@0";
  assert.throws(() => validateDocument(document), errorCode("UNSUPPORTED_PROFILE"));
  document.meta.profile = "polycss-3d@0";
  document.meta.format = "gzip-wrapper@0";
  assert.throws(() => validateDocument(document), errorCode("UNSUPPORTED_FORMAT"));
});

test("META fails unknown required capabilities and safely ignores unknown optional ones", async () => {
  const built = buildDom(await syntheticInput());
  const optional = copy(built.document);
  optional.meta.optionalCapabilities = ["future-decoration"];
  assert.doesNotThrow(() => validateDocument(optional));

  const unknown = copy(built.document);
  unknown.meta.capabilities.push("future-required");
  assert.throws(() => validateDocument(unknown), errorCode("UNSUPPORTED_REQUIRED_CAPABILITY"));

  const missing = copy(built.document);
  delete missing.meta.capabilities;
  assert.throws(() => validateDocument(missing), errorCode("INVALID_META"));

  const overlap = copy(built.document);
  overlap.meta.optionalCapabilities = [overlap.meta.capabilities[0]];
  assert.throws(() => validateDocument(overlap), errorCode("INVALID_META"));

  const experience = copy(built.document);
  experience.meta.initialExperience = "webpage-replay";
  assert.throws(() => validateDocument(experience), errorCode("INVALID_META"));

  const unavailable = copy(built.document);
  unavailable.meta.initialExperience = "interaction";
  unavailable.meta.capabilities.push("prepared-pointer-grab-interaction");
  assert.throws(() => validateDocument(unavailable), errorCode("MISSING_INITIAL_EXPERIENCE"));

  const polycss = buildDom(await syntheticPolycssInput()).document;
  const underdeclared = copy(polycss);
  underdeclared.meta.capabilities = underdeclared.meta.capabilities.filter((value) => value !== "prepared-playback");
  assert.throws(() => validateDocument(underdeclared), errorCode("CAPABILITY_CLOSURE_MISMATCH"));
  const falseConformance = copy(polycss);
  falseConformance.meta.conformance.executable[1] = "future-viewer-only";
  assert.throws(() => validateDocument(falseConformance), errorCode("CONFORMANCE_CLOSURE_MISMATCH"));
  const declaredOnly = copy(polycss);
  declaredOnly.meta.conformance.declaredOnly.push("future-viewer-only");
  assert.throws(() => validateDocument(declaredOnly), errorCode("CONFORMANCE_CLOSURE_MISMATCH"));
});

test("META binds canonically ordered artifact identities while inert claims grant no authority", async () => {
  const input = await syntheticInput();
  input.meta.artifacts = [
    { id: "config", role: "configuration", byteLength: 83, decodedByteLength: 83, digest: { algorithm: "sha256", value: "1".repeat(64) } },
    { id: "model", role: "primary", byteLength: 4096, decodedByteLength: 8192, digest: { algorithm: "sha256", value: "2".repeat(64) } },
  ];
  input.meta.claims = [
    { artifact: "config", kind: "license", value: "MIT" },
    { artifact: "config", kind: "qualification", value: "source-verified" },
    { artifact: "model", kind: "locator", value: "https://example.test/source/model.bin" },
    { artifact: "model", kind: "qualification", value: "native-parity-unqualified" },
    { artifact: "model", kind: "revision", value: "abc123" },
  ];
  assert.doesNotThrow(() => buildDom(input));
  const cases = [
    ["legacy singleton", (value) => { value.meta.sourceArtifact = value.meta.artifacts[0]; }, "INVALID_META"],
    ["status mixed into identity", (value) => { value.meta.artifacts[0].status = "source-verified"; }, "INVALID_META"],
    ["artifact order", (value) => { value.meta.artifacts.reverse(); }, "INVALID_META"],
    ["duplicate claim", (value) => { value.meta.claims[3] = structuredClone(value.meta.claims[2]); }, "INVALID_META"],
    ["unknown artifact", (value) => { value.meta.claims[0].artifact = "missing"; }, "INVALID_META"],
    ["local POSIX path", (value) => { value.meta.claims[2].value = "/Users/example/model.bin"; }, "META_LOCAL_PATH"],
    ["local Windows path", (value) => { value.meta.claims[2].value = "C:\\Users\\example\\model.bin"; }, "META_LOCAL_PATH"],
    ["credentialed locator", (value) => { value.meta.claims[2].value = "https://user:pass@example.test/model.bin"; }, "INVALID_META"],
    ["claim resource authority", (value) => { value.meta.claims[2].value = "dom-asset:checker"; }, "INVALID_META"],
  ];
  for (const [label, mutate, code] of cases) {
    const value = copy(input);
    mutate(value);
    assert.throws(() => buildDom(value), errorCode(code), label);
  }
});

test("rejects unknown tree fields and codec/interpreter mismatches", async () => {
  const input = await syntheticInput();
  const unknown = copy(input);
  unknown.tree.nodes[0].adapterPrivateState = { executable: "no" };
  assert.throws(() => buildDom(unknown), errorCode("INVALID_NODE"));
  const mismatch = copy(await syntheticPolycssInput());
  mismatch.bindings.channels[0].interpreter = "static-presentation@0";
  assert.throws(() => buildDom(mismatch), errorCode("STATE_INTERPRETER_MISMATCH"));
});

test("validates image identity, dimensions, and semantic resource roles", async () => {
  const input = await syntheticInput();
  assert.throws(() => buildDom(input, { limits: { maxImagePixels: 1 } }), errorCode("IMAGE_DIMENSION_LIMIT"));
  assert.throws(() => buildDom(input, { limits: { maxAggregateImagePixels: 3 } }), errorCode("AGGREGATE_IMAGE_PIXEL_LIMIT"));
  const animatedPng = copy(input);
  const checker = animatedPng.resourceInputs.find((resource) => resource.id === "checker");
  const animationControl = new Uint8Array(8);
  new DataView(animationControl.buffer).setUint32(0, 2, false);
  checker.bytes = insertPngChunk(checker.bytes, "acTL", animationControl);
  assert.throws(() => buildDom(animatedPng), errorCode("IMAGE_ANIMATION_UNSUPPORTED"));
  const malformedImage = copy(input);
  malformedImage.resourceInputs.find((resource) => resource.id === "checker").bytes = new TextEncoder().encode("not a png");
  assert.throws(() => buildDom(malformedImage), errorCode("IMAGE_MEDIA_MISMATCH"));
  const wrongRole = copy(input);
  wrongRole.cssBinding.stylesheets[0].assetTokens[0].resource = "model-css";
  assert.throws(() => buildDom(wrongRole), errorCode("RESOURCE_ROLE_MISMATCH"));
  const unused = copy(input);
  unused.resourceInputs.push({
    id: "unused",
    kind: "binary",
    mediaType: "application/octet-stream",
    path: "unused.bin",
    bytes: new Uint8Array([1, 2, 3]),
  });
  assert.throws(() => buildDom(unused), errorCode("INVALID_RESOURCE_KIND"));

  const headerOnlyWebp = copy(input);
  const webp = new Uint8Array(30);
  webp.set(new TextEncoder().encode("RIFF"), 0);
  new DataView(webp.buffer).setUint32(4, 22, true);
  webp.set(new TextEncoder().encode("WEBPVP8X"), 8);
  new DataView(webp.buffer).setUint32(16, 10, true);
  headerOnlyWebp.resourceInputs[0].mediaType = "image/webp";
  headerOnlyWebp.resourceInputs[0].bytes = webp;
  assert.throws(() => buildDom(headerOnlyWebp), errorCode("IMAGE_MEDIA_MISMATCH"));
});

test("rejects unknown resource catalog, record, digest, dimensions, and legacy storage fields", async () => {
  const input = await syntheticInput();
  const built = buildDom(input);
  const cases = [
    ["INVALID_RESOURCES", (document) => { document.resources.privateUrl = "https://example.test/catalog"; }],
    ["INVALID_RESOURCE", (document) => { document.resources.resources[0].privateUrl = "https://example.test/resource"; }],
    ["INVALID_RESOURCE_DIGEST", (document) => { document.resources.resources[0].digest.trustMe = true; }],
    ["INVALID_RESOURCE_DIMENSIONS", (document) => { document.resources.resources[0].dimensions.channels = 4; }],
    ["INVALID_RESOURCE", (document) => { document.resources.resources[0].storage = { mode: "external", path: "asset.png" }; }],
    ["UNSAFE_RESOURCE_PATH", (document) => { document.resources.resources[0].path = "https://example.test/asset"; }],
  ];
  for (const [code, mutate] of cases) {
    const document = copy(built.document);
    mutate(document);
    assert.throws(() => validateDocument(document), errorCode(code));
  }
});

test("rejects context-dependent inline styles and obsolete state-machine surface", async () => {
  const input = await syntheticInput();
  const contextual = copy(input);
  contextual.tree.nodes[2].styles.transform = "translateX(var(--embedding-owned-offset))";
  assert.throws(() => buildDom(contextual), errorCode("UNSAFE_STYLE_VALUE"));
  const environment = copy(input);
  environment.tree.nodes[2].styles.transform = "translateX(env(safe-area-inset-left))";
  assert.throws(() => buildDom(environment), errorCode("UNSAFE_STYLE_VALUE"));
  const obsolete = copy(input);
  obsolete.state.channels.push({ id: "frames", codec: "style-frames@0", data: { frames: [] } });
  assert.throws(() => buildDom(obsolete), errorCode("UNSUPPORTED_STATE_CODEC"));
  const declared = copy(await syntheticPolycssInput());
  declared.bindings.channels[0].status = "declared";
  assert.throws(() => buildDom(declared), errorCode("INVALID_BINDING_STATUS"));
});

test("rejects malformed, empty, host-escaped, or excessive binding targets before execution", async () => {
  const input = await syntheticPolycssInput();
  const malformed = copy(input);
  malformed.bindings.channels[0].targets.emitters[0][0] = null;
  assert.throws(() => buildDom(malformed), errorCode("INVALID_TARGETS"));
  const empty = copy(input);
  empty.bindings.channels[0].targets = {};
  assert.throws(() => buildDom(empty), errorCode("INVALID_TARGETS"));

  const polycss = await syntheticPolycssInput();
  const hostLeaf = copy(polycss);
  hostLeaf.bindings.channels.find((channel) => channel.interpreter === "polycss-playback@0").targets.leaves[0] = "$host";
  assert.throws(() => buildDom(hostLeaf), errorCode("INVALID_STABLE_ID"));

  const excessive = copy(input);
  excessive.bindings.channels[0].targets = { repeated: new Array(excessive.tree.nodes.length + 2).fill(excessive.tree.nodes[0].id) };
  assert.throws(() => buildDom(excessive), errorCode("TARGET_CARDINALITY_MISMATCH"));
});

test("rejects unknown executable PolyCSS packet fields", async () => {
  const base = await syntheticPolycssInput();
  const cases = [
    ["INVALID_PLAYBACK_STATE", (input) => {
      input.state.channels.find((channel) => channel.id === "playback").data.packet.lighting = [];
    }],
    ["INVALID_PLAYBACK_STATE", (input) => {
      input.state.channels.find((channel) => channel.id === "playback").data.packet.initial.leaves.visibility = [1];
    }],
    ["INVALID_FRAME_ROW", (input) => {
      input.state.channels.find((channel) => channel.id === "playback").data.packet.frameRows[0].push(0);
    }],
    ["INVALID_SURFACE_STATE", (input) => {
      input.state.channels.find((channel) => channel.id === "surface").data.packet.lighting = {};
    }],
    ["INVALID_PRESENTATION_STATE", (input) => {
      input.state.channels.find((channel) => channel.id === "presentation").data.packet.background.asset = "checker";
    }],
    ["INVALID_EFFECTS_STATE", (input) => {
      input.state.channels.find((channel) => channel.id === "effects").data.packet.spawnStream.tuples[0][1] = 1e40;
    }],
  ];
  for (const [code, mutate] of cases) {
    const input = copy(base);
    mutate(input);
    assert.throws(() => buildDom(input), errorCode(code));
  }
});

test("cross-checks initial surface bits and atlas state against retained TREE styles", async () => {
  const base = await syntheticPolycssInput();
  const unusedBit = copy(base);
  unusedBit.state.channels.find((channel) => channel.id === "surface").data.packet.visibility.initialVisibleBitsBase64 = "Aw==";
  assert.throws(() => buildDom(unusedBit), errorCode("INVALID_SURFACE_STATE"));

  const visibility = copy(base);
  visibility.tree.nodes.find((node) => node.id === "synthetic-polycss/leaf").styles.visibility = "hidden";
  assert.throws(() => buildDom(visibility), errorCode("SURFACE_TREE_MISMATCH"));

  const defaultAtlas = copy(base);
  delete defaultAtlas.tree.nodes.find((node) => node.id === "synthetic-polycss/leaf").styles.backgroundPositionY;
  assert.doesNotThrow(() => buildDom(defaultAtlas));

  const atlas = copy(base);
  atlas.tree.nodes.find((node) => node.id === "synthetic-polycss/leaf").styles.backgroundPositionY = "-1px";
  assert.throws(() => buildDom(atlas), errorCode("SURFACE_TREE_MISMATCH"));
});

test("validates prepared two-axis surface addresses and sparse class variants", async () => {
  const base = await syntheticAdapterTechniquesInput();
  assert.doesNotThrow(() => buildDom(base));

  const wrongSurfaceSink = copy(base);
  wrongSurfaceSink.bindings.channels.find((channel) => channel.id === "surface").sinks = ["style.backgroundPositionY", "style.visibility"];
  assert.throws(() => buildDom(wrongSurfaceSink), errorCode("INVALID_SURFACE_BINDING"));

  const legacyPosition = copy(base);
  legacyPosition.state.channels.find((channel) => channel.id === "surface").data.packet.surface.statePacking.backgroundPositions = ["0 0", "rgb(0 0 0)"];
  assert.throws(() => buildDom(legacyPosition), errorCode("INVALID_SURFACE_STATE"));

  for (const [label, mutate, code = "INVALID_SURFACE_STATE"] of [
    ["missing packed indices", (packing) => { delete packing.positionIndicesBase64; }],
    ["missing dictionary", (packing) => { delete packing.positionDictionary; }],
    ["fractional coordinate", (packing) => { packing.positionDictionary[0][0] = -0.5; }],
    ["out-of-range coordinate", (packing) => { packing.positionDictionary[1][0] = 0x80000000; }],
    ["unsorted dictionary", (packing) => { packing.positionDictionary.reverse(); }],
    ["duplicate dictionary", (packing) => { packing.positionDictionary[1] = [-16, -16]; }],
    ["unreferenced dictionary row", (packing) => { packing.positionIndicesBase64 = packedIntegers([0, 0], 2); }],
    ["out-of-range dictionary index", (packing) => { packing.positionIndicesBase64 = packedIntegers([1, 2], 2); }, "STATE_COLUMN_MISMATCH"],
    ["truncated state indices", (packing) => { packing.positionIndicesBase64 = packedIntegers([1], 2); }, "STATE_COLUMN_MISMATCH"],
  ]) {
    const invalid = copy(base);
    const packing = invalid.state.channels.find((channel) => channel.id === "surface").data.packet.surface.statePacking;
    mutate(packing);
    assert.throws(() => buildDom(invalid), errorCode(code), label);
  }

  const negativeZero = structuredClone(buildDom(base).document);
  negativeZero.state.channels.find((channel) => channel.id === "surface").data.packet.surface.statePacking.positionDictionary[1][0] = -0;
  assert.throws(() => validateDocument(negativeZero), errorCode("INVALID_SURFACE_STATE"), "negative zero coordinate");

  const wrongInitialClass = copy(base);
  wrongInitialClass.tree.nodes.find((node) => node.id === "synthetic-polycss/leaf").classes = ["leaf", "material-b"];
  assert.throws(() => buildDom(wrongInitialClass), errorCode("VARIANT_TREE_MISMATCH"));

  const noOpTransition = copy(base);
  noOpTransition.state.channels.find((channel) => channel.id === "variants").data.packet.sequential.classIndicesBase64 = "AAAAAA==";
  assert.throws(() => buildDom(noOpTransition), errorCode("INVALID_VARIANT_STATE"));

  const declaredOutline = copy(base);
  const outlinePacket = declaredOutline.state.channels.find((channel) => channel.id === "variants").data.packet;
  outlinePacket.effects[0].styles.outlineColor = "#f88";
  outlinePacket.effects[1].styles.outlineColor = "#8f8";
  declaredOutline.bindings.channels.find((channel) => channel.id === "variants").sinks.push("style.outlineColor");
  assert.doesNotThrow(() => buildDom(declaredOutline));

  const stylesheetOverride = copy(base);
  const stylesheet = stylesheetOverride.resourceInputs.find((resource) => resource.id === "model-css");
  stylesheet.bytes = new TextEncoder().encode(`${new TextDecoder().decode(stylesheet.bytes)}\n[data-domformat-root="synthetic-polycss"] .material-a *{visibility:hidden}`);
  assert.throws(() => buildDom(stylesheetOverride), errorCode("UNDECLARED_VARIANT_EFFECT"));

  const important = copy(base);
  const importantCss = important.resourceInputs.find((resource) => resource.id === "model-css");
  importantCss.bytes = new TextEncoder().encode(`${new TextDecoder().decode(importantCss.bytes)}\n[data-domformat-root="synthetic-polycss"] .leaf{color:red !important}`);
  assert.throws(() => buildDom(important), errorCode("UNSAFE_CSS_IMPORTANT"));

  const undeclaredProperty = copy(base);
  undeclaredProperty.state.channels.find((channel) => channel.id === "variants").data.packet.effects[0].styles.transform = "none";
  assert.throws(() => buildDom(undeclaredProperty), errorCode("INVALID_VARIANT_EFFECT"));

  const incompleteSinks = copy(base);
  incompleteSinks.bindings.channels.find((channel) => channel.id === "variants").sinks = ["class.prepared"];
  assert.throws(() => buildDom(incompleteSinks), errorCode("INVALID_VARIANT_BINDING"));

  const escapedTarget = copy(base);
  escapedTarget.bindings.channels.find((channel) => channel.id === "variants").targets.effectNodes = ["synthetic-polycss/camera"];
  escapedTarget.state.channels.find((channel) => channel.id === "variants").data.packet.effects[0].targetIndex = 0;
  assert.throws(() => buildDom(escapedTarget), errorCode("INVALID_VARIANT_EFFECT"));
});

test("surface transitions and jumps must reproduce the canonical target frame", async () => {
  const base = await syntheticTwoFramePolycssInput();
  assert.doesNotThrow(() => buildDom(base));

  const transition = copy(base);
  transition.state.channels.find((channel) => channel.id === "surface").data.packet.transitions.sequential.stateIndexDeltas = [0, 0];
  assert.throws(() => buildDom(transition), errorCode("SURFACE_TRANSITION_MISMATCH"));

  const jump = copy(base);
  const packet = jump.state.channels.find((channel) => channel.id === "surface").data.packet;
  packet.transitions.nonInteractiveJumps = [{
    fromFrame: 1,
    toFrame: 2,
    faceIndicesBase64: "",
    stateIndicesBase64: "",
  }];
  packet.visibility.nonInteractiveJumps = [{ fromFrame: 1, toFrame: 2, faceIndicesBase64: "" }];
  assert.throws(() => buildDom(jump), errorCode("SURFACE_JUMP_MISMATCH"));
});

test("surface visibility validation retains only declared jump endpoints", async () => {
  const base = await syntheticPagedPlaybackInput();
  assert.doesNotThrow(() => buildDom(base, { limits: { maxVisibilityCells: 1 } }));

  const jump = copy(base);
  const packet = jump.state.channels.find((channel) => channel.id === "surface").data.packet;
  packet.transitions.nonInteractiveJumps = [{
    fromFrame: 1,
    toFrame: 2,
    faceIndicesBase64: "",
    stateIndicesBase64: "",
  }];
  packet.visibility.nonInteractiveJumps = [{ fromFrame: 1, toFrame: 2, faceIndicesBase64: "" }];
  assert.throws(
    () => buildDom(jump, { limits: { maxVisibilityCells: 1 } }),
    errorCode("VISIBILITY_ALLOCATION_LIMIT"),
  );
});

test("closed inputs, binary32 publication, and target ownership fail before runtime", async () => {
  const base = await syntheticPolycssInput();

  const tickDefault = copy(base);
  tickDefault.bindings.inputs.find((input) => input.id === "time.tick").default = 0;
  assert.throws(() => buildDom(tickDefault), errorCode("INVALID_PLAYBACK_BINDING"));

  const overflowingAppearance = copy(base);
  overflowingAppearance.state.channels.find((channel) => channel.id === "playback").data.packet.appearances[0][1] = Number.MAX_VALUE;
  assert.throws(() => buildDom(overflowingAppearance), errorCode("INVALID_PLAYBACK_STATE"));

  const overlappingEffect = copy(base);
  overlappingEffect.bindings.channels.find((channel) => channel.id === "effects").targets.emitters[0][0] = "synthetic-polycss/model";
  assert.throws(() => buildDom(overlappingEffect), errorCode("TARGET_OWNERSHIP_CONFLICT"));
});

test("target traversal is depth-bounded and codec base64 scanning is stack-safe", async () => {
  const built = buildDom(await syntheticPolycssInput());

  const deep = copy(built.document);
  let targets = "synthetic-polycss/model";
  for (let depth = 0; depth < 20_000; depth += 1) targets = { nested: targets };
  deep.bindings.channels.find((channel) => channel.id === "playback").targets = targets;
  assert.throws(() => validateDocument(deep), errorCode("TARGET_DEPTH_LIMIT"));

  const broad = copy(built.document);
  broad.bindings.channels.find((channel) => channel.id === "playback").targets = {
    branches: Array.from({ length: 101 }, () => ({})),
  };
  assert.throws(() => validateDocument(broad), errorCode("TARGET_CARDINALITY_MISMATCH"));

  const large = copy(built.document);
  large.state.channels.find((channel) => channel.id === "surface").data.packet.visibility.sequential.faceIndicesBase64 = `${"AAAA".repeat(2_599_999)}AAA*`;
  assert.throws(() => validateDocument(large), (error) => {
    assert.equal(error?.name, "DomFormatError");
    assert.equal(error?.code, "INVALID_SURFACE_STATE");
    return true;
  });
});

test("rejects unknown top-level and META fields in the executable fixture", async () => {
  const built = buildDom(await syntheticPolycssInput());
  assert.throws(() => validateDocument(Object.create(built.document)), errorCode("INVALID_DOCUMENT"));
  const top = copy(built.document);
  top.privateAdapter = {};
  assert.throws(() => validateDocument(top), errorCode("INVALID_DOCUMENT"));
  const meta = copy(built.document);
  meta.meta.privateAdapter = "private-producer";
  assert.throws(() => validateDocument(meta), errorCode("INVALID_META"));
  const counts = copy(built.document);
  counts.meta.counts.nodes += 1;
  assert.throws(() => validateDocument(counts), errorCode("META_COUNT_MISMATCH"));
});
