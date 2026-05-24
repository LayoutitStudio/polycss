#!/usr/bin/env node
/**
 * Visits the gallery at the user-provided model URL, enables castShadow,
 * and dumps:
 *   - the shadow SVG outerHTML (truncated)
 *   - the subpath count + winding signs for each M…L…Z block
 *   - a screenshot of the result
 *
 * Goal: figure out why the bat model gets holes in its shadow even after
 * the per-polygon CCW normalization. Suspects: degenerate (near-zero
 * area) projections, self-intersecting non-convex merged polys.
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

const URL_STR = optStr("url", "http://localhost:4321/gallery?model=922117102");
const HEADED = hasFlag("headed");

const outDir = resolve(repoRoot, "bench/results/bat-shadow");
await mkdir(outDir, { recursive: true });

const browser = await chromium.launch({
  headless: !HEADED,
  args: chromiumArgsWithGpuDefault([], { softwareBackend: false }),
});

try {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await ctx.newPage();
  page.on("pageerror", (err) => console.log(`[pageerror] ${err.message}`));

  await page.goto(URL_STR, { waitUntil: "networkidle", timeout: 30000 });
  await page.waitForFunction(
    () => !!document.querySelector(".polycss-mesh"),
    { timeout: 30000 },
  );
  await page.waitForTimeout(1500);

  // Toggle Cast shadow + Show ground via the tweakpane labels.
  await page.evaluate(() => {
    const clickToggle = (labelText) => {
      const all = Array.from(document.querySelectorAll("div, span, label"));
      const labelEl = all.find((el) => (el.textContent || "").trim() === labelText);
      if (!labelEl) return false;
      let parent = labelEl.parentElement;
      for (let i = 0; i < 8 && parent; i++) {
        const cb = parent.querySelector('input[type="checkbox"]');
        if (cb) {
          if (!cb.checked) cb.click();
          return true;
        }
        parent = parent.parentElement;
      }
      return false;
    };
    clickToggle("Cast shadow");
    clickToggle("Show ground");
  });
  await page.waitForTimeout(1000);

  // Save the raw shadow SVG outerHTML so we can render it standalone on a
  // white background — the gallery's dark background hides any actual holes.
  const rawSvg = await page.evaluate(() => {
    const svg = document.querySelector("svg.polycss-shadow");
    return svg ? svg.outerHTML : null;
  });
  if (rawSvg) {
    await writeFile(resolve(outDir, "shadow-extracted.html"),
      `<!doctype html><html><body style="background:#fff;margin:0;padding:0">
       <div style="position:relative;width:1600px;height:1600px;background:#eee;overflow:hidden">
         ${rawSvg.replace(/transform:[^"]*"/, 'transform:translate(0,0)"')}
       </div></body></html>`);
  }

  // Snapshot the shadow SVG and analyze its compound path.
  const snapshot = await page.evaluate(() => {
    const svg = document.querySelector("svg.polycss-shadow");
    if (!svg) return { found: false };
    const paths = svg.querySelectorAll("path");
    const all = Array.from(paths).map((path) => {
      const d = path.getAttribute("d") || "";
      // Split d into M…Z subpaths.
      const subpaths = d.split("Z").filter((s) => s.trim().length > 0);
      const analyzed = subpaths.map((sub) => {
        const cleaned = sub.replace(/^M/, "");
        // Each token is "x,y" separated by "L".
        const tokens = cleaned.split("L");
        const verts = tokens.map((t) => t.split(",").map(Number));
        // Signed area (positive = CCW in math; negative = CW).
        let a = 0;
        for (let i = 0; i < verts.length; i++) {
          const p = verts[i];
          const q = verts[(i + 1) % verts.length];
          a += p[0] * q[1] - q[0] * p[1];
        }
        return {
          n: verts.length,
          signedArea: a / 2,
        };
      });
      // Per-subpath winding summary.
      const ccw = analyzed.filter((s) => s.signedArea > 0).length;
      const cw = analyzed.filter((s) => s.signedArea < 0).length;
      const zero = analyzed.filter((s) => Math.abs(s.signedArea) < 1e-6).length;
      const minArea = analyzed.length > 0 ? Math.min(...analyzed.map((s) => Math.abs(s.signedArea))) : 0;
      const maxArea = analyzed.length > 0 ? Math.max(...analyzed.map((s) => Math.abs(s.signedArea))) : 0;
      return {
        subpathCount: subpaths.length,
        ccw, cw, zero,
        minArea,
        maxArea,
        fillRule: path.getAttribute("fill-rule"),
        opacity: path.getAttribute("opacity"),
        dLength: d.length,
      };
    });
    return {
      found: true,
      svgClass: svg.getAttribute("class"),
      svgWidth: svg.getAttribute("width"),
      svgHeight: svg.getAttribute("height"),
      svgTransform: svg.style.transform.slice(0, 100),
      pathCount: paths.length,
      paths: all,
    };
  });

  console.log(JSON.stringify(snapshot, null, 2));

  const shotPath = resolve(outDir, "shadow.png");
  await page.screenshot({ path: shotPath, fullPage: false });
  console.log(`Screenshot: ${shotPath}`);
  await writeFile(resolve(outDir, "report.json"), JSON.stringify(snapshot, null, 2));
} finally {
  await browser.close();
}
