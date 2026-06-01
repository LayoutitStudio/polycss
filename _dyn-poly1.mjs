import { chromium } from "playwright";
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 600, height: 600 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
await page.goto("http://localhost:4400/perf-react.html?mesh=castle&mode=dynamic&motion=none&az=60&el=45&cast=0&floor=0&zoom=4&nohud=1", { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForTimeout(8000);
const info = await page.evaluate(() => {
  const all = [...document.querySelectorAll("[data-poly-index='1']")];
  return {
    count: all.length,
    items: all.map(el => ({
      tag: el.tagName.toLowerCase(),
      style: el.getAttribute("style")?.slice(0, 200),
    })),
  };
});
console.log(JSON.stringify(info, null, 2));
await browser.close();
