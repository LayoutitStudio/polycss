import { chromium } from "playwright";
const URL = "http://localhost:4400/perf-vanilla.html?mesh=castle&mode=baked&motion=none&az=60&el=45&cast=1&floor=1&nohud=1";
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 600, height: 700 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
page.on("console", (msg) => console.log(msg.type(), msg.text()));
page.on("pageerror", (err) => console.log("[pageerror]", err.message));
await page.goto(URL, { waitUntil: "networkidle" });
await page.waitForTimeout(8000);
const info = await page.evaluate(() => {
  const scene = document.querySelector(".polycss-scene");
  return {
    sceneTransform: scene?.style.transform,
    meshCount: document.querySelectorAll(".polycss-mesh").length,
    shadowCount: document.querySelectorAll(".polycss-shadow").length,
    polyCount: document.querySelectorAll(".polycss-mesh > b, .polycss-mesh > i, .polycss-mesh > s, .polycss-mesh > u").length,
  };
});
console.log("info:", JSON.stringify(info, null, 2));
await page.screenshot({ path: "/tmp/vanilla-debug.png" });
await browser.close();
