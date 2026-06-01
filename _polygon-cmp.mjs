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
  // Expose the caster polygons via window for inspection.
  const info = await page.evaluate(() => {
    // Vanilla: window.__poly may have scene
    // React: not exposed. So instead count from DOM.
    const leaves = [...document.querySelectorAll(".polycss-mesh > b, .polycss-mesh > i, .polycss-mesh > s, .polycss-mesh > u")];
    // Both renderers use .polycss-mesh wrapper now (after my bench unification).
    const meshes = [...document.querySelectorAll(".polycss-mesh")];
    const polyCounts = meshes.map(m => m.querySelectorAll(":scope > b, :scope > i, :scope > s, :scope > u").length);
    return {
      meshCount: meshes.length,
      polyCounts,
      totalLeaves: leaves.length,
    };
  });
  console.log(`${name.padEnd(8)}`, JSON.stringify(info));
}
await browser.close();
