import { chromium } from "playwright";
const URLS = [
  ["vanilla", `http://localhost:4400/perf-vanilla.html?mesh=castle&mode=baked&motion=none&az=60&el=45&zoom=2.0`],
  ["react",   `http://localhost:4400/perf-react.html?mesh=castle&mode=baked&motion=none&az=60&el=45&zoom=2.0`],
  ["vue",     `http://localhost:4400/perf-vue.html?mesh=castle&mode=baked&motion=none&az=60&el=45&zoom=2.0`],
];
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1200, height: 1000 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
for (const [name, url] of URLS) {
  await page.goto(url, { waitUntil: "networkidle" });
  await page.waitForTimeout(10000);
  await page.evaluate(() => { document.querySelector("#fps")?.parentElement?.remove(); document.querySelector("#fps")?.remove(); });
  await page.screenshot({ path: `/tmp/perf-${name}.png` });
  console.log(`saved ${name}`);
}
await browser.close();
