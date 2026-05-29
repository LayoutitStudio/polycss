#!/usr/bin/env node
/**
 * Deep corpus report for meshResolution="lossy".
 *
 * This is a count/quality bench, not a browser FPS bench. It scans gallery
 * GLB/GLTF/OBJ assets, compares lossless/current lossy output, and records
 * current-path timing and crack diagnostics.
 *
 * Usage:
 *   node bench/lossy-corpus-bench.mjs
 *   node bench/lossy-corpus-bench.mjs --models adventurer,snail
 *   node bench/lossy-corpus-bench.mjs --json bench/results/lossy-corpus.json
 *   node bench/lossy-corpus-bench.mjs --from-json bench/results/lossy-corpus.json --opportunities
 *   node bench/lossy-corpus-bench.mjs --from-json after.json --compare before.json
 *   node bench/lossy-corpus-bench.mjs --root /tmp/polycss-model-corpus --json /tmp/corpus.json
 */
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { performance } from "node:perf_hooks";
import {
  bakeSolidTextureSamples,
  optimizeAnimatedMeshPolygons,
  optimizeMeshPolygons,
  parseGltf,
  parseMtl,
  parseObj,
} from "../packages/core/dist/index.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const galleryRoot = resolve(repoRoot, "website/public/gallery");
const glbRoot = join(galleryRoot, "glb");
const objRoot = join(galleryRoot, "obj");
const requireFromWebsite = createRequire(resolve(repoRoot, "website/package.json"));

const argv = process.argv.slice(2);
const flag = (name) => argv.indexOf(`--${name}`);
const hasFlag = (name) => flag(name) >= 0;
const optStr = (name, dflt = "") => {
  const index = flag(name);
  return index >= 0 ? argv[index + 1] : dflt;
};

if (hasFlag("help")) {
  console.log(`Usage: node bench/lossy-corpus-bench.mjs [--models filter] [--json file]
       node bench/lossy-corpus-bench.mjs --from-json file [--opportunities] [--compare baseline]

Options:
  --models <list>       Comma-separated case-insensitive substrings to include.
  --models-file <file>  Newline-separated model paths or substrings to include.
  --root <dir>          Scan GLB/GLTF/OBJ files under a temporary corpus root.
  --json <file>         Write full summary + rows as JSON.
  --from-json <file>    Read an existing corpus JSON instead of scanning models.
  --compare <file>      Compare this run/JSON against a prior corpus JSON.
  --opportunities       Print ranked lossy opportunity and timing tables.
  --quick               Only compute raw/lossless/current stats and current timings.
  --limit <n>           Number of rows to print for opportunity/compare tables.
  --file-offset <n>     Skip the first n selected files before scanning.
  --file-limit <n>      Scan at most n selected files.
  --timeout-ms <n>      Kill and record a model row if it exceeds n ms.
  --progress <n>        Print progress to stderr every n scanned files.
`);
  process.exit(0);
}

const PRINT_LIMIT = Number(optStr("limit", "12")) || 12;
const FILE_OFFSET = Math.max(0, Number(optStr("file-offset", "0")) || 0);
const FILE_LIMIT = Math.max(0, Number(optStr("file-limit", "0")) || 0);
const PROGRESS_EVERY = Math.max(0, Number(optStr("progress", "0")) || 0);
const MODEL_TIMEOUT_MS = Math.max(0, Number(optStr("timeout-ms", optStr("timeout", "0"))) || 0);
const QUICK_MODE = hasFlag("quick");
const sourceRoot = optStr("root") ? resolve(repoRoot, optStr("root")) : galleryRoot;
const LOSSY_CRACK_DIAGNOSTIC_BOUNDARY = 0.04;
const CRACK_SEARCH_MULTIPLIER = 2.6;

function walk(dir, exts) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(path, exts));
    else if (exts.has(extname(entry.name).toLowerCase())) out.push(path);
  }
  return out.sort((a, b) => a.localeCompare(b));
}

function selectedFiles() {
  const exts = new Set([".glb", ".gltf", ".obj"]);
  const files = optStr("root")
    ? walk(sourceRoot, exts)
    : [
        ...walk(glbRoot, new Set([".glb", ".gltf"])),
        ...walk(objRoot, new Set([".obj"])),
      ];
  const needles = selectedModelNeedles();
  if (needles.length === 0) return sliceSelectedFiles(files);
  const filtered = files.filter((file) => {
    const label = relative(sourceRoot, file).toLowerCase();
    return needles.some((needle) => label.includes(needle));
  });
  return sliceSelectedFiles(filtered);
}

function selectedModelNeedles() {
  const needles = [];
  const filter = optStr("models").trim();
  if (filter) {
    needles.push(...filter.split(",").map((value) => value.trim().toLowerCase()).filter(Boolean));
  }
  const modelsFile = optStr("models-file").trim();
  if (modelsFile) {
    const file = resolve(repoRoot, modelsFile);
    const lines = readFileSync(file, "utf8")
      .split(/\r?\n/)
      .map((line) => line.replace(/#.*$/, "").trim().toLowerCase())
      .filter(Boolean);
    needles.push(...lines);
  }
  return needles;
}

function sliceSelectedFiles(files) {
  const start = Math.min(FILE_OFFSET, files.length);
  const end = FILE_LIMIT > 0 ? Math.min(files.length, start + FILE_LIMIT) : files.length;
  return files.slice(start, end);
}

function readBytes(path) {
  const bytes = readFileSync(path);
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

let textureSamplingReady = false;
let textureSamplingUnavailable = false;

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

async function readImageBytes(url) {
  if (/^(blob:|data:|https?:)/.test(url)) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`image fetch failed: ${response.status}`);
    return Buffer.from(await response.arrayBuffer());
  }
  return readFileSync(url.startsWith("file://") ? fileURLToPath(url) : url);
}

async function applyGalleryTexturePrepass(result) {
  if (!installTextureSamplingEnv()) return result;
  return bakeSolidTextureSamples(result);
}

function inferObjTextureOverrides(modelPath) {
  const overrides = {};
  if (modelPath.includes("/quaternius/ultimate-spaceships/")) {
    const dir = dirname(modelPath);
    const texture = readdirSync(dir).find((name) =>
      /\.(png|jpe?g)$/i.test(name) && !/normal|rough|metal|ao/i.test(name)
    );
    if (texture) overrides.Texture = join(dir, texture);
  }
  return overrides;
}

async function parseModel(modelPath) {
  const ext = extname(modelPath).toLowerCase();
  if (ext === ".glb" || ext === ".gltf") {
    return applyGalleryTexturePrepass(parseGltf(readBytes(modelPath), {
      baseUrl: pathToFileURL(modelPath).href,
      resolveBuffer: (uri) => readFileSync(resolve(dirname(modelPath), uri)),
    }));
  }

  if (ext === ".obj") {
    const text = readFileSync(modelPath, "utf8");
    const mtlPath = modelPath.replace(/\.obj$/i, ".mtl");
    const materialColors = {};
    const materialTextures = inferObjTextureOverrides(modelPath);
    if (existsSync(mtlPath)) {
      const mtl = parseMtl(readFileSync(mtlPath, "utf8"));
      Object.assign(materialColors, mtl.colors);
      for (const [name, texture] of Object.entries(mtl.textures)) {
        materialTextures[name] = resolve(dirname(mtlPath), texture);
      }
    }
    return applyGalleryTexturePrepass(parseObj(text, {
      targetSize: /coliseum\.obj$/.test(modelPath) ? 80 : 60,
      defaultColor: "#8b95a1",
      materialColors,
      materialTextures,
    }));
  }

  throw new Error(`Unsupported model: ${modelPath}`);
}

function polygonRenderCost(polygons) {
  let cost = 0;
  for (const polygon of polygons) {
    const vertexCount = polygon.vertices.length;
    const irregularPenalty = vertexCount <= 4 ? 0 : Math.min(4, vertexCount - 4) * 0.12;
    const texturePenalty = polygon.texture || polygon.material?.texture || polygon.textureTriangles?.length ? 0.15 : 0;
    cost += 1 + irregularPenalty + texturePenalty;
  }
  return cost;
}

function polygonStats(polygons) {
  let triangles = 0;
  let quads = 0;
  let textured = 0;
  let maxVertices = 0;
  for (const polygon of polygons) {
    if (polygon.vertices.length === 3) triangles += 1;
    else if (polygon.vertices.length === 4) quads += 1;
    if (polygon.texture || polygon.material?.texture || polygon.uvs || polygon.textureTriangles?.length) textured += 1;
    maxVertices = Math.max(maxVertices, polygon.vertices.length);
  }
  return {
    count: polygons.length,
    cost: Number(polygonRenderCost(polygons).toFixed(2)),
    triangles,
    quads,
    textured,
    maxVertices,
  };
}

function vertexKey(vertex) {
  return `${vertex[0]},${vertex[1]},${vertex[2]}`;
}

function edgeKey(a, b) {
  const ak = vertexKey(a);
  const bk = vertexKey(b);
  return ak < bk ? `${ak}|${bk}` : `${bk}|${ak}`;
}

function distanceVec(a, b) {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

function subVec(a, b) {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function dotVec(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function makeSegment(key, a, b, index = -1) {
  const delta = subVec(b, a);
  const length = Math.hypot(delta[0], delta[1], delta[2]);
  if (length <= 1e-10) return null;
  return {
    index,
    key,
    a,
    b,
    length,
    dir: [delta[0] / length, delta[1] / length, delta[2] / length],
    minX: Math.min(a[0], b[0]),
    minY: Math.min(a[1], b[1]),
    minZ: Math.min(a[2], b[2]),
    maxX: Math.max(a[0], b[0]),
    maxY: Math.max(a[1], b[1]),
    maxZ: Math.max(a[2], b[2]),
  };
}

function collectEdgeStats(polygons) {
  const edges = new Map();
  for (const polygon of polygons) {
    for (let i = 0; i < polygon.vertices.length; i++) {
      const a = polygon.vertices[i];
      const b = polygon.vertices[(i + 1) % polygon.vertices.length];
      const key = edgeKey(a, b);
      const current = edges.get(key);
      if (current) current.count += 1;
      else {
        const segment = makeSegment(key, a, b);
        if (segment) edges.set(key, { count: 1, segment });
      }
    }
  }

  const boundaryKeys = new Set();
  const internalKeys = new Set();
  const boundarySegments = [];
  const internalSegments = [];
  let boundaryLength = 0;
  let index = 0;
  for (const [key, edge] of edges) {
    const segment = { ...edge.segment, index };
    index += 1;
    if (edge.count === 1) {
      boundaryKeys.add(key);
      boundarySegments.push(segment);
      boundaryLength += distanceVec(segment.a, segment.b);
    } else {
      internalKeys.add(key);
      internalSegments.push(segment);
    }
  }
  return { boundaryKeys, internalKeys, boundarySegments, internalSegments, boundaryLength };
}

function modelDiagonal(polygons) {
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  for (const polygon of polygons) {
    for (const [x, y, z] of polygon.vertices) {
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      minZ = Math.min(minZ, z);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      maxZ = Math.max(maxZ, z);
    }
  }
  return Number.isFinite(minX) ? Math.hypot(maxX - minX, maxY - minY, maxZ - minZ) : 0;
}

function segmentCell(segment, cellSize) {
  return [
    Math.floor(((segment.a[0] + segment.b[0]) / 2) / cellSize),
    Math.floor(((segment.a[1] + segment.b[1]) / 2) / cellSize),
    Math.floor(((segment.a[2] + segment.b[2]) / 2) / cellSize),
  ];
}

function cellKey(x, y, z) {
  return `${x},${y},${z}`;
}

function buildSegmentIndex(segments, tolerance) {
  const cellSize = Math.max(tolerance * 8, 0.5);
  const cells = new Map();
  for (const segment of segments) {
    addSegmentToCells(cells, segment, cellSize, tolerance);
  }
  return { cellSize, cells };
}

function addSegmentToCells(cells, segment, cellSize, padding) {
  const [minX, minY, minZ] = cellCoords(
    [segment.minX - padding, segment.minY - padding, segment.minZ - padding],
    cellSize,
  );
  const [maxX, maxY, maxZ] = cellCoords(
    [segment.maxX + padding, segment.maxY + padding, segment.maxZ + padding],
    cellSize,
  );
  for (let x = minX; x <= maxX; x++) {
    for (let y = minY; y <= maxY; y++) {
      for (let z = minZ; z <= maxZ; z++) {
        const key = cellKey(x, y, z);
        const bucket = cells.get(key);
        if (bucket) bucket.push(segment);
        else cells.set(key, [segment]);
      }
    }
  }
}

function cellCoords(point, cellSize) {
  return [
    Math.floor(point[0] / cellSize),
    Math.floor(point[1] / cellSize),
    Math.floor(point[2] / cellSize),
  ];
}

function indexedSegmentCandidates(segment, index, tolerance) {
  const out = [];
  const seen = new Set();
  const [minX, minY, minZ] = cellCoords(
    [segment.minX - tolerance, segment.minY - tolerance, segment.minZ - tolerance],
    index.cellSize,
  );
  const [maxX, maxY, maxZ] = cellCoords(
    [segment.maxX + tolerance, segment.maxY + tolerance, segment.maxZ + tolerance],
    index.cellSize,
  );
  for (let x = minX; x <= maxX; x++) {
    for (let y = minY; y <= maxY; y++) {
      for (let z = minZ; z <= maxZ; z++) {
        const bucket = index.cells.get(cellKey(x, y, z));
        if (!bucket) continue;
        for (const candidate of bucket) {
          if (seen.has(candidate)) continue;
          seen.add(candidate);
          out.push(candidate);
        }
      }
    }
  }
  return out;
}

function segmentBoundsOverlap(a, b, tolerance) {
  return a.minX <= b.maxX + tolerance &&
    b.minX <= a.maxX + tolerance &&
    a.minY <= b.maxY + tolerance &&
    b.minY <= a.maxY + tolerance &&
    a.minZ <= b.maxZ + tolerance &&
    b.minZ <= a.maxZ + tolerance;
}

function overlappingSegmentInfo(a, b, tolerance) {
  if (!segmentBoundsOverlap(a, b, tolerance)) return null;
  if (Math.abs(dotVec(a.dir, b.dir)) < 0.999) return null;
  const bStart = dotVec(subVec(b.a, a.a), a.dir);
  const bEnd = dotVec(subVec(b.b, a.a), a.dir);
  const overlapStart = Math.max(0, Math.min(bStart, bEnd));
  const overlapEnd = Math.min(a.length, Math.max(bStart, bEnd));
  const overlapLength = overlapEnd - overlapStart;
  if (overlapLength <= Math.max(1e-5, Math.min(a.length, b.length) * 1e-4)) return null;

  const midT = (overlapStart + overlapEnd) / 2;
  const mid = [
    a.a[0] + a.dir[0] * midT,
    a.a[1] + a.dir[1] * midT,
    a.a[2] + a.dir[2] * midT,
  ];
  const projected = Math.max(0, Math.min(b.length, dotVec(subVec(mid, b.a), b.dir)));
  const closest = [
    b.a[0] + b.dir[0] * projected,
    b.a[1] + b.dir[1] * projected,
    b.a[2] + b.dir[2] * projected,
  ];
  const gap = distanceVec(mid, closest);
  return gap <= tolerance ? { gap, overlapLength } : null;
}

function indexedInternalEdgeGap(segment, index, tolerance) {
  let best = null;
  for (const candidate of indexedSegmentCandidates(segment, index, tolerance)) {
    const overlap = overlappingSegmentInfo(segment, candidate, tolerance);
    if (!overlap) continue;
    if (
      best === null ||
      overlap.overlapLength > best.overlapLength ||
      (overlap.overlapLength === best.overlapLength && overlap.gap < best.gap)
    ) {
      best = overlap;
    }
  }
  return best;
}

function boundaryTJunctionMetrics(boundarySegments, tolerance) {
  const index = buildSegmentIndex(boundarySegments, tolerance);
  const seenPairs = new Set();
  let pairs = 0;
  let length = 0;
  for (const segment of boundarySegments) {
    for (const candidate of indexedSegmentCandidates(segment, index, tolerance)) {
      if (candidate === segment || candidate.key === segment.key) continue;
      const pairKey = segment.index < candidate.index
        ? `${segment.index}:${candidate.index}`
        : `${candidate.index}:${segment.index}`;
      if (seenPairs.has(pairKey)) continue;
      seenPairs.add(pairKey);
      const overlap = overlappingSegmentInfo(segment, candidate, tolerance);
      if (!overlap) continue;
      pairs += 1;
      length += overlap.overlapLength;
    }
  }
  return { pairs, length };
}

function crackTolerances(polygons, maxBoundaryDisplacement = LOSSY_CRACK_DIAGNOSTIC_BOUNDARY) {
  const diagonal = modelDiagonal(polygons);
  const baseTolerance = diagonal > 0 ? Math.min(0.08, Math.max(0.001, diagonal * 0.001)) : 0;
  const tolerance = Math.max(baseTolerance, maxBoundaryDisplacement * 1.05);
  const searchTolerance = Math.max(tolerance, baseTolerance * CRACK_SEARCH_MULTIPLIER, maxBoundaryDisplacement * CRACK_SEARCH_MULTIPLIER);
  return { baseTolerance, tolerance, searchTolerance };
}

function crackMetrics(sourcePolygons, candidatePolygons, maxBoundaryDisplacement = LOSSY_CRACK_DIAGNOSTIC_BOUNDARY) {
  const sourceEdges = collectEdgeStats(sourcePolygons);
  const candidateEdges = collectEdgeStats(candidatePolygons);
  const { baseTolerance, tolerance, searchTolerance } = crackTolerances(sourcePolygons, maxBoundaryDisplacement);
  const index = buildSegmentIndex(sourceEdges.internalSegments, searchTolerance);
  const metrics = {
    maxGap: 0,
    internalBoundaryLength: 0,
    exactInternal: 0,
    nearInternalLength: 0,
    excessBoundaryLength: Math.max(0, candidateEdges.boundaryLength - sourceEdges.boundaryLength),
    baseTolerance,
    tolerance,
    searchTolerance,
    nearInternal: 0,
    over04: 0,
    over08: 0,
    over12: 0,
    tJunctionPairs: 0,
    tJunctionLength: 0,
  };

  for (const edge of candidateEdges.boundarySegments) {
    const key = edgeKey(edge.a, edge.b);
    if (sourceEdges.boundaryKeys.has(key)) continue;
    if (sourceEdges.internalKeys.has(key)) {
      metrics.exactInternal += 1;
      metrics.nearInternal += 1;
      metrics.internalBoundaryLength += edge.length;
      continue;
    }
    const overlap = indexedInternalEdgeGap(edge, index, searchTolerance);
    if (overlap === null) continue;
    metrics.nearInternal += 1;
    metrics.maxGap = Math.max(metrics.maxGap, overlap.gap);
    metrics.internalBoundaryLength += overlap.overlapLength;
    metrics.nearInternalLength += overlap.overlapLength;
    if (overlap.gap > 0.04) metrics.over04 += 1;
    if (overlap.gap > 0.08) metrics.over08 += 1;
    if (overlap.gap > 0.12) metrics.over12 += 1;
  }

  const tJunctions = boundaryTJunctionMetrics(candidateEdges.boundarySegments, searchTolerance);
  metrics.tJunctionPairs = tJunctions.pairs;
  metrics.tJunctionLength = tJunctions.length;
  return metrics;
}

function compactCrackMetrics(metrics) {
  return {
    maxGap: Number(metrics.maxGap.toFixed(6)),
    internalBoundaryLength: Number(metrics.internalBoundaryLength.toFixed(2)),
    exactInternal: metrics.exactInternal,
    nearInternalLength: Number(metrics.nearInternalLength.toFixed(2)),
    excessBoundaryLength: Number(metrics.excessBoundaryLength.toFixed(2)),
    baseTolerance: Number(metrics.baseTolerance.toFixed(6)),
    tolerance: Number(metrics.tolerance.toFixed(6)),
    searchTolerance: Number(metrics.searchTolerance.toFixed(6)),
    nearInternal: metrics.nearInternal,
    over04: metrics.over04,
    over08: metrics.over08,
    over12: metrics.over12,
    tJunctionPairs: metrics.tJunctionPairs,
    tJunctionLength: Number(metrics.tJunctionLength.toFixed(2)),
  };
}

function crackDelta(current, reference) {
  return {
    maxGap: Number((current.maxGap - reference.maxGap).toFixed(6)),
    internalBoundaryLength: Number((current.internalBoundaryLength - reference.internalBoundaryLength).toFixed(2)),
    exactInternal: current.exactInternal - reference.exactInternal,
    nearInternalLength: Number((current.nearInternalLength - reference.nearInternalLength).toFixed(2)),
    excessBoundaryLength: Number((current.excessBoundaryLength - reference.excessBoundaryLength).toFixed(2)),
    nearInternal: current.nearInternal - reference.nearInternal,
    over04: current.over04 - reference.over04,
    over08: current.over08 - reference.over08,
    over12: current.over12 - reference.over12,
    tJunctionPairs: current.tJunctionPairs - reference.tJunctionPairs,
    tJunctionLength: Number((current.tJunctionLength - reference.tJunctionLength).toFixed(2)),
  };
}

function crackReport(_sourcePolygons, losslessPolygons, currentPolygons) {
  const lossless = compactCrackMetrics(crackMetrics(losslessPolygons, losslessPolygons));
  const current = compactCrackMetrics(crackMetrics(losslessPolygons, currentPolygons));
  return {
    lossless,
    current,
    delta: crackDelta(current, lossless),
  };
}

function pctDrop(after, before) {
  return before > 0 ? ((before - after) / before) * 100 : 0;
}

function timed(fn) {
  const started = performance.now();
  const value = fn();
  return {
    value,
    ms: Number((performance.now() - started).toFixed(1)),
  };
}

async function summarizeModel(modelPath) {
  const label = relative(sourceRoot, modelPath);
  const started = performance.now();
  const parseStarted = performance.now();
  const parsed = await parseModel(modelPath);
  const parseMs = Number((performance.now() - parseStarted).toFixed(1));
  const raw = parsed.polygons;
  const losslessRun = timed(() => optimizeMeshPolygons(raw, { meshResolution: "lossless" }));
  const currentRun = timed(() => optimizeMeshPolygons(raw, { meshResolution: "lossy" }));
  const lossless = losslessRun.value;
  const current = currentRun.value;
  const rawStats = polygonStats(raw);
  const losslessStats = polygonStats(lossless);
  const currentStats = polygonStats(current);
  const cracks = QUICK_MODE ? null : crackReport(raw, lossless, current);
  if (QUICK_MODE) {
    const currentDropPct = pctDrop(currentStats.cost, losslessStats.cost);
    return {
      model: label,
      ext: extname(modelPath).slice(1).toLowerCase(),
      raw: rawStats,
      lossless: losslessStats,
      current: currentStats,
      currentDropPct: Number(currentDropPct.toFixed(1)),
      cracks: null,
      classification: currentStats.cost < losslessStats.cost
        ? "auto-gain"
        : "no-observed-geometry-potential",
      animated: null,
      timings: {
        parseMs,
        losslessMs: losslessRun.ms,
        currentMs: currentRun.ms,
        animatedMs: 0,
        totalMs: Number((performance.now() - started).toFixed(1)),
      },
    };
  }

  let animated = null;
  let animatedMs = 0;
  if (parsed.animation?.clips?.length) {
    const run = timed(() => optimizeAnimatedMeshPolygons(parsed, { meshResolution: "lossy" }));
    animatedMs = run.ms;
    const optimized = run.value;
    const stats = polygonStats(optimized.polygons);
    animated = {
      clips: parsed.animation.clips.length,
      count: stats.count,
      dropPct: Number(pctDrop(stats.cost, rawStats.cost).toFixed(1)),
    };
  }

  const currentDropPct = pctDrop(currentStats.cost, losslessStats.cost);
  const classification = currentStats.cost < losslessStats.cost
    ? "auto-gain"
    : "no-observed-geometry-potential";

  return {
    model: label,
    ext: extname(modelPath).slice(1).toLowerCase(),
    raw: rawStats,
    lossless: losslessStats,
    current: currentStats,
    currentDropPct: Number(currentDropPct.toFixed(1)),
    cracks,
    classification,
    animated,
    timings: {
      parseMs,
      losslessMs: losslessRun.ms,
      currentMs: currentRun.ms,
      animatedMs,
      totalMs: Number((performance.now() - started).toFixed(1)),
    },
  };
}

async function summarizeSingleModelAndExit() {
  const singleModelPath = optStr("single-model");
  if (!singleModelPath) return false;
  const row = await summarizeModel(resolve(repoRoot, singleModelPath));
  process.stdout.write(`${JSON.stringify(row)}\n`);
  return true;
}

function summarizeModelInWorker(modelPath) {
  if (MODEL_TIMEOUT_MS <= 0) return null;
  const args = [
    fileURLToPath(import.meta.url),
    "--single-model",
    modelPath,
  ];
  if (optStr("root")) args.push("--root", sourceRoot);
  if (QUICK_MODE) args.push("--quick");

  const result = spawnSync(process.execPath, args, {
    cwd: repoRoot,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    timeout: MODEL_TIMEOUT_MS,
  });

  if (result.error) {
    if (result.error.code === "ETIMEDOUT") {
      throw new Error(`timeout after ${MODEL_TIMEOUT_MS}ms`);
    }
    throw result.error;
  }
  if (result.status !== 0) {
    const message = (result.stderr || result.stdout || `worker exited with status ${result.status}`).trim();
    throw new Error(message);
  }
  return JSON.parse(result.stdout);
}

function summarizeRows(rows, errors, elapsedMs) {
  const byClass = {};
  for (const row of rows) byClass[row.classification] = (byClass[row.classification] ?? 0) + 1;
  const total = (field) => rows.reduce((sum, row) => sum + (row[field]?.count ?? 0), 0);
  const crackRows = rows.filter((row) => row.cracks);
  return {
    scanned: rows.length,
    errors: errors.length,
    elapsedMs: Number(elapsedMs.toFixed(1)),
    byClass,
    aggregate: {
      raw: total("raw"),
      lossless: total("lossless"),
      current: total("current"),
    },
    cracks: crackRows.length > 0
      ? {
          measured: crackRows.length,
          maxCurrentGap: Math.max(...crackRows.map((row) => row.cracks.current.maxGap)),
          maxCurrentInternalBoundaryLength: Math.max(...crackRows.map((row) => row.cracks.current.internalBoundaryLength)),
          totalCurrentInternalBoundaryLength: Number(crackRows.reduce((sum, row) => sum + row.cracks.current.internalBoundaryLength, 0).toFixed(2)),
          totalInternalBoundaryDelta: Number(crackRows.reduce((sum, row) => sum + row.cracks.delta.internalBoundaryLength, 0).toFixed(2)),
          totalExactInternalDelta: crackRows.reduce((sum, row) => sum + row.cracks.delta.exactInternal, 0),
          totalOver04Delta: crackRows.reduce((sum, row) => sum + row.cracks.delta.over04, 0),
          totalOver08Delta: crackRows.reduce((sum, row) => sum + row.cracks.delta.over08, 0),
          totalTJunctionPairs: crackRows.reduce((sum, row) => sum + row.cracks.current.tJunctionPairs, 0),
          totalTJunctionLength: Number(crackRows.reduce((sum, row) => sum + row.cracks.current.tJunctionLength, 0).toFixed(2)),
          totalTJunctionPairDelta: crackRows.reduce((sum, row) => sum + row.cracks.delta.tJunctionPairs, 0),
          totalTJunctionLengthDelta: Number(crackRows.reduce((sum, row) => sum + row.cracks.delta.tJunctionLength, 0).toFixed(2)),
        }
      : null,
  };
}

function readCorpusJson(path) {
  return JSON.parse(readFileSync(resolve(repoRoot, path), "utf8"));
}

function totalCost(rows, field) {
  return Number(rows.reduce((sum, row) => sum + (row[field]?.cost ?? 0), 0).toFixed(2));
}

function totalTiming(rows, field) {
  return Number(rows.reduce((sum, row) => sum + (row.timings?.[field] ?? 0), 0).toFixed(1));
}

function printCorpusSummary(output) {
  const { summary } = output;
  console.log("lossy corpus benchmark");
  console.log(`models=${summary.scanned} errors=${summary.errors} elapsedMs=${summary.elapsedMs}`);
  console.log(`classes=${JSON.stringify(summary.byClass)}`);
  console.log(`aggregate raw=${summary.aggregate.raw} lossless=${summary.aggregate.lossless} current=${summary.aggregate.current}`);
  if (summary.cracks) {
    console.log(`cracks measured=${summary.cracks.measured} maxGap=${summary.cracks.maxCurrentGap} totalInternal=${summary.cracks.totalCurrentInternalBoundaryLength} deltaInternal=${summary.cracks.totalInternalBoundaryDelta} deltaExactInternal=${summary.cracks.totalExactInternalDelta} deltaOver04=${summary.cracks.totalOver04Delta} deltaOver08=${summary.cracks.totalOver08Delta} tJunctionPairs=${summary.cracks.totalTJunctionPairs} tJunctionDelta=${summary.cracks.totalTJunctionPairDelta} tJunctionLengthDelta=${summary.cracks.totalTJunctionLengthDelta}`);
  }
  if (output.rows?.length) {
    console.log(`costs lossless=${totalCost(output.rows, "lossless")} current=${totalCost(output.rows, "current")}`);
    if (output.rows.some((row) => row.timings)) {
      console.log(`timings currentMs=${totalTiming(output.rows, "currentMs")}`);
    }
  }
}

function printOpportunityReport(output, limit = PRINT_LIMIT) {
  console.log("");
  console.log("opportunity report");
  const crackRows = [...output.rows]
    .filter((row) => row.cracks)
    .sort((a, b) =>
      b.cracks.delta.internalBoundaryLength - a.cracks.delta.internalBoundaryLength ||
      b.cracks.current.maxGap - a.cracks.current.maxGap
    );
  if (crackRows.length > 0) {
    console.log("");
    console.log("largest current crack deltas");
    for (const row of crackRows.slice(0, limit)) {
      console.log(`${row.model}: maxGap=${row.cracks.current.maxGap} losslessInternalDelta=${row.cracks.delta.internalBoundaryLength} exactInternalDelta=${row.cracks.delta.exactInternal} tJunctionDelta=${row.cracks.delta.tJunctionPairs} over04Delta=${row.cracks.delta.over04} current=${row.current.count} lossless=${row.lossless.count}`);
    }
  }

  const timingRows = [...output.rows]
    .filter((row) => row.timings)
    .sort((a, b) => (b.timings.currentMs ?? 0) - (a.timings.currentMs ?? 0));
  if (timingRows.length > 0) {
    console.log("");
    console.log("slow current optimizer rows");
    for (const row of timingRows.slice(0, limit)) {
      console.log(`${row.model}: currentMs=${row.timings.currentMs} current=${row.current.count} lossless=${row.lossless.count}`);
    }
  }
}

function printCompareReport(current, baseline, limit = PRINT_LIMIT) {
  const baselineRows = new Map(baseline.rows.map((row) => [row.model, row]));
  const deltas = [];
  for (const row of current.rows) {
    const before = baselineRows.get(row.model);
    if (!before) continue;
    deltas.push({
      model: row.model,
      currentCostDelta: Number((row.current.cost - before.current.cost).toFixed(2)),
      currentCountDelta: row.current.count - before.current.count,
      currentMsDelta: row.timings?.currentMs !== undefined && before.timings?.currentMs !== undefined
        ? Number((row.timings.currentMs - before.timings.currentMs).toFixed(1))
        : null,
      internalBoundaryDelta: row.cracks && before.cracks
        ? Number((row.cracks.current.internalBoundaryLength - before.cracks.current.internalBoundaryLength).toFixed(2))
        : null,
      exactInternalDelta: row.cracks && before.cracks
        ? row.cracks.current.exactInternal - before.cracks.current.exactInternal
        : null,
      tJunctionPairDelta: row.cracks && before.cracks
        ? row.cracks.current.tJunctionPairs - before.cracks.current.tJunctionPairs
        : null,
      tJunctionLengthDelta: row.cracks && before.cracks
        ? Number((row.cracks.current.tJunctionLength - before.cracks.current.tJunctionLength).toFixed(2))
        : null,
      beforeClass: before.classification,
      afterClass: row.classification,
      beforeCost: before.current.cost,
      afterCost: row.current.cost,
    });
  }
  const totalCostDelta = Number(deltas.reduce((sum, row) => sum + row.currentCostDelta, 0).toFixed(2));
  const totalCountDelta = deltas.reduce((sum, row) => sum + row.currentCountDelta, 0);
  const timingDeltas = deltas.filter((row) => row.currentMsDelta !== null);
  const totalMsDelta = Number(timingDeltas.reduce((sum, row) => sum + row.currentMsDelta, 0).toFixed(1));
  const gapDeltas = deltas.filter((row) => row.internalBoundaryDelta !== null);
  const totalInternalBoundaryDelta = Number(gapDeltas.reduce((sum, row) => sum + row.internalBoundaryDelta, 0).toFixed(2));
  const totalExactInternalDelta = gapDeltas.reduce((sum, row) => sum + row.exactInternalDelta, 0);
  const totalTJunctionPairDelta = gapDeltas.reduce((sum, row) => sum + row.tJunctionPairDelta, 0);
  const totalTJunctionLengthDelta = Number(gapDeltas.reduce((sum, row) => sum + row.tJunctionLengthDelta, 0).toFixed(2));
  console.log("");
  console.log("compare report");
  console.log(`matched=${deltas.length} currentCostDelta=${totalCostDelta} currentCountDelta=${totalCountDelta} currentMsDelta=${timingDeltas.length > 0 ? totalMsDelta : "n/a"}`);
  if (gapDeltas.length > 0) {
    console.log(`gapDeltas internalBoundary=${totalInternalBoundaryDelta} exactInternal=${totalExactInternalDelta} tJunctionPairs=${totalTJunctionPairDelta} tJunctionLength=${totalTJunctionLengthDelta}`);
  }

  const improved = [...deltas].filter((row) => row.currentCostDelta < 0).sort((a, b) => a.currentCostDelta - b.currentCostDelta);
  const regressed = [...deltas].filter((row) => row.currentCostDelta > 0).sort((a, b) => b.currentCostDelta - a.currentCostDelta);
  const slower = [...timingDeltas].filter((row) => row.currentMsDelta > 0).sort((a, b) => b.currentMsDelta - a.currentMsDelta);
  const gapRegressions = [...gapDeltas]
    .filter((row) =>
      row.internalBoundaryDelta > 0 ||
      row.exactInternalDelta > 0 ||
      row.tJunctionPairDelta > 0 ||
      row.tJunctionLengthDelta > 0
    )
    .sort((a, b) =>
      b.internalBoundaryDelta - a.internalBoundaryDelta ||
      b.tJunctionPairDelta - a.tJunctionPairDelta ||
      b.exactInternalDelta - a.exactInternalDelta
    );
  const classChanges = deltas.filter((row) => row.beforeClass !== row.afterClass);
  const printRows = (title, rows, format) => {
    if (rows.length === 0) return;
    console.log("");
    console.log(title);
    for (const row of rows.slice(0, limit)) console.log(format(row));
  };
  printRows("largest improvements", improved, (row) =>
    `${row.model}: ${row.beforeCost}->${row.afterCost} delta=${row.currentCostDelta}`
  );
  printRows("largest regressions", regressed, (row) =>
    `${row.model}: ${row.beforeCost}->${row.afterCost} delta=+${row.currentCostDelta}`
  );
  printRows("largest currentMs increases", slower, (row) =>
    `${row.model}: currentMsDelta=+${row.currentMsDelta} costDelta=${row.currentCostDelta}`
  );
  printRows("largest gap metric regressions", gapRegressions, (row) =>
    `${row.model}: internalBoundaryDelta=${row.internalBoundaryDelta} exactInternalDelta=${row.exactInternalDelta} tJunctionPairDelta=${row.tJunctionPairDelta} tJunctionLengthDelta=${row.tJunctionLengthDelta} costDelta=${row.currentCostDelta}`
  );
  printRows("classification changes", classChanges, (row) =>
    `${row.model}: ${row.beforeClass}->${row.afterClass} costDelta=${row.currentCostDelta}`
  );
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
      rows.push(summarizeModelInWorker(file) ?? await summarizeModel(file));
    } catch (error) {
      errors.push({
        model: relative(sourceRoot, file),
        error: error instanceof Error ? error.message : String(error),
        ...(error instanceof Error && /^timeout after \d+ms$/.test(error.message)
          ? { timeoutMs: MODEL_TIMEOUT_MS }
          : {}),
      });
    }
    if (PROGRESS_EVERY > 0 && (scanned % PROGRESS_EVERY === 0 || scanned === files.length)) {
      const elapsedMs = Number((performance.now() - started).toFixed(1));
      console.error(`lossy-corpus progress ${scanned}/${files.length} rows=${rows.length} errors=${errors.length} elapsedMs=${elapsedMs}`);
    }
  }

  return {
    summary: summarizeRows(rows, errors, performance.now() - started),
    rows,
    errors,
    options: {
      quick: QUICK_MODE,
      models: optStr("models").trim() || null,
      root: optStr("root") ? sourceRoot : null,
      fileOffset: FILE_OFFSET,
      fileLimit: FILE_LIMIT || null,
      timeoutMs: MODEL_TIMEOUT_MS || null,
    },
  };
}

const fromJson = optStr("from-json");
if (await summarizeSingleModelAndExit()) process.exit(0);
const output = fromJson ? readCorpusJson(fromJson) : await runCorpus();

printCorpusSummary(output);
if (hasFlag("opportunities")) printOpportunityReport(output);

const comparePath = optStr("compare");
if (comparePath) printCompareReport(output, readCorpusJson(comparePath));

const jsonPath = optStr("json");
if (jsonPath && !fromJson) {
  const outputPath = resolve(repoRoot, jsonPath);
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`);
  console.log(`wrote ${jsonPath}`);
}
