import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { decodeJson, encodeCanonicalJson } from "../src/canonical-json.js";
import { DEFAULT_LIMITS, jsonStructureLimits } from "../src/constants.js";
import { loadManifest } from "../src/manifest.js";
import { readDom } from "../src/reader.js";
import { validateDocument } from "../src/schema.js";
import { createPolycssPlayback, materializePolycssState } from "../src/state/polycss.js";
import { buildDom } from "../src/writer.js";
import { readDomNVersion } from "../conformance/nversion/reader.js";
import {
  builtExternalResources,
  errorCode,
  syntheticAdapterTechniquesInput,
  syntheticExecutableInteractionInput,
  syntheticInput,
  syntheticManifestPath,
  syntheticPagedPlaybackInput,
  syntheticTwoFramePolycssInput,
} from "./helpers.js";

const UTF8 = new TextEncoder();
const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function integerBase64(values, width) {
  const bytes = Buffer.allocUnsafe(values.length * width);
  for (let index = 0; index < values.length; index += 1) {
    if (width === 2) bytes.writeUInt16LE(values[index], index * width);
    else bytes.writeUInt32LE(values[index], index * width);
  }
  return bytes.toString("base64");
}

test("JSON structure preflight enforces exact array, object, and depth boundaries", () => {
  const limits = { maxArrayItems: 2, maxObjectMembers: 2 };
  assert.deepEqual(decodeJson(UTF8.encode("[0,1]"), "array", limits), [0, 1]);
  assert.throws(() => decodeJson(UTF8.encode("[0,1,2]"), "array", limits), errorCode("JSON_ARRAY_LIMIT"));
  assert.deepEqual(decodeJson(UTF8.encode('{"a":0,"b":1}'), "object", limits), { a: 0, b: 1 });
  assert.throws(() => decodeJson(UTF8.encode('{"a":0,"b":1,"c":2}'), "object", limits), errorCode("JSON_OBJECT_LIMIT"));
  assert.equal(new TextDecoder().decode(encodeCanonicalJson([0, 1], limits)), "[0,1]");
  assert.throws(() => encodeCanonicalJson([0, 1, 2], limits), errorCode("JSON_ARRAY_LIMIT"));
  const exactKey = "a".repeat(256);
  const excessiveKey = "a".repeat(257);
  assert.deepEqual(decodeJson(UTF8.encode(`{${JSON.stringify(exactKey)}:0}`), "key"), { [exactKey]: 0 });
  assert.throws(() => decodeJson(UTF8.encode(`{${JSON.stringify(excessiveKey)}:0}`), "key"), errorCode("JSON_KEY_LIMIT"));
  assert.throws(() => encodeCanonicalJson({ [excessiveKey]: 0 }), errorCode("JSON_KEY_LIMIT"));

  const accepted = `${"[".repeat(256)}0${"]".repeat(256)}`;
  const rejected = `${"[".repeat(257)}0${"]".repeat(257)}`;
  assert.doesNotThrow(() => decodeJson(UTF8.encode(accepted), "depth"));
  assert.throws(() => decodeJson(UTF8.encode(rejected), "depth"), errorCode("JSON_DEPTH"));
});

test("every configured limit is wired to a rejecting path", async () => {
  const basic = await syntheticInput();
  const executable = await syntheticExecutableInteractionInput();
  const twoFrame = await syntheticTwoFramePolycssInput();
  const paged = await syntheticPagedPlaybackInput();
  const cases = [
    ["maxNodes", basic, "NODE_COUNT_LIMIT"],
    ["maxTreeDepth", basic, "TREE_DEPTH_LIMIT"],
    ["maxAttributesPerNode", basic, "INVALID_MOUNT"],
    ["maxClassesPerNode", basic, "CLASS_COUNT_LIMIT"],
    ["maxStylesPerNode", basic, "STYLE_COUNT_LIMIT"],
    ["maxResources", basic, "INVALID_RESOURCE_INPUTS"],
    ["maxStatePages", paged, "INVALID_RESOURCE_INPUTS"],
    ["maxResourceBytes", basic, "RESOURCE_SIZE_LIMIT"],
    ["maxAggregateResourceBytes", basic, "AGGREGATE_RESOURCE_LIMIT"],
    ["maxAggregateStatePageBytes", paged, "AGGREGATE_RESOURCE_LIMIT"],
    ["maxCssBytes", basic, "CSS_SIZE_LIMIT"],
    ["maxCssRules", basic, "CSS_RULE_LIMIT"],
    ["maxCssSelectors", basic, "CSS_SELECTOR_LIMIT"],
    ["maxCssSelectorBytes", basic, "CSS_SELECTOR_LIMIT"],
    ["maxCssDeclarations", basic, "CSS_DECLARATION_LIMIT"],
    ["maxCssFunctions", basic, "CSS_FUNCTION_LIMIT"],
    ["maxCssAssetTokens", basic, "CSS_TOKEN_LIMIT"],
    ["maxImageWidth", basic, "IMAGE_DIMENSION_LIMIT"],
    ["maxImageHeight", basic, "IMAGE_DIMENSION_LIMIT"],
    ["maxImagePixels", basic, "IMAGE_DIMENSION_LIMIT"],
    ["maxAggregateImagePixels", basic, "AGGREGATE_IMAGE_PIXEL_LIMIT"],
    ["maxStateChannels", executable, "STATE_CHANNEL_LIMIT"],
    ["maxBindingChannels", executable, "BINDING_CHANNEL_LIMIT"],
    ["maxBindingInputs", executable, "BINDING_INPUT_LIMIT"],
    ["maxFrames", executable, "FRAME_CARDINALITY_MISMATCH"],
    ["maxPagedFrames", paged, "FRAME_CARDINALITY_MISMATCH"],
    ["maxStatePageFrames", paged, "STATE_PAGE_COVERAGE_MISMATCH"],
    ["maxTimelineTicks", executable, "TIMELINE_LIMIT"],
    ["maxPreparedTransforms", executable, "TRANSFORM_ALLOCATION_LIMIT"],
    ["maxPreparedStates", executable, "SURFACE_STATE_LIMIT"],
    ["maxPreparedChanges", twoFrame, "STATE_CHANGE_LIMIT"],
    ["maxVisibilityCells", executable, "VISIBILITY_ALLOCATION_LIMIT"],
    ["maxEffectParticles", executable, "EFFECT_PARTICLE_LIMIT"],
    ["maxEffectSpawnTuples", executable, "EFFECT_STATE_LIMIT"],
    ["maxInteractionControls", executable, "INTERACTION_STATE_LIMIT"],
    ["maxInteractionObjects", executable, "INTERACTION_STATE_LIMIT"],
    ["maxInteractionVertices", executable, "INTERACTION_STATE_LIMIT"],
    ["maxInteractionWeights", executable, "INTERACTION_STATE_LIMIT"],
    ["maxInteractionWeightReferences", executable, "INTERACTION_STATE_LIMIT"],
    ["maxInteractionLeafRows", executable, "INTERACTION_STATE_LIMIT"],
  ];
  for (const [name, input, code] of cases) {
    assert.throws(
      () => buildDom(structuredClone(input), { limits: { [name]: 0 } }),
      errorCode(code),
      name,
    );
  }

  await assert.rejects(loadManifest(syntheticManifestPath, { limits: { maxManifestBytes: 0 } }), errorCode("MANIFEST_LIMIT"));
  await assert.rejects(loadManifest(syntheticManifestPath, { limits: { maxDecodedInputBytes: 0 } }), errorCode("MANIFEST_INPUT_LIMIT"));
  await assert.rejects(loadManifest(syntheticManifestPath, { limits: { maxAggregateDecodedBytes: 128 } }), errorCode("AGGREGATE_DECODED_LIMIT"));

  const excessiveNodeAttributes = structuredClone(basic);
  excessiveNodeAttributes.tree.nodes[1].attributes["data-extra"] = "present";
  assert.throws(() => buildDom(excessiveNodeAttributes, { limits: { maxAttributesPerNode: 1 } }), errorCode("ATTRIBUTE_COUNT_LIMIT"));

  const built = buildDom(basic);
  assert.throws(() => readDom(built.bytes, { limits: { maxResources: 1 } }), errorCode("RESOURCE_COUNT_LIMIT"));
  assert.doesNotThrow(() => readDom(built.bytes, {
    limits: {
      maxFileBytes: built.bytes.length,
      maxAggregateDecodedBytes: built.bytes.length,
    },
  }));
  assert.throws(() => readDom(built.bytes, { limits: { maxFileBytes: built.bytes.length - 1 } }), errorCode("FILE_LIMIT"));
  assert.throws(() => readDom(built.bytes, { limits: { maxAggregateDecodedBytes: built.bytes.length - 1 } }), errorCode("DOCUMENT_DECODED_LIMIT"));

  const covered = new Set([
    ...cases.map(([name]) => name),
    "maxFileBytes",
    "maxManifestBytes",
    "maxDecodedInputBytes",
    "maxAggregateDecodedBytes",
  ]);
  assert.deepEqual([...covered].sort(), Object.keys(DEFAULT_LIMITS).sort());
  assert.equal(Object.isFrozen(jsonStructureLimits(DEFAULT_LIMITS)), true);
});

test("declared transform counts cannot escape coded validation through array allocation", async () => {
  const input = await syntheticExecutableInteractionInput();
  input.state.channels.find((channel) => channel.codec === "polycss-playback-packed@0").data.packet.transforms.count = 2 ** 32;
  assert.throws(
    () => buildDom(input, { limits: { maxPreparedTransforms: 2 ** 32 } }),
    errorCode("TRANSFORM_GROUP_MISMATCH"),
  );
});

test("maximum uint16 variant palette and target closure stays linear and publishes sparsely", async () => {
  const built = buildDom(await syntheticAdapterTechniquesInput());
  const document = structuredClone(built.document);
  const count = 65_535;
  const classCount = 65_534;
  const classes = Array.from({ length: classCount }, (_, index) => `v${String(index).padStart(5, "0")}`);
  const targetIds = new Array(count);
  let sibling = 1 + Math.max(...document.tree.nodes.filter((node) => node.parent === -1).map((node) => node.sibling));
  for (let index = 0; index < count; index += 1) {
    const id = `synthetic-polycss/variant:${index}`;
    targetIds[index] = id;
    document.tree.nodes.push({
      attributes: { "aria-hidden": "true" },
      classes: index < classCount ? ["variant-target", classes[index]] : ["variant-target"],
      id,
      index: document.tree.nodes.length,
      name: "span",
      namespace: "http://www.w3.org/1999/xhtml",
      parent: -1,
      sibling: sibling++,
    });
  }
  document.meta.counts.nodes = document.tree.nodes.length;
  const binding = document.bindings.channels.find((channel) => channel.interpreter === "polycss-variants@0");
  binding.targets = { effectNodes: [], nodes: targetIds };
  const packet = document.state.channels.find((channel) => channel.codec === "polycss-variants-packed@0").data.packet;
  const indices = Array.from({ length: count }, (_, index) => index < classCount ? index : 65_535);
  packet.classes = classes;
  packet.effects = Array.from({ length: classCount }, (_, index) => ({ classIndex: index, ownerIndex: index, styles: { color: "#fff" }, targetIndex: 65_535 }));
  packet.initial.classIndicesBase64 = integerBase64(indices, 2);
  packet.sequential = {
    classIndicesBase64: integerBase64([0, 65_535], 2),
    offsetsBase64: integerBase64([0, 1, 2], 4),
    targetIndicesBase64: integerBase64([0, 0], 2),
  };
  Object.defineProperty(packet.classes, "includes", {
    configurable: true,
    value() { throw new Error("variant closure performed linear palette lookup"); },
  });
  assert.doesNotThrow(() => validateDocument(document));
  delete packet.classes.includes;

  const materialized = materializePolycssState(document.state);
  assert.equal(materialized.variants.initial.length, count);
  assert.equal(materialized.variants.sequentialTargets.length, 2);
  assert.equal("rows" in materialized.variants, false);
  const classWrites = [];
  const variantTarget = {
    style: {},
    classList: {
      add(token) { classWrites.push(["add", token]); },
      remove(token) { classWrites.push(["remove", token]); },
    },
  };
  const untouchedTarget = { style: {} };
  Object.defineProperty(untouchedTarget, "classList", {
    get() { throw new Error("sparse variant publication touched an unchanged target"); },
  });
  const variantNodes = new Array(count).fill(untouchedTarget);
  variantNodes[0] = variantTarget;
  const playbackTarget = { style: {} };
  const runtime = createPolycssPlayback(materialized, document.bindings, { byId: new Map() }, {
    publishAppearance() {},
    boundTargets: new Map([
      ["playback", { targets: { model: playbackTarget, shapes: [playbackTarget], leaves: [playbackTarget] } }],
      ["variants", { targets: { nodes: variantNodes } }],
    ]),
  });
  runtime.publishInitial();
  classWrites.splice(0);
  assert.equal(runtime.advance(), 2);
  assert.deepEqual(classWrites, [["remove", classes[0]]]);
  assert.equal(runtime.seek(1), 1);
  assert.deepEqual(classWrites, [["remove", classes[0]], ["add", classes[0]]]);

  const bytes = encodeCanonicalJson(document);
  await assert.doesNotReject(readDomNVersion(bytes, {
    externalResources: builtExternalResources(built),
    limits: { maxNodes: document.tree.nodes.length },
  }));
  const directory = await mkdtemp(join(tmpdir(), "domformat-max-variants-"));
  try {
    const model = join(directory, "model.json");
    await writeFile(model, bytes);
    for (const record of document.resources.resources) {
      const target = join(directory, record.path);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, built.externalResources.get(record.path));
    }
    const python = spawnSync("python3", ["-B", "conformance/reader.py", "validate", model], {
      cwd: PACKAGE_ROOT,
      encoding: "utf8",
      maxBuffer: 4 * 1024 * 1024,
    });
    assert.equal(python.status, 0, `${python.stdout}\n${python.stderr}`);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
