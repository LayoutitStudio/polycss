#!/usr/bin/env node
/**
 * Non-voxel drag trace bench.
 *
 * Loads the vanilla non-voxel bench page, drives PolyOrbitControls with real
 * Playwright mouse input, rotates the camera by the requested number of degrees,
 * and writes both a Chrome trace file and a compact JSON summary.
 *
 * Usage:
 *   node .agents/skills/chrome-trace/scripts/polycss-nonvoxel-drag-trace.mjs
 *   node .agents/skills/chrome-trace/scripts/polycss-nonvoxel-drag-trace.mjs --mesh teapot --mode baked --label teapot-drag
 *   node .agents/skills/chrome-trace/scripts/polycss-nonvoxel-drag-trace.mjs --degrees 360 --drag-ms 1500 --steps 120
 *   node .agents/skills/chrome-trace/scripts/polycss-nonvoxel-drag-trace.mjs --variant force-atlas --trace-out bench/results/teapot.trace.json
 *   node .agents/skills/chrome-trace/scripts/polycss-nonvoxel-drag-trace.mjs --frame-details --no-print-json
 */
import { createServer } from "node:http";
import { mkdirSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { chromiumArgsWithGpuDefault } from "../../../../bench/chromium-defaults.mjs";
import { getNonVoxelVariantParams, knownNonVoxelVariantIds } from "../../../../bench/nonvoxel-variants.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const benchDir = resolve(__dirname, "../../../../bench");
const repoRoot = resolve(benchDir, "..");
const galleryDir = resolve(repoRoot, "website/public/gallery");

const argv = process.argv.slice(2);
const flag = (name) => argv.indexOf(`--${name}`);
const optStr = (name, dflt = "") => {
  const i = flag(name);
  if (i >= 0) return argv[i + 1] ?? dflt;
  const prefixed = argv.find((arg) => arg.startsWith(`--${name}=`));
  return prefixed ? prefixed.slice(name.length + 3) : dflt;
};
const optNum = (name, dflt) => {
  const raw = optStr(name);
  if (raw.trim() === "") return dflt;
  const value = Number(raw);
  return Number.isFinite(value) ? value : dflt;
};
const optFlagValue = (name, dflt = "") => {
  const i = flag(name);
  if (i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--")) return argv[i + 1];
  const prefixed = argv.find((arg) => arg.startsWith(`--${name}=`));
  return prefixed ? prefixed.slice(name.length + 3) : dflt;
};
const optAll = (name) => {
  const values = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === `--${name}` && argv[i + 1]) {
      values.push(argv[i + 1]);
      i += 1;
    } else if (arg.startsWith(`--${name}=`)) {
      values.push(arg.slice(name.length + 3));
    }
  }
  return values;
};
const hasFlag = (name) => flag(name) >= 0 || argv.includes(`--${name}=true`);

const PIXELS_PER_DEGREE = 4;
const MESH = optStr("mesh", "teapot");
const MODE = optStr("mode", "baked");
const VARIANT = optStr("variant", "baseline");
const DEGREES = optNum("degrees", 360);
const WARMUP_MS = optNum("warmup", 1000);
const DRAG_MS = optNum("drag-ms", 1500);
const SETTLE_MS = optNum("settle", 250);
const STEPS = Math.max(1, Math.round(optNum("steps", 120)));
const VIEWPORT_WIDTH = Math.max(320, Math.round(optNum("viewport-width", 1280)));
const VIEWPORT_HEIGHT = Math.max(240, Math.round(optNum("viewport-height", 800)));
const LABEL = optStr("label");
const JSON_PATH = optStr("json") || optStr("summary-out");
const TRACE_PATH = optStr("trace-out");
const FRAME_DETAILS = hasFlag("frame-details");
const FRAME_DETAILS_LIMIT = Math.max(0, Math.round(optNum("frame-details-limit", 24)));
const PRINT_JSON = !hasFlag("no-print-json");
const TRACE = !hasFlag("no-trace");
const GPU_DETAILS_MODE = resolveGpuDetailsMode();
const GPU_DETAILS = GPU_DETAILS_MODE !== "off";
const HEADED = hasFlag("headed");
const BROWSER_EXECUTABLE = optStr("browser-executable");
const SOFTWARE_BACKEND = hasFlag("software-backend");
const CHROMIUM_ARGS = chromiumArgsWithGpuDefault([
  ...optAll("chromium-arg"),
  ...optAll("chromium-args").flatMap((value) => value.split(/\s+/).filter(Boolean)),
], { softwareBackend: SOFTWARE_BACKEND });

function resolveGpuDetailsMode() {
  const raw = (optFlagValue("gpu-details") || optFlagValue("gpu-viz-details")).toLowerCase();
  if (raw === "off" || raw === "false" || raw === "no" || raw === "0") return "off";
  if (hasFlag("deep-gpu") || raw === "full" || raw === "deep" || raw === "heavy") return "full";
  if (hasFlag("gpu-details") || hasFlag("gpu-viz-details") || raw === "light" || raw === "summary") return "light";
  return "off";
}

if (MODE !== "baked" && MODE !== "dynamic") {
  throw new Error(`--mode must be baked or dynamic; got "${MODE}"`);
}
if (!Number.isFinite(DEGREES) || DEGREES === 0) {
  throw new Error("--degrees must be a non-zero number");
}

const VARIANT_PARAMS = getNonVoxelVariantParams(VARIANT);
if (!VARIANT_PARAMS) {
  throw new Error(`Unknown --variant "${VARIANT}". Known: ${knownNonVoxelVariantIds().join(", ")}`);
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".obj": "text/plain; charset=utf-8",
  ".mtl": "text/plain; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gltf": "application/json; charset=utf-8",
  ".glb": "model/gltf-binary",
  ".vox": "application/octet-stream",
};

const BASE_TRACE_CATEGORIES = [
  "devtools.timeline",
  "disabled-by-default-devtools.timeline",
  "benchmark",
  "blink",
  "blink.console",
  "blink.user_timing",
  "cc",
  "gpu",
  "viz",
  "v8.console",
  "renderer.scheduler",
];

const GPU_DETAIL_TRACE_CATEGORIES = [
  "disabled-by-default-viz.gpu_composite_time",
];

const DEEP_GPU_TRACE_CATEGORIES = [
  ...GPU_DETAIL_TRACE_CATEGORIES,
  "disabled-by-default-devtools.timeline.picture",
  "disabled-by-default-cc.debug",
  "disabled-by-default-cc.debug.display_items",
  "disabled-by-default-cc.debug.picture",
  "disabled-by-default-gpu.debug",
  "disabled-by-default-skia",
  "disabled-by-default-skia.gpu",
  "disabled-by-default-skia.gpu.cache",
  "disabled-by-default-viz.debug.overlay_planes",
  "disabled-by-default-viz.overdraw",
  "disabled-by-default-viz.quads",
  "disabled-by-default-viz.triangles",
];

const TRACE_CATEGORIES = [
  ...BASE_TRACE_CATEGORIES,
  ...(GPU_DETAILS_MODE === "light" ? GPU_DETAIL_TRACE_CATEGORIES : []),
  ...(GPU_DETAILS_MODE === "full" ? DEEP_GPU_TRACE_CATEGORIES : []),
].join(",");

const EVENT_GROUPS = {
  style: ["UpdateLayoutTree", "RecalculateStyles"],
  layout: ["Layout"],
  prePaint: ["PrePaint"],
  paint: ["Paint"],
  raster: ["RasterTask", "ImageDecodeTask", "Decode Image"],
  script: ["FunctionCall", "EvaluateScript", "EventDispatch", "TimerFire", "FireAnimationFrame"],
  compositorMain: [
    "ProxyMain::BeginMainFrame",
    "WebFrameWidgetImpl::UpdateLifecycle",
    "PaintArtifactCompositor::Update",
    "Layerize",
    "Commit",
    "ProxyImpl::ReadyToCommit",
  ],
  compositorImpl: [
    "LayerTreeImpl::UpdateDrawProperties",
    "LayerTreeImpl::UpdateDrawProperties::CalculateDrawProperties",
    "draw_property_utils::ComputeDrawPropertiesOfVisibleLayers",
    "LayerTreeHostImpl::PrepareToDraw",
    "MainFrame.Draw",
    "SubmitCompositorFrame",
  ],
  gpuViz: [
    "Graphics.Pipeline",
    "DisplayScheduler::OnBeginFrameDeadline",
    "DisplayScheduler::DrawAndSwap",
    "Display::DrawAndSwap",
    "DirectRenderer::DrawFrame",
    "DirectRenderer::DrawRenderPass",
    "SoftwareRenderer::DoDrawQuad",
    "SkiaOutputSurfaceImplOnGpu::SwapBuffers",
  ],
};

const EVENT_GROUP_PATTERNS = {
  gpuVizRenderPass: [
    /RenderPass/i,
    /CalculateRenderPass/i,
    /DrawFrame/i,
    /DrawAndSwap/i,
  ],
  gpuVizQuads: [
    /Quad/i,
    /AppendQuads/i,
  ],
  gpuVizTiles: [
    /Tile/i,
    /RasterTask/i,
    /RasterBuffer/i,
    /RasterSource/i,
    /PlaybackToMemory/i,
  ],
  gpuVizSkia: [
    /Skia/i,
    /GrContext/i,
    /Graphite/i,
  ],
  gpuVizGpuService: [
    /SwapBuffers/i,
    /CommandBuffer/i,
    /SharedImage/i,
    /Gpu/i,
    /Metal/i,
  ],
};

const EXACT_EVENT_GROUPS = new Map();
for (const [group, names] of Object.entries(EVENT_GROUPS)) {
  for (const name of names) {
    const groups = EXACT_EVENT_GROUPS.get(name) ?? [];
    groups.push(group);
    EXACT_EVENT_GROUPS.set(name, groups);
  }
}

function allGroupNames() {
  return [...Object.keys(EVENT_GROUPS), ...Object.keys(EVENT_GROUP_PATTERNS)];
}

const KEY_EVENTS = [
  "EventDispatch",
  "FunctionCall",
  "FireAnimationFrame",
  "UpdateLayoutTree",
  "Layout",
  "PrePaint",
  "Paint",
  "PaintArtifactCompositor::Update",
  "Layerize",
  "Commit",
  "ProxyMain::BeginMainFrame",
  "LayerTreeImpl::UpdateDrawProperties",
  "LayerTreeImpl::UpdateDrawProperties::CalculateDrawProperties",
  "draw_property_utils::ComputeDrawPropertiesOfVisibleLayers",
  "LayerTreeHostImpl::PrepareToDraw",
  "MainFrame.Draw",
  "SubmitCompositorFrame",
  "RasterTask",
  "Graphics.Pipeline",
  "DisplayScheduler::OnBeginFrameDeadline",
  "DisplayScheduler::DrawAndSwap",
  "Display::DrawAndSwap",
  "DirectRenderer::DrawFrame",
  "DirectRenderer::DrawRenderPass",
  "SoftwareRenderer::DoDrawQuad",
  "SkiaRenderer::DoDrawQuad",
  "GLRenderer::DoDrawQuad",
  "SkiaOutputSurfaceImplOnGpu::SwapBuffers",
  "LayerTreeHostImpl::CalculateRenderPasses",
  "PictureLayerImpl::AppendQuads",
  "TileManager::PrepareTiles",
  "TileManager::AssignGpuMemoryToTiles",
  "TileTaskManagerImpl::ScheduleTasks",
  "RasterTaskImpl::RunOnWorkerThread",
  "RasterBufferProvider::PlaybackToMemory",
];

function startServer() {
  return new Promise((resolveStart, rejectStart) => {
    const server = createServer(async (req, res) => {
      try {
        const u = new URL(req.url, "http://localhost");
        const safe = u.pathname.replace(/\/+/g, "/");
        if (safe.includes("..")) {
          res.writeHead(403);
          res.end("forbidden");
          return;
        }
        const abs = safe.startsWith("/gallery/")
          ? resolve(galleryDir, safe.slice("/gallery/".length))
          : resolve(benchDir, safe === "/" ? "nonvoxel-vanilla.html" : safe.slice(1));
        const data = await readFile(abs);
        res.writeHead(200, {
          "Content-Type": MIME[extname(abs).toLowerCase()] || "application/octet-stream",
          "Cache-Control": "no-store",
        });
        res.end(data);
      } catch (error) {
        res.writeHead(404);
        res.end(String(error?.message ?? error));
      }
    });
    server.on("error", rejectStart);
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      resolveStart({ server, port: typeof addr === "object" ? addr.port : 0 });
    });
  });
}

function stopServer(server) {
  return new Promise((resolveStop) => server.close(resolveStop));
}

function safeLabel(value) {
  return value.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase() || "run";
}

function outputPaths() {
  const label = LABEL || `nonvoxel-drag-${safeLabel(MESH)}-${MODE}-${safeLabel(VARIANT)}`;
  return {
    label,
    json: resolve(repoRoot, JSON_PATH || `bench/results/${label}.json`),
    trace: resolve(repoRoot, TRACE_PATH || `bench/results/${label}.trace.json`),
  };
}

function urlFor(port) {
  const params = new URLSearchParams({
    mesh: MESH,
    mode: MODE,
    motion: "drag",
    ...(FRAME_DETAILS ? { frameWork: "1" } : {}),
    ...VARIANT_PARAMS,
  });
  return `http://127.0.0.1:${port}/nonvoxel-vanilla.html?${params.toString()}`;
}

function quantile(sorted, q) {
  if (sorted.length === 0) return 0;
  const i = (sorted.length - 1) * q;
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
}

function summarizeFrameTimes(samples) {
  const rawDts = samples.map((sample) => sample.dt).filter((dt) => Number.isFinite(dt) && dt > 0);
  const dts = rawDts.filter((dt) => dt < 2000).sort((a, b) => a - b);
  const p50 = quantile(dts, 0.5);
  const p95 = quantile(dts, 0.95);
  const p99 = quantile(dts, 0.99);
  const duration = samples.length >= 2
    ? samples[samples.length - 1].t - samples[0].t
    : 0;
  return {
    fps_p50: p50 > 0 ? +(1000 / p50).toFixed(2) : 0,
    fps_p95: p95 > 0 ? +(1000 / p95).toFixed(2) : 0,
    frame_time_p50_ms: +p50.toFixed(3),
    frame_time_p95_ms: +p95.toFixed(3),
    frame_time_p99_ms: +p99.toFixed(3),
    sample_count: dts.length,
    sample_count_raw: rawDts.length,
    sample_count_filtered: rawDts.length - dts.length,
    sample_duration_ms: +duration.toFixed(3),
  };
}

function findTraceMark(events, name) {
  return events.find((event) => event?.name === name && Number.isFinite(event?.args?.data?.startTime)) ??
    events.find((event) => event?.name === "TimeStamp" && event?.args?.data?.message === name);
}

function makeFrameWindows(samples, startPerfNow, endPerfNow) {
  return samples
    .filter((sample) => Number.isFinite(sample?.dt) && sample.dt > 0 && sample.dt < 2000)
    .filter((sample) => sample.t - sample.dt >= startPerfNow && sample.t <= endPerfNow)
    .map((sample, index) => ({
      index,
      start: sample.t - sample.dt,
      end: sample.t,
      dt: sample.dt,
    }));
}

function frameIndexAt(frames, perfNow) {
  let lo = 0;
  let hi = frames.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const frame = frames[mid];
    if (perfNow < frame.start) hi = mid - 1;
    else if (perfNow > frame.end) lo = mid + 1;
    else return mid;
  }
  return -1;
}

function addDuration(map, name, durationMs) {
  const entry = map.get(name) ?? { count: 0, duration_ms: 0 };
  entry.count += 1;
  entry.duration_ms += durationMs;
  map.set(name, entry);
}

function eventGroups(eventName) {
  const out = new Set(EXACT_EVENT_GROUPS.get(eventName) ?? []);
  for (const [group, patterns] of Object.entries(EVENT_GROUP_PATTERNS)) {
    if (patterns.some((pattern) => pattern.test(eventName))) out.add(group);
  }
  return [...out];
}

function addEventGroups(map, eventName, durationMs) {
  for (const group of eventGroups(eventName)) {
    addDuration(map, group, durationMs);
  }
}

function addAggregate(map, name, count, durationMs) {
  const entry = map.get(name) ?? { count: 0, duration_ms: 0 };
  entry.count += count;
  entry.duration_ms += durationMs;
  map.set(name, entry);
}

function frameWorkForFrame(frameWorkSamples, frame, startIndex) {
  if (!Array.isArray(frameWorkSamples) || frameWorkSamples.length === 0) {
    return { sample: null, nextIndex: startIndex };
  }

  let index = Math.max(0, startIndex);
  while (index + 1 < frameWorkSamples.length && frameWorkSamples[index + 1].t <= frame.end + 1) {
    index += 1;
  }
  const sample = frameWorkSamples[index];
  if (sample && sample.t >= frame.start - 1 && sample.t <= frame.end + 1) {
    return { sample, nextIndex: index };
  }
  return { sample: null, nextIndex: index };
}

function serializePageOps(ops) {
  const out = {};
  if (!ops || typeof ops !== "object") return out;
  for (const [name, entry] of Object.entries(ops)) {
    out[name] = {
      count: entry.count ?? 0,
      duration_ms: +((entry.duration_ms ?? 0)).toFixed(4),
    };
  }
  return out;
}

function summarizeFrameDetails(events, samples, frameWorkSamples, startPerfNow, endPerfNow) {
  if (!FRAME_DETAILS || FRAME_DETAILS_LIMIT === 0) return null;
  const startMark = findTraceMark(events, "polycss-drag-trace-start");
  const endMark = findTraceMark(events, "polycss-drag-trace-end");
  if (!startMark?.args?.data?.startTime || !endMark?.args?.data?.startTime) {
    return {
      error: "Trace markers were not captured; frame details cannot be aligned.",
    };
  }

  const tracePerfOffsetMs = (startMark.ts / 1000) - startMark.args.data.startTime;
  const alignedStartPerfNow = startMark.args.data.startTime || startPerfNow;
  const alignedEndPerfNow = endMark.args.data.startTime || endPerfNow;
  const frames = makeFrameWindows(samples, alignedStartPerfNow, alignedEndPerfNow);
  const frameTotals = frames.map((frame) => ({
    ...frame,
    groups: new Map(),
    events: new Map(),
    completeEventMs: 0,
    pageOps: {},
  }));

  let frameWorkIndex = 0;
  for (const frame of frameTotals) {
    const result = frameWorkForFrame(frameWorkSamples, frame, frameWorkIndex);
    frameWorkIndex = result.nextIndex;
    frame.pageOps = serializePageOps(result.sample?.ops);
  }

  for (const event of events) {
    if (event?.ph !== "X" || typeof event.dur !== "number" || !Number.isFinite(event.ts)) continue;
    const durationMs = event.dur / 1000;
    const midpointPerfNow = ((event.ts + event.dur / 2) / 1000) - tracePerfOffsetMs;
    const index = frameIndexAt(frameTotals, midpointPerfNow);
    if (index < 0) continue;
    const frame = frameTotals[index];
    frame.completeEventMs += durationMs;
    addDuration(frame.events, event.name, durationMs);
    addEventGroups(frame.groups, event.name, durationMs);
  }

  const serializeMap = (map, keys) => {
    const out = {};
    for (const key of keys) out[key] = +((map.get(key)?.duration_ms ?? 0)).toFixed(4);
    return out;
  };
  const serializeGroups = (map) => serializeMap(map, allGroupNames());
  const serializeKeyEvents = (map) => serializeMap(map, KEY_EVENTS);
  const topEvents = (map) => [...map.entries()]
    .map(([event, total]) => ({
      event,
      count: total.count,
      duration_ms: +total.duration_ms.toFixed(4),
    }))
    .sort((a, b) => b.duration_ms - a.duration_ms)
    .slice(0, 12);
  const topPageOps = (map) => [...map.entries()]
    .map(([operation, total]) => ({
      operation,
      count: total.count,
      duration_ms: +total.duration_ms.toFixed(4),
    }))
    .sort((a, b) => b.duration_ms - a.duration_ms)
    .slice(0, 12);

  const serializeFrame = (frame) => ({
    index: frame.index,
    start_ms: +frame.start.toFixed(3),
    end_ms: +frame.end.toFixed(3),
    dt_ms: +frame.dt.toFixed(3),
    complete_event_ms: +frame.completeEventMs.toFixed(3),
    page_ops: frame.pageOps,
    groups_ms: serializeGroups(frame.groups),
    key_events_ms: serializeKeyEvents(frame.events),
    topEvents: topEvents(frame.events),
  });

  const framesOut = frameTotals
    .slice()
    .sort((a, b) => b.dt - a.dt)
    .slice(0, FRAME_DETAILS_LIMIT)
    .map(serializeFrame)
    .sort((a, b) => a.index - b.index);
  const rotationFrames = frameTotals
    .filter((frame) =>
      frame.pageOps["input.pointermove"] ||
      frame.pageOps["controls.change"] ||
      frame.pageOps["camera.update"] ||
      frame.pageOps["scene.applyCamera"])
    .slice(0, FRAME_DETAILS_LIMIT)
    .map(serializeFrame);

  const totals = new Map();
  const pageTotals = new Map();
  for (const frame of frameTotals) {
    for (const [event, total] of frame.events) addAggregate(totals, event, total.count, total.duration_ms);
    for (const [operation, total] of Object.entries(frame.pageOps)) {
      addAggregate(pageTotals, operation, total.count ?? 0, total.duration_ms ?? 0);
    }
  }

  return {
    tracePerfOffsetMs: +tracePerfOffsetMs.toFixed(3),
    frameCount: frameTotals.length,
    includedFrames: framesOut.length,
    slowestFrames: framesOut,
    rotationFrames,
    topPageOps: topPageOps(pageTotals),
    topEvents: topEvents(totals),
  };
}

function summarizeTraceEvents(events) {
  const byName = new Map();
  let completeEventCount = 0;
  let totalDurationUs = 0;
  for (const event of events) {
    if (event?.ph !== "X" || typeof event.dur !== "number") continue;
    completeEventCount += 1;
    totalDurationUs += event.dur;
    const prev = byName.get(event.name) ?? { count: 0, durationUs: 0 };
    prev.count += 1;
    prev.durationUs += event.dur;
    byName.set(event.name, prev);
  }

  const groupTotals = new Map();
  for (const [eventName, entry] of byName.entries()) {
    for (const groupName of eventGroups(eventName)) {
      const total = groupTotals.get(groupName) ?? { count: 0, durationUs: 0 };
      total.count += entry.count;
      total.durationUs += entry.durationUs;
      groupTotals.set(groupName, total);
    }
  }

  const groups = Object.fromEntries(allGroupNames().map((name) => {
    const total = groupTotals.get(name);
    return [name, {
      count: total?.count ?? 0,
      duration_ms: +((total?.durationUs ?? 0) / 1000).toFixed(3),
    }];
  }));

  const topEvents = [...byName.entries()]
    .sort((a, b) => b[1].durationUs - a[1].durationUs)
    .slice(0, 20)
    .map(([name, entry]) => ({
      name,
      count: entry.count,
      duration_ms: +(entry.durationUs / 1000).toFixed(3),
    }));

  return {
    eventCount: events.length,
    completeEventCount,
    totalCompleteDurationMs: +(totalDurationUs / 1000).toFixed(3),
    groups,
    topEvents,
  };
}

function metricMap(metrics) {
  const out = new Map();
  for (const metric of metrics?.metrics ?? []) out.set(metric.name, metric.value);
  return out;
}

function diffPerformanceMetrics(before, after) {
  const a = metricMap(before);
  const b = metricMap(after);
  const keys = [
    "Timestamp",
    "Documents",
    "Frames",
    "JSEventListeners",
    "Nodes",
    "LayoutCount",
    "RecalcStyleCount",
    "LayoutDuration",
    "RecalcStyleDuration",
    "ScriptDuration",
    "TaskDuration",
    "JSHeapUsedSize",
    "JSHeapTotalSize",
  ];
  const out = {};
  for (const key of keys) {
    const beforeValue = a.get(key);
    const afterValue = b.get(key);
    if (beforeValue === undefined || afterValue === undefined) continue;
    const value = key === "Timestamp" || key === "Documents" || key === "Frames" ||
      key === "JSEventListeners" || key === "Nodes" ||
      key === "JSHeapUsedSize" || key === "JSHeapTotalSize"
      ? afterValue
      : afterValue - beforeValue;
    out[key] = Number(value.toFixed(key.endsWith("Duration") ? 6 : 3));
  }
  return out;
}

function buildGesturePlan(hostBox) {
  const margin = Math.max(24, Math.min(96, hostBox.width * 0.15));
  const left = hostBox.x + margin;
  const right = hostBox.x + hostBox.width - margin;
  const y = hostBox.y + hostBox.height / 2;
  const usable = Math.max(1, right - left);
  const totalDx = -DEGREES * PIXELS_PER_DEGREE;
  const direction = Math.sign(totalDx);
  let remaining = Math.abs(totalDx);
  const gestures = [];

  while (remaining > 0) {
    const distance = Math.min(remaining, usable);
    gestures.push(direction < 0
      ? { startX: right, endX: right - distance, y, pixels: distance }
      : { startX: left, endX: left + distance, y, pixels: distance });
    remaining -= distance;
  }

  let remainingSteps = STEPS;
  const totalPixels = gestures.reduce((sum, gesture) => sum + gesture.pixels, 0);
  gestures.forEach((gesture, index) => {
    if (index === gestures.length - 1) {
      gesture.steps = Math.max(1, remainingSteps);
    } else {
      gesture.steps = Math.max(1, Math.round(STEPS * (gesture.pixels / totalPixels)));
      remainingSteps = Math.max(1, remainingSteps - gesture.steps);
    }
  });

  return {
    pixelsPerDegree: PIXELS_PER_DEGREE,
    requestedDegrees: DEGREES,
    expectedRotYDelta: -totalDx / PIXELS_PER_DEGREE,
    totalDx,
    totalPixels,
    durationMs: DRAG_MS,
    stepCount: gestures.reduce((sum, gesture) => sum + gesture.steps, 0),
    gestures,
  };
}

async function startTrace(cdp) {
  const events = [];
  cdp.on("Tracing.dataCollected", (payload) => {
    if (Array.isArray(payload.value)) events.push(...payload.value);
  });
  await cdp.send("Performance.enable");
  await cdp.send("Tracing.start", {
    transferMode: "ReportEvents",
    categories: TRACE_CATEGORIES,
  });
  return events;
}

async function stopTrace(cdp, events) {
  const done = new Promise((resolveDone) => {
    cdp.once("Tracing.tracingComplete", resolveDone);
  });
  await cdp.send("Tracing.end");
  await done;
  return events;
}

async function performDrag(page, plan) {
  const delayMs = plan.durationMs / Math.max(1, plan.stepCount);
  const first = plan.gestures[0];
  await page.mouse.move(first.startX, first.y);

  for (let gestureIndex = 0; gestureIndex < plan.gestures.length; gestureIndex += 1) {
    const gesture = plan.gestures[gestureIndex];
    if (gestureIndex > 0) await page.mouse.move(gesture.startX, gesture.y);
    await page.mouse.down();
    for (let step = 1; step <= gesture.steps; step += 1) {
      const t = step / gesture.steps;
      const x = gesture.startX + (gesture.endX - gesture.startX) * t;
      await page.mouse.move(x, gesture.y);
      if (delayMs > 0) await page.waitForTimeout(delayMs);
    }
    await page.mouse.up();
    if (gestureIndex + 1 < plan.gestures.length) await page.waitForTimeout(40);
  }
}

async function run() {
  const paths = outputPaths();
  const { server, port } = await startServer();
  console.log(`[drag-trace] server :${port}`);
  console.log(`[drag-trace] mesh=${MESH} mode=${MODE} variant=${VARIANT} degrees=${DEGREES} warmup=${WARMUP_MS}ms drag=${DRAG_MS}ms settle=${SETTLE_MS}ms gpuDetails=${GPU_DETAILS_MODE}`);
  if (BROWSER_EXECUTABLE) console.log(`[drag-trace] browser=${BROWSER_EXECUTABLE}`);
  if (SOFTWARE_BACKEND) console.log("[drag-trace] software backend=on");
  if (CHROMIUM_ARGS.length > 0) console.log(`[drag-trace] chromium args=${CHROMIUM_ARGS.join(" ")}`);

  const launchOptions = { headless: !HEADED, args: CHROMIUM_ARGS };
  if (BROWSER_EXECUTABLE) launchOptions.executablePath = BROWSER_EXECUTABLE;
  let browser = null;

  try {
    browser = await chromium.launch(launchOptions);
    const ctx = await browser.newContext({ viewport: { width: VIEWPORT_WIDTH, height: VIEWPORT_HEIGHT } });
    const page = await ctx.newPage();
    page.on("console", (message) => {
      if (message.type() === "error" || message.type() === "warning") {
        console.log(`[drag-trace:page:${message.type()}] ${message.text()}`);
      }
    });
    page.on("pageerror", (error) => {
      console.log(`[drag-trace:page:error] ${error?.stack || error?.message || error}`);
    });
    const targetUrl = urlFor(port);
    await page.goto(targetUrl, { waitUntil: "load" });
    await page.waitForFunction(() =>
      window.__perf__?.ready === true && window.__nonvoxelBench?.ready === true,
    null, { timeout: 30000 });
    await page.waitForTimeout(WARMUP_MS);

    const hostBox = await page.locator("#host").boundingBox();
    if (!hostBox) throw new Error("Could not locate #host for drag input");
    const dragPlan = buildGesturePlan(hostBox);
    const cdp = await ctx.newCDPSession(page);
    const traceEvents = TRACE ? await startTrace(cdp) : [];
    const metricsBefore = await cdp.send("Performance.getMetrics");

    const startInfo = await page.evaluate((traceEnabled) => {
      window.__nonvoxelBench.resetInteractionStats();
      if (traceEnabled) {
        performance.mark("polycss-drag-trace-start");
        console.timeStamp("polycss-drag-trace-start");
      }
      return {
        sampleIndex: window.__perf__.samples.length,
        perfNow: performance.now(),
        camera: window.__nonvoxelBench.cameraState(),
      };
    }, TRACE);

    await performDrag(page, dragPlan);
    await page.waitForTimeout(SETTLE_MS);

    const endInfo = await page.evaluate(({ from, traceEnabled }) => {
      if (traceEnabled) {
        performance.mark("polycss-drag-trace-end");
        console.timeStamp("polycss-drag-trace-end");
      }
      return {
        perfNow: performance.now(),
        camera: window.__nonvoxelBench.cameraState(),
        interaction: window.__nonvoxelBench.interactionStats(),
        frameWorkSamples: window.__nonvoxelBench.frameWorkSamples(),
        samples: window.__perf__.samples.slice(from),
        polyCount: window.__perf__.polyCount,
        renderStats: window.__perf__.renderStats ?? null,
      };
    }, { from: startInfo.sampleIndex, traceEnabled: TRACE });
    const metricsAfter = await cdp.send("Performance.getMetrics");
    const events = TRACE ? await stopTrace(cdp, traceEvents) : [];
    await ctx.close();

    const traceSummary = summarizeTraceEvents(events);
    const frameDetails = summarizeFrameDetails(
      events,
      endInfo.samples,
      endInfo.frameWorkSamples,
      startInfo.perfNow,
      endInfo.perfNow,
    );
    const result = {
      kind: "nonvoxel-drag-trace",
      mesh: MESH,
      mode: MODE,
      variant: VARIANT,
      url: targetUrl,
      viewport: { width: VIEWPORT_WIDTH, height: VIEWPORT_HEIGHT },
      warmup_ms: WARMUP_MS,
      settle_ms: SETTLE_MS,
      browserExecutable: BROWSER_EXECUTABLE || null,
      chromiumArgs: CHROMIUM_ARGS,
      softwareBackend: SOFTWARE_BACKEND,
      gpuDetails: GPU_DETAILS_MODE,
      drag: {
        ...dragPlan,
        gestures: dragPlan.gestures.map((gesture) => ({
          startX: +gesture.startX.toFixed(3),
          endX: +gesture.endX.toFixed(3),
          y: +gesture.y.toFixed(3),
          pixels: +gesture.pixels.toFixed(3),
          steps: gesture.steps,
        })),
      },
      camera: {
        start: startInfo.camera,
        end: endInfo.camera,
        cumulativeRotY: +endInfo.interaction.cumulativeRotY.toFixed(3),
        requestedRotYDelta: +dragPlan.expectedRotYDelta.toFixed(3),
        rotYError: +(endInfo.interaction.cumulativeRotY - dragPlan.expectedRotYDelta).toFixed(3),
        interaction: endInfo.interaction,
      },
      frames: summarizeFrameTimes(endInfo.samples),
      polyCount: endInfo.polyCount,
      renderStats: endInfo.renderStats,
      trace: traceSummary,
      frameDetails,
      performanceMetrics: diffPerformanceMetrics(metricsBefore, metricsAfter),
      outputFiles: {
        json: paths.json,
        trace: paths.trace,
      },
    };

    if (TRACE) {
      const tracePayload = {
        traceEvents: events,
        displayTimeUnit: "ms",
        metadata: {
          source: ".agents/skills/chrome-trace/scripts/polycss-nonvoxel-drag-trace.mjs",
          mesh: MESH,
          mode: MODE,
          variant: VARIANT,
          requestedDegrees: DEGREES,
          dragMs: DRAG_MS,
          steps: STEPS,
          gpuDetails: GPU_DETAILS_MODE,
        },
      };
      mkdirSync(dirname(paths.trace), { recursive: true });
      writeFileSync(paths.trace, JSON.stringify(tracePayload));
      console.log(`[drag-trace] wrote ${paths.trace}`);
    }
    mkdirSync(dirname(paths.json), { recursive: true });
    writeFileSync(paths.json, `${JSON.stringify(result, null, 2)}\n`);

    console.log(`[drag-trace] wrote ${paths.json}`);
    console.log(
      `[drag-trace] p50=${result.frames.fps_p50.toFixed(1)}fps p95=${result.frames.fps_p95.toFixed(1)}fps ` +
      `p99=${result.frames.frame_time_p99_ms.toFixed(1)}ms rotY=${result.camera.cumulativeRotY.toFixed(1)}deg ` +
      `err=${result.camera.rotYError.toFixed(2)}deg`,
    );
    if (PRINT_JSON) console.log(JSON.stringify(result, null, 2));
  } finally {
    if (browser) await browser.close();
    await stopServer(server);
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
