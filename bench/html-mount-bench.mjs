/**
 * Benchmark the experimental trusted HTML chunk mount helper against the
 * existing DocumentFragment mount path.
 *
 * Usage:
 *   node bench/html-mount-bench.mjs
 *   node bench/html-mount-bench.mjs --count 20000 --repeats 7 --label html-mount
 *   node bench/html-mount-bench.mjs --no-experimental
 */
import { createServer } from "node:http";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { chromiumArgsWithGpuDefault } from "./chromium-defaults.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");
const benchDir = resolve(repoRoot, "bench");

const argv = process.argv.slice(2);
const flag = (name) => argv.indexOf(`--${name}`);
const optStr = (name, dflt = "") => {
  const i = flag(name);
  return i >= 0 ? argv[i + 1] : dflt;
};
const optNum = (name, dflt) => {
  const raw = optStr(name);
  return raw ? Number(raw) : dflt;
};
const hasFlag = (name) => flag(name) >= 0;
const optAll = (name) => {
  const values = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === `--${name}` && argv[i + 1]) {
      values.push(argv[i + 1]);
      i += 1;
    } else if (arg.startsWith(`--${name}=`)) {
      values.push(arg.slice(name.length + 3));
    }
  }
  return values;
};

const COUNT = optNum("count", 10000);
const REPEATS = optNum("repeats", 5);
const CHUNK_SIZE = optNum("chunk-size", optNum("chunkSize", 750));
const MODE = optStr("mode", "baked");
const LABEL = optStr("label");
const HEADED = hasFlag("headed");
const NO_EXPERIMENTAL = hasFlag("no-experimental");
const YIELD_BETWEEN_CHUNKS = hasFlag("yield");
const BROWSER_EXECUTABLE = optStr("browser-executable");
const CHROMIUM_ARGS = chromiumArgsWithGpuDefault([
  ...(NO_EXPERIMENTAL ? [] : ["--enable-experimental-web-platform-features"]),
  ...optAll("chromium-arg"),
  ...optAll("chromium-args").flatMap((value) => value.split(/\s+/).filter(Boolean)),
]);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
};

function startServer() {
  return new Promise((resolveStart, rejectStart) => {
    const server = createServer(async (req, res) => {
      try {
        const url = new URL(req.url, "http://localhost");
        const safe = url.pathname.replace(/\/+/g, "/");
        if (safe.includes("..")) {
          res.writeHead(403);
          res.end("forbidden");
          return;
        }
        const abs = resolve(benchDir, safe === "/" ? "html-mount.html" : safe.slice(1));
        const data = await readFile(abs);
        res.writeHead(200, {
          "Content-Type": MIME[extname(abs).toLowerCase()] || "application/octet-stream",
          "Cache-Control": "no-store",
        });
        res.end(data);
      } catch (err) {
        res.writeHead(404);
        res.end(String(err?.message ?? err));
      }
    });
    server.on("error", rejectStart);
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      resolveStart({ server, port: typeof addr === "object" ? addr.port : 0 });
    });
  });
}

function stopServer(server) {
  return new Promise((resolveStop) => server.close(resolveStop));
}

function printResult(result) {
  console.log(`[html-mount] supported=${result.supported} count=${result.options.count} repeats=${result.options.repeats} chunk=${result.options.chunkSize}`);
  console.log(JSON.stringify(result.summary, null, 2));
  for (const row of result.rows) {
    console.log(
      `${row.strategy.padEnd(8)} #${row.repeat} ` +
      `render=${row.renderMs.toFixed(3)}ms mount=${row.mountMs.toFixed(3)}ms ` +
      `total=${row.totalMs.toFixed(3)}ms mounted=${row.mounted} leaves=${row.leafCount}`,
    );
  }
}

let server;
let browser;
try {
  const started = await startServer();
  server = started.server;
  const url = `http://127.0.0.1:${started.port}/html-mount.html`;
  console.log(`[html-mount] ${url}`);
  if (CHROMIUM_ARGS.length > 0) console.log(`[html-mount] chromium args=${CHROMIUM_ARGS.join(" ")}`);
  browser = await chromium.launch({
    headless: !HEADED,
    executablePath: BROWSER_EXECUTABLE || undefined,
    args: CHROMIUM_ARGS,
  });
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  await page.goto(url, { waitUntil: "load" });
  const result = await page.evaluate(
    async ({ count, repeats, chunkSize, mode, yieldBetweenChunks }) =>
      window.runPolycssHtmlMountBench({ count, repeats, chunkSize, mode, yieldBetweenChunks }),
    {
      count: COUNT,
      repeats: REPEATS,
      chunkSize: CHUNK_SIZE,
      mode: MODE === "dynamic" ? "dynamic" : "baked",
      yieldBetweenChunks: YIELD_BETWEEN_CHUNKS,
    },
  );
  printResult(result);
  if (LABEL) {
    const dir = resolve(repoRoot, "bench/results");
    await mkdir(dir, { recursive: true });
    const file = resolve(dir, `${LABEL}.json`);
    await writeFile(file, JSON.stringify(result, null, 2));
    console.log(`[html-mount] wrote ${file}`);
  }
} finally {
  if (browser) await browser.close();
  if (server) await stopServer(server);
}
