import { chromium } from "playwright";
const urls = [
  ["vanilla", "http://localhost:4400/perf-vanilla.html?mesh=castle&mode=baked&motion=none&az=60&el=45&cast=0&floor=0&zoom=4&nohud=1"],
  ["react",   "http://localhost:4400/perf-react.html?mesh=castle&mode=baked&motion=none&az=60&el=45&cast=0&floor=0&zoom=4&nohud=1"],
];
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 600, height: 600 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
for (const [name, url] of urls) {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(10000);
  const info = await page.evaluate(() => {
    // Get all <s> leaves and read their tag + data attrs
    const ss = [...document.querySelectorAll(".polycss-scene s")];
    const us = [...document.querySelectorAll(".polycss-scene u")];
    return {
      sIdx: ss.map(el => el.getAttribute("data-poly-index")).filter(Boolean),
      uIdx: us.map(el => el.getAttribute("data-poly-index")).filter(Boolean),
      sCount: ss.length,
      uCount: us.length,
    };
  });
  console.log(`${name}: s=${info.sCount} u=${info.uCount}`);
  console.log(`  s indices: [${info.sIdx.slice(0,12).join(",")}]${info.sIdx.length > 12 ? " ..." : ""}`);
  console.log(`  u indices: [${info.uIdx.slice(0,8).join(",")}]${info.uIdx.length > 8 ? " ..." : ""}`);
}
await browser.close();
