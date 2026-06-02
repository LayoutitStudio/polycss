import {
  isSolidTrianglePlan,
  offsetConvexPolygonPointsByEdgeAmounts,
  parsePureColor,
  resolveSeamBleed,
  safePlanSeamBleedAmount,
} from "@layoutit/polycss-core";
import type {
  TextureAtlasPlan,
  PolyTextureLightingMode,
  SolidPaintDefaults,
  SolidTrianglePrimitive,
  Vec2,
  Vec3,
} from "@layoutit/polycss-core";
import type { CSSProperties } from "vue";

// ---------------------------------------------------------------------------
// Internal helpers used by solidTriangleStyle and updateStableTriangleDom
// ---------------------------------------------------------------------------

export const DEFAULT_TILE = 50;
export const DEFAULT_LIGHT_DIR: Vec3 = [0.4, -0.7, 0.59];
export const DEFAULT_LIGHT_COLOR = "#ffffff";
export const DEFAULT_LIGHT_INTENSITY = 1;
export const DEFAULT_AMBIENT_COLOR = "#ffffff";
export const DEFAULT_AMBIENT_INTENSITY = 0.4;
export const BASIS_EPS = 1e-9;
// Matches the canonical SOLID_TRIANGLE_BLEED constant.
export const SOLID_TRIANGLE_BLEED = 0.75;
const SOLID_TRIANGLE_CANONICAL_SIZE = 32;
const SOLID_TRIANGLE_LARGE_BORDER_CANONICAL_SIZE = 96;
const SOLID_TRIANGLE_LARGE_BORDER_WIDTH = "0 48px 96px 48px";
let cachedSolidTriangleUserAgent: string | undefined;
let cachedSolidTriangleCanonicalSize = SOLID_TRIANGLE_CANONICAL_SIZE;

function cornerTriangleSupported(): boolean {
  const css = typeof CSS !== "undefined" ? CSS : undefined;
  return !!css?.supports?.("corner-top-left-shape", "bevel") &&
    !!css.supports("corner-top-right-shape", "bevel");
}

function solidTrianglePrimitive(): SolidTrianglePrimitive {
  if (cornerTriangleSupported()) return "corner-bevel";
  const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
  return /\bFirefox\//.test(ua) ? "border-large" : "border";
}

export function solidTriangleCanonicalSize(): number {
  const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
  if (ua !== cachedSolidTriangleUserAgent) {
    cachedSolidTriangleUserAgent = ua;
    cachedSolidTriangleCanonicalSize = /\bFirefox\//.test(ua)
      ? SOLID_TRIANGLE_LARGE_BORDER_CANONICAL_SIZE
      : SOLID_TRIANGLE_CANONICAL_SIZE;
  }
  return cachedSolidTriangleCanonicalSize;
}

export function solidTriangleBorderWidth(): string | undefined {
  return solidTrianglePrimitive() === "border-large"
    ? SOLID_TRIANGLE_LARGE_BORDER_WIDTH
    : undefined;
}

export function solidTrianglePaintStyle(): CSSProperties | undefined {
  const primitive = solidTrianglePrimitive();
  if (primitive === "corner-bevel") return undefined;
  const borderWidth = primitive === "border-large" ? SOLID_TRIANGLE_LARGE_BORDER_WIDTH : undefined;
  return borderWidth ? { borderWidth } : undefined;
}

export function applySolidTrianglePaintStyle(el: HTMLElement): void {
  const primitive = solidTrianglePrimitive();
  if (primitive === "corner-bevel") {
    el.style.width = "";
    el.style.height = "";
    el.style.backgroundColor = "";
    el.style.borderWidth = "";
    el.style.borderTopLeftRadius = "";
    el.style.borderTopRightRadius = "";
    el.style.removeProperty("corner-top-left-shape");
    el.style.removeProperty("corner-top-right-shape");
  } else {
    el.style.width = "";
    el.style.height = "";
    el.style.backgroundColor = "";
    el.style.borderTopLeftRadius = "";
    el.style.borderTopRightRadius = "";
    el.style.removeProperty("corner-top-left-shape");
    el.style.removeProperty("corner-top-right-shape");
    el.style.borderWidth = primitive === "border-large" ? SOLID_TRIANGLE_LARGE_BORDER_WIDTH : "";
  }
}

export interface RGB { r: number; g: number; b: number; }

export function parseHex(hex: string): RGB {
  // Tolerate any CSS color string the renderer hands us — hex, rgb(),
  // or rgba(). Polygon colors arrive from user code and helpers like
  // <PolyTransformControls> use rgba() to fade arrows on hover/drag.
  const parsed = parsePureColor(hex);
  if (!parsed) return { r: 255, g: 255, b: 255 };
  return { r: parsed.rgb[0], g: parsed.rgb[1], b: parsed.rgb[2] };
}

export function rgbKey({ r, g, b }: RGB): string {
  return `${r},${g},${b}`;
}

function parseAlpha(input: string): number {
  return parsePureColor(input)?.alpha ?? 1;
}

export function rgbToHex({ r, g, b }: RGB): string {
  const f = (n: number) =>
    Math.round(Math.max(0, Math.min(255, n))).toString(16).padStart(2, "0");
  return `#${f(r)}${f(g)}${f(b)}`;
}

export function shadePolygon(
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
  // Preserve the base polygon's alpha. Lighting only modulates RGB —
  // a translucent input (e.g. <PolyTransformControls> arrow at idle)
  // must keep its alpha so the gizmo stays see-through after shading.
  const alpha = parseAlpha(baseColor);
  return alpha < 1
    ? `rgba(${r}, ${g}, ${b}, ${alpha})`
    : rgbToHex({ r, g, b });
}

export function quantizeCssColor(input: string, steps: number): string {
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

export function stepRgbToward(current: RGB, target: RGB, maxStep: number): RGB {
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

export function offsetConvexPolygonPoints(points: number[], amount: number): number[] {
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
    offsetLines.push({
      a: [a[0] + ox, a[1] + oy],
      b: [b[0] + ox, b[1] + oy],
    });
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
      expanded.push(
        original[0] + (dx / miter) * maxMiter,
        original[1] + (dy / miter) * maxMiter,
      );
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

function triangleEdgeIndexForPair(a: number, b: number): number | undefined {
  if ((a + 1) % 3 === b) return a;
  if ((b + 1) % 3 === a) return b;
  return undefined;
}

function stableTriangleEdgeAmounts(
  entry: TextureAtlasPlan,
  a: number,
  b: number,
  c: number,
  screenPts: number[],
): number[] | null {
  const seamEdges = entry.seamBleedEdges;
  if (!seamEdges?.size) return null;
  const seamAmount = entry.seamBleed === undefined
    ? SOLID_TRIANGLE_BLEED
    : entry.seamBleed;
  const edgePairs: Array<[number, number]> = [[c, a], [a, b], [b, c]];
  return edgePairs.map(([from, to], localEdgeIndex) => {
    const edgeIndex = triangleEdgeIndexForPair(from, to);
    const requested = edgeIndex !== undefined && seamEdges.has(edgeIndex)
      ? entry.seamBleedEdgeAmounts?.get(edgeIndex) ?? resolveSeamBleed(seamAmount, SOLID_TRIANGLE_BLEED)
      : 0;
    return safePlanSeamBleedAmount(screenPts, localEdgeIndex, requested);
  });
}

export function formatStableTriangleTransformScalars(
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

// Generates Vue CSSProperties for a solid-triangle (<u>) leaf.
// Uses canonical SOLID_TRIANGLE_BLEED = 0.75 to match the polycss renderer.
export function solidTriangleStyle(
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

  const canonicalSize = solidTriangleCanonicalSize();
  const left = Math.max(0, Math.min(baseLength, apexX));
  const right = Math.max(0, baseLength - left);
  const screenPts = [left, 0, 0, height, left + right, height];
  const edgeAmounts = stableTriangleEdgeAmounts(entry, a, b, c, screenPts);
  const expanded = edgeAmounts
    ? offsetConvexPolygonPointsByEdgeAmounts(screenPts, edgeAmounts)
    : offsetStableTrianglePoints(
        left,
        right,
        height,
        resolveSeamBleed(entry.seamBleed, SOLID_TRIANGLE_BLEED),
      );
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
          "--pnx": normal[0].toFixed(4),
          "--pny": normal[1].toFixed(4),
          "--pnz": normal[2].toFixed(4),
          "--psr": (base.r / 255).toFixed(4),
          "--psg": (base.g / 255).toFixed(4),
          "--psb": (base.b / 255).toFixed(4),
        }
      : dynamic
        ? {
            "--pnx": normal[0].toFixed(4),
            "--pny": normal[1].toFixed(4),
            "--pnz": normal[2].toFixed(4),
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

  const halfBase = canonicalSize / 2;
  const xCol: Vec3 = [
    (baseRight[0] - baseLeft[0]) / canonicalSize,
    (baseRight[1] - baseLeft[1]) / canonicalSize,
    (baseRight[2] - baseLeft[2]) / canonicalSize,
  ];
  const txCol: Vec3 = [
    apex[0] - xCol[0] * halfBase,
    apex[1] - xCol[1] * halfBase,
    apex[2] - xCol[2] * halfBase,
  ];
  const yCol: Vec3 = [
    (baseLeft[0] - txCol[0]) / canonicalSize,
    (baseLeft[1] - txCol[1]) / canonicalSize,
    (baseLeft[2] - txCol[2]) / canonicalSize,
  ];
  const canonicalMatrix = [
    xCol[0], xCol[1], xCol[2], 0,
    yCol[0], yCol[1], yCol[2], 0,
    normal[0], normal[1], normal[2], 0,
    txCol[0], txCol[1], txCol[2], 1,
  ].map((v) => (Math.round(v * 1000) / 1000 || 0).toString()).join(",");
  const primitiveStyle = solidTrianglePaintStyle();
  return {
    transform: `matrix3d(${canonicalMatrix})`,
    ...(primitiveStyle ?? {}),
    ...sharedStyle,
  };
}
