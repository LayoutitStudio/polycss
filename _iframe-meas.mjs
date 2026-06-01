import { chromium } from "playwright";
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1800, height: 700 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
await page.goto("http://localhost:4400/parity-trio.html?mesh=castle&mode=baked&motion=none&az=60&el=45&cast=1&floor=1&zoom=4", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(12000);
const info = await page.evaluate(() => {
  const frames = document.querySelectorAll("iframe");
  return [...frames].map((f, i) => {
    const win = f.contentWindow;
    const doc = win?.document;
    const host = doc?.getElementById("host");
    const camera = doc?.querySelector(".polycss-camera");
    return {
      iframeIdx: i,
      iframeWxH: `${f.clientWidth}x${f.clientHeight}`,
      hostWxH: host ? `${host.clientWidth}x${host.clientHeight}` : null,
      cameraWxH: camera ? `${camera.clientWidth}x${camera.clientHeight}` : null,
      viewport: win ? `${win.innerWidth}x${win.innerHeight}` : null,
    };
  });
});
console.log(JSON.stringify(info, null, 2));
await browser.close();
