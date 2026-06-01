import { chromium } from "playwright";
const URL = "http://localhost:4400/perf-react.html?mesh=castle&mode=baked&motion=none&az=60&el=45&cast=0&floor=0&zoom=4&nohud=1";
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 600, height: 700 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
await page.goto(URL, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(10000);
const info = await page.evaluate(() => {
  const scene = document.querySelector(".polycss-scene");
  if (!scene) return { error: "no scene" };
  // Tag count anywhere under scene
  const tags = { b: 0, i: 0, s: 0, u: 0 };
  scene.querySelectorAll("b, i, s, u").forEach(el => { tags[el.tagName.toLowerCase()]++; });
  // First few leaves with colors
  const leaves = [...scene.querySelectorAll("b, i, s, u")].slice(0, 6);
  return {
    sceneChildrenTags: [...scene.children].map(c => c.tagName.toLowerCase() + "." + c.className),
    tags,
    sampleLeaves: leaves.map(el => ({
      tag: el.tagName.toLowerCase(),
      color: el.style.color || getComputedStyle(el).color,
      parent: el.parentElement?.tagName.toLowerCase() + "." + (el.parentElement?.className || ""),
    })),
  };
});
console.log(JSON.stringify(info, null, 2));
await browser.close();
