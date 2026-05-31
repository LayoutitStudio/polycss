#!/usr/bin/env node
/**
 * Synthetic browser bench for solid non-rect polygon primitives:
 *
 *   node bench/mask-polygon-bench.mjs
 *   node bench/mask-polygon-bench.mjs --counts 1000,3000 --variants border16,solid64,mask16,atlas64 --label mask-poly
 *   node bench/mask-polygon-bench.mjs --variants border16,border16:ellipse0,border16:inset50,border16:xywh0
 *   node bench/mask-polygon-bench.mjs --variants border16,solid64,clip16,svgpoly16,svgpath16
 *   node bench/mask-polygon-bench.mjs --variants border16,borderclass16,bordervar16,bordercontainpaint16,bordernowill16
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
const hasFlag = (name) => flag(name) >= 0 || argv.includes(`--${name}=true`);
const optStr = (name, dflt = "") => {
  const exact = flag(name);
  if (exact >= 0) return argv[exact + 1] ?? dflt;
  const prefixed = argv.find((arg) => arg.startsWith(`--${name}=`));
  return prefixed ? prefixed.slice(name.length + 3) : dflt;
};
const optNum = (name, dflt) => {
  const raw = optStr(name, String(dflt));
  const value = Number(raw);
  return Number.isFinite(value) ? value : dflt;
};
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

const COUNTS = parseNumberList(optStr("counts", "1000,3000,6000"));
const VARIANTS = parseVariants(optStr("variants", "border16,mask16,mask64,atlas64"));
const REPEATS = Math.max(1, Math.round(optNum("repeats", 2)));
const WARMUP_MS = Math.max(0, optNum("warmup", 1200));
const SAMPLE_MS = Math.max(250, optNum("sample", 2500));
const SHAPE = optStr("shape", "hex");
const MOTION = optStr("motion", "orbit");
const TARGET = optNum("target", 64);
const LABEL = optStr("label");
const JSON_PATH = optStr("json");
const HEADED = hasFlag("headed");
const BROWSER_EXECUTABLE = optStr("browser-executable");
const BORDER_SHAPE_FLAG = "--enable-blink-features=CSSBorderShape";
const CHROMIUM_ARGS = chromiumArgsWithGpuDefault([
  ...(!hasFlag("no-border-shape-flag") ? [BORDER_SHAPE_FLAG] : []),
  ...optAll("chromium-arg"),
  ...optAll("chromium-args").flatMap((value) => value.split(/\s+/).filter(Boolean)),
]);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
};

function parseNumberList(value) {
  return String(value)
    .split(",")
    .map((part) => Number(part.trim()))
    .filter((n) => Number.isFinite(n) && n > 0)
    .map((n) => Math.round(n));
}

function parseVariants(value) {
  return String(value)
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((id) => {
      const [baseId, borderInnerRaw] = id.split(":");
      const samePathMatch = /^border(class|var|containpaint|containstrict|containlayout|nowill|isolate|solidstyle)(\d+)?$/i.exec(baseId);
      if (samePathMatch) {
        const mode = samePathMatch[1].toLowerCase();
        const primitive = Number(samePathMatch[2] ?? 16);
        return {
          id: `${baseId}${borderInnerRaw ? `:${borderInnerRaw.toLowerCase()}` : ""}`,
          strategy: "border",
          borderFunction: "polygon",
          borderInner: borderInnerRaw?.toLowerCase(),
          borderShapeSource: mode === "class" ? "class" : mode === "var" ? "var" : "inline",
          leafContain: mode === "containpaint"
            ? "paint"
            : mode === "containstrict"
              ? "strict"
              : mode === "containlayout"
                ? "layout"
                : undefined,
          leafWillChange: mode === "nowill" ? "auto" : undefined,
          leafIsolation: mode === "isolate" ? "isolate" : undefined,
          borderStyle: mode === "solidstyle" ? "solid" : undefined,
          primitive,
        };
      }
      const borderMatch = /^border(?:(polygonplain|polygon|path|shape|circle|ellipse|xywh|inset|rect))?(\d+)?$/i.exec(baseId);
      if (borderMatch) {
        const borderFunction = (borderMatch[1] ?? "polygon").toLowerCase();
        const primitive = Number(borderMatch[2] ?? 16);
        const borderInner = borderInnerRaw?.toLowerCase();
        const baseVariantId = borderFunction === "polygon" ? `border${primitive}` : `border${borderFunction}${primitive}`;
        return {
          id: borderInner ? `${baseVariantId}:${borderInner}` : baseVariantId,
          strategy: "border",
          borderFunction,
          borderInner,
          primitive,
        };
      }
      const clipMatch = /^clip(\d+)?$/i.exec(id);
      if (clipMatch) {
        const primitive = Number(clipMatch[1] ?? 16);
        return { id: `clip${primitive}`, strategy: "clip", primitive };
      }
      const svgMatch = /^svg(?:(poly|polygon|path))?(\d+)?$/i.exec(id);
      if (svgMatch) {
        const svgMode = (svgMatch[1] ?? "poly").toLowerCase() === "path" ? "path" : "polygon";
        const primitive = Number(svgMatch[2] ?? 16);
        return {
          id: `svg${svgMode === "path" ? "path" : "poly"}${primitive}`,
          strategy: "svg",
          svgMode,
          primitive,
        };
      }
      const solidMatch = /^solid(\d+)?$/i.exec(id);
      if (solidMatch) {
        const primitive = Number(solidMatch[1] ?? 64);
        return { id: `solid${primitive}`, strategy: "solid", primitive };
      }
      const match = /^(mask|atlas)(\d+)?$/i.exec(id);
      if (!match) {
        throw new Error(
          `Unknown variant "${id}". Use border16, borderclass16, bordervar16, bordercontainpaint16, borderpolygonplain16, borderpath16, bordershape16, solid64, clip16, svgpoly16, svgpath16, mask16, mask64, atlas64, etc.`,
        );
      }
      const strategy = match[1].toLowerCase();
      const primitive = Number(match[2] ?? (strategy === "atlas" ? 64 : 16));
      return { id: `${strategy}${primitive}`, strategy, primitive };
    });
}

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
        const abs = resolve(benchDir, safe === "/" ? "mask-polygon.html" : safe.slice(1));
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

function quantile(values, q) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (sorted.length === 0) return 0;
  const index = (sorted.length - 1) * q;
  const lo = Math.floor(index);
  const hi = Math.ceil(index);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (index - lo);
}

function median(values) {
  return quantile(values, 0.5);
}

function summarizeSamples(samples) {
  const dts = samples
    .map((sample) => Number(sample?.dt))
    .filter((dt) => Number.isFinite(dt) && dt > 0 && dt < 1000);
  const p50 = quantile(dts, 0.5);
  const p95 = quantile(dts, 0.95);
  const p99 = quantile(dts, 0.99);
  return {
    sampleCount: dts.length,
    fpsP50: p50 > 0 ? 1000 / p50 : 0,
    frameTimeP50Ms: p50,
    frameTimeP95Ms: p95,
    frameTimeP99Ms: p99,
    over20Ms: dts.filter((dt) => dt > 20).length,
    over33Ms: dts.filter((dt) => dt > 33.333).length,
  };
}

function supported(row) {
  if (row.strategy === "border") {
    const functionSupported = row.support.borderFunctions?.[row.borderFunction ?? "polygon"] ?? row.support.borderShapeFunction ?? row.support.borderShape;
    const innerSupported = row.borderInner ? row.support.borderInners?.[row.borderInner] : true;
    return functionSupported && innerSupported;
  }
  if (row.strategy === "mask") return row.support.maskComposite || row.support.webkitMaskComposite;
  if (row.strategy === "clip") return row.support.clipPathPolygon;
  return true;
}

function runUrl(baseUrl, variant, count) {
  const url = new URL("/mask-polygon.html", baseUrl);
  url.searchParams.set("strategy", variant.strategy);
  url.searchParams.set("primitive", String(variant.primitive));
  if (variant.borderFunction) url.searchParams.set("borderFunction", variant.borderFunction);
  if (variant.borderInner) url.searchParams.set("borderInner", variant.borderInner);
  if (variant.borderShapeSource) url.searchParams.set("borderShapeSource", variant.borderShapeSource);
  if (variant.leafContain) url.searchParams.set("leafContain", variant.leafContain);
  if (variant.leafWillChange) url.searchParams.set("leafWillChange", variant.leafWillChange);
  if (variant.leafIsolation) url.searchParams.set("leafIsolation", variant.leafIsolation);
  if (variant.borderStyle) url.searchParams.set("borderStyle", variant.borderStyle);
  if (variant.svgMode) url.searchParams.set("svgMode", variant.svgMode);
  url.searchParams.set("count", String(count));
  url.searchParams.set("shape", SHAPE);
  url.searchParams.set("motion", MOTION);
  url.searchParams.set("target", String(TARGET));
  return url.href;
}

async function runOne(browser, baseUrl, variant, count, repeat) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 820 } });
  try {
    const url = runUrl(baseUrl, variant, count);
    await page.goto(url, { waitUntil: "load" });
    await page.waitForFunction(() => window.__maskPolyBench?.ready === true, null, { timeout: 30000 });
    const result = await page.evaluate(
      (options) => window.runMaskPolygonBench(options),
      { warmupMs: WARMUP_MS, sampleMs: SAMPLE_MS },
    );
    const frames = summarizeSamples(result.samples);
    return {
      repeat,
      variant: variant.id,
      strategy: variant.strategy,
      borderFunction: variant.borderFunction,
      borderInner: variant.borderInner,
      borderShapeSource: variant.borderShapeSource,
      leafContain: variant.leafContain,
      leafWillChange: variant.leafWillChange,
      leafIsolation: variant.leafIsolation,
      borderStyle: variant.borderStyle,
      svgMode: variant.svgMode,
      primitive: variant.primitive,
      count,
      shape: SHAPE,
      motion: MOTION,
      target: TARGET,
      support: result.support,
      supported: supported({
        strategy: variant.strategy,
        borderFunction: variant.borderFunction,
        borderInner: variant.borderInner,
        borderShapeSource: variant.borderShapeSource,
        leafContain: variant.leafContain,
        leafWillChange: variant.leafWillChange,
        leafIsolation: variant.leafIsolation,
        borderStyle: variant.borderStyle,
        svgMode: variant.svgMode,
        support: result.support,
      }),
      mountMs: result.mountMs,
      styleBytes: result.styleBytes,
      ...frames,
      url,
    };
  } finally {
    await page.close();
  }
}

function aggregate(rows) {
  const groups = new Map();
  for (const row of rows) {
    const key = `${row.count}:${row.variant}`;
    const list = groups.get(key) ?? [];
    list.push(row);
    groups.set(key, list);
  }
  return [...groups.values()].map((list) => {
    const first = list[0];
    return {
      count: first.count,
      variant: first.variant,
      strategy: first.strategy,
      borderFunction: first.borderFunction,
      borderInner: first.borderInner,
      borderShapeSource: first.borderShapeSource,
      leafContain: first.leafContain,
      leafWillChange: first.leafWillChange,
      leafIsolation: first.leafIsolation,
      borderStyle: first.borderStyle,
      svgMode: first.svgMode,
      primitive: first.primitive,
      supported: list.every((row) => row.supported),
      fpsP50: median(list.map((row) => row.fpsP50)),
      frameTimeP50Ms: median(list.map((row) => row.frameTimeP50Ms)),
      frameTimeP95Ms: median(list.map((row) => row.frameTimeP95Ms)),
      frameTimeP99Ms: median(list.map((row) => row.frameTimeP99Ms)),
      mountMs: median(list.map((row) => row.mountMs)),
      styleBytes: median(list.map((row) => row.styleBytes)),
      samples: list.reduce((sum, row) => sum + row.sampleCount, 0),
    };
  }).sort((a, b) => a.count - b.count || a.variant.localeCompare(b.variant));
}

function fmt(value, digits = 1) {
  return Number.isFinite(value) ? value.toFixed(digits) : "n/a";
}

function printRows(rows, aggregates) {
  console.log(`[mask-polygon] counts=${COUNTS.join(",")} variants=${VARIANTS.map((v) => v.id).join(",")} repeats=${REPEATS} warmup=${WARMUP_MS}ms sample=${SAMPLE_MS}ms`);
  if (CHROMIUM_ARGS.length > 0) console.log(`[mask-polygon] chromium args=${CHROMIUM_ARGS.join(" ")}`);
  for (const row of rows) {
    console.log(
      `#${row.repeat} count=${String(row.count).padStart(5)} ${row.variant.padEnd(8)} ` +
      `supported=${row.supported ? "yes" : "no "} fps50=${fmt(row.fpsP50).padStart(5)} ` +
      `p95=${fmt(row.frameTimeP95Ms).padStart(5)}ms p99=${fmt(row.frameTimeP99Ms).padStart(5)}ms ` +
      `mount=${fmt(row.mountMs, 2).padStart(7)}ms style=${Math.round(row.styleBytes / 1024)}KiB`,
    );
  }
  console.log("[mask-polygon] aggregate medians");
  for (const row of aggregates) {
    console.log(
      `count=${String(row.count).padStart(5)} ${row.variant.padEnd(8)} ` +
      `supported=${row.supported ? "yes" : "no "} fps50=${fmt(row.fpsP50).padStart(5)} ` +
      `p50=${fmt(row.frameTimeP50Ms).padStart(5)}ms p95=${fmt(row.frameTimeP95Ms).padStart(5)}ms ` +
      `p99=${fmt(row.frameTimeP99Ms).padStart(5)}ms mount=${fmt(row.mountMs, 2).padStart(7)}ms ` +
      `style=${Math.round(row.styleBytes / 1024)}KiB`,
    );
  }
}

let server;
let browser;
try {
  if (COUNTS.length === 0) throw new Error("No counts selected.");
  if (VARIANTS.length === 0) throw new Error("No variants selected.");

  const started = await startServer();
  server = started.server;
  const baseUrl = `http://127.0.0.1:${started.port}`;
  browser = await chromium.launch({
    headless: !HEADED,
    executablePath: BROWSER_EXECUTABLE || undefined,
    args: CHROMIUM_ARGS,
  });

  const rows = [];
  for (const count of COUNTS) {
    for (const variant of VARIANTS) {
      for (let repeat = 1; repeat <= REPEATS; repeat += 1) {
        rows.push(await runOne(browser, baseUrl, variant, count, repeat));
      }
    }
  }
  const aggregates = aggregate(rows);
  const result = {
    kind: "mask-polygon-bench",
    options: {
      counts: COUNTS,
      variants: VARIANTS,
      repeats: REPEATS,
      warmupMs: WARMUP_MS,
      sampleMs: SAMPLE_MS,
      shape: SHAPE,
      motion: MOTION,
      target: TARGET,
      chromiumArgs: CHROMIUM_ARGS,
    },
    rows,
    aggregates,
  };
  printRows(rows, aggregates);

  const outputPath = JSON_PATH || (LABEL ? resolve(repoRoot, "bench/results", `${LABEL}.json`) : "");
  if (outputPath) {
    await mkdir(dirname(resolve(outputPath)), { recursive: true });
    await writeFile(resolve(outputPath), `${JSON.stringify(result, null, 2)}\n`);
    console.log(`[mask-polygon] wrote ${resolve(outputPath)}`);
  }
} finally {
  if (browser) await browser.close();
  if (server) await stopServer(server);
}
