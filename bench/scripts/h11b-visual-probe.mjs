#!/usr/bin/env node
/**
 * Visual probe for H11b at higher zoom — settles into a zoomed view of
 * the teapot self-shadow case so the proxy-vs-per-face shadow geometry
 * is actually visible (the default shadow-regression captures at zoom
 * 0.2 reduce the teapot to a small diamond).
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const PORT = Number(process.env.BENCH_PORT ?? 4400);
const REPO = resolve(import.meta.dirname, '../..');

const AZIMUTHS = [50, 130, 220];
const ZOOM = 3.0;

function urlFor(az) {
  const p = new URLSearchParams({
    mesh: 'teapot',
    mode: 'dynamic',
    motion: 'none',
    cs: '1', ss: '1', fv: '1', fr: '1',
    az: String(az), el: '45',
    zoom: String(ZOOM),
    nohud: '1',
  });
  return `http://localhost:${PORT}/perf-vanilla.html?${p.toString()}`;
}

const label = process.argv[2];
if (!label) { console.error('Usage: h11b-visual-probe.mjs <label>'); process.exit(2); }
const outDir = resolve(REPO, 'bench/results/h11b-visual', label);
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu-rasterization'] });
for (const az of AZIMUTHS) {
  const ctx = await browser.newContext({ viewport: { width: 1024, height: 768 } });
  const page = await ctx.newPage();
  try {
    await page.goto(urlFor(az), { waitUntil: 'load', timeout: 30_000 });
    await page.waitForFunction(() => window.__perf__?.ready === true, null, { timeout: 30_000 });
    await page.waitForTimeout(6_000);
    const png = `teapot-self-az${az}-z${ZOOM}.png`;
    await page.screenshot({ path: `${outDir}/${png}` });
    console.log(`[${label}] az${az}: ${outDir}/${png}`);
  } finally {
    await page.close();
    await ctx.close();
  }
}
await browser.close();
