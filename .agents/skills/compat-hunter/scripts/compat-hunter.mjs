#!/usr/bin/env node
/**
 * Stream OBJ/GLB/glTF/VOX files through the core parser and keep only compatibility
 * cases worth inspecting. Clean models are never written to disk.
 *
 * Usage:
 *   pnpm --filter @layoutit/polycss-core build
 *   node .agents/skills/compat-hunter/scripts/compat-hunter.mjs
 *   node .agents/skills/compat-hunter/scripts/compat-hunter.mjs --sources objaverse --max-models 5000
 *   node .agents/skills/compat-hunter/scripts/compat-hunter.mjs --sources github --max-models 500
 *   node .agents/skills/compat-hunter/scripts/compat-hunter.mjs --sources polyhaven --max-models 200
 *   node .agents/skills/compat-hunter/scripts/compat-hunter.mjs --sources github --github-repos ephtracy/voxel-model@master:vox/
 *   node .agents/skills/compat-hunter/scripts/compat-hunter.mjs --local-root /tmp/models --out bench/results/local-hunt
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";
import { parseGltf, parseObj, parseVox } from "../../../../packages/core/dist/index.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const argv = process.argv.slice(2).filter((arg) => arg !== "--");
const VALID_SOURCES = new Set(["objaverse", "github", "polyhaven", "local"]);
const textEncoder = new TextEncoder();

function fail(message) {
  console.error(`compat-hunter: ${message}`);
  process.exit(1);
}

function flag(name) {
  return argv.indexOf(`--${name}`);
}

function hasFlag(name) {
  return flag(name) >= 0;
}

function optStr(name, dflt = "") {
  const index = flag(name);
  if (index < 0) return dflt;
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) fail(`--${name} requires a value`);
  return value;
}

function optNum(name, dflt) {
  const raw = optStr(name, "");
  if (!raw) return dflt;
  const value = Number(raw);
  return Number.isFinite(value) ? value : dflt;
}

function parseByteLimit(raw) {
  const text = String(raw).trim().toLowerCase();
  const match = /^(\d+(?:\.\d+)?)(b|kb|mb|gb)?$/.exec(text);
  if (!match) return Number(raw) || 0;
  const value = Number(match[1]);
  const unit = match[2] ?? "b";
  const multiplier = unit === "gb" ? 1024 ** 3 : unit === "mb" ? 1024 ** 2 : unit === "kb" ? 1024 : 1;
  return Math.floor(value * multiplier);
}

function usage() {
  console.log(`Usage: node .agents/skills/compat-hunter/scripts/compat-hunter.mjs [options]

Options:
  --sources <list>          Comma-separated sources: objaverse,github,polyhaven,local. Default: objaverse,github
  --max-models <n>          Stop after this many attempted models. Default: 2000
  --max-bytes <n|10mb>      Skip remote files above this size. Default: 10mb
  --concurrency <n>         Parallel remote downloads/parses. Default: 8
  --timeout-ms <n>          Fetch timeout for API/file downloads. Default: 30000
  --out <dir>               Report directory. Default: bench/results/compat-hunter-<timestamp>
  --progress <n>            Print progress every n attempts. Default: 100
  --report <file>           Print a compact summary for an existing report and exit.
  --stop-on-interesting     Stop after first actionable case. Default: true
  --no-stop-on-interesting  Continue after actionable cases until --max-models
  --keep-known              Save files that only hit known non-actionable warnings.
  --local-root <dir>        Local OBJ/GLB/glTF/VOX tree when --sources includes local.
  --objaverse-shards <a:b>  Objaverse shard range, inclusive. Default: 20:120
  --github-repos <list>     repo specs owner/repo@branch[:prefix], comma-separated.
  --polyhaven-limit <n>     Max Poly Haven asset metadata records to inspect. Default: 250
  --skip-manifest <file>    Manifest with selected[].path to skip. Default: previous 5k manifest if present
`);
}

if (hasFlag("help")) {
  usage();
  process.exit(0);
}

if (hasFlag("report")) {
  summarizeReport(resolve(repoRoot, optStr("report")));
  process.exit(0);
}

const sources = optStr("sources", "objaverse,github")
  .split(",")
  .map((source) => source.trim())
  .filter(Boolean);
for (const source of sources) {
  if (!VALID_SOURCES.has(source)) {
    fail(`unknown source "${source}" (expected one of ${[...VALID_SOURCES].join(", ")})`);
  }
}
const maxModels = Math.max(1, optNum("max-models", 2000));
const maxBytes = parseByteLimit(optStr("max-bytes", "10mb"));
const concurrency = Math.max(1, optNum("concurrency", 8));
const timeoutMs = Math.max(0, optNum("timeout-ms", 30000));
const progressEvery = Math.max(0, optNum("progress", 100));
const stopOnInteresting = !hasFlag("no-stop-on-interesting");
const keepKnown = hasFlag("keep-known");
const startedAt = new Date().toISOString();
const outRoot = resolve(repoRoot, optStr(
  "out",
  `bench/results/compat-hunter-${startedAt.replace(/[:.]/g, "-")}`,
));
const interestingRoot = join(outRoot, "interesting");
const knownRoot = join(outRoot, "known");
const reportPath = join(outRoot, "report.json");
mkdirSync(interestingRoot, { recursive: true });
if (keepKnown) mkdirSync(knownRoot, { recursive: true });

const defaultSkipManifest = resolve(repoRoot, "bench/results/parser-corpus-5000-objaverse/manifest.json");
const skipManifestPath = optStr("skip-manifest", existsSync(defaultSkipManifest) ? defaultSkipManifest : "");
const skippedSourcePaths = new Set();
if (skipManifestPath && existsSync(resolve(repoRoot, skipManifestPath))) {
  const manifest = JSON.parse(readFileSync(resolve(repoRoot, skipManifestPath), "utf8"));
  for (const item of manifest.selected ?? []) {
    if (item.path) skippedSourcePaths.add(item.path);
  }
}

const knownWarningCounts = new Map();
const knownErrorCounts = new Map();
const failureCounts = new Map();
const sourceCounts = new Map();
const cleanSamples = [];
const knownSamples = [];
const interesting = [];
const failedDownloads = [];
let cleanCount = 0;
let knownCount = 0;
let attempted = 0;
let parsed = 0;
let totalPolygons = 0;
let stop = false;
let nextQueueIndex = 0;

function stableShuffle(items, seed) {
  let state = seed >>> 0;
  const next = () => {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function bump(map, key) {
  map.set(key, (map.get(key) ?? 0) + 1);
}

function counterObject(map) {
  return Object.fromEntries([...map.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])));
}

function sourceStats(source) {
  if (!sourceCounts.has(source)) {
    sourceCounts.set(source, {
      queued: 0,
      attempted: 0,
      parsed: 0,
      clean: 0,
      known: 0,
      interesting: 0,
      failedDownloads: 0,
      totalPolygons: 0,
    });
  }
  return sourceCounts.get(source);
}

function bumpSource(source, field, amount = 1) {
  const stats = sourceStats(source);
  stats[field] = (stats[field] ?? 0) + amount;
}

function sourceCountsObject() {
  return Object.fromEntries([...sourceCounts.entries()].sort((a, b) => a[0].localeCompare(b[0])));
}

function summarizeReport(file) {
  const report = JSON.parse(readFileSync(file, "utf8"));
  console.log(JSON.stringify({
    counts: report.counts,
    sourceCounts: report.sourceCounts,
    knownWarningsByMessage: report.knownWarningsByMessage,
    knownErrorsByMessage: report.knownErrorsByMessage,
    failuresByMessage: report.failuresByMessage,
    interesting: report.interesting,
  }, null, 2));
}

function isKnownWarning(warning) {
  return /^Skipped primitives with unsupported mode \d+ \((POINTS|LINES|LINE_LOOP|LINE_STRIP)\)$/.test(warning)
    || warning === "Skipped primitives with unsupported required extension KHR_draco_mesh_compression"
    || /^Skipped primitives with unsupported required extension (EXT|KHR)_meshopt_compression$/.test(warning)
    || /^Skipped recursive node reference \d+ in glTF scene graph$/.test(warning)
    || warning === "No glTF meshes found"
    || warning === "No non-degenerate glTF triangles remained after normalization"
    || /^Mesh .+: skipped mesh with non-array primitives$/.test(warning)
    || warning === "Skipped OBJ point elements; PolyCSS only renders face polygons"
    || warning === "Skipped OBJ line elements; PolyCSS only renders face polygons"
    || warning === "Skipped MagicaVoxel scene graph transforms; models were flattened into one grid";
}

function isKnownError(message) {
  return /^parseGltf: only glTF v2 supported/.test(message)
    || /^parseGltf: only glTF asset v2 supported/.test(message)
    || /^parseGltf: glTF asset requires minVersion/.test(message);
}

function toArrayBuffer(bytes) {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

function classify(parsed, ext) {
  const warnings = parsed.warnings ?? [];
  const unknownWarnings = warnings.filter((warning) => !isKnownWarning(warning));
  if (unknownWarnings.length > 0) return { kind: "unknown-warning", unknownWarnings };
  if (parsed.polygons.length === 0 && warnings.length === 0) return { kind: `${ext}-zero-no-warning`, unknownWarnings };
  if (parsed.polygons.length === 0 && warnings.some(isKnownWarning)) return { kind: "known-zero", unknownWarnings };
  if (warnings.length > 0) return { kind: "known-warning", unknownWarnings };
  return { kind: "clean", unknownWarnings };
}

function rowForItem(item, testedIndex, extra = {}) {
  return {
    testedIndex,
    source: item.source,
    sourcePath: item.sourcePath,
    ext: item.ext,
    size: item.size,
    url: item.url,
    ...extra,
  };
}

function writeReport(done = false) {
  const report = {
    startedAt,
    updatedAt: new Date().toISOString(),
    done,
    policy: {
      sources,
      maxModels,
      maxBytes,
      concurrency,
      timeoutMs,
      stopOnInteresting,
      keepKnown,
      cleanFilesDeleted: true,
      skippedSourcePaths: skippedSourcePaths.size,
    },
    counts: {
      queued: queue.length,
      attempted,
      parsed,
      clean: cleanCount,
      known: knownCount,
      interesting: interesting.length,
      failedDownloads: failedDownloads.length,
      totalPolygons,
    },
    sourceCounts: sourceCountsObject(),
    knownWarningsByMessage: counterObject(knownWarningCounts),
    knownErrorsByMessage: counterObject(knownErrorCounts),
    failuresByMessage: counterObject(failureCounts),
    interesting,
    knownSamples: knownSamples.slice(-100),
    cleanSamples: cleanSamples.slice(-25),
    failedDownloads: failedDownloads.slice(-100),
  };
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
}

async function fetchWithTimeout(url) {
  const response = await fetch(url, {
    headers: { "User-Agent": "polycss-compat-hunter" },
    signal: timeoutMs > 0 ? AbortSignal.timeout(timeoutMs) : undefined,
  });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return response;
}

async function fetchJson(url) {
  const response = await fetchWithTimeout(url);
  return response.json();
}

async function fetchBytes(url) {
  const response = await fetchWithTimeout(url);
  return new Uint8Array(await response.arrayBuffer());
}

async function fetchText(url) {
  const response = await fetchWithTimeout(url);
  return response.text();
}

async function listObjaverse() {
  const [startRaw, endRaw] = optStr("objaverse-shards", "20:120").split(":");
  const start = Number(startRaw);
  const end = Number(endRaw);
  const out = [];
  for (let shard = start; shard <= end && out.length < maxModels * 3; shard++) {
    const shardName = `000-${String(shard).padStart(3, "0")}`;
    const api = `https://huggingface.co/api/datasets/allenai/objaverse/tree/main/glbs/${shardName}?recursive=false&expand=false`;
    try {
      const entries = await fetchJson(api);
      const files = entries
        .filter((entry) =>
          entry.type === "file"
          && entry.path?.endsWith(".glb")
          && entry.size > 0
          && entry.size <= maxBytes
          && !skippedSourcePaths.has(entry.path)
        )
        .map((entry) => ({
          source: "allenai/objaverse@main",
          sourcePath: entry.path,
          ext: "glb",
          size: entry.size,
          url: `https://huggingface.co/datasets/allenai/objaverse/resolve/main/${entry.path}`,
        }));
      out.push(...stableShuffle(files, 0x509c + shard));
      console.log(`listed objaverse ${shardName}: +${files.length}, queue=${out.length}`);
    } catch (error) {
      const source = "allenai/objaverse@main";
      failedDownloads.push({
        source,
        sourcePath: shardName,
        stage: "list",
        error: error instanceof Error ? error.message : String(error),
      });
      bumpSource(source, "failedDownloads");
    }
  }
  return out;
}

function parseRepoSpec(spec) {
  const [repoAndBranch, prefix = ""] = spec.split(":");
  const [repoName, branch = "main"] = repoAndBranch.split("@");
  const [owner, repo] = repoName.split("/");
  if (!owner || !repo || !branch) fail(`bad GitHub repo spec "${spec}" (expected owner/repo@branch[:prefix])`);
  return { owner, repo, branch, prefix };
}

async function listGithub() {
  const defaultRepos = [
    "alecjacobson/common-3d-test-models@master",
    "mrdoob/three.js@dev:examples/models/",
    "KhronosGroup/glTF-Sample-Assets@main:Models/",
    "KhronosGroup/glTF-Sample-Models@main:2.0/",
    "google/draco@main:testdata/",
    "google/model-viewer@master",
    "assimp/assimp@master:test/models/",
    "ephtracy/voxel-model@master:vox/",
    "mikelovesrobots/mmmm@master:vox/",
  ];
  const specs = optStr("github-repos", defaultRepos.join(","))
    .split(",")
    .map((spec) => spec.trim())
    .filter(Boolean)
    .map(parseRepoSpec);
  const out = [];
  for (const spec of specs) {
    const source = `${spec.owner}/${spec.repo}@${spec.branch}`;
    const api = `https://api.github.com/repos/${spec.owner}/${spec.repo}/git/trees/${spec.branch}?recursive=1`;
    try {
      const json = await fetchJson(api);
      const files = (json.tree ?? [])
        .filter((entry) =>
          entry.type === "blob"
          && (!spec.prefix || entry.path.startsWith(spec.prefix))
          && /\.(obj|glb|gltf|vox)$/i.test(entry.path)
          && entry.size > 0
          && entry.size <= maxBytes
        )
        .map((entry) => ({
          source,
          sourcePath: entry.path,
          ext: extname(entry.path).slice(1).toLowerCase(),
          size: entry.size,
          url: `https://raw.githubusercontent.com/${spec.owner}/${spec.repo}/${spec.branch}/${entry.path}`,
          baseUrl: `https://raw.githubusercontent.com/${spec.owner}/${spec.repo}/${spec.branch}/${entry.path}`,
        }));
      out.push(...files);
      console.log(`listed github ${source}: +${files.length}, queue=${out.length}`);
    } catch (error) {
      failedDownloads.push({
        source,
        sourcePath: spec.prefix || ".",
        stage: "list",
        error: error instanceof Error ? error.message : String(error),
      });
      bumpSource(source, "failedDownloads");
    }
  }
  return stableShuffle(out, 0xc017);
}

function selectPolyhavenGltf(assetId, files) {
  const variants = [];
  for (const [resolution, formats] of Object.entries(files.gltf ?? {})) {
    const gltf = formats?.gltf;
    if (!gltf?.url) continue;
    const includeUrls = {};
    let size = gltf.size ?? 0;
    for (const [uri, include] of Object.entries(gltf.include ?? {})) {
      if (!uri.toLowerCase().endsWith(".bin") || !include?.url) continue;
      includeUrls[uri] = include.url;
      size += include.size ?? 0;
    }
    variants.push({
      resolution,
      size,
      url: gltf.url,
      includeUrls,
    });
  }
  return variants
    .filter((variant) => variant.size > 0 && variant.size <= maxBytes)
    .sort((a, b) => a.size - b.size || a.resolution.localeCompare(b.resolution))[0] ?? null;
}

async function listPolyhaven() {
  const limit = Math.max(1, optNum("polyhaven-limit", 250));
  const source = "polyhaven@models";
  const out = [];
  try {
    const assets = await fetchJson("https://api.polyhaven.com/assets?t=models");
    const ids = stableShuffle(Object.keys(assets), 0x9017).slice(0, limit);
    for (const assetId of ids) {
      if (out.length >= maxModels * 2) break;
      try {
        const files = await fetchJson(`https://api.polyhaven.com/files/${encodeURIComponent(assetId)}`);
        const selected = selectPolyhavenGltf(assetId, files);
        if (!selected) continue;
        out.push({
          source,
          sourcePath: `${assetId}/${selected.resolution}`,
          ext: "gltf",
          size: selected.size,
          url: selected.url,
          baseUrl: selected.url,
          includeUrls: selected.includeUrls,
        });
      } catch (error) {
        failedDownloads.push({
          source,
          sourcePath: assetId,
          stage: "list",
          error: error instanceof Error ? error.message : String(error),
        });
        bumpSource(source, "failedDownloads");
      }
    }
    console.log(`listed polyhaven models: +${out.length}, inspected=${ids.length}`);
  } catch (error) {
    failedDownloads.push({
      source,
      sourcePath: ".",
      stage: "list",
      error: error instanceof Error ? error.message : String(error),
    });
    bumpSource(source, "failedDownloads");
  }
  return stableShuffle(out, 0x9a11);
}

function walkLocal(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walkLocal(full));
      continue;
    }
    const ext = extname(entry.name).slice(1).toLowerCase();
    if (ext === "obj" || ext === "glb" || ext === "gltf" || ext === "vox") out.push(full);
  }
  return out;
}

function listLocal() {
  const rootArg = optStr("local-root", "");
  if (!rootArg) return [];
  const root = resolve(repoRoot, rootArg);
  const files = walkLocal(root)
    .map((file) => ({
      source: `local:${root}`,
      sourcePath: relative(root, file),
      ext: extname(file).slice(1).toLowerCase(),
      size: readFileSync(file).byteLength,
      url: file,
      baseUrl: file,
    }))
    .filter((item) => item.size <= maxBytes);
  console.log(`listed local ${root}: +${files.length}`);
  return stableShuffle(files, 0x10ca1);
}

async function downloadItem(item) {
  if (item.source.startsWith("local:")) {
    return item.ext === "obj" || item.ext === "gltf" ? readFileSync(item.url, "utf8") : readFileSync(item.url);
  }
  return item.ext === "obj" || item.ext === "gltf" ? fetchText(item.url) : fetchBytes(item.url);
}

async function loadExternalGltfBuffers(item, text) {
  const doc = JSON.parse(text);
  const buffers = new Map();
  const expectedBytes = (doc.buffers ?? [])
    .filter((buffer) => buffer.uri && !buffer.uri.startsWith("data:"))
    .reduce((sum, buffer) => sum + (buffer.byteLength ?? 0), textEncoder.encode(text).byteLength);
  if (expectedBytes > maxBytes) {
    throw new Error(`external glTF buffers exceed --max-bytes (${expectedBytes} > ${maxBytes})`);
  }
  for (const buffer of doc.buffers ?? []) {
    const uri = buffer.uri;
    if (!uri || uri.startsWith("data:")) continue;
    if (item.source.startsWith("local:")) {
      buffers.set(uri, new Uint8Array(readFileSync(resolve(dirname(item.url), uri))));
      continue;
    }
    const url = item.includeUrls?.[uri] ?? new URL(uri, item.baseUrl ?? item.url).href;
    buffers.set(uri, await fetchBytes(url));
  }
  return buffers;
}

async function prepareItem(item) {
  const data = await downloadItem(item);
  if (item.ext !== "gltf") return { data, keepData: data, parseOptions: undefined, externalBuffers: new Map() };
  const externalBuffers = await loadExternalGltfBuffers(item, data);
  return {
    data: textEncoder.encode(data),
    keepData: data,
    externalBuffers,
    parseOptions: {
      baseUrl: item.baseUrl ?? item.url,
      resolveBuffer: (uri) => {
        const bytes = externalBuffers.get(uri);
        if (!bytes) throw new Error(`compat-hunter: missing prefetched glTF buffer ${uri}`);
        return bytes;
      },
    },
  };
}

function parseItem(item, prepared) {
  if (item.ext === "obj") return parseObj(prepared.data);
  if (item.ext === "vox") return parseVox(toArrayBuffer(prepared.data));
  return parseGltf(prepared.data, prepared.parseOptions);
}

function keepPathFor(item, testedIndex, root) {
  return join(root, `${String(testedIndex).padStart(5, "0")}-${item.sourcePath.replace(/[^A-Za-z0-9._-]+/g, "-")}`);
}

function writeKeptItem(item, testedIndex, root, prepared) {
  const keptPath = keepPathFor(item, testedIndex, root);
  if (item.ext !== "gltf") {
    writeFileSync(keptPath, prepared.keepData);
    return keptPath;
  }
  mkdirSync(keptPath, { recursive: true });
  writeFileSync(join(keptPath, "model.gltf"), prepared.keepData);
  const buffersDir = join(keptPath, "buffers");
  mkdirSync(buffersDir, { recursive: true });
  const buffers = [];
  for (const [uri, bytes] of prepared.externalBuffers.entries()) {
    const fileName = uri.replace(/[^A-Za-z0-9._-]+/g, "-");
    writeFileSync(join(buffersDir, fileName), bytes);
    buffers.push({ uri, fileName, bytes: bytes.byteLength });
  }
  writeFileSync(join(keptPath, "external-buffers.json"), `${JSON.stringify(buffers, null, 2)}\n`);
  return keptPath;
}

async function handleItem(item, testedIndex) {
  const started = performance.now();
  let prepared;
  try {
    prepared = await prepareItem(item);
  } catch (error) {
    failedDownloads.push(rowForItem(item, testedIndex, {
      stage: "download",
      error: error instanceof Error ? error.message : String(error),
      ms: Math.round((performance.now() - started) * 100) / 100,
    }));
    bumpSource(item.source, "failedDownloads");
    return;
  }

  try {
    const parsedResult = parseItem(item, prepared);
    const ms = Math.round((performance.now() - started) * 100) / 100;
    const classification = classify(parsedResult, item.ext);
    const warnings = parsedResult.warnings ?? [];
    const row = rowForItem(item, testedIndex, {
      kind: classification.kind,
      polygonCount: parsedResult.polygons.length,
      warningCount: warnings.length,
      warnings,
      triangleCount: parsedResult.metadata?.triangleCount,
      unknownWarnings: classification.unknownWarnings,
      ms,
    });
    parsed++;
    bumpSource(item.source, "parsed");
    totalPolygons += parsedResult.polygons.length;
    bumpSource(item.source, "totalPolygons", parsedResult.polygons.length);
    parsedResult.dispose?.();

    if (classification.kind === "clean") {
      cleanCount++;
      bumpSource(item.source, "clean");
      if (cleanSamples.length < 25 || testedIndex % progressEvery === 0) {
        cleanSamples.push({
          testedIndex,
          source: item.source,
          sourcePath: item.sourcePath,
          polygonCount: row.polygonCount,
          ms,
        });
      }
      return;
    }

    if (classification.kind === "known-warning" || classification.kind === "known-zero") {
      knownCount++;
      bumpSource(item.source, "known");
      for (const warning of warnings) bump(knownWarningCounts, warning);
      if (keepKnown) {
        const keptPath = writeKeptItem(item, testedIndex, knownRoot, prepared);
        row.keptPath = keptPath;
      }
      knownSamples.push(row);
      return;
    }

    const keptPath = writeKeptItem(item, testedIndex, interestingRoot, prepared);
    interesting.push({ ...row, keptPath });
    bumpSource(item.source, "interesting");
    console.log(`FOUND ${classification.kind} at ${testedIndex}: ${item.source} ${item.sourcePath}`);
    if (stopOnInteresting) stop = true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const knownError = isKnownError(message);
    if (knownError) {
      knownCount++;
      bumpSource(item.source, "known");
      bump(knownErrorCounts, message);
      const row = rowForItem(item, testedIndex, {
        kind: "known-error",
        error: message,
        ms: Math.round((performance.now() - started) * 100) / 100,
      });
      if (keepKnown) row.keptPath = writeKeptItem(item, testedIndex, knownRoot, prepared);
      knownSamples.push(row);
      return;
    }
    bump(failureCounts, message);
    const keptPath = writeKeptItem(item, testedIndex, interestingRoot, prepared);
    interesting.push(rowForItem(item, testedIndex, {
      kind: "throw",
      error: message,
      keptPath,
      ms: Math.round((performance.now() - started) * 100) / 100,
    }));
    bumpSource(item.source, "interesting");
    console.log(`FOUND throw at ${testedIndex}: ${item.source} ${item.sourcePath}: ${message}`);
    if (stopOnInteresting) stop = true;
  }
}

async function buildQueue() {
  const chunks = [];
  if (sources.includes("objaverse")) chunks.push(await listObjaverse());
  if (sources.includes("github")) chunks.push(await listGithub());
  if (sources.includes("polyhaven")) chunks.push(await listPolyhaven());
  if (sources.includes("local")) chunks.push(listLocal());
  return stableShuffle(chunks.flat(), 0x705e);
}

const queue = await buildQueue();
for (const item of queue) bumpSource(item.source, "queued");
if (queue.length === 0) {
  writeReport(true);
  throw new Error("compat-hunter: no OBJ/GLB/glTF/VOX candidates were listed");
}

async function worker() {
  while (!stop) {
    if (attempted >= maxModels) return;
    const item = queue[nextQueueIndex++];
    if (!item) return;
    const testedIndex = ++attempted;
    bumpSource(item.source, "attempted");
    await handleItem(item, testedIndex);
    if (progressEvery > 0 && (attempted % progressEvery === 0 || stop)) {
      console.log(
        `attempted=${attempted} parsed=${parsed} clean=${cleanCount} known=${knownCount} `
        + `interesting=${interesting.length} failedDownloads=${failedDownloads.length}`,
      );
      writeReport(stop);
    }
  }
}

writeReport(false);
await Promise.all(Array.from({ length: concurrency }, () => worker()));
writeReport(true);
console.log(JSON.stringify({
  reportPath,
  attempted,
  parsed,
  clean: cleanCount,
  known: knownCount,
  interesting: interesting.length,
  failedDownloads: failedDownloads.length,
  totalPolygons,
}, null, 2));
