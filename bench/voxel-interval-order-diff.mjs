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

const DEFAULT_TARGETS = [
  "garden:t|br|fr",
  "treasure:t|br|fr",
  "ancient-crash-site:t|bl|br",
  "obj-house3:t|br|fr",
];

const args = parseArgs(process.argv.slice(2));
const targets = args.targets.length ? args.targets : DEFAULT_TARGETS;
const outLabel = args.label ?? "a92-interval-order-diff";
const maxOverlapItems = Number(args.maxOverlapItems ?? 1800);

function parseArgs(argv) {
  const out = { targets: [] };
  for (const arg of argv) {
    if (arg.startsWith("--targets=")) {
      out.targets.push(...arg.slice("--targets=".length).split(",").map((value) => value.trim()).filter(Boolean));
    } else if (arg.startsWith("--label=")) out.label = arg.slice("--label=".length);
    else if (arg.startsWith("--max-overlap-items=")) out.maxOverlapItems = arg.slice("--max-overlap-items=".length);
    else if (!arg.startsWith("--")) out.targets.push(arg);
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

function signatureRanges(signature) {
  const ranges = [];
  let current = null;
  for (let halfStep = 0; halfStep < 720; halfStep += 1) {
    const rotY = halfStep * 0.5;
    if (visibleFaceSignature({ rotX: 65, rotY }) === signature) {
      if (!current) current = { start: rotY, end: rotY, count: 0 };
      current.end = rotY;
      current.count += 1;
    } else if (current) {
      ranges.push(current);
      current = null;
    }
  }
  if (current) ranges.push(current);
  return ranges.sort((a, b) => b.count - a.count);
}

function representativeInterval(signature) {
  const range = signatureRanges(signature)[0];
  if (!range) throw new Error(`No camera interval for signature ${signature}`);
  return {
    start: { rotX: 65, rotY: range.start },
    midpoint: { rotX: 65, rotY: (range.start + range.end) / 2 },
    end: { rotX: 65, rotY: range.end },
  };
}

function intervalCenterRotation(rotation, signature) {
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
  const offset = (matches[start] + matches[end]) / 2;
  return { ...rotation, rotY: rotation.rotY + offset };
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
    projectedArea: Math.max(0, Math.max(...points.map((point) => point.x)) - Math.min(...points.map((point) => point.x))) *
      Math.max(0, Math.max(...points.map((point) => point.y)) - Math.min(...points.map((point) => point.y))),
    localArea: Math.abs(item.width * item.height),
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

function adaptiveScreenOrder(visible, rotation, signature) {
  const centered = intervalCenterRotation(rotation, signature);
  const currentProjected = visible.map((item) => projectedBounds(item, rotation));
  const centeredProjected = visible.map((item) => projectedBounds(item, centered));
  const currentBounds = sceneBounds(currentProjected);
  const centeredBounds = sceneBounds(centeredProjected);
  const tile3Scores = visible.map((item) => Math.max(
    tileSpanScore(item, rotation, currentBounds, 3),
    tileSpanScore(item, centered, centeredBounds, 3),
  ));
  const tileCount = (quantile(tile3Scores, 0.95) ?? 0) > 1 ? 5 : 3;
  const baselineSlots = tileOrder(visible, rotation, tileCount);
  const phaseOrder = tileOrder(visible, centered, tileCount);
  const scoreBySource = new Map();
  visible.forEach((item, index) => scoreBySource.set(item.sourceIndex, tile3Scores[index] ?? 0));
  const isAnchor = (item) => (scoreBySource.get(item.sourceIndex) ?? 0) > 1;
  const movablePhase = phaseOrder.filter((item) => !isAnchor(item));
  let next = 0;
  return {
    order: baselineSlots.map((item) => {
      if (isAnchor(item)) return item;
      return movablePhase[next++] ?? item;
    }),
    tileCount,
    centeredRotY: centered.rotY,
    anchoredCount: visible.filter(isAnchor).length,
    scoreBySource,
  };
}

function sampleItemsByProjectedArea(items, rotation, maxItems) {
  if (!Number.isFinite(maxItems) || maxItems <= 0 || items.length <= maxItems) return items;
  return items
    .map((item) => ({ item, area: projectedBounds(item, rotation).projectedArea }))
    .sort((a, b) => b.area - a.area || a.item.sourceIndex - b.item.sourceIndex)
    .slice(0, maxItems)
    .map((entry) => entry.item)
    .sort((a, b) => a.sourceIndex - b.sourceIndex);
}

function facePairKey(a, b) {
  return FACE_ORDER.indexOf(a) <= FACE_ORDER.indexOf(b) ? `${a}/${b}` : `${b}/${a}`;
}

function signForPair(pair, ranks) {
  const a = ranks.get(pair.a.item.sourceIndex);
  const b = ranks.get(pair.b.item.sourceIndex);
  if (!Number.isFinite(a) || !Number.isFinite(b) || a === b) return 0;
  return a < b ? -1 : 1;
}

function addMetric(map, key, value) {
  map.set(key, (map.get(key) ?? 0) + value);
}

function changedOverlapDiff(items, rotation, baselineRanks, candidateRanks, candidateScoreBySource) {
  const sampled = sampleItemsByProjectedArea(items, rotation, maxOverlapItems);
  const projected = sampled
    .map((item) => ({ item, ...projectedBounds(item, rotation) }))
    .sort((a, b) => a.minX - b.minX);
  const active = [];
  const pairArea = new Map();
  const changedPairArea = new Map();
  const changedDepthArea = new Map();
  const itemChangedArea = new Map();
  let pairs = 0;
  let changedPairs = 0;
  let overlapArea = 0;
  let changedArea = 0;

  for (const current of projected) {
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
      const key = facePairKey(current.item.face, other.item.face);
      addMetric(pairArea, key, area);

      const pair = { a: current, b: other };
      const baseSign = signForPair(pair, baselineRanks);
      const candidateSign = signForPair(pair, candidateRanks);
      if (baseSign === candidateSign || candidateSign === 0 || baseSign === 0) continue;

      changedPairs += 1;
      changedArea += area;
      addMetric(changedPairArea, key, area);
      const depthKey = Math.abs(current.depth - other.depth) < 1e-6
        ? "same-depth"
        : candidateSign < 0 === current.depth < other.depth
          ? "candidate-low-depth-first"
          : "candidate-high-depth-first";
      addMetric(changedDepthArea, depthKey, area);
      addChangedItem(itemChangedArea, current.item, area, baselineRanks, candidateRanks, candidateScoreBySource);
      addChangedItem(itemChangedArea, other.item, area, baselineRanks, candidateRanks, candidateScoreBySource);
    }
    active.push(current);
  }

  return {
    sampledLeaves: sampled.length,
    pairs,
    changedPairs,
    overlapArea,
    changedArea,
    changedPairRate: pairs ? changedPairs / pairs : 0,
    changedAreaRate: overlapArea ? changedArea / overlapArea : 0,
    topPairAreas: topEntries(pairArea, overlapArea, 8),
    topChangedPairAreas: topEntries(changedPairArea, changedArea, 8),
    changedDepthAreas: topEntries(changedDepthArea, changedArea, 4),
    topChangedItems: [...itemChangedArea.values()]
      .sort((a, b) => b.changedArea - a.changedArea)
      .slice(0, 10),
  };
}

function addChangedItem(map, item, area, baselineRanks, candidateRanks, candidateScoreBySource) {
  const entry = map.get(item.sourceIndex) ?? {
    sourceIndex: item.sourceIndex,
    face: item.face,
    primitive: Math.max(item.width, item.height),
    localArea: item.width * item.height,
    baselineRank: baselineRanks.get(item.sourceIndex),
    candidateRank: candidateRanks.get(item.sourceIndex),
    movedDistance: Math.abs((candidateRanks.get(item.sourceIndex) ?? 0) - (baselineRanks.get(item.sourceIndex) ?? 0)),
    tile3SpanScore: candidateScoreBySource.get(item.sourceIndex) ?? 0,
    changedArea: 0,
  };
  entry.changedArea += area;
  map.set(item.sourceIndex, entry);
}

function topEntries(map, denominator, count) {
  return [...map.entries()]
    .map(([key, value]) => ({
      key,
      value,
      rate: denominator ? value / denominator : 0,
    }))
    .sort((a, b) => b.value - a.value)
    .slice(0, count);
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

function movedSummary(visible, baselineRanks, candidateRanks) {
  const byFace = new Map();
  const distances = [];
  for (const item of visible) {
    const baselineRank = baselineRanks.get(item.sourceIndex);
    const candidateRank = candidateRanks.get(item.sourceIndex);
    if (!Number.isFinite(baselineRank) || !Number.isFinite(candidateRank)) continue;
    const distance = Math.abs(candidateRank - baselineRank);
    if (distance === 0) continue;
    distances.push(distance);
    const current = byFace.get(item.face) ?? { face: item.face, count: 0, totalDistance: 0 };
    current.count += 1;
    current.totalDistance += distance;
    byFace.set(item.face, current);
  }
  return {
    movedCount: distances.length,
    movedRate: visible.length ? distances.length / visible.length : 0,
    movedDistanceP50: quantile(distances, 0.5) ?? 0,
    movedDistanceP95: quantile(distances, 0.95) ?? 0,
    movedByFace: [...byFace.values()]
      .map((entry) => ({
        ...entry,
        averageDistance: entry.count ? entry.totalDistance / entry.count : 0,
      }))
      .sort((a, b) => b.count - a.count),
  };
}

function analyzeTarget(target) {
  const splitAt = target.indexOf(":");
  if (splitAt < 0) throw new Error(`Target must be model:signature, got ${target}`);
  return {
    model: target.slice(0, splitAt),
    signature: target.slice(splitAt + 1),
  };
}

async function analyze({ model, signature }) {
  const items = await loadItems(model);
  const visible = visibleItems(items, signature);
  const interval = representativeInterval(signature);
  const orderRotation = interval.start;
  const overlapRotation = interval.midpoint;
  const baselineOrder = tileOrder(visible, orderRotation, 4);
  const candidate = adaptiveScreenOrder(visible, orderRotation, signature);
  const baselineRanks = ranksForOrder(baselineOrder);
  const candidateRanks = ranksForOrder(candidate.order);
  const moved = movedSummary(visible, baselineRanks, candidateRanks);
  const changed = changedOverlapDiff(visible, overlapRotation, baselineRanks, candidateRanks, candidate.scoreBySource);
  return {
    model,
    signature,
    orderRotation,
    overlapRotation,
    visibleLeaves: visible.length,
    candidateTileCount: candidate.tileCount,
    candidateCenteredRotY: candidate.centeredRotY,
    candidateAnchoredCount: candidate.anchoredCount,
    candidateAnchoredRate: visible.length ? candidate.anchoredCount / visible.length : 0,
    ...moved,
    changedOverlap: changed,
  };
}

function renderMarkdown(rows) {
  const lines = [];
  lines.push("# Voxel Interval Order Diff");
  lines.push("");
  lines.push("Baseline: current tile4 row-major order. Candidate: adaptive screen-span phase order from A85/A87.");
  lines.push("Orders are computed at the interval entry boundary; overlap contribution is measured at the interval midpoint.");
  lines.push(`Max overlap items: ${maxOverlapItems}`);
  lines.push("");
  lines.push("| Model | Signature | RotY | Leaves | Cand tiles | Anchored % | Moved % | Moved p95 | Changed overlap % | Top changed pairs |");
  lines.push("| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |");
  for (const row of rows) {
    lines.push([
      `| ${row.model}`,
      row.signature,
      fmt(row.orderRotation.rotY, 1),
      row.visibleLeaves,
      row.candidateTileCount,
      fmt(row.candidateAnchoredRate * 100, 1),
      fmt(row.movedRate * 100, 1),
      fmt(row.movedDistanceP95, 0),
      fmt(row.changedOverlap.changedAreaRate * 100, 1),
      `${row.changedOverlap.topChangedPairAreas.slice(0, 3).map((entry) => `${entry.key} ${fmt(entry.rate * 100, 0)}%`).join(", ")} |`,
    ].join(" | "));
  }

  for (const row of rows) {
    lines.push("");
    lines.push(`## ${row.model} ${row.signature}`);
    lines.push("");
    lines.push(`Order rotation: rotX=${fmt(row.orderRotation.rotX, 1)}, rotY=${fmt(row.orderRotation.rotY, 1)}; overlap rotation: rotY=${fmt(row.overlapRotation.rotY, 1)}; candidate centered rotY=${fmt(row.candidateCenteredRotY, 1)}.`);
    lines.push("");
    lines.push("Moved by face:");
    lines.push("");
    lines.push("| Face | Count | Avg distance |");
    lines.push("| --- | ---: | ---: |");
    for (const face of row.movedByFace) {
      lines.push(`| ${face.face} | ${face.count} | ${fmt(face.averageDistance, 1)} |`);
    }
    lines.push("");
    lines.push("Changed depth area:");
    lines.push("");
    lines.push("| Direction | Area share |");
    lines.push("| --- | ---: |");
    for (const entry of row.changedOverlap.changedDepthAreas) {
      lines.push(`| ${entry.key} | ${fmt(entry.rate * 100, 1)}% |`);
    }
    lines.push("");
    lines.push("Top changed leaves:");
    lines.push("");
    lines.push("| Source | Face | Primitive | Move | Tile span | Changed area |");
    lines.push("| ---: | --- | ---: | ---: | ---: | ---: |");
    for (const item of row.changedOverlap.topChangedItems) {
      lines.push([
        `| ${item.sourceIndex}`,
        item.face,
        fmt(item.primitive, 0),
        fmt(item.movedDistance, 0),
        fmt(item.tile3SpanScore, 2),
        `${fmt(item.changedArea, 0)} |`,
      ].join(" | "));
    }
  }
  return `${lines.join("\n")}\n`;
}

const rows = [];
for (const target of targets.map(analyzeTarget)) {
  console.log(`[order-diff] ${target.model} ${target.signature}`);
  rows.push(await analyze(target));
}

const output = {
  generatedAt: new Date().toISOString(),
  maxOverlapItems,
  targets,
  rows,
};
const jsonPath = join(resultDir, `${outLabel}.json`);
const mdPath = join(resultDir, `${outLabel}.md`);
await writeFile(jsonPath, JSON.stringify(output, null, 2));
await writeFile(mdPath, renderMarkdown(rows));

console.log(`[order-diff] wrote ${jsonPath}`);
console.log(`[order-diff] wrote ${mdPath}`);
console.log(renderMarkdown(rows));
