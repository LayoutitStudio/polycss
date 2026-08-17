import test from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { mountDom, readDomBrowser } from "../src/browser.js";
import { buildDom } from "../src/writer.js";
import { mountConformanceDom } from "../conformance/viewer/mount.js";
import {
  builtExternalResources,
  projectRoot,
  syntheticAdapterTechniquesInput,
  syntheticExecutableInteractionInput,
  syntheticHiddenPlaybackInput,
  syntheticPolycssInput,
  syntheticStaticPresentationInput,
  syntheticTwoFramePolycssInput,
} from "./helpers.js";
import { dispatch, FakeElement, fakeBrowserDocument } from "./fake-browser.js";

const STYLE_PROPERTIES = Object.freeze([
  "backgroundColor", "backgroundImage", "backgroundPosition", "backgroundPositionY",
  "backgroundRepeat", "backgroundSize", "border", "borderBottomLeftRadius",
  "borderBottomRightRadius", "borderShape", "borderTopLeftRadius", "borderTopRightRadius",
  "boxSizing", "color", "contain", "cornerBottomLeftShape", "cornerBottomRightShape",
  "cornerTopLeftShape", "cornerTopRightShape", "display",
  "height", "inset", "isolation", "left", "margin", "maxWidth", "objectFit",
  "objectPosition", "opacity", "overflow", "padding", "perspective", "perspectiveOrigin",
  "pointerEvents", "position", "top", "transform", "transformOrigin", "transformStyle",
  "visibility", "width", "zIndex",
]);
const SHARED_RUNTIME_IMPORTS = Object.freeze([
  "browser-input.js",
  "errors.js",
  "lifecycle.js",
  "state/effects.js",
  "state/interaction.js",
  "state/polycss.js",
  "state/presentation.js",
]);

function resourceUrls(result, fake) {
  const ids = result.document.resources.resources.filter((record) => record.kind !== "stylesheet").map((record) => record.id);
  return new Map(ids.map((id, index) => [id, fake.urls.created[index]]));
}

function normalize(value, urls) {
  if (typeof value !== "string") return value;
  let output = value;
  for (const [id, url] of urls) output = output.split(url).join(`dom-resource:${id}`);
  return output;
}

function styles(element, urls) {
  return Object.fromEntries(STYLE_PROPERTIES
    .map((property) => [property, normalize(element.style[property], urls)])
    .filter(([, value]) => value !== undefined && value !== ""));
}

function referenceSnapshot(result, host, fake) {
  const surface = host.childNodes[0];
  const elements = fake.namespaced;
  const urls = resourceUrls(result, fake);
  return {
    mount: {
      attributes: result.document.tree.mount.attributes.map(([name]) => [name, surface.getAttribute(name)]),
      styles: styles(surface, urls),
    },
    nodes: result.document.tree.nodes.map((node) => {
      const element = elements[node.index];
      const parent = element.parentNode === surface ? -1 : elements.indexOf(element.parentNode);
      const attributeNames = [...Object.keys(node.attributes ?? {}), ...Object.keys(node.resourceAttributes ?? {})].sort();
      return {
        id: node.id,
        index: node.index,
        parent,
        sibling: element.parentNode.childNodes.indexOf(element),
        namespace: element.namespaceURI,
        name: element.localName,
        classes: [...element.classes],
        attributes: Object.fromEntries(attributeNames.map((name) => [name, normalize(element.getAttribute(name), urls)])),
        styles: styles(element, urls),
      };
    }),
  };
}

function normalizedCss(result, fake) {
  const urls = resourceUrls(result, fake);
  return fake.document.head.childNodes.map((element) => {
    let text = normalize(element.textContent, urls);
    text = text.replace(/\[data-domformat-instance="[^"]+"\]/gu, "[data-domformat-instance=INSTANCE]");
    return text;
  });
}

function normalizedWrites(result, host, fake) {
  const surface = host.childNodes[0];
  const urls = resourceUrls(result, fake);
  return fake.writes.flatMap(({ element, property, value }) => {
    if (element === surface) return [["$host", property, normalize(value, urls)]];
    const index = fake.namespaced.indexOf(element);
    if (index < 0) return [];
    return [[result.document.tree.nodes[index].id, property, normalize(value, urls)]];
  });
}

function clearWrites(...fakes) {
  for (const fake of fakes) fake.writes.splice(0);
}

async function mountedPair(input, options = {}) {
  const built = buildDom(input);
  const result = await readDomBrowser(built.bytes, { externalResources: builtExternalResources(built) });
  const reference = fakeBrowserDocument();
  const alternate = fakeBrowserDocument();
  const referenceHost = new FakeElement(reference.document, "main");
  const alternateHost = new FakeElement(alternate.document, "main");
  const referencePhases = [];
  const alternatePhases = [];
  const referenceRuntime = await mountDom(result, referenceHost, {
    animate: options.animate ?? false,
    mode: options.mode,
    onLifecyclePhase: (phase) => referencePhases.push(phase),
  });
  const alternateRuntime = await mountConformanceDom(result, alternateHost, {
    animate: options.animate ?? false,
    mode: options.mode,
    onLifecyclePhase: (phase) => alternatePhases.push(phase),
  });
  return {
    result,
    reference,
    alternate,
    referenceHost,
    alternateHost,
    referencePhases,
    alternatePhases,
    referenceRuntime,
    alternateRuntime,
  };
}

function assertEquivalent(value, label) {
  assert.deepEqual(value.alternateRuntime.snapshot(), referenceSnapshot(value.result, value.referenceHost, value.reference), label);
  assert.deepEqual(normalizedCss(value.result, value.alternate), normalizedCss(value.result, value.reference), `${label}: CSS closure`);
}

test("alternate mount shell has one mechanically enforced shared-interpreter boundary", async () => {
  const directory = resolve(projectRoot, "conformance/viewer");
  assert.deepEqual((await readdir(directory)).sort(), ["mount.js"]);
  const source = await readFile(resolve(directory, "mount.js"), "utf8");
  const imports = [...source.matchAll(/from\s+"\.\.\/\.\.\/dist\/([^"]+)"/gu)].map((match) => match[1]).sort();
  assert.deepEqual(imports, [...SHARED_RUNTIME_IMPORTS].sort());
  assert.doesNotMatch(source, /\b(?:eval|Function)\s*\(/u);
  assert.doesNotMatch(source, /\.innerHTML\s*=/u);
});

test("alternate viewer reconstructs the exact stable tree, initial publication, CSS closure, and lifecycle", async () => {
  const value = await mountedPair(await syntheticPolycssInput());
  assert.deepEqual(value.alternatePhases, value.referencePhases);
  assert.deepEqual(value.alternatePhases, ["validate", "construct", "bind", "initialize", "publish"]);
  assertEquivalent(value, "initial publication");
  assert.deepEqual(
    normalizedWrites(value.result, value.alternateHost, value.alternate),
    normalizedWrites(value.result, value.referenceHost, value.reference),
    "initial DOM write transcript",
  );

  const identities = new Map(value.result.document.tree.nodes.map((node) => [node.id, value.alternateRuntime.node(node.id)]));
  value.alternateRuntime.advance();
  for (const [id, element] of identities) assert.equal(value.alternateRuntime.node(id), element, `identity ${id}`);

  assert.equal(value.referenceRuntime.destroy(), true);
  assert.equal(value.alternateRuntime.destroy(), true);
  assert.equal(value.referenceRuntime.destroy(), false);
  assert.equal(value.alternateRuntime.destroy(), false);
  assert.deepEqual(value.alternatePhases, value.referencePhases);
  assert.deepEqual(value.alternatePhases, ["validate", "construct", "bind", "initialize", "publish", "destroy"]);
  assert.equal(value.referenceHost.childNodes.length, 0);
  assert.equal(value.alternateHost.childNodes.length, 0);
});

test("initial playback preserves an identical TREE scene transform without reassigning it", async () => {
  const value = await mountedPair(await syntheticPolycssInput());
  for (const [label, host, fake] of [
    ["public", value.referenceHost, value.reference],
    ["alternate", value.alternateHost, value.alternate],
  ]) {
    const writes = normalizedWrites(value.result, host, fake).filter(([id, property]) => (
      id === "synthetic-polycss/model" && property === "transform"
    ));
    assert.deepEqual(writes, [["synthetic-polycss/model", "transform", "translate3d(0px, 0px, 0px)"]], label);
  }
  value.referenceRuntime.destroy();
  value.alternateRuntime.destroy();
});

test("alternate and public viewers agree on static presentation without playback or effects", async () => {
  const value = await mountedPair(await syntheticStaticPresentationInput());
  assertEquivalent(value, "static presentation");
  assert.equal(value.referenceRuntime.sourceFrame, 1);
  assert.equal(value.alternateRuntime.sourceFrame, 1);
  assert.equal(value.referenceRuntime.seek(1), 1);
  assert.equal(value.alternateRuntime.seek(1), 1);
  assert.throws(() => value.referenceRuntime.seek(2), (error) => error?.code === "FRAME_RANGE");
  assert.throws(() => value.alternateRuntime.seek(2), (error) => error?.code === "FRAME_RANGE");
  value.referenceRuntime.destroy();
  value.alternateRuntime.destroy();
});

test("alternate CSS materialization rewrites URL tokens but not url-like text inside strings", async () => {
  const input = await syntheticPolycssInput();
  const stylesheet = input.resourceInputs.find((resource) => resource.id === "model-css");
  const scope = input.cssBinding.stylesheets[0].scope;
  const css = new TextDecoder().decode(stylesheet.bytes);
  stylesheet.bytes = new TextEncoder().encode(`${css}\n${scope} .leaf{font:"url(dom-asset:checker)";}`);
  const value = await mountedPair(input);
  assertEquivalent(value, "CSS string token isolation");
  const materialized = normalizedCss(value.result, value.alternate).join("\n");
  assert.match(materialized, /font:"url\(dom-asset:checker\)"/u);
  value.referenceRuntime.destroy();
  value.alternateRuntime.destroy();
});

test("alternate and public viewers publish identical ordered animation transitions and wrap", async () => {
  const value = await mountedPair(await syntheticTwoFramePolycssInput(), { animate: true });
  assertEquivalent(value, "animation initial");
  clearWrites(value.reference, value.alternate);

  assert.equal(value.reference.frame(0), 1);
  assert.equal(value.alternate.frame(0), 1);
  assert.deepEqual(normalizedWrites(value.result, value.alternateHost, value.alternate), normalizedWrites(value.result, value.referenceHost, value.reference));
  clearWrites(value.reference, value.alternate);

  value.reference.frame(34);
  value.alternate.frame(34);
  assertEquivalent(value, "animation frame 2");
  assert.deepEqual(
    normalizedWrites(value.result, value.alternateHost, value.alternate),
    normalizedWrites(value.result, value.referenceHost, value.reference),
    "frame 1 to 2 write order",
  );
  clearWrites(value.reference, value.alternate);

  value.reference.frame(68);
  value.alternate.frame(68);
  assertEquivalent(value, "animation wrap to frame 1");
  assert.deepEqual(
    normalizedWrites(value.result, value.alternateHost, value.alternate),
    normalizedWrites(value.result, value.referenceHost, value.reference),
    "frame 2 to 1 write order",
  );
  value.referenceRuntime.destroy();
  value.alternateRuntime.destroy();
});

test("prepared atlas addresses and class variants publish without replacing retained nodes", async () => {
  const value = await mountedPair(await syntheticAdapterTechniquesInput());
  const referenceLeaf = value.reference.namespaced[2];
  const alternateLeaf = value.alternateRuntime.node("synthetic-polycss/leaf");
  const identities = [referenceLeaf, alternateLeaf];

  assert.equal(referenceLeaf.style.backgroundPosition, "0px 0px");
  assert.deepEqual(referenceLeaf.classes, ["leaf", "material-a"]);
  value.referenceRuntime.seek(2);
  value.alternateRuntime.seek(2);
  assert.equal(value.reference.namespaced[2], identities[0]);
  assert.equal(value.alternateRuntime.node("synthetic-polycss/leaf"), identities[1]);
  assert.equal(referenceLeaf.style.backgroundPosition, "-16px -16px");
  assert.deepEqual(referenceLeaf.classes, ["leaf", "material-b"]);
  assertEquivalent(value, "prepared adapter techniques frame 2");

  value.referenceRuntime.seek(1);
  value.alternateRuntime.seek(1);
  assert.equal(referenceLeaf.style.backgroundPosition, "0px 0px");
  assert.deepEqual(referenceLeaf.classes, ["leaf", "material-a"]);
  assertEquivalent(value, "prepared adapter techniques wrap");
  value.referenceRuntime.destroy();
  value.alternateRuntime.destroy();
});

test("alternate and public viewers defer hidden transforms until an explicit publication boundary", async () => {
  const value = await mountedPair(await syntheticHiddenPlaybackInput(), { animate: true, mode: "animation" });
  const leafIndex = value.result.document.tree.nodes.findIndex((node) => node.id === "synthetic/leaf");
  const referenceLeaf = value.reference.namespaced[leafIndex];
  const alternateLeaf = value.alternateRuntime.node("synthetic/leaf");
  const referenceIdentity = referenceLeaf;
  const alternateIdentity = alternateLeaf;
  const initialTransform = referenceLeaf.style.transform;
  const leafWrites = (host, fake) => normalizedWrites(value.result, host, fake)
    .filter(([id, property]) => id === "synthetic/leaf" && (property === "transform" || property === "visibility"));

  value.reference.frame(0);
  value.alternate.frame(0);
  clearWrites(value.reference, value.alternate);

  value.reference.frame(34);
  value.alternate.frame(34);
  assert.equal(value.referenceRuntime.sourceFrame, 2);
  assert.equal(value.alternateRuntime.sourceFrame, 2);
  assert.equal(referenceLeaf.style.transform, initialTransform);
  assert.equal(alternateLeaf.style.transform, initialTransform);
  assert.deepEqual(leafWrites(value.referenceHost, value.reference), []);
  assert.deepEqual(leafWrites(value.alternateHost, value.alternate), []);
  assertEquivalent(value, "hidden automatic playback");

  clearWrites(value.reference, value.alternate);
  assert.equal(value.referenceRuntime.seek(2), 2);
  assert.equal(value.alternateRuntime.seek(2), 2);
  const synchronizedReferenceWrites = leafWrites(value.referenceHost, value.reference);
  const synchronizedAlternateWrites = leafWrites(value.alternateHost, value.alternate);
  assert.deepEqual(synchronizedAlternateWrites, synchronizedReferenceWrites);
  assert.equal(synchronizedReferenceWrites.length, 1);
  assert.equal(synchronizedReferenceWrites[0][1], "transform");
  assertEquivalent(value, "same-frame public synchronization");

  clearWrites(value.reference, value.alternate);
  value.referenceRuntime.seek(2);
  value.alternateRuntime.seek(2);
  assert.deepEqual(leafWrites(value.referenceHost, value.reference), []);
  assert.deepEqual(leafWrites(value.alternateHost, value.alternate), []);

  value.reference.frame(68);
  value.alternate.frame(68);
  clearWrites(value.reference, value.alternate);
  value.reference.frame(102);
  value.alternate.frame(102);
  assert.deepEqual(leafWrites(value.alternateHost, value.alternate), leafWrites(value.referenceHost, value.reference));
  assert.deepEqual(leafWrites(value.referenceHost, value.reference).map(([, property]) => property), ["transform", "visibility"]);
  assert.equal(referenceLeaf.style.visibility, "visible");
  assert.equal(alternateLeaf.style.visibility, "visible");
  assert.equal(value.reference.namespaced[leafIndex], referenceIdentity);
  assert.equal(value.alternateRuntime.node("synthetic/leaf"), alternateIdentity);
  assertEquivalent(value, "flush before reveal");

  assert.equal(value.referenceRuntime.destroy(), true);
  assert.equal(value.alternateRuntime.destroy(), true);
  assert.equal(value.referenceRuntime.destroy(), false);
  assert.equal(value.alternateRuntime.destroy(), false);
});

test("entering interaction mode synchronizes deferred hidden transforms in both viewers", async () => {
  const value = await mountedPair(await syntheticHiddenPlaybackInput(), { animate: true, mode: "animation" });
  value.reference.frame(0);
  value.alternate.frame(0);
  value.reference.frame(34);
  value.alternate.frame(34);
  clearWrites(value.reference, value.alternate);

  assert.equal(value.referenceRuntime.setMode("interaction"), "interaction");
  assert.equal(value.alternateRuntime.setMode("interaction"), "interaction");
  const referenceWrites = normalizedWrites(value.result, value.referenceHost, value.reference)
    .filter(([id, property]) => id === "synthetic/leaf" && property === "transform");
  const alternateWrites = normalizedWrites(value.result, value.alternateHost, value.alternate)
    .filter(([id, property]) => id === "synthetic/leaf" && property === "transform");
  assert.deepEqual(alternateWrites, referenceWrites);
  assert.equal(referenceWrites.length, 1);
  assertEquivalent(value, "interaction mode synchronization");
  value.referenceRuntime.destroy();
  value.alternateRuntime.destroy();
});

test("alternate and public viewers catch up every due fixed-rate playback tick", async () => {
  const value = await mountedPair(await syntheticTwoFramePolycssInput(), { animate: true });
  value.reference.frame(0);
  value.alternate.frame(0);
  clearWrites(value.reference, value.alternate);

  value.reference.frame(68);
  value.alternate.frame(68);
  assert.equal(value.referenceRuntime.sourceFrame, 1);
  assert.equal(value.alternateRuntime.sourceFrame, 1);
  assertEquivalent(value, "two-tick RAF catch-up");
  assert.deepEqual(
    normalizedWrites(value.result, value.alternateHost, value.alternate),
    normalizedWrites(value.result, value.referenceHost, value.reference),
    "two-tick RAF catch-up write order",
  );
  value.referenceRuntime.destroy();
  value.alternateRuntime.destroy();
});

test("eight due scheduler ticks catch up while the ninth is a suspension", async () => {
  for (const [timestamp, expectedFrame, label] of [
    [267, 1, "eight due ticks"],
    [300, 2, "nine due ticks"],
  ]) {
    const value = await mountedPair(await syntheticTwoFramePolycssInput(), { animate: true });
    value.reference.frame(0);
    value.alternate.frame(0);
    value.reference.frame(timestamp);
    value.alternate.frame(timestamp);
    assert.equal(value.referenceRuntime.sourceFrame, expectedFrame, `${label} reference boundary`);
    assert.equal(value.alternateRuntime.sourceFrame, expectedFrame, `${label} alternate boundary`);
    assertEquivalent(value, label);
    value.referenceRuntime.destroy();
    value.alternateRuntime.destroy();
  }
});

test("alternate and public viewers drop a suspended scheduler backlog", async () => {
  const value = await mountedPair(await syntheticTwoFramePolycssInput(), { animate: true });
  value.reference.frame(0);
  value.alternate.frame(0);
  clearWrites(value.reference, value.alternate);

  value.reference.frame(60_000);
  value.alternate.frame(60_000);
  assert.equal(value.referenceRuntime.sourceFrame, 2);
  assert.equal(value.alternateRuntime.sourceFrame, 2);
  assertEquivalent(value, "suspended RAF advances one tick");

  value.reference.frame(60_001);
  value.alternate.frame(60_001);
  assert.equal(value.referenceRuntime.sourceFrame, 2);
  assert.equal(value.alternateRuntime.sourceFrame, 2);

  value.reference.frame(60_034);
  value.alternate.frame(60_034);
  assert.equal(value.referenceRuntime.sourceFrame, 1);
  assert.equal(value.alternateRuntime.sourceFrame, 1);
  assertEquivalent(value, "suspended RAF deadline reset");
  value.referenceRuntime.destroy();
  value.alternateRuntime.destroy();
});

test("interaction catch-up keeps every due tick separately published", async () => {
  const catchup = await mountedPair(await syntheticExecutableInteractionInput(), { animate: true, mode: "interaction" });
  const sequential = await mountedPair(await syntheticExecutableInteractionInput(), { animate: true, mode: "interaction" });
  for (const value of [catchup, sequential]) {
    value.reference.frame(0);
    value.alternate.frame(0);
    clearWrites(value.reference, value.alternate);
  }

  catchup.reference.frame(68);
  catchup.alternate.frame(68);
  sequential.reference.frame(34);
  sequential.alternate.frame(34);
  sequential.reference.frame(68);
  sequential.alternate.frame(68);

  assert.deepEqual(
    normalizedWrites(catchup.result, catchup.referenceHost, catchup.reference),
    normalizedWrites(sequential.result, sequential.referenceHost, sequential.reference),
  );
  assert.deepEqual(
    normalizedWrites(catchup.result, catchup.alternateHost, catchup.alternate),
    normalizedWrites(sequential.result, sequential.alternateHost, sequential.alternate),
  );
  assertEquivalent(catchup, "interaction two-tick catch-up");
  assertEquivalent(sequential, "interaction sequential ticks");
  for (const value of [catchup, sequential]) {
    value.referenceRuntime.destroy();
    value.alternateRuntime.destroy();
  }
});

test("public seek invalidates sparse interaction publication for the next tick", async () => {
  const value = await mountedPair(await syntheticExecutableInteractionInput(), { animate: true, mode: "interaction" });
  const eyeIndex = value.result.document.tree.nodes.findIndex((node) => node.id === "synthetic/eye-leaf");
  const referenceEye = value.reference.namespaced[eyeIndex];
  const alternateEye = value.alternateRuntime.node("synthetic/eye-leaf");
  const interactionTransform = referenceEye.style.transform;
  assert.equal(alternateEye.style.transform, interactionTransform);

  const frame = value.referenceRuntime.sourceFrame;
  assert.equal(value.referenceRuntime.seek(frame), frame);
  assert.equal(value.alternateRuntime.seek(frame), frame);
  const preparedTransform = referenceEye.style.transform;
  assert.notEqual(preparedTransform, interactionTransform);
  assert.equal(alternateEye.style.transform, preparedTransform);

  value.reference.frame(0);
  value.alternate.frame(0);
  value.reference.frame(34);
  value.alternate.frame(34);
  assert.equal(referenceEye.style.transform, interactionTransform);
  assert.equal(alternateEye.style.transform, interactionTransform);
  assertEquivalent(value, "interaction republish after seek");
  value.referenceRuntime.destroy();
  value.alternateRuntime.destroy();
});

test("alternate and public viewers agree through pointer pick, drag, release, effects, and mode reset", async () => {
  const value = await mountedPair(await syntheticExecutableInteractionInput(), { animate: true, mode: "interaction" });
  assertEquivalent(value, "interaction initial");
  const initialFrame = value.referenceRuntime.sourceFrame;
  assert.equal(value.referenceRuntime.seek(2), 2);
  assert.equal(value.alternateRuntime.seek(2), 2);
  assertEquivalent(value, "interaction explicit seek");
  assert.equal(value.referenceRuntime.seek(initialFrame), initialFrame);
  assert.equal(value.alternateRuntime.seek(initialFrame), initialFrame);
  assertEquivalent(value, "interaction seek restore");
  const alternateIdentities = new Map(value.result.document.tree.nodes.map((node) => [node.id, value.alternateRuntime.node(node.id)]));
  value.reference.frame(0);
  value.alternate.frame(0);
  clearWrites(value.reference, value.alternate);

  const events = [
    ["pointerdown", { button: 0, pointerId: 1, clientX: 160, clientY: 120 }],
    ["pointermove", { pointerId: 1, clientX: 170, clientY: 120 }],
    ["pointermove", { pointerId: 1, clientX: 180, clientY: 125 }],
    ["pointerup", { button: 0, pointerId: 1, clientX: 180, clientY: 125 }],
  ];
  let timestamp = 34;
  for (const [name, event] of events) {
    dispatch(value.referenceHost, name, event);
    dispatch(value.alternateHost, name, event);
    value.reference.frame(timestamp);
    value.alternate.frame(timestamp);
    assertEquivalent(value, `interaction ${name}`);
    assert.deepEqual(
      normalizedWrites(value.result, value.alternateHost, value.alternate),
      normalizedWrites(value.result, value.referenceHost, value.reference),
      `${name} write order`,
    );
    clearWrites(value.reference, value.alternate);
    timestamp += 34;
  }
  for (const [id, element] of alternateIdentities) assert.equal(value.alternateRuntime.node(id), element, `interaction identity ${id}`);

  assert.equal(value.referenceRuntime.setMode("animation"), "animation");
  assert.equal(value.alternateRuntime.setMode("animation"), "animation");
  assertEquivalent(value, "interaction teardown to animation");
  assert.deepEqual(
    normalizedWrites(value.result, value.alternateHost, value.alternate),
    normalizedWrites(value.result, value.referenceHost, value.reference),
    "mode reset write order",
  );
  value.referenceRuntime.destroy();
  value.alternateRuntime.destroy();
});

test("alternate and public viewers pick through a nonidentity presentation appearance", async () => {
  const input = await syntheticExecutableInteractionInput();
  input.state.channels.find((channel) => channel.id === "playback").data.packet.appearances[0] = ["zoomed", 2, 50];
  const value = await mountedPair(input, { animate: true, mode: "interaction" });
  const cursorIndex = value.result.document.tree.nodes.findIndex((node) => node.id === "synthetic/cursor");
  const leafIndex = value.result.document.tree.nodes.findIndex((node) => node.id === "synthetic/leaf");
  assert.equal(value.reference.namespaced[cursorIndex].style.transform, "translate3d(160px, 170px, 0) scale(2)");
  assert.equal(value.alternate.namespaced[cursorIndex].style.transform, "translate3d(160px, 170px, 0) scale(2)");

  value.reference.frame(0);
  value.alternate.frame(0);
  dispatch(value.referenceHost, "pointerdown", { button: 0, pointerId: 1, clientX: 160, clientY: 170 });
  dispatch(value.alternateHost, "pointerdown", { button: 0, pointerId: 1, clientX: 160, clientY: 170 });
  value.reference.frame(34);
  value.alternate.frame(34);
  const selectedTransform = value.reference.namespaced[leafIndex].style.transform;
  dispatch(value.referenceHost, "pointermove", { pointerId: 1, clientX: 180, clientY: 170 });
  dispatch(value.alternateHost, "pointermove", { pointerId: 1, clientX: 180, clientY: 170 });
  for (const timestamp of [68, 102]) {
    value.reference.frame(timestamp);
    value.alternate.frame(timestamp);
  }
  assert.notEqual(value.reference.namespaced[leafIndex].style.transform, selectedTransform);
  assertEquivalent(value, "interaction through presentation appearance");
  value.referenceRuntime.destroy();
  value.alternateRuntime.destroy();
});

test("alternate viewer rolls back partial phases and keeps destroy idempotent", async () => {
  const built = buildDom(await syntheticPolycssInput());
  const result = await readDomBrowser(built.bytes, { externalResources: builtExternalResources(built) });
  for (const failedPhase of ["construct", "bind", "publish"]) {
    const fake = fakeBrowserDocument();
    const host = new FakeElement(fake.document, "main");
    const prior = new FakeElement(fake.document, "p");
    host.appendChild(prior);
    const replaceChildren = host.replaceChildren.bind(host);
    let replacements = 0;
    host.replaceChildren = (...children) => {
      replacements += 1;
      return replaceChildren(...children);
    };
    host.style.position = "sticky";
    const phases = [];
    await assert.rejects(mountConformanceDom(result, host, {
      animate: false,
      onLifecyclePhase(phase) {
        phases.push(phase);
        if (phase === failedPhase) throw new Error(`injected ${failedPhase} failure`);
      },
    }), new RegExp(`injected ${failedPhase} failure`, "u"));
    assert.deepEqual(host.childNodes, [prior]);
    assert.equal(host.style.position, "sticky");
    assert.equal(host.hasAttribute("tabindex"), false);
    assert.equal(fake.document.head.childNodes.length, 0);
    assert.deepEqual(fake.urls.revoked, fake.urls.created);
    assert.equal(phases.at(-1), "destroy");
    assert.equal(replacements, failedPhase === "publish" ? 2 : 0);
  }
});
