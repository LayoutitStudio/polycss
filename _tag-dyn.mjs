import { chromium } from "playwright";
const urls = [
  ["vanilla", "http://localhost:4400/perf-vanilla.html?mesh=castle&mode=dynamic&motion=none&az=60&el=45&cast=1&floor=1&zoom=4&nohud=1"],
  ["react",   "http://localhost:4400/perf-react.html?mesh=castle&mode=dynamic&motion=none&az=60&el=45&cast=1&floor=1&zoom=4&nohud=1"],
  ["vue",     "http://localhost:4400/perf-vue.html?mesh=castle&mode=dynamic&motion=none&az=60&el=45&cast=1&floor=1&zoom=4&nohud=1"],
];
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 600, height: 600 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
for (const [name, url] of urls) {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(8000);
  const info = await page.evaluate(() => {
    const scene = document.querySelector(".polycss-scene");
    const tags = { b: 0, i: 0, s: 0, u: 0, q: 0 };
    scene.querySelectorAll("b, i, s, u, q").forEach(el => { tags[el.tagName.toLowerCase()]++; });
    return { total: scene.querySelectorAll("b, i, s, u, q").length, tags };
  });
  console.log(`${name.padEnd(8)} total=${info.total} tags=${JSON.stringify(info.tags)}`);
}
await browser.close();
