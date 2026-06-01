import { chromium } from "playwright";
const urls = [
  ["vanilla", "http://localhost:4400/perf-vanilla.html?mesh=castle&mode=baked&motion=none&az=60&el=45&cast=0&floor=0&zoom=4&nohud=1"],
  ["react",   "http://localhost:4400/perf-react.html?mesh=castle&mode=baked&motion=none&az=60&el=45&cast=0&floor=0&zoom=4&nohud=1"],
  ["vue",     "http://localhost:4400/perf-vue.html?mesh=castle&mode=baked&motion=none&az=60&el=45&cast=0&floor=0&zoom=4&nohud=1"],
];
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 600, height: 700 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
const results = {};
for (const [name, url] of urls) {
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(10000);
  results[name] = await page.evaluate(() => {
    // Find ALL leaves anywhere under the scene, grouped by data-poly-index.
    const scene = document.querySelector(".polycss-scene");
    const leaves = [...scene.querySelectorAll("b, i, s, u")];
    const byIdx = {};
    for (const el of leaves) {
      const idx = el.getAttribute("data-poly-index");
      if (idx === null) continue;
      byIdx[idx] = { tag: el.tagName.toLowerCase(), color: el.style.color || getComputedStyle(el).color };
    }
    return { total: leaves.length, samples: Object.fromEntries(Object.entries(byIdx).slice(0, 10)) };
  });
}
console.log("totals:", Object.fromEntries(Object.entries(results).map(([k,v]) => [k, v.total])));
// Compare polygon-by-polygon
const indices = Object.keys(results.vanilla.samples);
console.log("\n#idx  vanilla              | react              | vue");
for (const idx of indices) {
  const v = results.vanilla.samples[idx];
  const r = results.react.samples[idx];
  const ve = results.vue.samples[idx];
  const match = (a, b) => a && b && a.color === b.color && a.tag === b.tag ? "  " : "❌";
  console.log(`#${idx.padEnd(4)} ${v?.tag}:${v?.color.padEnd(18)} ${match(v,r)} ${r?.tag}:${r?.color?.padEnd(18) || "MISSING"} ${match(v,ve)} ${ve?.tag}:${ve?.color?.padEnd(18) || "MISSING"}`);
}
await browser.close();
