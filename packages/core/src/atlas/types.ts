import type { Vec3, Polygon } from "../types";

export interface RGB { r: number; g: number; b: number; }
export interface RGBFactors { r: number; g: number; b: number; }

export interface UvAffine {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
}

export interface UvSampleRect {
  minU: number;
  minV: number;
  maxU: number;
  maxV: number;
}

export interface TextureTrianglePlan {
  screenPts: number[];
  uvAffine: UvAffine | null;
  uvSampleRect: UvSampleRect | null;
}

export interface TextureAtlasPlan {
  index: number;
  polygon: Polygon;
  texture?: string;
  tileSize: number;
  layerElevation: number;
  matrix: string;
  canonicalMatrix: string;
  atlasMatrix: string;
  atlasCanonicalSize?: number;
  projectiveMatrix: string | null;
  canvasW: number;
  canvasH: number;
  screenPts: number[];
  uvAffine: UvAffine | null;
  uvSampleRect: UvSampleRect | null;
  textureTriangles: TextureTrianglePlan[] | null;
  textureEdgeRepairEdges: Set<number> | null;
  textureEdgeRepair: boolean;
  /** World-space surface normal — stable across light changes, used by dynamic mode. */
  normal: Vec3;
  textureTint: RGBFactors;
  shadedColor: string;
}

export interface BorderShapeBounds {
  minX: number;
  minY: number;
  width: number;
  height: number;
}
