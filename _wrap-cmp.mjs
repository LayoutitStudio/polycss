import { chromium } from "playwright";
const urls = [
  ["vanilla", "http://localhost:4400/perf-vanilla.html?mesh=castle&mode=baked&motion=none&az=60&el=45&cast=1&floor=1&zoom=4&nohud=1"],
  ["react",   "http://localhost:4400/perf-react.html?mesh=castle&mode=baked&motion=none&az=60&el=45&cast=1&floor=1&zoom=4&nohud=1"],
];
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 600, height: 700 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
for (const [name, url] of urls) {
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(8000);
  const info = await page.evaluate(() => {
    const wrappers = [...document.querySelectorAll(".polycss-mesh")];
    return wrappers.map((m, i) => ({
      idx: i,
      transform: m.style.transform,
      origin: m.style.transformOrigin,
      polyCount: m.querySelectorAll(":scope > b, :scope > i, :scope > s, :scope > u").length,
    }));
  });
  console.log(`=== ${name} ===`, JSON.stringify(info, null, 2));
}
await browser.close();
