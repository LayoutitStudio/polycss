import { chromium } from "playwright";
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 600, height: 600 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
await page.goto("http://localhost:4400/perf-react.html?mesh=castle&mode=baked&motion=none&az=60&el=45&cast=1&floor=1&zoom=4&nohud=1", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(8000);
const info = await page.evaluate(() => {
  return {
    cornerTopLeft: CSS.supports("corner-top-left-shape", "bevel"),
    cornerTopRight: CSS.supports("corner-top-right-shape", "bevel"),
    cornerBL: CSS.supports("corner-bottom-left-shape", "bevel"),
    cornerBR: CSS.supports("corner-bottom-right-shape", "bevel"),
    borderShape: CSS.supports("border-shape", "polygon(0 0, 10px 0, 0 10px)"),
    ua: navigator.userAgent.slice(0, 80),
  };
});
console.log(JSON.stringify(info, null, 2));
await browser.close();
