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
    const ss = [...document.querySelectorAll("s")];
    const us = [...document.querySelectorAll("u")];
    return {
      sSample: ss.slice(0, 3).map(el => ({
        bg: el.style.backgroundImage?.slice(0, 50),
        color: el.style.color,
        idx: el.getAttribute("data-poly-index"),
      })),
      uSample: us.slice(0, 3).map(el => ({
        color: el.style.color,
        bordBot: el.style.borderBottomColor,
        idx: el.getAttribute("data-poly-index"),
      })),
    };
  });
  console.log(`=== ${name} ===`, JSON.stringify(info, null, 2));
}
await browser.close();
