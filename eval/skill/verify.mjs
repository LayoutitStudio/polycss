/**
 * Builds a candidate `scene.mjs` and grades what it actually renders.
 *
 * Two stages, both objective:
 *   build  — esbuild resolves `@layoutit/polycss` against workspace SOURCE and
 *            fails on any import that does not exist. An invented export is a
 *            build error here, not a mystery at runtime.
 *   render — Chromium mounts the bundle, and each task's checks run over two
 *            DOM snapshots (so motion is observable) plus the source text.
 *
 * Grading never reads the agent's prose. A scene that does not paint scores
 * zero no matter how confident the explanation was.
 */
import { build } from "esbuild";
import { createServer } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

import { chromiumArgsWithGpuDefault } from "../../bench/chromium-defaults.mjs";
import { TRACKS } from "./tracks.mjs";

const here = resolve(fileURLToPath(import.meta.url), "..");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
};

/** Each track brings its own aliases: workspace SOURCE for PolyCSS, the
 *  workspace copy of three for the control. */
export async function bundleScene(entry, outfile, alias = TRACKS.polycss.alias) {
  try {
    await build({
      entryPoints: [entry],
      outfile,
      bundle: true,
      format: "esm",
      platform: "browser",
      target: "es2020",
      alias,
      loader: { ".ts": "ts", ".tsx": "tsx" },
      jsx: "automatic",
      logLevel: "silent",
      define: { "process.env.NODE_ENV": '"production"' },
    });
    return { ok: true };
  } catch (error) {
    const messages = (error.errors ?? []).map((e) => {
      const where = e.location ? `${e.location.file}:${e.location.line}` : "";
      return `${where} ${e.text}`.trim();
    });
    return { ok: false, error: messages.join("; ") || String(error.message ?? error) };
  }
}

/**
 * Serve the harness page and the built bundles. A local server (rather than
 * file://) is required because Chromium refuses ES module imports over file://.
 */
async function serve(roots) {
  const server = createServer(async (req, res) => {
    const path = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
    for (const [prefix, dir] of Object.entries(roots)) {
      if (!path.startsWith(prefix)) continue;
      const rel = path.slice(prefix.length).replace(/^\/+/, "");
      // Contain reads to the mounted directory — the file name comes from a
      // request, and these bundles sit next to the rest of the repo.
      const target = resolve(dir, rel);
      if (target !== resolve(dir) && !target.startsWith(resolve(dir) + "/")) break;
      try {
        const body = await readFile(target);
        res.writeHead(200, { "content-type": MIME[extname(target)] ?? "application/octet-stream" });
        res.end(body);
        return;
      } catch {
        break;
      }
    }
    res.writeHead(404).end("not found");
  });

  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  const { port } = server.address();
  return {
    origin: `http://127.0.0.1:${port}`,
    close: () => new Promise((done) => server.close(done)),
  };
}

/**
 * Two snapshots separated by `settleMs`: the first after the scene has mounted
 * and atlases have had time to decode, the second late enough that autorotate
 * has visibly moved the leaves.
 */
async function probeScene(page, url, { settleMs = 1200, mountTimeoutMs = 15000 } = {}) {
  await page.goto(url, { waitUntil: "load" });
  const mounted = await page.evaluate(
    (ms) =>
      Promise.race([
        window.__mounted,
        new Promise((r) => setTimeout(() => r("timeout"), ms)),
      ]),
    mountTimeoutMs,
  );

  const sample = async () => {
    const dom = await page.evaluate(() => window.__probe());
    const shot = await page.locator("#host").screenshot({ type: "png" });
    const pixels = await page.evaluate(
      (dataUrl) => window.__samplePixels(dataUrl),
      `data:image/png;base64,${shot.toString("base64")}`,
    );
    return { ...dom, pixels };
  };

  const first = await sample();
  await page.waitForTimeout(settleMs);
  const second = await sample();
  const errors = await page.evaluate(() => window.__evalErrors.slice());

  if (mounted === "timeout") errors.unshift("mount() did not settle within the timeout");
  return { first, second, errors, mounted: mounted === true };
}

export async function verifyCandidates(candidates, { headed = false, settleMs } = {}) {
  // Unique per invocation. A shared `.generated/<agent>__<track>__<task>.js`
  // meant two concurrent runs with the same key raced on one file and both
  // graded whichever bundle won.
  const bundleDir = mkdtempSync(join(tmpdir(), "polycss-skill-bundles-"));
  const built = [];

  for (const candidate of candidates) {
    const outfile = join(bundleDir, `${candidate.key}.js`);
    const result = await bundleScene(
      candidate.entry,
      outfile,
      (candidate.track ?? TRACKS.polycss).alias,
    );
    built.push({ ...candidate, outfile, build: result });
  }

  const server = await serve({
    "/harness": join(here, "harness"),
    "/bundles": bundleDir,
  });

  const browser = await chromium.launch({
    headless: !headed,
    args: chromiumArgsWithGpuDefault(),
  });

  try {
    let page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
    const results = [];

    for (const candidate of built) {
      const checksFor = (c) => [...c.task.visual, ...((c.track ?? TRACKS.polycss).installSkill ? c.task.native : [])];

      if (!candidate.build.ok) {
        results.push({
          ...candidate,
          checks: checksFor(candidate).map((check) => ({
            id: check.id,
            describe: check.describe,
            pass: false,
            reason: "not run — bundle failed to build",
          })),
        });
        continue;
      }

      const url = `${server.origin}/harness/index.html?bundle=${encodeURIComponent(
        `/bundles/${candidate.key}.js`,
      )}`;
      // A candidate is untrusted code. One that breaks the probe — or the page
      // itself — used to reject the whole verifier, so every later candidate
      // went ungraded. Failures become a failed row and the page is rebuilt.
      let probe;
      try {
        probe = await probeScene(page, url, { settleMs });
      } catch (error) {
        results.push({
          ...candidate,
          probe: null,
          checks: checksFor(candidate).map((check) => ({
            id: check.id,
            describe: check.describe,
            pass: false,
            reason: `grading failed: ${String(error.message ?? error).split("\n")[0]}`,
          })),
        });
        try {
          await page.close();
        } catch {
          /* already gone */
        }
        page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
        continue;
      }
      const ctx = { ...probe, source: candidate.source };

      const checks = checksFor(candidate).map((check) => {
        let outcome;
        try {
          outcome = check.run(ctx);
        } catch (error) {
          outcome = `check threw: ${error.message}`;
        }
        return {
          id: check.id,
          describe: check.describe,
          pass: outcome === true,
          reason: outcome === true ? null : String(outcome),
        };
      });

      results.push({ ...candidate, probe, checks });
    }

    return results;
  } finally {
    await browser.close();
    await server.close();
    rmSync(bundleDir, { recursive: true, force: true });
  }
}
