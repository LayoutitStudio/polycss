import type { Polygon } from "@layoutit/polycss-core";
import {
  buildSeamBleedPolygonEdges,
  DEFAULT_SEAM_BLEED,
  DEFAULT_TILE,
  SOLID_TRIANGLE_CANONICAL_SIZE,
  DEFAULT_MATRIX_DECIMALS,
  BASIS_EPS,
  resolveBleedRatio,
} from "@layoutit/polycss-core";
import type {
  SolidTrianglePlan,
  SolidTriangleColorPlan,
  SolidTriangleFrame,
  SolidTrianglePrimitive,
  StableTriangleColorState,
} from "@layoutit/polycss-core";
import type {
  SolidTriangleElement,
  InternalRenderTextureAtlasOptions,
  RenderTextureAtlasOptions,
  RenderedPoly,
  RenderTextureAtlasResult,
} from "./types";
import {
  rgbEqual,
  stepRgbToward,
  rgbToCss,
  colorErrorScore,
} from "@layoutit/polycss-core";
import { computeSolidTriangleColorPlan } from "@layoutit/polycss-core";
import {
  computeSolidTrianglePlan,
  computeSolidTrianglePlanFromCssPoints,
} from "./solidTrianglePlan";
import { stableTriangleMatrixDecimals } from "@layoutit/polycss-core";
import { applyPolygonDataAttrs, hasPolygonDataAttrs } from "./emit";
import { resolveSolidTrianglePrimitive } from "./strategy";

// See renderPolygons.ts. `options.seamBleed` is interpreted as a ratio.
const SOLID_TRIANGLE_BORDER_WIDTH = "0 48px 96px 48px";

type RenderTextureAtlasOptionsWithSeams = RenderTextureAtlasOptions & {
  seamBleed?: number;
  seamEdges?: Set<number>;
};

function buildStableTriangleSeamEdges(
  polygons: Polygon[],
  options: RenderTextureAtlasOptions,
): Map<number, Set<number>> | null {
  return buildSeamBleedPolygonEdges(polygons, {
    tileSize: options.tileSize,
    layerElevation: options.layerElevation,
    directionalLight: options.directionalLight,
    ambientLight: options.ambientLight,
  });
}

function stableTriangleSeamOptions(
  index: number,
  seamBleedEdges: Map<number, Set<number>> | null,
  options: RenderTextureAtlasOptionsWithSeams,
): RenderTextureAtlasOptionsWithSeams {
  // `options.seamBleed` is the ratio (0..1). Resolve to absolute px.
  const bleed = DEFAULT_SEAM_BLEED * resolveBleedRatio(options.seamBleed);
  return seamBleedEdges && bleed > 0
    ? {
        ...options,
        seamBleed: seamBleedEdges.has(index) ? bleed : undefined,
        seamEdges: seamBleedEdges.get(index),
      }
    : options;
}

export function stableTriangleColorState(options: InternalRenderTextureAtlasOptions): StableTriangleColorState {
  return {
    updatesDisabled: options.stableTriangleColorFreezeFrames === 0,
    freezeFrames: Math.max(1, Math.floor(options.stableTriangleColorFreezeFrames ?? 1)),
    colorFrame: Math.max(0, Math.floor(options.stableTriangleColorFrame ?? 0)),
    maxStep: Math.max(0, Math.floor(options.stableTriangleColorMaxStep ?? 0)),
  };
}

export function stableTriangleColorAllowed(index: number, state: StableTriangleColorState): boolean {
  return !state.updatesDisabled &&
    (state.freezeFrames <= 1 || (state.colorFrame + index) % state.freezeFrames === 0);
}

export function shouldComputeStableTriangleColor(
  element: HTMLElement,
  index: number,
  optimizeTriangleStyle: boolean,
  stableTriangleDebug: InternalRenderTextureAtlasOptions["stableTriangleDebug"],
  stableTriangleColorPolicy: InternalRenderTextureAtlasOptions["stableTriangleColorPolicy"],
  colorState: StableTriangleColorState,
): boolean {
  if (!optimizeTriangleStyle) return true;
  if (colorState.updatesDisabled) return false;
  if (stableTriangleDebug === "plan-only" || stableTriangleDebug === "transform-only") return false;
  if (stableTriangleColorPolicy === "adaptive") return true;
  if ((element as SolidTriangleElement).__polycssSolidTriangleColor === undefined) return true;
  return stableTriangleColorAllowed(index, colorState);
}

export function applySolidTrianglePrimitive(
  el: HTMLElement,
  primitive: SolidTrianglePrimitive,
): void {
  const triangleEl = el as SolidTriangleElement;
  if (triangleEl.__polycssSolidTrianglePrimitive === primitive) return;
  if (primitive === "corner-bevel") {
    el.style.width = `${SOLID_TRIANGLE_CANONICAL_SIZE}px`;
    el.style.height = `${SOLID_TRIANGLE_CANONICAL_SIZE}px`;
    el.style.backgroundColor = "currentColor";
    el.style.borderWidth = "0";
    el.style.borderTopLeftRadius = "50% 100%";
    el.style.borderTopRightRadius = "50% 100%";
    el.style.setProperty("corner-top-left-shape", "bevel");
    el.style.setProperty("corner-top-right-shape", "bevel");
  } else {
    el.style.width = "";
    el.style.height = "";
    el.style.backgroundColor = "";
    el.style.borderTopLeftRadius = "";
    el.style.borderTopRightRadius = "";
    el.style.removeProperty("corner-top-left-shape");
    el.style.removeProperty("corner-top-right-shape");
    el.style.borderWidth = primitive === "border-large" ? SOLID_TRIANGLE_BORDER_WIDTH : "";
  }
  triangleEl.__polycssSolidTrianglePrimitive = primitive;
}

export function showSolidTriangleElement(el: HTMLElement): void {
  const triangleEl = el as SolidTriangleElement;
  if (!triangleEl.__polycssSolidTriangleHidden) return;
  el.style.visibility = "";
  triangleEl.__polycssSolidTriangleHidden = false;
}

export function hideSolidTriangleElement(el: HTMLElement): void {
  const triangleEl = el as SolidTriangleElement;
  if (triangleEl.__polycssSolidTriangleHidden) return;
  el.style.visibility = "hidden";
  triangleEl.__polycssSolidTriangleHidden = true;
}

export function applySolidTriangleElement(
  el: HTMLElement,
  entry: SolidTrianglePlan,
): void {
  el.setAttribute("style", entry.styleText);
  applySolidTrianglePrimitive(el, entry.primitive);
  const triangleEl = el as SolidTriangleElement;
  triangleEl.__polycssSolidTriangleBasis = entry.basis;
  triangleEl.__polycssSolidTriangleHidden = false;
  if (entry.colorComputed) {
    triangleEl.__polycssSolidTriangleColor = entry.bakedColor ?? "";
    triangleEl.__polycssSolidTriangleColorRgb = entry.bakedRgb;
    triangleEl.__polycssSolidTriangleColorAlpha = entry.bakedAlpha;
  }
  triangleEl.__polycssSolidTriangleColorFrame = undefined;
  if (entry.polygon.data || hasPolygonDataAttrs(el)) {
    applyPolygonDataAttrs(el, entry.polygon);
  }
}

export function applySolidTriangleElementColor(
  el: HTMLElement,
  entry: SolidTriangleColorPlan,
  colorState: StableTriangleColorState,
  colorUpdateAllowed?: boolean,
): void {
  if (!entry.colorComputed) {
    if (entry.polygon.data || hasPolygonDataAttrs(el)) {
      applyPolygonDataAttrs(el, entry.polygon);
    }
    return;
  }
  const triangleEl = el as SolidTriangleElement;
  const nextColor = entry.bakedColor ?? "";
  const nextRgb = entry.bakedRgb;
  const nextAlpha = entry.bakedAlpha ?? 1;
  const currentColor = triangleEl.__polycssSolidTriangleColor;
  const currentRgb = triangleEl.__polycssSolidTriangleColorRgb;
  const currentAlpha = triangleEl.__polycssSolidTriangleColorAlpha ?? 1;
  const shouldUpdateColor = colorUpdateAllowed ?? stableTriangleColorAllowed(entry.index, colorState);
  if (!colorState.updatesDisabled && currentColor !== nextColor && (currentColor === undefined || shouldUpdateColor)) {
    let writeColor = nextColor;
    let writeRgb = nextRgb;
    if (
      colorState.maxStep > 0 &&
      currentRgb &&
      nextRgb &&
      currentAlpha === nextAlpha
    ) {
      const steppedRgb = stepRgbToward(currentRgb, nextRgb, colorState.maxStep);
      writeRgb = steppedRgb;
      writeColor = rgbToCss(steppedRgb, nextAlpha);
    }
    if (writeColor !== currentColor || !rgbEqual(writeRgb, currentRgb)) {
      el.style.color = writeColor;
    }
    triangleEl.__polycssSolidTriangleColor = writeColor;
    triangleEl.__polycssSolidTriangleColorRgb = writeRgb;
    triangleEl.__polycssSolidTriangleColorAlpha = nextAlpha;
    triangleEl.__polycssSolidTriangleColorFrame = colorState.colorFrame;
  }
  if (entry.polygon.data || hasPolygonDataAttrs(el)) {
    applyPolygonDataAttrs(el, entry.polygon);
  }
}

export function applySolidTriangleElementFast(
  el: HTMLElement,
  entry: SolidTrianglePlan,
  colorState: StableTriangleColorState,
  colorUpdateAllowed?: boolean,
): void {
  const triangleEl = el as SolidTriangleElement;
  applySolidTrianglePrimitive(el, entry.primitive);
  if (triangleEl.__polycssSolidTriangleBasis !== entry.basis) {
    triangleEl.__polycssSolidTriangleBasis = entry.basis;
  }
  showSolidTriangleElement(el);
  el.style.transform = entry.transformText;
  if (entry.colorComputed || entry.polygon.data || hasPolygonDataAttrs(el)) {
    applySolidTriangleElementColor(el, entry, colorState, colorUpdateAllowed);
  }
}

export function applySolidTriangleElementColorOnly(
  el: HTMLElement,
  entry: SolidTriangleColorPlan,
  colorState: StableTriangleColorState,
  colorUpdateAllowed?: boolean,
): void {
  showSolidTriangleElement(el);
  applySolidTriangleElementColor(el, entry, colorState, colorUpdateAllowed);
}

export function applySolidTriangleElementTransformOnly(
  el: HTMLElement,
  entry: SolidTrianglePlan,
): void {
  const triangleEl = el as SolidTriangleElement;
  applySolidTrianglePrimitive(el, entry.primitive);
  if (triangleEl.__polycssSolidTriangleBasis !== entry.basis) {
    triangleEl.__polycssSolidTriangleBasis = entry.basis;
  }
  showSolidTriangleElement(el);
  el.style.transform = entry.transformText;
  if (entry.polygon.data || hasPolygonDataAttrs(el)) {
    applyPolygonDataAttrs(el, entry.polygon);
  }
}

export function stableTriangleColorBudgetCount(
  total: number,
  options: InternalRenderTextureAtlasOptions,
): number {
  const configured = options.stableTriangleColorBudget;
  if (typeof configured === "number" && Number.isFinite(configured) && configured > 0) {
    return configured <= 1
      ? Math.max(1, Math.ceil(total * configured))
      : Math.max(1, Math.floor(configured));
  }
  const freezeFrames = Math.max(1, Math.floor(options.stableTriangleColorFreezeFrames ?? 1));
  return Math.max(1, Math.ceil(total / freezeFrames));
}

export function selectAdaptiveTriangleColorUpdates(
  rendered: RenderedPoly[],
  plans: Array<SolidTriangleColorPlan | null>,
  options: InternalRenderTextureAtlasOptions,
): Set<number> | null {
  if (options.stableTriangleColorPolicy !== "adaptive") return null;
  if (options.stableTriangleColorFreezeFrames === 0) return new Set();
  const colorFrame = Math.max(0, Math.floor(options.stableTriangleColorFrame ?? 0));
  const freezeFrames = Math.max(1, Math.floor(options.stableTriangleColorFreezeFrames ?? 1));
  if (freezeFrames <= 1 && !Number.isFinite(options.stableTriangleColorBudget)) return null;
  const maxWrites = stableTriangleColorBudgetCount(rendered.length, options);
  const maxAge = Math.max(
    1,
    Math.floor(options.stableTriangleColorMaxAge ?? Math.max(2, freezeFrames * 2)),
  );
  const candidates: Array<{ index: number; score: number }> = [];

  for (let i = 0; i < rendered.length; i++) {
    const item = rendered[i];
    const plan = plans[i];
    if (item.kind !== "triangle" || !plan) continue;
    const triangleEl = item.element as SolidTriangleElement;
    const currentColor = triangleEl.__polycssSolidTriangleColor;
    const nextColor = plan.bakedColor ?? "";
    if (currentColor === nextColor) continue;
    const lastColorFrame = triangleEl.__polycssSolidTriangleColorFrame ?? 0;
    const age = Math.max(0, colorFrame - lastColorFrame);
    const error = colorErrorScore(currentColor, nextColor);
    candidates.push({
      index: i,
      score: (age >= maxAge ? 1_000_000 : 0) + error * 10_000 + age,
    });
  }

  if (candidates.length === 0) return new Set();
  candidates.sort((a, b) => b.score - a.score);
  return new Set(candidates.slice(0, maxWrites).map((candidate) => candidate.index));
}

export function createSolidTriangleElement(
  entry: SolidTrianglePlan,
  doc: Document,
): HTMLElement {
  const el = doc.createElement("u");
  applySolidTriangleElement(el, entry);
  // Always emit data-poly-index for devtools pinpointing. The update
  // paths below skip data-attr work via outer guards (they hot-loop
  // through transforms), so this mount-time call is what makes the
  // index stick on every triangle leaf.
  applyPolygonDataAttrs(el, entry.polygon, entry.index);
  return el;
}

export function createHiddenSolidTriangleElement(
  polygon: Polygon,
  polygonIndex: number,
  doc: Document,
): HTMLElement {
  const el = doc.createElement("u");
  hideSolidTriangleElement(el);
  applyPolygonDataAttrs(el, polygon, polygonIndex);
  return el;
}

export function updateStableTriangleElementsStreaming(
  rendered: RenderedPoly[],
  polygons: Polygon[],
  options: RenderTextureAtlasOptions,
  optimizeTriangleStyle: boolean,
  stableTriangleUpdateMode: "full" | "transform-only" | "color-only" | "plan-only",
  colorState: StableTriangleColorState,
): boolean {
  const internalOptions = options as InternalRenderTextureAtlasOptions;
  const stableTriangleDebug = internalOptions.stableTriangleDebug;
  const colorOnly = optimizeTriangleStyle && stableTriangleUpdateMode === "color-only";
  if (internalOptions.stableTriangleColorPolicy === "adaptive") return false;
  if (rendered.length !== polygons.length) return false;
  const matrixDecimals = stableTriangleMatrixDecimals(internalOptions.stableTriangleMatrixDecimals);
  const doc = options.doc ?? (typeof document !== "undefined" ? document : null);
  const solidTrianglePrimitive = doc
    ? resolveSolidTrianglePrimitive(doc, options.strategies) ?? "border"
    : "border";

  for (let i = 0; i < rendered.length; i++) {
    const item = rendered[i];
    if (item.kind !== "triangle" || item.polygonIndex !== i || !polygons[i]) return false;
  }

  const seamBleedEdges = buildStableTriangleSeamEdges(polygons, options);
  for (let i = 0; i < rendered.length; i++) {
    const element = rendered[i].element as SolidTriangleElement;
    const polygon = polygons[i];
    if (colorOnly) {
      if (
        shouldComputeStableTriangleColor(
          element,
          i,
          optimizeTriangleStyle,
          stableTriangleDebug,
          internalOptions.stableTriangleColorPolicy,
          colorState,
        )
      ) {
        const plan = computeSolidTriangleColorPlan(polygon, i, options);
        if (!plan) continue;
        applySolidTriangleElementColorOnly(
          element,
          plan,
          colorState,
        );
      }
      continue;
    }

    const plan = computeSolidTrianglePlan(polygon, i, stableTriangleSeamOptions(i, seamBleedEdges, options), {
      basis: element.__polycssSolidTriangleBasis,
      matrixDecimals,
      primitive: solidTrianglePrimitive,
      includeColor: stableTriangleUpdateMode !== "plan-only" &&
        stableTriangleUpdateMode !== "transform-only" &&
        shouldComputeStableTriangleColor(
          element,
          i,
          optimizeTriangleStyle,
          stableTriangleDebug,
          internalOptions.stableTriangleColorPolicy,
          colorState,
        ),
    });
    if (!plan) {
      hideSolidTriangleElement(element);
      continue;
    }
    if (optimizeTriangleStyle && stableTriangleUpdateMode === "plan-only") {
      continue;
    } else if (optimizeTriangleStyle && stableTriangleUpdateMode === "transform-only") {
      applySolidTriangleElementTransformOnly(element, plan);
    } else if (optimizeTriangleStyle) {
      applySolidTriangleElementFast(element, plan, colorState);
    } else {
      applySolidTriangleElement(element, plan);
    }
  }

  return true;
}

export function captureStableTriangleTransformFrame(
  rendered: RenderedPoly[],
  polygons: Polygon[],
  frame: SolidTriangleFrame,
  options: RenderTextureAtlasOptions = {},
): boolean {
  const textureLighting = options.textureLighting ?? "baked";
  const internalOptions = options as InternalRenderTextureAtlasOptions;
  const optimizeTriangleStyle =
    internalOptions.optimizeStableTriangleStyle === true &&
    textureLighting === "baked";
  if (!optimizeTriangleStyle) return false;
  if (internalOptions.stableTriangleColorPolicy === "adaptive") return false;
  if (rendered.length !== frame.polygonCount || polygons.length !== frame.polygonCount) return false;
  if (frame.vertices.length < frame.polygonCount * 9) return false;

  const stableTriangleDebug = internalOptions.stableTriangleDebug;
  const stableTriangleUpdateMode = internalOptions.stableTriangleUpdateMode ??
    (stableTriangleDebug === "plan-only" || stableTriangleDebug === "transform-only"
      ? stableTriangleDebug
      : "full");
  if (stableTriangleUpdateMode === "color-only") return false;

  const matrixDecimals = stableTriangleMatrixDecimals(internalOptions.stableTriangleMatrixDecimals);
  const colorState = stableTriangleColorState(internalOptions);
  const tile = options.tileSize ?? DEFAULT_TILE;
  const elev = options.layerElevation ?? tile;
  const doc = options.doc ?? (typeof document !== "undefined" ? document : null);
  const solidTrianglePrimitive = doc
    ? resolveSolidTrianglePrimitive(doc, options.strategies) ?? "border"
    : "border";

  for (let i = 0; i < rendered.length; i++) {
    const item = rendered[i];
    const polygon = polygons[i];
    if (
      item.kind !== "triangle" ||
      item.polygonIndex !== i ||
      !polygon ||
      polygon.vertices.length !== 3 ||
      polygon.texture ||
      polygon.material?.texture
    ) {
      return false;
    }
  }

  const values = frame.vertices;
  const seamBleedEdges = buildStableTriangleSeamEdges(polygons, options);
  for (let i = 0; i < rendered.length; i++) {
    const element = rendered[i].element as SolidTriangleElement;
    const polygon = polygons[i]!;
    const offset = i * 9;
    const p0x = values[offset + 1]! * tile;
    const p0y = values[offset]! * tile;
    const p0z = values[offset + 2]! * elev;
    const p1x = values[offset + 4]! * tile;
    const p1y = values[offset + 3]! * tile;
    const p1z = values[offset + 5]! * elev;
    const p2x = values[offset + 7]! * tile;
    const p2y = values[offset + 6]! * tile;
    const p2z = values[offset + 8]! * elev;
    const plan = computeSolidTrianglePlanFromCssPoints(
      polygon,
      i,
      stableTriangleSeamOptions(i, seamBleedEdges, options),
      {
        basis: element.__polycssSolidTriangleBasis,
        matrixDecimals,
        primitive: solidTrianglePrimitive,
        color: frame.colors?.[i],
        includeColor: stableTriangleUpdateMode !== "plan-only" &&
          stableTriangleUpdateMode !== "transform-only" &&
          shouldComputeStableTriangleColor(
            element,
            i,
            optimizeTriangleStyle,
            stableTriangleDebug,
            internalOptions.stableTriangleColorPolicy,
            colorState,
          ),
      },
      p0x,
      p0y,
      p0z,
      p1x,
      p1y,
      p1z,
      p2x,
      p2y,
      p2z,
    );
    if (!plan) {
      hideSolidTriangleElement(element);
      continue;
    }
    if (stableTriangleUpdateMode === "plan-only") {
      continue;
    } else if (stableTriangleUpdateMode === "transform-only") {
      applySolidTriangleElementTransformOnly(element, plan);
    } else {
      applySolidTriangleElementFast(element, plan, colorState);
    }
  }

  return true;
}

export function renderPolygonsWithStableTriangles(
  polygons: Polygon[],
  options: RenderTextureAtlasOptions = {},
): RenderTextureAtlasResult | null {
  const doc = options.doc ?? (typeof document !== "undefined" ? document : null);
  if (!doc) return { rendered: [], dispose: () => {} };
  const solidTrianglePrimitive = resolveSolidTrianglePrimitive(doc, options.strategies);
  if (!solidTrianglePrimitive) return null;
  if (polygons.some((polygon) => polygon.texture || polygon.vertices.length !== 3)) {
    return null;
  }
  const matrixDecimals = stableTriangleMatrixDecimals((options as InternalRenderTextureAtlasOptions).stableTriangleMatrixDecimals);
  const rendered: RenderedPoly[] = [];
  const seamBleedEdges = buildStableTriangleSeamEdges(polygons, options);

  for (let i = 0; i < polygons.length; i += 1) {
    const polygon = polygons[i];
    const plan = computeSolidTrianglePlan(polygon, i, stableTriangleSeamOptions(i, seamBleedEdges, options), {
      matrixDecimals,
      primitive: solidTrianglePrimitive,
    });
    const element = plan
      ? createSolidTriangleElement(plan, doc)
      : createHiddenSolidTriangleElement(polygon, i, doc);
    rendered.push({ polygonIndex: i, element, kind: "triangle", dispose: () => {} });
  }

  return {
    rendered,
    dispose() {},
  };
}

export function updatePolygonsWithStableTriangles(
  rendered: RenderedPoly[],
  polygons: Polygon[],
  options: RenderTextureAtlasOptions = {},
): RenderTextureAtlasResult | null {
  const doc = options.doc ?? (typeof document !== "undefined" ? document : null);
  if (!doc) return { rendered, dispose: () => {} };
  const solidTrianglePrimitive = resolveSolidTrianglePrimitive(doc, options.strategies);
  if (!solidTrianglePrimitive) return null;
  if (rendered.some((item) => item.kind !== "triangle")) return null;
  if (polygons.length !== rendered.length) return null;
  for (let i = 0; i < rendered.length; i++) {
    if (rendered[i].polygonIndex !== i) return null;
  }

  const optimizeTriangleStyle =
    (options as InternalRenderTextureAtlasOptions).optimizeStableTriangleStyle === true &&
    (options.textureLighting ?? "baked") === "baked";
  const internalOptions = options as InternalRenderTextureAtlasOptions;
  const stableTriangleDebug = internalOptions.stableTriangleDebug;
  const stableTriangleUpdateMode = internalOptions.stableTriangleUpdateMode ??
    (stableTriangleDebug === "plan-only" || stableTriangleDebug === "transform-only"
      ? stableTriangleDebug
      : "full");
  const colorOnly = optimizeTriangleStyle && stableTriangleUpdateMode === "color-only";
  const colorState = stableTriangleColorState(internalOptions);
  const matrixDecimals = stableTriangleMatrixDecimals(internalOptions.stableTriangleMatrixDecimals);
  if (
    updateStableTriangleElementsStreaming(
      rendered,
      polygons,
      options,
      optimizeTriangleStyle,
      stableTriangleUpdateMode,
      colorState,
    )
  ) {
    return {
      rendered,
      dispose() {},
    };
  }
  const nextTrianglePlans: Array<SolidTrianglePlan | null> = new Array(rendered.length);
  const nextTriangleColorPlans: Array<SolidTriangleColorPlan | null> = new Array(rendered.length);
  const seamBleedEdges = buildStableTriangleSeamEdges(polygons, options);
  for (let i = 0; i < rendered.length; i++) {
    const element = rendered[i].element as SolidTriangleElement;
    if (colorOnly) {
      const shouldComputeColor = internalOptions.stableTriangleColorPolicy === "adaptive" ||
        shouldComputeStableTriangleColor(
          element,
          i,
          optimizeTriangleStyle,
          stableTriangleDebug,
          internalOptions.stableTriangleColorPolicy,
          colorState,
        );
      nextTriangleColorPlans[i] = shouldComputeColor
        ? computeSolidTriangleColorPlan(polygons[i], i, options)
        : null;
      continue;
    }
    nextTrianglePlans[i] = computeSolidTrianglePlan(polygons[i], i, stableTriangleSeamOptions(i, seamBleedEdges, options), {
      basis: element.__polycssSolidTriangleBasis,
      matrixDecimals,
      primitive: solidTrianglePrimitive,
      includeColor: stableTriangleUpdateMode !== "plan-only" &&
        stableTriangleUpdateMode !== "transform-only" &&
        shouldComputeStableTriangleColor(
          element,
          i,
          optimizeTriangleStyle,
          stableTriangleDebug,
          internalOptions.stableTriangleColorPolicy,
          colorState,
        ),
    });
  }
  const adaptiveColorUpdates = optimizeTriangleStyle && stableTriangleUpdateMode !== "plan-only" &&
      stableTriangleUpdateMode !== "transform-only"
    ? selectAdaptiveTriangleColorUpdates(
        rendered,
        colorOnly ? nextTriangleColorPlans : nextTrianglePlans,
        internalOptions,
      )
    : null;

  for (let i = 0; i < rendered.length; i++) {
    if (colorOnly) {
      const plan = nextTriangleColorPlans[i];
      if (plan) {
        applySolidTriangleElementColorOnly(
          rendered[i].element,
          plan,
          colorState,
          adaptiveColorUpdates?.has(i),
        );
      }
      continue;
    }
    const plan = nextTrianglePlans[i];
    if (!plan) {
      hideSolidTriangleElement(rendered[i].element);
      continue;
    }
    if (optimizeTriangleStyle && stableTriangleUpdateMode === "plan-only") {
      continue;
    } else if (optimizeTriangleStyle && stableTriangleUpdateMode === "transform-only") {
      applySolidTriangleElementTransformOnly(rendered[i].element, plan);
    } else if (optimizeTriangleStyle) {
      applySolidTriangleElementFast(
        rendered[i].element,
        plan,
        colorState,
        adaptiveColorUpdates?.has(i),
      );
    } else {
      applySolidTriangleElement(rendered[i].element, plan);
    }
  }

  return {
    rendered,
    dispose() {},
  };
}
