#!/usr/bin/env node
/**
 * Visual parity check for non-voxel bench variants.
 *
 * This compares nonvoxel-vanilla.html variants against the baked baseline at
 * a static camera pose. It is intentionally bench-only: the goal is to reject
 * performance leads that alter projection before they reach product code.
 */
import { createServer } from "node:http";
import { mkdirSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { getNonVoxelVariantParams, knownNonVoxelVariantIds } from "./nonvoxel-variants.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");
const benchDir = resolve(repoRoot, "bench");
const galleryDir = resolve(repoRoot, "website/public/gallery");
const resultsDir = resolve(benchDir, "results");

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

const MODE = optStr("mode", "baked");
const MOTION = optStr("motion", "none");
const THRESHOLD = optNum("threshold", 0.01);
const WIDTH = optNum("width", 1280);
const HEIGHT = optNum("height", 800);
const SETTLE_MS = optNum("settle", 250);
const JSON_PATH = optStr("json");
const SCREENSHOT_DIR = optStr("screenshots");
const HEADED = hasFlag("headed");
const BROWSER_EXECUTABLE = optStr("browser-executable");
const CHROMIUM_ARGS = [
  ...optAll("chromium-arg"),
  ...optAll("chromium-args").flatMap((value) => value.split(/\s+/).filter(Boolean)),
];

const MODELS = [
  { id: "chicken", mesh: "chicken" },
  { id: "rock1", mesh: "rock1" },
  { id: "saucer", mesh: "saucer" },
  { id: "teapot", mesh: "teapot" },
  { id: "ducky", mesh: "ducky" },
  { id: "violin", mesh: "glb:Violin.glb", params: { zoom: "0.35", targetSize: "60" } },
  { id: "elephant", mesh: "glb:Elephant.glb", params: { zoom: "0.35", targetSize: "60" } },
  { id: "policecar", mesh: "glb:Policecar.glb", params: { zoom: "0.35", targetSize: "60" } },
];

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

function splitList(value) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function selectedModels() {
  const requested = splitList(optStr("models"));
  if (requested.length === 0) return MODELS;
  const byId = new Map(MODELS.map((model) => [model.id, model]));
  return requested.map((id) => {
    const known = byId.get(id);
    if (known) return known;
    if (id.startsWith("glb:") || id.startsWith("obj:")) {
      return { id: id.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, ""), mesh: id };
    }
    throw new Error(`Unknown model "${id}". Known: ${MODELS.map((model) => model.id).join(", ")}`);
  });
}

function selectedVariants() {
  const requested = splitList(optStr("variants", "scene-split-target,scene-transform-perspective"));
  return requested.map((id) => {
    const params = getNonVoxelVariantParams(id);
    if (!params) throw new Error(`Unknown variant "${id}". Known: ${knownNonVoxelVariantIds().join(", ")}`);
    if (id === "baseline") throw new Error("Baseline is implicit; do not include it in --variants.");
    return { id, params };
  });
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

function queryString(model, params = {}) {
  const search = new URLSearchParams({
    mesh: model.mesh,
    mode: MODE,
    motion: MOTION,
    ...model.params,
    ...params,
  });
  return search.toString();
}

async function waitForReady(page) {
  await page.waitForFunction(() => window.__perf__?.ready === true, null, { timeout: 30000 });
  await page.waitForFunction(() => document.querySelectorAll(".polycss-scene b,.polycss-scene i,.polycss-scene s,.polycss-scene u").length > 0, null, { timeout: 30000 });
  await page.addStyleTag({ content: "#fps{display:none!important}" });
  await page.waitForTimeout(SETTLE_MS);
}

async function screenshotVariant(page, port, model, variant) {
  const url = `http://127.0.0.1:${port}/nonvoxel-vanilla.html?${queryString(model, variant.params)}`;
  await page.goto(url, { waitUntil: "load" });
  await waitForReady(page);
  return {
    buffer: await page.screenshot({ fullPage: false }),
    url,
    renderStats: await page.evaluate(() => window.__perf__?.renderStats ?? null),
    sceneTransform: await page.evaluate(() => {
      const scene = document.querySelector(".polycss-scene");
      const host = document.getElementById("host");
      return {
        scene: scene instanceof HTMLElement ? scene.style.transform : "",
        scenePerspective: scene instanceof HTMLElement ? scene.style.perspective : "",
        hostPerspective: host instanceof HTMLElement ? host.style.perspective : "",
        shell: document.querySelector(".polycss-scene > div") instanceof HTMLElement
          ? document.querySelector(".polycss-scene > div").style.transform
          : "",
      };
    }),
  };
}

async function compareBuffers(page, baseline, candidate) {
  return await page.evaluate(async ({ baselineB64, candidateB64 }) => {
    async function loadImageData(b64) {
      const img = new Image();
      img.src = `data:image/png;base64,${b64}`;
      await img.decode();
      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0);
      return ctx.getImageData(0, 0, canvas.width, canvas.height);
    }

    const [a, b] = await Promise.all([loadImageData(baselineB64), loadImageData(candidateB64)]);
    if (a.width !== b.width || a.height !== b.height) {
      return { ok: false, reason: "size", baselineSize: [a.width, a.height], candidateSize: [b.width, b.height] };
    }

    let sum = 0;
    let max = 0;
    let changedPixels = 0;
    const pixelCount = a.width * a.height;
    for (let i = 0; i < a.data.length; i += 4) {
      const dr = Math.abs(a.data[i] - b.data[i]);
      const dg = Math.abs(a.data[i + 1] - b.data[i + 1]);
      const db = Math.abs(a.data[i + 2] - b.data[i + 2]);
      const pixel = Math.max(dr, dg, db);
      if (pixel > 0) changedPixels += 1;
      max = Math.max(max, pixel);
      sum += dr + dg + db;
    }

    return {
      ok: true,
      meanDelta: (sum / (pixelCount * 3)) / 255,
      maxDelta: max / 255,
      changedPixelRatio: changedPixels / pixelCount,
    };
  }, {
    baselineB64: baseline.toString("base64"),
    candidateB64: candidate.toString("base64"),
  });
}

function screenshotPath(modelId, variantId) {
  return resolve(SCREENSHOT_DIR, `${modelId}-${MODE}-${variantId}.png`);
}

async function main() {
  const models = selectedModels();
  const variants = selectedVariants();
  const { server, port } = await startServer();
  let browser;
  try {
    browser = await chromium.launch({
      headless: !HEADED,
      ...(BROWSER_EXECUTABLE ? { executablePath: BROWSER_EXECUTABLE } : {}),
      args: CHROMIUM_ARGS,
    });
    const context = await browser.newContext({ viewport: { width: WIDTH, height: HEIGHT } });
    const page = await context.newPage();
    if (SCREENSHOT_DIR) mkdirSync(SCREENSHOT_DIR, { recursive: true });

    const results = [];
    for (const model of models) {
      const baseline = await screenshotVariant(page, port, model, { id: "baseline", params: {} });
      if (SCREENSHOT_DIR) writeFileSync(screenshotPath(model.id, "baseline"), baseline.buffer);
      for (const variant of variants) {
        const candidate = await screenshotVariant(page, port, model, variant);
        if (SCREENSHOT_DIR) writeFileSync(screenshotPath(model.id, variant.id), candidate.buffer);
        const comparison = await compareBuffers(page, baseline.buffer, candidate.buffer);
        const meanDelta = comparison.ok ? comparison.meanDelta : Infinity;
        const pass = comparison.ok && meanDelta <= THRESHOLD;
        results.push({
          model: model.id,
          mesh: model.mesh,
          variant: variant.id,
          pass,
          threshold: THRESHOLD,
          ...comparison,
          meanDelta: Number.isFinite(meanDelta) ? +meanDelta.toFixed(6) : meanDelta,
          maxDelta: comparison.ok ? +comparison.maxDelta.toFixed(6) : null,
          changedPixelRatio: comparison.ok ? +comparison.changedPixelRatio.toFixed(6) : null,
          renderStats: candidate.renderStats,
          transforms: {
            baseline: baseline.sceneTransform,
            candidate: candidate.sceneTransform,
          },
          url: candidate.url,
        });
      }
    }

    const report = {
      generatedAt: new Date().toISOString(),
      mode: MODE,
      motion: MOTION,
      viewport: { width: WIDTH, height: HEIGHT },
      threshold: THRESHOLD,
      pass: results.every((result) => result.pass),
      results,
    };

    if (JSON_PATH) {
      mkdirSync(dirname(resolve(JSON_PATH)), { recursive: true });
      writeFileSync(resolve(JSON_PATH), `${JSON.stringify(report, null, 2)}\n`);
    }

    console.log(JSON.stringify(report, null, 2));
    await context.close();
    process.exitCode = report.pass ? 0 : 1;
  } finally {
    if (browser) await browser.close();
    await stopServer(server);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
