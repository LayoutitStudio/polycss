import { parsePureColor, type Polygon, type Vec3 } from "@layoutit/polycss-react";

type AxisIndex = 0 | 1 | 2;
type Point2 = [number, number];

interface Segment2 {
  a: Point2;
  b: Point2;
}

interface InteriorShellInterval {
  row: number;
  y: number;
  x0: number;
  x1: number;
  length: number;
}

interface InteriorShellSlice {
  fixedAxis: AxisIndex;
  axisA: AxisIndex;
  axisB: AxisIndex;
  planeValue: number;
  points: Point2[];
  area: number;
}

interface InteriorShellComponent {
  points: Point2[];
  area: number;
}

interface DominantSolidSurface {
  color: string;
  polygons: Polygon[];
}

interface PolygonBounds {
  min: Vec3;
  max: Vec3;
  center: Vec3;
  span: Vec3;
  diagonal: number;
  maxSpan: number;
}

export interface InteriorShellOptions {
  maxSlices?: number;
  spread?: number;
  inset?: number;
  maxLoopPoints?: number;
}

export const DEFAULT_INTERIOR_SHELL_OPTIONS = {
  maxSlices: 4,
  spread: 0.12,
  inset: 0.12,
  maxLoopPoints: 32,
} satisfies Required<InteriorShellOptions>;

const MIN_MAX_SPAN = 8;
const MIN_DIAGONAL = 10;
const MIN_SOLID_COVERAGE = 0.2;
const MIN_PLANE_AREA_RATIO = 0.12;
const MIN_SLICE_AREA_RATIO = 0.01;
const SCAN_ROWS = 96;
const INTERVAL_MIN_LENGTH_RATIO = 0.18;
const INTERVAL_OVERLAP_RATIO = 0.12;
const INTERVAL_SUPPORT_RADIUS_ROWS = 2;
const MIN_INTERVAL_ROWS = 4;
const MAX_COMPONENTS_PER_SLICE = 1;
const EPS = 1e-6;

function solidColorToHex(value: string): string | null {
  const parsed = parsePureColor(value);
  if (!parsed || parsed.alpha < 1) return null;
  const hex = parsed.rgb
    .map((channel) => Math.max(0, Math.min(255, Math.round(channel))).toString(16).padStart(2, "0"))
    .join("");
  return `#${hex}`;
}

function polygonArea(polygon: Pick<Polygon, "vertices">): number {
  const [origin] = polygon.vertices;
  if (!origin || polygon.vertices.length < 3) return 0;
  let area = 0;
  for (let i = 1; i < polygon.vertices.length - 1; i += 1) {
    const a = polygon.vertices[i];
    const b = polygon.vertices[i + 1];
    const ax = a[0] - origin[0];
    const ay = a[1] - origin[1];
    const az = a[2] - origin[2];
    const bx = b[0] - origin[0];
    const by = b[1] - origin[1];
    const bz = b[2] - origin[2];
    area += Math.hypot(
      ay * bz - az * by,
      az * bx - ax * bz,
      ax * by - ay * bx,
    ) * 0.5;
  }
  return area;
}

function polygonBounds(polygons: Polygon[]): PolygonBounds | null {
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;

  for (const polygon of polygons) {
    for (const [x, y, z] of polygon.vertices) {
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      minZ = Math.min(minZ, z);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      maxZ = Math.max(maxZ, z);
    }
  }

  if (!Number.isFinite(minX)) return null;
  const span: Vec3 = [maxX - minX, maxY - minY, maxZ - minZ];
  return {
    min: [minX, minY, minZ],
    max: [maxX, maxY, maxZ],
    center: [
      (minX + maxX) / 2,
      (minY + maxY) / 2,
      (minZ + maxZ) / 2,
    ],
    span,
    diagonal: Math.hypot(span[0], span[1], span[2]),
    maxSpan: Math.max(span[0], span[1], span[2]),
  };
}

function dominantSolidSurface(polygons: Polygon[]): DominantSolidSurface | null {
  let totalWeight = 0;
  let solidWeight = 0;
  const weights = new Map<string, number>();
  const polygonsByColor = new Map<string, Polygon[]>();

  for (const polygon of polygons) {
    const weight = Math.max(polygonArea(polygon), 1e-4);
    totalWeight += weight;
    if (polygon.texture || polygon.material?.texture || polygon.textureTriangles?.length) continue;

    const color = solidColorToHex(polygon.color ?? "#cccccc");
    if (!color) continue;
    solidWeight += weight;
    weights.set(color, (weights.get(color) ?? 0) + weight);
    const sameColor = polygonsByColor.get(color);
    if (sameColor) sameColor.push(polygon);
    else polygonsByColor.set(color, [polygon]);
  }

  if (totalWeight <= 0 || solidWeight / totalWeight < MIN_SOLID_COVERAGE) return null;

  let bestColor: string | null = null;
  let bestWeight = 0;
  for (const [color, weight] of weights) {
    if (weight > bestWeight) {
      bestColor = color;
      bestWeight = weight;
    }
  }
  return bestColor
    ? { color: bestColor, polygons: polygonsByColor.get(bestColor) ?? [] }
    : null;
}

export function interiorShellPolygons(polygons: Polygon[], options: InteriorShellOptions = {}): Polygon[] {
  const surface = dominantSolidSurface(polygons);
  if (!surface || surface.polygons.length === 0) return [];

  const bounds = polygonBounds(surface.polygons);
  if (!bounds) return [];
  if (bounds.maxSpan < MIN_MAX_SPAN || bounds.diagonal < MIN_DIAGONAL) return [];

  const resolved = resolveInteriorShellOptions(options);
  const slices: InteriorShellSlice[] = [];
  for (const plane of candidatePlanes(bounds)) {
    const area = bounds.span[plane.axisA] * bounds.span[plane.axisB];
    for (const position of slicePositions(resolved.spread)) {
      const planeValue = bounds.min[plane.fixedAxis] + bounds.span[plane.fixedAxis] * position;
      slices.push(...interiorShellSlicesAtPlane(
        surface.polygons,
        bounds,
        plane.fixedAxis,
        plane.axisA,
        plane.axisB,
        planeValue,
        area,
        resolved.inset,
      ));
    }
  }

  return selectInteriorShellSlices(slices, resolved.maxSlices)
    .flatMap((slice) => polygonFromSlice(bounds, slice, surface.color, resolved.maxLoopPoints));
}

function resolveInteriorShellOptions(options: InteriorShellOptions): Required<InteriorShellOptions> {
  return {
    maxSlices: Math.max(1, Math.min(8, Math.round(options.maxSlices ?? DEFAULT_INTERIOR_SHELL_OPTIONS.maxSlices))),
    spread: Math.max(0, Math.min(0.34, options.spread ?? DEFAULT_INTERIOR_SHELL_OPTIONS.spread)),
    inset: Math.max(0, Math.min(0.18, options.inset ?? DEFAULT_INTERIOR_SHELL_OPTIONS.inset)),
    maxLoopPoints: Math.max(4, Math.min(64, Math.round(options.maxLoopPoints ?? DEFAULT_INTERIOR_SHELL_OPTIONS.maxLoopPoints))),
  };
}

function slicePositions(spread: number): number[] {
  if (spread <= EPS) return [0.5];
  return [0.5, 0.5 - spread, 0.5 + spread];
}

function candidatePlanes(bounds: PolygonBounds): Array<{ fixedAxis: AxisIndex; axisA: AxisIndex; axisB: AxisIndex; area: number }> {
  const candidates = [
    { fixedAxis: 2 as AxisIndex, axisA: 0 as AxisIndex, axisB: 1 as AxisIndex, area: bounds.span[0] * bounds.span[1] },
    { fixedAxis: 1 as AxisIndex, axisA: 0 as AxisIndex, axisB: 2 as AxisIndex, area: bounds.span[0] * bounds.span[2] },
    { fixedAxis: 0 as AxisIndex, axisA: 1 as AxisIndex, axisB: 2 as AxisIndex, area: bounds.span[1] * bounds.span[2] },
  ].sort((a, b) => b.area - a.area);
  const minArea = (candidates[0]?.area ?? 0) * MIN_PLANE_AREA_RATIO;
  return candidates.filter((candidate) => candidate.area > minArea);
}

function selectInteriorShellSlices(slices: InteriorShellSlice[], maxSlices: number): InteriorShellSlice[] {
  const selected: InteriorShellSlice[] = [];
  const sorted = [...slices].sort((a, b) => b.area - a.area);
  for (const slice of sorted) {
    if (selected.length >= maxSlices) break;
    const axisCount = selected.filter((current) => current.fixedAxis === slice.fixedAxis).length;
    if (axisCount >= 2) continue;
    selected.push(slice);
  }
  return selected;
}

function polygonFromSlice(
  bounds: PolygonBounds,
  slice: InteriorShellSlice,
  color: string,
  maxLoopPoints: number,
): Polygon[] {
  const points = simplifyLoop2D(slice.points, maxLoopPoints);
  if (points.length < 3) return [];
  const vertices = points.map(([a, b]): Vec3 => {
    const vertex = [...bounds.center] as Vec3;
    vertex[slice.fixedAxis] = slice.planeValue;
    vertex[slice.axisA] = a;
    vertex[slice.axisB] = b;
    return vertex;
  });
  return [
    { vertices, color },
    { vertices: [...vertices].reverse(), color },
  ];
}

function interiorShellSlicesAtPlane(
  polygons: Polygon[],
  bounds: PolygonBounds,
  fixedAxis: AxisIndex,
  axisA: AxisIndex,
  axisB: AxisIndex,
  planeValue: number,
  candidateArea: number,
  inset: number,
): InteriorShellSlice[] {
  const tolerance = Math.max(bounds.diagonal * 1e-5, 1e-4);
  const segments: Segment2[] = [];
  for (const polygon of polygons) {
    const segment = slicePolygonAtAxis(polygon, fixedAxis, axisA, axisB, planeValue, tolerance);
    if (segment) segments.push(segment);
  }
  if (segments.length < 3) return [];

  const primary = scanlineSliceComponents(segments, false, candidateArea, tolerance, inset);
  const secondary = scanlineSliceComponents(segments, true, candidateArea, tolerance, inset);
  const components = totalComponentArea(secondary) > totalComponentArea(primary) ? secondary : primary;
  return components.map((component): InteriorShellSlice => ({
    fixedAxis,
    axisA,
    axisB,
    planeValue,
    points: component.points,
    area: component.area,
  })).filter((slice) => slice.area >= candidateArea * MIN_SLICE_AREA_RATIO);
}

function slicePolygonAtAxis(
  polygon: Polygon,
  fixedAxis: AxisIndex,
  axisA: AxisIndex,
  axisB: AxisIndex,
  planeValue: number,
  tolerance: number,
): Segment2 | null {
  const vertices = polygon.vertices;
  if (vertices.length < 3) return null;
  if (vertices.every((vertex) => Math.abs(vertex[fixedAxis] - planeValue) <= tolerance)) return null;

  const hits: Point2[] = [];
  for (let i = 0; i < vertices.length; i += 1) {
    const a = vertices[i];
    const b = vertices[(i + 1) % vertices.length];
    const da = a[fixedAxis] - planeValue;
    const db = b[fixedAxis] - planeValue;

    if (Math.abs(da) <= tolerance && Math.abs(db) <= tolerance) {
      hits.push([a[axisA], a[axisB]], [b[axisA], b[axisB]]);
      continue;
    }
    if (Math.abs(da) <= tolerance) {
      hits.push([a[axisA], a[axisB]]);
      continue;
    }
    if (da * db >= 0) continue;

    const t = da / (da - db);
    hits.push([
      a[axisA] + (b[axisA] - a[axisA]) * t,
      a[axisB] + (b[axisB] - a[axisB]) * t,
    ]);
  }

  const unique = uniquePoints2D(hits, tolerance);
  if (unique.length < 2) return null;

  let best: Segment2 | null = null;
  let bestDistance = 0;
  for (let i = 0; i < unique.length; i += 1) {
    for (let j = i + 1; j < unique.length; j += 1) {
      const distance = distance2D(unique[i], unique[j]);
      if (distance > bestDistance) {
        best = { a: unique[i], b: unique[j] };
        bestDistance = distance;
      }
    }
  }
  return best && bestDistance > tolerance ? best : null;
}

function scanlineSliceComponents(
  segments: Segment2[],
  swapAxes: boolean,
  candidateArea: number,
  tolerance: number,
  inset: number,
): InteriorShellComponent[] {
  const oriented = segments.map((segment): Segment2 => ({
    a: orientPoint2D(segment.a, swapAxes),
    b: orientPoint2D(segment.b, swapAxes),
  }));
  const intervals = scanlineIntervals(oriented, candidateArea, tolerance);
  if (intervals.length < MIN_INTERVAL_ROWS) return [];

  const components = intervalComponents(intervals)
    .filter((component) => component.length >= MIN_INTERVAL_ROWS)
    .slice(0, MAX_COMPONENTS_PER_SLICE);

  return components.flatMap((component) => {
    const safeComponent = insetIntervalComponent(component, inset, candidateArea, tolerance);
    if (safeComponent.length < MIN_INTERVAL_ROWS) return [];
    const loop = loopFromIntervals(safeComponent);
    const area = Math.abs(loopArea2D(loop));
    if (loop.length < 3 || area < candidateArea * MIN_SLICE_AREA_RATIO) return [];
    const points = scaleLoopTowardCentroid2D(loop, inset * 0.75)
      .map((point) => orientPoint2D(point, swapAxes));
    return [{ points, area: Math.abs(loopArea2D(points)) }];
  });
}

function insetIntervalComponent(
  component: InteriorShellInterval[],
  inset: number,
  candidateArea: number,
  tolerance: number,
): InteriorShellInterval[] {
  const rows = [...component].sort((a, b) => a.row - b.row || b.length - a.length);
  if (rows.length < MIN_INTERVAL_ROWS) return [];
  if (inset <= EPS) return rows;

  const trim = Math.min(
    Math.floor((rows.length - MIN_INTERVAL_ROWS) / 2),
    Math.max(1, Math.ceil(rows.length * inset * 0.35)),
  );
  const trimmed = rows.slice(trim, rows.length - trim);
  const absoluteMargin = Math.max(Math.sqrt(candidateArea) * 0.004, tolerance * 3);

  const insetRows = trimmed.flatMap((interval): InteriorShellInterval[] => {
    const margin = Math.max(interval.length * inset * 0.22, absoluteMargin);
    const x0 = interval.x0 + margin;
    const x1 = interval.x1 - margin;
    if (x1 - x0 <= tolerance * 4) return [];
    return [{
      ...interval,
      x0,
      x1,
      length: x1 - x0,
    }];
  });

  return supportedIntervalComponent(insetRows, tolerance);
}

function supportedIntervalComponent(
  component: InteriorShellInterval[],
  tolerance: number,
): InteriorShellInterval[] {
  const rows = [...component].sort((a, b) => a.row - b.row || b.length - a.length);
  if (rows.length < MIN_INTERVAL_ROWS) return [];
  const radius = Math.min(INTERVAL_SUPPORT_RADIUS_ROWS, Math.floor((rows.length - 1) / 2));
  if (radius <= 0) return rows;

  const supported: InteriorShellInterval[] = [];
  for (let i = 0; i < rows.length; i += 1) {
    const from = Math.max(0, i - radius);
    const to = Math.min(rows.length - 1, i + radius);
    let x0 = rows[i].x0;
    let x1 = rows[i].x1;
    for (let j = from; j <= to; j += 1) {
      x0 = Math.max(x0, rows[j].x0);
      x1 = Math.min(x1, rows[j].x1);
    }
    if (x1 - x0 <= tolerance * 4) continue;
    supported.push({
      ...rows[i],
      x0,
      x1,
      length: x1 - x0,
    });
  }

  return intervalComponents(supported)
    .filter((candidate) => candidate.length >= MIN_INTERVAL_ROWS)[0] ?? [];
}

function scanlineIntervals(
  segments: Segment2[],
  candidateArea: number,
  tolerance: number,
): InteriorShellInterval[] {
  let minY = Infinity;
  let maxY = -Infinity;
  for (const segment of segments) {
    minY = Math.min(minY, segment.a[1], segment.b[1]);
    maxY = Math.max(maxY, segment.a[1], segment.b[1]);
  }
  if (!Number.isFinite(minY) || maxY - minY <= tolerance) return [];

  const intervals: InteriorShellInterval[] = [];
  for (let row = 0; row < SCAN_ROWS; row += 1) {
    const y = minY + ((row + 0.5) / SCAN_ROWS) * (maxY - minY);
    const xs: number[] = [];
    for (const segment of segments) {
      const y0 = segment.a[1];
      const y1 = segment.b[1];
      if (Math.abs(y1 - y0) <= tolerance) continue;
      const low = Math.min(y0, y1);
      const high = Math.max(y0, y1);
      if (y < low || y >= high) continue;
      const t = (y - y0) / (y1 - y0);
      xs.push(segment.a[0] + (segment.b[0] - segment.a[0]) * t);
    }

    xs.sort((a, b) => a - b);
    const uniqueXs = uniqueNumbers(xs, tolerance);
    for (let i = 0; i + 1 < uniqueXs.length; i += 2) {
      const x0 = uniqueXs[i];
      const x1 = uniqueXs[i + 1];
      const length = x1 - x0;
      if (length <= tolerance) continue;
      intervals.push({ row, y, x0, x1, length });
    }
  }

  if (intervals.length === 0) return [];
  const maxLength = Math.max(...intervals.map((interval) => interval.length));
  const minLength = Math.max(
    maxLength * INTERVAL_MIN_LENGTH_RATIO,
    Math.sqrt(candidateArea) * 0.01,
    tolerance * 4,
  );
  return intervals.filter((interval) => interval.length >= minLength);
}

function intervalComponents(intervals: InteriorShellInterval[]): InteriorShellInterval[][] {
  const sorted = [...intervals].sort((a, b) => a.row - b.row || b.length - a.length);
  const components: InteriorShellInterval[][] = [];
  const active: Array<{ last: InteriorShellInterval; component: InteriorShellInterval[] }> = [];

  for (const interval of sorted) {
    let best: { last: InteriorShellInterval; component: InteriorShellInterval[] } | null = null;
    for (const current of active) {
      if (interval.row - current.last.row > 1) continue;
      const overlap = Math.min(interval.x1, current.last.x1) - Math.max(interval.x0, current.last.x0);
      const required = Math.min(interval.length, current.last.length) * INTERVAL_OVERLAP_RATIO;
      if (overlap >= required && (!best || current.component.length > best.component.length)) {
        best = current;
      }
    }

    if (best) {
      best.component.push(interval);
      best.last = interval;
    } else {
      const component = [interval];
      components.push(component);
      active.push({ last: interval, component });
    }

    for (let i = active.length - 1; i >= 0; i -= 1) {
      if (interval.row - active[i].last.row > 1) active.splice(i, 1);
    }
  }

  return components.sort((a, b) => componentArea(b) - componentArea(a));
}

function loopFromIntervals(intervals: InteriorShellInterval[]): Point2[] {
  const byRow = new Map<number, InteriorShellInterval>();
  for (const interval of intervals) {
    const current = byRow.get(interval.row);
    if (!current || interval.length > current.length) byRow.set(interval.row, interval);
  }
  const rows = [...byRow.values()].sort((a, b) => a.row - b.row);
  const loop = [
    ...rows.map((row): Point2 => [row.x0, row.y]),
    ...rows.slice().reverse().map((row): Point2 => [row.x1, row.y]),
  ];
  return cleanLoop2D(loop);
}

function cleanLoop2D(points: Point2[]): Point2[] {
  const out: Point2[] = [];
  for (const point of points) {
    const previous = out[out.length - 1];
    if (!previous || distance2D(previous, point) > EPS) out.push(point);
  }
  if (out.length > 1 && distance2D(out[0], out[out.length - 1]) <= EPS) out.pop();
  return out;
}

function simplifyLoop2D(points: Point2[], maxPoints: number): Point2[] {
  const cleaned = cleanLoop2D(points);
  if (cleaned.length <= maxPoints) return cleaned;

  const out = [...cleaned];
  while (out.length > maxPoints) {
    let removeIndex = -1;
    let removeScore = Infinity;
    for (let i = 0; i < out.length; i += 1) {
      const previous = out[(i + out.length - 1) % out.length];
      const current = out[i];
      const next = out[(i + 1) % out.length];
      const score = triangleArea2D(previous, current, next);
      if (score < removeScore) {
        removeScore = score;
        removeIndex = i;
      }
    }
    if (removeIndex < 0) break;
    out.splice(removeIndex, 1);
  }
  return cleanLoop2D(out);
}

function triangleArea2D(a: Point2, b: Point2, c: Point2): number {
  return Math.abs(
    (a[0] * (b[1] - c[1]) +
      b[0] * (c[1] - a[1]) +
      c[0] * (a[1] - b[1])) * 0.5,
  );
}

function scaleLoopTowardCentroid2D(points: Point2[], amount: number): Point2[] {
  const center = loopCentroid2D(points);
  return points.map(([x, y]) => [
    center[0] + (x - center[0]) * (1 - amount),
    center[1] + (y - center[1]) * (1 - amount),
  ]);
}

function componentArea(component: InteriorShellInterval[]): number {
  if (component.length === 0) return 0;
  const rows = [...component].sort((a, b) => a.row - b.row);
  const rowStep = rows.length > 1 ? Math.abs(rows[1].y - rows[0].y) : 1;
  return rows.reduce((sum, row) => sum + row.length * rowStep, 0);
}

function orientPoint2D([x, y]: Point2, swapAxes: boolean): Point2 {
  return swapAxes ? [y, x] : [x, y];
}

function uniquePoints2D(points: Point2[], tolerance: number): Point2[] {
  const cellSize = Math.max(tolerance, 1e-6);
  const seen = new Map<string, Point2>();
  for (const point of points) {
    const key = `${Math.round(point[0] / cellSize)},${Math.round(point[1] / cellSize)}`;
    if (!seen.has(key)) seen.set(key, point);
  }
  return [...seen.values()];
}

function uniqueNumbers(values: number[], tolerance: number): number[] {
  const out: number[] = [];
  for (const value of values) {
    if (!out.some((current) => Math.abs(current - value) <= tolerance)) out.push(value);
  }
  return out;
}

function distance2D(a: Point2, b: Point2): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

function loopArea2D(points: Point2[]): number {
  let area = 0;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    area += a[0] * b[1] - a[1] * b[0];
  }
  return area / 2;
}

function totalComponentArea(components: InteriorShellComponent[]): number {
  return components.reduce((sum, component) => sum + component.area, 0);
}

function loopCentroid2D(points: Point2[]): Point2 {
  const signedArea = loopArea2D(points);
  if (Math.abs(signedArea) <= EPS) {
    return [
      points.reduce((sum, point) => sum + point[0], 0) / Math.max(points.length, 1),
      points.reduce((sum, point) => sum + point[1], 0) / Math.max(points.length, 1),
    ];
  }

  let cx = 0;
  let cy = 0;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    const crossValue = a[0] * b[1] - b[0] * a[1];
    cx += (a[0] + b[0]) * crossValue;
    cy += (a[1] + b[1]) * crossValue;
  }
  const factor = 1 / (6 * signedArea);
  return [cx * factor, cy * factor];
}
