#!/usr/bin/env node
/**
 * Playwright benchmark for the animated human run sequence.
 *
 * The page drives the real vanilla animation path:
 * parse GLB -> sample clip -> createPolyAnimationMixer.update(dt) ->
 * PolyMeshHandle.setPolygons(..., { merge:false, stableDom:true }).
 *
 * Usage:
 *   node bench/animated-human-bench.mjs
 *   node bench/animated-human-bench.mjs --mode baked,dynamic --label human-run
 *   node bench/animated-human-bench.mjs --compare-stable-dom --trace
 *   node bench/animated-human-bench.mjs --profile
 *   node bench/animated-human-bench.mjs --mesh poly-pizza/animated-human.glb --clip run
 */
import { createServer } from "node:http";
import { mkdirSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { chromiumArgsWithGpuDefault } from "./chromium-defaults.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");
const benchDir = resolve(repoRoot, "bench");
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
const hasOpt = (name) =>
  flag(name) >= 0 || argv.some((arg) => arg.startsWith(`--${name}=`));

const MESH = optStr("mesh", "poly-pizza/animated-human.glb");
const CLIP = optStr("clip", "run");
const TARGET_SIZE = optNum("target-size", optNum("targetSize", 72));
const TIME_SCALE = optNum("time-scale", optNum("timeScale", 1));
const WARMUP_MS = optNum("warmup", 2000);
const SAMPLE_MS = optNum("sample", 5000);
const RUNS = Math.max(1, optNum("runs", 1));
const LABEL = optStr("label");
const JSON_PATH = optStr("json");
const HEADED = hasFlag("headed");
const TRACE = hasFlag("trace");
const PROFILE = hasFlag("profile");
const COMPARE_STABLE_TRIANGLE_DEBUG = hasFlag("compare-stable-triangle-debug");
const COMPARE_ANIMATION_DRIVER = hasFlag("compare-animation-driver");
const COMPARE_ANIMATION_FRAME_CACHE = hasFlag("compare-animation-frame-cache");
const COMPARE_ANIMATED_MESH_OPTIMIZATION = hasFlag("compare-animated-mesh-optimization");
const REQUIRE_SOLID_TRIANGLES = hasFlag("require-solid-triangles");
const BROWSER_EXECUTABLE = optStr("browser-executable");
const SOFTWARE_BACKEND = hasFlag("software-backend");
const SOLID_TEXTURE_SAMPLES = !hasFlag("no-solid-texture-samples");
const DISABLE_STRATEGIES = optStr("disable-strategies", optStr("disableStrategies"));
const STABLE_TRIANGLE_DEBUG = optStr("stable-triangle-debug", optStr("stableTriangleDebug"));
const ANIMATION_DRIVER = optStr("animation-driver", optStr("animationDriver", "js"));
const ANIMATION_FRAME_CACHE = hasFlag("animation-frame-cache") || hasFlag("animationFrameCache");
const ANIMATION_FRAME_CACHE_FRAMES = optNum(
  "animation-frame-cache-frames",
  optNum("animationFrameCacheFrames", 60),
);
const KEYFRAME_SAMPLES = optNum("keyframe-samples", optNum("keyframeSamples", 24));
const DEFAULT_STABLE_TRIANGLE_COLOR_STEPS = 0;
const DEFAULT_STABLE_TRIANGLE_COLOR_POLICY = "cadence";
const DEFAULT_STABLE_TRIANGLE_COLOR_FREEZE_FRAMES = 12;
const DEFAULT_STABLE_TRIANGLE_COLOR_BUDGET = 0.16;
const DEFAULT_STABLE_TRIANGLE_COLOR_MAX_AGE = 8;
const DEFAULT_STABLE_TRIANGLE_COLOR_MAX_STEP = 8;
const HAS_STABLE_TRIANGLE_COLOR_STEPS =
  hasOpt("stable-triangle-color-steps") || hasOpt("stableTriangleColorSteps");
const STABLE_TRIANGLE_COLOR_STEPS = optNum(
  "stable-triangle-color-steps",
  optNum("stableTriangleColorSteps", 0),
);
const HAS_STABLE_TRIANGLE_COLOR_POLICY =
  hasOpt("stable-triangle-color-policy") || hasOpt("stableTriangleColorPolicy");
const STABLE_TRIANGLE_COLOR_POLICY = optStr(
  "stable-triangle-color-policy",
  optStr("stableTriangleColorPolicy", DEFAULT_STABLE_TRIANGLE_COLOR_POLICY),
);
const HAS_STABLE_TRIANGLE_COLOR_FREEZE_FRAMES =
  hasOpt("stable-triangle-color-freeze-frames") || hasOpt("stableTriangleColorFreezeFrames");
const STABLE_TRIANGLE_COLOR_FREEZE_FRAMES = optNum(
  "stable-triangle-color-freeze-frames",
  optNum("stableTriangleColorFreezeFrames", 0),
);
const HAS_STABLE_TRIANGLE_COLOR_BUDGET =
  hasOpt("stable-triangle-color-budget") || hasOpt("stableTriangleColorBudget");
const STABLE_TRIANGLE_COLOR_BUDGET = optNum(
  "stable-triangle-color-budget",
  optNum("stableTriangleColorBudget", 0),
);
const HAS_STABLE_TRIANGLE_COLOR_MAX_AGE =
  hasOpt("stable-triangle-color-max-age") || hasOpt("stableTriangleColorMaxAge");
const STABLE_TRIANGLE_COLOR_MAX_AGE = optNum(
  "stable-triangle-color-max-age",
  optNum("stableTriangleColorMaxAge", 0),
);
const HAS_STABLE_TRIANGLE_COLOR_MAX_STEP =
  hasOpt("stable-triangle-color-max-step") || hasOpt("stableTriangleColorMaxStep");
const STABLE_TRIANGLE_COLOR_MAX_STEP = optNum(
  "stable-triangle-color-max-step",
  optNum("stableTriangleColorMaxStep", 0),
);
const HAS_STABLE_TRIANGLE_MATRIX_DECIMALS =
  hasOpt("stable-triangle-matrix-decimals") || hasOpt("stableTriangleMatrixDecimals");
const STABLE_TRIANGLE_MATRIX_DECIMALS = optNum(
  "stable-triangle-matrix-decimals",
  optNum("stableTriangleMatrixDecimals", 3),
);
const STABLE_TRIANGLE_COLOR_STEPS_LABEL = HAS_STABLE_TRIANGLE_COLOR_STEPS
  ? String(STABLE_TRIANGLE_COLOR_STEPS)
  : `auto(${DEFAULT_STABLE_TRIANGLE_COLOR_STEPS})`;
const STABLE_TRIANGLE_COLOR_POLICY_LABEL = HAS_STABLE_TRIANGLE_COLOR_POLICY
  ? STABLE_TRIANGLE_COLOR_POLICY
  : `auto(${DEFAULT_STABLE_TRIANGLE_COLOR_POLICY})`;
const STABLE_TRIANGLE_COLOR_FREEZE_FRAMES_LABEL = HAS_STABLE_TRIANGLE_COLOR_FREEZE_FRAMES
  ? String(STABLE_TRIANGLE_COLOR_FREEZE_FRAMES)
  : `auto(${DEFAULT_STABLE_TRIANGLE_COLOR_FREEZE_FRAMES})`;
const STABLE_TRIANGLE_COLOR_BUDGET_LABEL = HAS_STABLE_TRIANGLE_COLOR_BUDGET
  ? String(STABLE_TRIANGLE_COLOR_BUDGET)
  : `auto(${DEFAULT_STABLE_TRIANGLE_COLOR_BUDGET} adaptive)`;
const STABLE_TRIANGLE_COLOR_MAX_AGE_LABEL = HAS_STABLE_TRIANGLE_COLOR_MAX_AGE
  ? String(STABLE_TRIANGLE_COLOR_MAX_AGE)
  : `auto(${DEFAULT_STABLE_TRIANGLE_COLOR_MAX_AGE} adaptive)`;
const STABLE_TRIANGLE_COLOR_MAX_STEP_LABEL = HAS_STABLE_TRIANGLE_COLOR_MAX_STEP
  ? String(STABLE_TRIANGLE_COLOR_MAX_STEP)
  : `auto(${DEFAULT_STABLE_TRIANGLE_COLOR_MAX_STEP})`;
const STABLE_TRIANGLE_MATRIX_DECIMALS_LABEL = HAS_STABLE_TRIANGLE_MATRIX_DECIMALS
  ? String(STABLE_TRIANGLE_MATRIX_DECIMALS)
  : "auto(3)";
const CHROMIUM_ARGS = chromiumArgsWithGpuDefault([
  ...optAll("chromium-arg"),
  ...optAll("chromium-args").flatMap((value) => value.split(/\s+/).filter(Boolean)),
], { softwareBackend: SOFTWARE_BACKEND });

const MODES = optStr("mode", "baked")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean)
  .map((value) => value === "dynamic" ? "dynamic" : "baked");
const STABLE_DOM_VARIANTS = hasFlag("compare-stable-dom")
  ? [true, false]
  : [!hasFlag("no-stable-dom")];
const STABLE_TRIANGLE_DEBUG_VARIANTS = COMPARE_STABLE_TRIANGLE_DEBUG
  ? ["", "transform-only", "plan-only"]
  : [STABLE_TRIANGLE_DEBUG].filter((value) =>
      value === "" || value === "transform-only" || value === "plan-only"
    );
const VALID_ANIMATION_DRIVERS = [
  "js",
  "css-keyframes",
  "js-style-cache",
  "typed-om-style-cache",
  "progressive-style-cache",
];
const ANIMATION_DRIVER_VARIANTS = COMPARE_ANIMATION_DRIVER
  ? ["js", "progressive-style-cache", "js-style-cache", "css-keyframes"]
  : [VALID_ANIMATION_DRIVERS.includes(ANIMATION_DRIVER)
      ? ANIMATION_DRIVER
      : "js"];
const ANIMATION_FRAME_CACHE_VARIANTS = COMPARE_ANIMATION_FRAME_CACHE
  ? [false, true]
  : [ANIMATION_FRAME_CACHE];
const ANIMATED_MESH_OPTIMIZATION_VARIANTS = COMPARE_ANIMATED_MESH_OPTIMIZATION
  ? [false, true]
  : [hasFlag("animated-mesh-optimization") || hasFlag("animatedMeshOptimization")];

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".glb": "model/gltf-binary",
  ".gltf": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
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
        const abs = safe.startsWith("/gallery/")
          ? resolve(galleryDir, safe.slice("/gallery/".length))
          : resolve(benchDir, safe === "/" ? "animated-human.html" : safe.slice(1));
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

function quantile(values, q) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (sorted.length === 0) return 0;
  const i = (sorted.length - 1) * q;
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
}

function summarizeFrameTimes(samples) {
  const dtsRaw = samples.map((sample) => sample.dt).filter((dt) => dt > 0);
  const dts = dtsRaw.filter((dt) => dt < 2000);
  const p50 = quantile(dts, 0.5);
  const p95 = quantile(dts, 0.95);
  const p99 = quantile(dts, 0.99);
  return {
    fps_p50: p50 > 0 ? +(1000 / p50).toFixed(2) : 0,
    fps_p95: p95 > 0 ? +(1000 / p95).toFixed(2) : 0,
    frame_time_p50_ms: +p50.toFixed(3),
    frame_time_p95_ms: +p95.toFixed(3),
    frame_time_p99_ms: +p99.toFixed(3),
    sample_count: dts.length,
    sample_count_raw: dtsRaw.length,
    sample_count_filtered: dtsRaw.length - dts.length,
  };
}

function summarizeDurations(samples, key) {
  const values = samples
    .map((sample) => Number(sample?.[key]))
    .filter((value) => Number.isFinite(value) && value >= 0);
  if (values.length === 0) {
    return { p50_ms: 0, p95_ms: 0, p99_ms: 0, avg_ms: 0, max_ms: 0 };
  }
  const sum = values.reduce((acc, value) => acc + value, 0);
  return {
    p50_ms: +quantile(values, 0.5).toFixed(3),
    p95_ms: +quantile(values, 0.95).toFixed(3),
    p99_ms: +quantile(values, 0.99).toFixed(3),
    avg_ms: +(sum / values.length).toFixed(3),
    max_ms: +Math.max(...values).toFixed(3),
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

  const get = (...names) => {
    let count = 0;
    let durationUs = 0;
    for (const name of names) {
      const entry = byName.get(name);
      if (!entry) continue;
      count += entry.count;
      durationUs += entry.durationUs;
    }
    return { count, duration_ms: +(durationUs / 1000).toFixed(3) };
  };

  return {
    eventCount: events.length,
    completeEventCount,
    totalCompleteDurationMs: +(totalDurationUs / 1000).toFixed(3),
    groups: {
      style: get("UpdateLayoutTree", "RecalculateStyles"),
      layout: get("Layout"),
      prePaint: get("PrePaint"),
      paint: get("Paint"),
      raster: get("RasterTask", "ImageDecodeTask", "Decode Image"),
      script: get("FunctionCall", "EvaluateScript", "EventDispatch", "TimerFire", "FireAnimationFrame"),
      compositorMain: get(
        "ProxyMain::BeginMainFrame",
        "WebFrameWidgetImpl::UpdateLifecycle",
        "PaintArtifactCompositor::Update",
        "Layerize",
        "Commit",
        "ProxyImpl::ReadyToCommit",
      ),
      compositorImpl: get(
        "LayerTreeImpl::UpdateDrawProperties",
        "LayerTreeHostImpl::PrepareToDraw",
        "MainFrame.Draw",
        "SubmitCompositorFrame",
      ),
    },
    topEvents: [...byName.entries()]
      .sort((a, b) => b[1].durationUs - a[1].durationUs)
      .slice(0, 16)
      .map(([name, entry]) => ({
        name,
        count: entry.count,
        duration_ms: +(entry.durationUs / 1000).toFixed(3),
      })),
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
  return summarizeTraceEvents(events);
}

function cpuFrameLabel(callFrame) {
  const fn = callFrame?.functionName || "(anonymous)";
  const url = callFrame?.url ? callFrame.url.split("/").pop() : "";
  const line = Number.isFinite(callFrame?.lineNumber) ? callFrame.lineNumber + 1 : 0;
  return url ? `${fn} (${url}:${line})` : fn;
}

function summarizeCpuProfile(profile) {
  const nodeById = new Map();
  for (const node of profile?.nodes ?? []) nodeById.set(node.id, node);
  const samples = profile?.samples ?? [];
  const deltas = profile?.timeDeltas ?? [];
  const fallbackDeltaUs = samples.length > 0 && Number.isFinite(profile?.endTime) && Number.isFinite(profile?.startTime)
    ? ((profile.endTime - profile.startTime) * 1000) / samples.length
    : 0;

  let totalUs = 0;
  const byFrame = new Map();
  for (let i = 0; i < samples.length; i += 1) {
    const node = nodeById.get(samples[i]);
    if (!node) continue;
    const deltaUs = Number.isFinite(deltas[i]) ? deltas[i] : fallbackDeltaUs;
    totalUs += deltaUs;
    const label = cpuFrameLabel(node.callFrame);
    const entry = byFrame.get(label) ?? {
      frame: label,
      functionName: node.callFrame?.functionName || "(anonymous)",
      url: node.callFrame?.url || "",
      line: Number.isFinite(node.callFrame?.lineNumber) ? node.callFrame.lineNumber + 1 : null,
      column: Number.isFinite(node.callFrame?.columnNumber) ? node.callFrame.columnNumber + 1 : null,
      self_ms: 0,
      samples: 0,
    };
    entry.self_ms += deltaUs / 1000;
    entry.samples += 1;
    byFrame.set(label, entry);
  }

  const topSelf = [...byFrame.values()]
    .sort((a, b) => b.self_ms - a.self_ms)
    .slice(0, 24)
    .map((entry) => ({
      ...entry,
      self_ms: +entry.self_ms.toFixed(3),
      self_pct: totalUs > 0 ? +((entry.self_ms * 1000 / totalUs) * 100).toFixed(2) : 0,
    }));

  return {
    samples: samples.length,
    total_ms: +(totalUs / 1000).toFixed(3),
    topSelf,
  };
}

async function startCpuProfile(cdp) {
  await cdp.send("Profiler.enable");
  await cdp.send("Profiler.setSamplingInterval", { interval: 100 });
  await cdp.send("Profiler.start");
}

async function stopCpuProfile(cdp) {
  const { profile } = await cdp.send("Profiler.stop");
  return summarizeCpuProfile(profile);
}

function scenarioKey({
  mode,
  stableDom,
  stableTriangleDebug,
  animationDriver,
  animationFrameCache,
  animatedMeshOptimization,
  run,
}) {
  const stable = stableDom ? "stable" : "remount";
  const debugSuffix = COMPARE_STABLE_TRIANGLE_DEBUG || stableTriangleDebug
    ? `.${stableTriangleDebug || "normal"}`
    : "";
  const driverSuffix = COMPARE_ANIMATION_DRIVER || animationDriver !== "js"
    ? `.${animationDriver}`
    : "";
  const frameCacheSuffix = animationFrameCache ? ".framecache" : "";
  const meshOptSuffix = animatedMeshOptimization ? ".meshopt" : "";
  return RUNS > 1
    ? `${mode}.${stable}${debugSuffix}${driverSuffix}${frameCacheSuffix}${meshOptSuffix}.r${run + 1}`
    : `${mode}.${stable}${debugSuffix}${driverSuffix}${frameCacheSuffix}${meshOptSuffix}`;
}

function buildUrl(port, scenario) {
  const params = new URLSearchParams({
    mesh: MESH,
    clip: CLIP,
    mode: scenario.mode,
    stableDom: scenario.stableDom ? "1" : "0",
    animationDriver: scenario.animationDriver,
    animationFrameCache: scenario.animationFrameCache ? "1" : "0",
    animationFrameCacheFrames: String(ANIMATION_FRAME_CACHE_FRAMES),
    keyframeSamples: String(KEYFRAME_SAMPLES),
    animatedMeshOptimization: scenario.animatedMeshOptimization ? "1" : "0",
    targetSize: String(TARGET_SIZE),
    timeScale: String(TIME_SCALE),
    solidTextureSamples: SOLID_TEXTURE_SAMPLES ? "1" : "0",
  });
  if (DISABLE_STRATEGIES) params.set("disableStrategies", DISABLE_STRATEGIES);
  if (scenario.stableTriangleDebug) params.set("stableTriangleDebug", scenario.stableTriangleDebug);
  if (HAS_STABLE_TRIANGLE_COLOR_POLICY) {
    params.set("stableTriangleColorPolicy", STABLE_TRIANGLE_COLOR_POLICY);
  }
  if (HAS_STABLE_TRIANGLE_COLOR_STEPS) {
    params.set("stableTriangleColorSteps", String(STABLE_TRIANGLE_COLOR_STEPS));
  }
  if (HAS_STABLE_TRIANGLE_COLOR_FREEZE_FRAMES) {
    params.set("stableTriangleColorFreezeFrames", String(STABLE_TRIANGLE_COLOR_FREEZE_FRAMES));
  }
  if (
    HAS_STABLE_TRIANGLE_COLOR_BUDGET ||
    STABLE_TRIANGLE_COLOR_POLICY === "adaptive"
  ) {
    params.set(
      "stableTriangleColorBudget",
      String(STABLE_TRIANGLE_COLOR_BUDGET || DEFAULT_STABLE_TRIANGLE_COLOR_BUDGET),
    );
  }
  if (
    HAS_STABLE_TRIANGLE_COLOR_MAX_AGE ||
    STABLE_TRIANGLE_COLOR_POLICY === "adaptive"
  ) {
    params.set(
      "stableTriangleColorMaxAge",
      String(STABLE_TRIANGLE_COLOR_MAX_AGE || DEFAULT_STABLE_TRIANGLE_COLOR_MAX_AGE),
    );
  }
  if (HAS_STABLE_TRIANGLE_COLOR_MAX_STEP) {
    params.set("stableTriangleColorMaxStep", String(STABLE_TRIANGLE_COLOR_MAX_STEP));
  }
  if (HAS_STABLE_TRIANGLE_MATRIX_DECIMALS) {
    params.set("stableTriangleMatrixDecimals", String(STABLE_TRIANGLE_MATRIX_DECIMALS));
  }
  return `http://127.0.0.1:${port}/animated-human.html?${params.toString()}`;
}

async function runScenario(port, scenario) {
  const launchOptions = { headless: !HEADED, args: CHROMIUM_ARGS };
  if (BROWSER_EXECUTABLE) launchOptions.executablePath = BROWSER_EXECUTABLE;
  const browser = await chromium.launch(launchOptions);
  try {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await ctx.newPage();
    const url = buildUrl(port, scenario);

    await page.goto(url, { waitUntil: "load" });
    await page.waitForFunction(() => window.__perf__?.ready === true, null, { timeout: 45000 });
    await page.waitForTimeout(WARMUP_MS);

    const cdp = TRACE || PROFILE ? await ctx.newCDPSession(page) : null;
    let traceEvents = null;
    let metricsBefore = null;
    if (cdp) {
      if (PROFILE) await startCpuProfile(cdp);
      if (TRACE) traceEvents = await startTrace(cdp);
      metricsBefore = await cdp.send("Performance.getMetrics");
    }

    const startIndexes = await page.evaluate(() => ({
      samples: window.__perf__.samples.length,
      animationSamples: window.__perf__.animationSamples.length,
    }));
    await page.waitForTimeout(SAMPLE_MS);

    const metricsAfter = cdp ? await cdp.send("Performance.getMetrics") : null;
    const trace = cdp && TRACE ? await stopTrace(cdp, traceEvents) : null;
    const cpuProfile = cdp && PROFILE ? await stopCpuProfile(cdp) : null;
    const pageResult = await page.evaluate((from) => ({
      samples: window.__perf__.samples.slice(from.samples),
      animationSamples: window.__perf__.animationSamples.slice(from.animationSamples),
      polyCount: window.__perf__.polyCount,
      renderStats: window.__perf__.renderStats,
      animation: window.__perf__.animation,
    }), startIndexes);

    await ctx.close();

    return {
      ...summarizeFrameTimes(pageResult.samples),
      animation_update: summarizeDurations(pageResult.animationSamples, "updateMs"),
      set_polygons: summarizeDurations(pageResult.animationSamples, "setPolygonsMs"),
      sample_and_mixer: summarizeDurations(pageResult.animationSamples, "nonSetPolygonsMs"),
      animation_sample_count: pageResult.animationSamples.length,
      polyCount: pageResult.polyCount,
      renderStats: pageResult.renderStats,
      animation: pageResult.animation,
      trace,
      cpuProfile,
      performanceMetrics: metricsBefore && metricsAfter
        ? diffPerformanceMetrics(metricsBefore, metricsAfter)
        : null,
    };
  } finally {
    await browser.close();
  }
}

const scenarios = [];
for (const mode of MODES) {
  for (const stableDom of STABLE_DOM_VARIANTS) {
    for (const stableTriangleDebug of STABLE_TRIANGLE_DEBUG_VARIANTS) {
      for (const animationDriver of ANIMATION_DRIVER_VARIANTS) {
        for (const animationFrameCache of ANIMATION_FRAME_CACHE_VARIANTS) {
          for (const animatedMeshOptimization of ANIMATED_MESH_OPTIMIZATION_VARIANTS) {
            for (let run = 0; run < RUNS; run += 1) {
              scenarios.push({
                mode,
                stableDom,
                stableTriangleDebug,
                animationDriver,
                animationFrameCache,
                animatedMeshOptimization,
                run,
              });
            }
          }
        }
      }
    }
  }
}

console.log(`[animated-human] mesh=${MESH} clip=${CLIP} targetSize=${TARGET_SIZE} warmup=${WARMUP_MS}ms sample=${SAMPLE_MS}ms animatedMeshOptimization=${ANIMATED_MESH_OPTIMIZATION_VARIANTS.join(",")} animationDriver=${ANIMATION_DRIVER_VARIANTS.join(",")} animationFrameCache=${ANIMATION_FRAME_CACHE_VARIANTS.join(",")} animationFrameCacheFrames=${ANIMATION_FRAME_CACHE_FRAMES} keyframeSamples=${KEYFRAME_SAMPLES} stableTriangleDebug=${STABLE_TRIANGLE_DEBUG_VARIANTS.map((value) => value || "normal").join(",")} colorPolicy=${STABLE_TRIANGLE_COLOR_POLICY_LABEL} colorSteps=${STABLE_TRIANGLE_COLOR_STEPS_LABEL} colorFreezeFrames=${STABLE_TRIANGLE_COLOR_FREEZE_FRAMES_LABEL} colorBudget=${STABLE_TRIANGLE_COLOR_BUDGET_LABEL} colorMaxAge=${STABLE_TRIANGLE_COLOR_MAX_AGE_LABEL} colorMaxStep=${STABLE_TRIANGLE_COLOR_MAX_STEP_LABEL} matrixDecimals=${STABLE_TRIANGLE_MATRIX_DECIMALS_LABEL}`);
if (BROWSER_EXECUTABLE) console.log(`[animated-human] browser=${BROWSER_EXECUTABLE}`);
if (SOFTWARE_BACKEND) console.log("[animated-human] software backend=on");
if (CHROMIUM_ARGS.length > 0) console.log(`[animated-human] chromium args=${CHROMIUM_ARGS.join(" ")}`);
if (TRACE) console.log("[animated-human] trace=on");
if (PROFILE) console.log("[animated-human] profile=on");
if (REQUIRE_SOLID_TRIANGLES) console.log("[animated-human] require solid triangle path=on");

const { server, port } = await startServer();
console.log(`[animated-human] server :${port}`);

try {
  const results = {};
  for (const scenario of scenarios) {
    const key = scenarioKey(scenario);
    process.stdout.write(`  ${key.padEnd(30)}`);
    const result = await runScenario(port, scenario);
    const polygonStats = result.renderStats?.polygons;
    const tags = result.renderStats?.dom?.tags;
    if (
      REQUIRE_SOLID_TRIANGLES &&
      (
        result.polyCount <= 0 ||
        polygonStats?.solidTriangles !== result.polyCount ||
        tags?.u !== result.polyCount
      )
    ) {
      throw new Error(
        `${key} left the baked solid triangle path: ` +
        `polygons solid/textured=${polygonStats?.solid ?? "?"}/${polygonStats?.textured ?? "?"}, ` +
        `tags b/i/s/u/q=${tags?.b ?? "?"}/${tags?.i ?? "?"}/${tags?.s ?? "?"}/${tags?.u ?? "?"}/${tags?.q ?? "?"}`,
      );
    }
    results[key] = result;
    const tagNote = tags ? ` tags b/i/s/u/q=${tags.b}/${tags.i}/${tags.s}/${tags.u}/${tags.q}` : "";
    const traceNote = result.trace?.groups
      ? ` trace script/style/paint/comp=${result.trace.groups.script.duration_ms.toFixed(1)}/${result.trace.groups.style.duration_ms.toFixed(1)}/${result.trace.groups.paint.duration_ms.toFixed(1)}/${(result.trace.groups.compositorMain.duration_ms + result.trace.groups.compositorImpl.duration_ms).toFixed(1)}ms`
      : "";
    const profileTop = result.cpuProfile?.topSelf?.[0];
    const profileNote = profileTop
      ? ` profile top=${profileTop.functionName || profileTop.frame} ${profileTop.self_ms.toFixed(1)}ms`
      : "";
    process.stdout.write(
      `p50=${result.fps_p50.toFixed(1).padStart(5)}fps ` +
      `p95=${result.fps_p95.toFixed(1).padStart(5)}fps ` +
      `update p50=${result.animation_update.p50_ms.toFixed(2)}ms ` +
      `setPolys p50=${result.set_polygons.p50_ms.toFixed(2)}ms ` +
      `clip=${result.animation?.clip?.name ?? "?"}${tagNote}${traceNote}${profileNote}\n`,
    );
  }

  const out = {
    mesh: MESH,
    clip: CLIP,
    targetSize: TARGET_SIZE,
    timeScale: TIME_SCALE,
    solidTextureSamples: SOLID_TEXTURE_SAMPLES,
    compareAnimatedMeshOptimization: COMPARE_ANIMATED_MESH_OPTIMIZATION,
    compareAnimationDriver: COMPARE_ANIMATION_DRIVER,
    compareAnimationFrameCache: COMPARE_ANIMATION_FRAME_CACHE,
    animatedMeshOptimization: ANIMATED_MESH_OPTIMIZATION_VARIANTS.length === 1
      ? ANIMATED_MESH_OPTIMIZATION_VARIANTS[0]
      : "compare",
    animationDriver: ANIMATION_DRIVER_VARIANTS.length === 1 ? ANIMATION_DRIVER_VARIANTS[0] : "compare",
    animationFrameCache: ANIMATION_FRAME_CACHE_VARIANTS.length === 1
      ? ANIMATION_FRAME_CACHE_VARIANTS[0]
      : "compare",
    animationFrameCacheFrames: ANIMATION_FRAME_CACHE_FRAMES,
    keyframeSamples: KEYFRAME_SAMPLES,
    stableTriangleDebug: STABLE_TRIANGLE_DEBUG || null,
    stableTriangleColorPolicy: HAS_STABLE_TRIANGLE_COLOR_POLICY
      ? STABLE_TRIANGLE_COLOR_POLICY
      : "auto",
    stableTriangleColorSteps: HAS_STABLE_TRIANGLE_COLOR_STEPS
      ? (STABLE_TRIANGLE_COLOR_STEPS > 1 ? STABLE_TRIANGLE_COLOR_STEPS : null)
      : "auto",
    defaultStableTriangleColorSteps: DEFAULT_STABLE_TRIANGLE_COLOR_STEPS,
    defaultStableTriangleColorPolicy: DEFAULT_STABLE_TRIANGLE_COLOR_POLICY,
    stableTriangleColorFreezeFrames: HAS_STABLE_TRIANGLE_COLOR_FREEZE_FRAMES
      ? STABLE_TRIANGLE_COLOR_FREEZE_FRAMES
      : "auto",
    defaultStableTriangleColorFreezeFrames: DEFAULT_STABLE_TRIANGLE_COLOR_FREEZE_FRAMES,
    stableTriangleColorBudget: HAS_STABLE_TRIANGLE_COLOR_BUDGET
      ? (STABLE_TRIANGLE_COLOR_BUDGET > 0 ? STABLE_TRIANGLE_COLOR_BUDGET : null)
      : "auto",
    defaultStableTriangleColorBudget: DEFAULT_STABLE_TRIANGLE_COLOR_BUDGET,
    stableTriangleColorMaxAge: HAS_STABLE_TRIANGLE_COLOR_MAX_AGE
      ? (STABLE_TRIANGLE_COLOR_MAX_AGE > 0 ? STABLE_TRIANGLE_COLOR_MAX_AGE : null)
      : "auto",
    defaultStableTriangleColorMaxAge: DEFAULT_STABLE_TRIANGLE_COLOR_MAX_AGE,
    stableTriangleColorMaxStep: HAS_STABLE_TRIANGLE_COLOR_MAX_STEP
      ? (STABLE_TRIANGLE_COLOR_MAX_STEP > 0 ? STABLE_TRIANGLE_COLOR_MAX_STEP : null)
      : "auto",
    defaultStableTriangleColorMaxStep: DEFAULT_STABLE_TRIANGLE_COLOR_MAX_STEP,
    stableTriangleMatrixDecimals: HAS_STABLE_TRIANGLE_MATRIX_DECIMALS
      ? STABLE_TRIANGLE_MATRIX_DECIMALS
      : "auto",
    compareStableTriangleDebug: COMPARE_STABLE_TRIANGLE_DEBUG,
    requireSolidTriangles: REQUIRE_SOLID_TRIANGLES,
    disableStrategies: DISABLE_STRATEGIES || null,
    browserExecutable: BROWSER_EXECUTABLE || null,
    chromiumArgs: CHROMIUM_ARGS,
    softwareBackend: SOFTWARE_BACKEND,
    warmup_ms: WARMUP_MS,
    sample_ms: SAMPLE_MS,
    results,
  };

  const outputPath = JSON_PATH || (LABEL ? resolve(repoRoot, "bench/results", `${LABEL}.json`) : "");
  if (outputPath) {
    mkdirSync(dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, JSON.stringify(out, null, 2) + "\n");
    console.log(`[animated-human] wrote ${outputPath}`);
  }

  console.log(JSON.stringify(out, null, 2));
} finally {
  await stopServer(server);
}
