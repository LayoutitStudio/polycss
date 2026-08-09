import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { mountDom, readDomBrowser, readDomBrowserUrl } from "../src/browser.js";
import { createInteractionInput } from "../src/browser-input.js";
import { decodeJson, encodeCanonicalJson } from "../src/canonical-json.js";
import { buildDom } from "../src/writer.js";
import { builtExternalResources, errorCode, syntheticAnimationWithoutEffectsInput, syntheticInput, syntheticStaticPresentationInput, syntheticPolycssInput } from "./helpers.js";
import { dispatch, FakeElement, fakeBrowserDocument } from "./fake-browser.js";

function foreignArrayBuffer(bytes) {
  const context = vm.createContext({ values: [...bytes] });
  return vm.runInContext("Uint8Array.from(values).buffer", context);
}

function documentRoutes(built, modelUrl) {
  const routes = new Map([[modelUrl, built.bytes]]);
  for (const record of built.document.resources.resources) {
    routes.set(new URL(record.path, modelUrl).href, built.externalResources.get(record.path));
  }
  return routes;
}

function readBuiltBrowser(built, options = {}) {
  return readDomBrowser(built.bytes, { externalResources: builtExternalResources(built), ...options });
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
  assert.deepEqual(Object.keys(runtime), ["lifecycle", "mode", "sourceFrame", "seek", "setMode", "destroy"]);
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
  dispatch(host, "pointercancel", { clientX: 0, clientY: 0, pointerId: 7 });
  assert.equal(host.hasPointerCapture(7), false);
  assert.deepEqual(input.sample(), { stickX: 0, stickY: 0, pressed: false, hold: false, pointer: null });

  dispatch(host, "pointerdown", { button: 0, clientX: 60, clientY: 70, pointerId: 8 });
  input.sample();
  dispatch(host, "pointerup", { clientX: 99, clientY: 99, pointerId: 9 });
  assert.equal(host.hasPointerCapture(8), true);
  assert.equal(input.sample().pressed, true);
  dispatch(host, "lostpointercapture", { clientX: 0, clientY: 0, pointerId: 8 });
  assert.equal(host.hasPointerCapture(8), false);
  assert.deepEqual(input.sample(), { stickX: 0, stickY: 0, pressed: false, hold: false, pointer: null });
  dispatch(host, "pointerdown", { button: 0, clientX: 80, clientY: 90, pointerId: 10 });
  assert.equal(host.hasPointerCapture(10), true);
  assert.equal(input.destroy(), true);
  assert.equal(host.hasPointerCapture(10), false);
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
