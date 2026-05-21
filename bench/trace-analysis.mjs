#!/usr/bin/env node
/**
 * Chrome trace analysis for polycss camera-motion runs.
 *
 * Captures a perf or non-voxel bench page, aligns trace events to rAF frame
 * samples, and reports compositor/style/raster/script cost per cadence bucket.
 *
 * Usage:
 *   node bench/trace-analysis.mjs
 *   node bench/trace-analysis.mjs --mesh ancient-crash-site --runs 3 --dom-samples
 *   node bench/trace-analysis.mjs --mesh obj-house3 --renderer vanilla --label obj-house3-trace
 *   node bench/trace-analysis.mjs --page nonvoxel --mesh glb:Elephant.glb --variant order-tile4 --no-trace
 */
import { createServer } from "node:http";
import { mkdirSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { chromiumArgsWithGpuDefault } from "./chromium-defaults.mjs";
import { getNonVoxelVariantParams, knownNonVoxelVariantIds } from "./nonvoxel-variants.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");
const benchDir = resolve(repoRoot, "bench");
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
const HEADED = hasFlag("headed");
const JSON_ONLY = hasFlag("json");
const TRACE = !hasFlag("no-trace");
const DOM_SAMPLES = hasFlag("dom-samples");
const BROWSER_EXECUTABLE = optStr("browser-executable");
const SOFTWARE_BACKEND = hasFlag("software-backend");
const CHROMIUM_ARGS = chromiumArgsWithGpuDefault([
  ...optAll("chromium-arg"),
  ...optAll("chromium-args").flatMap((value) => value.split(/\s+/).filter(Boolean)),
], { softwareBackend: SOFTWARE_BACKEND });

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

const TRACE_CATEGORIES = [
  "devtools.timeline",
  "disabled-by-default-devtools.timeline",
  "blink",
  "blink.user_timing",
  "cc",
  "gpu",
  "viz",
  "renderer.scheduler",
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
};

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
  "DisplayScheduler::DrawAndSwap",
  "DirectRenderer::DrawFrame",
  "DirectRenderer::DrawRenderPass",
  "SoftwareRenderer::DoDrawQuad",
  "RunTask",
  "RasterTask",
];

function printHelp() {
  console.log(`Usage: node bench/trace-analysis.mjs [options]

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
  --no-trace                  Collect rAF bucket stats without Chrome tracing
  --dom-samples               Sample mounted leaf/tag counts by rAF frame
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

  const groupByEvent = new Map();
  for (const [group, names] of Object.entries(EVENT_GROUPS)) {
    for (const name of names) groupByEvent.set(name, group);
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
    const group = groupByEvent.get(event.name);
    if (group) addDuration(bucket.groupTotals, group, durationMs);
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
      for (const group of Object.keys(EVENT_GROUPS)) {
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
      ...variantParams,
    });
    return `http://127.0.0.1:${port}/nonvoxel-vanilla.html?${params.toString()}`;
  }
  if (PAGE !== "perf") {
    throw new Error(`Unknown --page "${PAGE}". Expected "perf" or "nonvoxel".`);
  }
  return `http://127.0.0.1:${port}/perf-${RENDERER}.html?mesh=${encodeURIComponent(MESH)}&mode=${encodeURIComponent(MODE)}&motion=${encodeURIComponent(MOTION)}`;
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
    const cdp = TRACE ? await ctx.newCDPSession(page) : null;
    const url = pageUrl(port);
    await page.goto(url, { waitUntil: "load" });
    try {
      await page.waitForFunction(() => window.__perf__?.ready === true, null, { timeout: 30000 });
    } catch (error) {
      const details = pageDiagnostics.length ? `\n${pageDiagnostics.join("\n")}` : "";
      throw new Error(`Perf page did not become ready for ${url}.${details}`, { cause: error });
    }
    await page.waitForTimeout(WARMUP_MS);

    const events = TRACE ? await startTrace(cdp) : [];
    const startIdx = await page.evaluate(() => window.__perf__.samples.length);
    const startPerfNow = await page.evaluate(({ traceEnabled, domSamples }) => {
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
    }, { traceEnabled: TRACE, domSamples: DOM_SAMPLES });
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
    }), startIdx);
    await ctx.close();

    let tracePerfOffsetMs = 0;
    let alignedStartPerfNow = startPerfNow;
    let alignedEndPerfNow = endPerfNow;
    if (TRACE) {
      const startMark = findTraceMark(events, "__polycss_trace_analysis_start__");
      const endMark = findTraceMark(events, "__polycss_trace_analysis_end__");
      if (!startMark?.args?.data?.startTime || !endMark?.args?.data?.startTime) {
        throw new Error("Trace markers were not captured; cannot align trace to rAF samples.");
      }
      tracePerfOffsetMs = (startMark.ts / 1000) - startMark.args.data.startTime;
      alignedStartPerfNow = startMark.args.data.startTime;
      alignedEndPerfNow = endMark.args.data.startTime;
    }
    const { frames, baseFrameMs } = makeFrames(pageResult.samples, alignedStartPerfNow, alignedEndPerfNow);
    attachDomSamples(frames, pageResult.domSamples);
    const frameStats = summarizeFrameTimes(frames);
    const buckets = summarizeBuckets(events, frames, tracePerfOffsetMs, pageResult.renderStats);
    const eventTotals = aggregateEventTotals(events, tracePerfOffsetMs, alignedStartPerfNow, alignedEndPerfNow);

    return {
      repeat,
      page: PAGE,
      mesh: MESH,
      renderer: RENDERER,
      ...(PAGE === "nonvoxel" ? { variant: VARIANT } : {}),
      mode: MODE,
      motion: MOTION,
      trace: TRACE,
      domSamples: DOM_SAMPLES,
      warmup_ms: WARMUP_MS,
      sample_ms: SAMPLE_MS,
      baseFrameMs: +baseFrameMs.toFixed(3),
      ...frameStats,
      polyCount: pageResult.polyCount,
      renderStats: pageResult.renderStats,
      domSamples: DOM_SAMPLES ? pageResult.domSamples : undefined,
      buckets,
      eventTotals,
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
  console.log("| Bucket | Frames | Leaves p50 | Tags p50 | dt p50 | dt p95 | style | prePaint | PAC | layerize | drawProps | visible | prepareDraw | draw | raster | script |");
  console.log("| --- | ---: | ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |");
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
    console.log(`[trace-analysis] page=${PAGE} mesh=${MESH} renderer=${RENDERER} variant=${PAGE === "nonvoxel" ? VARIANT : "n/a"} mode=${MODE} motion=${MOTION} trace=${TRACE ? "on" : "off"} domSamples=${DOM_SAMPLES ? "on" : "off"} runs=${RUNS} warmup=${WARMUP_MS}ms sample=${SAMPLE_MS}ms`);
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
    browserExecutable: BROWSER_EXECUTABLE || null,
    chromiumArgs: CHROMIUM_ARGS,
    softwareBackend: SOFTWARE_BACKEND,
    warmup_ms: WARMUP_MS,
    sample_ms: SAMPLE_MS,
    runs,
  };
  if (LABEL) {
    const dir = resolve(repoRoot, "bench/results");
    mkdirSync(dir, { recursive: true });
    const file = resolve(dir, `${LABEL}.json`);
    writeFileSync(file, JSON.stringify(out, null, 2) + "\n");
    if (!JSON_ONLY) console.log(`[trace-analysis] wrote ${file}`);
  }
  if (JSON_ONLY) console.log(JSON.stringify(out, null, 2));
} finally {
  await stopServer(server);
}
