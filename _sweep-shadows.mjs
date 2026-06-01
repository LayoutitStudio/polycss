import { chromium } from "playwright";
const MESHES = ["castle", "teapot", "apple", "coliseum"];
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 600, height: 600 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
for (const mesh of MESHES) {
  const counts = {};
  for (const r of ["vanilla", "react", "vue"]) {
    const url = `http://localhost:4400/perf-${r}.html?mesh=${mesh}&mode=baked&motion=none&az=60&el=45&cast=1&floor=1&zoom=4&nohud=1`;
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(7000);
    counts[r] = await page.evaluate(() => ({
      leaves: document.querySelectorAll(".polycss-scene b, .polycss-scene i, .polycss-scene s, .polycss-scene u").length,
      receiverShadows: document.querySelectorAll(".polycss-shadow-receiver").length,
      receiverPaths: [...document.querySelectorAll(".polycss-shadow-receiver path")].reduce((sum, p) => sum + ((p.getAttribute("d")?.match(/M/g) || []).length), 0),
    }));
  }
  const match = JSON.stringify(counts.vanilla) === JSON.stringify(counts.react) &&
                JSON.stringify(counts.vanilla) === JSON.stringify(counts.vue);
  console.log(`${match ? "✓" : "❌"} ${mesh}/shadow: vanilla=${JSON.stringify(counts.vanilla)} react=${JSON.stringify(counts.react)} vue=${JSON.stringify(counts.vue)}`);
}
await browser.close();
