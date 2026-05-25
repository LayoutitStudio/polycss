/**
 * Editor floor grid for the /builder viewport — terrain-aware.
 *
 * Flat rows/columns are emitted as one slab per visible line. Raised
 * terrain vertices split only the affected line runs, so the normal flat
 * grid stays cheap without relying on a transformed CSS background.
 */
import type { Polygon, Vec3 } from "@layoutit/polycss-core";
import { vertexKey, type TerrainVertices } from "./terrain";

export interface BuilderGridOptions {
  /** Side length of the mounted grid window in world units. Default 200. */
  size?: number;
  /** World-space center for the mounted grid window. Defaults to origin. */
  center?: [number, number];
  /** Distance between adjacent gridlines in world units. Default 10. */
  spacing?: number;
  /** Line width in world units. Default 0.16 — keeps the same grid
   *  style while reducing high-frequency shimmer at oblique angles.
   *  orbit distance. */
  thickness?: number;
  /** Color of each gridline. */
  color?: string;
  /** Heightmap. Empty map ⇒ one polygon per visible grid line. */
  vertices?: TerrainVertices;
}

/** Emit a flat slab between two vertex indices along a constant-Y row
 *  (X-direction line). Both endpoints are at z = 0 — used for flat runs. */
function flatXSlab(
  i0: number, i1: number, j: number,
  spacing: number, halfT: number, color: string,
): Polygon {
  const x0 = i0 * spacing;
  const x1 = i1 * spacing;
  const y  = j  * spacing;
  return {
    vertices: [
      [x0, y - halfT, 0],
      [x1, y - halfT, 0],
      [x1, y + halfT, 0],
      [x0, y + halfT, 0],
    ] as [Vec3, Vec3, Vec3, Vec3],
    color,
  };
}

/** Single X-direction cell segment from (i, j) to (i+1, j). The slab
 *  lies in the plane that contains the line and the perpendicular
 *  (constant-Y) thickness axis — always planar even when z0 != z1. */
function xSegment(
  i: number, j: number, z0: number, z1: number,
  spacing: number, halfT: number, color: string,
): Polygon {
  const x0 = i * spacing;
  const x1 = (i + 1) * spacing;
  const y  = j * spacing;
  return {
    vertices: [
      [x0, y - halfT, z0],
      [x1, y - halfT, z1],
      [x1, y + halfT, z1],
      [x0, y + halfT, z0],
    ] as [Vec3, Vec3, Vec3, Vec3],
    color,
  };
}

function flatYSlab(
  i: number, j0: number, j1: number,
  spacing: number, halfT: number, color: string,
): Polygon {
  const x  = i  * spacing;
  const y0 = j0 * spacing;
  const y1 = j1 * spacing;
  return {
    vertices: [
      [x - halfT, y0, 0],
      [x + halfT, y0, 0],
      [x + halfT, y1, 0],
      [x - halfT, y1, 0],
    ] as [Vec3, Vec3, Vec3, Vec3],
    color,
  };
}

function ySegment(
  i: number, j: number, z0: number, z1: number,
  spacing: number, halfT: number, color: string,
): Polygon {
  const x  = i * spacing;
  const y0 = j * spacing;
  const y1 = (j + 1) * spacing;
  return {
    vertices: [
      [x - halfT, y0, z0],
      [x + halfT, y0, z0],
      [x + halfT, y1, z1],
      [x - halfT, y1, z1],
    ] as [Vec3, Vec3, Vec3, Vec3],
    color,
  };
}

export function buildGridPolygons(options: BuilderGridOptions = {}): Polygon[] {
  const size      = options.size      ?? 200;
  const spacing   = options.spacing   ?? 10;
  const thickness = options.thickness ?? 0.16;
  const color     = options.color     ?? "#2f3a49";
  const vertices  = options.vertices  ?? new Map<string, number>();
  const center    = options.center    ?? [0, 0];

  const halfT     = thickness / 2;
  const halfCells = Math.floor(size / 2 / spacing);
  const centerI   = Math.round(center[0] / spacing);
  const centerJ   = Math.round(center[1] / spacing);
  const minI      = centerI - halfCells;
  const maxI      = centerI + halfCells;
  const minJ      = centerJ - halfCells;
  const maxJ      = centerJ + halfCells;
  const getZ = (i: number, j: number): number => vertices.get(vertexKey(i, j)) ?? 0;

  const polys: Polygon[] = [];

  // X-direction lines at each j. Walk i; collapse flat segments into
  // one slab per run, and emit elevated segments individually.
  for (let j = minJ; j <= maxJ; j++) {
    let runStart: number | null = null;
    for (let i = minI; i < maxI; i++) {
      const zL = getZ(i, j);
      const zR = getZ(i + 1, j);
      const isFlat = zL === 0 && zR === 0;
      if (isFlat) {
        if (runStart === null) runStart = i;
      } else {
        if (runStart !== null) {
          polys.push(flatXSlab(runStart, i, j, spacing, halfT, color));
          runStart = null;
        }
        polys.push(xSegment(i, j, zL, zR, spacing, halfT, color));
      }
    }
    if (runStart !== null) polys.push(flatXSlab(runStart, maxI, j, spacing, halfT, color));
  }

  // Y-direction lines at each i.
  for (let i = minI; i <= maxI; i++) {
    let runStart: number | null = null;
    for (let j = minJ; j < maxJ; j++) {
      const zL = getZ(i, j);
      const zU = getZ(i, j + 1);
      const isFlat = zL === 0 && zU === 0;
      if (isFlat) {
        if (runStart === null) runStart = j;
      } else {
        if (runStart !== null) {
          polys.push(flatYSlab(i, runStart, j, spacing, halfT, color));
          runStart = null;
        }
        polys.push(ySegment(i, j, zL, zU, spacing, halfT, color));
      }
    }
    if (runStart !== null) polys.push(flatYSlab(i, runStart, maxJ, spacing, halfT, color));
  }

  return polys;
}
