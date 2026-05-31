/**
 * Gallery baseline / after capture for the post-parity modernization.
 * Mirrors capture.mjs but targets the website dev server on :4322 and
 * exercises a spread of presets covering primitives, OBJ, textured glTF,
 * voxel, and the workbenches.
 */
import { chromium } from "playwright";
import { existsSync, mkdirSync, readFileSync, writeFileSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = "http://localhost:4322";
const compare = process.argv.includes("--compare");
const outDir = compare ? join(__dirname, "gallery-after") : join(__dirname, "gallery-baseline");
mkdirSync(outDir, { recursive: true });

const SCENARIOS = [
  // Castle URL the user is using.
  { name: "gallery-castle-scene", url: "/gallery?model=2596447321&scene=2lz2rgX48f5wY4jhxga4gaf4e4bsdsk3ffkm3d48SE5a4da8g" },
  // Default landing — exercises gallery defaults (cube preset).
  { name: "gallery-default", url: "/gallery" },
  // Builder workbench
  { name: "builder-default", url: "/builder" },
  // WordArt
  { name: "wordart-default", url: "/wordart" },
  // Home page (renders polycss content too)
  { name: "home", url: "/" },
];

const browser = await chromium.launch({
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist"],
});
const ctx = await browser.newContext({ viewport: { width: 1700, height: 950 } });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
page.on("console", (m) => { if (m.type() === "error") errors.push(`console.error: ${m.text()}`); });

const results = [];
for (const s of SCENARIOS) {
  try {
    await page.goto(`${ROOT}${s.url}`, { waitUntil: "domcontentloaded", timeout: 30000 });
    // 8s settle — gallery's mesh loaders (parseObj + texture decode + atlas
    // build) take 3-5s, and React + lil-gui paint cycles add more. Same
    // reason the bench capture uses 7s.
    await page.waitForTimeout(8000);
    const path = join(outDir, `${s.name}.png`);
    await page.screenshot({ path, fullPage: false });
    const stat = statSync(path);
    results.push({ name: s.name, bytes: stat.size, ok: true });
    console.log(`✓ ${s.name} (${(stat.size / 1024).toFixed(1)} KB)`);
  } catch (e) {
    results.push({ name: s.name, ok: false, err: String(e) });
    console.log(`✗ ${s.name} — ${e.message}`);
  }
}

writeFileSync(
  join(outDir, "manifest.json"),
  JSON.stringify({ at: new Date().toISOString(), errors, results }, null, 2),
);
console.log(`\n${results.filter((r) => r.ok).length}/${SCENARIOS.length} captured → ${outDir}`);
if (errors.length) {
  console.log(`\nconsole/page errors: ${errors.length}`);
  for (const e of errors.slice(0, 8)) console.log("  " + e);
}
await browser.close();

if (compare) {
  const baseDir = join(__dirname, "gallery-baseline");
  const baseManifest = JSON.parse(readFileSync(join(baseDir, "manifest.json"), "utf8"));
  console.log("\nbyte-size diff (baseline → after):");
  for (const r of results) {
    if (!r.ok) continue;
    const b = baseManifest.results.find((x) => x.name === r.name);
    if (!b || !b.ok) { console.log(`  ${r.name}: NEW`); continue; }
    const delta = r.bytes - b.bytes;
    const pct = ((delta / b.bytes) * 100).toFixed(1);
    const flag = Math.abs(delta) > b.bytes * 0.02 ? "  ⚠" : "";
    console.log(`  ${r.name}: ${b.bytes} → ${r.bytes} (${delta >= 0 ? "+" : ""}${delta}, ${pct}%)${flag}`);
  }
}
