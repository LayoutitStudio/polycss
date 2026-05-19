#!/usr/bin/env node
import { readFile, readdir, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import {
  BASE_TILE,
  normalFacesCamera,
  parseVox,
} from "../packages/core/dist/index.js";

const repoRoot = resolve(import.meta.dirname, "..");
const galleryVoxDir = resolve(repoRoot, "website/public/gallery/vox");
const resultDir = resolve(repoRoot, "bench/results");
const benchResultPrefix = process.env.BENCH_RESULT_PREFIX ?? "";

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

const FACE_ORDER = ["t", "b", "bl", "br", "fr", "fl"];
const FACE_ORDER_INDEX = Object.fromEntries(FACE_ORDER.map((face, index) => [face, index]));
const TOP_REVERSE_ORDER = ["t", "b", "fl", "fr", "br", "bl"];

function sourceBlockDepthOrder(items, rotY, blockSize, front) {
  const blocks = new Map();
  for (const item of items) {
    const blockIndex = Math.floor(item.sourceIndex / blockSize);
    const block = blocks.get(blockIndex) ?? { blockIndex, items: [], depthSum: 0 };
    block.items.push(item);
    block.depthSum += itemViewDepth(item, rotY);
    blocks.set(blockIndex, block);
  }
  return [...blocks.values()]
    .map((block) => ({ ...block, avgDepth: block.depthSum / block.items.length }))
    .sort((a, b) => {
      const delta = a.avgDepth - b.avgDepth;
      return (front ? delta : -delta) || a.blockIndex - b.blockIndex;
    })
    .flatMap((block) => block.items);
}

const STRATEGIES = [
  {
    key: "exact",
    caseId: "polycss-voxlocal-direct-matrix-exact",
    label: "Exact parsed",
    order(items) {
      return items;
    },
  },
  {
    key: "face",
    caseId: "polycss-voxlocal-direct-matrix-face-order",
    label: "Face order",
    order(items) {
      return [...items].sort((a, b) =>
        FACE_ORDER_INDEX[a.face] - FACE_ORDER_INDEX[b.face] || a.sourceIndex - b.sourceIndex
      );
    },
  },
  {
    key: "topRev",
    caseId: "polycss-voxlocal-direct-matrix-face-order-top-reverse",
    label: "Top reverse",
    order(items) {
      const index = Object.fromEntries(TOP_REVERSE_ORDER.map((face, i) => [face, i]));
      return [...items].sort((a, b) => index[a.face] - index[b.face] || a.sourceIndex - b.sourceIndex);
    },
  },
  {
    key: "normalF",
    caseId: "polycss-voxlocal-direct-matrix-face-normal-front",
    label: "Normal front",
    order(items, rotY) {
      const faces = [...new Set(items.map((item) => item.face))]
        .sort((a, b) => faceCameraDepth(a, rotY) - faceCameraDepth(b, rotY));
      const index = Object.fromEntries(faces.map((face, i) => [face, i]));
      return [...items].sort((a, b) => index[a.face] - index[b.face] || a.sourceIndex - b.sourceIndex);
    },
  },
  {
    key: "normalB",
    caseId: "polycss-voxlocal-direct-matrix-face-normal-back",
    label: "Normal back",
    order(items, rotY) {
      const faces = [...new Set(items.map((item) => item.face))]
        .sort((a, b) => faceCameraDepth(b, rotY) - faceCameraDepth(a, rotY));
      const index = Object.fromEntries(faces.map((face, i) => [face, i]));
      return [...items].sort((a, b) => index[a.face] - index[b.face] || a.sourceIndex - b.sourceIndex);
    },
  },
  {
    key: "depthF",
    caseId: "polycss-voxlocal-direct-matrix-depth-front",
    label: "Depth front",
    order(items, rotY) {
      return [...items].sort((a, b) => itemViewDepth(a, rotY) - itemViewDepth(b, rotY));
    },
  },
  {
    key: "depthB",
    caseId: "polycss-voxlocal-direct-matrix-depth-back",
    label: "Depth back",
    order(items, rotY) {
      return [...items].sort((a, b) => itemViewDepth(b, rotY) - itemViewDepth(a, rotY));
    },
  },
  ...[32, 64, 128, 256].flatMap((blockSize) => [
    {
      key: `block${blockSize}F`,
      caseId: `polycss-voxlocal-direct-matrix-source-block${blockSize}-depth-front`,
      label: `Block ${blockSize} front`,
      order(items, rotY) {
        return sourceBlockDepthOrder(items, rotY, blockSize, true);
      },
    },
    {
      key: `block${blockSize}B`,
      caseId: `polycss-voxlocal-direct-matrix-source-block${blockSize}-depth-back`,
      label: `Block ${blockSize} back`,
      order(items, rotY) {
        return sourceBlockDepthOrder(items, rotY, blockSize, false);
      },
    },
  ]),
];

const HARD_SPLIT_MODELS = [
  "obj_house3.vox",
  "obj_house5.vox",
  "desert2.vox",
  "house.vox",
  "scene_mechanic2.vox",
  "Treasure.vox",
  "army.vox",
  "AncientCrashSite.vox",
  "skyscraper.vox",
];

const args = parseArgs(process.argv.slice(2));
const angleStep = Number(args.angleStep ?? process.env.ANGLE_STEP ?? 15);
const targetSize = Number(args.targetSize ?? process.env.POLY_TARGET_SIZE ?? 70);
const models = args.models.length ? args.models : HARD_SPLIT_MODELS;
const selectedStrategies = args.strategies.length
  ? STRATEGIES.filter((strategy) => args.strategies.includes(strategy.key))
  : STRATEGIES;

function parseArgs(argv) {
  const out = {
    models: [],
    strategies: [],
    angleStep: null,
    targetSize: null,
  };
  for (const arg of argv) {
    if (arg.startsWith("--angle-step=")) {
      out.angleStep = arg.slice("--angle-step=".length);
    } else if (arg.startsWith("--target-size=")) {
      out.targetSize = arg.slice("--target-size=".length);
    } else if (arg.startsWith("--strategies=")) {
      out.strategies = arg.slice("--strategies=".length).split(",").map((value) => value.trim()).filter(Boolean);
    } else if (arg.startsWith("--models=")) {
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

function benchmarkResultSlug(file) {
  return basename(file).replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase();
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

function exactMatrixItemForPolygon(polygon, sourceIndex) {
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

  const eps = 1e-6;
  const base = { face, sourceIndex };
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

function projectPoint(point, rotY) {
  const rz = (rotY * Math.PI) / 180;
  const rx = (65 * Math.PI) / 180;
  const cosZ = Math.cos(rz);
  const sinZ = Math.sin(rz);
  const cosX = Math.cos(rx);
  const sinX = Math.sin(rx);
  const [x, y, z] = point;
  const x1 = x * cosZ - y * sinZ;
  const y1 = x * sinZ + y * cosZ;
  return {
    x: x1,
    y: y1 * cosX - z * sinX,
    z: y1 * sinX + z * cosX,
  };
}

function itemViewDepth(item, rotY) {
  return projectPoint(itemCenter(item), rotY).z;
}

function faceCameraDepth(face, rotY) {
  const normal = FACE_NORMALS[face];
  return projectPoint(normal, rotY).z;
}

function polygonArea2(points) {
  let sum = 0;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return Math.abs(sum) / 2;
}

function planeFromProjected(points) {
  const [a, b, c] = points;
  const ux = b.x - a.x;
  const uy = b.y - a.y;
  const uz = b.z - a.z;
  const vx = c.x - a.x;
  const vy = c.y - a.y;
  const vz = c.z - a.z;
  const nx = uy * vz - uz * vy;
  const ny = uz * vx - ux * vz;
  const nz = ux * vy - uy * vx;
  if (Math.abs(nz) <= 1e-9) return null;
  return {
    a: -nx / nz,
    b: -ny / nz,
    c: (nx * a.x + ny * a.y + nz * a.z) / nz,
  };
}

function planeZ(plane, x, y, fallback) {
  return plane ? plane.a * x + plane.b * y + plane.c : fallback;
}

function projectedItem(item, order, rotY) {
  const points = itemCorners(item).map((point) => projectPoint(point, rotY));
  const minX = Math.min(...points.map((point) => point.x));
  const maxX = Math.max(...points.map((point) => point.x));
  const minY = Math.min(...points.map((point) => point.y));
  const maxY = Math.max(...points.map((point) => point.y));
  const depth = points.reduce((sum, point) => sum + point.z, 0) / points.length;
  return {
    item,
    order,
    points,
    minX,
    maxX,
    minY,
    maxY,
    depth,
    area2d: polygonArea2(points),
    plane: planeFromProjected(points),
  };
}

class DisjointSet {
  constructor(size) {
    this.parent = Array.from({ length: size }, (_, index) => index);
    this.size = Array.from({ length: size }, () => 1);
  }

  find(index) {
    let root = index;
    while (this.parent[root] !== root) root = this.parent[root];
    while (this.parent[index] !== index) {
      const parent = this.parent[index];
      this.parent[index] = root;
      index = parent;
    }
    return root;
  }

  union(a, b) {
    let rootA = this.find(a);
    let rootB = this.find(b);
    if (rootA === rootB) return;
    if (this.size[rootA] < this.size[rootB]) [rootA, rootB] = [rootB, rootA];
    this.parent[rootB] = rootA;
    this.size[rootA] += this.size[rootB];
  }
}

function analyzeProjected(projected) {
  const sorted = projected
    .map((item, index) => ({ ...item, index }))
    .sort((a, b) => a.minX - b.minX);
  const dsu = new DisjointSet(projected.length);
  const active = [];
  let overlapPairs = 0;
  let overlapArea = 0;
  let invAsc = 0;
  let invDesc = 0;
  let depthTies = 0;
  let crossings = 0;

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
      overlapPairs += 1;
      overlapArea += (x1 - x0) * (y1 - y0);
      dsu.union(current.index, other.index);

      const orderDelta = current.order - other.order;
      const depthDelta = current.depth - other.depth;
      if (Math.abs(depthDelta) <= 0.5) {
        depthTies += 1;
      } else {
        if ((orderDelta < 0) !== (depthDelta < 0)) invAsc += 1;
        if ((orderDelta < 0) !== (depthDelta > 0)) invDesc += 1;
      }

      const samples = [
        [(x0 + x1) / 2, (y0 + y1) / 2],
        [x0, y0],
        [x1, y0],
        [x1, y1],
        [x0, y1],
      ];
      let sawPositive = false;
      let sawNegative = false;
      for (const [x, y] of samples) {
        const dz = planeZ(current.plane, x, y, current.depth) - planeZ(other.plane, x, y, other.depth);
        if (dz > 0.5) sawPositive = true;
        else if (dz < -0.5) sawNegative = true;
      }
      if (sawPositive && sawNegative) crossings += 1;
    }
    active.push(current);
  }

  let largestComponent = 0;
  const componentSizes = new Map();
  for (let i = 0; i < projected.length; i += 1) {
    const root = dsu.find(i);
    const size = (componentSizes.get(root) ?? 0) + 1;
    componentSizes.set(root, size);
    largestComponent = Math.max(largestComponent, size);
  }

  let faceSwitches = 0;
  let depthJump = 0;
  let sourceJump = 0;
  const orderSorted = [...projected].sort((a, b) => a.order - b.order);
  for (let i = 1; i < orderSorted.length; i += 1) {
    const prev = orderSorted[i - 1];
    const next = orderSorted[i];
    if (prev.item.face !== next.item.face) faceSwitches += 1;
    depthJump += Math.abs(prev.depth - next.depth);
    sourceJump += Math.abs(prev.item.sourceIndex - next.item.sourceIndex);
  }

  return {
    activeLeaves: projected.length,
    overlapPairs,
    overlapArea,
    invAsc,
    invDesc,
    depthTies,
    crossings,
    componentCount: componentSizes.size,
    largestComponent,
    faceSwitches,
    depthJumpMean: orderSorted.length > 1 ? depthJump / (orderSorted.length - 1) : 0,
    sourceJumpMean: orderSorted.length > 1 ? sourceJump / (orderSorted.length - 1) : 0,
  };
}

function mergeMetricRows(rows) {
  const total = {
    samples: rows.length,
    activeLeaves: 0,
    overlapPairs: 0,
    overlapArea: 0,
    invAsc: 0,
    invDesc: 0,
    depthTies: 0,
    crossings: 0,
    largestComponentMax: 0,
    largestComponentMedian: median(rows.map((row) => row.largestComponent)),
    componentCountMedian: median(rows.map((row) => row.componentCount)),
    faceSwitchesMedian: median(rows.map((row) => row.faceSwitches)),
    depthJumpMeanMedian: median(rows.map((row) => row.depthJumpMean)),
    sourceJumpMeanMedian: median(rows.map((row) => row.sourceJumpMean)),
  };
  for (const row of rows) {
    total.activeLeaves += row.activeLeaves;
    total.overlapPairs += row.overlapPairs;
    total.overlapArea += row.overlapArea;
    total.invAsc += row.invAsc;
    total.invDesc += row.invDesc;
    total.depthTies += row.depthTies;
    total.crossings += row.crossings;
    total.largestComponentMax = Math.max(total.largestComponentMax, row.largestComponent);
  }
  total.activeLeavesMedian = median(rows.map((row) => row.activeLeaves));
  total.overlapPairsPerLeaf = total.activeLeaves ? total.overlapPairs / total.activeLeaves : 0;
  total.invAscRate = total.overlapPairs ? total.invAsc / total.overlapPairs : 0;
  total.invDescRate = total.overlapPairs ? total.invDesc / total.overlapPairs : 0;
  total.tieRate = total.overlapPairs ? total.depthTies / total.overlapPairs : 0;
  total.crossingRate = total.overlapPairs ? total.crossings / total.overlapPairs : 0;
  total.minDepthInvRate = Math.min(total.invAscRate, total.invDescRate);
  return total;
}

function visibleItems(items, rotY) {
  const visibleFaces = new Set(
    Object.entries(FACE_NORMALS)
      .filter(([, normal]) => normalFacesCamera(normal, { rotX: 65, rotY }, 0.001))
      .map(([face]) => face)
  );
  return items.filter((item) => visibleFaces.has(item.face));
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

async function loadBenchResult(modelFile) {
  const slug = benchmarkResultSlug(modelFile);
  const path = join(resultDir, `${benchResultPrefix}${slug}-rotation-compare.json`);
  try {
    const data = JSON.parse(await readFile(path, "utf8"));
    const out = {};
    for (const strategy of STRATEGIES) {
      const runs = data.cases?.[strategy.caseId]?.runs ?? [];
      out[strategy.key] = runs.length
        ? {
            runs: runs.length,
            fpsP95: median(runs.map((run) => run.fps_p95)),
            frameP99: median(runs.map((run) => run.frame_time_p99_ms)),
          }
        : null;
    }
    return out;
  } catch {
    return {};
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
    .map((polygon, sourceIndex) => exactMatrixItemForPolygon(polygon, sourceIndex))
    .filter((item) => item && item.width > 0 && item.height > 0);
  const angles = [];
  for (let offset = 0; offset < 360; offset += angleStep) angles.push(45 + offset);
  const bench = await loadBenchResult(path);
  const strategyRows = [];
  for (const strategy of selectedStrategies) {
    const angleRows = [];
    for (const rotY of angles) {
      const currentVisible = visibleItems(items, rotY);
      const ordered = strategy.order(currentVisible, rotY);
      const projected = ordered.map((item, index) => projectedItem(item, index, rotY));
      angleRows.push({ rotY, ...analyzeProjected(projected) });
    }
    strategyRows.push({
      key: strategy.key,
      label: strategy.label,
      caseId: strategy.caseId,
      bench: bench[strategy.key] ?? null,
      metrics: mergeMetricRows(angleRows),
      angles: angleRows,
    });
  }
  return {
    model: basename(path),
    key: canonicalModelKey(path),
    targetSize,
    angleStep,
    polygons: parsed.polygons.length,
    exactItems: items.length,
    strategies: strategyRows,
  };
}

function renderMarkdown(rows) {
  const lines = [];
  lines.push("# Voxel Order Metrics");
  lines.push("");
  lines.push(`Target size: ${targetSize}`);
  lines.push(`Angle step: ${angleStep}`);
  lines.push("");
  for (const row of rows) {
    lines.push(`## ${row.model}`);
    lines.push("");
    lines.push(`Polygons: ${row.polygons}; exact matrix items: ${row.exactItems}`);
    lines.push("");
    lines.push("| Strategy | Runs | FPS p95 | Frame p99 | Active | Overlap/leaf | Min inv % | Asc inv % | Desc inv % | Cross % | Tie % | Max comp | Face switches | Depth jump |");
    lines.push("| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |");
    for (const strategy of row.strategies) {
      const m = strategy.metrics;
      const b = strategy.bench;
      lines.push([
        `| ${strategy.label}`,
        b?.runs ?? "",
        fmt(b?.fpsP95),
        fmt(b?.frameP99),
        fmt(m.activeLeavesMedian, 0),
        fmt(m.overlapPairsPerLeaf, 2),
        fmt(m.minDepthInvRate * 100, 2),
        fmt(m.invAscRate * 100, 2),
        fmt(m.invDescRate * 100, 2),
        fmt(m.crossingRate * 100, 2),
        fmt(m.tieRate * 100, 2),
        fmt(m.largestComponentMax, 0),
        fmt(m.faceSwitchesMedian, 0),
        `${fmt(m.depthJumpMeanMedian, 1)} |`,
      ].join(" | "));
    }
    lines.push("");
  }
  return `${lines.join("\n")}\n`;
}

const rows = [];
for (const model of models) {
  console.log(`[voxel-order-metrics] analyzing ${model}`);
  rows.push(await analyzeModel(model));
}

const jsonPath = join(resultDir, "voxel-order-metrics.json");
const mdPath = join(resultDir, "voxel-order-metrics.md");
await writeFile(jsonPath, JSON.stringify({
  generatedAt: new Date().toISOString(),
  targetSize,
  angleStep,
  models: rows,
}, null, 2));
await writeFile(mdPath, renderMarkdown(rows));

console.log(`[voxel-order-metrics] wrote ${jsonPath}`);
console.log(`[voxel-order-metrics] wrote ${mdPath}`);
