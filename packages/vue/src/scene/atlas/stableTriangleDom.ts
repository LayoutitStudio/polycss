import type { Polygon } from "@layoutit/polycss-core";
import type {
  PolyDirectionalLight,
  PolyAmbientLight,
  PolyTextureLightingMode,
  PolyRenderStrategiesOption,
  PolySeamBleed,
} from "@layoutit/polycss-core";
import { isSolidTriangleSupported } from "./detection";
import {
  BASIS_EPS,
  SOLID_TRIANGLE_BLEED,
  DEFAULT_TILE,
  DEFAULT_LIGHT_DIR,
  DEFAULT_LIGHT_COLOR,
  DEFAULT_LIGHT_INTENSITY,
  DEFAULT_AMBIENT_COLOR,
  DEFAULT_AMBIENT_INTENSITY,
  parseHex,
  rgbKey,
  rgbToHex,
  shadePolygon,
  quantizeCssColor,
  stepRgbToward,
  offsetConvexPolygonPoints,
} from "./solidTriangleStyle";
import type { RGB } from "./solidTriangleStyle";

// ---------------------------------------------------------------------------
// updateStableTriangleDom — imperative DOM fast-path for triangle meshes
// This is Vue-specific: it writes directly to HTMLElement style without
// triggering a Vue re-render. Used by PolyMesh's setPolygonsImpl callback.
// ---------------------------------------------------------------------------

export interface StableTriangleDomUpdateOptions {
  directionalLight?: PolyDirectionalLight;
  ambientLight?: PolyAmbientLight;
  textureLighting?: PolyTextureLightingMode;
  strategies?: PolyRenderStrategiesOption;
  seamBleed?: PolySeamBleed;
  colorFrame?: number;
  colorSteps?: number;
  colorFreezeFrames?: number;
  colorMaxStep?: number;
}

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
  color?: string;
  basis: StableTriangleBasis;
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
  let apexPtX = apexLineRightX - t * right;
  let apexPtY = apexLineRightY - t * height;
  let baseLeftX = -amount * (left + leftLen) / height;
  let baseLeftY = height + amount;
  let baseRightX = baseWidth + amount * (right + rightLen) / height;
  let baseRightY = baseLeftY;

  const maxMiter = Math.max(2, amount * 4);
  const apexDx = apexPtX - left;
  const apexDy = apexPtY;
  const apexMiter = Math.sqrt(apexDx * apexDx + apexDy * apexDy);
  if (apexMiter > maxMiter) {
    apexPtX = left + (apexDx / apexMiter) * maxMiter;
    apexPtY = (apexDy / apexMiter) * maxMiter;
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

  return [apexPtX, apexPtY, baseLeftX, baseLeftY, baseRightX, baseRightY];
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

  const SOLID_TRIANGLE_CANONICAL_SIZE = 32;
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

  let color: string | undefined;
  if (Math.floor(options.colorFreezeFrames ?? 1) !== 0) {
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
    color = options.colorSteps
      ? quantizeCssColor(shadedColor, options.colorSteps)
      : shadedColor;
  }
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
    if (style.color !== undefined) applyStableTriangleColor(el, i, style.color, options);
  }
  return true;
}
