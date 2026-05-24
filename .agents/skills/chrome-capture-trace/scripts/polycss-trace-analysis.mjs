#!/usr/bin/env node
/**
 * Chrome trace analysis for polycss camera-motion runs.
 *
 * Captures a perf or non-voxel bench page, aligns trace events to rAF frame
 * samples, and reports compositor/style/raster/script cost per cadence bucket.
 *
 * Usage:
 *   node .agents/skills/chrome-capture-trace/scripts/polycss-trace-analysis.mjs
 *   node .agents/skills/chrome-capture-trace/scripts/polycss-trace-analysis.mjs --mesh ancient-crash-site --runs 3 --dom-samples
 *   node .agents/skills/chrome-capture-trace/scripts/polycss-trace-analysis.mjs --mesh obj-house3 --renderer vanilla --label obj-house3-trace
 *   node .agents/skills/chrome-capture-trace/scripts/polycss-trace-analysis.mjs --page nonvoxel --mesh glb:Elephant.glb --variant order-tile4 --no-trace
 *   node .agents/skills/chrome-capture-trace/scripts/polycss-trace-analysis.mjs --page nonvoxel --mesh teapot --frame-details --layer-details
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
  return i >= 0 ? argv[i + 1] : dflt;
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
const optNum = (name, dflt) => {
  const v = optStr(name);
  return v ? Number(v) : dflt;
};
const optFlagValue = (name, dflt = "") => {
  const i = flag(name);
  if (i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--")) return argv[i + 1];
  const prefixed = argv.find((arg) => arg.startsWith(`--${name}=`));
  return prefixed ? prefixed.slice(name.length + 3) : dflt;
};
const hasFlag = (name) => flag(name) >= 0;

const HELP = argv.includes("--help") || argv.includes("-h");
const PAGE = optStr("page", "perf");
const MESH = optStr("mesh", PAGE === "nonvoxel" ? "glb:Elephant.glb" : "garden");
const MODE = optStr("mode", "baked");
const MOTION = optStr("motion", "rot");
const RENDERER = optStr("renderer", "vanilla");
const VARIANT = optStr("variant", "baseline");
const WARMUP_MS = optNum("warmup", 1500);
const SAMPLE_MS = optNum("sample", 6000);
const RUNS = optNum("runs", 1);
const LABEL = optStr("label");
const SUMMARY_PATH = optStr("summary-out");
const TRACE_PATH = optStr("trace-out");
const HEADED = hasFlag("headed");
const JSON_ONLY = hasFlag("json");
const TRACE = !hasFlag("no-trace");
const DOM_SAMPLES = hasFlag("dom-samples");
const FRAME_DETAILS = hasFlag("frame-details");
const FRAME_DETAILS_LIMIT = Math.max(0, Math.round(optNum("frame-details-limit", 24)));
const LAYER_DETAILS = hasFlag("layer-details") || hasFlag("layers");
const LAYER_DETAILS_LIMIT = Math.max(0, Math.round(optNum("layer-details-limit", 80)));
const GPU_DETAILS_MODE = resolveGpuDetailsMode();
const GPU_DETAILS = GPU_DETAILS_MODE !== "off";
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
  "FireAnimationFrame",
  "FunctionCall",
  "UpdateLayoutTree",
  "PrePaint",
  "PaintArtifactCompositor::Update",
  "Layerize",
  "LayerTreeImpl::UpdateDrawProperties",
  "LayerTreeImpl::UpdateDrawProperties::CalculateDrawProperties",
  "draw_property_utils::ComputeDrawPropertiesOfVisibleLayers",
  "LayerTreeHostImpl::PrepareToDraw",
  "MainFrame.Draw",
  "SubmitCompositorFrame",
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
  "RunTask",
  "RasterTask",
];

function printHelp() {
  console.log(`Usage: node .agents/skills/chrome-capture-trace/scripts/polycss-trace-analysis.mjs [options]

Options:
  --page <name>               perf | nonvoxel. Default: perf
  --mesh <id>                 Mesh id or path accepted by the selected page.
  --renderer <name>           html | vanilla | react | vue. Default: vanilla
  --variant <name>            Non-voxel page variant. Default: baseline
  --mode <name>               baked | dynamic. Default: baked
  --motion <name>             rot | light | none. Default: rot
  --runs <n>                  Repeat count. Default: 1
  --warmup <ms>               Warmup window. Default: 1500
  --sample <ms>               Trace sample window. Default: 6000
  --label <name>              Write bench/results/<name>.json
  --summary-out <file>        Write summary JSON to an explicit file
  --trace-out <file>          Write raw Chrome trace JSON. For --runs > 1, adds .rN before .json
  --no-trace                  Collect rAF bucket stats without Chrome tracing
  --dom-samples               Sample mounted leaf/tag counts by rAF frame
  --frame-details             Include slowest/fastest frame event and page-work details
  --frame-details-limit <n>   Frames to include per details section. Default: 24
  --layer-details             Include CDP LayerTree summary and compositing reasons
  --layer-details-limit <n>   Layers to inspect for reasons. Default: 80
  --gpu-details [light|full]  Include GPU/viz detail categories. Default when present: light
  --deep-gpu                  Alias for --gpu-details full; much larger and timing-intrusive
  --headed                    Run headed Chromium
  --browser-executable <path> Use a specific Chromium/Chrome executable
  --software-backend          Force the old software/stress backend
  --chromium-arg <arg>        Extra Chromium arg, repeatable
  --json                      Print only JSON
`);
}

function startServer() {
  return new Promise((resolveStart, rejectStart) => {
    const server = createServer(async (req, res) => {
      try {
        const u = new URL(req.url, "http://localhost");
        const safe = u.pathname.replace(/\/+/g, "/");
        if (safe.includes("..")) {
          res.writeHead(403);
          res.end();
          return;
        }
        const abs = safe === "/" || safe === ""
          ? resolve(benchDir, "perf.html")
          : safe.startsWith("/gallery/")
            ? resolve(galleryDir, safe.slice("/gallery/".length))
            : resolve(benchDir, safe.slice(1));
        const data = await readFile(abs);
        res.writeHead(200, {
          "Content-Type": MIME[extname(abs).toLowerCase()] || "application/octet-stream",
          "Cache-Control": "no-store",
        });
        res.end(data);
      } catch (err) {
        res.writeHead(404);
        res.end(String(err?.message ?? err));
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

function quantile(values, q) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const i = (sorted.length - 1) * q;
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
}

function median(values) {
  return quantile(values, 0.5);
}

function fmt(value, digits = 2) {
  return Number.isFinite(value) ? Number(value).toFixed(digits) : "";
}

function bucketName(dt, baseFrameMs) {
  const ratio = Math.max(1, Math.round(dt / baseFrameMs));
  return ratio >= 4 ? "x4_plus" : `x${ratio}`;
}

function estimateBaseFrameMs(dts) {
  const p10 = quantile(dts, 0.1) ?? 16.667;
  return p10 < 12 ? 8.333 : 16.667;
}

function summarizeFrameTimes(frames) {
  const dts = frames.map((frame) => frame.dt);
  const p50 = median(dts) ?? 0;
  const p95 = quantile(dts, 0.95) ?? 0;
  const p99 = quantile(dts, 0.99) ?? 0;
  return {
    count: frames.length,
    fps_p50: p50 > 0 ? +(1000 / p50).toFixed(2) : 0,
    fps_p95: p95 > 0 ? +(1000 / p95).toFixed(2) : 0,
    frame_time_p50_ms: +p50.toFixed(3),
    frame_time_p95_ms: +p95.toFixed(3),
    frame_time_p99_ms: +p99.toFixed(3),
  };
}

function findTraceMark(events, name) {
  return events.find((event) => event?.name === name && Number.isFinite(event?.args?.data?.startTime)) ??
    events.find((event) => event?.name === "TimeStamp" && event?.args?.data?.message === name);
}

function makeFrames(samples, startPerfNow, endPerfNow) {
  const raw = samples
    .filter((sample) => Number.isFinite(sample?.dt) && sample.dt > 0 && sample.dt < 2000)
    .filter((sample) => sample.t - sample.dt >= startPerfNow && sample.t <= endPerfNow)
    .map((sample, index) => ({
      index,
      start: sample.t - sample.dt,
      end: sample.t,
      dt: sample.dt,
    }));
  const baseFrameMs = estimateBaseFrameMs(raw.map((frame) => frame.dt));
  for (const frame of raw) frame.bucket = bucketName(frame.dt, baseFrameMs);
  return { frames: raw, baseFrameMs };
}

function attachDomSamples(frames, domSamples) {
  if (!Array.isArray(domSamples) || domSamples.length === 0) return;
  let sampleIndex = 0;
  for (const frame of frames) {
    while (sampleIndex + 1 < domSamples.length && domSamples[sampleIndex + 1].t <= frame.end) {
      sampleIndex += 1;
    }
    const sample = domSamples[sampleIndex];
    if (sample && sample.t >= frame.start - 1 && sample.t <= frame.end + 1) {
      frame.leaves = sample.leaves ?? sample.leafCount;
      frame.tags = sample.tags;
      frame.bucketCount = sample.bucketCount;
      frame.inlineStyleChars = sample.inlineStyleChars;
    }
  }
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

function emptyBucket(bucket) {
  return {
    bucket,
    frameCount: 0,
    frame_time_p50_ms: null,
    frame_time_p95_ms: null,
    leaves_p50: null,
    leaves_p95: null,
    bucketCount_p50: null,
    tags_p50: { b: null, i: null, s: null, u: null, q: null },
    inlineStyleChars_p50: null,
    groups_ms_per_frame: {},
    events_ms_per_frame: {},
    topEvents: [],
  };
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

function serializeDurationMap(map, keys) {
  const out = {};
  for (const key of keys) out[key] = +((map.get(key)?.duration_ms ?? 0)).toFixed(4);
  return out;
}

function topDurationEntries(map, keyName, limit = 12) {
  return [...map.entries()]
    .map(([name, total]) => ({
      [keyName]: name,
      count: total.count,
      duration_ms: +total.duration_ms.toFixed(4),
    }))
    .sort((a, b) => b.duration_ms - a.duration_ms)
    .slice(0, limit);
}

function serializeFrameDetailsFrame(frame) {
  return {
    index: frame.index,
    bucket: frame.bucket,
    start_ms: +frame.start.toFixed(3),
    end_ms: +frame.end.toFixed(3),
    dt_ms: +frame.dt.toFixed(3),
    leaves: Number.isFinite(frame.leaves) ? frame.leaves : null,
    tags: frame.tags ?? null,
    bucketCount: Number.isFinite(frame.bucketCount) ? frame.bucketCount : null,
    inlineStyleChars: Number.isFinite(frame.inlineStyleChars) ? frame.inlineStyleChars : null,
    complete_event_ms: +frame.completeEventMs.toFixed(3),
    page_ops: frame.pageOps,
    groups_ms: serializeDurationMap(frame.groups, allGroupNames()),
    key_events_ms: serializeDurationMap(frame.events, KEY_EVENTS),
    topEvents: topDurationEntries(frame.events, "event"),
  };
}

function summarizeFrameDetails(events, frames, tracePerfOffsetMs, frameWorkSamples) {
  if (!FRAME_DETAILS || FRAME_DETAILS_LIMIT === 0) return null;
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

  const eventTotals = new Map();
  const groupTotals = new Map();
  const pageTotals = new Map();
  for (const frame of frameTotals) {
    for (const [event, total] of frame.events) addAggregate(eventTotals, event, total.count, total.duration_ms);
    for (const [group, total] of frame.groups) addAggregate(groupTotals, group, total.count, total.duration_ms);
    for (const [operation, total] of Object.entries(frame.pageOps)) {
      addAggregate(pageTotals, operation, total.count ?? 0, total.duration_ms ?? 0);
    }
  }

  const byDtDesc = (a, b) => b.dt - a.dt || b.completeEventMs - a.completeEventMs;
  const byDtAsc = (a, b) => a.dt - b.dt || b.completeEventMs - a.completeEventMs;
  const serializeFrames = (selected) => selected.map(serializeFrameDetailsFrame);

  return {
    frameCount: frameTotals.length,
    includedFrames: Math.min(FRAME_DETAILS_LIMIT, frameTotals.length),
    slowestFrames: serializeFrames(frameTotals.slice().sort(byDtDesc).slice(0, FRAME_DETAILS_LIMIT)),
    fastestFrames: serializeFrames(frameTotals.slice().sort(byDtAsc).slice(0, FRAME_DETAILS_LIMIT)),
    topPageOps: topDurationEntries(pageTotals, "operation"),
    topGroups: topDurationEntries(groupTotals, "group"),
    topEvents: topDurationEntries(eventTotals, "event"),
  };
}

function summarizeBuckets(events, frames, tracePerfOffsetMs, renderStats) {
  const fallbackTags = renderStats?.dom?.tags ?? null;
  const fallbackLeaves = renderStats?.dom?.leafCount ?? null;
  const fallbackBucketCount = renderStats?.dom?.buckets ?? null;
  const fallbackInlineStyleChars = renderStats?.dom?.inlineStyleChars ?? null;
  const buckets = new Map();
  for (const frame of frames) {
    const bucket = buckets.get(frame.bucket) ?? {
      ...emptyBucket(frame.bucket),
      frameDts: [],
      leaves: [],
      bucketCounts: [],
      inlineStyleChars: [],
      tagCounts: { b: [], i: [], s: [], u: [], q: [] },
      eventTotals: new Map(),
      groupTotals: new Map(),
    };
    bucket.frameCount += 1;
    bucket.frameDts.push(frame.dt);
    if (Number.isFinite(frame.leaves)) bucket.leaves.push(frame.leaves);
    if (Number.isFinite(frame.bucketCount)) bucket.bucketCounts.push(frame.bucketCount);
    if (Number.isFinite(frame.inlineStyleChars)) bucket.inlineStyleChars.push(frame.inlineStyleChars);
    for (const tag of ["b", "i", "s", "u", "q"]) {
      if (Number.isFinite(frame.tags?.[tag])) bucket.tagCounts[tag].push(frame.tags[tag]);
    }
    buckets.set(frame.bucket, bucket);
  }

  for (const event of events) {
    if (event?.ph !== "X" || typeof event.dur !== "number" || !Number.isFinite(event.ts)) continue;
    const durationMs = event.dur / 1000;
    const midpointPerfNow = ((event.ts + event.dur / 2) / 1000) - tracePerfOffsetMs;
    const index = frameIndexAt(frames, midpointPerfNow);
    if (index < 0) continue;
    const bucket = buckets.get(frames[index].bucket);
    if (!bucket) continue;
    addDuration(bucket.eventTotals, event.name, durationMs);
    addEventGroups(bucket.groupTotals, event.name, durationMs);
  }

  return ["x1", "x2", "x3", "x4_plus"]
    .map((name) => {
      const bucket = buckets.get(name);
      if (!bucket) return emptyBucket(name);
      const frameCount = bucket.frameCount || 1;
      const events_ms_per_frame = {};
      for (const event of KEY_EVENTS) {
        events_ms_per_frame[event] = +((bucket.eventTotals.get(event)?.duration_ms ?? 0) / frameCount).toFixed(4);
      }
      const groups_ms_per_frame = {};
      for (const group of allGroupNames()) {
        groups_ms_per_frame[group] = +((bucket.groupTotals.get(group)?.duration_ms ?? 0) / frameCount).toFixed(4);
      }
      const tags_p50 = {};
      for (const tag of ["b", "i", "s", "u", "q"]) {
        tags_p50[tag] = bucket.tagCounts[tag].length ? +(median(bucket.tagCounts[tag]) ?? 0).toFixed(0) : null;
      }
      const topEvents = [...bucket.eventTotals.entries()]
        .map(([event, total]) => ({
          event,
          count: total.count,
          ms_per_frame: +(total.duration_ms / frameCount).toFixed(4),
        }))
        .sort((a, b) => b.ms_per_frame - a.ms_per_frame)
        .slice(0, 12);
      const summary = {
        bucket: name,
        frameCount: bucket.frameCount,
        frame_time_p50_ms: +(median(bucket.frameDts) ?? 0).toFixed(3),
        frame_time_p95_ms: +(quantile(bucket.frameDts, 0.95) ?? 0).toFixed(3),
        leaves_p50: bucket.leaves.length ? +(median(bucket.leaves) ?? 0).toFixed(0) : fallbackLeaves,
        leaves_p95: bucket.leaves.length ? +(quantile(bucket.leaves, 0.95) ?? 0).toFixed(0) : null,
        bucketCount_p50: bucket.bucketCounts.length ? +(median(bucket.bucketCounts) ?? 0).toFixed(0) : fallbackBucketCount,
        tags_p50,
        inlineStyleChars_p50: bucket.inlineStyleChars.length ? +(median(bucket.inlineStyleChars) ?? 0).toFixed(0) : fallbackInlineStyleChars,
        groups_ms_per_frame,
        events_ms_per_frame,
        topEvents,
      };
      if (fallbackTags && Object.values(tags_p50).every((value) => value === null)) {
        summary.tags_p50 = fallbackTags;
      }
      return summary;
    });
}

function aggregateEventTotals(events, tracePerfOffsetMs, startPerfNow, endPerfNow) {
  const totals = new Map();
  for (const event of events) {
    if (event?.ph !== "X" || typeof event.dur !== "number" || !Number.isFinite(event.ts)) continue;
    const midpointPerfNow = ((event.ts + event.dur / 2) / 1000) - tracePerfOffsetMs;
    if (midpointPerfNow < startPerfNow || midpointPerfNow > endPerfNow) continue;
    addDuration(totals, event.name, event.dur / 1000);
  }
  return [...totals.entries()]
    .map(([event, total]) => ({ event, count: total.count, duration_ms: +total.duration_ms.toFixed(3) }))
    .sort((a, b) => b.duration_ms - a.duration_ms)
    .slice(0, 40);
}

function tagText(tags) {
  if (!tags) return "";
  return `b/i/s/u/q=${tags.b ?? ""}/${tags.i ?? ""}/${tags.s ?? ""}/${tags.u ?? ""}/${tags.q ?? ""}`;
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

async function stopTrace(cdp) {
  await new Promise(async (resolveStop) => {
    cdp.once("Tracing.tracingComplete", resolveStop);
    await cdp.send("Tracing.end");
  });
}

function performanceMetric(metrics, name) {
  return metrics?.metrics?.find((metric) => metric.name === name)?.value;
}

async function traceClockOffset(cdp, page) {
  try {
    const [metrics, perfNow] = await Promise.all([
      cdp.send("Performance.getMetrics"),
      page.evaluate(() => performance.now()),
    ]);
    const timestampSeconds = performanceMetric(metrics, "Timestamp");
    return Number.isFinite(timestampSeconds) ? (timestampSeconds * 1000) - perfNow : 0;
  } catch {
    return 0;
  }
}

async function startLayerTracking(cdp) {
  const state = { layers: [], errors: [] };
  cdp.on("LayerTree.layerTreeDidChange", (payload) => {
    if (Array.isArray(payload?.layers)) state.layers = payload.layers;
  });
  try {
    await cdp.send("DOM.enable");
    await cdp.send("LayerTree.enable");
  } catch (error) {
    state.errors.push(String(error?.message ?? error));
  }
  return state;
}

function attrValue(attrs, name) {
  if (!Array.isArray(attrs)) return "";
  for (let i = 0; i < attrs.length; i += 2) {
    if (attrs[i] === name) return attrs[i + 1] ?? "";
  }
  return "";
}

async function describeLayerNode(cdp, backendNodeId) {
  if (!backendNodeId) return null;
  try {
    const { node } = await cdp.send("DOM.describeNode", { backendNodeId });
    return {
      nodeName: node?.nodeName ?? "",
      id: attrValue(node?.attributes, "id"),
      className: attrValue(node?.attributes, "class"),
    };
  } catch {
    return null;
  }
}

async function compositingReasons(cdp, layerId) {
  try {
    const result = await cdp.send("LayerTree.compositingReasons", { layerId });
    return result?.compositingReasons ?? [];
  } catch {
    return [];
  }
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      out[index] = await fn(items[index], index);
    }
  });
  await Promise.all(workers);
  return out;
}

function nodeLayerGroup(node) {
  if (!node) return "unknown";
  const nodeName = String(node.nodeName || "").toLowerCase();
  const classNames = String(node.className || "").split(/\s+/).filter(Boolean);
  const hasClass = (name) => classNames.includes(name);

  if (["b", "i", "s", "u", "q"].includes(nodeName)) return `leaf:${nodeName}`;
  if (hasClass("polycss-scene")) return "polycss-scene";
  if (hasClass("polycss-camera")) return "polycss-camera";
  if (hasClass("polycss-mesh")) return "polycss-mesh";
  if (hasClass("polycss-bucket")) return "polycss-bucket";
  if (hasClass("polycss-voxel-face")) return "polycss-voxel-face";
  if (node.id === "fps") return "overlay:fps";
  if (nodeName) return nodeName;
  return "unknown";
}

function addReasonCounts(map, reasons) {
  for (const reason of reasons ?? []) {
    map.set(reason, (map.get(reason) ?? 0) + 1);
  }
}

function serializeReasonCounts(map, limit = 12) {
  return [...map.entries()]
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason))
    .slice(0, limit);
}

function addLayerAggregate(map, info) {
  const group = nodeLayerGroup(info.node);
  const area = (info.width ?? 0) * (info.height ?? 0);
  const aggregate = map.get(group) ?? {
    group,
    layerCount: 0,
    drawsContentCount: 0,
    invisibleCount: 0,
    totalArea: 0,
    maxArea: 0,
    paintCountTotal: 0,
    reasonCounts: new Map(),
    sampleNodes: new Map(),
  };

  aggregate.layerCount += 1;
  if (info.drawsContent) aggregate.drawsContentCount += 1;
  if (info.invisible) aggregate.invisibleCount += 1;
  aggregate.totalArea += area;
  aggregate.maxArea = Math.max(aggregate.maxArea, area);
  aggregate.paintCountTotal += Number(info.paintCount) || 0;
  addReasonCounts(aggregate.reasonCounts, info.compositingReasons);
  if (info.node) {
    const key = [
      info.node.nodeName,
      info.node.id ? `#${info.node.id}` : "",
      info.node.className ? `.${String(info.node.className).split(/\s+/).filter(Boolean).join(".")}` : "",
    ].join("");
    if (key) aggregate.sampleNodes.set(key, (aggregate.sampleNodes.get(key) ?? 0) + 1);
  }

  map.set(group, aggregate);
}

function serializeLayerAggregate(aggregate) {
  const sampleNodes = [...aggregate.sampleNodes.entries()]
    .map(([node, count]) => ({ node, count }))
    .sort((a, b) => b.count - a.count || a.node.localeCompare(b.node))
    .slice(0, 6);
  return {
    group: aggregate.group,
    layerCount: aggregate.layerCount,
    drawsContentCount: aggregate.drawsContentCount,
    invisibleCount: aggregate.invisibleCount,
    totalArea: +aggregate.totalArea.toFixed(3),
    maxArea: +aggregate.maxArea.toFixed(3),
    paintCountTotal: +aggregate.paintCountTotal.toFixed(3),
    reasonCounts: serializeReasonCounts(aggregate.reasonCounts, 8),
    sampleNodes,
  };
}

async function collectLayerDetails(cdp, state) {
  if (!LAYER_DETAILS) return null;
  await new Promise((resolveWait) => setTimeout(resolveWait, 50));
  const layers = Array.isArray(state?.layers) ? state.layers : [];
  const reasonCounts = new Map();
  const aggregateMap = new Map();
  const layerInfos = await mapLimit(layers, 16, async (layer) => {
    const [reasons, node] = await Promise.all([
      compositingReasons(cdp, layer.layerId),
      describeLayerNode(cdp, layer.backendNodeId),
    ]);
    const info = {
      layerId: layer.layerId,
      parentLayerId: layer.parentLayerId ?? null,
      backendNodeId: layer.backendNodeId ?? null,
      drawsContent: Boolean(layer.drawsContent),
      invisible: Boolean(layer.invisible),
      width: layer.width ?? 0,
      height: layer.height ?? 0,
      area: +(((layer.width ?? 0) * (layer.height ?? 0))).toFixed(3),
      paintCount: layer.paintCount ?? null,
      node,
      compositingReasons: reasons,
    };
    addReasonCounts(reasonCounts, reasons);
    addLayerAggregate(aggregateMap, info);
    return info;
  });

  const layerAreas = layers.map((layer) => (layer.width ?? 0) * (layer.height ?? 0));
  const topLayers = layerInfos
    .slice()
    .sort((a, b) => b.area - a.area)
    .slice(0, LAYER_DETAILS_LIMIT);
  const layerAggregates = [...aggregateMap.values()]
    .map(serializeLayerAggregate)
    .sort((a, b) =>
      b.layerCount - a.layerCount ||
      b.drawsContentCount - a.drawsContentCount ||
      b.totalArea - a.totalArea ||
      a.group.localeCompare(b.group)
    );

  return {
    enabled: true,
    layerCount: layers.length,
    aggregatedLayerCount: layerInfos.length,
    inspectedLayerCount: topLayers.length,
    drawsContentCount: layers.filter((layer) => layer.drawsContent).length,
    invisibleCount: layers.filter((layer) => layer.invisible).length,
    totalArea: +layerAreas.reduce((sum, area) => sum + area, 0).toFixed(3),
    maxArea: +(Math.max(0, ...layerAreas)).toFixed(3),
    reasonCounts: serializeReasonCounts(reasonCounts, 24),
    layerAggregates,
    topLayers,
    errors: state?.errors ?? [],
  };
}

function pageUrl(port) {
  if (PAGE === "nonvoxel") {
    const variantParams = getNonVoxelVariantParams(VARIANT);
    if (!variantParams) {
      throw new Error(`Unknown --variant "${VARIANT}". Known: ${knownNonVoxelVariantIds().join(", ")}`);
    }
    const params = new URLSearchParams({
      mesh: MESH,
      mode: MODE,
      motion: MOTION,
      ...(FRAME_DETAILS ? { frameWork: "1" } : {}),
      ...variantParams,
    });
    return `http://127.0.0.1:${port}/nonvoxel-vanilla.html?${params.toString()}`;
  }
  if (PAGE !== "perf") {
    throw new Error(`Unknown --page "${PAGE}". Expected "perf" or "nonvoxel".`);
  }
  return `http://127.0.0.1:${port}/perf-${RENDERER}.html?mesh=${encodeURIComponent(MESH)}&mode=${encodeURIComponent(MODE)}&motion=${encodeURIComponent(MOTION)}`;
}

function traceOutputPath(repeat) {
  if (!TRACE_PATH) return "";
  const abs = resolve(TRACE_PATH);
  if (RUNS <= 1) return abs;
  return abs.endsWith(".json")
    ? abs.replace(/\.json$/, `.r${repeat}.json`)
    : `${abs}.r${repeat}.json`;
}

async function runOnce(port, repeat) {
  const launchOptions = { headless: !HEADED, args: CHROMIUM_ARGS };
  if (BROWSER_EXECUTABLE) launchOptions.executablePath = BROWSER_EXECUTABLE;
  const browser = await chromium.launch(launchOptions);
  try {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await ctx.newPage();
    const pageDiagnostics = [];
    page.on("console", (message) => {
      if (message.type() === "error") pageDiagnostics.push(`[console:${message.type()}] ${message.text()}`);
    });
    page.on("pageerror", (error) => {
      pageDiagnostics.push(`[pageerror] ${error?.stack || error?.message || error}`);
    });
    const cdp = (TRACE || LAYER_DETAILS) ? await ctx.newCDPSession(page) : null;
    const url = pageUrl(port);
    await page.goto(url, { waitUntil: "load" });
    try {
      await page.waitForFunction(() => window.__perf__?.ready === true, null, { timeout: 30000 });
    } catch (error) {
      const details = pageDiagnostics.length ? `\n${pageDiagnostics.join("\n")}` : "";
      throw new Error(`Perf page did not become ready for ${url}.${details}`, { cause: error });
    }
    const layerState = LAYER_DETAILS && cdp ? await startLayerTracking(cdp) : null;
    await page.waitForTimeout(WARMUP_MS);

    const events = TRACE ? await startTrace(cdp) : [];
    const fallbackTracePerfOffsetMs = TRACE ? await traceClockOffset(cdp, page) : 0;
    const startIdx = await page.evaluate(() => window.__perf__.samples.length);
    const startPerfNow = await page.evaluate(({ traceEnabled, domSamples, frameDetails }) => {
      if (frameDetails) {
        window.__nonvoxelBench?.resetInteractionStats?.();
      }
      if (domSamples) {
        window.__polycssDomSamples = [];
        window.__polycssDomSampling = true;
        const tick = (now) => {
          const mesh = document.querySelector(".polycss-voxel-mesh");
          const sceneRoot = document.querySelector(".polycss-scene");
          const tags = { b: 0, i: 0, s: 0, u: 0, q: 0 };
          let inlineStyleChars = 0;
          if (sceneRoot) {
            for (const tag of Object.keys(tags)) tags[tag] = sceneRoot.querySelectorAll(tag).length;
            for (const el of sceneRoot.querySelectorAll("b,i,s,u,q")) {
              inlineStyleChars += el.getAttribute("style")?.length ?? 0;
            }
          }
          window.__polycssDomSamples.push({
            t: now,
            leaves: mesh?.childElementCount ?? tags.b + tags.i + tags.s + tags.u,
            tags,
            bucketCount: sceneRoot?.querySelectorAll(".polycss-bucket").length ?? 0,
            inlineStyleChars,
          });
          if (window.__polycssDomSampling) requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      } else {
        window.__polycssDomSamples = [];
        window.__polycssDomSampling = false;
      }
      if (traceEnabled) {
        performance.mark("__polycss_trace_analysis_start__");
        console.timeStamp("__polycss_trace_analysis_start__");
      }
      return performance.now();
    }, { traceEnabled: TRACE, domSamples: DOM_SAMPLES, frameDetails: FRAME_DETAILS });
    await page.waitForTimeout(SAMPLE_MS);
    const endPerfNow = await page.evaluate((traceEnabled) => {
      if (traceEnabled) {
        performance.mark("__polycss_trace_analysis_end__");
        console.timeStamp("__polycss_trace_analysis_end__");
      }
      window.__polycssDomSampling = false;
      return performance.now();
    }, TRACE);
    if (TRACE) await stopTrace(cdp);

    const pageResult = await page.evaluate((from) => ({
      samples: window.__perf__.samples.slice(from),
      polyCount: window.__perf__.polyCount,
      renderStats: window.__perf__.renderStats ?? null,
      domSamples: window.__polycssDomSamples ?? null,
      frameWorkSamples: window.__nonvoxelBench?.frameWorkSamples?.() ?? null,
    }), startIdx);
    const layerDetails = LAYER_DETAILS && cdp ? await collectLayerDetails(cdp, layerState) : null;
    await ctx.close();

    let tracePerfOffsetMs = 0;
    let alignedStartPerfNow = startPerfNow;
    let alignedEndPerfNow = endPerfNow;
    let traceAligned = !TRACE;
    let traceAlignmentSource = TRACE ? "none" : "disabled";
    if (TRACE) {
      const startMark = findTraceMark(events, "__polycss_trace_analysis_start__");
      const endMark = findTraceMark(events, "__polycss_trace_analysis_end__");
      if (startMark?.args?.data?.startTime && endMark?.args?.data?.startTime) {
        tracePerfOffsetMs = (startMark.ts / 1000) - startMark.args.data.startTime;
        alignedStartPerfNow = startMark.args.data.startTime;
        alignedEndPerfNow = endMark.args.data.startTime;
        traceAligned = true;
        traceAlignmentSource = "trace-markers";
      } else {
        tracePerfOffsetMs = fallbackTracePerfOffsetMs;
        traceAlignmentSource = "performance-metrics-fallback";
      }
    }
    const { frames, baseFrameMs } = makeFrames(pageResult.samples, alignedStartPerfNow, alignedEndPerfNow);
    attachDomSamples(frames, pageResult.domSamples);
    const frameStats = summarizeFrameTimes(frames);
    const buckets = summarizeBuckets(events, frames, tracePerfOffsetMs, pageResult.renderStats);
    const eventTotals = aggregateEventTotals(events, tracePerfOffsetMs, alignedStartPerfNow, alignedEndPerfNow);
    const frameDetails = summarizeFrameDetails(events, frames, tracePerfOffsetMs, pageResult.frameWorkSamples);
    const traceFile = TRACE ? traceOutputPath(repeat) : "";
    if (traceFile) {
      mkdirSync(dirname(traceFile), { recursive: true });
      writeFileSync(traceFile, JSON.stringify({
        traceEvents: events,
        displayTimeUnit: "ms",
        metadata: {
          source: ".agents/skills/chrome-capture-trace/scripts/polycss-trace-analysis.mjs",
          page: PAGE,
          mesh: MESH,
          renderer: RENDERER,
          variant: PAGE === "nonvoxel" ? VARIANT : undefined,
          mode: MODE,
          motion: MOTION,
          repeat,
          warmupMs: WARMUP_MS,
          sampleMs: SAMPLE_MS,
          gpuDetails: GPU_DETAILS_MODE,
          traceAligned,
          traceAlignmentSource,
        },
      }));
      if (!JSON_ONLY) console.log(`[trace-analysis] wrote ${traceFile}`);
    }

    return {
      repeat,
      page: PAGE,
      mesh: MESH,
      renderer: RENDERER,
      ...(PAGE === "nonvoxel" ? { variant: VARIANT } : {}),
      mode: MODE,
      motion: MOTION,
      trace: TRACE,
      traceAligned,
      traceAlignmentSource,
      domSamples: DOM_SAMPLES,
      gpuDetails: GPU_DETAILS_MODE,
      warmup_ms: WARMUP_MS,
      sample_ms: SAMPLE_MS,
      baseFrameMs: +baseFrameMs.toFixed(3),
      ...frameStats,
      polyCount: pageResult.polyCount,
      renderStats: pageResult.renderStats,
      domSamples: DOM_SAMPLES ? pageResult.domSamples : undefined,
      frameDetails,
      layerDetails,
      buckets,
      eventTotals,
      outputFiles: {
        ...(traceFile ? { trace: traceFile } : {}),
      },
    };
  } finally {
    await browser.close();
  }
}

function printRun(run) {
  const bucketText = run.buckets
    .filter((bucket) => bucket.frameCount > 0)
    .map((bucket) => `${bucket.bucket}:${bucket.frameCount}`)
    .join(" ");
  console.log(
    `[trace-analysis] ${run.mesh}${run.variant ? ` ${run.variant}` : ""} r${run.repeat} p50=${fmt(run.fps_p50, 1)} p95=${fmt(run.fps_p95, 1)} p99=${fmt(run.frame_time_p99_ms, 1)}ms base=${fmt(run.baseFrameMs, 3)}ms ${bucketText}`,
  );
  console.log("| Bucket | Frames | Leaves p50 | Tags p50 | dt p50 | dt p95 | gpuViz | compositorMain | compositorImpl | style | prePaint | PAC | layerize | drawProps | visible | prepareDraw | draw | raster | script |");
  console.log("| --- | ---: | ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |");
  for (const bucket of run.buckets) {
    if (bucket.frameCount === 0) continue;
    const e = bucket.events_ms_per_frame;
    const g = bucket.groups_ms_per_frame;
    console.log([
      `| ${bucket.bucket}`,
      bucket.frameCount,
      fmt(bucket.leaves_p50, 0),
      tagText(bucket.tags_p50),
      fmt(bucket.frame_time_p50_ms),
      fmt(bucket.frame_time_p95_ms),
      fmt(g.gpuViz, 4),
      fmt(g.compositorMain, 4),
      fmt(g.compositorImpl, 4),
      fmt(g.style, 4),
      fmt(g.prePaint, 4),
      fmt(e["PaintArtifactCompositor::Update"], 4),
      fmt(e.Layerize, 4),
      fmt(e["LayerTreeImpl::UpdateDrawProperties"], 4),
      fmt(e["draw_property_utils::ComputeDrawPropertiesOfVisibleLayers"], 4),
      fmt(e["LayerTreeHostImpl::PrepareToDraw"], 4),
      fmt(e["MainFrame.Draw"], 4),
      fmt(g.raster, 4),
      `${fmt(g.script, 4)} |`,
    ].join(" | "));
  }
}

if (HELP) {
  printHelp();
  process.exit(0);
}

const { server, port } = await startServer();
try {
  if (!JSON_ONLY) {
    console.log(`[trace-analysis] server :${port}`);
    console.log(`[trace-analysis] page=${PAGE} mesh=${MESH} renderer=${RENDERER} variant=${PAGE === "nonvoxel" ? VARIANT : "n/a"} mode=${MODE} motion=${MOTION} trace=${TRACE ? "on" : "off"} domSamples=${DOM_SAMPLES ? "on" : "off"} frameDetails=${FRAME_DETAILS ? "on" : "off"} layerDetails=${LAYER_DETAILS ? "on" : "off"} gpuDetails=${GPU_DETAILS_MODE} runs=${RUNS} warmup=${WARMUP_MS}ms sample=${SAMPLE_MS}ms`);
  }
  const runs = [];
  for (let repeat = 1; repeat <= RUNS; repeat += 1) {
    const run = await runOnce(port, repeat);
    runs.push(run);
    if (!JSON_ONLY) printRun(run);
  }
  const out = {
    kind: "trace-analysis",
    page: PAGE,
    mesh: MESH,
    renderer: RENDERER,
    ...(PAGE === "nonvoxel" ? { variant: VARIANT } : {}),
    mode: MODE,
    motion: MOTION,
    trace: TRACE,
    domSamples: DOM_SAMPLES,
    gpuDetails: GPU_DETAILS_MODE,
    traceAligned: runs.every((run) => run.traceAligned !== false),
    browserExecutable: BROWSER_EXECUTABLE || null,
    chromiumArgs: CHROMIUM_ARGS,
    softwareBackend: SOFTWARE_BACKEND,
    warmup_ms: WARMUP_MS,
    sample_ms: SAMPLE_MS,
    runs,
  };
  if (LABEL || SUMMARY_PATH) {
    const file = SUMMARY_PATH ? resolve(SUMMARY_PATH) : resolve(repoRoot, "bench/results", `${LABEL}.json`);
    const dir = dirname(file);
    mkdirSync(dir, { recursive: true });
    writeFileSync(file, JSON.stringify(out, null, 2) + "\n");
    if (!JSON_ONLY) console.log(`[trace-analysis] wrote ${file}`);
  }
  if (JSON_ONLY) console.log(JSON.stringify(out, null, 2));
} finally {
  await stopServer(server);
}
