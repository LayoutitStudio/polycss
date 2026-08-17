import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync, gunzipSync } from "node:zlib";
import { decodeJson, encodeCanonicalJson } from "../src/canonical-json.js";
import { readDom, readDomFile } from "../src/reader.js";
import { buildDom } from "../src/writer.js";
import { NVersionError } from "../conformance/nversion/errors.js";
import { readDomNVersion } from "../conformance/nversion/reader.js";
import { validateStylesheet } from "../conformance/nversion/resources.js";
import {
  builtExternalResources,
  errorCode,
  largePagedDescriptorClosure,
  syntheticAdapterTechniquesInput,
  syntheticAspectProfileTimelinesInput,
  syntheticCompositorTimingInput,
  syntheticCssGraphicsDemoInput,
  syntheticDynamicViewportProfilesInput,
  syntheticEmptySurfaceInput,
  syntheticExecutableInteractionInput,
  syntheticExactTimingInput,
  syntheticInput,
  syntheticOrbitInput,
  syntheticPagedPlaybackChangesInput,
  syntheticPagedPlaybackInput,
  syntheticPagedVariantsInput,
  syntheticPagedProfileTimelinesInput,
  syntheticPagedProfileTimelinesWithoutInteractionInput,
  syntheticPlaybackWithoutSurfaceInput,
  syntheticPolycssInput,
  syntheticProfileTimelinesInput,
  syntheticPreparedBanksInput,
  syntheticPagedPreparedBanksInput,
  syntheticResponsivePresentationInput,
  syntheticStaticPresentationInput,
  syntheticTwoFramePolycssInput,
  syntheticViewportProfilesInput,
} from "./helpers.js";
import { CSSGRAPHICS_OUT_OF_SCOPE_ADAPTERS, CSSGRAPHICS_REVISION, STABLE_CSSGRAPHICS_BROWSER_CONTRACTS } from "./cssgraphics-contracts.js";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const producer = resolve(root, "conformance/producer.py");
const pythonReader = resolve(root, "conformance/reader.py");
const corpus = resolve(root, "conformance/corpus");
const N_VERSION_FILES = Object.freeze([
  "conformance/nversion/errors.js",
  "conformance/nversion/json.js",
  "conformance/nversion/resources.js",
  "conformance/nversion/schema.js",
  "conformance/nversion/reader.js",
]);

function runPython(args) {
  return spawnSync("python3", ["-B", ...args], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 4 * 1024 * 1024,
  });
}

function packedIntegers(values, width) {
  const bytes = new Uint8Array(values.length * width);
  for (let index = 0; index < values.length; index += 1) {
    for (let byte = 0; byte < width; byte += 1) bytes[index * width + byte] = Math.floor(values[index] / 2 ** (byte * 8)) & 255;
  }
  return Buffer.from(bytes).toString("base64");
}

function replaceStatePage(document, resources, pageId, mutate) {
  const page = decodeJson(resources.get(pageId), `State page ${pageId}`);
  const descriptor = document.state.channels
    .find((channel) => channel.codec === "polycss-paged-playback@0")
    .data.packet.pages.find((entry) => entry.resource === pageId);
  mutate(page, descriptor);
  const changed = encodeCanonicalJson(page);
  resources.set(pageId, changed);
  const record = document.resources.resources.find((entry) => entry.id === pageId);
  record.byteLength = changed.length;
  record.decodedByteLength = changed.length;
  record.digest.value = createHash("sha256").update(changed).digest("hex");
  record.decodedDigest.value = record.digest.value;
}

function mutateCorpus(source, operation) {
  if (operation === "none") return source.slice();
  if (operation === "gzip-transport") return Uint8Array.of(0x1f, 0x8b, 0x08, 0x00);
  if (operation === "malformed-utf8") return Uint8Array.of(0xff);
  if (operation === "byte-order-mark") return Uint8Array.from([0xef, 0xbb, 0xbf, ...source]);
  if (operation === "malformed-json") return new TextEncoder().encode('{"meta":');
  const text = new TextDecoder().decode(source);
  if (operation === "duplicate-key") return new TextEncoder().encode('{"meta":null,' + text.slice(1));
  if (operation === "negative-zero") return new TextEncoder().encode(text.replace('"version":0', '"version":-0'));
  const document = decodeJson(source, "N-version corpus");
  if (operation === "unknown-top-level") document.privateAdapter = true;
  else if (operation === "unsupported-format") document.meta.format = "domformat@99";
  else if (operation === "unsupported-profile") document.meta.profile = "polycss-3d@99";
  else if (operation === "unknown-required-capability") document.meta.capabilities.push("future-required");
  else if (operation === "invalid-initial-experience") document.meta.initialExperience = "webpage-replay";
  else if (operation === "embedded-payload") document.payloads = {};
  else if (operation === "embedded-storage") {
    delete document.resources.resources[0].path;
    document.resources.resources[0].storage = { mode: "embedded", encoding: "base64" };
  } else if (operation === "unsafe-resource-path") document.resources.resources[0].path = "../private.png";
  else if (operation === "duplicate-resource-path") document.resources.resources[1].path = document.resources.resources[0].path;
  else if (operation === "casefold-resource-path") document.resources.resources[1].path = document.resources.resources[0].path.toUpperCase();
  else if (operation === "resource-path-prefix") document.resources.resources[1].path = `${document.resources.resources[0].path}/model.css`;
  else if (operation === "reserved-resource-path") document.resources.resources[0].path = "assets/CON.png";
  else if (operation === "trailing-dot-resource-path") document.resources.resources[0].path = "assets/checker.";
  else if (operation === "missing-aria-hidden") delete document.tree.nodes.find((node) => !document.tree.nodes.some((candidate) => candidate.parent === node.index)).attributes["aria-hidden"];
  else if (operation === "noncanonical-base64") {
    const surface = document.state.channels.find((channel) => channel.codec === "polycss-surface-packed@0");
    assert.equal(surface.data.packet.visibility.initialVisibleBitsBase64, "Aw==");
    surface.data.packet.visibility.initialVisibleBitsBase64 = "Ax==";
  }
  else if (operation === "missing-resource" || operation === "resource-digest") return source.slice();
  else throw new Error(`Unknown corpus mutation ${operation}.`);
  return encodeCanonicalJson(document);
}

async function produce(directory, options = []) {
  await mkdir(directory, { recursive: true });
  const model = join(directory, "model.json");
  const run = runPython([producer, model, ...options]);
  assert.equal(run.status, 0, `${run.stdout}\n${run.stderr}`);
  return { model, directory, bytes: await readFile(model), summary: JSON.parse(run.stdout) };
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function crc32(bytes) {
  let value = 0xffffffff;
  for (const byte of bytes) {
    value ^= byte;
    for (let bit = 0; bit < 8; bit += 1) value = value >>> 1 ^ (value & 1 ? 0xedb88320 : 0);
  }
  return (value ^ 0xffffffff) >>> 0;
}

test("N-version browser probe has a mechanically closed production boundary", async () => {
  for (const file of N_VERSION_FILES) {
    const source = await readFile(resolve(root, file), "utf8");
    assert.doesNotMatch(source, /(?:^|["'])\.\.\/\.\.\/src\//mu, file);
    assert.doesNotMatch(source, /(?:^|["'])\.\.\/src\//mu, file);
    assert.doesNotMatch(source, /conformance\/viewer|viewer\/mount/u, file);
    assert.doesNotMatch(source, /\b(?:eval|Function|WebAssembly)\s*\(/u, file);
    assert.doesNotMatch(source, /innerHTML|insertAdjacentHTML|document\.write/u, file);
  }
});

async function assertIndependentReadersAccept(input, prefix) {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  try {
    const built = buildDom(input);
    const externalResources = builtExternalResources(built);
    assert.doesNotThrow(() => readDom(built.bytes, { externalResources, requireResources: true }));
    const nversion = await readDomNVersion(built.bytes, { externalResources });
    for (const record of built.document.resources.resources) {
      if (record.kind === "state-page") await assert.doesNotReject(nversion.loadStatePage(record));
    }
    const model = join(directory, "model.json");
    await writeFile(model, built.bytes);
    for (const record of built.document.resources.resources) {
      const target = join(directory, record.path);
      await mkdir(resolve(target, ".."), { recursive: true });
      await writeFile(target, built.externalResources.get(record.path));
    }
    const python = runPython([pythonReader, "validate", model]);
    assert.equal(python.status, 0, `${python.stdout}\n${python.stderr}`);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function assertIndependentReadersReject(input, prefix, mutateDocument, expectedCode) {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  try {
    const built = buildDom(input);
    const document = structuredClone(built.document);
    mutateDocument(document);
    const bytes = encodeCanonicalJson(document);
    const externalResources = builtExternalResources(built);
    assert.throws(() => readDom(bytes, { externalResources, requireResources: true }), expectedCode ? (error) => error?.code === expectedCode : undefined, `${prefix} production`);
    await assert.rejects(readDomNVersion(bytes, { externalResources }), expectedCode ? (error) => error instanceof NVersionError && error.code === expectedCode : NVersionError, `${prefix} N-version`);
    const model = join(directory, "model.json");
    await writeFile(model, bytes);
    for (const record of document.resources.resources) {
      const target = join(directory, record.path);
      await mkdir(resolve(target, ".."), { recursive: true });
      await writeFile(target, externalResources.get(record.id));
    }
    const python = runPython([pythonReader, "validate", model]);
    assert.equal(python.status, 1, `${prefix} Python: ${python.stdout}\n${python.stderr}`);
    if (expectedCode) assert.match(`${python.stdout}\n${python.stderr}`, new RegExp(`: ${expectedCode}:`, "u"), `${prefix} Python error code`);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test("all readers distinguish an unclosed compositor cycle from sink ownership", async () => {
  await assertIndependentReadersReject(await syntheticCompositorTimingInput(), "domformat-compositor-open-cycle-", (document) => {
    const cycle = document.state.channels.find((channel) => channel.codec === "polycss-compositor-timing-prepared@0").data.packet.targets.find((target) => target.kind === "cycle");
    cycle.keyframes.at(-1).transformIndex = 1;
  }, "INVALID_COMPOSITOR_TIMING_STATE");
});

test("production, N-version, and Python readers accept reduced executable closures", async () => {
  for (const [name, createInput] of [
    ["empty surface", syntheticEmptySurfaceInput],
    ["leafless playback without surface", syntheticPlaybackWithoutSurfaceInput],
    ["static presentation", syntheticStaticPresentationInput],
  ]) {
    await assertIndependentReadersAccept(await createInput(), `domformat-${name.replaceAll(" ", "-")}-`);
  }
});

test("production, N-version, and Python readers accept prepared adapter techniques", async () => {
  await assertIndependentReadersAccept(
    await syntheticAdapterTechniquesInput(),
    "domformat-adapter-techniques-",
  );
});

test("pinned stable cssGraphics browser contracts have source-cited closed execution paths in every reader", async () => {
  assert.equal(CSSGRAPHICS_REVISION, "bb2d0b030b9a5b15f2268d8221b57b56fb61be30");
  assert.deepEqual(STABLE_CSSGRAPHICS_BROWSER_CONTRACTS.map((contract) => contract.id), ["3dpipes", "electropaint", "gears", "gravitywell", "maze", "menger", "solitaire"]);
  assert.deepEqual(CSSGRAPHICS_OUT_OF_SCOPE_ADAPTERS, [{ id: "super-mario-64", ownership: "custom-morph-prepared-package", reason: "The pinned repository exports a browser adapter, but its custom/Morph prepared-package and product path is outside this DOMFORMAT mechanism claim and has no top-level stable browser-demo contract." }]);
  for (const contract of STABLE_CSSGRAPHICS_BROWSER_CONTRACTS) {
    assert.ok(contract.source.length > 0 && contract.source.every((citation) => /^src\/adapters\/.+?:\d/u.test(citation)), `${contract.id} source citations`);
    const input = await syntheticCssGraphicsDemoInput(contract.id);
    const playbackBinding = input.bindings.channels.find((channel) => channel.interpreter === "polycss-playback@0" || channel.interpreter === "polycss-paged-playback@0");
    const playbackPacket = input.state.channels.find((channel) => channel.codec === "polycss-playback-packed@0" || channel.codec === "polycss-paged-playback@0").data.packet;
    assert.deepEqual(playbackBinding.parameters.tickIntervalUs, [...contract.cadence.tickIntervalUs], `${contract.id} cadence`);
    assert.equal(playbackBinding.parameters.catchUpPolicy, contract.cadence.catchUpPolicy, `${contract.id} catch-up`);
    if (contract.cadence.deadlineMicros) assert.ok(playbackPacket.timeline.deadlineMicros, `${contract.id} explicit deadlines`);
    const techniques = new Set([input.state.channels.some((channel) => channel.codec === "polycss-paged-playback@0") ? "paged-playback" : "prepared-playback"]);
    const surface = input.state.channels.find((channel) => channel.codec === "polycss-surface-packed@0")?.data.packet;
    if (surface?.surface.faces.some((face) => face.stateCount > 1)) techniques.add("prepared-surface");
    if (input.state.channels.some((channel) => channel.codec === "polycss-variants-packed@0")) techniques.add("prepared-variants");
    if (input.state.channels.some((channel) => channel.codec === "polycss-paged-variants@0")) techniques.add("paged-variants");
    const viewport = input.state.channels.find((channel) => channel.codec === "polycss-viewport-profiles-packed@0")?.data.packet;
    if (viewport) techniques.add("responsive-profiles");
    if (viewport?.profiles.some((profile) => profile.visibilityChanges)) techniques.add("profile-frame-visibility");
    if (viewport?.profiles.some((profile) => profile.responsiveAffine)) techniques.add("responsive-affine");
    if (playbackPacket.banks) techniques.add("prepared-banks");
    if (playbackPacket.profileTimelines) techniques.add("profile-timelines");
    if (input.state.channels.some((channel) => channel.codec === "polycss-compositor-timing-prepared@0")) techniques.add("compositor-timing");
    if (playbackBinding.parameters.catchUpPolicy === "elapsed") techniques.add("elapsed-catch-up");
    if (contract.id === "electropaint") techniques.add("large-paged-closure");
    assert.deepEqual([...techniques].sort(), [...contract.techniques].sort(), `${contract.id} exact technique closure`);
    if (contract.id === "menger") {
      const packing = input.state.channels.find((channel) => channel.codec === "polycss-surface-packed@0").data.packet.surface.statePacking;
      assert.ok(packing.positionDictionary.length >= 2 && typeof packing.positionIndicesBase64 === "string", "Menger uses packed two-axis atlas positions");
      assert.deepEqual(input.bindings.channels.find((channel) => channel.interpreter === "polycss-surface@0").sinks, ["style.backgroundPosition", "style.visibility"]);
    }
    if (contract.id === "gravitywell") assert.ok(input.bindings.channels.find((channel) => channel.interpreter === "polycss-paged-variants@0").sinks.includes("style.color"), "Gravity Well binds prepared color publication");
    if (contract.techniques.includes("profile-frame-visibility")) {
      assert.ok(viewport.profiles.some((profile) => profile.visibilityChanges?.leafIndicesBase64), `${contract.id} has sparse profile-frame visibility rows`);
    }
    if (contract.techniques.includes("responsive-affine")) {
      assert.ok(viewport.profiles.some((profile) => profile.responsiveAffine?.coefficientsBase64), `${contract.id} has responsive affine coefficients`);
    }
    if (contract.techniques.includes("prepared-banks")) {
      assert.deepEqual(playbackPacket.banks.map(({ id, entryFrame }) => [id, entryFrame]), [["alpha", 1], ["beta", 3], ["gamma", 5]], `${contract.id} prepared bank entries`);
    }
    await assertIndependentReadersAccept(input, `domformat-cssgraphics-${contract.id}-`);
  }
});

test("the pinned ElectroPaint 64,000-frame/128-page closure stays deferred in every reader", async () => {
  const directory = await mkdtemp(join(tmpdir(), "domformat-cssgraphics-electropaint-closure-"));
  try {
    const built = buildDom(await syntheticPagedPlaybackInput({ variants: false }));
    const closure = largePagedDescriptorClosure(built, { frameCount: 64_000, pageCount: 128, transformAssignmentsPerFrame: 40 });
    const packet = closure.document.state.channels.find((channel) => channel.codec === "polycss-paged-playback@0").data.packet;
    assert.equal(packet.pages.length, 128);
    assert.equal(packet.pages.reduce((sum, page) => sum + page.transformCount, 0), 2_560_000);

    const production = readDom(closure.bytes, { externalResources: closure.eagerResources });
    assert.equal(production.externalMissing.length, 128);
    let loads = 0;
    const nversion = await readDomNVersion(closure.bytes, {
      externalResources: closure.eagerResources,
      loadResource() { loads += 1; throw new Error("ElectroPaint pages must remain deferred at document admission."); },
    });
    assert.equal(loads, 0);
    assert.equal(nversion.resourceBytes.size, closure.eagerResources.size);

    const model = join(directory, "model.json");
    await writeFile(model, closure.bytes);
    const python = runPython([pythonReader, "validate", model, "--no-resources"]);
    assert.equal(python.status, 0, `${python.stdout}\n${python.stderr}`);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("all readers admit the 64,000-frame/500-page lazy closure and reject oversized descriptors before page loading", async () => {
  const directory = await mkdtemp(join(tmpdir(), "domformat-large-paged-descriptors-"));
  try {
    const built = buildDom(await syntheticPagedPlaybackInput());
    const accepted = largePagedDescriptorClosure(built);
    const production = readDom(accepted.bytes, { externalResources: accepted.eagerResources });
    assert.equal(production.externalMissing.length, 500);
    let acceptedLoads = 0;
    const nversion = await readDomNVersion(accepted.bytes, {
      externalResources: accepted.eagerResources,
      loadResource() { acceptedLoads += 1; throw new Error("State pages must remain deferred."); },
    });
    assert.equal(acceptedLoads, 0);
    assert.equal(nversion.resourceBytes.size, accepted.eagerResources.size);
    const acceptedModel = join(directory, "accepted.json");
    await writeFile(acceptedModel, accepted.bytes);
    const acceptedPython = runPython([pythonReader, "validate", acceptedModel, "--no-resources"]);
    assert.equal(acceptedPython.status, 0, `${acceptedPython.stdout}\n${acceptedPython.stderr}`);

    const cases = [
      ["state-page count", { pageCount: 513 }, "RESOURCE_COUNT_LIMIT"],
      ["paged frame count", { frameCount: 64_001 }, "FRAME_CARDINALITY_MISMATCH"],
      ["per-page frame count", { pageCount: 6 }, "STATE_PAGE_COVERAGE_MISMATCH"],
      ["aggregate encoded page bytes", { encodedByteLength: 300 * 1024 }, "AGGREGATE_RESOURCE_LIMIT"],
      ["resident materialized byte product", { materializedByteLength: 27 * 1024 * 1024 }, "STATE_PAGE_RESIDENCY_LIMIT"],
    ];
    for (const [label, options, code] of cases) {
      const closure = largePagedDescriptorClosure(built, options);
      assert.throws(() => readDom(closure.bytes, { externalResources: closure.eagerResources }), errorCode(code), `${label} production`);
      let loads = 0;
      await assert.rejects(
        readDomNVersion(closure.bytes, {
          externalResources: closure.eagerResources,
          loadResource() { loads += 1; throw new Error("Invalid descriptors must fail before resource loading."); },
        }),
        (error) => error instanceof NVersionError && error.code === code,
        `${label} N-version`,
      );
      assert.equal(loads, 0, `${label} N-version page loads`);
      const model = join(directory, `${label.replaceAll(" ", "-")}.json`);
      await writeFile(model, closure.bytes);
      const python = runPython([pythonReader, "validate", model, "--no-resources"]);
      assert.equal(python.status, 1, `${label} Python: ${python.stdout}\n${python.stderr}`);
      assert.match(python.stderr, new RegExp(`\\b${code}\\b`), `${label} Python code`);
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("production, N-version, and Python readers accept every stable adapter-derived contract", async () => {
  for (const [name, createInput] of [
    ["responsive presentation", syntheticResponsivePresentationInput],
    ["landscape-first portrait-width presentation", syntheticAspectProfileTimelinesInput],
    ["presentation viewport profiles", syntheticViewportProfilesInput],
    ["dynamic responsive viewport profiles", syntheticDynamicViewportProfilesInput],
    ["presentation playback timelines", syntheticProfileTimelinesInput],
    ["host-selected prepared banks", syntheticPreparedBanksInput],
    ["covering viewport profiles", () => syntheticViewportProfilesInput("smallest-covering")],
    ["prepared orbit", syntheticOrbitInput],
    ["identity state pages", syntheticPagedVariantsInput],
    ["identity paged playback", syntheticPagedPlaybackInput],
    ["combined paged playback transforms, visibility, and variants", syntheticPagedPlaybackChangesInput],
    ["paged presentation playback timelines", syntheticPagedProfileTimelinesInput],
    ["paged presentation playback timelines without interaction", syntheticPagedProfileTimelinesWithoutInteractionInput],
    ["gzip state pages", () => syntheticPagedVariantsInput("gzip")],
    ["gzip paged playback", () => syntheticPagedPlaybackInput({ encoding: "gzip" })],
    ["paged host-selected prepared banks", syntheticPagedPreparedBanksInput],
    ["compositor timing", syntheticCompositorTimingInput],
    ["exact rational single-step timing", syntheticExactTimingInput],
    ["explicit elapsed deadlines", () => syntheticExactTimingInput({ catchUpPolicy: "elapsed", deadlineMicros: [0, 20_000, 50_000] })],
    ["exact interaction cadence", async () => {
      const input = await syntheticExecutableInteractionInput();
      const playback = input.bindings.channels.find((channel) => channel.interpreter === "polycss-playback@0").parameters;
      const interaction = input.bindings.channels.find((channel) => channel.interpreter === "polycss-pointer-grab@0").parameters;
      delete playback.tickRateHz;
      delete interaction.tickRateHz;
      playback.tickIntervalUs = [50_000, 3];
      playback.catchUpPolicy = "single-step";
      interaction.tickIntervalUs = [50_000, 3];
      return input;
    }],
    ["exact compositor cadence", async () => {
      const input = await syntheticCompositorTimingInput();
      const playback = input.bindings.channels.find((channel) => channel.interpreter === "polycss-playback@0").parameters;
      const compositor = input.bindings.channels.find((channel) => channel.interpreter === "polycss-compositor-timing@0").parameters;
      const interaction = input.bindings.channels.find((channel) => channel.interpreter === "polycss-pointer-grab@0").parameters;
      delete playback.tickRateHz;
      delete compositor.tickRateHz;
      delete interaction.tickRateHz;
      playback.tickIntervalUs = [30_000, 1];
      compositor.tickIntervalUs = [30_000, 1];
      interaction.tickIntervalUs = [30_000, 1];
      return input;
    }],
  ]) await assertIndependentReadersAccept(await createInput(), `domformat-${name.replaceAll(" ", "-")}-`);
});

test("production, N-version, and Python readers reject each new contract boundary", async () => {
  const cases = [
    ["timing-unreduced-rational", syntheticExactTimingInput, (document) => {
      document.bindings.channels.find((channel) => channel.interpreter === "polycss-playback@0").parameters.tickIntervalUs = [60_000, 2];
    }],
    ["timing-deadline-order", () => syntheticExactTimingInput({ catchUpPolicy: "elapsed", deadlineMicros: [0, 20_000, 50_000] }), (document) => {
      document.state.channels.find((channel) => channel.codec === "polycss-playback-packed@0").data.packet.timeline.deadlineMicros[2] = 20_000;
    }],
    ["timing-elapsed-effects-history", syntheticTwoFramePolycssInput, (document) => {
      document.bindings.channels.find((channel) => channel.interpreter === "polycss-playback@0").parameters.catchUpPolicy = "elapsed";
    }],
    ["responsive-final-breakpoint", syntheticResponsivePresentationInput, (document) => {
      document.state.channels.find((channel) => channel.codec === "static-presentation@0").data.packet.camera.profiles.at(-1).maxViewportWidth = 900;
      document.bindings.channels.find((channel) => channel.interpreter === "static-presentation@0").parameters.profiles.at(-1).maxViewportWidth = 900;
    }],
    ["responsive-profiles-without-selector", syntheticResponsivePresentationInput, (document) => {
      delete document.state.channels.find((channel) => channel.codec === "static-presentation@0").data.packet.camera.profileSelection;
      delete document.bindings.channels.find((channel) => channel.interpreter === "static-presentation@0").parameters.profileSelection;
    }],
    ["viewport-visibility-open-cycle", syntheticDynamicViewportProfilesInput, (document) => {
      const profile = document.state.channels.find((channel) => channel.codec === "polycss-viewport-profiles-packed@0").data.packet.profiles[0];
      profile.visibilityChanges.offsetsBase64 = Buffer.from(new Uint32Array([0, 0, 1, 1, 1, 1, 1, 1, 1]).buffer).toString("base64");
      profile.visibilityChanges.leafIndicesBase64 = Buffer.from(new Uint16Array([0]).buffer).toString("base64");
    }],
    ["viewport-responsive-truncated", syntheticDynamicViewportProfilesInput, (document) => {
      document.state.channels.find((channel) => channel.codec === "polycss-viewport-profiles-packed@0").data.packet.profiles[1].responsiveAffine.coefficientsBase64 = "";
    }],
    ["responsive-selector-without-profiles", syntheticResponsivePresentationInput, (document) => {
      delete document.state.channels.find((channel) => channel.codec === "static-presentation@0").data.packet.camera.profiles;
      delete document.bindings.channels.find((channel) => channel.interpreter === "static-presentation@0").parameters.profiles;
    }],
    ["responsive-null-profiles", syntheticResponsivePresentationInput, (document) => {
      document.state.channels.find((channel) => channel.codec === "static-presentation@0").data.packet.camera.profiles = null;
      document.bindings.channels.find((channel) => channel.interpreter === "static-presentation@0").parameters.profiles = null;
    }],
    ["responsive-null-selector", syntheticResponsivePresentationInput, (document) => {
      document.state.channels.find((channel) => channel.codec === "static-presentation@0").data.packet.camera.profileSelection = null;
      document.bindings.channels.find((channel) => channel.interpreter === "static-presentation@0").parameters.profileSelection = null;
    }],
    ["responsive-unsupported-selector", syntheticResponsivePresentationInput, (document) => {
      document.state.channels.find((channel) => channel.codec === "static-presentation@0").data.packet.camera.profileSelection = "media-query";
      document.bindings.channels.find((channel) => channel.interpreter === "static-presentation@0").parameters.profileSelection = "media-query";
    }],
    ["responsive-selector-mismatch", syntheticResponsivePresentationInput, (document) => {
      document.state.channels.find((channel) => channel.codec === "static-presentation@0").data.packet.camera.profileSelection = "landscape-first-portrait-width";
      const rows = document.state.channels.find((channel) => channel.codec === "static-presentation@0").data.packet.camera.profiles;
      delete rows[0].maxViewportWidth;
      rows.splice(1, 0, { ...structuredClone(rows[1]), id: "portrait", maxViewportWidth: 720 });
    }],
    ["aspect-nonincreasing-portrait-maxima", syntheticAspectProfileTimelinesInput, (document) => {
      document.state.channels.find((channel) => channel.codec === "static-presentation@0").data.packet.camera.profiles[2].maxViewportWidth = 500;
      document.bindings.channels.find((channel) => channel.interpreter === "static-presentation@0").parameters.profiles[2].maxViewportWidth = 500;
    }],
    ["aspect-bounded-final-portrait", syntheticAspectProfileTimelinesInput, (document) => {
      document.state.channels.find((channel) => channel.codec === "static-presentation@0").data.packet.camera.profiles.at(-1).maxViewportWidth = 1000;
      document.bindings.channels.find((channel) => channel.interpreter === "static-presentation@0").parameters.profiles.at(-1).maxViewportWidth = 1000;
    }],
    ["viewport-unused-bits", syntheticViewportProfilesInput, (document) => {
      document.state.channels.find((channel) => channel.codec === "polycss-viewport-profiles-packed@0").data.packet.profiles[0].visibleBitsBase64 = Buffer.from([0xff]).toString("base64");
    }],
    ["playback-profile-order", syntheticProfileTimelinesInput, (document) => {
      document.state.channels.find((channel) => channel.codec === "polycss-playback-packed@0").data.packet.profileTimelines = [
        { profileId: "desktop", introTicks: 0, loopTicks: 2, frames: [1, 2] },
        { profileId: "mobile", introTicks: 0, loopTicks: 2, frames: [1, 3] },
      ];
    }],
    ["playback-timeline-frame-span", syntheticProfileTimelinesInput, (document) => {
      document.bindings.channels.find((channel) => channel.interpreter === "polycss-playback@0").parameters.frameCount = 20;
      const packet = document.state.channels.find((channel) => channel.codec === "polycss-playback-packed@0").data.packet;
      packet.timeline = { introTicks: 0, loopTicks: 20, frames: Array.from({ length: 20 }, (_, index) => index + 1) };
      packet.profileTimelines[0].frames = [1, 10];
    }],
    ["prepared-bank-incomplete-pair", syntheticPreparedBanksInput, (document) => {
      delete document.state.channels.find((channel) => channel.codec === "polycss-playback-packed@0").data.packet.initialBankId;
    }],
    ["prepared-bank-id-order", syntheticPreparedBanksInput, (document) => {
      const banks = document.state.channels.find((channel) => channel.codec === "polycss-playback-packed@0").data.packet.banks;
      [banks[1], banks[2]] = [banks[2], banks[1]];
    }],
    ["prepared-bank-entry-duplicate", syntheticPreparedBanksInput, (document) => {
      document.state.channels.find((channel) => channel.codec === "polycss-playback-packed@0").data.packet.banks[1].entryFrame = 1;
    }],
    ["prepared-bank-initial-closure", syntheticPreparedBanksInput, (document) => {
      document.state.channels.find((channel) => channel.codec === "polycss-playback-packed@0").data.packet.banks[0].timeline.frames[1] = 8;
    }],
    ["prepared-bank-transfer-residency", () => syntheticPagedPreparedBanksInput({ variants: false }), (document) => {
      document.state.channels.find((channel) => channel.codec === "polycss-paged-playback@0").data.packet.maxResidentPages = 2;
    }],
    ["orbit-backward-closure", syntheticOrbitInput, (document) => {
      const transitions = document.state.channels.find((channel) => channel.codec === "polycss-orbit-input-prepared@0").data.packet.surface.transitions;
      const values = new Array(120).fill(119).map((value, index) => index === 1 ? 118 : value - index);
      transitions.backwardPositionIndicesBase64 = packedIntegers(values, 2);
    }],
    ["paged-coverage-gap", syntheticPagedVariantsInput, (document) => {
      document.state.channels.find((channel) => channel.codec === "polycss-paged-variants@0").data.packet.pages[1].startFrame += 1;
    }],
    ["paged-disjoint-reserves", syntheticPagedVariantsInput, (document) => {
      document.state.channels.find((channel) => channel.codec === "polycss-paged-variants@0").data.packet.maxResidentPages = 3;
    }],
    ["compositor-duration", syntheticCompositorTimingInput, (document) => {
      document.state.channels.find((channel) => channel.codec === "polycss-compositor-timing-prepared@0").data.packet.targets.find((target) => target.kind === "transition").durationTicks = 9;
    }],
    ["inline-control", syntheticStaticPresentationInput, (document) => {
      document.tree.nodes[0].styles.transform = "\u0001";
    }],
  ];
  for (const [name, createInput, mutate] of cases) await assertIndependentReadersReject(await createInput(), `domformat-${name}-`, mutate, name === "playback-timeline-frame-span" ? "TIMELINE_LIMIT" : undefined);
});

test("Python rejects booleans for every codec packet version", async () => {
  for (const [codec, createInput] of [
    ["polycss-playback-packed@0", syntheticPolycssInput],
    ["polycss-surface-packed@0", syntheticPolycssInput],
    ["polycss-effects-prepared@0", syntheticPolycssInput],
    ["static-presentation@0", syntheticPolycssInput],
    ["polycss-pointer-grab-prepared@0", syntheticExecutableInteractionInput],
    ["polycss-variants-packed@0", syntheticAdapterTechniquesInput],
    ["polycss-orbit-input-prepared@0", syntheticOrbitInput],
    ["polycss-viewport-profiles-packed@0", syntheticViewportProfilesInput],
    ["polycss-paged-variants@0", syntheticPagedVariantsInput],
    ["polycss-paged-playback@0", syntheticPagedPlaybackInput],
    ["polycss-compositor-timing-prepared@0", syntheticCompositorTimingInput],
  ]) await assertIndependentReadersReject(await createInput(), `domformat-bool-${codec.replaceAll(/[^a-z0-9]+/gu, "-")}-`, (document) => {
    document.state.channels.find((channel) => channel.codec === codec).data.packet.version = false;
  });
});

test("all readers fail closed on state-page identity, decoding, and payload errors", async () => {
  const cases = [
    ["missing", "identity", (_document, resources, pageId) => resources.delete(pageId)],
    ["encoded-digest", "identity", (_document, resources, pageId) => { resources.get(pageId)[0] ^= 1; }],
    ["codec", "identity", (document, _resources, pageId) => { document.resources.resources.find((record) => record.id === pageId).codec = "future-page@0"; }],
    ["payload-version", "identity", (document, resources, pageId) => {
      const page = decodeJson(resources.get(pageId), "state page");
      page.version = false;
      const changed = encodeCanonicalJson(page);
      resources.set(pageId, changed);
      const record = document.resources.resources.find((entry) => entry.id === pageId);
      record.byteLength = changed.length;
      record.decodedByteLength = changed.length;
      record.digest.value = createHash("sha256").update(changed).digest("hex");
      record.decodedDigest.value = record.digest.value;
    }],
    ["bad-gzip", "gzip", (document, resources, pageId) => {
      const changed = Uint8Array.of(0x1f, 0x8b, 0, 0);
      resources.set(pageId, changed);
      const record = document.resources.resources.find((entry) => entry.id === pageId);
      record.byteLength = changed.length;
      record.digest.value = createHash("sha256").update(changed).digest("hex");
    }],
    ["decode-bomb", "gzip", (document, resources, pageId) => {
      const decoded = gunzipSync(resources.get(pageId));
      const changed = gzipSync(Buffer.concat([decoded, Buffer.alloc(1024, 0x20)]), { level: 9 });
      resources.set(pageId, changed);
      const record = document.resources.resources.find((entry) => entry.id === pageId);
      record.byteLength = changed.length;
      record.digest.value = createHash("sha256").update(changed).digest("hex");
    }],
  ];
  for (const [label, encoding, mutate] of cases) {
    const directory = await mkdtemp(join(tmpdir(), `domformat-state-page-${label}-`));
    try {
      const built = buildDom(await syntheticPagedVariantsInput(encoding));
      const document = structuredClone(built.document);
      const resources = new Map([...builtExternalResources(built)].map(([id, value]) => [id, value.slice()]));
      const pageId = document.state.channels.find((channel) => channel.codec === "polycss-paged-variants@0").data.packet.pages[0].resource;
      mutate(document, resources, pageId);
      const bytes = encodeCanonicalJson(document);
      assert.throws(() => readDom(bytes, { externalResources: resources, requireResources: true }), undefined, `${label} production`);
      await assert.rejects((async () => {
        const result = await readDomNVersion(bytes, { externalResources: resources });
        const record = document.resources.resources.find((entry) => entry.id === pageId);
        await result.loadStatePage(record);
      })(), NVersionError, `${label} N-version`);
      const model = join(directory, "model.json");
      await writeFile(model, bytes);
      for (const record of document.resources.resources) {
        const value = resources.get(record.id);
        if (!value) continue;
        const target = join(directory, record.path);
        await mkdir(resolve(target, ".."), { recursive: true });
        await writeFile(target, value);
      }
      const python = runPython([pythonReader, "validate", model]);
      assert.equal(python.status, 1, `${label} Python: ${python.stdout}\n${python.stderr}`);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }
});

test("all readers fail closed on adjacent and wrap paged-playback boundary mismatches", async () => {
  const cases = [
    ["adjacent", "playback-page-2", (page) => { page.keyframe.shapeVisibilityBitsBase64 = "Ag=="; }],
    ["wrap", "playback-page-1", (_page, _descriptor, document, resources) => {
      replaceStatePage(document, resources, "playback-page-4", (page, descriptor) => {
        page.sequential.shapeOffsetsBase64 = packedIntegers([0, 0, 1], 4);
        page.sequential.shapeTargetIndicesBase64 = packedIntegers([0], 4);
        page.sequential.shapeTransformIndicesBase64 = packedIntegers([1], 4);
        page.sequential.shapeVisibilityBase64 = packedIntegers([0], 1);
        descriptor.shapeChangeCount += 1;
        descriptor.materializedByteLength += 9;
      });
    }],
  ];
  for (const [label, requestedPageId, mutate] of cases) {
    const directory = await mkdtemp(join(tmpdir(), `domformat-state-page-boundary-${label}-`));
    try {
      const built = buildDom(await syntheticPagedPlaybackInput());
      const document = structuredClone(built.document);
      const resources = new Map([...builtExternalResources(built)].map(([id, value]) => [id, value.slice()]));
      if (label === "adjacent") replaceStatePage(document, resources, requestedPageId, mutate);
      else mutate(undefined, undefined, document, resources);
      const bytes = encodeCanonicalJson(document);
      assert.throws(
        () => readDom(bytes, { externalResources: resources, requireResources: true }),
        (error) => error?.code === "STATE_PAGE_BOUNDARY_MISMATCH",
        `${label} production`,
      );
      const nversion = await readDomNVersion(bytes, { externalResources: resources });
      const requested = document.resources.resources.find((record) => record.id === requestedPageId);
      await assert.rejects(
        nversion.loadStatePage(requested),
        (error) => error instanceof NVersionError && error.code === "STATE_PAGE_BOUNDARY_MISMATCH",
        `${label} N-version`,
      );
      const model = join(directory, "model.json");
      await writeFile(model, bytes);
      for (const record of document.resources.resources) {
        const target = join(directory, record.path);
        await mkdir(resolve(target, ".."), { recursive: true });
        await writeFile(target, resources.get(record.id));
      }
      const python = runPython([pythonReader, "validate", model]);
      assert.equal(python.status, 1, `${label} Python: ${python.stdout}\n${python.stderr}`);
      assert.match(`${python.stdout}\n${python.stderr}`, /STATE_PAGE_BOUNDARY_MISMATCH/u, `${label} Python error code`);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }
});

test("N-version reader defers state pages and validates each requested page without publishing its bytes", async () => {
  const built = buildDom(await syntheticPagedVariantsInput("gzip"));
  const all = builtExternalResources(built);
  const calls = [];
  const result = await readDomNVersion(built.bytes, {
    async loadResource(record, signal) {
      calls.push({ id: record.id, kind: record.kind, signal });
      return all.get(record.id);
    },
  });
  const eagerIds = built.document.resources.resources.filter((record) => record.kind !== "state-page").map((record) => record.id);
  const pageRecords = built.document.resources.resources.filter((record) => record.kind === "state-page");
  assert.deepEqual(calls.map(({ id }) => id), eagerIds);
  assert.deepEqual([...result.resourceBytes.keys()], eagerIds);
  assert.equal([...result.resourceBytes.keys()].some((id) => id.startsWith("variant-page-")), false);
  assert.equal(Object.isFrozen(result.document.resources.resources.find((record) => record.kind === "state-page")?.digest), true);

  const first = await result.loadStatePage(pageRecords[0]);
  assert.equal(decodeJson(first, "deferred state page").startFrame, 1);
  assert.deepEqual(calls.map(({ id }) => id), [...eagerIds, pageRecords[0].id]);
  assert.deepEqual([...result.resourceBytes.keys()], eagerIds);

  const corrupt = all.get(pageRecords[2].id).slice();
  corrupt[corrupt.length - 1] ^= 1;
  all.set(pageRecords[2].id, corrupt);
  await assert.rejects(result.loadStatePage(pageRecords[2]), (error) => error instanceof NVersionError && error.code === "RESOURCE_DIGEST_MISMATCH");
  assert.deepEqual(calls.map(({ id }) => id), [...eagerIds, pageRecords[0].id, pageRecords[2].id]);
});

test("N-version deferred state-page requests propagate cancellation without publication", async () => {
  const built = buildDom(await syntheticPagedVariantsInput());
  const all = builtExternalResources(built);
  let release;
  const result = await readDomNVersion(built.bytes, {
    async loadResource(record, signal) {
      if (record.kind !== "state-page") return all.get(record.id);
      await new Promise((resolve) => {
        release = resolve;
        signal.addEventListener("abort", resolve, { once: true });
      });
      return all.get(record.id);
    },
  });
  const page = built.document.resources.resources.find((record) => record.kind === "state-page");
  const controller = new AbortController();
  const pending = result.loadStatePage(page, controller.signal);
  controller.abort();
  await assert.rejects(pending, (error) => error instanceof NVersionError && error.code === "OPERATION_ABORTED");
  release?.();
  assert.equal(result.resourceBytes.has(page.id), false);
});

test("production, N-version, and Python readers agree on exact artifacts and inert claims", async () => {
  const input = await syntheticInput();
  input.meta.artifacts = [
    { id: "archive", role: "distribution", byteLength: 1024, decodedByteLength: 2048, digest: { algorithm: "sha256", value: "c".repeat(64) } },
    { id: "config", role: "configuration", byteLength: 64, decodedByteLength: 64, digest: { algorithm: "sha256", value: "d".repeat(64) } },
  ];
  input.meta.claims = [
    { artifact: "archive", kind: "locator", value: "https://example.test/archive.zip" },
    { artifact: "config", kind: "license", value: "MIT" },
    { artifact: "config", kind: "qualification", value: "source-verified" },
  ];
  await assertIndependentReadersAccept(input, "domformat-artifacts-");
});

test("production, N-version, and Python readers reject malformed packed surface positions", async () => {
  const built = buildDom(await syntheticAdapterTechniquesInput());
  const directory = await mkdtemp(join(tmpdir(), "domformat-surface-positions-"));
  try {
    const cases = [
      ["legacy-string", (packing) => { packing.backgroundPositions = ["0 0", "rgb(0 0 0)"]; }],
      ["unsorted-dictionary", (packing) => { packing.positionDictionary.reverse(); }],
      ["unreferenced-dictionary", (packing) => { packing.positionIndicesBase64 = packedIntegers([0, 0], 2); }],
      ["out-of-range-index", (packing) => { packing.positionIndicesBase64 = packedIntegers([1, 2], 2); }],
    ];
    for (const [label, mutate] of cases) {
      const document = structuredClone(built.document);
      const packing = document.state.channels.find((channel) => channel.id === "surface").data.packet.surface.statePacking;
      mutate(packing);
      const bytes = encodeCanonicalJson(document);
      const resources = builtExternalResources(built);
      assert.throws(() => readDom(bytes, { externalResources: resources, requireResources: true }), undefined, `${label} production`);
      await assert.rejects(readDomNVersion(bytes, { externalResources: resources }), NVersionError, `${label} N-version`);
      const caseDirectory = join(directory, label);
      await mkdir(caseDirectory, { recursive: true });
      const model = join(caseDirectory, "model.json");
      await writeFile(model, bytes);
      for (const record of document.resources.resources) {
        const target = join(caseDirectory, record.path);
        await mkdir(resolve(target, ".."), { recursive: true });
        await writeFile(target, resources.get(record.id));
      }
      const python = runPython([pythonReader, "validate", model]);
      assert.equal(python.status, 1, `${label} Python: ${python.stdout}\n${python.stderr}`);
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("production, N-version, and Python readers reject undeclared variant effects", async () => {
  const built = buildDom(await syntheticAdapterTechniquesInput());
  const directory = await mkdtemp(join(tmpdir(), "domformat-variant-effects-"));
  try {
    const cases = [
      ["INVALID_VARIANT_EFFECT", (document) => {
        document.state.channels.find((channel) => channel.id === "variants").data.packet.effects[0].styles.transform = "none";
      }],
      ["UNDECLARED_VARIANT_EFFECT", (document, resources) => {
        const record = document.resources.resources.find((entry) => entry.id === "model-css");
        const css = resources.get("model-css");
        const changed = new TextEncoder().encode(`${new TextDecoder().decode(css)}\n[data-domformat-root="synthetic-polycss"] .material-a *{visibility:hidden}`);
        resources.set("model-css", changed);
        record.byteLength = changed.length;
        record.digest.value = createHash("sha256").update(changed).digest("hex");
      }],
      ["UNSAFE_CSS_IMPORTANT", (document, resources) => {
        const record = document.resources.resources.find((entry) => entry.id === "model-css");
        const css = resources.get("model-css");
        const changed = new TextEncoder().encode(`${new TextDecoder().decode(css)}\n[data-domformat-root="synthetic-polycss"] .leaf{color:red !important}`);
        resources.set("model-css", changed);
        record.byteLength = changed.length;
        record.digest.value = createHash("sha256").update(changed).digest("hex");
      }],
    ];
    for (const [expected, mutate] of cases) {
      const document = structuredClone(built.document);
      const resources = new Map([...builtExternalResources(built)].map(([id, bytes]) => [id, bytes.slice()]));
      mutate(document, resources);
      const bytes = encodeCanonicalJson(document);
      assert.throws(() => readDom(bytes, { externalResources: resources, requireResources: true }), (error) => error?.code === expected, `${expected} production`);
      await assert.rejects(readDomNVersion(bytes, { externalResources: resources }), (error) => error instanceof NVersionError && error.code === expected, `${expected} N-version`);
      const caseDirectory = join(directory, expected.toLowerCase());
      await mkdir(caseDirectory, { recursive: true });
      const model = join(caseDirectory, "model.json");
      await writeFile(model, bytes);
      for (const record of document.resources.resources) {
        const target = join(caseDirectory, record.path);
        await mkdir(resolve(target, ".."), { recursive: true });
        await writeFile(target, resources.get(record.id));
      }
      const python = runPython([pythonReader, "validate", model]);
      assert.equal(python.status, 1, `${expected} Python: ${python.stdout}\n${python.stderr}`);
      assert.match(python.stderr, new RegExp(`: ${expected}:`, "u"));
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("production, N-version, and Python readers reject a null optional presentation background", async () => {
  const built = buildDom(await syntheticStaticPresentationInput());
  const document = decodeJson(built.bytes, "static presentation");
  document.state.channels.find((channel) => channel.codec === "static-presentation@0").data.packet.background = null;
  const bytes = encodeCanonicalJson(document);
  const externalResources = builtExternalResources(built);
  assert.throws(() => readDom(bytes, { externalResources, requireResources: true }), (error) => error?.code === "INVALID_PRESENTATION_STATE");
  await assert.rejects(readDomNVersion(bytes, { externalResources }), (error) => error instanceof NVersionError && error.code === "INVALID_PRESENTATION_STATE");

  const directory = await mkdtemp(join(tmpdir(), "domformat-null-presentation-background-"));
  try {
    const model = join(directory, "model.json");
    await writeFile(model, bytes);
    for (const record of built.document.resources.resources) {
      const target = join(directory, record.path);
      await mkdir(resolve(target, ".."), { recursive: true });
      await writeFile(target, built.externalResources.get(record.path));
    }
    const python = runPython([pythonReader, "validate", model]);
    assert.equal(python.status, 1, `${python.stdout}\n${python.stderr}`);
    assert.match(python.stderr, /INVALID_PRESENTATION_STATE/u);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("production, N-version, and Python readers reject effects without playback", async () => {
  const built = buildDom(await syntheticEmptySurfaceInput());
  const document = decodeJson(built.bytes, "effects without playback");
  document.state.channels = document.state.channels.filter((channel) => !["polycss-playback-packed@0", "polycss-surface-packed@0"].includes(channel.codec));
  document.bindings.channels = document.bindings.channels.filter((channel) => !["polycss-playback@0", "polycss-surface@0"].includes(channel.interpreter));
  document.bindings.inputs = document.bindings.inputs.filter((definition) => definition.id !== "time.tick");
  document.meta.capabilities = document.meta.capabilities.filter((capability) => !["prepared-playback", "prepared-surface-lighting"].includes(capability));
  document.meta.conformance.executable = document.meta.conformance.executable.filter((role) => !["playback", "surface-lighting"].includes(role));
  document.meta.counts = { nodes: document.tree.nodes.length };
  const bytes = encodeCanonicalJson(document);
  const externalResources = builtExternalResources(built);
  assert.throws(() => readDom(bytes, { externalResources, requireResources: true }), (error) => error?.code === "MISSING_POLYCSS_CHANNEL");
  await assert.rejects(readDomNVersion(bytes, { externalResources }), (error) => error instanceof NVersionError && error.code === "MISSING_POLYCSS_CHANNEL");

  const directory = await mkdtemp(join(tmpdir(), "domformat-effects-without-playback-"));
  try {
    const model = join(directory, "model.json");
    await writeFile(model, bytes);
    for (const record of built.document.resources.resources) {
      const target = join(directory, record.path);
      await mkdir(resolve(target, ".."), { recursive: true });
      await writeFile(target, built.externalResources.get(record.path));
    }
    const python = runPython([pythonReader, "validate", model]);
    assert.equal(python.status, 1, `${python.stdout}\n${python.stderr}`);
    assert.match(python.stderr, /MISSING_POLYCSS_CHANNEL/u);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("N-version probe matches the exact shared transport and envelope corpus", async () => {
  const manifest = JSON.parse(await readFile(resolve(corpus, "cases.json"), "utf8"));
  const source = new Uint8Array(await readFile(resolve(corpus, manifest.fixture.json)));
  const document = decodeJson(source, "N-version corpus");
  const baseResources = new Map(await Promise.all(document.resources.resources.map(async (record) => [record.id, new Uint8Array(await readFile(resolve(corpus, record.path)))])));
  for (const entry of manifest.cases) {
    const externalResources = new Map([...baseResources].map(([id, bytes]) => [id, bytes.slice()]));
    if (entry.mutation === "missing-resource") externalResources.delete("independent-checker");
    if (entry.mutation === "resource-digest") externalResources.get("independent-checker")[0] ^= 1;
    let actual = "valid";
    try {
      await readDomNVersion(mutateCorpus(source, entry.mutation), { externalResources });
    } catch (error) {
      assert.ok(error instanceof NVersionError, entry.id);
      actual = error.code;
    }
    assert.equal(actual, entry.expect, entry.id);
  }
});

test("N-version probe matches the shared fail-closed CSS security corpus", async () => {
  const manifest = JSON.parse(await readFile(resolve(corpus, "css-security-cases.json"), "utf8"));
  const records = new Map([["checker", { id: "checker", kind: "image" }]]);
  const limits = {
    maxCssBytes: 1024 * 1024,
    maxCssRules: 8_192,
    maxCssSelectors: 32_768,
    maxCssSelectorBytes: 4_096,
    maxCssDeclarations: 131_072,
  };
  for (const entry of manifest.cases) {
    let actual = "valid";
    try {
      validateStylesheet(new TextEncoder().encode(entry.css), {
        id: "model-css",
        scope: manifest.scope,
        assetTokens: entry.tokens,
      }, records, limits);
    } catch (error) {
      assert.ok(error instanceof NVersionError, entry.id);
      actual = error.code;
    }
    assert.equal(actual, entry.expect, entry.id);
  }
});

test("production and N-version readers reject prepared runtime arithmetic envelopes", async () => {
  const built = buildDom(await syntheticExecutableInteractionInput());
  const externalResources = builtExternalResources(built);
  const cases = [
    ["INVALID_INTERACTION_STATE", (document) => {
      const packet = document.state.channels.find((channel) => channel.codec === "polycss-pointer-grab-prepared@0").data.packet;
      const closure = packet.controls[0].closure;
      closure.weightActiveFlags[0] = 0;
      closure.weightScalars[0] = Math.fround(2e38);
      closure.weightLinearContributions[0] = 2;
    }],
    ["INVALID_INTERACTION_STATE", (document) => {
      const packet = document.state.channels.find((channel) => channel.codec === "polycss-pointer-grab-prepared@0").data.packet;
      packet.objects.rotationMatrices[0] = Math.fround(2e38);
      packet.controls.find((control) => control.mode === "eye-follow").closure.rigidRootInverseMatrix[0] = 2;
    }],
    ...[1, 1.5].map((timeout) => ["INVALID_EFFECTS_STATE", (document) => {
      const packet = document.state.channels.find((channel) => channel.codec === "polycss-effects-prepared@0").data.packet;
      packet.biases.continuous = [0, 0, 0];
      packet.spawnStream.tuples[0] = [timeout, Math.fround(2e38), 0, 0];
    }]),
  ];
  for (const [code, mutateDocument] of cases) {
    const document = decodeJson(built.bytes, "prepared arithmetic fixture");
    mutateDocument(document);
    const bytes = encodeCanonicalJson(document);
    assert.throws(() => readDom(bytes, { externalResources, requireResources: true }), (error) => error?.code === code);
    await assert.rejects(readDomNVersion(bytes, { externalResources }), (error) => error instanceof NVersionError && error.code === code);
  }
});

test("N-version probe accepts independently produced canonical and ordinary JSON", async () => {
  const directory = await mkdtemp(join(tmpdir(), "domformat-nversion-producer-"));
  try {
    const canonical = await produce(join(directory, "canonical"));
    const ordinary = await produce(join(directory, "ordinary"), ["--ordinary"]);
    const canonicalReference = await readDomFile(canonical.model);
    const ordinaryReference = await readDomFile(ordinary.model);
    const canonicalNVersion = await readDomNVersion(canonical.bytes, { externalResources: canonicalReference.resourceBytes });
    const ordinaryNVersion = await readDomNVersion(ordinary.bytes, { externalResources: ordinaryReference.resourceBytes });
    assert.deepEqual(plain(canonicalNVersion.document), canonicalReference.document);
    assert.deepEqual(plain(ordinaryNVersion.document), ordinaryReference.document);
    assert.equal(canonicalNVersion.implementation, "nversion-browser-probe@0");
    assert.equal(canonicalNVersion.resourceBytes.size, 2);
    assert.equal(ordinaryNVersion.transport.encoding, "json");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("seeded cross-field mutations agree across Node, Python, and the N-version probe", async () => {
  const directory = await mkdtemp(join(tmpdir(), "domformat-nversion-differential-"));
  try {
    const produced = await produce(directory, ["--ordinary"]);
    const reference = await readDomFile(produced.model);
    const original = JSON.parse(await readFile(produced.model, "utf8"));
    const mutations = [
      { valid: true, apply(document, seed) { document.meta.optionalCapabilities.push(`zz-review-${seed}`); } },
      { valid: false, apply(document, seed) { document[`unknown${seed}`] = true; } },
      { valid: false, apply(document, seed) { document.meta.format = `domformat@${seed + 1}`; } },
      { valid: false, apply(document) { document.tree.nodes[1].id = document.tree.nodes[0].id; } },
      { valid: false, apply(document, seed) { document.tree.nodes[1].sibling = seed + 2; } },
      { valid: false, apply(document, seed) { document.meta.counts.nodes += seed + 1; } },
      { valid: false, apply(document, seed) { const record = document.resources.resources[seed % 2]; record.digest.value = `${record.digest.value[0] === "0" ? "1" : "0"}${record.digest.value.slice(1)}`; } },
      { valid: false, apply(document, seed) { document[`payloads${seed}`] = {}; } },
      { valid: false, apply(document, seed) { const binding = document.bindings.channels.find((entry) => entry.interpreter === "polycss-playback@0"); binding.targets.leaves[seed % binding.targets.leaves.length] = `missing/leaf:${seed}`; } },
      { valid: false, apply(document) { document.state.channels.find((entry) => entry.id === "playback").codec = "static-presentation@0"; } },
      { valid: false, apply(document) { document.bindings.channels.find((entry) => entry.interpreter === "polycss-playback@0").targets.leaves.reverse(); } },
      { valid: false, apply(document, seed) { document.bindings.channels.find((entry) => entry.interpreter === "static-presentation@0").parameters.sourceWidth += seed + 1; } },
      { valid: false, apply(document, seed) { document.state.channels.find((entry) => entry.id === "playback").data.packet[`private${seed}`] = 1; } },
      { valid: false, apply(document) { document.bindings.channels.find((entry) => entry.interpreter === "polycss-effects@0").inputs.reverse(); } },
      { valid: false, apply(document, seed) { document.cssBinding.stylesheets[0].scope = `[data-missing="scope-${seed}"]`; } },
      { valid: false, apply(document, seed) { document.meta.capabilities.push(`unknown-${seed}`); } },
    ];
    for (let seed = 0; seed < 64; seed += 1) {
      const mutation = mutations[seed % mutations.length];
      const document = structuredClone(original);
      mutation.apply(document, seed);
      const bytes = new TextEncoder().encode(JSON.stringify(document, null, seed % 3));
      let nodeValid = true;
      try { readDom(bytes, { externalResources: reference.resourceBytes, requireResources: true }); } catch { nodeValid = false; }
      let nVersionValid = true;
      try { await readDomNVersion(bytes, { externalResources: reference.resourceBytes }); } catch (error) { assert.ok(error instanceof NVersionError, `seed ${seed}`); nVersionValid = false; }
      const path = join(directory, `case-${seed}.json`);
      await writeFile(path, bytes);
      const python = runPython([pythonReader, "validate", path]);
      const pythonValid = python.status === 0;
      assert.equal(nodeValid, mutation.valid, `seed ${seed} Node`);
      assert.equal(nVersionValid, mutation.valid, `seed ${seed} N-version`);
      assert.equal(pythonValid, mutation.valid, `seed ${seed} Python: ${python.stderr}`);
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("deep codec mutations are rejected by Node, Python, and the N-version reader", async () => {
  const directory = await mkdtemp(join(tmpdir(), "domformat-nversion-codecs-"));
  try {
    const produced = await produce(directory, ["--ordinary"]);
    const reference = await readDomFile(produced.model);
    const original = JSON.parse(await readFile(produced.model, "utf8"));
    const packet = (document, id) => document.state.channels.find((entry) => entry.id === id).data.packet;
    const mutations = [
      ["playback transform encoding", (document) => { packet(document, "playback").transforms.groups[0].encoding = "future-packed"; }],
      ["playback transform scale width", (document) => { packet(document, "playback").transforms.groups[0].scales.pop(); }],
      ["playback unowned transform", (document) => { packet(document, "playback").initial.shapes.transforms[1] = 0; }],
      ["playback concealed unowned transform", (document) => {
        packet(document, "playback").initial.shapes.transforms[1] = 0;
        packet(document, "playback").transforms.groups.splice(2, 1);
      }],
      ["surface source-frame delta", (document) => { packet(document, "surface").surface.statePacking.sourceFrameDeltas[1] = packet(document, "surface").frameCount; }],
      ["effects emitter mode", (document) => { packet(document, "effects").emitters[0].mode = "network-stream"; }],
      ["interaction pointer quantization", (document) => { packet(document, "interaction").input.pointerQuantization = "round"; }],
      ["interaction stick range", (document) => { packet(document, "interaction").input.stickRange = [-127, 127]; }, "INVALID_INTERACTION_STATE"],
      ["interaction target order", (document) => {
        document.bindings.channels.find((entry) => entry.interpreter === "polycss-pointer-grab@0").targets.leaves.reverse();
      }, "INTERACTION_TARGET_MISMATCH"],
      ["interaction overlong basis", (document) => { packet(document, "interaction").leaves[0].basis.push(0); }],
      ["interaction canonical size", (document) => { packet(document, "interaction").leaves[0].canonicalSize = 64; }],
      ["interaction playback fit mismatch", (document) => {
        document.state.channels.find((entry) => entry.id === "playback").data.leafFit[0].canonicalSize = 16;
      }],
    ];
    for (const [label, mutate, expectedCode] of mutations) {
      const document = structuredClone(original);
      mutate(document);
      const bytes = new TextEncoder().encode(JSON.stringify(document));
      assert.throws(
        () => readDom(bytes, { externalResources: reference.resourceBytes, requireResources: true }),
        expectedCode ? (error) => error?.code === expectedCode : undefined,
        `${label} Node`,
      );
      await assert.rejects(
        readDomNVersion(bytes, { externalResources: reference.resourceBytes }),
        expectedCode ? (error) => error instanceof NVersionError && error.code === expectedCode : NVersionError,
        `${label} N-version`,
      );
      const path = join(directory, `invalid-${label.replaceAll(" ", "-")}.json`);
      await writeFile(path, bytes);
      const python = runPython([pythonReader, "validate", path]);
      assert.notEqual(python.status, 0, `${label} Python`);
      if (expectedCode) assert.match(python.stderr, new RegExp(`: ${expectedCode}:`, "u"), `${label} Python code`);
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("illegal PNG media survives digest rebinding but not independent validation", async () => {
  const directory = await mkdtemp(join(tmpdir(), "domformat-nversion-media-"));
  try {
    const produced = await produce(directory, ["--ordinary"]);
    const document = JSON.parse(await readFile(produced.model, "utf8"));
    const record = document.resources.resources.find((entry) => entry.kind === "image" && entry.mediaType === "image/png");
    assert.ok(record);
    const imagePath = join(directory, record.path);
    const image = new Uint8Array(await readFile(imagePath));
    image[24] = 3;
    const checksum = crc32(image.subarray(12, 29));
    image[29] = checksum >>> 24;
    image[30] = checksum >>> 16 & 0xff;
    image[31] = checksum >>> 8 & 0xff;
    image[32] = checksum & 0xff;
    record.digest.value = createHash("sha256").update(image).digest("hex");
    await writeFile(imagePath, image);
    const modelBytes = new TextEncoder().encode(JSON.stringify(document));
    await writeFile(produced.model, modelBytes);
    const resources = new Map(await Promise.all(document.resources.resources.map(async (entry) => [entry.id, new Uint8Array(await readFile(join(directory, entry.path)))])));
    assert.throws(() => readDom(modelBytes, { externalResources: resources, requireResources: true }), (error) => error?.code === "IMAGE_MEDIA_MISMATCH");
    await assert.rejects(readDomNVersion(modelBytes, { externalResources: resources }), (error) => error instanceof NVersionError && error.code === "IMAGE_MEDIA_MISMATCH");
    const python = runPython([pythonReader, "validate", produced.model]);
    assert.notEqual(python.status, 0, python.stdout);
    assert.match(python.stderr, /IMAGE_MEDIA_MISMATCH/u);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("animated WebP has one rejection code across independent readers", async () => {
  const directory = await mkdtemp(join(tmpdir(), "domformat-nversion-animated-webp-"));
  try {
    const produced = await produce(directory, ["--ordinary"]);
    const document = JSON.parse(await readFile(produced.model, "utf8"));
    const record = document.resources.resources.find((entry) => entry.kind === "image");
    assert.ok(record);
    const image = new Uint8Array(44);
    image.set(new TextEncoder().encode("RIFF"), 0);
    new DataView(image.buffer).setUint32(4, 36, true);
    image.set(new TextEncoder().encode("WEBPVP8X"), 8);
    new DataView(image.buffer).setUint32(16, 10, true);
    image[20] = 0x02;
    image.set(new TextEncoder().encode("VP8L"), 30);
    new DataView(image.buffer).setUint32(34, 6, true);
    image[38] = 0x2f;
    record.mediaType = "image/webp";
    record.path = record.path.replace(/\.png$/u, ".webp");
    record.byteLength = image.length;
    record.dimensions = { width: 1, height: 1 };
    record.digest.value = createHash("sha256").update(image).digest("hex");
    await writeFile(join(directory, record.path), image);
    const modelBytes = new TextEncoder().encode(JSON.stringify(document));
    await writeFile(produced.model, modelBytes);
    const resources = new Map(await Promise.all(document.resources.resources.map(async (entry) => [entry.id, new Uint8Array(await readFile(join(directory, entry.path)))])));

    assert.throws(() => readDom(modelBytes, { externalResources: resources, requireResources: true }), (error) => error?.code === "IMAGE_ANIMATION_UNSUPPORTED");
    await assert.rejects(readDomNVersion(modelBytes, { externalResources: resources }), (error) => error instanceof NVersionError && error.code === "IMAGE_ANIMATION_UNSUPPORTED");
    const python = runPython([pythonReader, "validate", produced.model]);
    assert.equal(python.status, 1, `${python.stdout}\n${python.stderr}`);
    assert.match(python.stderr, /IMAGE_ANIMATION_UNSUPPORTED/u);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
