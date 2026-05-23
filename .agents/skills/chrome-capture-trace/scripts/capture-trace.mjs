#!/usr/bin/env node
import { mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";

const argv = process.argv.slice(2);

function flag(name) {
  return argv.indexOf(`--${name}`);
}

function hasFlag(name) {
  return flag(name) >= 0 || argv.includes(`--${name}=true`);
}

function optStr(name, dflt = "") {
  const exact = flag(name);
  if (exact >= 0) return argv[exact + 1] ?? dflt;
  const prefixed = argv.find((arg) => arg.startsWith(`--${name}=`));
  return prefixed ? prefixed.slice(name.length + 3) : dflt;
}

function optNum(name, dflt) {
  const raw = optStr(name);
  if (!raw) return dflt;
  const value = Number(raw);
  return Number.isFinite(value) ? value : dflt;
}

function optAll(name) {
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
}

const HELP = hasFlag("help") || hasFlag("h");
const URL = optStr("url");
const ACTION = optStr("action", "wait");
const SELECTOR = optStr("selector", "body");
const READY_JS = optStr("ready-js");
const WAIT_FOR_SELECTOR = optStr("wait-for-selector");
const EVAL_BODY = optStr("eval");
const WARMUP_MS = optNum("warmup", 1000);
const SAMPLE_MS = optNum("sample", 1500);
const DURATION_MS = optNum("duration", 1000);
const SETTLE_MS = optNum("settle", 250);
const STEPS = Math.max(1, Math.round(optNum("steps", 60)));
const VIEWPORT = optStr("viewport", "1280x800");
const TRACE_OUT = optStr("trace-out", "chrome-trace.json");
const SUMMARY_OUT = optStr("summary-out", "chrome-trace-summary.json");
const BROWSER_EXECUTABLE = optStr("browser-executable");
const HEADLESS = !hasFlag("headed");
const CHROMIUM_ARGS = optAll("chromium-arg");
const MARK_START = "__chrome_capture_trace_start__";
const MARK_END = "__chrome_capture_trace_end__";

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
  gpuViz: [
    "Graphics.Pipeline",
    "DisplayScheduler::DrawAndSwap",
    "DirectRenderer::DrawFrame",
    "DirectRenderer::DrawRenderPass",
  ],
};

function printHelp() {
  console.log(`Usage:
  node scripts/capture-trace.mjs --url <url> [options]

Options:
  --url <url>                  Page to open.
  --ready-js <expr>            Wait until this page expression is truthy.
  --wait-for-selector <sel>    Wait for a selector before warmup.
  --warmup <ms>                Warmup before tracing. Default: 1000
  --settle <ms>                Wait after the action before stopping. Default: 250
  --viewport <WxH>             Viewport. Default: 1280x800
  --action <kind>              wait | drag | click | scroll | eval. Default: wait
  --sample <ms>                Wait-action duration. Default: 1500
  --selector <sel>             Target selector for drag/click. Default: body
  --drag <dx,dy>               Drag delta in CSS pixels. Default: 400,0
  --scroll <dx,dy>             Mouse wheel delta. Default: 0,800
  --duration <ms>              Drag duration. Default: 1000
  --steps <n>                  Drag steps. Default: 60
  --eval <body>                JavaScript body for action=eval.
  --trace-out <file>           Raw trace output. Default: chrome-trace.json
  --summary-out <file>         Summary JSON output. Default: chrome-trace-summary.json
  --browser-executable <path>  Use a specific Chrome/Chromium executable.
  --chromium-arg <arg>         Extra Chromium arg, repeatable.
  --headed                     Run headed.
`);
}

function parsePair(value, fallback) {
  const [a, b] = String(value || "").split(",").map((part) => Number(part.trim()));
  return {
    x: Number.isFinite(a) ? a : fallback.x,
    y: Number.isFinite(b) ? b : fallback.y,
  };
}

function parseViewport(value) {
  const match = /^(\d+)x(\d+)$/i.exec(value);
  if (!match) return { width: 1280, height: 800 };
  return { width: Number(match[1]), height: Number(match[2]) };
}

function quantile(values, q) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const index = (sorted.length - 1) * q;
  const lo = Math.floor(index);
  const hi = Math.ceil(index);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (index - lo);
}

function addDuration(map, name, durationMs) {
  const entry = map.get(name) ?? { count: 0, durationMs: 0 };
  entry.count += 1;
  entry.durationMs += durationMs;
  map.set(name, entry);
}

function serializeTotals(map, limit = 20) {
  return [...map.entries()]
    .map(([name, entry]) => ({
      name,
      count: entry.count,
      duration_ms: +entry.durationMs.toFixed(4),
    }))
    .sort((a, b) => b.duration_ms - a.duration_ms)
    .slice(0, limit);
}

function findTraceMark(events, name) {
  return events.find((event) => event?.name === name && Number.isFinite(event?.args?.data?.startTime)) ??
    events.find((event) => event?.name === "TimeStamp" && event?.args?.data?.message === name);
}

function eventPerfNow(event, tracePerfOffsetMs) {
  return ((event.ts + (event.dur ?? 0) / 2) / 1000) - tracePerfOffsetMs;
}

function framesFromSamples(samples, startPerfNow, endPerfNow) {
  return samples
    .filter((sample) => Number.isFinite(sample?.dt) && sample.dt > 0 && sample.dt < 2000)
    .filter((sample) => sample.t - sample.dt >= startPerfNow && sample.t <= endPerfNow)
    .map((sample, index) => ({
      index,
      start: sample.t - sample.dt,
      end: sample.t,
      dt: sample.dt,
      groups: new Map(),
      events: new Map(),
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

function summarizeFrames(frames) {
  const dts = frames.map((frame) => frame.dt);
  const p50 = quantile(dts, 0.5) ?? 0;
  const p95 = quantile(dts, 0.95) ?? 0;
  const p99 = quantile(dts, 0.99) ?? 0;
  return {
    count: frames.length,
    fps_p50: p50 > 0 ? +(1000 / p50).toFixed(2) : 0,
    frame_time_p50_ms: +p50.toFixed(3),
    frame_time_p95_ms: +p95.toFixed(3),
    frame_time_p99_ms: +p99.toFixed(3),
  };
}

function summarizeEvents(events, tracePerfOffsetMs, startPerfNow, endPerfNow, frames) {
  const eventToGroup = new Map();
  for (const [group, names] of Object.entries(EVENT_GROUPS)) {
    for (const name of names) eventToGroup.set(name, group);
  }

  const groupTotals = new Map();
  const eventTotals = new Map();
  let completeEventCount = 0;
  let completeDurationMs = 0;

  for (const event of events) {
    if (event?.ph !== "X" || typeof event.dur !== "number" || !Number.isFinite(event.ts)) continue;
    const perfNow = eventPerfNow(event, tracePerfOffsetMs);
    if (perfNow < startPerfNow || perfNow > endPerfNow) continue;
    const durationMs = event.dur / 1000;
    completeEventCount += 1;
    completeDurationMs += durationMs;
    addDuration(eventTotals, event.name, durationMs);
    const group = eventToGroup.get(event.name);
    if (group) addDuration(groupTotals, group, durationMs);

    const frameIndex = frameIndexAt(frames, perfNow);
    if (frameIndex >= 0) {
      const frame = frames[frameIndex];
      addDuration(frame.events, event.name, durationMs);
      if (group) addDuration(frame.groups, group, durationMs);
    }
  }

  const frameDetails = frames
    .map((frame) => ({
      index: frame.index,
      start_ms: +frame.start.toFixed(3),
      end_ms: +frame.end.toFixed(3),
      dt_ms: +frame.dt.toFixed(3),
      groups: Object.fromEntries(
        Object.keys(EVENT_GROUPS).map((group) => [group, +(frame.groups.get(group)?.durationMs ?? 0).toFixed(4)]),
      ),
      topEvents: serializeTotals(frame.events, 8),
    }))
    .sort((a, b) => b.dt_ms - a.dt_ms)
    .slice(0, 12);

  return {
    complete_event_count: completeEventCount,
    complete_duration_ms: +completeDurationMs.toFixed(3),
    groups: Object.fromEntries(
      Object.keys(EVENT_GROUPS).map((group) => {
        const total = groupTotals.get(group);
        return [group, {
          count: total?.count ?? 0,
          duration_ms: +(total?.durationMs ?? 0).toFixed(4),
          ms_per_frame: frames.length ? +((total?.durationMs ?? 0) / frames.length).toFixed(4) : null,
        }];
      }),
    ),
    topEvents: serializeTotals(eventTotals, 30),
    slowestFrames: frameDetails,
  };
}

async function startRafSampler(page) {
  return page.evaluate(() => {
    window.__chromeCaptureTraceSamples = [];
    window.__chromeCaptureTraceSampling = true;
    let last = performance.now();
    const tick = (now) => {
      window.__chromeCaptureTraceSamples.push({ t: now, dt: now - last });
      last = now;
      if (window.__chromeCaptureTraceSampling) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

async function stopRafSampler(page) {
  return page.evaluate(() => {
    window.__chromeCaptureTraceSampling = false;
    return window.__chromeCaptureTraceSamples ?? [];
  });
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
  const done = new Promise((resolveDone) => cdp.once("Tracing.tracingComplete", resolveDone));
  await cdp.send("Tracing.end");
  await done;
}

async function mark(page, name) {
  return page.evaluate((markName) => {
    performance.mark(markName);
    console.timeStamp(markName);
    return performance.now();
  }, name);
}

async function performAction(page) {
  if (ACTION === "wait") {
    await page.waitForTimeout(SAMPLE_MS);
    return { kind: ACTION, sample_ms: SAMPLE_MS };
  }

  if (ACTION === "click") {
    await page.locator(SELECTOR).click();
    return { kind: ACTION, selector: SELECTOR };
  }

  if (ACTION === "scroll") {
    const delta = parsePair(optStr("scroll"), { x: 0, y: 800 });
    await page.mouse.wheel(delta.x, delta.y);
    return { kind: ACTION, delta };
  }

  if (ACTION === "eval") {
    if (!EVAL_BODY) throw new Error("--eval is required for --action eval");
    await page.evaluate((body) => {
      return new Function(body)();
    }, EVAL_BODY);
    return { kind: ACTION, eval: EVAL_BODY };
  }

  if (ACTION === "drag") {
    const delta = parsePair(optStr("drag"), { x: 400, y: 0 });
    const box = await page.locator(SELECTOR).boundingBox();
    if (!box) throw new Error(`Could not find a bounding box for selector: ${SELECTOR}`);
    const start = {
      x: box.x + box.width / 2,
      y: box.y + box.height / 2,
    };
    const delayMs = DURATION_MS / STEPS;
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    for (let step = 1; step <= STEPS; step += 1) {
      const t = step / STEPS;
      await page.mouse.move(start.x + delta.x * t, start.y + delta.y * t);
      if (delayMs > 0) await page.waitForTimeout(delayMs);
    }
    await page.mouse.up();
    return {
      kind: ACTION,
      selector: SELECTOR,
      delta,
      duration_ms: DURATION_MS,
      steps: STEPS,
      start: { x: +start.x.toFixed(3), y: +start.y.toFixed(3) },
    };
  }

  throw new Error(`Unknown --action "${ACTION}". Expected wait, drag, click, scroll, or eval.`);
}

async function loadPlaywright() {
  try {
    return await import("playwright");
  } catch (firstError) {
    try {
      const requireFromCwd = createRequire(resolve(process.cwd(), "package.json"));
      return requireFromCwd("playwright");
    } catch (secondError) {
      throw new Error(
        "Could not load Playwright. Run this script from a project that has playwright installed, or install playwright where the skill is located.",
        { cause: secondError ?? firstError },
      );
    }
  }
}

async function run() {
  if (HELP || !URL) {
    printHelp();
    process.exit(URL || HELP ? 0 : 1);
  }

  const { chromium } = await loadPlaywright();
  const viewport = parseViewport(VIEWPORT);
  const launchOptions = { headless: HEADLESS, args: CHROMIUM_ARGS };
  if (BROWSER_EXECUTABLE) launchOptions.executablePath = BROWSER_EXECUTABLE;

  const browser = await chromium.launch(launchOptions);
  try {
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();
    const diagnostics = [];
    page.on("console", (message) => {
      if (message.type() === "error" || message.type() === "warning") {
        diagnostics.push(`[console:${message.type()}] ${message.text()}`);
      }
    });
    page.on("pageerror", (error) => {
      diagnostics.push(`[pageerror] ${error?.stack || error?.message || error}`);
    });

    await page.goto(URL, { waitUntil: "load" });
    if (WAIT_FOR_SELECTOR) await page.waitForSelector(WAIT_FOR_SELECTOR, { timeout: 30000 });
    if (READY_JS) {
      await page.waitForFunction((expr) => Boolean(new Function(`return (${expr});`)()), READY_JS, { timeout: 30000 });
    }
    await page.waitForTimeout(WARMUP_MS);

    const cdp = await context.newCDPSession(page);
    const traceEvents = await startTrace(cdp);
    await startRafSampler(page);
    const startPerfNow = await mark(page, MARK_START);
    const action = await performAction(page);
    await page.waitForTimeout(SETTLE_MS);
    const endPerfNow = await mark(page, MARK_END);
    const samples = await stopRafSampler(page);
    await stopTrace(cdp);

    const startMark = findTraceMark(traceEvents, MARK_START);
    const endMark = findTraceMark(traceEvents, MARK_END);
    const aligned = Boolean(startMark?.args?.data?.startTime && endMark?.args?.data?.startTime);
    const tracePerfOffsetMs = aligned ? (startMark.ts / 1000) - startMark.args.data.startTime : 0;
    const alignedStartPerfNow = aligned ? startMark.args.data.startTime : startPerfNow;
    const alignedEndPerfNow = aligned ? endMark.args.data.startTime : endPerfNow;
    const frames = aligned ? framesFromSamples(samples, alignedStartPerfNow, alignedEndPerfNow) : [];
    const eventSummary = aligned
      ? summarizeEvents(traceEvents, tracePerfOffsetMs, alignedStartPerfNow, alignedEndPerfNow, frames)
      : summarizeEvents(traceEvents, 0, -Infinity, Infinity, frames);

    const summary = {
      kind: "chrome-capture-trace",
      url: URL,
      viewport,
      action,
      warmup_ms: WARMUP_MS,
      settle_ms: SETTLE_MS,
      trace_aligned_to_marks: aligned,
      trace_perf_offset_ms: aligned ? +tracePerfOffsetMs.toFixed(3) : null,
      action_window_ms: +(alignedEndPerfNow - alignedStartPerfNow).toFixed(3),
      frames: summarizeFrames(frames),
      trace: {
        event_count: traceEvents.length,
        ...eventSummary,
      },
      outputFiles: {
        trace: resolve(TRACE_OUT),
        summary: resolve(SUMMARY_OUT),
      },
      diagnostics,
    };

    mkdirSync(dirname(resolve(TRACE_OUT)), { recursive: true });
    writeFileSync(resolve(TRACE_OUT), JSON.stringify({
      traceEvents,
      displayTimeUnit: "ms",
      metadata: {
        source: "chrome-capture-trace/scripts/capture-trace.mjs",
        url: URL,
        action,
      },
    }));

    mkdirSync(dirname(resolve(SUMMARY_OUT)), { recursive: true });
    writeFileSync(resolve(SUMMARY_OUT), `${JSON.stringify(summary, null, 2)}\n`);

    console.log(JSON.stringify(summary, null, 2));
  } finally {
    await browser.close();
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
