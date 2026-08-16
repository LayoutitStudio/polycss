import type { Polygon } from "@layoutit/polycss-core";
import type {
  PolyDirectionalLight,
  PolyAmbientLight,
  PolyPointLight,
  PolyTextureLightingMode,
  PolyRenderStrategiesOption,
  PolySeamBleed,
  RGB,
  SolidTrianglePrimitive,
} from "@layoutit/polycss-core";
import {
  BASIS_EPS,
  DEFAULT_TILE,
  SOLID_TRIANGLE_BLEED,
  computeSolidTriangleColorPlanFromNormal,
  offsetStableTrianglePoints,
  parseHex,
  quantizeCssColor,
  rgbToHex,
  seamBleedPrimitiveRatio,
  stepRgbToward,
} from "@layoutit/polycss-core";
import { resolveSolidTrianglePrimitive } from "./detection";
import {
  formatStableTriangleTransformScalars,
  applySolidTrianglePaintStyle,
  solidTriangleBorderWidth,
  solidTriangleCanonicalSize,
} from "./solidTriangleStyle";

// ---------------------------------------------------------------------------
// updateStableTriangleDom — imperative DOM fast-path for triangle meshes
// This is React-specific: it writes directly to HTMLElement style without
// triggering a React re-render. Used by PolyMesh's setPolygonsImpl callback.
// ---------------------------------------------------------------------------

export interface StableTriangleDomUpdateOptions {
  directionalLight?: PolyDirectionalLight;
  ambientLight?: PolyAmbientLight;
  pointLights?: PolyPointLight[];
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
  borderWidth?: string;
  color?: string;
  basis: StableTriangleBasis;
}

function computeStableTriangleDomStyle(
  polygon: Polygon,
  index: number,
  options: StableTriangleDomUpdateOptions,
  primitive: SolidTrianglePrimitive,
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
    basisHint ? computeStableTriangleDomStyle(polygon, index, options, primitive) : null;
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
  // Scale the primitive overscan by the seamBleed-derived ratio — mirrors
  // core solidTrianglePlan (options.seamBleed=0 disables it, sub-default
  // values shrink it proportionally).
  const expanded = offsetStableTrianglePoints(
    leftExtent,
    rightExtent,
    height,
    SOLID_TRIANGLE_BLEED * seamBleedPrimitiveRatio(options.seamBleed),
  );
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

  const canonicalSize = solidTriangleCanonicalSize(primitive);
  const invCanonicalSize = 1 / canonicalSize;
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
    // Vanilla routes imperative solid-triangle updates through core's
    // computeSolidTrianglePlanFromCssPoints, whose color plan folds the
    // directional, ambient, AND point-light contributions into one baked
    // linear-light Lambert color. Reuse that color plan here so imperative
    // updates match the plan-path colors (including point-light shading).
    const colorPlan = computeSolidTriangleColorPlanFromNormal(
      polygon,
      index,
      nx,
      ny,
      nz,
      {
        directionalLight: options.directionalLight,
        ambientLight: options.ambientLight,
        pointLights: options.pointLights,
        tileSize: tile,
        layerElevation: elev,
      },
      true,
    );
    const shadedColor = colorPlan.bakedColor;
    color = shadedColor !== undefined && options.colorSteps
      ? quantizeCssColor(shadedColor, options.colorSteps)
      : shadedColor;
  }
  return { transform, borderWidth: solidTriangleBorderWidth(primitive), color, basis: { a, b, c } };
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
  // Resolve the primitive against the ROOT's owning document (correct inside
  // iframes / second documents) and honor strategies.disable — mirrors
  // vanilla's updatePolygonsWithStableTriangles gate, which rejects this
  // fast path entirely when "u" is disabled or unsupported.
  const primitive = resolveSolidTrianglePrimitive(root.ownerDocument, options.strategies);
  if (!primitive) return false;
  const leaves = Array.from(root.children).filter(
    (child): child is StableTriangleDomElement =>
      child instanceof HTMLElement && child.localName === "u",
  );
  if (leaves.length !== polygons.length) return false;

  const styles = polygons.map((polygon, index) =>
    computeStableTriangleDomStyle(polygon, index, options, primitive, leaves[index].__polycssStableTriangleBasis)
  );
  if (styles.some((style) => !style)) return false;

  for (let i = 0; i < leaves.length; i += 1) {
    const style = styles[i]!;
    const el = leaves[i];
    if (el.style.visibility) el.style.visibility = "";
    el.__polycssStableTriangleBasis = style.basis;
    applySolidTrianglePaintStyle(el, primitive);
    el.style.transform = style.transform;
    if (style.borderWidth !== undefined) el.style.borderWidth = style.borderWidth;
    if (style.color !== undefined) applyStableTriangleColor(el, i, style.color, options);
  }
  return true;
}
