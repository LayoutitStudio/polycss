#!/usr/bin/env node
/**
 * Three.js parity shots for shadow research.
 *
 * Loads bench/three-parity.html with deterministic URL params and
 * captures side-by-side screenshots of the PolyCSS + Three.js stages
 * for a fixed light/camera pose. The user explicitly asked
 * "make sure to bench against threejs always to check that we are not
 * doing anything aweful" — this script provides the visual receipt that
 * shadow optimizations on the PolyCSS side haven't drifted away from
 * three.js MeshLambertMaterial shading + DirectionalLight shadows.
 *
 * Output: bench/results/threejs-parity/<label>/<mesh>-<pose>.png
 *
 * Usage:
 *   node bench/scripts/threejs-parity-shots.mjs <label>
 *
 * Server must be running on :4400.
 */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const PORT = Number(process.env.BENCH_PORT ?? 4400);
const REPO = resolve(import.meta.dirname, '../..');

// Direction vectors that span typical light positions.
const POSES = [
  { id: 'topdown',   dx: 0.0, dy: 0.0, dz: -1.0 },
  { id: 'sideish',   dx: -0.5, dy: -0.3, dz: -0.81 },
  { id: 'low-angle', dx: -0.7, dy: -0.6, dz: -0.39 },
];

const MESHES = ['cube', 'e', 'cottage', 'castle'];

function urlFor(mesh, pose) {
  const p = new URLSearchParams({
    mesh,
    dx: String(pose.dx), dy: String(pose.dy), dz: String(pose.dz),
    di: '1', ai: '0.4',
    cs: '1', ss: '0', fv: '1', fr: '1',
    lighting: 'baked',
    rotX: '65', rotY: '45',
  });
  return `http://localhost:${PORT}/three-parity.html?${p.toString()}`;
}

async function capture(browser, mesh, pose, outDir) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await ctx.newPage();
  try {
    await page.goto(urlFor(mesh, pose), { waitUntil: 'networkidle', timeout: 30_000 });
    // Settle: wait for PolyCSS shadows + three.js draw call.
    await page.waitForTimeout(6_000);
    const outFile = `${outDir}/${mesh}-${pose.id}.png`;
    await page.screenshot({ path: outFile });
    console.log(`  ${mesh} ${pose.id}: ${outFile}`);
    return { ok: true, mesh, pose: pose.id, path: outFile };
  } catch (err) {
    console.log(`  ${mesh} ${pose.id}: FAIL ${err?.message ?? err}`);
    return { ok: false, mesh, pose: pose.id, error: String(err?.message ?? err) };
  } finally {
    await page.close();
    await ctx.close();
  }
}

const args = process.argv.slice(2);
const label = args[0];
if (!label) {
  console.error('Usage: threejs-parity-shots.mjs <label>');
  process.exit(2);
}

const outDir = resolve(REPO, 'bench/results/threejs-parity', label);
mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu-rasterization'] });
const captures = [];
console.log(`[threejs-parity:${label}]`);
for (const mesh of MESHES) {
  for (const pose of POSES) {
    captures.push(await capture(browser, mesh, pose, outDir));
  }
}
await browser.close();
writeFileSync(`${outDir}/summary.json`, JSON.stringify({ label, capturedAt: new Date().toISOString(), captures }, null, 2));
console.log(`\nwrote ${outDir}/summary.json (${captures.length} captures)`);
