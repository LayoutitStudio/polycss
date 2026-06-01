import { chromium } from "playwright";
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 600, height: 600 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
await page.goto("http://localhost:4400/perf-vanilla.html?mesh=castle&mode=baked&motion=none&az=60&el=45&cast=0&floor=0&zoom=4&nohud=1", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(10000);
const plans = await page.evaluate(() => (window).__vanillaPlans);
console.log(JSON.stringify(plans, null, 2));
await browser.close();
