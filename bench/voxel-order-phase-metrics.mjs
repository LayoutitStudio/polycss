#!/usr/bin/env node
import { readFile, readdir, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import {
  BASE_TILE,
  normalFacesCamera,
  parseVox,
  rotateVec3,
} from "../packages/core/dist/index.js";

const repoRoot = resolve(import.meta.dirname, "..");
const galleryVoxDir = resolve(repoRoot, "website/public/gallery/vox");
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
  "Garden.vox",
  "desert2.vox",
  "scene_mechanic2.vox",
  "obj_house3.vox",
  "Treasure.vox",
  "skyscraper.vox",
  "AncientCrashSite.vox",
  "army.vox",
];

const args = parseArgs(process.argv.slice(2));
const angleStep = Number(args.angleStep ?? 5);
const targetSize = Number(args.targetSize ?? 60);
const models = args.models.length ? args.models : DEFAULT_MODELS;

const STRATEGIES = [
  { key: "baseline", label: "Current", phase(rotation, signature) { return rotation; } },
  { key: "offset30", label: "+30deg", phase(rotation) { return { ...rotation, rotY: rotation.rotY + 30 }; } },
  {
    key: "center",
    label: "Centered interval",
    phase(rotation, signature) {
      return intervalPhase(rotation, signature, 0.5);
    },
  },
  {
    key: "frac033",
    label: "Interval 0.33",
    phase(rotation, signature) {
      return intervalPhase(rotation, signature, 0.33);
    },
  },
  {
    key: "frac067",
    label: "Interval 0.67",
    phase(rotation, signature) {
      return intervalPhase(rotation, signature, 0.67);
    },
  },
];

function parseArgs(argv) {
  const out = { models: [], angleStep: null, targetSize: null };
  for (const arg of argv) {
    if (arg.startsWith("--angle-step=")) out.angleStep = arg.slice("--angle-step=".length);
    else if (arg.startsWith("--target-size=")) out.targetSize = arg.slice("--target-size=".length);
    else if (arg.startsWith("--models=")) {
      out.models.push(...arg.slice("--models=".length).split(",").map((value) => value.trim()).filter(Boolean));
    } else if (!arg.startsWith("--")) {
      out.models.push(arg);
    }
  }
  return out;
}

function canonicalModelKey(file) {
  return basename(file, ".vox").replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase();
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

function visibleFaceSignature(rotation) {
  const visible = [];
  for (const face of FACE_ORDER) {
    if (normalFacesCamera(FACE_NORMALS[face], rotation)) visible.push(face);
  }
  return visible.join("|");
}

function visibleItems(items, rotation) {
  const visibleFaces = new Set(visibleFaceSignature(rotation).split("|").filter(Boolean));
  return items.filter((item) => visibleFaces.has(item.face));
}

function intervalPhase(rotation, signature, fraction) {
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

function tileOrder(items, orderRotation) {
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
  const tileCount = 4;
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

function orderRanks(ordered) {
  const ranks = new Map();
  ordered.forEach((item, index) => ranks.set(item.sourceIndex, index));
  return ranks;
}

function overlapPairs(items, actualRotation) {
  const projected = items.map((item) => ({ item, ...projectedBounds(item, actualRotation) }));
  const sorted = projected
    .map((entry, index) => ({ ...entry, index }))
    .sort((a, b) => a.minX - b.minX);
  const active = [];
  const pairs = [];
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
      const overlapArea = (x1 - x0) * (y1 - y0);
      pairs.push({
        a: current,
        b: other,
        overlapArea,
        maxPrimitive: Math.max(current.primitive, other.primitive),
        maxArea: Math.max(current.area, other.area),
        depthDelta: current.depth - other.depth,
      });
    }
    active.push(current);
  }
  return pairs;
}

function pairSign(pair, ranks) {
  const a = ranks.get(pair.a.item.sourceIndex);
  const b = ranks.get(pair.b.item.sourceIndex);
  if (!Number.isFinite(a) || !Number.isFinite(b) || a === b) return 0;
  return a < b ? -1 : 1;
}

function summarize(values) {
  return {
    median: median(values),
    p90: quantile(values, 0.9),
    p95: quantile(values, 0.95),
    max: values.length ? Math.max(...values) : null,
  };
}

function analyzePhaseForAngle(items, actualRotation, strategy) {
  const signature = visibleFaceSignature(actualRotation);
  const visible = visibleItems(items, actualRotation);
  const baselineOrder = tileOrder(visible, actualRotation);
  const strategyOrder = tileOrder(visible, strategy.phase(actualRotation, signature));
  const baselineRanks = orderRanks(baselineOrder);
  const strategyRanks = orderRanks(strategyOrder);
  const pairs = overlapPairs(visible, actualRotation);
  let changedPairs = 0;
  let changedArea = 0;
  let changedHugePairs = 0;
  let changedHugeArea = 0;
  let depthAscBad = 0;
  let depthDescBad = 0;
  let depthAscArea = 0;
  let depthDescArea = 0;
  let changedDepthAscBad = 0;
  let changedDepthDescBad = 0;
  let changedDepthAscArea = 0;
  let changedDepthDescArea = 0;
  let totalArea = 0;
  const movedDistances = [];
  const movedPrimitives = [];
  const movedAreas = [];

  for (const item of visible) {
    const baselineRank = baselineRanks.get(item.sourceIndex);
    const strategyRank = strategyRanks.get(item.sourceIndex);
    if (!Number.isFinite(baselineRank) || !Number.isFinite(strategyRank)) continue;
    const distance = Math.abs(strategyRank - baselineRank);
    if (distance > 0) {
      movedDistances.push(distance);
      movedPrimitives.push(Math.max(item.width, item.height));
      movedAreas.push(item.width * item.height);
    }
  }

  for (const pair of pairs) {
    totalArea += pair.overlapArea;
    const baseSign = pairSign(pair, baselineRanks);
    const strategySign = pairSign(pair, strategyRanks);
    const changed = baseSign !== strategySign;
    if (changed) {
      changedPairs += 1;
      changedArea += pair.overlapArea;
      if (pair.maxPrimitive > 600) {
        changedHugePairs += 1;
        changedHugeArea += pair.overlapArea;
      }
    }

    if (Math.abs(pair.depthDelta) > 0.5 && strategySign !== 0) {
      if ((strategySign < 0) !== (pair.depthDelta < 0)) {
        depthAscBad += 1;
        depthAscArea += pair.overlapArea;
        if (changed) {
          changedDepthAscBad += 1;
          changedDepthAscArea += pair.overlapArea;
        }
      }
      if ((strategySign < 0) !== (pair.depthDelta > 0)) {
        depthDescBad += 1;
        depthDescArea += pair.overlapArea;
        if (changed) {
          changedDepthDescBad += 1;
          changedDepthDescArea += pair.overlapArea;
        }
      }
    }
  }

  return {
    rotY: actualRotation.rotY,
    leaves: visible.length,
    overlapPairs: pairs.length,
    overlapArea: totalArea,
    changedPairs,
    changedPairRate: pairs.length ? changedPairs / pairs.length : 0,
    changedAreaRate: totalArea ? changedArea / totalArea : 0,
    changedHugePairs,
    changedHugePairRate: pairs.length ? changedHugePairs / pairs.length : 0,
    changedHugeAreaRate: totalArea ? changedHugeArea / totalArea : 0,
    depthAscBadRate: pairs.length ? depthAscBad / pairs.length : 0,
    depthDescBadRate: pairs.length ? depthDescBad / pairs.length : 0,
    depthAscBadAreaRate: totalArea ? depthAscArea / totalArea : 0,
    depthDescBadAreaRate: totalArea ? depthDescArea / totalArea : 0,
    changedDepthAscBadRate: changedPairs ? changedDepthAscBad / changedPairs : 0,
    changedDepthDescBadRate: changedPairs ? changedDepthDescBad / changedPairs : 0,
    changedDepthAscBadAreaRate: changedArea ? changedDepthAscArea / changedArea : 0,
    changedDepthDescBadAreaRate: changedArea ? changedDepthDescArea / changedArea : 0,
    movedCount: movedDistances.length,
    movedRate: visible.length ? movedDistances.length / visible.length : 0,
    movedDistance: summarize(movedDistances),
    movedPrimitive: summarize(movedPrimitives),
    movedArea: summarize(movedAreas),
  };
}

function mergeAngleRows(rows) {
  const sum = (key) => rows.reduce((total, row) => total + row[key], 0);
  const weighted = (valueKey, weightKey) => {
    const weight = sum(weightKey);
    return weight ? rows.reduce((total, row) => total + row[valueKey] * row[weightKey], 0) / weight : 0;
  };
  return {
    samples: rows.length,
    leavesMedian: median(rows.map((row) => row.leaves)),
    overlapPairsPerLeaf: sum("leaves") ? sum("overlapPairs") / sum("leaves") : 0,
    changedPairRate: weighted("changedPairRate", "overlapPairs"),
    changedAreaRate: weighted("changedAreaRate", "overlapArea"),
    changedHugePairRate: weighted("changedHugePairRate", "overlapPairs"),
    changedHugeAreaRate: weighted("changedHugeAreaRate", "overlapArea"),
    depthAscBadRate: weighted("depthAscBadRate", "overlapPairs"),
    depthDescBadRate: weighted("depthDescBadRate", "overlapPairs"),
    depthAscBadAreaRate: weighted("depthAscBadAreaRate", "overlapArea"),
    depthDescBadAreaRate: weighted("depthDescBadAreaRate", "overlapArea"),
    changedDepthAscBadRate: weighted("changedDepthAscBadRate", "changedPairs"),
    changedDepthDescBadRate: weighted("changedDepthDescBadRate", "changedPairs"),
    changedDepthAscBadAreaRate: weighted("changedDepthAscBadAreaRate", "changedArea"),
    changedDepthDescBadAreaRate: weighted("changedDepthDescBadAreaRate", "changedArea"),
    movedRate: weighted("movedRate", "leaves"),
    movedDistanceP95Median: median(rows.map((row) => row.movedDistance.p95)),
    movedPrimitiveP95Median: median(rows.map((row) => row.movedPrimitive.p95)),
    movedAreaP95Median: median(rows.map((row) => row.movedArea.p95)),
  };
}

async function findModelPath(model) {
  if (model.includes("/") || model.includes("\\")) return resolve(repoRoot, model);
  const direct = resolve(galleryVoxDir, model);
  try {
    await readFile(direct);
    return direct;
  } catch {
    const files = await readdir(galleryVoxDir);
    const needle = model.toLowerCase().replace(/\.vox$/, "");
    const match = files.find((file) => file.toLowerCase().replace(/\.vox$/, "") === needle);
    if (!match) throw new Error(`Could not find model ${model}`);
    return join(galleryVoxDir, match);
  }
}

async function analyzeModel(model) {
  const path = await findModelPath(model);
  const bytes = await readFile(path);
  const parsed = parseVox(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    { targetSize, gridShift: 0 },
  );
  const items = parsed.polygons
    .map((polygon, sourceIndex) => matrixItemForPolygon(polygon, sourceIndex))
    .filter((item) => item && item.width > 0 && item.height > 0);
  const angles = [];
  for (let offset = 0; offset < 360; offset += angleStep) {
    angles.push({ rotX: 65, rotY: 45 + offset });
  }
  return {
    model: basename(path),
    key: canonicalModelKey(path),
    polygons: parsed.polygons.length,
    items: items.length,
    strategies: STRATEGIES.map((strategy) => {
      const angleRows = angles.map((rotation) => analyzePhaseForAngle(items, rotation, strategy));
      return {
        key: strategy.key,
        label: strategy.label,
        metrics: mergeAngleRows(angleRows),
        angles: angleRows,
      };
    }),
  };
}

function renderMarkdown(rows) {
  const lines = [];
  lines.push("# Voxel Order Phase Metrics");
  lines.push("");
  lines.push(`Target size: ${targetSize}`);
  lines.push(`Angle step: ${angleStep}`);
  lines.push("");
  for (const row of rows) {
    lines.push(`## ${row.model}`);
    lines.push("");
    lines.push(`Polygons: ${row.polygons}; matrix items: ${row.items}`);
    lines.push("");
    lines.push("| Strategy | Active | Overlap/leaf | Changed pairs % | Changed overlap area % | Changed huge area % | Moved leaves % | Moved dist p95 | Moved primitive p95 | Asc-bad area % | Desc-bad area % |");
    lines.push("| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |");
    for (const strategy of row.strategies) {
      const m = strategy.metrics;
      lines.push([
        `| ${strategy.label}`,
        fmt(m.leavesMedian, 0),
        fmt(m.overlapPairsPerLeaf, 2),
        fmt(m.changedPairRate * 100, 2),
        fmt(m.changedAreaRate * 100, 2),
        fmt(m.changedHugeAreaRate * 100, 2),
        fmt(m.movedRate * 100, 2),
        fmt(m.movedDistanceP95Median, 0),
        fmt(m.movedPrimitiveP95Median, 0),
        fmt(m.depthAscBadAreaRate * 100, 2),
        `${fmt(m.depthDescBadAreaRate * 100, 2)} |`,
      ].join(" | "));
    }
    lines.push("");
  }
  return `${lines.join("\n")}\n`;
}

const rows = [];
for (const model of models) {
  console.log(`[phase-metrics] analyzing ${model}`);
  rows.push(await analyzeModel(model));
}

const out = {
  generatedAt: new Date().toISOString(),
  targetSize,
  angleStep,
  models: rows,
};
const jsonPath = join(resultDir, "voxel-order-phase-metrics.json");
const mdPath = join(resultDir, "voxel-order-phase-metrics.md");
await writeFile(jsonPath, JSON.stringify(out, null, 2));
await writeFile(mdPath, renderMarkdown(rows));
console.log(`[phase-metrics] wrote ${jsonPath}`);
console.log(`[phase-metrics] wrote ${mdPath}`);
