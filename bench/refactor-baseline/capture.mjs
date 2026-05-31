/**
 * Baseline screenshots taken BEFORE the createPolyScene.ts split refactor.
 * After each refactor commit, rerun this with --compare to diff against the
 * baseline so any visual regression is caught immediately.
 *
 * Each captured scenario exercises a code path the refactor touches:
 *   - shadows-baked        → shadowEmitter (ground) + shadowGeometry + renderEntry baked
 *   - shadows-receiver     → shadowEmitter (receiver-face) + cameraCull
 *   - shadows-dynamic      → dynamic-mode `<q>` leaves + lightingVars
 *   - lighting-dynamic     → lightingVars + applySolidPaintVars
 *   - lighting-baked       → renderEntry rebake path
 *   - voxel-direct         → canRenderVoxelDirect path
 *   - mesh-transforms      → buildMeshTransform (scale+rotation)
 *   - camera-cull-voxel    → voxel face-cull patch path
 */
import { chromium } from "playwright";
import { existsSync, mkdirSync, readFileSync, writeFileSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = "http://localhost:4400";
const compare = process.argv.includes("--compare");
const outDir = compare ? join(__dirname, "after") : join(__dirname, "baseline");
mkdirSync(outDir, { recursive: true });

const SCENARIOS = [
  // three-parity exercises shadows + lighting in both baked + dynamic modes.
  { name: "three-parity-cottage-baked", url: "/three-parity.html?mesh=cottage&z=80&rx=30&ry=20" },
  { name: "three-parity-cottage-dynamic", url: "/three-parity.html?mesh=cottage&z=80&rx=30&ry=20&lighting=dynamic" },
  { name: "three-parity-cube-baked", url: "/three-parity.html?mesh=cube&z=80&rx=30&ry=20" },
  { name: "three-parity-cube-dynamic", url: "/three-parity.html?mesh=cube&z=80&rx=30&ry=20&lighting=dynamic" },
  { name: "three-parity-E-baked", url: "/three-parity.html?mesh=E&z=80&rx=30&ry=20" },
  { name: "three-parity-E-scaled", url: "/three-parity.html?mesh=cottage&z=80&rx=30&ry=20&scale=0.57" },
  // baked-shadow / real-shadow / composite-shadow: focused shadow tests.
  { name: "baked-shadow", url: "/baked-shadow.html" },
  { name: "real-shadow", url: "/real-shadow.html" },
  { name: "composite-shadow", url: "/composite-shadow.html" },
  // voxel + non-voxel rendering paths.
  { name: "nonvoxel-vanilla", url: "/nonvoxel-vanilla.html" },
  // perf pages exercise the bulk-mesh paths.
  { name: "perf-vanilla", url: "/perf-vanilla.html" },
  { name: "atlas-background", url: "/atlas-background.html" },
  { name: "html-mount", url: "/html-mount.html" },
];

const browser = await chromium.launch({
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist"],
});
const ctx = await browser.newContext({ viewport: { width: 1700, height: 950 } });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
page.on("console", (m) => { if (m.type() === "error") errors.push(`console.error: ${m.text()}`); });

let captured = 0;
const results = [];
for (const s of SCENARIOS) {
  try {
    await page.goto(`${ROOT}${s.url}`, { waitUntil: "domcontentloaded", timeout: 15000 });
    // Generous settle for atlas decode + DOM mount. Textured meshes
    // (cottage, .obj loaders) routinely take 3-5+s before background-image
    // styles populate; a too-short settle captures the un-textured gray
    // geometry and produces false-positive "regressions". 7s covers the
    // slowest scenarios in this set with margin.
    await page.waitForTimeout(7000);
    const path = join(outDir, `${s.name}.png`);
    await page.screenshot({ path, fullPage: false });
    const stat = statSync(path);
    results.push({ name: s.name, bytes: stat.size, ok: true });
    captured++;
    console.log(`✓ ${s.name} (${(stat.size / 1024).toFixed(1)} KB)`);
  } catch (e) {
    results.push({ name: s.name, ok: false, err: String(e) });
    console.log(`✗ ${s.name} — ${e.message}`);
  }
}

writeFileSync(join(outDir, "manifest.json"), JSON.stringify({ at: new Date().toISOString(), errors, results }, null, 2));
console.log(`\n${captured}/${SCENARIOS.length} captured → ${outDir}`);
if (errors.length) {
  console.log(`\nconsole/page errors: ${errors.length}`);
  for (const e of errors.slice(0, 6)) console.log("  " + e);
}
await browser.close();

if (compare) {
  // Side-by-side byte comparison. Bit-exact match isn't required (GPU
  // composite is non-deterministic at the pixel level), but byte size
  // is a quick first-pass smoke test. A real perceptual diff (pixelmatch)
  // is the follow-up if anything looks off.
  const baselineDir = join(__dirname, "baseline");
  const baseManifest = JSON.parse(readFileSync(join(baselineDir, "manifest.json"), "utf8"));
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
