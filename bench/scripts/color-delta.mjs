#!/usr/bin/env node
/**
 * Shadow COLOR calibration — PolyCSS vs three.js.
 *
 * Renders both engines in NORMAL mode (real materials), aligns them at host
 * resolution, and reports the per-channel color delta (PolyCSS − three.js)
 * split into SHADOW pixels vs LIT floor, plus a signed-delta heatmap.
 *
 * Usage: node bench/scripts/color-delta.mjs "<oracle URL>" [outPrefix]
 * Server must be running (default :4322).
 */
import { chromium } from "playwright";
import { writeFileSync } from "node:fs";

const url = process.argv[2];
if (!url) { console.error("usage: color-delta.mjs <url> [outPrefix]"); process.exit(2); }
const prefix = process.argv[3] ?? "/tmp/color-delta";

const browser = await chromium.launch({ args: ["--use-angle=metal", "--enable-gpu-rasterization"] });
const ctx = await browser.newContext({ viewport: { width: 1500, height: 950 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
page.on("pageerror", (e) => console.error("[pageerror]", e.message));
await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });
await page.waitForTimeout(6500);
await page.evaluate(() => window.oracleSetHelpersHidden(true));
await page.waitForTimeout(400);

const shot = await (await page.$("#poly-host")).screenshot();
const json = await page.evaluate(
  (d) => window.oracleColorDelta(d),
  "data:image/png;base64," + shot.toString("base64"),
);

await (await page.$(".stage.polycss")).screenshot({ path: `${prefix}-poly.png` });
await (await page.$(".stage.three")).screenshot({ path: `${prefix}-three.png` });
await (await page.$(".stage.diff")).screenshot({ path: `${prefix}-heat.png` });
writeFileSync(`${prefix}.json`, JSON.stringify(json, null, 2));
console.log(JSON.stringify(json, null, 2));
console.error(`wrote ${prefix}-poly.png ${prefix}-three.png ${prefix}-heat.png ${prefix}.json`);
await browser.close();
