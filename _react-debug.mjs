import { chromium } from "playwright";
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 600, height: 600 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
// Add a window.__getReactPlans probe that we'll call after the page settles.
await page.addInitScript(() => {
  // No-op; just want page console to log when ready
});
page.on("console", (m) => { if (m.type() === "log" || m.type() === "info") console.log("[browser]", m.text()); });
await page.goto("http://localhost:4400/perf-react.html?mesh=castle&mode=baked&motion=none&az=60&el=45&cast=0&floor=0&zoom=4&nohud=1", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(10000);
const info = await page.evaluate(() => {
  // Inspect the actual DOM polygon at index 1 to learn its tag + style.
  const p1 = document.querySelector("[data-poly-index='1']");
  // Look for any window var the renderer exposes
  const w = window;
  return {
    tag: p1?.tagName.toLowerCase() ?? null,
    polyExposed: Object.keys(w).filter((k) => /poly|react/i.test(k)).slice(0, 20),
  };
});
console.log(JSON.stringify(info, null, 2));
await browser.close();
