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
    const poly1 = document.querySelector("[data-poly-index='1']");
    return poly1 ? {
      tag: poly1.tagName.toLowerCase(),
      bg: (poly1.style.backgroundImage || "").slice(0, 40),
      color: poly1.style.color,
      // Inspect computed plan via scene-level data
    } : null;
  });
  console.log(`${name} poly1:`, JSON.stringify(info));
}
await browser.close();
