#!/usr/bin/env node
/**
 * Visual + structural diagnostic for the baked-mode cast-shadow path.
 *
 * Renders the same minimal cube-on-a-ground scene in four configurations
 * (baked/dynamic × castShadow on/off) and reports:
 *   - element counts (leaves, shadow leaves, mesh wrappers)
 *   - scene-root state (`--shadow-ground-cssz`, `--clx`, data-polycss-lighting)
 *   - inline transform on the first few shadow leaves
 *   - a screenshot of each variant
 *
 * Usage:
 *   node bench/baked-shadow-diagnose.mjs           # headless, all variants
 *   node bench/baked-shadow-diagnose.mjs --headed  # open browser
 *   node bench/baked-shadow-diagnose.mjs --port=4400
 *
 * Requires the bench bundle to be built first (`node bench/build.mjs` or
 * `pnpm bench:build`).
 */
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { chromiumArgsWithGpuDefault } from "./chromium-defaults.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");

const argv = process.argv.slice(2);
const optStr = (name, dflt = "") => {
  const i = argv.indexOf(`--${name}`);
  if (i >= 0) return argv[i + 1] ?? dflt;
  const eq = argv.find((a) => a.startsWith(`--${name}=`));
  return eq ? eq.slice(name.length + 3) : dflt;
};
const hasFlag = (name) => argv.includes(`--${name}`) || argv.includes(`--${name}=true`);

const PORT = Number(optStr("port", "4400"));
const HEADED = hasFlag("headed");

// Start the perf-serve static server so the .generated/polycss.js bundle
// resolves under the same origin as the HTML page.
const serverProc = spawn(
  "node",
  ["bench/perf-serve.mjs", "--port", String(PORT)],
  { cwd: repoRoot, stdio: ["ignore", "pipe", "pipe"] },
);
await new Promise((resolveReady) => {
  const onLine = (data) => {
    if (String(data).includes("[perf-serve] index")) {
      serverProc.stdout.off("data", onLine);
      resolveReady();
    }
  };
  serverProc.stdout.on("data", onLine);
});

const outDir = resolve(repoRoot, "bench/results/baked-shadow");
await mkdir(outDir, { recursive: true });

const browser = await chromium.launch({
  headless: !HEADED,
  args: chromiumArgsWithGpuDefault([], { softwareBackend: false }),
});

const variants = [
  { name: "baked-cast",    query: "?mode=baked&cast=1" },
  { name: "baked-nocast",  query: "?mode=baked&cast=0" },
  { name: "dynamic-cast",  query: "?mode=dynamic&cast=1" },
  { name: "dynamic-nocast",query: "?mode=dynamic&cast=0" },
];

const report = {};

try {
  const ctx = await browser.newContext({ viewport: { width: 800, height: 600 } });
  for (const v of variants) {
    const page = await ctx.newPage();
    const url = `http://localhost:${PORT}/baked-shadow.html${v.query}`;
    const consoleMsgs = [];
    page.on("console", (msg) => {
      if (msg.type() === "error" || msg.type() === "warning") {
        consoleMsgs.push(`[${msg.type()}] ${msg.text()}`);
      }
    });
    page.on("pageerror", (err) => {
      consoleMsgs.push(`[pageerror] ${err.message}`);
    });

    await page.goto(url, { waitUntil: "networkidle", timeout: 10000 });
    // Give the scene a tick to render.
    await page.waitForTimeout(200);

    const snapshot = await page.evaluate(() => window.__polySnapshot());

    const shotPath = resolve(outDir, `${v.name}.png`);
    await page.screenshot({ path: shotPath, fullPage: false });

    report[v.name] = {
      url,
      snapshot,
      consoleMsgs,
      screenshot: shotPath.slice(repoRoot.length + 1),
    };

    await page.close();
  }
} finally {
  await browser.close();
  serverProc.kill();
}

const summaryPath = resolve(outDir, "report.json");
await writeFile(summaryPath, JSON.stringify(report, null, 2));

console.log("\n──── baked-shadow diagnose report ────\n");
for (const [name, r] of Object.entries(report)) {
  console.log(`▷ ${name}  (${r.url})`);
  const s = r.snapshot;
  console.log(`    mode=${s.mode}  cast=${s.castShadow}  data-polycss-lighting=${s.lightingAttr}`);
  console.log(`    meshes=${s.meshCount}  leaves=${s.leafCount}  shadows=${s.shadowCount}`);
  console.log(`    --shadow-ground-cssz=${s.groundCssZ_var}  --clx=${s.clx_var}`);
  if (s.sample.length > 0) {
    console.log(`    shadow leaf samples:`);
    for (const sa of s.sample) {
      const t = sa.transform.length > 100 ? sa.transform.slice(0, 100) + "…" : sa.transform;
      console.log(`      transform: ${t}`);
      console.log(`      width=${sa.width} height=${sa.height} color=${sa.color}`);
    }
  }
  if (r.consoleMsgs.length > 0) {
    console.log(`    !! console:`);
    for (const m of r.consoleMsgs) console.log(`       ${m}`);
  }
  console.log(`    screenshot: ${r.screenshot}\n`);
}

console.log(`Full report: ${summaryPath.slice(repoRoot.length + 1)}`);
