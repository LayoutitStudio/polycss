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
  syntheticAspectProfileTimelinesInput,
  syntheticCompositorTimingInput,
  syntheticExecutableInteractionInput,
  syntheticEvictingPagedVariantsInput,
  syntheticExactTimingInput,
  syntheticHiddenPlaybackInput,
  syntheticOrbitInput,
  syntheticPagedAspectProfileTimelinesWithoutInteractionInput,
  syntheticPagedVariantsInput,
  syntheticProfileTimelinesInput,
  syntheticPreparedBanksInput,
  syntheticPagedPreparedBanksInput,
  syntheticPolycssInput,
  syntheticStaticPresentationInput,
  syntheticTwoFramePolycssInput,
  syntheticViewportProfilesInput,
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
  "pointerEvents", "position", "top", "transform", "transformOrigin", "transformStyle", "transition",
  "visibility", "width", "zIndex",
]);
const SHARED_RUNTIME_IMPORTS = Object.freeze([
  "internal-conformance.js",
]);

function resourceUrls(result, fake) {
  const ids = result.document.resources.resources.filter((record) => record.kind === "image").map((record) => record.id);
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

async function flushAsyncWork(turns = 8) {
  for (let turn = 0; turn < turns; turn += 1) await new Promise((resolve) => setImmediate(resolve));
}

// Both shells skip schedule() while a paged wait is pending, so the first window timer a shell arms
// after a page lands is its own signal that automatic catch-up finished draining. Counting
// event-loop turns instead would race that signal: a turn spin costs microseconds while the resume
// path waits on a libuv-threadpool SHA-256 digest of every loaded state page.
function whenSchedulerRearms(fake, message) {
  const schedule = fake.win.setTimeout;
  return new Promise((resolve, reject) => {
    const guard = setTimeout(() => { fake.win.setTimeout = schedule; reject(new Error(message)); }, 30_000);
    guard.unref?.();
    fake.win.setTimeout = (callback, delay) => {
      fake.win.setTimeout = schedule;
      clearTimeout(guard);
      resolve();
      return schedule(callback, delay);
    };
  });
}

async function waitForScheduledWork(fake, predicate, message) {
  while (!predicate()) await whenSchedulerRearms(fake, message);
}

async function mountedPair(input, options = {}) {
  const built = buildDom(input);
  const externalResources = builtExternalResources(built);
  const reference = fakeBrowserDocument();
  const alternate = fakeBrowserDocument();
  const referenceHost = new FakeElement(reference.document, "main");
  const alternateHost = new FakeElement(alternate.document, "main");
  const referencePhases = [];
  const alternatePhases = [];
  const referencePageLoads = [];
  const alternatePageLoads = [];
  const eagerResources = new Map(externalResources);
  for (const record of built.document.resources.resources) if (record.kind === "state-page") eagerResources.delete(record.id);
  const result = await readDomBrowser(built.bytes, {
    externalResources: eagerResources,
    loadExternalResource(record, signal) {
      referencePageLoads.push([record.id, signal, referenceHost.childNodes.length]);
      return options.loadStatePage?.("reference", record, signal, externalResources) ?? externalResources.get(record.id);
    },
  });
  const referenceRuntime = await mountDom(result, referenceHost, {
    animate: options.animate ?? false,
    mode: options.mode,
    onLifecyclePhase: (phase) => referencePhases.push(phase),
  });
  const alternateRuntime = await mountConformanceDom(result, alternateHost, {
    animate: options.animate ?? false,
    mode: options.mode,
    loadStatePage(record, signal) {
      alternatePageLoads.push([record.id, signal, alternateHost.childNodes.length]);
      return options.loadStatePage?.("alternate", record, signal, externalResources) ?? externalResources.get(record.id);
    },
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
    referencePageLoads,
    alternatePageLoads,
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

test("alternate and public viewers select retained prepared banks identically", async () => {
  for (const input of [await syntheticPreparedBanksInput(), await syntheticPagedPreparedBanksInput()]) {
    const value = await mountedPair(input, { mode: "animation" });
    const referenceIdentity = value.reference.namespaced.slice();
    const alternateIdentity = value.result.document.tree.nodes.map((node) => value.alternateRuntime.node(node.id));
    assert.equal(value.referenceRuntime.bankId, "alpha");
    assert.equal(value.alternateRuntime.bankId, "alpha");
    const isPaged = input.state.channels.some((channel) => channel.codec === "polycss-paged-playback@0");
    assert.equal(await value.referenceRuntime[isPaged ? "selectBankAsync" : "selectBank"]("beta"), 3);
    assert.equal(await value.alternateRuntime[isPaged ? "selectBankAsync" : "selectBank"]("beta"), 3);
    assert.equal(value.referenceRuntime.bankId, "beta");
    assert.equal(value.alternateRuntime.bankId, "beta");
    assert.deepEqual(value.reference.namespaced, referenceIdentity);
    assert.deepEqual(value.result.document.tree.nodes.map((node) => value.alternateRuntime.node(node.id)), alternateIdentity);
    assertEquivalent(value, "prepared bank beta handoff");
    assert.equal(await value.referenceRuntime[isPaged ? "selectBankAsync" : "selectBank"]("gamma"), 5);
    assert.equal(await value.alternateRuntime[isPaged ? "selectBankAsync" : "selectBank"]("gamma"), 5);
    assertEquivalent(value, "prepared bank resident gamma handoff");
    value.referenceRuntime.destroy();
    value.alternateRuntime.destroy();
  }
});

test("alternate and public async bank integrity failures tear down identically", async () => {
  const value = await mountedPair(await syntheticPagedPreparedBanksInput(), {
    mode: "animation",
    loadStatePage(_path, record, _signal, resources) {
      return record.id === "variant-page-3" ? new TextEncoder().encode("{}") : resources.get(record.id);
    },
  });
  await assert.rejects(value.referenceRuntime.selectBankAsync("gamma"), (error) => error?.code === "RESOURCE_SIZE_MISMATCH");
  await assert.rejects(value.alternateRuntime.selectBankAsync("gamma"), (error) => error?.code === "RESOURCE_SIZE_MISMATCH");
  assert.equal(value.referenceRuntime.lifecycle.phase, "destroy");
  assert.equal(value.alternateRuntime.lifecycle.phase, "destroy");
  assert.deepEqual(value.referencePhases, value.alternatePhases);
  assert.equal(value.referenceHost.childNodes.length, 0);
  assert.equal(value.alternateHost.childNodes.length, 0);
});

test("alternate and public viewers agree on deferred paged variants, readiness, refetch, and CSS closure", async () => {
  const value = await mountedPair(await syntheticEvictingPagedVariantsInput("gzip"), { mode: "animation" });
  const leafIndex = value.result.document.tree.nodes.findIndex((node) => node.id === "synthetic/leaf");
  const referenceLeaf = value.reference.namespaced[leafIndex];
  const alternateLeaf = value.alternateRuntime.node("synthetic/leaf");
  assert.deepEqual(value.alternatePageLoads.slice(0, 2).map(([id, , attached]) => [id, attached]), [
    ["variant-page-1", 0],
    ["variant-page-2", 0],
  ]);
  assert.equal(referenceLeaf.classes.includes("material-a"), true);
  assert.equal(alternateLeaf.classes.includes("material-a"), true);
  assertEquivalent(value, "paged initial readiness");
  const initialSourceFrame = value.referenceRuntime.sourceFrame;
  assert.equal(value.alternateRuntime.sourceFrame, initialSourceFrame);
  await flushAsyncWork();
  assert.deepEqual(value.alternatePageLoads.map(([id]) => id), ["variant-page-1", "variant-page-2"]);

  clearWrites(value.reference, value.alternate);
  assert.throws(() => value.referenceRuntime.seek(7), (error) => error?.code === "STATE_PAGE_NOT_READY");
  assert.throws(() => value.alternateRuntime.seek(7), (error) => error?.code === "STATE_PAGE_NOT_READY");
  assert.equal(value.referenceRuntime.sourceFrame, initialSourceFrame);
  assert.equal(value.alternateRuntime.sourceFrame, initialSourceFrame);
  assert.deepEqual(normalizedWrites(value.result, value.referenceHost, value.reference), []);
  assert.deepEqual(normalizedWrites(value.result, value.alternateHost, value.alternate), []);

  assert.equal(await value.referenceRuntime.seekAsync(7), 7);
  assert.equal(await value.alternateRuntime.seekAsync(7), 7);
  assertEquivalent(value, "paged random seek");
  assert.equal(await value.referenceRuntime.seekAsync(4), 4);
  assert.equal(await value.alternateRuntime.seekAsync(4), 4);
  assertEquivalent(value, "paged bounded-window refetch");
  assert.equal(await value.referenceRuntime.seekAsync(5), 5);
  assert.equal(await value.alternateRuntime.seekAsync(5), 5);
  assert.throws(() => value.referenceRuntime.seek(7), (error) => error?.code === "STATE_PAGE_NOT_READY");
  assert.throws(() => value.alternateRuntime.seek(7), (error) => error?.code === "STATE_PAGE_NOT_READY");
  assert.equal(await value.referenceRuntime.seekAsync(7), 7);
  assert.equal(await value.alternateRuntime.seekAsync(7), 7);
  assertEquivalent(value, "paged evicted-page refetch");
  assert.equal(value.referenceRuntime.destroy(), true);
  assert.equal(value.alternateRuntime.destroy(), true);
});

test("paged interaction verifies its noninitial experience page before attachment", async () => {
  const input = await syntheticPagedVariantsInput();
  input.state.channels.find((channel) => channel.codec === "polycss-pointer-grab-prepared@0").data.packet.animator.eyeFrame = 7;
  input.bindings.channels.find((channel) => channel.interpreter === "polycss-pointer-grab@0").parameters.initialFrame = 7;
  const value = await mountedPair(input, { mode: "interaction" });
  for (const loads of [value.referencePageLoads, value.alternatePageLoads]) {
    assert.deepEqual(loads.map(([id, , attached]) => [id, attached]), [
      ["variant-page-1", 0],
      ["variant-page-4", 0],
    ]);
  }
  assert.equal(value.referenceRuntime.sourceFrame, 7);
  assert.equal(value.alternateRuntime.sourceFrame, 7);
  assertEquivalent(value, "paged interaction readiness");
  value.referenceRuntime.destroy();
  value.alternateRuntime.destroy();
});

test("alternate and public viewers keep the interaction page pinned across animation windows", async () => {
  const input = await syntheticPagedVariantsInput();
  input.state.channels.find((channel) => channel.codec === "polycss-pointer-grab-prepared@0").data.packet.animator.eyeFrame = 7;
  input.bindings.channels.find((channel) => channel.interpreter === "polycss-pointer-grab@0").parameters.initialFrame = 7;
  const value = await mountedPair(input, { mode: "animation" });
  assert.equal(await value.referenceRuntime.seekAsync(3), 3);
  assert.equal(await value.alternateRuntime.seekAsync(3), 3);
  const referenceLoads = value.referencePageLoads.length;
  const alternateLoads = value.alternatePageLoads.length;
  assert.equal(value.referenceRuntime.setMode("interaction"), "interaction");
  assert.equal(value.alternateRuntime.setMode("interaction"), "interaction");
  assert.equal(value.referenceRuntime.sourceFrame, 7);
  assert.equal(value.alternateRuntime.sourceFrame, 7);
  assert.equal(value.referencePageLoads.length, referenceLoads);
  assert.equal(value.alternatePageLoads.length, alternateLoads);
  assertEquivalent(value, "paged pinned interaction switch");
  value.referenceRuntime.destroy();
  value.alternateRuntime.destroy();
});

test("alternate and public viewers advance only the ready catch-up prefix when an intermediate page is absent", async () => {
  const value = await mountedPair(await syntheticPagedVariantsInput(), { animate: true, mode: "animation" });
  value.reference.frame(0);
  value.alternate.frame(0);
  await flushAsyncWork();
  assert.equal(await value.referenceRuntime.seekAsync(7), 7);
  assert.equal(await value.alternateRuntime.seekAsync(7), 7);
  assert.equal(value.referenceRuntime.seek(1), 1);
  assert.equal(value.alternateRuntime.seek(1), 1);
  value.reference.frame(0);
  value.alternate.frame(0);
  value.reference.frame(200);
  value.alternate.frame(200);
  assert.equal(value.referenceRuntime.lifecycle.phase, "publish");
  assert.equal(value.alternateRuntime.lifecycle.phase, "publish");
  assert.equal(value.referenceRuntime.sourceFrame, 4);
  assert.equal(value.alternateRuntime.sourceFrame, 4);
  await waitForScheduledWork(value.reference, () => value.referenceRuntime.sourceFrame === 7, "The reference viewer never resumed its ready catch-up prefix.");
  await waitForScheduledWork(value.alternate, () => value.alternateRuntime.sourceFrame === 7, "The alternate viewer never resumed its ready catch-up prefix.");
  assert.equal(value.referenceRuntime.sourceFrame, 7);
  assert.equal(value.alternateRuntime.sourceFrame, 7);
  assertEquivalent(value, "paged automatic catch-up ready prefix");
  value.referenceRuntime.destroy();
  value.alternateRuntime.destroy();
});

test("alternate and public interaction schedulers wait at paged animator boundaries without teardown", async () => {
  const input = await syntheticPagedVariantsInput();
  input.state.channels.find((channel) => channel.codec === "polycss-pointer-grab-prepared@0").data.packet.animator.eyeStillTicks = 1;
  const value = await mountedPair(input, { animate: true, mode: "animation" });
  assert.equal(value.referenceRuntime.setMode("interaction"), "interaction");
  assert.equal(value.alternateRuntime.setMode("interaction"), "interaction");
  value.reference.frame(0);
  value.alternate.frame(0);
  assert.doesNotThrow(() => value.reference.frame(267));
  assert.doesNotThrow(() => value.alternate.frame(267));
  assert.equal(value.referenceRuntime.lifecycle.phase, "publish");
  assert.equal(value.alternateRuntime.lifecycle.phase, "publish");
  await flushAsyncWork();
  assert.equal(value.referenceRuntime.lifecycle.phase, "publish");
  assert.equal(value.alternateRuntime.lifecycle.phase, "publish");
  const leafIndex = value.result.document.tree.nodes.findIndex((node) => node.id === "synthetic/leaf");
  assert.equal(value.reference.namespaced[leafIndex].classes.includes("material-b"), true);
  assert.equal(value.alternateRuntime.node("synthetic/leaf").classes.includes("material-b"), true);
  assertEquivalent(value, "paged interaction boundary readiness");
  value.referenceRuntime.destroy();
  value.alternateRuntime.destroy();
});

test("alternate and public viewers apply identical typed orbit input and cyclic surface state", async () => {
  const value = await mountedPair(await syntheticOrbitInput());
  const leafIndex = value.result.document.tree.nodes.findIndex((node) => node.id === "synthetic-polycss/leaf");
  const referenceLeaf = value.reference.namespaced[leafIndex];
  const alternateLeaf = value.alternateRuntime.node("synthetic-polycss/leaf");
  const identities = [referenceLeaf, alternateLeaf];
  clearWrites(value.reference, value.alternate);

  for (const yaw of [90, -90, 177, -177, 0]) {
    assert.equal(value.referenceRuntime.setInput("orbit.yaw", yaw), yaw);
    assert.equal(value.alternateRuntime.setInput("orbit.yaw", yaw), yaw);
    assertEquivalent(value, `orbit yaw ${yaw}`);
    assert.deepEqual(
      normalizedWrites(value.result, value.alternateHost, value.alternate),
      normalizedWrites(value.result, value.referenceHost, value.reference),
    );
    clearWrites(value.reference, value.alternate);
  }
  assert.equal(value.referenceRuntime.setInput("orbit.pitch", -100), -28);
  assert.equal(value.alternateRuntime.setInput("orbit.pitch", -100), -28);
  assert.equal(value.referenceRuntime.setInput("orbit.zoom", 20), 2);
  assert.equal(value.alternateRuntime.setInput("orbit.zoom", 20), 2);
  assert.equal(value.reference.namespaced[leafIndex], identities[0]);
  assert.equal(value.alternateRuntime.node("synthetic-polycss/leaf"), identities[1]);
  assertEquivalent(value, "orbit clamp and identity");
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

test("alternate and public viewers share closed compositor cycles and snap timing", async () => {
  const input = await syntheticCompositorTimingInput();
  input.state.channels.find((channel) => channel.codec === "polycss-playback-packed@0").data.packet.timeline.frames = [1, 1, 2, 4, 4, 6, 8, 2];
  const value = await mountedPair(input, { animate: true, mode: "animation" });
  const modelIndex = value.result.document.tree.nodes.findIndex((node) => node.id === "synthetic/scene");
  const referenceAnimation = value.reference.namespaced[modelIndex].animations[0];
  const alternateAnimation = value.alternateRuntime.node("synthetic/scene").animations[0];
  assert.ok(referenceAnimation);
  assert.ok(alternateAnimation);
  assertEquivalent(value, "compositor initial");
  value.reference.frame(0);
  value.alternate.frame(0);
  clearWrites(value.reference, value.alternate);
  value.reference.frame(100);
  value.alternate.frame(100);
  assert.equal(value.referenceRuntime.sourceFrame, 4);
  assert.equal(value.alternateRuntime.sourceFrame, 4);
  assert.equal(referenceAnimation.currentTime, 100);
  assert.equal(alternateAnimation.currentTime, 100);
  assertEquivalent(value, "compositor repeated and nonidentity catch-up");
  assert.deepEqual(
    normalizedWrites(value.result, value.alternateHost, value.alternate),
    normalizedWrites(value.result, value.referenceHost, value.reference),
  );
  clearWrites(value.reference, value.alternate);
  referenceAnimation.currentTime = 999;
  alternateAnimation.currentTime = 999;
  value.referenceRuntime.seek(7);
  value.alternateRuntime.seek(7);
  assert.equal(referenceAnimation.currentTime, 100);
  assert.equal(alternateAnimation.currentTime, 100);
  assertEquivalent(value, "compositor seek snap");
  assert.deepEqual(
    normalizedWrites(value.result, value.alternateHost, value.alternate),
    normalizedWrites(value.result, value.referenceHost, value.reference),
  );
  value.referenceRuntime.setMode("interaction");
  value.alternateRuntime.setMode("interaction");
  value.referenceRuntime.setMode("animation");
  value.alternateRuntime.setMode("animation");
  assert.equal(referenceAnimation.currentTime, 0);
  assert.equal(alternateAnimation.currentTime, 0);
  value.reference.frame(399);
  value.alternate.frame(399);
  assert.equal(value.referenceRuntime.sourceFrame, 1);
  assert.equal(value.alternateRuntime.sourceFrame, 1);
  assert.equal(referenceAnimation.currentTime, 0);
  assert.equal(alternateAnimation.currentTime, 0);
  assertEquivalent(value, "compositor logical-tick wrap");
  value.referenceRuntime.destroy();
  value.alternateRuntime.destroy();
});

test("alternate and public viewers preserve animate false through mode round trips", async () => {
  const value = await mountedPair(await syntheticCompositorTimingInput(), { animate: false, mode: "animation" });
  const modelIndex = value.result.document.tree.nodes.findIndex((node) => node.id === "synthetic/scene");
  const referenceAnimation = value.reference.namespaced[modelIndex].animations[0];
  const alternateAnimation = value.alternateRuntime.node("synthetic/scene").animations[0];
  assert.equal(referenceAnimation.playState, "paused");
  assert.equal(alternateAnimation.playState, "paused");
  value.referenceRuntime.setMode("interaction");
  value.alternateRuntime.setMode("interaction");
  value.referenceRuntime.setMode("animation");
  value.alternateRuntime.setMode("animation");
  assert.equal(referenceAnimation.playState, "paused");
  assert.equal(alternateAnimation.playState, "paused");
  assertEquivalent(value, "animate false mode round trip");
  value.referenceRuntime.destroy();
  value.alternateRuntime.destroy();
});

test("prepared atlas addresses and class variants publish without replacing retained nodes", async () => {
  const value = await mountedPair(await syntheticAdapterTechniquesInput());
  const referenceLeaf = value.reference.namespaced[2];
  const alternateLeaf = value.alternateRuntime.node("synthetic-polycss/leaf");
  const identities = [referenceLeaf, alternateLeaf];

  assert.equal(referenceLeaf.style.backgroundPosition, "0 0");
  assert.deepEqual(referenceLeaf.classes, ["leaf", "material-a"]);
  assert.equal(referenceLeaf.style.visibility, "hidden");
  clearWrites(value.reference, value.alternate);
  value.referenceRuntime.seek(2);
  value.alternateRuntime.seek(2);
  assert.equal(value.reference.namespaced[2], identities[0]);
  assert.equal(value.alternateRuntime.node("synthetic-polycss/leaf"), identities[1]);
  assert.equal(referenceLeaf.style.backgroundPosition, "-16px -16px");
  assert.deepEqual(referenceLeaf.classes, ["leaf", "material-b"]);
  assert.equal(referenceLeaf.style.visibility, "visible");
  const orderedProperties = (host, fake) => normalizedWrites(value.result, host, fake)
    .filter(([id, property]) => id === "synthetic-polycss/leaf" && ["class:remove", "class:add", "backgroundPosition", "visibility"].includes(property))
    .map(([, property]) => property);
  assert.deepEqual(orderedProperties(value.referenceHost, value.reference), [
    "class:remove",
    "class:add",
    "backgroundPosition",
    "visibility",
  ]);
  assert.deepEqual(orderedProperties(value.alternateHost, value.alternate), [
    "class:remove",
    "class:add",
    "backgroundPosition",
    "visibility",
  ]);
  assertEquivalent(value, "prepared adapter techniques frame 2");

  clearWrites(value.reference, value.alternate);
  value.referenceRuntime.seek(1);
  value.alternateRuntime.seek(1);
  assert.equal(referenceLeaf.style.backgroundPosition, "-16px -16px");
  assert.deepEqual(referenceLeaf.classes, ["leaf", "material-a"]);
  assert.equal(referenceLeaf.style.visibility, "hidden");
  assertEquivalent(value, "prepared adapter techniques wrap");
  value.referenceRuntime.destroy();
  value.alternateRuntime.destroy();
});

test("alternate and public viewers switch prepared viewport profiles with identical reveal ordering", async () => {
  const value = await mountedPair(await syntheticViewportProfilesInput(), { mode: "animation" });
  const leafIndex = value.result.document.tree.nodes.findIndex((node) => node.id === "synthetic/leaf");
  const referenceLeaf = value.reference.namespaced[leafIndex];
  const alternateLeaf = value.alternateRuntime.node("synthetic/leaf");
  const identities = [referenceLeaf, alternateLeaf];
  assert.equal(referenceLeaf.style.visibility, "hidden");
  assertEquivalent(value, "viewport profile initial");

  value.referenceRuntime.seek(2);
  value.alternateRuntime.seek(2);
  clearWrites(value.reference, value.alternate);
  value.referenceHost.childNodes[0].clientWidth = 600;
  value.alternateHost.childNodes[0].clientWidth = 600;
  value.reference.observers[0].callback();
  value.alternate.observers[0].callback();

  assert.equal(value.reference.namespaced[leafIndex], identities[0]);
  assert.equal(value.alternateRuntime.node("synthetic/leaf"), identities[1]);
  const referenceWrites = normalizedWrites(value.result, value.referenceHost, value.reference);
  const alternateWrites = normalizedWrites(value.result, value.alternateHost, value.alternate);
  assert.deepEqual(alternateWrites, referenceWrites);
  assert.deepEqual(referenceWrites.filter(([id, property]) => id === "synthetic/leaf" && ["transform", "backgroundPositionY", "visibility"].includes(property)).map(([, property]) => property), [
    "transform",
    "backgroundPositionY",
    "visibility",
  ]);
  assertEquivalent(value, "viewport profile desktop reveal");
  value.referenceRuntime.destroy();
  value.alternateRuntime.destroy();
});

test("alternate and public viewers select and restart responsive playback timelines identically", async () => {
  const value = await mountedPair(await syntheticProfileTimelinesInput(), { animate: true, mode: "animation" });
  const surfaces = [value.referenceHost.childNodes[0], value.alternateHost.childNodes[0]];
  value.reference.frame(0);
  value.alternate.frame(0);
  value.reference.frame(34);
  value.alternate.frame(34);
  assert.equal(value.referenceRuntime.sourceFrame, 3);
  assert.equal(value.alternateRuntime.sourceFrame, 3);
  assertEquivalent(value, "mobile timeline advance");

  assert.equal(value.referenceRuntime.setMode("interaction"), "interaction");
  assert.equal(value.alternateRuntime.setMode("interaction"), "interaction");
  surfaces[0].clientWidth = 600;
  surfaces[1].clientWidth = 600;
  value.reference.observers[0].callback();
  value.alternate.observers[0].callback();
  assert.equal(value.referenceRuntime.sourceFrame, 3);
  assert.equal(value.alternateRuntime.sourceFrame, 3);
  assertEquivalent(value, "interaction profile preservation");

  assert.equal(value.referenceRuntime.setMode("animation"), "animation");
  assert.equal(value.alternateRuntime.setMode("animation"), "animation");
  assert.equal(value.referenceRuntime.sourceFrame, 1);
  assert.equal(value.alternateRuntime.sourceFrame, 1);
  value.reference.frame(68);
  value.alternate.frame(68);
  assert.equal(value.referenceRuntime.sourceFrame, 2);
  assert.equal(value.alternateRuntime.sourceFrame, 2);
  assertEquivalent(value, "desktop baseline re-entry");
  value.referenceRuntime.destroy();
  value.alternateRuntime.destroy();
});

test("alternate and public viewers match landscape-first selection, interaction preservation, and restart", async () => {
  const value = await mountedPair(await syntheticAspectProfileTimelinesInput(), { animate: true, mode: "animation" });
  const surfaces = [value.referenceHost.childNodes[0], value.alternateHost.childNodes[0]];
  value.reference.frame(0);
  value.alternate.frame(0);
  value.reference.frame(34);
  value.alternate.frame(34);
  assert.equal(value.referenceRuntime.sourceFrame, 2);
  assert.equal(value.alternateRuntime.sourceFrame, 2);
  assertEquivalent(value, "320x240 landscape baseline");
  const deadlines = [[...value.reference.timers.values()][0].due, [...value.alternate.timers.values()][0].due];
  for (const surface of surfaces) {
    surface.clientWidth = 600;
    surface.clientHeight = 800;
  }
  value.reference.observers[0].callback();
  value.alternate.observers[0].callback();
  assert.equal(value.referenceRuntime.sourceFrame, 2);
  assert.equal(value.alternateRuntime.sourceFrame, 2);
  assert.deepEqual([[...value.reference.timers.values()][0].due, [...value.alternate.timers.values()][0].due], deadlines);
  assertEquivalent(value, "portrait baseline band without restart");

  assert.equal(value.referenceRuntime.setMode("interaction"), "interaction");
  assert.equal(value.alternateRuntime.setMode("interaction"), "interaction");
  for (const surface of surfaces) {
    surface.clientWidth = 240;
    surface.clientHeight = 320;
  }
  value.reference.observers[0].callback();
  value.alternate.observers[0].callback();
  assert.equal(value.referenceRuntime.sourceFrame, 3);
  assert.equal(value.alternateRuntime.sourceFrame, 3);
  assertEquivalent(value, "portrait phone interaction preservation");

  assert.equal(value.referenceRuntime.setMode("animation"), "animation");
  assert.equal(value.alternateRuntime.setMode("animation"), "animation");
  assert.equal(value.referenceRuntime.sourceFrame, 1);
  assert.equal(value.alternateRuntime.sourceFrame, 1);
  value.reference.frame(68);
  value.alternate.frame(68);
  assert.equal(value.referenceRuntime.sourceFrame, 3);
  assert.equal(value.alternateRuntime.sourceFrame, 3);
  assertEquivalent(value, "portrait phone override re-entry");
  value.referenceRuntime.destroy();
  value.alternateRuntime.destroy();
});

test("alternate and public viewers preserve animate:false across landscape-first mode round trips", async () => {
  const value = await mountedPair(await syntheticAspectProfileTimelinesInput(), { animate: false, mode: "animation" });
  const surfaces = [value.referenceHost.childNodes[0], value.alternateHost.childNodes[0]];
  assert.equal(value.referenceRuntime.seek(2), 2);
  assert.equal(value.alternateRuntime.seek(2), 2);
  for (const surface of surfaces) {
    surface.clientWidth = 240;
    surface.clientHeight = 320;
  }
  value.reference.observers[0].callback();
  value.alternate.observers[0].callback();
  assert.equal(value.referenceRuntime.sourceFrame, 1);
  assert.equal(value.alternateRuntime.sourceFrame, 1);
  assert.equal(value.reference.timers.size, 0);
  assert.equal(value.alternate.timers.size, 0);
  assert.equal(value.reference.raf.size, 0);
  assert.equal(value.alternate.raf.size, 0);
  value.reference.frame(1000);
  value.alternate.frame(1000);
  assert.equal(value.referenceRuntime.sourceFrame, 1);
  assert.equal(value.alternateRuntime.sourceFrame, 1);

  assert.equal(value.referenceRuntime.setMode("interaction"), "interaction");
  assert.equal(value.alternateRuntime.setMode("interaction"), "interaction");
  for (const surface of surfaces) {
    surface.clientWidth = 320;
    surface.clientHeight = 240;
  }
  value.reference.observers[0].callback();
  value.alternate.observers[0].callback();
  assert.equal(value.referenceRuntime.setMode("animation"), "animation");
  assert.equal(value.alternateRuntime.setMode("animation"), "animation");
  value.reference.frame(2000);
  value.alternate.frame(2000);
  assert.equal(value.referenceRuntime.sourceFrame, 1);
  assert.equal(value.alternateRuntime.sourceFrame, 1);
  assertEquivalent(value, "animate:false landscape re-entry");
  value.referenceRuntime.destroy();
  value.alternateRuntime.destroy();
});

test("alternate and public viewers replace a stale page wait before responsive restart preload", async () => {
  let delayPageTwo = false;
  const pending = { reference: [], alternate: [] };
  const value = await mountedPair(await syntheticPagedAspectProfileTimelinesWithoutInteractionInput(), {
    animate: true,
    mode: "animation",
    loadStatePage(path, record, signal, resources) {
      if (!delayPageTwo || record.id !== "variant-page-2") return resources.get(record.id);
      return new Promise((resolve, reject) => {
        const call = { signal, resolve: () => resolve(resources.get(record.id)) };
        pending[path].push(call);
        signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { code: "OPERATION_ABORTED" })), { once: true });
      });
    },
  });
  const surfaces = [value.referenceHost.childNodes[0], value.alternateHost.childNodes[0]];

  assert.equal(await value.referenceRuntime.seekAsync(5), 5);
  assert.equal(await value.alternateRuntime.seekAsync(5), 5);
  assert.equal(await value.referenceRuntime.seekAsync(7), 7);
  assert.equal(await value.alternateRuntime.seekAsync(7), 7);
  await flushAsyncWork();
  delayPageTwo = true;
  assert.equal(value.referenceRuntime.seek(1), 1);
  assert.equal(value.alternateRuntime.seek(1), 1);
  await flushAsyncWork();
  value.reference.frame(34);
  value.alternate.frame(34);
  await flushAsyncWork();
  assert.equal(pending.reference.length, 2);
  assert.equal(pending.alternate.length, 2);

  for (const surface of surfaces) {
    surface.clientWidth = 240;
    surface.clientHeight = 320;
  }
  value.reference.observers[0].callback();
  value.alternate.observers[0].callback();
  await flushAsyncWork();
  for (const path of ["reference", "alternate"]) {
    assert.equal(pending[path].length, 3, `${path} starts one replacement preload`);
    assert.equal(pending[path][0].signal.aborted, true, `${path} cancels the superseded opportunistic preload`);
    assert.equal(pending[path][1].signal.aborted, true, `${path} cancels the stale scheduler wait generation`);
    assert.equal(pending[path][2].signal.aborted, false, `${path} keeps the post-reschedule preload live`);
    pending[path][2].resolve();
  }
  await flushAsyncWork();
  value.reference.frame(68);
  value.alternate.frame(68);
  await flushAsyncWork();
  assert.equal(value.referenceRuntime.lifecycle.phase, "publish");
  assert.equal(value.alternateRuntime.lifecycle.phase, "publish");
  assert.equal(value.referenceRuntime.sourceFrame, 3);
  assert.equal(value.alternateRuntime.sourceFrame, 3);
  assertEquivalent(value, "responsive replacement preload publication");
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

test("alternate and public viewers share exact rational single-step timing", async () => {
  const value = await mountedPair(await syntheticExactTimingInput(), { animate: true });
  value.reference.frame(0);
  value.alternate.frame(0);
  value.reference.frame(90);
  value.alternate.frame(90);
  assert.equal(value.referenceRuntime.sourceFrame, 2);
  assert.equal(value.alternateRuntime.sourceFrame, 2);
  value.reference.frame(91);
  value.alternate.frame(91);
  assert.equal(value.referenceRuntime.sourceFrame, 2, "single-step resets its deadline after a stall");
  value.reference.frame(121);
  value.alternate.frame(121);
  assert.equal(value.referenceRuntime.sourceFrame, 1);
  assertEquivalent(value, "exact 30ms single-step cadence");
  value.referenceRuntime.destroy();
  value.alternateRuntime.destroy();
});

test("alternate and public viewers collapse arbitrary elapsed deadlines to one retained publication", async () => {
  const input = await syntheticExactTimingInput({ catchUpPolicy: "elapsed", deadlineMicros: [0, 20_000, 50_000] });
  const value = await mountedPair(input, { animate: true });
  value.reference.frame(0);
  value.alternate.frame(0);
  value.reference.frame(50);
  value.alternate.frame(50);
  assert.equal(value.referenceRuntime.sourceFrame, 1, "two elapsed events wrap to the initial source frame");
  assert.equal(value.alternateRuntime.sourceFrame, 1);
  value.reference.frame(69);
  value.alternate.frame(69);
  assert.equal(value.referenceRuntime.sourceFrame, 1, "the next loop-relative deadline remains at 70ms");
  value.reference.frame(70);
  value.alternate.frame(70);
  assert.equal(value.referenceRuntime.sourceFrame, 2);
  assertEquivalent(value, "arbitrary elapsed deadline collapse");
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
