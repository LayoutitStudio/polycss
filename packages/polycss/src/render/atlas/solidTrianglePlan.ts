import type { Polygon } from "@layoutit/polycss-core";
import {
  computeSolidTrianglePlanFromCssPoints as computeSolidTrianglePlanFromCssPointsCore,
  computeSolidTrianglePlan as computeSolidTrianglePlanCore,
} from "@layoutit/polycss-core";
import type {
  SolidTrianglePlan,
  SolidTriangleComputeOptions,
} from "@layoutit/polycss-core";
import type { RenderTextureAtlasOptions } from "./types";
import { resolveSolidTrianglePrimitive } from "./strategy";

/**
 * Polycss wrapper for computeSolidTrianglePlan that pre-resolves the primitive
 * from options.doc before delegating to the pure core function.
 */
export function computeSolidTrianglePlan(
  polygon: Polygon,
  index: number,
  options: RenderTextureAtlasOptions,
  computeOptions: SolidTriangleComputeOptions = {},
): SolidTrianglePlan | null {
  const resolvedPrimitive = computeOptions.primitive != null
    ? undefined
    : (() => {
        const doc = options.doc ?? (typeof document !== "undefined" ? document : null);
        return doc ? resolveSolidTrianglePrimitive(doc, options.strategies) ?? "border" : "border";
      })();
  return computeSolidTrianglePlanCore(polygon, index, options, {
    ...computeOptions,
    resolvedPrimitive: computeOptions.resolvedPrimitive ?? resolvedPrimitive,
  });
}

/**
 * Polycss wrapper for computeSolidTrianglePlanFromCssPoints that pre-resolves
 * the primitive from options.doc before delegating to the pure core function.
 */
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
  const resolvedPrimitive = computeOptions.primitive != null
    ? undefined
    : (() => {
        const doc = options.doc ?? (typeof document !== "undefined" ? document : null);
        return doc ? resolveSolidTrianglePrimitive(doc, options.strategies) ?? "border" : "border";
      })();
  return computeSolidTrianglePlanFromCssPointsCore(
    polygon,
    index,
    options,
    { ...computeOptions, resolvedPrimitive: computeOptions.resolvedPrimitive ?? resolvedPrimitive },
    p0x, p0y, p0z,
    p1x, p1y, p1z,
    p2x, p2y, p2z,
  );
}
