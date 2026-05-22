import type { PolyTextureLightingMode, Polygon } from "@layoutit/polycss-core";
import type { Vec3 } from "@layoutit/polycss-core";
import type {
  TextureAtlasPlan,
  PackedTextureAtlasEntry,
  SolidTrianglePlan,
  SolidTriangleElement,
  SolidPaintDefaults,
  TextureAtlasPage,
  CornerShapeGeometry,
  RenderTextureAtlasOptions,
  ProjectiveQuadGuardSettings,
} from "./types";
import { formatCssLength, formatMatrix3dValues, formatSolidQuadMatrix } from "@layoutit/polycss-core";
import {
  setInlineStyleProperty,
  removeInlineStyleProperty,
  applySolidPaint,
  shadePolygon,
  applyDynamicNormalVars,
} from "./paintDefaults";
import {
  formatBorderShapeElementStyle,
  formatCornerShapeElementStyle,
} from "@layoutit/polycss-core";
import { atlasCanonicalSizeForEntry } from "./packing";
import { computeProjectiveQuadMatrix, stableBasisFromPlan as stableBasisFromPlanImpl } from "./plan";
import {
  DEFAULT_LIGHT_DIR,
  DEFAULT_LIGHT_COLOR,
  DEFAULT_LIGHT_INTENSITY,
  DEFAULT_AMBIENT_COLOR,
  DEFAULT_AMBIENT_INTENSITY,
} from "@layoutit/polycss-core";

export const ELEMENT_DATA_KEYS = new WeakMap<HTMLElement, string[]>();

export function applyPolygonDataAttrs(el: HTMLElement, polygon: Polygon): void {
  const previousDataKeys = ELEMENT_DATA_KEYS.get(el);
  if (previousDataKeys) {
    for (const key of previousDataKeys) el.removeAttribute(`data-${key}`);
  }
  const nextDataKeys: string[] = [];
  if (polygon.data) {
    for (const [k, v] of Object.entries(polygon.data)) {
      el.setAttribute(`data-${k}`, String(v));
      nextDataKeys.push(k);
    }
  }
  ELEMENT_DATA_KEYS.set(el, nextDataKeys);
  (el as SolidTriangleElement).__polycssHasDataAttrs = nextDataKeys.length > 0;
}

export function hasPolygonDataAttrs(el: HTMLElement): boolean {
  return (el as SolidTriangleElement).__polycssHasDataAttrs === true;
}

export function applyAtlasBackground(
  el: HTMLElement,
  page: TextureAtlasPage,
  textureLighting: PolyTextureLightingMode,
  entry: PackedTextureAtlasEntry,
): void {
  if (!page.url) return;
  const url = `url(${page.url})`;
  const width = entry.canvasW || 1;
  const height = entry.canvasH || 1;
  const atlasCanonicalSize = atlasCanonicalSizeForEntry(entry);
  const pos = `${formatCssLength((-entry.x / width) * atlasCanonicalSize)} ${formatCssLength((-entry.y / height) * atlasCanonicalSize)}`;
  const size = `${formatCssLength((page.width / width) * atlasCanonicalSize)} ${formatCssLength((page.height / height) * atlasCanonicalSize)}`;
  if (textureLighting === "dynamic") {
    setInlineStyleProperty(el, "background-image", url);
    setInlineStyleProperty(el, "background-position", pos);
    setInlineStyleProperty(el, "background-size", size);
  } else {
    setInlineStyleProperty(el, "background", `${url} ${pos} / ${size} no-repeat`);
  }
  // Dynamic mode also masks the entire <i> by the atlas image so the
  // background-color tint only paints inside the polygon shape (W3C
  // multiply with transparent backdrop reduces to source).
  if (textureLighting === "dynamic") {
    setInlineStyleProperty(el, "mask-image", url);
    setInlineStyleProperty(el, "mask-mode", "alpha");
    setInlineStyleProperty(el, "mask-position", pos);
    setInlineStyleProperty(el, "mask-size", size);
    setInlineStyleProperty(el, "mask-repeat", "no-repeat");
    // Vendor-prefixed twins for older Safari. setProperty avoids the
    // deprecation warnings on the camelCase properties in lib.dom.
    setInlineStyleProperty(el, "-webkit-mask-image", url);
    setInlineStyleProperty(el, "-webkit-mask-position", pos);
    setInlineStyleProperty(el, "-webkit-mask-size", size);
    setInlineStyleProperty(el, "-webkit-mask-repeat", "no-repeat");
  } else {
    removeInlineStyleProperty(el, "mask-image");
    removeInlineStyleProperty(el, "mask-mode");
    removeInlineStyleProperty(el, "mask-position");
    removeInlineStyleProperty(el, "mask-size");
    removeInlineStyleProperty(el, "mask-repeat");
    removeInlineStyleProperty(el, "-webkit-mask-image");
    removeInlineStyleProperty(el, "-webkit-mask-position");
    removeInlineStyleProperty(el, "-webkit-mask-size");
    removeInlineStyleProperty(el, "-webkit-mask-repeat");
  }
}

export function updateAtlasElementWithStablePlan(
  el: HTMLElement,
  source: TextureAtlasPlan,
  polygon: Polygon,
  textureLighting: PolyTextureLightingMode,
): boolean {
  if (source.texture) {
    if (!polygon.texture || source.texture !== polygon.texture) return false;
  } else if (polygon.texture) {
    return false;
  }
  const next = stableMatrixFromPlan(source, polygon);
  if (!next) {
    el.style.visibility = "hidden";
    applyPolygonDataAttrs(el, polygon);
    return true;
  }
  el.style.visibility = "";
  setInlineStyleProperty(el, "transform", `matrix3d(${next.matrix})`);
  if (textureLighting === "dynamic") {
    setInlineStyleProperty(el, "--pnx", next.normal[0].toFixed(4));
    setInlineStyleProperty(el, "--pny", next.normal[1].toFixed(4));
    setInlineStyleProperty(el, "--pnz", next.normal[2].toFixed(4));
  }
  applyPolygonDataAttrs(el, polygon);
  return true;
}

export function clearAtlasImageStyles(el: HTMLElement): void {
  el.style.backgroundImage = "";
  el.style.backgroundPosition = "";
  el.style.backgroundSize = "";
  el.style.maskImage = "";
  el.style.maskMode = "";
  el.style.maskPosition = "";
  el.style.maskSize = "";
  el.style.maskRepeat = "";
  el.style.removeProperty("-webkit-mask-image");
  el.style.removeProperty("-webkit-mask-position");
  el.style.removeProperty("-webkit-mask-size");
  el.style.removeProperty("-webkit-mask-repeat");
}

export function shadedSolidPlanForNormal(
  source: TextureAtlasPlan,
  polygon: Polygon,
  normal: Vec3,
  textureLighting: PolyTextureLightingMode,
  options: RenderTextureAtlasOptions,
): TextureAtlasPlan {
  if (textureLighting !== "baked") return { ...source, polygon, normal };
  const directionalCfg = options.directionalLight;
  const ambientCfg = options.ambientLight;
  const lightDir = directionalCfg?.direction ?? DEFAULT_LIGHT_DIR;
  const lightColor = directionalCfg?.color ?? DEFAULT_LIGHT_COLOR;
  const lightIntensity = Math.max(0, directionalCfg?.intensity ?? DEFAULT_LIGHT_INTENSITY);
  const ambientColor = ambientCfg?.color ?? DEFAULT_AMBIENT_COLOR;
  const ambientIntensity = Math.max(0, ambientCfg?.intensity ?? DEFAULT_AMBIENT_INTENSITY);
  const lLen = Math.hypot(lightDir[0], lightDir[1], lightDir[2]) || 1;
  const lx = lightDir[0] / lLen, ly = lightDir[1] / lLen, lz = lightDir[2] / lLen;
  const directScale = lightIntensity * Math.max(0, normal[0] * lx + normal[1] * ly + normal[2] * lz);
  return {
    ...source,
    polygon,
    normal,
    shadedColor: shadePolygon(polygon.color ?? "#cccccc", directScale, lightColor, ambientColor, ambientIntensity),
  };
}

export function stableMatrixFromPlan(
  source: TextureAtlasPlan,
  polygon: Polygon,
): { matrix: string; normal: Vec3 } | null {
  const basis = stableBasisFromPlan(source, polygon);
  if (!basis) return null;
  const { normal, xAxis, yAxis, tx, ty, tz } = basis;

  return {
    normal,
    matrix: formatMatrix3dValues([
      xAxis[0] * source.canvasW / atlasCanonicalSizeForEntry(source),
      xAxis[1] * source.canvasW / atlasCanonicalSizeForEntry(source),
      xAxis[2] * source.canvasW / atlasCanonicalSizeForEntry(source),
      0,
      yAxis[0] * source.canvasH / atlasCanonicalSizeForEntry(source),
      yAxis[1] * source.canvasH / atlasCanonicalSizeForEntry(source),
      yAxis[2] * source.canvasH / atlasCanonicalSizeForEntry(source),
      0,
      normal[0], normal[1], normal[2], 0,
      tx, ty, tz, 1,
    ]),
  };
}


const stableBasisFromPlan = stableBasisFromPlanImpl;

// Stable topology can reuse the original atlas raster: keep the element's
// local 2D texture space fixed, and solve the new matrix from that space to
// the updated 3D triangle.
export function stableProjectiveMatrixFromPlan(
  source: TextureAtlasPlan,
  polygon: Polygon,
  guards: ProjectiveQuadGuardSettings,
): { matrix: string; normal: Vec3 } | null {
  if (source.screenPts.length !== 8 || polygon.vertices.length !== 4) return null;
  const basis = stableBasisFromPlan(source, polygon);
  if (!basis) return null;
  const matrix = computeProjectiveQuadMatrix(
    source.screenPts,
    basis.xAxis,
    basis.yAxis,
    basis.normal,
    basis.tx,
    basis.ty,
    basis.tz,
    guards,
  );
  return matrix ? { matrix, normal: basis.normal } : null;
}

export function createSolidElement(
  entry: TextureAtlasPlan,
  textureLighting: PolyTextureLightingMode,
  doc: Document,
  solidPaintDefaults?: SolidPaintDefaults,
): HTMLElement {
  const el = doc.createElement("b");
  el.setAttribute("style", `transform:matrix3d(${formatSolidQuadMatrix(entry)})`);
  applyPolygonDataAttrs(el, entry.polygon);
  applySolidPaint(el, entry, textureLighting, solidPaintDefaults);

  return el;
}

export function createBorderShapeSolidElement(
  entry: TextureAtlasPlan,
  textureLighting: PolyTextureLightingMode,
  doc: Document,
  solidPaintDefaults?: SolidPaintDefaults,
): HTMLElement {
  const el = doc.createElement("i");
  el.setAttribute("style", formatBorderShapeElementStyle(entry));
  applyPolygonDataAttrs(el, entry.polygon);
  applySolidPaint(el, entry, textureLighting, solidPaintDefaults);

  return el;
}

export function createCornerShapeSolidElement(
  entry: TextureAtlasPlan,
  geometry: CornerShapeGeometry,
  textureLighting: PolyTextureLightingMode,
  doc: Document,
  solidPaintDefaults?: SolidPaintDefaults,
): HTMLElement {
  const el = doc.createElement("u");
  el.setAttribute("style", formatCornerShapeElementStyle(entry, geometry));
  applyPolygonDataAttrs(el, entry.polygon);
  applySolidPaint(el, entry, textureLighting, solidPaintDefaults);
  setInlineStyleProperty(el, "background", "currentColor");

  return el;
}

export function createProjectiveSolidElement(
  entry: TextureAtlasPlan & { projectiveMatrix: string },
  textureLighting: PolyTextureLightingMode,
  doc: Document,
  solidPaintDefaults?: SolidPaintDefaults,
): HTMLElement {
  const el = doc.createElement("b");
  el.setAttribute("style", `transform:matrix3d(${entry.projectiveMatrix})`);
  applyPolygonDataAttrs(el, entry.polygon);
  applySolidPaint(el, entry, textureLighting, solidPaintDefaults);

  return el;
}

export function updateSolidElementWithStablePlan(
  el: HTMLElement,
  source: TextureAtlasPlan,
  polygon: Polygon,
  textureLighting: PolyTextureLightingMode,
  options: RenderTextureAtlasOptions,
  guards: ProjectiveQuadGuardSettings,
  solidPaintDefaults?: SolidPaintDefaults,
): boolean {
  const next = source.projectiveMatrix
    ? stableProjectiveMatrixFromPlan(source, polygon, guards)
    : stableMatrixFromPlan(source, polygon);
  if (!next) return false;
  const entry = shadedSolidPlanForNormal(source, polygon, next.normal, textureLighting, options);
  el.style.visibility = "";
  el.style.transform = `matrix3d(${next.matrix})`;
  applySolidPaint(el, entry, textureLighting, solidPaintDefaults);
  applyPolygonDataAttrs(el, entry.polygon);
  return true;
}

export function updateBorderShapeElementWithStablePlan(
  el: HTMLElement,
  entry: TextureAtlasPlan,
  textureLighting: PolyTextureLightingMode,
  solidPaintDefaults?: SolidPaintDefaults,
): void {
  el.style.visibility = "";
  el.setAttribute("style", formatBorderShapeElementStyle(entry));
  applySolidPaint(el, entry, textureLighting, solidPaintDefaults);
  applyPolygonDataAttrs(el, entry.polygon);
}

export function updateCornerShapeElementWithStablePlan(
  el: HTMLElement,
  entry: TextureAtlasPlan,
  geometry: CornerShapeGeometry,
  textureLighting: PolyTextureLightingMode,
  solidPaintDefaults?: SolidPaintDefaults,
): void {
  el.style.visibility = "";
  el.setAttribute("style", formatCornerShapeElementStyle(entry, geometry));
  applySolidPaint(el, entry, textureLighting, solidPaintDefaults);
  setInlineStyleProperty(el, "background", "currentColor");
  applyPolygonDataAttrs(el, entry.polygon);
}

export function createAtlasElement(
  entry: PackedTextureAtlasEntry,
  textureLighting: PolyTextureLightingMode,
  doc: Document,
): HTMLElement {
  const el = doc.createElement("s");
  el.setAttribute("style", `transform:matrix3d(${entry.atlasMatrix})`);
  applyPolygonDataAttrs(el, entry.polygon);
  const width = entry.canvasW || 1;
  const height = entry.canvasH || 1;
  const atlasCanonicalSize = atlasCanonicalSizeForEntry(entry);
  setInlineStyleProperty(el, "--polycss-atlas-size", `${atlasCanonicalSize}px`);
  setInlineStyleProperty(el, "background-position", `${formatCssLength((-entry.x / width) * atlasCanonicalSize)} ${formatCssLength((-entry.y / height) * atlasCanonicalSize)}`);
  setInlineStyleProperty(el, "opacity", "0");

  if (textureLighting === "dynamic") applyDynamicNormalVars(el, entry);
  return el;
}
