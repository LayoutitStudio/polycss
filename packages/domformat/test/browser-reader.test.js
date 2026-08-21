import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { mountDom, readDomBrowser, readDomBrowserUrl } from "../src/browser.js";
import { createInteractionInput } from "../src/browser-input.js";
import { decodeJson, encodeCanonicalJson } from "../src/canonical-json.js";
import { DEFAULT_LIMITS } from "../src/constants.js";
import { pagedPlaybackPublicationWorkspaceBytes } from "../src/state-pages.js";
import { createPolycssPagedState, createPolycssPublicationDiagnostics } from "../src/state/paged-state.js";
import { createPolycssPlayback, materializePolycssState } from "../src/state/polycss.js";
import { createStaticPresentation } from "../src/state/presentation.js";
import { buildDom } from "../src/writer.js";
import { builtExternalResources, errorCode, largePagedDescriptorClosure, syntheticAdapterTechniquesInput, syntheticAnimationWithoutEffectsInput, syntheticAspectProfileTimelinesInput, syntheticCompositorTimingInput, syntheticEvictingPagedVariantsInput, syntheticExecutableInteractionInput, syntheticInput, syntheticOrbitInput, syntheticPagedPlaybackChangesInput, syntheticPagedPlaybackInput, syntheticPagedPreparedBanksInput, syntheticPreparedBanksInput, syntheticPagedProfileTimelinesWithoutInteractionInput, syntheticPagedVariantsInput, syntheticProfileTimelinesInput, syntheticResponsivePresentationInput, syntheticStaticPresentationInput, syntheticPolycssInput, syntheticViewportProfilesInput } from "./helpers.js";
import { dispatch, FakeElement, fakeBrowserDocument } from "./fake-browser.js";

function foreignArrayBuffer(bytes) {
  const context = vm.createContext({ values: [...bytes] });
  return vm.runInContext("Uint8Array.from(values).buffer", context);
}

function base64Integers(values, width) {
  const bytes = new Uint8Array(values.length * width);
  for (let index = 0; index < values.length; index += 1) for (let byte = 0; byte < width; byte += 1) bytes[index * width + byte] = Math.floor(values[index] / 2 ** (byte * 8)) & 255;
  return Buffer.from(bytes).toString("base64");
}

function resetPublicationDiagnostics(diagnostics) {
  for (const key of Object.keys(diagnostics)) diagnostics[key] = 0;
}

function withoutSequentialRangeCopies(callback) {
  const originalArrayFrom = Array.from;
  const OriginalSet = globalThis.Set;
  const typedArrays = [Uint8Array, Uint16Array, Uint32Array];
  const originalSlices = typedArrays.map((constructor) => constructor.prototype.slice);
  Array.from = () => { throw new Error("sequential staging called Array.from"); };
  globalThis.Set = class extends OriginalSet { constructor() { throw new Error("sequential staging allocated a Set"); } };
  for (const constructor of typedArrays) constructor.prototype.slice = () => { throw new Error("sequential staging sliced a typed range"); };
  try {
    return callback();
  } finally {
    Array.from = originalArrayFrom;
    globalThis.Set = OriginalSet;
    for (let index = 0; index < typedArrays.length; index += 1) typedArrays[index].prototype.slice = originalSlices[index];
  }
}

function withoutPlaybackBoundaryAllocations(callback) {
  const originalArrayFrom = Array.from;
  const typedArrays = [Uint8Array, Uint16Array, Uint32Array];
  const originalSlices = typedArrays.map((constructor) => constructor.prototype.slice);
  const originalUint32Subarray = Uint32Array.prototype.subarray;
  const originalUint32Iterator = Uint32Array.prototype[Symbol.iterator];
  Array.from = () => { throw new Error("playback boundary validation called Array.from"); };
  Uint32Array.prototype.subarray = () => { throw new Error("playback boundary validation created a target subarray"); };
  Uint32Array.prototype[Symbol.iterator] = () => { throw new Error("playback boundary validation spread a target range"); };
  for (const constructor of typedArrays) constructor.prototype.slice = () => { throw new Error("playback boundary validation sliced a typed range"); };
  try {
    return callback();
  } finally {
    Array.from = originalArrayFrom;
    Uint32Array.prototype.subarray = originalUint32Subarray;
    Uint32Array.prototype[Symbol.iterator] = originalUint32Iterator;
    for (let index = 0; index < typedArrays.length; index += 1) typedArrays[index].prototype.slice = originalSlices[index];
  }
}

function documentRoutes(built, modelUrl) {
  const routes = new Map([[modelUrl, built.bytes]]);
  for (const record of built.document.resources.resources) {
    routes.set(new URL(record.path, modelUrl).href, built.externalResources.get(record.path));
  }
  return routes;
}

function readBuiltBrowser(built, options = {}) {
  const all = builtExternalResources(built);
  const eager = new Map(all);
  for (const record of built.document.resources.resources) if (record.kind === "state-page") eager.delete(record.id);
  return readDomBrowser(built.bytes, { externalResources: eager, loadExternalResource: (record) => all.get(record.id), ...options });
}

async function flushAsyncWork(turns = 8) {
  for (let turn = 0; turn < turns; turn += 1) await new Promise((resolve) => setImmediate(resolve));
}

function routeFetch(routes, calls = []) {
  return async (input, options) => {
    const url = String(input);
    calls.push({ url, options });
    if (!routes.has(url)) return new Response("missing", { status: 404 });
    const bytes = routes.get(url);
    return new Response(bytes, {
      status: 200,
      headers: { "content-length": String(bytes.byteLength) },
    });
  };
}

test("browser reader verifies supplied sibling resources without network loading", async () => {
  const built = buildDom(await syntheticInput());
  const result = await readBuiltBrowser(built);
  assert.equal(result.resourceBytes.size, 2);
  assert.deepEqual([...result.resourceBytes.keys()], ["checker", "model-css"]);
  assert.equal(Object.isFrozen(result.document), true);
  assert.equal(Object.isFrozen(result.document.tree.nodes[0]), true);
  assert.throws(() => { result.document.meta.title = "mutated"; }, TypeError);
  await assert.rejects(
    readDomBrowser(built.bytes, { externalResources: new Map() }),
    errorCode("MISSING_EXTERNAL_RESOURCE"),
  );
});

test("browser reader accepts model and sibling ArrayBuffers from another realm", async () => {
  const built = buildDom(await syntheticInput());
  const externalResources = new Map([...builtExternalResources(built)].map(([id, bytes]) => [id, foreignArrayBuffer(bytes)]));
  const result = await readDomBrowser(foreignArrayBuffer(built.bytes), { externalResources });
  assert.equal(result.resourceBytes.size, 2);
});

test("stock browser limits admit 64,000 paged frames and 500 deferred pages while oversized closures fail before resource loading", async () => {
  const built = buildDom(await syntheticPagedPlaybackInput());
  const accepted = largePagedDescriptorClosure(built);
  let loads = 0;
  const result = await readDomBrowser(accepted.bytes, {
    externalResources: accepted.eagerResources,
    loadExternalResource() { loads += 1; throw new Error("Descriptor validation must not load state pages."); },
  });
  assert.equal(loads, 0);
  assert.equal(result.document.resources.resources.filter((record) => record.kind === "state-page").length, 500);
  assert.equal(result.document.bindings.channels.find((channel) => channel.interpreter === "polycss-paged-playback@0").parameters.frameCount, 64_000);

  const cases = [
    ["state-page count", { pageCount: 513 }, "RESOURCE_COUNT_LIMIT"],
    ["paged frame count", { frameCount: 64_001 }, "FRAME_CARDINALITY_MISMATCH"],
    ["per-page frame count", { pageCount: 6 }, "STATE_PAGE_COVERAGE_MISMATCH"],
    ["aggregate encoded page bytes", { encodedByteLength: 300 * 1024 }, "AGGREGATE_RESOURCE_LIMIT"],
    ["resident materialized byte product", { materializedByteLength: 27 * 1024 * 1024 }, "STATE_PAGE_RESIDENCY_LIMIT"],
  ];
  for (const [label, options, code] of cases) {
    const closure = largePagedDescriptorClosure(built, options);
    let invalidLoads = 0;
    await assert.rejects(
      readDomBrowser(closure.bytes, {
        externalResources: closure.eagerResources,
        loadExternalResource() { invalidLoads += 1; throw new Error("Invalid descriptors must fail before resource loading."); },
      }),
      errorCode(code),
      label,
    );
    assert.equal(invalidLoads, 0, label);
  }
});

test("browser reader rejects eagerly supplied state pages before copying or validating them", async () => {
  const built = buildDom(await syntheticPagedPlaybackInput());
  const all = builtExternalResources(built);
  const statePage = built.document.resources.resources.find((record) => record.kind === "state-page");
  all.set(statePage.id, Uint8Array.of(0));
  let loads = 0;
  await assert.rejects(
    readDomBrowser(built.bytes, { externalResources: all, loadExternalResource(record) { loads += 1; return all.get(record.id); } }),
    errorCode("INVALID_EXTERNAL_RESOURCES"),
  );
  assert.equal(loads, 0);
});

test("browser reader reports unavailable SHA-256 as a coded format error", async () => {
  const built = buildDom(await syntheticInput());
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "crypto");
  Object.defineProperty(globalThis, "crypto", { configurable: true, value: undefined });
  try {
    await assert.rejects(readBuiltBrowser(built), errorCode("MISSING_BROWSER_API"));
  } finally {
    if (descriptor) Object.defineProperty(globalThis, "crypto", descriptor);
    else delete globalThis.crypto;
  }
});

test("browser limit overrides reject non-record values consistently", async () => {
  const built = buildDom(await syntheticInput());
  const externalResources = builtExternalResources(built);
  for (const limits of [null, [], 0, true, "limits", () => {}]) {
    await assert.rejects(readDomBrowser(built.bytes, { externalResources, limits }), errorCode("INVALID_LIMITS"));
  }
});

test("browser reader caps decoded image exposure at 16 Mi pixels", async () => {
  const built = buildDom(await syntheticInput());
  const packageWithDimensions = (width, height) => {
    const envelope = decodeJson(built.bytes);
    envelope.resources.resources.find((record) => record.kind === "image").dimensions = { width, height };
    return encodeCanonicalJson(envelope);
  };
  const externalResources = builtExternalResources(built);
  await assert.rejects(readDomBrowser(packageWithDimensions(4096, 4096), { externalResources }), errorCode("IMAGE_DIMENSION_MISMATCH"));
  await assert.rejects(readDomBrowser(packageWithDimensions(4097, 4096), { externalResources }), errorCode("IMAGE_DIMENSION_LIMIT"));
});

test("browser URL reader loads sibling resources relative to the JSON document with strict fetch policy", async () => {
  const built = buildDom(await syntheticInput());
  const modelUrl = "https://packages.example/models/synthetic.json";
  const routes = documentRoutes(built, modelUrl);
  const calls = [];
  const controller = new AbortController();
  const result = await readDomBrowserUrl("/models/synthetic.json", {
    baseUrl: "https://packages.example/viewer/",
    fetch: routeFetch(routes, calls),
    signal: controller.signal,
  });

  assert.equal(result.resourceBytes.size, 2);
  assert.deepEqual(calls.map((call) => call.url), [
    modelUrl,
    "https://packages.example/models/assets/checker.png",
    "https://packages.example/models/model.css",
  ]);
  for (const call of calls) {
    assert.equal(call.options.cache, "no-store");
    assert.equal(call.options.credentials, "omit");
    assert.equal(call.options.redirect, "error");
    assert.equal(call.options.signal, controller.signal);
  }
});

test("browser reader requires all sibling resources and rejects digest corruption", async () => {
  const built = buildDom(await syntheticInput());
  await assert.rejects(readDomBrowser(built.bytes), errorCode("MISSING_EXTERNAL_RESOURCE"));
  await assert.rejects(
    readDomBrowser(built.bytes, { externalResources: {}, loadExternalResource: async () => new Uint8Array() }),
    errorCode("INVALID_EXTERNAL_RESOURCES"),
  );
  await assert.rejects(
    readDomBrowser(built.bytes, { externalResources: new Map([["undeclared", new Uint8Array()]]) }),
    errorCode("UNEXPECTED_EXTERNAL_RESOURCE"),
  );

  const modelUrl = "https://packages.example/models/synthetic.json";
  const routes = documentRoutes(built, modelUrl);
  const checkerUrl = "https://packages.example/models/assets/checker.png";
  const corrupt = routes.get(checkerUrl).slice();
  corrupt[corrupt.length - 1] ^= 1;
  routes.set(checkerUrl, corrupt);
  await assert.rejects(
    readDomBrowserUrl(modelUrl, { fetch: routeFetch(routes) }),
    errorCode("RESOURCE_DIGEST_MISMATCH"),
  );
});

test("browser URL reader rejects oversized model and resource responses before mounting", async () => {
  const built = buildDom(await syntheticInput());
  const modelUrl = "https://packages.example/models/synthetic.json";
  const oversizedModelFetch = async () => new Response(built.bytes, {
    status: 200,
    headers: { "content-length": String(built.bytes.length + 1) },
  });
  await assert.rejects(
    readDomBrowserUrl(modelUrl, {
      fetch: oversizedModelFetch,
      limits: { maxFileBytes: built.bytes.length },
    }),
    errorCode("FILE_LIMIT"),
  );

  const routes = documentRoutes(built, modelUrl);
  const checkerUrl = "https://packages.example/models/assets/checker.png";
  const checker = routes.get(checkerUrl);
  const oversized = new Uint8Array(checker.length + 1);
  oversized.set(checker);
  routes.set(checkerUrl, oversized);
  await assert.rejects(
    readDomBrowserUrl(modelUrl, { fetch: routeFetch(routes) }),
    errorCode("RESOURCE_SIZE_MISMATCH"),
  );
});

test("browser URL reader rejects credentialed and unsupported model URLs", async () => {
  await assert.rejects(
    readDomBrowserUrl("https://user:pass@example.test/model.json", { fetch: async () => new Response() }),
    errorCode("UNSAFE_MODEL_URL"),
  );
  await assert.rejects(
    readDomBrowserUrl("file:///tmp/model.json", { fetch: async () => new Response() }),
    errorCode("UNSAFE_MODEL_URL"),
  );
});

test("browser URL reader cancels response bodies rejected by headers or streaming limits", async () => {
  const modelUrl = "https://packages.example/models/oversized.json";
  await assert.rejects(
    readDomBrowserUrl(modelUrl, { fetch: async () => null }),
    errorCode("INVALID_FETCH_RESPONSE"),
  );

  let httpCancelled = 0;
  const httpResponse = {
    ok: false,
    status: 404,
    body: { async cancel() { httpCancelled += 1; } },
  };
  await assert.rejects(
    readDomBrowserUrl(modelUrl, { fetch: async () => httpResponse }),
    errorCode("MODEL_FETCH_FAILED"),
  );
  assert.equal(httpCancelled, 1);

  let buffered = 0;
  const unstreamableResponse = {
    ok: true,
    status: 200,
    headers: { get: () => null },
    body: null,
    async arrayBuffer() { buffered += 1; return new ArrayBuffer(0); },
  };
  await assert.rejects(
    readDomBrowserUrl(modelUrl, { fetch: async () => unstreamableResponse }),
    errorCode("UNSTREAMABLE_FETCH_RESPONSE"),
  );
  assert.equal(buffered, 0);

  let headerCancelled = 0;
  const headerResponse = {
    ok: true,
    status: 200,
    headers: { get: (name) => name === "content-length" ? "17" : null },
    body: { async cancel() { headerCancelled += 1; } },
  };
  await assert.rejects(
    readDomBrowserUrl(modelUrl, { fetch: async () => headerResponse, limits: { maxFileBytes: 16 } }),
    errorCode("FILE_LIMIT"),
  );
  assert.equal(headerCancelled, 1);

  let streamCancelled = 0;
  let reads = 0;
  const streamResponse = {
    ok: true,
    status: 200,
    headers: { get: () => null },
    body: {
      getReader() {
        return {
          async read() {
            reads += 1;
            return { done: false, value: new Uint8Array(17) };
          },
          async cancel() { streamCancelled += 1; },
        };
      },
    },
  };
  await assert.rejects(
    readDomBrowserUrl(modelUrl, { fetch: async () => streamResponse, limits: { maxFileBytes: 16 } }),
    errorCode("FILE_LIMIT"),
  );
  assert.equal(reads, 1);
  assert.equal(streamCancelled, 1);
});

function descendants(element) {
  const values = [];
  for (const child of element.childNodes) {
    values.push(child, ...descendants(child));
  }
  return values;
}

test("mount rejects a valid but unsupported profile closure before host mutation", async () => {
  const built = buildDom(await syntheticInput());
  const result = await readBuiltBrowser(built);
  const { document, urls } = fakeBrowserDocument();
  const host = new FakeElement(document, "main");
  const priorChild = new FakeElement(document, "p");
  host.appendChild(priorChild);
  host.setAttribute("data-domformat-root", "prior");
  host.style.position = "sticky";

  const phases = [];
  await assert.rejects(mountDom(result, host, {
    animate: false,
    onLifecyclePhase: (phase) => phases.push(phase),
  }), errorCode("UNSUPPORTED_MOUNT_CONTRACT"));
  assert.deepEqual(phases, ["destroy"]);
  assert.deepEqual(host.childNodes, [priorChild]);
  assert.equal(priorChild.parentNode, host);
  assert.equal(host.getAttribute("data-domformat-root"), "prior");
  assert.equal(host.style.position, "sticky");
  assert.equal(host.hasAttribute("style"), false);
  assert.equal(host.hasAttribute("data-domformat-instance"), false);
  assert.equal(host.hasAttribute("tabindex"), false);
  assert.equal(document.head.childNodes.length, 0);
  assert.deepEqual(urls.revoked, []);
  assert.deepEqual(urls.created, []);
});

test("mount publishes a static presentation without playback, effects, input listeners, or a scheduler", async () => {
  const built = buildDom(await syntheticStaticPresentationInput());
  const result = await readBuiltBrowser(built);
  const { document } = fakeBrowserDocument();
  let scheduled = 0;
  document.defaultView.requestAnimationFrame = () => { scheduled += 1; return scheduled; };
  document.defaultView.cancelAnimationFrame = () => {};
  const host = new FakeElement(document, "main");
  const runtime = await mountDom(result, host);
  assert.equal(runtime.sourceFrame, 1);
  assert.equal(runtime.seek(1), 1);
  assert.throws(() => runtime.seek(2), errorCode("FRAME_RANGE"));
  assert.equal(scheduled, 0);
  assert.equal(host.hasAttribute("tabindex"), false);
  assert.equal([...host.listeners.keys()].some((key) => key.startsWith("keydown:")), false);
  const mounted = descendants(host.childNodes[0]);
  const byId = new Map(result.document.tree.nodes.map((node, index) => [node.id, mounted[index]]));
  assert.equal(byId.get("synthetic-polycss/camera").style.transform, "");
  runtime.destroy();
});

test("responsive presentation switches prepared orientation exactly at its viewport breakpoint", async () => {
  const built = buildDom(await syntheticResponsivePresentationInput());
  const result = await readBuiltBrowser(built);
  const { document, observers, namespaced } = fakeBrowserDocument();
  const host = new FakeElement(document, "main");
  const runtime = await mountDom(result, host);
  const mountSurface = host.childNodes[0];
  const cameraIndex = result.document.tree.nodes.findIndex((node) => node.id === "synthetic-polycss/camera");
  const camera = namespaced[cameraIndex];
  const identity = camera;

  assert.equal(camera.style.transform, "rotate(90deg) scale(0.933333)");
  mountSurface.clientWidth = 599;
  observers[0].callback();
  assert.equal(camera.style.left, "139.5px");
  assert.equal(camera.style.transform, "rotate(90deg) scale(0.933333)");

  mountSurface.clientWidth = 600;
  observers[0].callback();
  assert.equal(camera.style.left, "140px");
  assert.equal(camera.style.top, "0px");
  assert.equal(camera.style.transform, "");
  assert.equal(namespaced[cameraIndex], identity);
  runtime.destroy();
});

test("viewport profiles switch same-topology leaf layout and catch up paint before reveal", async () => {
  const built = buildDom(await syntheticViewportProfilesInput());
  const result = await readBuiltBrowser(built);
  const { document, observers, namespaced, writes } = fakeBrowserDocument();
  const host = new FakeElement(document, "main");
  const runtime = await mountDom(result, host, { animate: false, mode: "animation" });
  const mountSurface = host.childNodes[0];
  const leafIndex = result.document.tree.nodes.findIndex((node) => node.id === "synthetic/leaf");
  const eyeLeafIndex = result.document.tree.nodes.findIndex((node) => node.id === "synthetic/eye-leaf");
  const leaf = namespaced[leafIndex];
  const eyeLeaf = namespaced[eyeLeafIndex];
  const identity = leaf;

  assert.equal(leaf.style.visibility, "hidden");
  assert.match(eyeLeaf.style.transform, /,10,0,0,1\)$/u);
  runtime.seek(2);
  writes.splice(0);
  mountSurface.clientWidth = 600;
  observers[0].callback();

  assert.equal(namespaced[leafIndex], identity);
  assert.equal(leaf.style.backgroundPositionY, "-32px");
  assert.equal(leaf.style.visibility, "visible");
  assert.deepEqual(
    writes.filter((write) => write.element === leaf && ["transform", "backgroundPositionY", "visibility"].includes(write.property)).map((write) => write.property),
    ["transform", "backgroundPositionY", "visibility"],
  );

  writes.splice(0);
  mountSurface.clientWidth = 620;
  observers[0].callback();
  assert.deepEqual(writes.filter((write) => write.element === leaf || write.element === eyeLeaf), []);
  runtime.destroy();
});

test("responsive playback timelines restart before animation reveal and survive interaction mode", async () => {
  const built = buildDom(await syntheticProfileTimelinesInput());
  const result = await readBuiltBrowser(built);
  const browser = fakeBrowserDocument();
  const host = new FakeElement(browser.document, "main");
  const runtime = await mountDom(result, host, { animate: true, mode: "animation" });
  const mountSurface = host.childNodes[0];

  browser.frame(0);
  browser.frame(34);
  assert.equal(runtime.sourceFrame, 3, "the initial mobile profile is selected before first publication");
  assert.equal(runtime.setMode("interaction"), "interaction");
  assert.equal(runtime.sourceFrame, 3);
  mountSurface.clientWidth = 600;
  browser.observers[0].callback();
  assert.equal(runtime.sourceFrame, 3, "profile selection does not overwrite interaction state");

  assert.equal(runtime.setMode("animation"), "animation");
  assert.equal(runtime.sourceFrame, 1, "animation re-entry restarts the selected desktop timeline");
  browser.frame(68);
  assert.equal(runtime.sourceFrame, 2, "desktop falls back to the required baseline timeline");

  mountSurface.clientWidth = 599;
  browser.observers[0].callback();
  assert.equal(runtime.sourceFrame, 1, "changed animation profile restarts before viewport publication");
  browser.frame(102);
  assert.equal(runtime.sourceFrame, 3, "the selected mobile override drives animation after restart");
  assert.equal(runtime.mode, "animation");
  runtime.destroy();
});

test("landscape-first profile timelines select before publication and preserve interaction state", async () => {
  const built = buildDom(await syntheticAspectProfileTimelinesInput());
  const result = await readBuiltBrowser(built);
  const browser = fakeBrowserDocument();
  const host = new FakeElement(browser.document, "main");
  const runtime = await mountDom(result, host, { animate: true, mode: "animation" });
  const surface = host.childNodes[0];

  browser.frame(0);
  browser.frame(34);
  assert.equal(runtime.sourceFrame, 2, "320x240 landscape starts on the baseline timeline");
  const baselineDeadline = [...browser.timers.values()][0].due;
  surface.clientWidth = 600;
  surface.clientHeight = 800;
  browser.observers[0].callback();
  assert.equal(runtime.sourceFrame, 2, "portrait baseline bands do not restart an unchanged timeline");
  assert.equal([...browser.timers.values()][0].due, baselineDeadline, "an unchanged timeline keeps its scheduler deadline");
  assert.equal(runtime.setMode("interaction"), "interaction");
  assert.equal(runtime.sourceFrame, 3);
  surface.clientWidth = 240;
  surface.clientHeight = 320;
  browser.observers[0].callback();
  assert.equal(runtime.sourceFrame, 3, "portrait phone selection preserves interaction publication");

  assert.equal(runtime.setMode("animation"), "animation");
  assert.equal(runtime.sourceFrame, 1, "animation re-entry restarts the selected phone timeline");
  browser.frame(68);
  assert.equal(runtime.sourceFrame, 3, "phone profile uses its prepared override");

  surface.clientWidth = 320;
  surface.clientHeight = 240;
  browser.observers[0].callback();
  assert.equal(runtime.sourceFrame, 1, "landscape profile change restarts before reveal");
  browser.frame(102);
  assert.equal(runtime.sourceFrame, 2, "landscape returns to the baseline timeline");
  runtime.destroy();
});

test("landscape-first profile changes preserve animate:false through interaction round trips", async () => {
  const built = buildDom(await syntheticAspectProfileTimelinesInput());
  const result = await readBuiltBrowser(built);
  const browser = fakeBrowserDocument();
  const host = new FakeElement(browser.document, "main");
  const runtime = await mountDom(result, host, { animate: false, mode: "animation" });
  const surface = host.childNodes[0];

  assert.equal(runtime.seek(2), 2);
  surface.clientWidth = 240;
  surface.clientHeight = 320;
  browser.observers[0].callback();
  assert.equal(runtime.sourceFrame, 1, "phone timeline change synchronously restarts the prepared initial frame");
  assert.equal(browser.timers.size, 0);
  assert.equal(browser.raf.size, 0);
  browser.frame(1000);
  assert.equal(runtime.sourceFrame, 1, "responsive selection does not enable scheduling");

  assert.equal(runtime.setMode("interaction"), "interaction");
  assert.equal(runtime.sourceFrame, 3);
  surface.clientWidth = 320;
  surface.clientHeight = 240;
  browser.observers[0].callback();
  assert.equal(runtime.sourceFrame, 3, "landscape selection preserves interaction publication");
  assert.equal(runtime.setMode("animation"), "animation");
  assert.equal(runtime.sourceFrame, 1);
  browser.frame(2000);
  assert.equal(runtime.sourceFrame, 1, "animation re-entry preserves animate:false");
  runtime.destroy();
});

test("responsive restart without interaction keeps the playback initial page resident after disjoint lookahead", async () => {
  const built = buildDom(await syntheticPagedProfileTimelinesWithoutInteractionInput());
  const result = await readBuiltBrowser(built);
  const browser = fakeBrowserDocument();
  const host = new FakeElement(browser.document, "main");
  const runtime = await mountDom(result, host, { animate: true, mode: "animation" });
  const mountSurface = host.childNodes[0];

  assert.equal(await runtime.seekAsync(5), 5);
  await flushAsyncWork();
  mountSurface.clientWidth = 600;
  browser.observers[0].callback();
  assert.equal(runtime.sourceFrame, 1, "the profile restart publishes from the pinned initial page");
  browser.frame(0);
  for (let turn = 0; turn < 128 && runtime.sourceFrame !== 2; turn += 1) {
    await flushAsyncWork(1);
    browser.frame(34);
  }
  assert.equal(runtime.sourceFrame, 2);
  runtime.destroy();
});

test("smallest-covering viewport profiles select the first fitting prepared row", async () => {
  const built = buildDom(await syntheticViewportProfilesInput("smallest-covering"));
  const result = await readBuiltBrowser(built);
  const { document, observers, namespaced, writes } = fakeBrowserDocument();
  const host = new FakeElement(document, "main");
  const runtime = await mountDom(result, host, { animate: false, mode: "animation" });
  const mountSurface = host.childNodes[0];
  const leafIndex = result.document.tree.nodes.findIndex((node) => node.id === "synthetic/leaf");
  const leaf = namespaced[leafIndex];
  assert.equal(leaf.style.visibility, "hidden");

  mountSurface.clientWidth = 500;
  mountSurface.clientHeight = 400;
  observers[0].callback();
  assert.equal(leaf.style.visibility, "visible");
  writes.splice(0);
  mountSurface.clientWidth = 550;
  observers[0].callback();
  assert.deepEqual(writes.filter((write) => write.element === leaf), []);
  runtime.destroy();
});

test("typed orbit input clamps model controls and coalesces cyclic prepared surface writes", async () => {
  const built = buildDom(await syntheticOrbitInput());
  const result = await readBuiltBrowser(built);
  const { document, namespaced, writes } = fakeBrowserDocument();
  const host = new FakeElement(document, "main");
  const runtime = await mountDom(result, host, { animate: false });
  const modelIndex = result.document.tree.nodes.findIndex((node) => node.id === "synthetic-polycss/model");
  const leafIndex = result.document.tree.nodes.findIndex((node) => node.id === "synthetic-polycss/leaf");
  const model = namespaced[modelIndex];
  const leaf = namespaced[leafIndex];
  const identities = [model, leaf];
  assert.equal(leaf.style.backgroundPosition, "0 0");

  writes.splice(0);
  assert.equal(runtime.setInput("orbit.yaw", 90), 90);
  assert.match(model.style.transform, /rotateY\(90deg\)/u);
  assert.equal(leaf.style.backgroundPosition, "0 -480px");
  assert.deepEqual(writes.filter((write) => write.element === leaf), [
    { element: leaf, property: "backgroundPosition", value: "0 -480px" },
  ]);

  writes.splice(0);
  assert.equal(runtime.setInput("orbit.pitch", 100), 28);
  assert.match(model.style.transform, /rotateX\(28deg\)/u);
  assert.equal(runtime.setInput("orbit.zoom", 0), 0.5);
  assert.match(model.style.transform, /scale3d\(0\.5, 0\.516, 0\.5\)/u);
  assert.throws(() => runtime.setInput("orbit.roll", 1), errorCode("UNKNOWN_EXTERNAL_INPUT"));
  assert.throws(() => runtime.setInput("orbit.yaw", Number.NaN), errorCode("INVALID_EXTERNAL_INPUT"));
  assert.equal(namespaced[modelIndex], identities[0]);
  assert.equal(namespaced[leafIndex], identities[1]);
  runtime.destroy();
  assert.throws(() => runtime.setInput("orbit.yaw", 0), errorCode("MOUNT_DESTROYED"));
});

test("documents without external input reject the closed runtime operation", async () => {
  const built = buildDom(await syntheticStaticPresentationInput());
  const result = await readBuiltBrowser(built);
  const { document } = fakeBrowserDocument();
  const runtime = await mountDom(result, new FakeElement(document, "main"), { animate: false });
  assert.throws(() => runtime.setInput("orbit.yaw", 0), errorCode("UNKNOWN_EXTERNAL_INPUT"));
  runtime.destroy();
});

test("mount runs prepared animation without an effects interpreter", async () => {
  const built = buildDom(await syntheticAnimationWithoutEffectsInput());
  const result = await readBuiltBrowser(built);
  const { document } = fakeBrowserDocument();
  const host = new FakeElement(document, "main");
  const runtime = await mountDom(result, host, { animate: false });
  assert.equal(runtime.sourceFrame, 1);
  assert.equal(runtime.seek(1), 1);
  runtime.destroy();
});

test("prepared playback sleeps on an owned deadline timer instead of polling display frames", async () => {
  const built = buildDom(await syntheticExecutableInteractionInput());
  const result = await readBuiltBrowser(built);
  const fake = fakeBrowserDocument();
  const runtime = await mountDom(result, new FakeElement(fake.document, "main"), { mode: "animation" });
  assert.equal(fake.timers.size, 1);
  assert.equal(fake.raf.size, 0);
  for (const timestamp of [8, 16, 24, 32]) {
    assert.equal(fake.advance(timestamp), 0);
    assert.equal(fake.raf.size, 0);
  }
  assert.equal(fake.advance(33), 1);
  assert.equal(fake.timers.size, 1);
  assert.equal(fake.raf.size, 0);
  for (const timestamp of [40, 48, 56, 64]) assert.equal(fake.advance(timestamp), 0);
  assert.equal(fake.advance(66), 1);
  assert.equal(fake.timers.size, 1);
  runtime.setMode("interaction");
  assert.equal(fake.timers.size, 1);
  assert.equal(fake.raf.size, 0);
  runtime.destroy();
  assert.equal(fake.timers.size, 0);
  assert.equal(fake.raf.size, 0);
});

test("closed compositor timing animates model cycles without per-tick JS and snaps nonsequential publication", async () => {
  const built = buildDom(await syntheticCompositorTimingInput());
  const result = await readBuiltBrowser(built);
  const fake = fakeBrowserDocument();
  const runtime = await mountDom(result, new FakeElement(fake.document, "main"), { mode: "animation" });
  const modelIndex = result.document.tree.nodes.findIndex((node) => node.id === "synthetic/scene");
  const leafIndex = result.document.tree.nodes.findIndex((node) => node.id === "synthetic/leaf");
  const model = fake.namespaced[modelIndex];
  const leaf = fake.namespaced[leafIndex];
  assert.equal(model.animations.length, 1);
  const animation = model.animations[0];
  assert.equal(animation.options.easing, "linear");
  assert.equal(animation.options.iterations, Infinity);
  assert.equal(animation.keyframes.length, 3);
  assert.equal(animation.playState, "running");

  fake.writes.splice(0);
  fake.advance(33);
  assert.deepEqual(fake.writes.filter((write) => write.element === model && write.property === "transform"), []);
  const sequential = fake.writes.filter((write) => write.element === leaf && ["transition", "transform"].includes(write.property));
  assert.deepEqual(sequential.map((write) => write.property), ["transition", "transform"]);
  assert.match(sequential[0].value, /^transform .*ms linear$/u);

  fake.writes.splice(0);
  const getBoundingClientRect = leaf.getBoundingClientRect.bind(leaf);
  leaf.getBoundingClientRect = () => {
    fake.writes.push(Object.freeze({ element: leaf, property: "layout", value: "flush" }));
    return getBoundingClientRect();
  };
  runtime.seek(4);
  const snap = fake.writes.filter((write) => write.element === leaf && ["transition", "transform", "layout"].includes(write.property));
  assert.deepEqual(snap.map((write) => write.property), ["transition", "transform", "layout", "transition"]);
  assert.equal(snap[0].value, "none");
  assert.ok(Math.abs(animation.currentTime - 1000 / 30) < 1e-12);
  runtime.setMode("interaction");
  assert.equal(animation.playState, "paused");
  runtime.setMode("animation");
  assert.equal(animation.playState, "running");
  assert.equal(animation.currentTime, 0);
  runtime.destroy();
  assert.equal(animation.playState, "idle");
});

test("animate false remains compositor-paused across interaction and animation modes", async () => {
  const built = buildDom(await syntheticCompositorTimingInput());
  const result = await readBuiltBrowser(built);
  const fake = fakeBrowserDocument();
  const host = new FakeElement(fake.document, "main");
  const runtime = await mountDom(result, host, { animate: false, mode: "animation" });
  const modelIndex = result.document.tree.nodes.findIndex((node) => node.id === "synthetic/scene");
  const animation = fake.namespaced[modelIndex].animations[0];
  assert.equal(animation.playState, "paused");
  assert.equal(fake.timers.size, 0);

  runtime.setMode("interaction");
  runtime.setMode("animation");
  assert.equal(animation.playState, "paused");
  assert.equal(animation.currentTime, 0);
  assert.equal(fake.timers.size, 0);
  assert.equal(fake.raf.size, 0);
  runtime.destroy();
  assert.equal(animation.playState, "idle");
});

test("mount materializes exact declared descendant variant effects", async () => {
  const input = await syntheticAdapterTechniquesInput();
  const leaf = input.tree.nodes.find((node) => node.id === "synthetic-polycss/leaf");
  const owner = input.tree.nodes.find((node) => node.id === "synthetic-polycss/model");
  leaf.classes = leaf.classes.filter((token) => !token.startsWith("material-"));
  owner.classes.push("material-a");
  const binding = input.bindings.channels.find((channel) => channel.id === "variants");
  binding.targets = { effectNodes: [leaf.id], nodes: [owner.id] };
  const packet = input.state.channels.find((channel) => channel.id === "variants").data.packet;
  for (const effect of packet.effects) effect.targetIndex = 0;

  const built = buildDom(input);
  const result = await readBuiltBrowser(built);
  const { document, namespaced } = fakeBrowserDocument();
  const host = new FakeElement(document, "main");
  const runtime = await mountDom(result, host, { animate: false });
  const variantStyle = document.head.childNodes.find((element) => element.dataset.domformatStylesheet === "prepared-variants");
  assert.ok(variantStyle);
  assert.match(variantStyle.textContent, new RegExp(`\\[data-domformat-node="${owner.index}"\\]\\.material-a \\[data-domformat-node="${leaf.index}"\\]\\{color:#f00\\}`, "u"));
  assert.equal(namespaced[owner.index].getAttribute("data-domformat-node"), String(owner.index));
  assert.equal(namespaced[leaf.index].getAttribute("data-domformat-node"), String(leaf.index));
  assert.deepEqual(namespaced[owner.index].classes, [...owner.classes]);
  runtime.seek(2);
  assert.deepEqual(namespaced[owner.index].classes, owner.classes.map((token) => token === "material-a" ? "material-b" : token));
  runtime.destroy();
});

test("paged variants load the initial page before attach and retain the current/lookahead window plus fixed pins", async () => {
  const built = buildDom(await syntheticEvictingPagedVariantsInput());
  const all = builtExternalResources(built);
  const eager = new Map(all);
  for (const record of built.document.resources.resources) if (record.kind === "state-page") eager.delete(record.id);
  const calls = [];
  const result = await readDomBrowser(built.bytes, {
    externalResources: eager,
    async loadExternalResource(record, signal) {
      calls.push([record.id, signal]);
      return all.get(record.id);
    },
  });
  assert.deepEqual(calls, []);
  assert.equal(result.resourceBytes.size, eager.size);

  const { document, namespaced } = fakeBrowserDocument();
  const host = new FakeElement(document, "main");
  const runtime = await mountDom(result, host, { animate: false });
  const leafIndex = result.document.tree.nodes.findIndex((node) => node.id === "synthetic/leaf");
  const leaf = namespaced[leafIndex];
  assert.equal(calls[0][0], "variant-page-1");
  assert.equal(leaf.classes.includes("material-a"), true);
  await flushAsyncWork();
  assert.deepEqual(calls.map(([id]) => id), ["variant-page-1", "variant-page-2", "variant-page-3"]);

  assert.equal(await runtime.seekAsync(7), 7);
  assert.equal(leaf.classes.includes("material-a"), true);
  assert.equal(await runtime.seekAsync(4), 4);
  assert.equal(leaf.classes.includes("material-b"), true);
  assert.deepEqual(
    calls.filter(([id]) => id === "variant-page-1" || id === "variant-page-2").map(([id]) => id),
    ["variant-page-1", "variant-page-2"],
  );
  assert.equal(await runtime.seekAsync(5), 5);
  assert.throws(() => runtime.seek(7), errorCode("STATE_PAGE_NOT_READY"));
  assert.equal(runtime.sourceFrame, 5);
  assert.equal(leaf.classes.includes("material-a"), true);
  assert.equal(await runtime.seekAsync(7), 7);
  assert.equal(calls.filter(([id]) => id === "variant-page-6").length, 2);
  assert.deepEqual(
    calls.filter(([id]) => id === "variant-page-1" || id === "variant-page-2").map(([id]) => id),
    ["variant-page-1", "variant-page-2"],
  );
  runtime.destroy();
});

test("paged variant admission never transiently exceeds the decoded residency ceiling", async () => {
  const built = buildDom(await syntheticEvictingPagedVariantsInput());
  const all = builtExternalResources(built);
  const fake = fakeBrowserDocument();
  const mounted = {
    byId: new Map(built.document.tree.nodes.map((node) => [node.id, new FakeElement(fake.document, node.name)])),
  };
  let corruptPage3 = false;
  const page3ResidentCounts = [];
  let paged;
  paged = createPolycssPagedState(built.document, mounted, DEFAULT_LIMITS, async (record) => {
    if (record.id === "variant-page-3") page3ResidentCounts.push(paged.residentResources.length);
    return corruptPage3 && record.id === "variant-page-3" ? new TextEncoder().encode("{}") : all.get(record.id);
  });
  assert.ok(paged);
  await paged.prepareInitial();
  await paged.ensureFrame(7);
  const beforeFailedMaterialization = paged.residentResources;
  corruptPage3 = true;
  await assert.rejects(paged.ensureFrame(3), errorCode("INVALID_STATE_PAGE"));
  assert.deepEqual(paged.residentResources, beforeFailedMaterialization);
  corruptPage3 = false;
  await paged.ensureFrame(3);
  assert.equal(paged.peakResidentPages, 4);
  assert.equal(paged.residentResources.length, 4);
  assert.deepEqual(page3ResidentCounts, [3, 3]);
  paged.destroy();
});

test("sequential paged variants compare only their resident typed target range", async () => {
  const targetCount = 1_984;
  const target = 937;
  const keyframe = new Array(targetCount).fill(0);
  const payload = {
    version: 0,
    codec: "polycss-paged-variants-page@0",
    channel: "variants",
    startFrame: 1,
    endFrame: 3,
    keyframeClassIndicesBase64: base64Integers(keyframe, 2),
    sequential: {
      offsetsBase64: base64Integers([0, 0, 1, 2], 4),
      targetIndicesBase64: base64Integers([target, target + 1], 2),
      classIndicesBase64: base64Integers([1, 1], 2),
    },
  };
  const bytes = encodeCanonicalJson(payload);
  const materializedByteLength = targetCount * 2 + 16 + 8;
  const ids = Array.from({ length: targetCount }, (_, index) => `variant:${index}`);
  const fake = fakeBrowserDocument();
  const nodes = ids.map((id) => {
    const node = new FakeElement(fake.document, "s");
    node.classList.add("class-a");
    return [id, node];
  });
  fake.writes.splice(0);
  const document = {
    state: { channels: [{ id: "variants", codec: "polycss-paged-variants@0", data: { packet: {
      frameCount: 3,
      classes: ["class-a", "class-b"],
      initial: { frame: 1, classIndicesBase64: base64Integers(keyframe, 2) },
      pages: [{ resource: "variants-page", startFrame: 1, endFrame: 3, changeCount: 2, materializedByteLength }],
      lookaheadPages: 1,
      maxResidentPages: 2,
    } } }] },
    bindings: { channels: [{ id: "variants", state: "variants", interpreter: "polycss-paged-variants@0", targets: { nodes: ids } }] },
    resources: { resources: [{ id: "variants-page", kind: "state-page", decodedByteLength: bytes.length }] },
  };
  const diagnostics = createPolycssPublicationDiagnostics();
  const pagedState = createPolycssPagedState(document, { byId: new Map(nodes) }, DEFAULT_LIMITS, async () => bytes, { diagnostics });
  await pagedState.prepareInitial();
  resetPublicationDiagnostics(diagnostics);

  const staged = withoutSequentialRangeCopies(() => pagedState.stage(2, false));
  assert.equal(staged.variants.kind, "range");
  assert.equal(Object.hasOwn(staged.variants, "targets"), false);
  assert.equal(Object.hasOwn(staged.variants, "classes"), false);
  assert.ok(ArrayBuffer.isView(staged.variants.page.targets));
  const restaged = pagedState.stage(2, false);
  assert.equal(restaged.variants.page, staged.variants.page);
  assert.throws(() => pagedState.commit(staged), errorCode("INVALID_PLAYBACK_PUBLICATION"));
  withoutSequentialRangeCopies(() => pagedState.commit(restaged));
  assert.equal(diagnostics.variantLogicalTargetVisits, 1);
  assert.equal(diagnostics.variantComparisonTargetVisits, 1);
  assert.equal(diagnostics.variantCanonicalReconstructions, 0);
  assert.equal(diagnostics.variantDomWrites, 2);
  assert.deepEqual(fake.writes.map((write) => [write.element === nodes[target][1] ? target : -1, write.property]), [[target, "class:remove"], [target, "class:add"]]);

  resetPublicationDiagnostics(diagnostics);
  fake.writes.splice(0);
  pagedState.publishVariants(2);
  assert.equal(diagnostics.variantCanonicalReconstructions, 0);
  assert.equal(diagnostics.variantLogicalTargetVisits, 0);
  assert.equal(diagnostics.variantComparisonTargetVisits, targetCount);
  assert.deepEqual(fake.writes, []);

  resetPublicationDiagnostics(diagnostics);
  pagedState.publishVariants(1);
  assert.equal(diagnostics.variantCanonicalReconstructions, 1, "page-start publication must retain an immutable complete stage");
  assert.equal(diagnostics.variantLogicalTargetVisits, targetCount);
  assert.equal(diagnostics.variantComparisonTargetVisits, targetCount, "page-start complete publication must compare the full published row");
  assert.deepEqual(nodes[target][1].classes, ["class-a"]);
  pagedState.destroy();
});

test("paged playback mutates sparse canonical rows in place and visits every declared dense target", async () => {
  const exercise = async (input) => {
    const built = buildDom(await input);
    const all = builtExternalResources(built);
    const fake = fakeBrowserDocument();
    const mounted = { byId: new Map(built.document.tree.nodes.map((node) => {
      const element = new FakeElement(fake.document, node.name);
      Object.assign(element.style, node.styles ?? {});
      for (const className of node.classes) element.classList.add(className);
      return [node.id, element];
    })) };
    const diagnostics = createPolycssPublicationDiagnostics();
    const pagedState = createPolycssPagedState(built.document, mounted, DEFAULT_LIMITS, async (record) => all.get(record.id), { diagnostics });
    await pagedState.prepareInitial();
    const playback = createPolycssPlayback(materializePolycssState(built.document.state), built.document.bindings, mounted, {
      publishAppearance() {},
      pagedState,
      assertPagedFrameReady: (frame) => pagedState.assertFrameReady(frame),
      diagnostics,
    });
    playback.publishInitial();
    return { built, diagnostics, fake, mounted, pagedState, playback };
  };

  const sparse = await exercise(syntheticPagedPlaybackChangesInput({ variants: false }));
  await sparse.pagedState.ensureFrame(2);
  sparse.playback.advance();
  await sparse.pagedState.ensureFrame(3);
  sparse.playback.advance();
  const sparseCanonical = sparse.pagedState.canonicalPlayback;
  const sparseShapeRow = sparseCanonical.shapeTransforms;
  const sparseVisibilityRow = sparseCanonical.shapeVisibility;
  const sparseLeafRow = sparseCanonical.leafTransforms;
  resetPublicationDiagnostics(sparse.diagnostics);
  const sparseStage = withoutSequentialRangeCopies(() => sparse.pagedState.stage(4));
  assert.equal(sparseStage.playback.kind, "range");
  for (const property of ["shapeTargets", "shapeTransforms", "shapeVisibility", "leafTargets", "leafTransforms"]) assert.equal(Object.hasOwn(sparseStage.playback, property), false);
  withoutSequentialRangeCopies(() => sparse.playback.advance());
  assert.equal(sparse.playback.sourceFrame, 4);
  assert.equal(sparse.pagedState.canonicalPlayback, sparseCanonical);
  assert.equal(sparse.pagedState.canonicalPlayback.shapeTransforms, sparseShapeRow);
  assert.equal(sparse.pagedState.canonicalPlayback.shapeVisibility, sparseVisibilityRow);
  assert.equal(sparse.pagedState.canonicalPlayback.leafTransforms, sparseLeafRow);
  assert.equal(sparse.diagnostics.playbackCanonicalReconstructions, 0);
  assert.equal(sparse.diagnostics.playbackCanonicalShapeVisits, 1);
  assert.equal(sparse.diagnostics.playbackCanonicalLeafVisits, 0);
  assert.equal(sparse.diagnostics.playbackBoundaryShapeVisits, 0);
  assert.equal(sparse.diagnostics.playbackBoundaryLeafVisits, 0);
  assert.equal(sparse.diagnostics.playbackPublicationShapeVisits, 1);
  assert.equal(sparse.diagnostics.playbackPublicationLeafVisits, 0);
  sparse.pagedState.destroy();

  const denseInput = syntheticPagedPlaybackInput({ ranges: [[1, 8]], mutate(input) {
    const packet = input.state.channels.find((channel) => channel.codec === "polycss-playback-packed@0").data.packet;
    packet.transforms.count = 9;
    const changed = [1, 0, 0, 0, 1, 0, 0, 0, 1, 10, 0, 0];
    for (const group of [packet.transforms.groups[1], packet.transforms.groups[2]]) group.columns = changed.map((value) => [value]);
    for (const group of [packet.transforms.groups[3], packet.transforms.groups[4]]) group.columns.forEach((column, component) => column.push(component === 9 ? 10_000 : column[0]));
    packet.shapeChanges = { sources: [0, 1], transforms: [5, 1], visibility: [0, 0] };
    packet.frameRows[1][3] = 0;
    packet.frameRows[1][4] = 2;
    packet.leafChanges = { sources: [0, 1], transforms: [7, 1] };
    packet.frameRows[1][5] = 0;
    packet.frameRows[1][6] = 2;
  } });
  const dense = await exercise(denseInput);
  const retained = [...dense.mounted.byId.values()];
  resetPublicationDiagnostics(dense.diagnostics);
  dense.playback.advance();
  assert.equal(dense.diagnostics.playbackCanonicalReconstructions, 0);
  assert.equal(dense.diagnostics.playbackCanonicalShapeVisits, 2);
  assert.equal(dense.diagnostics.playbackCanonicalLeafVisits, 2);
  assert.equal(dense.diagnostics.playbackPublicationShapeVisits, 2);
  assert.equal(dense.diagnostics.playbackPublicationLeafVisits, 2);
  assert.deepEqual([...dense.mounted.byId.values()], retained);

  resetPublicationDiagnostics(dense.diagnostics);
  dense.playback.seek(6);
  assert.equal(dense.diagnostics.playbackCanonicalReconstructions, 1);
  assert.equal(dense.diagnostics.playbackCanonicalShapeVisits, 2);
  assert.equal(dense.diagnostics.playbackCanonicalLeafVisits, 2);
  assert.equal(dense.diagnostics.playbackPublicationShapeVisits, 2);
  assert.equal(dense.diagnostics.playbackPublicationLeafVisits, 2);

  dense.pagedState.commit(dense.pagedState.stage(8));
  const wrapCanonical = dense.pagedState.canonicalPlayback;
  const wrapShapeRow = wrapCanonical.shapeTransforms;
  const wrapLeafRow = wrapCanonical.leafTransforms;
  resetPublicationDiagnostics(dense.diagnostics);
  const wrap = withoutPlaybackBoundaryAllocations(() => dense.pagedState.stage(1));
  assert.equal(wrap.playback.kind, "range");
  const densePacket = dense.built.document.state.channels.find((channel) => channel.codec === "polycss-paged-playback@0").data.packet;
  assert.equal(dense.diagnostics.playbackBoundaryShapeVisits, densePacket.shapeCount + wrap.playback.shapeEnd - wrap.playback.shapeStart);
  assert.equal(dense.diagnostics.playbackBoundaryLeafVisits, densePacket.leafCount + wrap.playback.leafEnd - wrap.playback.leafStart);
  dense.pagedState.commit(wrap);
  assert.equal(dense.pagedState.canonicalPlayback, wrapCanonical);
  assert.equal(dense.pagedState.canonicalPlayback.shapeTransforms, wrapShapeRow);
  assert.equal(dense.pagedState.canonicalPlayback.leafTransforms, wrapLeafRow);
  assert.equal(dense.diagnostics.playbackCanonicalReconstructions, 0);
  assert.equal(dense.diagnostics.playbackCanonicalShapeVisits, 2);
  assert.equal(dense.diagnostics.playbackCanonicalLeafVisits, 2);
  dense.pagedState.destroy();
});

test("cross-page playback boundary validation avoids target-sized temporary rows and ranges", async () => {
  const built = buildDom(await syntheticPagedPlaybackChangesInput({ variants: false }));
  const all = builtExternalResources(built);
  const fake = fakeBrowserDocument();
  const mounted = { byId: new Map(built.document.tree.nodes.map((node) => {
    const element = new FakeElement(fake.document, node.name);
    Object.assign(element.style, node.styles ?? {});
    return [node.id, element];
  })) };
  const diagnostics = createPolycssPublicationDiagnostics();
  const pagedState = createPolycssPagedState(built.document, mounted, DEFAULT_LIMITS, async (record) => all.get(record.id), { diagnostics });
  await pagedState.prepareInitial();
  await pagedState.ensureFrame(2);
  resetPublicationDiagnostics(diagnostics);
  const withinPage = pagedState.stage(2);
  assert.equal(diagnostics.playbackBoundaryShapeVisits, 0);
  assert.equal(diagnostics.playbackBoundaryLeafVisits, 0);
  pagedState.commit(withinPage);
  resetPublicationDiagnostics(diagnostics);
  await pagedState.ensureFrame(3);
  const staged = withoutPlaybackBoundaryAllocations(() => pagedState.stage(3));
  assert.equal(staged.playback.kind, "range");
  const packet = built.document.state.channels.find((channel) => channel.codec === "polycss-paged-playback@0").data.packet;
  assert.equal(diagnostics.playbackBoundaryShapeVisits, packet.shapeCount + staged.playback.shapeEnd - staged.playback.shapeStart);
  assert.equal(diagnostics.playbackBoundaryLeafVisits, packet.leafCount + staged.playback.leafEnd - staged.playback.leafStart);
  pagedState.commit(staged);
  assert.equal(pagedState.frame, 3);
  pagedState.destroy();
});

test("paged playback preserves exact random, boundary, wrap, and cross-channel publication", async () => {
  const ranges = Array.from({ length: 8 }, (_, index) => [index + 1, index + 1]);
  const built = buildDom(await syntheticPagedPlaybackInput({ variants: true, ranges }));
  const all = builtExternalResources(built);
  const eager = new Map(all);
  for (const record of built.document.resources.resources) if (record.kind === "state-page") eager.delete(record.id);
  const result = await readDomBrowser(built.bytes, { externalResources: eager, loadExternalResource: (record) => all.get(record.id) });
  const browser = fakeBrowserDocument();
  const runtime = await mountDom(result, new FakeElement(browser.document, "main"), { animate: false, mode: "animation" });
  assert.equal(await runtime.seekAsync(5), 5);
  assert.equal(await runtime.seekAsync(6), 6);
  assert.equal(await runtime.seekAsync(8), 8);
  assert.equal(runtime.seek(1), 1);
  const leafIndex = result.document.tree.nodes.findIndex((node) => node.id === "synthetic/leaf");
  assert.equal(browser.namespaced[leafIndex].classes.includes("material-a"), true);
  assert.equal(await runtime.seekAsync(7), 7);
  assert.equal(browser.namespaced[leafIndex].classes.includes("material-b"), false);
  assert.equal(runtime.lifecycle.phase, "publish");
  runtime.destroy();
});

test("range stages pin verified pages until commit and replacement discards abandoned pins", async () => {
  const ranges = Array.from({ length: 8 }, (_, index) => [index + 1, index + 1]);
  const built = buildDom(await syntheticPagedPlaybackInput({ ranges }));
  const all = builtExternalResources(built);
  const create = () => {
    const fake = fakeBrowserDocument();
    const mounted = { byId: new Map(built.document.tree.nodes.map((node) => {
      const element = new FakeElement(fake.document, node.name);
      Object.assign(element.style, node.styles ?? {});
      for (const className of node.classes) element.classList.add(className);
      return [node.id, element];
    })) };
    return createPolycssPagedState(built.document, mounted, DEFAULT_LIMITS, async (record) => all.get(record.id));
  };

  const committed = create();
  await committed.prepareInitial();
  await committed.ensureFrame(2);
  const frame2 = committed.stage(2);
  for (const frame of [4, 6, 8]) await committed.ensureFrame(frame);
  assert.equal(committed.residentResources.includes("playback-page-2"), true);
  assert.equal(committed.isFrameReady(2), true);
  assert.ok(committed.peakResidentPages <= 5);
  committed.commit(frame2);
  assert.equal(committed.frame, 2);
  assert.equal(committed.isFrameReady(2), true);
  committed.destroy();

  const abandoned = create();
  await abandoned.prepareInitial();
  await abandoned.ensureFrame(2);
  const stale = abandoned.stage(2);
  await abandoned.ensureFrame(6);
  const replacement = abandoned.stage(6);
  await abandoned.ensureFrame(8);
  await abandoned.ensureFrame(4);
  assert.equal(abandoned.residentResources.includes("playback-page-2"), false);
  assert.throws(() => abandoned.commit(stale), errorCode("INVALID_PLAYBACK_PUBLICATION"));
  assert.equal(abandoned.commit(replacement), 6);
  assert.ok(abandoned.peakResidentPages <= 5);
  abandoned.destroy();
});

test("complete paged stages remain stable after later sparse commits", async () => {
  const built = buildDom(await syntheticPagedPlaybackChangesInput({ variants: false }));
  const all = builtExternalResources(built);
  const fake = fakeBrowserDocument();
  const mounted = { byId: new Map(built.document.tree.nodes.map((node) => {
    const element = new FakeElement(fake.document, node.name);
    Object.assign(element.style, node.styles ?? {});
    for (const className of node.classes) element.classList.add(className);
    return [node.id, element];
  })) };
  const pagedState = createPolycssPagedState(built.document, mounted, DEFAULT_LIMITS, async (record) => all.get(record.id));
  await pagedState.prepareInitial();
  await pagedState.ensureFrame(4);
  const complete = pagedState.stage(4);
  assert.equal(complete.playback.kind, "complete");
  const packet = built.document.state.channels.find((channel) => channel.codec === "polycss-paged-playback@0").data.packet;
  const pageBytes = new Map(packet.pages.map((page) => [page.resource, page.materializedByteLength]));
  const completePage = packet.pages.find((page) => complete.frame >= page.startFrame && complete.frame <= page.endFrame);
  const stageWorkspace = pagedPlaybackPublicationWorkspaceBytes(completePage.materializedByteLength, packet.shapeCount, packet.leafCount);
  const shapes = [...complete.playback.shapeTransforms];
  const visibility = [...complete.playback.shapeVisibility];
  const leaves = [...complete.playback.leafTransforms];
  await pagedState.ensureFrame(8);
  const residentBytes = pagedState.residentResources.reduce((total, resource) => total + pageBytes.get(resource), 0);
  assert.ok(pagedState.peakMaterializedBytes >= residentBytes + stageWorkspace);
  pagedState.commit(complete);
  await pagedState.ensureFrame(5);
  const sparse = pagedState.stage(5);
  assert.equal(sparse.playback.kind, "range");
  pagedState.commit(sparse);
  assert.deepEqual(complete.playback.shapeTransforms, shapes);
  assert.deepEqual([...complete.playback.shapeVisibility], visibility);
  assert.deepEqual(complete.playback.leafTransforms, leaves);
  pagedState.destroy();
});

test("public prepared-bank selection keeps one retained topology and restarts the selected canonical timeline", async () => {
  const built = buildDom(await syntheticPreparedBanksInput());
  const result = await readDomBrowser(built.bytes, { externalResources: builtExternalResources(built) });
  const fake = fakeBrowserDocument();
  const runtime = await mountDom(result, new FakeElement(fake.document, "main"), { animate: false, mode: "animation" });
  const retained = fake.namespaced.slice();
  assert.equal(runtime.bankId, "alpha");
  assert.equal(runtime.selectBank("beta"), 3);
  assert.equal(runtime.bankId, "beta");
  assert.equal(runtime.sourceFrame, 3);
  assert.deepEqual(fake.namespaced, retained);
  assert.equal(runtime.setMode("interaction"), "interaction");
  assert.throws(() => runtime.selectBank("gamma"), errorCode("INVALID_EXPERIENCE_MODE"));
  assert.equal(runtime.setMode("animation"), "animation");
  assert.equal(runtime.bankId, "beta");
  assert.equal(runtime.sourceFrame, 3);
  assert.deepEqual(fake.namespaced, retained);
  runtime.destroy();
});

test("paged prepared-bank handoff is atomic under supersession and corrupt target pages", async () => {
  const ranges = Array.from({ length: 8 }, (_, index) => [index + 1, index + 1]);
  const built = buildDom(await syntheticPagedPreparedBanksInput({ variants: true, ranges }));
  const all = builtExternalResources(built);
  const eager = new Map(all);
  for (const record of built.document.resources.resources) if (record.kind === "state-page") eager.delete(record.id);
  let releaseGamma;
  const gammaGate = new Promise((resolve) => { releaseGamma = resolve; });
  let corruptGamma = false;
  const result = await readDomBrowser(built.bytes, {
    externalResources: eager,
    loadExternalResource(record) {
      if (record.id === "playback-page-5" && !corruptGamma) return gammaGate;
      if (record.id === "variant-page-5" && corruptGamma) return new TextEncoder().encode("{}");
      return all.get(record.id);
    },
  });
  const fake = fakeBrowserDocument();
  const host = new FakeElement(fake.document, "main");
  const runtime = await mountDom(result, host, { animate: false, mode: "animation" });
  const retained = fake.namespaced.slice();
  const stale = runtime.selectBankAsync("gamma");
  const staleRejection = assert.rejects(stale, errorCode("OPERATION_ABORTED"));
  assert.equal(await runtime.selectBankAsync("beta"), 3);
  assert.equal(runtime.bankId, "beta");
  assert.equal(runtime.sourceFrame, 3);
  assert.deepEqual(fake.namespaced, retained);
  releaseGamma(all.get("playback-page-5"));
  await staleRejection;
  const writesBeforeFailure = fake.writes.length;
  corruptGamma = true;
  await assert.rejects(runtime.selectBankAsync("gamma"), errorCode("RESOURCE_SIZE_MISMATCH"));
  assert.equal(runtime.bankId, null);
  assert.equal(runtime.sourceFrame, 3);
  assert.ok(fake.writes.length >= writesBeforeFailure);
  assert.equal(runtime.lifecycle.phase, "destroy");
  assert.equal(host.childNodes.length, 0);
  assert.equal(runtime.destroy(), false);
});

test("paged catch-up advances every logical row while publishing only the final DOM diff", async () => {
  const built = buildDom(await syntheticPagedPlaybackInput({ variants: true, mutate(input) {
    const playback = input.state.channels.find((channel) => channel.codec === "polycss-playback-packed@0").data.packet;
    playback.transforms.count = 6;
    playback.transforms.groups[1].empty = [0];
    const changed = [1, 0, 0, 0, 1, 0, 0, 0, 1, 10, 0, 0];
    playback.transforms.groups[1].columns = changed.map((value) => [value]);
    playback.shapeChanges = { sources: [0, 0], transforms: [1, 4], visibility: [1, 0] };
    playback.frameRows[0][3] = 0;
    playback.frameRows[0][4] = 1;
    playback.frameRows[3][3] = 1;
    playback.frameRows[3][4] = 1;
    const surface = input.state.channels.find((channel) => channel.codec === "polycss-surface-packed@0").data.packet;
    surface.surface.faces[0].stateCount = 2;
    surface.surface.faces[1].stateOffset = 2;
    surface.surface.statePacking.stateCount = 3;
    surface.surface.statePacking.sourceFrameDeltas = [0, 3, 0];
    surface.transitions.sequential = {
      offsetsBase64: base64Integers([0, 1, 1, 1, 2, 2, 2, 2, 2], 4),
      faceIndexDeltas: [0, 0],
      stateIndexDeltas: [0, 1],
    };
  } }));
  const all = builtExternalResources(built);
  const eager = new Map(all);
  for (const record of built.document.resources.resources) if (record.kind === "state-page") eager.delete(record.id);
  const result = await readDomBrowser(built.bytes, { externalResources: eager, loadExternalResource: (record) => all.get(record.id) });
  const fake = fakeBrowserDocument();
  const runtime = await mountDom(result, new FakeElement(fake.document, "main"), { animate: true, mode: "animation" });
  fake.frame(0);
  fake.writes.splice(0);
  fake.frame(100);
  assert.equal(runtime.sourceFrame, 4);
  const leafIndex = result.document.tree.nodes.findIndex((node) => node.id === "synthetic/leaf");
  const shapeIndex = result.document.tree.nodes.findIndex((node) => node.id === "synthetic/shape");
  const leaf = fake.namespaced[leafIndex];
  const shape = fake.namespaced[shapeIndex];
  assert.deepEqual(fake.writes.filter((write) => write.element === leaf || write.element === shape).map((write) => [write.element === leaf ? "leaf" : "shape", write.property]), [
    ["leaf", "class:remove"],
    ["leaf", "class:add"],
    ["shape", "transform"],
    ["leaf", "backgroundPositionY"],
    ["shape", "visibility"],
  ]);
  assert.equal(leaf.classes.includes("material-b"), true);
  runtime.destroy();
});

test("paged catch-up stages non-adjacent timeline targets without requiring skipped source pages", async () => {
  const ranges = Array.from({ length: 8 }, (_, index) => [index + 1, index + 1]);
  const built = buildDom(await syntheticPagedPlaybackInput({ ranges, mutate(input) {
    input.state.channels.find((channel) => channel.codec === "polycss-playback-packed@0").data.packet.timeline = { introTicks: 0, loopTicks: 3, frames: [1, 3, 4] };
  } }));
  const all = builtExternalResources(built);
  const fake = fakeBrowserDocument();
  const mounted = { byId: new Map(built.document.tree.nodes.map((node) => {
    const element = new FakeElement(fake.document, node.name);
    Object.assign(element.style, node.styles ?? {});
    for (const className of node.classes) element.classList.add(className);
    return [node.id, element];
  })) };
  const calls = [];
  const pagedState = createPolycssPagedState(built.document, mounted, DEFAULT_LIMITS, async (record) => {
    calls.push(record.id);
    return all.get(record.id);
  });
  await pagedState.prepareInitial();
  await pagedState.ensureFrame(3);
  const playback = createPolycssPlayback(materializePolycssState(built.document.state), built.document.bindings, mounted, {
    pagedState,
    assertPagedFrameReady: (frame) => pagedState.assertFrameReady(frame),
    publishAppearance() {},
  });
  playback.publishInitial();
  assert.deepEqual(playback.advanceMany(2), [3, 4]);
  assert.equal(playback.sourceFrame, 4);
  assert.equal(calls.includes("playback-page-2"), false);
  pagedState.destroy();
});

test("combined paged playback and variants supersede asymmetric loads without partial publication", async () => {
  const ranges = Array.from({ length: 8 }, (_, index) => [index + 1, index + 1]);
  const built = buildDom(await syntheticPagedPlaybackInput({ variants: true, ranges }));
  const all = builtExternalResources(built);
  const eager = new Map(all);
  for (const record of built.document.resources.resources) if (record.kind === "state-page") eager.delete(record.id);
  let releasePlayback7;
  const playback7 = new Promise((resolve) => { releasePlayback7 = resolve; });
  const result = await readDomBrowser(built.bytes, {
    externalResources: eager,
    loadExternalResource: (record) => record.id === "playback-page-7" ? playback7 : all.get(record.id),
  });
  const fake = fakeBrowserDocument();
  const runtime = await mountDom(result, new FakeElement(fake.document, "main"), { animate: false, mode: "animation" });
  const leafIndex = result.document.tree.nodes.findIndex((node) => node.id === "synthetic/leaf");
  const leaf = fake.namespaced[leafIndex];
  const stale = runtime.seekAsync(7);
  const staleRejection = assert.rejects(stale, errorCode("OPERATION_ABORTED"));
  assert.equal(await runtime.seekAsync(3), 3);
  assert.equal(runtime.sourceFrame, 3);
  assert.equal(leaf.classes.includes("material-a"), true);
  releasePlayback7(all.get("playback-page-7"));
  await staleRejection;
  assert.equal(runtime.sourceFrame, 3);
  assert.equal(runtime.lifecycle.phase, "publish");
  runtime.destroy();
});

test("combined page rollback is atomic after either channel has loaded first", async () => {
  const oneFrame = Array.from({ length: 8 }, (_, index) => [index + 1, index + 1]);
  const broad = [[1, 4], [5, 8]];
  for (const scenario of [
    { ranges: oneFrame, variantRanges: broad, partial: "playback-page-2", failure: "variant-page-2" },
    { ranges: broad, variantRanges: oneFrame, partial: "variant-page-2", failure: "playback-page-2" },
  ]) {
    const built = buildDom(await syntheticPagedPlaybackInput({ variants: true, ranges: scenario.ranges, variantRanges: scenario.variantRanges }));
    const all = builtExternalResources(built);
    const fake = fakeBrowserDocument();
    const mounted = { byId: new Map(built.document.tree.nodes.map((node) => {
      const element = new FakeElement(fake.document, node.name);
      Object.assign(element.style, node.styles ?? {});
      for (const className of node.classes) element.classList.add(className);
      return [node.id, element];
    })) };
    const calls = [];
    let corrupt = true;
    const pagedState = createPolycssPagedState(built.document, mounted, DEFAULT_LIMITS, async (record) => {
      calls.push(record.id);
      return corrupt && record.id === scenario.failure ? new TextEncoder().encode("{}") : all.get(record.id);
    });
    await pagedState.prepareInitial();
    const before = pagedState.residentResources;
    calls.splice(0);
    await assert.rejects(pagedState.ensureFrame(2), errorCode("INVALID_STATE_PAGE"));
    assert.ok(calls.indexOf(scenario.partial) >= 0 && calls.indexOf(scenario.partial) < calls.indexOf(scenario.failure));
    assert.deepEqual(pagedState.residentResources, before);
    assert.equal(pagedState.peakResidentPages, before.length + 2);
    assert.ok(pagedState.peakDecodedBytes > 0);
    assert.ok(pagedState.peakMaterializedBytes > 0);
    assert.ok(pagedState.peakDocumentStateBytes <= DEFAULT_LIMITS.maxAggregateDecodedBytes);
    corrupt = false;
    await pagedState.ensureFrame(2);
    assert.equal(pagedState.isFrameReady(2), true);
    pagedState.destroy();
  }
});

test("a failed page load with free capacity preserves the prior resident set without refetching", async () => {
  const ranges = Array.from({ length: 8 }, (_, index) => [index + 1, index + 1]);
  const built = buildDom(await syntheticPagedPlaybackInput({ ranges }));
  const all = builtExternalResources(built);
  const fake = fakeBrowserDocument();
  const mounted = { byId: new Map(built.document.tree.nodes.map((node) => {
    const element = new FakeElement(fake.document, node.name);
    Object.assign(element.style, node.styles ?? {});
    return [node.id, element];
  })) };
  const calls = [];
  const pagedState = createPolycssPagedState(built.document, mounted, DEFAULT_LIMITS, async (record) => {
    calls.push(record.id);
    return record.id === "playback-page-7" ? new TextEncoder().encode("{}") : all.get(record.id);
  });
  await pagedState.prepareInitial();
  await pagedState.ensureFrame(2);
  const before = pagedState.residentResources;
  calls.splice(0);
  await assert.rejects(pagedState.ensureFrame(7), errorCode("INVALID_STATE_PAGE"));
  assert.deepEqual(pagedState.residentResources, before);
  assert.deepEqual(calls, ["playback-page-7"]);
  pagedState.destroy();
});

test("combined fixed pins make interaction entry synchronous without page fetch", async () => {
  const ranges = Array.from({ length: 8 }, (_, index) => [index + 1, index + 1]);
  const input = await syntheticPagedPlaybackInput({ variants: true, ranges });
  input.state.channels.find((channel) => channel.codec === "polycss-pointer-grab-prepared@0").data.packet.animator.eyeFrame = 7;
  input.bindings.channels.find((channel) => channel.interpreter === "polycss-pointer-grab@0").parameters.initialFrame = 7;
  const built = buildDom(input);
  const all = builtExternalResources(built);
  const eager = new Map(all);
  for (const record of built.document.resources.resources) if (record.kind === "state-page") eager.delete(record.id);
  const calls = [];
  const result = await readDomBrowser(built.bytes, { externalResources: eager, loadExternalResource(record) { calls.push(record.id); return all.get(record.id); } });
  const fake = fakeBrowserDocument();
  const runtime = await mountDom(result, new FakeElement(fake.document, "main"), { animate: false, mode: "animation" });
  const before = calls.length;
  assert.equal(runtime.setMode("interaction"), "interaction");
  assert.equal(runtime.sourceFrame, 7);
  assert.equal(calls.length, before);
  runtime.destroy();
});

test("same-frame paged seek restores canonical variants after an interaction surface frame", async () => {
  const built = buildDom(await syntheticPagedPlaybackInput({ variants: true }));
  const all = builtExternalResources(built);
  const fake = fakeBrowserDocument();
  const byId = new Map(built.document.tree.nodes.map((node) => {
    const element = new FakeElement(fake.document, node.name);
    Object.assign(element.style, node.styles ?? {});
    for (const className of node.classes) element.classList.add(className);
    return [node.id, element];
  }));
  const mounted = { byId };
  const pagedState = createPolycssPagedState(built.document, mounted, DEFAULT_LIMITS, async (record) => all.get(record.id));
  await pagedState.prepareInitial();
  const playback = createPolycssPlayback(materializePolycssState(built.document.state), built.document.bindings, mounted, {
    pagedState,
    assertPagedFrameReady: (frame) => pagedState.assertFrameReady(frame),
    publishAppearance() {},
  });
  playback.publishInitial();
  const leaf = byId.get("synthetic/leaf");
  assert.equal(leaf.classes.includes("material-a"), true);
  playback.applySurfaceFrame(2);
  assert.equal(leaf.classes.includes("material-b"), true);
  assert.equal(playback.sourceFrame, 1);
  playback.seek(1);
  assert.equal(leaf.classes.includes("material-a"), true);
  assert.equal(leaf.classes.includes("material-b"), false);
  pagedState.destroy();
});

test("document-wide page workspace ceiling rejects before fetching or materializing", async () => {
  const built = buildDom(await syntheticPagedPlaybackInput({ variants: true }));
  const fake = fakeBrowserDocument();
  const mounted = { byId: new Map(built.document.tree.nodes.map((node) => {
    const element = new FakeElement(fake.document, node.name);
    Object.assign(element.style, node.styles ?? {});
    return [node.id, element];
  })) };
  let loads = 0;
  const pagedState = createPolycssPagedState(built.document, mounted, { ...DEFAULT_LIMITS, maxAggregateDecodedBytes: 1 }, async () => { loads += 1; return new Uint8Array(); });
  await assert.rejects(pagedState.prepareInitial(), errorCode("STATE_PAGE_RESIDENCY_LIMIT"));
  assert.equal(loads, 0);
  assert.equal(pagedState.residentResources.length, 0);
  pagedState.destroy();
});

test("paged residency accounting rejects before eviction or fetch", async () => {
  const built = buildDom(await syntheticEvictingPagedVariantsInput());
  const all = builtExternalResources(built);
  const fake = fakeBrowserDocument();
  const mounted = { byId: new Map(built.document.tree.nodes.map((node) => [node.id, new FakeElement(fake.document, node.name)])) };
  const limits = { ...DEFAULT_LIMITS };
  const calls = [];
  const pagedState = createPolycssPagedState(built.document, mounted, limits, async (record) => {
    calls.push(record.id);
    return all.get(record.id);
  });
  await pagedState.prepareInitial();
  await pagedState.ensureFrame(7);
  const before = pagedState.residentResources;
  const callsBefore = calls.length;
  limits.maxAggregateDecodedBytes = 1;
  await assert.rejects(pagedState.ensureFrame(3), errorCode("STATE_PAGE_RESIDENCY_LIMIT"));
  assert.deepEqual(pagedState.residentResources, before);
  assert.equal(calls.length, callsBefore);
  limits.maxAggregateDecodedBytes = DEFAULT_LIMITS.maxAggregateDecodedBytes;
  await pagedState.ensureFrame(3);
  pagedState.destroy();
});

test("nonuniform complete publication preflights materialization and projected live bytes atomically", async () => {
  const built = buildDom(await syntheticPagedPlaybackChangesInput({ variants: true }));
  const all = builtExternalResources(built);
  const fake = fakeBrowserDocument();
  const mounted = { byId: new Map(built.document.tree.nodes.map((node) => {
    const element = new FakeElement(fake.document, node.name);
    Object.assign(element.style, node.styles ?? {});
    for (const className of node.classes) element.classList.add(className);
    return [node.id, element];
  })) };
  const limits = { ...DEFAULT_LIMITS };
  const pagedState = createPolycssPagedState(built.document, mounted, limits, async (record) => all.get(record.id));
  await pagedState.prepareInitial();
  await pagedState.ensureFrame(4);
  const packet = built.document.state.channels.find((channel) => channel.codec === "polycss-paged-playback@0").data.packet;
  assert.ok(new Set(packet.pages.map((page) => page.materializedByteLength)).size > 1);

  limits.maxAggregateDecodedBytes = 1;
  const originalArrayFrom = Array.from;
  let materialized = false;
  let stageError;
  Array.from = () => { materialized = true; throw new Error("complete row materialized before workspace admission"); };
  try { pagedState.stage(4); } catch (error) { stageError = error; } finally { Array.from = originalArrayFrom; }
  assert.throws(() => { throw stageError; }, errorCode("STATE_PAGE_RESIDENCY_LIMIT"));
  assert.equal(materialized, false);

  limits.maxAggregateDecodedBytes = DEFAULT_LIMITS.maxAggregateDecodedBytes;
  const staged = pagedState.stage(4);
  assert.equal(staged.playback.kind, "complete");
  assert.equal(staged.variants.kind, "complete");
  const canonical = pagedState.canonicalPlayback;
  const shapeTransforms = [...canonical.shapeTransforms];
  const shapeVisibility = [...canonical.shapeVisibility];
  const leafTransforms = [...canonical.leafTransforms];
  const classes = [...mounted.byId.get("synthetic/leaf").classes];
  fake.writes.splice(0);
  limits.maxAggregateDecodedBytes = 1;
  assert.throws(() => pagedState.commit(staged), errorCode("STATE_PAGE_RESIDENCY_LIMIT"));
  assert.equal(pagedState.frame, 1);
  assert.equal(pagedState.canonicalPlayback, canonical);
  assert.deepEqual(canonical.shapeTransforms, shapeTransforms);
  assert.deepEqual([...canonical.shapeVisibility], shapeVisibility);
  assert.deepEqual(canonical.leafTransforms, leafTransforms);
  assert.deepEqual(mounted.byId.get("synthetic/leaf").classes, classes);
  assert.deepEqual(fake.writes, []);

  limits.maxAggregateDecodedBytes = DEFAULT_LIMITS.maxAggregateDecodedBytes;
  assert.throws(() => pagedState.commit(staged), errorCode("INVALID_PLAYBACK_PUBLICATION"));
  assert.equal(pagedState.commit(pagedState.stage(4)), 4);
  pagedState.destroy();
});

test("failed paged seek keeps its source frame retryable until commit succeeds", async () => {
  const built = buildDom(await syntheticPagedPlaybackChangesInput({ variants: false }));
  const all = builtExternalResources(built);
  const fake = fakeBrowserDocument();
  const mounted = { byId: new Map(built.document.tree.nodes.map((node) => {
    const element = new FakeElement(fake.document, node.name);
    Object.assign(element.style, node.styles ?? {});
    for (const className of node.classes) element.classList.add(className);
    return [node.id, element];
  })) };
  const limits = { ...DEFAULT_LIMITS };
  const pagedState = createPolycssPagedState(built.document, mounted, limits, async (record) => all.get(record.id));
  await pagedState.prepareInitial();
  await pagedState.ensureFrame(4);
  let failCommit = false;
  const playback = createPolycssPlayback(materializePolycssState(built.document.state), built.document.bindings, mounted, {
    publishAppearance() {},
    pagedState,
    assertPagedFrameReady: (frame) => pagedState.assertFrameReady(frame),
    compositorTiming: {
      before(kind) {
        if (kind === "seek" && failCommit) {
          limits.maxAggregateDecodedBytes = 1;
          failCommit = false;
        }
      },
      after() {},
    },
  });
  playback.publishInitial();
  const leaf = mounted.byId.get("synthetic/leaf");
  const initialTransform = leaf.style.transform;
  fake.writes.splice(0);
  failCommit = true;

  assert.throws(() => playback.seek(4), errorCode("STATE_PAGE_RESIDENCY_LIMIT"));
  assert.equal(playback.sourceFrame, 1);
  assert.equal(pagedState.frame, 1);
  assert.equal(leaf.style.transform, initialTransform);
  assert.deepEqual(fake.writes, []);

  limits.maxAggregateDecodedBytes = DEFAULT_LIMITS.maxAggregateDecodedBytes;
  assert.equal(playback.seek(4), 4);
  assert.equal(playback.sourceFrame, 4);
  assert.equal(pagedState.frame, 4);
  assert.equal(leaf.style.transform, pagedState.canonicalPlayback.leafTransforms[0]);
  pagedState.destroy();
});

test("nonuniform runtime playback pages reject a larger next live row before canonical mutation", async () => {
  const shapeCount = 2_048;
  const identity = "matrix3d(1,0,0,0,0,1,0,0,0,0,1,0,1,0,0,1)";
  const components = new Array(16).fill("123456.789063");
  components[3] = "0";
  components[7] = "0";
  components[11] = "0";
  components[15] = "1";
  const largeTransform = `matrix3d(${components.join(",")})`;
  const shapeIndices = new Array(shapeCount).fill(1);
  const shapeTargets = Array.from({ length: shapeCount }, (_, index) => index);
  const visibilityBits = Buffer.from(new Uint8Array(shapeCount / 8).fill(0xff)).toString("base64");
  const page = (frame, transform, changed) => {
    const changeCount = changed ? shapeCount : 0;
    const payload = {
      version: 0,
      codec: "polycss-paged-playback-page@0",
      channel: "playback",
      startFrame: frame,
      endFrame: frame,
      transforms: [null, transform],
      keyframe: {
        appearance: 0,
        modelTransform: 0,
        shapeTransformIndicesBase64: base64Integers(shapeIndices, 4),
        shapeVisibilityBitsBase64: visibilityBits,
        leafTransformIndicesBase64: "",
      },
      sequential: {
        appearanceIndicesBase64: base64Integers([0], 2),
        modelTransformIndicesBase64: base64Integers([0xffffffff], 4),
        shapeOffsetsBase64: base64Integers([0, changeCount], 4),
        shapeTargetIndicesBase64: base64Integers(changed ? shapeTargets : [], 4),
        shapeTransformIndicesBase64: base64Integers(changed ? shapeIndices : [], 4),
        shapeVisibilityBase64: base64Integers(changed ? new Array(shapeCount).fill(1) : [], 1),
        leafOffsetsBase64: base64Integers([0, 0], 4),
        leafTargetIndicesBase64: "",
        leafTransformIndicesBase64: "",
      },
    };
    const bytes = encodeCanonicalJson(payload);
    const transformBytes = 16 + transform.length * 2;
    const materializedByteLength = transformBytes + shapeCount * 5 + changeCount * 9 + 22;
    return { bytes, descriptor: { resource: `page-${frame}`, startFrame: frame, endFrame: frame, transformCount: 2, shapeChangeCount: changeCount, leafChangeCount: 0, materializedByteLength } };
  };
  const pages = [page(1, identity, false), page(2, largeTransform, true)];
  assert.notEqual(pages[0].descriptor.materializedByteLength, pages[1].descriptor.materializedByteLength);
  const document = {
    state: { channels: [{ id: "playback", codec: "polycss-paged-playback@0", data: { packet: {
      shapeCount,
      leafCount: 0,
      appearances: [["default", 0, 0]],
      initial: { sourceFrame: 1, appearance: 0 },
      pages: pages.map(({ descriptor }) => descriptor),
      lookaheadPages: 1,
      maxResidentPages: 2,
    } } }] },
    bindings: { channels: [{
      id: "playback",
      state: "playback",
      interpreter: "polycss-paged-playback@0",
      parameters: { baseSceneTransform: identity },
      targets: { model: "model", shapes: shapeTargets.map((index) => `shape-${index}`), leaves: [] },
    }] },
    resources: { resources: pages.map(({ bytes, descriptor }) => ({ id: descriptor.resource, kind: "state-page", decodedByteLength: bytes.length })) },
  };
  const bytesByResource = new Map(pages.map(({ bytes, descriptor }) => [descriptor.resource, bytes]));
  const create = (limit) => {
    const fake = fakeBrowserDocument();
    const model = new FakeElement(fake.document, "main");
    model.style.transform = identity;
    const entries = [["model", model]];
    for (const index of shapeTargets) {
      const shape = new FakeElement(fake.document, "i");
      shape.style.transform = identity;
      shape.style.visibility = "visible";
      entries.push([`shape-${index}`, shape]);
    }
    const pagedState = createPolycssPagedState(document, { byId: new Map(entries) }, { ...DEFAULT_LIMITS, maxAggregateDecodedBytes: limit }, async (record) => bytesByResource.get(record.id));
    return { fake, pagedState };
  };
  const prepare = async (runtime) => {
    await runtime.prepareInitial();
    await runtime.ensureFrame(2);
    return runtime.stage(2);
  };

  const baseline = create(DEFAULT_LIMITS.maxAggregateDecodedBytes);
  const baselineStage = await prepare(baseline.pagedState);
  assert.equal(baselineStage.playback.kind, "range");
  const admittedPeak = baseline.pagedState.peakDocumentStateBytes;
  baseline.pagedState.commit(baselineStage);
  const projectedPeak = baseline.pagedState.peakDocumentStateBytes;
  assert.ok(projectedPeak > admittedPeak);
  baseline.pagedState.destroy();

  const rejected = create(projectedPeak - 1);
  const rejectedStage = await prepare(rejected.pagedState);
  const canonical = rejected.pagedState.canonicalPlayback;
  const shapeRow = canonical.shapeTransforms;
  rejected.fake.writes.splice(0);
  assert.throws(() => rejected.pagedState.commit(rejectedStage), errorCode("STATE_PAGE_RESIDENCY_LIMIT"));
  assert.equal(rejected.pagedState.frame, 1);
  assert.equal(rejected.pagedState.canonicalPlayback, canonical);
  assert.equal(canonical.shapeTransforms, shapeRow);
  assert.equal(canonical.shapeTransforms[0], identity);
  assert.deepEqual(rejected.fake.writes, []);
  rejected.pagedState.destroy();
});

test("already-aborted page requests reject even when the complete target window is resident", async () => {
  const built = buildDom(await syntheticPagedPlaybackInput({ variants: true }));
  const all = builtExternalResources(built);
  const fake = fakeBrowserDocument();
  const mounted = { byId: new Map(built.document.tree.nodes.map((node) => {
    const element = new FakeElement(fake.document, node.name);
    Object.assign(element.style, node.styles ?? {});
    return [node.id, element];
  })) };
  const pagedState = createPolycssPagedState(built.document, mounted, DEFAULT_LIMITS, async (record) => all.get(record.id));
  await pagedState.prepareInitial();
  const before = pagedState.residentResources;
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(pagedState.ensureFrame(1, controller.signal), errorCode("OPERATION_ABORTED"));
  await assert.rejects(pagedState.prepareInitial(controller.signal), errorCode("OPERATION_ABORTED"));
  assert.deepEqual(pagedState.residentResources, before);
  pagedState.destroy();
});

test("combined paged publication succeeds at its measured byte peak and rejects one byte below it", async () => {
  const built = buildDom(await syntheticPagedPlaybackInput({ variants: true }));
  const all = builtExternalResources(built);
  const create = (limit) => {
    const fake = fakeBrowserDocument();
    const mounted = { byId: new Map(built.document.tree.nodes.map((node) => {
      const element = new FakeElement(fake.document, node.name);
      Object.assign(element.style, node.styles ?? {});
      for (const className of node.classes) element.classList.add(className);
      return [node.id, element];
    })) };
    return createPolycssPagedState(built.document, mounted, { ...DEFAULT_LIMITS, maxAggregateDecodedBytes: limit }, async (record) => all.get(record.id));
  };
  const exercise = async (pagedState) => {
    await pagedState.prepareInitial();
    await pagedState.ensureFrame(2);
    pagedState.commit(pagedState.stage(2));
  };
  const baseline = create(DEFAULT_LIMITS.maxAggregateDecodedBytes);
  await exercise(baseline);
  const peak = baseline.peakDocumentStateBytes;
  assert.ok(peak > 0 && peak < DEFAULT_LIMITS.maxAggregateDecodedBytes);
  baseline.destroy();

  const exact = create(peak);
  await exercise(exact);
  assert.equal(exact.peakDocumentStateBytes, peak);
  exact.destroy();

  const below = create(peak - 1);
  await assert.rejects(exercise(below), errorCode("STATE_PAGE_RESIDENCY_LIMIT"));
  assert.equal(below.peakDocumentStateBytes, peak);
  below.destroy();
});

test("superseding an in-progress page load preserves the currently published frame", async () => {
  const ranges = Array.from({ length: 8 }, (_, index) => [index + 1, index + 1]);
  const built = buildDom(await syntheticPagedPlaybackInput({ ranges }));
  const all = builtExternalResources(built);
  const fake = fakeBrowserDocument();
  const mounted = { byId: new Map(built.document.tree.nodes.map((node) => {
    const element = new FakeElement(fake.document, node.name);
    Object.assign(element.style, node.styles ?? {});
    for (const className of node.classes) element.classList.add(className);
    return [node.id, element];
  })) };
  const calls = [];
  let releasePage7;
  const page7 = new Promise((resolve) => { releasePage7 = resolve; });
  const pagedState = createPolycssPagedState(built.document, mounted, DEFAULT_LIMITS, async (record) => {
    calls.push(record.id);
    if (record.id === "playback-page-7") return page7;
    return all.get(record.id);
  });
  await pagedState.prepareInitial();
  await pagedState.ensureFrame(2);
  pagedState.commit(pagedState.stage(2));
  const stale = pagedState.ensureFrame(7);
  await flushAsyncWork(2);
  assert.equal(calls.filter((id) => id === "playback-page-7").length, 1);
  await pagedState.ensureFrame(3);
  releasePage7(all.get("playback-page-7"));
  await assert.rejects(stale, errorCode("OPERATION_ABORTED"));
  assert.equal(pagedState.frame, 2);
  assert.equal(pagedState.isFrameReady(2), true);
  assert.equal(pagedState.isFrameReady(3), true);
  assert.doesNotThrow(() => pagedState.stage(2));
  assert.equal(calls.filter((id) => id === "playback-page-2").length, 1);
  pagedState.destroy();
});

test("combined paging protects independently published playback and variant pages", async () => {
  const ranges = Array.from({ length: 8 }, (_, index) => [index + 1, index + 1]);
  const built = buildDom(await syntheticPagedPlaybackInput({ variants: true, ranges, variantRanges: ranges }));
  const all = builtExternalResources(built);
  const fake = fakeBrowserDocument();
  const mounted = { byId: new Map(built.document.tree.nodes.map((node) => {
    const element = new FakeElement(fake.document, node.name);
    Object.assign(element.style, node.styles ?? {});
    for (const className of node.classes) element.classList.add(className);
    return [node.id, element];
  })) };
  const pagedState = createPolycssPagedState(built.document, mounted, DEFAULT_LIMITS, async (record) => all.get(record.id));
  await pagedState.prepareInitial();
  await pagedState.ensureFrame(6);
  await pagedState.ensureFrame(8);
  pagedState.publishVariants(8);
  await pagedState.ensureFrame(6);
  await pagedState.ensureFrame(4);
  assert.equal(pagedState.frame, 1);
  assert.equal(pagedState.residentResources.includes("playback-page-1"), true);
  assert.equal(pagedState.residentResources.includes("variant-page-8"), true);
  pagedState.destroy();
});

test("paged automatic catch-up advances its ready prefix when an intermediate page is absent but the final page is resident", async () => {
  const built = buildDom(await syntheticPagedVariantsInput());
  const all = builtExternalResources(built);
  const eager = new Map(all);
  for (const record of built.document.resources.resources) if (record.kind === "state-page") eager.delete(record.id);
  let releasePage3;
  const page3 = new Promise((resolve) => { releasePage3 = resolve; });
  const result = await readDomBrowser(built.bytes, {
    externalResources: eager,
    loadExternalResource: (record) => record.id === "variant-page-3" ? page3 : all.get(record.id),
  });
  const browser = fakeBrowserDocument();
  const runtime = await mountDom(result, new FakeElement(browser.document, "main"), { animate: true, mode: "animation" });
  browser.frame(0);
  await flushAsyncWork();
  assert.equal(await runtime.seekAsync(7), 7);
  assert.equal(runtime.seek(1), 1);
  browser.frame(0);
  browser.frame(200);
  assert.equal(runtime.lifecycle.phase, "publish");
  assert.equal(runtime.sourceFrame, 4);
  releasePage3(all.get("variant-page-3"));
  for (let turn = 0; turn < 64 && runtime.sourceFrame !== 7; turn += 1) await flushAsyncWork(1);
  assert.equal(runtime.lifecycle.phase, "publish");
  assert.equal(runtime.sourceFrame, 7);
  runtime.destroy();
});

test("paged interaction backpressures at a page boundary before mutating or destroying the runtime", async () => {
  const input = await syntheticPagedVariantsInput();
  input.state.channels.find((channel) => channel.codec === "polycss-pointer-grab-prepared@0").data.packet.animator.eyeStillTicks = 1;
  const built = buildDom(input);
  const all = builtExternalResources(built);
  const eager = new Map(all);
  for (const record of built.document.resources.resources) if (record.kind === "state-page") eager.delete(record.id);
  const result = await readDomBrowser(built.bytes, {
    externalResources: eager,
    loadExternalResource: (record) => all.get(record.id),
  });
  const browser = fakeBrowserDocument();
  const host = new FakeElement(browser.document, "main");
  const runtime = await mountDom(result, host, { animate: true, mode: "animation" });
  assert.equal(runtime.setMode("interaction"), "interaction");
  browser.frame(0);
  assert.doesNotThrow(() => browser.frame(267));
  assert.equal(runtime.lifecycle.phase, "publish");
  await flushAsyncWork();
  assert.equal(runtime.lifecycle.phase, "publish");
  const leafIndex = result.document.tree.nodes.findIndex((node) => node.id === "synthetic/leaf");
  assert.equal(browser.namespaced[leafIndex].classes.includes("material-b"), true);
  runtime.destroy();
});

test("paged variants pin the fixed interaction page so a synchronous mode switch remains available", async () => {
  const input = await syntheticPagedVariantsInput();
  input.state.channels.find((channel) => channel.codec === "polycss-pointer-grab-prepared@0").data.packet.animator.eyeFrame = 7;
  input.bindings.channels.find((channel) => channel.interpreter === "polycss-pointer-grab@0").parameters.initialFrame = 7;
  const built = buildDom(input);
  const all = builtExternalResources(built);
  const eager = new Map(all);
  for (const record of built.document.resources.resources) if (record.kind === "state-page") eager.delete(record.id);
  const calls = [];
  const result = await readDomBrowser(built.bytes, {
    externalResources: eager,
    loadExternalResource(record) {
      calls.push(record.id);
      return all.get(record.id);
    },
  });
  const { document } = fakeBrowserDocument();
  const runtime = await mountDom(result, new FakeElement(document, "main"), { animate: false, mode: "animation" });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(calls.slice(0, 3), ["variant-page-1", "variant-page-4", "variant-page-2"]);
  assert.equal(await runtime.seekAsync(3), 3);
  const callsBeforeSwitch = calls.length;
  assert.equal(runtime.setMode("interaction"), "interaction");
  assert.equal(runtime.sourceFrame, 7);
  assert.equal(runtime.lifecycle.phase, "publish");
  assert.equal(calls.length, callsBeforeSwitch);
  runtime.destroy();
});

test("paged variant requests cancel stale generations and fail closed on late page corruption", async () => {
  const built = buildDom(await syntheticPagedVariantsInput("gzip"));
  const all = builtExternalResources(built);
  const eager = new Map(all);
  for (const record of built.document.resources.resources) if (record.kind === "state-page") eager.delete(record.id);
  let releasePage4;
  const page4 = new Promise((resolve) => { releasePage4 = resolve; });
  const result = await readDomBrowser(built.bytes, {
    externalResources: eager,
    loadExternalResource(record) {
      return record.id === "variant-page-4" ? page4 : all.get(record.id);
    },
  });
  const firstBrowser = fakeBrowserDocument();
  const runtime = await mountDom(result, new FakeElement(firstBrowser.document, "main"), { animate: false });
  await new Promise((resolve) => setImmediate(resolve));
  const stale = runtime.seekAsync(7);
  const staleRejection = assert.rejects(stale, errorCode("OPERATION_ABORTED"));
  assert.equal(await runtime.seekAsync(1), 1);
  releasePage4(all.get("variant-page-4"));
  await staleRejection;
  assert.equal(runtime.sourceFrame, 1);
  assert.equal(runtime.destroy(), true);

  const corrupt = new Map(all);
  const bytes = corrupt.get("variant-page-4").slice();
  bytes[bytes.length - 1] ^= 1;
  corrupt.set("variant-page-4", bytes);
  const corruptEager = new Map(corrupt);
  for (const record of built.document.resources.resources) if (record.kind === "state-page") corruptEager.delete(record.id);
  const corruptResult = await readDomBrowser(built.bytes, {
    externalResources: corruptEager,
    loadExternalResource: (record) => corrupt.get(record.id),
  });
  const secondBrowser = fakeBrowserDocument();
  const corruptRuntime = await mountDom(corruptResult, new FakeElement(secondBrowser.document, "main"), { animate: false });
  await assert.rejects(corruptRuntime.seekAsync(7), errorCode("RESOURCE_DIGEST_MISMATCH"));
  assert.equal(corruptRuntime.lifecycle.phase, "destroy");
});

test("mount preserves the browser reader's explicitly raised CSS rule limit", async () => {
  const input = await syntheticPolycssInput();
  const stylesheet = input.resourceInputs.find((resource) => resource.id === "model-css");
  const scope = input.cssBinding.stylesheets[0].scope;
  const extraRules = Array.from({ length: 8_192 }, () => `${scope} .leaf{opacity:1}`).join("\n");
  stylesheet.bytes = new TextEncoder().encode(`${new TextDecoder().decode(stylesheet.bytes)}\n${extraRules}`);
  const limits = { maxCssBytes: 2 * 1024 * 1024, maxCssRules: 9_000 };
  const built = buildDom(input, { limits });
  const result = await readBuiltBrowser(built, { limits });
  const { document } = fakeBrowserDocument();
  const runtime = await mountDom(result, new FakeElement(document, "main"), { animate: false });
  assert.equal(runtime.destroy(), true);
});

test("successful mount retains identities and idempotent destroy restores the host", async () => {
  const built = buildDom(await syntheticPolycssInput());
  const result = await readBuiltBrowser(built);
  const { document, urls, observers, namespaced } = fakeBrowserDocument();
  const host = new FakeElement(document, "main");
  const priorChild = new FakeElement(document, "p");
  host.appendChild(priorChild);
  host.setAttribute("data-domformat-root", "prior");
  host.style.position = "sticky";

  const phases = [];
  const runtime = await mountDom(result, host, {
    animate: false,
    onLifecyclePhase: (phase) => phases.push(phase),
  });
  assert.deepEqual(phases, ["validate", "construct", "bind", "initialize", "publish"]);
  assert.deepEqual(Object.keys(runtime), ["lifecycle", "mode", "sourceFrame", "bankId", "seek", "seekAsync", "selectBank", "selectBankAsync", "setMode", "setInput", "destroy"]);
  assert.equal(runtime.lifecycle.phase, "publish");
  assert.deepEqual(runtime.lifecycle.history, phases);
  assert.equal(runtime.mode, "animation");
  assert.equal(runtime.sourceFrame, 1);
  assert.equal(runtime.seek(1), 1);
  const mountSurface = host.childNodes[0];
  assert.equal(descendants(mountSurface).length, 8);
  assert.equal(document.head.childNodes.length, 1);
  assert.equal(observers.length, 1);
  assert.deepEqual(observers[0].observed, [host]);
  assert.equal(host.getAttribute("data-domformat-root"), "prior");
  assert.notEqual(mountSurface, host);
  assert.equal(mountSurface.getAttribute("data-domformat-root"), "synthetic-polycss");
  assert.equal(mountSurface.getAttribute("data-domformat-mount-surface"), "");
  assert.equal(mountSurface.style.contain, "strict");
  assert.equal(mountSurface.style.overflow, "hidden");
  assert.equal(mountSurface.style.position, "relative");
  assert.equal(mountSurface.stylePriorities.get("contain"), "important");
  assert.equal(mountSurface.stylePriorities.get("pointer-events"), "important");
  const runtimeScope = mountSurface.getAttribute("data-domformat-instance");
  assert.match(runtimeScope, /^d[0-9a-z]+$/u);
  assert.equal(host.getAttribute("tabindex"), null);
  assert.equal(document.head.childNodes[0].textContent.includes('[data-domformat-root="synthetic-polycss"]'), false);
  assert.ok(document.head.childNodes[0].textContent.startsWith(`[data-domformat-instance="${runtimeScope}"]`));
  assert.equal([...host.listeners.keys()].some((key) => key.startsWith("keydown:")), false);
  assert.equal(document.defaultView.listeners.has("keydown"), false);
  assert.notEqual(host.childNodes[0], priorChild);
  const cameraIndex = result.document.tree.nodes.findIndex((node) => node.id === "synthetic-polycss/camera");
  const camera = namespaced[cameraIndex];
  assert.equal(camera.style.left, "0px");
  host.clientWidth = 640;
  mountSurface.clientWidth = 640;
  observers[0].callback();
  assert.equal(camera.style.left, "160px");

  assert.equal(runtime.destroy(), true);
  assert.equal(runtime.destroy(), false);
  assert.deepEqual(phases, ["validate", "construct", "bind", "initialize", "publish", "destroy"]);
  assert.equal(runtime.lifecycle.phase, "destroy");
  assert.deepEqual(runtime.lifecycle.history, phases);
  assert.deepEqual(host.childNodes, [priorChild]);
  assert.equal(host.getAttribute("data-domformat-root"), "prior");
  assert.equal(host.style.position, "sticky");
  assert.equal(host.hasAttribute("style"), false);
  assert.equal(host.hasAttribute("data-domformat-instance"), false);
  assert.equal(host.hasAttribute("tabindex"), false);
  assert.equal([...host.listeners.keys()].some((key) => key.startsWith("keydown:")), false);
  assert.equal(document.head.childNodes.length, 0);
  assert.equal(observers[0].disconnected, true);
  assert.deepEqual(urls.revoked, urls.created);
  assert.equal(runtime.mode, "animation");
  assert.equal(runtime.sourceFrame, 1);
  assert.throws(() => runtime.seek(1), errorCode("MOUNT_DESTROYED"));
  assert.throws(() => runtime.setMode("animation"), errorCode("MOUNT_DESTROYED"));
});

test("resize failures roll back the mount and remain observable", async () => {
  const built = buildDom(await syntheticPolycssInput());
  const result = await readBuiltBrowser(built);
  const { document, urls, observers, namespaced } = fakeBrowserDocument();
  const host = new FakeElement(document, "main");
  const priorChild = new FakeElement(document, "p");
  host.appendChild(priorChild);
  const runtime = await mountDom(result, host, { animate: false });
  const cameraIndex = result.document.tree.nodes.findIndex((node) => node.id === "synthetic-polycss/camera");
  const camera = namespaced[cameraIndex];
  const failure = new Error("resize publication failed");
  camera.style = new Proxy(camera.style, { set() { throw failure; } });

  assert.throws(() => observers[0].callback(), (error) => error === failure);
  assert.deepEqual(host.childNodes, [priorChild]);
  assert.equal(document.head.childNodes.length, 0);
  assert.equal(observers[0].disconnected, true);
  assert.deepEqual(urls.revoked, urls.created);
  assert.throws(() => runtime.seek(1), errorCode("MOUNT_DESTROYED"));
  assert.equal(runtime.destroy(), false);
});

test("a retained destroyed controller does not retain its detached mount graph", () => {
  const probe = spawnSync(process.execPath, [
    "--expose-gc",
    "--import",
    "tsx",
    fileURLToPath(new URL("./runtime-gc-probe.js", import.meta.url)),
  ], { encoding: "utf8" });
  assert.equal(probe.status, 0, `${probe.stdout}\n${probe.stderr}`);
});

test("one host cannot own overlapping runtimes and can be remounted after destroy", async () => {
  const built = buildDom(await syntheticPolycssInput());
  const result = await readBuiltBrowser(built);
  const { document } = fakeBrowserDocument();
  const host = new FakeElement(document, "main");
  const first = await mountDom(result, host, { animate: false });

  await assert.rejects(mountDom(result, host, { animate: false }), errorCode("HOST_ALREADY_MOUNTED"));
  assert.equal(first.destroy(), true);

  const second = await mountDom(result, host, { animate: false });
  assert.equal(second.destroy(), true);
});

test("mount keeps construction detached and publishes packet-owned initial sinks atomically", async () => {
  const input = await syntheticPolycssInput();
  input.tree.nodes.find((node) => node.id === "synthetic-polycss/leaf").styles.transform = "translate3d(777px, 0px, 0px)";
  const particle = input.tree.nodes.find((node) => node.id === "synthetic-polycss/effects/particle:0");
  particle.styles.visibility = "visible";
  particle.styles.opacity = "1";
  const built = buildDom(input);
  const result = await readBuiltBrowser(built);
  const { document } = fakeBrowserDocument();
  const host = new FakeElement(document, "main");
  const priorChild = new FakeElement(document, "p");
  host.appendChild(priorChild);
  const observations = [];
  const runtime = await mountDom(result, host, {
    animate: false,
    onLifecyclePhase(phase) {
      observations.push([phase, host.childNodes[0] === priorChild]);
    },
  });
  assert.deepEqual(observations, [
    ["validate", true],
    ["construct", true],
    ["bind", true],
    ["initialize", true],
    ["publish", false],
  ]);
  const mounted = descendants(host.childNodes[0]);
  const byId = new Map(result.document.tree.nodes.map((node, index) => [node.id, mounted[index]]));
  assert.notEqual(byId.get("synthetic-polycss/leaf").style.transform, "translate3d(777px, 0px, 0px)");
  assert.equal(byId.get("synthetic-polycss/effects/particle:0").style.visibility, "hidden");
  assert.equal(byId.get("synthetic-polycss/effects/particle:0").style.opacity, "0");
  runtime.destroy();
});

test("reader document stays immutable when the bind phase is observable", async () => {
  const built = buildDom(await syntheticPolycssInput());
  const result = await readBuiltBrowser(built);
  const { document } = fakeBrowserDocument();
  const host = new FakeElement(document, "main");
  const phases = [];
  const runtime = await mountDom(result, host, {
    animate: false,
    onLifecyclePhase(phase) {
      phases.push(phase);
      if (phase === "bind") {
        assert.throws(() => {
          result.document.bindings.channels.find((channel) => channel.id === "playback").targets.model = "missing-after-bind";
        }, TypeError);
      }
    },
  });
  assert.deepEqual(phases, ["validate", "construct", "bind", "initialize", "publish"]);
  const mounted = descendants(host.childNodes[0]);
  const byId = new Map(result.document.tree.nodes.map((node, index) => [node.id, mounted[index]]));
  assert.ok(byId.get("synthetic-polycss/model"));
  assert.equal(byId.get("synthetic-polycss/model").style.transform, "translate3d(0px, 0px, 0px)");
  runtime.destroy();
});

test("zero-layout appearance fallback derives from the declared presentation viewport", async () => {
  const input = await syntheticPolycssInput();
  const presentationBinding = input.bindings.channels.find((channel) => channel.id === "presentation");
  const presentationPacket = input.state.channels.find((channel) => channel.id === "presentation").data.packet;
  Object.assign(presentationBinding.parameters, {
    fitHeight: 480,
    fitWidth: 640,
    sourceHeight: 480,
    sourceWidth: 640,
  });
  Object.assign(presentationPacket.camera, presentationBinding.parameters);
  Object.assign(input.tree.nodes.find((node) => node.id === "synthetic-polycss/camera").styles, {
    height: "480px",
    perspectiveOrigin: "320px 240px",
    width: "640px",
  });

  const built = buildDom(input);
  const result = await readBuiltBrowser(built);
  const { document } = fakeBrowserDocument();
  const createElement = document.createElement.bind(document);
  document.createElement = (name) => {
    const element = createElement(name);
    if (name === "div") {
      element.clientWidth = 0;
      element.clientHeight = 0;
    }
    return element;
  };
  const host = new FakeElement(document, "main");
  host.clientWidth = 0;
  host.clientHeight = 0;
  const runtime = await mountDom(result, host, { animate: false });
  const mounted = descendants(host.childNodes[0]);
  const byId = new Map(result.document.tree.nodes.map((node, index) => [node.id, mounted[index]]));
  const camera = byId.get("synthetic-polycss/camera");
  assert.equal(camera.style.left, "0px");
  assert.equal(camera.style.top, "0px");
  assert.equal(camera.style.width, "640px");
  assert.equal(camera.style.height, "480px");
  assert.equal(camera.style.transform, "");
  runtime.destroy();
});

test("browser image decode and cancellation failures roll back before publication", async () => {
  const built = buildDom(await syntheticPolycssInput());
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(readDomBrowser(built.bytes, { signal: controller.signal }), errorCode("OPERATION_ABORTED"));

  const result = await readBuiltBrowser(built);
  const failed = fakeBrowserDocument();
  const decodeImage = failed.document.defaultView.createImageBitmap;
  failed.document.defaultView.createImageBitmap = async () => { throw new Error("synthetic decoder rejection"); };
  const host = new FakeElement(failed.document, "main");
  const priorChild = new FakeElement(failed.document, "p");
  host.appendChild(priorChild);
  const phases = [];
  await assert.rejects(mountDom(result, host, {
    animate: false,
    onLifecyclePhase: (phase) => phases.push(phase),
  }), errorCode("IMAGE_DECODE_FAILED"));
  assert.deepEqual(phases, ["validate", "construct", "destroy"]);
  assert.deepEqual(host.childNodes, [priorChild]);
  assert.equal(failed.document.head.childNodes.length, 0);
  assert.deepEqual(failed.urls.revoked, failed.urls.created);

  failed.document.defaultView.createImageBitmap = decodeImage;
  const recovered = await mountDom(result, host, { animate: false });
  assert.equal(recovered.destroy(), true);
});

test("global image decoding fallback uses its owning realm", async () => {
  const built = buildDom(await syntheticPolycssInput());
  const result = await readBuiltBrowser(built);
  const fake = fakeBrowserDocument();
  fake.document.defaultView.createImageBitmap = undefined;
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "createImageBitmap");
  Object.defineProperty(globalThis, "createImageBitmap", {
    configurable: true,
    value: async function () {
      assert.equal(this, globalThis);
      return { width: 2, height: 2, close() {} };
    },
  });
  try {
    const runtime = await mountDom(result, new FakeElement(fake.document, "main"), { animate: false });
    assert.equal(runtime.destroy(), true);
  } finally {
    if (descriptor) Object.defineProperty(globalThis, "createImageBitmap", descriptor);
    else delete globalThis.createImageBitmap;
  }
});

test("mount rejects forged values and uses private verified resource bytes", async () => {
  const built = buildDom(await syntheticPolycssInput());
  const result = await readBuiltBrowser(built);
  const forged = { ...result };
  const { document, urls } = fakeBrowserDocument();
  const host = new FakeElement(document, "main");
  const priorChild = new FakeElement(document, "p");
  host.appendChild(priorChild);
  const phases = [];

  await assert.rejects(mountDom(forged, host, {
    animate: false,
    onLifecyclePhase: (phase) => phases.push(phase),
  }), errorCode("LIFECYCLE_PRECONDITION"));
  assert.deepEqual(phases, ["destroy"]);
  assert.deepEqual(host.childNodes, [priorChild]);
  assert.equal(host.hasAttribute("tabindex"), false);
  assert.deepEqual(urls.created, []);

  const bytes = result.resourceBytes.get("checker");
  bytes[bytes.length - 1] ^= 1;
  result.resourceBytes.clear();
  const privateSnapshotPhases = [];
  const runtime = await mountDom(result, host, {
    animate: false,
    onLifecyclePhase: (phase) => privateSnapshotPhases.push(phase),
  });
  assert.deepEqual(privateSnapshotPhases, ["validate", "construct", "bind", "initialize", "publish"]);
  assert.notDeepEqual(host.childNodes, [priorChild]);
  runtime.destroy();
  assert.deepEqual(host.childNodes, [priorChild]);
});

test("partial bind and publish failures transactionally roll back completed phases", async () => {
  const built = buildDom(await syntheticPolycssInput());
  const result = await readBuiltBrowser(built);
  const { document, urls } = fakeBrowserDocument();
  const host = new FakeElement(document, "main");
  const priorChild = new FakeElement(document, "p");
  host.appendChild(priorChild);
  host.style.position = "sticky";
  const phases = [];

  await assert.rejects(mountDom(result, host, {
    animate: false,
    onLifecyclePhase(phase) {
      phases.push(phase);
      if (phase === "bind") throw new Error("injected bind failure");
    },
  }), /injected bind failure/u);
  assert.deepEqual(phases, ["validate", "construct", "bind", "destroy"]);
  assert.deepEqual(host.childNodes, [priorChild]);
  assert.equal(host.style.position, "sticky");
  assert.equal(host.hasAttribute("tabindex"), false);
  assert.equal(document.head.childNodes.length, 0);
  assert.deepEqual(urls.revoked, urls.created);

  const late = fakeBrowserDocument();
  const lateHost = new FakeElement(late.document, "main");
  const latePriorChild = new FakeElement(late.document, "p");
  lateHost.appendChild(latePriorChild);
  const latePhases = [];
  await assert.rejects(mountDom(result, lateHost, {
    animate: false,
    onLifecyclePhase(phase) {
      latePhases.push(phase);
      if (phase === "publish") throw new Error("injected publish failure");
    },
  }), /injected publish failure/u);
  assert.deepEqual(latePhases, ["validate", "construct", "bind", "initialize", "publish", "destroy"]);
  assert.deepEqual(lateHost.childNodes, [latePriorChild]);
  assert.equal(lateHost.hasAttribute("tabindex"), false);
  assert.equal(late.document.head.childNodes.length, 0);
  assert.equal(late.observers[0].disconnected, true);
  assert.deepEqual(late.urls.revoked, late.urls.created);
  assert.equal([...lateHost.listeners.keys()].some((key) => key.startsWith("keydown:")), false);
});

test("pre-publication failure does not detach and reconnect existing host children", async () => {
  const built = buildDom(await syntheticPolycssInput());
  const result = await readBuiltBrowser(built);
  const { document } = fakeBrowserDocument();
  const host = new FakeElement(document, "main");
  const priorChild = new FakeElement(document, "p");
  host.appendChild(priorChild);
  const replaceChildren = host.replaceChildren.bind(host);
  let replacements = 0;
  host.replaceChildren = (...children) => {
    replacements += 1;
    return replaceChildren(...children);
  };

  await assert.rejects(mountDom(result, host, {
    animate: false,
    onLifecyclePhase(phase) {
      if (phase === "construct") throw new Error("injected construct failure");
    },
  }), /injected construct failure/u);
  assert.equal(replacements, 0);
  assert.deepEqual(host.childNodes, [priorChild]);
  assert.equal(priorChild.parentNode, host);
});

test("input sampling has fixed typed order and consumes the latest pointer once", async () => {
  const { document } = fakeBrowserDocument();
  const host = new FakeElement(document, "main");
  const input = createInteractionInput(host, host, {
    fitHeight: 240,
    fitWidth: 320,
    sourceHeight: 240,
    sourceWidth: 320,
  });
  input.setEnabled(true);

  const keydown = dispatch(host, "keydown", { code: "ArrowRight" });
  assert.equal(keydown.prevented, true);
  dispatch(host, "pointermove", { clientX: 10, clientY: 15 });
  dispatch(host, "pointermove", { clientX: 20, clientY: 25 });
  const positioned = input.sample();
  assert.deepEqual(Object.keys(positioned), ["stickX", "stickY", "pressed", "hold", "pointer"]);
  assert.deepEqual(positioned, { stickX: 0, stickY: 0, pressed: false, hold: false, pointer: { x: 20, y: 25 } });
  assert.deepEqual(input.sample(), { stickX: 127, stickY: 0, pressed: false, hold: false, pointer: null });

  const keyup = dispatch(host, "keyup", { code: "ArrowRight" });
  assert.equal(keyup.prevented, true);
  assert.deepEqual(input.sample(), { stickX: 0, stickY: 0, pressed: false, hold: false, pointer: null });

  dispatch(host, "pointerdown", { button: 0, clientX: 40, clientY: 50, pointerId: 7 });
  assert.equal(host.hasPointerCapture(7), true);
  assert.deepEqual(input.sample(), { stickX: 0, stickY: 0, pressed: true, hold: false, pointer: { x: 40, y: 50 } });
  dispatch(host, "pointermove", { clientX: 41, clientY: 51, pointerId: 7 });
  dispatch(host, "pointercancel", { clientX: 0, clientY: 0, pointerId: 7 });
  assert.equal(host.hasPointerCapture(7), false);
  assert.deepEqual(input.sample(), { stickX: 0, stickY: 0, pressed: false, hold: false, pointer: null });

  dispatch(host, "pointerdown", { button: 0, clientX: 60, clientY: 70, pointerId: 8 });
  input.sample();
  dispatch(host, "pointerup", { clientX: 99, clientY: 99, pointerId: 9 });
  assert.equal(host.hasPointerCapture(8), true);
  assert.equal(input.sample().pressed, true);
  dispatch(host, "pointermove", { clientX: 61, clientY: 71, pointerId: 8 });
  dispatch(host, "lostpointercapture", { clientX: 0, clientY: 0, pointerId: 8 });
  assert.equal(host.hasPointerCapture(8), false);
  assert.deepEqual(input.sample(), { stickX: 0, stickY: 0, pressed: false, hold: false, pointer: null });
  dispatch(host, "keydown", { code: "ArrowLeft" });
  dispatch(host, "pointerdown", { button: 0, clientX: 80, clientY: 90, pointerId: 10 });
  assert.equal(host.hasPointerCapture(10), true);
  dispatch(host, "pointermove", { clientX: 81, clientY: 91, pointerId: 10 });
  dispatch(host, "blur");
  assert.equal(host.hasPointerCapture(10), false);
  assert.deepEqual(input.sample(), { stickX: 0, stickY: 0, pressed: false, hold: false, pointer: null });
  dispatch(host, "pointerdown", { button: 0, clientX: 80, clientY: 90, pointerId: 11 });
  assert.equal(host.hasPointerCapture(11), true);
  assert.equal(input.destroy(), true);
  assert.equal(host.hasPointerCapture(11), false);
  assert.equal(input.destroy(), false);
  assert.throws(() => input.sample(), errorCode("INPUT_DESTROYED"));
});

test("pointer mapping measures the isolated mount surface with viewport fallback", () => {
  const { document } = fakeBrowserDocument();
  const host = new FakeElement(document, "main");
  const viewport = new FakeElement(document, "div");
  host.getBoundingClientRect = () => { throw new Error("caller host must not be measured"); };
  viewport.getBoundingClientRect = () => ({ left: 100, top: 50, width: 640, height: 480 });
  const presentation = { fitHeight: 240, fitWidth: 320, sourceHeight: 240, sourceWidth: 320 };
  const input = createInteractionInput(host, viewport, presentation);
  input.setEnabled(true);
  dispatch(host, "pointermove", { clientX: 420, clientY: 290 });
  assert.deepEqual(input.sample().pointer, { x: 160, y: 120 });
  input.destroy();

  const zeroViewport = new FakeElement(document, "div");
  zeroViewport.clientWidth = 0;
  zeroViewport.clientHeight = 0;
  zeroViewport.getBoundingClientRect = () => ({ left: 10, top: 20, width: 0, height: 0 });
  const fallback = createInteractionInput(host, zeroViewport, presentation, { viewportWidth: 640, viewportHeight: 480 });
  fallback.setEnabled(true);
  dispatch(host, "pointermove", { clientX: 330, clientY: 260 });
  assert.deepEqual(fallback.sample().pointer, { x: 160, y: 120 });
  fallback.destroy();
});

test("pointer mapping converts a non-uniformly scaled surface back to layout coordinates", () => {
  const { document } = fakeBrowserDocument();
  const host = new FakeElement(document, "main");
  const viewport = new FakeElement(document, "div");
  viewport.clientWidth = 640;
  viewport.clientHeight = 480;
  viewport.getBoundingClientRect = () => ({ left: 100, top: 50, width: 1280, height: 480 });
  const input = createInteractionInput(host, viewport, {
    fitHeight: 240,
    fitWidth: 320,
    sourceHeight: 240,
    sourceWidth: 320,
  });
  input.setEnabled(true);
  for (const [clientX, sourceX] of [[420, 80], [740, 160], [1060, 240]]) {
    dispatch(host, "pointermove", { clientX, clientY: 290 });
    assert.deepEqual(input.sample().pointer, { x: sourceX, y: 120 });
  }
  input.destroy();
});

test("pointer mapping inverts the current presentation appearance", () => {
  const { document } = fakeBrowserDocument();
  const host = new FakeElement(document, "main");
  const camera = new FakeElement(document, "div");
  const parameters = { fitHeight: 240, fitWidth: 320, sourceHeight: 240, sourceWidth: 320 };
  const presentation = createStaticPresentation({
    channels: [{
      id: "presentation",
      interpreter: "static-presentation@0",
      parameters,
      targets: { camera: "camera" },
    }],
  }, { host, byId: new Map([["camera", camera]]) });
  presentation.publishAppearance(["zoomed", 2, 10]);
  assert.equal(camera.style.left, "-160px");
  assert.equal(camera.style.top, "-110px");
  assert.equal(camera.style.transform, "scale(2)");
  assert.deepEqual(presentation.viewportPoint(160, 120, 320, 240), { x: 160, y: 130, scale: 2 });

  const input = createInteractionInput(host, host, presentation);
  input.setEnabled(true);
  dispatch(host, "pointermove", { clientX: 160, clientY: 130 });
  assert.deepEqual(input.sample().pointer, { x: 160, y: 120 });
  input.destroy();
});

test("landscape-first presentation selects landscape before strict portrait width bands", () => {
  const { document } = fakeBrowserDocument();
  const host = new FakeElement(document, "main");
  const camera = new FakeElement(document, "div");
  const row = (id, maxViewportWidth) => ({
    id,
    ...(maxViewportWidth === undefined ? {} : { maxViewportWidth }),
    fit: "contain",
    quarterTurns: 0,
    bounds: [0, 0, 320, 240],
    safeInset: 0,
    bias: [0, 0],
  });
  const presentation = createStaticPresentation({
    channels: [{
      id: "presentation",
      interpreter: "static-presentation@0",
      parameters: {
        fitHeight: 240,
        fitWidth: 320,
        sourceHeight: 240,
        sourceWidth: 320,
        profileSelection: "landscape-first-portrait-width",
        profiles: [row("landscape"), row("phone", 520), row("portrait-720", 720), row("portrait-920", 920), row("portrait-wide")],
      },
      targets: { camera: "camera" },
    }],
  }, { host, byId: new Map([["camera", camera]]) });

  for (const [width, height, expected] of [
    [320, 240, "landscape"],
    [240, 320, "phone"],
    [519, 600, "phone"],
    [520, 600, "portrait-720"],
    [719, 800, "portrait-720"],
    [720, 800, "portrait-920"],
    [919, 1000, "portrait-920"],
    [920, 1000, "portrait-wide"],
    [600, 600, "portrait-720"],
  ]) {
    host.clientWidth = width;
    host.clientHeight = height;
    presentation.resize();
    assert.equal(presentation.profileId, expected, `${width}x${height}`);
  }
});

test("prepared quarter-turn and cover profiles preserve exact forward and inverse mapping", () => {
  const { document } = fakeBrowserDocument();
  const host = new FakeElement(document, "main");
  const camera = new FakeElement(document, "div");
  const mobile = {
    id: "mobile",
    fit: "contain",
    quarterTurns: 1,
    bounds: [40, -40, 280, 280],
    safeInset: 8,
    bias: [0, -0.06],
  };
  const presentation = createStaticPresentation({
    channels: [{
      id: "presentation",
      interpreter: "static-presentation@0",
      parameters: { fitHeight: 240, fitWidth: 320, sourceHeight: 240, sourceWidth: 320, profileSelection: "viewport-width", profiles: [mobile] },
      targets: { camera: "camera" },
    }],
  }, { host, byId: new Map([["camera", camera]]) });
  presentation.resize();
  assert.equal(presentation.profileId, "mobile");
  const mobilePoint = presentation.viewportPoint(40, -40, 320, 240);
  assert.deepEqual(mobilePoint, { x: 160 + 160 * (224 / 240), y: 120 - 120 * (224 / 240), scale: 224 / 240 });
  assert.deepEqual(presentation.sourcePoint(mobilePoint.x, mobilePoint.y, 320, 240), { x: 40, y: -40 });

  const input = createInteractionInput(host, host, presentation);
  input.setEnabled(true);
  dispatch(host, "pointermove", { clientX: mobilePoint.x, clientY: mobilePoint.y });
  assert.deepEqual(input.sample().pointer, { x: 40, y: -40 });
  input.destroy();

  const offOriginCamera = new FakeElement(document, "div");
  const offOrigin = createStaticPresentation({
    channels: [{
      id: "presentation",
      interpreter: "static-presentation@0",
      parameters: {
        fitHeight: 240,
        fitWidth: 320,
        sourceHeight: 240,
        sourceWidth: 320,
        profileSelection: "viewport-width",
        profiles: [{ id: "off-origin", fit: "contain", quarterTurns: 1, bounds: [0, 0, 100, 50], safeInset: 0, bias: [0, 0] }],
      },
      targets: { camera: "off-origin-camera" },
    }],
  }, { host, byId: new Map([["off-origin-camera", offOriginCamera]]) });
  offOrigin.resize();
  assert.equal(offOriginCamera.style.left, "-228px");
  assert.equal(offOriginCamera.style.top, "264px");
  assert.equal(offOriginCamera.style.transform, "rotate(90deg) scale(2.4)");
  assert.deepEqual(offOrigin.viewportPoint(0, 0, 320, 240), { x: 220, y: 0, scale: 2.4 });
  assert.deepEqual(offOrigin.viewportPoint(100, 50, 320, 240), { x: 100, y: 240, scale: 2.4 });
  assert.deepEqual(offOrigin.sourcePoint(160, 120, 320, 240), { x: 50, y: 25 });

  const coverCamera = new FakeElement(document, "div");
  const coverHost = new FakeElement(document, "main");
  coverHost.clientHeight = 320;
  const cover = createStaticPresentation({
    channels: [{
      id: "presentation",
      interpreter: "static-presentation@0",
      parameters: {
        fitHeight: 240,
        fitWidth: 320,
        sourceHeight: 240,
        sourceWidth: 320,
        profileSelection: "viewport-width",
        profiles: [{ id: "cover", fit: "cover", quarterTurns: 0, bounds: [0, 0, 320, 240], safeInset: 0, bias: [0, 0] }],
      },
      targets: { camera: "cover-camera" },
    }],
  }, { host: coverHost, byId: new Map([["cover-camera", coverCamera]]) });
  cover.resize();
  assert.equal(cover.profileId, "cover");
  assert.equal(coverCamera.style.transform, "scale(1.333333)");
  assert.equal(coverCamera.style.left, "0px");
  assert.equal(coverCamera.style.top, "40px");
});
