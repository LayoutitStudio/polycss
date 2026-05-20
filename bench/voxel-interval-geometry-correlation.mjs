#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  BASE_TILE,
  normalFacesCamera,
  parseVox,
  rotateVec3,
} from "../packages/core/dist/index.js";
import { PRESETS } from "./perf-shared.mjs";

const repoRoot = resolve(import.meta.dirname, "..");
const resultDir = resolve(repoRoot, "bench/results");

const FACE_NORMALS = {
  t: [0, 0, 1],
  b: [0, 0, -1],
  fl: [0, 1, 0],
  br: [0, -1, 0],
  fr: [1, 0, 0],
  bl: [-1, 0, 0],
};

const FACE_ORDER = ["t", "b", "bl", "br", "fr", "fl"];
const FACE_BY_NORMAL = new Map([
  ["0,0,1", "t"],
  ["0,0,-1", "b"],
  ["0,1,0", "fl"],
  ["0,-1,0", "br"],
  ["1,0,0", "fr"],
  ["-1,0,0", "bl"],
]);

const DEFAULT_MODELS = [
  "ancient-crash-site",
  "garden",
  "scene-mechanic2",
  "obj-house3",
  "treasure",
];

const args = parseArgs(process.argv.slice(2));
const models = args.models.length ? args.models : DEFAULT_MODELS;
const baselinePrefix = args.baselinePrefix ?? "a87-interval-baseline";
const candidatePrefix = args.candidatePrefix ?? "a87-interval-auto";
const angleStep = Number(args.angleStep ?? 5);
const outLabel = args.label ?? "a88-interval-geometry-correlation";
const maxOverlapItems = Number(args.maxOverlapItems ?? 1200);

function parseArgs(argv) {
  const out = { models: [] };
  for (const arg of argv) {
    if (arg.startsWith("--models=")) {
      out.models.push(...arg.slice("--models=".length).split(",").map((value) => value.trim()).filter(Boolean));
    } else if (arg.startsWith("--baseline-prefix=")) out.baselinePrefix = arg.slice("--baseline-prefix=".length);
    else if (arg.startsWith("--candidate-prefix=")) out.candidatePrefix = arg.slice("--candidate-prefix=".length);
    else if (arg.startsWith("--angle-step=")) out.angleStep = arg.slice("--angle-step=".length);
    else if (arg.startsWith("--label=")) out.label = arg.slice("--label=".length);
    else if (arg.startsWith("--max-overlap-items=")) out.maxOverlapItems = arg.slice("--max-overlap-items=".length);
    else if (!arg.startsWith("--")) out.models.push(arg);
  }
  return out;
}

function quantile(values, q) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const i = (sorted.length - 1) * q;
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
}

function median(values) {
  return quantile(values, 0.5);
}

function fmt(value, digits = 2) {
  return Number.isFinite(value) ? value.toFixed(digits) : "";
}

function visibleFaceSignature(rotation) {
  const visible = [];
  for (const face of FACE_ORDER) {
    if (normalFacesCamera(FACE_NORMALS[face], rotation)) visible.push(face);
  }
  return visible.join("|");
}

function intervalPhase(rotation, signature, fraction = 0.5) {
  const matches = [];
  for (let offset = -180; offset <= 180; offset += 1) {
    const candidate = { ...rotation, rotY: rotation.rotY + offset };
    if (visibleFaceSignature(candidate) === signature) matches.push(offset);
  }
  const zeroIndex = matches.indexOf(0);
  if (zeroIndex < 0) return rotation;
  let start = zeroIndex;
  let end = zeroIndex;
  while (start > 0 && matches[start] - matches[start - 1] === 1) start -= 1;
  while (end + 1 < matches.length && matches[end + 1] - matches[end] === 1) end += 1;
  const offset = matches[start] + (matches[end] - matches[start]) * fraction;
  return { ...rotation, rotY: rotation.rotY + offset };
}

function rotationsForSignature(signature) {
  const rotations = [];
  for (let rotY = 0; rotY < 360; rotY += angleStep) {
    const rotation = { rotX: 65, rotY };
    if (visibleFaceSignature(rotation) === signature) rotations.push(rotation);
  }
  return rotations.length ? rotations : [{ rotX: 65, rotY: 45 }];
}

function cssNormalForPolygon(polygon) {
  const vertices = polygon.vertices;
  if (vertices.length < 3) return null;
  const v0 = vertices[0];
  let nx = 0;
  let ny = 0;
  let nz = 0;
  for (let i = 1; i + 1 < vertices.length; i += 1) {
    const v1 = vertices[i];
    const v2 = vertices[i + 1];
    const e1x = v1[1] - v0[1];
    const e1y = v1[0] - v0[0];
    const e1z = v1[2] - v0[2];
    const e2x = v2[1] - v0[1];
    const e2y = v2[0] - v0[0];
    const e2z = v2[2] - v0[2];
    nx -= e1y * e2z - e1z * e2y;
    ny -= e1z * e2x - e1x * e2z;
    nz -= e1x * e2y - e1y * e2x;
  }
  const len = Math.hypot(nx, ny, nz);
  if (len <= 1e-9) return null;
  return [
    Math.round(nx / len),
    Math.round(ny / len),
    Math.round(nz / len),
  ];
}

function matrixItemForPolygon(polygon, sourceIndex) {
  if (polygon.texture || polygon.material || polygon.uvs || polygon.textureTriangles) return null;
  if (polygon.vertices.length !== 4) return null;
  const normal = cssNormalForPolygon(polygon);
  const face = normal ? FACE_BY_NORMAL.get(normal.join(",")) : undefined;
  if (!face) return null;

  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  for (const v of polygon.vertices) {
    minX = Math.min(minX, v[0]);
    minY = Math.min(minY, v[1]);
    minZ = Math.min(minZ, v[2]);
    maxX = Math.max(maxX, v[0]);
    maxY = Math.max(maxY, v[1]);
    maxZ = Math.max(maxZ, v[2]);
  }

  const base = { face, sourceIndex };
  const eps = 1e-6;
  if (Math.abs(maxZ - minZ) <= eps) {
    return {
      ...base,
      axis: "z",
      left: minY * BASE_TILE,
      top: minX * BASE_TILE,
      width: Math.max(0, (maxY - minY) * BASE_TILE),
      height: Math.max(0, (maxX - minX) * BASE_TILE),
      z: minZ * BASE_TILE,
    };
  }
  if (Math.abs(maxX - minX) <= eps) {
    return {
      ...base,
      axis: "x",
      left: minY * BASE_TILE,
      top: minZ * BASE_TILE,
      width: Math.max(0, (maxY - minY) * BASE_TILE),
      height: Math.max(0, (maxZ - minZ) * BASE_TILE),
      z: -minX * BASE_TILE,
    };
  }
  if (Math.abs(maxY - minY) <= eps) {
    return {
      ...base,
      axis: "y",
      left: minZ * BASE_TILE,
      top: minX * BASE_TILE,
      width: Math.max(0, (maxZ - minZ) * BASE_TILE),
      height: Math.max(0, (maxX - minX) * BASE_TILE),
      z: -minY * BASE_TILE,
    };
  }
  return null;
}

function itemCenter(item) {
  if (item.axis === "x") return [item.left + item.width / 2, -item.z, item.top + item.height / 2];
  if (item.axis === "y") return [-item.z, item.top + item.height / 2, item.left + item.width / 2];
  return [item.left + item.width / 2, item.top + item.height / 2, item.z];
}

function itemCorners(item) {
  if (item.axis === "x") {
    return [
      [item.left, -item.z, item.top],
      [item.left + item.width, -item.z, item.top],
      [item.left + item.width, -item.z, item.top + item.height],
      [item.left, -item.z, item.top + item.height],
    ];
  }
  if (item.axis === "y") {
    return [
      [-item.z, item.top, item.left],
      [-item.z, item.top, item.left + item.width],
      [-item.z, item.top + item.height, item.left + item.width],
      [-item.z, item.top + item.height, item.left],
    ];
  }
  return [
    [item.left, item.top, item.z],
    [item.left + item.width, item.top, item.z],
    [item.left + item.width, item.top + item.height, item.z],
    [item.left, item.top + item.height, item.z],
  ];
}

function projectPoint(point, rotation) {
  const [x, y, z] = rotateVec3(point, rotation.rotX, 0, rotation.rotY);
  return { x, y, z };
}

function projectedPoint(item, rotation) {
  const [x, y] = rotateVec3(itemCenter(item), rotation.rotX, 0, rotation.rotY);
  return { x, y };
}

function projectedBounds(item, rotation) {
  const points = itemCorners(item).map((point) => projectPoint(point, rotation));
  return {
    minX: Math.min(...points.map((point) => point.x)),
    maxX: Math.max(...points.map((point) => point.x)),
    minY: Math.min(...points.map((point) => point.y)),
    maxY: Math.max(...points.map((point) => point.y)),
    depth: points.reduce((sum, point) => sum + point.z, 0) / points.length,
    area: Math.abs(item.width * item.height),
    primitive: Math.max(item.width, item.height),
  };
}

function visibleItems(items, signature) {
  const faces = new Set(signature.split("|").filter(Boolean));
  return items.filter((item) => faces.has(item.face));
}

function sceneBounds(projected) {
  return {
    minX: Math.min(...projected.map((item) => item.minX)),
    maxX: Math.max(...projected.map((item) => item.maxX)),
    minY: Math.min(...projected.map((item) => item.minY)),
    maxY: Math.max(...projected.map((item) => item.maxY)),
  };
}

function tileSpanScore(item, rotation, bounds, tileCount) {
  const projected = projectedBounds(item, rotation);
  const tileW = Math.max(1e-6, (bounds.maxX - bounds.minX) / tileCount);
  const tileH = Math.max(1e-6, (bounds.maxY - bounds.minY) / tileCount);
  return Math.max(
    (projected.maxX - projected.minX) / tileW,
    (projected.maxY - projected.minY) / tileH,
  );
}

function tileOrder(items, orderRotation, tileCount) {
  const entries = items.map((item) => ({ item, ...projectedPoint(item, orderRotation) }));
  if (entries.length === 0) return [];
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const entry of entries) {
    minX = Math.min(minX, entry.x);
    maxX = Math.max(maxX, entry.x);
    minY = Math.min(minY, entry.y);
    maxY = Math.max(maxY, entry.y);
  }
  const spanX = Math.max(1e-6, maxX - minX);
  const spanY = Math.max(1e-6, maxY - minY);
  const tiles = new Map();
  for (const entry of entries) {
    const tx = Math.min(tileCount - 1, Math.max(0, Math.floor(((entry.x - minX) / spanX) * tileCount)));
    const ty = Math.min(tileCount - 1, Math.max(0, Math.floor(((entry.y - minY) / spanY) * tileCount)));
    const key = `${tx}:${ty}`;
    let tile = tiles.get(key);
    if (!tile) {
      tile = { tx, ty, sourceIndex: entry.item.sourceIndex, items: [] };
      tiles.set(key, tile);
    }
    tile.items.push(entry.item);
    tile.sourceIndex = Math.min(tile.sourceIndex, entry.item.sourceIndex);
  }
  return [...tiles.values()]
    .sort((a, b) => (a.ty - b.ty) || (a.tx - b.tx) || a.sourceIndex - b.sourceIndex)
    .flatMap((tile) => tile.items);
}

function ranksForOrder(ordered) {
  const ranks = new Map();
  ordered.forEach((item, index) => ranks.set(item.sourceIndex, index));
  return ranks;
}

function overlapSummary(items, rotation, baselineRanks, candidateRanks) {
  const sampledItems = sampleItems(items, maxOverlapItems);
  const projected = sampledItems.map((item) => ({ item, ...projectedBounds(item, rotation) }));
  const sorted = projected
    .map((entry, index) => ({ ...entry, index }))
    .sort((a, b) => a.minX - b.minX);
  const active = [];
  let pairs = 0;
  let overlapArea = 0;
  let changedPairs = 0;
  let changedArea = 0;
  let sameFacePairs = 0;
  let sameFaceArea = 0;
  const pairAreas = new Map();
  const changedPairAreas = new Map();
  for (const current of sorted) {
    for (let i = active.length - 1; i >= 0; i -= 1) {
      if (active[i].maxX <= current.minX) active.splice(i, 1);
    }
    for (const other of active) {
      if (other.maxY <= current.minY || other.minY >= current.maxY) continue;
      const x0 = Math.max(current.minX, other.minX);
      const x1 = Math.min(current.maxX, other.maxX);
      const y0 = Math.max(current.minY, other.minY);
      const y1 = Math.min(current.maxY, other.maxY);
      if (x1 <= x0 || y1 <= y0) continue;
      const area = (x1 - x0) * (y1 - y0);
      pairs += 1;
      overlapArea += area;
      if (current.item.face === other.item.face) {
        sameFacePairs += 1;
        sameFaceArea += area;
      }
      const pairKey = facePairKey(current.item.face, other.item.face);
      pairAreas.set(pairKey, (pairAreas.get(pairKey) ?? 0) + area);
      const aBase = baselineRanks.get(current.item.sourceIndex);
      const bBase = baselineRanks.get(other.item.sourceIndex);
      const aCand = candidateRanks.get(current.item.sourceIndex);
      const bCand = candidateRanks.get(other.item.sourceIndex);
      if (
        Number.isFinite(aBase) &&
        Number.isFinite(bBase) &&
        Number.isFinite(aCand) &&
        Number.isFinite(bCand) &&
        Math.sign(aBase - bBase) !== Math.sign(aCand - bCand)
      ) {
        changedPairs += 1;
        changedArea += area;
        changedPairAreas.set(pairKey, (changedPairAreas.get(pairKey) ?? 0) + area);
      }
    }
    active.push(current);
  }
  return {
    pairs,
    sampledLeaves: sampledItems.length,
    overlapArea,
    overlapPairsPerLeaf: sampledItems.length ? pairs / sampledItems.length : 0,
    changedPairRate: pairs ? changedPairs / pairs : 0,
    changedAreaRate: overlapArea ? changedArea / overlapArea : 0,
    sameFacePairRate: pairs ? sameFacePairs / pairs : 0,
    sameFaceAreaRate: overlapArea ? sameFaceArea / overlapArea : 0,
    topOverlapPair: topPair(pairAreas, overlapArea),
    topChangedPair: topPair(changedPairAreas, changedArea),
  };
}

function facePairKey(a, b) {
  return FACE_ORDER.indexOf(a) <= FACE_ORDER.indexOf(b) ? `${a}/${b}` : `${b}/${a}`;
}

function topPair(map, totalArea) {
  let bestPair = "";
  let bestArea = 0;
  for (const [pair, area] of map) {
    if (area > bestArea) {
      bestPair = pair;
      bestArea = area;
    }
  }
  return {
    pair: bestPair,
    areaRate: totalArea ? bestArea / totalArea : 0,
  };
}

function sampleItems(items, maxItems) {
  if (!Number.isFinite(maxItems) || maxItems <= 0 || items.length <= maxItems) return items;
  const sampled = [];
  const stride = items.length / maxItems;
  for (let i = 0; i < maxItems; i += 1) {
    sampled.push(items[Math.floor(i * stride)]);
  }
  return sampled;
}

function summarizeValues(values) {
  return {
    median: median(values),
    p95: quantile(values, 0.95),
    p99: quantile(values, 0.99),
    max: values.length ? Math.max(...values) : null,
  };
}

function mergeRows(rows) {
  const numberKeys = Object.keys(rows[0] ?? {}).filter((key) => typeof rows[0][key] === "number");
  const merged = {};
  for (const key of numberKeys) merged[key] = median(rows.map((row) => row[key]));
  const pairKeys = ["topOverlapPair", "topChangedPair"];
  for (const key of pairKeys) merged[key] = mostCommonPair(rows.map((row) => row[key]));
  return merged;
}

function mostCommonPair(pairs) {
  const counts = new Map();
  for (const pair of pairs) {
    if (!pair?.pair) continue;
    const current = counts.get(pair.pair) ?? { pair: pair.pair, count: 0, rates: [] };
    current.count += 1;
    current.rates.push(pair.areaRate);
    counts.set(pair.pair, current);
  }
  const best = [...counts.values()].sort((a, b) => b.count - a.count || (median(b.rates) ?? 0) - (median(a.rates) ?? 0))[0];
  return best ? { pair: best.pair, areaRate: median(best.rates) ?? 0 } : { pair: "", areaRate: 0 };
}

async function loadItems(model) {
  const preset = PRESETS[model];
  if (!preset) throw new Error(`Unknown preset ${model}`);
  const path = resolve(repoRoot, "website/public", preset.url.replace(/^\/gallery\//, "gallery/"));
  const bytes = await readFile(path);
  const parsed = parseVox(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    preset.options,
  );
  return parsed.polygons
    .map((polygon, sourceIndex) => matrixItemForPolygon(polygon, sourceIndex))
    .filter((item) => item && item.width > 0 && item.height > 0);
}

function readProfilerRun(prefix, model) {
  return readFile(join(resultDir, `${prefix}-${model}.json`), "utf8")
    .then((text) => JSON.parse(text).runs[0]);
}

function signatureMap(run) {
  const map = new Map();
  for (const row of run.signatures) map.set(row.signature, row);
  return map;
}

function intervalDelta(baseline, candidate, signature) {
  const base = signatureMap(baseline).get(signature);
  const cand = signatureMap(candidate).get(signature);
  if (!base || !cand || base.frames < 16 || cand.frames < 16) return null;
  return {
    signature,
    baseFrames: base.frames,
    candidateFrames: cand.frames,
    baseP95: base.fps_p95,
    candidateP95: cand.fps_p95,
    deltaP95: cand.fps_p95 - base.fps_p95,
    baseP99: base.frame_time_p99_ms,
    candidateP99: cand.frame_time_p99_ms,
    deltaP99: cand.frame_time_p99_ms - base.frame_time_p99_ms,
    baseX4: base.buckets.x4_plus,
    candidateX4: cand.buckets.x4_plus,
  };
}

function analyzeSignature(items, signature) {
  const visible = visibleItems(items, signature);
  const rows = [];
  for (const rotation of rotationsForSignature(signature)) {
    const centered = intervalPhase(rotation, signature, 0.5);
    const projected = visible.map((item) => projectedBounds(item, rotation));
    const centeredProjected = visible.map((item) => projectedBounds(item, centered));
    const bounds = sceneBounds(projected);
    const centeredBounds = sceneBounds(centeredProjected);
    const screenArea = Math.max(1e-6, (bounds.maxX - bounds.minX) * (bounds.maxY - bounds.minY));
    const projectedAreas = projected.map((item) => Math.max(0, item.maxX - item.minX) * Math.max(0, item.maxY - item.minY));
    const tile3Scores = visible.map((item) => Math.max(
      tileSpanScore(item, rotation, bounds, 3),
      tileSpanScore(item, centered, centeredBounds, 3),
    ));
    const tile5Scores = visible.map((item) => Math.max(
      tileSpanScore(item, rotation, bounds, 5),
      tileSpanScore(item, centered, centeredBounds, 5),
    ));
    const localPrimitives = visible.map((item) => Math.max(item.width, item.height));
    const baselineOrder = tileOrder(visible, rotation, 4);
    const candidateTileCount = quantile(tile3Scores, 0.95) > 1 ? 5 : 3;
    const candidateOrder = tileOrder(visible, centered, candidateTileCount);
    const overlap = overlapSummary(
      visible,
      rotation,
      ranksForOrder(baselineOrder),
      ranksForOrder(candidateOrder),
    );
    const faceCounts = Object.fromEntries(FACE_ORDER.map((face) => [face, visible.filter((item) => item.face === face).length]));
    rows.push({
      leaves: visible.length,
      topShare: visible.length ? faceCounts.t / visible.length : 0,
      sideBalance: visible.length
        ? Math.max(faceCounts.fl, faceCounts.br, faceCounts.fr, faceCounts.bl) / visible.length
        : 0,
      projectedAreaOverScreen: projectedAreas.reduce((sum, area) => sum + area, 0) / screenArea,
      localPrimitiveP95: quantile(localPrimitives, 0.95) ?? 0,
      localPrimitiveP99: quantile(localPrimitives, 0.99) ?? 0,
      tile3SpanP95: quantile(tile3Scores, 0.95) ?? 0,
      tile3SpanP99: quantile(tile3Scores, 0.99) ?? 0,
      tile3SpanGt1Rate: visible.length ? tile3Scores.filter((score) => score > 1).length / visible.length : 0,
      tile5SpanP95: quantile(tile5Scores, 0.95) ?? 0,
      tile5SpanGt1Rate: visible.length ? tile5Scores.filter((score) => score > 1).length / visible.length : 0,
      candidateTileCount,
      ...overlap,
    });
  }
  return mergeRows(rows);
}

function renderMarkdown(rows) {
  const lines = [];
  lines.push("# Voxel Interval Geometry Correlation");
  lines.push("");
  lines.push(`Baseline prefix: \`${baselinePrefix}\``);
  lines.push(`Candidate prefix: \`${candidatePrefix}\``);
  lines.push(`Angle step: ${angleStep}`);
  lines.push(`Max overlap items: ${maxOverlapItems}`);
  lines.push("");
  lines.push("| Model | Signature | Delta p95 | Delta p99 ms | Leaves | Tile3 span p95 | Tile3 >1 % | Overlap/leaf | Changed overlap % | Top overlap pair | Top changed pair | Area/screen | Top % | Candidate tiles |");
  lines.push("| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- | ---: | ---: | ---: |");
  for (const row of rows) {
    lines.push([
      `| ${row.model}`,
      row.signature,
      fmt(row.deltaP95, 1),
      fmt(row.deltaP99, 1),
      fmt(row.geometry.leaves, 0),
      fmt(row.geometry.tile3SpanP95, 2),
      fmt(row.geometry.tile3SpanGt1Rate * 100, 1),
      fmt(row.geometry.overlapPairsPerLeaf, 2),
      fmt(row.geometry.changedAreaRate * 100, 1),
      `${row.geometry.topOverlapPair?.pair ?? ""} ${fmt((row.geometry.topOverlapPair?.areaRate ?? 0) * 100, 0)}%`,
      `${row.geometry.topChangedPair?.pair ?? ""} ${fmt((row.geometry.topChangedPair?.areaRate ?? 0) * 100, 0)}%`,
      fmt(row.geometry.projectedAreaOverScreen, 2),
      fmt(row.geometry.topShare * 100, 1),
      `${fmt(row.geometry.candidateTileCount, 0)} |`,
    ].join(" | "));
  }
  return `${lines.join("\n")}\n`;
}

const rows = [];
for (const model of models) {
  console.log(`[interval-geometry] ${model}`);
  const items = await loadItems(model);
  const baseline = await readProfilerRun(baselinePrefix, model);
  const candidate = await readProfilerRun(candidatePrefix, model);
  const signatures = new Set([
    ...baseline.signatures.map((row) => row.signature),
    ...candidate.signatures.map((row) => row.signature),
  ]);
  for (const signature of [...signatures].sort()) {
    const delta = intervalDelta(baseline, candidate, signature);
    if (!delta) continue;
    rows.push({
      model,
      ...delta,
      geometry: analyzeSignature(items, signature),
    });
  }
}

const output = {
  generatedAt: new Date().toISOString(),
  baselinePrefix,
  candidatePrefix,
  angleStep,
  rows,
};
const jsonPath = join(resultDir, `${outLabel}.json`);
const mdPath = join(resultDir, `${outLabel}.md`);
await writeFile(jsonPath, JSON.stringify(output, null, 2));
await writeFile(mdPath, renderMarkdown(rows));

console.log(`[interval-geometry] wrote ${jsonPath}`);
console.log(`[interval-geometry] wrote ${mdPath}`);
console.log(renderMarkdown(rows));
