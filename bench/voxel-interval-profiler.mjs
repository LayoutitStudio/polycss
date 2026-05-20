#!/usr/bin/env node
import { createServer } from "node:http";
import { mkdirSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { normalFacesCamera } from "../packages/core/dist/index.js";
import { PRESETS } from "./perf-shared.mjs";
import { chromiumArgsWithGpuDefault } from "./chromium-defaults.mjs";

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

const MESH = optStr("mesh", "garden");
const MODE = optStr("mode", "baked");
const MOTION = optStr("motion", "rot");
const RENDERER = optStr("renderer", "vanilla");
const WARMUP_MS = optNum("warmup", 1500);
const SAMPLE_MS = optNum("sample", 8000);
const RUNS = optNum("runs", 1);
const LABEL = optStr("label");
const PAGE_QUERY = optStr("page-query");
const STRATEGY = optStr("strategy", PAGE_QUERY ? "candidate" : "baseline");
const HEADED = hasFlag("headed");
const JSON_ONLY = hasFlag("json");
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

const FACE_NORMALS = {
  t: [0, 0, 1],
  b: [0, 0, -1],
  fl: [0, 1, 0],
  br: [0, -1, 0],
  fr: [1, 0, 0],
  bl: [-1, 0, 0],
};

const FACE_ORDER = ["t", "b", "bl", "br", "fr", "fl"];

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

function fmt(value, digits = 1) {
  return Number.isFinite(value) ? value.toFixed(digits) : "";
}

function visibleFaceSignature(rotX, rotY) {
  const visible = [];
  for (const face of FACE_ORDER) {
    if (normalFacesCamera(FACE_NORMALS[face], { rotX, rotY })) visible.push(face);
  }
  return visible.join("|");
}

function bucketName(dt, baseFrameMs) {
  const ratio = Math.max(1, Math.round(dt / baseFrameMs));
  return ratio >= 4 ? "x4_plus" : `x${ratio}`;
}

function estimateBaseFrameMs(dts) {
  const p10 = quantile(dts, 0.1) ?? 16.667;
  return p10 < 12 ? 8.333 : 16.667;
}

function summarizeFrames(frames) {
  const dts = frames.map((frame) => frame.dt);
  const p50 = median(dts) ?? 0;
  const p95 = quantile(dts, 0.95) ?? 0;
  const p99 = quantile(dts, 0.99) ?? 0;
  const buckets = { x1: 0, x2: 0, x3: 0, x4_plus: 0 };
  for (const frame of frames) buckets[frame.bucket] = (buckets[frame.bucket] ?? 0) + 1;
  return {
    frames: frames.length,
    fps_p50: p50 > 0 ? +(1000 / p50).toFixed(2) : 0,
    fps_p95: p95 > 0 ? +(1000 / p95).toFixed(2) : 0,
    frame_time_p50_ms: +p50.toFixed(3),
    frame_time_p95_ms: +p95.toFixed(3),
    frame_time_p99_ms: +p99.toFixed(3),
    buckets,
  };
}

function normalizeRotY(rotY) {
  const normalized = rotY % 360;
  return normalized < 0 ? normalized + 360 : normalized;
}

function frameRotation(preset, absoluteSampleIndex) {
  if (MOTION !== "rot") return { rotX: preset.rotX, rotY: preset.rotY };
  return {
    rotX: preset.rotX,
    rotY: normalizeRotY(preset.rotY + absoluteSampleIndex * 0.5),
  };
}

function frameRows(samples, startIdx, preset) {
  const raw = samples
    .map((sample, index) => ({ sample, absoluteSampleIndex: startIdx + index }))
    .filter(({ sample }) => Number.isFinite(sample?.dt) && sample.dt > 0 && sample.dt < 2000);
  const baseFrameMs = estimateBaseFrameMs(raw.map(({ sample }) => sample.dt));
  return {
    baseFrameMs,
    frames: raw.map(({ sample, absoluteSampleIndex }, index) => {
      const rotation = frameRotation(preset, absoluteSampleIndex);
      return {
        index,
        absoluteSampleIndex,
        t: sample.t,
        dt: sample.dt,
        bucket: bucketName(sample.dt, baseFrameMs),
        rotX: rotation.rotX,
        rotY: rotation.rotY,
        signature: visibleFaceSignature(rotation.rotX, rotation.rotY),
      };
    }),
  };
}

function segmentFrames(frames) {
  const segments = [];
  let current = null;
  for (const frame of frames) {
    if (!current || current.signature !== frame.signature) {
      current = {
        id: segments.length,
        signature: frame.signature,
        startFrame: frame.index,
        endFrame: frame.index,
        startRotY: frame.rotY,
        endRotY: frame.rotY,
        frames: [],
      };
      segments.push(current);
    }
    current.frames.push(frame);
    current.endFrame = frame.index;
    current.endRotY = frame.rotY;
  }
  return segments.map((segment) => ({
    id: segment.id,
    signature: segment.signature,
    startFrame: segment.startFrame,
    endFrame: segment.endFrame,
    startRotY: +segment.startRotY.toFixed(3),
    endRotY: +segment.endRotY.toFixed(3),
    ...summarizeFrames(segment.frames),
  }));
}

function groupBySignature(frames) {
  const groups = new Map();
  for (const frame of frames) {
    const group = groups.get(frame.signature) ?? [];
    group.push(frame);
    groups.set(frame.signature, group);
  }
  return [...groups.entries()]
    .map(([signature, group]) => ({ signature, ...summarizeFrames(group) }))
    .sort((a, b) => FACE_ORDER.indexOf(a.signature) - FACE_ORDER.indexOf(b.signature));
}

function buildUrl(port) {
  const params = new URLSearchParams({
    mesh: MESH,
    mode: MODE,
    motion: MOTION,
  });
  const extra = PAGE_QUERY ? `&${PAGE_QUERY.replace(/^\?/, "")}` : "";
  return `http://127.0.0.1:${port}/perf-${RENDERER}.html?${params.toString()}${extra}`;
}

async function runOnce(port, repeat) {
  const preset = PRESETS[MESH];
  if (!preset) throw new Error(`Unknown bench preset: ${MESH}`);

  const launchOptions = { headless: !HEADED, args: CHROMIUM_ARGS };
  if (BROWSER_EXECUTABLE) launchOptions.executablePath = BROWSER_EXECUTABLE;
  const browser = await chromium.launch(launchOptions);
  try {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await ctx.newPage();
    await page.goto(buildUrl(port), { waitUntil: "load" });
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

    const { frames, baseFrameMs } = frameRows(pageResult.samples, startIdx, preset);
    return {
      repeat,
      strategy: STRATEGY,
      mesh: MESH,
      renderer: RENDERER,
      mode: MODE,
      motion: MOTION,
      pageQuery: PAGE_QUERY || null,
      warmup_ms: WARMUP_MS,
      sample_ms: SAMPLE_MS,
      baseFrameMs: +baseFrameMs.toFixed(3),
      ...summarizeFrames(frames),
      polyCount: pageResult.polyCount,
      renderStats: pageResult.renderStats,
      segments: segmentFrames(frames),
      signatures: groupBySignature(frames),
    };
  } finally {
    await browser.close();
  }
}

function printRun(run) {
  console.log(
    `[intervals] ${run.strategy} ${run.mesh} r${run.repeat} p50=${fmt(run.fps_p50)} p95=${fmt(run.fps_p95)} p99=${fmt(run.frame_time_p99_ms)}ms base=${fmt(run.baseFrameMs, 3)}ms`,
  );
  console.log("| Segment | Signature | RotY | Frames | p95 FPS | p99 ms | x1 | x2 | x3 | x4+ |");
  console.log("| ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |");
  for (const segment of run.segments) {
    if (segment.frames < 8) continue;
    console.log([
      `| ${segment.id}`,
      segment.signature,
      `${fmt(segment.startRotY)}-${fmt(segment.endRotY)}`,
      segment.frames,
      fmt(segment.fps_p95),
      fmt(segment.frame_time_p99_ms),
      segment.buckets.x1,
      segment.buckets.x2,
      segment.buckets.x3,
      `${segment.buckets.x4_plus} |`,
    ].join(" | "));
  }
}

const { server, port } = await startServer();
try {
  if (!JSON_ONLY) {
    console.log(`[intervals] server :${port}`);
    console.log(`[intervals] mesh=${MESH} renderer=${RENDERER} mode=${MODE} motion=${MOTION} strategy=${STRATEGY} runs=${RUNS} warmup=${WARMUP_MS}ms sample=${SAMPLE_MS}ms`);
  }
  const runs = [];
  for (let repeat = 1; repeat <= RUNS; repeat += 1) {
    const run = await runOnce(port, repeat);
    runs.push(run);
    if (!JSON_ONLY) printRun(run);
  }
  const out = {
    mesh: MESH,
    strategy: STRATEGY,
    renderer: RENDERER,
    mode: MODE,
    motion: MOTION,
    pageQuery: PAGE_QUERY || null,
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
    if (!JSON_ONLY) console.log(`[intervals] wrote ${file}`);
  }
  if (JSON_ONLY) console.log(JSON.stringify(out, null, 2));
} finally {
  await stopServer(server);
}
