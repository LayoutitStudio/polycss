#!/usr/bin/env node
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { chromiumArgsWithGpuDefault } from "./chromium-defaults.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");
const benchDir = resolve(repoRoot, "bench");
const galleryDir = resolve(repoRoot, "website/public/gallery");

const args = new Map(process.argv.slice(2).map((arg) => {
  const [key, ...rest] = arg.replace(/^--/, "").split("=");
  return [key, rest.length ? rest.join("=") : "true"];
}));

const MESH = args.get("mesh") ?? "obj-house3";
const RENDERER = args.get("renderer") ?? "vanilla";
const MODE = args.get("mode") ?? "baked";
const MOTION = args.get("motion") ?? "rot";
const WARMUP_MS = Number(args.get("warmup") ?? 1200);
const SAMPLE_MS = Number(args.get("sample") ?? 2500);
const HEADED = args.has("headed");
const SOFTWARE_BACKEND = args.has("software-backend");
const CHROMIUM_ARGS = chromiumArgsWithGpuDefault((args.get("chromium-args") ?? "")
  .split(/\s+/)
  .map((value) => value.trim())
  .filter(Boolean), { softwareBackend: SOFTWARE_BACKEND });
const EVENT_NAMES = (args.get("events") ??
  "SoftwareRenderer::DoDrawQuad,DirectRenderer::DrawRenderPass,MainFrame.Draw,LayerTreeHostImpl::PrepareToDraw")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

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
  "cc",
  "disabled-by-default-cc.debug",
  "gpu",
  "viz",
  "disabled-by-default-viz.debug",
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

function collectArgShape(value, depth = 0) {
  if (value == null || depth > 2) return value;
  if (typeof value !== "object") return typeof value;
  if (Array.isArray(value)) return [`array(${value.length})`, collectArgShape(value[0], depth + 1)];
  return Object.fromEntries(Object.entries(value).slice(0, 12).map(([key, item]) => [
    key,
    collectArgShape(item, depth + 1),
  ]));
}

const { server, port } = await startServer();
const browser = await chromium.launch({
  headless: !HEADED,
  args: [
    "--disable-background-timer-throttling",
    "--disable-renderer-backgrounding",
    "--disable-backgrounding-occluded-windows",
    ...CHROMIUM_ARGS,
  ],
});

try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  const events = [];
  cdp.on("Tracing.dataCollected", (payload) => {
    if (Array.isArray(payload.value)) events.push(...payload.value);
  });
  const url = `http://127.0.0.1:${port}/perf-${RENDERER}.html?mesh=${encodeURIComponent(MESH)}&mode=${encodeURIComponent(MODE)}&motion=${encodeURIComponent(MOTION)}`;
  await page.goto(url, { waitUntil: "load" });
  await page.waitForFunction(() => window.__perf__?.ready === true, null, { timeout: 30000 });
  await page.waitForTimeout(WARMUP_MS);
  await cdp.send("Tracing.start", {
    transferMode: "ReportEvents",
    categories: TRACE_CATEGORIES,
  });
  await page.waitForTimeout(SAMPLE_MS);
  await new Promise(async (resolveStop) => {
    cdp.once("Tracing.tracingComplete", resolveStop);
    await cdp.send("Tracing.end");
  });
  for (const eventName of EVENT_NAMES) {
    const matches = events.filter((event) => event.name === eventName);
    console.log(`\n## ${eventName} (${matches.length})`);
    const samples = matches.slice(0, 8).map((event) => ({
      ph: event.ph,
      dur_us: event.dur,
      cat: event.cat,
      argsShape: collectArgShape(event.args),
      args: event.args,
    }));
    console.dir(samples, { depth: 8, colors: false, maxArrayLength: 20 });
  }
  await ctx.close();
} finally {
  await browser.close();
  await stopServer(server);
}
