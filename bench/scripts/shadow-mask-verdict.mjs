#!/usr/bin/env node
/**
 * Shadow-MASK parity verdict — the better oracle.
 *
 * Instead of a luma diff with a tolerance knob, this drives both engines
 * into "shadows only" mode (PolyCSS hides meshes → shadow SVGs only;
 * three.js → ShadowMaterial), reduces each REAL render to a binary
 * "in shadow?" mask, and compares shadow SHAPE: missing (three shadowed,
 * PolyCSS lit = a hole), extra (PolyCSS shadowed, three lit). three.js
 * stays the reference; only the comparison method changes.
 *
 * Writes illustration PNGs (diff classification + the on-render green
 * occluder outlines) next to the JSON verdict.
 *
 * Usage:
 *   node bench/scripts/shadow-mask-verdict.mjs "<shadow-oracle URL>" [outPrefix]
 *
 * Server must be running on :4400.
 */
import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';

const url = process.argv[2];
if (!url) { console.error('usage: shadow-mask-verdict.mjs <url> [outPrefix]'); process.exit(2); }
const prefix = process.argv[3] ?? '/tmp/shadow-mask';

const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu-rasterization'] });
const ctx = await browser.newContext({ viewport: { width: 1500, height: 950 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
page.on('pageerror', e => console.error('[pageerror]', e.message));
await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForTimeout(6500);

await page.evaluate(() => window.oracleSetHelpersHidden(true));
// Shadows-only mode for clean binary masks on both engines.
await page.evaluate(() => window.oracleSetShadowsOnly(true));
await page.waitForTimeout(800); // SVG recolor + three ShadowMaterial render

const shot = await (await page.$('#poly-host')).screenshot();
const json = await page.evaluate(
  d => window.oracleMaskCompare(d),
  'data:image/png;base64,' + shot.toString('base64'),
);

// Illustration 1: the diff classification (red=missing, blue=extra).
await (await page.$('.stage.diff')).screenshot({ path: `${prefix}-diff.png` });
// Illustration 2: back to normal render so the green occluder outlines show.
await page.evaluate(() => window.oracleSetShadowsOnly(false));
await page.evaluate(() => window.oracleSetHelpersHidden(true));
await page.waitForTimeout(400);
await (await page.$('.stage.polycss')).screenshot({ path: `${prefix}-render.png` });
await (await page.$('.stage.three')).screenshot({ path: `${prefix}-three.png` });

writeFileSync(`${prefix}.json`, JSON.stringify(json, null, 2));
console.log(JSON.stringify(json, null, 2));
console.error(`wrote ${prefix}-diff.png ${prefix}-render.png ${prefix}-three.png ${prefix}.json`);
await browser.close();
