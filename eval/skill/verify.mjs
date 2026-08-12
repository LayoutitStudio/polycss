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
import { readFile } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

import { chromiumArgsWithGpuDefault } from "../../bench/chromium-defaults.mjs";

const here = resolve(fileURLToPath(import.meta.url), "..");
const repoRoot = resolve(here, "..", "..");

/** Same aliasing as bench/build.mjs: bundle workspace SOURCE, not dist. */
const ALIASES = {
  "@layoutit/polycss-core": resolve(repoRoot, "packages/core/src/index.ts"),
  "@layoutit/polycss-core/three": resolve(repoRoot, "packages/core/src/three/index.ts"),
  "@layoutit/polycss": resolve(repoRoot, "packages/polycss/src/index.ts"),
  "@layoutit/polycss/elements": resolve(repoRoot, "packages/polycss/src/elements/index.ts"),
  "@layoutit/polycss/three": resolve(repoRoot, "packages/polycss/src/three.ts"),
};

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
};

export async function bundleScene(entry, outfile) {
  try {
    await build({
      entryPoints: [entry],
      outfile,
      bundle: true,
      format: "esm",
      platform: "browser",
      target: "es2020",
      alias: ALIASES,
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
  const bundleDir = resolve(here, ".generated");
  const built = [];

  for (const candidate of candidates) {
    const outfile = join(bundleDir, `${candidate.key}.js`);
    const result = await bundleScene(candidate.entry, outfile);
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
    const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
    const results = [];

    for (const candidate of built) {
      if (!candidate.build.ok) {
        results.push({
          ...candidate,
          checks: candidate.task.checks.map((check) => ({
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
      const probe = await probeScene(page, url, { settleMs });
      const ctx = { ...probe, source: candidate.source };

      const checks = candidate.task.checks.map((check) => {
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
  }
}
