import type {
  PolyAmbientLight,
  PolyDirectionalLight,
  Polygon,
  TextureTriangle,
  PolyTextureLightingMode,
  Vec2,
  Vec3,
} from "@layoutit/polycss-core";
import { parsePureColor } from "@layoutit/polycss-core";

const DEFAULT_TILE = 50;
const DEFAULT_LIGHT_DIR: Vec3 = [0.4, -0.7, 0.59];
const DEFAULT_LIGHT_COLOR = "#ffffff";
const DEFAULT_LIGHT_INTENSITY = 1;
const DEFAULT_AMBIENT_COLOR = "#ffffff";
const DEFAULT_AMBIENT_INTENSITY = 0.4;
const ATLAS_MAX_SIZE = 4096;
const ATLAS_PADDING = 1;
const MIN_ATLAS_SCALE = 0.1;
const MAX_ATLAS_SCALE = 1;
const AUTO_ATLAS_LOW_AREA = ATLAS_MAX_SIZE * ATLAS_MAX_SIZE;
const AUTO_ATLAS_MEDIUM_AREA = AUTO_ATLAS_LOW_AREA * 3;
const AUTO_ATLAS_MAX_BITMAP_SIDE = 2048;
// Total decoded RGBA bytes summed across all atlas pages, picked per device
// class. On mobile Chrome (Galaxy S23 Ultra-class hardware), large textured
// meshes sit right at the compositor's GPU-memory edge — when the scene
// transform mutates per frame the compositor evicts and re-rasterizes pages
// mid-frame, producing visible flicker/tearing during rotation. 4 MB keeps
// us under that threshold with no perceptible loss of texture detail at
// typical mobile display sizes. Desktop GPUs have orders of magnitude more
// memory, so we keep textures sharp there.
const AUTO_ATLAS_MAX_DECODED_BYTES_MOBILE = 4 * 1024 * 1024;
const AUTO_ATLAS_MAX_DECODED_BYTES_DESKTOP = 16 * 1024 * 1024;
const AUTO_ATLAS_SCALE_GUARD = 0.995;
const COLOR_PARSE_CACHE_MAX = 512;

export type TextureQuality = number | "auto";

export type PolyRenderStrategy = "b" | "i" | "u";

export interface PolyRenderStrategiesOption {
  /** Strategies to skip; polygons that would normally use them fall through
   *  the chain (b → i → s, u → i → s, i → s). `<s>` is the universal
   *  fallback and cannot be disabled — textured polys have no other path. */
  disable?: readonly PolyRenderStrategy[];
}

interface RGB { r: number; g: number; b: number; }
interface RGBFactors { r: number; g: number; b: number; }
type PureColorParseResult = ReturnType<typeof parsePureColor>;

interface UvAffine {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
}

interface UvSampleRect {
  minU: number;
  minV: number;
  maxU: number;
  maxV: number;
}

export interface TextureAtlasPlan {
  index: number;
  polygon: Polygon;
  texture?: string;
  tileSize: number;
  layerElevation: number;
  matrix: string;
  canonicalMatrix: string;
  atlasMatrix: string;
  atlasCanonicalSize?: number;
  projectiveMatrix: string | null;
  canvasW: number;
  canvasH: number;
  screenPts: number[];
  uvAffine: UvAffine | null;
  uvSampleRect: UvSampleRect | null;
  textureTriangles: TextureTrianglePlan[] | null;
  textureEdgeRepairEdges: Set<number> | null;
  textureEdgeRepair: boolean;
  /** World-space surface normal — stable across light changes, used by dynamic mode. */
  normal: Vec3;
  textureTint: RGBFactors;
  shadedColor: string;
}

interface TextureTrianglePlan {
  screenPts: number[];
  uvAffine: UvAffine | null;
  uvSampleRect: UvSampleRect | null;
}

export interface PackedTextureAtlasEntry extends TextureAtlasPlan {
  pageIndex: number;
  x: number;
  y: number;
}

export interface PackedPage {
  width: number;
  height: number;
  entries: PackedTextureAtlasEntry[];
}

interface PackingShelf {
  x: number;
  y: number;
  height: number;
}

interface PackingPage extends PackedPage {
  shelves: PackingShelf[];
  sealed?: boolean;
}

export interface PackedAtlas {
  entries: Array<PackedTextureAtlasEntry | null>;
  pages: PackedPage[];
}

interface SolidTriangleColorPlan {
  index: number;
  polygon: Polygon;
  colorComputed: boolean;
  bakedColor?: string;
  bakedRgb?: RGB;
  bakedAlpha?: number;
  dynamicVars?: string;
}

interface SolidTrianglePlan extends SolidTriangleColorPlan {
  styleText: string;
  transformText: string;
  basis: SolidTriangleBasis;
}

interface SolidTriangleBasis {
  a: number;
  b: number;
  c: number;
}

interface SolidTriangleComputeOptions {
  basis?: SolidTriangleBasis;
  includeColor?: boolean;
  matrixDecimals?: number;
  color?: string;
}

interface SolidTriangleElement extends HTMLElement {
  __polycssSolidTriangleBasis?: SolidTriangleBasis;
  __polycssSolidTriangleColor?: string;
  __polycssSolidTriangleColorRgb?: RGB;
  __polycssSolidTriangleColorAlpha?: number;
  __polycssSolidTriangleColorFrame?: number;
  __polycssSolidTriangleHidden?: boolean;
  __polycssHasDataAttrs?: boolean;
}

interface StableTriangleColorState {
  updatesDisabled: boolean;
  freezeFrames: number;
  colorFrame: number;
  maxStep: number;
}

export interface SolidTriangleFrame {
  polygonCount: number;
  vertices: ArrayLike<number>;
  colors?: readonly (string | undefined)[];
}

export interface SolidPaintDefaults {
  paintColor?: string;
  dynamicColor?: { r: number; g: number; b: number };
  dynamicColorKey?: string;
}

export interface TextureAtlasPage {
  width: number;
  height: number;
  url: string | null;
}

interface RectBrush {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface LocalBasis {
  xAxis: Vec3;
  yAxis: Vec3;
  local2D: Vec2[];
  shiftX: number;
  shiftY: number;
  canvasW: number;
  canvasH: number;
  pixelArea: number;
  rawArea: number;
}

interface BasisOptions {
  optimize: boolean;
  fixedXAxis?: Vec3;
  boundsOrigin?: Vec3;
  snapBounds?: boolean;
  seamEdges?: Set<number>;
}

interface BasisHint {
  xAxis?: Vec3;
  boundsOrigin?: Vec3;
  seamEdges: Set<number>;
  textureEdgeRepairEdges?: Set<number>;
}

// Budget for the internal async atlas planner used by large imperative
// scene updates. Keep comfortably under the 50ms long-task threshold.
const ASYNC_RENDER_BUDGET_MS = 12;

interface PolygonBasisInfo {
  pts: Vec3[];
  normal: Vec3;
  planeD: number;
  optimizable: boolean;
}

export interface RenderTextureAtlasOptions {
  doc?: Document;
  tileSize?: number;
  layerElevation?: number;
  directionalLight?: PolyDirectionalLight;
  ambientLight?: PolyAmbientLight;
  textureLighting?: PolyTextureLightingMode;
  /**
   * Atlas bitmap budget and CSS sprite size. Numeric values are clamped to
   * 0.1..1 and keep the 64px sprite. Omitted / `"auto"` picks a raster scale
   * from packed atlas area, caps oversized runtime bitmaps by side length and
   * decoded-memory budget, and uses a 128px sprite on desktop-class documents
   * or a 64px sprite on mobile-class documents.
   */
  textureQuality?: TextureQuality;
  solidPaintDefaults?: SolidPaintDefaults;
  strategies?: PolyRenderStrategiesOption;
}

interface InternalRenderTextureAtlasOptions extends RenderTextureAtlasOptions {
  optimizeStableTriangleStyle?: boolean;
  stableTriangleDebug?: "transform-only" | "plan-only";
  stableTriangleUpdateMode?: "full" | "transform-only" | "color-only";
  stableTriangleColorPolicy?: "cadence" | "adaptive";
  stableTriangleColorSteps?: number;
  stableTriangleColorFreezeFrames?: number;
  stableTriangleColorBudget?: number;
  stableTriangleColorMaxAge?: number;
  stableTriangleColorMaxStep?: number;
  stableTriangleColorFrame?: number;
  stableTriangleMatrixDecimals?: number;
}

export interface RenderedPoly {
  polygonIndex: number;
  element: HTMLElement;
  kind?: "atlas" | "solid" | "border" | "triangle";
  plan?: TextureAtlasPlan;
  dispose(): void;
}

export interface RenderTextureAtlasResult {
  rendered: RenderedPoly[];
  dispose(): void;
}

export interface RenderTextureAtlasAsyncResult extends RenderTextureAtlasResult {
  solidPaintDefaults: SolidPaintDefaults;
}

const TEXTURE_IMAGE_CACHE = new Map<string, Promise<HTMLImageElement>>();
const PURE_COLOR_CACHE = new Map<string, PureColorParseResult>();
const ELEMENT_DATA_KEYS = new WeakMap<HTMLElement, string[]>();
const RECT_EPS = 1e-3;
const BASIS_EPS = 1e-9;
const SURFACE_NORMAL_EPS = 1e-4;
const SURFACE_DISTANCE_EPS = 0.1;
const SEAM_LIGHT_EPS = 0.01;
const TEXTURE_TRIANGLE_BLEED = 0.75;
const TEXTURE_EDGE_REPAIR_ALPHA_MIN = 1;
const TEXTURE_EDGE_REPAIR_SOURCE_ALPHA_MIN = 250;
const TEXTURE_EDGE_REPAIR_RADIUS = 1.5;
const SOLID_TRIANGLE_BLEED = 0.75;
const DEFAULT_MATRIX_DECIMALS = 3;
const DEFAULT_BORDER_SHAPE_DECIMALS = 2;
const DEFAULT_ATLAS_CSS_DECIMALS = 4;
const DECIMAL_SCALES = [1, 10, 100, 1000, 10000, 100000, 1000000];
const SOLID_QUAD_CANONICAL_SIZE = 64;
const SOLID_TRIANGLE_CANONICAL_SIZE = 64;
const ATLAS_CANONICAL_SIZE_EXPLICIT = 64;
const ATLAS_CANONICAL_SIZE_AUTO_DESKTOP = 128;
const BORDER_SHAPE_CENTER_PERCENT = 50;
const BORDER_SHAPE_POINT_EPS = 1e-7;
const BORDER_SHAPE_CANONICAL_SIZE = 16;
const BORDER_SHAPE_BLEED = 0.9;
const PROJECTIVE_QUAD_DENOM_EPS = 0.05;
const PROJECTIVE_QUAD_MAX_WEIGHT_RATIO = Number.POSITIVE_INFINITY;
const PROJECTIVE_QUAD_BLEED = 0.6;

function stableTriangleMatrixDecimals(options: InternalRenderTextureAtlasOptions): number {
  return Math.max(
    0,
    Math.min(6, Math.floor(options.stableTriangleMatrixDecimals ?? DEFAULT_MATRIX_DECIMALS)),
  );
}

interface BorderShapeBounds {
  minX: number;
  minY: number;
  width: number;
  height: number;
}

interface BorderShapeGeometry {
  bounds: BorderShapeBounds;
  points: Array<[number, number]>;
}

interface ProjectiveQuadGuardSettings {
  denomEps: number;
  maxWeightRatio: number;
  bleed: number;
  disableGuards: boolean;
}

interface ProjectiveQuadGuardOverrides {
  denomEps?: number;
  maxWeightRatio?: number;
  bleed?: number;
  disableGuards?: boolean;
}

interface ProjectiveQuadGuardGlobal {
  __polycssProjectiveQuadGuards?: ProjectiveQuadGuardOverrides;
}

interface ProjectiveQuadCoefficients {
  g: number;
  h: number;
  w1: number;
  w3: number;
}

function loadTextureImage(url: string): Promise<HTMLImageElement> {
  let p = TEXTURE_IMAGE_CACHE.get(url);
  if (!p) {
    p = new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.decoding = "async";
      // Request CORS so cross-origin textures can be drawn to the atlas canvas
      // without tainting it (atlas rasterisation reads pixels via toBlob /
      // getImageData). Same-origin loads ignore the attribute; cross-origin
      // servers need `Access-Control-Allow-Origin` set, which is standard for
      // public CDNs like esm.sh / polycss.com.
      img.crossOrigin = "anonymous";
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error(`texture load failed: ${url}`));
      img.src = url;
    });
    TEXTURE_IMAGE_CACHE.set(url, p);
    p.then(
      () => {
        if (TEXTURE_IMAGE_CACHE.get(url) === p) TEXTURE_IMAGE_CACHE.delete(url);
      },
      () => {
        if (TEXTURE_IMAGE_CACHE.get(url) === p) TEXTURE_IMAGE_CACHE.delete(url);
      },
    );
  }
  return p;
}

function normalizeAtlasScale(scale: number | string | undefined): number {
  const value = typeof scale === "string" ? Number(scale) : scale;
  if (value === undefined || !Number.isFinite(value)) return 1;
  return Math.min(MAX_ATLAS_SCALE, Math.max(MIN_ATLAS_SCALE, value));
}

function roundDecimal(value: number, decimals: number): string {
  if (Object.is(value, 0) || Object.is(value, -0)) return "0";
  if (value === 1) return "1";
  if (value === -1) return "-1";
  const scale = DECIMAL_SCALES[decimals] ?? 10 ** decimals;
  const next = Math.round(value * scale) / scale;
  if (Object.is(next, 0) || Object.is(next, -0)) return "0";
  return String(next);
}

function formatCssLength(value: number, decimals = DEFAULT_ATLAS_CSS_DECIMALS): string {
  const next = roundDecimal(value, decimals);
  return next === "0" ? "0" : `${next}px`;
}

function formatMatrix3dValues(values: readonly number[], decimals = DEFAULT_MATRIX_DECIMALS): string {
  if (values.length === 0) return "";
  let text = roundDecimal(values[0], decimals);
  for (let i = 1; i < values.length; i++) text += `,${roundDecimal(values[i], decimals)}`;
  return text;
}

function formatAffineMatrix3dColumns(
  xCol: Vec3,
  yCol: Vec3,
  zCol: Vec3,
  txCol: Vec3,
  decimals = DEFAULT_MATRIX_DECIMALS,
): string {
  return formatAffineMatrix3dScalars(
    xCol[0], xCol[1], xCol[2],
    yCol[0], yCol[1], yCol[2],
    zCol[0], zCol[1], zCol[2],
    txCol[0], txCol[1], txCol[2],
    decimals,
  );
}

function formatAffineMatrix3dScalars(
  x0: number,
  x1: number,
  x2: number,
  y0: number,
  y1: number,
  y2: number,
  z0: number,
  z1: number,
  z2: number,
  tx0: number,
  tx1: number,
  tx2: number,
  decimals = DEFAULT_MATRIX_DECIMALS,
): string {
  if (decimals === 3) {
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
    return `${rx0},${rx1},${rx2},0,` +
      `${ry0},${ry1},${ry2},0,` +
      `${rz0},${rz1},${rz2},0,` +
      `${rtx0},${rtx1},${rtx2},1`;
  }
  return `${roundDecimal(x0, decimals)},${roundDecimal(x1, decimals)},${roundDecimal(x2, decimals)},0,` +
    `${roundDecimal(y0, decimals)},${roundDecimal(y1, decimals)},${roundDecimal(y2, decimals)},0,` +
    `${roundDecimal(z0, decimals)},${roundDecimal(z1, decimals)},${roundDecimal(z2, decimals)},0,` +
    `${roundDecimal(tx0, decimals)},${roundDecimal(tx1, decimals)},${roundDecimal(tx2, decimals)},1`;
}

function formatAffineMatrix3dTransformScalars(
  x0: number,
  x1: number,
  x2: number,
  y0: number,
  y1: number,
  y2: number,
  z0: number,
  z1: number,
  z2: number,
  tx0: number,
  tx1: number,
  tx2: number,
  decimals = DEFAULT_MATRIX_DECIMALS,
): string {
  if (decimals !== 3) {
    return `matrix3d(${formatAffineMatrix3dScalars(
      x0, x1, x2,
      y0, y1, y2,
      z0, z1, z2,
      tx0, tx1, tx2,
      decimals,
    )})`;
  }
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
  return `matrix3d(${rx0},${rx1},${rx2},0,` +
    `${ry0},${ry1},${ry2},0,` +
    `${rz0},${rz1},${rz2},0,` +
    `${rtx0},${rtx1},${rtx2},1)`;
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

function intersect2DLinesRaw(
  a0x: number,
  a0y: number,
  a1x: number,
  a1y: number,
  b0x: number,
  b0y: number,
  b1x: number,
  b1y: number,
): Vec2 | null {
  const rx = a1x - a0x;
  const ry = a1y - a0y;
  const sx = b1x - b0x;
  const sy = b1y - b0y;
  const det = rx * sy - ry * sx;
  if (Math.abs(det) <= BASIS_EPS) return null;

  const qpx = b0x - a0x;
  const qpy = b0y - a0y;
  const t = (qpx * sy - qpy * sx) / det;
  return [a0x + t * rx, a0y + t * ry];
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

function offsetTrianglePoints(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  amount: number,
): number[] {
  if (amount <= 0) return [x0, y0, x1, y1, x2, y2];
  const area = (x0 * y1 - y0 * x1 + x1 * y2 - y1 * x2 + x2 * y0 - y2 * x0) / 2;
  const fallback = () => expandClipPoints([x0, y0, x1, y1, x2, y2], amount);
  if (Math.abs(area) <= BASIS_EPS) return fallback();

  const outwardSign = area > 0 ? 1 : -1;

  const dx0 = x1 - x0;
  const dy0 = y1 - y0;
  const len0 = Math.sqrt(dx0 * dx0 + dy0 * dy0);
  const dx1 = x2 - x1;
  const dy1 = y2 - y1;
  const len1 = Math.sqrt(dx1 * dx1 + dy1 * dy1);
  const dx2 = x0 - x2;
  const dy2 = y0 - y2;
  const len2 = Math.sqrt(dx2 * dx2 + dy2 * dy2);
  if (len0 <= BASIS_EPS || len1 <= BASIS_EPS || len2 <= BASIS_EPS) return fallback();

  const ox0 = outwardSign * (dy0 / len0) * amount;
  const oy0 = outwardSign * (-dx0 / len0) * amount;
  const l0ax = x0 + ox0;
  const l0ay = y0 + oy0;
  const l0bx = x1 + ox0;
  const l0by = y1 + oy0;

  const ox1 = outwardSign * (dy1 / len1) * amount;
  const oy1 = outwardSign * (-dx1 / len1) * amount;
  const l1ax = x1 + ox1;
  const l1ay = y1 + oy1;
  const l1bx = x2 + ox1;
  const l1by = y2 + oy1;

  const ox2 = outwardSign * (dy2 / len2) * amount;
  const oy2 = outwardSign * (-dx2 / len2) * amount;
  const l2ax = x2 + ox2;
  const l2ay = y2 + oy2;
  const l2bx = x0 + ox2;
  const l2by = y0 + oy2;

  const r0x = l2bx - l2ax;
  const r0y = l2by - l2ay;
  const s0x = l0bx - l0ax;
  const s0y = l0by - l0ay;
  const det0 = r0x * s0y - r0y * s0x;
  if (Math.abs(det0) <= BASIS_EPS) return fallback();
  const q0x = l0ax - l2ax;
  const q0y = l0ay - l2ay;
  const t0 = (q0x * s0y - q0y * s0x) / det0;
  let p0x = l2ax + t0 * r0x;
  let p0y = l2ay + t0 * r0y;

  const r1x = l0bx - l0ax;
  const r1y = l0by - l0ay;
  const s1x = l1bx - l1ax;
  const s1y = l1by - l1ay;
  const det1 = r1x * s1y - r1y * s1x;
  if (Math.abs(det1) <= BASIS_EPS) return fallback();
  const q1x = l1ax - l0ax;
  const q1y = l1ay - l0ay;
  const t1 = (q1x * s1y - q1y * s1x) / det1;
  let p1x = l0ax + t1 * r1x;
  let p1y = l0ay + t1 * r1y;

  const r2x = l1bx - l1ax;
  const r2y = l1by - l1ay;
  const s2x = l2bx - l2ax;
  const s2y = l2by - l2ay;
  const det2 = r2x * s2y - r2y * s2x;
  if (Math.abs(det2) <= BASIS_EPS) return fallback();
  const q2x = l2ax - l1ax;
  const q2y = l2ay - l1ay;
  const t2 = (q2x * s2y - q2y * s2x) / det2;
  let p2x = l1ax + t2 * r2x;
  let p2y = l1ay + t2 * r2y;

  const maxMiter = Math.max(2, amount * 4);
  const m0x = p0x - x0;
  const m0y = p0y - y0;
  const m0 = Math.sqrt(m0x * m0x + m0y * m0y);
  if (m0 > maxMiter) {
    p0x = x0 + (m0x / m0) * maxMiter;
    p0y = y0 + (m0y / m0) * maxMiter;
  }
  const m1x = p1x - x1;
  const m1y = p1y - y1;
  const m1 = Math.sqrt(m1x * m1x + m1y * m1y);
  if (m1 > maxMiter) {
    p1x = x1 + (m1x / m1) * maxMiter;
    p1y = y1 + (m1y / m1) * maxMiter;
  }
  const m2x = p2x - x2;
  const m2y = p2y - y2;
  const m2 = Math.sqrt(m2x * m2x + m2y * m2y);
  if (m2 > maxMiter) {
    p2x = x2 + (m2x / m2) * maxMiter;
    p2y = y2 + (m2y / m2) * maxMiter;
  }

  return [p0x, p0y, p1x, p1y, p2x, p2y];
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
    return offsetTrianglePoints(left, 0, 0, height, baseWidth, height, amount);
  }

  const leftLen = Math.sqrt(left * left + height * height);
  const rightLen = Math.sqrt(right * right + height * height);
  if (leftLen <= BASIS_EPS || rightLen <= BASIS_EPS) {
    return offsetTrianglePoints(left, 0, 0, height, baseWidth, height, amount);
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
    return offsetTrianglePoints(left, 0, 0, height, baseWidth, height, amount);
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

function finiteNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function resolveProjectiveQuadGuards(doc: Document): ProjectiveQuadGuardSettings {
  const win = doc?.defaultView as (Window & ProjectiveQuadGuardGlobal) | null | undefined;
  const overrides = win?.__polycssProjectiveQuadGuards;
  const overrideMaxWeightRatio = overrides?.maxWeightRatio;
  const denomEps = Math.max(
    0,
    finiteNumber(overrides?.denomEps, PROJECTIVE_QUAD_DENOM_EPS),
  );
  const maxWeightRatio = typeof overrideMaxWeightRatio === "number" &&
    Number.isFinite(overrideMaxWeightRatio) &&
    overrideMaxWeightRatio > 0
    ? Math.max(1, overrideMaxWeightRatio)
    : PROJECTIVE_QUAD_MAX_WEIGHT_RATIO;
  const bleed = Math.max(
    0,
    finiteNumber(overrides?.bleed, PROJECTIVE_QUAD_BLEED),
  );

  return {
    denomEps,
    maxWeightRatio,
    bleed,
    disableGuards: overrides?.disableGuards === true,
  };
}

function computeProjectiveQuadCoefficients(
  q: Array<[number, number]>,
  guards: ProjectiveQuadGuardSettings,
): ProjectiveQuadCoefficients | null {
  if (q.length !== 4 || !isConvexPolygonPoints(q)) return null;

  const [q0, q1, q2, q3] = q;
  const sx = q0[0] - q1[0] + q2[0] - q3[0];
  const sy = q0[1] - q1[1] + q2[1] - q3[1];
  const dx1 = q1[0] - q2[0];
  const dx2 = q3[0] - q2[0];
  const dy1 = q1[1] - q2[1];
  const dy2 = q3[1] - q2[1];
  const det = dx1 * dy2 - dy1 * dx2;
  if (Math.abs(det) <= BASIS_EPS) return null;

  const g = (sx * dy2 - sy * dx2) / det;
  const h = (dx1 * sy - dy1 * sx) / det;
  const weights = [1, 1 + g, 1 + g + h, 1 + h];
  if (weights.some((weight) => !Number.isFinite(weight))) {
    return null;
  }

  const minWeight = Math.min(...weights);
  const maxWeight = Math.max(...weights);
  if (!guards.disableGuards) {
    if (minWeight <= guards.denomEps) return null;
    // Very large homogeneous-weight variation means the rectangle's vanishing
    // line is too close to the primitive. Chrome can then tessellate the leaf
    // visibly wrong; the clipped polygon path is steadier for those quads.
    if (maxWeight / minWeight > guards.maxWeightRatio) return null;
  }

  return {
    g,
    h,
    w1: 1 + g,
    w3: 1 + h,
  };
}

function computeProjectiveQuadMatrix(
  screenPts: number[],
  xAxis: Vec3,
  yAxis: Vec3,
  normal: Vec3,
  tx: number,
  ty: number,
  tz: number,
  guards: ProjectiveQuadGuardSettings,
): string | null {
  if (screenPts.length !== 8) return null;
  const rawQ: Array<[number, number]> = [
    [screenPts[0], screenPts[1]],
    [screenPts[2], screenPts[3]],
    [screenPts[4], screenPts[5]],
    [screenPts[6], screenPts[7]],
  ];
  if (!computeProjectiveQuadCoefficients(rawQ, guards)) return null;

  const expandedPts = offsetConvexPolygonPoints(screenPts, guards.bleed);
  const q: Array<[number, number]> = [
    [expandedPts[0], expandedPts[1]],
    [expandedPts[2], expandedPts[3]],
    [expandedPts[4], expandedPts[5]],
    [expandedPts[6], expandedPts[7]],
  ];
  const coeffs = computeProjectiveQuadCoefficients(q, guards);
  if (!coeffs) return null;
  const { g, h, w1, w3 } = coeffs;
  const [q0, q1, , q3] = q;

  const p0: Vec3 = [
    tx + q0[0] * xAxis[0] + q0[1] * yAxis[0],
    ty + q0[0] * xAxis[1] + q0[1] * yAxis[1],
    tz + q0[0] * xAxis[2] + q0[1] * yAxis[2],
  ];
  const projectiveColumn = ([x, y]: Vec2, weight: number): Vec3 => [
    (weight - 1) * tx + (weight * x - q0[0]) * xAxis[0] + (weight * y - q0[1]) * yAxis[0],
    (weight - 1) * ty + (weight * x - q0[0]) * xAxis[1] + (weight * y - q0[1]) * yAxis[1],
    (weight - 1) * tz + (weight * x - q0[0]) * xAxis[2] + (weight * y - q0[1]) * yAxis[2],
  ];

  const values = [
    ...projectiveColumn(q1, w1), g,
    ...projectiveColumn(q3, w3), h,
    normal[0], normal[1], normal[2], 0,
    p0[0], p0[1], p0[2], 1,
  ];
  for (let i = 0; i < 8; i += 1) values[i] /= SOLID_QUAD_CANONICAL_SIZE;
  return formatMatrix3dValues(values, 6);
}

function formatPercent(value: number, decimals = DEFAULT_BORDER_SHAPE_DECIMALS): string {
  const next = roundDecimal(value, decimals);
  return Number(next) === 0 ? "0" : `${next}%`;
}

function pointOnSegment(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): boolean {
  const cross = (px - ax) * (by - ay) - (py - ay) * (bx - ax);
  if (Math.abs(cross) > BORDER_SHAPE_POINT_EPS) return false;
  const dot = (px - ax) * (px - bx) + (py - ay) * (py - by);
  return dot <= BORDER_SHAPE_POINT_EPS;
}

function polygonContainsPoint(
  points: Array<[number, number]>,
  px = BORDER_SHAPE_CENTER_PERCENT,
  py = BORDER_SHAPE_CENTER_PERCENT,
): boolean {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [xi, yi] = points[i];
    const [xj, yj] = points[j];
    if (pointOnSegment(px, py, xi, yi, xj, yj)) return true;
    if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

function atlasArea(pages: PackedPage[]): number {
  return pages.reduce((sum, page) => sum + page.width * page.height, 0);
}

function autoAtlasScaleCap(pages: PackedPage[], maxDecodedBytes: number): number {
  const area = atlasArea(pages);
  if (area <= 0) return 1;

  const maxSide = Math.max(
    1,
    ...pages.map((page) => Math.max(page.width, page.height)),
  );
  const sideScale = AUTO_ATLAS_MAX_BITMAP_SIDE / maxSide;
  const memoryScale = Math.sqrt(maxDecodedBytes / (area * 4));

  return normalizeAtlasScale(Math.min(sideScale, memoryScale));
}

function autoAtlasScale(pages: PackedPage[], maxDecodedBytes: number): number {
  const area = atlasArea(pages);
  let atlasScale = 0.5;
  if (area <= AUTO_ATLAS_LOW_AREA) atlasScale = 1;
  else if (area <= AUTO_ATLAS_MEDIUM_AREA) atlasScale = 0.75;

  return normalizeAtlasScale(Math.min(atlasScale, autoAtlasScaleCap(pages, maxDecodedBytes)));
}

function atlasBitmapMaxSide(pages: PackedPage[], atlasScale: number): number {
  return pages.reduce((max, page) => Math.max(
    max,
    Math.ceil(page.width * atlasScale),
    Math.ceil(page.height * atlasScale),
  ), 0);
}

function atlasDecodedBytes(pages: PackedPage[], atlasScale: number): number {
  return pages.reduce((sum, page) =>
    sum +
    Math.ceil(page.width * atlasScale) *
    Math.ceil(page.height * atlasScale) *
    4
  , 0);
}

function autoAtlasBudgetFactor(
  pages: PackedPage[],
  atlasScale: number,
  maxDecodedBytes: number,
): number {
  const maxSide = atlasBitmapMaxSide(pages, atlasScale);
  const decodedBytes = atlasDecodedBytes(pages, atlasScale);
  const sideFactor = maxSide > AUTO_ATLAS_MAX_BITMAP_SIDE
    ? AUTO_ATLAS_MAX_BITMAP_SIDE / maxSide
    : 1;
  const memoryFactor = decodedBytes > maxDecodedBytes
    ? Math.sqrt(maxDecodedBytes / decodedBytes)
    : 1;
  return Math.min(sideFactor, memoryFactor);
}

function packTextureAtlasPlansAuto(
  plans: Array<TextureAtlasPlan | null>,
  fullScalePacked: PackedAtlas,
  maxDecodedBytes: number,
): { packed: PackedAtlas; atlasScale: number } {
  let atlasScale = autoAtlasScale(fullScalePacked.pages, maxDecodedBytes);
  let packed = atlasScale === 1
    ? fullScalePacked
    : packTextureAtlasPlans(plans, atlasScale);

  // Lower scales increase padding, so verify the final packed bitmap budget.
  for (let i = 0; i < 4; i++) {
    const factor = autoAtlasBudgetFactor(packed.pages, atlasScale, maxDecodedBytes);
    if (factor >= 1) break;

    const nextAtlasScale = normalizeAtlasScale(atlasScale * factor * AUTO_ATLAS_SCALE_GUARD);
    if (nextAtlasScale >= atlasScale) break;
    atlasScale = nextAtlasScale;
    packed = packTextureAtlasPlans(plans, atlasScale);
  }

  return { packed, atlasScale };
}

function autoAtlasMaxDecodedBytes(doc: Document | null | undefined): number {
  return isMobileDocument(doc)
    ? AUTO_ATLAS_MAX_DECODED_BYTES_MOBILE
    : AUTO_ATLAS_MAX_DECODED_BYTES_DESKTOP;
}

function isMobileDocument(doc: Document | null | undefined): boolean {
  if (!doc) return false;
  const win = doc.defaultView ?? (typeof window !== "undefined" ? window : undefined);
  const media = win?.matchMedia;
  if (!media) return false;
  // Same device-class heuristic as borderShapeSupported: coarse pointer or
  // no hover capability = phone/tablet, which has a tight GPU-memory budget
  // for composited 3D layers.
  return media("(pointer: coarse)").matches || media("(hover: none)").matches;
}

function atlasCanonicalSizeForTextureQuality(
  textureQualityInput: TextureQuality | undefined,
  doc: Document | null | undefined,
): number {
  if (textureQualityInput !== undefined && textureQualityInput !== "auto") {
    return ATLAS_CANONICAL_SIZE_EXPLICIT;
  }
  return isMobileDocument(doc)
    ? ATLAS_CANONICAL_SIZE_EXPLICIT
    : ATLAS_CANONICAL_SIZE_AUTO_DESKTOP;
}

function formatAtlasMatrix(
  entry: TextureAtlasPlan,
  atlasCanonicalSize: number,
): string {
  const values = entry.matrix.split(",").map((value) => Number(value));
  if (values.length !== 16 || values.some((value) => !Number.isFinite(value))) {
    return entry.canonicalMatrix;
  }
  values[0] *= entry.canvasW / atlasCanonicalSize;
  values[1] *= entry.canvasW / atlasCanonicalSize;
  values[2] *= entry.canvasW / atlasCanonicalSize;
  values[4] *= entry.canvasH / atlasCanonicalSize;
  values[5] *= entry.canvasH / atlasCanonicalSize;
  values[6] *= entry.canvasH / atlasCanonicalSize;
  return formatMatrix3dValues(values);
}

function applyPackedAtlasCanonicalSize(
  packed: PackedAtlas,
  atlasCanonicalSize: number,
): PackedAtlas {
  for (const entry of packed.entries) {
    if (!entry) continue;
    entry.atlasCanonicalSize = atlasCanonicalSize;
    entry.atlasMatrix = formatAtlasMatrix(entry, atlasCanonicalSize);
  }
  return packed;
}

function atlasCanonicalSizeForEntry(entry: TextureAtlasPlan): number {
  return entry.atlasCanonicalSize ?? ATLAS_CANONICAL_SIZE_EXPLICIT;
}

export function packTextureAtlasPlansWithScale(
  plans: Array<TextureAtlasPlan | null>,
  textureQualityInput: TextureQuality | undefined,
  doc: Document | null | undefined,
): { packed: PackedAtlas; atlasScale: number; atlasCanonicalSize: number } {
  const atlasCanonicalSize = atlasCanonicalSizeForTextureQuality(textureQualityInput, doc);
  if (textureQualityInput !== undefined && textureQualityInput !== "auto") {
    const atlasScale = normalizeAtlasScale(textureQualityInput);
    return {
      packed: applyPackedAtlasCanonicalSize(packTextureAtlasPlans(plans, atlasScale), atlasCanonicalSize),
      atlasScale,
      atlasCanonicalSize,
    };
  }

  const fullScalePacked = packTextureAtlasPlans(plans, 1);
  const autoPacked = packTextureAtlasPlansAuto(plans, fullScalePacked, autoAtlasMaxDecodedBytes(doc));
  return {
    packed: applyPackedAtlasCanonicalSize(autoPacked.packed, atlasCanonicalSize),
    atlasScale: autoPacked.atlasScale,
    atlasCanonicalSize,
  };
}

function atlasPadding(atlasScale: number): number {
  return Math.max(ATLAS_PADDING, Math.ceil(ATLAS_PADDING / atlasScale));
}

function setCssTransform(
  ctx: CanvasRenderingContext2D,
  atlasScale: number,
  a = 1,
  b = 0,
  c = 0,
  d = 1,
  e = 0,
  f = 0,
): void {
  ctx.setTransform(
    a * atlasScale,
    b * atlasScale,
    c * atlasScale,
    d * atlasScale,
    e * atlasScale,
    f * atlasScale,
  );
}

function parseHex(hex: string): RGB {
  // Tolerate any CSS color string the renderer hands us — hex, rgb(),
  // or rgba(). createTransformControls passes rgba() colors to fade
  // arrows on hover/drag.
  const parsed = cachedParsePureColor(hex);
  if (!parsed) return { r: 255, g: 255, b: 255 };
  return { r: parsed.rgb[0], g: parsed.rgb[1], b: parsed.rgb[2] };
}

function rgbKey({ r, g, b }: RGB): string {
  return `${r},${g},${b}`;
}

/** Returns the parsed alpha for a color string (1.0 default). */
function parseAlpha(input: string): number {
  return cachedParsePureColor(input)?.alpha ?? 1;
}

function rgbToHex({ r, g, b }: RGB): string {
  const f = (n: number) =>
    Math.round(Math.max(0, Math.min(255, n))).toString(16).padStart(2, "0");
  return `#${f(r)}${f(g)}${f(b)}`;
}

function setInlineStyleProperty(el: HTMLElement, property: string, value: string): void {
  const current = el.getAttribute("style") ?? "";
  const declaration = `${property}:${value}`;
  const escaped = property.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`(^|;)\\s*${escaped}\\s*:[^;]*`, "i");
  const next = pattern.test(current)
    ? current.replace(pattern, (_match, prefix: string) => `${prefix}${declaration}`)
    : `${current}${current.trim() && !current.trim().endsWith(";") ? ";" : ""}${declaration}`;
  if (next !== current) el.setAttribute("style", next);
}

function removeInlineStyleProperty(el: HTMLElement, property: string): void {
  const current = el.getAttribute("style") ?? "";
  if (!current) return;
  const escaped = property.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const matcher = new RegExp(`^\\s*${escaped}\\s*:`, "i");
  const next = current
    .split(";")
    .map((declaration) => declaration.trim())
    .filter((declaration) => declaration && !matcher.test(declaration))
    .join(";");
  if (next) el.setAttribute("style", next);
  else el.removeAttribute("style");
}

function cachedParsePureColor(input: string): PureColorParseResult {
  if (PURE_COLOR_CACHE.has(input)) {
    const cached = PURE_COLOR_CACHE.get(input);
    return cached === undefined ? null : cached;
  }
  const parsed = parsePureColor(input);
  if (PURE_COLOR_CACHE.size >= COLOR_PARSE_CACHE_MAX) PURE_COLOR_CACHE.clear();
  PURE_COLOR_CACHE.set(input, parsed);
  return parsed;
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
  // Preserve the base polygon's alpha. Lighting only modulates RGB —
  // a translucent input (e.g. createTransformControls arrows at idle)
  // must keep its alpha so the gizmo stays see-through after shading.
  const alpha = parseAlpha(baseColor);
  return alpha < 1
    ? `rgba(${r}, ${g}, ${b}, ${alpha})`
    : rgbToHex({ r, g, b });
}

function quantizeCssColor(input: string, steps: number): string {
  if (!Number.isFinite(steps) || steps <= 1) return input;
  const parsed = cachedParsePureColor(input);
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

function rgbEqual(a: RGB | undefined, b: RGB | undefined): boolean {
  return !!a && !!b && a.r === b.r && a.g === b.g && a.b === b.b;
}

function stepRgbToward(current: RGB, target: RGB, maxStep: number): RGB {
  const step = (from: number, to: number) => {
    const delta = to - from;
    if (Math.abs(delta) <= maxStep) return to;
    return from + Math.sign(delta) * maxStep;
  };
  return {
    r: step(current.r, target.r),
    g: step(current.g, target.g),
    b: step(current.b, target.b),
  };
}

function rgbToCss(rgb: RGB, alpha = 1): string {
  return alpha < 1
    ? `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha})`
    : rgbToHex(rgb);
}

function colorErrorScore(current: string | undefined, next: string): number {
  if (current === undefined) return Number.POSITIVE_INFINITY;
  if (current === next) return 0;
  const currentColor = cachedParsePureColor(current);
  const nextColor = cachedParsePureColor(next);
  if (!currentColor || !nextColor) return 1;
  const dr = currentColor.rgb[0] - nextColor.rgb[0];
  const dg = currentColor.rgb[1] - nextColor.rgb[1];
  const db = currentColor.rgb[2] - nextColor.rgb[2];
  const da = (currentColor.alpha - nextColor.alpha) * 255;
  return Math.sqrt(dr * dr + dg * dg + db * db + da * da) / 510;
}

function stableTriangleColorState(options: InternalRenderTextureAtlasOptions): StableTriangleColorState {
  return {
    updatesDisabled: options.stableTriangleColorFreezeFrames === 0,
    freezeFrames: Math.max(1, Math.floor(options.stableTriangleColorFreezeFrames ?? 1)),
    colorFrame: Math.max(0, Math.floor(options.stableTriangleColorFrame ?? 0)),
    maxStep: Math.max(0, Math.floor(options.stableTriangleColorMaxStep ?? 0)),
  };
}

function stableTriangleColorAllowed(index: number, state: StableTriangleColorState): boolean {
  return !state.updatesDisabled &&
    (state.freezeFrames <= 1 || (state.colorFrame + index) % state.freezeFrames === 0);
}

function shouldComputeStableTriangleColor(
  element: HTMLElement,
  index: number,
  optimizeTriangleStyle: boolean,
  stableTriangleDebug: InternalRenderTextureAtlasOptions["stableTriangleDebug"],
  stableTriangleColorPolicy: InternalRenderTextureAtlasOptions["stableTriangleColorPolicy"],
  colorState: StableTriangleColorState,
): boolean {
  if (!optimizeTriangleStyle) return true;
  if (stableTriangleDebug === "plan-only" || stableTriangleDebug === "transform-only") return false;
  if (stableTriangleColorPolicy === "adaptive") return true;
  if ((element as SolidTriangleElement).__polycssSolidTriangleColor === undefined) return true;
  return stableTriangleColorAllowed(index, colorState);
}

function textureTintFactors(
  directScale: number,
  lightColor: string,
  ambientColor: string,
  ambientIntensity: number,
): RGBFactors {
  const light = parseHex(lightColor);
  const amb = parseHex(ambientColor);
  return {
    r: (amb.r / 255) * ambientIntensity + (light.r / 255) * directScale,
    g: (amb.g / 255) * ambientIntensity + (light.g / 255) * directScale,
    b: (amb.b / 255) * ambientIntensity + (light.b / 255) * directScale,
  };
}

function tintToCss({ r, g, b }: RGBFactors): string {
  const f = (n: number) => Math.round(Math.max(0, Math.min(1, n)) * 255);
  return `rgb(${f(r)} ${f(g)} ${f(b)})`;
}

function applyTextureTint(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  tint: RGBFactors,
  atlasScale: number,
): void {
  if (
    Math.abs(tint.r - 1) < 0.001 &&
    Math.abs(tint.g - 1) < 0.001 &&
    Math.abs(tint.b - 1) < 0.001
  ) {
    return;
  }
  ctx.save();
  setCssTransform(ctx, atlasScale);
  ctx.globalCompositeOperation = "multiply";
  ctx.fillStyle = tintToCss(tint);
  ctx.fillRect(x, y, width, height);
  ctx.restore();
}

function drawImageCover(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  x: number,
  y: number,
  width: number,
  height: number,
  atlasScale: number,
): void {
  const srcW = img.naturalWidth || img.width || 1;
  const srcH = img.naturalHeight || img.height || 1;
  const scale = Math.max(width / srcW, height / srcH);
  const drawW = srcW * scale;
  const drawH = srcH * scale;
  setCssTransform(ctx, atlasScale);
  ctx.drawImage(img, x + (width - drawW) / 2, y + (height - drawH) / 2, drawW, drawH);
}

function pointKey(point: Vec3): string {
  return `${point[0]},${point[1]},${point[2]}`;
}

function edgeKey(a: Vec3, b: Vec3): string {
  const ak = pointKey(a);
  const bk = pointKey(b);
  return ak < bk ? `${ak}|${bk}` : `${bk}|${ak}`;
}

export function buildTextureEdgeRepairSets(polygons: Polygon[]): Array<Set<number> | undefined> {
  const edgeOwners = new Map<string, Array<{ polygon: number; edge: number }>>();
  for (let polygonIndex = 0; polygonIndex < polygons.length; polygonIndex++) {
    const vertices = polygons[polygonIndex].vertices;
    if (!vertices || vertices.length < 3 || !polygons[polygonIndex].texture) continue;
    for (let edgeIndex = 0; edgeIndex < vertices.length; edgeIndex++) {
      const key = edgeKey(vertices[edgeIndex], vertices[(edgeIndex + 1) % vertices.length]);
      const owners = edgeOwners.get(key);
      const owner = { polygon: polygonIndex, edge: edgeIndex };
      if (owners) owners.push(owner);
      else edgeOwners.set(key, [owner]);
    }
  }
  const repairEdges = polygons.map(() => new Set<number>());
  for (const owners of edgeOwners.values()) {
    if (owners.length < 2) continue;
    for (let i = 0; i < owners.length; i++) {
      for (let j = i + 1; j < owners.length; j++) {
        repairEdges[owners[i].polygon].add(owners[i].edge);
        repairEdges[owners[j].polygon].add(owners[j].edge);
      }
    }
  }
  return repairEdges.map((edges) => edges.size > 0 ? edges : undefined);
}

function canonicalEdgeVector(a: Vec3, b: Vec3): Vec3 {
  return pointKey(a) < pointKey(b)
    ? [b[0] - a[0], b[1] - a[1], b[2] - a[2]]
    : [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function isBasisOptimizable(polygon: Polygon): boolean {
  return !polygon.texture;
}

function cssPoints(vertices: Vec3[], tile: number, elev: number): Vec3[] {
  return vertices.map((v): Vec3 => [v[1] * tile, v[0] * tile, v[2] * elev]);
}

function computeSurfaceNormal(pts: Vec3[]): Vec3 | null {
  if (pts.length < 3) return null;
  const p0 = pts[0];
  let nx = 0;
  let ny = 0;
  let nz = 0;
  for (let i = 1; i + 1 < pts.length; i++) {
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const e1: Vec3 = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]];
    const e2: Vec3 = [p2[0] - p0[0], p2[1] - p0[1], p2[2] - p0[2]];
    nx -= e1[1] * e2[2] - e1[2] * e2[1];
    ny -= e1[2] * e2[0] - e1[0] * e2[2];
    nz -= e1[0] * e2[1] - e1[1] * e2[0];
  }
  const nLen = Math.hypot(nx, ny, nz);
  if (nLen <= BASIS_EPS) return null;
  nx /= nLen; ny /= nLen; nz /= nLen;
  return [nx, ny, nz];
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

function getPolygonBasisInfo(
  polygon: Polygon,
  tile: number,
  elev: number,
): PolygonBasisInfo | null {
  if (!polygon.vertices || polygon.vertices.length < 3) return null;
  const pts = cssPoints(polygon.vertices, tile, elev);
  const normal = computeSurfaceNormal(pts);
  if (!normal) return null;
  return {
    pts,
    normal,
    planeD: dotVec(normal, pts[0]),
    optimizable: isBasisOptimizable(polygon),
  };
}

function compatibleSurface(
  a: PolygonBasisInfo | null,
  b: PolygonBasisInfo | null,
): boolean {
  if (!a || !b || !a.optimizable || !b.optimizable) return false;
  return compatibleBleedSurface(a, b);
}

function compatibleBleedSurface(
  a: PolygonBasisInfo | null,
  b: PolygonBasisInfo | null,
): boolean {
  if (!a || !b) return false;
  if (dotVec(a.normal, b.normal) < 1 - SURFACE_NORMAL_EPS) return false;
  return Math.abs(a.planeD - b.planeD) <= SURFACE_DISTANCE_EPS;
}

function seamLightBrightness(
  info: PolygonBasisInfo | null,
  options: RenderTextureAtlasOptions,
): number | null {
  if (!info) return null;
  const directionalCfg = options.directionalLight;
  const ambientCfg = options.ambientLight;
  const lightDir = directionalCfg?.direction ?? DEFAULT_LIGHT_DIR;
  const lightColor = directionalCfg?.color ?? DEFAULT_LIGHT_COLOR;
  const lightIntensity = Math.max(0, directionalCfg?.intensity ?? DEFAULT_LIGHT_INTENSITY);
  const ambientColor = ambientCfg?.color ?? DEFAULT_AMBIENT_COLOR;
  const ambientIntensity = Math.max(0, ambientCfg?.intensity ?? DEFAULT_AMBIENT_INTENSITY);
  const lLen = Math.hypot(lightDir[0], lightDir[1], lightDir[2]) || 1;
  const lx = lightDir[0] / lLen, ly = lightDir[1] / lLen, lz = lightDir[2] / lLen;
  const directScale = lightIntensity * Math.max(0, info.normal[0] * lx + info.normal[1] * ly + info.normal[2] * lz);
  const tint = textureTintFactors(directScale, lightColor, ambientColor, ambientIntensity);
  return tint.r * 0.2126 + tint.g * 0.7152 + tint.b * 0.0722;
}

function basisAxisKey(axis: Vec3): string {
  const canonical: Vec3 = [...axis] as Vec3;
  const first = Math.abs(canonical[0]) > BASIS_EPS
    ? 0
    : Math.abs(canonical[1]) > BASIS_EPS
      ? 1
      : 2;
  if (canonical[first] < 0) {
    canonical[0] *= -1;
    canonical[1] *= -1;
    canonical[2] *= -1;
  }
  return `${canonical[0].toFixed(6)},${canonical[1].toFixed(6)},${canonical[2].toFixed(6)}`;
}

function makeLocalBasis(
  pts: Vec3[],
  origin: Vec3,
  normal: Vec3,
  rawXAxis: Vec3,
  options: { boundsOrigin?: Vec3; snapBounds?: boolean } = {},
): LocalBasis | null {
  const dot = dotVec(rawXAxis, normal);
  const planeX: Vec3 = [
    rawXAxis[0] - dot * normal[0],
    rawXAxis[1] - dot * normal[1],
    rawXAxis[2] - dot * normal[2],
  ];
  const xLength = Math.hypot(planeX[0], planeX[1], planeX[2]);
  if (xLength <= BASIS_EPS) return null;

  const xAxis: Vec3 = [
    planeX[0] / xLength,
    planeX[1] / xLength,
    planeX[2] / xLength,
  ];
  const yAxisRaw: Vec3 = [
    normal[1] * xAxis[2] - normal[2] * xAxis[1],
    normal[2] * xAxis[0] - normal[0] * xAxis[2],
    normal[0] * xAxis[1] - normal[1] * xAxis[0],
  ];
  const yLength = Math.hypot(yAxisRaw[0], yAxisRaw[1], yAxisRaw[2]);
  if (yLength <= BASIS_EPS) return null;
  const yAxis: Vec3 = [
    yAxisRaw[0] / yLength,
    yAxisRaw[1] / yLength,
    yAxisRaw[2] / yLength,
  ];

  const local2D = pts.map((p): Vec2 => {
    const dx = p[0] - origin[0], dy = p[1] - origin[1], dz = p[2] - origin[2];
    return [
      dx * xAxis[0] + dy * xAxis[1] + dz * xAxis[2],
      dx * yAxis[0] + dy * yAxis[1] + dz * yAxis[2],
    ];
  });

  const boundsOrigin = options.boundsOrigin ?? origin;
  const odx = origin[0] - boundsOrigin[0];
  const ody = origin[1] - boundsOrigin[1];
  const odz = origin[2] - boundsOrigin[2];
  const originOffsetX = odx * xAxis[0] + ody * xAxis[1] + odz * xAxis[2];
  const originOffsetY = odx * yAxis[0] + ody * yAxis[1] + odz * yAxis[2];
  let xMin = Infinity, yMin = Infinity, xMax = -Infinity, yMax = -Infinity;
  for (const [x, y] of local2D) {
    const boundsX = x + originOffsetX;
    const boundsY = y + originOffsetY;
    if (boundsX < xMin) xMin = boundsX; if (boundsX > xMax) xMax = boundsX;
    if (boundsY < yMin) yMin = boundsY; if (boundsY > yMax) yMax = boundsY;
  }

  const w = xMax - xMin;
  const h = yMax - yMin;
  if (!Number.isFinite(w) || !Number.isFinite(h)) return null;

  const boxMinX = options.snapBounds ? Math.floor(xMin + RECT_EPS) : xMin;
  const boxMinY = options.snapBounds ? Math.floor(yMin + RECT_EPS) : yMin;
  const boxMaxX = options.snapBounds ? Math.ceil(xMax - RECT_EPS) : xMax;
  const boxMaxY = options.snapBounds ? Math.ceil(yMax - RECT_EPS) : yMax;
  const canvasW = Math.max(1, options.snapBounds ? boxMaxX - boxMinX : Math.ceil(w));
  const canvasH = Math.max(1, options.snapBounds ? boxMaxY - boxMinY : Math.ceil(h));
  return {
    xAxis,
    yAxis,
    local2D,
    shiftX: originOffsetX - boxMinX,
    shiftY: originOffsetY - boxMinY,
    canvasW,
    canvasH,
    pixelArea: canvasW * canvasH,
    rawArea: w * h,
  };
}

function evaluateIslandAxis(
  component: number[],
  infos: Array<PolygonBasisInfo | null>,
  axis: Vec3,
  boundsOrigin: Vec3,
): { pixelArea: number; rawArea: number } | null {
  let pixelArea = 0;
  let rawArea = 0;
  for (const index of component) {
    const info = infos[index];
    if (!info) return null;
    const basis = makeLocalBasis(info.pts, info.pts[0], info.normal, axis, {
      boundsOrigin,
      snapBounds: true,
    });
    if (!basis) return null;
    pixelArea += basis.pixelArea;
    rawArea += basis.rawArea;
  }
  return { pixelArea, rawArea };
}

function chooseIslandXAxis(
  component: number[],
  infos: Array<PolygonBasisInfo | null>,
): BasisHint | null {
  const boundsOrigin = infos[component[0]]?.pts[0];
  if (!boundsOrigin) return null;
  let baseline: { pixelArea: number; rawArea: number } | null = { pixelArea: 0, rawArea: 0 };
  let best: { xAxis: Vec3; pixelArea: number; rawArea: number } | null = null;
  const seen = new Set<string>();

  for (const polygonIndex of component) {
    const info = infos[polygonIndex];
    if (!info) continue;

    const firstEdge: Vec3 = [
      info.pts[1][0] - info.pts[0][0],
      info.pts[1][1] - info.pts[0][1],
      info.pts[1][2] - info.pts[0][2],
    ];
    const firstBasis = makeLocalBasis(info.pts, info.pts[0], info.normal, firstEdge);
    if (baseline && firstBasis) {
      baseline.pixelArea += firstBasis.pixelArea;
      baseline.rawArea += firstBasis.rawArea;
    } else {
      baseline = null;
    }

    for (let i = 0; i < info.pts.length; i++) {
      const rawAxis = canonicalEdgeVector(info.pts[i], info.pts[(i + 1) % info.pts.length]);
      const basis = makeLocalBasis(info.pts, info.pts[0], info.normal, rawAxis);
      if (!basis) continue;
      const key = basisAxisKey(basis.xAxis);
      if (seen.has(key)) continue;
      seen.add(key);

      const candidate = evaluateIslandAxis(component, infos, basis.xAxis, boundsOrigin);
      if (!candidate) continue;
      if (
        !best ||
        candidate.pixelArea < best.pixelArea ||
        (candidate.pixelArea === best.pixelArea && candidate.rawArea < best.rawArea - RECT_EPS)
      ) {
        best = { xAxis: basis.xAxis, ...candidate };
      }
    }
  }

  if (!best) return null;
  if (
    baseline &&
    (
      best.pixelArea < baseline.pixelArea ||
      (best.pixelArea === baseline.pixelArea && best.rawArea <= baseline.rawArea + RECT_EPS)
    )
  ) {
    return { xAxis: best.xAxis, boundsOrigin, seamEdges: new Set<number>() };
  }
  return null;
}

function buildBasisHints(
  polygons: Polygon[],
  options: RenderTextureAtlasOptions,
): Array<BasisHint | undefined> {
  const tile = options.tileSize ?? DEFAULT_TILE;
  const elev = options.layerElevation ?? tile;
  const infos = polygons.map((polygon) => getPolygonBasisInfo(polygon, tile, elev));
  const edgeOwners = new Map<string, Array<{ polygon: number; edge: number }>>();
  const seamEdges = polygons.map(() => new Set<number>());
  const textureEdgeRepairEdges = polygons.map(() => new Set<number>());
  for (let polygonIndex = 0; polygonIndex < polygons.length; polygonIndex++) {
    const vertices = polygons[polygonIndex].vertices;
    if (!vertices || vertices.length < 3) continue;
    for (let edgeIndex = 0; edgeIndex < vertices.length; edgeIndex++) {
      const key = edgeKey(
        vertices[edgeIndex],
        vertices[(edgeIndex + 1) % vertices.length],
      );
      const owners = edgeOwners.get(key);
      const owner = { polygon: polygonIndex, edge: edgeIndex };
      if (owners) owners.push(owner);
      else edgeOwners.set(key, [owner]);
    }
  }

  const adjacency = polygons.map(() => new Set<number>());
  for (const owners of edgeOwners.values()) {
    if (owners.length < 2) continue;
    for (let i = 0; i < owners.length; i++) {
      for (let j = i + 1; j < owners.length; j++) {
        const aOwner = owners[i];
        const bOwner = owners[j];
        const a = aOwner.polygon;
        const b = bOwner.polygon;
        if (polygons[a].texture && polygons[b].texture) {
          textureEdgeRepairEdges[aOwner.polygon].add(aOwner.edge);
          textureEdgeRepairEdges[bOwner.polygon].add(bOwner.edge);
        }
        if (compatibleBleedSurface(infos[a], infos[b])) {
          seamEdges[aOwner.polygon].add(aOwner.edge);
          seamEdges[bOwner.polygon].add(bOwner.edge);
        } else {
          const aLight = seamLightBrightness(infos[a], options);
          const bLight = seamLightBrightness(infos[b], options);
          if (aLight !== null && bLight !== null) {
            if (aLight <= bLight + SEAM_LIGHT_EPS) seamEdges[aOwner.polygon].add(aOwner.edge);
            if (bLight <= aLight + SEAM_LIGHT_EPS) seamEdges[bOwner.polygon].add(bOwner.edge);
          }
        }
        if (!compatibleSurface(infos[a], infos[b])) continue;
        adjacency[a].add(b);
        adjacency[b].add(a);
      }
    }
  }

  const hints: Array<BasisHint | undefined> = Array(polygons.length).fill(undefined);
  const visited = new Set<number>();
  for (let i = 0; i < polygons.length; i++) {
    if (visited.has(i) || !infos[i]?.optimizable) continue;
    const component: number[] = [];
    const stack = [i];
    visited.add(i);
    while (stack.length > 0) {
      const current = stack.pop()!;
      component.push(current);
      for (const next of adjacency[current]) {
        if (visited.has(next)) continue;
        visited.add(next);
        stack.push(next);
      }
    }

    if (component.length < 2) continue;
    const hint = chooseIslandXAxis(component, infos);
    if (!hint) continue;
    for (const index of component) {
      hints[index] = {
        xAxis: hint.xAxis,
        boundsOrigin: hint.boundsOrigin,
        seamEdges: seamEdges[index],
        textureEdgeRepairEdges: textureEdgeRepairEdges[index],
      };
    }
  }

  for (let i = 0; i < polygons.length; i++) {
    if (!hints[i] && (seamEdges[i].size > 0 || textureEdgeRepairEdges[i].size > 0)) {
      hints[i] = {
        seamEdges: seamEdges[i],
        textureEdgeRepairEdges: textureEdgeRepairEdges[i],
      };
    }
  }

  return hints;
}

function canvasToUrl(canvas: HTMLCanvasElement): Promise<string | null> {
  if (typeof canvas.toBlob === "function") {
    return new Promise((resolve) => {
      canvas.toBlob((blob) => {
        resolve(blob ? URL.createObjectURL(blob) : null);
      }, "image/png");
    });
  }
  try {
    return Promise.resolve(canvas.toDataURL("image/png"));
  } catch {
    return Promise.resolve(null);
  }
}

function chooseLocalBasis(
  pts: Vec3[],
  origin: Vec3,
  normal: Vec3,
  options: BasisOptions,
): LocalBasis | null {
  if (options.optimize && options.fixedXAxis) {
    return makeLocalBasis(pts, origin, normal, options.fixedXAxis, {
      boundsOrigin: options.boundsOrigin,
      snapBounds: options.snapBounds,
    });
  }

  let best: LocalBasis | null = null;
  const seamCandidates = options.optimize && options.seamEdges && options.seamEdges.size > 0
    ? Array.from(options.seamEdges)
    : null;
  const candidateEdges = seamCandidates ?? (
    options.optimize
      ? pts.map((_, edgeIndex) => edgeIndex)
      : [0]
  );

  for (const i of candidateEdges) {
    const next = (i + 1) % pts.length;
    const edge = seamCandidates
      ? canonicalEdgeVector(pts[i], pts[next])
      : [
          pts[next][0] - pts[i][0],
          pts[next][1] - pts[i][1],
          pts[next][2] - pts[i][2],
        ] as Vec3;
    const candidate = makeLocalBasis(pts, origin, normal, edge, {
      boundsOrigin: options.boundsOrigin,
      snapBounds: options.snapBounds,
    });
    if (!candidate) continue;

    if (
      !best ||
      candidate.pixelArea < best.pixelArea ||
      (candidate.pixelArea === best.pixelArea && candidate.rawArea < best.rawArea - RECT_EPS)
    ) {
      best = candidate;
    }
  }

  return best;
}

function isFullRectBasis(basis: LocalBasis): boolean {
  if (basis.local2D.length !== 4) return false;

  const xs: number[] = [];
  const ys: number[] = [];
  const addUnique = (list: number[], value: number): void => {
    for (const existing of list) {
      if (Math.abs(existing - value) <= RECT_EPS) return;
    }
    list.push(value);
  };

  for (const [x, y] of basis.local2D) {
    addUnique(xs, x + basis.shiftX);
    addUnique(ys, y + basis.shiftY);
  }
  if (xs.length !== 2 || ys.length !== 2) return false;

  xs.sort((a, b) => a - b);
  ys.sort((a, b) => a - b);
  if (
    Math.abs(xs[0]) > RECT_EPS ||
    Math.abs(ys[0]) > RECT_EPS ||
    xs[1] - xs[0] <= RECT_EPS ||
    ys[1] - ys[0] <= RECT_EPS
  ) {
    return false;
  }

  for (const [rawX, rawY] of basis.local2D) {
    const x = rawX + basis.shiftX;
    const y = rawY + basis.shiftY;
    const onX = Math.abs(x - xs[0]) <= RECT_EPS || Math.abs(x - xs[1]) <= RECT_EPS;
    const onY = Math.abs(y - ys[0]) <= RECT_EPS || Math.abs(y - ys[1]) <= RECT_EPS;
    if (!onX || !onY) return false;
  }
  return true;
}

function computeUvAffine(points: Vec2[], uvs: Vec2[]): UvAffine | null {
  if (points.length < 3 || uvs.length < 3) return null;
  const [p0, p1, p2] = points;
  const [uv0, uv1, uv2] = uvs;
  const sx0 = p0[0], sy0 = p0[1];
  const sx1 = p1[0], sy1 = p1[1];
  const sx2 = p2[0], sy2 = p2[1];
  const u0 = uv0[0], V0 = 1 - uv0[1];
  const u1 = uv1[0], V1 = 1 - uv1[1];
  const u2 = uv2[0], V2 = 1 - uv2[1];
  const du1 = u1 - u0, dV1 = V1 - V0;
  const du2 = u2 - u0, dV2 = V2 - V0;
  const det = du1 * dV2 - du2 * dV1;
  if (Math.abs(det) <= 1e-9) return null;

  const dx1 = sx1 - sx0, dx2 = sx2 - sx0;
  const dy1 = sy1 - sy0, dy2 = sy2 - sy0;
  const affine = {
    a: (dx1 * dV2 - dx2 * dV1) / det,
    b: (du1 * dx2 - du2 * dx1) / det,
    c: (dy1 * dV2 - dy2 * dV1) / det,
    d: (du1 * dy2 - du2 * dy1) / det,
    e: 0,
    f: 0,
  };
  affine.e = sx0 - affine.a * u0 - affine.b * V0;
  affine.f = sy0 - affine.c * u0 - affine.d * V0;
  return affine;
}

function computeUvSampleRect(uvs: Vec2[]): UvSampleRect | null {
  if (uvs.length === 0) return null;
  let minU = Infinity;
  let minV = Infinity;
  let maxU = -Infinity;
  let maxV = -Infinity;
  for (const uv of uvs) {
    const u = uv[0];
    const v = 1 - uv[1];
    if (!Number.isFinite(u) || !Number.isFinite(v)) return null;
    minU = Math.min(minU, u);
    maxU = Math.max(maxU, u);
    minV = Math.min(minV, v);
    maxV = Math.max(maxV, v);
  }
  return { minU, minV, maxU, maxV };
}

function projectTextureTriangle(
  triangle: TextureTriangle,
  tile: number,
  elev: number,
  origin: Vec3,
  xAxis: Vec3,
  yAxis: Vec3,
  shiftX: number,
  shiftY: number,
): TextureTrianglePlan | null {
  const pts = cssPoints(triangle.vertices, tile, elev);
  const points = pts.map((point): Vec2 => {
    const dx = point[0] - origin[0];
    const dy = point[1] - origin[1];
    const dz = point[2] - origin[2];
    return [
      dx * xAxis[0] + dy * xAxis[1] + dz * xAxis[2] + shiftX,
      dx * yAxis[0] + dy * yAxis[1] + dz * yAxis[2] + shiftY,
    ];
  });
  const uvAffine = computeUvAffine(points, triangle.uvs);
  const uvSampleRect = computeUvSampleRect(triangle.uvs);
  if (!uvAffine && !uvSampleRect) return null;
  return {
    screenPts: points.flatMap(([x, y]) => [x, y]),
    uvAffine,
    uvSampleRect,
  };
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
    const length = Math.hypot(dx, dy);
    if (length <= RECT_EPS) continue;
    expanded[i] += (dx / length) * amount;
    expanded[i + 1] += (dy / length) * amount;
  }
  return expanded;
}

function tracePolygonPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  points: number[],
): void {
  for (let i = 0; i < points.length; i += 2) {
    const px = x + points[i];
    const py = y + points[i + 1];
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
}

function computeTextureAtlasPlan(
  polygon: Polygon,
  index: number,
  options: RenderTextureAtlasOptions,
  projectiveQuadGuards: ProjectiveQuadGuardSettings,
  basisHint?: BasisHint,
): TextureAtlasPlan | null {
  const { vertices, texture, uvs } = polygon;
  if (!vertices || vertices.length < 3) return null;

  const tile = options.tileSize ?? DEFAULT_TILE;
  const elev = options.layerElevation ?? tile;
  const pts = cssPoints(vertices, tile, elev);
  const p0 = pts[0];
  const p1 = pts[1];

  const e1: Vec3 = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]];
  const l01 = Math.hypot(e1[0], e1[1], e1[2]);
  if (l01 === 0) return null;

  const normal = computeSurfaceNormal(pts);
  if (!normal) return null;

  const firstEdgeBasis = chooseLocalBasis(pts, p0, normal, { optimize: false });
  const basis = texture
    ? firstEdgeBasis
    : firstEdgeBasis && isFullRectBasis(firstEdgeBasis)
      ? firstEdgeBasis
      : chooseLocalBasis(pts, p0, normal, {
          optimize: true,
          fixedXAxis: basisHint?.xAxis,
          boundsOrigin: basisHint?.boundsOrigin,
          snapBounds: Boolean(basisHint),
          seamEdges: basisHint?.seamEdges,
        });
  if (!basis) return null;
  const { xAxis, yAxis, local2D } = basis;
  const textureEdgeRepairEdges = texture && basisHint?.textureEdgeRepairEdges?.size
    ? basisHint.textureEdgeRepairEdges
    : null;
  const textureEdgeRepair = Boolean(texture && textureEdgeRepairEdges);
  const shiftX = basis.shiftX;
  const shiftY = basis.shiftY;
  const canvasW = basis.canvasW;
  const canvasH = basis.canvasH;

  const screenPts: number[] = [];
  for (const [x, y] of local2D) screenPts.push(x + shiftX, y + shiftY);

  const tx = p0[0] - shiftX * xAxis[0] - shiftY * yAxis[0];
  const ty = p0[1] - shiftX * xAxis[1] - shiftY * yAxis[1];
  const tz = p0[2] - shiftX * xAxis[2] - shiftY * yAxis[2];
  const matrix = formatMatrix3dValues([
    xAxis[0], xAxis[1], xAxis[2], 0,
    yAxis[0], yAxis[1], yAxis[2], 0,
    normal[0], normal[1], normal[2], 0,
    tx, ty, tz, 1,
  ]);
  const canonicalMatrix = formatMatrix3dValues([
    xAxis[0] * canvasW, xAxis[1] * canvasW, xAxis[2] * canvasW, 0,
    yAxis[0] * canvasH, yAxis[1] * canvasH, yAxis[2] * canvasH, 0,
    normal[0], normal[1], normal[2], 0,
    tx, ty, tz, 1,
  ]);
  const atlasMatrix = formatMatrix3dValues([
    xAxis[0] * canvasW / ATLAS_CANONICAL_SIZE_EXPLICIT,
    xAxis[1] * canvasW / ATLAS_CANONICAL_SIZE_EXPLICIT,
    xAxis[2] * canvasW / ATLAS_CANONICAL_SIZE_EXPLICIT,
    0,
    yAxis[0] * canvasH / ATLAS_CANONICAL_SIZE_EXPLICIT,
    yAxis[1] * canvasH / ATLAS_CANONICAL_SIZE_EXPLICIT,
    yAxis[2] * canvasH / ATLAS_CANONICAL_SIZE_EXPLICIT,
    0,
    normal[0], normal[1], normal[2], 0,
    tx, ty, tz, 1,
  ]);
  const projectiveMatrix = !texture && vertices.length === 4
    ? computeProjectiveQuadMatrix(
        screenPts,
        xAxis,
        yAxis,
        normal,
        tx,
        ty,
        tz,
        projectiveQuadGuards,
      )
    : null;

  const directionalCfg = options.directionalLight;
  const ambientCfg = options.ambientLight;
  const lightDir = directionalCfg?.direction ?? DEFAULT_LIGHT_DIR;
  const lightColor = directionalCfg?.color ?? DEFAULT_LIGHT_COLOR;
  const lightIntensity = Math.max(0, directionalCfg?.intensity ?? DEFAULT_LIGHT_INTENSITY);
  const ambientColor = ambientCfg?.color ?? DEFAULT_AMBIENT_COLOR;
  const ambientIntensity = Math.max(0, ambientCfg?.intensity ?? DEFAULT_AMBIENT_INTENSITY);
  const lLen = Math.hypot(lightDir[0], lightDir[1], lightDir[2]) || 1;
  const lx = lightDir[0] / lLen, ly = lightDir[1] / lLen, lz = lightDir[2] / lLen;
  // Decoupled: directional and ambient sum independently. No (1 - ambient)
  // budget — matches three.js's lighting model.
  const directScale = lightIntensity * Math.max(0, normal[0] * lx + normal[1] * ly + normal[2] * lz);
  const textureTint = textureTintFactors(directScale, lightColor, ambientColor, ambientIntensity);
  const shadedColor = shadePolygon(polygon.color ?? "#cccccc", directScale, lightColor, ambientColor, ambientIntensity);

  let uvAffine: UvAffine | null = null;
  let uvSampleRect: UvSampleRect | null = null;
  if (texture && uvs && uvs.length >= 3 && uvs.length === vertices.length) {
    uvSampleRect = computeUvSampleRect(uvs);
    uvAffine = computeUvAffine(
      local2D.map(([x, y]) => [x + shiftX, y + shiftY]),
      uvs,
    );
  }
  const textureTriangles = texture && polygon.textureTriangles?.length
    ? polygon.textureTriangles
        .map((triangle) =>
          projectTextureTriangle(triangle, tile, elev, p0, xAxis, yAxis, shiftX, shiftY)
        )
        .filter((triangle): triangle is TextureTrianglePlan => !!triangle)
    : null;

  return {
    index,
    polygon,
    texture,
    tileSize: tile,
    layerElevation: elev,
    matrix,
    canonicalMatrix,
    atlasMatrix,
    projectiveMatrix,
    canvasW,
    canvasH,
    screenPts,
    uvAffine,
    uvSampleRect,
    textureTriangles,
    textureEdgeRepairEdges,
    textureEdgeRepair,
    normal,
    textureTint,
    shadedColor,
  };
}

function computeSolidTriangleColorPlanFromNormal(
  polygon: Polygon,
  index: number,
  nx: number,
  ny: number,
  nz: number,
  options: RenderTextureAtlasOptions,
  includeColor: boolean,
  colorOverride?: string,
): SolidTriangleColorPlan {
  const internalOptions = options as InternalRenderTextureAtlasOptions;
  let bakedColorValue = "";
  let bakedRgb: RGB | undefined;
  let bakedAlpha: number | undefined;
  let dynamicVars = "";
  if (includeColor) {
    const baseColor = colorOverride ?? polygon.color ?? "#cccccc";
    const directionalCfg = options.directionalLight;
    const ambientCfg = options.ambientLight;
    const lightDir = directionalCfg?.direction ?? DEFAULT_LIGHT_DIR;
    const lightColor = directionalCfg?.color ?? DEFAULT_LIGHT_COLOR;
    const lightIntensity = Math.max(0, directionalCfg?.intensity ?? DEFAULT_LIGHT_INTENSITY);
    const ambientColor = ambientCfg?.color ?? DEFAULT_AMBIENT_COLOR;
    const ambientIntensity = Math.max(0, ambientCfg?.intensity ?? DEFAULT_AMBIENT_INTENSITY);
    const lLen = Math.hypot(lightDir[0], lightDir[1], lightDir[2]) || 1;
    const lx = lightDir[0] / lLen, ly = lightDir[1] / lLen, lz = lightDir[2] / lLen;
    const directScale = lightIntensity * Math.max(0, nx * lx + ny * ly + nz * lz);
    const shadedColorRaw = shadePolygon(baseColor, directScale, lightColor, ambientColor, ambientIntensity);
    const textureLighting = options.textureLighting ?? "baked";
    const shadedColor = textureLighting === "baked" && internalOptions.stableTriangleColorSteps
      ? quantizeCssColor(shadedColorRaw, internalOptions.stableTriangleColorSteps)
      : shadedColorRaw;
    const base = parseHex(baseColor);
    const useDefaultPaint = shadedColor === options.solidPaintDefaults?.paintColor;
    const useDefaultDynamicColor =
      textureLighting === "dynamic" && rgbKey(base) === options.solidPaintDefaults?.dynamicColorKey;
    bakedColorValue = textureLighting === "dynamic" || useDefaultPaint
      ? ""
      : shadedColor;
    bakedRgb = bakedColorValue ? parseHex(bakedColorValue) : undefined;
    bakedAlpha = bakedColorValue ? parseAlpha(bakedColorValue) : undefined;
    dynamicVars = textureLighting === "dynamic"
      ? `--pnx:${nx.toFixed(4)};--pny:${ny.toFixed(4)};--pnz:${nz.toFixed(4)};` +
        (useDefaultDynamicColor
          ? ""
          : `--psr:${(base.r / 255).toFixed(4)};--psg:${(base.g / 255).toFixed(4)};--psb:${(base.b / 255).toFixed(4)};`)
      : "";
  }
  return {
    index,
    polygon,
    colorComputed: includeColor,
    bakedColor: bakedColorValue || undefined,
    bakedRgb,
    bakedAlpha,
    dynamicVars,
  };
}

function computeSolidTriangleColorPlan(
  polygon: Polygon,
  index: number,
  options: RenderTextureAtlasOptions,
): SolidTriangleColorPlan | null {
  if (polygon.texture || polygon.vertices.length !== 3) return null;
  const tile = options.tileSize ?? DEFAULT_TILE;
  const elev = options.layerElevation ?? tile;
  const v0 = polygon.vertices[0];
  const v1 = polygon.vertices[1];
  const v2 = polygon.vertices[2];
  const p0: Vec3 = [v0[1] * tile, v0[0] * tile, v0[2] * elev];
  const p1: Vec3 = [v1[1] * tile, v1[0] * tile, v1[2] * elev];
  const p2: Vec3 = [v2[1] * tile, v2[0] * tile, v2[2] * elev];
  const e10x = p1[0] - p0[0];
  const e10y = p1[1] - p0[1];
  const e10z = p1[2] - p0[2];
  const e20x = p2[0] - p0[0];
  const e20y = p2[1] - p0[1];
  const e20z = p2[2] - p0[2];
  let nx = -(e10y * e20z - e10z * e20y);
  let ny = -(e10z * e20x - e10x * e20z);
  let nz = -(e10x * e20y - e10y * e20x);
  const nLen = Math.sqrt(nx * nx + ny * ny + nz * nz);
  if (nLen <= BASIS_EPS) return null;
  nx /= nLen;
  ny /= nLen;
  nz /= nLen;
  return computeSolidTriangleColorPlanFromNormal(polygon, index, nx, ny, nz, options, true);
}

function computeSolidTrianglePlan(
  polygon: Polygon,
  index: number,
  options: RenderTextureAtlasOptions,
  computeOptions: SolidTriangleComputeOptions = {},
): SolidTrianglePlan | null {
  if (polygon.texture || polygon.vertices.length !== 3) return null;

  const tile = options.tileSize ?? DEFAULT_TILE;
  const elev = options.layerElevation ?? tile;
  const v0 = polygon.vertices[0];
  const v1 = polygon.vertices[1];
  const v2 = polygon.vertices[2];
  const p0x = v0[1] * tile;
  const p0y = v0[0] * tile;
  const p0z = v0[2] * elev;
  const p1x = v1[1] * tile;
  const p1y = v1[0] * tile;
  const p1z = v1[2] * elev;
  const p2x = v2[1] * tile;
  const p2y = v2[0] * tile;
  const p2z = v2[2] * elev;
  return computeSolidTrianglePlanFromCssPoints(
    polygon,
    index,
    options,
    computeOptions,
    p0x,
    p0y,
    p0z,
    p1x,
    p1y,
    p1z,
    p2x,
    p2y,
    p2z,
  );
}

function computeSolidTrianglePlanFromCssPoints(
  polygon: Polygon,
  index: number,
  options: RenderTextureAtlasOptions,
  computeOptions: SolidTriangleComputeOptions,
  p0x: number,
  p0y: number,
  p0z: number,
  p1x: number,
  p1y: number,
  p1z: number,
  p2x: number,
  p2y: number,
  p2z: number,
): SolidTrianglePlan | null {
  const internalOptions = options as InternalRenderTextureAtlasOptions;
  const e10x = p1x - p0x;
  const e10y = p1y - p0y;
  const e10z = p1z - p0z;
  const e20x = p2x - p0x;
  const e20y = p2y - p0y;
  const e20z = p2z - p0z;
  let nx = -(e10y * e20z - e10z * e20y);
  let ny = -(e10z * e20x - e10x * e20z);
  let nz = -(e10x * e20y - e10y * e20x);
  const nLen = Math.sqrt(nx * nx + ny * ny + nz * nz);
  if (nLen <= BASIS_EPS) return null;
  nx /= nLen;
  ny /= nLen;
  nz /= nLen;

  let basisHint = computeOptions.basis;
  let a = basisHint?.a ?? 0;
  let b = basisHint?.b ?? 1;
  let c = basisHint?.c ?? 2;
  if (
    a < 0 || a > 2 ||
    b < 0 || b > 2 ||
    c < 0 || c > 2 ||
    a === b || a === c || b === c
  ) {
    basisHint = undefined;
    a = 0;
    b = 1;
    c = 2;
  } else if (
    !(
      (a === 0 && b === 1 && c === 2) ||
      (a === 1 && b === 2 && c === 0) ||
      (a === 2 && b === 0 && c === 1)
    )
  ) {
    basisHint = undefined;
    a = 0;
    b = 1;
    c = 2;
  }
  const retryWithoutBasis = (): SolidTrianglePlan | null =>
    basisHint
      ? computeSolidTrianglePlanFromCssPoints(
          polygon,
          index,
          options,
          {
            ...computeOptions,
            basis: undefined,
          },
          p0x,
          p0y,
          p0z,
          p1x,
          p1y,
          p1z,
          p2x,
          p2y,
          p2z,
        )
      : null;

  if (!basisHint) {
    const len01Sq = e10x * e10x + e10y * e10y + e10z * e10z;
    const e21x = p2x - p1x;
    const e21y = p2y - p1y;
    const e21z = p2z - p1z;
    const e02x = p0x - p2x;
    const e02y = p0y - p2y;
    const e02z = p0z - p2z;
    const len12Sq = e21x * e21x + e21y * e21y + e21z * e21z;
    const len20Sq = e02x * e02x + e02y * e02y + e02z * e02z;
    let baseLengthSq = len01Sq;
    if (len12Sq > baseLengthSq) {
      a = 1;
      b = 2;
      c = 0;
      baseLengthSq = len12Sq;
    }
    if (len20Sq > baseLengthSq) {
      a = 2;
      b = 0;
      c = 1;
    }
  }

  let avx: number;
  let avy: number;
  let avz: number;
  let bvx: number;
  let bvy: number;
  let bvz: number;
  const cvx = c === 0 ? p0x : c === 1 ? p1x : p2x;
  const cvy = c === 0 ? p0y : c === 1 ? p1y : p2y;
  const cvz = c === 0 ? p0z : c === 1 ? p1z : p2z;
  if (a === 0) {
    avx = p0x; avy = p0y; avz = p0z;
  } else if (a === 1) {
    avx = p1x; avy = p1y; avz = p1z;
  } else {
    avx = p2x; avy = p2y; avz = p2z;
  }
  if (b === 0) {
    bvx = p0x; bvy = p0y; bvz = p0z;
  } else if (b === 1) {
    bvx = p1x; bvy = p1y; bvz = p1z;
  } else {
    bvx = p2x; bvy = p2y; bvz = p2z;
  }

  let baseDx = bvx - avx;
  let baseDy = bvy - avy;
  let baseDz = bvz - avz;
  let baseLength = Math.sqrt(baseDx * baseDx + baseDy * baseDy + baseDz * baseDz);
  if (baseLength <= BASIS_EPS) return retryWithoutBasis();

  let x0 = baseDx / baseLength;
  let x1 = baseDy / baseLength;
  let x2 = baseDz / baseLength;
  let apexX = (cvx - avx) * x0 + (cvy - avy) * x1 + (cvz - avz) * x2;
  let y0 = ny * x2 - nz * x1;
  let y1 = nz * x0 - nx * x2;
  let y2 = nx * x1 - ny * x0;
  let height = nLen / baseLength;
  if (height <= BASIS_EPS) return retryWithoutBasis();

  const left = Math.max(0, Math.min(baseLength, apexX));
  const right = Math.max(0, baseLength - left);
  const expanded = offsetStableTrianglePoints(left, right, height, SOLID_TRIANGLE_BLEED);
  const apex2x = expanded[0];
  const apex2y = expanded[1];
  const baseLeft2x = expanded[2];
  const baseLeft2y = expanded[3];
  const baseRight2x = expanded[4];
  const baseRight2y = expanded[5];
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
  const includeColor = computeOptions.includeColor ?? true;
  let colorComputed = false;
  let bakedColorValue: string | undefined;
  let bakedRgb: RGB | undefined;
  let bakedAlpha: number | undefined;
  let dynamicVars = "";
  if (includeColor) {
    const colorPlan = computeSolidTriangleColorPlanFromNormal(
      polygon,
      index,
      nx,
      ny,
      nz,
      options,
      true,
      computeOptions.color,
    );
    colorComputed = colorPlan.colorComputed;
    bakedColorValue = colorPlan.bakedColor;
    bakedRgb = colorPlan.bakedRgb;
    bakedAlpha = colorPlan.bakedAlpha;
    dynamicVars = colorPlan.dynamicVars ?? "";
  }
  const bakedColor = bakedColorValue ? `color:${bakedColorValue};` : "";
  const invCanonicalSize = 1 / SOLID_TRIANGLE_CANONICAL_SIZE;
  const baseWidthPx = leftPx + rightPx;
  const xScale = baseWidthPx * invCanonicalSize;
  const yXScale = (rightPx - leftPx) * 0.5 * invCanonicalSize;
  const yYScale = heightPx * invCanonicalSize;
  const txXOffset = apex2x - left - baseWidthPx * 0.5;
  const txYOffset = apex2y;
  const xCol0 = x0 * xScale;
  const xCol1 = x1 * xScale;
  const xCol2 = x2 * xScale;
  const yCol0 = x0 * yXScale + y0 * yYScale;
  const yCol1 = x1 * yXScale + y1 * yYScale;
  const yCol2 = x2 * yXScale + y2 * yYScale;
  const txCol0 = cvx + x0 * txXOffset + y0 * txYOffset;
  const txCol1 = cvy + x1 * txXOffset + y1 * txYOffset;
  const txCol2 = cvz + x2 * txXOffset + y2 * txYOffset;
  const matrixDecimals = computeOptions.matrixDecimals ?? stableTriangleMatrixDecimals(internalOptions);
  const transformText = formatAffineMatrix3dTransformScalars(
    xCol0, xCol1, xCol2,
    yCol0, yCol1, yCol2,
    nx, ny, nz,
    txCol0, txCol1, txCol2,
    matrixDecimals,
  );
  const textureLighting = options.textureLighting ?? "baked";
  const optimizeStyleText =
    internalOptions.optimizeStableTriangleStyle === true &&
    textureLighting === "baked";
  const styleText = optimizeStyleText
    ? ""
    : `transform:${transformText};` + bakedColor + dynamicVars;

  const basis = basisHint && basisHint.a === a && basisHint.b === b && basisHint.c === c
    ? basisHint
    : { a, b, c };
  return {
    index,
    polygon,
    styleText,
    transformText,
    basis,
    colorComputed,
    bakedColor: bakedColorValue,
    bakedRgb,
    bakedAlpha,
    dynamicVars,
  };
}

function packTextureAtlasPlans(
  plans: Array<TextureAtlasPlan | null>,
  atlasScale = 1,
): PackedAtlas {
  const entries: Array<PackedTextureAtlasEntry | null> = Array(plans.length).fill(null);
  const pages: PackingPage[] = [];
  const padding = atlasPadding(atlasScale);
  const sortedPlans = plans
    .filter((plan): plan is TextureAtlasPlan => !!plan)
    .sort((a, b) =>
      b.canvasH - a.canvasH ||
      b.canvasW - a.canvasW ||
      a.index - b.index
    );

  const createPage = (): PackingPage => ({
    width: padding,
    height: padding,
    entries: [],
    shelves: [],
  });

  const placeOnPage = (
    page: PackingPage,
    plan: TextureAtlasPlan,
    pageIndex: number,
  ): PackedTextureAtlasEntry | null => {
    if (page.sealed) return null;
    for (const shelf of page.shelves) {
      if (
        plan.canvasH <= shelf.height &&
        shelf.x + plan.canvasW + padding <= ATLAS_MAX_SIZE
      ) {
        const entry = { ...plan, pageIndex, x: shelf.x, y: shelf.y };
        shelf.x += plan.canvasW + padding * 2;
        page.entries.push(entry);
        page.width = Math.max(page.width, entry.x + plan.canvasW + padding);
        return entry;
      }
    }

    const shelfY = page.shelves.length === 0 ? padding : page.height + padding;
    if (shelfY + plan.canvasH + padding > ATLAS_MAX_SIZE) return null;

    const entry = { ...plan, pageIndex, x: padding, y: shelfY };
    page.shelves.push({
      x: padding + plan.canvasW + padding * 2,
      y: shelfY,
      height: plan.canvasH,
    });
    page.entries.push(entry);
    page.width = Math.max(page.width, entry.x + plan.canvasW + padding);
    page.height = Math.max(page.height, shelfY + plan.canvasH + padding);
    return entry;
  };

  for (const plan of sortedPlans) {
    const tooLarge =
      plan.canvasW + padding * 2 > ATLAS_MAX_SIZE ||
      plan.canvasH + padding * 2 > ATLAS_MAX_SIZE;

    if (tooLarge) {
      const pageIndex = pages.length;
      const entry = { ...plan, pageIndex, x: padding, y: padding };
      entries[plan.index] = entry;
      pages.push({
        width: plan.canvasW + padding * 2,
        height: plan.canvasH + padding * 2,
        entries: [entry],
        shelves: [],
        sealed: true,
      });
      continue;
    }

    let placed: PackedTextureAtlasEntry | null = null;
    for (let pageIndex = 0; pageIndex < pages.length; pageIndex++) {
      placed = placeOnPage(pages[pageIndex], plan, pageIndex);
      if (placed) break;
    }
    if (!placed) {
      const page = createPage();
      const pageIndex = pages.length;
      pages.push(page);
      placed = placeOnPage(page, plan, pageIndex);
    }
    if (placed) entries[plan.index] = placed;
  }

  return {
    entries,
    pages: pages.map(({ width, height, entries }) => ({ width, height, entries })),
  };
}

function paintSolidAtlasEntry(
  ctx: CanvasRenderingContext2D,
  entry: PackedTextureAtlasEntry,
  textureLighting: PolyTextureLightingMode,
  atlasScale: number,
): void {
  setCssTransform(ctx, atlasScale);
  ctx.beginPath();
  tracePolygonPath(ctx, entry.x, entry.y, entry.screenPts);
  ctx.clip();
  setCssTransform(ctx, atlasScale);
  // Dynamic mode multiplies the tint at render time via background-blend-mode,
  // so the atlas keeps the polygon's unshaded base color.
  ctx.fillStyle = textureLighting === "dynamic"
    ? (entry.polygon.color ?? "#cccccc")
    : entry.shadedColor;
  ctx.fillRect(entry.x, entry.y, entry.canvasW, entry.canvasH);
}

function clampSourceCoord(value: number, max: number): number {
  return Math.max(0, Math.min(max, value));
}

function drawImageUvSample(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  rect: UvSampleRect,
  x: number,
  y: number,
  width: number,
  height: number,
  atlasScale: number,
): void {
  const imgW = img.naturalWidth || img.width || 1;
  const imgH = img.naturalHeight || img.height || 1;
  const rawX0 = clampSourceCoord(Math.min(rect.minU, rect.maxU) * imgW, imgW);
  const rawX1 = clampSourceCoord(Math.max(rect.minU, rect.maxU) * imgW, imgW);
  const rawY0 = clampSourceCoord(Math.min(rect.minV, rect.maxV) * imgH, imgH);
  const rawY1 = clampSourceCoord(Math.max(rect.minV, rect.maxV) * imgH, imgH);

  let sx = Math.floor(rawX0);
  let sy = Math.floor(rawY0);
  let sw = Math.ceil(rawX1) - sx;
  let sh = Math.ceil(rawY1) - sy;

  if (sw < 1) {
    sx = Math.floor(clampSourceCoord(((rect.minU + rect.maxU) / 2) * imgW, imgW - 1));
    sw = 1;
  }
  if (sh < 1) {
    sy = Math.floor(clampSourceCoord(((rect.minV + rect.maxV) / 2) * imgH, imgH - 1));
    sh = 1;
  }
  sx = Math.max(0, Math.min(imgW - 1, sx));
  sy = Math.max(0, Math.min(imgH - 1, sy));
  sw = Math.max(1, Math.min(imgW - sx, sw));
  sh = Math.max(1, Math.min(imgH - sy, sh));

  setCssTransform(ctx, atlasScale);
  ctx.drawImage(img, sx, sy, sw, sh, x, y, width, height);
}

function traceOffsetPolygonPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  points: number[],
  offsetX: number,
  offsetY: number,
): void {
  for (let i = 0; i < points.length; i += 2) {
    const px = x + points[i] + offsetX;
    const py = y + points[i + 1] + offsetY;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
}

function drawTexturedAtlasEntry(
  ctx: CanvasRenderingContext2D,
  entry: PackedTextureAtlasEntry,
  srcImg: HTMLImageElement,
  atlasScale: number,
  offsetX = 0,
  offsetY = 0,
): void {
  if (entry.textureTriangles?.length) {
    const imgW = srcImg.naturalWidth || srcImg.width || 1;
    const imgH = srcImg.naturalHeight || srcImg.height || 1;
    for (const triangle of entry.textureTriangles) {
      const clipPts = expandClipPoints(triangle.screenPts, TEXTURE_TRIANGLE_BLEED);
      ctx.save();
      setCssTransform(ctx, atlasScale);
      ctx.beginPath();
      traceOffsetPolygonPath(ctx, entry.x, entry.y, clipPts, offsetX, offsetY);
      ctx.clip();
      if (triangle.uvAffine) {
        setCssTransform(
          ctx,
          atlasScale,
          triangle.uvAffine.a / imgW, triangle.uvAffine.c / imgW,
          triangle.uvAffine.b / imgH, triangle.uvAffine.d / imgH,
          entry.x + triangle.uvAffine.e + offsetX,
          entry.y + triangle.uvAffine.f + offsetY,
        );
        ctx.drawImage(srcImg, 0, 0);
      } else if (triangle.uvSampleRect) {
        drawImageUvSample(
          ctx,
          srcImg,
          triangle.uvSampleRect,
          entry.x + offsetX,
          entry.y + offsetY,
          entry.canvasW,
          entry.canvasH,
          atlasScale,
        );
      }
      ctx.restore();
    }
  } else if (entry.uvAffine) {
    const imgW = srcImg.naturalWidth || srcImg.width || 1;
    const imgH = srcImg.naturalHeight || srcImg.height || 1;
    setCssTransform(
      ctx,
      atlasScale,
      entry.uvAffine.a / imgW, entry.uvAffine.c / imgW,
      entry.uvAffine.b / imgH, entry.uvAffine.d / imgH,
      entry.x + entry.uvAffine.e + offsetX,
      entry.y + entry.uvAffine.f + offsetY,
    );
    ctx.drawImage(srcImg, 0, 0);
  } else if (entry.uvSampleRect) {
    drawImageUvSample(
      ctx,
      srcImg,
      entry.uvSampleRect,
      entry.x + offsetX,
      entry.y + offsetY,
      entry.canvasW,
      entry.canvasH,
      atlasScale,
    );
  } else {
    drawImageCover(
      ctx,
      srcImg,
      entry.x + offsetX,
      entry.y + offsetY,
      entry.canvasW,
      entry.canvasH,
      atlasScale,
    );
  }
}

function distanceToSegment(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  if (lenSq <= BASIS_EPS) return Math.hypot(px - ax, py - ay);
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq));
  return Math.hypot(px - (ax + dx * t), py - (ay + dy * t));
}

function distanceToPolygonEdges(
  px: number,
  py: number,
  points: number[],
  edgeIndices: Set<number>,
): number {
  let best = Infinity;
  const count = points.length / 2;
  for (const edgeIndex of edgeIndices) {
    if (edgeIndex < 0 || edgeIndex >= count) continue;
    const i = edgeIndex * 2;
    const next = ((edgeIndex + 1) % count) * 2;
    best = Math.min(
      best,
      distanceToSegment(px, py, points[i], points[i + 1], points[next], points[next + 1]),
    );
  }
  return best;
}

function nearestOpaquePixelOffset(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  x: number,
  y: number,
  radius: number,
): number | null {
  const minX = Math.max(0, x - radius);
  const maxX = Math.min(width - 1, x + radius);
  const minY = Math.max(0, y - radius);
  const maxY = Math.min(height - 1, y + radius);
  let bestOffset: number | null = null;
  let bestDistanceSq = Infinity;
  for (let yy = minY; yy <= maxY; yy++) {
    for (let xx = minX; xx <= maxX; xx++) {
      if (xx === x && yy === y) continue;
      const dx = xx - x;
      const dy = yy - y;
      const distanceSq = dx * dx + dy * dy;
      if (distanceSq > radius * radius || distanceSq >= bestDistanceSq) continue;
      const offset = (yy * width + xx) * 4;
      if (data[offset + 3] < TEXTURE_EDGE_REPAIR_SOURCE_ALPHA_MIN) continue;
      bestOffset = offset;
      bestDistanceSq = distanceSq;
    }
  }
  return bestOffset;
}

function repairTextureEdgeAlpha(
  ctx: CanvasRenderingContext2D,
  entry: PackedTextureAtlasEntry,
  atlasScale: number,
): void {
  if (!entry.textureEdgeRepair || !entry.texture) return;
  if (!entry.textureEdgeRepairEdges || entry.textureEdgeRepairEdges.size === 0) return;
  const canvas = (ctx as CanvasRenderingContext2D & { canvas?: HTMLCanvasElement }).canvas;
  if (!canvas) return;
  const pixelX = Math.max(0, Math.floor(entry.x * atlasScale));
  const pixelY = Math.max(0, Math.floor(entry.y * atlasScale));
  const pixelW = Math.max(1, Math.min(canvas.width - pixelX, Math.ceil(entry.canvasW * atlasScale)));
  const pixelH = Math.max(1, Math.min(canvas.height - pixelY, Math.ceil(entry.canvasH * atlasScale)));
  if (pixelW <= 0 || pixelH <= 0) return;

  let imageData: ImageData;
  try {
    imageData = ctx.getImageData(pixelX, pixelY, pixelW, pixelH);
  } catch {
    return;
  }

  const data = imageData.data;
  const source = new Uint8ClampedArray(data);
  const radius = Math.max(TEXTURE_EDGE_REPAIR_RADIUS, TEXTURE_EDGE_REPAIR_RADIUS / atlasScale);
  const sourceRadius = Math.max(2, Math.ceil(radius * atlasScale) + 1);
  let changed = false;
  for (let y = 0; y < pixelH; y++) {
    for (let x = 0; x < pixelW; x++) {
      const offset = (y * pixelW + x) * 4;
      const alpha = data[offset + 3];
      if (alpha < TEXTURE_EDGE_REPAIR_ALPHA_MIN || alpha === 255) continue;
      const localX = (pixelX + x + 0.5) / atlasScale - entry.x;
      const localY = (pixelY + y + 0.5) / atlasScale - entry.y;
      if (distanceToPolygonEdges(localX, localY, entry.screenPts, entry.textureEdgeRepairEdges) > radius) {
        continue;
      }
      const sourceOffset = nearestOpaquePixelOffset(source, pixelW, pixelH, x, y, sourceRadius);
      if (sourceOffset === null) continue;
      data[offset] = source[sourceOffset];
      data[offset + 1] = source[sourceOffset + 1];
      data[offset + 2] = source[sourceOffset + 2];
      data[offset + 3] = 255;
      changed = true;
    }
  }
  if (!changed) return;
  ctx.putImageData(imageData, pixelX, pixelY);
}

async function buildAtlasPage(
  page: PackedPage,
  textureLighting: PolyTextureLightingMode,
  doc: Document,
  atlasScale: number,
): Promise<TextureAtlasPage> {
  const canvas = doc.createElement("canvas");
  canvas.width = Math.max(1, Math.ceil(page.width * atlasScale));
  canvas.height = Math.max(1, Math.ceil(page.height * atlasScale));
  const needsReadback = page.entries.some((entry) =>
    entry.textureEdgeRepair &&
    entry.texture &&
    entry.textureEdgeRepairEdges &&
    entry.textureEdgeRepairEdges.size > 0
  );
  const ctx = canvas.getContext("2d", needsReadback ? { willReadFrequently: true } : undefined);
  if (!ctx) return { width: page.width, height: page.height, url: null };

  const uniqueTextures = Array.from(new Set(
    page.entries.flatMap((entry) => entry.texture ? [entry.texture] : []),
  ));
  const loaded = new Map<string, HTMLImageElement>();
  await Promise.all(uniqueTextures.map(async (url) => {
    loaded.set(url, await loadTextureImage(url));
  }));

  for (const entry of page.entries) {
    const srcImg = entry.texture ? loaded.get(entry.texture) : null;
    if (!entry.texture) {
      ctx.save();
      paintSolidAtlasEntry(ctx, entry, textureLighting, atlasScale);
      ctx.restore();
      continue;
    }

    if (srcImg) {
      ctx.save();
      setCssTransform(
        ctx,
        atlasScale,
      );
      ctx.beginPath();
      tracePolygonPath(ctx, entry.x, entry.y, entry.screenPts);
      ctx.clip();
      drawTexturedAtlasEntry(ctx, entry, srcImg, atlasScale);
      ctx.restore();
    }
    if (entry.texture && textureLighting === "baked") {
      ctx.save();
      setCssTransform(ctx, atlasScale);
      ctx.beginPath();
      tracePolygonPath(ctx, entry.x, entry.y, entry.screenPts);
      ctx.clip();
      applyTextureTint(ctx, entry.x, entry.y, entry.canvasW, entry.canvasH, entry.textureTint, atlasScale);
      ctx.restore();
    }
    repairTextureEdgeAlpha(ctx, entry, atlasScale);
  }

  const url = await canvasToUrl(canvas);
  canvas.width = 1;
  canvas.height = 1;

  return {
    width: page.width,
    height: page.height,
    url,
  };
}

export async function buildAtlasPages(
  pages: PackedPage[],
  textureLighting: PolyTextureLightingMode,
  doc: Document,
  atlasScale: number,
  isCancelled: () => boolean,
): Promise<TextureAtlasPage[]> {
  const built: TextureAtlasPage[] = [];
  for (const page of pages) {
    if (isCancelled()) break;
    built.push(await buildAtlasPage(page, textureLighting, doc, atlasScale));
  }
  return built;
}

function applyAtlasBackground(
  el: HTMLElement,
  page: TextureAtlasPage,
  textureLighting: PolyTextureLightingMode,
  entry: PackedTextureAtlasEntry,
): void {
  if (!page.url) return;
  const url = `url(${page.url})`;
  const width = entry.canvasW || 1;
  const height = entry.canvasH || 1;
  const atlasCanonicalSize = atlasCanonicalSizeForEntry(entry);
  const pos = `${formatCssLength((-entry.x / width) * atlasCanonicalSize)} ${formatCssLength((-entry.y / height) * atlasCanonicalSize)}`;
  const size = `${formatCssLength((page.width / width) * atlasCanonicalSize)} ${formatCssLength((page.height / height) * atlasCanonicalSize)}`;
  if (textureLighting === "dynamic") {
    setInlineStyleProperty(el, "background-image", url);
    setInlineStyleProperty(el, "background-position", pos);
    setInlineStyleProperty(el, "background-size", size);
  } else {
    setInlineStyleProperty(el, "background", `${url} ${pos} / ${size} no-repeat`);
  }
  // Dynamic mode also masks the entire <i> by the atlas image so the
  // background-color tint only paints inside the polygon shape (W3C
  // multiply with transparent backdrop reduces to source).
  if (textureLighting === "dynamic") {
    setInlineStyleProperty(el, "mask-image", url);
    setInlineStyleProperty(el, "mask-mode", "alpha");
    setInlineStyleProperty(el, "mask-position", pos);
    setInlineStyleProperty(el, "mask-size", size);
    setInlineStyleProperty(el, "mask-repeat", "no-repeat");
    // Vendor-prefixed twins for older Safari. setProperty avoids the
    // deprecation warnings on the camelCase properties in lib.dom.
    setInlineStyleProperty(el, "-webkit-mask-image", url);
    setInlineStyleProperty(el, "-webkit-mask-position", pos);
    setInlineStyleProperty(el, "-webkit-mask-size", size);
    setInlineStyleProperty(el, "-webkit-mask-repeat", "no-repeat");
  } else {
    removeInlineStyleProperty(el, "mask-image");
    removeInlineStyleProperty(el, "mask-mode");
    removeInlineStyleProperty(el, "mask-position");
    removeInlineStyleProperty(el, "mask-size");
    removeInlineStyleProperty(el, "mask-repeat");
    removeInlineStyleProperty(el, "-webkit-mask-image");
    removeInlineStyleProperty(el, "-webkit-mask-position");
    removeInlineStyleProperty(el, "-webkit-mask-size");
    removeInlineStyleProperty(el, "-webkit-mask-repeat");
  }
}

function applyPolygonDataAttrs(el: HTMLElement, polygon: Polygon): void {
  const previousDataKeys = ELEMENT_DATA_KEYS.get(el);
  if (previousDataKeys) {
    for (const key of previousDataKeys) el.removeAttribute(`data-${key}`);
  }
  const nextDataKeys: string[] = [];
  if (polygon.data) {
    for (const [k, v] of Object.entries(polygon.data)) {
      el.setAttribute(`data-${k}`, String(v));
      nextDataKeys.push(k);
    }
  }
  ELEMENT_DATA_KEYS.set(el, nextDataKeys);
  (el as SolidTriangleElement).__polycssHasDataAttrs = nextDataKeys.length > 0;
}

function hasPolygonDataAttrs(el: HTMLElement): boolean {
  return (el as SolidTriangleElement).__polycssHasDataAttrs === true;
}

function formatScaledMatrixFromPlan(
  entry: TextureAtlasPlan,
  scaleX: number,
  scaleY: number,
  offsetX = 0,
  offsetY = 0,
): string {
  const values = entry.matrix.split(",").map((value) => Number(value));
  if (values.length !== 16 || values.some((value) => !Number.isFinite(value))) {
    return entry.matrix;
  }
  const x0 = values[0];
  const x1 = values[1];
  const x2 = values[2];
  const y0 = values[4];
  const y1 = values[5];
  const y2 = values[6];
  values[0] *= scaleX;
  values[1] *= scaleX;
  values[2] *= scaleX;
  values[4] *= scaleY;
  values[5] *= scaleY;
  values[6] *= scaleY;
  values[12] += offsetX * x0 + offsetY * y0;
  values[13] += offsetX * x1 + offsetY * y1;
  values[14] += offsetX * x2 + offsetY * y2;
  return formatMatrix3dValues(values);
}

function formatBorderShapeMatrix(
  entry: TextureAtlasPlan,
  bounds: BorderShapeBounds,
): string {
  return formatScaledMatrixFromPlan(
    entry,
    bounds.width / BORDER_SHAPE_CANONICAL_SIZE,
    bounds.height / BORDER_SHAPE_CANONICAL_SIZE,
    bounds.minX,
    bounds.minY,
  );
}

function formatSolidQuadMatrix(entry: TextureAtlasPlan): string {
  return formatScaledMatrixFromPlan(
    entry,
    (entry.canvasW || 1) / SOLID_QUAD_CANONICAL_SIZE,
    (entry.canvasH || 1) / SOLID_QUAD_CANONICAL_SIZE,
  );
}

function formatBorderShapeElementStyle(entry: TextureAtlasPlan): string {
  const geometry = borderShapeGeometryForPlan(entry);
  return [
    `transform:matrix3d(${formatBorderShapeMatrix(entry, geometry.bounds)})`,
    `border-shape:${cssBorderShapeForGeometry(geometry.points)}`,
  ].join(";");
}

interface StablePlanBasis {
  normal: Vec3;
  xAxis: Vec3;
  yAxis: Vec3;
  tx: number;
  ty: number;
  tz: number;
}

function stableBasisFromPlan(
  source: TextureAtlasPlan,
  polygon: Polygon,
): StablePlanBasis | null {
  if (source.screenPts.length < 6 || polygon.vertices.length < 3) return null;

  const tile = source.tileSize;
  const elev = source.layerElevation;
  const target = cssPoints(polygon.vertices, tile, elev);
  const normal = computeSurfaceNormal(target);
  if (!normal) return null;

  const sx0 = source.screenPts[0];
  const sy0 = source.screenPts[1];
  const sx1 = source.screenPts[2];
  const sy1 = source.screenPts[3];
  const sx2 = source.screenPts[4];
  const sy2 = source.screenPts[5];
  const dx1 = sx1 - sx0;
  const dy1 = sy1 - sy0;
  const dx2 = sx2 - sx0;
  const dy2 = sy2 - sy0;
  const det = dx1 * dy2 - dy1 * dx2;
  if (Math.abs(det) <= BASIS_EPS) return null;

  const p0 = target[0];
  const p1 = target[1];
  const p2 = target[2];
  const q1: Vec3 = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]];
  const q2: Vec3 = [p2[0] - p0[0], p2[1] - p0[1], p2[2] - p0[2]];

  const xAxis: Vec3 = [
    (q1[0] * dy2 - dy1 * q2[0]) / det,
    (q1[1] * dy2 - dy1 * q2[1]) / det,
    (q1[2] * dy2 - dy1 * q2[2]) / det,
  ];
  const yAxis: Vec3 = [
    (dx1 * q2[0] - q1[0] * dx2) / det,
    (dx1 * q2[1] - q1[1] * dx2) / det,
    (dx1 * q2[2] - q1[2] * dx2) / det,
  ];
  const tx = p0[0] - xAxis[0] * sx0 - yAxis[0] * sy0;
  const ty = p0[1] - xAxis[1] * sx0 - yAxis[1] * sy0;
  const tz = p0[2] - xAxis[2] * sx0 - yAxis[2] * sy0;

  return {
    normal,
    xAxis,
    yAxis,
    tx,
    ty,
    tz,
  };
}

// Stable topology can reuse the original atlas raster: keep the element's
// local 2D texture space fixed, and solve the new matrix from that space to
// the updated 3D triangle.
function stableMatrixFromPlan(
  source: TextureAtlasPlan,
  polygon: Polygon,
): { matrix: string; normal: Vec3 } | null {
  const basis = stableBasisFromPlan(source, polygon);
  if (!basis) return null;
  const { normal, xAxis, yAxis, tx, ty, tz } = basis;

  return {
    normal,
    matrix: formatMatrix3dValues([
      xAxis[0] * source.canvasW / atlasCanonicalSizeForEntry(source),
      xAxis[1] * source.canvasW / atlasCanonicalSizeForEntry(source),
      xAxis[2] * source.canvasW / atlasCanonicalSizeForEntry(source),
      0,
      yAxis[0] * source.canvasH / atlasCanonicalSizeForEntry(source),
      yAxis[1] * source.canvasH / atlasCanonicalSizeForEntry(source),
      yAxis[2] * source.canvasH / atlasCanonicalSizeForEntry(source),
      0,
      normal[0], normal[1], normal[2], 0,
      tx, ty, tz, 1,
    ]),
  };
}

function stableProjectiveMatrixFromPlan(
  source: TextureAtlasPlan,
  polygon: Polygon,
  guards: ProjectiveQuadGuardSettings,
): { matrix: string; normal: Vec3 } | null {
  if (source.screenPts.length !== 8 || polygon.vertices.length !== 4) return null;
  const basis = stableBasisFromPlan(source, polygon);
  if (!basis) return null;
  const matrix = computeProjectiveQuadMatrix(
    source.screenPts,
    basis.xAxis,
    basis.yAxis,
    basis.normal,
    basis.tx,
    basis.ty,
    basis.tz,
    guards,
  );
  return matrix ? { matrix, normal: basis.normal } : null;
}

function updateAtlasElementWithStablePlan(
  el: HTMLElement,
  source: TextureAtlasPlan,
  polygon: Polygon,
  textureLighting: PolyTextureLightingMode,
): boolean {
  if (!source.texture || !polygon.texture || source.texture !== polygon.texture) return false;
  const next = stableMatrixFromPlan(source, polygon);
  if (!next) return false;
  setInlineStyleProperty(el, "transform", `matrix3d(${next.matrix})`);
  if (textureLighting === "dynamic") {
    setInlineStyleProperty(el, "--pnx", next.normal[0].toFixed(4));
    setInlineStyleProperty(el, "--pny", next.normal[1].toFixed(4));
    setInlineStyleProperty(el, "--pnz", next.normal[2].toFixed(4));
  }
  applyPolygonDataAttrs(el, polygon);
  return true;
}

function applyDynamicNormalVars(el: HTMLElement, entry: TextureAtlasPlan): void {
  // Dynamic mode: emit ONLY the per-polygon normal vars inline. The
  // calc-driven background-color + background-blend-mode multiply live
  // in the global stylesheet's
  // `.polycss-scene[data-polycss-lighting="dynamic"] i { ... }` rule, so
  // the per-element style stays tiny (~50 chars instead of ~600).
  setInlineStyleProperty(el, "--pnx", entry.normal[0].toFixed(4));
  setInlineStyleProperty(el, "--pny", entry.normal[1].toFixed(4));
  setInlineStyleProperty(el, "--pnz", entry.normal[2].toFixed(4));
}

function fullRectBounds(entry: TextureAtlasPlan): RectBrush | null {
  if (entry.screenPts.length !== 8) return null;

  const xs: number[] = [];
  const ys: number[] = [];
  const addUnique = (list: number[], value: number): void => {
    for (const existing of list) {
      if (Math.abs(existing - value) <= RECT_EPS) return;
    }
    list.push(value);
  };

  for (let i = 0; i < entry.screenPts.length; i += 2) {
    addUnique(xs, entry.screenPts[i]);
    addUnique(ys, entry.screenPts[i + 1]);
  }
  if (xs.length !== 2 || ys.length !== 2) return null;

  xs.sort((a, b) => a - b);
  ys.sort((a, b) => a - b);
  if (
    Math.abs(xs[0]) > RECT_EPS ||
    Math.abs(ys[0]) > RECT_EPS ||
    xs[1] - xs[0] <= RECT_EPS ||
    ys[1] - ys[0] <= RECT_EPS
  ) {
    return null;
  }

  for (let i = 0; i < entry.screenPts.length; i += 2) {
    const x = entry.screenPts[i];
    const y = entry.screenPts[i + 1];
    const onX = Math.abs(x - xs[0]) <= RECT_EPS || Math.abs(x - xs[1]) <= RECT_EPS;
    const onY = Math.abs(y - ys[0]) <= RECT_EPS || Math.abs(y - ys[1]) <= RECT_EPS;
    if (!onX || !onY) return null;
  }

  return {
    left: xs[0],
    top: ys[0],
    width: xs[1] - xs[0],
    height: ys[1] - ys[0],
  };
}

export function isFullRectSolid(entry: TextureAtlasPlan): boolean {
  return !!fullRectBounds(entry);
}

export function isSolidTrianglePlan(entry: TextureAtlasPlan): boolean {
  return !entry.texture && entry.polygon.vertices.length === 3;
}

export function isProjectiveQuadPlan(entry: TextureAtlasPlan): entry is TextureAtlasPlan & { projectiveMatrix: string } {
  return !entry.texture && !!entry.projectiveMatrix && !isFullRectSolid(entry);
}

function borderShapeSupported(doc: Document): boolean {
  const css = doc.defaultView?.CSS ?? (typeof CSS !== "undefined" ? CSS : undefined);
  const supportsBorderShape = !!css?.supports?.(
    "border-shape",
    "polygon(0 0, 100% 0, 0 100%) circle(0)",
  );
  if (!supportsBorderShape) return false;

  const win = doc.defaultView ?? (typeof window !== "undefined" ? window : undefined);
  const media = win?.matchMedia;
  if (!media) return true;

  return media("(pointer: fine)").matches && media("(hover: hover)").matches;
}

function solidTriangleSupported(doc: Document): boolean {
  const win = doc.defaultView ?? (typeof window !== "undefined" ? window : undefined);
  const userAgent = win?.navigator?.userAgent ?? "";
  if (!userAgent) return true;

  const isChromiumFamily = /\b(?:Chrome|HeadlessChrome|Chromium|Edg|OPR)\//.test(userAgent);
  const isSafariFamily = /\bVersion\/[\d.]+.*\bSafari\//.test(userAgent);
  return !isSafariFamily || isChromiumFamily;
}

function incrementCount(map: Map<string, number>, key: string): void {
  map.set(key, (map.get(key) ?? 0) + 1);
}

function dominantCountKey(map: Map<string, number>): string | undefined {
  let bestKey: string | undefined;
  let bestCount = 1;
  for (const [key, count] of map) {
    if (count > bestCount) {
      bestKey = key;
      bestCount = count;
    }
  }
  return bestKey;
}

function getSolidPaintDefaultsForPlans(
  plans: Array<TextureAtlasPlan | null>,
  textureLighting: PolyTextureLightingMode,
  doc: Document,
  disabled: ReadonlySet<PolyRenderStrategy>,
): SolidPaintDefaults {
  const paintCounts = new Map<string, number>();
  const dynamicCounts = new Map<string, number>();
  const dynamicColors = new Map<string, RGB>();
  const useFullRectSolid = !disabled.has("b");
  const useProjectiveQuad = useFullRectSolid;
  const useStableTriangle = !disabled.has("u") && solidTriangleSupported(doc);
  const useBorderShape = !disabled.has("i") && borderShapeSupported(doc);

  for (const plan of plans) {
    if (!plan || plan.texture) continue;

    if (textureLighting === "dynamic") {
      if (
        !(useStableTriangle && isSolidTrianglePlan(plan)) &&
        !(useFullRectSolid && isFullRectSolid(plan)) &&
        !(useProjectiveQuad && isProjectiveQuadPlan(plan)) &&
        !useBorderShape
      ) continue;
      const color = parseHex(plan.polygon.color ?? "#cccccc");
      const key = rgbKey(color);
      incrementCount(dynamicCounts, key);
      if (!dynamicColors.has(key)) dynamicColors.set(key, color);
      continue;
    }

    if (
      !(useStableTriangle && isSolidTrianglePlan(plan)) &&
      !(useFullRectSolid && isFullRectSolid(plan)) &&
      !(useProjectiveQuad && isProjectiveQuadPlan(plan)) &&
      !useBorderShape
    ) continue;
    incrementCount(paintCounts, plan.shadedColor);
  }

  const paintColor = dominantCountKey(paintCounts);
  const dynamicColorKey = dominantCountKey(dynamicCounts);
  return {
    paintColor,
    dynamicColorKey,
    dynamicColor: dynamicColorKey ? dynamicColors.get(dynamicColorKey) : undefined,
  };
}

function yieldToMainThread(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

async function yieldIfOverBudget(started: number): Promise<number> {
  if (performance.now() - started < ASYNC_RENDER_BUDGET_MS) return started;
  await yieldToMainThread();
  return performance.now();
}

export function getSolidPaintDefaults(
  polygons: Polygon[],
  options: RenderTextureAtlasOptions = {},
): SolidPaintDefaults {
  const doc = options.doc ?? (typeof document !== "undefined" ? document : null);
  if (!doc) return {};
  const disabled = new Set(options.strategies?.disable ?? []);
  const basisHints = buildBasisHints(polygons, options);
  const projectiveQuadGuards = resolveProjectiveQuadGuards(doc);
  const plans = polygons.map((polygon, index) =>
    computeTextureAtlasPlan(polygon, index, options, projectiveQuadGuards, basisHints[index])
  );
  return getSolidPaintDefaultsForPlans(
    plans,
    options.textureLighting ?? "baked",
    doc,
    disabled,
  );
}

/** Options accepted by the public {@link computeTextureAtlasPlanPublic} wrapper. */
export interface ComputeTextureAtlasPlanOptions {
  tileSize?: number;
  layerElevation?: number;
  directionalLight?: PolyDirectionalLight;
  ambientLight?: PolyAmbientLight;
  /** Shared-edge set returned by {@link buildTextureEdgeRepairSets}. */
  textureEdgeRepairEdges?: Set<number>;
}

/**
 * Compute the per-polygon layout plan for one polygon in isolation.
 *
 * This is the public single-polygon variant used by React and Vue components.
 * It does not run the cross-polygon basis-optimisation or seam-detection that
 * the full `renderPolygonsWithTextureAtlas` pipeline performs, but the
 * strategy selection (projective-quad, rect, etc.) is identical to the
 * canonical renderer.
 */
export function computeTextureAtlasPlanPublic(
  polygon: Polygon,
  index: number,
  options: ComputeTextureAtlasPlanOptions = {},
): TextureAtlasPlan | null {
  const doc = typeof document !== "undefined" ? document : null;
  const projectiveQuadGuards: ProjectiveQuadGuardSettings = doc
    ? resolveProjectiveQuadGuards(doc)
    : {
        denomEps: PROJECTIVE_QUAD_DENOM_EPS,
        maxWeightRatio: PROJECTIVE_QUAD_MAX_WEIGHT_RATIO,
        bleed: PROJECTIVE_QUAD_BLEED,
        disableGuards: false,
      };
  const basisHint: BasisHint | undefined = options.textureEdgeRepairEdges?.size
    ? { seamEdges: new Set<number>(), textureEdgeRepairEdges: options.textureEdgeRepairEdges }
    : undefined;
  return computeTextureAtlasPlan(polygon, index, options, projectiveQuadGuards, basisHint);
}

/**
 * Compute the dominant paint defaults from an already-computed array of plans.
 *
 * React and Vue compute plans first (to drive the atlas packing), then pass
 * the plan array here so they don't need access to the raw polygon list.
 * Requires access to a Document to check browser support for solid-triangle
 * and border-shape strategies.
 */
export function getSolidPaintDefaultsFromPlans(
  plans: Array<TextureAtlasPlan | null>,
  textureLighting: PolyTextureLightingMode,
  disabled: ReadonlySet<PolyRenderStrategy> = new Set(),
  doc?: Document | null,
): SolidPaintDefaults {
  const resolvedDoc = doc ?? (typeof document !== "undefined" ? document : null);
  if (!resolvedDoc) return {};
  return getSolidPaintDefaultsForPlans(plans, textureLighting, resolvedDoc, disabled);
}

/** Format a raw comma-separated matrix3d value string with rounded decimals. */
export function formatMatrix3d(matrix: string, decimals = DEFAULT_MATRIX_DECIMALS): string {
  return `matrix3d(${matrix.split(",").map((value) => {
    const parsed = Number(value.trim());
    return Number.isFinite(parsed) ? roundDecimal(parsed, decimals) : value.trim();
  }).join(",")})`;
}

/** Format a pixel CSS length value. */
export function formatCssLengthPx(value: number, decimals = DEFAULT_ATLAS_CSS_DECIMALS): string {
  const next = roundDecimal(value, decimals);
  return Number(next) === 0 || Object.is(Number(next), -0) ? "0" : `${next}px`;
}

/**
 * Produce the CSS matrix3d transform for a solid-quad (`<b>`) leaf, including
 * the canonical 64px primitive scale.
 */
export function formatSolidQuadEntryMatrix(entry: TextureAtlasPlan): string {
  return `matrix3d(${formatSolidQuadMatrix(entry)})`;
}

/**
 * Produce the CSS matrix3d transform for a border-shape (`<i>`) leaf.
 * Uses the canonical BORDER_SHAPE_BLEED-expanded geometry so the transform
 * matches the border-shape polygon produced by {@link cssBorderShapeForPlan}.
 */
export function formatBorderShapeEntryMatrix(entry: TextureAtlasPlan): string {
  const geometry = borderShapeGeometryForPlan(entry);
  return `matrix3d(${formatBorderShapeMatrix(entry, geometry.bounds)})`;
}

/**
 * Returns true when the browser supports the `border-shape` CSS property and
 * the pointer/hover media queries indicate a fine-pointer device (desktop-class).
 * Falls back to a globalThis-based check when no Document is available.
 */
export function isBorderShapeSupported(doc?: Document | null): boolean {
  const d = doc ?? (typeof document !== "undefined" ? document : null);
  if (!d) {
    const css = typeof CSS !== "undefined" ? CSS : undefined;
    const supportsBorderShape = !!css?.supports?.("border-shape", "polygon(0 0, 100% 0, 0 100%) circle(0)");
    if (!supportsBorderShape) return false;
    const media = typeof matchMedia !== "undefined" ? matchMedia : undefined;
    if (!media) return true;
    return media("(pointer: fine)").matches && media("(hover: hover)").matches;
  }
  return borderShapeSupported(d);
}

/**
 * Returns true when the browser renders CSS border-trick triangles correctly.
 * WebKit/Safari renders them incorrectly when transformed — this check gates
 * the `<u>` strategy path.
 */
export function isSolidTriangleSupported(doc?: Document | null): boolean {
  const d = doc ?? (typeof document !== "undefined" ? document : null);
  if (!d) {
    const userAgent = (typeof navigator !== "undefined" ? navigator : globalThis.navigator)?.userAgent ?? "";
    if (!userAgent) return true;
    const isChromiumFamily = /\b(?:Chrome|HeadlessChrome|Chromium|Edg|OPR)\//.test(userAgent);
    const isSafariFamily = /\bVersion\/[\d.]+.*\bSafari\//.test(userAgent);
    return !isSafariFamily || isChromiumFamily;
  }
  return solidTriangleSupported(d);
}

/**
 * Filter a plan array to the subset that needs atlas packing, given the active
 * render strategies and texture-lighting mode. Plans excluded from the atlas
 * will be rendered via `<b>`, `<i>`, or `<u>` by the framework components.
 */
export function filterAtlasPlans(
  plans: Array<TextureAtlasPlan | null>,
  textureLighting: PolyTextureLightingMode,
  disabled: ReadonlySet<PolyRenderStrategy>,
  doc?: Document | null,
): Array<TextureAtlasPlan | null> {
  const useFullRectSolid = !disabled.has("b");
  const useProjectiveQuad = useFullRectSolid;
  const useStableTriangle = !disabled.has("u") && isSolidTriangleSupported(doc);
  const useBorderShape = !disabled.has("i") && textureLighting !== "dynamic" && isBorderShapeSupported(doc);
  const disableB = disabled.has("b");
  return plans.map((plan) => {
    if (!plan || plan.texture) return plan;
    if (useStableTriangle && isSolidTrianglePlan(plan)) return null;
    const fullRect = isFullRectSolid(plan);
    if (
      (useFullRectSolid && fullRect) ||
      (useProjectiveQuad && isProjectiveQuadPlan(plan)) ||
      (textureLighting !== "dynamic" && useBorderShape && (!fullRect || disableB))
    ) return null;
    return plan;
  });
}

function borderShapeBoundsFromPoints(
  points: number[],
  fallbackWidth: number,
  fallbackHeight: number,
): BorderShapeBounds {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < points.length; i += 2) {
    const x = points[i];
    const y = points[i + 1];
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  const width = maxX - minX;
  const height = maxY - minY;
  if (
    !Number.isFinite(minX) ||
    !Number.isFinite(minY) ||
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= BASIS_EPS ||
    height <= BASIS_EPS
  ) {
    return { minX: 0, minY: 0, width: fallbackWidth, height: fallbackHeight };
  }
  return { minX, minY, width, height };
}

function borderShapeGeometryForPlan(entry: TextureAtlasPlan): BorderShapeGeometry {
  const fallbackWidth = entry.canvasW || 1;
  const fallbackHeight = entry.canvasH || 1;
  const sourcePts = BORDER_SHAPE_BLEED > 0
    ? offsetConvexPolygonPoints(entry.screenPts, BORDER_SHAPE_BLEED)
    : entry.screenPts;
  const bounds = BORDER_SHAPE_BLEED > 0
    ? borderShapeBoundsFromPoints(sourcePts, fallbackWidth, fallbackHeight)
    : { minX: 0, minY: 0, width: fallbackWidth, height: fallbackHeight };
  const points: Array<[number, number]> = [];
  for (let i = 0; i < sourcePts.length; i += 2) {
    const x = Math.max(0, Math.min(100, ((sourcePts[i] - bounds.minX) / bounds.width) * 100));
    const y = Math.max(0, Math.min(100, ((sourcePts[i + 1] - bounds.minY) / bounds.height) * 100));
    points.push([x, y]);
  }
  return { bounds, points };
}

function cssBorderShapePoint([x, y]: [number, number]): string {
  return `${formatPercent(x)} ${formatPercent(y)}`;
}

function cssPolygonShapeForPoints(points: Array<[number, number]>): string {
  return `polygon(${points.map(cssBorderShapePoint).join(",")})`;
}

function cssCollapsedInnerShapeForPoints(points: Array<[number, number]>): string {
  if (polygonContainsPoint(points)) return "circle(0)";

  let xSum = 0;
  let ySum = 0;
  const pointCount = Math.max(1, points.length);
  for (const [x, y] of points) {
    xSum += x;
    ySum += y;
  }
  const x = formatPercent(Math.max(0, Math.min(100, xSum / pointCount)));
  const y = formatPercent(Math.max(0, Math.min(100, ySum / pointCount)));
  return `circle(0 at ${x} ${y})`;
}

function cssBorderShapeForGeometry(points: Array<[number, number]>): string {
  return `${cssPolygonShapeForPoints(points)} ${cssCollapsedInnerShapeForPoints(points)}`;
}

export function cssBorderShapeForPlan(entry: TextureAtlasPlan): string {
  return cssBorderShapeForGeometry(borderShapeGeometryForPlan(entry).points);
}

function applySolidPaint(
  el: HTMLElement,
  entry: TextureAtlasPlan,
  textureLighting: PolyTextureLightingMode,
  solidPaintDefaults?: SolidPaintDefaults,
): void {
  if (textureLighting === "dynamic") {
    removeInlineStyleProperty(el, "color");
    removeInlineStyleProperty(el, "background");
    applyDynamicNormalVars(el, entry);
    const base = parseHex(entry.polygon.color ?? "#cccccc");
    if (rgbKey(base) === solidPaintDefaults?.dynamicColorKey) {
      removeInlineStyleProperty(el, "--psr");
      removeInlineStyleProperty(el, "--psg");
      removeInlineStyleProperty(el, "--psb");
    } else {
      setInlineStyleProperty(el, "--psr", (base.r / 255).toFixed(4));
      setInlineStyleProperty(el, "--psg", (base.g / 255).toFixed(4));
      setInlineStyleProperty(el, "--psb", (base.b / 255).toFixed(4));
    }
  } else if (entry.shadedColor !== solidPaintDefaults?.paintColor) {
    removeInlineStyleProperty(el, "background");
    setInlineStyleProperty(el, "color", entry.shadedColor);
  } else {
    removeInlineStyleProperty(el, "background");
    removeInlineStyleProperty(el, "color");
  }
}

function shadedSolidPlanForNormal(
  source: TextureAtlasPlan,
  polygon: Polygon,
  normal: Vec3,
  textureLighting: PolyTextureLightingMode,
  options: RenderTextureAtlasOptions,
): TextureAtlasPlan {
  if (textureLighting !== "baked") return { ...source, polygon, normal };
  const directionalCfg = options.directionalLight;
  const ambientCfg = options.ambientLight;
  const lightDir = directionalCfg?.direction ?? DEFAULT_LIGHT_DIR;
  const lightColor = directionalCfg?.color ?? DEFAULT_LIGHT_COLOR;
  const lightIntensity = Math.max(0, directionalCfg?.intensity ?? DEFAULT_LIGHT_INTENSITY);
  const ambientColor = ambientCfg?.color ?? DEFAULT_AMBIENT_COLOR;
  const ambientIntensity = Math.max(0, ambientCfg?.intensity ?? DEFAULT_AMBIENT_INTENSITY);
  const lLen = Math.hypot(lightDir[0], lightDir[1], lightDir[2]) || 1;
  const lx = lightDir[0] / lLen, ly = lightDir[1] / lLen, lz = lightDir[2] / lLen;
  const directScale = lightIntensity * Math.max(0, normal[0] * lx + normal[1] * ly + normal[2] * lz);
  return {
    ...source,
    polygon,
    normal,
    shadedColor: shadePolygon(polygon.color ?? "#cccccc", directScale, lightColor, ambientColor, ambientIntensity),
  };
}

function createSolidElement(
  entry: TextureAtlasPlan,
  textureLighting: PolyTextureLightingMode,
  doc: Document,
  solidPaintDefaults?: SolidPaintDefaults,
): HTMLElement {
  const el = doc.createElement("b");
  el.setAttribute("style", `transform:matrix3d(${formatSolidQuadMatrix(entry)})`);
  applyPolygonDataAttrs(el, entry.polygon);
  applySolidPaint(el, entry, textureLighting, solidPaintDefaults);

  return el;
}

function createBorderShapeSolidElement(
  entry: TextureAtlasPlan,
  textureLighting: PolyTextureLightingMode,
  doc: Document,
  solidPaintDefaults?: SolidPaintDefaults,
): HTMLElement {
  const el = doc.createElement("i");
  el.setAttribute("style", formatBorderShapeElementStyle(entry));
  applyPolygonDataAttrs(el, entry.polygon);
  applySolidPaint(el, entry, textureLighting, solidPaintDefaults);

  return el;
}

function createProjectiveSolidElement(
  entry: TextureAtlasPlan & { projectiveMatrix: string },
  textureLighting: PolyTextureLightingMode,
  doc: Document,
  solidPaintDefaults?: SolidPaintDefaults,
): HTMLElement {
  const el = doc.createElement("b");
  el.setAttribute("style", `transform:matrix3d(${entry.projectiveMatrix})`);
  applyPolygonDataAttrs(el, entry.polygon);
  applySolidPaint(el, entry, textureLighting, solidPaintDefaults);

  return el;
}

function updateSolidElementWithStablePlan(
  el: HTMLElement,
  source: TextureAtlasPlan,
  polygon: Polygon,
  textureLighting: PolyTextureLightingMode,
  options: RenderTextureAtlasOptions,
  guards: ProjectiveQuadGuardSettings,
  solidPaintDefaults?: SolidPaintDefaults,
): boolean {
  const next = source.projectiveMatrix
    ? stableProjectiveMatrixFromPlan(source, polygon, guards)
    : stableMatrixFromPlan(source, polygon);
  if (!next) return false;
  const entry = shadedSolidPlanForNormal(source, polygon, next.normal, textureLighting, options);
  el.style.visibility = "";
  el.style.transform = `matrix3d(${next.matrix})`;
  applySolidPaint(el, entry, textureLighting, solidPaintDefaults);
  applyPolygonDataAttrs(el, entry.polygon);
  return true;
}

function updateBorderShapeElementWithStablePlan(
  el: HTMLElement,
  entry: TextureAtlasPlan,
  textureLighting: PolyTextureLightingMode,
  solidPaintDefaults?: SolidPaintDefaults,
): void {
  el.style.visibility = "";
  el.setAttribute("style", formatBorderShapeElementStyle(entry));
  applySolidPaint(el, entry, textureLighting, solidPaintDefaults);
  applyPolygonDataAttrs(el, entry.polygon);
}

function createAtlasElement(
  entry: PackedTextureAtlasEntry,
  textureLighting: PolyTextureLightingMode,
  doc: Document,
): HTMLElement {
  const el = doc.createElement("s");
  el.setAttribute("style", `transform:matrix3d(${entry.atlasMatrix})`);
  applyPolygonDataAttrs(el, entry.polygon);
  const width = entry.canvasW || 1;
  const height = entry.canvasH || 1;
  const atlasCanonicalSize = atlasCanonicalSizeForEntry(entry);
  setInlineStyleProperty(el, "--polycss-atlas-size", `${atlasCanonicalSize}px`);
  setInlineStyleProperty(el, "background-position", `${formatCssLength((-entry.x / width) * atlasCanonicalSize)} ${formatCssLength((-entry.y / height) * atlasCanonicalSize)}`);
  setInlineStyleProperty(el, "opacity", "0");

  if (textureLighting === "dynamic") applyDynamicNormalVars(el, entry);
  return el;
}

export function renderPolygonsWithTextureAtlas(
  polygons: Polygon[],
  options: RenderTextureAtlasOptions = {},
): RenderTextureAtlasResult {
  const doc = options.doc ?? (typeof document !== "undefined" ? document : null);
  if (!doc) return { rendered: [], dispose: () => {} };

  const textureLighting = options.textureLighting ?? "baked";
  const disabled = new Set(options.strategies?.disable ?? []);
  const useFullRectSolid = !disabled.has("b");
  const useProjectiveQuad = useFullRectSolid;
  const useStableTriangle = !disabled.has("u") && solidTriangleSupported(doc);
  const useBorderShape = !disabled.has("i") && borderShapeSupported(doc);
  const basisHints = buildBasisHints(polygons, options);
  const projectiveQuadGuards = resolveProjectiveQuadGuards(doc);
  const plans = polygons.map((polygon, index) =>
    computeTextureAtlasPlan(polygon, index, options, projectiveQuadGuards, basisHints[index])
  );
  const trianglePlans = plans.map((plan) =>
    plan && useStableTriangle && isSolidTrianglePlan(plan)
      ? computeSolidTrianglePlan(plan.polygon, plan.index, options)
      : null
  );
  const atlasPlans = plans.map((plan, index) =>
    plan &&
    (plan.texture
      ? plan
      : (!(useFullRectSolid && isFullRectSolid(plan)) && !trianglePlans[index] && !(useProjectiveQuad && isProjectiveQuadPlan(plan)) && !useBorderShape) ? plan : null)
  );
  const { packed, atlasScale } = packTextureAtlasPlansWithScale(atlasPlans, options.textureQuality, doc);
  const atlasElements = new Map<number, HTMLElement>();
  const rendered: RenderedPoly[] = [];
  let cancelled = false;
  let urls: string[] = [];

  for (let i = 0; i < polygons.length; i++) {
    const plan = plans[i];
    const trianglePlan = trianglePlans[i];
    if (!plan) continue;

    const entry = packed.entries[i];
    if (entry) {
      const element = createAtlasElement(entry, textureLighting, doc);
      atlasElements.set(i, element);
      rendered.push({ polygonIndex: i, element, kind: "atlas", plan: entry, dispose: () => {} });
    } else if (!plan.texture && useFullRectSolid && isFullRectSolid(plan)) {
      const element = createSolidElement(plan, textureLighting, doc, options.solidPaintDefaults);
      rendered.push({ polygonIndex: i, element, kind: "solid", plan, dispose: () => {} });
    } else if (!plan.texture && trianglePlan) {
      const element = createSolidTriangleElement(trianglePlan, doc);
      rendered.push({ polygonIndex: i, element, kind: "triangle", plan, dispose: () => {} });
    } else if (!plan.texture && useProjectiveQuad && isProjectiveQuadPlan(plan)) {
      const element = createProjectiveSolidElement(plan, textureLighting, doc, options.solidPaintDefaults);
      rendered.push({ polygonIndex: i, element, kind: "solid", plan, dispose: () => {} });
    } else if (!plan.texture && useBorderShape) {
      const element = createBorderShapeSolidElement(plan, textureLighting, doc, options.solidPaintDefaults);
      rendered.push({ polygonIndex: i, element, kind: "border", plan, dispose: () => {} });
    }
  }

  rendered.sort((a, b) => a.polygonIndex - b.polygonIndex);

  buildAtlasPages(packed.pages, textureLighting, doc, atlasScale, () => cancelled)
    .then((pages) => {
      if (cancelled) {
        for (const page of pages) {
          if (page.url?.startsWith("blob:")) URL.revokeObjectURL(page.url);
        }
        return;
      }
      urls = pages.flatMap((page) => page.url?.startsWith("blob:") ? [page.url] : []);
      for (let pageIndex = 0; pageIndex < packed.pages.length; pageIndex++) {
        const page = packed.pages[pageIndex];
        const built = pages[pageIndex];
        if (!built) continue;
        for (const entry of page.entries) {
          const el = atlasElements.get(entry.index);
          if (!el || !built.url) continue;
          applyAtlasBackground(el, built, textureLighting, entry);
          removeInlineStyleProperty(el, "opacity");
        }
      }
    })
    .catch(() => {
      if (cancelled) return;
      for (const element of atlasElements.values()) {
        setInlineStyleProperty(element, "opacity", "0.5");
        setInlineStyleProperty(element, "outline", "1px dashed rgba(255, 0, 0, 0.6)");
      }
    });

  return {
    rendered,
    dispose() {
      cancelled = true;
      for (const url of urls) URL.revokeObjectURL(url);
      urls = [];
    },
  };
}

export async function renderPolygonsWithTextureAtlasAsync(
  polygons: Polygon[],
  options: RenderTextureAtlasOptions = {},
  shouldCancel: () => boolean = () => false,
): Promise<RenderTextureAtlasAsyncResult> {
  const doc = options.doc ?? (typeof document !== "undefined" ? document : null);
  if (!doc || shouldCancel()) {
    return { rendered: [], solidPaintDefaults: {}, dispose: () => {} };
  }

  const textureLighting = options.textureLighting ?? "baked";
  const disabled = new Set(options.strategies?.disable ?? []);
  const useFullRectSolid = !disabled.has("b");
  const useProjectiveQuad = useFullRectSolid;
  const useStableTriangle = !disabled.has("u") && solidTriangleSupported(doc);
  const useBorderShape = !disabled.has("i") && borderShapeSupported(doc);
  await yieldToMainThread();
  if (shouldCancel()) return { rendered: [], solidPaintDefaults: {}, dispose: () => {} };

  const basisHints = buildBasisHints(polygons, options);
  const projectiveQuadGuards = resolveProjectiveQuadGuards(doc);
  let batchStarted = performance.now();
  const plans: Array<TextureAtlasPlan | null> = new Array(polygons.length);
  for (let i = 0; i < polygons.length; i++) {
    plans[i] = computeTextureAtlasPlan(polygons[i], i, options, projectiveQuadGuards, basisHints[i]);
    batchStarted = await yieldIfOverBudget(batchStarted);
    if (shouldCancel()) return { rendered: [], solidPaintDefaults: {}, dispose: () => {} };
  }

  const solidPaintDefaults = options.solidPaintDefaults ??
    getSolidPaintDefaultsForPlans(plans, textureLighting, doc, disabled);
  const trianglePlans: Array<SolidTrianglePlan | null> = new Array(plans.length);
  const atlasPlans: Array<TextureAtlasPlan | null> = new Array(plans.length);
  for (let i = 0; i < plans.length; i++) {
    const plan = plans[i];
    const trianglePlan = plan && useStableTriangle && isSolidTrianglePlan(plan)
      ? computeSolidTrianglePlan(plan.polygon, plan.index, { ...options, solidPaintDefaults })
      : null;
    trianglePlans[i] = trianglePlan;
    atlasPlans[i] = plan &&
      (plan.texture
        ? plan
        : (!(useFullRectSolid && isFullRectSolid(plan)) && !trianglePlan && !(useProjectiveQuad && isProjectiveQuadPlan(plan)) && !useBorderShape) ? plan : null);
    batchStarted = await yieldIfOverBudget(batchStarted);
    if (shouldCancel()) return { rendered: [], solidPaintDefaults, dispose: () => {} };
  }

  const { packed, atlasScale } = packTextureAtlasPlansWithScale(atlasPlans, options.textureQuality, doc);
  const atlasElements = new Map<number, HTMLElement>();
  const rendered: RenderedPoly[] = [];
  let cancelled = false;
  let urls: string[] = [];

  for (let i = 0; i < polygons.length; i++) {
    const plan = plans[i];
    const trianglePlan = trianglePlans[i];
    if (!plan) continue;

    const entry = packed.entries[i];
    if (entry) {
      const element = createAtlasElement(entry, textureLighting, doc);
      atlasElements.set(i, element);
      rendered.push({ polygonIndex: i, element, kind: "atlas", plan: entry, dispose: () => {} });
    } else if (!plan.texture && useFullRectSolid && isFullRectSolid(plan)) {
      const element = createSolidElement(plan, textureLighting, doc, solidPaintDefaults);
      rendered.push({ polygonIndex: i, element, kind: "solid", plan, dispose: () => {} });
    } else if (!plan.texture && trianglePlan) {
      const element = createSolidTriangleElement(trianglePlan, doc);
      rendered.push({ polygonIndex: i, element, kind: "triangle", plan, dispose: () => {} });
    } else if (!plan.texture && useProjectiveQuad && isProjectiveQuadPlan(plan)) {
      const element = createProjectiveSolidElement(plan, textureLighting, doc, solidPaintDefaults);
      rendered.push({ polygonIndex: i, element, kind: "solid", plan, dispose: () => {} });
    } else if (!plan.texture && useBorderShape) {
      const element = createBorderShapeSolidElement(plan, textureLighting, doc, solidPaintDefaults);
      rendered.push({ polygonIndex: i, element, kind: "border", plan, dispose: () => {} });
    }
    batchStarted = await yieldIfOverBudget(batchStarted);
    if (shouldCancel()) {
      for (const item of rendered) item.dispose();
      return { rendered: [], solidPaintDefaults, dispose: () => {} };
    }
  }

  rendered.sort((a, b) => a.polygonIndex - b.polygonIndex);

  buildAtlasPages(packed.pages, textureLighting, doc, atlasScale, () => cancelled || shouldCancel())
    .then((pages) => {
      if (cancelled || shouldCancel()) {
        for (const page of pages) {
          if (page.url?.startsWith("blob:")) URL.revokeObjectURL(page.url);
        }
        return;
      }
      urls = pages.flatMap((page) => page.url?.startsWith("blob:") ? [page.url] : []);
      for (let pageIndex = 0; pageIndex < packed.pages.length; pageIndex++) {
        const page = packed.pages[pageIndex];
        const built = pages[pageIndex];
        if (!built) continue;
        for (const entry of page.entries) {
          const el = atlasElements.get(entry.index);
          if (!el || !built.url) continue;
          applyAtlasBackground(el, built, textureLighting, entry);
          removeInlineStyleProperty(el, "opacity");
        }
      }
    })
    .catch(() => {
      if (cancelled || shouldCancel()) return;
      for (const element of atlasElements.values()) {
        setInlineStyleProperty(element, "opacity", "0.5");
        setInlineStyleProperty(element, "outline", "1px dashed rgba(255, 0, 0, 0.6)");
      }
    });

  return {
    rendered,
    solidPaintDefaults,
    dispose() {
      cancelled = true;
      for (const url of urls) URL.revokeObjectURL(url);
      urls = [];
    },
  };
}

function clearAtlasImageStyles(el: HTMLElement): void {
  el.style.backgroundImage = "";
  el.style.backgroundPosition = "";
  el.style.backgroundSize = "";
  el.style.maskImage = "";
  el.style.maskMode = "";
  el.style.maskPosition = "";
  el.style.maskSize = "";
  el.style.maskRepeat = "";
  el.style.removeProperty("-webkit-mask-image");
  el.style.removeProperty("-webkit-mask-position");
  el.style.removeProperty("-webkit-mask-size");
  el.style.removeProperty("-webkit-mask-repeat");
}

function applySolidTriangleElement(
  el: HTMLElement,
  entry: SolidTrianglePlan,
): void {
  el.setAttribute("style", entry.styleText);
  const triangleEl = el as SolidTriangleElement;
  triangleEl.__polycssSolidTriangleBasis = entry.basis;
  triangleEl.__polycssSolidTriangleHidden = false;
  if (entry.colorComputed) {
    triangleEl.__polycssSolidTriangleColor = entry.bakedColor ?? "";
    triangleEl.__polycssSolidTriangleColorRgb = entry.bakedRgb;
    triangleEl.__polycssSolidTriangleColorAlpha = entry.bakedAlpha;
  }
  triangleEl.__polycssSolidTriangleColorFrame = undefined;
  if (entry.polygon.data || hasPolygonDataAttrs(el)) {
    applyPolygonDataAttrs(el, entry.polygon);
  }
}

function applySolidTriangleElementColor(
  el: HTMLElement,
  entry: SolidTriangleColorPlan,
  colorState: StableTriangleColorState,
  colorUpdateAllowed?: boolean,
): void {
  if (!entry.colorComputed) {
    if (entry.polygon.data || hasPolygonDataAttrs(el)) {
      applyPolygonDataAttrs(el, entry.polygon);
    }
    return;
  }
  const triangleEl = el as SolidTriangleElement;
  const nextColor = entry.bakedColor ?? "";
  const nextRgb = entry.bakedRgb;
  const nextAlpha = entry.bakedAlpha ?? 1;
  const currentColor = triangleEl.__polycssSolidTriangleColor;
  const currentRgb = triangleEl.__polycssSolidTriangleColorRgb;
  const currentAlpha = triangleEl.__polycssSolidTriangleColorAlpha ?? 1;
  const shouldUpdateColor = colorUpdateAllowed ?? stableTriangleColorAllowed(entry.index, colorState);
  if (!colorState.updatesDisabled && currentColor !== nextColor && (currentColor === undefined || shouldUpdateColor)) {
    let writeColor = nextColor;
    let writeRgb = nextRgb;
    if (
      colorState.maxStep > 0 &&
      currentRgb &&
      nextRgb &&
      currentAlpha === nextAlpha
    ) {
      const steppedRgb = stepRgbToward(currentRgb, nextRgb, colorState.maxStep);
      writeRgb = steppedRgb;
      writeColor = rgbToCss(steppedRgb, nextAlpha);
    }
    if (writeColor !== currentColor || !rgbEqual(writeRgb, currentRgb)) {
      el.style.color = writeColor;
    }
    triangleEl.__polycssSolidTriangleColor = writeColor;
    triangleEl.__polycssSolidTriangleColorRgb = writeRgb;
    triangleEl.__polycssSolidTriangleColorAlpha = nextAlpha;
    triangleEl.__polycssSolidTriangleColorFrame = colorState.colorFrame;
  }
  if (entry.polygon.data || hasPolygonDataAttrs(el)) {
    applyPolygonDataAttrs(el, entry.polygon);
  }
}

function applySolidTriangleElementFast(
  el: HTMLElement,
  entry: SolidTrianglePlan,
  colorState: StableTriangleColorState,
  colorUpdateAllowed?: boolean,
): void {
  const triangleEl = el as SolidTriangleElement;
  if (triangleEl.__polycssSolidTriangleBasis !== entry.basis) {
    triangleEl.__polycssSolidTriangleBasis = entry.basis;
  }
  showSolidTriangleElement(el);
  el.style.transform = entry.transformText;
  if (entry.colorComputed || entry.polygon.data || hasPolygonDataAttrs(el)) {
    applySolidTriangleElementColor(el, entry, colorState, colorUpdateAllowed);
  }
}

function applySolidTriangleElementColorOnly(
  el: HTMLElement,
  entry: SolidTriangleColorPlan,
  colorState: StableTriangleColorState,
  colorUpdateAllowed?: boolean,
): void {
  showSolidTriangleElement(el);
  applySolidTriangleElementColor(el, entry, colorState, colorUpdateAllowed);
}

function applySolidTriangleElementTransformOnly(
  el: HTMLElement,
  entry: SolidTrianglePlan,
): void {
  const triangleEl = el as SolidTriangleElement;
  if (triangleEl.__polycssSolidTriangleBasis !== entry.basis) {
    triangleEl.__polycssSolidTriangleBasis = entry.basis;
  }
  showSolidTriangleElement(el);
  el.style.transform = entry.transformText;
  if (entry.polygon.data || hasPolygonDataAttrs(el)) {
    applyPolygonDataAttrs(el, entry.polygon);
  }
}

function showSolidTriangleElement(el: HTMLElement): void {
  const triangleEl = el as SolidTriangleElement;
  if (!triangleEl.__polycssSolidTriangleHidden) return;
  el.style.visibility = "";
  triangleEl.__polycssSolidTriangleHidden = false;
}

function hideSolidTriangleElement(el: HTMLElement): void {
  const triangleEl = el as SolidTriangleElement;
  if (triangleEl.__polycssSolidTriangleHidden) return;
  el.style.visibility = "hidden";
  triangleEl.__polycssSolidTriangleHidden = true;
}

function stableTriangleColorBudgetCount(
  total: number,
  options: InternalRenderTextureAtlasOptions,
): number {
  const configured = options.stableTriangleColorBudget;
  if (typeof configured === "number" && Number.isFinite(configured) && configured > 0) {
    return configured <= 1
      ? Math.max(1, Math.ceil(total * configured))
      : Math.max(1, Math.floor(configured));
  }
  const freezeFrames = Math.max(1, Math.floor(options.stableTriangleColorFreezeFrames ?? 1));
  return Math.max(1, Math.ceil(total / freezeFrames));
}

function selectAdaptiveTriangleColorUpdates(
  rendered: RenderedPoly[],
  plans: Array<SolidTriangleColorPlan | null>,
  options: InternalRenderTextureAtlasOptions,
): Set<number> | null {
  if (options.stableTriangleColorPolicy !== "adaptive") return null;
  if (options.stableTriangleColorFreezeFrames === 0) return new Set();
  const colorFrame = Math.max(0, Math.floor(options.stableTriangleColorFrame ?? 0));
  const freezeFrames = Math.max(1, Math.floor(options.stableTriangleColorFreezeFrames ?? 1));
  if (freezeFrames <= 1 && !Number.isFinite(options.stableTriangleColorBudget)) return null;
  const maxWrites = stableTriangleColorBudgetCount(rendered.length, options);
  const maxAge = Math.max(
    1,
    Math.floor(options.stableTriangleColorMaxAge ?? Math.max(2, freezeFrames * 2)),
  );
  const candidates: Array<{ index: number; score: number }> = [];

  for (let i = 0; i < rendered.length; i++) {
    const item = rendered[i];
    const plan = plans[i];
    if (item.kind !== "triangle" || !plan) continue;
    const triangleEl = item.element as SolidTriangleElement;
    const currentColor = triangleEl.__polycssSolidTriangleColor;
    const nextColor = plan.bakedColor ?? "";
    if (currentColor === nextColor) continue;
    const lastColorFrame = triangleEl.__polycssSolidTriangleColorFrame ?? 0;
    const age = Math.max(0, colorFrame - lastColorFrame);
    const error = colorErrorScore(currentColor, nextColor);
    candidates.push({
      index: i,
      score: (age >= maxAge ? 1_000_000 : 0) + error * 10_000 + age,
    });
  }

  if (candidates.length === 0) return new Set();
  candidates.sort((a, b) => b.score - a.score);
  return new Set(candidates.slice(0, maxWrites).map((candidate) => candidate.index));
}

function createSolidTriangleElement(
  entry: SolidTrianglePlan,
  doc: Document,
): HTMLElement {
  const el = doc.createElement("u");
  clearAtlasImageStyles(el);
  applySolidTriangleElement(el, entry);
  applyPolygonDataAttrs(el, entry.polygon);
  return el;
}

function createHiddenSolidTriangleElement(
  polygon: Polygon,
  doc: Document,
): HTMLElement {
  const el = doc.createElement("u");
  clearAtlasImageStyles(el);
  hideSolidTriangleElement(el);
  applyPolygonDataAttrs(el, polygon);
  return el;
}

function updateStableTriangleElementsStreaming(
  rendered: RenderedPoly[],
  polygons: Polygon[],
  options: RenderTextureAtlasOptions,
  optimizeTriangleStyle: boolean,
  stableTriangleUpdateMode: "full" | "transform-only" | "color-only" | "plan-only",
  colorState: StableTriangleColorState,
): boolean {
  const internalOptions = options as InternalRenderTextureAtlasOptions;
  const stableTriangleDebug = internalOptions.stableTriangleDebug;
  const colorOnly = optimizeTriangleStyle && stableTriangleUpdateMode === "color-only";
  if (internalOptions.stableTriangleColorPolicy === "adaptive") return false;
  if (rendered.length !== polygons.length) return false;
  const matrixDecimals = stableTriangleMatrixDecimals(internalOptions);

  for (let i = 0; i < rendered.length; i++) {
    const item = rendered[i];
    if (item.kind !== "triangle" || item.polygonIndex !== i || !polygons[i]) return false;
  }

  for (let i = 0; i < rendered.length; i++) {
    const element = rendered[i].element as SolidTriangleElement;
    const polygon = polygons[i];
    if (colorOnly) {
      if (
        shouldComputeStableTriangleColor(
          element,
          i,
          optimizeTriangleStyle,
          stableTriangleDebug,
          internalOptions.stableTriangleColorPolicy,
          colorState,
        )
      ) {
        const plan = computeSolidTriangleColorPlan(polygon, i, options);
        if (!plan) continue;
        applySolidTriangleElementColorOnly(
          element,
          plan,
          colorState,
        );
      }
      continue;
    }

    const plan = computeSolidTrianglePlan(polygon, i, options, {
      basis: element.__polycssSolidTriangleBasis,
      matrixDecimals,
      includeColor: stableTriangleUpdateMode !== "plan-only" &&
        stableTriangleUpdateMode !== "transform-only" &&
        shouldComputeStableTriangleColor(
          element,
          i,
          optimizeTriangleStyle,
          stableTriangleDebug,
          internalOptions.stableTriangleColorPolicy,
          colorState,
        ),
    });
    if (!plan) {
      hideSolidTriangleElement(element);
      continue;
    }
    if (optimizeTriangleStyle && stableTriangleUpdateMode === "plan-only") {
      continue;
    } else if (optimizeTriangleStyle && stableTriangleUpdateMode === "transform-only") {
      applySolidTriangleElementTransformOnly(element, plan);
    } else if (optimizeTriangleStyle) {
      applySolidTriangleElementFast(element, plan, colorState);
    } else {
      applySolidTriangleElement(element, plan);
    }
  }

  return true;
}

export function updateStableTriangleFrame(
  rendered: RenderedPoly[],
  polygons: Polygon[],
  frame: SolidTriangleFrame,
  options: RenderTextureAtlasOptions = {},
): boolean {
  const textureLighting = options.textureLighting ?? "baked";
  const internalOptions = options as InternalRenderTextureAtlasOptions;
  const optimizeTriangleStyle =
    internalOptions.optimizeStableTriangleStyle === true &&
    textureLighting === "baked";
  if (!optimizeTriangleStyle) return false;
  if (internalOptions.stableTriangleColorPolicy === "adaptive") return false;
  if (rendered.length !== frame.polygonCount || polygons.length !== frame.polygonCount) return false;
  if (frame.vertices.length < frame.polygonCount * 9) return false;

  const stableTriangleDebug = internalOptions.stableTriangleDebug;
  const stableTriangleUpdateMode = internalOptions.stableTriangleUpdateMode ??
    (stableTriangleDebug === "plan-only" || stableTriangleDebug === "transform-only"
      ? stableTriangleDebug
      : "full");
  if (stableTriangleUpdateMode === "color-only") return false;

  const matrixDecimals = stableTriangleMatrixDecimals(internalOptions);
  const colorState = stableTriangleColorState(internalOptions);
  const tile = options.tileSize ?? DEFAULT_TILE;
  const elev = options.layerElevation ?? tile;

  for (let i = 0; i < rendered.length; i++) {
    const item = rendered[i];
    const polygon = polygons[i];
    if (
      item.kind !== "triangle" ||
      item.polygonIndex !== i ||
      !polygon ||
      polygon.vertices.length !== 3 ||
      polygon.texture ||
      polygon.material?.texture
    ) {
      return false;
    }
  }

  const values = frame.vertices;
  for (let i = 0; i < rendered.length; i++) {
    const element = rendered[i].element as SolidTriangleElement;
    const polygon = polygons[i]!;
    const offset = i * 9;
    const p0x = values[offset + 1]! * tile;
    const p0y = values[offset]! * tile;
    const p0z = values[offset + 2]! * elev;
    const p1x = values[offset + 4]! * tile;
    const p1y = values[offset + 3]! * tile;
    const p1z = values[offset + 5]! * elev;
    const p2x = values[offset + 7]! * tile;
    const p2y = values[offset + 6]! * tile;
    const p2z = values[offset + 8]! * elev;
    const plan = computeSolidTrianglePlanFromCssPoints(
      polygon,
      i,
      options,
      {
        basis: element.__polycssSolidTriangleBasis,
        matrixDecimals,
        color: frame.colors?.[i],
        includeColor: stableTriangleUpdateMode !== "plan-only" &&
          stableTriangleUpdateMode !== "transform-only" &&
          shouldComputeStableTriangleColor(
            element,
            i,
            optimizeTriangleStyle,
            stableTriangleDebug,
            internalOptions.stableTriangleColorPolicy,
            colorState,
          ),
      },
      p0x,
      p0y,
      p0z,
      p1x,
      p1y,
      p1z,
      p2x,
      p2y,
      p2z,
    );
    if (!plan) {
      hideSolidTriangleElement(element);
      continue;
    }
    if (stableTriangleUpdateMode === "plan-only") {
      continue;
    } else if (stableTriangleUpdateMode === "transform-only") {
      applySolidTriangleElementTransformOnly(element, plan);
    } else {
      applySolidTriangleElementFast(element, plan, colorState);
    }
  }

  return true;
}

export function renderPolygonsWithStableTriangles(
  polygons: Polygon[],
  options: RenderTextureAtlasOptions = {},
): RenderTextureAtlasResult | null {
  const doc = options.doc ?? (typeof document !== "undefined" ? document : null);
  if (!doc) return { rendered: [], dispose: () => {} };
  if (!solidTriangleSupported(doc)) return null;
  if (polygons.some((polygon) => polygon.texture || polygon.vertices.length !== 3)) {
    return null;
  }
  const matrixDecimals = stableTriangleMatrixDecimals(options as InternalRenderTextureAtlasOptions);
  const rendered: RenderedPoly[] = [];

  for (let i = 0; i < polygons.length; i += 1) {
    const polygon = polygons[i];
    const plan = computeSolidTrianglePlan(polygon, i, options, { matrixDecimals });
    const element = plan
      ? createSolidTriangleElement(plan, doc)
      : createHiddenSolidTriangleElement(polygon, doc);
    rendered.push({ polygonIndex: i, element, kind: "triangle", dispose: () => {} });
  }

  return {
    rendered,
    dispose() {},
  };
}

export function updatePolygonsWithStableTriangles(
  rendered: RenderedPoly[],
  polygons: Polygon[],
  options: RenderTextureAtlasOptions = {},
): RenderTextureAtlasResult | null {
  const doc = options.doc ?? (typeof document !== "undefined" ? document : null);
  if (!doc) return { rendered, dispose: () => {} };
  if (!solidTriangleSupported(doc)) return null;
  if (rendered.some((item) => item.kind !== "triangle")) return null;
  if (polygons.length !== rendered.length) return null;
  for (let i = 0; i < rendered.length; i++) {
    if (rendered[i].polygonIndex !== i) return null;
  }

  const optimizeTriangleStyle =
    (options as InternalRenderTextureAtlasOptions).optimizeStableTriangleStyle === true &&
    (options.textureLighting ?? "baked") === "baked";
  const internalOptions = options as InternalRenderTextureAtlasOptions;
  const stableTriangleDebug = internalOptions.stableTriangleDebug;
  const stableTriangleUpdateMode = internalOptions.stableTriangleUpdateMode ??
    (stableTriangleDebug === "plan-only" || stableTriangleDebug === "transform-only"
      ? stableTriangleDebug
      : "full");
  const colorOnly = optimizeTriangleStyle && stableTriangleUpdateMode === "color-only";
  const colorState = stableTriangleColorState(internalOptions);
  const matrixDecimals = stableTriangleMatrixDecimals(internalOptions);
  if (
    updateStableTriangleElementsStreaming(
      rendered,
      polygons,
      options,
      optimizeTriangleStyle,
      stableTriangleUpdateMode,
      colorState,
    )
  ) {
    return {
      rendered,
      dispose() {},
    };
  }
  const nextTrianglePlans: Array<SolidTrianglePlan | null> = new Array(rendered.length);
  const nextTriangleColorPlans: Array<SolidTriangleColorPlan | null> = new Array(rendered.length);
  for (let i = 0; i < rendered.length; i++) {
    const element = rendered[i].element as SolidTriangleElement;
    if (colorOnly) {
      const shouldComputeColor = internalOptions.stableTriangleColorPolicy === "adaptive" ||
        shouldComputeStableTriangleColor(
          element,
          i,
          optimizeTriangleStyle,
          stableTriangleDebug,
          internalOptions.stableTriangleColorPolicy,
          colorState,
        );
      nextTriangleColorPlans[i] = shouldComputeColor
        ? computeSolidTriangleColorPlan(polygons[i], i, options)
        : null;
      continue;
    }
    nextTrianglePlans[i] = computeSolidTrianglePlan(polygons[i], i, options, {
      basis: element.__polycssSolidTriangleBasis,
      matrixDecimals,
      includeColor: stableTriangleUpdateMode !== "plan-only" &&
        stableTriangleUpdateMode !== "transform-only" &&
        shouldComputeStableTriangleColor(
          element,
          i,
          optimizeTriangleStyle,
          stableTriangleDebug,
          internalOptions.stableTriangleColorPolicy,
          colorState,
        ),
    });
  }
  const adaptiveColorUpdates = optimizeTriangleStyle && stableTriangleUpdateMode !== "plan-only" &&
      stableTriangleUpdateMode !== "transform-only"
    ? selectAdaptiveTriangleColorUpdates(
        rendered,
        colorOnly ? nextTriangleColorPlans : nextTrianglePlans,
        internalOptions,
      )
    : null;

  for (let i = 0; i < rendered.length; i++) {
    if (colorOnly) {
      const plan = nextTriangleColorPlans[i];
      if (plan) {
        applySolidTriangleElementColorOnly(
          rendered[i].element,
          plan,
          colorState,
          adaptiveColorUpdates?.has(i),
        );
      }
      continue;
    }
    const plan = nextTrianglePlans[i];
    if (!plan) {
      hideSolidTriangleElement(rendered[i].element);
      continue;
    }
    if (optimizeTriangleStyle && stableTriangleUpdateMode === "plan-only") {
      continue;
    } else if (optimizeTriangleStyle && stableTriangleUpdateMode === "transform-only") {
      applySolidTriangleElementTransformOnly(rendered[i].element, plan);
    } else if (optimizeTriangleStyle) {
      applySolidTriangleElementFast(
        rendered[i].element,
        plan,
        colorState,
        adaptiveColorUpdates?.has(i),
      );
    } else {
      applySolidTriangleElement(rendered[i].element, plan);
    }
  }

  return {
    rendered,
    dispose() {},
  };
}

export function updatePolygonsWithStableTopology(
  rendered: RenderedPoly[],
  polygons: Polygon[],
  options: RenderTextureAtlasOptions = {},
): boolean {
  if (rendered.length !== polygons.length) return false;
  const doc = options.doc ?? (typeof document !== "undefined" ? document : null);
  const textureLighting = options.textureLighting ?? "baked";
  const disabled = new Set(options.strategies?.disable ?? []);
  const useFullRectSolid = !disabled.has("b");
  const useProjectiveQuad = useFullRectSolid;
  const useBorderShape = !!doc && !disabled.has("i") && borderShapeSupported(doc);
  const projectiveQuadGuards = doc
    ? resolveProjectiveQuadGuards(doc)
    : {
        denomEps: PROJECTIVE_QUAD_DENOM_EPS,
        maxWeightRatio: PROJECTIVE_QUAD_MAX_WEIGHT_RATIO,
        bleed: PROJECTIVE_QUAD_BLEED,
        disableGuards: false,
      };
  const optimizeTriangleStyle =
    (options as InternalRenderTextureAtlasOptions).optimizeStableTriangleStyle === true &&
    textureLighting === "baked";
  const internalOptions = options as InternalRenderTextureAtlasOptions;
  const stableTriangleDebug = internalOptions.stableTriangleDebug;
  const stableTriangleUpdateMode = internalOptions.stableTriangleUpdateMode ??
    (stableTriangleDebug === "plan-only" || stableTriangleDebug === "transform-only"
      ? stableTriangleDebug
      : "full");
  const colorOnly = optimizeTriangleStyle && stableTriangleUpdateMode === "color-only";
  const colorState = stableTriangleColorState(internalOptions);
  const matrixDecimals = stableTriangleMatrixDecimals(internalOptions);
  if (
    updateStableTriangleElementsStreaming(
      rendered,
      polygons,
      options,
      optimizeTriangleStyle,
      stableTriangleUpdateMode,
      colorState,
    )
  ) {
    return true;
  }
  const nextTrianglePlans: Array<SolidTrianglePlan | null> = [];
  const nextTriangleColorPlans: Array<SolidTriangleColorPlan | null> = [];
  const nextTexturePlans: Array<TextureAtlasPlan | null> = [];

  for (let i = 0; i < rendered.length; i++) {
    const item = rendered[i];
    if (item.polygonIndex !== i) return false;
    const polygon = polygons[i];
    if (!polygon) return false;
    if (colorOnly && item.kind !== "triangle") return false;
    if (item.kind === "atlas") {
      if (
        !item.plan ||
        !updateAtlasElementWithStablePlan(item.element, item.plan, polygon, textureLighting)
      ) {
        return false;
      }
      continue;
    }
    if (item.kind === "triangle") {
      const element = item.element as SolidTriangleElement;
      if (colorOnly) {
        const shouldComputeColor = internalOptions.stableTriangleColorPolicy === "adaptive" ||
          shouldComputeStableTriangleColor(
            element,
            i,
            optimizeTriangleStyle,
            stableTriangleDebug,
            internalOptions.stableTriangleColorPolicy,
            colorState,
          );
        nextTriangleColorPlans[i] = shouldComputeColor
          ? computeSolidTriangleColorPlan(polygon, i, options)
          : null;
        continue;
      }
      const plan = computeSolidTrianglePlan(polygon, i, options, {
        basis: element.__polycssSolidTriangleBasis,
        matrixDecimals,
        includeColor: stableTriangleUpdateMode !== "plan-only" &&
          stableTriangleUpdateMode !== "transform-only" &&
          shouldComputeStableTriangleColor(
            element,
            i,
            optimizeTriangleStyle,
            stableTriangleDebug,
            internalOptions.stableTriangleColorPolicy,
            colorState,
          ),
      });
      if (!plan) {
        nextTrianglePlans[i] = null;
        continue;
      }
      nextTrianglePlans[i] = plan;
      continue;
    }
    if (item.kind === "solid") {
      if (!item.plan || polygon.texture || polygon.vertices.length !== item.plan.polygon.vertices.length) return false;
      nextTexturePlans[i] = item.plan;
      continue;
    }
    if (item.kind === "border") {
      const plan = computeTextureAtlasPlan(polygon, i, options, projectiveQuadGuards);
      if (
        !plan ||
        plan.texture ||
        !useBorderShape ||
        (useFullRectSolid && isFullRectSolid(plan)) ||
        (useProjectiveQuad && isProjectiveQuadPlan(plan))
      ) {
        return false;
      }
      nextTexturePlans[i] = plan;
      continue;
    }
    return false;
  }

  const adaptiveColorUpdates = optimizeTriangleStyle && stableTriangleUpdateMode !== "plan-only" &&
      stableTriangleUpdateMode !== "transform-only"
    ? selectAdaptiveTriangleColorUpdates(
        rendered,
        colorOnly ? nextTriangleColorPlans : nextTrianglePlans,
        internalOptions,
      )
    : null;

  for (let i = 0; i < rendered.length; i++) {
    const item = rendered[i];
    if (item.kind === "triangle") {
      if (colorOnly) {
        const plan = nextTriangleColorPlans[i];
        if (plan) {
          applySolidTriangleElementColorOnly(
            item.element,
            plan,
            colorState,
            adaptiveColorUpdates?.has(i),
          );
        }
        continue;
      }
      const plan = nextTrianglePlans[i];
      if (!plan) {
        hideSolidTriangleElement(item.element);
        continue;
      }
      if (optimizeTriangleStyle && stableTriangleUpdateMode === "plan-only") {
        continue;
      } else if (optimizeTriangleStyle && stableTriangleUpdateMode === "transform-only") {
        applySolidTriangleElementTransformOnly(item.element, plan);
      } else if (optimizeTriangleStyle) {
        applySolidTriangleElementFast(
          item.element,
          plan,
          colorState,
          adaptiveColorUpdates?.has(i),
        );
      } else {
        applySolidTriangleElement(item.element, plan);
      }
    } else if (item.kind === "solid") {
      const plan = nextTexturePlans[i];
      if (!plan) return false;
      if (
        !updateSolidElementWithStablePlan(
          item.element,
          plan,
          polygons[i],
          textureLighting,
          options,
          projectiveQuadGuards,
          internalOptions.solidPaintDefaults,
        )
      ) {
        return false;
      }
    } else if (item.kind === "border") {
      const plan = nextTexturePlans[i];
      if (!plan) return false;
      updateBorderShapeElementWithStablePlan(item.element, plan, textureLighting, internalOptions.solidPaintDefaults);
    }
  }

  return true;
}
