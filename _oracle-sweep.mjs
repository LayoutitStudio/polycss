// One-off sweep over camera + light direction × the castle mesh.
// Drives the shadow-oracle, captures top-N misclassified polys per
// config, aggregates how often each polygon appears across configs.
// Output:
//   - console summary (top configs by total flagged px + top polys by
//     # configs they appear in)
//   - _sweep-results/config-XXX.png screenshots of the top-5 worst configs
import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";

const OUT_DIR = "_sweep-results";
const TOL = 40;

// Smaller grid for the first sweep — 2 pitches × 3 azimuths × 4 lights = 24 configs.
const CAM_PITCHES = [45, 70];
const CAM_AZIMUTHS = [30, 150, 270];
const LIGHT_CONFIGS = [
  { az: 60,  el: 30 }, { az: 200, el: 30 },
  { az: 60,  el: 60 }, { az: 200, el: 60 },
];
const ZOOM = 80;  // moderate zoom — close enough to see issues, far enough to see whole castle

await mkdir(OUT_DIR, { recursive: true });

function lightDirFromAzEl(az, el) {
  const a = az * Math.PI / 180, e = el * Math.PI / 180;
  return [Math.cos(e) * Math.sin(a), Math.cos(e) * Math.cos(a), Math.sin(e)];
}

function buildUrl(camPitch, camAz, lightAz, lightEl) {
  const [dx, dy, dz] = lightDirFromAzEl(lightAz, lightEl);
  return `http://localhost:4400/shadow-oracle.html?mesh=castle&light=baked` +
    `&dx=${dx}&dy=${dy}&dz=${dz}&di=1&ai=0.3&so=1` +
    `&rx=${camPitch}&ry=${camAz}&z=${ZOOM}&tol=${TOL}`;
}

const browser = await chromium.launch({
  args: ["--enable-unsafe-swiftshader", "--use-gl=angle", "--use-angle=swiftshader", "--ignore-gpu-blocklist"],
});
const ctx = await browser.newContext({ viewport: { width: 1800, height: 1100 } });
const page = await ctx.newPage();

const configs = [];
for (const camPitch of CAM_PITCHES) {
  for (const camAz of CAM_AZIMUTHS) {
    for (const light of LIGHT_CONFIGS) {
      configs.push({ camPitch, camAz, light });
    }
  }
}
console.log(`Sweeping ${configs.length} configs (cam ${CAM_PITCHES.length}×${CAM_AZIMUTHS.length}, light ${LIGHT_CONFIGS.length}) …`);

const results = [];
// Per-poly aggregation across all configs.
const polyHits = new Map();   // polyIdx → { count, totalPx, totalDelta, configs: [] }

const t0 = Date.now();
for (let i = 0; i < configs.length; i++) {
  const cfg = configs[i];
  const url = buildUrl(cfg.camPitch, cfg.camAz, cfg.light.az, cfg.light.el);
  await page.goto(url, { waitUntil: "networkidle" });
  await page.evaluate(async () => {
    const sel = document.querySelector("#panel select");
    if (sel) { sel.value = "castle"; sel.dispatchEvent(new Event("change")); }
  });
  await page.waitForTimeout(11500);
  await page.evaluate(() => document.querySelector("#panel button").click());
  await page.waitForTimeout(3500);
  const oracle = await page.evaluate(() => {
    if (!window.__oracle) return null;
    return {
      polys: window.__oracle.ranked.map((r) => ({ idx: r.idx, pixels: r.pixels, median: r.median })),
    };
  });
  const status = await page.locator("#panel >> text=/base Δ/").first().textContent().catch(() => null);
  if (!oracle) {
    console.log(`  [${i + 1}/${configs.length}] cam(${cfg.camPitch},${cfg.camAz}) light(${cfg.light.az},${cfg.light.el}) — NO ORACLE`);
    continue;
  }
  const totalFlaggedPx = oracle.polys.reduce((s, p) => s + p.pixels, 0);
  results.push({ cfg, totalFlaggedPx, polyCount: oracle.polys.length, polys: oracle.polys, status });
  console.log(`  [${i + 1}/${configs.length}] cam(${cfg.camPitch},${cfg.camAz}) light(${cfg.light.az},${cfg.light.el}) — ${oracle.polys.length} polys · ${totalFlaggedPx}px`);
  for (const p of oracle.polys) {
    let entry = polyHits.get(p.idx);
    if (!entry) {
      entry = { idx: p.idx, count: 0, totalPx: 0, totalDelta: 0, configs: [] };
      polyHits.set(p.idx, entry);
    }
    entry.count += 1;
    entry.totalPx += p.pixels;
    entry.totalDelta += p.median;
    entry.configs.push({ camPitch: cfg.camPitch, camAz: cfg.camAz, lightAz: cfg.light.az, lightEl: cfg.light.el, px: p.pixels, med: p.median });
  }
}
const elapsedMs = Date.now() - t0;

console.log(`\nDone. ${results.length} configs in ${(elapsedMs / 1000).toFixed(0)}s.`);

// Top 5 worst configs by total flagged px.
const worstConfigs = [...results].sort((a, b) => b.totalFlaggedPx - a.totalFlaggedPx).slice(0, 5);
console.log("\n=== TOP 5 WORST CONFIGS (by total flagged px) ===");
for (const r of worstConfigs) {
  console.log(`  cam(${r.cfg.camPitch},${r.cfg.camAz}) light(${r.cfg.light.az},${r.cfg.light.el}) ` +
    `→ ${r.polyCount} polys · ${r.totalFlaggedPx}px`);
  // Top 3 polys for this config
  for (const p of r.polys.slice(0, 3)) {
    console.log(`      #${p.idx}: ${p.pixels}px med Δ${p.median.toFixed(1)}`);
  }
}

// Top 20 most persistently misclassified polygons.
const persistent = [...polyHits.values()].sort((a, b) => b.count - a.count || b.totalPx - a.totalPx).slice(0, 20);
console.log(`\n=== TOP 20 POLYGONS BY # CONFIGS APPEARING (out of ${results.length}) ===`);
for (const p of persistent) {
  const avgDelta = (p.totalDelta / p.count).toFixed(1);
  console.log(`  #${p.idx}: flagged in ${p.count}/${results.length} configs · ${p.totalPx}px total · avg med Δ${avgDelta}`);
}

// Screenshot the worst configs.
for (let i = 0; i < worstConfigs.length; i++) {
  const r = worstConfigs[i];
  const url = buildUrl(r.cfg.camPitch, r.cfg.camAz, r.cfg.light.az, r.cfg.light.el);
  await page.goto(url, { waitUntil: "networkidle" });
  await page.evaluate(async () => {
    const sel = document.querySelector("#panel select");
    if (sel) { sel.value = "castle"; sel.dispatchEvent(new Event("change")); }
  });
  await page.waitForTimeout(11500);
  await page.evaluate(() => document.querySelector("#panel button").click());
  await page.waitForTimeout(3500);
  const file = `${OUT_DIR}/worst-${i + 1}-cam${r.cfg.camPitch}_${r.cfg.camAz}-light${r.cfg.light.az}_${r.cfg.light.el}.png`;
  await page.screenshot({ path: file });
  console.log(`  Saved ${file}`);
}

await writeFile(`${OUT_DIR}/sweep-results.json`, JSON.stringify({
  configsRun: results.length,
  elapsedMs,
  tol: TOL,
  zoom: ZOOM,
  worstConfigs,
  persistent: [...polyHits.values()].sort((a, b) => b.count - a.count || b.totalPx - a.totalPx),
}, null, 2));
console.log(`\nFull JSON: ${OUT_DIR}/sweep-results.json`);
await browser.close();
