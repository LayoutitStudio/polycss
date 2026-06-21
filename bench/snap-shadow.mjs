import { chromium } from "playwright";
import { chromiumArgsWithGpuDefault } from "./chromium-defaults.mjs";

const url = process.argv[2];
const out = process.argv[3] ?? "/tmp/shadow.png";
if (!url) { console.error("usage: node bench/snap-shadow.mjs <url> <out.png>"); process.exit(1); }

const browser = await chromium.launch({ args: chromiumArgsWithGpuDefault() });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 2 });
page.on("console", (m) => { if (m.type() === "error") console.error("[page]", m.text()); });
await page.goto(url, { waitUntil: "networkidle" });
await page.waitForSelector(".polycss-scene", { state: "attached", timeout: 30000 }).catch(() => {});
await page.waitForTimeout(2500);
await page.screenshot({ path: out });
console.log("saved", out);
await browser.close();
