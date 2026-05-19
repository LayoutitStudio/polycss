#!/usr/bin/env node
/**
 * Synthetic Chromium compositor probe for polycss trace hypotheses.
 *
 * This intentionally does not render a correct model. It isolates browser
 * behavior under a rotating preserve-3d root:
 *   - topology: equal leaf count, different leaf transform topology
 *   - distribution: equal matrix3d leaves, different projected distribution
 *   - depth-groups: per-leaf translateZ versus depth-plane wrappers
 *
 * Usage:
 *   node bench/compositor-topology-probe.mjs
 *   node bench/compositor-topology-probe.mjs --mode=topology --leaves=5000
 *   node bench/compositor-topology-probe.mjs --mode=distribution --headed
 *   node bench/compositor-topology-probe.mjs --mode=depth-groups --leaves=5000
 *   node bench/compositor-topology-probe.mjs --mode=depth-groups --root=js
 */
import { chromium } from "playwright";

const args = new Map(
  process.argv.slice(2).map((arg) => {
    const [key, ...rest] = arg.replace(/^--/, "").split("=");
    return [key, rest.length ? rest.join("=") : "true"];
  }),
);

const MODE = args.get("mode") ?? "all";
const LEAVES = Number(args.get("leaves") ?? 2500);
const SAMPLE_MS = Number(args.get("sample-ms") ?? 2500);
const WARMUP_MS = Number(args.get("warmup-ms") ?? 700);
const HEADED = args.has("headed");
const JSON_OUT = args.has("json");
const EXECUTABLE = args.get("browser");
const ROOT = args.get("root");

const CHROMIUM_ARGS = [
  "--disable-background-timer-throttling",
  "--disable-renderer-backgrounding",
  "--disable-backgrounding-occluded-windows",
];

const TRACE_CATEGORIES = [
  "devtools.timeline",
  "disabled-by-default-devtools.timeline",
  "blink",
  "cc",
  "gpu",
  "renderer.scheduler",
].join(",");

function percentile(sorted, p) {
  return sorted[
    Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * p)))
  ] ?? 0;
}

function summarizeFrameTimes(dts) {
  const sorted = dts
    .filter((value) => Number.isFinite(value) && value > 0 && value < 2000)
    .sort((a, b) => a - b);
  const p50 = percentile(sorted, 0.5);
  const p95 = percentile(sorted, 0.95);
  const p99 = percentile(sorted, 0.99);
  return {
    samples: sorted.length,
    fps_p50: +(1000 / p50).toFixed(1),
    fps_p95: +(1000 / p95).toFixed(1),
    p99_ms: +p99.toFixed(1),
  };
}

function summarizeTraceEvents(events) {
  const byName = new Map();
  for (const event of events) {
    if (event?.ph !== "X" || typeof event.dur !== "number") continue;
    const entry = byName.get(event.name) ?? { count: 0, us: 0 };
    entry.count += 1;
    entry.us += event.dur;
    byName.set(event.name, entry);
  }

  const get = (name) => byName.get(name) ?? { count: 0, us: 0 };
  const frames = Math.max(1, get("FireAnimationFrame").count || 1);
  const pick = (name) => {
    const event = get(name);
    return {
      count: event.count,
      total_ms: +(event.us / 1000).toFixed(1),
      per_frame_ms: +(event.us / 1000 / frames).toFixed(3),
    };
  };

  return {
    pac: pick("PaintArtifactCompositor::Update"),
    layerize: pick("Layerize"),
    drawProps: pick("LayerTreeImpl::UpdateDrawProperties"),
    visible: pick("draw_property_utils::ComputeDrawPropertiesOfVisibleLayers"),
    draw: pick("MainFrame.Draw"),
    paint: pick("Paint"),
    style: pick("UpdateLayoutTree"),
    raf: pick("FireAnimationFrame"),
  };
}

async function startTrace(cdp) {
  const events = [];
  cdp.on("Tracing.dataCollected", (payload) => {
    if (Array.isArray(payload.value)) events.push(...payload.value);
  });
  await cdp.send("Tracing.start", {
    transferMode: "ReportEvents",
    categories: TRACE_CATEGORIES,
  });
  return events;
}

async function stopTrace(cdp, events) {
  await new Promise(async (resolve) => {
    cdp.once("Tracing.tracingComplete", resolve);
    await cdp.send("Tracing.end");
  });
  return summarizeTraceEvents(events);
}

function topologyStyle(variant, i, leaves) {
  const cols = Math.max(1, Math.ceil(Math.sqrt(leaves)));
  const x = (i % cols) * 8 - 200;
  const y = Math.floor(i / cols) * 8 - 200;
  const z = ((i % 17) - 8) * 6;
  switch (variant) {
    case "left-top":
      return `left:${x}px;top:${y}px;width:6px;height:6px;`;
    case "translate2d":
      return `width:6px;height:6px;transform:translate(${x}px,${y}px);`;
    case "translateZ0":
      return `left:${x}px;top:${y}px;width:6px;height:6px;transform:translateZ(0);`;
    case "translateZ":
      return `left:${x}px;top:${y}px;width:6px;height:6px;transform:translateZ(${z}px);`;
    case "matrix3d":
      return `width:1px;height:1px;transform:matrix3d(6,0,0,0,0,6,0,0,0,0,1,0,${x},${y},${z},1);`;
    default:
      throw new Error(`Unknown topology variant "${variant}"`);
  }
}

function distributionStyle(variant, i) {
  const cols = 40;
  let x;
  let y;
  if (variant === "cluster") {
    x = (i % cols) * 8 - 160;
    y = Math.floor(i / cols) * 8 - 120;
  } else if (variant === "spread") {
    x = (i % cols) * 24 - 480;
    y = Math.floor(i / cols) * 24 - 360;
  } else if (variant === "overlap") {
    x = (i % cols) * 2 - 40;
    y = Math.floor(i / cols) * 2 - 30;
  } else {
    throw new Error(`Unknown distribution variant "${variant}"`);
  }
  const z = ((i % 17) - 8) * 6;
  return `width:1px;height:1px;transform:matrix3d(6,0,0,0,0,6,0,0,0,0,1,0,${x},${y},${z},1);`;
}

function parseDepthVariant(variant) {
  const match = /^(leaf|group)-z(\d+)$/.exec(variant);
  if (!match) throw new Error(`Unknown depth-groups variant "${variant}"`);
  return {
    kind: match[1],
    depthCount: Math.max(1, Number(match[2])),
  };
}

function depthPosition(i, leaves) {
  const cols = Math.max(1, Math.ceil(Math.sqrt(leaves)));
  return {
    x: (i % cols) * 8 - 200,
    y: Math.floor(i / cols) * 8 - 200,
  };
}

function depthValue(depthIndex, depthCount) {
  return (depthIndex - (depthCount - 1) / 2) * 6;
}

function makeDepthGroupCells(variant, leaves) {
  const { kind, depthCount } = parseDepthVariant(variant);
  if (kind === "leaf") {
    const cells = [];
    for (let i = 0; i < leaves; i++) {
      const depthIndex = i % depthCount;
      const { x, y } = depthPosition(i, leaves);
      const z = depthValue(depthIndex, depthCount);
      cells.push(
        `<b style="left:${x}px;top:${y}px;width:6px;height:6px;transform:translateZ(${z}px);"></b>`,
      );
    }
    return cells.join("");
  }

  const buckets = Array.from({ length: depthCount }, () => []);
  for (let i = 0; i < leaves; i++) {
    const depthIndex = i % depthCount;
    const { x, y } = depthPosition(i, leaves);
    buckets[depthIndex].push(
      `<b style="left:${x}px;top:${y}px;width:6px;height:6px;"></b>`,
    );
  }

  return buckets
    .map((children, depthIndex) => {
      const z = depthValue(depthIndex, depthCount);
      return `<div class="depth" style="transform:translateZ(${z}px)">${children.join("")}</div>`;
    })
    .join("");
}

function makeHtml({ mode, variant, leaves, root }) {
  let cells = "";
  if (mode === "depth-groups") {
    cells = makeDepthGroupCells(variant, leaves);
  } else {
    const leafHtml = [];
    for (let i = 0; i < leaves; i++) {
      const style =
        mode === "topology"
          ? topologyStyle(variant, i, leaves)
          : distributionStyle(variant, i);
      leafHtml.push(`<b style="${style}"></b>`);
    }
    cells = leafHtml.join("");
  }

  const rootMotion =
    root === "css"
      ? "animation:spin 10s linear infinite;"
      : "transform:scale(.7) rotateX(65deg) rotate(0deg);";
  const script =
    root === "css"
      ? "const samples=[];let last=performance.now();function tick(now){samples.push(now-last);last=now;requestAnimationFrame(tick)}requestAnimationFrame(tick);window.__probe={samples};"
      : "const root=document.querySelector('.scene');const samples=[];let last=performance.now(),frame=0;function tick(now){samples.push(now-last);last=now;frame++;root.style.transform='scale(.7) rotateX(65deg) rotate('+((frame*.5)%360)+'deg)';requestAnimationFrame(tick)}requestAnimationFrame(tick);window.__probe={samples};";

  return `<!doctype html><meta charset="utf-8"><style>
body{margin:0;background:#111;overflow:hidden}
#host{position:relative;width:1280px;height:800px;perspective:8000px;transform-style:preserve-3d}
.scene{position:absolute;left:50%;top:50%;width:0;height:0;transform-style:preserve-3d;will-change:transform;${rootMotion}}
.depth{position:absolute;left:0;top:0;width:0;height:0;transform-origin:0 0;transform-style:preserve-3d}
b{position:absolute;display:block;background:#5eead4;transform-origin:0 0;transform-style:preserve-3d;backface-visibility:visible;margin:0;padding:0}
@keyframes spin{from{transform:scale(.7) rotateX(65deg) rotate(0deg)}to{transform:scale(.7) rotateX(65deg) rotate(360deg)}}
</style><div id="host"><div class="scene">${cells}</div></div><script>${script}</script>`;
}

async function runCase(browser, config) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.setContent(makeHtml(config), { waitUntil: "load" });
  await page.waitForTimeout(WARMUP_MS);
  const cdp = await page.context().newCDPSession(page);
  const events = await startTrace(cdp);
  const start = await page.evaluate(() => window.__probe.samples.length);
  await page.waitForTimeout(SAMPLE_MS);
  const dts = await page.evaluate(
    (from) => window.__probe.samples.slice(from),
    start,
  );
  const trace = await stopTrace(cdp, events);
  await page.close();
  return {
    ...config,
    ...summarizeFrameTimes(dts),
    trace,
  };
}

function printRows(rows) {
  const header = [
    "mode",
    "root",
    "variant",
    "fps_p50",
    "fps_p95",
    "p99",
    "PAC/frame",
    "DrawProps/frame",
    "Draw/frame",
  ];
  console.log(header.join("\t"));
  for (const row of rows) {
    console.log([
      row.mode,
      row.root,
      row.variant,
      row.fps_p50.toFixed(1),
      row.fps_p95.toFixed(1),
      row.p99_ms.toFixed(1),
      row.trace.pac.per_frame_ms.toFixed(3),
      row.trace.drawProps.per_frame_ms.toFixed(3),
      row.trace.draw.per_frame_ms.toFixed(3),
    ].join("\t"));
  }
}

const configs = [];
if (MODE === "all" || MODE === "topology") {
  for (const variant of ["left-top", "translate2d", "translateZ0", "translateZ", "matrix3d"]) {
    configs.push({ mode: "topology", root: ROOT ?? "css", variant, leaves: LEAVES });
  }
}
if (MODE === "all" || MODE === "distribution") {
  const leaves = MODE === "all" ? Math.min(LEAVES, 1200) : LEAVES;
  for (const variant of ["cluster", "spread", "overlap"]) {
    configs.push({ mode: "distribution", root: ROOT ?? "js", variant, leaves });
  }
}
if (MODE === "all" || MODE === "depth-groups") {
  for (const variant of ["leaf-z17", "group-z17", "leaf-z50", "group-z50", "leaf-z250", "group-z250"]) {
    configs.push({ mode: "depth-groups", root: ROOT ?? "css", variant, leaves: LEAVES });
  }
}
if (configs.length === 0) {
  throw new Error(`Unknown --mode=${MODE}; use all, topology, distribution, or depth-groups`);
}

const launchOptions = { headless: !HEADED, args: CHROMIUM_ARGS };
if (EXECUTABLE) launchOptions.executablePath = EXECUTABLE;
const browser = await chromium.launch(launchOptions);
try {
  const rows = [];
  for (const config of configs) {
    rows.push(await runCase(browser, config));
  }
  if (JSON_OUT) {
    console.log(JSON.stringify(rows, null, 2));
  } else {
    printRows(rows);
  }
} finally {
  await browser.close();
}
