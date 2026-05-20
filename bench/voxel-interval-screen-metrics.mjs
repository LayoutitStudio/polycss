#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import {
  BASE_TILE,
  normalFacesCamera,
  parseVox,
  rotateVec3,
} from "../packages/core/dist/index.js";
import { PRESETS } from "./perf-shared.mjs";

const repoRoot = resolve(import.meta.dirname, "..");
const resultDir = resolve(repoRoot, "bench/results");
const galleryDir = resolve(repoRoot, "website/public");

const FACE_NORMALS = {
  t: [0, 0, 1],
  b: [0, 0, -1],
  fl: [0, 1, 0],
  br: [0, -1, 0],
  fr: [1, 0, 0],
  bl: [-1, 0, 0],
};

const FACE_BY_NORMAL = new Map([
  ["0,0,1", "t"],
  ["0,0,-1", "b"],
  ["0,1,0", "fl"],
  ["0,-1,0", "br"],
  ["1,0,0", "fr"],
  ["-1,0,0", "bl"],
]);

const args = parseArgs(process.argv.slice(2));
const labels = args.labels.length ? args.labels : [
  "a155-interval-current-ancient-crash-site",
  "a155-interval-current-obj-house3",
  "a155-interval-current-scene-mechanic2",
];
const angleStep = Number(args.angleStep ?? 5);
const outLabel = args.out ?? "a155-interval-screen-metrics";

function parseArgs(argv) {
  const out = { labels: [] };
  for (const arg of argv) {
    if (arg.startsWith("--labels=")) {
      out.labels.push(...arg.slice("--labels=".length).split(",").map((value) => value.trim()).filter(Boolean));
    } else if (arg.startsWith("--angle-step=")) {
      out.angleStep = arg.slice("--angle-step=".length);
    } else if (arg.startsWith("--out=")) {
      out.out = arg.slice("--out=".length);
    } else if (!arg.startsWith("--")) {
      out.labels.push(arg);
    }
  }
  return out;
}

function quantile(values, q) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return 0;
  const i = (sorted.length - 1) * q;
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
}

function median(values) {
  return quantile(values, 0.5);
}

function fmt(value, digits = 1) {
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

function itemForPolygon(polygon, sourceIndex) {
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

function itemCenter(item) {
  if (item.axis === "x") return [item.left + item.width / 2, -item.z, item.top + item.height / 2];
  if (item.axis === "y") return [-item.z, item.top + item.height / 2, item.left + item.width / 2];
  return [item.left + item.width / 2, item.top + item.height / 2, item.z];
}

function projectedCenter(item, rotation) {
  const [x, y] = rotateVec3(itemCenter(item), rotation.rotX, 0, rotation.rotY);
  return { x, y };
}

function tileScanlineOrder(items, rotation) {
  const entries = items.map((item) => ({ item, ...projectedCenter(item, rotation) }));
  if (!entries.length) return [];
  const minX = Math.min(...entries.map((entry) => entry.x));
  const maxX = Math.max(...entries.map((entry) => entry.x));
  const minY = Math.min(...entries.map((entry) => entry.y));
  const maxY = Math.max(...entries.map((entry) => entry.y));
  const spanX = Math.max(1e-6, maxX - minX);
  const spanY = Math.max(1e-6, maxY - minY);
  const tiles = new Map();
  for (const entry of entries) {
    const tx = Math.min(3, Math.max(0, Math.floor(((entry.x - minX) / spanX) * 4)));
    const ty = Math.min(3, Math.max(0, Math.floor(((entry.y - minY) / spanY) * 4)));
    const key = `${tx}:${ty}`;
    const tile = tiles.get(key) ?? { tx, ty, sourceIndex: entry.item.sourceIndex, items: [] };
    tile.items.push(entry.item);
    tile.sourceIndex = Math.min(tile.sourceIndex, entry.item.sourceIndex);
    tiles.set(key, tile);
  }
  return [...tiles.values()]
    .sort((a, b) => (a.ty - b.ty) || (a.tx - b.tx) || a.sourceIndex - b.sourceIndex)
    .flatMap((tile) => tile.items);
}

function polygonArea(points) {
  let sum = 0;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return Math.abs(sum) / 2;
}

function projectedBounds(item, rotation, order) {
  const points = itemCorners(item).map((point) => {
    const [x, y, z] = rotateVec3(point, rotation.rotX, 0, rotation.rotY);
    return { x, y, z };
  });
  const minX = Math.min(...points.map((point) => point.x));
  const maxX = Math.max(...points.map((point) => point.x));
  const minY = Math.min(...points.map((point) => point.y));
  const maxY = Math.max(...points.map((point) => point.y));
  return {
    face: item.face,
    order,
    minX,
    maxX,
    minY,
    maxY,
    depth: points.reduce((sum, point) => sum + point.z, 0) / points.length,
    boundsArea: Math.max(0, maxX - minX) * Math.max(0, maxY - minY),
    quadArea: polygonArea(points),
  };
}

function visibleFaceSignature(rotation) {
  return Object.entries(FACE_NORMALS)
    .filter(([, normal]) => normalFacesCamera(normal, rotation))
    .map(([face]) => face)
    .join("|");
}

function rotationsForSignature(signature) {
  const rotations = [];
  for (let rotY = 0; rotY < 360; rotY += angleStep) {
    const rotation = { rotX: 65, rotY };
    if (visibleFaceSignature(rotation) === signature) rotations.push(rotation);
  }
  return rotations.length ? rotations : [{ rotX: 65, rotY: 45 }];
}

function overlapMetrics(projected) {
  const sorted = projected.map((rect, index) => ({ ...rect, index })).sort((a, b) => a.minX - b.minX);
  const active = [];
  let pairs = 0;
  let area = 0;
  let invAsc = 0;
  let invDesc = 0;
  let ties = 0;
  const facePairAreas = new Map();
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
      pairs += 1;
      area += overlapArea;
      const pair = [current.face, other.face].sort().join("+");
      facePairAreas.set(pair, (facePairAreas.get(pair) ?? 0) + overlapArea);
      const orderDelta = current.order - other.order;
      const depthDelta = current.depth - other.depth;
      if (Math.abs(depthDelta) <= 0.5) {
        ties += 1;
      } else {
        if ((orderDelta < 0) !== (depthDelta < 0)) invAsc += 1;
        if ((orderDelta < 0) !== (depthDelta > 0)) invDesc += 1;
      }
    }
    active.push(current);
  }
  const topPair = [...facePairAreas.entries()].sort((a, b) => b[1] - a[1])[0] ?? null;
  return {
    pairs,
    area,
    invAsc,
    invDesc,
    ties,
    topPair: topPair ? { pair: topPair[0], areaRate: area ? topPair[1] / area : 0 } : null,
  };
}

function mergeRows(rows) {
  return {
    active: median(rows.map((row) => row.active)),
    boundsFill: median(rows.map((row) => row.boundsFill)),
    quadFill: median(rows.map((row) => row.quadFill)),
    overlapPairsPerLeaf: median(rows.map((row) => row.overlapPairsPerLeaf)),
    overlapAreaPerLeaf: median(rows.map((row) => row.overlapAreaPerLeaf)),
    invAscRate: median(rows.map((row) => row.invAscRate)),
    invDescRate: median(rows.map((row) => row.invDescRate)),
    minInvRate: median(rows.map((row) => Math.min(row.invAscRate, row.invDescRate))),
    screenArea: median(rows.map((row) => row.screenArea)),
    topPair: topPair(rows.map((row) => row.topPair)),
  };
}

function topPair(pairs) {
  const scores = new Map();
  for (const pair of pairs) {
    if (!pair) continue;
    scores.set(pair.pair, (scores.get(pair.pair) ?? 0) + pair.areaRate);
  }
  const best = [...scores.entries()].sort((a, b) => b[1] - a[1])[0];
  return best ? { pair: best[0], areaRate: best[1] / Math.max(1, pairs.filter(Boolean).length) } : null;
}

function geometryForSignature(items, signature) {
  const faces = new Set(signature.split("|").filter(Boolean));
  const visible = items.filter((item) => faces.has(item.face));
  const rows = rotationsForSignature(signature).map((rotation) => {
    const ordered = tileScanlineOrder(visible, rotation);
    const ranks = new Map(ordered.map((item, index) => [item.sourceIndex, index]));
    const projected = visible.map((item) => projectedBounds(item, rotation, ranks.get(item.sourceIndex) ?? item.sourceIndex));
    const minX = Math.min(...projected.map((rect) => rect.minX));
    const maxX = Math.max(...projected.map((rect) => rect.maxX));
    const minY = Math.min(...projected.map((rect) => rect.minY));
    const maxY = Math.max(...projected.map((rect) => rect.maxY));
    const screenArea = Math.max(1e-6, (maxX - minX) * (maxY - minY));
    const boundsArea = projected.reduce((sum, rect) => sum + rect.boundsArea, 0);
    const quadArea = projected.reduce((sum, rect) => sum + rect.quadArea, 0);
    const overlap = overlapMetrics(projected);
    return {
      active: visible.length,
      screenArea,
      boundsFill: boundsArea / screenArea,
      quadFill: quadArea / screenArea,
      overlapPairsPerLeaf: visible.length ? overlap.pairs / visible.length : 0,
      overlapAreaPerLeaf: visible.length ? overlap.area / visible.length : 0,
      invAscRate: overlap.pairs ? overlap.invAsc / overlap.pairs : 0,
      invDescRate: overlap.pairs ? overlap.invDesc / overlap.pairs : 0,
      topPair: overlap.topPair,
    };
  });
  return mergeRows(rows);
}

async function loadItems(mesh) {
  const preset = PRESETS[mesh];
  if (!preset) throw new Error(`No preset for ${mesh}`);
  const path = resolve(galleryDir, preset.url.replace(/^\//, ""));
  const bytes = await readFile(path);
  const parsed = parseVox(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    { targetSize: preset.options?.targetSize ?? 70, gridShift: 0 },
  );
  return parsed.polygons
    .map((polygon, sourceIndex) => itemForPolygon(polygon, sourceIndex))
    .filter((item) => item && item.width > 0 && item.height > 0);
}

async function analyzeLabel(label) {
  const data = JSON.parse(await readFile(resolve(resultDir, `${label}.json`), "utf8"));
  const items = await loadItems(data.mesh);
  const run = data.runs[0];
  return run.signatures.map((signatureRow) => ({
    label,
    mesh: data.mesh,
    signature: signatureRow.signature,
    fpsP95: signatureRow.fps_p95,
    p99: signatureRow.frame_time_p99_ms,
    x1: signatureRow.buckets.x1,
    x2: signatureRow.buckets.x2,
    x3: signatureRow.buckets.x3,
    x4Plus: signatureRow.buckets.x4_plus,
    geometry: geometryForSignature(items, signatureRow.signature),
  }));
}

function renderMarkdown(rows) {
  const lines = [
    "# Voxel Interval Screen Metrics",
    "",
    `Angle step: ${angleStep}`,
    "",
    "| Mesh | Signature | p95 FPS | p99 ms | Active | Bounds fill | Overlap/leaf | Asc inv % | Desc inv % | Top pair | Pair % | x1 | x2 | x3 | x4+ |",
    "| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- | ---: | ---: | ---: | ---: | ---: |",
  ];
  for (const row of rows) {
    lines.push([
      `| ${row.mesh}`,
      row.signature,
      fmt(row.fpsP95),
      fmt(row.p99),
      fmt(row.geometry.active, 0),
      fmt(row.geometry.boundsFill, 2),
      fmt(row.geometry.overlapPairsPerLeaf, 2),
      fmt(row.geometry.invAscRate * 100, 1),
      fmt(row.geometry.invDescRate * 100, 1),
      row.geometry.topPair?.pair ?? "",
      fmt((row.geometry.topPair?.areaRate ?? 0) * 100, 0),
      row.x1,
      row.x2,
      row.x3,
      `${row.x4Plus} |`,
    ].join(" | "));
  }
  return `${lines.join("\n")}\n`;
}

const rows = (await Promise.all(labels.map((label) => analyzeLabel(label)))).flat();
const output = {
  generatedAt: new Date().toISOString(),
  labels,
  angleStep,
  rows,
};
const jsonPath = join(resultDir, `${outLabel}.json`);
const mdPath = join(resultDir, `${outLabel}.md`);
await writeFile(jsonPath, JSON.stringify(output, null, 2));
await writeFile(mdPath, renderMarkdown(rows));
console.log(renderMarkdown(rows));
console.log(`Wrote ${jsonPath}`);
console.log(`Wrote ${mdPath}`);
