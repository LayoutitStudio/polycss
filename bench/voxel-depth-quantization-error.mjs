#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
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

const FACE_BY_NORMAL = new Map([
  ["0,0,1", "t"],
  ["0,0,-1", "b"],
  ["0,1,0", "fl"],
  ["0,-1,0", "br"],
  ["1,0,0", "fr"],
  ["-1,0,0", "bl"],
]);

const DEFAULT_MODELS = [
  "AncientCrashSite.vox",
  "desert2.vox",
  "Treasure.vox",
  "obj_house3.vox",
  "scene_mechanic2.vox",
  "scene_house.vox",
  "scene_sidewalk.vox",
];

const args = parseArgs(process.argv.slice(2));
const models = args.models.length ? args.models : DEFAULT_MODELS;
const bucketCounts = args.buckets.length ? args.buckets : [2, 4, 8, 12, 16];
const rotation = {
  rotX: Number(args.rotX ?? 65),
  rotY: Number(args.rotY ?? 45),
};
const targetSize = Number(args.targetSize ?? 70);
const outPath = args.out ?? resolve(resultDir, "a150-depth-quantization-error.md");
const jsonPath = args.json ?? resolve(resultDir, "a150-depth-quantization-error.json");

function parseArgs(argv) {
  const parsed = {
    buckets: [],
    models: [],
  };
  for (const arg of argv) {
    if (arg.startsWith("--buckets=")) {
      parsed.buckets = arg.slice("--buckets=".length).split(",").map(Number).filter(Number.isFinite);
    } else if (arg.startsWith("--models=")) {
      parsed.models = arg.slice("--models=".length).split(",").filter(Boolean);
    } else if (arg.startsWith("--rotX=")) {
      parsed.rotX = arg.slice("--rotX=".length);
    } else if (arg.startsWith("--rotY=")) {
      parsed.rotY = arg.slice("--rotY=".length);
    } else if (arg.startsWith("--targetSize=")) {
      parsed.targetSize = arg.slice("--targetSize=".length);
    } else if (arg.startsWith("--out=")) {
      parsed.out = resolve(arg.slice("--out=".length));
    } else if (arg.startsWith("--json=")) {
      parsed.json = resolve(arg.slice("--json=".length));
    } else if (!arg.startsWith("--")) {
      parsed.models.push(arg);
    }
  }
  return parsed;
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

function polygonItem(polygon, sourceIndex) {
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

function project(point) {
  const [x, y] = rotateVec3(point, rotation.rotX, 0, rotation.rotY);
  return { x, y };
}

function quantile(values, q) {
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 0) return 0;
  const i = (sorted.length - 1) * q;
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
}

function quantizedZ(item, axisStats, bucketCount) {
  if (bucketCount <= 1) return axisStats.min;
  const span = axisStats.max - axisStats.min;
  if (Math.abs(span) <= 1e-9) return axisStats.min;
  const unit = span / bucketCount;
  const bucket = Math.max(0, Math.min(bucketCount - 1, Math.floor((item.z - axisStats.min) / unit)));
  return axisStats.min + (bucket + 0.5) * unit;
}

function errorForBuckets(items, bucketCount) {
  const statsByAxis = new Map();
  for (const axis of ["x", "y", "z"]) {
    const axisItems = items.filter((item) => item.axis === axis);
    statsByAxis.set(axis, {
      min: Math.min(...axisItems.map((item) => item.z)),
      max: Math.max(...axisItems.map((item) => item.z)),
    });
  }

  const errors = items.map((item) => {
    const exact = project(itemCenter(item));
    const q = project(itemCenter({ ...item, z: quantizedZ(item, statsByAxis.get(item.axis), bucketCount) }));
    return Math.hypot(exact.x - q.x, exact.y - q.y);
  });

  return {
    bucketCount,
    wrappers: bucketCount * 3,
    p50: quantile(errors, 0.5),
    p95: quantile(errors, 0.95),
    max: Math.max(...errors),
  };
}

async function analyzeModel(model) {
  const file = model.endsWith(".vox") ? model : `${model}.vox`;
  const path = resolve(galleryVoxDir, file);
  const bytes = await readFile(path);
  const parsed = parseVox(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    { targetSize, gridShift: 0 },
  );
  const items = parsed.polygons
    .map((polygon, sourceIndex) => polygonItem(polygon, sourceIndex))
    .filter(Boolean)
    .filter((item) => item.width > 0 && item.height > 0);
  const visibleFaces = new Set(
    Object.entries(FACE_NORMALS)
      .filter(([, normal]) => normalFacesCamera(normal, rotation))
      .map(([face]) => face),
  );
  const active = items.filter((item) => visibleFaces.has(item.face));
  const exactPlanes = new Set(active.map((item) => `${item.axis}:${item.z.toFixed(3)}`));
  return {
    model: file,
    active: active.length,
    exactPlanes: exactPlanes.size,
    rows: bucketCounts.map((bucketCount) => errorForBuckets(active, bucketCount)),
  };
}

function fmt(value) {
  return value.toFixed(1);
}

const results = [];
for (const model of models) {
  results.push(await analyzeModel(model));
}

const lines = [
  "# Depth Quantization Error",
  "",
  `Rotation: rotX=${rotation.rotX}, rotY=${rotation.rotY}`,
  `Target size: ${targetSize}`,
  "",
  "| Model | Active | Exact planes | Buckets/axis | Total wrappers | p50 err | p95 err | max err |",
  "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
];

for (const result of results) {
  for (const row of result.rows) {
    lines.push([
      `| ${basename(result.model, ".vox")}`,
      result.active,
      result.exactPlanes,
      row.bucketCount,
      row.wrappers,
      fmt(row.p50),
      fmt(row.p95),
      `${fmt(row.max)} |`,
    ].join(" | "));
  }
}

await mkdir(resultDir, { recursive: true });
await writeFile(outPath, `${lines.join("\n")}\n`);
await writeFile(jsonPath, `${JSON.stringify({ rotation, targetSize, results }, null, 2)}\n`);
console.log(lines.join("\n"));
console.log(`\nWrote ${outPath}`);
console.log(`Wrote ${jsonPath}`);
