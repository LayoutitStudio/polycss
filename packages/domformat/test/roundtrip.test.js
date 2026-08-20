import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { buildDom } from "../src/writer.js";
import { readDom } from "../src/reader.js";
import { inspection } from "../src/inspect.js";
import { sha256Hex } from "../src/hash.js";
import { decodeJson, encodeCanonicalJson } from "../src/canonical-json.js";
import { builtExternalResources, errorCode, syntheticAdapterTechniquesInput, syntheticInput, syntheticPagedPlaybackInput, syntheticPagedVariantsInput, syntheticPolycssInput } from "./helpers.js";

function foreignArrayBuffer(bytes) {
  const context = vm.createContext({ values: [...bytes] });
  return vm.runInContext("Uint8Array.from(values).buffer", context);
}

test("JSON writer is deterministic and round-trips every semantic section with sibling resources", async () => {
  const input = await syntheticInput();
  const first = buildDom(input);
  const second = buildDom(input);
  assert.deepEqual(first.bytes, second.bytes);
  const result = readDom(first.bytes, { externalResources: builtExternalResources(first), requireResources: true });
  assert.deepEqual(result.document.tree, input.tree);
  assert.deepEqual(result.document.state, input.state);
  assert.deepEqual(result.document.bindings, input.bindings);
  assert.equal(result.document.meta.format, "domformat@0");
  assert.equal(result.document.meta.profile, "polycss-3d@0");
  assert.equal("packaging" in result.document.meta, false);
  assert.equal("payloads" in result.document, false);
  assert.equal(result.document.meta.generator.version, "0.0.0");
  assert.equal(result.document.resources.resources.every((record) => typeof record.path === "string" && !("storage" in record)), true);
  assert.equal(result.resourceBytes.size, 2);
  assert.match(sha256Hex(first.bytes), /^[0-9a-f]{64}$/u);
  const summary = inspection(result);
  assert.equal(summary.tree.nodes, 3);
  assert.equal(summary.allResourcesVerified, true);
  assert.throws(() => readDom(first.bytes, { externalResources: new Map(), requireResources: true }), errorCode("MISSING_EXTERNAL_RESOURCE"));
  assert.equal(Object.isFrozen(result.document), true);
  assert.equal(Object.isFrozen(result.document.tree.nodes[0].styles), true);
  assert.throws(() => { result.document.tree.nodes[0].styles.position = "fixed"; }, TypeError);
});

test("writer returns the same canonical Unicode document carried by its bytes", async () => {
  const input = await syntheticInput();
  input.meta.title = "Cafe\u0301 retained model";
  const built = buildDom(input);
  const read = readDom(built.bytes, { externalResources: builtExternalResources(built), requireResources: true });
  assert.equal(built.document.meta.title, "Café retained model");
  assert.deepEqual(built.document, read.document);
});

test("multi-artifact identity and separately inert claims round-trip canonically", async () => {
  const input = await syntheticInput();
  input.meta.artifacts = [
    { id: "disc-image", role: "distribution", byteLength: 734003200, decodedByteLength: 734003200, digest: { algorithm: "sha256", value: "a".repeat(64) } },
    { id: "scene-config", role: "configuration", byteLength: 124, decodedByteLength: 124, digest: { algorithm: "sha256", value: "b".repeat(64) } },
  ];
  input.meta.claims = [
    { artifact: "disc-image", kind: "qualification", value: "capture-complete-unqualified" },
    { artifact: "scene-config", kind: "license", value: "asserted-by-producer" },
    { artifact: "scene-config", kind: "qualification", value: "source-verified" },
    { artifact: "scene-config", kind: "revision", value: "4e63df42885bb439b6889cc81fb112504971ca1b" },
  ];
  const first = buildDom(input);
  const second = buildDom(input);
  assert.deepEqual(first.bytes, second.bytes);
  const read = readDom(first.bytes, { externalResources: builtExternalResources(first), requireResources: true });
  assert.deepEqual(read.document.meta.artifacts, input.meta.artifacts);
  assert.deepEqual(read.document.meta.claims, input.meta.claims);
  assert.equal("sourceArtifact" in read.document.meta, false);
});

test("identity and gzip state pages round-trip with exact encoded and decoded identities", async () => {
  for (const encoding of ["identity", "gzip"]) {
    const built = buildDom(await syntheticPagedVariantsInput(encoding));
    const pages = built.document.resources.resources.filter((record) => record.kind === "state-page");
    assert.equal(pages.length, 4);
    assert.equal(pages.every((record) => record.encoding === encoding && record.decodedByteLength > 0 && /^[0-9a-f]{64}$/u.test(record.decodedDigest.value)), true);
    if (encoding === "identity") assert.equal(pages.every((record) => record.byteLength === record.decodedByteLength && record.digest.value === record.decodedDigest.value), true);
    else assert.equal(pages.every((record) => record.byteLength < record.decodedByteLength && record.digest.value !== record.decodedDigest.value), true);
    const read = readDom(built.bytes, { externalResources: builtExternalResources(built), requireResources: true });
    assert.deepEqual(read.document.state, built.document.state);
    assert.equal(read.externalMissing.length, 0);
  }
});

test("file reader rejects paged playback initial pages that disagree with TREE", async () => {
  const built = buildDom(await syntheticPagedPlaybackInput());
  const document = decodeJson(built.bytes);
  const binding = document.bindings.channels.find((channel) => channel.interpreter === "polycss-paged-playback@0");
  document.tree.nodes.find((node) => node.id === binding.targets.model).styles.transform = `${binding.parameters.baseSceneTransform} matrix3d(1,0,0,0,0,1,0,0,0,0,1,0,1,0,0,1)`;
  assert.throws(() => readDom(encodeCanonicalJson(document), { externalResources: builtExternalResources(built), requireResources: true }), errorCode("STATE_PAGE_INITIAL_MISMATCH"));
});

test("inspection reports paged playback tables and both state-page identities", async () => {
  const built = buildDom(await syntheticPagedPlaybackInput({ encoding: "gzip", variants: true }));
  const read = readDom(built.bytes, { externalResources: builtExternalResources(built), requireResources: true });
  const summary = inspection(read);
  const playback = summary.state.channels.find((channel) => channel.codec === "polycss-paged-playback@0");
  assert.deepEqual(playback.details, {
    frames: 8,
    shapes: 2,
    leaves: 2,
    pages: 4,
    transforms: 16,
    shapeChanges: 0,
    leafChanges: 0,
    materializedBytes: 344,
  });
  const pages = summary.resources.filter((resource) => resource.kind === "state-page");
  assert.equal(pages.length, 8);
  assert.equal(pages.every((resource) => ["polycss-paged-playback-page@0", "polycss-paged-variants-page@0"].includes(resource.codec)
    && resource.encoding === "gzip" && resource.decodedBytes > 0 && /^[0-9a-f]{64}$/u.test(resource.decodedDigest)), true);
});

test("state-page encoded and decoded corruption fails before page use", async () => {
  const built = buildDom(await syntheticPagedVariantsInput("gzip"));
  const external = builtExternalResources(built);
  const encoded = new Map([...external].map(([id, bytes]) => [id, bytes.slice()]));
  encoded.get("variant-page-1")[0] ^= 1;
  assert.throws(() => readDom(built.bytes, { externalResources: encoded, requireResources: true }), errorCode("RESOURCE_DIGEST_MISMATCH"));

  const document = decodeJson(built.bytes);
  document.resources.resources.find((record) => record.id === "variant-page-1").decodedDigest.value = "0".repeat(64);
  assert.throws(
    () => readDom(encodeCanonicalJson(document), { externalResources: external, requireResources: true }),
    errorCode("STATE_PAGE_DECODED_DIGEST_MISMATCH"),
  );
});

test("writer deeply freezes the canonical document carried by its bytes", async () => {
  const built = buildDom(await syntheticInput());
  assert.equal(Object.isFrozen(built.document), true);
  assert.equal(Object.isFrozen(built.document.meta), true);
  assert.equal(Object.isFrozen(built.document.tree), true);
  assert.equal(Object.isFrozen(built.document.tree.nodes), true);
  assert.equal(Object.isFrozen(built.document.tree.nodes[0]), true);
  assert.throws(() => { built.document.meta.title = "mutated"; }, TypeError);
  assert.throws(() => { built.document.tree.nodes.push({}); }, TypeError);
});

test("canonical JSON rejects sparse arrays and non-plain host objects", () => {
  const sparse = [];
  sparse.length = 1;
  assert.throws(() => encodeCanonicalJson(sparse), errorCode("INVALID_JSON_ARRAY"));
  assert.throws(() => encodeCanonicalJson(new Date(0)), errorCode("INVALID_JSON_OBJECT"));
});

test("writer rejects non-plain records and invalid resource ids before sorting", async () => {
  assert.throws(() => buildDom(new Date(0)), errorCode("INVALID_DOCUMENT_INPUT"));

  const record = await syntheticInput();
  record.resourceInputs[0] = new Date(0);
  assert.throws(() => buildDom(record), errorCode("INVALID_RESOURCE_INPUT"));

  const id = await syntheticInput();
  id.resourceInputs[0].id = { toString() { throw new Error("must not coerce"); } };
  assert.throws(() => buildDom(id), errorCode("INVALID_RESOURCE_ID"));
});

test("writer binds external bytes by size and digest", async () => {
  const input = await syntheticInput();
  const built = buildDom(input);
  assert.equal(built.externalResources.size, 2);
  const external = builtExternalResources(built);
  const result = readDom(built.bytes, { externalResources: external, requireResources: true });
  assert.deepEqual(result.externalMissing, []);
  assert.throws(() => readDom(built.bytes, { externalResources: { checker: new Uint8Array() } }), errorCode("INVALID_EXTERNAL_RESOURCES"));
  assert.throws(() => readDom(built.bytes, { externalResources: new Map([["undeclared", new Uint8Array()]]) }), errorCode("UNEXPECTED_EXTERNAL_RESOURCE"));
  assert.throws(() => readDom(built.bytes, { externalResources: new Map([["checker", "not bytes"]]) }), errorCode("INVALID_RESOURCE_BYTES"));
});

test("writer copies caller-owned resource bytes before validation and publication", async () => {
  const input = await syntheticInput();
  const source = input.resourceInputs[0].bytes;
  const built = buildDom(input);
  const before = builtExternalResources(built).get(input.resourceInputs[0].id).slice();
  source.fill(0);
  assert.deepEqual(builtExternalResources(built).get(input.resourceInputs[0].id), before);
  assert.equal(readDom(built.bytes, { externalResources: builtExternalResources(built), requireResources: true }).resourceBytes.size, 2);
});

test("writer accepts and copies the exact bytes selected by an ArrayBufferView", async () => {
  const input = await syntheticInput();
  const resource = input.resourceInputs[0];
  const expected = Uint8Array.from(resource.bytes);
  const padding = 7;
  const storage = new Uint8Array(expected.length + padding * 2);
  storage.fill(0xa5);
  storage.set(expected, padding);
  resource.bytes = new DataView(storage.buffer, padding, expected.length);

  const built = buildDom(input);
  assert.deepEqual(built.externalResources.get(resource.path), expected);
  storage.fill(0);
  assert.deepEqual(built.externalResources.get(resource.path), expected);
});

test("writer and Node reader accept raw ArrayBuffers from another realm", async () => {
  const input = await syntheticInput();
  for (const resource of input.resourceInputs) resource.bytes = foreignArrayBuffer(resource.bytes);
  const built = buildDom(input);
  const resources = new Map([...builtExternalResources(built)].map(([id, bytes]) => [id, foreignArrayBuffer(bytes)]));
  const result = readDom(foreignArrayBuffer(built.bytes), { externalResources: resources, requireResources: true });
  assert.equal(result.resourceBytes.size, 2);
});

test("executable PolyCSS fixture is deterministic and remains fully executable", async () => {
  const input = await syntheticPolycssInput();
  const first = buildDom(input);
  const second = buildDom(input);
  assert.deepEqual(first.bytes, second.bytes);
  const read = readDom(first.bytes, { externalResources: builtExternalResources(first), requireResources: true });
  assert.equal(read.document.tree.nodes.length, 8);
  assert.deepEqual(read.document.state.channels.map((channel) => channel.codec), [
    "polycss-effects-prepared@0",
    "polycss-playback-packed@0",
    "static-presentation@0",
    "polycss-surface-packed@0",
  ]);
});

test("prepared two-axis positions retain their packed dictionary through canonical round-trip", async () => {
  const input = await syntheticAdapterTechniquesInput();
  const built = buildDom(input);
  const read = readDom(built.bytes, { externalResources: builtExternalResources(built), requireResources: true });
  const packing = read.document.state.channels.find((channel) => channel.id === "surface").data.packet.surface.statePacking;
  assert.deepEqual(packing.positionDictionary, [[-16, -16], [0, 0]]);
  assert.equal(packing.positionIndicesBase64, "AQAAAA==");
  assert.equal("backgroundPositions" in packing, false);
  assert.deepEqual(read.document.state, built.document.state);
});
