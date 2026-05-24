#!/usr/bin/env node
/**
 * Loads bench/composite-shadow.html (caster pole on receiver cube) and
 * dumps the resulting shadow SVG structure + a screenshot. Used to
 * validate the experimental per-receiver-face shadow projection in
 * polycss createPolyScene.
 */
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { chromiumArgsWithGpuDefault } from "./chromium-defaults.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");

const PORT = 4400;
const HEADED = process.argv.includes("--headed");

const outDir = resolve(repoRoot, "bench/results/composite-shadow");
await mkdir(outDir, { recursive: true });

const server = spawn(
  "node",
  ["bench/perf-serve.mjs", "--port", String(PORT)],
  { cwd: repoRoot, stdio: ["ignore", "pipe", "pipe"] },
);
await new Promise((ok) => {
  const onLine = (data) => {
    if (String(data).includes("[perf-serve] index")) {
      server.stdout.off("data", onLine);
      ok();
    }
  };
  server.stdout.on("data", onLine);
});

const browser = await chromium.launch({
  headless: !HEADED,
  args: chromiumArgsWithGpuDefault([], { softwareBackend: false }),
});

try {
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 } });
  const page = await ctx.newPage();
  page.on("pageerror", (err) => console.log(`[pageerror] ${err.message}`));
  page.on("console", (msg) => {
    if (msg.type() === "error") console.log(`[console.error] ${msg.text()}`);
  });

  await page.goto(`http://localhost:${PORT}/composite-shadow.html`, {
    waitUntil: "networkidle",
    timeout: 10000,
  });
  await page.waitForTimeout(500);

  const snap = await page.evaluate(() => {
    const shadows = document.querySelectorAll("svg.polycss-shadow");
    const receiverShadows = document.querySelectorAll("svg.polycss-shadow-receiver");
    return {
      shadowCount: shadows.length,
      receiverShadowCount: receiverShadows.length,
      shadowOuter: Array.from(shadows).slice(0, 4).map((svg) => ({
        classes: svg.getAttribute("class"),
        width: svg.getAttribute("width"),
        height: svg.getAttribute("height"),
        transform: svg.style.transform.slice(0, 120),
        pathD: svg.querySelector("path")?.getAttribute("d")?.slice(0, 120),
      })),
    };
  });

  console.log(JSON.stringify(snap, null, 2));

  await page.screenshot({ path: resolve(outDir, "composite.png"), fullPage: false });
  console.log(`Screenshot: ${outDir}/composite.png`);
} finally {
  await browser.close();
  server.kill();
}
