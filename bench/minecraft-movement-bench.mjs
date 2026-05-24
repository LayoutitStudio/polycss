#!/usr/bin/env node
import { createServer } from "node:http";
import { mkdirSync, writeFileSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { chromiumArgsWithGpuDefault } from "./chromium-defaults.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");
const vanillaDistDir = resolve(repoRoot, "examples/vanilla/dist");

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
const TARGET_URL = optStr("url");
const MOTION = optStr("motion", "walk-look");
const WARMUP_MS = optNum("warmup", 1500);
const SAMPLE_MS = optNum("sample", 2500);
const SETTLE_MS = optNum("settle", 300);
const STEPS = Math.max(1, Math.round(optNum("steps", 120)));
const VIEWPORT = optStr("viewport", "1280x800");
const TRACE_OUT = optStr("trace-out", "bench/results/minecraft-movement-trace.json");
const SUMMARY_OUT = optStr("summary-out", "bench/results/minecraft-movement-summary.json");
const MARKDOWN_OUT = optStr("markdown-out", "bench/results/minecraft-movement-report.md");
const BROWSER_EXECUTABLE = optStr("browser-executable");
const HEADLESS = !hasFlag("headed");
const SOFTWARE_BACKEND = hasFlag("software-backend");
const CHROMIUM_ARGS = chromiumArgsWithGpuDefault([
  ...optAll("chromium-arg"),
  ...optAll("chromium-args").flatMap((value) => value.split(/\s+/).filter(Boolean)),
], { softwareBackend: SOFTWARE_BACKEND });

const MARK_START = "__minecraft_movement_start__";
const MARK_END = "__minecraft_movement_end__";
const WORLD_MESH_SELECTOR = '[data-poly-mesh-id="polycraft-world"], [data-poly-mesh-id^="polycraft-world-"]';

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

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

function printHelp() {
  console.log(`Usage:
  pnpm bench:minecraft-movement
  node bench/minecraft-movement-bench.mjs [options]

Options:
  --url <url>                  Trace an existing server instead of serving examples/vanilla/dist.
  --motion <kind>              wait | walk | look | walk-look. Default: walk-look
  --warmup <ms>                Warmup before tracing. Default: 1500
  --sample <ms>                Movement window. Default: 2500
  --settle <ms>                Trace settle time after movement. Default: 300
  --steps <n>                  Mouse movement steps. Default: 120
  --viewport <WxH>             Browser viewport. Default: 1280x800
  --trace-out <file>           Raw Chrome trace JSON. Default: bench/results/minecraft-movement-trace.json
  --summary-out <file>         Summary JSON. Default: bench/results/minecraft-movement-summary.json
  --markdown-out <file>        Markdown report. Default: bench/results/minecraft-movement-report.md
  --browser-executable <path>  Use a specific Chrome/Chromium executable.
  --software-backend           Disable the default GPU Chromium args.
  --chromium-arg <arg>         Extra Chromium arg, repeatable.
  --headed                     Run headed.
`);
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

function summarizeFrames(frames, actionWindowMs) {
  const dts = frames.map((frame) => frame.dt);
  const p50 = quantile(dts, 0.5) ?? 0;
  const p95 = quantile(dts, 0.95) ?? 0;
  const p99 = quantile(dts, 0.99) ?? 0;
  const over16 = dts.filter((dt) => dt > 16.7).length;
  const over33 = dts.filter((dt) => dt > 33.3).length;
  return {
    count: frames.length,
    fps_mean: actionWindowMs > 0 ? +(frames.length / (actionWindowMs / 1000)).toFixed(2) : 0,
    fps_p50: p50 > 0 ? +(1000 / p50).toFixed(2) : 0,
    frame_time_p50_ms: +p50.toFixed(3),
    frame_time_p95_ms: +p95.toFixed(3),
    frame_time_p99_ms: +p99.toFixed(3),
    frames_over_16_7_ms: over16,
    frames_over_33_3_ms: over33,
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

  const slowestFrames = frames
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
    slowestFrames,
  };
}

function resolveOutputPath(path) {
  return resolve(repoRoot, path);
}

function safeStaticPath(pathname) {
  const decoded = decodeURIComponent(pathname);
  if (decoded.includes("\0")) return null;
  const normalized = decoded.replace(/\/+/g, "/");
  const filePath = normalized.endsWith("/") ? `${normalized}index.html` : normalized;
  const absolute = resolve(vanillaDistDir, `.${filePath}`);
  if (!absolute.startsWith(`${vanillaDistDir}/`) && absolute !== vanillaDistDir) return null;
  return absolute;
}

async function assertBuiltMinecraftExample() {
  try {
    await stat(resolve(vanillaDistDir, "minecraft/index.html"));
  } catch {
    throw new Error("Missing examples/vanilla/dist/minecraft/index.html. Run `pnpm --filter @layoutit/polycss-examples-vanilla build` first, or pass --url.");
  }
}

function startStaticServer() {
  return new Promise((resolveStart, rejectStart) => {
    const server = createServer(async (req, res) => {
      try {
        const requestUrl = new URL(req.url ?? "/", "http://127.0.0.1");
        const absolute = safeStaticPath(requestUrl.pathname);
        if (!absolute) {
          res.writeHead(403);
          res.end("Forbidden");
          return;
        }
        const data = await readFile(absolute);
        res.writeHead(200, {
          "Content-Type": MIME[extname(absolute).toLowerCase()] || "application/octet-stream",
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
      const address = server.address();
      resolveStart({ server, port: typeof address === "object" ? address.port : 0 });
    });
  });
}

function stopServer(server) {
  return new Promise((resolveStop) => server.close(() => resolveStop()));
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

async function startRafSampler(page) {
  await page.evaluate(() => {
    window.__minecraftBenchSamples = [];
    window.__minecraftBenchSampling = true;
    let last = performance.now();
    const tick = (now) => {
      window.__minecraftBenchSamples.push({ t: now, dt: now - last });
      last = now;
      if (window.__minecraftBenchSampling) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

async function stopRafSampler(page) {
  return page.evaluate(() => {
    window.__minecraftBenchSampling = false;
    return window.__minecraftBenchSamples ?? [];
  });
}

async function startWorldMutationObserver(page) {
  return page.evaluate((worldSelector) => {
    const worlds = [...document.querySelectorAll(worldSelector)];
    const host = document.querySelector("#host");
    if (!worlds.length || !host) return { ok: false };
    const isWorldNode = (node) => {
      return node instanceof Element &&
        (node.matches(worldSelector) || Boolean(node.closest(worldSelector)));
    };
    window.__minecraftBenchWorldMutations = {
      records: 0,
      addedNodes: 0,
      removedNodes: 0,
      attributeChanges: 0,
      characterDataChanges: 0,
    };
    window.__minecraftBenchWorldObserver?.disconnect?.();
    window.__minecraftBenchWorldObserver = new MutationObserver((records) => {
      for (const record of records) {
        const targetIsWorld = isWorldNode(record.target);
        const addedNodes = [...record.addedNodes].filter(isWorldNode).length;
        const removedNodes = [...record.removedNodes].filter(isWorldNode).length;
        if (!targetIsWorld && addedNodes === 0 && removedNodes === 0) continue;
        window.__minecraftBenchWorldMutations.records += 1;
        window.__minecraftBenchWorldMutations.addedNodes += addedNodes;
        window.__minecraftBenchWorldMutations.removedNodes += removedNodes;
        if (record.type === "attributes") window.__minecraftBenchWorldMutations.attributeChanges += 1;
        if (record.type === "characterData") window.__minecraftBenchWorldMutations.characterDataChanges += 1;
      }
    });
    window.__minecraftBenchWorldObserver.observe(host, {
      attributes: false,
      childList: true,
      subtree: true,
      characterData: false,
    });
    return {
      ok: true,
      meshCount: worlds.length,
      leafCount: worlds.reduce((count, world) => count + world.querySelectorAll("b,i,s,u,q").length, 0),
    };
  }, WORLD_MESH_SELECTOR);
}

async function stopWorldMutationObserver(page) {
  return page.evaluate(() => {
    window.__minecraftBenchWorldObserver?.disconnect?.();
    return window.__minecraftBenchWorldMutations ?? null;
  });
}

async function collectPageMetrics(page) {
  return page.evaluate((worldSelector) => {
    const worlds = [...document.querySelectorAll(worldSelector)];
    const outline = document.querySelector('[data-poly-mesh-id="polycraft-outline"]');
    const hand = document.querySelector("#hand");
    const statsOverlay = document.querySelector("#stats-js-overlay");
    const camera = document.querySelector(".polycss-camera");
    const leafSelector = "b,i,s,u,q";
    return {
      playing: document.body.hasAttribute("data-playing"),
      statsText: document.querySelector("#stats")?.textContent?.trim() ?? "",
      worldMeshCount: worlds.length,
      worldLeafCount: worlds.reduce((count, world) => count + world.querySelectorAll(leafSelector).length, 0),
      outlineLeafCount: outline?.querySelectorAll(leafSelector).length ?? 0,
      handLeafCount: hand?.querySelectorAll(leafSelector).length ?? 0,
      statsOverlayPanels: statsOverlay?.children.length ?? 0,
      bodyCursor: getComputedStyle(document.body).cursor,
      hostCursor: getComputedStyle(document.querySelector("#host")).cursor,
      cameraTransformLength: camera?.getAttribute("style")?.length ?? 0,
    };
  }, WORLD_MESH_SELECTOR);
}

async function waitForMinecraftReady(page) {
  await page.waitForSelector("#prompt", { state: "attached", timeout: 30000 });
  await page.waitForSelector("#host", { state: "attached", timeout: 30000 });
  await page.waitForSelector(WORLD_MESH_SELECTOR, { state: "attached", timeout: 30000 });
  await page.waitForFunction((worldSelector) => {
    const worlds = [...document.querySelectorAll(worldSelector)];
    return worlds.some((world) => world.querySelectorAll("b,i,s,u,q").length > 0);
  }, WORLD_MESH_SELECTOR, { timeout: 30000 });
  await page.locator("#prompt").click({ force: true, timeout: 30000 });
  await page.waitForFunction(() => document.body.hasAttribute("data-playing"), null, { timeout: 30000 });
}

async function performMovement(page, motion, sampleMs, steps) {
  if (!["wait", "walk", "look", "walk-look"].includes(motion)) {
    throw new Error(`Unknown --motion "${motion}". Expected wait, walk, look, or walk-look.`);
  }

  const box = await page.locator("#host").boundingBox();
  if (!box) throw new Error("Could not find #host bounding box.");

  const center = {
    x: box.x + box.width / 2,
    y: box.y + box.height / 2,
  };
  const lookX = Math.min(320, box.width * 0.24);
  const lookY = Math.min(72, box.height * 0.09);
  const delayMs = sampleMs / steps;
  const doesWalk = motion === "walk" || motion === "walk-look";
  const doesLook = motion === "look" || motion === "walk-look";

  await page.mouse.move(center.x, center.y);
  if (motion === "wait") {
    await page.waitForTimeout(sampleMs);
    return { kind: motion, sample_ms: sampleMs };
  }

  try {
    if (doesWalk) await page.keyboard.down("w");
    if (doesLook) {
      for (let step = 1; step <= steps; step += 1) {
        const t = step / steps;
        const x = center.x + Math.sin(t * Math.PI * 2) * lookX;
        const y = center.y + Math.sin(t * Math.PI * 4) * lookY;
        await page.mouse.move(x, y);
        if (delayMs > 0) await page.waitForTimeout(delayMs);
      }
    } else {
      await page.waitForTimeout(sampleMs);
    }
  } finally {
    if (doesWalk) await page.keyboard.up("w").catch(() => undefined);
  }

  return {
    kind: motion,
    sample_ms: sampleMs,
    steps: doesLook ? steps : 0,
    target: "#host",
    start: { x: +center.x.toFixed(3), y: +center.y.toFixed(3) },
    look_amplitude: doesLook ? { x: +lookX.toFixed(3), y: +lookY.toFixed(3) } : null,
  };
}

function dominantGroups(groups) {
  return Object.entries(groups)
    .map(([name, value]) => ({ name, ...value }))
    .filter((group) => group.duration_ms > 0)
    .sort((a, b) => b.duration_ms - a.duration_ms)
    .slice(0, 6);
}

function renderMarkdown(summary) {
  const groups = dominantGroups(summary.trace.groups);
  const topEvents = summary.trace.topEvents.slice(0, 10);
  const lines = [
    "# Minecraft Movement Bench",
    "",
    `- URL: ${summary.url}`,
    `- Viewport: ${summary.viewport.width}x${summary.viewport.height}`,
    `- Motion: ${summary.action.kind}`,
    `- Warmup: ${summary.warmup_ms} ms`,
    `- Sample: ${summary.action.sample_ms} ms`,
    `- Settle traced: ${summary.settle_ms} ms`,
    `- Trace aligned to marks: ${summary.trace_aligned_to_marks ? "yes" : "no"}`,
    "",
    "## FPS",
    "",
    `- Mean FPS: ${summary.frames.fps_mean}`,
    `- P50 FPS: ${summary.frames.fps_p50}`,
    `- P50 frame: ${summary.frames.frame_time_p50_ms} ms`,
    `- P95 frame: ${summary.frames.frame_time_p95_ms} ms`,
    `- P99 frame: ${summary.frames.frame_time_p99_ms} ms`,
    `- Frames over 16.7 ms: ${summary.frames.frames_over_16_7_ms}`,
    `- Frames over 33.3 ms: ${summary.frames.frames_over_33_3_ms}`,
    "",
    "## Trace Groups",
    "",
    ...groups.map((group) => `- ${group.name}: ${group.duration_ms} ms (${group.ms_per_frame} ms/frame, ${group.count} events)`),
    "",
    "## Top Events",
    "",
    ...topEvents.map((event) => `- ${event.name}: ${event.duration_ms} ms (${event.count} events)`),
    "",
    "## Page Metrics",
    "",
    `- World meshes: ${summary.page.after.worldMeshCount}`,
    `- World leaves: ${summary.page.after.worldLeafCount}`,
    `- Hand leaves: ${summary.page.after.handLeafCount}`,
    `- Stats panels: ${summary.page.after.statsOverlayPanels}`,
    `- World mutation records during movement plus settle: ${summary.page.worldMutations?.records ?? "n/a"}`,
    "",
    "## Artifacts",
    "",
    `- Trace: ${summary.outputFiles.trace}`,
    `- Summary: ${summary.outputFiles.summary}`,
  ];
  return `${lines.join("\n")}\n`;
}

async function run() {
  if (HELP) {
    printHelp();
    return;
  }

  let server = null;
  let url = TARGET_URL;
  if (!url) {
    await assertBuiltMinecraftExample();
    const started = await startStaticServer();
    server = started.server;
    url = `http://127.0.0.1:${started.port}/minecraft/`;
  }

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

    await page.goto(url, { waitUntil: "load" });
    try {
      await waitForMinecraftReady(page);
    } catch (error) {
      const bodyPreview = await page.locator("body").textContent().catch(() => "");
      const htmlPreview = await page.content().catch(() => "");
      throw new Error(
        `Minecraft page did not become ready at ${page.url()}. Body: ${bodyPreview?.trim().slice(0, 220) || htmlPreview.slice(0, 220)}`,
        { cause: error },
      );
    }
    await page.mouse.move(viewport.width / 2, viewport.height / 2);
    await page.waitForTimeout(WARMUP_MS);

    const beforePageMetrics = await collectPageMetrics(page);
    const observerStart = await startWorldMutationObserver(page);
    if (!observerStart.ok) throw new Error("Could not attach world mutation observer.");

    const cdp = await context.newCDPSession(page);
    const traceEvents = await startTrace(cdp);
    await startRafSampler(page);
    const startPerfNow = await mark(page, MARK_START);
    const action = await performMovement(page, MOTION, SAMPLE_MS, STEPS);
    const endPerfNow = await mark(page, MARK_END);
    await page.waitForTimeout(SETTLE_MS);
    const worldMutations = await stopWorldMutationObserver(page);
    const samples = await stopRafSampler(page);
    await stopTrace(cdp);
    const afterPageMetrics = await collectPageMetrics(page);

    const startMark = findTraceMark(traceEvents, MARK_START);
    const endMark = findTraceMark(traceEvents, MARK_END);
    const aligned = Boolean(startMark?.args?.data?.startTime && endMark?.args?.data?.startTime);
    const tracePerfOffsetMs = aligned ? (startMark.ts / 1000) - startMark.args.data.startTime : 0;
    const alignedStartPerfNow = aligned ? startMark.args.data.startTime : startPerfNow;
    const alignedEndPerfNow = aligned ? endMark.args.data.startTime : endPerfNow;
    const actionWindowMs = alignedEndPerfNow - alignedStartPerfNow;
    const frames = framesFromSamples(samples, alignedStartPerfNow, alignedEndPerfNow);
    const eventSummary = aligned
      ? summarizeEvents(traceEvents, tracePerfOffsetMs, alignedStartPerfNow, alignedEndPerfNow, frames)
      : summarizeEvents(traceEvents, 0, -Infinity, Infinity, frames);

    const summary = {
      kind: "minecraft-movement-bench",
      url,
      viewport,
      action,
      warmup_ms: WARMUP_MS,
      settle_ms: SETTLE_MS,
      trace_aligned_to_marks: aligned,
      trace_perf_offset_ms: aligned ? +tracePerfOffsetMs.toFixed(3) : null,
      action_window_ms: +actionWindowMs.toFixed(3),
      frames: summarizeFrames(frames, actionWindowMs),
      trace: {
        event_count: traceEvents.length,
        ...eventSummary,
      },
      page: {
        before: beforePageMetrics,
        after: afterPageMetrics,
        worldMutations,
      },
      outputFiles: {
        trace: resolveOutputPath(TRACE_OUT),
        summary: resolveOutputPath(SUMMARY_OUT),
        markdown: MARKDOWN_OUT ? resolveOutputPath(MARKDOWN_OUT) : null,
      },
      diagnostics,
    };

    const traceOutPath = resolveOutputPath(TRACE_OUT);
    mkdirSync(dirname(traceOutPath), { recursive: true });
    writeFileSync(traceOutPath, JSON.stringify({
      traceEvents,
      displayTimeUnit: "ms",
      metadata: {
        source: "bench/minecraft-movement-bench.mjs",
        url,
        action,
      },
    }));

    const summaryOutPath = resolveOutputPath(SUMMARY_OUT);
    mkdirSync(dirname(summaryOutPath), { recursive: true });
    writeFileSync(summaryOutPath, `${JSON.stringify(summary, null, 2)}\n`);

    if (MARKDOWN_OUT) {
      const markdownOutPath = resolveOutputPath(MARKDOWN_OUT);
      mkdirSync(dirname(markdownOutPath), { recursive: true });
      writeFileSync(markdownOutPath, renderMarkdown(summary));
    }

    console.log(JSON.stringify(summary, null, 2));
  } finally {
    await browser.close();
    if (server) await stopServer(server);
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
