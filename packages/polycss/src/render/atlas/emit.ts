import type {
  PolyTextureImageRendering,
  PolyTextureLeafGeometry,
  PolyTextureLightingMode,
  Polygon,
} from "@layoutit/polycss-core";
import type { Vec3 } from "@layoutit/polycss-core";
import type {
  TextureAtlasPlan,
  PackedTextureAtlasEntry,
  SolidPaintDefaults,
  TextureAtlasPage,
  CornerShapeGeometry,
  ProjectiveQuadGuardSettings,
} from "@layoutit/polycss-core";
import type {
  SolidTriangleElement,
  RenderTextureAtlasOptions,
} from "./types";
import {
  formatCssLength,
  formatMatrix3dValues,
  formatSolidQuadMatrix,
  resolvePolyTextureImageRendering,
} from "@layoutit/polycss-core";
import { shadePolygon } from "@layoutit/polycss-core";
import {
  setInlineStyleProperty,
  applySolidPaint,
  formatInitialSolidPaintStyle,
} from "./paintDefaults";
import {
  formatBorderShapeElementStyle,
  formatCornerShapeElementStyle,
} from "@layoutit/polycss-core";
import { atlasCanonicalSizeForEntry } from "@layoutit/polycss-core";
import { computeProjectiveQuadMatrix, stableBasisFromPlan as stableBasisFromPlanImpl } from "@layoutit/polycss-core";
import {
  DEFAULT_LIGHT_DIR,
  DEFAULT_LIGHT_COLOR,
  DEFAULT_LIGHT_INTENSITY,
  DEFAULT_AMBIENT_COLOR,
  DEFAULT_AMBIENT_INTENSITY,
} from "@layoutit/polycss-core";

const CORNER_SHAPE_SOLID_CLASS = "polycss-corner-shape-solid";

function atlasLeafWidthForEntry(entry: TextureAtlasPlan): number {
  return entry.atlasLeafWidth ?? atlasCanonicalSizeForEntry(entry);
}

function atlasLeafHeightForEntry(entry: TextureAtlasPlan): number {
  return entry.atlasLeafHeight ?? atlasCanonicalSizeForEntry(entry);
}

function textureImageRenderingForEntry(
  entry: TextureAtlasPlan,
  defaultImageRendering?: PolyTextureImageRendering,
): PolyTextureImageRendering {
  return resolvePolyTextureImageRendering(entry.polygon, defaultImageRendering);
}

function textureImageRenderingStyle(imageRendering: PolyTextureImageRendering): string {
  return imageRendering === "pixelated" ? ";image-rendering:pixelated" : "";
}

function applyTextureDiagnostics(
  el: HTMLElement,
  backend: "atlas" | "image",
  ready: boolean,
  imageRendering: PolyTextureImageRendering,
  leafSizing?: string,
  projection?: string,
  lighting?: string,
  leafWidth?: number,
  leafHeight?: number,
): void {
  el.setAttribute("data-polycss-leaf", "polygon");
  el.setAttribute("data-polycss-texture-backend", backend);
  el.setAttribute("data-polycss-texture-ready", ready ? "true" : "false");
  el.setAttribute("data-polycss-texture-image-rendering", imageRendering);
  if (leafSizing) el.setAttribute("data-polycss-texture-leaf-sizing", leafSizing);
  else el.removeAttribute("data-polycss-texture-leaf-sizing");
  if (projection) el.setAttribute("data-polycss-texture-projection", projection);
  else el.removeAttribute("data-polycss-texture-projection");
  if (lighting) el.setAttribute("data-polycss-texture-lighting", lighting);
  else el.removeAttribute("data-polycss-texture-lighting");
  if (typeof leafWidth === "number") el.setAttribute("data-polycss-texture-leaf-width", String(leafWidth));
  else el.removeAttribute("data-polycss-texture-leaf-width");
  if (typeof leafHeight === "number") el.setAttribute("data-polycss-texture-leaf-height", String(leafHeight));
  else el.removeAttribute("data-polycss-texture-leaf-height");
}

export const ELEMENT_DATA_KEYS = new WeakMap<HTMLElement, string[]>();
const ELEMENT_DATA_VALUES = new WeakMap<HTMLElement, Map<string, string>>();

export function applyPolygonDataAttrs(el: HTMLElement, polygon: Polygon, polygonIndex?: number): void {
  const previousDataKeys = ELEMENT_DATA_KEYS.get(el);
  const previousDataValues = ELEMENT_DATA_VALUES.get(el);
  const hasIndex = typeof polygonIndex === "number";
  if (!polygon.data && !hasIndex && (!previousDataKeys || previousDataKeys.length === 0)) {
    (el as SolidTriangleElement).__polycssHasDataAttrs = false;
    return;
  }
  const nextDataValues = new Map<string, string>();
  if (polygon.data) {
    for (const [k, v] of Object.entries(polygon.data)) {
      nextDataValues.set(k, String(v));
    }
  }
  if (polygon.doubleSided === true) nextDataValues.set("polycss-double-sided", "true");
  // Debug pinpointing: emit the polygon's index in the source mesh so
  // devtools inspection can ref back to mesh.polygons[N]. Always-on
  // because the cost is minimal (one short attribute per leaf, set once)
  // and the convenience during shadow/lighting debugging is significant.
  if (hasIndex) nextDataValues.set("poly-index", String(polygonIndex));
  if (previousDataKeys) {
    for (const key of previousDataKeys) {
      if (!nextDataValues.has(key)) el.removeAttribute(`data-${key}`);
    }
  }
  for (const [key, value] of nextDataValues) {
    if (previousDataValues?.get(key) !== value) {
      el.setAttribute(`data-${key}`, value);
    }
  }
  const nextDataKeys = Array.from(nextDataValues.keys());
  if (nextDataKeys.length > 0) ELEMENT_DATA_KEYS.set(el, nextDataKeys);
  else ELEMENT_DATA_KEYS.delete(el);
  if (nextDataValues.size > 0) ELEMENT_DATA_VALUES.set(el, nextDataValues);
  else ELEMENT_DATA_VALUES.delete(el);
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
  preserveDynamicNormalVars = textureLighting === "dynamic",
  defaultImageRendering?: PolyTextureImageRendering,
): void {
  if (!page.url) return;
  const imageRendering = textureImageRenderingForEntry(entry, defaultImageRendering);
  const url = `url(${page.url})`;
  const width = entry.canvasW || 1;
  const height = entry.canvasH || 1;
  const atlasCanonicalSize = atlasCanonicalSizeForEntry(entry);
  const atlasLeafWidth = atlasLeafWidthForEntry(entry);
  const atlasLeafHeight = atlasLeafHeightForEntry(entry);
  const pos = `${formatCssLength((-entry.x / width) * atlasLeafWidth)} ${formatCssLength((-entry.y / height) * atlasLeafHeight)}`;
  const size = `${formatCssLength((page.width / width) * atlasLeafWidth)} ${formatCssLength((page.height / height) * atlasLeafHeight)}`;
  const atlasBaseStyle =
    `transform:matrix3d(${entry.atlasMatrix})` +
    `;--polycss-atlas-size:${atlasCanonicalSize}px` +
    `;--polycss-atlas-width:${formatCssLength(atlasLeafWidth)}` +
    `;--polycss-atlas-height:${formatCssLength(atlasLeafHeight)}` +
    `;--polycss-atlas-leaf-sizing:${entry.atlasLeafSizing ?? "canonical"}`;
  const dynamicBaseStyle =
    `${atlasBaseStyle}` +
    `;--polycss-atlas-position:${pos}` +
    `;--polycss-atlas-image-size:${size}`;
  if (textureLighting === "dynamic") {
    const normalStyle = preserveDynamicNormalVars
      ? `;--pnx:${entry.normal[0].toFixed(4)}` +
        `;--pny:${entry.normal[1].toFixed(4)}` +
        `;--pnz:${entry.normal[2].toFixed(4)}`
      : "";
    // Dynamic mode masks the atlas image so the background-color tint only
    // paints inside the polygon shape.
    el.setAttribute(
      "style",
      dynamicBaseStyle +
        `;--polycss-atlas-url:${url}` +
        normalStyle +
        textureImageRenderingStyle(imageRendering),
    );
  } else {
    // Use individual `background-image / -position / -size / -repeat`
    // properties rather than the `background:` shorthand. The shorthand
    // resets `background-color` to its initial value (transparent), which
    // prevents an outer "dynamic" CSS tint from layering on top of the
    // baked bitmap — useful for callers that swap the scene to dynamic
    // mode for live-preview during a slider drag without rebaking the
    // atlas. Behaviour in pure baked mode is unchanged.
    //
    // Also emit the polygon's surface-normal vars (--pnx/--pny/--pnz)
    // even in baked mode so the dynamic CSS Lambert formula has real
    // values to dot against `--plx/--ply/--plz` when a caller toggles
    // the scene's lighting mode without rebaking. Without these the
    // Lambert dot product collapses to 0 and the tint goes to
    // ambient-only (black with ambient=0).
    el.setAttribute(
      "style",
      atlasBaseStyle +
        `;background-image:${url}` +
        `;background-position:${pos}` +
        `;background-size:${size}` +
        `;background-repeat:no-repeat` +
        `;--pnx:${entry.normal[0].toFixed(4)}` +
        `;--pny:${entry.normal[1].toFixed(4)}` +
        `;--pnz:${entry.normal[2].toFixed(4)}` +
        textureImageRenderingStyle(imageRendering),
    );
  }
  applyTextureDiagnostics(
    el,
    "atlas",
    true,
    imageRendering,
    entry.atlasLeafSizing ?? "canonical",
    "affine",
    textureLighting,
    atlasLeafWidth,
    atlasLeafHeight,
  );
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
    applyPolygonDataAttrs(el, polygon, source.index);
    return true;
  }
  el.style.visibility = "";
  setInlineStyleProperty(el, "transform", `matrix3d(${next.matrix})`);
  if (textureLighting === "dynamic") {
    setInlineStyleProperty(el, "--pnx", next.normal[0].toFixed(4));
    setInlineStyleProperty(el, "--pny", next.normal[1].toFixed(4));
    setInlineStyleProperty(el, "--pnz", next.normal[2].toFixed(4));
  }
  applyPolygonDataAttrs(el, polygon, source.index);
  return true;
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
  const occluded = options.lightOccludedPolyIndices?.has(source.index) ?? false;
  const directScale = occluded
    ? 0
    : lightIntensity * Math.max(0, normal[0] * lx + normal[1] * ly + normal[2] * lz);
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
      xAxis[0] * source.canvasW / atlasLeafWidthForEntry(source),
      xAxis[1] * source.canvasW / atlasLeafWidthForEntry(source),
      xAxis[2] * source.canvasW / atlasLeafWidthForEntry(source),
      0,
      yAxis[0] * source.canvasH / atlasLeafHeightForEntry(source),
      yAxis[1] * source.canvasH / atlasLeafHeightForEntry(source),
      yAxis[2] * source.canvasH / atlasLeafHeightForEntry(source),
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
  skipDynamicNormalVars = false,
): HTMLElement {
  const el = doc.createElement("b");
  el.setAttribute(
    "style",
    `transform:matrix3d(${formatSolidQuadMatrix(entry)})` +
      formatInitialSolidPaintStyle(entry, textureLighting, solidPaintDefaults, skipDynamicNormalVars),
  );
  applyPolygonDataAttrs(el, entry.polygon, entry.index);

  return el;
}

export function createBorderShapeSolidElement(
  entry: TextureAtlasPlan,
  textureLighting: PolyTextureLightingMode,
  doc: Document,
  solidPaintDefaults?: SolidPaintDefaults,
  skipDynamicNormalVars = false,
): HTMLElement {
  const el = doc.createElement("i");
  el.setAttribute(
    "style",
    formatBorderShapeElementStyle(entry) +
      formatInitialSolidPaintStyle(entry, textureLighting, solidPaintDefaults, skipDynamicNormalVars),
  );
  applyPolygonDataAttrs(el, entry.polygon, entry.index);

  return el;
}

export function createCornerShapeSolidElement(
  entry: TextureAtlasPlan,
  geometry: CornerShapeGeometry,
  textureLighting: PolyTextureLightingMode,
  doc: Document,
  solidPaintDefaults?: SolidPaintDefaults,
  skipDynamicNormalVars = false,
): HTMLElement {
  const el = doc.createElement("u");
  el.className = CORNER_SHAPE_SOLID_CLASS;
  el.setAttribute(
    "style",
    formatCornerShapeElementStyle(entry, geometry) +
      formatInitialSolidPaintStyle(entry, textureLighting, solidPaintDefaults, skipDynamicNormalVars),
  );
  applyPolygonDataAttrs(el, entry.polygon, entry.index);

  return el;
}

export function createProjectiveSolidElement(
  entry: TextureAtlasPlan & { projectiveMatrix: string },
  textureLighting: PolyTextureLightingMode,
  doc: Document,
  solidPaintDefaults?: SolidPaintDefaults,
  skipDynamicNormalVars = false,
): HTMLElement {
  const el = doc.createElement("b");
  el.setAttribute(
    "style",
    `transform:matrix3d(${entry.projectiveMatrix})` +
      formatInitialSolidPaintStyle(entry, textureLighting, solidPaintDefaults, skipDynamicNormalVars),
  );
  applyPolygonDataAttrs(el, entry.polygon, entry.index);

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
  applyPolygonDataAttrs(el, entry.polygon, entry.index);
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
  applyPolygonDataAttrs(el, entry.polygon, entry.index);
}

export function updateCornerShapeElementWithStablePlan(
  el: HTMLElement,
  entry: TextureAtlasPlan,
  geometry: CornerShapeGeometry,
  textureLighting: PolyTextureLightingMode,
  solidPaintDefaults?: SolidPaintDefaults,
): void {
  el.style.visibility = "";
  el.className = CORNER_SHAPE_SOLID_CLASS;
  el.setAttribute("style", formatCornerShapeElementStyle(entry, geometry));
  applySolidPaint(el, entry, textureLighting, solidPaintDefaults);
  setInlineStyleProperty(el, "background", "currentColor");
  applyPolygonDataAttrs(el, entry.polygon, entry.index);
}

export function createAtlasElement(
  entry: PackedTextureAtlasEntry,
  textureLighting: PolyTextureLightingMode,
  doc: Document,
  skipDynamicNormalVars = false,
  defaultImageRendering?: PolyTextureImageRendering,
): HTMLElement {
  const el = doc.createElement("s");
  const imageRendering = textureImageRenderingForEntry(entry, defaultImageRendering);
  const atlasCanonicalSize = atlasCanonicalSizeForEntry(entry);
  const atlasLeafWidth = atlasLeafWidthForEntry(entry);
  const atlasLeafHeight = atlasLeafHeightForEntry(entry);
  // Emit surface normal vars regardless of mode — see applyAtlasBackground
  // for why baked-mode leaves benefit when callers toggle the scene's
  // lighting mode without rebaking. `skipDynamicNormalVars` still wins
  // (used by Lambert-bucketed dynamic leaves where the wrapper provides
  // the normal once for every poly in the bucket).
  const dynamicNormalStyle = skipDynamicNormalVars
    ? ""
    : `;--pnx:${entry.normal[0].toFixed(4)}` +
      `;--pny:${entry.normal[1].toFixed(4)}` +
      `;--pnz:${entry.normal[2].toFixed(4)}`;
  el.setAttribute(
    "style",
    `transform:matrix3d(${entry.atlasMatrix})` +
      `;--polycss-atlas-size:${atlasCanonicalSize}px` +
      `;--polycss-atlas-width:${formatCssLength(atlasLeafWidth)}` +
      `;--polycss-atlas-height:${formatCssLength(atlasLeafHeight)}` +
      `;--polycss-atlas-leaf-sizing:${entry.atlasLeafSizing ?? "canonical"}` +
      `;opacity:0` +
      dynamicNormalStyle +
      textureImageRenderingStyle(imageRendering),
  );
  applyTextureDiagnostics(
    el,
    "atlas",
    false,
    imageRendering,
    entry.atlasLeafSizing ?? "canonical",
    "affine",
    textureLighting,
    atlasLeafWidth,
    atlasLeafHeight,
  );
  applyPolygonDataAttrs(el, entry.polygon, entry.index);
  return el;
}

export function createTextureImageElement(
  plan: TextureAtlasPlan,
  geometry: PolyTextureLeafGeometry,
  doc: Document,
  skipDynamicNormalVars = false,
): HTMLElement {
  const el = doc.createElement("s");
  const dynamicNormalStyle = skipDynamicNormalVars
    ? ""
    : `;--pnx:${plan.normal[0].toFixed(4)}` +
      `;--pny:${plan.normal[1].toFixed(4)}` +
      `;--pnz:${plan.normal[2].toFixed(4)}`;
  el.setAttribute(
    "style",
    `transform:matrix3d(${geometry.matrix})` +
      `;--polycss-atlas-width:${formatCssLength(geometry.leafWidth)}` +
      `;--polycss-atlas-height:${formatCssLength(geometry.leafHeight)}` +
      `;--polycss-atlas-leaf-sizing:image` +
      `;background-image:url(${geometry.url})` +
      `;background-position:${formatCssLength(geometry.backgroundPosition[0])} ${formatCssLength(geometry.backgroundPosition[1])}` +
      `;background-size:${formatCssLength(geometry.backgroundSize[0])} ${formatCssLength(geometry.backgroundSize[1])}` +
      `;background-repeat:no-repeat` +
      `;background-blend-mode:normal` +
      `;mask-image:none` +
      `;-webkit-mask-image:none` +
      dynamicNormalStyle +
      textureImageRenderingStyle(geometry.imageRendering),
  );
  applyTextureDiagnostics(
    el,
    "image",
    true,
    geometry.imageRendering,
    "image",
    geometry.projection,
    geometry.lighting,
    geometry.leafWidth,
    geometry.leafHeight,
  );
  el.setAttribute("data-polycss-texture-source-x", String(geometry.sourceRect.x));
  el.setAttribute("data-polycss-texture-source-y", String(geometry.sourceRect.y));
  el.setAttribute("data-polycss-texture-source-width", String(geometry.sourceRect.width));
  el.setAttribute("data-polycss-texture-source-height", String(geometry.sourceRect.height));
  applyPolygonDataAttrs(el, plan.polygon, plan.index);
  return el;
}
