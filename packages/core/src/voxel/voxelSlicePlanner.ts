/* Pure voxel slice planning - zero DOM dependencies.
 * The rectangle optimizer is ported from voxcss mergeVoxels="3d"; polycss
 * feeds it the raw MagicaVoxel cell source and renders the plans in
 * packages/polycss.
 */
import type { PolyVoxelSource } from "../parser/types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PlaneAxis = "x" | "y" | "z";
export type PolyVoxelFace = "t" | "b" | "bl" | "br" | "fr" | "fl";

export interface PolyVoxelWallsMask {
  t: boolean;
  b: boolean;
  bl: boolean;
  br: boolean;
  fl: boolean;
  fr: boolean;
}

const CUBE_FACES = ["t", "b", "bl", "br", "fr", "fl"] as const;

export interface FaceKey { axis: PlaneAxis; plane: number; face: PolyVoxelFace; }

export interface FaceBuffer {
  width: number;
  height: number;
  minRow: number;
  minCol: number;
  ids: Uint32Array;
  mask: Uint8Array;
  filledCount: number;
  palette: string[];
}

export interface FaceData { key: FaceKey; buffer: FaceBuffer; }

export type Brush = {
  r0: number;
  c0: number;
  r1: number;
  c1: number;
  baseColor: string;
};

export type SlicePlan = {
  key: FaceKey;
  buffer: FaceBuffer;
  brushes: Brush[];
};

/** Half-open bounds: [r0, r1) x [c0, c1) */
interface Rect {
  r0: number;
  c0: number;
  r1: number;
  c1: number;
}

type HoleFill = {
  mask: Uint8Array;
  filledCount: number;
  allowMask: Uint8Array | null;
};

type SpanMergeCandidate = {
  first: number;
  second: number;
  replacement: Brush;
  extraArea: number;
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const SLICE_RENDERER_VERSION = 1;
export const AXIS_ORDER: Record<PlaneAxis, number> = { x: 0, y: 1, z: 2 };
export const FACE_ORDER = new Map<PolyVoxelFace, number>(CUBE_FACES.map((face, index) => [face, index] as const));
export const NEXT_LAYER_STEP: Record<PolyVoxelFace, number> = {
  t: 1, fr: 1, fl: 1,
  b: -1, bl: -1, br: -1
};

export const wallsToSig = (walls: PolyVoxelWallsMask): number =>
  (walls.t ? 1 : 0) |
  (walls.b ? 2 : 0) |
  (walls.bl ? 4 : 0) |
  (walls.br ? 8 : 0) |
  (walls.fl ? 16 : 0) |
  (walls.fr ? 32 : 0);

export const buildSliceCacheKey = (face: FaceData): string => {
  const { axis, plane, face: faceKey } = face.key;
  return `slice:${SLICE_RENDERER_VERSION}:${axis}:${plane}:${faceKey}`;
};

export const buffersEqual = (a: FaceBuffer | null, b: FaceBuffer | null): boolean => {
  if (a === b) return true;
  if (!a || !b) return false;
  if (a.width !== b.width || a.height !== b.height) return false;
  if (a.minRow !== b.minRow || a.minCol !== b.minCol) return false;
  if (a.filledCount !== b.filledCount) return false;
  const paletteA = a.palette;
  const paletteB = b.palette;
  if (paletteA.length !== paletteB.length) return false;
  for (let i = 0; i < paletteA.length; i += 1) {
    if (paletteA[i] !== paletteB[i]) return false;
  }
  const idsA = a.ids;
  const idsB = b.ids;
  if (idsA.length !== idsB.length) return false;
  for (let i = 0; i < idsA.length; i += 1) {
    if (idsA[i] !== idsB[i]) return false;
  }
  return true;
};

// ---------------------------------------------------------------------------
// Rectangle decomposition
// ---------------------------------------------------------------------------

export const holeFillVariants = (buffer: FaceBuffer, nextLayer: FaceBuffer | null): HoleFill[] => {
  const out: HoleFill[] = [{ mask: buffer.mask, filledCount: buffer.filledCount, allowMask: null }];
  if (!nextLayer) return out;

  const { width, height } = buffer;
  const allowMask = new Uint8Array(width * height);

  const rowOffset = nextLayer.minRow - buffer.minRow;
  const colOffset = nextLayer.minCol - buffer.minCol;

  for (let nr = 0; nr < nextLayer.height; nr += 1) {
    const r = nr + rowOffset;
    if (r < 0 || r >= height) continue;
    const rowBase = r * width;
    const nextRowBase = nr * nextLayer.width;
    for (let nc = 0; nc < nextLayer.width; nc += 1) {
      if (!nextLayer.mask[nextRowBase + nc]) continue;
      const c = nc + colOffset;
      if (c < 0 || c >= width) continue;
      const idx = rowBase + c;
      if (!buffer.mask[idx]) allowMask[idx] = 1;
    }
  }

  let added = 0;
  for (let i = 0; i < allowMask.length; i += 1) added += allowMask[i] ? 1 : 0;
  if (!added) return out;

  const filledMask = buffer.mask.slice();
  for (let i = 0; i < allowMask.length; i += 1) if (allowMask[i]) filledMask[i] = 1;

  out.push({ mask: filledMask, filledCount: buffer.filledCount + added, allowMask });
  return out;
};

export const runRects = (mask: Uint8Array, width: number, bounds: Rect, byColumn: boolean): Rect[] => {
  const { r0, c0, r1, c1 } = bounds;
  if (r1 <= r0 || c1 <= c0) return [];

  const rects: Rect[] = [];

  if (!byColumn) {
    for (let r = r0; r < r1; r += 1) {
      const rowBase = r * width;
      let c = c0;
      while (c < c1) {
        while (c < c1 && !mask[rowBase + c]) c += 1;
        if (c >= c1) break;
        const start = c;
        while (c < c1 && mask[rowBase + c]) c += 1;
        rects.push({ r0: r, c0: start, r1: r + 1, c1: c });
      }
    }
    return rects;
  }

  for (let c = c0; c < c1; c += 1) {
    let r = r0;
    while (r < r1) {
      while (r < r1 && !mask[r * width + c]) r += 1;
      if (r >= r1) break;
      const start = r;
      while (r < r1 && mask[r * width + c]) r += 1;
      rects.push({ r0: start, c0: c, r1: r, c1: c + 1 });
    }
  }
  return rects;
};

export const mergeAlignedRects = <T extends Rect>(rects: T[]): T[] => {
  if (rects.length < 2) return rects;

  rects.sort((a, b) => a.r0 - b.r0 || a.r1 - b.r1 || a.c0 - b.c0 || a.c1 - b.c1);
  const horiz: T[] = [];
  for (const rect of rects) {
    const last = horiz[horiz.length - 1];
    if (last && rect.r0 === last.r0 && rect.r1 === last.r1 && rect.c0 === last.c1) {
      last.c1 = rect.c1;
      continue;
    }
    horiz.push(rect);
  }

  horiz.sort((a, b) => a.c0 - b.c0 || a.c1 - b.c1 || a.r0 - b.r0 || a.r1 - b.r1);
  const vert: T[] = [];
  for (const rect of horiz) {
    const last = vert[vert.length - 1];
    if (last && rect.c0 === last.c0 && rect.c1 === last.c1 && rect.r0 === last.r1) {
      last.r1 = rect.r1;
      continue;
    }
    vert.push(rect);
  }

  return vert;
};

const pickRectsForMask = (mask: Uint8Array, width: number, height: number): Rect[] => {
  const bounds = { r0: 0, c0: 0, r1: height, c1: width };

  const row = mergeAlignedRects(runRects(mask, width, bounds, false));
  const col = mergeAlignedRects(runRects(mask, width, bounds, true));

  if (!row.length) return col;
  if (col.length && col.length < row.length) return col;
  return row;
};

const findLargestFilledRect = (
  mask: Uint8Array,
  width: number,
  height: number,
  heights: Int32Array,
  stackStarts: Int32Array,
  stackHeights: Int32Array
): (Rect & { area: number }) | null => {
  heights.fill(0);
  let best: (Rect & { area: number }) | null = null;

  for (let r = 0; r < height; r += 1) {
    const rowBase = r * width;
    for (let c = 0; c < width; c += 1) {
      heights[c] = mask[rowBase + c] ? heights[c] + 1 : 0;
    }

    let stackLength = 0;
    for (let c = 0; c <= width; c += 1) {
      const currentHeight = c < width ? heights[c] : 0;
      let start = c;

      while (stackLength > 0 && stackHeights[stackLength - 1] > currentHeight) {
        stackLength -= 1;
        const rectHeight = stackHeights[stackLength];
        const rectStart = stackStarts[stackLength];
        const area = rectHeight * (c - rectStart);
        if (!best || area > best.area) {
          best = {
            r0: r - rectHeight + 1,
            c0: rectStart,
            r1: r + 1,
            c1: c,
            area
          };
        }
        start = rectStart;
      }

      if (currentHeight > 0 && (stackLength === 0 || stackHeights[stackLength - 1] < currentHeight)) {
        stackStarts[stackLength] = start;
        stackHeights[stackLength] = currentHeight;
        stackLength += 1;
      }
    }
  }

  return best;
};

const greedyRectsForMask = (mask: Uint8Array, width: number, height: number, limit: number): Rect[] | null => {
  if (limit <= 1) return null;

  const heights = new Int32Array(width);
  const stackStarts = new Int32Array(width + 1);
  const stackHeights = new Int32Array(width + 1);
  const rects: Rect[] = [];

  while (rects.length < limit) {
    const rect = findLargestFilledRect(mask, width, height, heights, stackStarts, stackHeights);
    if (!rect || rect.area <= 0) return rects;

    rects.push({ r0: rect.r0, c0: rect.c0, r1: rect.r1, c1: rect.c1 });
    if (rects.length >= limit) return null;

    for (let r = rect.r0; r < rect.r1; r += 1) {
      const rowBase = r * width;
      for (let c = rect.c0; c < rect.c1; c += 1) mask[rowBase + c] = 0;
    }
  }

  return null;
};

const greedyRectsForRuns = (runs: Rect[], width: number, height: number, limit: number): Rect[] | null => {
  if (runs.length < 2 || limit <= 1) return null;

  let minR = height;
  let minC = width;
  let maxR = -1;
  let maxC = -1;
  let filled = 0;

  for (const run of runs) {
    if (run.r0 < minR) minR = run.r0;
    if (run.c0 < minC) minC = run.c0;
    if (run.r1 > maxR) maxR = run.r1;
    if (run.c1 > maxC) maxC = run.c1;
    filled += (run.r1 - run.r0) * (run.c1 - run.c0);
  }

  const localW = maxC - minC;
  const localH = maxR - minR;
  if (localW <= 0 || localH <= 0) return null;
  if (filled === localW * localH) {
    return limit > 1 ? [{ r0: minR, c0: minC, r1: maxR, c1: maxC }] : null;
  }

  const localMask = new Uint8Array(localW * localH);
  for (const run of runs) {
    for (let r = run.r0; r < run.r1; r += 1) {
      const rowBase = (r - minR) * localW;
      for (let c = run.c0; c < run.c1; c += 1) localMask[rowBase + c - minC] = 1;
    }
  }

  const localRects = greedyRectsForMask(localMask, localW, localH, limit);
  if (!localRects) return null;

  return localRects.map((rect) => ({
    r0: rect.r0 + minR,
    c0: rect.c0 + minC,
    r1: rect.r1 + minR,
    c1: rect.c1 + minC
  }));
};

const componentRectsForMask = (mask: Uint8Array, width: number, height: number): Rect[] => {
  const bounds = { r0: 0, c0: 0, r1: height, c1: width };
  const rowRuns = runRects(mask, width, bounds, false);
  if (rowRuns.length < 2) return rowRuns;

  const parent = new Int32Array(rowRuns.length);
  for (let i = 0; i < parent.length; i += 1) parent[i] = i;

  const find = (index: number): number => {
    let root = index;
    while (parent[root] !== root) root = parent[root];
    while (parent[index] !== index) {
      const next = parent[index];
      parent[index] = root;
      index = next;
    }
    return root;
  };

  const union = (a: number, b: number): void => {
    const rootA = find(a);
    const rootB = find(b);
    if (rootA !== rootB) parent[rootB] = rootA;
  };

  let previousStart = 0;
  let previousEnd = 0;
  let currentRow = -1;
  let currentStart = 0;

  for (let i = 0; i < rowRuns.length; i += 1) {
    const run = rowRuns[i];
    if (!run) continue;

    if (run.r0 !== currentRow) {
      if (run.r0 === currentRow + 1) {
        previousStart = currentStart;
        previousEnd = i;
      } else {
        previousStart = i;
        previousEnd = i;
      }
      currentRow = run.r0;
      currentStart = i;
    }

    for (let previousIndex = previousStart; previousIndex < previousEnd; previousIndex += 1) {
      const previous = rowRuns[previousIndex];
      if (!previous) continue;
      if (previous.c1 <= run.c0) continue;
      if (previous.c0 >= run.c1) break;
      union(i, previousIndex);
    }
  }

  const rootToGroup = new Int32Array(rowRuns.length);
  rootToGroup.fill(-1);
  const groups: number[][] = [];
  for (let i = 0; i < rowRuns.length; i += 1) {
    const root = find(i);
    let groupIndex = rootToGroup[root] ?? -1;
    if (groupIndex < 0) {
      groupIndex = groups.length;
      rootToGroup[root] = groupIndex;
      groups.push([]);
    }
    groups[groupIndex]?.push(i);
  }

  if (groups.length < 2) return rowRuns;

  const out: Rect[] = [];

  for (const group of groups) {
    let minR = height;
    let minC = width;
    let maxR = -1;
    let maxC = -1;
    let filled = 0;

    for (const index of group) {
      const run = rowRuns[index];
      if (!run) continue;
      if (run.r0 < minR) minR = run.r0;
      if (run.c0 < minC) minC = run.c0;
      if (run.r1 > maxR) maxR = run.r1;
      if (run.c1 > maxC) maxC = run.c1;
      filled += run.c1 - run.c0;
    }

    const localW = maxC - minC;
    const localH = maxR - minR;
    if (filled === localW * localH) {
      out.push({ r0: minR, c0: minC, r1: maxR, c1: maxC });
      continue;
    }

    const localMask = new Uint8Array(localW * localH);
    for (const index of group) {
      const run = rowRuns[index];
      if (!run) continue;
      const localRow = (run.r0 - minR) * localW;
      for (let c = run.c0; c < run.c1; c += 1) {
        localMask[localRow + c - minC] = 1;
      }
    }

    const localRects = pickRectsForMask(localMask, localW, localH);
    for (const rect of localRects) {
      out.push({
        r0: rect.r0 + minR,
        c0: rect.c0 + minC,
        r1: rect.r1 + minR,
        c1: rect.c1 + minC
      });
    }
  }

  return out;
};

const emitHost = (host: Rect, buffer: FaceBuffer): Brush[] => {
  const { width, ids, palette } = buffer;

  const counts = new Map<number, number>();
  const localW = host.c1 - host.c0;
  const localH = host.r1 - host.r0;

  for (let r = host.r0; r < host.r1; r += 1) {
    const rowBase = r * width;
    for (let c = host.c0; c < host.c1; c += 1) {
      const id = ids[rowBase + c];
      if (!id) continue;
      const next = (counts.get(id) ?? 0) + 1;
      counts.set(id, next);
    }
  }

  if (!counts.size) return [];
  const colorIds = Array.from(counts.keys()).sort((a, b) => a - b);
  const localMask = new Uint8Array(localW * localH);
  const colorRects: { colorId: number; rects: Rect[] }[] = [];

  let baseId = colorIds[0] ?? 0;
  let baseRectCount = -1;
  let baseCellCount = -1;

  for (const colorId of colorIds) {
    localMask.fill(0);

    for (let r = host.r0; r < host.r1; r += 1) {
      const rowBase = r * width;
      const localRow = (r - host.r0) * localW;
      for (let c = host.c0; c < host.c1; c += 1) {
        if (ids[rowBase + c] === colorId) localMask[localRow + (c - host.c0)] = 1;
      }
    }

    const rects = pickRectsForMask(localMask, localW, localH);
    colorRects.push({ colorId, rects });

    const cellCount = counts.get(colorId) ?? 0;
    if (
      rects.length > baseRectCount
      || (rects.length === baseRectCount && cellCount > baseCellCount)
      || (rects.length === baseRectCount && cellCount === baseCellCount && colorId < baseId)
    ) {
      baseId = colorId;
      baseRectCount = rects.length;
      baseCellCount = cellCount;
    }
  }

  const baseFill = palette[baseId] ?? "";
  if (!baseFill) return [];

  const out: Brush[] = [{ ...host, baseColor: baseFill }];

  for (const { colorId, rects } of colorRects) {
    if (colorId === baseId || !rects.length) continue;

    const fill = palette[colorId] ?? "";
    if (!fill) continue;

    for (const r of rects) {
      out.push({
        r0: r.r0 + host.r0,
        c0: r.c0 + host.c0,
        r1: r.r1 + host.r0,
        c1: r.c1 + host.c0,
        baseColor: fill
      });
    }
  }

  return out;
};

export const verify = (brushes: Brush[], buffer: FaceBuffer, allowMask: Uint8Array | null, paletteIds: Map<string, number>): boolean => {
  const { width, height } = buffer;
  const scratch = new Uint32Array(width * height);

  for (const brush of brushes) {
    const colorId = paletteIds.get(brush.baseColor);
    if (!colorId) return false;

    const r0 = Math.max(0, brush.r0);
    const c0 = Math.max(0, brush.c0);
    const r1 = Math.min(height, brush.r1);
    const c1 = Math.min(width, brush.c1);

    for (let r = r0; r < r1; r += 1) {
      const rowBase = r * width;
      for (let c = c0; c < c1; c += 1) scratch[rowBase + c] = colorId;
    }
  }

  const expected = buffer.ids;
  for (let i = 0; i < scratch.length; i += 1) {
    if (scratch[i] === expected[i]) continue;
    if (allowMask && !expected[i] && allowMask[i]) continue;
    return false;
  }
  return true;
};

const mergeAligned = (brushes: Brush[]): Brush[] => {
  if (brushes.length < 2) return brushes;

  const byColor = new Map<string, Brush[]>();
  for (const b of brushes) {
    const list = byColor.get(b.baseColor);
    if (list) list.push(b);
    else byColor.set(b.baseColor, [b]);
  }

  const out: Brush[] = [];
  for (const [, list] of byColor) {
    out.push(...mergeAlignedRects(list.map((b) => ({ ...b }))));
  }
  return out;
};

const rectArea = (rect: Rect): number =>
  Math.max(0, rect.r1 - rect.r0) * Math.max(0, rect.c1 - rect.c0);

const rectsOverlap = (a: Rect, b: Rect): boolean =>
  a.r0 < b.r1 && a.r1 > b.r0 && a.c0 < b.c1 && a.c1 > b.c0;

const rangesOverlap = (a0: number, a1: number, b0: number, b1: number): boolean =>
  a0 < b1 && a1 > b0;

const mergedBounds = (a: Brush, b: Brush): Brush => ({
  r0: Math.min(a.r0, b.r0),
  c0: Math.min(a.c0, b.c0),
  r1: Math.max(a.r1, b.r1),
  c1: Math.max(a.c1, b.c1),
  baseColor: a.baseColor
});

const buildLastPaintIndices = (
  brushes: Brush[],
  buffer: FaceBuffer,
  paletteIds: Map<string, number>
): { lastPaint: Int32Array; previousPaint: Int32Array; brushColorIds: Int32Array } | null => {
  const { width, height } = buffer;
  const lastPaint = new Int32Array(width * height);
  const previousPaint = new Int32Array(width * height);
  const brushColorIds = new Int32Array(brushes.length);
  lastPaint.fill(-1);
  previousPaint.fill(-1);
  for (let i = 0; i < brushes.length; i += 1) {
    const brush = brushes[i];
    const colorId = paletteIds.get(brush.baseColor);
    if (!colorId) return null;
    brushColorIds[i] = colorId;

    const r0 = Math.max(0, brush.r0);
    const c0 = Math.max(0, brush.c0);
    const r1 = Math.min(height, brush.r1);
    const c1 = Math.min(width, brush.c1);
    for (let r = r0; r < r1; r += 1) {
      const rowBase = r * width;
      for (let c = c0; c < c1; c += 1) {
        const index = rowBase + c;
        previousPaint[index] = lastPaint[index] ?? -1;
        lastPaint[index] = i;
      }
    }
  }
  return { lastPaint, previousPaint, brushColorIds };
};

const verifySpanMergeByLastPaint = (
  buffer: FaceBuffer,
  allowMask: Uint8Array | null,
  paletteIds: Map<string, number>,
  lastPaint: Int32Array,
  previousPaint: Int32Array,
  brushColorIds: Int32Array,
  firstIndex: number,
  secondIndex: number,
  replacement: Brush,
  atFirstIndex: boolean
): boolean => {
  const colorId = paletteIds.get(replacement.baseColor);
  if (!colorId) return false;

  const expected = buffer.ids;
  const paintIndex = atFirstIndex ? firstIndex : secondIndex;
  const removedIndex = atFirstIndex ? secondIndex : firstIndex;
  for (let r = replacement.r0; r < replacement.r1; r += 1) {
    const expectedRowBase = r * buffer.width;
    for (let c = replacement.c0; c < replacement.c1; c += 1) {
      const expectedIndex = expectedRowBase + c;
      if (expected[expectedIndex] === colorId) {
        if (atFirstIndex && lastPaint[expectedIndex] === removedIndex) {
          const previousIndex = previousPaint[expectedIndex] ?? -1;
          if (previousIndex > paintIndex && brushColorIds[previousIndex] !== colorId) return false;
        }
        continue;
      }
      if (allowMask && !expected[expectedIndex] && allowMask[expectedIndex]) continue;
      const lastIndex = lastPaint[expectedIndex] ?? -1;
      if (lastIndex > paintIndex && lastIndex !== removedIndex) continue;
      return false;
    }
  }
  return true;
};

const collectAdjacentSpanMergeCandidates = (brushes: Brush[]): SpanMergeCandidate[] => {
  const rowGroups = new Map<string, number[]>();
  const colGroups = new Map<string, number[]>();

  for (let i = 0; i < brushes.length; i += 1) {
    const brush = brushes[i];
    const rowKey = `${brush.baseColor}|r|${brush.r0}|${brush.r1}`;
    const colKey = `${brush.baseColor}|c|${brush.c0}|${brush.c1}`;
    const rowGroup = rowGroups.get(rowKey);
    if (rowGroup) rowGroup.push(i);
    else rowGroups.set(rowKey, [i]);
    const colGroup = colGroups.get(colKey);
    if (colGroup) colGroup.push(i);
    else colGroups.set(colKey, [i]);
  }

  const seen = new Set<string>();
  const out: SpanMergeCandidate[] = [];
  const addPair = (a: number, b: number): void => {
    const first = Math.min(a, b);
    const second = Math.max(a, b);
    if (first === second) return;
    const key = `${first}:${second}`;
    if (seen.has(key)) return;
    seen.add(key);

    const brushA = brushes[first];
    const brushB = brushes[second];
    if (!brushA || !brushB || brushA.baseColor !== brushB.baseColor) return;

    const replacement = mergedBounds(brushA, brushB);
    const extraArea = rectArea(replacement) - rectArea(brushA) - rectArea(brushB);
    if (extraArea < 0) return;
    out.push({ first, second, replacement, extraArea });
  };

  for (const group of rowGroups.values()) {
    if (group.length < 2) continue;
    group.sort((a, b) => brushes[a].c0 - brushes[b].c0 || brushes[a].c1 - brushes[b].c1);
    for (let i = 0; i < group.length - 1; i += 1) addPair(group[i], group[i + 1]);
  }

  for (const group of colGroups.values()) {
    if (group.length < 2) continue;
    group.sort((a, b) => brushes[a].r0 - brushes[b].r0 || brushes[a].r1 - brushes[b].r1);
    for (let i = 0; i < group.length - 1; i += 1) addPair(group[i], group[i + 1]);
  }

  out.sort((a, b) => a.extraArea - b.extraArea || a.first - b.first || a.second - b.second);
  return out;
};

const collectOverlappingSpanMergeCandidates = (brushes: Brush[]): SpanMergeCandidate[] => {
  const colorGroups = new Map<string, number[]>();
  for (let i = 0; i < brushes.length; i += 1) {
    const brush = brushes[i];
    const group = colorGroups.get(brush.baseColor);
    if (group) group.push(i);
    else colorGroups.set(brush.baseColor, [i]);
  }

  const out: SpanMergeCandidate[] = [];
  for (const group of colorGroups.values()) {
    if (group.length < 2) continue;
    for (let a = 0; a < group.length - 1; a += 1) {
      const first = group[a];
      const brushA = brushes[first];
      if (!brushA) continue;
      for (let b = a + 1; b < group.length; b += 1) {
        const second = group[b];
        const brushB = brushes[second];
        if (!brushB) continue;
        if (
          !rangesOverlap(brushA.r0, brushA.r1, brushB.r0, brushB.r1)
          && !rangesOverlap(brushA.c0, brushA.c1, brushB.c0, brushB.c1)
        ) {
          continue;
        }

        const replacement = mergedBounds(brushA, brushB);
        const extraArea = rectArea(replacement) - rectArea(brushA) - rectArea(brushB);
        out.push({ first, second, replacement, extraArea });
      }
    }
  }

  out.sort((a, b) => a.extraArea - b.extraArea || a.first - b.first || a.second - b.second);
  return out;
};

const applySpanMergeBatch = (
  current: Brush[],
  candidates: SpanMergeCandidate[],
  buffer: FaceBuffer,
  allowMask: Uint8Array | null,
  paletteIds: Map<string, number>
): Brush[] | null => {
  if (!candidates.length) return null;

  const paintState = buildLastPaintIndices(current, buffer, paletteIds);
  if (!paintState) return null;
  const { lastPaint, previousPaint, brushColorIds } = paintState;
  const used = new Uint8Array(current.length);
  const remove = new Uint8Array(current.length);
  const replace: (Brush | undefined)[] = [];
  let replaceCount = 0;
  const replacementBounds: Rect[] = [];

  for (const candidate of candidates) {
    const { first, second, replacement } = candidate;
    if (used[first] || used[second]) continue;
    let overlaps = false;
    for (const bounds of replacementBounds) {
      if (rectsOverlap(bounds, replacement)) {
        overlaps = true;
        break;
      }
    }
    if (overlaps) continue;

    const firstBrush = current[first];
    const secondBrush = current[second];
    if (!firstBrush || !secondBrush || firstBrush.baseColor !== secondBrush.baseColor) continue;

    if (
      verifySpanMergeByLastPaint(
        buffer,
        allowMask,
        paletteIds,
        lastPaint,
        previousPaint,
        brushColorIds,
        first,
        second,
        replacement,
        true
      )
    ) {
      used[first] = 1;
      used[second] = 1;
      replace[first] = replacement;
      replaceCount += 1;
      remove[second] = 1;
      replacementBounds.push(replacement);
      continue;
    }

    if (
      verifySpanMergeByLastPaint(
        buffer,
        allowMask,
        paletteIds,
        lastPaint,
        previousPaint,
        brushColorIds,
        first,
        second,
        replacement,
        false
      )
    ) {
      used[first] = 1;
      used[second] = 1;
      remove[first] = 1;
      replace[second] = replacement;
      replaceCount += 1;
      replacementBounds.push(replacement);
    }
  }

  if (!replaceCount) return null;

  const accepted: Brush[] = [];
  for (let i = 0; i < current.length; i += 1) {
    if (remove[i]) continue;
    accepted.push(replace[i] ?? current[i]);
  }

  return accepted;
};

const optimizeSpanOverdraw = (
  brushes: Brush[],
  buffer: FaceBuffer,
  allowMask: Uint8Array | null,
  paletteIds: Map<string, number>
): Brush[] => {
  if (brushes.length < 2) return brushes;

  let current = brushes;
  let changed = false;

  for (;;) {
    const adjacent = applySpanMergeBatch(
      current,
      collectAdjacentSpanMergeCandidates(current),
      buffer,
      allowMask,
      paletteIds
    );
    if (adjacent) {
      current = adjacent;
      changed = true;
      continue;
    }

    const overlapping = applySpanMergeBatch(
      current,
      collectOverlappingSpanMergeCandidates(current),
      buffer,
      allowMask,
      paletteIds
    );
    if (!overlapping) break;

    current = overlapping;
    changed = true;
  }

  return changed && current.length < brushes.length && verify(current, buffer, allowMask, paletteIds)
    ? current
    : brushes;
};

const canDropBrush = (
  brush: Brush,
  brushIndex: number,
  buffer: FaceBuffer,
  lastPaint: Int32Array,
  previousPaint: Int32Array,
  brushColorIds: Int32Array
): boolean => {
  const colorId = brushColorIds[brushIndex] ?? 0;
  if (!colorId) return false;

  for (let r = brush.r0; r < brush.r1; r += 1) {
    const rowBase = r * buffer.width;
    for (let c = brush.c0; c < brush.c1; c += 1) {
      const index = rowBase + c;
      if (lastPaint[index] !== brushIndex) continue;

      const previousIndex = previousPaint[index] ?? -1;
      if (previousIndex < 0 || brushColorIds[previousIndex] !== colorId) return false;
    }
  }

  return true;
};

const dropRedundantBrushes = (
  brushes: Brush[],
  buffer: FaceBuffer,
  allowMask: Uint8Array | null,
  paletteIds: Map<string, number>
): Brush[] => {
  if (brushes.length < 2) return brushes;

  let current = brushes;
  let changed = false;

  for (;;) {
    const paintState = buildLastPaintIndices(current, buffer, paletteIds);
    if (!paintState) break;

    const { lastPaint, previousPaint, brushColorIds } = paintState;
    let removedIndex = -1;
    for (let i = 0; i < current.length; i += 1) {
      const brush = current[i];
      if (!brush) continue;
      if (canDropBrush(brush, i, buffer, lastPaint, previousPaint, brushColorIds)) {
        removedIndex = i;
        break;
      }
    }

    if (removedIndex < 0) break;

    const next: Brush[] = [];
    for (let i = 0; i < current.length; i += 1) {
      if (i !== removedIndex) next.push(current[i]);
    }
    current = next;
    changed = true;
  }

  return changed && current.length < brushes.length && verify(current, buffer, allowMask, paletteIds)
    ? current
    : brushes;
};

const collectColorIds = (buffer: FaceBuffer): number[] => {
  const seen = new Set<number>();
  for (const id of buffer.ids) {
    if (id) seen.add(id);
  }
  return Array.from(seen).sort((a, b) => a - b);
};

type ReverseRunRect = Rect & {
  colorId: number;
  gain: number;
  area: number;
};

const findBestReverseRunRect = (
  buffer: FaceBuffer,
  safe: Uint8Array,
  colors: readonly number[],
  allowMask: Uint8Array | null
): ReverseRunRect | null => {
  const { width, height, ids } = buffer;
  let best: ReverseRunRect | null = null;

  const canCover = (index: number, colorId: number): boolean =>
    !!safe[index] || ids[index] === colorId || (!!allowMask && !ids[index] && !!allowMask[index]);

  const consider = (colorId: number, r0: number, c0: number, r1: number, c1: number): void => {
    let gain = 0;
    for (let r = r0; r < r1; r += 1) {
      const rowBase = r * width;
      for (let c = c0; c < c1; c += 1) {
        const index = rowBase + c;
        const id = ids[index];
        if (!canCover(index, colorId)) return;
        if (!safe[index] && id === colorId) gain += 1;
      }
    }
    if (!gain) return;
    const area = (r1 - r0) * (c1 - c0);
    if (!best || gain > best.gain || (gain === best.gain && area > best.area)) {
      best = { colorId, r0, c0, r1, c1, gain, area };
    }
  };

  for (const colorId of colors) {
    for (let r = 0; r < height; r += 1) {
      const rowBase = r * width;
      let c = 0;
      while (c < width) {
        while (c < width && (safe[rowBase + c] || ids[rowBase + c] !== colorId)) c += 1;
        const start = c;
        while (c < width && !safe[rowBase + c] && ids[rowBase + c] === colorId) c += 1;
        if (start === c) continue;

        let r0 = r;
        growUp:
        while (r0 > 0) {
          const nextRow = (r0 - 1) * width;
          for (let x = start; x < c; x += 1) {
            const index = nextRow + x;
            if (!canCover(index, colorId)) break growUp;
          }
          r0 -= 1;
        }

        let r1 = r + 1;
        growDown:
        while (r1 < height) {
          const nextRow = r1 * width;
          for (let x = start; x < c; x += 1) {
            const index = nextRow + x;
            if (!canCover(index, colorId)) break growDown;
          }
          r1 += 1;
        }

        consider(colorId, r0, start, r1, c);
      }
    }

    for (let c = 0; c < width; c += 1) {
      let r = 0;
      while (r < height) {
        while (r < height && (safe[r * width + c] || ids[r * width + c] !== colorId)) r += 1;
        const start = r;
        while (r < height && !safe[r * width + c] && ids[r * width + c] === colorId) r += 1;
        if (start === r) continue;

        let c0 = c;
        growLeft:
        while (c0 > 0) {
          for (let y = start; y < r; y += 1) {
            const index = y * width + c0 - 1;
            if (!canCover(index, colorId)) break growLeft;
          }
          c0 -= 1;
        }

        let c1 = c + 1;
        growRight:
        while (c1 < width) {
          for (let y = start; y < r; y += 1) {
            const index = y * width + c1;
            if (!canCover(index, colorId)) break growRight;
          }
          c1 += 1;
        }

        consider(colorId, start, c0, r, c1);
      }
    }
  }

  return best;
};

const evaluateReverseRunVariant = (
  buffer: FaceBuffer,
  paletteIds: Map<string, number>,
  limit: number,
  allowMask: Uint8Array | null = null
): Brush[] | null => {
  const colorCount = buffer.palette.length - 1;
  const area = buffer.width * buffer.height;
  let maxColors = allowMask ? 4 : 3;
  if (allowMask) {
    if (limit < 20 || limit > 64 || colorCount < 2 || colorCount > 4) return null;
  } else {
    const compactMultiColor = limit >= 45
      && limit <= 64
      && colorCount >= 4
      && colorCount <= 5
      && buffer.filledCount <= 650
      && area <= 1200;
    if (compactMultiColor) maxColors = 5;
    else if (limit < 150 || colorCount < 2 || colorCount > 3) return null;
  }

  const colors = collectColorIds(buffer);
  if (colors.length < 2 || colors.length > maxColors) return null;

  const safe = new Uint8Array(buffer.ids.length);
  let remaining = buffer.filledCount;
  const reverse: Brush[] = [];

  while (remaining > 0) {
    if (reverse.length >= limit - 1) return null;

    const rect = findBestReverseRunRect(buffer, safe, colors, allowMask);
    if (!rect) return null;

    const fill = buffer.palette[rect.colorId] ?? "";
    if (!fill) return null;
    reverse.push({ r0: rect.r0, c0: rect.c0, r1: rect.r1, c1: rect.c1, baseColor: fill });

    for (let r = rect.r0; r < rect.r1; r += 1) {
      const rowBase = r * buffer.width;
      for (let c = rect.c0; c < rect.c1; c += 1) {
        const index = rowBase + c;
        if (!safe[index] && buffer.ids[index] === rect.colorId) {
          safe[index] = 1;
          remaining -= 1;
        }
      }
    }
  }

  if (reverse.length >= limit) return null;

  const brushes = reverse.reverse();
  return verify(brushes, buffer, allowMask, paletteIds) ? brushes : null;
};

const evaluateSingleColorGreedyVariant = (
  buffer: FaceBuffer,
  holeFill: HoleFill,
  paletteIds: Map<string, number>,
  limit: number
): Brush[] | null => {
  if (buffer.palette.length !== 2 || limit <= 2 || limit > 32) return null;

  const fill = buffer.palette[1] ?? "";
  if (!fill) return null;

  const rects = greedyRectsForMask(holeFill.mask.slice(), buffer.width, buffer.height, limit);
  if (!rects || rects.length >= limit) return null;

  const brushes = rects.map((rect) => ({ ...rect, baseColor: fill }));
  return verify(brushes, buffer, holeFill.allowMask, paletteIds) ? brushes : null;
};

type SetCoverRect = Rect & {
  bits: bigint;
  count: number;
  area: number;
};

const SINGLE_COLOR_SET_COVER_MAX_LIMIT = 42;
const SINGLE_COLOR_SET_COVER_MAX_TARGETS = 400;
const SINGLE_COLOR_SET_COVER_MAX_CANDIDATES = 5200;
const SINGLE_COLOR_SET_COVER_MIN_HOLE_FILL = 20;
const SINGLE_COLOR_SET_COVER_MAX_SOLID_AREA = 128;
const SINGLE_COLOR_SET_COVER_MAX_SOLID_TARGETS = 80;
const TWO_COLOR_SET_COVER_MAX_LIMIT = 32;
const TWO_COLOR_SET_COVER_MAX_TARGETS = 160;
const TWO_COLOR_SET_COVER_MAX_AREA = 1600;
const SINGLE_COLOR_SET_COVER_CACHE_MAX = 256;
const SINGLE_COLOR_SET_COVER_MISS: Rect[] = [];
const singleColorSetCoverCache = new Map<string, Rect[]>();

const bitCountBigInt = (rawBits: bigint): number => {
  let bits = rawBits;
  let count = 0;
  while (bits) {
    bits &= bits - 1n;
    count += 1;
  }
  return count;
};

const generateSetCoverRects = (
  mask: Uint8Array,
  width: number,
  height: number,
  targetBitsByCell: bigint[]
): SetCoverRect[] | null => {
  const rectsByBits = new Map<bigint, SetCoverRect>();
  const columnAllowed = new Uint8Array(width);
  const columnBits: bigint[] = new Array<bigint>(width).fill(0n);

  const addRect = (bits: bigint, r0: number, c0: number, r1: number, c1: number): boolean => {
    if (!bits) return true;

    const area = (r1 - r0) * (c1 - c0);
    const existing = rectsByBits.get(bits);
    if (
      !existing
      || area < existing.area
      || (area === existing.area && (r1 - r0) > (existing.r1 - existing.r0))
    ) {
      rectsByBits.set(bits, {
        r0,
        c0,
        r1,
        c1,
        bits,
        count: bitCountBigInt(bits),
        area
      });
      if (rectsByBits.size > SINGLE_COLOR_SET_COVER_MAX_CANDIDATES) return false;
    }

    return true;
  };

  for (let r0 = 0; r0 < height; r0 += 1) {
    columnAllowed.fill(1);
    columnBits.fill(0n);

    for (let r1 = r0; r1 < height; r1 += 1) {
      const rowBase = r1 * width;
      for (let c = 0; c < width; c += 1) {
        if (!columnAllowed[c]) continue;
        const index = rowBase + c;
        if (!mask[index]) {
          columnAllowed[c] = 0;
          columnBits[c] = 0n;
          continue;
        }
        columnBits[c] |= targetBitsByCell[index] ?? 0n;
      }

      let c0 = 0;
      while (c0 < width) {
        while (c0 < width && !columnAllowed[c0]) c0 += 1;
        if (c0 >= width) break;

        let bits = 0n;
        let c1 = c0;
        while (c1 < width && columnAllowed[c1]) {
          bits |= columnBits[c1] ?? 0n;
          c1 += 1;
          if (!addRect(bits, r0, c0, r1 + 1, c1)) return null;
        }

        c0 = c1 + 1;
      }
    }
  }

  const rects = Array.from(rectsByBits.values());
  rects.sort((a, b) => b.count - a.count || a.area - b.area || a.r0 - b.r0 || a.c0 - b.c0);
  return rects;
};

const greedySetCoverRects = (
  mask: Uint8Array,
  width: number,
  height: number,
  targetBitsByCell: bigint[],
  fullBits: bigint,
  limit: number
): Rect[] | null => {
  const rects = generateSetCoverRects(mask, width, height, targetBitsByCell);
  if (!rects || !rects.length) return null;

  const greedySolution: number[] = [];
  let greedyUncovered = fullBits;
  while (greedyUncovered && greedySolution.length < limit) {
    let bestRectIndex = -1;
    let bestGain = 0;

    for (let rectIndex = 0; rectIndex < rects.length; rectIndex += 1) {
      const rect = rects[rectIndex];
      if (!rect) continue;
      if (rect.count <= bestGain) break;
      const gain = bitCountBigInt(rect.bits & greedyUncovered);
      if (gain > bestGain) {
        bestGain = gain;
        bestRectIndex = rectIndex;
      }
    }

    if (bestRectIndex < 0 || !bestGain) break;
    greedySolution.push(bestRectIndex);
    greedyUncovered &= ~(rects[bestRectIndex]?.bits ?? 0n);
  }

  if (greedyUncovered || greedySolution.length >= limit) return null;

  return greedySolution.map((rectIndex) => {
    const rect = rects[rectIndex] as SetCoverRect;
    return { r0: rect.r0, c0: rect.c0, r1: rect.r1, c1: rect.c1 };
  });
};

const appendMaskRuns = (parts: string[], mask: Uint8Array): void => {
  if (!mask.length) {
    parts.push("e");
    return;
  }

  let current = mask[0] ? 1 : 0;
  let count = 1;
  for (let i = 1; i < mask.length; i += 1) {
    const next = mask[i] ? 1 : 0;
    if (next === current) {
      count += 1;
      continue;
    }
    parts.push(current ? "1" : "0", count.toString(36), ",");
    current = next;
    count = 1;
  }
  parts.push(current ? "1" : "0", count.toString(36));
};

const singleColorSetCoverCacheKey = (buffer: FaceBuffer, holeFill: HoleFill, limit: number): string => {
  const parts = [buffer.width.toString(36), "x", buffer.height.toString(36), ":", limit.toString(36), ":"];
  appendMaskRuns(parts, buffer.mask);
  parts.push(":");
  appendMaskRuns(parts, holeFill.mask);
  return parts.join("");
};

const rememberSingleColorSetCover = (key: string, rects: Rect[] | null): void => {
  if (singleColorSetCoverCache.size >= SINGLE_COLOR_SET_COVER_CACHE_MAX) singleColorSetCoverCache.clear();
  singleColorSetCoverCache.set(key, rects ?? SINGLE_COLOR_SET_COVER_MISS);
};

const evaluateSingleColorSetCoverVariant = (
  buffer: FaceBuffer,
  holeFill: HoleFill,
  paletteIds: Map<string, number>,
  limit: number
): Brush[] | null => {
  if (buffer.palette.length !== 2 || limit <= 2 || limit > SINGLE_COLOR_SET_COVER_MAX_LIMIT) return null;
  if (buffer.filledCount > SINGLE_COLOR_SET_COVER_MAX_TARGETS) return null;

  if (holeFill.allowMask) {
    if (holeFill.filledCount - buffer.filledCount < SINGLE_COLOR_SET_COVER_MIN_HOLE_FILL) return null;
  } else if (
    buffer.width * buffer.height > SINGLE_COLOR_SET_COVER_MAX_SOLID_AREA
    || buffer.filledCount > SINGLE_COLOR_SET_COVER_MAX_SOLID_TARGETS
  ) {
    return null;
  }

  const fill = buffer.palette[1] ?? "";
  if (!fill) return null;

  const cacheKey = singleColorSetCoverCacheKey(buffer, holeFill, limit);
  const cachedRects = singleColorSetCoverCache.get(cacheKey);
  if (cachedRects) {
    if (cachedRects === SINGLE_COLOR_SET_COVER_MISS) return null;
    const brushes = cachedRects.map((rect) => ({ ...rect, baseColor: fill }));
    return verify(brushes, buffer, holeFill.allowMask, paletteIds) ? brushes : null;
  }

  const targetBitsByCell = new Array<bigint>(buffer.ids.length).fill(0n);
  let targetCount = 0;
  let fullBits = 0n;

  for (let i = 0; i < buffer.ids.length; i += 1) {
    if (buffer.ids[i] !== 1) continue;
    const bit = 1n << BigInt(targetCount);
    targetBitsByCell[i] = bit;
    targetCount += 1;
    fullBits |= bit;
  }

  if (!fullBits || targetCount > SINGLE_COLOR_SET_COVER_MAX_TARGETS) {
    rememberSingleColorSetCover(cacheKey, null);
    return null;
  }

  const rects = greedySetCoverRects(
    holeFill.mask,
    buffer.width,
    buffer.height,
    targetBitsByCell,
    fullBits,
    limit
  );
  rememberSingleColorSetCover(cacheKey, rects);
  if (!rects) return null;

  const brushes = rects.map((rect) => ({ ...rect, baseColor: fill }));

  return verify(brushes, buffer, holeFill.allowMask, paletteIds) ? brushes : null;
};

const evaluateTwoColorSetCoverVariant = (
  buffer: FaceBuffer,
  holeFill: HoleFill,
  paletteIds: Map<string, number>,
  limit: number
): Brush[] | null => {
  if (limit <= 2 || limit > TWO_COLOR_SET_COVER_MAX_LIMIT) return null;
  if (buffer.filledCount > TWO_COLOR_SET_COVER_MAX_TARGETS) return null;

  const area = buffer.width * buffer.height;
  if (area > TWO_COLOR_SET_COVER_MAX_AREA) return null;

  const shortSide = Math.max(1, Math.min(buffer.width, buffer.height));
  const longSide = Math.max(buffer.width, buffer.height);
  if (holeFill.allowMask) {
    if (area > 800) return null;
    if (area > 64 && (area < 700 || buffer.filledCount < 140)) return null;
  } else if (
    area > 64
    && (limit < 20 || buffer.filledCount < 100 || longSide < shortSide * 4)
  ) {
    return null;
  }

  const colors = collectColorIds(buffer);
  if (colors.length !== 2) return null;

  let best: Brush[] | null = null;
  const orders = [colors, [colors[1] ?? 0, colors[0] ?? 0]];

  for (const order of orders) {
    const brushes: Brush[] = [];
    for (let orderIndex = 0; orderIndex < order.length; orderIndex += 1) {
      const paintColorId = order[orderIndex] ?? 0;
      const futureBrushMinimum = order.length - orderIndex - 1;
      const remainingLimit = limit - brushes.length - futureBrushMinimum;
      if (remainingLimit <= 1) break;

      const active = new Set(order.slice(orderIndex));
      const mask = holeFill.allowMask ? holeFill.allowMask.slice() : new Uint8Array(buffer.ids.length);
      const targetBitsByCell = new Array<bigint>(buffer.ids.length).fill(0n);
      let fullBits = 0n;
      let targetCount = 0;

      for (let i = 0; i < buffer.ids.length; i += 1) {
        const id = buffer.ids[i];
        if (!active.has(id)) continue;
        mask[i] = 1;
        const bit = 1n << BigInt(targetCount);
        targetBitsByCell[i] = bit;
        targetCount += 1;
        fullBits |= bit;
      }

      if (!fullBits || targetCount > TWO_COLOR_SET_COVER_MAX_TARGETS) {
        brushes.length = limit;
        break;
      }

      const rects = greedySetCoverRects(
        mask,
        buffer.width,
        buffer.height,
        targetBitsByCell,
        fullBits,
        remainingLimit
      );
      if (!rects) {
        brushes.length = limit;
        break;
      }

      const fill = buffer.palette[paintColorId] ?? "";
      if (!fill) {
        brushes.length = limit;
        break;
      }
      for (const rect of rects) brushes.push({ ...rect, baseColor: fill });
      if (brushes.length >= limit) break;
    }

    if (brushes.length < limit && verify(brushes, buffer, holeFill.allowMask, paletteIds)) {
      if (!best || brushes.length < best.length) best = brushes;
    }
  }

  return best;
};

const withoutColor = (colors: readonly number[], colorId: number): number[] => {
  const out: number[] = [];
  for (const id of colors) {
    if (id !== colorId) out.push(id);
  }
  return out;
};

const buildOrderedMask = (buffer: FaceBuffer, colors: readonly number[], allowMask: Uint8Array | null): Uint8Array => {
  const active = new Set(colors);
  const mask = allowMask ? allowMask.slice() : new Uint8Array(buffer.ids.length);
  const ids = buffer.ids;
  for (let i = 0; i < ids.length; i += 1) {
    if (active.has(ids[i])) mask[i] = 1;
  }
  return mask;
};

const allowMaskCanBridgeColorRuns = (buffer: FaceBuffer, allowMask: Uint8Array): boolean => {
  const { width, height, ids } = buffer;

  for (let r = 0; r < height; r += 1) {
    const rowBase = r * width;
    let c = 0;
    while (c < width) {
      while (c < width && !allowMask[rowBase + c]) c += 1;
      const start = c;
      while (c < width && allowMask[rowBase + c]) c += 1;
      if (start === c) continue;

      const left = start > 0 ? ids[rowBase + start - 1] : 0;
      const right = c < width ? ids[rowBase + c] : 0;
      if (left && left === right) return true;
    }
  }

  for (let c = 0; c < width; c += 1) {
    let r = 0;
    while (r < height) {
      while (r < height && !allowMask[r * width + c]) r += 1;
      const start = r;
      while (r < height && allowMask[r * width + c]) r += 1;
      if (start === r) continue;

      const above = start > 0 ? ids[(start - 1) * width + c] : 0;
      const below = r < height ? ids[r * width + c] : 0;
      if (above && above === below) return true;
    }
  }

  return false;
};

const orderedRectsForColors = (
  buffer: FaceBuffer,
  colors: readonly number[],
  allowMask: Uint8Array | null,
  cache: Map<string, Rect[]>
): Rect[] => {
  const key = colors.join(",");
  const cached = cache.get(key);
  if (cached) return cached;

  const mask = buildOrderedMask(buffer, colors, allowMask);
  const rects = pickRectsForMask(mask, buffer.width, buffer.height);
  cache.set(key, rects);
  return rects;
};

const evaluateDenseOrderedVariant = (
  buffer: FaceBuffer,
  holeFill: HoleFill,
  paletteIds: Map<string, number>,
  limit: number
): Brush[] | null => {
  const colorCount = buffer.palette.length - 1;
  if (colorCount < 3 || limit <= 1) return null;

  const area = holeFill.mask.length;
  if (holeFill.filledCount * (colorCount + 2) < area * colorCount) return null;

  const currentRects = pickRectsForMask(holeFill.mask, buffer.width, buffer.height);
  if (currentRects.length + colorCount - 1 >= limit) return null;

  const colors = collectColorIds(buffer);
  const cache = new Map<string, Rect[]>();
  cache.set(colors.join(","), currentRects);
  const remaining = colors.slice();
  const brushes: Brush[] = [];

  while (remaining.length) {
    const currentRects = orderedRectsForColors(buffer, remaining, holeFill.allowMask, cache);
    const minimumFutureBrushes = remaining.length - 1;
    if (brushes.length + currentRects.length + minimumFutureBrushes >= limit) return null;

    let chosen = remaining[0] ?? 0;
    let bestNextCount = Number.MAX_SAFE_INTEGER;
    let bestExactCount = -1;

    for (const colorId of remaining) {
      const next = withoutColor(remaining, colorId);
      const nextCount = next.length ? orderedRectsForColors(buffer, next, holeFill.allowMask, cache).length : 0;
      const exactCount = orderedRectsForColors(buffer, [colorId], holeFill.allowMask, cache).length;
      if (
        nextCount < bestNextCount
        || (nextCount === bestNextCount && exactCount > bestExactCount)
        || (nextCount === bestNextCount && exactCount === bestExactCount && colorId < chosen)
      ) {
        chosen = colorId;
        bestNextCount = nextCount;
        bestExactCount = exactCount;
      }
    }

    if (brushes.length + currentRects.length + bestNextCount + Math.max(0, remaining.length - 2) >= limit) return null;

    const fill = buffer.palette[chosen] ?? "";
    if (!fill) return null;
    for (const rect of currentRects) brushes.push({ ...rect, baseColor: fill });

    const nextRemaining = withoutColor(remaining, chosen);
    remaining.length = 0;
    remaining.push(...nextRemaining);
  }

  return brushes.length < limit && verify(brushes, buffer, holeFill.allowMask, paletteIds) ? brushes : null;
};

const evaluateExactColorVariant = (
  buffer: FaceBuffer,
  paletteIds: Map<string, number>,
  limit: number,
  allowMask: Uint8Array | null = null
): Brush[] | null => {
  const colorCount = buffer.palette.length - 1;
  if (colorCount < (allowMask ? 1 : 2) || colorCount >= limit) return null;

  const { width, height, ids, palette } = buffer;
  const rowRectsByColor: Rect[][] = [];
  const colRectsByColor: Rect[][] = [];
  const rowRuns: Rect[] = [];
  const rowRunColorIds: number[] = [];
  const parent: number[] = [];
  const brushes: Brush[] = [];
  const componentCountsByColor: number[] = [];
  let componentCount = 0;

  const find = (index: number): number => {
    let root = index;
    while (parent[root] !== root) root = parent[root] ?? root;
    while (parent[index] !== index) {
      const next = parent[index] ?? index;
      parent[index] = root;
      index = next;
    }
    return root;
  };

  const union = (a: number, b: number): void => {
    const rootA = find(a);
    const rootB = find(b);
    if (rootA !== rootB) {
      parent[rootB] = rootA;
      componentCount -= 1;
      const colorId = rowRunColorIds[rootA] ?? rowRunColorIds[rootB] ?? 0;
      componentCountsByColor[colorId] = Math.max(0, (componentCountsByColor[colorId] ?? 1) - 1);
    }
  };

  let previousStart = 0;
  let previousEnd = 0;
  let currentRow = -1;
  let currentStart = 0;

  for (let r = 0; r < height; r += 1) {
    const rowBase = r * width;
    let c = 0;
    while (c < width) {
      const colorId = ids[rowBase + c];
      if (!colorId) {
        c += 1;
        continue;
      }

      const c0 = c;
      c += 1;
      while (c < width && (ids[rowBase + c] === colorId || (allowMask && allowMask[rowBase + c]))) c += 1;
      const rect = { r0: r, c0, r1: r + 1, c1: c };
      const runIndex = rowRuns.length;
      rowRuns.push(rect);
      rowRunColorIds.push(colorId);
      parent.push(runIndex);
      componentCount += 1;
      componentCountsByColor[colorId] = (componentCountsByColor[colorId] ?? 0) + 1;
      const rowRects = rowRectsByColor[colorId];
      if (rowRects) rowRects.push(rect);
      else rowRectsByColor[colorId] = [rect];

      if (r !== currentRow) {
        if (r === currentRow + 1) {
          previousStart = currentStart;
          previousEnd = runIndex;
        } else {
          previousStart = runIndex;
          previousEnd = runIndex;
        }
        currentRow = r;
        currentStart = runIndex;
      }

      for (let previousIndex = previousStart; previousIndex < previousEnd; previousIndex += 1) {
        const previous = rowRuns[previousIndex];
        if (!previous) continue;
        if (previous.c1 <= c0) continue;
        if (previous.c0 >= c) break;
        if (rowRunColorIds[previousIndex] === colorId) union(runIndex, previousIndex);
      }
    }
  }

  if (componentCount >= limit) return null;

  for (let c = 0; c < width; c += 1) {
    let r = 0;
    while (r < height) {
      const colorId = ids[r * width + c];
      if (!colorId) {
        r += 1;
        continue;
      }

      const r0 = r;
      r += 1;
      while (r < height && (ids[r * width + c] === colorId || (allowMask && allowMask[r * width + c]))) r += 1;
      const colRects = colRectsByColor[colorId];
      const rect = { r0, c0: c, r1: r, c1: c + 1 };
      if (colRects) colRects.push(rect);
      else colRectsByColor[colorId] = [rect];
    }
  }

  const colorCandidates: {
    colorId: number;
    fill: string;
    rects: Rect[];
    rowRects: Rect[];
    componentCount: number;
  }[] = [];
  let totalRects = 0;

  for (let colorId = 1; colorId < palette.length; colorId += 1) {
    const fill = palette[colorId] ?? "";
    if (!fill) return null;

    const rowRects = mergeAlignedRects(rowRectsByColor[colorId] ?? []);
    const colRects = mergeAlignedRects(colRectsByColor[colorId] ?? []);
    if (!rowRects.length && !colRects.length) continue;

    const rects = colRects.length && colRects.length < rowRects.length ? colRects : rowRects;
    const colorComponentCount = componentCountsByColor[colorId] ?? rects.length;
    totalRects += rects.length;
    colorCandidates.push({ colorId, fill, rects, rowRects, componentCount: colorComponentCount });
  }

  if (totalRects < limit) {
    for (const candidate of colorCandidates) {
      if (candidate.rects.length <= candidate.componentCount) continue;

      const greedyRects = greedyRectsForRuns(
        candidate.rowRects,
        width,
        height,
        candidate.rects.length
      );
      if (!greedyRects || greedyRects.length >= candidate.rects.length) continue;

      totalRects += greedyRects.length - candidate.rects.length;
      candidate.rects = greedyRects;
    }
  }

  colorCandidates.sort((a, b) => {
    const savingsA = a.rects.length - a.componentCount;
    const savingsB = b.rects.length - b.componentCount;
    return savingsB - savingsA || b.rects.length - a.rects.length;
  });

  if (totalRects >= limit) return null;

  for (const candidate of colorCandidates) {
    for (const rect of candidate.rects) brushes.push({ ...rect, baseColor: candidate.fill });
  }

  return brushes.length < limit && verify(brushes, buffer, allowMask, paletteIds) ? brushes : null;
};

const evaluateVariant = (buffer: FaceBuffer, holeFill: HoleFill, paletteIds: Map<string, number>): Brush[] | null => {
  const bounds = { r0: 0, c0: 0, r1: buffer.height, c1: buffer.width };

  let best: Brush[] | null = null;
  let firstHostRectCount = -1;
  let hasHostAxisConflict = false;

  for (const byColumn of [false, true]) {
    const rects = mergeAlignedRects(runRects(holeFill.mask, buffer.width, bounds, byColumn));
    if (firstHostRectCount < 0) firstHostRectCount = rects.length;
    else if (rects.length !== firstHostRectCount) hasHostAxisConflict = true;

    const brushes: Brush[] = [];
    for (const host of rects) brushes.push(...emitHost(host, buffer));

    if (!verify(brushes, buffer, holeFill.allowMask, paletteIds)) continue;

    let bestHere = brushes;
    const aligned = mergeAligned(brushes);
    if (aligned.length < bestHere.length && verify(aligned, buffer, holeFill.allowMask, paletteIds)) bestHere = aligned;

    if (!best || bestHere.length < best.length) best = bestHere;
  }

  if (hasHostAxisConflict) {
    const componentRects = componentRectsForMask(holeFill.mask, buffer.width, buffer.height);
    if (!best || componentRects.length < best.length) {
      const componentBrushes: Brush[] = [];
      for (const host of componentRects) componentBrushes.push(...emitHost(host, buffer));

      if (verify(componentBrushes, buffer, holeFill.allowMask, paletteIds)) {
        let bestHere = componentBrushes;
        const aligned = mergeAligned(componentBrushes);
        if (aligned.length < bestHere.length && verify(aligned, buffer, holeFill.allowMask, paletteIds)) bestHere = aligned;
        if (!best || bestHere.length < best.length) best = bestHere;
      }
    }
  }

  return best;
};

export const buildSlicePlan = (faceData: FaceData, nextLayer: FaceBuffer | null): SlicePlan => {
  const buffer = faceData.buffer;
  const paletteIds = new Map<string, number>();
  for (let i = 1; i < buffer.palette.length; i += 1) paletteIds.set(buffer.palette[i], i);

  const refineBrushes = (brushes: Brush[], allowMask: Uint8Array | null): Brush[] => {
    let refined = brushes;
    const optimized = optimizeSpanOverdraw(refined, buffer, allowMask, paletteIds);
    if (optimized.length < refined.length) {
      refined = optimized;
    }

    const pruned = dropRedundantBrushes(refined, buffer, allowMask, paletteIds);
    if (pruned.length < refined.length) refined = pruned;

    return refined;
  };

  let best: Brush[] | null = null;
  let bestAllowMask: Uint8Array | null = null;

  const holeFills = holeFillVariants(buffer, nextLayer);
  for (const holeFill of holeFills) {
    const candidate = evaluateVariant(buffer, holeFill, paletteIds);
    if (candidate && (!best || candidate.length < best.length)) {
      best = candidate;
      bestAllowMask = holeFill.allowMask;
    }

    const orderedCandidate = evaluateDenseOrderedVariant(
      buffer,
      holeFill,
      paletteIds,
      best?.length ?? Number.MAX_SAFE_INTEGER
    );
    if (orderedCandidate && (!best || orderedCandidate.length < best.length)) {
      best = orderedCandidate;
      bestAllowMask = holeFill.allowMask;
    }

  }

  if (best) best = refineBrushes(best, bestAllowMask);

  let acceptedBridgedColorCandidate = false;
  for (const holeFill of holeFills) {
    if (!holeFill.allowMask) continue;
    if (!allowMaskCanBridgeColorRuns(buffer, holeFill.allowMask)) continue;
    const bridgedColorCandidate = evaluateExactColorVariant(
      buffer,
      paletteIds,
      best?.length ?? Number.MAX_SAFE_INTEGER,
      holeFill.allowMask
    );
    if (bridgedColorCandidate && (!best || bridgedColorCandidate.length < best.length)) {
      const refinedColorCandidate = refineBrushes(bridgedColorCandidate, holeFill.allowMask);
      if (!best || refinedColorCandidate.length < best.length) {
        best = refinedColorCandidate;
        bestAllowMask = holeFill.allowMask;
        acceptedBridgedColorCandidate = true;
      }
    }
  }

  if (!acceptedBridgedColorCandidate) {
    const colorCandidate = evaluateExactColorVariant(buffer, paletteIds, best?.length ?? Number.MAX_SAFE_INTEGER);
    if (colorCandidate && (!best || colorCandidate.length < best.length)) {
      const refinedColorCandidate = refineBrushes(colorCandidate, null);
      if (!best || refinedColorCandidate.length < best.length) {
        best = refinedColorCandidate;
        bestAllowMask = null;
      }
    }
  }

  if (best) {
    const reverseRunCandidate = evaluateReverseRunVariant(buffer, paletteIds, best.length);
    if (reverseRunCandidate && reverseRunCandidate.length < best.length) {
      const refinedReverseRunCandidate = refineBrushes(reverseRunCandidate, null);
      best = refinedReverseRunCandidate.length < reverseRunCandidate.length ? refinedReverseRunCandidate : reverseRunCandidate;
      bestAllowMask = null;
    }

    if (faceData.key.axis === "z" && faceData.key.face === "t") {
      for (const holeFill of holeFills) {
        if (!holeFill.allowMask) continue;
        if (holeFill.filledCount - buffer.filledCount < 20) continue;
        const reverseRunCandidate = evaluateReverseRunVariant(buffer, paletteIds, best.length, holeFill.allowMask);
        if (reverseRunCandidate && reverseRunCandidate.length < best.length) {
          const refinedReverseRunCandidate = refineBrushes(reverseRunCandidate, holeFill.allowMask);
          best = refinedReverseRunCandidate.length < reverseRunCandidate.length ? refinedReverseRunCandidate : reverseRunCandidate;
          bestAllowMask = holeFill.allowMask;
        }
      }
    }
  }

  if (best) {
    for (const holeFill of holeFills) {
      const twoColorSetCoverCandidate = evaluateTwoColorSetCoverVariant(
        buffer,
        holeFill,
        paletteIds,
        best.length
      );
      if (twoColorSetCoverCandidate && twoColorSetCoverCandidate.length < best.length) {
        best = twoColorSetCoverCandidate;
        bestAllowMask = holeFill.allowMask;
      }

      if (!holeFill.allowMask) {
        const singleColorSetCoverCandidate = evaluateSingleColorSetCoverVariant(
          buffer,
          holeFill,
          paletteIds,
          best.length
        );
        if (singleColorSetCoverCandidate && singleColorSetCoverCandidate.length < best.length) {
          best = singleColorSetCoverCandidate;
          bestAllowMask = holeFill.allowMask;
        }
      }

      if (faceData.key.axis === "z") {
        const singleColorGreedyCandidate = evaluateSingleColorGreedyVariant(
          buffer,
          holeFill,
          paletteIds,
          best.length
        );
        if (singleColorGreedyCandidate && singleColorGreedyCandidate.length < best.length) {
          best = singleColorGreedyCandidate;
          bestAllowMask = holeFill.allowMask;
        }

        if (holeFill.allowMask) {
          const singleColorSetCoverCandidate = evaluateSingleColorSetCoverVariant(
            buffer,
            holeFill,
            paletteIds,
            best.length
          );
          if (singleColorSetCoverCandidate && singleColorSetCoverCandidate.length < best.length) {
            best = singleColorSetCoverCandidate;
            bestAllowMask = holeFill.allowMask;
          }
        }
      }
    }
  }

  return { key: faceData.key, buffer, brushes: best ?? [] };
};

// ---------------------------------------------------------------------------
// Face data extraction from polycss voxel source
// ---------------------------------------------------------------------------

export const buildFaceDataFromVoxelSource = (source: PolyVoxelSource): FaceData[] => {
  const rows = Math.max(0, Math.floor(source.rows));
  const cols = Math.max(0, Math.floor(source.cols));
  const depth = Math.max(0, Math.floor(source.depth));
  if (rows <= 0 || cols <= 0 || depth <= 0 || source.cells.length === 0) return [];

  const strideXY = rows * cols;
  const occupancy = new Int32Array(strideXY * depth);
  const occupiedIndices: number[] = [];
  const cellsByIndex = new Map<number, { color: string }>();

  for (const cell of source.cells) {
    const x = Math.floor(cell.x);
    const y = Math.floor(cell.y);
    const z = Math.floor(cell.z);
    if (x < 0 || x >= rows || y < 0 || y >= cols || z < 0 || z >= depth) continue;
    const index = z * strideXY + x * cols + y;
    if (occupancy[index]) continue;
    occupancy[index] = 1;
    occupiedIndices.push(index);
    cellsByIndex.set(index, { color: cell.color || "#cccccc" });
  }

  type Builder = {
    key: FaceKey;
    minRow: number;
    minCol: number;
    maxRow: number;
    maxCol: number;
    cells: Array<{ row: number; col: number; color: string }>;
  };

  const builders = new Map<string, Builder>();
  const addCell = (
    axis: PlaneAxis,
    plane: number,
    face: PolyVoxelFace,
    color: string,
    row: number,
    col: number,
  ): void => {
    const keyStr = `${axis}:${plane}:${face}`;
    let builder = builders.get(keyStr);
    if (!builder) {
      builder = { key: { axis, plane, face }, minRow: row, minCol: col, maxRow: row, maxCol: col, cells: [] };
      builders.set(keyStr, builder);
    }
    builder.cells.push({ row, col, color });
    if (row < builder.minRow) builder.minRow = row;
    if (col < builder.minCol) builder.minCol = col;
    if (row > builder.maxRow) builder.maxRow = row;
    if (col > builder.maxCol) builder.maxCol = col;
  };

  const hasNeighbor = (x: number, y: number, z: number): boolean =>
    x >= 0 && x < rows && y >= 0 && y < cols && z >= 0 && z < depth &&
    occupancy[z * strideXY + x * cols + y] !== 0;

  for (const index of occupiedIndices) {
    const z = Math.floor(index / strideXY);
    const rem = index - z * strideXY;
    const x = Math.floor(rem / cols);
    const y = rem - x * cols;
    const color = cellsByIndex.get(index)?.color ?? "#cccccc";

    if (!hasNeighbor(x, y, z + 1)) addCell("z", z + 1, "t", color, x, y);
    if (!hasNeighbor(x, y, z - 1)) addCell("z", z, "b", color, x, y);
    if (!hasNeighbor(x, y - 1, z)) addCell("y", y, "bl", color, x, z);
    if (!hasNeighbor(x, y + 1, z)) addCell("y", y + 1, "fr", color, x, z);
    if (!hasNeighbor(x - 1, y, z)) addCell("x", x, "br", color, z, y);
    if (!hasNeighbor(x + 1, y, z)) addCell("x", x + 1, "fl", color, z, y);
  }

  const buildersList = Array.from(builders.values()).sort((a, b) =>
    AXIS_ORDER[a.key.axis] - AXIS_ORDER[b.key.axis]
    || a.key.plane - b.key.plane
    || (FACE_ORDER.get(a.key.face) ?? 0) - (FACE_ORDER.get(b.key.face) ?? 0)
  );

  const faces: FaceData[] = [];
  for (const builder of buildersList) {
    if (builder.cells.length > 1) {
      builder.cells.sort((a, b) => (a.row !== b.row ? a.row - b.row : a.col - b.col));
    }
    const width = builder.maxCol - builder.minCol + 1;
    const height = builder.maxRow - builder.minRow + 1;
    if (width <= 0 || height <= 0) continue;

    const ids = new Uint32Array(width * height);
    const palette: string[] = [""];
    const colorIndex = new Map<string, number>();
    let filledCount = 0;

    for (const cell of builder.cells) {
      const rowOffset = cell.row - builder.minRow;
      const colOffset = cell.col - builder.minCol;
      if (rowOffset < 0 || colOffset < 0 || rowOffset >= height || colOffset >= width) continue;
      const bufferIndex = rowOffset * width + colOffset;
      let colorId = colorIndex.get(cell.color);
      if (colorId === undefined) {
        colorId = palette.length;
        colorIndex.set(cell.color, colorId);
        palette.push(cell.color);
      }
      if (!ids[bufferIndex]) filledCount += 1;
      ids[bufferIndex] = colorId;
    }

    if (filledCount === 0) continue;
    const mask = new Uint8Array(ids.length);
    for (let i = 0; i < ids.length; i += 1) if (ids[i]) mask[i] = 1;

    faces.push({
      key: builder.key,
      buffer: {
        width,
        height,
        minRow: builder.minRow,
        minCol: builder.minCol,
        ids,
        mask,
        filledCount,
        palette,
      },
    });
  }

  return faces;
};
