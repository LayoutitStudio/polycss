import { chromium } from "playwright";
import { chromiumArgsWithGpuDefault } from "/Users/apresmoi/Documents/voxcss/bench/chromium-defaults.mjs";
const browser = await chromium.launch({ headless: true, args: chromiumArgsWithGpuDefault([], { softwareBackend: false }) });
const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 } });
const page = await ctx.newPage();
await page.goto("http://localhost:4400/real-shadow.html?norayt", { waitUntil: "networkidle", timeout: 15000 });
await page.waitForTimeout(2000);
// Take a few samples across drag.
const samples = [];
for (const az of [60, 120, 180, 240, 300]) {
  await page.evaluate((v) => {
    const el = document.getElementById("az");
    el.value = String(v);
    el.dispatchEvent(new Event("input"));
  }, az);
  await page.waitForTimeout(50);
  const stats = await page.evaluate(() => {
    const allSvgs = document.querySelectorAll("svg.polycss-shadow");
    const groundSvgs = document.querySelectorAll("svg.polycss-shadow:not(.polycss-shadow-receiver)");
    const recvSvgs = document.querySelectorAll("svg.polycss-shadow-receiver");
    const paths = document.querySelectorAll("svg.polycss-shadow path");
    let subpaths = 0, dlen = 0;
    paths.forEach(p => {
      const d = p.getAttribute("d") || "";
      subpaths += (d.match(/M/g) || []).length;
      dlen += d.length;
    });
    return {
      total: allSvgs.length,
      ground: groundSvgs.length,
      receivers: recvSvgs.length,
      paths: paths.length,
      subpaths,
      dlenKB: (dlen / 1024).toFixed(1),
    };
  });
  samples.push({ az, ...stats });
}
console.log(JSON.stringify(samples, null, 2));
await browser.close();
