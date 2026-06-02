#!/usr/bin/env node
/**
 * Compare baseline gallery GLB/GLTF imports against the PolyCSS-owned
 * simplifier. Optionally includes meshoptimizer as an external comparator
 * when installed outside the repo.
 *
 * Usage:
 *   node bench/gltf-simplifier-corpus-bench.mjs --json bench/results/poly-simplifier.json
 *   node bench/gltf-simplifier-corpus-bench.mjs --models flying-saucer,space-shuttle --progress 1
 *   node bench/gltf-simplifier-corpus-bench.mjs --meshoptimizer --meshoptimizer-package /tmp/polycss-meshopt/package.json
 */
import { createRequire } from "node:module";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { performance } from "node:perf_hooks";
import {
  bakeSolidTextureSamples,
  optimizeMeshParseResult,
  parseGltf,
} from "../packages/core/dist/index.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const galleryGlbRoot = resolve(repoRoot, "website/public/gallery/glb");
const requireFromWebsite = createRequire(resolve(repoRoot, "website/package.json"));

const argv = process.argv.slice(2);
const flag = (name) => argv.indexOf(`--${name}`);
const hasFlag = (name) => flag(name) >= 0;
const optStr = (name, dflt = "") => {
  const index = flag(name);
  return index >= 0 ? argv[index + 1] : dflt;
};

if (hasFlag("help")) {
  console.log(`Usage: node bench/gltf-simplifier-corpus-bench.mjs [--json file]

Options:
  --models <list>                 Comma-separated case-insensitive path substrings.
  --root <dir>                    Scan GLB/GLTF files under this root. Default: website/public/gallery/glb.
  --json <file>                   Write full summary + rows as JSON.
  --progress <n>                  Print progress to stderr every n scanned files.
  --limit <n>                     Number of rows to print in win/regression tables.
  --file-offset <n>               Skip first n selected files.
  --file-limit <n>                Scan at most n selected files.
  --stop-drop-pct <n>             Candidate early-stop target drop percentage. Default: 15.
  --simplify-ratio <n>            Triangle simplifier target ratio. Default: core default.
  --simplify-max-error <n>        Triangle simplifier max displacement. Default: core default.
  --simplify-max-normal-angle <n> Triangle simplifier max normal angle in degrees. Default: core default.
  --meshoptimizer                 Include external meshoptimizer comparator.
  --meshoptimizer-package <file>  package.json whose node_modules contains @gltf-transform/* + meshoptimizer.
`);
  process.exit(0);
}

const PRINT_LIMIT = Math.max(1, Number(optStr("limit", "16")) || 16);
const FILE_OFFSET = Math.max(0, Number(optStr("file-offset", "0")) || 0);
const FILE_LIMIT = Math.max(0, Number(optStr("file-limit", "0")) || 0);
const PROGRESS_EVERY = Math.max(0, Number(optStr("progress", "0")) || 0);
const stopDropPctValue = Number(optStr("stop-drop-pct", "15"));
const STOP_DROP_PCT = Number.isFinite(stopDropPctValue) ? Math.max(0, stopDropPctValue) : 15;
const INCLUDE_MESHOPTIMIZER = hasFlag("meshoptimizer");
const sourceRoot = optStr("root") ? resolve(repoRoot, optStr("root")) : galleryGlbRoot;
const SIMPLIFY_OPTIONS = {};
const simplifyRatio = Number(optStr("simplify-ratio", "NaN"));
const simplifyMaxError = Number(optStr("simplify-max-error", "NaN"));
const simplifyMaxNormalAngle = Number(optStr("simplify-max-normal-angle", "NaN"));
if (Number.isFinite(simplifyRatio)) SIMPLIFY_OPTIONS.ratio = simplifyRatio;
if (Number.isFinite(simplifyMaxError)) SIMPLIFY_OPTIONS.maxError = simplifyMaxError;
if (Number.isFinite(simplifyMaxNormalAngle)) SIMPLIFY_OPTIONS.maxNormalAngleDeg = simplifyMaxNormalAngle;

let textureSamplingReady = false;
let textureSamplingUnavailable = false;
let meshoptimizerDepsPromise = null;

function walk(dir, exts) {
  const out = [];
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(path, exts));
    else if (exts.has(extname(entry.name).toLowerCase())) out.push(path);
  }
  return out.sort((a, b) => a.localeCompare(b));
}

function selectedFiles() {
  const needles = optStr("models")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  let files = walk(sourceRoot, new Set([".glb", ".gltf"]));
  if (needles.length > 0) {
    files = files.filter((file) => {
      const label = relative(sourceRoot, file).toLowerCase();
      return needles.some((needle) => label.includes(needle));
    });
  }
  const start = Math.min(FILE_OFFSET, files.length);
  const end = FILE_LIMIT > 0 ? Math.min(files.length, start + FILE_LIMIT) : files.length;
  return files.slice(start, end);
}

function readBytes(path) {
  const bytes = readFileSync(path);
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

function resolveGltfBuffer(modelPath, uri) {
  if (/^file:\/\//i.test(uri)) return readFileSync(fileURLToPath(uri));
  return readFileSync(resolve(dirname(modelPath), uri));
}

async function readImageBytes(url) {
  if (/^(blob:|data:|https?:)/.test(url)) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`image fetch failed: ${response.status}`);
    return Buffer.from(await response.arrayBuffer());
  }
  return readFileSync(url.startsWith("file://") ? fileURLToPath(url) : url);
}

function installTextureSamplingEnv() {
  if (textureSamplingReady) return true;
  if (textureSamplingUnavailable) return false;

  let sharp;
  try {
    sharp = requireFromWebsite("sharp");
  } catch {
    textureSamplingUnavailable = true;
    return false;
  }

  class BenchImage {
    onload = null;
    onerror = null;
    decoding = "async";
    width = 0;
    height = 0;
    naturalWidth = 0;
    naturalHeight = 0;
    data = null;
    #decodePromise = null;
    #src = "";

    set src(value) {
      this.#src = value;
      this.#decodePromise = (async () => {
        const input = await readImageBytes(value);
        const { data, info } = await sharp(input).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
        this.width = this.naturalWidth = info.width;
        this.height = this.naturalHeight = info.height;
        this.data = data;
        this.onload?.();
      })().catch((error) => {
        this.onerror?.();
        throw error;
      });
    }

    get src() {
      return this.#src;
    }

    decode() {
      return this.#decodePromise ?? Promise.resolve();
    }
  }

  class BenchCanvas {
    width = 0;
    height = 0;
    image = null;

    getContext() {
      return {
        drawImage: (image) => {
          this.image = image;
        },
        getImageData: () => ({
          data: this.image?.data ?? new Uint8ClampedArray(this.width * this.height * 4),
        }),
      };
    }
  }

  globalThis.Image = BenchImage;
  globalThis.document = {
    createElement: (tagName) => tagName === "canvas" ? new BenchCanvas() : {},
  };
  textureSamplingReady = true;
  return true;
}

async function applyGalleryTexturePrepass(result) {
  if (!installTextureSamplingEnv()) return result;
  return bakeSolidTextureSamples(result);
}

function hasTexturePaint(polygon) {
  return Boolean(
    polygon.texture ||
    polygon.material?.texture ||
    polygon.uvs?.length ||
    polygon.textureTriangles?.length
  );
}

async function parsePrepared(modelPath, bytes) {
  const parsed = parseGltf(bytes, {
    baseUrl: pathToFileURL(modelPath).href,
    resolveBuffer: (uri) => resolveGltfBuffer(modelPath, uri),
  });
  const baked = await applyGalleryTexturePrepass(parsed);
  return {
    parsed,
    baked,
  };
}

function polygonStats(polygons) {
  let triangles = 0;
  let quads = 0;
  let textured = 0;
  let maxVertices = 0;
  for (const polygon of polygons) {
    if (polygon.vertices.length === 3) triangles += 1;
    else if (polygon.vertices.length === 4) quads += 1;
    if (hasTexturePaint(polygon)) textured += 1;
    maxVertices = Math.max(maxVertices, polygon.vertices.length);
  }
  return {
    count: polygons.length,
    triangles,
    quads,
    textured,
    maxVertices,
  };
}

function pctDrop(after, before) {
  return before > 0 ? ((before - after) / before) * 100 : 0;
}

async function importFromPackage(requireFrom, name) {
  return import(pathToFileURL(requireFrom.resolve(name)).href);
}

async function loadMeshoptimizerDeps() {
  if (!INCLUDE_MESHOPTIMIZER) return null;
  meshoptimizerDepsPromise ??= (async () => {
    const packageJson = optStr("meshoptimizer-package", "website/package.json");
    const requireFrom = createRequire(resolve(repoRoot, packageJson));
    const [
      { Logger, NodeIO },
      { ALL_EXTENSIONS },
      { dedup, flatten, join, prune, simplify, weld },
      { MeshoptDecoder, MeshoptEncoder, MeshoptSimplifier },
    ] = await Promise.all([
      importFromPackage(requireFrom, "@gltf-transform/core"),
      importFromPackage(requireFrom, "@gltf-transform/extensions"),
      importFromPackage(requireFrom, "@gltf-transform/functions"),
      importFromPackage(requireFrom, "meshoptimizer"),
    ]);
    await Promise.all([
      MeshoptDecoder.ready,
      MeshoptEncoder.ready,
      MeshoptSimplifier.ready,
    ]);
    return {
      Logger,
      NodeIO,
      ALL_EXTENSIONS,
      dedup,
      flatten,
      join,
      prune,
      simplify,
      weld,
      MeshoptDecoder,
      MeshoptEncoder,
      MeshoptSimplifier,
    };
  })();
  return meshoptimizerDepsPromise;
}

async function simplifyWithMeshoptimizer(modelPath) {
  const deps = await loadMeshoptimizerDeps();
  if (!deps) return null;
  const io = new deps.NodeIO()
    .setLogger(new deps.Logger(deps.Logger.Verbosity.ERROR))
    .registerExtensions(deps.ALL_EXTENSIONS)
    .registerDependencies({
      "meshopt.decoder": deps.MeshoptDecoder,
      "meshopt.encoder": deps.MeshoptEncoder,
    });
  const document = await io.read(modelPath);
  await document.transform(
    deps.dedup(),
    deps.flatten(),
    deps.join(),
    deps.weld(),
    deps.simplify({
      simplifier: deps.MeshoptSimplifier,
      ratio: 0.7,
      error: 0.003,
      lockBorder: true,
    }),
    deps.prune(),
  );
  const out = await io.writeBinary(document);
  return out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength);
}

async function timed(fn) {
  const started = performance.now();
  const value = await fn();
  return {
    value,
    ms: Number((performance.now() - started).toFixed(1)),
  };
}

function optimizeCoreParseResult(prepared, options = {}) {
  return optimizeMeshParseResult(prepared.baked, {
    meshResolution: "lossy",
    source: prepared.parsed,
    ...options,
  });
}

async function summarizeModel(modelPath) {
  const label = relative(sourceRoot, modelPath);
  const started = performance.now();
  const originalBytes = readBytes(modelPath);
  const baselinePrepared = await timed(() => parsePrepared(modelPath, originalBytes));
  const baselineSourcePolygons = baselinePrepared.value.baked.polygons;
  const baselineOptimizedPolygons = optimizeCoreParseResult(baselinePrepared.value, {
    simplifyTriangleMeshes: false,
  }).polygons;
  const baselineOptimized = polygonStats(baselineOptimizedPolygons);
  const animated = (baselinePrepared.value.parsed.animation?.clips?.length ?? 0) > 0;

  const coreOptimized = await timed(() => Promise.resolve(optimizeCoreParseResult(baselinePrepared.value, {
    simplifyTriangleMeshOptions: SIMPLIFY_OPTIONS,
    simplifyEarlyStopDropRatio: STOP_DROP_PCT / 100,
  })));
  const polyOptimizedPolygons = coreOptimized.value.polygons;
  const polyOptimized = polygonStats(polyOptimizedPolygons);
  const polyAccepted = polyOptimized.count < baselineOptimized.count;

  let meshoptimizer = null;
  if (INCLUDE_MESHOPTIMIZER) {
    const meshoptBytes = await timed(() => simplifyWithMeshoptimizer(modelPath));
    const meshoptPrepared = await timed(() => parsePrepared(modelPath, meshoptBytes.value));
    const meshoptOptimized = optimizeCoreParseResult(meshoptPrepared.value, {
      simplifyTriangleMeshes: false,
    }).polygons;
    meshoptimizer = {
      raw: polygonStats(meshoptPrepared.value.baked.polygons),
      lossy: polygonStats(meshoptOptimized),
      bytes: meshoptBytes.value.byteLength,
      timings: {
        transformMs: meshoptBytes.ms,
        parseMs: meshoptPrepared.ms,
      },
    };
  }

  return {
    model: label,
    ext: extname(modelPath).slice(1).toLowerCase(),
    animated,
    baseline: {
      raw: polygonStats(baselineSourcePolygons),
      lossy: baselineOptimized,
      bytes: originalBytes.byteLength,
    },
    polycss: {
      accepted: polyAccepted,
      variant: polyAccepted ? "core-default" : "none",
      raw: polygonStats(polyOptimizedPolygons),
      candidateRaw: polygonStats(polyOptimizedPolygons),
      lossy: polyOptimized,
      candidateLossy: polyOptimized,
      timings: {
        simplifyMs: coreOptimized.ms,
      },
    },
    meshoptimizer,
    deltas: {
      polycssLossy: polyOptimized.count - baselineOptimized.count,
      polycssLossyDropPct: Number(pctDrop(polyOptimized.count, baselineOptimized.count).toFixed(1)),
      meshoptimizerLossy: meshoptimizer ? meshoptimizer.lossy.count - baselineOptimized.count : null,
      meshoptimizerLossyDropPct: meshoptimizer
        ? Number(pctDrop(meshoptimizer.lossy.count, baselineOptimized.count).toFixed(1))
        : null,
    },
    timings: {
      baselineParseMs: baselinePrepared.ms,
      totalMs: Number((performance.now() - started).toFixed(1)),
    },
  };
}

function summarizeRows(rows, errors, elapsedMs) {
  const total = (selector) => rows.reduce((sum, row) => sum + selector(row), 0);
  const baselineLossy = total((row) => row.baseline.lossy.count);
  const polyLossy = total((row) => row.polycss.lossy.count);
  const meshRows = rows.filter((row) => row.meshoptimizer);
  const meshLossy = meshRows.length > 0 ? total((row) => row.meshoptimizer?.lossy.count ?? 0) : null;
  return {
    scanned: rows.length,
    errors: errors.length,
    animated: rows.filter((row) => row.animated).length,
    elapsedMs: Number(elapsedMs.toFixed(1)),
    baseline: {
      raw: total((row) => row.baseline.raw.count),
      lossy: baselineLossy,
      bytes: total((row) => row.baseline.bytes),
    },
    polycss: {
      accepted: rows.filter((row) => row.polycss.accepted).length,
      raw: total((row) => row.polycss.raw.count),
      lossy: polyLossy,
      delta: polyLossy - baselineLossy,
      dropPct: Number(pctDrop(polyLossy, baselineLossy).toFixed(1)),
      wins: rows.filter((row) => row.deltas.polycssLossy < 0).length,
      unchanged: rows.filter((row) => row.deltas.polycssLossy === 0).length,
      regressions: rows.filter((row) => row.deltas.polycssLossy > 0).length,
      simplifyMs: Number(total((row) => row.polycss.timings.simplifyMs).toFixed(1)),
    },
    meshoptimizer: meshRows.length > 0 && meshLossy !== null
      ? {
          raw: total((row) => row.meshoptimizer?.raw.count ?? 0),
          lossy: meshLossy,
          delta: meshLossy - baselineLossy,
          dropPct: Number(pctDrop(meshLossy, baselineLossy).toFixed(1)),
          wins: meshRows.filter((row) => row.deltas.meshoptimizerLossy < 0).length,
          unchanged: meshRows.filter((row) => row.deltas.meshoptimizerLossy === 0).length,
          regressions: meshRows.filter((row) => row.deltas.meshoptimizerLossy > 0).length,
          transformMs: Number(total((row) => row.meshoptimizer?.timings.transformMs ?? 0).toFixed(1)),
        }
      : null,
  };
}

function printSummary(output) {
  const { summary } = output;
  console.log("gltf simplifier corpus benchmark");
  console.log(`models=${summary.scanned} errors=${summary.errors} animated=${summary.animated} elapsedMs=${summary.elapsedMs}`);
  console.log(`baseline lossy leaves=${summary.baseline.lossy} raw=${summary.baseline.raw}`);
  console.log(`polycss lossy leaves ${summary.baseline.lossy}->${summary.polycss.lossy} delta=${summary.polycss.delta} drop=${summary.polycss.dropPct}% accepted=${summary.polycss.accepted} wins=${summary.polycss.wins} unchanged=${summary.polycss.unchanged} regressions=${summary.polycss.regressions} simplifyMs=${summary.polycss.simplifyMs}`);
  if (summary.meshoptimizer) {
    console.log(`meshoptimizer lossy leaves ${summary.baseline.lossy}->${summary.meshoptimizer.lossy} delta=${summary.meshoptimizer.delta} drop=${summary.meshoptimizer.dropPct}% wins=${summary.meshoptimizer.wins} unchanged=${summary.meshoptimizer.unchanged} regressions=${summary.meshoptimizer.regressions} transformMs=${summary.meshoptimizer.transformMs}`);
  }

  const polyWins = [...output.rows]
    .filter((row) => row.deltas.polycssLossy < 0)
    .sort((a, b) => a.deltas.polycssLossy - b.deltas.polycssLossy);
  if (polyWins.length > 0) {
    console.log("");
    console.log("largest PolyCSS wins");
    for (const row of polyWins.slice(0, PRINT_LIMIT)) {
      console.log(`${row.model}: ${row.baseline.lossy.count}->${row.polycss.lossy.count} delta=${row.deltas.polycssLossy} drop=${row.deltas.polycssLossyDropPct}% raw=${row.baseline.raw.count}->${row.polycss.raw.count}`);
    }
  }

  const meshWins = [...output.rows]
    .filter((row) => row.deltas.meshoptimizerLossy !== null && row.deltas.meshoptimizerLossy < 0)
    .sort((a, b) => a.deltas.meshoptimizerLossy - b.deltas.meshoptimizerLossy);
  if (meshWins.length > 0) {
    console.log("");
    console.log("largest meshoptimizer wins");
    for (const row of meshWins.slice(0, PRINT_LIMIT)) {
      console.log(`${row.model}: ${row.baseline.lossy.count}->${row.meshoptimizer.lossy.count} delta=${row.deltas.meshoptimizerLossy} drop=${row.deltas.meshoptimizerLossyDropPct}% raw=${row.baseline.raw.count}->${row.meshoptimizer.raw.count}`);
    }
  }
}

async function runCorpus() {
  const started = performance.now();
  const rows = [];
  const errors = [];
  const files = selectedFiles();
  let scanned = 0;
  for (const file of files) {
    scanned += 1;
    try {
      rows.push(await summarizeModel(file));
    } catch (error) {
      errors.push({
        model: relative(sourceRoot, file),
        error: error instanceof Error ? error.message : String(error),
      });
    }
    if (PROGRESS_EVERY > 0 && (scanned % PROGRESS_EVERY === 0 || scanned === files.length)) {
      const elapsedMs = Number((performance.now() - started).toFixed(1));
      console.error(`gltf-simplifier progress ${scanned}/${files.length} rows=${rows.length} errors=${errors.length} elapsedMs=${elapsedMs}`);
    }
  }
  return {
    summary: summarizeRows(rows, errors, performance.now() - started),
    rows,
    errors,
    options: {
      root: sourceRoot,
      models: optStr("models").trim() || null,
      fileOffset: FILE_OFFSET,
      fileLimit: FILE_LIMIT || null,
      meshoptimizer: INCLUDE_MESHOPTIMIZER,
      meshoptimizerPackage: optStr("meshoptimizer-package") || null,
    },
  };
}

const output = await runCorpus();
printSummary(output);

const jsonPath = optStr("json");
if (jsonPath) {
  const outputPath = resolve(repoRoot, jsonPath);
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`);
  console.log(`wrote ${jsonPath}`);
}
