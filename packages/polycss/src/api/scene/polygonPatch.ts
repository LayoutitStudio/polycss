/**
 * Incremental polygon-update fast paths for `mesh.updatePolygon`: patch a
 * single mounted leaf's color / data attributes in place when the partial
 * update allows it, so the caller skips the full destructive re-render.
 *
 * Extracted verbatim from createPolyScene.ts.
 */
import type { RenderedPoly } from "../../render/textureAtlas";
import { applyPolygonDataAttrs } from "../../render/atlas/emit";
import {
  applyBakedSolidColor,
  applyDynamicColorVars,
} from "./lightingVars";
import type { SceneContext } from "./sceneContext";
import type { MeshEntry } from "./internalTypes";

export function renderedItemForPolygon(entry: MeshEntry, polygonIndex: number): RenderedPoly | undefined {
  const item = entry.renderedByPolygonIndex[polygonIndex];
  return item?.polygonIndex === polygonIndex ? item : undefined;
}

export function tryUpdatePolygonColorOnly(
  ctx: SceneContext,
  entry: MeshEntry,
  polygonIndex: number,
  color: string | undefined,
): boolean {
  const currentOptions = ctx.options.current;
  const polygon = entry.polygons[polygonIndex];
  if (!polygon) return false;
  const item = renderedItemForPolygon(entry, polygonIndex);
  if (!item) return false;
  const textureLighting = currentOptions.textureLighting ?? "baked";
  if (textureLighting === "dynamic") {
    applyDynamicColorVars(item.element, color);
    return true;
  }
  if (textureLighting === "baked") {
    return applyBakedSolidColor(item, polygon, currentOptions);
  }
  return false;
}

export function tryUpdatePolygonDataOnly(entry: MeshEntry, polygonIndex: number): boolean {
  const polygon = entry.polygons[polygonIndex];
  if (!polygon) return false;
  const item = renderedItemForPolygon(entry, polygonIndex);
  if (!item) return false;
  applyPolygonDataAttrs(item.element, polygon, polygonIndex);
  return true;
}

export function tryUpdatePolygonLeafOnly(
  ctx: SceneContext,
  entry: MeshEntry,
  polygonIndex: number,
  partialKeys: string[],
): boolean {
  if (partialKeys.length === 0 || !partialKeys.every((key) => key === "color" || key === "data")) {
    return false;
  }
  if (
    partialKeys.includes("color") &&
    !tryUpdatePolygonColorOnly(ctx, entry, polygonIndex, entry.polygons[polygonIndex]?.color)
  ) {
    return false;
  }
  if (partialKeys.includes("data") && !tryUpdatePolygonDataOnly(entry, polygonIndex)) {
    return false;
  }
  return true;
}
