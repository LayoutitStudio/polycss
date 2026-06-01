import { chromium } from "playwright";
const urls = [
  ["vanilla", "http://localhost:4400/perf-vanilla.html?mesh=castle&mode=baked&motion=none&az=60&el=45&cast=0&floor=0&zoom=4&nohud=1"],
  ["react",   "http://localhost:4400/perf-react.html?mesh=castle&mode=baked&motion=none&az=60&el=45&cast=0&floor=0&zoom=4&nohud=1"],
  ["vue",     "http://localhost:4400/perf-vue.html?mesh=castle&mode=baked&motion=none&az=60&el=45&cast=0&floor=0&zoom=4&nohud=1"],
];
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 600, height: 700 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
for (const [name, url] of urls) {
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(10000);
  const info = await page.evaluate(() => {
    // Sample colors from the first 20 polygons.
    const leaves = [...document.querySelectorAll(".polycss-mesh > b, .polycss-mesh > i, .polycss-mesh > s, .polycss-mesh > u")].slice(0, 20);
    return {
      leafCount: document.querySelectorAll(".polycss-mesh > b, .polycss-mesh > i, .polycss-mesh > s, .polycss-mesh > u").length,
      tagCounts: ["b", "i", "s", "u"].reduce((acc, t) => { acc[t] = document.querySelectorAll(`.polycss-mesh > ${t}`).length; return acc; }, {}),
      sampleColors: leaves.map(el => ({
        tag: el.tagName.toLowerCase(),
        color: el.style.color || getComputedStyle(el).color,
        idx: el.getAttribute("data-poly-index"),
      })),
    };
  });
  console.log(`\n=== ${name} ===`);
  console.log("leafCount:", info.leafCount, " tags:", info.tagCounts);
  console.log("samples:", JSON.stringify(info.sampleColors.slice(0,8), null, 2));
}
await browser.close();
