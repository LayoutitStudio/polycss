import { chromium } from "playwright";
const MESHES = ["mecha-golem", "army", "skyscraper", "treasure", "obj-house3"];
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 600, height: 600 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
for (const mesh of MESHES) {
  const counts = {};
  for (const r of ["vanilla", "react", "vue"]) {
    const url = `http://localhost:4400/perf-${r}.html?mesh=${mesh}&mode=baked&motion=none&az=60&el=45&cast=0&floor=0&zoom=4&nohud=1`;
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
      await page.waitForTimeout(8000);
      counts[r] = await page.evaluate(() => {
        const scene = document.querySelector(".polycss-scene");
        if (!scene) return null;
        const t = { b: 0, i: 0, s: 0, u: 0 };
        scene.querySelectorAll("b, i, s, u").forEach(el => { t[el.tagName.toLowerCase()]++; });
        const voxFaces = scene.querySelectorAll(".polycss-voxel-face").length;
        return { total: scene.querySelectorAll("b, i, s, u").length, ...t, voxFaces };
      });
    } catch (e) { counts[r] = { error: e.message.slice(0, 40) }; }
  }
  const match = JSON.stringify(counts.vanilla) === JSON.stringify(counts.react) &&
                JSON.stringify(counts.vanilla) === JSON.stringify(counts.vue);
  console.log(`${match ? "✓" : "❌"} ${mesh}: vanilla=${JSON.stringify(counts.vanilla)} react=${JSON.stringify(counts.react)} vue=${JSON.stringify(counts.vue)}`);
}
await browser.close();
