import type { Vec2, Vec3, Polygon } from "@layoutit/polycss-core";
import {
  BASIS_EPS,
  RECT_EPS,
  SOLID_TRIANGLE_BLEED,
  DEFAULT_MATRIX_DECIMALS,
} from "./constants";
import type {
  TextureAtlasPlan,
  StablePlanBasis,
  InternalRenderTextureAtlasOptions,
} from "./types";
import { formatAffineMatrix3dTransformScalars } from "./matrix";

export function cssPoints(vertices: Vec3[], tile: number, elev: number): Vec3[] {
  return vertices.map((v): Vec3 => [v[1] * tile, v[0] * tile, v[2] * elev]);
}

export function computeSurfaceNormal(pts: Vec3[]): Vec3 | null {
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

export function isConvexPolygonPoints(points: Array<[number, number]>): boolean {
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

export function signedArea2D(points: Array<[number, number]>): number {
  let area = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    area += a[0] * b[1] - a[1] * b[0];
  }
  return area / 2;
}

export function intersect2DLines(
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

export function intersect2DLinesRaw(
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

export function expandClipPoints(points: number[], amount: number): number[] {
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

export function offsetTrianglePoints(
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

export function offsetStableTrianglePoints(
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

export function stableBasisFromPlan(
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

export function stableTriangleMatrixDecimals(options: InternalRenderTextureAtlasOptions): number {
  return Math.max(
    0,
    Math.min(6, Math.floor(options.stableTriangleMatrixDecimals ?? DEFAULT_MATRIX_DECIMALS)),
  );
}
