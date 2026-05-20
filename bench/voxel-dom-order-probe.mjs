#!/usr/bin/env node
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve, join } from "node:path";
import { chromium } from "playwright";
import {
  BASE_TILE,
  normalFacesCamera,
  parseVox,
  rotateVec3,
} from "../packages/core/dist/index.js";
import { chromiumArgsWithGpuDefault } from "./chromium-defaults.mjs";
import { PRESETS } from "./perf-shared.mjs";

const repoRoot = resolve(import.meta.dirname, "..");
const galleryDir = resolve(repoRoot, "website/public");
const resultDir = resolve(repoRoot, "bench/results");

const args = new Map(process.argv.slice(2).map((arg) => {
  const [key, ...rest] = arg.replace(/^--/, "").split("=");
  return [key, rest.length ? rest.join("=") : "true"];
}));

const MESHES = (args.get("meshes") ?? "obj-house3,ancient-crash-site,scene-mechanic2")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
const STRATEGIES = (args.get("strategies") ?? "tile4-source,tile4-depth-front,tile4-depth-back,tile4-face,tile4-top-first,tile4-top-last")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
const PAINTS = (args.get("paints") ?? "current-color")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
const LEAF_TRANSFORM_STYLES = (args.get("leaf-transform-styles") ?? "preserve-3d")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
const LEAF_BACKFACES = (args.get("leaf-backfaces") ?? "visible")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
const TRANSFORM_SHAPES = (args.get("transform-shapes") ?? "matrix-scale")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
const LEAF_CONTAINS = (args.get("leaf-contains") ?? "none")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
const OCCLUSIONS = (args.get("occlusions") ?? "none")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
const OCCLUSION_GRID_W = Number(args.get("occlusion-grid-w") ?? 240);
const OCCLUSION_GRID_H = Number(args.get("occlusion-grid-h") ?? 160);
const OCCLUSION_MIN_CELLS = Number(args.get("occlusion-min-cells") ?? 1);
const OCCLUSION_INTERIOR_RADIUS = Number(args.get("occlusion-interior-radius") ?? 0);
const OCCLUSION_DEPTH_BUFFER = args.has("occlusion-depth-buffer");
const OCCLUSION_DEPTH_EPS = Number(args.get("occlusion-depth-eps") ?? 0.01);
const OCCLUSION_PRESERVE_ORDER = args.has("occlusion-preserve-order");
const OCCLUSION_INTERVAL_SAMPLES = Math.max(1, Math.floor(Number(args.get("occlusion-interval-samples") ?? 1)));
const WARMUP_MS = Number(args.get("warmup") ?? 1000);
const SAMPLE_MS = Number(args.get("sample") ?? 5000);
const RUNS = Number(args.get("runs") ?? 1);
const HEADED = args.has("headed");
const BROWSER_EXECUTABLE = args.get("browser-executable") ?? args.get("browser") ?? "";
const SOFTWARE_BACKEND = args.has("software-backend");
const CHROMIUM_ARGS = chromiumArgsWithGpuDefault((args.get("chromium-args") ?? "")
  .split(/\s+/)
  .map((value) => value.trim())
  .filter(Boolean), { softwareBackend: SOFTWARE_BACKEND });
const LABEL = args.get("label") ?? "";
const VISUAL_DIFF = args.has("visual-diff");
const VISUAL_TOLERANCE = Number(args.get("visual-tolerance") ?? 0.005);
const VISUAL_OFFSETS = (args.get("visual-offsets") ?? "0,45,90,135,180,225,270,315")
  .split(",")
  .map((value) => Number(value.trim()))
  .filter(Number.isFinite);
const VISUAL_SAVE = args.has("visual-save");

const FACE_NORMALS = {
  t: [0, 0, 1],
  b: [0, 0, -1],
  fl: [0, 1, 0],
  br: [0, -1, 0],
  fr: [1, 0, 0],
  bl: [-1, 0, 0],
};

const FACE_ORDER = ["t", "b", "bl", "br", "fr", "fl"];
const FACE_INDEX = Object.fromEntries(FACE_ORDER.map((face, index) => [face, index]));
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

function median(values) {
  return quantile(values, 0.5);
}

function summarizeDts(dts) {
  const sorted = dts.filter((value) => value > 0 && value < 2000).sort((a, b) => a - b);
  const p50 = quantile(sorted, 0.5);
  const p95 = quantile(sorted, 0.95);
  const p99 = quantile(sorted, 0.99);
  return {
    frames: sorted.length,
    fps_p50: 1000 / p50,
    fps_p95: 1000 / p95,
    frame_time_p99_ms: p99,
    buckets: {
      x1: sorted.filter((value) => value < 10).length,
      x2: sorted.filter((value) => value >= 10 && value < 18).length,
      x3: sorted.filter((value) => value >= 18 && value < 26).length,
      x4_plus: sorted.filter((value) => value >= 26).length,
    },
  };
}

function visibleFaceSignature(rotation) {
  const visible = [];
  for (const face of FACE_ORDER) {
    if (normalFacesCamera(FACE_NORMALS[face], rotation)) visible.push(face);
  }
  return visible.join("|");
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
  const base = { face, sourceIndex, color: polygon.color || "#cccccc" };
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

function projectedCenter(item, rotation) {
  const [x, y, z] = rotateVec3(itemCenter(item), rotation.rotX, 0, rotation.rotY);
  return { x, y, z };
}

function directMatrix(item, transformShape = "matrix-scale") {
  const { axis, left, top, width, height, z } = item;
  const sx = transformShape === "css-size-unit-matrix" ? 1 : width;
  const sy = transformShape === "css-size-unit-matrix" ? 1 : height;
  const values = axis === "x"
    ? [
        sx, 0, 0, 0,
        0, 0, sy, 0,
        0, -1, 0, 0,
        left, -z, top, 1,
      ]
    : axis === "y"
      ? [
          0, 0, sx, 0,
          0, sy, 0, 0,
          -1, 0, 0, 0,
          -z, top, left, 1,
        ]
      : [
          sx, 0, 0, 0,
          0, sy, 0, 0,
          0, 0, 1, 0,
          left, top, z, 1,
        ];
  return `matrix3d(${values.map((value) => Number(value.toFixed(6))).join(",")})`;
}

function sceneCenter(items) {
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  for (const item of items) {
    for (const [x, y, z] of itemCorners(item)) {
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      minZ = Math.min(minZ, z);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      maxZ = Math.max(maxZ, z);
    }
  }
  return {
    x: (minX + maxX) / 2,
    y: (minY + maxY) / 2,
    z: (minZ + maxZ) / 2,
  };
}

function orderedItems(items, signature, rotation, strategy) {
  const faces = new Set(signature.split("|").filter(Boolean));
  const entries = items
    .filter((item) => faces.has(item.face))
    .map((item) => ({ item, ...projectedCenter(item, rotation) }));
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
    const tile = tiles.get(key) ?? { tx, ty, sourceIndex: entry.item.sourceIndex, entries: [] };
    tile.entries.push(entry);
    tile.sourceIndex = Math.min(tile.sourceIndex, entry.item.sourceIndex);
    tiles.set(key, tile);
  }

  const tileEntries = [...tiles.values()].sort((a, b) =>
    (a.ty - b.ty) || (a.tx - b.tx) || a.sourceIndex - b.sourceIndex
  );

  return tileEntries.flatMap((tile) => {
    const local = [...tile.entries];
    if (strategy === "tile4-depth-front") {
      local.sort((a, b) => b.z - a.z || a.item.sourceIndex - b.item.sourceIndex);
    } else if (strategy === "tile4-depth-back") {
      local.sort((a, b) => a.z - b.z || a.item.sourceIndex - b.item.sourceIndex);
    } else if (strategy === "tile4-face") {
      local.sort((a, b) => FACE_INDEX[a.item.face] - FACE_INDEX[b.item.face] || a.item.sourceIndex - b.item.sourceIndex);
    } else if (strategy === "tile4-top-first") {
      local.sort((a, b) =>
        Number(a.item.face !== "t") - Number(b.item.face !== "t") ||
        a.item.sourceIndex - b.item.sourceIndex
      );
    } else if (strategy === "tile4-top-last") {
      local.sort((a, b) =>
        Number(a.item.face === "t") - Number(b.item.face === "t") ||
        a.item.sourceIndex - b.item.sourceIndex
      );
    }
    return local.map((entry) => entry.item);
  });
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

function buildHtml({ items, preset, strategy, paint, leafTransformStyle, leafBackface, transformShape, leafContain, occlusion, staticRotY = null }) {
  const center = sceneCenter(items);
  const itemData = JSON.stringify(items.map((item) => ({
    ...item,
    transform: directMatrix(item, transformShape),
    cssWidth: transformShape === "css-size-unit-matrix" ? item.width : 1,
    cssHeight: transformShape === "css-size-unit-matrix" ? item.height : 1,
  })));
  const backgroundRule = paint === "current-color" ? "background:currentColor;" : "";
  const containRule = leafContain === "none" ? "" : `contain:${leafContain};`;
  return `<!doctype html><meta charset="utf-8"><style>
body{margin:0;background:#111;overflow:hidden}
#host{position:relative;width:1280px;height:800px;transform-style:preserve-3d}
.scene{position:absolute;left:50%;top:50%;width:0;height:0;transform-style:preserve-3d;perspective:8000px;will-change:transform}
.mesh{position:absolute;left:0;top:0;width:0;height:0;transform-style:preserve-3d;transform-origin:var(--origin)}
b{position:absolute;display:block;top:0;left:0;width:1px;height:1px;${backgroundRule}transform-origin:0 0;transform-style:${leafTransformStyle};${containRule}margin:0;padding:0;font:inherit;font-weight:normal;font-style:normal;line-height:0;text-decoration:none;backface-visibility:${leafBackface};background-repeat:no-repeat;pointer-events:none}
</style><div id="host"><div class="scene"><div class="mesh"></div></div></div><script>
const items=${itemData};
const strategy=${JSON.stringify(strategy)};
const paint=${JSON.stringify(paint)};
const transformShape=${JSON.stringify(transformShape)};
const occlusion=${JSON.stringify(occlusion)};
const occlusionGridW=${OCCLUSION_GRID_W};
const occlusionGridH=${OCCLUSION_GRID_H};
const occlusionMinCells=${OCCLUSION_MIN_CELLS};
const occlusionInteriorRadius=${OCCLUSION_INTERIOR_RADIUS};
const occlusionDepthBuffer=${JSON.stringify(OCCLUSION_DEPTH_BUFFER)};
const occlusionDepthEps=${OCCLUSION_DEPTH_EPS};
const occlusionPreserveOrder=${JSON.stringify(OCCLUSION_PRESERVE_ORDER)};
const occlusionIntervalSamples=${OCCLUSION_INTERVAL_SAMPLES};
const staticRotY=${staticRotY == null ? "null" : JSON.stringify(staticRotY)};
const faceNormals=${JSON.stringify(FACE_NORMALS)};
const faceOrder=${JSON.stringify(FACE_ORDER)};
const preset=${JSON.stringify({ rotX: preset.rotX, rotY: preset.rotY, zoom: preset.zoom })};
const center=${JSON.stringify(center)};
const els=new Map();
const samples=[];
const frames=[];
let frame=0;
let last=performance.now();
let lastSignature="";
const scene=document.querySelector(".scene");
const mesh=document.querySelector(".mesh");
const intervalCullCache=new Map();
function normalFacesCamera(normal, rotX, rotY){
  const rz=rotY*Math.PI/180;
  const rx=rotX*Math.PI/180;
  const cosZ=Math.cos(rz), sinZ=Math.sin(rz);
  const cosX=Math.cos(rx), sinX=Math.sin(rx);
  const x1=normal[0]*cosZ-normal[1]*sinZ;
  const y1=normal[0]*sinZ+normal[1]*cosZ;
  const z2=y1*sinX+normal[2]*cosX;
  return z2>0.001;
}
function signature(rotX, rotY){
  const faces=[];
  for(const face of faceOrder) if(normalFacesCamera(faceNormals[face],rotX,rotY)) faces.push(face);
  return faces.join("|");
}
function rotatePoint(point, rotX, rotY){
  const rz=rotY*Math.PI/180;
  const rx=rotX*Math.PI/180;
  const cosZ=Math.cos(rz), sinZ=Math.sin(rz);
  const cosX=Math.cos(rx), sinX=Math.sin(rx);
  const x1=point[0]*cosZ-point[1]*sinZ;
  const y1=point[0]*sinZ+point[1]*cosZ;
  return {x:x1,y:y1*cosX-point[2]*sinX,z:y1*sinX+point[2]*cosX};
}
function itemCenter(item){
  if(item.axis==="x") return [item.left+item.width/2,-item.z,item.top+item.height/2];
  if(item.axis==="y") return [-item.z,item.top+item.height/2,item.left+item.width/2];
  return [item.left+item.width/2,item.top+item.height/2,item.z];
}
function itemCorners(item){
  if(item.axis==="x") return [[item.left,-item.z,item.top],[item.left+item.width,-item.z,item.top],[item.left+item.width,-item.z,item.top+item.height],[item.left,-item.z,item.top+item.height]];
  if(item.axis==="y") return [[-item.z,item.top,item.left],[-item.z,item.top,item.left+item.width],[-item.z,item.top+item.height,item.left+item.width],[-item.z,item.top+item.height,item.left]];
  return [[item.left,item.top,item.z],[item.left+item.width,item.top,item.z],[item.left+item.width,item.top+item.height,item.z],[item.left,item.top+item.height,item.z]];
}
function pointInConvex(point, poly){
  let sign=0;
  for(let i=0;i<poly.length;i++){
    const a=poly[i], b=poly[(i+1)%poly.length];
    const cross=(b.x-a.x)*(point.y-a.y)-(b.y-a.y)*(point.x-a.x);
    const next=Math.sign(cross);
    if(next===0) continue;
    if(sign===0) sign=next;
    else if(sign!==next) return false;
  }
  return true;
}
function occlusionCullSingle(entries, rotX, rotY){
  if(occlusion!=="grid"||entries.length===0) return entries;
  function depthAt(points,x,y){
    const p0=points[0], p1=points[1], p2=points[2];
    const ux=p1.x-p0.x, uy=p1.y-p0.y, uz=p1.z-p0.z;
    const vx=p2.x-p0.x, vy=p2.y-p0.y, vz=p2.z-p0.z;
    const nx=uy*vz-uz*vy;
    const ny=uz*vx-ux*vz;
    const nz=ux*vy-uy*vx;
    if(Math.abs(nz)<1e-9) return points.reduce((sum,point)=>sum+point.z,0)/points.length;
    return p0.z-(nx*(x-p0.x)+ny*(y-p0.y))/nz;
  }
  const projected=entries.map((entry)=>{
    const points=itemCorners(entry.item).map((point)=>rotatePoint(point,rotX,rotY));
    return {
      ...entry,
      points,
      depth:points.reduce((sum,point)=>sum+point.z,0)/points.length,
      minX:Math.min(...points.map((point)=>point.x)),
      maxX:Math.max(...points.map((point)=>point.x)),
      minY:Math.min(...points.map((point)=>point.y)),
      maxY:Math.max(...points.map((point)=>point.y)),
    };
  });
  const minX=Math.min(...projected.map((entry)=>entry.minX));
  const maxX=Math.max(...projected.map((entry)=>entry.maxX));
  const minY=Math.min(...projected.map((entry)=>entry.minY));
  const maxY=Math.max(...projected.map((entry)=>entry.maxY));
  const spanX=Math.max(1e-6,maxX-minX), spanY=Math.max(1e-6,maxY-minY);
  const occupied=new Uint8Array(occlusionGridW*occlusionGridH);
  const depths=new Float64Array(occlusionGridW*occlusionGridH);
  depths.fill(-Infinity);
  const kept=[];
  const keptSourceIndexes=new Set();
  for(const entry of projected.sort((a,b)=>b.depth-a.depth||a.item.sourceIndex-b.item.sourceIndex)){
    const gx0=Math.max(0,Math.floor(((entry.minX-minX)/spanX)*occlusionGridW));
    const gx1=Math.min(occlusionGridW-1,Math.ceil(((entry.maxX-minX)/spanX)*occlusionGridW));
    const gy0=Math.max(0,Math.floor(((entry.minY-minY)/spanY)*occlusionGridH));
    const gy1=Math.min(occlusionGridH-1,Math.ceil(((entry.maxY-minY)/spanY)*occlusionGridH));
    let hasPixel=false;
    const cells=[];
    for(let gy=gy0;gy<=gy1;gy++){
      const y=minY+((gy+0.5)/occlusionGridH)*spanY;
      for(let gx=gx0;gx<=gx1;gx++){
        const x=minX+((gx+0.5)/occlusionGridW)*spanX;
        if(!pointInConvex({x,y},entry.points)) continue;
        const index=gy*occlusionGridW+gx;
        const z=depthAt(entry.points,x,y);
        cells.push([index,z]);
        const covered=occupied[index]&&(!occlusionDepthBuffer||depths[index]>z+occlusionDepthEps);
        if(!covered) hasPixel=true;
      }
    }
    let hasOpenNeighbor=false;
    if(!hasPixel&&occlusionInteriorRadius>0){
      for(const [index] of cells){
        const cx=index%occlusionGridW;
        const cy=Math.floor(index/occlusionGridW);
        for(let dy=-occlusionInteriorRadius;dy<=occlusionInteriorRadius&&!hasOpenNeighbor;dy++){
          for(let dx=-occlusionInteriorRadius;dx<=occlusionInteriorRadius;dx++){
            const nx=cx+dx, ny=cy+dy;
            if(nx<0||nx>=occlusionGridW||ny<0||ny>=occlusionGridH||!occupied[ny*occlusionGridW+nx]){
              hasOpenNeighbor=true;
              break;
            }
          }
        }
        if(hasOpenNeighbor) break;
      }
    }
    if(cells.length===0||cells.length<occlusionMinCells||hasPixel||hasOpenNeighbor){
      kept.push(entry);
      keptSourceIndexes.add(entry.item.sourceIndex);
      for(const [index,z] of cells){
        occupied[index]=1;
        if(z>depths[index]) depths[index]=z;
      }
    }
  }
  return occlusionPreserveOrder
    ? entries.filter((entry)=>keptSourceIndexes.has(entry.item.sourceIndex))
    : kept;
}
function occlusionIntervalAngles(rotX, rotY, sig){
  if(occlusionIntervalSamples<=1) return [rotY];
  const step=0.5;
  let start=rotY;
  let end=rotY;
  for(let i=0;i<720&&signature(rotX,start-step)===sig;i++) start-=step;
  for(let i=0;i<720&&signature(rotX,end+step)===sig;i++) end+=step;
  if(occlusionIntervalSamples===1||Math.abs(end-start)<1e-6) return [rotY];
  const angles=[rotY];
  for(let i=0;i<occlusionIntervalSamples;i++){
    angles.push(start+((end-start)*i)/(occlusionIntervalSamples-1));
  }
  return [...new Set(angles.map((angle)=>Math.round(angle*1000)/1000))];
}
function occlusionCull(entries, rotX, rotY, sig){
  if(occlusion!=="grid"||entries.length===0||occlusionIntervalSamples<=1){
    return occlusionCullSingle(entries,rotX,rotY);
  }
  let keep=intervalCullCache.get(sig);
  if(!keep){
    keep=new Set();
    for(const angle of occlusionIntervalAngles(rotX,rotY,sig)){
      const sampleEntries=entries.map((entry)=>{
        const projected=rotatePoint(itemCenter(entry.item),rotX,angle);
        return {item:entry.item,...projected};
      });
      for(const entry of occlusionCullSingle(sampleEntries,rotX,angle)){
        keep.add(entry.item.sourceIndex);
      }
    }
    intervalCullCache.set(sig,keep);
  }
  return entries.filter((entry)=>keep.has(entry.item.sourceIndex));
}
function order(rotX, rotY, sig){
  const faces=new Set(sig.split("|").filter(Boolean));
  let entries=items.filter((item)=>faces.has(item.face)).map((item)=>{
    const projected=rotatePoint(itemCenter(item),rotX,rotY);
    return {item,...projected};
  });
  entries=occlusionCull(entries,rotX,rotY,sig);
  if(!entries.length) return [];
  let minX=Infinity,maxX=-Infinity,minY=Infinity,maxY=-Infinity;
  for(const entry of entries){minX=Math.min(minX,entry.x);maxX=Math.max(maxX,entry.x);minY=Math.min(minY,entry.y);maxY=Math.max(maxY,entry.y);}
  const spanX=Math.max(1e-6,maxX-minX), spanY=Math.max(1e-6,maxY-minY);
  const tiles=new Map();
  for(const entry of entries){
    const tx=Math.min(3,Math.max(0,Math.floor(((entry.x-minX)/spanX)*4)));
    const ty=Math.min(3,Math.max(0,Math.floor(((entry.y-minY)/spanY)*4)));
    const key=tx+":"+ty;
    let tile=tiles.get(key);
    if(!tile){tile={tx,ty,sourceIndex:entry.item.sourceIndex,entries:[]};tiles.set(key,tile);}
    tile.entries.push(entry);
    tile.sourceIndex=Math.min(tile.sourceIndex,entry.item.sourceIndex);
  }
  const faceIndex=Object.fromEntries(faceOrder.map((face,index)=>[face,index]));
  function projectedBounds(item){
    const points=itemCorners(item).map((point)=>rotatePoint(point,rotX,rotY));
    const minX=Math.min(...points.map((point)=>point.x));
    const maxX=Math.max(...points.map((point)=>point.x));
    const minY=Math.min(...points.map((point)=>point.y));
    const maxY=Math.max(...points.map((point)=>point.y));
    return {minX,maxX,minY,maxY,area:Math.max(0,maxX-minX)*Math.max(0,maxY-minY)};
  }
  function tileFill(entries){
    if(!entries.length) return 0;
    const rects=entries.map((entry)=>projectedBounds(entry.item));
    const minX=Math.min(...rects.map((rect)=>rect.minX));
    const maxX=Math.max(...rects.map((rect)=>rect.maxX));
    const minY=Math.min(...rects.map((rect)=>rect.minY));
    const maxY=Math.max(...rects.map((rect)=>rect.maxY));
    const area=Math.max(1e-6,(maxX-minX)*(maxY-minY));
    return rects.reduce((sum,rect)=>sum+rect.area,0)/area;
  }
  return [...tiles.values()].sort((a,b)=>a.ty-b.ty||a.tx-b.tx||a.sourceIndex-b.sourceIndex).flatMap((tile)=>{
    const local=[...tile.entries];
    const dense4=tileFill(local)>=4;
    const dense8=tileFill(local)>=8;
    const useDense4=strategy.startsWith("tile4-dense4-")&&dense4;
    const useDense8=strategy.startsWith("tile4-dense8-")&&dense8;
    const effective=(useDense4||useDense8)?strategy.replace(/^tile4-dense[48]-/,"tile4-"):strategy;
    if(effective==="tile4-depth-front") local.sort((a,b)=>b.z-a.z||a.item.sourceIndex-b.item.sourceIndex);
    else if(effective==="tile4-depth-back") local.sort((a,b)=>a.z-b.z||a.item.sourceIndex-b.item.sourceIndex);
    else if(effective==="tile4-face") local.sort((a,b)=>faceIndex[a.item.face]-faceIndex[b.item.face]||a.item.sourceIndex-b.item.sourceIndex);
    else if(effective==="tile4-top-first") local.sort((a,b)=>Number(a.item.face!=="t")-Number(b.item.face!=="t")||a.item.sourceIndex-b.item.sourceIndex);
    else if(effective==="tile4-top-last") local.sort((a,b)=>Number(a.item.face==="t")-Number(b.item.face==="t")||a.item.sourceIndex-b.item.sourceIndex);
    return local.map((entry)=>entry.item);
  });
}
function remount(ordered){
  const fragment=document.createDocumentFragment();
  for(const item of ordered){
    let el=els.get(item.sourceIndex);
    if(!el){
      el=document.createElement("b");
      if(paint==="inline-background") el.style.backgroundColor=item.color;
      else if(paint==="inline-background-shorthand") el.style.background=item.color;
      else el.style.color=item.color;
      if(transformShape==="css-size-unit-matrix"){
        el.style.width=item.cssWidth+"px";
        el.style.height=item.cssHeight+"px";
      }
      el.style.transform=item.transform;
      els.set(item.sourceIndex,el);
    }
    fragment.appendChild(el);
  }
  mesh.replaceChildren(fragment);
}
function tick(now){
  samples.push(now-last);
  last=now;
  frame++;
  const rotY=(preset.rotY+frame*0.5)%360;
  const rotX=preset.rotX;
  scene.style.transform="scale("+preset.zoom+") rotateX("+rotX+"deg) rotate("+rotY+"deg) translate3d("+(-center.x)+"px,"+(-center.y)+"px,"+(-center.z)+"px)";
  const sig=signature(rotX,rotY);
  if(sig!==lastSignature){
    remount(order(rotX,rotY,sig));
    lastSignature=sig;
  }
  frames.push({index:frame,rotY,signature:sig,dt:samples[samples.length-1],leaves:mesh.childElementCount});
  requestAnimationFrame(tick);
}
window.__probe={samples,frames,ready:true};
if(staticRotY===null){
  requestAnimationFrame(tick);
}else{
  const rotX=preset.rotX;
  const rotY=staticRotY;
  scene.style.transform="scale("+preset.zoom+") rotateX("+rotX+"deg) rotate("+rotY+"deg) translate3d("+(-center.x)+"px,"+(-center.y)+"px,"+(-center.z)+"px)";
  const sig=signature(rotX,rotY);
  remount(order(rotX,rotY,sig));
  lastSignature=sig;
  frames.push({index:0,rotY,signature:sig,dt:0,leaves:mesh.childElementCount});
}
</script>`;
}

function segmentFrames(frames) {
  const segments = [];
  let current = null;
  for (const frame of frames) {
    if (!current || current.signature !== frame.signature) {
      current = { signature: frame.signature, startRotY: frame.rotY, endRotY: frame.rotY, frames: [] };
      segments.push(current);
    }
    current.frames.push(frame);
    current.endRotY = frame.rotY;
  }
  return segments.map((segment) => ({
    signature: segment.signature,
    startRotY: segment.startRotY,
    endRotY: segment.endRotY,
    leaves: median(segment.frames.map((frame) => frame.leaves)),
    ...summarizeDts(segment.frames.map((frame) => frame.dt)),
  }));
}

async function runCase(browser, meshId, strategy, paint, leafTransformStyle, leafBackface, transformShape, leafContain, occlusion, repeat) {
  const { preset, items } = await loadItems(meshId);
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.setContent(buildHtml({ items, preset, strategy, paint, leafTransformStyle, leafBackface, transformShape, leafContain, occlusion }), { waitUntil: "load" });
  await page.waitForFunction(() => window.__probe?.ready === true, null, { timeout: 30000 });
  await page.waitForTimeout(WARMUP_MS);
  const start = await page.evaluate(() => window.__probe.samples.length);
  await page.waitForTimeout(SAMPLE_MS);
  const result = await page.evaluate((from) => ({
    samples: window.__probe.samples.slice(from),
    frames: window.__probe.frames.slice(from),
  }), start);
  await page.close();
  return {
    mesh: meshId,
    strategy,
    paint,
    leafTransformStyle,
    leafBackface,
    transformShape,
    leafContain,
    occlusion,
    repeat,
    warmup_ms: WARMUP_MS,
    sample_ms: SAMPLE_MS,
    leaves_p50: median(result.frames.map((frame) => frame.leaves)),
    ...summarizeDts(result.samples),
    segments: segmentFrames(result.frames),
  };
}

function fmt(value, digits = 1) {
  return Number.isFinite(value) ? value.toFixed(digits) : "";
}

function printRows(rows) {
  console.log("| Mesh | Strategy | Paint | Leaf transform-style | Backface | Transform shape | Contain | Occlusion | Leaves p50 | p50 FPS | p95 FPS | p99 ms | Frames | x1 | x2 | x3 | x4+ |");
  console.log("| --- | --- | --- | --- | --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |");
  for (const row of rows) {
    console.log([
      `| ${row.mesh}`,
      row.strategy,
      row.paint,
      row.leafTransformStyle,
      row.leafBackface,
      row.transformShape,
      row.leafContain,
      row.occlusion,
      fmt(row.leaves_p50, 0),
      fmt(row.fps_p50),
      fmt(row.fps_p95),
      fmt(row.frame_time_p99_ms),
      row.frames,
      row.buckets.x1,
      row.buckets.x2,
      row.buckets.x3,
      `${row.buckets.x4_plus} |`,
    ].join(" | "));
  }
}

async function compareScreenshots(page, baseline, candidate) {
  return await page.evaluate(async ({ baselineB64, candidateB64 }) => {
    async function loadPng(b64) {
      const img = new Image();
      img.src = `data:image/png;base64,${b64}`;
      await img.decode();
      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0);
      return ctx.getImageData(0, 0, canvas.width, canvas.height);
    }
    const [a, b] = await Promise.all([loadPng(baselineB64), loadPng(candidateB64)]);
    if (a.width !== b.width || a.height !== b.height) {
      return { ok: false, reason: "size", a: [a.width, a.height], b: [b.width, b.height] };
    }
    let sum = 0;
    let maxPixelDelta = 0;
    let changedPixels = 0;
    const pixels = a.width * a.height;
    for (let i = 0; i < a.data.length; i += 4) {
      const dr = Math.abs(a.data[i] - b.data[i]);
      const dg = Math.abs(a.data[i + 1] - b.data[i + 1]);
      const db = Math.abs(a.data[i + 2] - b.data[i + 2]);
      const pixelDelta = (dr + dg + db) / (3 * 255);
      sum += dr + dg + db;
      maxPixelDelta = Math.max(maxPixelDelta, pixelDelta);
      if (pixelDelta > 8 / 255) changedPixels += 1;
    }
    return {
      ok: true,
      mean_delta: sum / (pixels * 3 * 255),
      max_pixel_delta: maxPixelDelta,
      changed_ratio: changedPixels / pixels,
    };
  }, {
    baselineB64: baseline.toString("base64"),
    candidateB64: candidate.toString("base64"),
  });
}

async function captureStatic(browser, config) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  try {
    await page.setContent(buildHtml(config), { waitUntil: "load" });
    await page.waitForFunction(() => window.__probe?.ready === true, null, { timeout: 30000 });
    await page.waitForTimeout(150);
    const meta = await page.evaluate(() => ({
      leaves: document.querySelector(".mesh")?.childElementCount ?? 0,
      frame: window.__probe?.frames?.[0] ?? null,
    }));
    const screenshot = await page.screenshot({ fullPage: false });
    return { screenshot, meta };
  } finally {
    await page.close();
  }
}

async function runVisualDiff(browser) {
  const rows = [];
  const screenshotDir = join(resultDir, "occlusion-visual");
  if (VISUAL_SAVE) await mkdir(screenshotDir, { recursive: true });
  const comparePage = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  try {
    for (const mesh of MESHES) {
      const { preset, items } = await loadItems(mesh);
      for (const offset of VISUAL_OFFSETS) {
        const rotY = (preset.rotY + offset + 360) % 360;
        const baseConfig = {
          items,
          preset,
          strategy: STRATEGIES[0] ?? "tile4-source",
          paint: PAINTS[0] ?? "current-color",
          leafTransformStyle: LEAF_TRANSFORM_STYLES[0] ?? "preserve-3d",
          leafBackface: LEAF_BACKFACES[0] ?? "visible",
          transformShape: TRANSFORM_SHAPES[0] ?? "matrix-scale",
          leafContain: LEAF_CONTAINS[0] ?? "none",
          occlusion: "none",
          staticRotY: rotY,
        };
        const candidateConfig = { ...baseConfig, occlusion: "grid" };
        const baseline = await captureStatic(browser, baseConfig);
        const candidate = await captureStatic(browser, candidateConfig);
        const cmp = await compareScreenshots(comparePage, baseline.screenshot, candidate.screenshot);
        const row = {
          mesh,
          offset,
          rotY,
          baselineLeaves: baseline.meta.leaves,
          candidateLeaves: candidate.meta.leaves,
          removedLeaves: baseline.meta.leaves - candidate.meta.leaves,
          removedRatio: baseline.meta.leaves ? (baseline.meta.leaves - candidate.meta.leaves) / baseline.meta.leaves : 0,
          ...cmp,
          pass: Boolean(cmp.ok && cmp.mean_delta <= VISUAL_TOLERANCE),
        };
        rows.push(row);
        if (VISUAL_SAVE) {
          await writeFile(join(screenshotDir, `${mesh}-${offset}-none.png`), baseline.screenshot);
          await writeFile(join(screenshotDir, `${mesh}-${offset}-grid.png`), candidate.screenshot);
        }
      }
    }
  } finally {
    await comparePage.close();
  }

  console.log("| Mesh | Offset | Removed | Mean Δ | Changed | Max pixel Δ | Pass |");
  console.log("| --- | ---: | ---: | ---: | ---: | ---: | --- |");
  for (const row of rows) {
    console.log([
      `| ${row.mesh}`,
      row.offset,
      `${row.removedLeaves} (${(row.removedRatio * 100).toFixed(1)}%)`,
      row.ok ? row.mean_delta.toFixed(5) : row.reason,
      row.ok ? `${(row.changed_ratio * 100).toFixed(2)}%` : "",
      row.ok ? row.max_pixel_delta.toFixed(3) : "",
      `${row.pass ? "yes" : "no"} |`,
    ].join(" | "));
  }
  const pass = rows.every((row) => row.pass);
  if (LABEL) {
    await mkdir(resultDir, { recursive: true });
    const path = join(resultDir, `${LABEL}.json`);
      await writeFile(path, `${JSON.stringify({
        generatedAt: new Date().toISOString(),
        tolerance: VISUAL_TOLERANCE,
        browserExecutable: BROWSER_EXECUTABLE || null,
        chromiumArgs: CHROMIUM_ARGS,
        softwareBackend: SOFTWARE_BACKEND,
        visualOffsets: VISUAL_OFFSETS,
      occlusionGrid: [OCCLUSION_GRID_W, OCCLUSION_GRID_H],
      occlusionMinCells: OCCLUSION_MIN_CELLS,
      occlusionInteriorRadius: OCCLUSION_INTERIOR_RADIUS,
      occlusionDepthBuffer: OCCLUSION_DEPTH_BUFFER,
      occlusionDepthEps: OCCLUSION_DEPTH_EPS,
      occlusionPreserveOrder: OCCLUSION_PRESERVE_ORDER,
      occlusionIntervalSamples: OCCLUSION_INTERVAL_SAMPLES,
      pass,
      rows,
    }, null, 2)}\n`);
    console.log(`Wrote ${path}`);
  }
  return pass;
}

const browser = await chromium.launch({
  headless: !HEADED,
  args: [
    "--disable-background-timer-throttling",
    "--disable-renderer-backgrounding",
    "--disable-backgrounding-occluded-windows",
    ...CHROMIUM_ARGS,
  ],
  ...(BROWSER_EXECUTABLE ? { executablePath: BROWSER_EXECUTABLE } : {}),
});

try {
  if (VISUAL_DIFF) {
    const pass = await runVisualDiff(browser);
    if (!pass) process.exitCode = 1;
  } else {
    const rows = [];
    for (const mesh of MESHES) {
      for (const strategy of STRATEGIES) {
        for (const paint of PAINTS) {
          for (const leafTransformStyle of LEAF_TRANSFORM_STYLES) {
            for (const leafBackface of LEAF_BACKFACES) {
              for (const transformShape of TRANSFORM_SHAPES) {
                for (const leafContain of LEAF_CONTAINS) {
                  for (const occlusion of OCCLUSIONS) {
                    for (let repeat = 1; repeat <= RUNS; repeat += 1) {
                      rows.push(await runCase(browser, mesh, strategy, paint, leafTransformStyle, leafBackface, transformShape, leafContain, occlusion, repeat));
                    }
                  }
                }
              }
            }
          }
        }
      }
    }

    printRows(rows);

    if (LABEL) {
      await mkdir(resultDir, { recursive: true });
      const path = join(resultDir, `${LABEL}.json`);
      await writeFile(path, `${JSON.stringify({
        generatedAt: new Date().toISOString(),
        browserExecutable: BROWSER_EXECUTABLE || null,
        chromiumArgs: CHROMIUM_ARGS,
        softwareBackend: SOFTWARE_BACKEND,
        meshes: MESHES,
        strategies: STRATEGIES,
        paints: PAINTS,
        leafTransformStyles: LEAF_TRANSFORM_STYLES,
        leafBackfaces: LEAF_BACKFACES,
        transformShapes: TRANSFORM_SHAPES,
        leafContains: LEAF_CONTAINS,
        occlusions: OCCLUSIONS,
        occlusionGrid: [OCCLUSION_GRID_W, OCCLUSION_GRID_H],
        occlusionMinCells: OCCLUSION_MIN_CELLS,
        occlusionInteriorRadius: OCCLUSION_INTERIOR_RADIUS,
        occlusionDepthBuffer: OCCLUSION_DEPTH_BUFFER,
        occlusionDepthEps: OCCLUSION_DEPTH_EPS,
        occlusionPreserveOrder: OCCLUSION_PRESERVE_ORDER,
        occlusionIntervalSamples: OCCLUSION_INTERVAL_SAMPLES,
        warmup_ms: WARMUP_MS,
        sample_ms: SAMPLE_MS,
        runs: rows,
      }, null, 2)}\n`);
      console.log(`Wrote ${path}`);
    }
  }
} finally {
  await browser.close();
}
