import { chromium } from "playwright";
const urls = [
  ["vanilla", "http://localhost:4400/perf-vanilla.html?mesh=castle&mode=dynamic&motion=none&az=60&el=45&cast=1&floor=1&zoom=4&nohud=1"],
  ["react",   "http://localhost:4400/perf-react.html?mesh=castle&mode=dynamic&motion=none&az=60&el=45&cast=1&floor=1&zoom=4&nohud=1"],
];
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 600, height: 600 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
for (const [name, url] of urls) {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(8000);
  const info = await page.evaluate(() => {
    return {
      qElementsAnywhere: document.querySelectorAll("q").length,
      shadowReceiver: document.querySelectorAll(".polycss-shadow-receiver").length,
      groundShadow: document.querySelectorAll(".polycss-shadow:not(.polycss-shadow-receiver)").length,
      anyShadowChild: document.querySelectorAll(".polycss-mesh > q").length,
    };
  });
  console.log(`${name.padEnd(8)} ${JSON.stringify(info)}`);
}
await browser.close();
