#!/usr/bin/env node
/**
 * Shadow-regression fixture for the perf research loop.
 *
 * For each (scene, light-azimuth) pair, load perf-vanilla.html at a
 * deterministic URL, settle 6s, and capture both a screenshot and a
 * stats JSON (paths/SVGs/path-d-chars). The output goes under
 * bench/results/shadow-regression/<label>/.
 *
 * Usage:
 *   node bench/scripts/shadow-regression.mjs <label>
 *     # writes bench/results/shadow-regression/<label>/*
 *
 *   node bench/scripts/shadow-regression.mjs compare <a> <b>
 *     # prints a per-scene delta table for two prior labelled runs
 *
 * The bench server must be running on :4400 (pnpm bench:serve).
 */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const PORT = 4400;
const REPO = resolve(import.meta.dirname, '../..');

const SCENES = [
  { id: 'teapot-self', mesh: 'teapot', cs: 1, ss: 1, fv: 1, fr: 1, mode: 'dynamic' },
  { id: 'teapot-floor', mesh: 'teapot', cs: 1, ss: 0, fv: 1, fr: 1, mode: 'dynamic' },
  { id: 'castle-floor', mesh: 'castle', cs: 1, ss: 0, fv: 1, fr: 1, mode: 'baked' },
  { id: 'crate-floor', mesh: 'crate', cs: 1, ss: 0, fv: 1, fr: 1, mode: 'baked' },
];
const AZIMUTHS = [50, 130, 220];
const ELEVATION = 45;

function urlFor(scene, az) {
  const p = new URLSearchParams({
    mesh: scene.mesh,
    mode: scene.mode,
    motion: 'none',
    cs: String(scene.cs), ss: String(scene.ss), fv: String(scene.fv), fr: String(scene.fr),
    az: String(az), el: String(ELEVATION),
    nohud: '1',
  });
  return `http://localhost:${PORT}/perf-vanilla.html?${p.toString()}`;
}

async function captureOne(browser, scene, az, outDir) {
  const ctx = await browser.newContext({ viewport: { width: 1024, height: 768 } });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errs.push(`console.error: ${m.text()}`); });
  try {
    await page.goto(urlFor(scene, az), { waitUntil: 'load', timeout: 30_000 });
    await page.waitForFunction(() => window.__perf__?.ready === true, null, { timeout: 30_000 });
    await page.waitForTimeout(6_000);
    const stats = await page.evaluate(() => {
      const sceneRoot = document.querySelector('.polycss-scene');
      const recv = document.querySelectorAll('svg.polycss-shadow-receiver');
      const ground = document.querySelectorAll('svg.polycss-shadow:not(.polycss-shadow-receiver)');
      let paths = 0, pathDChars = 0;
      for (const svg of [...recv, ...ground]) {
        for (const p of svg.querySelectorAll('path')) {
          paths += 1;
          pathDChars += p.getAttribute('d')?.length ?? 0;
        }
      }
      const tags = { b: 0, i: 0, s: 0, u: 0 };
      if (sceneRoot) for (const t of Object.keys(tags)) tags[t] = sceneRoot.querySelectorAll(t).length;
      return {
        receiverSvgs: recv.length,
        groundSvgs: ground.length,
        shadowPaths: paths,
        shadowPathDChars: pathDChars,
        leafTags: tags,
      };
    });
    const pngName = `${scene.id}-az${az}.png`;
    await page.screenshot({ path: `${outDir}/${pngName}` });
    return { scene: scene.id, az, ok: true, ...stats, errors: errs };
  } catch (err) {
    return { scene: scene.id, az, ok: false, error: String(err?.message ?? err), errors: errs };
  } finally {
    await page.close();
    await ctx.close();
  }
}

async function runLabel(label) {
  const outDir = resolve(REPO, 'bench/results/shadow-regression', label);
  mkdirSync(outDir, { recursive: true });
  const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu-rasterization'] });
  const captures = [];
  for (const scene of SCENES) {
    for (const az of AZIMUTHS) {
      const result = await captureOne(browser, scene, az, outDir);
      console.log(`[${label}] ${result.scene} az${result.az}: ${result.ok ? `recvSVGs=${result.receiverSvgs} groundSVGs=${result.groundSvgs} paths=${result.shadowPaths} dChars=${result.shadowPathDChars}` : `FAIL ${result.error}`}`);
      captures.push(result);
    }
  }
  await browser.close();
  const summary = { label, capturedAt: new Date().toISOString(), captures };
  writeFileSync(`${outDir}/summary.json`, JSON.stringify(summary, null, 2));
  console.log(`\nwrote ${outDir}/summary.json (${captures.length} captures)`);
}

function loadSummary(label) {
  const f = resolve(REPO, 'bench/results/shadow-regression', label, 'summary.json');
  if (!existsSync(f)) throw new Error(`No summary at ${f}`);
  return JSON.parse(readFileSync(f, 'utf8'));
}

function compare(a, b) {
  const aSum = loadSummary(a);
  const bSum = loadSummary(b);
  const aBy = new Map(aSum.captures.map((c) => [`${c.scene}@${c.az}`, c]));
  const lines = ['| scene | az | recv Δ | paths Δ | dChars Δ |', '| --- | ---: | ---: | ---: | ---: |'];
  for (const bC of bSum.captures) {
    const aC = aBy.get(`${bC.scene}@${bC.az}`);
    if (!aC || !aC.ok || !bC.ok) {
      lines.push(`| ${bC.scene} | ${bC.az} | – | – | – |`);
      continue;
    }
    const drSvg = bC.receiverSvgs - aC.receiverSvgs;
    const dPaths = bC.shadowPaths - aC.shadowPaths;
    const dChars = bC.shadowPathDChars - aC.shadowPathDChars;
    const sign = (n) => n > 0 ? `+${n}` : `${n}`;
    lines.push(`| ${bC.scene} | ${bC.az} | ${sign(drSvg)} | ${sign(dPaths)} | ${sign(dChars)} |`);
  }
  console.log(`\nCompare: \`${a}\` → \`${b}\`\n`);
  console.log(lines.join('\n'));
  console.log('\nScreenshot pairs:');
  for (const bC of bSum.captures) {
    const aPng = resolve(REPO, 'bench/results/shadow-regression', a, `${bC.scene}-az${bC.az}.png`);
    const bPng = resolve(REPO, 'bench/results/shadow-regression', b, `${bC.scene}-az${bC.az}.png`);
    console.log(`  ${bC.scene} az${bC.az}: ${aPng} vs ${bPng}`);
  }
}

const args = process.argv.slice(2);
const cmd = args[0];
if (cmd === 'compare') {
  if (!args[1] || !args[2]) { console.error('Usage: shadow-regression.mjs compare <a> <b>'); process.exit(2); }
  compare(args[1], args[2]);
} else if (cmd && cmd !== '--help' && cmd !== '-h') {
  await runLabel(cmd);
} else {
  console.error('Usage:\n  shadow-regression.mjs <label>          # capture\n  shadow-regression.mjs compare <a> <b>   # diff two prior runs');
  process.exit(2);
}
