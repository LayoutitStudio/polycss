#!/usr/bin/env node
/**
 * Headless shadow-oracle verdict.
 *
 * Drives bench/shadow-oracle.html with a deterministic URL, screenshots
 * #poly-host with the REAL compositor (Playwright — captures the
 * 3D-`matrix3d`-transformed receiver-shadow SVGs that html-to-image drops),
 * hands it to the in-page oracle, and prints the JSON verdict: every polygon
 * (across ALL meshes — caster model + floor receiver) whose rendered
 * shading/shadow disagrees with three.js beyond the luma tolerance.
 *
 * Usage:
 *   node bench/scripts/shadow-oracle-verdict.mjs "<shadow-oracle URL>" [outFile.json]
 *
 * Server must be running on :4400 (node bench/perf-serve.mjs).
 */
import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';

const url = process.argv[2];
if (!url) { console.error('usage: shadow-oracle-verdict.mjs <url> [out.json]'); process.exit(2); }
const outFile = process.argv[3];

const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu-rasterization'] });
const ctx = await browser.newContext({ viewport: { width: 1500, height: 950 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
page.on('pageerror', e => console.error('[pageerror]', e.message));
await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
// Settle: atlas blobs + shadow SVGs + three draw.
await page.waitForTimeout(6500);

// Hide the light helper, let it present, screenshot the real PolyCSS render.
await page.evaluate(() => window.oracleSetHelpersHidden(true));
await page.waitForTimeout(200);
const host = await page.$('#poly-host');
const shot = await host.screenshot();
const dataUrl = 'data:image/png;base64,' + shot.toString('base64');

const json = await page.evaluate(d => window.oracleCompareWithImage(d), dataUrl);
await page.evaluate(() => window.oracleSetHelpersHidden(false));

if (!json) { console.error('oracle returned null'); process.exit(1); }
const out = JSON.stringify(json, null, 2);
if (outFile) { writeFileSync(outFile, out); console.error('wrote', outFile); }
console.log(out);
await browser.close();
