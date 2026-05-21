import {
  BORDER_SHAPE_CENTER_PERCENT,
  BORDER_SHAPE_POINT_EPS,
  BORDER_SHAPE_CANONICAL_SIZE,
  BORDER_SHAPE_BLEED,
  CORNER_SHAPE_POINT_EPS,
  CORNER_SHAPE_DUPLICATE_EPS,
  BASIS_EPS,
} from "./constants";
import type {
  TextureAtlasPlan,
  BorderShapeBounds,
  BorderShapeGeometry,
  CornerShapeCorner,
  CornerShapeSide,
  CornerShapeRadius,
  CornerShapeGeometry,
} from "./types";
import { formatPercent, formatScaledMatrixFromPlan } from "./matrix";
import { offsetConvexPolygonPoints } from "./solidTriangle";
import { isFullRectSolid, isSolidTrianglePlan } from "./strategy";

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

export function polygonContainsPoint(
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

export function borderShapeBoundsFromPoints(
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

export function borderShapeGeometryForPlan(entry: TextureAtlasPlan): BorderShapeGeometry {
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

export function simplifyCornerShapePoints(points: Array<[number, number]>): Array<[number, number]> {
  const simplified: Array<[number, number]> = [];
  for (const point of points) {
    const previous = simplified[simplified.length - 1];
    if (
      previous &&
      Math.hypot(previous[0] - point[0], previous[1] - point[1]) <= CORNER_SHAPE_DUPLICATE_EPS
    ) {
      continue;
    }
    simplified.push(point);
  }
  if (simplified.length > 1) {
    const first = simplified[0];
    const last = simplified[simplified.length - 1];
    if (Math.hypot(first[0] - last[0], first[1] - last[1]) <= CORNER_SHAPE_DUPLICATE_EPS) {
      simplified.pop();
    }
  }
  return simplified;
}

export function cornerShapePointSides([x, y]: [number, number]): Set<CornerShapeSide> | null {
  const sides = new Set<CornerShapeSide>();
  if (Math.abs(x) <= CORNER_SHAPE_POINT_EPS) sides.add("left");
  if (Math.abs(x - 100) <= CORNER_SHAPE_POINT_EPS) sides.add("right");
  if (Math.abs(y) <= CORNER_SHAPE_POINT_EPS) sides.add("top");
  if (Math.abs(y - 100) <= CORNER_SHAPE_POINT_EPS) sides.add("bottom");
  return sides.size > 0 ? sides : null;
}

export function sharedCornerShapeSide(a: Set<CornerShapeSide>, b: Set<CornerShapeSide>): boolean {
  for (const side of a) {
    if (b.has(side)) return true;
  }
  return false;
}

export function cornerShapeDiagonal(
  aPoint: [number, number],
  aSides: Set<CornerShapeSide>,
  bPoint: [number, number],
  bSides: Set<CornerShapeSide>,
): [CornerShapeCorner, CornerShapeRadius] | null {
  const read = (
    corner: CornerShapeCorner,
    horizontal: CornerShapeSide,
    vertical: CornerShapeSide,
  ): [CornerShapeCorner, CornerShapeRadius] | null => {
    const horizontalPoint = aSides.has(horizontal) ? aPoint : bSides.has(horizontal) ? bPoint : null;
    const verticalPoint = aSides.has(vertical) ? aPoint : bSides.has(vertical) ? bPoint : null;
    if (!horizontalPoint || !verticalPoint) return null;
    const radius = (() => {
      switch (corner) {
        case "topLeft":
          return { x: horizontalPoint[0], y: verticalPoint[1] };
        case "topRight":
          return { x: 100 - horizontalPoint[0], y: verticalPoint[1] };
        case "bottomRight":
          return { x: 100 - horizontalPoint[0], y: 100 - verticalPoint[1] };
        case "bottomLeft":
          return { x: horizontalPoint[0], y: 100 - verticalPoint[1] };
      }
    })();
    return radius.x > CORNER_SHAPE_POINT_EPS &&
        radius.y > CORNER_SHAPE_POINT_EPS &&
        radius.x < 100 - CORNER_SHAPE_POINT_EPS &&
        radius.y < 100 - CORNER_SHAPE_POINT_EPS
      ? [corner, radius]
      : null;
  };

  if ((aSides.has("top") || bSides.has("top")) && (aSides.has("left") || bSides.has("left"))) {
    return read("topLeft", "top", "left");
  }
  if ((aSides.has("top") || bSides.has("top")) && (aSides.has("right") || bSides.has("right"))) {
    return read("topRight", "top", "right");
  }
  if ((aSides.has("bottom") || bSides.has("bottom")) && (aSides.has("right") || bSides.has("right"))) {
    return read("bottomRight", "bottom", "right");
  }
  if ((aSides.has("bottom") || bSides.has("bottom")) && (aSides.has("left") || bSides.has("left"))) {
    return read("bottomLeft", "bottom", "left");
  }
  return null;
}

export function cornerShapeGeometryForPlan(entry: TextureAtlasPlan): CornerShapeGeometry | null {
  if (entry.texture || isSolidTrianglePlan(entry) || isFullRectSolid(entry)) return null;
  const geometry = borderShapeGeometryForPlan(entry);
  const points = simplifyCornerShapePoints(geometry.points);
  if (points.length < 4) return null;

  const sides = points.map(cornerShapePointSides);
  if (sides.some((side) => !side)) return null;

  const radii: Partial<Record<CornerShapeCorner, CornerShapeRadius>> = {};
  let diagonalCount = 0;
  for (let i = 0; i < points.length; i += 1) {
    const aSides = sides[i]!;
    const bSides = sides[(i + 1) % points.length]!;
    if (sharedCornerShapeSide(aSides, bSides)) continue;
    const diagonal = cornerShapeDiagonal(points[i], aSides, points[(i + 1) % points.length], bSides);
    if (!diagonal) return null;
    const [corner, radius] = diagonal;
    const previous = radii[corner];
    if (
      previous &&
      (Math.abs(previous.x - radius.x) > CORNER_SHAPE_POINT_EPS ||
        Math.abs(previous.y - radius.y) > CORNER_SHAPE_POINT_EPS)
    ) {
      return null;
    }
    radii[corner] = radius;
    diagonalCount += 1;
  }

  return diagonalCount > 0 ? { bounds: geometry.bounds, radii } : null;
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

export function cssBorderShapeForGeometry(points: Array<[number, number]>): string {
  return `${cssPolygonShapeForPoints(points)} ${cssCollapsedInnerShapeForPoints(points)}`;
}

export function cssBorderShapeForPlan(entry: TextureAtlasPlan): string {
  return cssBorderShapeForGeometry(borderShapeGeometryForPlan(entry).points);
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

export function formatBorderShapeEntryMatrix(entry: TextureAtlasPlan): string {
  const geometry = borderShapeGeometryForPlan(entry);
  return `matrix3d(${formatBorderShapeMatrix(entry, geometry.bounds)})`;
}

export function formatBorderShapeElementStyle(entry: TextureAtlasPlan): string {
  const geometry = borderShapeGeometryForPlan(entry);
  return [
    `transform:matrix3d(${formatBorderShapeMatrix(entry, geometry.bounds)})`,
    `border-shape:${cssBorderShapeForGeometry(geometry.points)}`,
  ].join(";");
}

export function formatCornerShapeElementStyle(
  entry: TextureAtlasPlan,
  geometry: CornerShapeGeometry,
): string {
  const styles = [
    `transform:matrix3d(${formatBorderShapeMatrix(entry, geometry.bounds)})`,
    `width:${BORDER_SHAPE_CANONICAL_SIZE}px`,
    `height:${BORDER_SHAPE_CANONICAL_SIZE}px`,
    "border:0",
    "box-sizing:border-box",
    "background:currentColor",
  ];
  for (const [corner, radius] of Object.entries(geometry.radii) as Array<[CornerShapeCorner, CornerShapeRadius]>) {
    const cssCorner = corner.replace(/[A-Z]/g, (char) => `-${char.toLowerCase()}`);
    styles.push(`border-${cssCorner}-radius:${formatPercent(radius.x)} ${formatPercent(radius.y)}`);
    styles.push(`corner-${cssCorner}-shape:bevel`);
  }
  return styles.join(";");
}
