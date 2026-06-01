import { chromium } from "playwright";
const urls = [
  ["vanilla", "http://localhost:4400/perf-vanilla.html?mesh=castle&mode=baked&motion=none&az=60&el=45&cast=1&floor=1&zoom=4&nohud=1"],
  ["react",   "http://localhost:4400/perf-react.html?mesh=castle&mode=baked&motion=none&az=60&el=45&cast=1&floor=1&zoom=4&nohud=1"],
  ["vue",     "http://localhost:4400/perf-vue.html?mesh=castle&mode=baked&motion=none&az=60&el=45&cast=1&floor=1&zoom=4&nohud=1"],
];
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 600, height: 700 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
for (const [name, url] of urls) {
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(10000);
  const info = await page.evaluate(() => {
    const recvSvgs = [...document.querySelectorAll(".polycss-shadow-receiver")];
    return {
      receiverCount: recvSvgs.length,
      receivers: recvSvgs.map(s => ({
        wxh: `${s.getAttribute("width")}x${s.getAttribute("height")}`,
        face: s.getAttribute("data-poly-shadow-receiver-face"),
        polys: s.getAttribute("data-poly-shadow-receiver-polys"),
        paths: s.querySelectorAll("path").length,
        firstPath: s.querySelector("path")?.getAttribute("d")?.slice(0, 80),
        opacity: s.querySelector("path")?.getAttribute("opacity"),
        fill: s.querySelector("path")?.getAttribute("fill"),
        transform: s.style.transform.slice(0, 100),
        display: getComputedStyle(s).display,
      })),
    };
  });
  console.log(`\n=== ${name} ===`);
  console.log(JSON.stringify(info, null, 2));
}
await browser.close();
