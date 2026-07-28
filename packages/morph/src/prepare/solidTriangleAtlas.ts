import { deflateSync } from "node:zlib";
import {
  computeTextureAtlasPlanPublic,
  packTextureAtlasPlansWithScale,
  type PackedTextureAtlasEntry,
  type Polygon,
  type TextureAtlasPlan,
} from "@layoutit/polycss";
import type {
  PolyMorphMat4,
  PolyMorphRenderFallback,
  PolyMorphVec3,
} from "../contracts/index.js";
import { failPolyMorphPrepare } from "./error.js";

const BLEED = 1.5;
const SAMPLES_PER_AXIS = 4;
const PNG_SIGNATURE = Uint8Array.from([
  137, 80, 78, 71, 13, 10, 26, 10,
]);

export interface PolyMorphTriangleAtlasInput {
  readonly vertexIndices: readonly [number, number, number];
  readonly vertices: readonly [PolyMorphVec3, PolyMorphVec3, PolyMorphVec3];
  readonly materialId: string;
  readonly leafMatrix: PolyMorphMat4;
}

export interface PolyMorphTriangleAtlasPage {
  readonly path: string;
  readonly width: number;
  readonly height: number;
  readonly bytes: Uint8Array;
}

export interface PolyMorphTriangleAtlas {
  readonly fallbacks: readonly PolyMorphRenderFallback[];
  readonly pages: readonly PolyMorphTriangleAtlasPage[];
}

function rounded(value: number): number {
  const result = Number(value.toFixed(10));
  return Object.is(result, -0) ? 0 : result;
}

function parseMatrix(value: string, path: string): PolyMorphMat4 {
  const values = value.split(",").map(Number);
  if (values.length !== 16 || values.some((part) => !Number.isFinite(part))) {
    failPolyMorphPrepare(
      "unrenderable-triangle",
      path,
      "PolyCSS produced an invalid fallback matrix",
    );
  }
  return values.map(rounded) as unknown as PolyMorphMat4;
}

function multiply(left: PolyMorphMat4, right: PolyMorphMat4): PolyMorphMat4 {
  const output = new Array<number>(16).fill(0);
  for (let column = 0; column < 4; column += 1) {
    for (let row = 0; row < 4; row += 1) {
      let sum = 0;
      for (let axis = 0; axis < 4; axis += 1) {
        sum += left[axis * 4 + row]! * right[column * 4 + axis]!;
      }
      output[column * 4 + row] = rounded(sum);
    }
  }
  return output as unknown as PolyMorphMat4;
}

function invertAffine(value: PolyMorphMat4, path: string): PolyMorphMat4 {
  const a00 = value[0], a01 = value[4], a02 = value[8];
  const a10 = value[1], a11 = value[5], a12 = value[9];
  const a20 = value[2], a21 = value[6], a22 = value[10];
  const determinant =
    a00 * (a11 * a22 - a12 * a21)
    - a01 * (a10 * a22 - a12 * a20)
    + a02 * (a10 * a21 - a11 * a20);
  if (!Number.isFinite(determinant) || Math.abs(determinant) <= 1e-12) {
    failPolyMorphPrepare(
      "unrenderable-triangle",
      path,
      "solid triangle matrix is not invertible",
    );
  }
  const inverseDeterminant = 1 / determinant;
  const r00 = (a11 * a22 - a12 * a21) * inverseDeterminant;
  const r01 = (a02 * a21 - a01 * a22) * inverseDeterminant;
  const r02 = (a01 * a12 - a02 * a11) * inverseDeterminant;
  const r10 = (a12 * a20 - a10 * a22) * inverseDeterminant;
  const r11 = (a00 * a22 - a02 * a20) * inverseDeterminant;
  const r12 = (a02 * a10 - a00 * a12) * inverseDeterminant;
  const r20 = (a10 * a21 - a11 * a20) * inverseDeterminant;
  const r21 = (a01 * a20 - a00 * a21) * inverseDeterminant;
  const r22 = (a00 * a11 - a01 * a10) * inverseDeterminant;
  const tx = value[12], ty = value[13], tz = value[14];
  return [
    rounded(r00), rounded(r10), rounded(r20), 0,
    rounded(r01), rounded(r11), rounded(r21), 0,
    rounded(r02), rounded(r12), rounded(r22), 0,
    rounded(-(r00 * tx + r01 * ty + r02 * tz)),
    rounded(-(r10 * tx + r11 * ty + r12 * tz)),
    rounded(-(r20 * tx + r21 * ty + r22 * tz)),
    1,
  ];
}

function shiftedMatrix(value: string, padding: number): string {
  if (padding === 0) return value;
  const matrix = parseMatrix(value, "$.render.fallback");
  const shifted = [...matrix] as number[];
  shifted[12] -= padding * matrix[0] + padding * matrix[4];
  shifted[13] -= padding * matrix[1] + padding * matrix[5];
  shifted[14] -= padding * matrix[2] + padding * matrix[6];
  return shifted.map(rounded).join(",");
}

function surfaceInfo(vertices: readonly PolyMorphVec3[]): {
  readonly normal: PolyMorphVec3;
  readonly plane: number;
} | null {
  const [a, b, c] = vertices;
  const ab = [b![0] - a![0], b![1] - a![1], b![2] - a![2]];
  const ac = [c![0] - a![0], c![1] - a![1], c![2] - a![2]];
  const cross = [
    ab[1]! * ac[2]! - ab[2]! * ac[1]!,
    ab[2]! * ac[0]! - ab[0]! * ac[2]!,
    ab[0]! * ac[1]! - ab[1]! * ac[0]!,
  ];
  const length = Math.hypot(...cross);
  if (length <= 1e-12) return null;
  const normal: PolyMorphVec3 = [
    cross[0]! / length,
    cross[1]! / length,
    cross[2]! / length,
  ];
  return {
    normal,
    plane: normal[0] * a![0] + normal[1] * a![1] + normal[2] * a![2],
  };
}

function buildSeamEdges(
  inputs: readonly PolyMorphTriangleAtlasInput[],
): readonly ReadonlySet<number>[] {
  const surfaces = inputs.map((input) => surfaceInfo(input.vertices));
  const owners = new Map<string, Array<{
    readonly polygonIndex: number;
    readonly edgeIndex: number;
  }>>();
  for (let polygonIndex = 0; polygonIndex < inputs.length; polygonIndex += 1) {
    const indices = inputs[polygonIndex]!.vertexIndices;
    for (let edgeIndex = 0; edgeIndex < 3; edgeIndex += 1) {
      const left = indices[edgeIndex]!;
      const right = indices[(edgeIndex + 1) % 3]!;
      const key = left < right ? `${left}:${right}` : `${right}:${left}`;
      const owner = { polygonIndex, edgeIndex };
      const rows = owners.get(key);
      if (rows) rows.push(owner);
      else owners.set(key, [owner]);
    }
  }
  const result = Array.from({ length: inputs.length }, () => new Set<number>());
  for (const rows of owners.values()) {
    for (let leftIndex = 0; leftIndex < rows.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < rows.length; rightIndex += 1) {
        const left = rows[leftIndex]!;
        const right = rows[rightIndex]!;
        const leftInput = inputs[left.polygonIndex]!;
        const rightInput = inputs[right.polygonIndex]!;
        const leftSurface = surfaces[left.polygonIndex];
        const rightSurface = surfaces[right.polygonIndex];
        if (
          leftInput.materialId !== rightInput.materialId
          || !leftSurface
          || !rightSurface
        ) {
          continue;
        }
        const dot =
          leftSurface.normal[0] * rightSurface.normal[0]
          + leftSurface.normal[1] * rightSurface.normal[1]
          + leftSurface.normal[2] * rightSurface.normal[2];
        if (
          dot < 1 - 1e-6
          || Math.abs(leftSurface.plane - rightSurface.plane) > 1e-5
        ) {
          continue;
        }
        result[left.polygonIndex]!.add(left.edgeIndex);
        result[right.polygonIndex]!.add(right.edgeIndex);
      }
    }
  }
  return result;
}

function createPlans(
  inputs: readonly PolyMorphTriangleAtlasInput[],
  seamEdges: readonly ReadonlySet<number>[],
): TextureAtlasPlan[] {
  return inputs.map((input, index) => {
    const polygon: Polygon = {
      color: "#ffffff",
      vertices: input.vertices.map(([x, y, z]) => [y, x, z]),
    };
    const plan = computeTextureAtlasPlanPublic(polygon, index, {
      tileSize: 1,
      layerElevation: 1,
      seamBleed: 0,
    });
    if (!plan) {
      failPolyMorphPrepare(
        "unrenderable-triangle",
        `$.render.leaves[${index}].fallback`,
        "PolyCSS produced no per-polygon atlas plan",
      );
    }
    const edges = seamEdges[index]!;
    const padding = edges.size > 0 ? Math.ceil(BLEED) : 0;
    return {
      ...plan,
      matrix: shiftedMatrix(plan.matrix, padding),
      canvasW: plan.canvasW + padding * 2,
      canvasH: plan.canvasH + padding * 2,
      screenPts: plan.screenPts.map((value) => value + padding),
      seamBleed: edges.size > 0 ? BLEED : undefined,
      seamBleedEdges: new Set(edges),
      seamBleedEdgeAmounts: edges.size > 0
        ? new Map([...edges].map((edge) => [edge, BLEED]))
        : undefined,
    };
  });
}

function covered(
  points: readonly number[],
  seamEdges: ReadonlySet<number>,
  x: number,
  y: number,
): boolean {
  let area = 0;
  for (let index = 0; index < points.length; index += 2) {
    const next = (index + 2) % points.length;
    area += points[index]! * points[next + 1]! - points[next]! * points[index + 1]!;
  }
  const orientation = area >= 0 ? 1 : -1;
  for (let index = 0; index < points.length; index += 2) {
    const edgeIndex = index / 2;
    const next = (index + 2) % points.length;
    const ax = points[index]!, ay = points[index + 1]!;
    const bx = points[next]!, by = points[next + 1]!;
    const dx = bx - ax, dy = by - ay;
    const length = Math.hypot(dx, dy);
    if (length <= 1e-12) return false;
    const distance = orientation * (dx * (y - ay) - dy * (x - ax)) / length;
    if (distance < -(seamEdges.has(edgeIndex) ? BLEED : 0)) return false;
  }
  return true;
}

function alphaAt(entry: PackedTextureAtlasEntry, x: number, y: number): number {
  let samples = 0;
  const seamEdges = entry.seamBleedEdges ?? new Set<number>();
  for (let sampleY = 0; sampleY < SAMPLES_PER_AXIS; sampleY += 1) {
    for (let sampleX = 0; sampleX < SAMPLES_PER_AXIS; sampleX += 1) {
      if (covered(
        entry.screenPts,
        seamEdges,
        x + (sampleX + 0.5) / SAMPLES_PER_AXIS,
        y + (sampleY + 0.5) / SAMPLES_PER_AXIS,
      )) {
        samples += 1;
      }
    }
  }
  return Math.round(samples * 255 / (SAMPLES_PER_AXIS * SAMPLES_PER_AXIS));
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = new TextEncoder().encode(type);
  const output = new Uint8Array(12 + data.byteLength);
  const view = new DataView(output.buffer);
  view.setUint32(0, data.byteLength);
  output.set(typeBytes, 4);
  output.set(data, 8);
  view.setUint32(8 + data.byteLength, crc32(output.subarray(4, 8 + data.byteLength)));
  return output;
}

function concatenate(parts: readonly Uint8Array[]): Uint8Array {
  const output = new Uint8Array(
    parts.reduce((total, part) => total + part.byteLength, 0),
  );
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.byteLength;
  }
  return output;
}

function png(
  width: number,
  height: number,
  entries: readonly PackedTextureAtlasEntry[],
): Uint8Array {
  const stride = 1 + width * 4;
  const pixels = new Uint8Array(height * stride);
  for (const entry of entries) {
    for (let y = 0; y < entry.canvasH; y += 1) {
      for (let x = 0; x < entry.canvasW; x += 1) {
        const alpha = alphaAt(entry, x, y);
        if (alpha === 0) continue;
        const pixel = (entry.y + y) * stride + 1 + (entry.x + x) * 4;
        pixels[pixel] = 255;
        pixels[pixel + 1] = 255;
        pixels[pixel + 2] = 255;
        pixels[pixel + 3] = alpha;
      }
    }
  }
  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  header[8] = 8;
  header[9] = 6;
  return concatenate([
    PNG_SIGNATURE,
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(pixels, { level: 9 })),
    chunk("IEND", new Uint8Array()),
  ]);
}

function pagePath(index: number): string {
  return `assets/solid-triangles-${String(index).padStart(3, "0")}.png`;
}

export function buildPolyMorphSolidTriangleAtlas(
  inputs: readonly PolyMorphTriangleAtlasInput[],
): PolyMorphTriangleAtlas {
  const plans = createPlans(inputs, buildSeamEdges(inputs));
  const { packed, atlasScale } = packTextureAtlasPlansWithScale(
    plans,
    1,
    null,
    "local",
  );
  if (atlasScale !== 1) {
    failPolyMorphPrepare(
      "invalid-atlas",
      "$.render.fallback",
      "per-polygon fallback atlas must retain CSS-pixel resolution",
    );
  }
  const fallbacks = inputs.map((input, index): PolyMorphRenderFallback => {
    const entry = packed.entries[index];
    if (!entry) {
      failPolyMorphPrepare(
        "invalid-atlas",
        `$.render.leaves[${index}].fallback`,
        "per-polygon fallback was not packed",
      );
    }
    const page = packed.pages[entry.pageIndex]!;
    const atlasMatrix = parseMatrix(
      entry.atlasMatrix,
      `$.render.leaves[${index}].fallback.matrix`,
    );
    return {
      width: entry.canvasW,
      height: entry.canvasH,
      matrixFromLeaf: multiply(
        invertAffine(
          input.leafMatrix,
          `$.render.leaves[${index}].matrix`,
        ),
        atlasMatrix,
      ),
      atlas: {
        resourcePath: pagePath(entry.pageIndex),
        x: entry.x,
        y: entry.y,
        width: entry.canvasW,
        height: entry.canvasH,
        pageWidth: page.width,
        pageHeight: page.height,
      },
    };
  });
  const pages = packed.pages.map((page, index): PolyMorphTriangleAtlasPage => ({
    path: pagePath(index),
    width: page.width,
    height: page.height,
    bytes: png(page.width, page.height, page.entries),
  }));
  return { fallbacks, pages };
}
