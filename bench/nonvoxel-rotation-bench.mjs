#!/usr/bin/env node
/**
 * Bench-only non-voxel rotation probe.
 *
 * Runs the vanilla renderer against a representative non-voxel corpus and a
 * small set of browser-shape ideas borrowed from the voxel investigation.
 * This intentionally routes through nonvoxel-vanilla.html so each variant still
 * uses the real renderer and the same FPS recorder as bench/perf-bench.mjs.
 *
 * Usage:
 *   node bench/nonvoxel-rotation-bench.mjs
 *   node bench/nonvoxel-rotation-bench.mjs --models saucer,rock1 --variants baseline,css-keyframes
 *   node bench/nonvoxel-rotation-bench.mjs --mode dynamic --sample 5000 --repeats 3
 *   node bench/nonvoxel-rotation-bench.mjs --run-order round-robin --repeats 5
 *   node bench/nonvoxel-rotation-bench.mjs --json bench/results/nonvoxel-rotation.json
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

const WARMUP_MS = optNum("warmup", 2000);
const SAMPLE_MS = optNum("sample", 3000);
const REPEATS = Math.max(1, optNum("repeats", 1));
const MODE = optStr("mode", "baked");
const RUN_ORDER_INPUT = optStr("run-order", "grouped");
const SEED = optStr("seed", "polycss-nonvoxel");
const JSON_PATH = optStr("json");
const PRINT_JSON = hasFlag("print-json") || !JSON_PATH;
const HEADED = hasFlag("headed");
const BROWSER_EXECUTABLE = optStr("browser-executable");
const SOFTWARE_BACKEND = hasFlag("software-backend");
const CHROMIUM_ARGS = chromiumArgsWithGpuDefault([
  ...optAll("chromium-arg"),
  ...optAll("chromium-args").flatMap((value) => value.split(/\s+/).filter(Boolean)),
], { softwareBackend: SOFTWARE_BACKEND });

const MODEL_CORPUS = [
  {
    id: "chicken",
    label: "Chicken OBJ",
    mesh: "chicken",
    reason: "Small flat-color OBJ; mostly merged quads.",
  },
  {
    id: "rock1",
    label: "Rock OBJ",
    mesh: "rock1",
    reason: "Small UV-textured OBJ; atlas-heavy baseline.",
  },
  {
    id: "saucer",
    label: "Saucer OBJ",
    mesh: "saucer",
    reason: "Large untextured OBJ; known rotation stress case.",
  },
  {
    id: "teapot",
    label: "Teapot OBJ",
    mesh: "teapot",
    reason: "Smooth curved solid OBJ.",
  },
  {
    id: "ducky",
    label: "Ducky GLB",
    mesh: "ducky",
    reason: "Small GLB with solid color swatches.",
  },
  {
    id: "elephant",
    label: "Elephant GLB",
    mesh: "glb:Elephant.glb",
    params: { zoom: "0.35", targetSize: "60" },
    reason: "Organic low-poly GLB.",
  },
  {
    id: "policecar",
    label: "Policecar GLB",
    mesh: "glb:Policecar.glb",
    params: { zoom: "0.35", targetSize: "60" },
    reason: "Mechanical GLB with many rectilinear parts.",
  },
  {
    id: "violin",
    label: "Violin GLB",
    mesh: "glb:Violin.glb",
    params: { zoom: "0.35", targetSize: "60" },
    reason: "Thin-structure GLB with many separated parts.",
  },
];

const VARIANTS = [
  {
    id: "baseline",
    label: "Baseline",
    params: {},
    hypothesis: "Current vanilla JS scene-root rotation.",
  },
  {
    id: "css-keyframes",
    label: "CSS Keyframes",
    params: { rotationDriver: "css-keyframes" },
    hypothesis: "Active declarative transform animation may skip PAC during auto-rotate.",
  },
  {
    id: "order-depth",
    label: "Initial Depth Order",
    params: { domOrder: "initial-depth" },
    hypothesis: "One-time depth locality may reduce compositor sort pressure.",
  },
  {
    id: "order-tile4",
    label: "Tile4 Screen Order",
    params: { domOrder: "tile4-screen" },
    hypothesis: "Voxel tile-order lesson may transfer to static non-voxel polygon order.",
  },
  {
    id: "order-area",
    label: "Area Desc Order",
    params: { domOrder: "area-desc" },
    hypothesis: "Large projected primitives grouped earlier may improve overlap cadence.",
  },
  {
    id: "no-border-shape",
    label: "No Border Shape",
    params: { disableStrategies: "i" },
    hypothesis: "Force irregular solids to atlas slices instead of border-shape leaves.",
  },
  {
    id: "no-stable-tri",
    label: "No Stable Triangles",
    params: { disableStrategies: "u" },
    hypothesis: "Avoid CSS border-triangle compositing for solid triangles.",
  },
  {
    id: "force-atlas",
    label: "Force Atlas",
    params: { disableStrategies: "b,i,u" },
    hypothesis: "Fewer CSS shape strategies may beat extra atlas memory for rotation.",
  },
  {
    id: "no-will-change",
    label: "No Scene Will-Change",
    params: { sceneTransformMode: "no-will-change" },
    hypothesis: "Confirm voxel result that root will-change is not the missing path.",
  },
  {
    id: "leaf-buckets-64",
    label: "Leaf Buckets 64",
    params: { leafBucketSize: "64" },
    hypothesis: "Wrap baked leaves into fixed-size preserve-3D subtrees without changing leaf order.",
  },
  {
    id: "leaf-buckets-128",
    label: "Leaf Buckets 128",
    params: { leafBucketSize: "128" },
    hypothesis: "Test a coarser fixed-size baked subtree shape.",
  },
  {
    id: "leaf-buckets-256",
    label: "Leaf Buckets 256",
    params: { leafBucketSize: "256" },
    hypothesis: "Test a low-wrapper baked subtree shape.",
  },
  {
    id: "scene-matrix3d",
    label: "Scene Matrix3d",
    params: { sceneTransformMode: "matrix3d" },
    hypothesis: "Use explicit matrix3d() on the scene root instead of transform functions.",
  },
  {
    id: "scene-split-target",
    label: "Split Target",
    params: { sceneTransformMode: "split-target" },
    hypothesis: "Split translate3d target compensation onto an inner shell.",
  },
  {
    id: "scene-host-perspective",
    label: "Host Perspective",
    params: { sceneTransformMode: "host-perspective" },
    hypothesis: "Move perspective off the scene root and onto the host.",
  },
  {
    id: "scene-transform-perspective",
    label: "Transform Perspective",
    params: { sceneTransformMode: "transform-perspective" },
    hypothesis: "Encode perspective in transform instead of the perspective property.",
  },
];

const RUN_ORDER_ALIASES = new Map([
  ["grouped", "grouped"],
  ["sequential", "grouped"],
  ["round-robin", "round-robin"],
  ["roundrobin", "round-robin"],
  ["interleaved", "round-robin"],
  ["random", "random"],
  ["shuffle", "random"],
]);

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
};

function splitList(value) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function selectedModels() {
  const requested = splitList(optStr("models"));
  if (requested.length === 0) return MODEL_CORPUS;
  const byId = new Map(MODEL_CORPUS.map((model) => [model.id, model]));
  const selected = requested.map((id) => {
    const known = byId.get(id);
    if (known) return known;
    if (id.startsWith("glb:") || id.startsWith("obj:")) {
      return { id: id.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, ""), label: id, mesh: id };
    }
    throw new Error(`Unknown model "${id}". Known: ${MODEL_CORPUS.map((m) => m.id).join(", ")}`);
  });
  return selected;
}

function selectedVariants() {
  const requested = splitList(optStr("variants"));
  if (requested.length === 0) return VARIANTS;
  const byId = new Map(VARIANTS.map((variant) => [variant.id, variant]));
  return requested.map((id) => {
    const variant = byId.get(id);
    if (!variant) throw new Error(`Unknown variant "${id}". Known: ${VARIANTS.map((v) => v.id).join(", ")}`);
    return variant;
  });
}

function selectedRunOrder() {
  const normalized = RUN_ORDER_ALIASES.get(RUN_ORDER_INPUT);
  if (!normalized) {
    throw new Error(`--run-order must be grouped, round-robin, or random; got "${RUN_ORDER_INPUT}"`);
  }
  return normalized;
}

function selectedModes() {
  if (MODE === "both") return ["baked", "dynamic"];
  if (MODE !== "baked" && MODE !== "dynamic") throw new Error("--mode must be baked, dynamic, or both");
  return [MODE];
}

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
  return new Promise((resolveStop) => server.close(() => resolveStop()));
}

function quantile(sorted, q) {
  if (sorted.length === 0) return 0;
  const i = (sorted.length - 1) * q;
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
}

function summarizeFrameTimes(dts, rawCount = dts.length) {
  const sorted = [...dts].sort((a, b) => a - b);
  const p50 = quantile(sorted, 0.5);
  const p95 = quantile(sorted, 0.95);
  const p99 = quantile(sorted, 0.99);
  return {
    fps_p50: p50 > 0 ? 1000 / p50 : 0,
    fps_p95: p95 > 0 ? 1000 / p95 : 0,
    frame_time_p50_ms: p50,
    frame_time_p95_ms: p95,
    frame_time_p99_ms: p99,
    sample_count: sorted.length,
    sample_count_raw: rawCount,
    sample_count_filtered: rawCount - sorted.length,
  };
}

function median(values) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  return quantile(sorted, 0.5);
}

function hashString(value) {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function seededRandom(seed) {
  let state = hashString(seed) || 1;
  return () => {
    state += 0x6d2b79f5;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle(items, seed) {
  const rng = seededRandom(seed);
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function instantiateVariants(selected) {
  const totals = new Map();
  for (const variant of selected) totals.set(variant.id, (totals.get(variant.id) ?? 0) + 1);
  const seen = new Map();
  return selected.map((variant) => {
    const occurrence = (seen.get(variant.id) ?? 0) + 1;
    seen.set(variant.id, occurrence);
    const duplicate = (totals.get(variant.id) ?? 0) > 1;
    return {
      ...variant,
      occurrence,
      runKey: duplicate ? `${variant.id}#${occurrence}` : variant.id,
    };
  });
}

function variantName(variant) {
  return variant.occurrence > 1 ? `${variant.id}#${variant.occurrence}` : variant.id;
}

function buildRunPlan(variants, repeats, runOrder, seedParts) {
  const plan = [];
  if (runOrder === "round-robin") {
    for (let repeat = 1; repeat <= repeats; repeat += 1) {
      for (const variant of variants) plan.push({ variant, repeat });
    }
  } else {
    for (const variant of variants) {
      for (let repeat = 1; repeat <= repeats; repeat += 1) plan.push({ variant, repeat });
    }
  }
  const ordered = runOrder === "random" ? shuffle(plan, seedParts.join(":")) : plan;
  return ordered.map((entry, index) => ({ ...entry, runIndex: index + 1 }));
}

function aggregateRuns(runs) {
  return {
    fps_p50: median(runs.map((run) => run.fps_p50)),
    fps_p95: median(runs.map((run) => run.fps_p95)),
    frame_time_p99_ms: median(runs.map((run) => run.frame_time_p99_ms)),
    sample_count: median(runs.map((run) => run.sample_count)),
    sample_count_raw: median(runs.map((run) => run.sample_count_raw)),
    sample_count_filtered: median(runs.map((run) => run.sample_count_filtered)),
    polyCount: runs[0]?.polyCount ?? 0,
    renderStats: runs[0]?.renderStats ?? null,
    runs,
  };
}

function urlFor(port, model, variant, mode) {
  const params = new URLSearchParams({
    mesh: model.mesh,
    mode,
    motion: "rot",
    ...(model.params ?? {}),
    ...(variant.params ?? {}),
  });
  return `http://127.0.0.1:${port}/nonvoxel-vanilla.html?${params.toString()}`;
}

async function runOnce(port, model, variant, mode) {
  const launchOptions = { headless: !HEADED, args: CHROMIUM_ARGS };
  if (BROWSER_EXECUTABLE) launchOptions.executablePath = BROWSER_EXECUTABLE;
  const browser = await chromium.launch(launchOptions);
  try {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await ctx.newPage();
    await page.goto(urlFor(port, model, variant, mode), { waitUntil: "load" });
    await page.waitForFunction(() => window.__perf__?.ready === true, null, { timeout: 30000 });
    await page.waitForTimeout(WARMUP_MS);
    const startIdx = await page.evaluate(() => window.__perf__.samples.length);
    await page.waitForTimeout(SAMPLE_MS);
    const pageResult = await page.evaluate((from) => ({
      samples: window.__perf__.samples.slice(from),
      polyCount: window.__perf__.polyCount,
      renderStats: window.__perf__.renderStats ?? null,
    }), startIdx);
    await ctx.close();

    const rawDts = pageResult.samples.map((sample) => sample.dt).filter((dt) => dt > 0);
    const dts = rawDts.filter((dt) => dt < 2000);
    return {
      ...summarizeFrameTimes(dts, rawDts.length),
      polyCount: pageResult.polyCount,
      renderStats: pageResult.renderStats,
    };
  } finally {
    await browser.close();
  }
}

function formatNumber(value, digits = 1) {
  return Number.isFinite(value) ? value.toFixed(digits) : "0.0";
}

function tagSummary(renderStats) {
  const tags = renderStats?.dom?.tags;
  if (!tags) return "";
  return `${tags.b}/${tags.i}/${tags.s}/${tags.u}/${tags.q}`;
}

function pctDelta(value, baseline) {
  if (!baseline) return 0;
  return ((value - baseline) / baseline) * 100;
}

const models = selectedModels();
const variants = instantiateVariants(selectedVariants());
const modes = selectedModes();
const runOrder = selectedRunOrder();
const rows = [];

console.log(`[nonvoxel] models=${models.map((model) => model.id).join(",")}`);
console.log(`[nonvoxel] variants=${variants.map(variantName).join(",")}`);
console.log(`[nonvoxel] mode=${modes.join(",")} repeats=${REPEATS} runOrder=${runOrder} seed=${SEED} warmup=${WARMUP_MS}ms sample=${SAMPLE_MS}ms`);
if (BROWSER_EXECUTABLE) console.log(`[nonvoxel] browser=${BROWSER_EXECUTABLE}`);
if (SOFTWARE_BACKEND) console.log("[nonvoxel] software backend=on");
if (CHROMIUM_ARGS.length > 0) console.log(`[nonvoxel] chromium args=${CHROMIUM_ARGS.join(" ")}`);

const { server, port } = await startServer();
console.log(`[nonvoxel] server :${port}`);

try {
  for (const mode of modes) {
    console.log("");
    console.log(`mode: ${mode}`);
    for (const model of models) {
      console.log(`  ${model.id} - ${model.reason ?? model.label}`);
      const runsByVariant = new Map(variants.map((variant) => [variant.runKey, []]));
      const plan = buildRunPlan(variants, REPEATS, runOrder, [SEED, mode, model.id]);
      const planWidth = String(plan.length).length;
      const nameWidth = Math.max(17, ...variants.map((variant) => variantName(variant).length + 1));
      for (const entry of plan) {
        process.stdout.write(
          `    [${String(entry.runIndex).padStart(planWidth)}/${plan.length}] ` +
          `${variantName(entry.variant).padEnd(nameWidth)}r${entry.repeat} `,
        );
        const run = await runOnce(port, model, entry.variant, mode);
        const annotatedRun = {
          ...run,
          repeat: entry.repeat,
          runIndex: entry.runIndex,
          runOrder,
        };
        runsByVariant.get(entry.variant.runKey).push(annotatedRun);
        process.stdout.write(
          `p50=${formatNumber(run.fps_p50).padStart(5)} p95=${formatNumber(run.fps_p95).padStart(5)} ` +
          `p99=${formatNumber(run.frame_time_p99_ms).padStart(5)}ms ` +
          `polys=${String(run.polyCount).padStart(5)} tags=${tagSummary(run.renderStats)}\n`,
        );
      }

      let baselineP95 = 0;
      for (const variant of variants) {
        const runs = runsByVariant.get(variant.runKey) ?? [];
        const result = aggregateRuns(runs);
        if (variant.id === "baseline") baselineP95 = result.fps_p95;
        const delta = variant.id === "baseline" ? 0 : pctDelta(result.fps_p95, baselineP95);
        const row = {
          mode,
          modelId: model.id,
          modelLabel: model.label,
          modelMesh: model.mesh,
          variantKey: variant.runKey,
          variantId: variant.id,
          variantLabel: variant.label,
          hypothesis: variant.hypothesis,
          runOrder,
          seed: SEED,
          fps_p50: +result.fps_p50.toFixed(2),
          fps_p95: +result.fps_p95.toFixed(2),
          frame_time_p99_ms: +result.frame_time_p99_ms.toFixed(2),
          p95_delta_pct: +delta.toFixed(1),
          sample_count: result.sample_count,
          sample_count_raw: result.sample_count_raw,
          sample_count_filtered: result.sample_count_filtered,
          polyCount: result.polyCount,
          renderStats: result.renderStats,
          runs: result.runs,
        };
        rows.push(row);
        const deltaText = variant.id === "baseline" ? "base" : `${delta >= 0 ? "+" : ""}${delta.toFixed(1)}%`;
        process.stdout.write(
          `    ${variantName(variant).padEnd(nameWidth)}summary p50=${formatNumber(result.fps_p50).padStart(5)} p95=${formatNumber(result.fps_p95).padStart(5)} ` +
          `p99=${formatNumber(result.frame_time_p99_ms).padStart(5)}ms ${deltaText.padStart(8)} ` +
          `polys=${String(result.polyCount).padStart(5)} tags=${tagSummary(result.renderStats)}\n`,
        );
      }
    }
  }

  const output = {
    kind: "nonvoxel-rotation",
    warmup_ms: WARMUP_MS,
    sample_ms: SAMPLE_MS,
    repeats: REPEATS,
    runOrder,
    seed: SEED,
    browserExecutable: BROWSER_EXECUTABLE || null,
    chromiumArgs: CHROMIUM_ARGS,
    softwareBackend: SOFTWARE_BACKEND,
    models,
    variants,
    rows,
  };

  if (JSON_PATH) {
    const outputPath = resolve(repoRoot, JSON_PATH);
    mkdirSync(dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`);
    console.log("");
    console.log(`[nonvoxel] wrote ${outputPath}`);
  }

  if (PRINT_JSON) {
    console.log("");
    console.log(JSON.stringify(output, null, 2));
  }
} finally {
  await stopServer(server);
}
