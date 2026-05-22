#!/usr/bin/env node
/**
 * Flicker diagnostic: records every style/attribute/childList mutation on
 * polycss elements over ~3 seconds of orbit animation, then prints a summary
 * grouped by element + attribute showing which elements mutate most.
 *
 * Also reports key CSS properties (will-change, transformStyle) on the scene
 * element — missing `will-change: transform` on .polycss-scene is the known
 * root cause of baked-shapes flicker in React/Vue (the scene re-rasterizes
 * every leaf on each frame instead of compositing a cached GPU layer).
 *
 * Usage:
 *   node bench/flicker-diagnose.mjs --port=5175
 *   node bench/flicker-diagnose.mjs --port=5173   # html baseline
 *   node bench/flicker-diagnose.mjs --port=5174   # vanilla baseline
 *   node bench/flicker-diagnose.mjs --port=5176   # vue
 *
 * Output: mutation counts/sec per element, top mutated attributes, CSS
 * property snapshot, and a sample of value transitions for high-frequency
 * mutated elements.
 */
import { chromium } from "playwright";
import { chromiumArgsWithGpuDefault } from "./chromium-defaults.mjs";

const argv = process.argv.slice(2);
const optStr = (name, dflt = "") => {
  const i = argv.indexOf(`--${name}`);
  if (i >= 0) return argv[i + 1] ?? dflt;
  const eq = argv.find((a) => a.startsWith(`--${name}=`));
  return eq ? eq.slice(name.length + 3) : dflt;
};
const hasFlag = (name) => argv.includes(`--${name}`) || argv.includes(`--${name}=true`);

const PORT = optStr("port", "5175");
const OBSERVE_MS = 3000;
const WARMUP_MS = 2000;
const HEADED = hasFlag("headed");
const TOP_N = 10;

const url = `http://localhost:${PORT}/baked-shapes/`;
console.log(`[flicker-diagnose] target: ${url}`);
console.log(`[flicker-diagnose] warmup: ${WARMUP_MS}ms  observe: ${OBSERVE_MS}ms`);

const browser = await chromium.launch({
  headless: !HEADED,
  args: chromiumArgsWithGpuDefault([], { softwareBackend: false }),
});

try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();

  await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });

  // Wait for mesh children to appear (up to 15s)
  await page.waitForFunction(
    () => {
      const mesh = document.querySelector(".polycss-mesh");
      return mesh && mesh.children.length > 0;
    },
    null,
    { timeout: 15000 },
  );

  // Let orbit animation run for warmup before we start recording
  await page.waitForTimeout(WARMUP_MS);

  // Snapshot key CSS properties before observing
  const cssSnapshot = await page.evaluate(() => {
    const scene = document.querySelector(".polycss-scene");
    if (!scene) return null;
    const cs = window.getComputedStyle(scene);
    return {
      willChange: cs.willChange,
      transformStyle: cs.transformStyle,
      perspective: cs.perspective,
    };
  });

  // Inject MutationObserver and collect records
  const records = await page.evaluate(
    ({ observeMs }) =>
      new Promise((resolve) => {
        const log = [];
        const t0 = performance.now();

        const observer = new MutationObserver((mutations) => {
          const ts = performance.now() - t0;
          for (const m of mutations) {
            const el = m.target;
            const tag = el.tagName?.toLowerCase() ?? "?";
            const cls = el.className ? String(el.className).trim().split(/\s+/).join(".") : "";
            const id = `${tag}${cls ? "." + cls : ""}`;
            if (m.type === "attributes") {
              log.push({
                ts,
                type: "attr",
                id,
                attr: m.attributeName ?? "",
                oldValue: m.oldValue ?? null,
                newValue: el.getAttribute(m.attributeName ?? "") ?? null,
              });
            } else if (m.type === "childList") {
              log.push({
                ts,
                type: "childList",
                id,
                added: m.addedNodes.length,
                removed: m.removedNodes.length,
              });
            }
          }
        });

        // Observe from document.body to catch all mutations including the scene element
        observer.observe(document.body, {
          subtree: true,
          childList: true,
          attributes: true,
          attributeOldValue: true,
          attributeFilter: ["style", "class", "transform"],
        });

        setTimeout(() => {
          observer.disconnect();
          resolve(log);
        }, observeMs);
      }),
    { observeMs: OBSERVE_MS },
  );

  await ctx.close();

  // ── CSS snapshot ──────────────────────────────────────────────────────────
  console.log("\n[flicker-diagnose] .polycss-scene CSS snapshot:");
  if (cssSnapshot) {
    const wc = cssSnapshot.willChange;
    const ok = wc === "transform";
    console.log(`  will-change:    ${wc}  ${ok ? "(OK — GPU layer promoted)" : "(MISSING — re-rasterizes every frame; FLICKER SOURCE)"}`);
    console.log(`  transform-style: ${cssSnapshot.transformStyle}`);
    console.log(`  perspective:    ${cssSnapshot.perspective}`);
  } else {
    console.log("  (scene element not found)");
  }

  // ── Analysis ──────────────────────────────────────────────────────────────

  const totalMs = OBSERVE_MS;
  const totalMutations = records.length;
  const mutPerSec = (totalMutations / (totalMs / 1000)).toFixed(1);

  // Filter out the orbit animation's per-frame scene transform update — that's
  // expected (1 write/frame) and is NOT the flicker source.
  const SCENE_STYLE_ORBIT_PATTERN = /scale\(.+?\) rotateX/;
  const interestingRecords = records.filter((r) => {
    if (r.type === "attr" && r.attr === "style" && r.id.includes("polycss-scene")) {
      // Only flag if the new value does NOT look like a normal orbit transform
      return !SCENE_STYLE_ORBIT_PATTERN.test(r.newValue ?? "");
    }
    return true;
  });

  console.log(`\n[flicker-diagnose] port=${PORT}  total mutations: ${totalMutations}  (${mutPerSec}/sec)`);
  console.log(`  (orbit transform updates: ${totalMutations - interestingRecords.length}, interesting: ${interestingRecords.length})\n`);

  // Group by element id + attribute
  const byKey = new Map();
  for (const rec of records) {
    if (rec.type === "attr") {
      const key = `${rec.id} [${rec.attr}]`;
      if (!byKey.has(key)) byKey.set(key, { count: 0, values: new Map(), transitions: [] });
      const entry = byKey.get(key);
      entry.count++;
      const vNew = rec.newValue ?? "(null)";
      const vOld = rec.oldValue ?? "(null)";
      entry.values.set(vNew, (entry.values.get(vNew) ?? 0) + 1);
      if (entry.transitions.length < 5) entry.transitions.push({ from: vOld, to: vNew });
    } else {
      const key = `${rec.id} [childList +${rec.added}/-${rec.removed}]`;
      if (!byKey.has(key)) byKey.set(key, { count: 0, values: new Map(), transitions: [] });
      byKey.get(key).count++;
    }
  }

  const sorted = [...byKey.entries()].sort((a, b) => b[1].count - a[1].count);

  if (sorted.length === 0) {
    console.log("  No mutations recorded.\n");
  } else {
    console.log(`  Top ${Math.min(TOP_N, sorted.length)} most-mutated element+attribute combos:`);
    console.log("  " + "─".repeat(80));
    for (const [key, data] of sorted.slice(0, TOP_N)) {
      const rate = (data.count / (totalMs / 1000)).toFixed(1);
      console.log(`  ${key}`);
      console.log(`    mutations: ${data.count}  (${rate}/sec)`);
      const uniqueVals = [...data.values.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
      if (uniqueVals.length > 0) {
        const preview = uniqueVals
          .map(([v, n]) => `"${v.length > 60 ? v.slice(0, 57) + "..." : v}" (×${n})`)
          .join(", ");
        console.log(`    unique values: ${uniqueVals.length}  top: ${preview}`);
      }
      if (data.transitions.length > 0) {
        console.log("    sample transitions:");
        for (const t of data.transitions.slice(0, 2)) {
          const f = t.from?.length > 60 ? t.from.slice(0, 57) + "..." : t.from;
          const to = t.to?.length > 60 ? t.to.slice(0, 57) + "..." : t.to;
          console.log(`      ${f}  →  ${to}`);
        }
      }
      console.log();
    }
  }

  // Group by just element tag to see which tags flicker most
  const byTag = new Map();
  for (const rec of records) {
    const tag = rec.id.split("[")[0].trim();
    byTag.set(tag, (byTag.get(tag) ?? 0) + 1);
  }
  const tagsSorted = [...byTag.entries()].sort((a, b) => b[1] - a[1]);
  console.log("  Mutations by element tag:");
  for (const [tag, count] of tagsSorted) {
    const rate = (count / (totalMs / 1000)).toFixed(1);
    console.log(`    ${tag.padEnd(40)} ${count.toString().padStart(6)} mutations  (${rate}/sec)`);
  }

  console.log();
} finally {
  await browser.close();
}
