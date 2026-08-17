import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { readFile } from "node:fs/promises";
import { loadManifest } from "../src/manifest.js";
import { encodeCanonicalJson } from "../src/canonical-json.js";
import { materializePolycssState } from "../src/state/polycss.js";

const here = dirname(fileURLToPath(import.meta.url));
export const projectRoot = resolve(here, "..");
export const syntheticManifestPath = resolve(projectRoot, "fixtures/synthetic/manifest.json");
export const syntheticPolycssManifestPath = resolve(projectRoot, "fixtures/synthetic-polycss/manifest.json");
export const syntheticInteractionPacketPath = resolve(projectRoot, "fixtures/synthetic-interaction/packet.json");

export async function syntheticInput() {
  return loadManifest(syntheticManifestPath);
}

export async function syntheticPolycssInput() {
  return loadManifest(syntheticPolycssManifestPath);
}

export async function syntheticEmptySurfaceInput() {
  const input = await syntheticPolycssInput();
  const playbackBinding = input.bindings.channels.find((channel) => channel.interpreter === "polycss-playback@0");
  const surfaceBinding = input.bindings.channels.find((channel) => channel.interpreter === "polycss-surface@0");
  const playback = input.state.channels.find((channel) => channel.codec === "polycss-playback-packed@0").data;
  const surface = input.state.channels.find((channel) => channel.codec === "polycss-surface-packed@0").data.packet;
  playback.packet.leafCount = 0;
  playback.packet.initial.leaves = { count: 0, transforms: [] };
  playback.packet.transforms = {
    count: 1,
    groups: [{
      encoding: "decimal-component-streams",
      empty: [0],
      scales: new Array(12).fill(0),
      columns: Array.from({ length: 12 }, () => []),
    }],
  };
  playback.leafFit = [];
  playbackBinding.targets.leaves = [];
  surfaceBinding.targets.leaves = [];
  surface.surface = { faces: [], statePacking: { stateCount: 0, sourceFrameDeltas: [] } };
  surface.visibility.initialVisibleBitsBase64 = "";
  input.meta.counts.leaves = 0;
  return input;
}

export async function syntheticPlaybackWithoutSurfaceInput() {
  const input = await syntheticEmptySurfaceInput();
  input.state.channels = input.state.channels.filter((channel) => channel.codec !== "polycss-surface-packed@0");
  input.bindings.channels = input.bindings.channels.filter((channel) => channel.interpreter !== "polycss-surface@0");
  input.meta.capabilities = input.meta.capabilities.filter((capability) => capability !== "prepared-surface-lighting");
  input.meta.conformance.executable = input.meta.conformance.executable.filter((role) => role !== "surface-lighting");
  return input;
}

export async function syntheticAnimationWithoutEffectsInput() {
  const input = await syntheticPolycssInput();
  input.state.channels = input.state.channels.filter((channel) => channel.codec !== "polycss-effects-prepared@0");
  input.bindings.channels = input.bindings.channels.filter((channel) => channel.interpreter !== "polycss-effects@0");
  input.bindings.inputs = input.bindings.inputs.filter((definition) => !definition.id.startsWith("interaction.grab-"));
  input.meta.capabilities = input.meta.capabilities.filter((capability) => capability !== "prepared-particle-effects");
  input.meta.conformance.executable = input.meta.conformance.executable.filter((role) => role !== "particle-effects");
  return input;
}

export async function syntheticEffectsWithoutPlaybackInput() {
  const input = await syntheticPolycssInput();
  input.state.channels = input.state.channels.filter((channel) => !["polycss-playback-packed@0", "polycss-surface-packed@0"].includes(channel.codec));
  input.bindings.channels = input.bindings.channels.filter((channel) => !["polycss-playback@0", "polycss-surface@0"].includes(channel.interpreter));
  input.bindings.inputs = input.bindings.inputs.filter((definition) => definition.id !== "time.tick");
  input.meta.capabilities = input.meta.capabilities.filter((capability) => !["prepared-playback", "prepared-surface-lighting"].includes(capability));
  input.meta.conformance.executable = input.meta.conformance.executable.filter((role) => !["playback", "surface-lighting"].includes(role));
  input.meta.counts = { nodes: input.tree.nodes.length };
  return input;
}

export async function syntheticStaticPresentationInput() {
  const input = await syntheticPolycssInput();
  input.tree.nodes = input.tree.nodes.slice(0, 3);
  delete input.tree.mount.resourceStyles.backgroundImage;
  delete input.tree.mount.styles.backgroundPosition;
  delete input.tree.mount.styles.backgroundRepeat;
  delete input.tree.mount.styles.backgroundSize;
  const presentationState = input.state.channels.find((channel) => channel.codec === "static-presentation@0");
  delete presentationState.data.packet.background;
  input.state.channels = [presentationState];
  const presentationBinding = input.bindings.channels.find((channel) => channel.interpreter === "static-presentation@0");
  presentationBinding.targets = { host: "$host", camera: "synthetic-polycss/camera" };
  presentationBinding.sinks = ["style.height", "style.left", "style.top", "style.transform", "style.width"];
  input.bindings.channels = [presentationBinding];
  input.bindings.inputs = input.bindings.inputs.filter((definition) => definition.id.startsWith("viewport."));
  input.meta.capabilities = ["css-semantic-closure", "deterministic-json", "explicit-retained-tree", "logical-assets"];
  input.meta.conformance.executable = ["retained-tree", "presentation"];
  input.meta.counts = { nodes: input.tree.nodes.length };
  return input;
}

export async function syntheticResponsivePresentationInput() {
  const input = await syntheticStaticPresentationInput();
  const profiles = [
    {
      id: "mobile",
      maxViewportWidth: 600,
      fit: "contain",
      quarterTurns: 1,
      bounds: [40, -40, 280, 280],
      safeInset: 8,
      bias: [0, -0.06],
    },
    {
      id: "desktop",
      fit: "contain",
      quarterTurns: 0,
      bounds: [0, 0, 320, 240],
      safeInset: 0,
      bias: [0, 0],
    },
  ];
  const presentationState = input.state.channels.find((channel) => channel.codec === "static-presentation@0");
  const presentationBinding = input.bindings.channels.find((channel) => channel.interpreter === "static-presentation@0");
  presentationState.data.packet.camera.profileSelection = "viewport-width";
  presentationState.data.packet.camera.profiles = structuredClone(profiles);
  presentationBinding.parameters.profileSelection = "viewport-width";
  presentationBinding.parameters.profiles = structuredClone(profiles);
  return input;
}

export async function syntheticOrbitInput() {
  const input = await syntheticStaticPresentationInput();
  const stateCount = 120;
  const positionDictionary = Array.from({ length: stateCount }, (_, index) => [0, -(stateCount - 1 - index) * 16]);
  const positionIndex = (state) => stateCount - 1 - state;
  const model = input.tree.nodes.find((node) => node.id === "synthetic-polycss/model");
  const leaf = input.tree.nodes.find((node) => node.id === "synthetic-polycss/leaf");
  model.styles.transform = "translate3d(0px, 7.5px, 0px) rotateX(0deg) rotateY(0deg) scale3d(1, 1.032, 1)";
  delete leaf.styles.backgroundPositionY;
  leaf.styles.backgroundPosition = "0 0";
  input.state.channels.unshift({
    id: "orbit",
    codec: "polycss-orbit-input-prepared@0",
    data: {
      packet: {
        version: 0,
        initial: { pitch: 0, yaw: 0, zoom: 1 },
        ranges: { pitch: [-28, 28], yaw: [-180, 180], zoom: [0.5, 2] },
        model: { translation: [0, 7.5, 0], scale: [1, 1.032, 1] },
        surface: {
          stateCount,
          positionDictionary,
          initialPositionIndicesBase64: base64Integers([positionIndex(0)], 2),
          transitions: {
            offsetsBase64: base64Integers(Array.from({ length: stateCount + 1 }, (_, index) => index), 4),
            leafIndicesBase64: base64Integers(new Array(stateCount).fill(0), 2),
            forwardPositionIndicesBase64: base64Integers(Array.from({ length: stateCount }, (_, state) => positionIndex(state)), 2),
            backwardPositionIndicesBase64: base64Integers(Array.from({ length: stateCount }, (_, state) => positionIndex((state + stateCount - 1) % stateCount)), 2),
          },
        },
      },
    },
  });
  input.bindings.inputs.unshift(
    { id: "orbit.pitch", type: "float", default: 0 },
    { id: "orbit.yaw", type: "float", default: 0 },
    { id: "orbit.zoom", type: "float", default: 1 },
  );
  input.bindings.channels.unshift({
    id: "orbit",
    state: "orbit",
    interpreter: "polycss-orbit-input@0",
    status: "executable",
    inputs: ["orbit.pitch", "orbit.yaw", "orbit.zoom"],
    targets: { model: model.id, leaves: [leaf.id] },
    sinks: ["style.backgroundPosition", "style.transform"],
  });
  input.meta.capabilities.push("prepared-orbit-input");
  input.meta.conformance.executable.splice(1, 0, "orbit-input");
  return input;
}

export async function syntheticViewportProfilesInput(selectionMode = "presentation-profile") {
  const input = await syntheticExecutableInteractionInput();
  const presentationProfiles = [
    {
      id: "mobile",
      maxViewportWidth: 600,
      fit: "contain",
      quarterTurns: 1,
      bounds: [40, -40, 280, 280],
      safeInset: 8,
      bias: [0, -0.06],
    },
    {
      id: "desktop",
      fit: "contain",
      quarterTurns: 0,
      bounds: [0, 0, 320, 240],
      safeInset: 0,
      bias: [0, 0],
    },
  ];
  const presentationState = input.state.channels.find((channel) => channel.codec === "static-presentation@0");
  const presentationBinding = input.bindings.channels.find((channel) => channel.interpreter === "static-presentation@0");
  presentationState.data.packet.camera.profileSelection = "viewport-width";
  presentationState.data.packet.camera.profiles = structuredClone(presentationProfiles);
  presentationBinding.parameters.profileSelection = "viewport-width";
  presentationBinding.parameters.profiles = structuredClone(presentationProfiles);

  const surface = input.state.channels.find((channel) => channel.codec === "polycss-surface-packed@0").data.packet;
  surface.surface.faces[0].stateCount = 2;
  surface.surface.faces[1].stateOffset = 2;
  surface.surface.statePacking.stateCount = 3;
  surface.surface.statePacking.sourceFrameDeltas = [0, 1, 0];
  surface.transitions.sequential.offsetsBase64 = base64Integers([0, 1, 2, 2, 2, 2, 2, 2, 2], 4);
  surface.transitions.sequential.faceIndexDeltas = [0, 0];
  surface.transitions.sequential.stateIndexDeltas = [0, 1];

  const profileRows = selectionMode === "presentation-profile"
    ? [
        { id: "mobile", transformIndicesBase64: base64Integers([0, 0], 2), visibleBitsBase64: Buffer.from([2]).toString("base64") },
        { id: "desktop", transformIndicesBase64: base64Integers([0xffff, 0xffff], 2), visibleBitsBase64: Buffer.from([3]).toString("base64") },
      ]
    : [
        { id: "small", width: 320, height: 240, transformIndicesBase64: base64Integers([0, 0], 2), visibleBitsBase64: Buffer.from([2]).toString("base64") },
        { id: "large", width: 640, height: 480, transformIndicesBase64: base64Integers([0xffff, 0xffff], 2), visibleBitsBase64: Buffer.from([3]).toString("base64") },
      ];
  input.state.channels.push({
    id: "viewport-profiles",
    codec: "polycss-viewport-profiles-packed@0",
    data: {
      packet: {
        version: 0,
        selection: { mode: selectionMode },
        transforms: [[1, 0, 0, 0, 1, 0, 0, 0, 1, 10, 0, 0]],
        profiles: profileRows,
      },
    },
  });
  input.bindings.channels.push({
    id: "viewport-profiles",
    state: "viewport-profiles",
    interpreter: "polycss-viewport-profiles@0",
    status: "executable",
    inputs: ["viewport.height", "viewport.width"],
    targets: { leaves: ["synthetic/leaf", "synthetic/eye-leaf"] },
    sinks: ["style.transform", "style.visibility"],
  });
  input.meta.capabilities.push("prepared-viewport-profiles");
  input.meta.conformance.executable.push("viewport-profiles");
  return input;
}

export async function syntheticDynamicViewportProfilesInput() {
  const input = await syntheticViewportProfilesInput();
  const profiles = input.state.channels.find((channel) => channel.codec === "polycss-viewport-profiles-packed@0").data.packet.profiles;
  profiles[0].visibilityChanges = {
    offsetsBase64: base64Integers([0, 1, 2, 2, 2, 2, 2, 2, 2], 4),
    leafIndicesBase64: base64Integers([0, 0], 2),
  };
  profiles[1].responsiveAffine = {
    scale: { baseWidth: 320, baseHeight: 240, multiplier: 1, max: 1 },
    presentBitsBase64: Buffer.from([1]).toString("base64"),
    coefficientsBase64: base64Float64([
      0, 0,
      0, 2,
      0, -3,
      0, 0,
      0, 0.1, 0, 4,
      5, 0, 0.2, 6,
    ]),
  };
  return input;
}

export async function syntheticProfileTimelinesInput() {
  const input = await syntheticViewportProfilesInput();
  const playback = input.state.channels.find((channel) => channel.codec === "polycss-playback-packed@0").data.packet;
  playback.profileTimelines = [
    { profileId: "mobile", introTicks: 0, loopTicks: 2, frames: [1, 3] },
  ];
  return input;
}

function addPreparedBanks(packet) {
  const profileIds = packet.profileTimelines?.map((timeline) => timeline.profileId) ?? [];
  const profileRows = (entryFrame, nextFrame) => profileIds.length === 0 ? {} : {
    profileTimelines: profileIds.map((profileId) => ({ profileId, introTicks: 0, loopTicks: 2, frames: [entryFrame, nextFrame] })),
  };
  packet.initialBankId = "alpha";
  packet.banks = [
    {
      id: "alpha",
      entryFrame: packet.initial.sourceFrame,
      timeline: structuredClone(packet.timeline),
      ...(packet.profileTimelines === undefined ? {} : { profileTimelines: structuredClone(packet.profileTimelines) }),
    },
    { id: "beta", entryFrame: 3, timeline: { introTicks: 0, loopTicks: 2, frames: [3, 4] }, ...profileRows(3, 4) },
    { id: "gamma", entryFrame: 5, timeline: { introTicks: 0, loopTicks: 2, frames: [5, 6] }, ...profileRows(5, 6) },
  ];
}

export async function syntheticPreparedBanksInput() {
  const input = await syntheticProfileTimelinesInput();
  addPreparedBanks(input.state.channels.find((channel) => channel.codec === "polycss-playback-packed@0").data.packet);
  return input;
}

function setPreparedCadence(input, tickIntervalUs, catchUpPolicy) {
  for (const binding of input.bindings.channels) {
    if (!["polycss-playback@0", "polycss-paged-playback@0", "polycss-pointer-grab@0", "polycss-compositor-timing@0"].includes(binding.interpreter)) continue;
    delete binding.parameters.tickRateHz;
    binding.parameters.tickIntervalUs = [...tickIntervalUs];
    if (binding.interpreter === "polycss-playback@0" || binding.interpreter === "polycss-paged-playback@0") binding.parameters.catchUpPolicy = catchUpPolicy;
  }
}

function removeHistoryDependentChannels(input) {
  const removedStates = new Set(input.bindings.channels.filter((channel) => ["polycss-effects@0", "polycss-pointer-grab@0"].includes(channel.interpreter)).map((channel) => channel.state));
  input.bindings.channels = input.bindings.channels.filter((channel) => !["polycss-effects@0", "polycss-pointer-grab@0"].includes(channel.interpreter));
  input.state.channels = input.state.channels.filter((channel) => !removedStates.has(channel.id));
  const usedInputs = new Set(input.bindings.channels.flatMap((channel) => channel.inputs));
  input.bindings.inputs = input.bindings.inputs.filter((definition) => usedInputs.has(definition.id));
  input.meta.capabilities = input.meta.capabilities.filter((capability) => !["prepared-particle-effects", "prepared-pointer-grab-interaction"].includes(capability));
  input.meta.conformance.executable = input.meta.conformance.executable.filter((role) => !["particle-effects", "pointer-grab-interaction"].includes(role));
  input.meta.initialExperience = "animation";
}

function makePreparedSurfaceStructural(input) {
  const packet = input.state.channels.find((channel) => channel.codec === "polycss-surface-packed@0").data.packet;
  for (const [index, face] of packet.surface.faces.entries()) {
    face.stateOffset = index;
    face.stateCount = 1;
  }
  packet.surface.statePacking = {
    stateCount: packet.surface.faces.length,
    sourceFrameDeltas: new Array(packet.surface.faces.length).fill(0),
  };
  packet.transitions.sequential = {
    offsetsBase64: base64Integers(new Array(packet.frameCount + 1).fill(0), 4),
    faceIndexDeltas: [],
    stateIndexDeltas: [],
  };
  packet.transitions.nonInteractiveJumps = [];
  packet.visibility.sequential = {
    offsetsBase64: base64Integers(new Array(packet.frameCount + 1).fill(0), 4),
    faceIndicesBase64: "",
  };
  packet.visibility.nonInteractiveJumps = [];
}

async function attachViewportProfiles(input, dynamic) {
  const source = await (dynamic ? syntheticDynamicViewportProfilesInput() : syntheticViewportProfilesInput());
  if (dynamic) {
    for (const profile of source.state.channels.find((channel) => channel.codec === "polycss-viewport-profiles-packed@0").data.packet.profiles) delete profile.responsiveAffine;
  }
  const presentationState = input.state.channels.find((channel) => channel.codec === "static-presentation@0");
  const presentationBinding = input.bindings.channels.find((channel) => channel.interpreter === "static-presentation@0");
  const sourcePresentationState = source.state.channels.find((channel) => channel.codec === "static-presentation@0");
  const sourcePresentationBinding = source.bindings.channels.find((channel) => channel.interpreter === "static-presentation@0");
  presentationState.data.packet.camera = structuredClone(sourcePresentationState.data.packet.camera);
  presentationBinding.parameters = structuredClone(sourcePresentationBinding.parameters);
  input.state.channels.push(structuredClone(source.state.channels.find((channel) => channel.codec === "polycss-viewport-profiles-packed@0")));
  input.bindings.channels.push(structuredClone(source.bindings.channels.find((channel) => channel.interpreter === "polycss-viewport-profiles@0")));
  input.state.channels.sort((left, right) => left.id.localeCompare(right.id));
  input.bindings.channels.sort((left, right) => left.id.localeCompare(right.id));
  if (!input.meta.capabilities.includes("prepared-viewport-profiles")) input.meta.capabilities.push("prepared-viewport-profiles");
  if (!input.meta.conformance.executable.includes("viewport-profiles")) input.meta.conformance.executable.push("viewport-profiles");
}

function addTimelineDeadlines(packet) {
  const timelines = [packet.timeline, ...(packet.profileTimelines ?? []), ...(packet.banks?.flatMap((bank) => [bank.timeline, ...(bank.profileTimelines ?? [])]) ?? [])];
  for (const timeline of timelines) timeline.deadlineMicros = Array.from({ length: timeline.frames.length + 1 }, (_, index) => index * 40_000 + Math.max(0, index - 1) * 20_000);
}

function useTwoAxisSurfacePositions(input) {
  const surface = input.state.channels.find((channel) => channel.codec === "polycss-surface-packed@0").data.packet;
  const packing = surface.surface.statePacking;
  if (packing.positionDictionary) return;
  const deltas = packing.sourceFrameDeltas;
  const positions = deltas.map((delta, index) => ({ state: index, value: [-index * 16, -delta * 16] }));
  positions.sort((left, right) => left.value[0] - right.value[0] || left.value[1] - right.value[1]);
  const positionIndex = new Array(deltas.length);
  positions.forEach((entry, index) => { positionIndex[entry.state] = index; });
  packing.positionDictionary = positions.map((entry) => entry.value);
  packing.positionIndicesBase64 = base64Integers(positionIndex, 2);
  const binding = input.bindings.channels.find((channel) => channel.interpreter === "polycss-surface@0");
  binding.sinks = ["style.backgroundPosition", "style.visibility"];
  const initialTargetFrame = surface.transitions.initialFrame - 1;
  for (const [leafIndex, leafId] of binding.targets.leaves.entries()) {
    const leaf = input.tree.nodes.find((node) => node.id === leafId);
    const face = surface.surface.faces[leafIndex];
    let sourceFrame = 0;
    let selectedState = 0;
    for (let local = 0; local < face.stateCount; local += 1) {
      sourceFrame += deltas[face.stateOffset + local];
      if (sourceFrame > initialTargetFrame) break;
      selectedState = local;
    }
    const value = positions[positionIndex[face.stateOffset + selectedState]].value;
    delete leaf.styles.backgroundPositionY;
    leaf.styles.backgroundPosition = value.map((coordinate) => coordinate === 0 ? "0" : `${coordinate}px`).join(" ");
  }
}

function addSurfaceStateAtFrameTwo(input) {
  const packet = input.state.channels.find((channel) => channel.codec === "polycss-surface-packed@0").data.packet;
  packet.surface.faces[0].stateCount = 2;
  packet.surface.faces[1].stateOffset = 2;
  packet.surface.statePacking.stateCount = 3;
  packet.surface.statePacking.sourceFrameDeltas = [0, 1, 0];
  packet.transitions.sequential = {
    offsetsBase64: base64Integers([0, 1, 2, 2, 2, 2, 2, 2, 2], 4),
    faceIndexDeltas: [0, 0],
    stateIndexDeltas: [0, 1],
  };
}

function addSurfaceStateAtFrameThree(input) {
  const packet = input.state.channels.find((channel) => channel.codec === "polycss-surface-packed@0").data.packet;
  packet.surface.faces[0].stateCount = 3;
  packet.surface.faces[1].stateOffset = 3;
  packet.surface.statePacking.stateCount = 4;
  packet.surface.statePacking.sourceFrameDeltas = [0, 1, 1, 0];
  packet.transitions.sequential = {
    offsetsBase64: base64Integers([0, 1, 2, 3, 3, 3, 3, 3, 3], 4),
    faceIndexDeltas: [0, 0, 0],
    stateIndexDeltas: [0, 1, 1],
  };
}

function addInlineVariants(input) {
  const playback = input.bindings.channels.find((channel) => channel.interpreter === "polycss-playback@0");
  const frameCount = playback.parameters.frameCount;
  const leafId = playback.targets.leaves[0];
  const leaf = input.tree.nodes.find((node) => node.id === leafId);
  if (!leaf.classes.includes("material-a")) leaf.classes.push("material-a");
  input.state.channels.push({
    id: "variants",
    codec: "polycss-variants-packed@0",
    data: { packet: {
      version: 0,
      frameCount,
      classes: ["material-a", "material-b"],
      effects: [
        { classIndex: 0, ownerIndex: 0, targetIndex: 65535, styles: { color: "#f00" } },
        { classIndex: 1, ownerIndex: 0, targetIndex: 65535, styles: { color: "#0f0" } },
      ],
      initial: { frame: 1, classIndicesBase64: base64Integers([0], 2) },
      sequential: {
        offsetsBase64: base64Integers(Array.from({ length: frameCount + 1 }, (_, index) => index), 4),
        targetIndicesBase64: base64Integers(new Array(frameCount).fill(0), 2),
        classIndicesBase64: base64Integers(Array.from({ length: frameCount }, (_, index) => index % 2), 2),
      },
      nonInteractiveJumps: [],
    } },
  });
  input.bindings.channels.push({
    id: "variants",
    state: "variants",
    interpreter: "polycss-variants@0",
    status: "executable",
    inputs: ["time.source-frame"],
    targets: { effectNodes: [], nodes: [leafId] },
    sinks: ["class.prepared", "style.color"],
  });
  input.state.channels.sort((left, right) => left.id.localeCompare(right.id));
  input.bindings.channels.sort((left, right) => left.id.localeCompare(right.id));
  if (!input.meta.capabilities.includes("prepared-variants")) input.meta.capabilities.splice(input.meta.capabilities.findIndex((capability) => capability > "prepared-variants"), 0, "prepared-variants");
  if (!input.meta.conformance.executable.includes("variants")) {
    const viewportIndex = input.meta.conformance.executable.indexOf("viewport-profiles");
    input.meta.conformance.executable.splice(viewportIndex < 0 ? input.meta.conformance.executable.length : viewportIndex, 0, "variants");
  }
}

export async function syntheticCssGraphicsDemoInput(id) {
  let input;
  if (id === "3dpipes" || id === "gravitywell") {
    input = await syntheticPagedPreparedBanksInput();
    await attachViewportProfiles(input, id === "gravitywell");
  } else if (id === "electropaint") {
    input = await syntheticPagedPlaybackChangesInput();
  } else if (id === "gears") {
    input = await syntheticViewportProfilesInput();
    addPreparedBanks(input.state.channels.find((channel) => channel.codec === "polycss-playback-packed@0").data.packet);
    addInlineVariants(input);
  } else if (id === "maze") {
    input = await syntheticCompositorTimingInput();
    addPreparedBanks(input.state.channels.find((channel) => channel.codec === "polycss-playback-packed@0").data.packet);
  } else if (id === "menger") {
    input = await syntheticCompositorTimingInput();
    addSurfaceStateAtFrameTwo(input);
    useTwoAxisSurfacePositions(input);
    removeHistoryDependentChannels(input);
  } else if (id === "solitaire") {
    input = await syntheticAspectProfileTimelinesInput();
    const dynamic = await syntheticDynamicViewportProfilesInput();
    const responsive = dynamic.state.channels.find((channel) => channel.codec === "polycss-viewport-profiles-packed@0").data.packet.profiles.find((profile) => profile.responsiveAffine).responsiveAffine;
    const viewport = input.state.channels.find((channel) => channel.codec === "polycss-viewport-profiles-packed@0").data.packet;
    for (const profile of viewport.profiles) profile.responsiveAffine = structuredClone(responsive);
    const packet = input.state.channels.find((channel) => channel.codec === "polycss-playback-packed@0").data.packet;
    addSurfaceStateAtFrameThree(input);
    addPreparedBanks(packet);
    addTimelineDeadlines(packet);
    removeHistoryDependentChannels(input);
  } else {
    throw new Error(`Unknown stable cssGraphics browser contract ${id}.`);
  }
  if (!["menger", "solitaire"].includes(id)) removeHistoryDependentChannels(input);
  if (!["menger", "solitaire"].includes(id)) makePreparedSurfaceStructural(input);
  const cadence = id === "3dpipes" || id === "electropaint"
    ? [[50_000, 3], "single-step"]
    : id === "maze"
      ? [[20_000, 1], "single-step"]
      : id === "solitaire"
        ? [[125_000, 3], "elapsed"]
        : [[30_000, 1], id === "menger" ? "elapsed" : "single-step"];
  setPreparedCadence(input, cadence[0], cadence[1]);
  return input;
}

export async function syntheticAspectProfileTimelinesInput() {
  const input = await syntheticViewportProfilesInput();
  const profiles = [
    { id: "landscape", fit: "contain", quarterTurns: 0, bounds: [0, 0, 320, 240], safeInset: 0, bias: [0, 0] },
    { id: "phone", maxViewportWidth: 520, fit: "contain", quarterTurns: 1, bounds: [40, -40, 280, 280], safeInset: 8, bias: [0, -0.06] },
    { id: "portrait-720", maxViewportWidth: 720, fit: "contain", quarterTurns: 0, bounds: [0, 0, 320, 240], safeInset: 0, bias: [0, 0] },
    { id: "portrait-920", maxViewportWidth: 920, fit: "contain", quarterTurns: 0, bounds: [0, 0, 320, 240], safeInset: 0, bias: [0, 0] },
    { id: "portrait-wide", fit: "contain", quarterTurns: 0, bounds: [0, 0, 320, 240], safeInset: 0, bias: [0, 0] },
  ];
  const presentationState = input.state.channels.find((channel) => channel.codec === "static-presentation@0");
  const presentationBinding = input.bindings.channels.find((channel) => channel.interpreter === "static-presentation@0");
  presentationState.data.packet.camera.profileSelection = "landscape-first-portrait-width";
  presentationState.data.packet.camera.profiles = structuredClone(profiles);
  presentationBinding.parameters.profileSelection = "landscape-first-portrait-width";
  presentationBinding.parameters.profiles = structuredClone(profiles);
  const viewportProfiles = input.state.channels.find((channel) => channel.codec === "polycss-viewport-profiles-packed@0").data.packet;
  const mobile = viewportProfiles.profiles[0];
  const desktop = viewportProfiles.profiles[1];
  viewportProfiles.profiles = [
    { ...structuredClone(desktop), id: "landscape" },
    { ...structuredClone(mobile), id: "phone" },
    { ...structuredClone(desktop), id: "portrait-720" },
    { ...structuredClone(desktop), id: "portrait-920" },
    { ...structuredClone(desktop), id: "portrait-wide" },
  ];
  const playback = input.state.channels.find((channel) => channel.codec === "polycss-playback-packed@0").data.packet;
  playback.profileTimelines = [
    { profileId: "phone", introTicks: 0, loopTicks: 2, frames: [1, 3] },
  ];
  return input;
}

export function builtExternalResources(built) {
  return new Map(built.document.resources.resources.map((record) => [
    record.id,
    built.externalResources.get(record.path),
  ]));
}

export function largePagedDescriptorClosure(built, {
  frameCount = 64_000,
  pageCount = 500,
  transformAssignmentsPerFrame = 40,
  encodedByteLength = 1,
  decodedByteLength = encodedByteLength,
  materializedByteLength = 64,
} = {}) {
  const document = structuredClone(built.document);
  document.state.channels = document.state.channels.filter((channel) => !["polycss-effects-prepared@0", "polycss-pointer-grab-prepared@0", "polycss-surface-packed@0"].includes(channel.codec));
  document.bindings.channels = document.bindings.channels.filter((channel) => !["polycss-effects@0", "polycss-pointer-grab@0", "polycss-surface@0"].includes(channel.interpreter));
  const usedInputs = new Set(document.bindings.channels.flatMap((channel) => channel.inputs));
  document.bindings.inputs = document.bindings.inputs.filter((input) => usedInputs.has(input.id));
  document.meta.capabilities = document.meta.capabilities.filter((capability) => !["prepared-particle-effects", "prepared-pointer-grab-interaction", "prepared-surface-lighting"].includes(capability));
  document.meta.conformance.executable = document.meta.conformance.executable.filter((role) => !["particle-effects", "pointer-grab-interaction", "surface-lighting"].includes(role));
  delete document.meta.initialExperience;
  if (document.meta.counts) {
    document.meta.counts.sourceFrames = frameCount;
    document.meta.counts.leaves = 0;
  }

  const binding = document.bindings.channels.find((channel) => channel.interpreter === "polycss-paged-playback@0");
  const packet = document.state.channels.find((channel) => channel.codec === "polycss-paged-playback@0").data.packet;
  binding.parameters.frameCount = frameCount;
  binding.targets.leaves = [];
  packet.leafCount = 0;
  packet.timeline = { introTicks: 0, loopTicks: 1, frames: [1] };
  const templateRecord = document.resources.resources.find((record) => record.kind === "state-page" && record.codec === "polycss-paged-playback-page@0");
  const templateDescriptor = packet.pages[0];
  let startFrame = 1;
  packet.pages = Array.from({ length: pageCount }, (_, index) => {
    const remainingFrames = frameCount - startFrame + 1;
    const remainingPages = pageCount - index;
    const localFrames = Math.ceil(remainingFrames / remainingPages);
    const endFrame = startFrame + localFrames - 1;
    const resource = `playback-page-${String(index + 1).padStart(4, "0")}`;
    const descriptor = {
      ...templateDescriptor,
      resource,
      startFrame,
      endFrame,
      transformCount: localFrames * transformAssignmentsPerFrame,
      shapeChangeCount: 0,
      leafChangeCount: 0,
      materializedByteLength,
    };
    startFrame = endFrame + 1;
    return descriptor;
  });
  const digest = "0".repeat(64);
  document.resources.resources = [
    ...document.resources.resources.filter((record) => record.kind !== "state-page"),
    ...packet.pages.map((page) => ({
      ...templateRecord,
      id: page.resource,
      path: `state/${page.resource}.json`,
      byteLength: encodedByteLength,
      digest: { algorithm: "sha256", value: digest },
      encoding: "identity",
      decodedByteLength,
      decodedDigest: { algorithm: "sha256", value: digest },
    })),
  ].sort((left, right) => left.id.localeCompare(right.id));
  const eagerResources = builtExternalResources(built);
  for (const record of built.document.resources.resources) if (record.kind === "state-page") eagerResources.delete(record.id);
  return { document, bytes: encodeCanonicalJson(document), eagerResources };
}

function appendNode(input, {
  id,
  parent,
  sibling,
  name,
  classes = [],
  attributes = {},
  styles = {},
  resourceAttributes = {},
  resourceStyles = {},
}) {
  input.tree.nodes.push({
    index: input.tree.nodes.length,
    id,
    parent,
    sibling,
    namespace: "http://www.w3.org/1999/xhtml",
    name,
    classes,
    attributes,
    styles,
    resourceAttributes,
    resourceStyles,
  });
}

export async function syntheticInteractionInput() {
  const input = await syntheticInput();
  const packet = JSON.parse(await readFile(syntheticInteractionPacketPath, "utf8"));
  appendNode(input, { id: "synthetic/eye-shape", parent: 0, sibling: 1, name: "div" });
  appendNode(input, { id: "synthetic/eye-leaf", parent: 3, sibling: 0, name: "u", attributes: { "aria-hidden": "true" }, styles: { transform: "" } });
  appendNode(input, { id: "synthetic/cursor", parent: -1, sibling: 1, name: "div" });
  appendNode(input, { id: "synthetic/cursor:open", parent: 5, sibling: 0, name: "img", attributes: { "aria-hidden": "true" }, styles: { visibility: "hidden" } });
  appendNode(input, { id: "synthetic/cursor:closed", parent: 5, sibling: 1, name: "img", attributes: { "aria-hidden": "true" }, styles: { visibility: "hidden" } });
  input.state.channels.push({ id: "interaction", codec: "polycss-pointer-grab-prepared@0", data: { packet } });
  input.bindings.inputs.unshift(
    { id: "axis.x", type: "float", default: 0 },
    { id: "axis.y", type: "float", default: 0 },
    { id: "button.hold", type: "boolean", default: false },
    { id: "pointer.positioned", type: "boolean", default: false },
    { id: "pointer.pressed", type: "boolean", default: false },
    { id: "pointer.x", type: "float", default: 160 },
    { id: "pointer.y", type: "float", default: 120 },
  );
  input.bindings.channels.push({
    id: "interaction",
    state: "interaction",
    interpreter: "polycss-pointer-grab@0",
    status: "executable",
    inputs: ["axis.x", "axis.y", "button.hold", "pointer.positioned", "pointer.pressed", "pointer.x", "pointer.y"],
    targets: {
      shapes: ["synthetic/shape", "synthetic/eye-shape"],
      leaves: ["synthetic/leaf", "synthetic/eye-leaf"],
      cursorLayer: "synthetic/cursor",
      cursorStates: { open: "synthetic/cursor:open", closed: "synthetic/cursor:closed" },
    },
    sinks: ["style.transform", "style.visibility"],
    parameters: { initialFrame: 3, tickRateHz: 30 },
  });
  input.meta.capabilities.splice(4, 0, "prepared-pointer-grab-interaction");
  input.meta.conformance.executable.push("pointer-grab-interaction");
  return input;
}

export async function syntheticExecutableInteractionInput() {
  const input = await syntheticInteractionInput();
  const executable = await syntheticPolycssInput();
  const playback = structuredClone(executable.state.channels.find((channel) => channel.id === "playback"));
  const surface = structuredClone(executable.state.channels.find((channel) => channel.id === "surface"));
  const effects = structuredClone(executable.state.channels.find((channel) => channel.id === "effects"));
  const presentation = structuredClone(executable.state.channels.find((channel) => channel.id === "presentation"));

  appendNode(input, {
    id: "synthetic/camera",
    parent: -1,
    sibling: 2,
    name: "div",
    classes: ["camera"],
    attributes: { "aria-hidden": "true" },
    styles: {
      height: "240px",
      perspective: "400px",
      perspectiveOrigin: "160px 120px",
      position: "relative",
      width: "320px",
    },
  });
  appendNode(input, { id: "synthetic/effects", parent: -1, sibling: 3, name: "div", classes: ["effects"] });
  appendNode(input, {
    id: "synthetic/effects/particle:0",
    parent: input.tree.nodes.length - 1,
    sibling: 0,
    name: "s",
    classes: ["leaf"],
    attributes: { "aria-hidden": "true" },
    styles: {
      backgroundPosition: "0px 0px",
      height: "2px",
      opacity: "0",
      transform: "translate3d(0px, 0px, 0px)",
      visibility: "hidden",
      width: "2px",
    },
    resourceStyles: { backgroundImage: { resource: "checker", syntax: "url" } },
  });

  Object.assign(input.tree.mount.styles, {
    backgroundColor: "#000",
    backgroundPosition: "center",
    backgroundRepeat: "repeat",
    backgroundSize: "auto",
  });
  input.tree.mount.resourceStyles = {
    backgroundImage: { resource: "checker", syntax: "overlay-url", overlayOpacity: 0.25 },
  };
  input.tree.nodes.find((node) => node.id === "synthetic/scene").styles.transform = "translate3d(0px, 0px, 0px)";
  for (const id of ["synthetic/leaf", "synthetic/eye-leaf"]) {
    const node = input.tree.nodes.find((entry) => entry.id === id);
    node.styles.backgroundPositionY = "0";
    node.styles.visibility = "visible";
  }

  const playbackPacket = playback.data.packet;
  playbackPacket.shapeCount = 2;
  playbackPacket.leafCount = 2;
  playbackPacket.timeline = { introTicks: 0, loopTicks: 8, frames: [1, 2, 3, 4, 5, 6, 7, 8] };
  playbackPacket.initial.sourceFrame = 1;
  playbackPacket.initial.shapes = { count: 2, transforms: [1, 1], visibility: [1, 1] };
  playbackPacket.initial.leaves = { count: 2, transforms: [3, 1] };
  playbackPacket.frameRows = Array.from({ length: 8 }, (_, index) => [index + 1, 0, -1, 0, 0, 0, 0]);
  const emptyTransformGroup = () => ({
    encoding: "decimal-component-streams",
    empty: [0],
    scales: new Array(12).fill(0),
    columns: Array.from({ length: 12 }, () => []),
  });
  const fittedTransformGroup = () => ({
    encoding: "source-milli-fitted-leaf",
    empty: [],
    scales: new Array(12).fill(1000),
    columns: [[1000], [0], [0], [0], [1000], [0], [0], [0], [1000], [0], [0], [0]],
  });
  playbackPacket.transforms = {
    count: 5,
    groups: [emptyTransformGroup(), emptyTransformGroup(), emptyTransformGroup(), fittedTransformGroup(), fittedTransformGroup()],
  };
  playback.data.leafFit = [{ canonicalSize: 32 }, { canonicalSize: 32 }];

  const surfacePacket = surface.data.packet;
  surfacePacket.frameCount = 8;
  surfacePacket.surface.faces = [
    { faceId: "synthetic-face", sourceOrder: 0, stateOffset: 0, stateCount: 1, leafWidth: 32, leafHeight: 32 },
    { faceId: "synthetic-eye-face", sourceOrder: 1, stateOffset: 1, stateCount: 1, leafWidth: 32, leafHeight: 32 },
  ];
  surfacePacket.surface.statePacking = { stateCount: 2, sourceFrameDeltas: [0, 0] };
  surfacePacket.transitions.initialFrame = 1;
  surfacePacket.transitions.sequential = {
    offsetsBase64: base64Integers(new Array(9).fill(0), 4),
    faceIndexDeltas: [],
    stateIndexDeltas: [],
  };
  surfacePacket.transitions.nonInteractiveJumps = [];
  surfacePacket.visibility = {
    initialFrame: 1,
    initialVisibleBitsBase64: Buffer.from([3]).toString("base64"),
    sequential: { offsetsBase64: base64Integers(new Array(9).fill(0), 4), faceIndicesBase64: "" },
    nonInteractiveJumps: [],
  };

  effects.data.packet.frameCount = 8;
  effects.data.packet.emitters = [{ mode: "grab", poolSize: 1, backgroundPositions: ["0px 0px"] }];
  presentation.data.packet.camera.baseSceneTransform = "translate3d(0px, 0px, 0px)";
  input.state.channels.push(effects, playback, presentation, surface);
  input.state.channels.sort((left, right) => left.id.localeCompare(right.id));

  input.bindings.inputs.push(
    { id: "interaction.grab-active", type: "boolean", default: false },
    { id: "interaction.grab-x", type: "float", default: 0 },
    { id: "interaction.grab-y", type: "float", default: 0 },
    { id: "interaction.grab-z", type: "float", default: 0 },
    { id: "time.source-frame", type: "uint" },
    { id: "time.tick", type: "uint" },
    { id: "viewport.height", type: "float" },
    { id: "viewport.width", type: "float" },
  );
  input.bindings.inputs.sort((left, right) => left.id.localeCompare(right.id));
  input.bindings.channels.push(
    {
      id: "effects",
      state: "effects",
      interpreter: "polycss-effects@0",
      status: "executable",
      inputs: ["interaction.grab-active", "interaction.grab-x", "interaction.grab-y", "interaction.grab-z", "time.source-frame"],
      targets: { stars: [], emitters: [["synthetic/effects/particle:0"]] },
      sinks: ["style.backgroundPosition", "style.opacity", "style.transform", "style.visibility"],
      parameters: { frameCount: 8 },
    },
    {
      id: "playback",
      state: "playback",
      interpreter: "polycss-playback@0",
      status: "executable",
      inputs: ["time.tick"],
      targets: {
        model: "synthetic/scene",
        shapes: ["synthetic/shape", "synthetic/eye-shape"],
        leaves: ["synthetic/leaf", "synthetic/eye-leaf"],
      },
      sinks: ["style.transform", "style.visibility"],
      parameters: { baseSceneTransform: "translate3d(0px, 0px, 0px)", frameCount: 8, tickRateHz: 30 },
    },
    {
      id: "presentation",
      state: "presentation",
      interpreter: "static-presentation@0",
      status: "executable",
      inputs: ["viewport.height", "viewport.width"],
      targets: {
        host: "$host",
        camera: "synthetic/camera",
        cursorLayer: "synthetic/cursor",
        cursorStates: { open: "synthetic/cursor:open", closed: "synthetic/cursor:closed" },
      },
      sinks: ["style.height", "style.left", "style.top", "style.transform", "style.visibility", "style.width"],
      parameters: { fitHeight: 240, fitWidth: 320, sourceHeight: 240, sourceWidth: 320 },
    },
    {
      id: "surface",
      state: "surface",
      interpreter: "polycss-surface@0",
      status: "executable",
      inputs: ["time.source-frame"],
      targets: { leaves: ["synthetic/leaf", "synthetic/eye-leaf"] },
      sinks: ["style.backgroundPositionY", "style.visibility"],
    },
  );
  input.bindings.channels.sort((left, right) => left.id.localeCompare(right.id));
  input.meta.capabilities = [
    "css-semantic-closure",
    "deterministic-json",
    "explicit-retained-tree",
    "logical-assets",
    "prepared-particle-effects",
    "prepared-pointer-grab-interaction",
    "prepared-playback",
    "prepared-surface-lighting",
  ];
  input.meta.conformance.executable = [
    "retained-tree",
    "particle-effects",
    "playback",
    "pointer-grab-interaction",
    "presentation",
    "surface-lighting",
  ];
  input.meta.initialExperience = "interaction";
  input.meta.counts = { nodes: input.tree.nodes.length, shapes: 2, leaves: 2, sourceFrames: 8 };
  return input;
}

function base64Integers(values, width) {
  const bytes = new Uint8Array(values.length * width);
  for (let index = 0; index < values.length; index += 1) {
    for (let byte = 0; byte < width; byte += 1) bytes[index * width + byte] = Math.floor(values[index] / 2 ** (byte * 8)) & 255;
  }
  return Buffer.from(bytes).toString("base64");
}

function base64Float64(values) {
  const bytes = new Uint8Array(values.length * 8);
  const view = new DataView(bytes.buffer);
  for (let index = 0; index < values.length; index += 1) view.setFloat64(index * 8, values[index], true);
  return Buffer.from(bytes).toString("base64");
}

function cssNumber(value) {
  const rounded = Math.round(Math.fround(value) * 1e6) / 1e6;
  return String(Object.is(rounded, -0) ? 0 : rounded);
}

function canonicalPageTransform(transform) {
  if (transform === "") return null;
  const values = transform.slice(9, -1).split(",").map((value) => cssNumber(Number(value)));
  const canonical = `matrix3d(${values.join(",")})`;
  return canonical === "matrix3d(1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1)" ? null : canonical;
}

function packedBits(values) {
  const bytes = new Uint8Array(Math.ceil(values.length / 8));
  for (let index = 0; index < values.length; index += 1) bytes[index >> 3] |= values[index] << (index & 7);
  return Buffer.from(bytes).toString("base64");
}

function inlinePlaybackRows(input) {
  const packet = materializePolycssState(input.state).playback;
  if (!packet || packet.kind !== "inline") throw new Error("Synthetic paged playback requires inline prepared playback.");
  const transform = (index) => canonicalPageTransform(packet.transforms[index]) ?? "";
  const initial = {
    appearance: packet.initial.appearance,
    model: transform(packet.initial.modelTransform),
    shapes: new Array(packet.shapeCount),
    visibility: new Uint8Array(packet.shapeCount),
    leaves: new Array(packet.leafCount),
  };
  for (let offset = 0; offset < packet.initial.shapes.length; offset += 3) {
    initial.shapes[packet.initial.shapes[offset]] = transform(packet.initial.shapes[offset + 1]);
    initial.visibility[packet.initial.shapes[offset]] = packet.initial.shapes[offset + 2];
  }
  for (let offset = 0; offset < packet.initial.leaves.length; offset += 2) initial.leaves[packet.initial.leaves[offset]] = transform(packet.initial.leaves[offset + 1]);
  const rows = [initial];
  for (let frame = 2; frame <= packet.frameRows.length; frame += 1) {
    const prior = rows.at(-1);
    const row = packet.frameRows[frame - 1];
    const next = { appearance: row[1], model: row[2] === -1 ? prior.model : transform(row[2]), shapes: [...prior.shapes], visibility: prior.visibility.slice(), leaves: [...prior.leaves] };
    for (let index = 0; index < row[4]; index += 1) {
      const offset = (row[3] + index) * 3;
      const target = packet.shapeChanges[offset];
      next.shapes[target] = transform(packet.shapeChanges[offset + 1]);
      next.visibility[target] = packet.shapeChanges[offset + 2];
    }
    for (let index = 0; index < row[6]; index += 1) {
      const offset = (row[5] + index) * 2;
      next.leaves[packet.leafChanges[offset]] = transform(packet.leafChanges[offset + 1]);
    }
    rows.push(next);
  }
  return { packet, rows };
}

function pagedPlaybackPage(channel, packet, rows, startFrame, endFrame) {
  const transforms = [];
  const indexByOwnerValue = new Map();
  const reference = (owner, transform) => {
    const canonical = canonicalPageTransform(transform);
    const key = `${owner}\0${canonical ?? ""}`;
    if (indexByOwnerValue.has(key)) return indexByOwnerValue.get(key);
    const index = transforms.length;
    transforms.push(canonical);
    indexByOwnerValue.set(key, index);
    return index;
  };
  const keyframe = rows[startFrame - 1];
  const keyframeModel = reference("model", keyframe.model);
  const keyframeShapes = keyframe.shapes.map((transform) => reference("shape", transform));
  const keyframeLeaves = keyframe.leaves.map((transform, index) => reference(`leaf:${index}`, transform));
  const appearances = [];
  const modelTransforms = [];
  const shapeOffsets = [0];
  const shapeTargets = [];
  const shapeTransforms = [];
  const shapeVisibility = [];
  const leafOffsets = [0];
  const leafTargets = [];
  const leafTransforms = [];
  const appendDelta = (from, to) => {
    appearances.push(to.appearance);
    modelTransforms.push(from.model === to.model ? 0xffffffff : reference("model", to.model));
    for (let index = 0; index < to.shapes.length; index += 1) {
      if (from.shapes[index] === to.shapes[index] && from.visibility[index] === to.visibility[index]) continue;
      shapeTargets.push(index);
      shapeTransforms.push(reference("shape", to.shapes[index]));
      shapeVisibility.push(to.visibility[index]);
    }
    shapeOffsets.push(shapeTargets.length);
    for (let index = 0; index < to.leaves.length; index += 1) {
      if (from.leaves[index] === to.leaves[index]) continue;
      leafTargets.push(index);
      leafTransforms.push(reference(`leaf:${index}`, to.leaves[index]));
    }
    leafOffsets.push(leafTargets.length);
  };
  appendDelta(rows[(startFrame + rows.length - 2) % rows.length], keyframe);
  for (let frame = startFrame + 1; frame <= endFrame; frame += 1) appendDelta(rows[frame - 2], rows[frame - 1]);
  const payload = {
    version: 0,
    codec: "polycss-paged-playback-page@0",
    channel,
    startFrame,
    endFrame,
    transforms,
    keyframe: {
      appearance: keyframe.appearance,
      modelTransform: keyframeModel,
      shapeTransformIndicesBase64: base64Integers(keyframeShapes, 4),
      shapeVisibilityBitsBase64: packedBits(keyframe.visibility),
      leafTransformIndicesBase64: base64Integers(keyframeLeaves, 4),
    },
    sequential: {
      appearanceIndicesBase64: base64Integers(appearances, 2),
      modelTransformIndicesBase64: base64Integers(modelTransforms, 4),
      shapeOffsetsBase64: base64Integers(shapeOffsets, 4),
      shapeTargetIndicesBase64: base64Integers(shapeTargets, 4),
      shapeTransformIndicesBase64: base64Integers(shapeTransforms, 4),
      shapeVisibilityBase64: base64Integers(shapeVisibility, 1),
      leafOffsetsBase64: base64Integers(leafOffsets, 4),
      leafTargetIndicesBase64: base64Integers(leafTargets, 4),
      leafTransformIndicesBase64: base64Integers(leafTransforms, 4),
    },
  };
  const materializedByteLength = transforms.reduce((total, transform) => total + 8 + (transform?.length ?? 0) * 2, 0)
    + keyframeShapes.length * 4 + keyframe.visibility.length + keyframeLeaves.length * 4
    + appearances.length * 2 + modelTransforms.length * 4
    + shapeOffsets.length * 4 + shapeTargets.length * 9
    + leafOffsets.length * 4 + leafTargets.length * 8;
  return { payload, descriptor: { startFrame, endFrame, transformCount: transforms.length, shapeChangeCount: shapeTargets.length, leafChangeCount: leafTargets.length, materializedByteLength } };
}

export async function syntheticTwoFramePolycssInput() {
  const input = await syntheticPolycssInput();
  const playbackBinding = input.bindings.channels.find((channel) => channel.interpreter === "polycss-playback@0");
  const playback = input.state.channels.find((channel) => channel.codec === "polycss-playback-packed@0").data.packet;
  playbackBinding.parameters.frameCount = 2;
  playback.timeline.loopTicks = 2;
  playback.timeline.frames = [1, 2];
  playback.frameRows.push([2, 0, -1, 0, 0, 0, 0]);

  const surface = input.state.channels.find((channel) => channel.codec === "polycss-surface-packed@0").data.packet;
  surface.frameCount = 2;
  surface.surface.faces[0].stateCount = 2;
  surface.surface.statePacking.stateCount = 2;
  surface.surface.statePacking.sourceFrameDeltas = [0, 1];
  surface.transitions.sequential.offsetsBase64 = base64Integers([0, 1, 2], 4);
  surface.transitions.sequential.faceIndexDeltas = [0, 0];
  surface.transitions.sequential.stateIndexDeltas = [0, 1];
  surface.visibility.sequential.offsetsBase64 = base64Integers([0, 0, 0], 4);

  const effectsBinding = input.bindings.channels.find((channel) => channel.interpreter === "polycss-effects@0");
  const effects = input.state.channels.find((channel) => channel.codec === "polycss-effects-prepared@0").data.packet;
  effectsBinding.parameters.frameCount = 2;
  effects.frameCount = 2;
  if (input.meta.counts) input.meta.counts.sourceFrames = 2;
  return input;
}

export async function syntheticExactTimingInput({
  catchUpPolicy = "single-step",
  tickIntervalUs = [30_000, 1],
  deadlineMicros,
} = {}) {
  const input = await syntheticTwoFramePolycssInput();
  const playbackBinding = input.bindings.channels.find((channel) => channel.interpreter === "polycss-playback@0");
  const playback = input.state.channels.find((channel) => channel.codec === "polycss-playback-packed@0").data.packet;
  delete playbackBinding.parameters.tickRateHz;
  playbackBinding.parameters.tickIntervalUs = tickIntervalUs;
  playbackBinding.parameters.catchUpPolicy = catchUpPolicy;
  if (deadlineMicros) playback.timeline.deadlineMicros = deadlineMicros;
  if (catchUpPolicy === "elapsed") {
    input.state.channels = input.state.channels.filter((channel) => channel.codec !== "polycss-effects-prepared@0");
    input.bindings.channels = input.bindings.channels.filter((channel) => channel.interpreter !== "polycss-effects@0");
    input.bindings.inputs = input.bindings.inputs.filter((definition) => !definition.id.startsWith("interaction.grab-"));
    input.meta.capabilities = input.meta.capabilities.filter((capability) => capability !== "prepared-particle-effects");
    input.meta.conformance.executable = input.meta.conformance.executable.filter((role) => role !== "particle-effects");
  }
  return input;
}

export async function syntheticAdapterTechniquesInput() {
  const input = await syntheticTwoFramePolycssInput();
  const leaf = input.tree.nodes.find((node) => node.id === "synthetic-polycss/leaf");
  leaf.classes.push("material-a");
  delete leaf.styles.backgroundPositionY;
  leaf.styles.backgroundPosition = "0 0";
  leaf.styles.visibility = "hidden";

  const surface = input.state.channels.find((channel) => channel.codec === "polycss-surface-packed@0").data.packet;
  surface.surface.statePacking.positionDictionary = [[-16, -16], [0, 0]];
  surface.surface.statePacking.positionIndicesBase64 = base64Integers([1, 0], 2);
  surface.transitions.sequential = {
    offsetsBase64: base64Integers([0, 0, 1], 4),
    faceIndexDeltas: [0],
    stateIndexDeltas: [1],
  };
  surface.visibility.initialVisibleBitsBase64 = Buffer.from([0]).toString("base64");
  surface.visibility.sequential = {
    offsetsBase64: base64Integers([0, 1, 2], 4),
    faceIndicesBase64: base64Integers([0, 0], 2),
  };
  const surfaceBinding = input.bindings.channels.find((channel) => channel.interpreter === "polycss-surface@0");
  surfaceBinding.sinks = ["style.backgroundPosition", "style.visibility"];

  input.state.channels.push({
    id: "variants",
    codec: "polycss-variants-packed@0",
    data: {
      packet: {
        version: 0,
        frameCount: 2,
        classes: ["material-a", "material-b"],
        effects: [
          { classIndex: 0, ownerIndex: 0, targetIndex: 65535, styles: { color: "#f00" } },
          { classIndex: 1, ownerIndex: 0, targetIndex: 65535, styles: { color: "#0f0" } },
        ],
        initial: { frame: 1, classIndicesBase64: base64Integers([0], 2) },
        sequential: {
          offsetsBase64: base64Integers([0, 1, 2], 4),
          targetIndicesBase64: base64Integers([0, 0], 2),
          classIndicesBase64: base64Integers([0, 1], 2),
        },
        nonInteractiveJumps: [],
      },
    },
  });
  input.bindings.channels.push({
    id: "variants",
    state: "variants",
    interpreter: "polycss-variants@0",
    status: "executable",
    inputs: ["time.source-frame"],
    targets: { effectNodes: [], nodes: ["synthetic-polycss/leaf"] },
    sinks: ["class.prepared", "style.color"],
  });
  input.meta.capabilities.push("prepared-variants");
  input.meta.conformance.executable.push("variants");

  return input;
}

export async function syntheticPagedVariantsInput(encoding = "identity", ranges = [[1, 2], [3, 4], [5, 6], [7, 8]]) {
  const input = await syntheticExecutableInteractionInput();
  const leaf = input.tree.nodes.find((node) => node.id === "synthetic/leaf");
  leaf.classes.push("material-a");
  const pages = ranges.map(([startFrame, endFrame], index) => {
    const frameCount = endFrame - startFrame + 1;
    const transitionCount = frameCount - 1;
    const payload = {
      version: 0,
      codec: "polycss-paged-variants-page@0",
      channel: "paged-variants",
      startFrame,
      endFrame,
      keyframeClassIndicesBase64: base64Integers([(startFrame - 1) % 2], 2),
      sequential: {
        offsetsBase64: base64Integers([0, 0, ...Array.from({ length: transitionCount }, (_, transition) => transition + 1)], 4),
        targetIndicesBase64: base64Integers(new Array(transitionCount).fill(0), 2),
        classIndicesBase64: base64Integers(Array.from({ length: transitionCount }, (_, transition) => (startFrame + transition) % 2), 2),
      },
    };
    const id = `variant-page-${index + 1}`;
    input.resourceInputs.push({
      id,
      kind: "state-page",
      mediaType: "application/vnd.layoutit.domformat-state-page+json",
      path: `state/${id}.json${encoding === "gzip" ? ".gz" : ""}`,
      bytes: encodeCanonicalJson(payload),
      encoding,
      codec: "polycss-paged-variants-page@0",
    });
    return {
      resource: id,
      startFrame,
      endFrame,
      changeCount: transitionCount,
      materializedByteLength: 2 + 4 * (frameCount + 1) + 4 * transitionCount,
    };
  });
  input.state.channels.push({
    id: "paged-variants",
    codec: "polycss-paged-variants@0",
    data: {
      packet: {
        version: 0,
        frameCount: 8,
        classes: ["material-a", "material-b"],
        effects: [
          { classIndex: 0, ownerIndex: 0, targetIndex: 65535, styles: { color: "#f00" } },
          { classIndex: 1, ownerIndex: 0, targetIndex: 65535, styles: { color: "#0f0" } },
        ],
        initial: { frame: 1, classIndicesBase64: base64Integers([0], 2) },
        pages,
        lookaheadPages: 1,
        maxResidentPages: 5,
      },
    },
  });
  input.state.channels.sort((left, right) => left.id.localeCompare(right.id));
  input.bindings.channels.push({
    id: "paged-variants",
    state: "paged-variants",
    interpreter: "polycss-paged-variants@0",
    status: "executable",
    inputs: ["time.source-frame"],
    targets: { effectNodes: [], nodes: [leaf.id] },
    sinks: ["class.prepared", "style.color"],
  });
  input.bindings.channels.sort((left, right) => left.id.localeCompare(right.id));
  input.meta.capabilities.splice(5, 0, "prepared-paged-state", "prepared-variants");
  input.meta.conformance.executable.splice(2, 0, "paged-variants");
  return input;
}

export async function syntheticPagedPlaybackInput({ encoding = "identity", variants = false, ranges = [[1, 2], [3, 4], [5, 6], [7, 8]], variantRanges = ranges, mutate = () => {} } = {}) {
  const input = variants ? await syntheticPagedVariantsInput(encoding, variantRanges) : await syntheticExecutableInteractionInput();
  mutate(input);
  const { packet, rows } = inlinePlaybackRows(input);
  const state = input.state.channels.find((channel) => channel.codec === "polycss-playback-packed@0");
  const binding = input.bindings.channels.find((channel) => channel.interpreter === "polycss-playback@0");
  const initial = rows[packet.initial.sourceFrame - 1];
  const nodeById = new Map(input.tree.nodes.map((node) => [node.id, node]));
  nodeById.get(binding.targets.model).styles.transform = initial.model === "" ? binding.parameters.baseSceneTransform : `${binding.parameters.baseSceneTransform} ${initial.model}`;
  for (let index = 0; index < binding.targets.shapes.length; index += 1) {
    const node = nodeById.get(binding.targets.shapes[index]);
    node.styles.transform = initial.shapes[index];
    node.styles.visibility = initial.visibility[index] === 1 ? "visible" : "hidden";
  }
  for (let index = 0; index < binding.targets.leaves.length; index += 1) nodeById.get(binding.targets.leaves[index]).styles.transform = initial.leaves[index];
  const pageEntries = ranges.map(([startFrame, endFrame], index) => {
    const { payload, descriptor } = pagedPlaybackPage(state.id, packet, rows, startFrame, endFrame);
    const id = `playback-page-${index + 1}`;
    input.resourceInputs.push({
      id,
      kind: "state-page",
      mediaType: "application/vnd.layoutit.domformat-state-page+json",
      path: `state/${id}.json${encoding === "gzip" ? ".gz" : ""}`,
      bytes: encodeCanonicalJson(payload),
      encoding,
      codec: "polycss-paged-playback-page@0",
    });
    return { resource: id, ...descriptor };
  });
  state.codec = "polycss-paged-playback@0";
  state.data = { packet: {
    version: 0,
    shapeCount: packet.shapeCount,
    leafCount: packet.leafCount,
    appearances: packet.appearances,
    timeline: packet.timeline,
    ...(packet.profileTimelines === undefined ? {} : { profileTimelines: packet.profileTimelines }),
    ...(packet.initialBankId === undefined ? {} : { initialBankId: packet.initialBankId, banks: packet.banks }),
    initial: { sourceFrame: packet.initial.sourceFrame, appearance: packet.initial.appearance },
    pages: pageEntries,
    lookaheadPages: 1,
    maxResidentPages: variants ? 10 : 5,
  } };
  binding.interpreter = "polycss-paged-playback@0";
  input.meta.capabilities = [
    "css-semantic-closure",
    "deterministic-json",
    "explicit-retained-tree",
    "logical-assets",
    "prepared-particle-effects",
    "prepared-paged-state",
    "prepared-playback",
    ...(variants ? ["prepared-variants"] : []),
    "prepared-pointer-grab-interaction",
    "prepared-surface-lighting",
  ];
  input.meta.conformance.executable[input.meta.conformance.executable.indexOf("playback")] = "paged-playback";
  if (variants) input.state.channels.find((channel) => channel.codec === "polycss-paged-variants@0").data.packet.maxResidentPages = 10;
  return input;
}

export async function syntheticPagedPreparedBanksInput({ variants = true, ranges, variantRanges } = {}) {
  const input = await syntheticPagedPlaybackInput({ variants, ...(ranges === undefined ? {} : { ranges }), ...(variantRanges === undefined ? {} : { variantRanges }), mutate(input) {
    addPreparedBanks(input.state.channels.find((channel) => channel.codec === "polycss-playback-packed@0").data.packet);
  } });
  const playback = input.state.channels.find((channel) => channel.codec === "polycss-paged-playback@0").data.packet;
  playback.maxResidentPages = 12;
  const pagedVariants = input.state.channels.find((channel) => channel.codec === "polycss-paged-variants@0");
  if (pagedVariants) pagedVariants.data.packet.maxResidentPages = 12;
  return input;
}

export function syntheticPagedPlaybackChangesInput({ variants = true } = {}) {
  return syntheticPagedPlaybackInput({ variants, mutate(input) {
    const playback = input.state.channels.find((channel) => channel.codec === "polycss-playback-packed@0").data.packet;
    playback.transforms.count = 7;
    playback.transforms.groups[1].empty = [0];
    playback.transforms.groups[1].columns = [1, 0, 0, 0, 1, 0, 0, 0, 1, 10, 0, 0].map((value) => [value]);
    playback.transforms.groups[3].columns.forEach((column, component) => column.push(component === 9 ? 20 : column[0]));
    playback.shapeChanges = { sources: [0, 0], transforms: [1, 4], visibility: [1, 0] };
    playback.frameRows[0][3] = 0;
    playback.frameRows[0][4] = 1;
    playback.frameRows[3][3] = 1;
    playback.frameRows[3][4] = 1;
    playback.leafChanges = { sources: [0, 0], transforms: [3, 3] };
    playback.frameRows[0][5] = 0;
    playback.frameRows[0][6] = 1;
    playback.frameRows[4][5] = 1;
    playback.frameRows[4][6] = 1;
  } });
}

export function syntheticEvictingPagedVariantsInput(encoding = "identity") {
  return syntheticPagedVariantsInput(encoding, [[1, 2], [3, 3], [4, 4], [5, 5], [6, 6], [7, 8]]);
}

export async function syntheticPagedProfileTimelinesInput() {
  const input = await syntheticPagedVariantsInput("identity", Array.from({ length: 8 }, (_, index) => [index + 1, index + 1]));
  const profiles = [
    { id: "mobile", maxViewportWidth: 600, fit: "contain", quarterTurns: 0, bounds: [0, 0, 320, 240], safeInset: 0, bias: [0, 0] },
    { id: "desktop", fit: "contain", quarterTurns: 0, bounds: [0, 0, 320, 240], safeInset: 0, bias: [0, 0] },
  ];
  const presentationState = input.state.channels.find((channel) => channel.codec === "static-presentation@0");
  const presentationBinding = input.bindings.channels.find((channel) => channel.interpreter === "static-presentation@0");
  presentationState.data.packet.camera.profileSelection = "viewport-width";
  presentationState.data.packet.camera.profiles = structuredClone(profiles);
  presentationBinding.parameters.profileSelection = "viewport-width";
  presentationBinding.parameters.profiles = structuredClone(profiles);
  input.state.channels.find((channel) => channel.codec === "polycss-playback-packed@0").data.packet.profileTimelines = [
    { profileId: "mobile", introTicks: 0, loopTicks: 2, frames: [1, 3] },
  ];
  return input;
}

export async function syntheticPagedProfileTimelinesWithoutInteractionInput() {
  const input = await syntheticPagedProfileTimelinesInput();
  const interactionBinding = input.bindings.channels.find((channel) => channel.id === "interaction");
  const interactionInputs = new Set(interactionBinding.inputs);
  input.state.channels = input.state.channels.filter((channel) => channel.id !== "interaction");
  input.bindings.channels = input.bindings.channels.filter((channel) => channel.id !== "interaction");
  input.bindings.inputs = input.bindings.inputs.filter((definition) => !interactionInputs.has(definition.id));
  input.meta.capabilities = input.meta.capabilities.filter((capability) => capability !== "prepared-pointer-grab-interaction");
  input.meta.conformance.executable = input.meta.conformance.executable.filter((role) => role !== "pointer-grab-interaction");
  input.meta.initialExperience = "animation";
  input.state.channels.find((channel) => channel.codec === "polycss-paged-variants@0").data.packet.maxResidentPages = 4;
  return input;
}

export async function syntheticPagedAspectProfileTimelinesWithoutInteractionInput() {
  const input = await syntheticPagedProfileTimelinesWithoutInteractionInput();
  const profiles = [
    { id: "landscape", fit: "contain", quarterTurns: 0, bounds: [0, 0, 320, 240], safeInset: 0, bias: [0, 0] },
    { id: "phone", maxViewportWidth: 520, fit: "contain", quarterTurns: 0, bounds: [0, 0, 320, 240], safeInset: 0, bias: [0, 0] },
    { id: "portrait-wide", fit: "contain", quarterTurns: 0, bounds: [0, 0, 320, 240], safeInset: 0, bias: [0, 0] },
  ];
  const presentationState = input.state.channels.find((channel) => channel.codec === "static-presentation@0");
  const presentationBinding = input.bindings.channels.find((channel) => channel.interpreter === "static-presentation@0");
  presentationState.data.packet.camera.profileSelection = "landscape-first-portrait-width";
  presentationState.data.packet.camera.profiles = structuredClone(profiles);
  presentationBinding.parameters.profileSelection = "landscape-first-portrait-width";
  presentationBinding.parameters.profiles = structuredClone(profiles);
  input.state.channels.find((channel) => channel.codec === "polycss-playback-packed@0").data.packet.profileTimelines = [
    { profileId: "phone", introTicks: 0, loopTicks: 2, frames: [1, 3] },
  ];
  return input;
}

export async function syntheticCompositorTimingInput() {
  const input = await syntheticExecutableInteractionInput();
  const playback = input.state.channels.find((channel) => channel.codec === "polycss-playback-packed@0").data.packet;
  const leafZeroGroup = playback.transforms.groups[3];
  leafZeroGroup.columns = leafZeroGroup.columns.map((column, index) => index === 9 ? [0, 10000, 0] : [column[0], column[0], column[0]]);
  playback.transforms.count = 7;
  playback.leafChanges = { sources: [0, 0], transforms: [5, 1] };
  playback.frameRows[1][5] = 0;
  playback.frameRows[1][6] = 1;
  playback.frameRows[2][5] = 1;
  playback.frameRows[2][6] = 1;
  for (let index = 3; index < playback.frameRows.length; index += 1) playback.frameRows[index][5] = 2;
  input.state.channels.push({
    id: "compositor-timing",
    codec: "polycss-compositor-timing-prepared@0",
    data: {
      packet: {
        version: 0,
        timing: "linear",
        targets: [
          {
            kind: "cycle",
            owner: "model",
            index: 0,
            durationTicks: 8,
            iterations: "infinite",
            closure: "closed",
            keyframes: [
              { tick: 0, transformIndex: 0 },
              { tick: 4, transformIndex: 3 },
              { tick: 8, transformIndex: 0 },
            ],
          },
          { kind: "transition", owner: "leaf", index: 0, durationTicks: 1 },
        ],
      },
    },
  });
  input.state.channels.sort((left, right) => left.id.localeCompare(right.id));
  input.bindings.channels.push({
    id: "compositor-timing",
    state: "compositor-timing",
    interpreter: "polycss-compositor-timing@0",
    status: "executable",
    inputs: ["time.source-frame", "time.tick"],
    targets: { nodes: ["synthetic/scene", "synthetic/leaf"] },
    sinks: ["style.transform"],
    parameters: { frameCount: 8, tickRateHz: 30 },
  });
  input.bindings.channels.sort((left, right) => left.id.localeCompare(right.id));
  input.meta.capabilities.splice(5, 0, "prepared-compositor-timing");
  input.meta.conformance.executable.splice(2, 0, "compositor-timing");
  return input;
}

export async function syntheticHiddenPlaybackInput() {
  const input = await syntheticExecutableInteractionInput();
  const playback = input.state.channels.find((channel) => channel.codec === "polycss-playback-packed@0").data.packet;
  playback.leafChanges = { sources: [0, 0, 0], transforms: [3, 2, 1] };
  const leafOffsets = [0, 1, 2, 3, 3, 3, 3, 3];
  for (let frame = 0; frame < playback.frameRows.length; frame += 1) {
    playback.frameRows[frame][5] = leafOffsets[frame];
    playback.frameRows[frame][6] = frame <= 2 ? 1 : 0;
  }
  playback.transforms.count = 7;
  const leafGroup = playback.transforms.groups[3];
  leafGroup.columns = leafGroup.columns.map((column, index) => {
    if (index === 0 || index === 4 || index === 8) return [column[0], 0, 0];
    if (index === 9) return [column[0], 1000, 1000];
    return [column[0], 0, 0];
  });

  const surface = input.state.channels.find((channel) => channel.codec === "polycss-surface-packed@0").data.packet;
  surface.visibility.initialVisibleBitsBase64 = Buffer.from([2]).toString("base64");
  surface.visibility.sequential = {
    offsetsBase64: base64Integers([0, 1, 1, 1, 2, 2, 2, 2, 2], 4),
    faceIndicesBase64: base64Integers([0, 0], 2),
  };
  surface.transitions.sequential = {
    offsetsBase64: base64Integers([0, 0, 0, 0, 1, 1, 1, 1, 1], 4),
    faceIndexDeltas: [0],
    stateIndexDeltas: [0],
  };
  input.tree.nodes.find((node) => node.id === "synthetic/leaf").styles.visibility = "hidden";
  return input;
}

export function errorCode(code) {
  return (error) => error?.code === code;
}
