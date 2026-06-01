import { chromium } from "playwright";
const urls = [
  ["vanilla", "http://localhost:4400/perf-vanilla.html?mesh=castle&mode=dynamic&motion=none&az=60&el=45&cast=0&floor=0&zoom=4&nohud=1"],
  ["react",   "http://localhost:4400/perf-react.html?mesh=castle&mode=dynamic&motion=none&az=60&el=45&cast=0&floor=0&zoom=4&nohud=1"],
];
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 600, height: 600 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
for (const [name, url] of urls) {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(8000);
  const info = await page.evaluate(() => {
    // Inspect polygon 1 (cornerShape candidate)
    const p1 = document.querySelector("[data-poly-index='1']");
    return p1 ? {
      tag: p1.tagName.toLowerCase(),
      style: p1.getAttribute("style")?.slice(0, 200),
      color: getComputedStyle(p1).color,
      bgColor: getComputedStyle(p1).backgroundColor,
      width: getComputedStyle(p1).width,
      height: getComputedStyle(p1).height,
      cornerShape: getComputedStyle(p1).getPropertyValue("corner-top-left-shape"),
    } : null;
  });
  console.log(`\n=== ${name} ===`, JSON.stringify(info, null, 2));
}
await browser.close();
