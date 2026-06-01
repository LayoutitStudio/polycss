// Cross-renderer parity capture across a shadow-state × mode × mesh matrix.
// Each config produces ONE composite image with vanilla|react|vue side-by-side.
import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";

const OUT = "_parity-matrix";
await mkdir(OUT, { recursive: true });

const CONFIGS = [
  { name: "castle-baked-noshadow",   mesh: "castle",  mode: "baked",   cast: 0, floor: 0, zoom: 4 },
  { name: "castle-baked-shadow",     mesh: "castle",  mode: "baked",   cast: 1, floor: 1, zoom: 4 },
  { name: "castle-dynamic-noshadow", mesh: "castle",  mode: "dynamic", cast: 0, floor: 0, zoom: 4 },
  { name: "castle-dynamic-shadow",   mesh: "castle",  mode: "dynamic", cast: 1, floor: 1, zoom: 4 },
  { name: "teapot-baked-noshadow",   mesh: "teapot",  mode: "baked",   cast: 0, floor: 0, zoom: 5 },
  { name: "teapot-baked-shadow",     mesh: "teapot",  mode: "baked",   cast: 1, floor: 1, zoom: 5 },
  { name: "coliseum-baked-shadow",   mesh: "coliseum",mode: "baked",   cast: 1, floor: 1, zoom: 3 },
];

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1800, height: 700 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
page.on("pageerror", (err) => console.log("[pageerror]", err.message));

for (const cfg of CONFIGS) {
  const qs = `mesh=${cfg.mesh}&mode=${cfg.mode}&motion=none&az=60&el=45&cast=${cfg.cast}&floor=${cfg.floor}&zoom=${cfg.zoom}`;
  const url = `http://localhost:4400/parity-trio.html?${qs}`;
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(11000);
  const file = `${OUT}/${cfg.name}.png`;
  await page.screenshot({ path: file, fullPage: false, timeout: 60000 });
  console.log(`saved ${file}`);
}
await browser.close();
