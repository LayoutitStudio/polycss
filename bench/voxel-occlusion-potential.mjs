#!/usr/bin/env node
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve, join } from "node:path";
import {
  BASE_TILE,
  normalFacesCamera,
  parseVox,
  rotateVec3,
} from "../packages/core/dist/index.js";
import { PRESETS } from "./perf-shared.mjs";

const repoRoot = resolve(import.meta.dirname, "..");
const galleryDir = resolve(repoRoot, "website/public");
const resultDir = resolve(repoRoot, "bench/results");

const args = new Map(process.argv.slice(2).map((arg) => {
  const [key, ...rest] = arg.replace(/^--/, "").split("=");
  return [key, rest.length ? rest.join("=") : "true"];
}));

const MESHES = (args.get("meshes") ?? "obj-house3,ancient-crash-site,scene-mechanic2,Treasure,army,skyscraper")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
const ANGLE_STEP = Number(args.get("angle-step") ?? 10);
const GRID_W = Number(args.get("grid-w") ?? 240);
const GRID_H = Number(args.get("grid-h") ?? 160);
const LABEL = args.get("label") ?? "";

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

function quantile(values, q) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return 0;
  const i = (sorted.length - 1) * q;
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
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

function visibleFaceSignature(rotX, rotY) {
  const visible = [];
  for (const face of FACE_ORDER) {
    if (normalFacesCamera(FACE_NORMALS[face], { rotX, rotY })) visible.push(face);
  }
  return visible.join("|");
}

async function loadItems(meshId) {
  const preset = PRESETS[meshId];
  if (!preset) throw new Error(`Unknown preset ${meshId}`);
  const path = resolve(galleryDir, preset.url.replace(/^\//, ""));
  const bytes = await readFile(path);
  const parsed = parseVox(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    { targetSize: preset.options?.targetSize ?? 70, gridShift: 0 },
  );
  const items = parsed.polygons
    .map((polygon, sourceIndex) => itemForPolygon(polygon, sourceIndex))
    .filter((item) => item && item.width > 0 && item.height > 0);
  if (items.length !== parsed.polygons.length) throw new Error(`${meshId} has non-exact voxel polygons`);
  return { preset, items };
}

function pointInConvex(point, poly) {
  let sign = 0;
  for (let i = 0; i < poly.length; i += 1) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const cross = (b.x - a.x) * (point.y - a.y) - (b.y - a.y) * (point.x - a.x);
    const nextSign = Math.sign(cross);
    if (nextSign === 0) continue;
    if (sign === 0) sign = nextSign;
    else if (sign !== nextSign) return false;
  }
  return true;
}

function estimateAtAngle(items, rotX, rotY) {
  const signature = visibleFaceSignature(rotX, rotY);
  const visibleFaces = new Set(signature.split("|").filter(Boolean));
  const projected = items
    .filter((item) => visibleFaces.has(item.face))
    .map((item) => {
      const points = itemCorners(item).map((corner) => {
        const [x, y, z] = rotateVec3(corner, rotX, 0, rotY);
        return { x, y, z };
      });
      return {
        item,
        points,
        depth: points.reduce((sum, point) => sum + point.z, 0) / points.length,
        minX: Math.min(...points.map((point) => point.x)),
        maxX: Math.max(...points.map((point) => point.x)),
        minY: Math.min(...points.map((point) => point.y)),
        maxY: Math.max(...points.map((point) => point.y)),
      };
    });
  if (!projected.length) return { signature, active: 0, kept: 0, culled: 0, cullRatio: 0 };

  const minX = Math.min(...projected.map((entry) => entry.minX));
  const maxX = Math.max(...projected.map((entry) => entry.maxX));
  const minY = Math.min(...projected.map((entry) => entry.minY));
  const maxY = Math.max(...projected.map((entry) => entry.maxY));
  const spanX = Math.max(1e-6, maxX - minX);
  const spanY = Math.max(1e-6, maxY - minY);
  const occupied = new Uint8Array(GRID_W * GRID_H);
  let kept = 0;
  let culled = 0;

  const sorted = projected.sort((a, b) => b.depth - a.depth || a.item.sourceIndex - b.item.sourceIndex);
  for (const entry of sorted) {
    const gx0 = Math.max(0, Math.floor(((entry.minX - minX) / spanX) * GRID_W));
    const gx1 = Math.min(GRID_W - 1, Math.ceil(((entry.maxX - minX) / spanX) * GRID_W));
    const gy0 = Math.max(0, Math.floor(((entry.minY - minY) / spanY) * GRID_H));
    const gy1 = Math.min(GRID_H - 1, Math.ceil(((entry.maxY - minY) / spanY) * GRID_H));
    let hasPixel = false;
    const cells = [];
    for (let gy = gy0; gy <= gy1; gy += 1) {
      const y = minY + ((gy + 0.5) / GRID_H) * spanY;
      for (let gx = gx0; gx <= gx1; gx += 1) {
        const x = minX + ((gx + 0.5) / GRID_W) * spanX;
        if (!pointInConvex({ x, y }, entry.points)) continue;
        const index = gy * GRID_W + gx;
        cells.push(index);
        if (!occupied[index]) hasPixel = true;
      }
    }
    if (!hasPixel) {
      culled += 1;
      continue;
    }
    kept += 1;
    for (const index of cells) occupied[index] = 1;
  }

  return {
    signature,
    active: projected.length,
    kept,
    culled,
    cullRatio: projected.length ? culled / projected.length : 0,
  };
}

function summarize(rows) {
  const active = rows.map((row) => row.active);
  const kept = rows.map((row) => row.kept);
  const culled = rows.map((row) => row.culled);
  const ratios = rows.map((row) => row.cullRatio);
  return {
    active_p50: quantile(active, 0.5),
    kept_p50: quantile(kept, 0.5),
    culled_p50: quantile(culled, 0.5),
    cullRatio_p50: quantile(ratios, 0.5),
    cullRatio_p95: quantile(ratios, 0.95),
  };
}

const results = [];
for (const mesh of MESHES) {
  const { preset, items } = await loadItems(mesh);
  const angles = [];
  for (let offset = 0; offset < 360; offset += ANGLE_STEP) {
    angles.push((preset.rotY + offset) % 360);
  }
  const rows = angles.map((rotY) => ({
    mesh,
    rotX: preset.rotX,
    rotY,
    ...estimateAtAngle(items, preset.rotX, rotY),
  }));
  const summary = summarize(rows);
  results.push({ mesh, grid: [GRID_W, GRID_H], angleStep: ANGLE_STEP, summary, rows });
}

console.log("| Mesh | Active p50 | Kept p50 | Culled p50 | Cull p50 | Cull p95 |");
console.log("| --- | ---: | ---: | ---: | ---: | ---: |");
for (const result of results) {
  console.log([
    `| ${result.mesh}`,
    result.summary.active_p50.toFixed(0),
    result.summary.kept_p50.toFixed(0),
    result.summary.culled_p50.toFixed(0),
    `${(result.summary.cullRatio_p50 * 100).toFixed(1)}%`,
    `${(result.summary.cullRatio_p95 * 100).toFixed(1)}% |`,
  ].join(" | "));
}

if (LABEL) {
  await mkdir(resultDir, { recursive: true });
  const path = join(resultDir, `${LABEL}.json`);
  await writeFile(path, `${JSON.stringify({
    generatedAt: new Date().toISOString(),
    meshes: MESHES,
    angleStep: ANGLE_STEP,
    grid: [GRID_W, GRID_H],
    results,
  }, null, 2)}\n`);
  console.log(`Wrote ${path}`);
}
