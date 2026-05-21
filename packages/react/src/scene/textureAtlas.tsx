import { useCallback, useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import type React from "react";
import type {
  PolyAmbientLight,
  PolyDirectionalLight,
  Polygon,
  PolyTextureLightingMode,
  Vec2,
  Vec3,
} from "@layoutit/polycss-core";
import { parsePureColor } from "@layoutit/polycss-core";
import {
  type TextureAtlasPlan,
  type PackedTextureAtlasEntry,
  type TextureAtlasPage,
  type PackedAtlas,
  type PackedPage,
  type SolidPaintDefaults,
  type PolyRenderStrategy,
  type PolyRenderStrategiesOption,
  type TextureQuality,
  type ComputeTextureAtlasPlanOptions,
  isSolidTrianglePlan,
  isProjectiveQuadPlan,
  isFullRectSolid,
  buildTextureEdgeRepairSets,
  computeTextureAtlasPlanPublic,
  getSolidPaintDefaultsFromPlans,
  cssBorderShapeForPlan,
  formatMatrix3d,
  formatCssLengthPx,
  formatSolidQuadEntryMatrix,
  formatBorderShapeEntryMatrix,
  isBorderShapeSupported,
  isSolidTriangleSupported,
  filterAtlasPlans,
  packTextureAtlasPlansWithScale,
  buildAtlasPages,
} from "@layoutit/polycss";

// Re-export pure types and functions so existing consumers of this module's
// public surface still get them without changing their import paths.
export type {
  TextureAtlasPlan,
  PackedTextureAtlasEntry,
  TextureAtlasPage,
  SolidPaintDefaults,
  PolyRenderStrategy,
  PolyRenderStrategiesOption,
  TextureQuality,
};
export {
  isSolidTrianglePlan,
  isProjectiveQuadPlan,
  buildTextureEdgeRepairSets,
  cssBorderShapeForPlan,
  getSolidPaintDefaults as getSolidPaintDefaultsFromPlans,
};

// Public re-export of computeTextureAtlasPlan (simple signature) so callers
// that import it from this module continue to work.
export function computeTextureAtlasPlan(
  polygon: Polygon,
  index: number,
  options: ComputeTextureAtlasPlanOptions = {},
): TextureAtlasPlan | null {
  return computeTextureAtlasPlanPublic(polygon, index, options);
}

// --- getSolidPaintDefaults (plan-array signature used by PolyMesh) ----------

export function getSolidPaintDefaults(
  plans: Array<TextureAtlasPlan | null>,
  textureLighting: PolyTextureLightingMode,
): SolidPaintDefaults {
  const disabled = new Set<PolyRenderStrategy>();
  return getSolidPaintDefaultsFromPlans(plans, textureLighting, disabled);
}

// ---------------------------------------------------------------------------
// Internal helpers used by solidTriangleStyle and updateStableTriangleDom
// ---------------------------------------------------------------------------

const DEFAULT_TILE = 50;
const DEFAULT_LIGHT_DIR: Vec3 = [0.4, -0.7, 0.59];
const DEFAULT_LIGHT_COLOR = "#ffffff";
const DEFAULT_LIGHT_INTENSITY = 1;
const DEFAULT_AMBIENT_COLOR = "#ffffff";
const DEFAULT_AMBIENT_INTENSITY = 0.4;
const BASIS_EPS = 1e-9;
// Matches the canonical SOLID_TRIANGLE_BLEED constant.
const SOLID_TRIANGLE_BLEED = 0.75;

interface RGB { r: number; g: number; b: number; }

interface StableTriangleBasis {
  a: number;
  b: number;
  c: number;
}

interface StableTriangleDomElement extends HTMLElement {
  __polycssStableTriangleBasis?: StableTriangleBasis;
  __polycssStableTriangleColor?: string;
  __polycssStableTriangleColorRgb?: RGB;
}

export interface StableTriangleDomUpdateOptions {
  directionalLight?: PolyDirectionalLight;
  ambientLight?: PolyAmbientLight;
  textureLighting?: PolyTextureLightingMode;
  colorFrame?: number;
  colorSteps?: number;
  colorFreezeFrames?: number;
  colorMaxStep?: number;
}

// TextureAtlasResult exposed by useTextureAtlas.
export interface TextureAtlasResult {
  entries: Array<PackedTextureAtlasEntry | null>;
  pages: TextureAtlasPage[];
  ready: boolean;
}

function parseHex(hex: string): RGB {
  const parsed = parsePureColor(hex);
  if (!parsed) return { r: 255, g: 255, b: 255 };
  return { r: parsed.rgb[0], g: parsed.rgb[1], b: parsed.rgb[2] };
}

function rgbKey({ r, g, b }: RGB): string {
  return `${r},${g},${b}`;
}

function parseAlpha(input: string): number {
  return parsePureColor(input)?.alpha ?? 1;
}

function rgbToHex({ r, g, b }: RGB): string {
  const f = (n: number) =>
    Math.round(Math.max(0, Math.min(255, n))).toString(16).padStart(2, "0");
  return `#${f(r)}${f(g)}${f(b)}`;
}

function shadePolygon(
  baseColor: string,
  directScale: number,
  lightColor: string,
  ambientColor: string,
  ambientIntensity: number,
): string {
  const base = parseHex(baseColor);
  const light = parseHex(lightColor);
  const amb = parseHex(ambientColor);
  const tintR = (amb.r / 255) * ambientIntensity + (light.r / 255) * directScale;
  const tintG = (amb.g / 255) * ambientIntensity + (light.g / 255) * directScale;
  const tintB = (amb.b / 255) * ambientIntensity + (light.b / 255) * directScale;
  const r = Math.max(0, Math.min(255, Math.round(base.r * tintR)));
  const g = Math.max(0, Math.min(255, Math.round(base.g * tintG)));
  const b = Math.max(0, Math.min(255, Math.round(base.b * tintB)));
  const alpha = parseAlpha(baseColor);
  return alpha < 1
    ? `rgba(${r}, ${g}, ${b}, ${alpha})`
    : rgbToHex({ r, g, b });
}

function quantizeCssColor(input: string, steps: number): string {
  if (!Number.isFinite(steps) || steps <= 1) return input;
  const parsed = parsePureColor(input);
  if (!parsed) return input;
  const channelStep = 255 / Math.max(1, Math.round(steps) - 1);
  const quantize = (value: number) =>
    Math.max(0, Math.min(255, Math.round(Math.round(value / channelStep) * channelStep)));
  const rgb = {
    r: quantize(parsed.rgb[0]),
    g: quantize(parsed.rgb[1]),
    b: quantize(parsed.rgb[2]),
  };
  return parsed.alpha < 1
    ? `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${parsed.alpha})`
    : rgbToHex(rgb);
}

function stepRgbToward(current: RGB, target: RGB, maxStep: number): RGB {
  const step = (from: number, to: number) => {
    if (from === to) return from;
    const delta = to - from;
    return from + Math.sign(delta) * Math.min(Math.abs(delta), maxStep);
  };
  return {
    r: step(current.r, target.r),
    g: step(current.g, target.g),
    b: step(current.b, target.b),
  };
}

function dotVec(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function crossVec(a: Vec3, b: Vec3): Vec3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function computeSurfaceNormal(pts: Vec3[]): Vec3 | null {
  if (pts.length < 3) return null;
  const p0 = pts[0];
  const normal: Vec3 = [0, 0, 0];
  for (let i = 1; i + 1 < pts.length; i++) {
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const e1: Vec3 = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]];
    const e2: Vec3 = [p2[0] - p0[0], p2[1] - p0[1], p2[2] - p0[2]];
    normal[0] -= e1[1] * e2[2] - e1[2] * e2[1];
    normal[1] -= e1[2] * e2[0] - e1[0] * e2[2];
    normal[2] -= e1[0] * e2[1] - e1[1] * e2[0];
  }
  const len = Math.hypot(normal[0], normal[1], normal[2]);
  if (len <= BASIS_EPS) return null;
  return [normal[0] / len, normal[1] / len, normal[2] / len];
}

function isConvexPolygonPoints(points: Array<[number, number]>): boolean {
  if (points.length < 3) return false;
  let sign = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    const c = points[(i + 2) % points.length];
    const cross = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
    if (Math.abs(cross) <= BASIS_EPS) return false;
    const nextSign = Math.sign(cross);
    if (sign === 0) sign = nextSign;
    else if (nextSign !== sign) return false;
  }
  return true;
}

function signedArea2D(points: Array<[number, number]>): number {
  let area = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    area += a[0] * b[1] - a[1] * b[0];
  }
  return area / 2;
}

function intersect2DLines(
  a0: [number, number],
  a1: [number, number],
  b0: [number, number],
  b1: [number, number],
): [number, number] | null {
  const rx = a1[0] - a0[0];
  const ry = a1[1] - a0[1];
  const sx = b1[0] - b0[0];
  const sy = b1[1] - b0[1];
  const det = rx * sy - ry * sx;
  if (Math.abs(det) <= BASIS_EPS) return null;
  const qpx = b0[0] - a0[0];
  const qpy = b0[1] - a0[1];
  const t = (qpx * sy - qpy * sx) / det;
  return [a0[0] + t * rx, a0[1] + t * ry];
}

function expandClipPoints(points: number[], amount: number): number[] {
  if (points.length < 6 || amount <= 0) return points;
  let cx = 0;
  let cy = 0;
  const count = points.length / 2;
  for (let i = 0; i < points.length; i += 2) {
    cx += points[i];
    cy += points[i + 1];
  }
  cx /= count;
  cy /= count;
  const expanded = points.slice();
  for (let i = 0; i < expanded.length; i += 2) {
    const dx = expanded[i] - cx;
    const dy = expanded[i + 1] - cy;
    const len = Math.hypot(dx, dy);
    if (len <= BASIS_EPS) continue;
    expanded[i] += (dx / len) * amount;
    expanded[i + 1] += (dy / len) * amount;
  }
  return expanded;
}

function offsetConvexPolygonPoints(points: number[], amount: number): number[] {
  if (points.length < 6 || points.length % 2 !== 0 || amount <= 0) return points;
  const q: Array<[number, number]> = [];
  for (let i = 0; i < points.length; i += 2) q.push([points[i], points[i + 1]]);
  if (!isConvexPolygonPoints(q)) return expandClipPoints(points, amount);
  const area = signedArea2D(q);
  if (Math.abs(area) <= BASIS_EPS) return expandClipPoints(points, amount);
  const outwardSign = area > 0 ? 1 : -1;
  const offsetLines: Array<{ a: [number, number]; b: [number, number] }> = [];
  for (let i = 0; i < q.length; i++) {
    const a = q[i];
    const b = q[(i + 1) % q.length];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const length = Math.hypot(dx, dy);
    if (length <= BASIS_EPS) return expandClipPoints(points, amount);
    const ox = outwardSign * (dy / length) * amount;
    const oy = outwardSign * (-dx / length) * amount;
    offsetLines.push({ a: [a[0] + ox, a[1] + oy], b: [b[0] + ox, b[1] + oy] });
  }
  const expanded: number[] = [];
  const maxMiter = Math.max(2, amount * 4);
  for (let i = 0; i < q.length; i++) {
    const prev = offsetLines[(i + q.length - 1) % q.length];
    const next = offsetLines[i];
    const intersection = intersect2DLines(prev.a, prev.b, next.a, next.b);
    if (!intersection) return expandClipPoints(points, amount);
    const original = q[i];
    const dx = intersection[0] - original[0];
    const dy = intersection[1] - original[1];
    const miter = Math.hypot(dx, dy);
    if (miter > maxMiter) {
      expanded.push(original[0] + (dx / miter) * maxMiter, original[1] + (dy / miter) * maxMiter);
    } else {
      expanded.push(intersection[0], intersection[1]);
    }
  }
  return expanded;
}

function offsetStableTrianglePoints(
  left: number,
  right: number,
  height: number,
  amount: number,
): number[] {
  const baseWidth = left + right;
  if (
    amount <= 0 ||
    height <= BASIS_EPS ||
    baseWidth <= BASIS_EPS ||
    !Number.isFinite(left + right + height + amount)
  ) {
    return offsetConvexPolygonPoints([left, 0, 0, height, baseWidth, height], amount);
  }
  const leftLen = Math.sqrt(left * left + height * height);
  const rightLen = Math.sqrt(right * right + height * height);
  if (leftLen <= BASIS_EPS || rightLen <= BASIS_EPS) {
    return offsetConvexPolygonPoints([left, 0, 0, height, baseWidth, height], amount);
  }
  const leftOffsetX = -amount * height / leftLen;
  const leftOffsetY = -amount * left / leftLen;
  const rightOffsetX = amount * height / rightLen;
  const rightOffsetY = -amount * right / rightLen;
  const apexLineLeftX = left + leftOffsetX;
  const apexLineLeftY = leftOffsetY;
  const apexLineRightX = baseWidth + rightOffsetX;
  const apexLineRightY = height + rightOffsetY;
  const det = -height * baseWidth;
  if (Math.abs(det) <= BASIS_EPS) {
    return offsetConvexPolygonPoints([left, 0, 0, height, baseWidth, height], amount);
  }
  const qx = apexLineLeftX - apexLineRightX;
  const qy = apexLineLeftY - apexLineRightY;
  const t = (qx * height + qy * left) / det;
  let apexX = apexLineRightX - t * right;
  let apexY = apexLineRightY - t * height;
  let baseLeftX = -amount * (left + leftLen) / height;
  let baseLeftY = height + amount;
  let baseRightX = baseWidth + amount * (right + rightLen) / height;
  let baseRightY = baseLeftY;
  const maxMiter = Math.max(2, amount * 4);
  const apexDx = apexX - left;
  const apexDy = apexY;
  const apexMiter = Math.sqrt(apexDx * apexDx + apexDy * apexDy);
  if (apexMiter > maxMiter) {
    apexX = left + (apexDx / apexMiter) * maxMiter;
    apexY = (apexDy / apexMiter) * maxMiter;
  }
  const leftMiter = Math.sqrt(baseLeftX * baseLeftX + amount * amount);
  if (leftMiter > maxMiter) {
    baseLeftX = (baseLeftX / leftMiter) * maxMiter;
    baseLeftY = height + (amount / leftMiter) * maxMiter;
  }
  const rightDx = baseRightX - baseWidth;
  const rightMiter = Math.sqrt(rightDx * rightDx + amount * amount);
  if (rightMiter > maxMiter) {
    baseRightX = baseWidth + (rightDx / rightMiter) * maxMiter;
    baseRightY = height + (amount / rightMiter) * maxMiter;
  }
  return [apexX, apexY, baseLeftX, baseLeftY, baseRightX, baseRightY];
}

function formatStableTriangleTransformScalars(
  x0: number, x1: number, x2: number,
  y0: number, y1: number, y2: number,
  z0: number, z1: number, z2: number,
  tx0: number, tx1: number, tx2: number,
): string {
  const rx0 = Math.round(x0 * 1000) / 1000 || 0;
  const rx1 = Math.round(x1 * 1000) / 1000 || 0;
  const rx2 = Math.round(x2 * 1000) / 1000 || 0;
  const ry0 = Math.round(y0 * 1000) / 1000 || 0;
  const ry1 = Math.round(y1 * 1000) / 1000 || 0;
  const ry2 = Math.round(y2 * 1000) / 1000 || 0;
  const rz0 = Math.round(z0 * 1000) / 1000 || 0;
  const rz1 = Math.round(z1 * 1000) / 1000 || 0;
  const rz2 = Math.round(z2 * 1000) / 1000 || 0;
  const rtx0 = Math.round(tx0 * 1000) / 1000 || 0;
  const rtx1 = Math.round(tx1 * 1000) / 1000 || 0;
  const rtx2 = Math.round(tx2 * 1000) / 1000 || 0;
  return `matrix3d(${rx0},${rx1},${rx2},0,${ry0},${ry1},${ry2},0,${rz0},${rz1},${rz2},0,${rtx0},${rtx1},${rtx2},1)`;
}

function cssPoints(vertices: Vec3[], tile: number, elev: number): Vec3[] {
  return vertices.map((v) => [v[1] * tile, v[0] * tile, v[2] * elev]);
}

// Generates React CSSProperties for a solid-triangle (<u>) leaf.
// Uses canonical SOLID_TRIANGLE_BLEED = 0.75 to match the polycss renderer.
function solidTriangleStyle(
  entry: TextureAtlasPlan,
  textureLighting: PolyTextureLightingMode,
  pointerEvents: "auto" | "none",
  solidPaintDefaults?: SolidPaintDefaults,
): CSSProperties | null {
  if (!isSolidTrianglePlan(entry)) return null;

  const tile = entry.tileSize;
  const elev = entry.layerElevation;
  const pts = cssPoints(entry.polygon.vertices, tile, elev);
  const normal = computeSurfaceNormal(pts);
  if (!normal) return null;

  const edges = [
    { a: 0, b: 1, c: 2 },
    { a: 1, b: 2, c: 0 },
    { a: 2, b: 0, c: 1 },
  ].map((edge) => {
    const av = pts[edge.a];
    const bv = pts[edge.b];
    return {
      ...edge,
      length: Math.hypot(bv[0] - av[0], bv[1] - av[1], bv[2] - av[2]),
    };
  }).sort((a, b) => b.length - a.length);

  let a = edges[0].a;
  let b = edges[0].b;
  const c = edges[0].c;
  let av = pts[a];
  let bv = pts[b];
  const cv = pts[c];
  let baseLength = edges[0].length;
  if (baseLength <= BASIS_EPS) return null;

  let xAxis: Vec3 = [
    (bv[0] - av[0]) / baseLength,
    (bv[1] - av[1]) / baseLength,
    (bv[2] - av[2]) / baseLength,
  ];
  const ac: Vec3 = [cv[0] - av[0], cv[1] - av[1], cv[2] - av[2]];
  let apexX = dotVec(ac, xAxis);
  let foot: Vec3 = [
    av[0] + xAxis[0] * apexX,
    av[1] + xAxis[1] * apexX,
    av[2] + xAxis[2] * apexX,
  ];
  let yAxisRaw: Vec3 = [foot[0] - cv[0], foot[1] - cv[1], foot[2] - cv[2]];
  const height = Math.hypot(yAxisRaw[0], yAxisRaw[1], yAxisRaw[2]);
  if (height <= BASIS_EPS) return null;
  let yAxis: Vec3 = [yAxisRaw[0] / height, yAxisRaw[1] / height, yAxisRaw[2] / height];

  if (dotVec(crossVec(xAxis, yAxis), normal) < 0) {
    const nextA = b;
    b = a;
    a = nextA;
    av = pts[a];
    bv = pts[b];
    baseLength = Math.hypot(bv[0] - av[0], bv[1] - av[1], bv[2] - av[2]);
    if (baseLength <= BASIS_EPS) return null;
    xAxis = [
      (bv[0] - av[0]) / baseLength,
      (bv[1] - av[1]) / baseLength,
      (bv[2] - av[2]) / baseLength,
    ];
    const nextAc: Vec3 = [cv[0] - av[0], cv[1] - av[1], cv[2] - av[2]];
    apexX = dotVec(nextAc, xAxis);
    foot = [
      av[0] + xAxis[0] * apexX,
      av[1] + xAxis[1] * apexX,
      av[2] + xAxis[2] * apexX,
    ];
    yAxisRaw = [foot[0] - cv[0], foot[1] - cv[1], foot[2] - cv[2]];
    const nextHeight = Math.hypot(yAxisRaw[0], yAxisRaw[1], yAxisRaw[2]);
    if (nextHeight <= BASIS_EPS) return null;
    yAxis = [yAxisRaw[0] / nextHeight, yAxisRaw[1] / nextHeight, yAxisRaw[2] / nextHeight];
  }

  const SOLID_TRIANGLE_CANONICAL_SIZE = 64;
  const left = Math.max(0, Math.min(baseLength, apexX));
  const right = Math.max(0, baseLength - left);
  const expanded = offsetConvexPolygonPoints([left, 0, 0, height, left + right, height], SOLID_TRIANGLE_BLEED);
  const apex2: Vec2 = [expanded[0], expanded[1]];
  const baseLeft2: Vec2 = [expanded[2], expanded[3]];
  const baseRight2: Vec2 = [expanded[4], expanded[5]];
  const baseY = (baseLeft2[1] + baseRight2[1]) / 2;
  const leftPx = apex2[0] - baseLeft2[0];
  const rightPx = baseRight2[0] - apex2[0];
  const heightPx = baseY - apex2[1];
  if (
    leftPx <= BASIS_EPS ||
    rightPx <= BASIS_EPS ||
    heightPx <= BASIS_EPS ||
    !Number.isFinite(leftPx + rightPx + heightPx)
  ) {
    return null;
  }
  const dynamic = textureLighting === "dynamic";
  const base = parseHex(entry.polygon.color ?? "#cccccc");
  const useDefaultDynamicColor = dynamic && rgbKey(base) === solidPaintDefaults?.dynamicColorKey;
  const sharedStyle = {
    color: dynamic || entry.shadedColor === solidPaintDefaults?.paintColor
      ? undefined
      : entry.shadedColor,
    pointerEvents: pointerEvents === "none" ? "none" as const : undefined,
    ...(dynamic && !useDefaultDynamicColor
      ? {
          ["--pnx" as string]: normal[0].toFixed(4),
          ["--pny" as string]: normal[1].toFixed(4),
          ["--pnz" as string]: normal[2].toFixed(4),
          ["--psr" as string]: (base.r / 255).toFixed(4),
          ["--psg" as string]: (base.g / 255).toFixed(4),
          ["--psb" as string]: (base.b / 255).toFixed(4),
        }
      : dynamic
        ? {
            ["--pnx" as string]: normal[0].toFixed(4),
            ["--pny" as string]: normal[1].toFixed(4),
            ["--pnz" as string]: normal[2].toFixed(4),
          }
        : null),
  };

  const worldPoint = ([x, y]: Vec2): Vec3 => [
    cv[0] + (x - left) * xAxis[0] + y * yAxis[0],
    cv[1] + (x - left) * xAxis[1] + y * yAxis[1],
    cv[2] + (x - left) * xAxis[2] + y * yAxis[2],
  ];
  const apex = worldPoint(apex2);
  const baseLeft = worldPoint([baseLeft2[0], baseY]);
  const baseRight = worldPoint([baseRight2[0], baseY]);

  const halfBase = SOLID_TRIANGLE_CANONICAL_SIZE / 2;
  const xCol: Vec3 = [
    (baseRight[0] - baseLeft[0]) / SOLID_TRIANGLE_CANONICAL_SIZE,
    (baseRight[1] - baseLeft[1]) / SOLID_TRIANGLE_CANONICAL_SIZE,
    (baseRight[2] - baseLeft[2]) / SOLID_TRIANGLE_CANONICAL_SIZE,
  ];
  const txCol: Vec3 = [
    apex[0] - xCol[0] * halfBase,
    apex[1] - xCol[1] * halfBase,
    apex[2] - xCol[2] * halfBase,
  ];
  const yCol: Vec3 = [
    (baseLeft[0] - txCol[0]) / SOLID_TRIANGLE_CANONICAL_SIZE,
    (baseLeft[1] - txCol[1]) / SOLID_TRIANGLE_CANONICAL_SIZE,
    (baseLeft[2] - txCol[2]) / SOLID_TRIANGLE_CANONICAL_SIZE,
  ];
  const canonicalMatrix = [
    xCol[0], xCol[1], xCol[2], 0,
    yCol[0], yCol[1], yCol[2], 0,
    normal[0], normal[1], normal[2], 0,
    txCol[0], txCol[1], txCol[2], 1,
  ].map((v) => (Math.round(v * 1000) / 1000 || 0).toString()).join(",");
  return {
    transform: `matrix3d(${canonicalMatrix})`,
    ...sharedStyle,
  };
}

// ---------------------------------------------------------------------------
// updateStableTriangleDom — imperative DOM fast-path for triangle meshes
// This is React-specific: it writes directly to HTMLElement style without
// triggering a React re-render. Used by PolyMesh's setPolygonsImpl callback.
// ---------------------------------------------------------------------------

function isStableTriangleBasis(value: StableTriangleBasis | undefined): value is StableTriangleBasis {
  if (!value) return false;
  const { a, b, c } = value;
  return (
    (a === 0 && b === 1 && c === 2) ||
    (a === 1 && b === 2 && c === 0) ||
    (a === 2 && b === 0 && c === 1)
  );
}

interface StableTriangleDomStyle {
  transform: string;
  color: string;
  basis: StableTriangleBasis;
}

function computeStableTriangleDomStyle(
  polygon: Polygon,
  options: StableTriangleDomUpdateOptions,
  basisHint?: StableTriangleBasis,
): StableTriangleDomStyle | null {
  if (polygon.texture || polygon.vertices.length !== 3) return null;

  const tile = DEFAULT_TILE;
  const elev = tile;
  const v0 = polygon.vertices[0];
  const v1 = polygon.vertices[1];
  const v2 = polygon.vertices[2];
  const p0x = v0[1] * tile, p0y = v0[0] * tile, p0z = v0[2] * elev;
  const p1x = v1[1] * tile, p1y = v1[0] * tile, p1z = v1[2] * elev;
  const p2x = v2[1] * tile, p2y = v2[0] * tile, p2z = v2[2] * elev;
  const e10x = p1x - p0x, e10y = p1y - p0y, e10z = p1z - p0z;
  const e20x = p2x - p0x, e20y = p2y - p0y, e20z = p2z - p0z;
  let nx = -(e10y * e20z - e10z * e20y);
  let ny = -(e10z * e20x - e10x * e20z);
  let nz = -(e10x * e20y - e10y * e20x);
  const nLen = Math.sqrt(nx * nx + ny * ny + nz * nz);
  if (nLen <= BASIS_EPS) return null;
  nx /= nLen; ny /= nLen; nz /= nLen;

  const len01Sq = e10x * e10x + e10y * e10y + e10z * e10z;
  const e21x = p2x - p1x, e21y = p2y - p1y, e21z = p2z - p1z;
  const e02x = p0x - p2x, e02y = p0y - p2y, e02z = p0z - p2z;
  const len12Sq = e21x * e21x + e21y * e21y + e21z * e21z;
  const len20Sq = e02x * e02x + e02y * e02y + e02z * e02z;
  let a = isStableTriangleBasis(basisHint) ? basisHint.a : 0;
  let b = isStableTriangleBasis(basisHint) ? basisHint.b : 1;
  let c = isStableTriangleBasis(basisHint) ? basisHint.c : 2;
  const retryWithoutBasis = (): StableTriangleDomStyle | null =>
    basisHint ? computeStableTriangleDomStyle(polygon, options) : null;
  if (!isStableTriangleBasis(basisHint)) {
    let baseLengthSq = len01Sq;
    if (len12Sq > baseLengthSq) { a = 1; b = 2; c = 0; baseLengthSq = len12Sq; }
    if (len20Sq > baseLengthSq) { a = 2; b = 0; c = 1; }
  }

  const cvx = c === 0 ? p0x : c === 1 ? p1x : p2x;
  const cvy = c === 0 ? p0y : c === 1 ? p1y : p2y;
  const cvz = c === 0 ? p0z : c === 1 ? p1z : p2z;
  const avx = a === 0 ? p0x : a === 1 ? p1x : p2x;
  const avy = a === 0 ? p0y : a === 1 ? p1y : p2y;
  const avz = a === 0 ? p0z : a === 1 ? p1z : p2z;
  const bvx = b === 0 ? p0x : b === 1 ? p1x : p2x;
  const bvy = b === 0 ? p0y : b === 1 ? p1y : p2y;
  const bvz = b === 0 ? p0z : b === 1 ? p1z : p2z;

  const baseDx = bvx - avx, baseDy = bvy - avy, baseDz = bvz - avz;
  const baseLength = Math.sqrt(baseDx * baseDx + baseDy * baseDy + baseDz * baseDz);
  if (baseLength <= BASIS_EPS) return retryWithoutBasis();

  const x0 = baseDx / baseLength, x1 = baseDy / baseLength, x2 = baseDz / baseLength;
  const apexXproj = (cvx - avx) * x0 + (cvy - avy) * x1 + (cvz - avz) * x2;
  let y0 = avx + x0 * apexXproj - cvx;
  let y1 = avy + x1 * apexXproj - cvy;
  let y2 = avz + x2 * apexXproj - cvz;
  const height = Math.sqrt(y0 * y0 + y1 * y1 + y2 * y2);
  if (height <= BASIS_EPS) return retryWithoutBasis();
  y0 /= height; y1 /= height; y2 /= height;

  const leftExtent = Math.max(0, Math.min(baseLength, apexXproj));
  const rightExtent = Math.max(0, baseLength - leftExtent);
  const expanded = offsetStableTrianglePoints(leftExtent, rightExtent, height, SOLID_TRIANGLE_BLEED);
  const apex2x = expanded[0], apex2y = expanded[1];
  const baseLeft2x = expanded[2], baseLeft2y = expanded[3];
  const baseRight2x = expanded[4], baseRight2y = expanded[5];
  const baseY = (baseLeft2y + baseRight2y) / 2;
  const leftPx = apex2x - baseLeft2x;
  const rightPx = baseRight2x - apex2x;
  const heightPx = baseY - apex2y;
  if (
    leftPx <= BASIS_EPS ||
    rightPx <= BASIS_EPS ||
    heightPx <= BASIS_EPS ||
    !Number.isFinite(leftPx + rightPx + heightPx)
  ) {
    return retryWithoutBasis();
  }

  const SOLID_TRIANGLE_CANONICAL_SIZE = 64;
  const invCanonicalSize = 1 / SOLID_TRIANGLE_CANONICAL_SIZE;
  const baseWidthPx = leftPx + rightPx;
  const xScale = baseWidthPx * invCanonicalSize;
  const yXScale = (rightPx - leftPx) * 0.5 * invCanonicalSize;
  const yYScale = heightPx * invCanonicalSize;
  const txXOffset = apex2x - leftExtent - baseWidthPx * 0.5;
  const txYOffset = apex2y;
  const transform = formatStableTriangleTransformScalars(
    x0 * xScale, x1 * xScale, x2 * xScale,
    x0 * yXScale + y0 * yYScale, x1 * yXScale + y1 * yYScale, x2 * yXScale + y2 * yYScale,
    nx, ny, nz,
    cvx + x0 * txXOffset + y0 * txYOffset,
    cvy + x1 * txXOffset + y1 * txYOffset,
    cvz + x2 * txXOffset + y2 * txYOffset,
  );

  const directionalCfg = options.directionalLight;
  const ambientCfg = options.ambientLight;
  const lightDir = directionalCfg?.direction ?? DEFAULT_LIGHT_DIR;
  const lightColor = directionalCfg?.color ?? DEFAULT_LIGHT_COLOR;
  const lightIntensity = Math.max(0, directionalCfg?.intensity ?? DEFAULT_LIGHT_INTENSITY);
  const ambientColor = ambientCfg?.color ?? DEFAULT_AMBIENT_COLOR;
  const ambientIntensity = Math.max(0, ambientCfg?.intensity ?? DEFAULT_AMBIENT_INTENSITY);
  const lLen = Math.sqrt(
    lightDir[0] * lightDir[0] + lightDir[1] * lightDir[1] + lightDir[2] * lightDir[2],
  ) || 1;
  const lx = lightDir[0] / lLen, ly = lightDir[1] / lLen, lz = lightDir[2] / lLen;
  const directScale = lightIntensity * Math.max(0, nx * lx + ny * ly + nz * lz);
  const shadedColor = shadePolygon(
    polygon.color ?? "#cccccc",
    directScale,
    lightColor,
    ambientColor,
    ambientIntensity,
  );
  const color = options.colorSteps
    ? quantizeCssColor(shadedColor, options.colorSteps)
    : shadedColor;
  return { transform, color, basis: { a, b, c } };
}

function stableTriangleColorAllowed(index: number, colorFrame: number, freezeFrames: number): boolean {
  return freezeFrames > 0 && (freezeFrames <= 1 || (colorFrame + index) % freezeFrames === 0);
}

function applyStableTriangleColor(
  el: StableTriangleDomElement,
  index: number,
  nextColor: string,
  options: StableTriangleDomUpdateOptions,
): void {
  const freezeFrames = Math.floor(options.colorFreezeFrames ?? 1);
  if (freezeFrames === 0) return;
  const currentColor = el.__polycssStableTriangleColor;
  const shouldWrite = currentColor === undefined ||
    stableTriangleColorAllowed(
      index,
      Math.max(0, Math.floor(options.colorFrame ?? 0)),
      Math.max(1, freezeFrames),
    );
  if (!shouldWrite || currentColor === nextColor) return;
  let writeColor = nextColor;
  let writeRgb = nextColor ? parseHex(nextColor) : undefined;
  const currentRgb = el.__polycssStableTriangleColorRgb;
  const maxStep = Math.max(0, Math.floor(options.colorMaxStep ?? 0));
  if (maxStep > 0 && currentRgb && writeRgb && nextColor) {
    writeRgb = stepRgbToward(currentRgb, writeRgb, maxStep);
    writeColor = rgbToHex(writeRgb);
  }
  el.style.color = writeColor;
  el.__polycssStableTriangleColor = writeColor;
  el.__polycssStableTriangleColorRgb = writeRgb;
}

export function updateStableTriangleDom(
  root: HTMLElement,
  polygons: Polygon[],
  options: StableTriangleDomUpdateOptions = {},
): boolean {
  if ((options.textureLighting ?? "baked") !== "baked") return false;
  if (!isSolidTriangleSupported()) return false;
  const leaves = Array.from(root.children).filter(
    (child): child is StableTriangleDomElement =>
      child instanceof HTMLElement && child.localName === "u",
  );
  if (leaves.length !== polygons.length) return false;

  const styles = polygons.map((polygon, index) =>
    computeStableTriangleDomStyle(polygon, options, leaves[index].__polycssStableTriangleBasis)
  );
  if (styles.some((style) => !style)) return false;

  for (let i = 0; i < leaves.length; i += 1) {
    const style = styles[i]!;
    const el = leaves[i];
    if (el.style.visibility) el.style.visibility = "";
    el.__polycssStableTriangleBasis = style.basis;
    el.style.transform = style.transform;
    applyStableTriangleColor(el, i, style.color, options);
  }
  return true;
}

// ---------------------------------------------------------------------------
// useTextureAtlas — React hook that packs plans into atlas pages with blob URLs
// ---------------------------------------------------------------------------

export function useTextureAtlas(
  plans: Array<TextureAtlasPlan | null>,
  textureLighting: PolyTextureLightingMode,
  textureQualityInput?: TextureQuality,
  strategies?: PolyRenderStrategiesOption,
): TextureAtlasResult {
  const disabled = useMemo(
    () => new Set((strategies?.disable ?? []) as PolyRenderStrategy[]),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [strategies?.disable?.join(",")],
  );

  const atlasPlans = useMemo(
    () => filterAtlasPlans(plans, textureLighting, disabled),
    [plans, textureLighting, disabled],
  );

  const { packed, atlasScale } = useMemo(
    () => packTextureAtlasPlansWithScale(
      atlasPlans,
      textureQualityInput,
      typeof document !== "undefined" ? document : null,
    ),
    [atlasPlans, textureQualityInput],
  );

  const [pages, setPages] = useState<TextureAtlasPage[]>(
    () => packed.pages.map((page) => ({ width: page.width, height: page.height, url: null })),
  );

  useEffect(() => {
    let cancelled = false;
    let urls: string[] = [];
    setPages(packed.pages.map((page) => ({ width: page.width, height: page.height, url: null })));

    if (packed.pages.length === 0 || typeof document === "undefined") {
      return () => {};
    }

    buildAtlasPages(packed.pages, textureLighting, document, atlasScale, () => cancelled)
      .then((nextPages) => {
        if (cancelled) {
          for (const page of nextPages) {
            if (page.url?.startsWith("blob:")) URL.revokeObjectURL(page.url);
          }
          return;
        }
        urls = nextPages.flatMap((page) => page.url?.startsWith("blob:") ? [page.url] : []);
        setPages(nextPages);
      })
      .catch(() => {
        if (!cancelled) {
          setPages(packed.pages.map((page) => ({ width: page.width, height: page.height, url: null })));
        }
      });

    return () => {
      cancelled = true;
      for (const url of urls) URL.revokeObjectURL(url);
    };
  }, [packed, textureLighting, atlasScale]);

  return {
    entries: packed.entries,
    pages,
    ready: pages.length === 0 || pages.every((page) => !!page.url),
  };
}

// ---------------------------------------------------------------------------
// Brush-inline-style ordering helper (needed by TextureBorderShapePoly)
// ---------------------------------------------------------------------------

const BRUSH_INLINE_STYLE_ORDER = new Map([
  ["transform", 0],
  ["border-shape", 1],
  ["border-width", 2],
  ["width", 3],
  ["height", 4],
  ["color", 5],
]);

function orderBrushInlineStyle(el: HTMLElement): void {
  const current = el.getAttribute("style");
  if (!current) return;
  const declarations = current.split(";").map((d) => d.trim()).filter(Boolean);
  const next = declarations
    .map((declaration, index) => {
      const property = declaration.slice(0, declaration.indexOf(":")).trim().toLowerCase();
      return { declaration, index, order: BRUSH_INLINE_STYLE_ORDER.get(property) ?? Number.POSITIVE_INFINITY };
    })
    .sort((a, b) => a.order - b.order || a.index - b.index)
    .map(({ declaration }) => declaration)
    .join(";");
  if (next !== current) el.setAttribute("style", next);
}

// ---------------------------------------------------------------------------
// React JSX render components
// ---------------------------------------------------------------------------

export function TextureBorderShapePoly({
  entry,
  solidPaintDefaults,
  className,
  style: styleProp,
  domAttrs,
  domEventHandlers,
  pointerEvents = "auto",
  disabledStrategies,
}: {
  entry: TextureAtlasPlan;
  solidPaintDefaults?: SolidPaintDefaults;
  className?: string;
  style?: CSSProperties;
  domAttrs?: Record<string, unknown>;
  domEventHandlers?: React.DOMAttributes<Element>;
  pointerEvents?: "auto" | "none";
  disabledStrategies?: ReadonlySet<string>;
}) {
  const fullRect = !entry.texture && isFullRectSolid(entry);

  const bDisabled = disabledStrategies?.has("b") ?? false;
  const useIForFullRect = bDisabled && isBorderShapeSupported();
  const borderShape = (!fullRect || useIForFullRect) ? cssBorderShapeForPlan(entry) : null;
  const useDefaultPaint = entry.shadedColor === solidPaintDefaults?.paintColor;
  const setElementRef = useCallback((el: HTMLElement | null) => {
    if (!el) return;
    if (borderShape) el.style.setProperty("border-shape", borderShape);
    else el.style.removeProperty("border-shape");
    orderBrushInlineStyle(el);
  }, [borderShape]);
  const transform = formatMatrix3d(
    borderShape ? formatBorderShapeEntryMatrix(entry) : formatSolidQuadEntryMatrix(entry),
  );
  const style: CSSProperties = {
    transform,
    color: useDefaultPaint ? undefined : entry.shadedColor,
    pointerEvents: pointerEvents === "none" ? "none" : undefined,
    ...styleProp,
  };

  const dataAttrs = entry.polygon.data
    ? Object.fromEntries(
        Object.entries(entry.polygon.data).map(([k, v]) => [`data-${k}`, String(v)]),
      )
    : {};
  const elementClassName = className?.trim() || undefined;

  if (fullRect && !useIForFullRect) {
    return (
      <b
        className={elementClassName}
        style={style}
        {...domEventHandlers}
        {...dataAttrs}
        {...domAttrs}
      />
    );
  }

  return (
    <i
      ref={setElementRef}
      className={elementClassName}
      style={style}
      {...domEventHandlers}
      {...dataAttrs}
      {...domAttrs}
    />
  );
}

export function TextureProjectiveSolidPoly({
  entry,
  textureLighting,
  solidPaintDefaults,
  className,
  style: styleProp,
  domAttrs,
  domEventHandlers,
  pointerEvents = "auto",
}: {
  entry: TextureAtlasPlan & { projectiveMatrix: string };
  textureLighting: PolyTextureLightingMode;
  solidPaintDefaults?: SolidPaintDefaults;
  className?: string;
  style?: CSSProperties;
  domAttrs?: Record<string, unknown>;
  domEventHandlers?: React.DOMAttributes<Element>;
  pointerEvents?: "auto" | "none";
}) {
  const dynamic = textureLighting === "dynamic";
  const base = parseHex(entry.polygon.color ?? "#cccccc");
  const useDefaultDynamicColor = dynamic && rgbKey(base) === solidPaintDefaults?.dynamicColorKey;
  const style: CSSProperties = {
    transform: formatMatrix3d(entry.projectiveMatrix),
    color: dynamic || entry.shadedColor === solidPaintDefaults?.paintColor
      ? undefined
      : entry.shadedColor,
    pointerEvents: pointerEvents === "none" ? "none" : undefined,
    ...(dynamic && !useDefaultDynamicColor
      ? {
          ["--pnx" as string]: entry.normal[0].toFixed(4),
          ["--pny" as string]: entry.normal[1].toFixed(4),
          ["--pnz" as string]: entry.normal[2].toFixed(4),
          ["--psr" as string]: (base.r / 255).toFixed(4),
          ["--psg" as string]: (base.g / 255).toFixed(4),
          ["--psb" as string]: (base.b / 255).toFixed(4),
        }
      : dynamic
        ? {
            ["--pnx" as string]: entry.normal[0].toFixed(4),
            ["--pny" as string]: entry.normal[1].toFixed(4),
            ["--pnz" as string]: entry.normal[2].toFixed(4),
          }
        : null),
    ...styleProp,
  };

  const dataAttrs = entry.polygon.data
    ? Object.fromEntries(
        Object.entries(entry.polygon.data).map(([k, v]) => [`data-${k}`, String(v)]),
      )
    : {};
  const elementClassName = className?.trim() || undefined;

  return (
    <b
      className={elementClassName}
      style={style}
      {...domEventHandlers}
      {...dataAttrs}
      {...domAttrs}
    />
  );
}

export function TextureTrianglePoly({
  entry,
  textureLighting,
  solidPaintDefaults,
  className,
  style: styleProp,
  domAttrs,
  domEventHandlers,
  pointerEvents = "auto",
}: {
  entry: TextureAtlasPlan;
  textureLighting: PolyTextureLightingMode;
  solidPaintDefaults?: SolidPaintDefaults;
  className?: string;
  style?: CSSProperties;
  domAttrs?: Record<string, unknown>;
  domEventHandlers?: React.DOMAttributes<Element>;
  pointerEvents?: "auto" | "none";
}) {
  const triangleStyle = solidTriangleStyle(entry, textureLighting, pointerEvents, solidPaintDefaults);
  if (!triangleStyle) return null;

  const dataAttrs = entry.polygon.data
    ? Object.fromEntries(
        Object.entries(entry.polygon.data).map(([k, v]) => [`data-${k}`, String(v)]),
      )
    : {};
  const elementClassName = className?.trim() || undefined;

  return (
    <u
      className={elementClassName}
      style={{ ...triangleStyle, ...styleProp }}
      {...domEventHandlers}
      {...dataAttrs}
      {...domAttrs}
    />
  );
}

export function TextureAtlasPoly({
  entry,
  page,
  textureLighting,
  className,
  style: styleProp,
  domAttrs,
  domEventHandlers,
  pointerEvents = "auto",
}: {
  entry: PackedTextureAtlasEntry;
  page: TextureAtlasPage | undefined;
  textureLighting: PolyTextureLightingMode;
  className?: string;
  style?: CSSProperties;
  domAttrs?: Record<string, unknown>;
  domEventHandlers?: React.DOMAttributes<Element>;
  pointerEvents?: "auto" | "none";
}) {
  const ATLAS_CANONICAL_SIZE_EXPLICIT = 64;
  const dynamic = textureLighting === "dynamic";
  const atlasCanonicalSize = entry.atlasCanonicalSize ?? ATLAS_CANONICAL_SIZE_EXPLICIT;
  const atlasWidth = entry.canvasW || 1;
  const atlasHeight = entry.canvasH || 1;
  const atlasPosition = page
    ? `${formatCssLengthPx((-entry.x / atlasWidth) * atlasCanonicalSize)} ${formatCssLengthPx((-entry.y / atlasHeight) * atlasCanonicalSize)}`
    : undefined;
  const atlasSize = page
    ? `${formatCssLengthPx((page.width / atlasWidth) * atlasCanonicalSize)} ${formatCssLengthPx((page.height / atlasHeight) * atlasCanonicalSize)}`
    : undefined;

  const dynamicMask = dynamic && page?.url ? `url(${page.url})` : undefined;
  const background = !dynamic && page?.url
    ? `url(${page.url}) ${atlasPosition} / ${atlasSize} no-repeat`
    : undefined;

  const style: CSSProperties = {
    transform: formatMatrix3d(entry.atlasMatrix),
    ["--polycss-atlas-size" as string]: `${atlasCanonicalSize}px`,
    background,
    backgroundImage: dynamic && page?.url ? `url(${page.url})` : undefined,
    backgroundPosition: dynamic ? atlasPosition : undefined,
    backgroundSize: dynamic ? atlasSize : undefined,
    ...(dynamic
      ? {
          ["--pnx" as string]: entry.normal[0].toFixed(4),
          ["--pny" as string]: entry.normal[1].toFixed(4),
          ["--pnz" as string]: entry.normal[2].toFixed(4),
        }
      : null),
    ...(dynamic && dynamicMask
      ? {
          maskImage: dynamicMask,
          maskMode: "alpha" as const,
          maskPosition: atlasPosition,
          maskSize: atlasSize,
          maskRepeat: "no-repeat" as const,
          WebkitMaskImage: dynamicMask,
          WebkitMaskPosition: atlasPosition,
          WebkitMaskSize: atlasSize,
          WebkitMaskRepeat: "no-repeat" as const,
        }
      : null),
    opacity: page?.url ? undefined : 0,
    pointerEvents: pointerEvents === "none" ? "none" : undefined,
    ...styleProp,
  };

  const dataAttrs = entry.polygon.data
    ? Object.fromEntries(
        Object.entries(entry.polygon.data).map(([k, v]) => [`data-${k}`, String(v)]),
      )
    : {};
  const elementClassName = className?.trim() || undefined;

  return (
    <s
      className={elementClassName}
      style={style}
      {...domEventHandlers}
      {...dataAttrs}
      {...domAttrs}
    />
  );
}
