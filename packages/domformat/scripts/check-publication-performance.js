import { execFile } from "node:child_process";
import { once } from "node:events";
import { createWriteStream } from "node:fs";
import { createServer } from "node:http";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { encodeCanonicalJson } from "../src/canonical-json.js";
import { invariant } from "../src/errors.js";
import { buildDom } from "../src/writer.js";
import { syntheticExecutableInteractionInput } from "../test/helpers.js";
import { auditSequentialPagedPublicationSources } from "./publication-allocation-guard.js";

const execFileAsync = promisify(execFile);
const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const workspaceRoot = resolve(root, "../..");
const configuredRuntimeRoot = resolve(process.env.DOMFORMAT_TRACE_RUNTIME_ROOT ?? root);
const configuredRuntimePackage = JSON.parse(await readFile(join(configuredRuntimeRoot, "package.json"), "utf8"));
const runtimeRoot = configuredRuntimePackage.name === "@layoutit/polycss-domformat" ? configuredRuntimeRoot : join(configuredRuntimeRoot, "packages/domformat");
const label = process.env.DOMFORMAT_TRACE_LABEL ?? "after";
const diagnosticsEnabled = process.env.DOMFORMAT_TRACE_DIAGNOSTICS === "1" || (process.env.DOMFORMAT_TRACE_DIAGNOSTICS !== "0" && runtimeRoot === root);
const guardedSourceFiles = Object.freeze({ pagedFile: "src/state/paged-state.ts", polycssFile: "src/state/polycss.ts" });
const sequentialPagedSourceGuard = auditSequentialPagedPublicationSources({
  pagedSource: await readFile(join(runtimeRoot, guardedSourceFiles.pagedFile), "utf8"),
  polycssSource: await readFile(join(runtimeRoot, guardedSourceFiles.polycssFile), "utf8"),
  ...guardedSourceFiles,
});
const allocationEvidence = Object.freeze({
  ...sequentialPagedSourceGuard,
  enforced: runtimeRoot === root,
  forbiddenSourceFormSites: sequentialPagedSourceGuard.violations.length,
  forbiddenSourceFormSitesByScope: Object.freeze(Object.fromEntries(sequentialPagedSourceGuard.scopes.map((scope) => [scope, sequentialPagedSourceGuard.violations.filter((entry) => entry.scope === scope).length]))),
});
if (allocationEvidence.enforced) invariant(allocationEvidence.pass, "PUBLICATION_ALLOCATION_GUARD", `Sequential paged publication reintroduced forbidden materialization/collection/sort/closure work: ${JSON.stringify({ missingScopes: allocationEvidence.missingScopes, violations: allocationEvidence.violations })}.`);
const outputRoot = resolve(workspaceRoot, "bench/results/domformat-publication", label);
const temporary = await mkdtemp(join(tmpdir(), "domformat-publication-"));
const durationMs = Number(process.env.DOMFORMAT_PUBLICATION_DURATION_MS ?? 42_000);
const maximumTaskMs = 50;
const frameCount = 1_440;
const framesPerPage = 60;
const pageCount = frameCount / framesPerPage;
const traceCategories = [
  "blink.user_timing",
  "devtools.timeline",
  "disabled-by-default-devtools.timeline",
].join(",");
const workloads = Object.freeze([
  Object.freeze({ id: "cloth", leafCount: 251, denseTransformCount: 200, sparseTransformStart: 200, sparseTransformPool: 51, sparseTransformCount: 17, surfaceChangeCount: 40, visibilityChangeCount: 51, variantChangeCount: 0 }),
  Object.freeze({ id: "solitaire", leafCount: 1_952, denseTransformCount: 0, sparseTransformStart: 0, sparseTransformPool: 32, sparseTransformCount: 32, surfaceChangeCount: 0, visibilityChangeCount: 32, variantChangeCount: 0 }),
  Object.freeze({ id: "gravity-well", leafCount: 1_984, denseTransformCount: 0, sparseTransformStart: 0, sparseTransformPool: 40, sparseTransformCount: 40, surfaceChangeCount: 0, visibilityChangeCount: 0, variantChangeCount: 40 }),
]);

let server;
let browser;

function contentType(pathname) {
  if (pathname.endsWith(".html")) return "text/html;charset=utf-8";
  if (pathname.endsWith(".js")) return "text/javascript;charset=utf-8";
  if (pathname.endsWith(".json")) return "application/json;charset=utf-8";
  if (pathname.endsWith(".css")) return "text/css;charset=utf-8";
  if (pathname.endsWith(".gz")) return "application/gzip";
  return "application/octet-stream";
}

function browserArguments() {
  return process.env.DOMFORMAT_BROWSER_NO_SANDBOX === "1" || (typeof process.getuid === "function" && process.getuid() === 0) ? ["--no-sandbox"] : [];
}

async function availableBrowser() {
  const candidates = [process.env.DOMFORMAT_BROWSER, chromium.executablePath(), "/Applications/Chromium.app/Contents/MacOS/Chromium", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser", "/usr/bin/google-chrome"].filter(Boolean);
  for (const candidate of candidates) {
    try { await access(candidate); return candidate; } catch {}
  }
  invariant(false, "MISSING_RELEASE_BROWSER", "A Chromium-family browser is required for the publication trace.");
}

function base64Integers(values, width) {
  const bytes = new Uint8Array(values.length * width);
  const view = new DataView(bytes.buffer);
  for (let index = 0; index < values.length; index += 1) {
    if (width === 1) bytes[index] = values[index];
    else if (width === 2) view.setUint16(index * width, values[index], true);
    else view.setUint32(index * width, values[index], true);
  }
  return Buffer.from(bytes).toString("base64");
}

function packedBits(values) {
  const bytes = new Uint8Array(Math.ceil(values.length / 8));
  for (let index = 0; index < values.length; index += 1) bytes[index >> 3] |= values[index] << (index & 7);
  return Buffer.from(bytes).toString("base64");
}

function transform(frame, leaf) {
  return `matrix3d(1,0,0,0,0,1,0,0,0,0,1,0,${frame * 2_000 + leaf + 1},0,0,1)`;
}

function frameTargets(workload, frame) {
  const targets = [];
  for (let index = 0; index < workload.denseTransformCount; index += 1) targets.push(index);
  if (frame === 1) {
    for (let index = 0; index < workload.sparseTransformPool; index += 1) targets.push(workload.sparseTransformStart + index);
  } else {
    const offset = (frame * workload.sparseTransformCount) % Math.max(1, workload.sparseTransformPool);
    for (let index = 0; index < workload.sparseTransformCount; index += 1) targets.push(workload.sparseTransformStart + (offset + index) % workload.sparseTransformPool);
  }
  targets.sort((left, right) => left - right);
  return targets;
}

function playbackRows(workload) {
  const rows = new Array(frameCount + 1);
  const current = new Uint16Array(workload.leafCount);
  current.fill(1);
  const targets = new Array(frameCount + 1);
  for (let frame = 1; frame <= frameCount; frame += 1) {
    const changed = frameTargets(workload, frame);
    targets[frame] = changed;
    for (const leaf of changed) current[leaf] = frame;
    rows[frame] = current.slice();
  }
  return { rows, targets };
}

function playbackPage(workload, playback, pageIndex) {
  const startFrame = pageIndex * framesPerPage + 1;
  const endFrame = startFrame + framesPerPage - 1;
  const transforms = [null, null];
  const indices = new Map();
  const reference = (value) => {
    const prior = indices.get(value);
    if (prior !== undefined) return prior;
    const index = transforms.length;
    indices.set(value, index);
    transforms.push(value);
    return index;
  };
  const keyframeIndices = Array.from(playback.rows[startFrame], (sourceFrame, leaf) => reference(transform(sourceFrame, leaf)));
  const appearances = new Array(framesPerPage).fill(0);
  const modelTransforms = new Array(framesPerPage).fill(0xffffffff);
  const shapeOffsets = new Array(framesPerPage + 1).fill(0);
  const leafOffsets = [0];
  const leafTargets = [];
  const leafTransforms = [];
  for (let frame = startFrame; frame <= endFrame; frame += 1) {
    for (const leaf of playback.targets[frame]) {
      leafTargets.push(leaf);
      leafTransforms.push(reference(transform(playback.rows[frame][leaf], leaf)));
    }
    leafOffsets.push(leafTargets.length);
  }
  const payload = {
    version: 0,
    codec: "polycss-paged-playback-page@0",
    channel: "playback",
    startFrame,
    endFrame,
    transforms,
    keyframe: { appearance: 0, modelTransform: 0, shapeTransformIndicesBase64: base64Integers([1], 4), shapeVisibilityBitsBase64: base64Integers([1], 1), leafTransformIndicesBase64: base64Integers(keyframeIndices, 4) },
    sequential: {
      appearanceIndicesBase64: base64Integers(appearances, 2),
      modelTransformIndicesBase64: base64Integers(modelTransforms, 4),
      shapeOffsetsBase64: base64Integers(shapeOffsets, 4),
      shapeTargetIndicesBase64: "",
      shapeTransformIndicesBase64: "",
      shapeVisibilityBase64: "",
      leafOffsetsBase64: base64Integers(leafOffsets, 4),
      leafTargetIndicesBase64: base64Integers(leafTargets, 4),
      leafTransformIndicesBase64: base64Integers(leafTransforms, 4),
    },
  };
  const transformBytes = transforms.reduce((total, value) => total + 8 + (value?.length ?? 0) * 2, 0);
  const materializedByteLength = transformBytes + 4 + 1 + workload.leafCount * 4 + framesPerPage * 6 + (framesPerPage + 1) * 8 + leafTargets.length * 8;
  return { payload, descriptor: { startFrame, endFrame, transformCount: transforms.length, shapeChangeCount: 0, leafChangeCount: leafTargets.length, materializedByteLength } };
}

function variantPage(workload, pageIndex) {
  const startFrame = pageIndex * framesPerPage + 1;
  const endFrame = startFrame + framesPerPage - 1;
  const keyframe = new Uint16Array(workload.leafCount);
  keyframe.fill(0xffff);
  keyframe.fill(0, 0, workload.variantChangeCount);
  if ((startFrame - 1) % 2 === 1) keyframe.fill(1, 0, workload.variantChangeCount);
  const offsets = [0, 0];
  const targets = [];
  const classes = [];
  for (let frame = startFrame + 1; frame <= endFrame; frame += 1) {
    for (let target = 0; target < workload.variantChangeCount; target += 1) {
      targets.push(target);
      classes.push((frame - 1) % 2);
    }
    offsets.push(targets.length);
  }
  const payload = {
    version: 0,
    codec: "polycss-paged-variants-page@0",
    channel: "variants",
    startFrame,
    endFrame,
    keyframeClassIndicesBase64: base64Integers(keyframe, 2),
    sequential: { offsetsBase64: base64Integers(offsets, 4), targetIndicesBase64: base64Integers(targets, 2), classIndicesBase64: base64Integers(classes, 2) },
  };
  return { payload, descriptor: { startFrame, endFrame, changeCount: targets.length, materializedByteLength: workload.leafCount * 2 + offsets.length * 4 + targets.length * 4 } };
}

function workloadTree(base, workload) {
  const original = base.tree.nodes.find((node) => node.id === "synthetic/leaf");
  const scene = structuredClone(base.tree.nodes.find((node) => node.id === "synthetic/scene"));
  const shape = structuredClone(base.tree.nodes.find((node) => node.id === "synthetic/shape"));
  shape.styles = { ...shape.styles, transform: "", visibility: "visible" };
  const cursor = structuredClone(base.tree.nodes.find((node) => node.id === "synthetic/cursor"));
  const cursorOpen = structuredClone(base.tree.nodes.find((node) => node.id === "synthetic/cursor:open"));
  const cursorClosed = structuredClone(base.tree.nodes.find((node) => node.id === "synthetic/cursor:closed"));
  const camera = structuredClone(base.tree.nodes.find((node) => node.id === "synthetic/camera"));
  const nodes = [scene, shape];
  for (let leaf = 0; leaf < workload.leafCount; leaf += 1) nodes.push({
    ...structuredClone(original),
    id: `synthetic/leaf:${leaf}`,
    sibling: leaf,
    classes: leaf < workload.variantChangeCount ? [...original.classes, "class-a"] : [...original.classes],
    styles: { ...structuredClone(original.styles), backgroundPositionY: "0", transform: transform(1, leaf), visibility: "visible" },
  });
  nodes.push(cursor, cursorOpen, cursorClosed, camera);
  const indexById = new Map(nodes.map((node, index) => [node.id, index]));
  return { ...structuredClone(base.tree), nodes: nodes.map((node, index) => ({ ...node, index, parent: node.parent === -1 ? -1 : indexById.get(base.tree.nodes[node.parent].id) })) };
}

function surfacePacket(workload, leafIds) {
  const faces = [];
  const sourceFrameDeltas = [];
  let stateOffset = 0;
  for (let leaf = 0; leaf < workload.leafCount; leaf += 1) {
    const stateCount = leaf < workload.surfaceChangeCount ? frameCount : 1;
    faces.push({ faceId: leafIds[leaf], sourceOrder: leaf, stateOffset, stateCount, leafWidth: 16, leafHeight: 16 });
    sourceFrameDeltas.push(0, ...new Array(stateCount - 1).fill(1));
    stateOffset += stateCount;
  }
  const surfaceOffsets = [0];
  const faceIndexDeltas = [];
  const stateIndexDeltas = [];
  const visibilityOffsets = [0];
  const visibilityFaces = [];
  const visibilityStart = workload.leafCount - workload.visibilityChangeCount;
  const visibilityTargets = Array.from({ length: workload.visibilityChangeCount }, (_, index) => visibilityStart + index);
  const currentVisibility = new Uint8Array(workload.leafCount).fill(1);
  if ((frameCount - 1) & 1) for (const face of visibilityTargets) currentVisibility[face] = 0;
  const encodedStates = new Uint32Array(workload.leafCount);
  for (let segment = 0; segment < frameCount; segment += 1) {
    const changedVisibility = visibilityTargets;
    const nextVisibility = currentVisibility.slice();
    for (const face of changedVisibility) nextVisibility[face] ^= 1;
    const lightingFaces = [];
    for (let face = 0; face < workload.surfaceChangeCount; face += 1) {
      const fromState = segment === 0 ? frameCount - 1 : segment - 1;
      const toState = segment;
      if (nextVisibility[face] === 1 && (currentVisibility[face] === 0 || fromState !== toState)) lightingFaces.push(face);
    }
    for (const face of changedVisibility) if (nextVisibility[face] === 1 && currentVisibility[face] === 0 && face >= workload.surfaceChangeCount) lightingFaces.push(face);
    lightingFaces.sort((left, right) => left - right);
    let previousFace = 0;
    for (const [index, face] of lightingFaces.entries()) {
      const targetState = face < workload.surfaceChangeCount ? segment : 0;
      faceIndexDeltas.push(index === 0 ? face : face - previousFace);
      stateIndexDeltas.push(targetState - encodedStates[face]);
      encodedStates[face] = targetState;
      previousFace = face;
    }
    surfaceOffsets.push(faceIndexDeltas.length);
    for (const face of changedVisibility) visibilityFaces.push(face);
    visibilityOffsets.push(visibilityFaces.length);
    currentVisibility.set(nextVisibility);
  }
  return {
    version: 0,
    frameCount,
    surface: { faces, statePacking: { stateCount: sourceFrameDeltas.length, sourceFrameDeltas } },
    transitions: { initialFrame: 1, sequential: { offsetsBase64: base64Integers(surfaceOffsets, 4), faceIndexDeltas, stateIndexDeltas }, nonInteractiveJumps: [] },
    visibility: { initialFrame: 1, initialVisibleBitsBase64: packedBits(new Uint8Array(workload.leafCount).fill(1)), sequential: { offsetsBase64: base64Integers(visibilityOffsets, 4), faceIndicesBase64: base64Integers(visibilityFaces, 2) }, nonInteractiveJumps: [] },
  };
}

async function workloadInput(workload) {
  const input = await syntheticExecutableInteractionInput();
  const presentationState = structuredClone(input.state.channels.find((channel) => channel.codec === "static-presentation@0"));
  const presentationBinding = structuredClone(input.bindings.channels.find((channel) => channel.interpreter === "static-presentation@0"));
  input.tree = workloadTree(input, workload);
  const playback = playbackRows(workload);
  const pages = [];
  for (let index = 0; index < pageCount; index += 1) {
    const page = playbackPage(workload, playback, index);
    const id = `${workload.id}-playback-${String(index + 1).padStart(2, "0")}`;
    input.resourceInputs.push({ id, kind: "state-page", mediaType: "application/vnd.layoutit.domformat-state-page+json", path: `state/${id}.json.gz`, bytes: encodeCanonicalJson(page.payload), encoding: "gzip", codec: "polycss-paged-playback-page@0" });
    pages.push({ resource: id, ...page.descriptor });
  }
  const leafIds = Array.from({ length: workload.leafCount }, (_, index) => `synthetic/leaf:${index}`);
  const playbackState = { id: "playback", codec: "polycss-paged-playback@0", data: { packet: { version: 0, shapeCount: 1, leafCount: workload.leafCount, appearances: [["default", 1, 0]], timeline: { introTicks: 0, loopTicks: frameCount, frames: Array.from({ length: frameCount }, (_, index) => index + 1) }, initial: { sourceFrame: 1, appearance: 0 }, pages, lookaheadPages: 1, maxResidentPages: 8 } } };
  const surfaceState = { id: "surface", codec: "polycss-surface-packed@0", data: { packet: surfacePacket(workload, leafIds) } };
  const playbackBinding = { id: "playback", state: "playback", interpreter: "polycss-paged-playback@0", status: "executable", inputs: ["time.tick"], targets: { model: "synthetic/scene", shapes: ["synthetic/shape"], leaves: leafIds }, sinks: ["style.transform", "style.visibility"], parameters: { baseSceneTransform: "translate3d(0px, 0px, 0px)", frameCount, tickRateHz: 30, catchUpPolicy: "single-step" } };
  const surfaceBinding = { id: "surface", state: "surface", interpreter: "polycss-surface@0", status: "executable", inputs: ["time.source-frame"], targets: { leaves: leafIds }, sinks: ["style.backgroundPositionY", "style.visibility"] };
  const states = [playbackState, presentationState, surfaceState];
  const bindings = [playbackBinding, presentationBinding, surfaceBinding];
  if (workload.variantChangeCount > 0) {
    const variantPages = [];
    for (let index = 0; index < pageCount; index += 1) {
      const page = variantPage(workload, index);
      const id = `${workload.id}-variants-${String(index + 1).padStart(2, "0")}`;
      input.resourceInputs.push({ id, kind: "state-page", mediaType: "application/vnd.layoutit.domformat-state-page+json", path: `state/${id}.json.gz`, bytes: encodeCanonicalJson(page.payload), encoding: "gzip", codec: "polycss-paged-variants-page@0" });
      variantPages.push({ resource: id, ...page.descriptor });
    }
    const initial = new Uint16Array(workload.leafCount);
    initial.fill(0xffff);
    initial.fill(0, 0, workload.variantChangeCount);
    states.push({ id: "variants", codec: "polycss-paged-variants@0", data: { packet: { version: 0, frameCount, classes: ["class-a", "class-b"], effects: [{ classIndex: 0, ownerIndex: 0, targetIndex: 65535, styles: { color: "#f00" } }, { classIndex: 1, ownerIndex: 0, targetIndex: 65535, styles: { color: "#0f0" } }], initial: { frame: 1, classIndicesBase64: base64Integers(initial, 2) }, pages: variantPages, lookaheadPages: 1, maxResidentPages: 8 } } });
    bindings.push({ id: "variants", state: "variants", interpreter: "polycss-paged-variants@0", status: "executable", inputs: ["time.source-frame"], targets: { effectNodes: [], nodes: leafIds }, sinks: ["class.prepared", "style.color"] });
  }
  input.state.channels = states.sort((left, right) => left.id.localeCompare(right.id));
  input.bindings.channels = bindings.sort((left, right) => left.id.localeCompare(right.id));
  const usedInputs = new Set(input.bindings.channels.flatMap((channel) => channel.inputs));
  input.bindings.inputs = input.bindings.inputs.filter((entry) => usedInputs.has(entry.id));
  input.meta = { title: `${workload.id} publication trace`, capabilities: ["css-semantic-closure", "deterministic-json", "explicit-retained-tree", "logical-assets", "prepared-paged-state", "prepared-playback", ...(workload.variantChangeCount > 0 ? ["prepared-variants"] : []), "prepared-surface-lighting"], optionalCapabilities: [], conformance: { executable: ["retained-tree", ...(workload.variantChangeCount > 0 ? ["paged-variants"] : []), "paged-playback", "presentation", "surface-lighting"], declaredOnly: [] }, counts: { nodes: input.tree.nodes.length, shapes: 1, leaves: workload.leafCount, sourceFrames: frameCount } };
  delete input.meta.initialExperience;
  return input;
}

async function writeFixtures() {
  const routes = new Map();
  for (const workload of workloads) {
    const built = buildDom(await workloadInput(workload));
    const directory = join(temporary, workload.id);
    await mkdir(directory, { recursive: true });
    const model = join(directory, "model.json");
    await writeFile(model, built.bytes);
    routes.set(`/${workload.id}/model.json`, model);
    for (const [relative, bytes] of built.externalResources) {
      const target = join(directory, ...relative.split("/"));
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, bytes);
      routes.set(`/${workload.id}/${relative}`, target);
    }
  }
  for (const [pathname, withDiagnostics] of [["suite.html", false], ["diagnostics.html", true]]) {
    const suite = join(temporary, pathname);
    await writeFile(suite, `<!doctype html><meta charset="utf-8"><style>html,body{margin:0}iframe{width:33.333vw;height:100vh;border:0}</style>${workloads.map((workload) => `<iframe data-workload="${workload.id}" src="/viewer/index.html?model=%2F${workload.id}%2Fmodel.json&animate=1&mode=animation${withDiagnostics ? "&diagnostics=1" : ""}"></iframe>`).join("")}`);
    routes.set(`/${pathname}`, suite);
  }
  return routes;
}

function serve(routes, installedRuntime) {
  return createServer(async (request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url, "http://127.0.0.1").pathname);
      if (pathname === "/favicon.ico") {
        response.writeHead(204, { "cache-control": "no-store" });
        response.end();
        return;
      }
      const explicit = routes.get(pathname);
      const installed = pathname.startsWith("/dist/");
      const sourceRoot = installed ? installedRuntime : root;
      const target = explicit ?? resolve(sourceRoot, `.${pathname}`);
      invariant(explicit !== undefined || target.startsWith(`${sourceRoot}${sep}`), "UNSAFE_TEST_PATH", "Publication request escaped its fixture root.");
      const bytes = await readFile(target);
      response.writeHead(200, { "cache-control": "no-store", "content-length": bytes.length, "content-type": contentType(target) });
      response.end(bytes);
    } catch {
      response.writeHead(404, { "content-type": "text/plain;charset=utf-8" });
      response.end("missing");
    }
  });
}

const browserInstrumentation = () => {
  const state = { raf: [], longTasks: [] };
  globalThis.__domformatPublicationTrace = state;
  const sample = (timestamp) => { state.raf.push(timestamp); requestAnimationFrame(sample); };
  requestAnimationFrame(sample);
  try { new PerformanceObserver((records) => { for (const entry of records.getEntries()) state.longTasks.push({ start: entry.startTime, duration: entry.duration }); }).observe({ type: "longtask", buffered: true }); } catch {}
};

async function startTrace(cdp) {
  const events = [];
  cdp.on("Tracing.dataCollected", (payload) => { if (Array.isArray(payload.value)) events.push(...payload.value); });
  await cdp.send("Tracing.start", { transferMode: "ReportEvents", categories: traceCategories });
  return events;
}

async function stopTrace(cdp) {
  await new Promise(async (resolveTrace) => { cdp.once("Tracing.tracingComplete", resolveTrace); await cdp.send("Tracing.end"); });
}

async function collectDiagnostics(context, origin) {
  if (!diagnosticsEnabled) return null;
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  await page.goto(`${origin}/diagnostics.html`, { waitUntil: "load", timeout: 120_000 });
  await page.waitForFunction(() => [...document.querySelectorAll("iframe")].every((frame) => frame.contentDocument?.documentElement.hasAttribute("data-domformat-ready")), undefined, { timeout: 120_000 });
  await page.evaluate(() => {
    for (const frame of document.querySelectorAll("iframe")) {
      const win = frame.contentWindow;
      win.__publicationLeaves = [...win.document.querySelectorAll("[data-domformat-node]")];
      for (const key of Object.keys(win.domformatProof.diagnostics)) win.domformatProof.diagnostics[key] = 0;
    }
  });
  await page.waitForFunction((minimumFrame) => [...document.querySelectorAll("iframe")].every((frame) => frame.contentWindow.domformatProof.sourceFrame >= minimumFrame), framesPerPage * 2 + 1, { timeout: 60_000 });
  const evidence = await page.evaluate(() => [...document.querySelectorAll("iframe")].map((frame) => {
    const win = frame.contentWindow;
    return { id: frame.dataset.workload, endFrame: win.domformatProof.sourceFrame, diagnostics: { ...win.domformatProof.diagnostics }, stableIdentity: win.__publicationLeaves.every((leaf) => leaf.isConnected && leaf.ownerDocument === win.document) };
  }));
  invariant(errors.length === 0 && evidence.every((entry) => entry.stableIdentity), "PUBLICATION_DIAGNOSTIC_FAILURE", `Publication diagnostic pass failed (${errors.join("; ")}).`);
  await page.close();
  return evidence;
}

function percentile(values, ratio) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1)];
}

function fixed(value) { return Number(value.toFixed(3)); }

async function writeRawTrace(path, events) {
  const output = createWriteStream(path);
  output.write('{"traceEvents":[');
  for (let start = 0; start < events.length; start += 256) {
    const chunk = events.slice(start, start + 256).map((event) => JSON.stringify(event)).join(",");
    if (!output.write(`${start === 0 ? "" : ","}${chunk}`)) await once(output, "drain");
  }
  output.end("]}");
  await once(output, "close");
}

function baselineDiagnostics(workload, endFrame) {
  const advances = endFrame - 1;
  const boundaries = Math.floor(advances / framesPerPage);
  const playbackVisits = advances * (workload.denseTransformCount + workload.sparseTransformCount);
  return {
    playbackCanonicalReconstructions: advances,
    playbackCanonicalShapeVisits: advances,
    playbackCanonicalLeafVisits: advances * workload.leafCount,
    playbackPublicationShapeVisits: 0,
    playbackPublicationLeafVisits: playbackVisits,
    variantCanonicalReconstructions: workload.variantChangeCount > 0 ? boundaries : 0,
    variantLogicalTargetVisits: workload.variantChangeCount > 0 ? boundaries * workload.leafCount + (advances - boundaries) * workload.variantChangeCount : 0,
    variantComparisonTargetVisits: workload.variantChangeCount > 0 ? advances * workload.leafCount : 0,
    variantDomWrites: workload.variantChangeCount > 0 ? advances * workload.variantChangeCount * 2 : 0,
    surfaceFullReconstructions: 0,
    surfaceLightingTargetVisits: advances * workload.surfaceChangeCount,
    surfaceVisibilityTargetVisits: advances * workload.visibilityChangeCount,
  };
}

function visitDiagnostics(value) {
  const { sequentialTargetSizedAllocations: _unsupportedPermanentZeroCounter, ...visits } = value;
  return visits;
}

function summarizeTrace(events, startPerf, endPerf, evidence) {
  const end = events.find((event) => event.name === "domformat-publication:end" && Number.isFinite(event.ts));
  invariant(end, "TRACE_MARK_MISSING", "Publication trace lacks its aligned CDP end mark.");
  const offsetMicros = end.ts - endPerf * 1_000;
  const startTrace = startPerf * 1_000 + offsetMicros;
  const endTrace = endPerf * 1_000 + offsetMicros;
  const tasks = events.filter((event) => event.ph === "X" && event.name === "RunTask" && event.pid === end.pid && event.tid === end.tid && event.ts < endTrace && event.ts + event.dur > startTrace);
  const idle = events.filter((event) => event.ph === "X" && event.name === "FireIdleCallback" && event.pid === end.pid && event.tid === end.tid && event.ts < endTrace && event.ts + event.dur > startTrace);
  const pageTasks = tasks.filter((task) => idle.some((callback) => callback.ts >= task.ts && callback.ts + callback.dur <= task.ts + task.dur));
  const taskDurations = tasks.map((event) => event.dur / 1_000);
  const pageDurations = pageTasks.map((event) => event.dur / 1_000);
  const rafGaps = evidence.raf.slice(1).map((value, index) => value - evidence.raf[index]);
  const dropped = rafGaps.filter((gap) => gap > 50);
  const groups = new Map();
  for (const event of events) {
    if (event.ph !== "X" || event.pid !== end.pid || event.tid !== end.tid || event.ts >= endTrace || event.ts + event.dur <= startTrace || event.name === "RunTask") continue;
    groups.set(event.name, (groups.get(event.name) ?? 0) + event.dur / 1_000);
  }
  const topEvents = [...groups].sort((left, right) => right[1] - left[1]).slice(0, 12).map(([name, totalMs]) => ({ name, totalMs: fixed(totalMs) }));
  return {
    durationMs: fixed(endPerf - startPerf),
    mainThread: { taskCount: tasks.length, maxTaskMs: fixed(Math.max(0, ...taskDurations)), p95TaskMs: fixed(percentile(taskDurations, 0.95)), longTaskObserverCount: evidence.longTasks.length },
    cadence: { sampleCount: rafGaps.length, p50Ms: fixed(percentile(rafGaps, 0.5)), p95Ms: fixed(percentile(rafGaps, 0.95)), maxPresentationGapMs: fixed(Math.max(0, ...rafGaps)), gapsOver50Ms: dropped.length },
    pagePreparation: { taskCount: pageTasks.length, maxTaskMs: fixed(Math.max(0, ...pageDurations)), p95TaskMs: fixed(percentile(pageDurations, 0.95)) },
    remainingDroppedFrameCauses: { gapsOver50Ms: dropped.length, topMainThreadEvents: topEvents },
  };
}

function markdown(report) {
  const diagnosticRows = report.workloads.map((entry) => `| ${entry.id} | ${entry.startFrame} | ${entry.endFrame} | ${entry.pageBoundariesCrossed} | ${entry.visitEvidenceProvenance} | ${entry.diagnostics.playbackPublicationLeafVisits} | ${entry.diagnostics.variantComparisonTargetVisits} | ${entry.diagnostics.surfaceLightingTargetVisits} | ${entry.diagnostics.surfaceVisibilityTargetVisits} | ${entry.diagnostics.playbackCanonicalReconstructions + entry.diagnostics.variantCanonicalReconstructions + entry.diagnostics.surfaceFullReconstructions} |`);
  const allocation = report.allocationEvidence;
  return `# DOMFormat prepared publication trace (${report.label})\n\nRuntime root: \`${report.runtimeRoot}\`\n\nBrowser: ${report.browserVersion}\n\nDuration: ${report.trace.durationMs.toFixed(3)} ms\n\n| Max main task | Max RAF gap | Cadence p50 | Cadence p95 | Page-preparation max |\n|---:|---:|---:|---:|---:|\n| ${report.trace.mainThread.maxTaskMs.toFixed(3)} ms | ${report.trace.cadence.maxPresentationGapMs.toFixed(3)} ms | ${report.trace.cadence.p50Ms.toFixed(3)} ms | ${report.trace.cadence.p95Ms.toFixed(3)} ms | ${report.trace.pagePreparation.maxTaskMs.toFixed(3)} ms |\n\n| Published adapter workload | Trace start | Trace end | Page boundaries | Visit evidence | Playback leaf visits | Variant compares | Surface visits | Visibility visits | Full reconstructions |\n|---|---:|---:|---:|---|---:|---:|---:|---:|---:|\n${diagnosticRows.join("\n")}\n\n## Sequential paged allocation evidence\n\nThe bounded TypeScript source guard found ${allocation.forbiddenSourceFormSites} forbidden source-form site(s) across the sequential paged staging/publication closure. Guard enforced: ${allocation.enforced ? "yes" : "no (historical comparison runtime)"}. Paged dispatch precedes inline materialization: ${allocation.pagedDispatchBeforeInlineMaterialization ? "yes" : "no"}. Missing guarded scopes: ${allocation.missingScopes.length}.\n\nThis is not a general JavaScript heap-allocation measurement. It rejects typed/ordinary \`slice()\`, \`Array.from()\`, array/typed-array constructors, generic array literals, spread-array clones, Set/Map construction, sorting, and nested closures in the guarded sequential paged publication closure while leaving explicit complete-row reconstruction branches legal.\n\nThe timing window is uninstrumented. Candidate-runtime target visits come from a separate instrumented post-trace browser pass. Historical-runtime target visits are deterministic workload estimates, not collected diagnostics. Each workload records its provenance in \`visitEvidenceProvenance\`; retained identities are checked in both browser passes when the instrumented pass runs. Flowerbox is intentionally excluded; the workloads are based on published Cloth, Solitaire, and Gravity Well adapters at cssGraphics ${report.cssgraphicsRevision}.\n`;
}

try {
  invariant(Number.isFinite(durationMs) && durationMs >= 40_000, "PUBLICATION_TRACE_DURATION", "The publication trace must run for at least 40 seconds.");
  await mkdir(outputRoot, { recursive: true });
  const routes = await writeFixtures();
  const npm = process.platform === "win32" ? "npm.cmd" : "npm";
  const packRoot = join(temporary, "pack");
  const installRoot = join(temporary, "install");
  await Promise.all([mkdir(packRoot), mkdir(installRoot)]);
  await execFileAsync(npm, ["run", "build"], { cwd: runtimeRoot, maxBuffer: 32 * 1024 * 1024, timeout: 120_000 });
  const packed = await execFileAsync(npm, ["pack", "--json", "--pack-destination", packRoot], { cwd: runtimeRoot, maxBuffer: 32 * 1024 * 1024, timeout: 120_000 });
  const reportStart = packed.stdout.lastIndexOf("\n[");
  const packReports = JSON.parse(reportStart === -1 ? packed.stdout : packed.stdout.slice(reportStart + 1));
  await execFileAsync(npm, ["install", "--prefix", installRoot, "--no-audit", "--no-fund", join(packRoot, packReports[0].filename)], { maxBuffer: 32 * 1024 * 1024, timeout: 120_000 });
  const installedRuntime = join(installRoot, "node_modules", "@layoutit", "polycss-domformat");
  server = serve(routes, installedRuntime);
  await new Promise((resolveListen, rejectListen) => { server.once("error", rejectListen); server.listen(0, "127.0.0.1", resolveListen); });
  const address = server.address();
  invariant(address && typeof address === "object", "PUBLICATION_SERVER", "Publication trace server did not bind.");
  const executablePath = await availableBrowser();
  browser = await chromium.launch({ executablePath, headless: true, args: browserArguments() });
  const context = await browser.newContext({ viewport: { width: 1_440, height: 900 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  await page.addInitScript(browserInstrumentation);
  const origin = `http://127.0.0.1:${address.port}`;
  await page.goto(`${origin}/suite.html`, { waitUntil: "load", timeout: 120_000 });
  try {
    await page.waitForFunction(() => [...document.querySelectorAll("iframe")].every((frame) => frame.contentDocument?.documentElement.hasAttribute("data-domformat-ready")), undefined, { timeout: 120_000 });
  } catch (error) {
    throw new Error(`Publication fixtures did not become ready (${errors.join("; ")}).`, { cause: error });
  }
  await page.evaluate(() => {
    for (const frame of document.querySelectorAll("iframe")) {
      const win = frame.contentWindow;
      win.__publicationLeaves = [...win.document.querySelectorAll("[data-domformat-node]")];
    }
    globalThis.__domformatPublicationTrace.raf.length = 0;
  });
  const cdp = await context.newCDPSession(page);
  const events = await startTrace(cdp);
  const startPerf = await page.evaluate(() => { performance.mark("domformat-publication:start"); return performance.now(); });
  await page.waitForTimeout(durationMs);
  const endPerf = await page.evaluate(() => { performance.mark("domformat-publication:end"); return performance.now(); });
  await stopTrace(cdp);
  const evidence = await page.evaluate(() => ({
    raf: globalThis.__domformatPublicationTrace.raf,
    longTasks: globalThis.__domformatPublicationTrace.longTasks,
    workloads: [...document.querySelectorAll("iframe")].map((frame) => {
      const win = frame.contentWindow;
      return { id: frame.dataset.workload, endFrame: win.domformatProof.sourceFrame, diagnostics: win.domformatProof.diagnostics ? { ...win.domformatProof.diagnostics } : null, stableIdentity: win.__publicationLeaves.every((leaf) => leaf.isConnected && leaf.ownerDocument === win.document) };
    }),
  }));
  invariant(errors.length === 0 && evidence.workloads.every((entry) => entry.stableIdentity), "PUBLICATION_TRACE_FAILURE", `Publication trace failed (${errors.join("; ")}).`);
  const trace = summarizeTrace(events, startPerf, endPerf, evidence);
  invariant(trace.mainThread.maxTaskMs <= maximumTaskMs, "PAGE_PREPARATION_LONG_TASK", `Publication trace main-thread task reached ${trace.mainThread.maxTaskMs} ms, above ${maximumTaskMs} ms.`);
  invariant(trace.pagePreparation.maxTaskMs <= maximumTaskMs, "PAGE_PREPARATION_LONG_TASK", `Publication trace page preparation reached ${trace.pagePreparation.maxTaskMs} ms, above ${maximumTaskMs} ms.`);
  await page.close();
  const diagnosticEvidence = await collectDiagnostics(context, origin);
  const diagnosticsByWorkload = new Map((diagnosticEvidence ?? []).map((entry) => [entry.id, entry]));
  const resultWorkloads = evidence.workloads.map((entry) => {
    const workload = workloads.find((candidate) => candidate.id === entry.id);
    const diagnostic = diagnosticsByWorkload.get(entry.id);
    return { ...entry, diagnostics: visitDiagnostics(diagnostic?.diagnostics ?? baselineDiagnostics(workload, entry.endFrame)), visitEvidenceProvenance: diagnostic ? "separate-instrumented-browser-pass" : "deterministic-workload-estimate", diagnosticEndFrame: diagnostic?.endFrame ?? null, startFrame: 1, pageBoundariesCrossed: Math.max(0, Math.floor((entry.endFrame - 1) / framesPerPage)) };
  });
  invariant(resultWorkloads.every((entry) => entry.pageBoundariesCrossed >= 2), "PUBLICATION_BOUNDARY_COVERAGE", "Every publication workload must cross at least two page boundaries.");
  const rawTrace = join(outputRoot, "publication.trace.json");
  await writeRawTrace(rawTrace, events);
  const report = { label, runtimeRoot, diagnosticsEnabled, timingInstrumented: false, allocationEvidence, cssgraphicsRevision: "083532aa66599f1ff4618b987ccc5df462631996", browserVersion: browser.version(), durationMs, framesPerPage, frameCount, maximumMainThreadTaskMs: maximumTaskMs, packedTarballBytes: packReports[0].size, trace, workloads: resultWorkloads, rawTrace };
  await writeFile(join(outputRoot, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  await writeFile(join(outputRoot, "report.md"), markdown(report));
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  await context.close();
} finally {
  if (browser) await browser.close();
  if (server) await new Promise((resolveClose) => server.close(resolveClose));
  await rm(temporary, { recursive: true, force: true });
}
