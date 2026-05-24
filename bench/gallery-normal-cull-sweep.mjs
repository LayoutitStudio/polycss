#!/usr/bin/env node
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { chromiumArgsWithGpuDefault } from "./chromium-defaults.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");

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
const splitList = (value) => value.split(",").map((item) => item.trim()).filter(Boolean);

const DEFAULT_MODES = [
  "baseline",
  "display",
  "leaf-display",
  "leaf-visibility",
  "leaf-backface",
  "visibility",
  "content",
  "clip",
  "opacity",
  "scale",
  "backface",
  "transform",
];

const baseUrl = optStr("url", "http://127.0.0.1:4323/gallery/?model=glb-nasa-mars-global-surveyor");
const modes = splitList(optStr("modes", DEFAULT_MODES.join(",")));
const movements = splitList(optStr("movements", "auto,manual"));
const repeats = Math.max(1, Math.floor(optNum("repeats", 1)));
const warmupMs = Math.max(0, optNum("warmup", 1000));
const sampleMs = Math.max(250, optNum("sample", 2500));
const minBucketSize = Math.max(2, Math.floor(optNum("min-bucket-size", 64)));
const decimals = Math.max(0, Math.floor(optNum("decimals", 0)));
const outputPath = resolve(repoRoot, optStr("json", "bench/results/mgs-normal-cull-extra-sweep-chrome148.json"));
const browserExecutable = optStr("browser-executable", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome");

function quantile(sorted, q) {
  if (sorted.length === 0) return 0;
  const i = (sorted.length - 1) * q;
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
}

function summarizeFrameTimes(dts) {
  const sorted = dts.filter((dt) => Number.isFinite(dt) && dt > 0 && dt < 2000).sort((a, b) => a - b);
  const p50 = quantile(sorted, 0.5);
  const p95 = quantile(sorted, 0.95);
  const p99 = quantile(sorted, 0.99);
  return {
    fps_p50: p50 > 0 ? +(1000 / p50).toFixed(2) : 0,
    fps_p95: p95 > 0 ? +(1000 / p95).toFixed(2) : 0,
    frame_time_p50_ms: +p50.toFixed(3),
    frame_time_p95_ms: +p95.toFixed(3),
    frame_time_p99_ms: +p99.toFixed(3),
    sample_count: sorted.length,
  };
}

async function setCheckbox(page, name, checked) {
  const result = await page.evaluate(({ name, checked }) => {
    const nameEl = [...document.querySelectorAll(".lil-gui .controller .name")]
      .find((el) => el.textContent?.trim() === name);
    const controller = nameEl?.closest(".controller");
    const input = controller?.querySelector("input[type='checkbox']");
    if (!(input instanceof HTMLInputElement)) return false;
    if (input.checked !== checked) input.click();
    return input.checked === checked;
  }, { name, checked });
  if (!result) throw new Error(`Could not set checkbox "${name}" to ${checked}`);
}

async function waitForModel(page) {
  await page.waitForFunction(() =>
    document.querySelectorAll(".dn-model-mesh b,.dn-model-mesh i,.dn-model-mesh s,.dn-model-mesh u").length > 2500,
    null,
    { timeout: 60000 },
  );
  await page.waitForTimeout(250);
}

async function configureMode(page, mode) {
  await page.evaluate(({ mode, minBucketSize, decimals }) => {
    window.__polycssNormalBucketCullMode = mode;
    window.__polycssNormalBucketCullMinBucketSize = minBucketSize;
    window.__polycssNormalBucketCullDecimals = decimals;
    window.__polycssNormalBucketCullSamples = [];
  }, { mode, minBucketSize, decimals });

  if (mode === "baseline") return;
  await setCheckbox(page, "Normal bucket cull", true);
  await page.waitForFunction(() => {
    const samples = window.__polycssNormalBucketCullSamples;
    return Array.isArray(samples) && samples.length > 0;
  }, null, { timeout: 10000 });
}

async function installSampler(page) {
  await page.evaluate(() => {
    window.__polycssSweepSampler = {
      dts: [],
      running: true,
      last: 0,
    };
    const sample = (now) => {
      const state = window.__polycssSweepSampler;
      if (!state?.running) return;
      if (state.last) state.dts.push(now - state.last);
      state.last = now;
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
}

async function readSampler(page) {
  return page.evaluate(() => {
    const state = window.__polycssSweepSampler;
    if (state) state.running = false;
    return state?.dts ?? [];
  });
}

async function runManualDrag(page) {
  const box = await page.locator(".dn-viewport").boundingBox()
    ?? await page.locator(".polycss-scene").boundingBox();
  if (!box) throw new Error("Could not find scene bounds for drag");
  const startX = box.x + box.width * 0.35;
  const y = box.y + box.height * 0.55;
  const endX = box.x + box.width * 0.75;
  const steps = Math.max(30, Math.round(sampleMs / 16));
  await page.mouse.move(startX, y);
  await page.mouse.down();
  for (let i = 1; i <= steps; i += 1) {
    const t = i / steps;
    await page.mouse.move(startX + (endX - startX) * t, y, { steps: 1 });
    await page.waitForTimeout(Math.max(1, Math.round(sampleMs / steps)));
  }
  await page.mouse.up();
}

async function collectDomStats(page) {
  return page.evaluate(() => {
    const leaves = [...document.querySelectorAll(".dn-model-mesh b,.dn-model-mesh i,.dn-model-mesh s,.dn-model-mesh u")];
    const buckets = [...document.querySelectorAll(".polycss-normal-cull-bucket")];
    const leafCounts = { b: 0, i: 0, s: 0, u: 0 };
    for (const leaf of leaves) {
      const tag = leaf.tagName.toLowerCase();
      if (tag in leafCounts) leafCounts[tag] += 1;
    }
    const hiddenDisplayLeaves = leaves.filter((leaf) => getComputedStyle(leaf).display === "none").length;
    const hiddenVisibilityLeaves = leaves.filter((leaf) => getComputedStyle(leaf).visibility === "hidden").length;
    const backfaceHiddenLeaves = leaves.filter((leaf) => getComputedStyle(leaf).backfaceVisibility === "hidden").length;
    const hiddenBuckets = buckets.filter((bucket) => {
      const style = getComputedStyle(bucket);
      return style.display === "none" || style.visibility === "hidden" || style.opacity === "0";
    }).length;
    const cullSamples = window.__polycssNormalBucketCullSamples ?? [];
    return {
      leaves: leaves.length,
      leafCounts,
      buckets: buckets.length,
      hiddenBuckets,
      hiddenDisplayLeaves,
      hiddenVisibilityLeaves,
      backfaceHiddenLeaves,
      cullSampleCount: cullSamples.length,
      cullLastSample: cullSamples.at(-1) ?? null,
      support: {
        borderShape: CSS.supports("border-shape", "polygon(0 0,100% 0,0 100%) circle(0)"),
        contentVisibility: "contentVisibility" in document.documentElement.style,
      },
    };
  });
}

async function runOne(browser, mode, movement, repeat) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
  try {
    await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
    await waitForModel(page);
    await configureMode(page, mode);
    if (movement === "auto") {
      await setCheckbox(page, "Auto rotate", true);
    }
    await page.waitForTimeout(warmupMs);
    await installSampler(page);
    if (movement === "manual") {
      await runManualDrag(page);
    } else {
      await page.waitForTimeout(sampleMs);
    }
    const dts = await readSampler(page);
    const dom = await collectDomStats(page);
    return {
      mode,
      movement,
      repeat,
      summary: summarizeFrameTimes(dts),
      dom,
    };
  } finally {
    await page.close();
  }
}

const browser = await chromium.launch({
  headless: true,
  executablePath: browserExecutable,
  args: chromiumArgsWithGpuDefault([]),
});

const results = [];
try {
  for (const movement of movements) {
    for (const mode of modes) {
      for (let repeat = 1; repeat <= repeats; repeat += 1) {
        const result = await runOne(browser, mode, movement, repeat);
        results.push(result);
        const { fps_p50, fps_p95, frame_time_p95_ms } = result.summary;
        console.log(`${movement.padEnd(6)} ${mode.padEnd(16)} #${repeat} fps50=${fps_p50} fps95=${fps_p95} p95=${frame_time_p95_ms}ms`);
      }
    }
  }
} finally {
  await browser.close();
}

const artifact = {
  createdAt: new Date().toISOString(),
  browserVersion: await chromium.launch({
    headless: true,
    executablePath: browserExecutable,
    args: chromiumArgsWithGpuDefault([]),
  }).then(async (b) => {
    const version = b.version();
    await b.close();
    return version;
  }),
  baseUrl,
  warmupMs,
  sampleMs,
  repeats,
  minBucketSize,
  decimals,
  modes,
  movements,
  results,
};

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(artifact, null, 2)}\n`);
console.log(`wrote ${outputPath}`);
