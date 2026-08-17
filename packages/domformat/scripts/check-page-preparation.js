import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { encodeCanonicalJson } from "../src/canonical-json.js";
import { invariant } from "../src/errors.js";
import { statePageValidationWorkspaceBytes } from "../src/state-pages.js";
import { buildDom } from "../src/writer.js";
import { syntheticExecutableInteractionInput } from "../test/helpers.js";

const execFileAsync = promisify(execFile);
const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const workspaceRoot = resolve(root, "../..");
const outputRoot = resolve(workspaceRoot, "bench/results/domformat-page-preparation");
const temporary = await mkdtemp(join(tmpdir(), "domformat-page-preparation-"));
const MAX_MAIN_THREAD_TASK_MS = 50;
const TRACE_CATEGORIES = [
  "blink.user_timing",
  "devtools.timeline",
  "disabled-by-default-devtools.timeline",
  "loading",
  "v8",
].join(",");
const UINT32_MAX = 0xffffffff;
const workloads = Object.freeze([
  Object.freeze({ id: "electropaint", leafCount: 40, framesPerPage: 500, pageCount: 7, lookaheadPages: 4, maxResidentPages: 7 }),
  Object.freeze({ id: "gravity-well", leafCount: 1_984, framesPerPage: 1, pageCount: 4, lookaheadPages: 1, maxResidentPages: 4 }),
]);
const paths = Object.freeze([
  Object.freeze({ id: "reference", page: "/viewer/index.html", suffix: "" }),
  Object.freeze({ id: "alternate", page: "/viewer/index.html", suffix: "&implementation=conformance" }),
  Object.freeze({ id: "nversion", page: "/test/nversion-viewer.html", suffix: "" }),
]);

let server;
let browser;

function contentType(pathname) {
  if (pathname.endsWith(".html")) return "text/html;charset=utf-8";
  if (pathname.endsWith(".js")) return "text/javascript;charset=utf-8";
  if (pathname.endsWith(".json")) return "application/json;charset=utf-8";
  if (pathname.endsWith(".css")) return "text/css;charset=utf-8";
  if (pathname.endsWith(".png")) return "image/png";
  if (pathname.endsWith(".gz")) return "application/gzip";
  return "application/octet-stream";
}

function browserArguments() {
  return process.env.DOMFORMAT_BROWSER_NO_SANDBOX === "1"
    || (typeof process.getuid === "function" && process.getuid() === 0)
    ? ["--no-sandbox"]
    : [];
}

async function availableBrowser() {
  const candidates = [
    process.env.DOMFORMAT_BROWSER,
    chromium.executablePath(),
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/usr/bin/google-chrome",
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      await access(candidate);
      return candidate;
    } catch {}
  }
  invariant(false, "MISSING_RELEASE_BROWSER", "A Chromium-family browser is required for the page-preparation trace.");
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

function transform(frame, leaf) {
  const x = (frame - 1) * 2_000 + leaf + 1;
  return `matrix3d(1,0,0,0,0,1,0,0,0,0,1,0,${x},0,0,1)`;
}

function pagePayload(workload, pageIndex) {
  const startFrame = pageIndex * workload.framesPerPage + 1;
  const endFrame = startFrame + workload.framesPerPage - 1;
  const transforms = [null, null];
  for (let local = 0; local < workload.framesPerPage; local += 1) {
    const frame = startFrame + local;
    for (let leaf = 0; leaf < workload.leafCount; leaf += 1) transforms.push(transform(frame, leaf));
  }
  const leafChanges = workload.framesPerPage * workload.leafCount;
  const leafOffsets = Array.from({ length: workload.framesPerPage + 1 }, (_, index) => index * workload.leafCount);
  const leafTargets = Array.from({ length: leafChanges }, (_, index) => index % workload.leafCount);
  const leafTransforms = Array.from({ length: leafChanges }, (_, index) => 2 + index);
  const payload = {
    version: 0,
    codec: "polycss-paged-playback-page@0",
    channel: "playback",
    startFrame,
    endFrame,
    transforms,
    keyframe: {
      appearance: 0,
      modelTransform: 0,
      shapeTransformIndicesBase64: base64Integers([1], 4),
      shapeVisibilityBitsBase64: base64Integers([1], 1),
      leafTransformIndicesBase64: base64Integers(Array.from({ length: workload.leafCount }, (_, index) => index + 2), 4),
    },
    sequential: {
      appearanceIndicesBase64: base64Integers(new Array(workload.framesPerPage).fill(0), 2),
      modelTransformIndicesBase64: base64Integers(new Array(workload.framesPerPage).fill(UINT32_MAX), 4),
      shapeOffsetsBase64: base64Integers(new Array(workload.framesPerPage + 1).fill(0), 4),
      shapeTargetIndicesBase64: "",
      shapeTransformIndicesBase64: "",
      shapeVisibilityBase64: "",
      leafOffsetsBase64: base64Integers(leafOffsets, 4),
      leafTargetIndicesBase64: base64Integers(leafTargets, 4),
      leafTransformIndicesBase64: base64Integers(leafTransforms, 4),
    },
  };
  const transformBytes = transforms.reduce((total, value) => total + 8 + (value?.length ?? 0) * 2, 0);
  const materializedByteLength = transformBytes
    + 4 + 1 + workload.leafCount * 4
    + workload.framesPerPage * 2 + workload.framesPerPage * 4
    + (workload.framesPerPage + 1) * 4
    + (workload.framesPerPage + 1) * 4 + leafChanges * 8;
  return Object.freeze({
    payload,
    descriptor: Object.freeze({
      startFrame,
      endFrame,
      transformCount: transforms.length,
      shapeChangeCount: 0,
      leafChangeCount: leafChanges,
      materializedByteLength,
    }),
  });
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
    styles: { ...structuredClone(original.styles), transform: transform(1, leaf) },
  });
  nodes.push(cursor, cursorOpen, cursorClosed, camera);
  const indexById = new Map(nodes.map((node, index) => [node.id, index]));
  return {
    ...structuredClone(base.tree),
    nodes: nodes.map((node, index) => ({
      ...node,
      index,
      parent: node.parent === -1 ? -1 : indexById.get(base.tree.nodes[node.parent].id),
    })),
  };
}

async function workloadInput(workload) {
  const input = await syntheticExecutableInteractionInput();
  const presentationState = structuredClone(input.state.channels.find((channel) => channel.codec === "static-presentation@0"));
  const presentationBinding = structuredClone(input.bindings.channels.find((channel) => channel.interpreter === "static-presentation@0"));
  input.tree = workloadTree(input, workload);
  const totalFrames = workload.framesPerPage * workload.pageCount;
  const pages = [];
  for (let pageIndex = 0; pageIndex < workload.pageCount; pageIndex += 1) {
    const page = pagePayload(workload, pageIndex);
    const id = `${workload.id}-page-${String(pageIndex + 1).padStart(2, "0")}`;
    input.resourceInputs.push({
      id,
      kind: "state-page",
      mediaType: "application/vnd.layoutit.domformat-state-page+json",
      path: `state/${id}.json.gz`,
      bytes: encodeCanonicalJson(page.payload),
      encoding: "gzip",
      codec: "polycss-paged-playback-page@0",
    });
    pages.push({ resource: id, ...page.descriptor });
  }
  const playbackState = {
    id: "playback",
    codec: "polycss-paged-playback@0",
    data: { packet: {
      version: 0,
      shapeCount: 1,
      leafCount: workload.leafCount,
      appearances: [["default", 1, 0]],
      timeline: { introTicks: 0, loopTicks: totalFrames, frames: Array.from({ length: totalFrames }, (_, index) => index + 1) },
      initial: { sourceFrame: 1, appearance: 0 },
      pages,
      lookaheadPages: workload.lookaheadPages,
      maxResidentPages: workload.maxResidentPages,
    } },
  };
  const leafIds = Array.from({ length: workload.leafCount }, (_, index) => `synthetic/leaf:${index}`);
  const totalFrameOffsets = base64Integers(new Array(totalFrames + 1).fill(0), 4);
  const visibleBytes = new Uint8Array(Math.ceil(workload.leafCount / 8)).fill(0xff);
  if (workload.leafCount % 8 !== 0) visibleBytes[visibleBytes.length - 1] = (1 << (workload.leafCount % 8)) - 1;
  const surfaceState = {
    id: "surface",
    codec: "polycss-surface-packed@0",
    data: { packet: {
      version: 0,
      frameCount: totalFrames,
      surface: {
        faces: leafIds.map((id, index) => ({ faceId: id, sourceOrder: index, stateOffset: index, stateCount: 1, leafWidth: 16, leafHeight: 16 })),
        statePacking: { stateCount: workload.leafCount, sourceFrameDeltas: new Array(workload.leafCount).fill(0) },
      },
      transitions: { initialFrame: 1, sequential: { offsetsBase64: totalFrameOffsets, faceIndexDeltas: [], stateIndexDeltas: [] }, nonInteractiveJumps: [] },
      visibility: { initialFrame: 1, initialVisibleBitsBase64: Buffer.from(visibleBytes).toString("base64"), sequential: { offsetsBase64: totalFrameOffsets, faceIndicesBase64: "" }, nonInteractiveJumps: [] },
    } },
  };
  const playbackBinding = {
    id: "playback",
    state: "playback",
    interpreter: "polycss-paged-playback@0",
    status: "executable",
    inputs: ["time.tick"],
    targets: { model: "synthetic/scene", shapes: ["synthetic/shape"], leaves: leafIds },
    sinks: ["style.transform", "style.visibility"],
    parameters: { baseSceneTransform: "translate3d(0px, 0px, 0px)", frameCount: totalFrames, tickRateHz: 30 },
  };
  const surfaceBinding = {
    id: "surface",
    state: "surface",
    interpreter: "polycss-surface@0",
    status: "executable",
    inputs: ["time.source-frame"],
    targets: { leaves: leafIds },
    sinks: ["style.backgroundPositionY", "style.visibility"],
  };
  input.state.channels = [playbackState, presentationState, surfaceState].sort((left, right) => left.id.localeCompare(right.id));
  input.bindings.channels = [playbackBinding, presentationBinding, surfaceBinding].sort((left, right) => left.id.localeCompare(right.id));
  const usedInputs = new Set(input.bindings.channels.flatMap((channel) => channel.inputs));
  input.bindings.inputs = input.bindings.inputs.filter((entry) => usedInputs.has(entry.id));
  input.meta = {
    title: `${workload.id} page preparation trace`,
    capabilities: ["css-semantic-closure", "deterministic-json", "explicit-retained-tree", "logical-assets", "prepared-paged-state", "prepared-playback", "prepared-surface-lighting"],
    optionalCapabilities: [],
    conformance: { executable: ["retained-tree", "paged-playback", "presentation", "surface-lighting"], declaredOnly: [] },
    counts: { nodes: input.tree.nodes.length, shapes: 1, leaves: workload.leafCount, sourceFrames: totalFrames },
  };
  delete input.meta.initialExperience;
  return input;
}

function liveRowBytes(workload) {
  let total = 8 + 1;
  total += 8;
  for (let leaf = 0; leaf < workload.leafCount; leaf += 1) total += 8 + transform(1, leaf).length * 2;
  return total;
}

async function writeFixture(workload) {
  const built = buildDom(await workloadInput(workload));
  const directory = join(temporary, workload.id);
  await mkdir(directory, { recursive: true });
  const routes = new Map();
  const model = join(directory, "model.json");
  await writeFile(model, built.bytes);
  routes.set(`/${workload.id}/model.json`, model);
  for (const [relative, bytes] of built.externalResources) {
    const target = join(directory, ...relative.split("/"));
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, bytes);
    routes.set(`/${workload.id}/${relative}`, target);
  }
  const records = new Map(built.document.resources.resources.map((record) => [record.id, record]));
  const packet = built.document.state.channels.find((channel) => channel.codec === "polycss-paged-playback@0").data.packet;
  const residentDescriptors = packet.pages.slice(0, workload.lookaheadPages + 1);
  const residentMaterializedBytes = residentDescriptors.reduce((total, page) => total + page.materializedByteLength, 0);
  const liveBytes = liveRowBytes(workload);
  let residentBefore = 0;
  let peakDocumentStateBytes = 0;
  let peakValidationBytes = 0;
  let peakMaterializedBytes = 0;
  for (const descriptor of residentDescriptors) {
    const record = records.get(descriptor.resource);
    const validationBytes = statePageValidationWorkspaceBytes(record.decodedByteLength, descriptor.materializedByteLength);
    peakValidationBytes = Math.max(peakValidationBytes, validationBytes);
    peakMaterializedBytes = Math.max(peakMaterializedBytes, residentBefore + descriptor.materializedByteLength);
    peakDocumentStateBytes = Math.max(peakDocumentStateBytes, validationBytes + residentBefore + descriptor.materializedByteLength + liveBytes);
    residentBefore += descriptor.materializedByteLength;
  }
  return Object.freeze({
    workload,
    built,
    routes,
    packet,
    records,
    metrics: Object.freeze({
      pageCount: packet.pages.length,
      initialResidentPages: residentDescriptors.length,
      encodedStatePageBytes: packet.pages.reduce((total, page) => total + records.get(page.resource).byteLength, 0),
      decodedStatePageBytes: packet.pages.reduce((total, page) => total + records.get(page.resource).decodedByteLength, 0),
      residentMaterializedBytes,
      peakValidationBytes,
      peakMaterializedBytes,
      peakDocumentStateBytes,
      liveRowBytes: liveBytes,
    }),
  });
}

function serve(explicitFiles, installedRuntime, runtimeRequests) {
  return createServer(async (request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url, "http://127.0.0.1").pathname);
      const explicit = explicitFiles.get(pathname);
      invariant(!pathname.startsWith("/src/") && !pathname.startsWith("/packages/domformat/"), "WORKSPACE_RUNTIME_IMPORT", `Browser requested workspace runtime path ${pathname}.`);
      const installedRequest = pathname.startsWith("/dist/");
      const sourceRoot = installedRequest ? installedRuntime : root;
      const target = explicit ?? resolve(sourceRoot, `.${pathname}`);
      invariant(explicit !== undefined || target.startsWith(`${sourceRoot}${sep}`), "UNSAFE_TEST_PATH", "Browser request escaped its fixture root.");
      const bytes = await readFile(target);
      if (installedRequest) runtimeRequests.push({ pathname, target });
      response.writeHead(200, {
        "cache-control": "no-store",
        "content-length": bytes.length,
        "content-type": contentType(target),
      });
      response.end(bytes);
    } catch {
      response.writeHead(404, { "content-type": "text/plain;charset=utf-8" });
      response.end("missing");
    }
  });
}

const browserInstrumentation = () => {
  const state = { events: [], longTasks: [], sequence: 0, pendingMaterialize: null, pendingIdleCallbacks: 0, idleCallbacks: 0, lastIdleCallback: 0, pauseIdle: false, heldIdleCallbacks: [] };
  globalThis.__domformatPagePreparation = state;
  const begin = (phase, detail = {}) => {
    const id = ++state.sequence;
    const start = performance.now();
    const mark = `domformat-page:${phase}:start:${id}`;
    performance.mark(mark);
    const event = { id, phase, start, end: null, duration: null, status: "pending", detail, startMark: mark, endMark: null };
    state.events.push(event);
    return event;
  };
  const end = (event, status = "ok") => {
    if (event.end !== null) return;
    event.end = performance.now();
    event.duration = event.end - event.start;
    event.status = status;
    event.endMark = `domformat-page:${event.phase}:end:${event.id}`;
    performance.mark(event.endMark);
  };
  const originalFetch = globalThis.fetch.bind(globalThis);
  globalThis.fetch = async (...args) => {
    const url = String(args[0]?.url ?? args[0]);
    if (!url.includes("/state/") || !url.endsWith(".gz")) return originalFetch(...args);
    if (state.pendingMaterialize) {
      end(state.pendingMaterialize);
      state.pendingMaterialize = null;
    }
    const event = begin("load", { url });
    try {
      const response = await originalFetch(...args);
      const readable = response.body;
      if (!readable) {
        end(event, response.ok ? "ok" : `http-${response.status}`);
        return response;
      }
      const wrapped = new Proxy(readable, {
        get(target, property) {
          if (property !== "getReader") {
            const value = Reflect.get(target, property, target);
            return typeof value === "function" ? value.bind(target) : value;
          }
          return (...readerArguments) => {
            const reader = target.getReader(...readerArguments);
            return new Proxy(reader, {
              get(readerTarget, readerProperty) {
                if (readerProperty === "read") return async (...readArguments) => {
                  try {
                    const value = await readerTarget.read(...readArguments);
                    if (value.done) end(event);
                    return value;
                  } catch (error) {
                    end(event, error?.name === "AbortError" ? "aborted" : "failed");
                    throw error;
                  }
                };
                if (readerProperty === "cancel") return async (...cancelArguments) => {
                  try { return await readerTarget.cancel(...cancelArguments); }
                  finally { end(event, "aborted"); }
                };
                const value = Reflect.get(readerTarget, readerProperty, readerTarget);
                return typeof value === "function" ? value.bind(readerTarget) : value;
              },
            });
          };
        },
      });
      return new Proxy(response, {
        get(target, property) {
          if (property === "body") return wrapped;
          const value = Reflect.get(target, property, target);
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
    } catch (error) {
      end(event, error?.name === "AbortError" ? "aborted" : "failed");
      throw error;
    }
  };
  const digestOwner = globalThis.SubtleCrypto?.prototype;
  if (digestOwner?.digest) {
    const originalDigest = digestOwner.digest;
    digestOwner.digest = async function instrumentedDigest(algorithm, value) {
      const event = begin("verify", { byteLength: value?.byteLength ?? null });
      try {
        const digest = await Reflect.apply(originalDigest, this, [algorithm, value]);
        end(event);
        return digest;
      } catch (error) {
        end(event, "failed");
        throw error;
      }
    };
  }
  const OriginalDecompressionStream = globalThis.DecompressionStream;
  const readableOwner = globalThis.ReadableStream?.prototype;
  if (typeof OriginalDecompressionStream === "function" && readableOwner?.pipeThrough) {
    const originalPipeThrough = readableOwner.pipeThrough;
    readableOwner.pipeThrough = function instrumentedPipeThrough(transform, ...pipeArguments) {
      const output = Reflect.apply(originalPipeThrough, this, [transform, ...pipeArguments]);
      if (!(transform instanceof OriginalDecompressionStream)) return output;
      return new Proxy(output, {
          get(target, property) {
            if (property !== "getReader") {
              const value = Reflect.get(target, property, target);
              return typeof value === "function" ? value.bind(target) : value;
            }
            return (...readerArguments) => {
              const event = begin("decode", { format: "gzip" });
              const reader = target.getReader(...readerArguments);
              return new Proxy(reader, {
                get(readerTarget, readerProperty) {
                  if (readerProperty === "read") return async (...readArguments) => {
                    try {
                      const value = await readerTarget.read(...readArguments);
                      if (value.done) end(event);
                      return value;
                    } catch (error) {
                      end(event, "failed");
                      throw error;
                    }
                  };
                  if (readerProperty === "cancel") return async (...cancelArguments) => {
                    try { return await readerTarget.cancel(...cancelArguments); }
                    finally { end(event, "aborted"); }
                  };
                  const value = Reflect.get(readerTarget, readerProperty, readerTarget);
                  return typeof value === "function" ? value.bind(readerTarget) : value;
                },
              });
            };
          },
        });
    };
  }
  const originalRequestIdleCallback = globalThis.requestIdleCallback?.bind(globalThis);
  if (originalRequestIdleCallback) {
    globalThis.requestIdleCallback = (callback, options) => {
      state.pendingIdleCallbacks += 1;
      const schedule = () => originalRequestIdleCallback((deadline) => {
        state.pendingIdleCallbacks -= 1;
        state.idleCallbacks += 1;
        state.lastIdleCallback = performance.now();
        callback(deadline);
      }, options);
      if (!state.pauseIdle) return schedule();
      state.heldIdleCallbacks.push(schedule);
      return -state.heldIdleCallbacks.length;
    };
    state.releaseIdleCallbacks = () => {
      state.pauseIdle = false;
      for (const schedule of state.heldIdleCallbacks.splice(0)) schedule();
    };
  }
  const originalParse = JSON.parse;
  JSON.parse = function instrumentedParse(value, ...rest) {
    const statePage = typeof value === "string" && value.includes('"codec":"polycss-paged-playback-page@0"');
    if (!statePage) return Reflect.apply(originalParse, this, [value, ...rest]);
    if (state.pendingMaterialize) end(state.pendingMaterialize);
    const event = begin("materialize", { textLength: value.length });
    state.pendingMaterialize = event;
    try {
      return Reflect.apply(originalParse, this, [value, ...rest]);
    } catch (error) {
      end(event, "failed");
      state.pendingMaterialize = null;
      throw error;
    }
  };
  state.finalizeMaterialize = () => {
    if (!state.pendingMaterialize) return;
    end(state.pendingMaterialize);
    state.pendingMaterialize = null;
  };
  try {
    new PerformanceObserver((records) => {
      for (const entry of records.getEntries()) state.longTasks.push({ start: entry.startTime, duration: entry.duration, name: entry.name });
    }).observe({ type: "longtask", buffered: true });
  } catch {}
};

async function startTrace(cdp) {
  const events = [];
  cdp.on("Tracing.dataCollected", (payload) => {
    if (Array.isArray(payload.value)) events.push(...payload.value);
  });
  await cdp.send("Tracing.start", { transferMode: "ReportEvents", categories: TRACE_CATEGORIES });
  return events;
}

async function stopTrace(cdp) {
  await new Promise(async (resolveTrace) => {
    cdp.once("Tracing.tracingComplete", resolveTrace);
    await cdp.send("Tracing.end");
  });
}

function traceMark(events, name) {
  return events.find((event) => event.name === name && Number.isFinite(event.ts));
}

function percentile(values, ratio) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1)];
}

function phaseSummary(events) {
  const result = {};
  for (const phase of ["load", "verify", "decode", "materialize"]) {
    const entries = events.filter((event) => event.phase === phase && event.end !== null);
    const durations = entries.map((event) => event.duration);
    result[phase] = Object.freeze({
      count: entries.length,
      failed: entries.filter((event) => event.status !== "ok").length,
      totalMs: Number(durations.reduce((total, value) => total + value, 0).toFixed(3)),
      p95Ms: Number(percentile(durations, 0.95).toFixed(3)),
      maxMs: Number(Math.max(0, ...durations).toFixed(3)),
    });
  }
  return Object.freeze(result);
}

async function tracePreparation(origin, fixture, path) {
  const context = await browser.newContext({ viewport: { width: 960, height: 720 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  await page.addInitScript(browserInstrumentation);
  const cdp = await context.newCDPSession(page);
  const events = await startTrace(cdp);
  const url = `${origin}${path.page}?model=%2F${fixture.workload.id}%2Fmodel.json&animate=0&mode=animation${path.suffix}`;
  await page.goto(url, { waitUntil: "load", timeout: 120_000 });
  await page.waitForFunction(() => document.documentElement.hasAttribute("data-domformat-ready") || document.documentElement.hasAttribute("data-domformat-error"), undefined, { timeout: 120_000 });
  const initial = await page.evaluate(() => ({
    ready: document.documentElement.hasAttribute("data-domformat-ready"),
    error: document.documentElement.hasAttribute("data-domformat-error"),
    status: document.querySelector("#status")?.textContent ?? "",
  }));
  if (!initial.ready || initial.error) {
    invariant(false, "PAGE_PREPARATION_FAILED", `${fixture.workload.id}/${path.id} failed to mount (${initial.status}; ${errors.join("; ")}).`);
  }
  const expectedUrls = fixture.packet.pages.slice(0, fixture.workload.lookaheadPages + 1).map((descriptor) => `/state/${descriptor.resource}.json.gz`);
  await page.waitForFunction((urls) => urls.every((url) => globalThis.__domformatPagePreparation.events.some((event) => event.phase === "load" && event.detail.url.includes(url) && event.status === "ok")), expectedUrls, { timeout: 120_000 });
  await page.waitForFunction((minimumMaterializations) => {
    const state = globalThis.__domformatPagePreparation;
    const materializations = state.events.filter((event) => event.phase === "materialize").length;
    return materializations >= minimumMaterializations && state.pendingIdleCallbacks === 0 && performance.now() - state.lastIdleCallback >= 32;
  }, expectedUrls.length, { timeout: 120_000 });
  await page.evaluate(() => new Promise((resolveFrame) => requestAnimationFrame(() => requestAnimationFrame(resolveFrame))));
  const endPerf = await page.evaluate(() => {
    globalThis.__domformatPagePreparation.finalizeMaterialize();
    performance.mark("domformat-page:trace:end");
    return performance.now();
  });
  await stopTrace(cdp);
  const evidence = await page.evaluate(() => ({
    events: globalThis.__domformatPagePreparation.events,
    longTasks: globalThis.__domformatPagePreparation.longTasks,
    sourceFrame: globalThis.domformatProof.sourceFrame,
    leaves: globalThis.domformatProof.leaves,
  }));
  const endMark = traceMark(events, "domformat-page:trace:end");
  invariant(endMark, "TRACE_MARK_MISSING", `${fixture.workload.id}/${path.id} lacks its aligned CDP end mark.`);
  const offsetMicros = endMark.ts - endPerf * 1_000;
  const startPerf = Math.min(...evidence.events.map((event) => event.start));
  const startTraceMicros = startPerf * 1_000 + offsetMicros;
  const endTrace = endPerf * 1_000 + offsetMicros;
  const mainThread = { pid: endMark.pid, tid: endMark.tid };
  const tasks = events.filter((event) => event.ph === "X" && event.name === "RunTask" && event.pid === mainThread.pid && event.tid === mainThread.tid && event.ts < endTrace && event.ts + event.dur > startTraceMicros);
  const idleCallbacks = events.filter((event) => event.ph === "X" && event.name === "FireIdleCallback" && event.pid === mainThread.pid && event.tid === mainThread.tid && event.ts < endTrace && event.ts + event.dur > startTraceMicros);
  const preparationTasks = tasks.filter((task) => idleCallbacks.some((callback) => callback.ts >= task.ts && callback.ts + callback.dur <= task.ts + task.dur));
  const phaseMarks = new Set(events.filter((event) => event.name?.startsWith?.("domformat-page:")).map((event) => event.name));
  for (const event of evidence.events.filter((entry) => entry.end !== null)) {
    invariant(phaseMarks.has(event.startMark) && phaseMarks.has(event.endMark), "TRACE_MARK_MISSING", `${fixture.workload.id}/${path.id} phase ${event.phase}/${event.id} is not aligned in CDP.`);
  }
  invariant(preparationTasks.length > 0, "TRACE_MARK_MISSING", `${fixture.workload.id}/${path.id} lacks validation-owned idle tasks.`);
  const taskDurations = preparationTasks.map((event) => event.dur / 1_000);
  const observedTaskDurations = tasks.map((event) => event.dur / 1_000);
  const maxTaskMs = Math.max(0, ...taskDurations);
  const observedMaxTaskMs = Math.max(0, ...observedTaskDurations);
  const phases = phaseSummary(evidence.events);
  invariant(maxTaskMs <= MAX_MAIN_THREAD_TASK_MS, "PAGE_PREPARATION_LONG_TASK", `${fixture.workload.id}/${path.id} validation-owned page preparation reached ${maxTaskMs.toFixed(3)} ms, above ${MAX_MAIN_THREAD_TASK_MS} ms (observed window max ${observedMaxTaskMs.toFixed(3)} ms; ${JSON.stringify(phases)}; longTasks=${JSON.stringify(evidence.longTasks)}).`);
  invariant(evidence.leaves === fixture.workload.leafCount && evidence.sourceFrame === 1 && errors.length === 0, "PAGE_PREPARATION_PUBLICATION", `${fixture.workload.id}/${path.id} published the wrong retained closure.`);
  const traceDirectory = join(outputRoot, "traces");
  await mkdir(traceDirectory, { recursive: true });
  const tracePath = join(traceDirectory, `${fixture.workload.id}-${path.id}.trace.json`);
  await writeFile(tracePath, JSON.stringify({ traceEvents: events }));
  await context.close();
  return Object.freeze({
    workload: fixture.workload.id,
    path: path.id,
    phases,
    mainThread: Object.freeze({ taskCount: taskDurations.length, p95TaskMs: Number(percentile(taskDurations, 0.95).toFixed(3)), maxTaskMs: Number(maxTaskMs.toFixed(3)), observedTaskCount: observedTaskDurations.length, observedMaxTaskMs: Number(observedMaxTaskMs.toFixed(3)), longTaskObserverCount: evidence.longTasks.length }),
    tracePath,
    traceMarkerCount: phaseMarks.size,
    loadedStatePageUrls: [...new Set(evidence.events.filter((event) => event.phase === "load" && event.status === "ok").map((event) => new URL(event.detail.url).pathname))].sort(),
  });
}

async function atomicityProof(origin, fixture, path, kind) {
  const context = await browser.newContext({ viewport: { width: 960, height: 720 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  await page.addInitScript(browserInstrumentation);
  const url = `${origin}${path.page}?model=%2F${fixture.workload.id}%2Fmodel.json&animate=0&mode=animation${path.suffix}`;
  await page.goto(url, { waitUntil: "load", timeout: 120_000 });
  await page.waitForFunction(() => document.documentElement.hasAttribute("data-domformat-ready"), undefined, { timeout: 120_000 });
  const initialUrls = fixture.packet.pages.slice(0, fixture.workload.lookaheadPages + 1).map((descriptor) => `/state/${descriptor.resource}.json.gz`);
  await page.waitForFunction((urls) => urls.every((url) => globalThis.__domformatPagePreparation.events.some((event) => event.phase === "load" && event.detail.url.includes(url) && event.status === "ok")), initialUrls, { timeout: 120_000 });
  await page.waitForFunction(() => {
    const state = globalThis.__domformatPagePreparation;
    return state.pendingIdleCallbacks === 0 && performance.now() - state.lastIdleCallback >= 32;
  }, undefined, { timeout: 120_000 });
  await page.evaluate(() => globalThis.__domformatPagePreparation.finalizeMaterialize());
  const target = fixture.packet.pages.at(-1);
  const record = fixture.records.get(target.resource);
  const routePattern = `**/state/${target.resource}.json.gz`;
  if (kind === "cancel") {
    await page.evaluate(() => {
      globalThis.__b33Leaf = document.querySelector('[data-domformat-node="2"]');
      globalThis.__domformatPagePreparation.pauseIdle = true;
    });
    await page.evaluate((frame) => {
      globalThis.__b33First = globalThis.domformatProof.seekAsync(frame).then(
        (value) => ({ status: "resolved", value }),
        (error) => ({ status: "rejected", code: error?.code ?? error?.name ?? "unknown" }),
      );
    }, target.startFrame);
    await page.waitForFunction(() => globalThis.__domformatPagePreparation.heldIdleCallbacks.length > 0, undefined, { timeout: 120_000 });
    const heldIdleSlices = await page.evaluate(() => globalThis.__domformatPagePreparation.heldIdleCallbacks.length);
    const second = await page.evaluate(async () => {
      const operation = globalThis.domformatProof.seekAsync(1);
      globalThis.__domformatPagePreparation.releaseIdleCallbacks();
      return operation;
    });
    const result = await page.evaluate(async () => ({
      first: await globalThis.__b33First,
      second: globalThis.domformatProof.sourceFrame,
      attribute: document.documentElement.dataset.domformatSourceFrame,
      sameLeaf: document.querySelector('[data-domformat-node="2"]') === globalThis.__b33Leaf,
    }));
    invariant(result.first.status === "rejected" && result.first.code === "OPERATION_ABORTED" && second === 1 && result.second === 1 && result.attribute === "1" && result.sameLeaf, "PAGE_PREPARATION_CANCELLATION", `${fixture.workload.id}/${path.id} cancellation published partial state.`);
    await context.close();
    return Object.freeze({ workload: fixture.workload.id, path: path.id, kind, cancellationPoint: "idle-sliced-materialization", heldIdleSlices, ...result });
  }
  await page.route(routePattern, async (route) => {
    await route.fulfill({
      status: 200,
      body: Buffer.alloc(record.byteLength),
      headers: { "content-length": String(record.byteLength), "content-type": record.mediaType },
    });
  });
  const result = await page.evaluate(async (frame) => {
    try {
      await globalThis.domformatProof.seekAsync(frame);
      return { status: "resolved", attribute: document.documentElement.dataset.domformatSourceFrame };
    } catch (error) {
      return { status: "rejected", code: error?.code ?? error?.name ?? "unknown", attribute: document.documentElement.dataset.domformatSourceFrame };
    }
  }, target.startFrame);
  invariant(result.status === "rejected" && result.code === "RESOURCE_DIGEST_MISMATCH" && result.attribute === "1", "PAGE_PREPARATION_FAILURE", `${fixture.workload.id}/${path.id} corrupt-page failure published partial state.`);
  await context.close();
  return Object.freeze({ workload: fixture.workload.id, path: path.id, kind, ...result });
}

function markdownReport(report) {
  const rows = report.traces.map((trace) => `| ${trace.workload} | ${trace.path} | ${trace.phases.load.maxMs.toFixed(3)} | ${trace.phases.verify.maxMs.toFixed(3)} | ${trace.phases.decode.maxMs.toFixed(3)} | ${trace.phases.materialize.maxMs.toFixed(3)} | ${trace.mainThread.maxTaskMs.toFixed(3)} |`);
  const fixtures = report.fixtures.map((fixture) => `| ${fixture.workload} | ${fixture.leafCount} | ${fixture.framesPerPage} | ${fixture.initialResidentPages} | ${fixture.residentMaterializedBytes} | ${fixture.peakDocumentStateBytes} |`);
  return `# DOMFORMAT source-size page preparation\n\nBrowser: ${report.browserVersion}\n\nRuntime: clean-installed npm tarball\n\nDeclared main-thread task bound: ${report.maximumMainThreadTaskMs} ms\n\n## Fixed workloads\n\n| Workload | Leaves | Frames/page | Initial resident pages | Resident materialized bytes | Accounted peak bytes |\n|---|---:|---:|---:|---:|---:|\n${fixtures.join("\n")}\n\n## Aligned trace phases\n\n| Workload | Viewer | Load max ms | Verify max ms | Decode max ms | Materialize wall max ms | Validation-owned task max ms |\n|---|---|---:|---:|---:|---:|---:|\n${rows.join("\n")}\n\nMaterialization, including its initial parse and canonical check, begins in an idle callback. It is then idle-sliced after an initial 64-operation slice and uses 256-operation slices thereafter. Its wall time includes those yields; the task column measures only renderer tasks containing those validation idle callbacks, while the JSON report also retains the maximum task across the complete observation window as a diagnostic. All phase boundaries have matching CDP user-timing marks and every path reported zero long tasks. Cancellation was forced while a materialization idle slice was held, and corrupt-page digest failure was exercised independently for every workload/viewer pair; none published a target frame or replaced a retained leaf. Raw traces are beside this report in \`traces/\`.\n`;
}

try {
  await mkdir(outputRoot, { recursive: true });
  const fixtures = [];
  for (const workload of workloads) fixtures.push(await writeFixture(workload));
  for (const fixture of fixtures) invariant(fixture.metrics.peakDocumentStateBytes <= 32 * 1024 * 1024, "STATE_PAGE_RESIDENCY_LIMIT", `${fixture.workload.id} accounted page-preparation peak exceeds the clean-browser ceiling.`);

  const npm = process.platform === "win32" ? "npm.cmd" : "npm";
  const packRoot = join(temporary, "pack");
  const installRoot = join(temporary, "install");
  await Promise.all([mkdir(packRoot), mkdir(installRoot)]);
  await execFileAsync(npm, ["run", "build"], { cwd: root, maxBuffer: 32 * 1024 * 1024, timeout: 120_000 });
  const packed = await execFileAsync(npm, ["pack", "--json", "--pack-destination", packRoot], { cwd: root, maxBuffer: 32 * 1024 * 1024, timeout: 120_000 });
  const reportStart = packed.stdout.lastIndexOf("\n[");
  const packReports = JSON.parse(reportStart === -1 ? packed.stdout : packed.stdout.slice(reportStart + 1));
  invariant(packReports.length === 1, "PAGE_PREPARATION_PACKAGE", "npm pack returned an unexpected report.");
  await execFileAsync(npm, ["install", "--prefix", installRoot, "--no-audit", "--no-fund", join(packRoot, packReports[0].filename)], { maxBuffer: 32 * 1024 * 1024, timeout: 120_000 });
  const installedRuntime = join(installRoot, "node_modules", "@layoutit", "polycss-domformat");
  const runtimeRequests = [];
  const explicitFiles = new Map(fixtures.flatMap((fixture) => [...fixture.routes]));
  server = serve(explicitFiles, installedRuntime, runtimeRequests);
  await new Promise((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(0, "127.0.0.1", resolveListen);
  });
  const address = server.address();
  invariant(address && typeof address === "object", "PAGE_PREPARATION_SERVER", "Trace server did not bind.");
  const origin = `http://127.0.0.1:${address.port}`;
  const executablePath = await availableBrowser();
  browser = await chromium.launch({ executablePath, headless: true, args: browserArguments() });
  const traces = [];
  const atomicity = [];
  for (const fixture of fixtures) for (const path of paths) {
    traces.push(await tracePreparation(origin, fixture, path));
    process.stderr.write(`[b33] traced ${fixture.workload.id}/${path.id}\n`);
    atomicity.push(await atomicityProof(origin, fixture, path, "cancel"));
    process.stderr.write(`[b33] cancelled ${fixture.workload.id}/${path.id}\n`);
    atomicity.push(await atomicityProof(origin, fixture, path, "failure"));
    process.stderr.write(`[b33] failed closed ${fixture.workload.id}/${path.id}\n`);
  }
  invariant(runtimeRequests.length > 0 && runtimeRequests.every(({ target }) => target.startsWith(`${join(installedRuntime, "dist")}${sep}`)), "WORKSPACE_RUNTIME_IMPORT", "The page-preparation gate did not confine runtime modules to the clean install.");
  const report = Object.freeze({
    schema: "domformat-page-preparation-trace@1",
    browser: executablePath,
    browserVersion: browser.version(),
    browserRuntime: "clean-installed npm tarball",
    maximumMainThreadTaskMs: MAX_MAIN_THREAD_TASK_MS,
    fixtures: fixtures.map((fixture) => Object.freeze({ workload: fixture.workload.id, leafCount: fixture.workload.leafCount, framesPerPage: fixture.workload.framesPerPage, lookaheadPages: fixture.workload.lookaheadPages, ...fixture.metrics })),
    traces,
    atomicity,
    browserRuntimeModules: [...new Set(runtimeRequests.map(({ pathname }) => pathname))].sort(),
  });
  await writeFile(join(outputRoot, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  await writeFile(join(outputRoot, "report.md"), markdownReport(report));
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} finally {
  try { await browser?.close(); } catch {}
  if (server) await new Promise((resolveClose) => server.close(resolveClose));
  await rm(temporary, { recursive: true, force: true });
}
