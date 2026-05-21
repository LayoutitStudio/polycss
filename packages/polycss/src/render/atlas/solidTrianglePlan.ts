import type { Polygon } from "@layoutit/polycss-core";
import type { Vec3 } from "@layoutit/polycss-core";
import {
  DEFAULT_TILE,
  DEFAULT_LIGHT_DIR,
  DEFAULT_LIGHT_COLOR,
  DEFAULT_LIGHT_INTENSITY,
  DEFAULT_AMBIENT_COLOR,
  DEFAULT_AMBIENT_INTENSITY,
  BASIS_EPS,
  SOLID_TRIANGLE_BLEED,
  SOLID_TRIANGLE_CANONICAL_SIZE,
} from "./constants";
import type {
  SolidTrianglePlan,
  SolidTriangleColorPlan,
  SolidTriangleBasis,
  SolidTriangleComputeOptions,
  InternalRenderTextureAtlasOptions,
  RenderTextureAtlasOptions,
  RGB,
} from "./types";
import {
  shadePolygon,
  quantizeCssColor,
  parseHex,
  parseAlpha,
  rgbKey,
} from "./paintDefaults";
import {
  cssPoints,
  offsetStableTrianglePoints,
  stableTriangleMatrixDecimals,
} from "./solidTriangle";
import { formatAffineMatrix3dTransformScalars } from "./matrix";
import { resolveSolidTrianglePrimitive } from "./strategy";

export function computeSolidTriangleColorPlanFromNormal(
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

export function computeSolidTriangleColorPlan(
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

export function computeSolidTrianglePlan(
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

export function computeSolidTrianglePlanFromCssPoints(
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
  const doc = options.doc ?? (typeof document !== "undefined" ? document : null);
  const primitive = computeOptions.primitive ??
    (doc ? resolveSolidTrianglePrimitive(doc, options.strategies) ?? "border" : "border");
  return {
    index,
    polygon,
    styleText,
    transformText,
    basis,
    primitive,
    colorComputed,
    bakedColor: bakedColorValue,
    bakedRgb,
    bakedAlpha,
    dynamicVars,
  };
}
