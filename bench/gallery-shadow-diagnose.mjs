#!/usr/bin/env node
/**
 * Targets the website's gallery (http://localhost:4321/gallery) and
 * captures before/after state when the user toggles castShadow with
 * the scene in baked mode — the exact failure scenario the user is
 * reporting ("UI disappears, shadows generally break").
 *
 * Usage:
 *   node bench/gallery-shadow-diagnose.mjs
 *   node bench/gallery-shadow-diagnose.mjs --headed
 *   node bench/gallery-shadow-diagnose.mjs --port=4321
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
    const meshes = document.querySelectorAll(".polycss-mesh");
    const shadows = document.querySelectorAll(".polycss-shadow");
    const leafSel = ".polycss-scene b, .polycss-scene i, .polycss-scene s, .polycss-scene u";
    const leaves = document.querySelectorAll(leafSel);
    return {
      meshCount: meshes.length,
      leafCount: leaves.length,
      shadowCount: shadows.length,
      sceneStyle: scene
        ? {
            transform: scene.style.transform.slice(0, 100),
            groundCssZ: scene.style.getPropertyValue("--shadow-ground-cssz") || "(unset)",
            clx: scene.style.getPropertyValue("--clx") || "(unset)",
            lighting: scene.dataset.polycssLighting || "(unset)",
          }
        : null,
      shadowSample: Array.from(shadows).slice(0, 2).map((el) => ({
        transform: el.style.transform.slice(0, 200),
        width: el.style.width,
        height: el.style.height,
      })),
    };
  });
}

const errors = [];

try {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await ctx.newPage();
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(`[console.error] ${msg.text()}`);
    if (msg.type() === "warning") errors.push(`[console.warn] ${msg.text()}`);
  });
  page.on("pageerror", (err) => errors.push(`[pageerror] ${err.message}`));

  await page.goto(`http://localhost:${PORT}/gallery`, { waitUntil: "networkidle", timeout: 30000 });
  // Wait for the gallery scene to fully mount and a mesh to render.
  await page.waitForFunction(
    () => {
      const mesh = document.querySelector(".polycss-mesh");
      const sceneChildren = document.querySelectorAll(".polycss-scene > *");
      return !!mesh && sceneChildren.length > 0;
    },
    { timeout: 30000 },
  );
  await page.waitForTimeout(800);

  const before = await snapshot(page);
  await page.screenshot({ path: resolve(outDir, "01-baseline.png"), fullPage: false });

  // Try to find and click the "Cast shadow" toggle inside the tweakpane dock.
  // tweakpane renders checkboxes as <input type="checkbox">. We look for the
  // label text "Cast shadow" and click its associated control.
  const beforeClickErrors = errors.length;
  const clicked = await page.evaluate(() => {
    // Tweakpane wraps each control with a label div. Walk every element
    // whose text reads "Cast shadow" and find a sibling/descendant input.
    const all = Array.from(document.querySelectorAll("div, span, label"));
    const labelEl = all.find((el) => (el.textContent || "").trim() === "Cast shadow");
    if (!labelEl) return { found: false };
    // Walk up looking for the row that contains the checkbox.
    let parent = labelEl.parentElement;
    for (let i = 0; i < 8 && parent; i++) {
      const cb = parent.querySelector('input[type="checkbox"]');
      if (cb) {
        const beforeChecked = cb.checked;
        cb.click();
        return { found: true, hasCheckbox: true, before: beforeChecked, after: cb.checked };
      }
      parent = parent.parentElement;
    }
    return { found: true, hasCheckbox: false };
  });

  await page.waitForTimeout(600);
  const after = await snapshot(page);
  await page.screenshot({ path: resolve(outDir, "02-cast-shadow.png"), fullPage: false });

  const clickErrors = errors.slice(beforeClickErrors);

  const report = {
    clickedToggle: clicked,
    before,
    after,
    errorsAfterToggle: clickErrors,
    allErrors: errors,
  };
  await writeFile(resolve(outDir, "report.json"), JSON.stringify(report, null, 2));

  console.log("\n──── gallery-shadow diagnose ────\n");
  console.log("Toggle click result:", clicked);
  console.log("\nBefore toggle:");
  console.log(JSON.stringify(before, null, 2));
  console.log("\nAfter toggle:");
  console.log(JSON.stringify(after, null, 2));
  if (clickErrors.length) {
    console.log("\n⚠️  Errors after toggle:");
    clickErrors.forEach((e) => console.log(`  ${e}`));
  }
  if (errors.length && !clickErrors.length) {
    console.log("\n(Page errors before toggle, possibly unrelated):");
    errors.forEach((e) => console.log(`  ${e}`));
  }
  console.log(`\nScreenshots: ${outDir.slice(repoRoot.length + 1)}/`);
} finally {
  await browser.close();
}
