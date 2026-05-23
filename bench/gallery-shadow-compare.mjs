#!/usr/bin/env node
/**
 * Same as gallery-shadow-diagnose, but takes two captures: baked+shadow
 * and dynamic+shadow, so we can tell whether the shadow weirdness is a
 * regression from the new baked path or pre-existing in dynamic too.
 */
import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { chromiumArgsWithGpuDefault } from "./chromium-defaults.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");

const argv = process.argv.slice(2);
const optStr = (name, dflt = "") => {
  const i = argv.indexOf(`--${name}`);
  if (i >= 0) return argv[i + 1] ?? dflt;
  const eq = argv.find((a) => a.startsWith(`--${name}=`));
  return eq ? eq.slice(name.length + 3) : dflt;
};
const hasFlag = (name) => argv.includes(`--${name}`) || argv.includes(`--${name}=true`);

const PORT = Number(optStr("port", "4321"));
const HEADED = hasFlag("headed");

const outDir = resolve(repoRoot, "bench/results/gallery-shadow");
await mkdir(outDir, { recursive: true });

const browser = await chromium.launch({
  headless: !HEADED,
  args: chromiumArgsWithGpuDefault([], { softwareBackend: false }),
});

async function snapshot(page) {
  return await page.evaluate(() => {
    const scene = document.querySelector(".polycss-scene");
    const shadows = document.querySelectorAll(".polycss-shadow");
    return {
      shadowCount: shadows.length,
      sceneLighting: scene?.dataset.polycssLighting || "(unset)",
      groundCssZ: scene?.style.getPropertyValue("--shadow-ground-cssz") || "(unset)",
      shadowSample: Array.from(shadows).slice(0, 3).map((el) => ({
        transform: el.style.transform.slice(0, 220),
        width: el.style.width,
        height: el.style.height,
      })),
    };
  });
}

async function toggle(page, label, desiredChecked) {
  return await page.evaluate(({ label, desiredChecked }) => {
    const all = Array.from(document.querySelectorAll("div, span, label"));
    const labelEl = all.find((el) => (el.textContent || "").trim() === label);
    if (!labelEl) return { found: false };
    let parent = labelEl.parentElement;
    for (let i = 0; i < 8 && parent; i++) {
      const cb = parent.querySelector('input[type="checkbox"]');
      if (cb) {
        if (cb.checked !== desiredChecked) cb.click();
        return { found: true, after: cb.checked };
      }
      // tweakpane sometimes uses select/dropdown — return the select element handle name
      const sel = parent.querySelector("select");
      if (sel) return { found: true, isSelect: true };
      parent = parent.parentElement;
    }
    return { found: true, hasCheckbox: false };
  }, { label, desiredChecked });
}

async function selectDropdown(page, label, valueText) {
  return await page.evaluate(({ label, valueText }) => {
    const all = Array.from(document.querySelectorAll("div, span, label"));
    const labelEl = all.find((el) => (el.textContent || "").trim() === label);
    if (!labelEl) return { found: false };
    let parent = labelEl.parentElement;
    for (let i = 0; i < 8 && parent; i++) {
      const sel = parent.querySelector("select");
      if (sel) {
        const opt = Array.from(sel.options).find((o) => o.text === valueText || o.value === valueText);
        if (!opt) return { found: true, hasSelect: true, options: Array.from(sel.options).map((o) => o.text) };
        sel.value = opt.value;
        sel.dispatchEvent(new Event("change", { bubbles: true }));
        return { found: true, set: opt.value };
      }
      parent = parent.parentElement;
    }
    return { found: true, hasSelect: false };
  }, { label, valueText });
}

const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
const errors = [];
try {
  const page = await ctx.newPage();
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(`[console.error] ${msg.text()}`);
  });
  page.on("pageerror", (err) => errors.push(`[pageerror] ${err.message}`));

  await page.goto(`http://localhost:${PORT}/gallery`, { waitUntil: "networkidle", timeout: 30000 });
  await page.waitForFunction(
    () => !!document.querySelector(".polycss-mesh"),
    { timeout: 30000 },
  );
  await page.waitForTimeout(800);

  // 1. Enable castShadow in baked mode (default).
  const tog1 = await toggle(page, "Cast shadow", true);
  await page.waitForTimeout(500);
  const baked = await snapshot(page);
  await page.screenshot({ path: resolve(outDir, "compare-baked.png"), fullPage: false });

  // 2. Switch lighting to dynamic, keep castShadow on.
  const sel = await selectDropdown(page, "Texture mode", "dynamic");
  await page.waitForTimeout(500);
  const dynamic = await snapshot(page);
  await page.screenshot({ path: resolve(outDir, "compare-dynamic.png"), fullPage: false });

  const report = { castToggle: tog1, modeSelect: sel, baked, dynamic, errors };
  await writeFile(resolve(outDir, "compare.json"), JSON.stringify(report, null, 2));

  console.log("\n──── baked vs dynamic with castShadow=true ────\n");
  console.log("Toggle:", tog1, "Mode select:", sel);
  console.log("\nBAKED:");
  console.log(JSON.stringify(baked, null, 2));
  console.log("\nDYNAMIC:");
  console.log(JSON.stringify(dynamic, null, 2));
  if (errors.length) {
    console.log("\nErrors:");
    errors.forEach((e) => console.log(`  ${e}`));
  }
} finally {
  await browser.close();
}
