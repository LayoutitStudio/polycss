import { chromium } from "playwright";
const urls = [
  ["vanilla", "http://localhost:4400/perf-vanilla.html?mesh=castle&mode=baked&motion=none&az=60&el=45&cast=1&floor=1&zoom=4&nohud=1"],
  ["react",   "http://localhost:4400/perf-react.html?mesh=castle&mode=baked&motion=none&az=60&el=45&cast=1&floor=1&zoom=4&nohud=1"],
  ["vue",     "http://localhost:4400/perf-vue.html?mesh=castle&mode=baked&motion=none&az=60&el=45&cast=1&floor=1&zoom=4&nohud=1"],
];
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 600, height: 918 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
for (const [name, url] of urls) {
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(8000);
  const info = await page.evaluate(() => {
    const host = document.getElementById("host");
    const camera = document.querySelector(".polycss-camera");
    const scene = document.querySelector(".polycss-scene");
    const hostRect = host?.getBoundingClientRect();
    const camRect = camera?.getBoundingClientRect();
    const sceneRect = scene?.getBoundingClientRect();
    return {
      hostRect: hostRect ? { x: hostRect.x, y: hostRect.y, w: hostRect.width, h: hostRect.height } : null,
      cameraRect: camRect ? { x: camRect.x, y: camRect.y, w: camRect.width, h: camRect.height } : null,
      cameraPerspective: camera ? getComputedStyle(camera).perspective : null,
      sceneRect: sceneRect ? { x: sceneRect.x, y: sceneRect.y, w: sceneRect.width, h: sceneRect.height } : null,
      sceneTransform: scene?.style.transform,
    };
  });
  console.log(`\n=== ${name} ===`);
  console.log(JSON.stringify(info, null, 2));
}
await browser.close();
