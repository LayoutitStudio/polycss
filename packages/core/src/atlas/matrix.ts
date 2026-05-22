import type { Vec3 } from "../types";
import {
  DEFAULT_MATRIX_DECIMALS,
  DEFAULT_ATLAS_CSS_DECIMALS,
  DEFAULT_BORDER_SHAPE_DECIMALS,
  DECIMAL_SCALES,
  SOLID_QUAD_CANONICAL_SIZE,
  BORDER_SHAPE_CANONICAL_SIZE,
} from "./constants";
import type { TextureAtlasPlan, BorderShapeBounds } from "./types";

export function roundDecimal(value: number, decimals: number): string {
  if (Object.is(value, 0) || Object.is(value, -0)) return "0";
  if (value === 1) return "1";
  if (value === -1) return "-1";
  const scale = DECIMAL_SCALES[decimals] ?? 10 ** decimals;
  const next = Math.round(value * scale) / scale;
  if (Object.is(next, 0) || Object.is(next, -0)) return "0";
  return String(next);
}

export function formatCssLength(value: number, decimals = DEFAULT_ATLAS_CSS_DECIMALS): string {
  const next = roundDecimal(value, decimals);
  return next === "0" ? "0" : `${next}px`;
}

export function formatMatrix3dValues(values: readonly number[], decimals = DEFAULT_MATRIX_DECIMALS): string {
  if (values.length === 0) return "";
  let text = roundDecimal(values[0], decimals);
  for (let i = 1; i < values.length; i++) text += `,${roundDecimal(values[i], decimals)}`;
  return text;
}

export function formatAffineMatrix3dColumns(
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

export function formatAffineMatrix3dScalars(
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

export function formatAffineMatrix3dTransformScalars(
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

export function formatScaledMatrixFromPlan(
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

export function formatBorderShapeMatrix(
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

export function formatSolidQuadMatrix(entry: TextureAtlasPlan): string {
  const bleed = entry.seamBleedInsets ?? { left: 0, right: 0, top: 0, bottom: 0 };
  const canvasW = entry.canvasW || 1;
  const canvasH = entry.canvasH || 1;
  return formatScaledMatrixFromPlan(
    entry,
    (canvasW + bleed.left + bleed.right) / SOLID_QUAD_CANONICAL_SIZE,
    (canvasH + bleed.top + bleed.bottom) / SOLID_QUAD_CANONICAL_SIZE,
    -bleed.left,
    -bleed.top,
  );
}

export function formatAtlasMatrix(
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

export function formatPercent(value: number, decimals = DEFAULT_BORDER_SHAPE_DECIMALS): string {
  const next = roundDecimal(value, decimals);
  return Number(next) === 0 ? "0" : `${next}%`;
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
