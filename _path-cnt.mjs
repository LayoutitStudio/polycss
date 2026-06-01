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
  await page.waitForTimeout(10000);
  const info = await page.evaluate(() => {
    const path = document.querySelector(".polycss-shadow-receiver path");
    const d = path?.getAttribute("d") || "";
    const subpaths = (d.match(/M/g) || []).length;
    return { dLen: d.length, subpaths };
  });
  console.log(`${name.padEnd(8)} subpaths=${info.subpaths} dLen=${info.dLen}`);
}
await browser.close();
