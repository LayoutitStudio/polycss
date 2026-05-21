import type { Polygon } from "@layoutit/polycss-core";
import type {
  TextureAtlasPlan,
  RenderTextureAtlasOptions,
  InternalRenderTextureAtlasOptions,
  RenderedPoly,
  RenderTextureAtlasResult,
  RenderTextureAtlasAsyncResult,
  SolidPaintDefaults,
  SolidTrianglePlan,
  SolidTriangleColorPlan,
  SolidTriangleFrame,
  SolidTriangleElement,
  CornerShapeGeometry,
} from "./types";
import {
  ASYNC_RENDER_BUDGET_MS,
  DEFAULT_TILE,
  PROJECTIVE_QUAD_DENOM_EPS,
  PROJECTIVE_QUAD_MAX_WEIGHT_RATIO,
  PROJECTIVE_QUAD_BLEED,
} from "./constants";
import { buildBasisHints, resolveProjectiveQuadGuards, computeTextureAtlasPlan } from "./plan";
import {
  getSolidPaintDefaultsForPlans,
  isFullRectSolid,
  isSolidTrianglePlan,
  isProjectiveQuadPlan,
  projectiveQuadSupported,
  cornerShapeSupported,
  borderShapeSupported,
  resolveSolidTrianglePrimitive,
} from "./strategy";
import { cornerShapeGeometryForPlan } from "./borderShape";
import { packTextureAtlasPlansWithScale } from "./packing";
import { buildAtlasPages } from "./rasterise";
import {
  createAtlasElement,
  createSolidElement,
  createBorderShapeSolidElement,
  createCornerShapeSolidElement,
  createProjectiveSolidElement,
  applyAtlasBackground,
  updateAtlasElementWithStablePlan,
  updateSolidElementWithStablePlan,
  updateBorderShapeElementWithStablePlan,
  updateCornerShapeElementWithStablePlan,
} from "./emit";
import { removeInlineStyleProperty, setInlineStyleProperty } from "./paintDefaults";
import {
  computeSolidTrianglePlan,
  computeSolidTrianglePlanFromCssPoints,
  computeSolidTriangleColorPlan,
} from "./solidTrianglePlan";
import {
  createSolidTriangleElement,
  createHiddenSolidTriangleElement,
  applySolidTriangleElement,
  applySolidTriangleElementFast,
  applySolidTriangleElementColorOnly,
  applySolidTriangleElementTransformOnly,
  hideSolidTriangleElement,
  stableTriangleColorState,
  shouldComputeStableTriangleColor,
  selectAdaptiveTriangleColorUpdates,
  updateStableTriangleElementsStreaming,
} from "./stableTriangle";
import { stableTriangleMatrixDecimals } from "./solidTriangle";

function yieldToMainThread(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

async function yieldIfOverBudget(started: number): Promise<number> {
  if (performance.now() - started < ASYNC_RENDER_BUDGET_MS) return started;
  await yieldToMainThread();
  return performance.now();
}

export function getSolidPaintDefaults(
  polygons: Polygon[],
  options: RenderTextureAtlasOptions = {},
): SolidPaintDefaults {
  const doc = options.doc ?? (typeof document !== "undefined" ? document : null);
  if (!doc) return {};
  const basisHints = buildBasisHints(polygons, options);
  const projectiveQuadGuards = resolveProjectiveQuadGuards(doc);
  const plans = polygons.map((polygon, index) =>
    computeTextureAtlasPlan(polygon, index, options, projectiveQuadGuards, basisHints[index])
  );
  return getSolidPaintDefaultsForPlans(
    plans,
    options.textureLighting ?? "baked",
    doc,
    options.strategies,
  );
}

export function renderPolygonsWithTextureAtlas(
  polygons: Polygon[],
  options: RenderTextureAtlasOptions = {},
): RenderTextureAtlasResult {
  const doc = options.doc ?? (typeof document !== "undefined" ? document : null);
  if (!doc) return { rendered: [], dispose: () => {} };

  const textureLighting = options.textureLighting ?? "baked";
  const disabled = new Set(options.strategies?.disable ?? []);
  const useFullRectSolid = !disabled.has("b");
  const useProjectiveQuad = useFullRectSolid && projectiveQuadSupported(doc);
  const solidTrianglePrimitive = resolveSolidTrianglePrimitive(doc, options.strategies);
  const useStableTriangle = solidTrianglePrimitive !== null;
  const useCornerShapeSolid = !disabled.has("i") && cornerShapeSupported(doc);
  const useBorderShape = !disabled.has("i") && borderShapeSupported(doc);
  const basisHints = buildBasisHints(polygons, options);
  const projectiveQuadGuards = resolveProjectiveQuadGuards(doc);
  const plans = polygons.map((polygon, index) =>
    computeTextureAtlasPlan(polygon, index, options, projectiveQuadGuards, basisHints[index])
  );
  const trianglePlans = plans.map((plan) =>
    plan && useStableTriangle && isSolidTrianglePlan(plan)
      ? computeSolidTrianglePlan(plan.polygon, plan.index, options, {
          primitive: solidTrianglePrimitive ?? undefined,
        })
      : null
  );
  const cornerShapePlans = plans.map((plan) =>
    plan &&
    useCornerShapeSolid &&
    !isSolidTrianglePlan(plan) &&
    !(useFullRectSolid && isFullRectSolid(plan)) &&
    !(useProjectiveQuad && isProjectiveQuadPlan(plan))
      ? cornerShapeGeometryForPlan(plan)
      : null
  );
  const atlasPlans = plans.map((plan, index) =>
    plan &&
    (plan.texture
      ? plan
      : (!(useFullRectSolid && isFullRectSolid(plan)) && !trianglePlans[index] && !(useProjectiveQuad && isProjectiveQuadPlan(plan)) && !cornerShapePlans[index] && !useBorderShape) ? plan : null)
  );
  const { packed, atlasScale } = packTextureAtlasPlansWithScale(atlasPlans, options.textureQuality, doc);
  const atlasElements = new Map<number, HTMLElement>();
  const rendered: RenderedPoly[] = [];
  let cancelled = false;
  let urls: string[] = [];

  for (let i = 0; i < polygons.length; i++) {
    const plan = plans[i];
    const trianglePlan = trianglePlans[i];
    const cornerShapePlan = cornerShapePlans[i];
    if (!plan) continue;

    const entry = packed.entries[i];
    if (entry) {
      const element = createAtlasElement(entry, textureLighting, doc);
      atlasElements.set(i, element);
      rendered.push({ polygonIndex: i, element, kind: "atlas", plan: entry, dispose: () => {} });
    } else if (!plan.texture && useFullRectSolid && isFullRectSolid(plan)) {
      const element = createSolidElement(plan, textureLighting, doc, options.solidPaintDefaults);
      rendered.push({ polygonIndex: i, element, kind: "solid", plan, dispose: () => {} });
    } else if (!plan.texture && trianglePlan) {
      const element = createSolidTriangleElement(trianglePlan, doc);
      rendered.push({ polygonIndex: i, element, kind: "triangle", plan, dispose: () => {} });
    } else if (!plan.texture && useProjectiveQuad && isProjectiveQuadPlan(plan)) {
      const element = createProjectiveSolidElement(plan, textureLighting, doc, options.solidPaintDefaults);
      rendered.push({ polygonIndex: i, element, kind: "solid", plan, dispose: () => {} });
    } else if (!plan.texture && cornerShapePlan) {
      const element = createCornerShapeSolidElement(plan, cornerShapePlan, textureLighting, doc, options.solidPaintDefaults);
      rendered.push({ polygonIndex: i, element, kind: "corner", plan, dispose: () => {} });
    } else if (!plan.texture && useBorderShape) {
      const element = createBorderShapeSolidElement(plan, textureLighting, doc, options.solidPaintDefaults);
      rendered.push({ polygonIndex: i, element, kind: "border", plan, dispose: () => {} });
    }
  }

  rendered.sort((a, b) => a.polygonIndex - b.polygonIndex);

  buildAtlasPages(packed.pages, textureLighting, doc, atlasScale, () => cancelled)
    .then((pages) => {
      if (cancelled) {
        for (const page of pages) {
          if (page.url?.startsWith("blob:")) URL.revokeObjectURL(page.url);
        }
        return;
      }
      urls = pages.flatMap((page) => page.url?.startsWith("blob:") ? [page.url] : []);
      for (let pageIndex = 0; pageIndex < packed.pages.length; pageIndex++) {
        const page = packed.pages[pageIndex];
        const built = pages[pageIndex];
        if (!built) continue;
        for (const entry of page.entries) {
          const el = atlasElements.get(entry.index);
          if (!el || !built.url) continue;
          applyAtlasBackground(el, built, textureLighting, entry);
          removeInlineStyleProperty(el, "opacity");
        }
      }
    })
    .catch(() => {
      if (cancelled) return;
      for (const element of atlasElements.values()) {
        setInlineStyleProperty(element, "opacity", "0.5");
        setInlineStyleProperty(element, "outline", "1px dashed rgba(255, 0, 0, 0.6)");
      }
    });

  return {
    rendered,
    dispose() {
      cancelled = true;
      for (const url of urls) URL.revokeObjectURL(url);
      urls = [];
    },
  };
}

export async function renderPolygonsWithTextureAtlasAsync(
  polygons: Polygon[],
  options: RenderTextureAtlasOptions = {},
  shouldCancel: () => boolean = () => false,
): Promise<RenderTextureAtlasAsyncResult> {
  const doc = options.doc ?? (typeof document !== "undefined" ? document : null);
  if (!doc || shouldCancel()) {
    return { rendered: [], solidPaintDefaults: {}, dispose: () => {} };
  }

  const textureLighting = options.textureLighting ?? "baked";
  const disabled = new Set(options.strategies?.disable ?? []);
  const useFullRectSolid = !disabled.has("b");
  const useProjectiveQuad = useFullRectSolid && projectiveQuadSupported(doc);
  const solidTrianglePrimitive = resolveSolidTrianglePrimitive(doc, options.strategies);
  const useStableTriangle = solidTrianglePrimitive !== null;
  const useCornerShapeSolid = !disabled.has("i") && cornerShapeSupported(doc);
  const useBorderShape = !disabled.has("i") && borderShapeSupported(doc);
  await yieldToMainThread();
  if (shouldCancel()) return { rendered: [], solidPaintDefaults: {}, dispose: () => {} };

  const basisHints = buildBasisHints(polygons, options);
  const projectiveQuadGuards = resolveProjectiveQuadGuards(doc);
  let batchStarted = performance.now();
  const plans: Array<TextureAtlasPlan | null> = new Array(polygons.length);
  for (let i = 0; i < polygons.length; i++) {
    plans[i] = computeTextureAtlasPlan(polygons[i], i, options, projectiveQuadGuards, basisHints[i]);
    batchStarted = await yieldIfOverBudget(batchStarted);
    if (shouldCancel()) return { rendered: [], solidPaintDefaults: {}, dispose: () => {} };
  }

  const solidPaintDefaults = options.solidPaintDefaults ??
    getSolidPaintDefaultsForPlans(plans, textureLighting, doc, options.strategies);
  const trianglePlans: Array<SolidTrianglePlan | null> = new Array(plans.length);
  const cornerShapePlans: Array<CornerShapeGeometry | null> = new Array(plans.length);
  const atlasPlans: Array<TextureAtlasPlan | null> = new Array(plans.length);
  for (let i = 0; i < plans.length; i++) {
    const plan = plans[i];
    const trianglePlan = plan && useStableTriangle && isSolidTrianglePlan(plan)
      ? computeSolidTrianglePlan(plan.polygon, plan.index, { ...options, solidPaintDefaults }, {
          primitive: solidTrianglePrimitive ?? undefined,
        })
      : null;
    trianglePlans[i] = trianglePlan;
    const cornerShapePlan = plan &&
        useCornerShapeSolid &&
        !isSolidTrianglePlan(plan) &&
        !(useFullRectSolid && isFullRectSolid(plan)) &&
        !(useProjectiveQuad && isProjectiveQuadPlan(plan))
      ? cornerShapeGeometryForPlan(plan)
      : null;
    cornerShapePlans[i] = cornerShapePlan;
    atlasPlans[i] = plan &&
      (plan.texture
        ? plan
        : (!(useFullRectSolid && isFullRectSolid(plan)) && !trianglePlan && !(useProjectiveQuad && isProjectiveQuadPlan(plan)) && !cornerShapePlan && !useBorderShape) ? plan : null);
    batchStarted = await yieldIfOverBudget(batchStarted);
    if (shouldCancel()) return { rendered: [], solidPaintDefaults, dispose: () => {} };
  }

  const { packed, atlasScale } = packTextureAtlasPlansWithScale(atlasPlans, options.textureQuality, doc);
  const atlasElements = new Map<number, HTMLElement>();
  const rendered: RenderedPoly[] = [];
  let cancelled = false;
  let urls: string[] = [];

  for (let i = 0; i < polygons.length; i++) {
    const plan = plans[i];
    const trianglePlan = trianglePlans[i];
    const cornerShapePlan = cornerShapePlans[i];
    if (!plan) continue;

    const entry = packed.entries[i];
    if (entry) {
      const element = createAtlasElement(entry, textureLighting, doc);
      atlasElements.set(i, element);
      rendered.push({ polygonIndex: i, element, kind: "atlas", plan: entry, dispose: () => {} });
    } else if (!plan.texture && useFullRectSolid && isFullRectSolid(plan)) {
      const element = createSolidElement(plan, textureLighting, doc, solidPaintDefaults);
      rendered.push({ polygonIndex: i, element, kind: "solid", plan, dispose: () => {} });
    } else if (!plan.texture && trianglePlan) {
      const element = createSolidTriangleElement(trianglePlan, doc);
      rendered.push({ polygonIndex: i, element, kind: "triangle", plan, dispose: () => {} });
    } else if (!plan.texture && useProjectiveQuad && isProjectiveQuadPlan(plan)) {
      const element = createProjectiveSolidElement(plan, textureLighting, doc, solidPaintDefaults);
      rendered.push({ polygonIndex: i, element, kind: "solid", plan, dispose: () => {} });
    } else if (!plan.texture && cornerShapePlan) {
      const element = createCornerShapeSolidElement(plan, cornerShapePlan, textureLighting, doc, solidPaintDefaults);
      rendered.push({ polygonIndex: i, element, kind: "corner", plan, dispose: () => {} });
    } else if (!plan.texture && useBorderShape) {
      const element = createBorderShapeSolidElement(plan, textureLighting, doc, solidPaintDefaults);
      rendered.push({ polygonIndex: i, element, kind: "border", plan, dispose: () => {} });
    }
    batchStarted = await yieldIfOverBudget(batchStarted);
    if (shouldCancel()) {
      for (const item of rendered) item.dispose();
      return { rendered: [], solidPaintDefaults, dispose: () => {} };
    }
  }

  rendered.sort((a, b) => a.polygonIndex - b.polygonIndex);

  buildAtlasPages(packed.pages, textureLighting, doc, atlasScale, () => cancelled || shouldCancel())
    .then((pages) => {
      if (cancelled || shouldCancel()) {
        for (const page of pages) {
          if (page.url?.startsWith("blob:")) URL.revokeObjectURL(page.url);
        }
        return;
      }
      urls = pages.flatMap((page) => page.url?.startsWith("blob:") ? [page.url] : []);
      for (let pageIndex = 0; pageIndex < packed.pages.length; pageIndex++) {
        const page = packed.pages[pageIndex];
        const built = pages[pageIndex];
        if (!built) continue;
        for (const entry of page.entries) {
          const el = atlasElements.get(entry.index);
          if (!el || !built.url) continue;
          applyAtlasBackground(el, built, textureLighting, entry);
          removeInlineStyleProperty(el, "opacity");
        }
      }
    })
    .catch(() => {
      if (cancelled || shouldCancel()) return;
      for (const element of atlasElements.values()) {
        setInlineStyleProperty(element, "opacity", "0.5");
        setInlineStyleProperty(element, "outline", "1px dashed rgba(255, 0, 0, 0.6)");
      }
    });

  return {
    rendered,
    solidPaintDefaults,
    dispose() {
      cancelled = true;
      for (const url of urls) URL.revokeObjectURL(url);
      urls = [];
    },
  };
}

export function updateStableTriangleFrame(
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

  const matrixDecimals = stableTriangleMatrixDecimals(internalOptions);
  const colorState = stableTriangleColorState(internalOptions);
  const tile = options.tileSize ?? DEFAULT_TILE;
  const elev = options.layerElevation ?? tile;

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
      options,
      {
        basis: element.__polycssSolidTriangleBasis,
        matrixDecimals,
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

export function updatePolygonsWithStableTopology(
  rendered: RenderedPoly[],
  polygons: Polygon[],
  options: RenderTextureAtlasOptions = {},
): boolean {
  if (rendered.length !== polygons.length) return false;
  const doc = options.doc ?? (typeof document !== "undefined" ? document : null);
  const textureLighting = options.textureLighting ?? "baked";
  const disabled = new Set(options.strategies?.disable ?? []);
  const useFullRectSolid = !disabled.has("b");
  const useProjectiveQuad = !!doc && useFullRectSolid && projectiveQuadSupported(doc);
  const useCornerShapeSolid = !!doc && !disabled.has("i") && cornerShapeSupported(doc);
  const useBorderShape = !!doc && !disabled.has("i") && borderShapeSupported(doc);
  const projectiveQuadGuards = doc
    ? resolveProjectiveQuadGuards(doc)
    : {
        denomEps: PROJECTIVE_QUAD_DENOM_EPS,
        maxWeightRatio: PROJECTIVE_QUAD_MAX_WEIGHT_RATIO,
        bleed: PROJECTIVE_QUAD_BLEED,
        disableGuards: false,
      };
  const optimizeTriangleStyle =
    (options as InternalRenderTextureAtlasOptions).optimizeStableTriangleStyle === true &&
    textureLighting === "baked";
  const internalOptions = options as InternalRenderTextureAtlasOptions;
  const stableTriangleDebug = internalOptions.stableTriangleDebug;
  const stableTriangleUpdateMode = internalOptions.stableTriangleUpdateMode ??
    (stableTriangleDebug === "plan-only" || stableTriangleDebug === "transform-only"
      ? stableTriangleDebug
      : "full");
  const colorOnly = optimizeTriangleStyle && stableTriangleUpdateMode === "color-only";
  const colorState = stableTriangleColorState(internalOptions);
  const matrixDecimals = stableTriangleMatrixDecimals(internalOptions);
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
    return true;
  }
  const nextTrianglePlans: Array<SolidTrianglePlan | null> = [];
  const nextTriangleColorPlans: Array<SolidTriangleColorPlan | null> = [];
  const nextTexturePlans: Array<TextureAtlasPlan | null> = [];

  for (let i = 0; i < rendered.length; i++) {
    const item = rendered[i];
    if (item.polygonIndex !== i) return false;
    const polygon = polygons[i];
    if (!polygon) return false;
    if (colorOnly && item.kind !== "triangle") return false;
    if (item.kind === "atlas") {
      if (
        !item.plan ||
        !updateAtlasElementWithStablePlan(item.element, item.plan, polygon, textureLighting)
      ) {
        return false;
      }
      continue;
    }
    if (item.kind === "triangle") {
      const element = item.element as SolidTriangleElement;
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
          ? computeSolidTriangleColorPlan(polygon, i, options)
          : null;
        continue;
      }
      const plan = computeSolidTrianglePlan(polygon, i, options, {
        basis: element.__polycssSolidTriangleBasis,
        matrixDecimals,
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
        nextTrianglePlans[i] = null;
        continue;
      }
      nextTrianglePlans[i] = plan;
      continue;
    }
    if (item.kind === "solid") {
      if (!item.plan || polygon.texture || polygon.vertices.length !== item.plan.polygon.vertices.length) return false;
      nextTexturePlans[i] = item.plan;
      continue;
    }
    if (item.kind === "border") {
      const plan = computeTextureAtlasPlan(polygon, i, options, projectiveQuadGuards);
      if (
        !plan ||
        plan.texture ||
        !useBorderShape ||
        (useFullRectSolid && isFullRectSolid(plan)) ||
        (useProjectiveQuad && isProjectiveQuadPlan(plan)) ||
        (useCornerShapeSolid && !!cornerShapeGeometryForPlan(plan))
      ) {
        return false;
      }
      nextTexturePlans[i] = plan;
      continue;
    }
    if (item.kind === "corner") {
      const plan = computeTextureAtlasPlan(polygon, i, options, projectiveQuadGuards);
      if (
        !plan ||
        plan.texture ||
        !useCornerShapeSolid ||
        isSolidTrianglePlan(plan) ||
        (useFullRectSolid && isFullRectSolid(plan)) ||
        (useProjectiveQuad && isProjectiveQuadPlan(plan)) ||
        !cornerShapeGeometryForPlan(plan)
      ) {
        return false;
      }
      nextTexturePlans[i] = plan;
      continue;
    }
    return false;
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
    const item = rendered[i];
    if (item.kind === "triangle") {
      if (colorOnly) {
        const plan = nextTriangleColorPlans[i];
        if (plan) {
          applySolidTriangleElementColorOnly(
            item.element,
            plan,
            colorState,
            adaptiveColorUpdates?.has(i),
          );
        }
        continue;
      }
      const plan = nextTrianglePlans[i];
      if (!plan) {
        hideSolidTriangleElement(item.element);
        continue;
      }
      if (optimizeTriangleStyle && stableTriangleUpdateMode === "plan-only") {
        continue;
      } else if (optimizeTriangleStyle && stableTriangleUpdateMode === "transform-only") {
        applySolidTriangleElementTransformOnly(item.element, plan);
      } else if (optimizeTriangleStyle) {
        applySolidTriangleElementFast(
          item.element,
          plan,
          colorState,
          adaptiveColorUpdates?.has(i),
        );
      } else {
        applySolidTriangleElement(item.element, plan);
      }
    } else if (item.kind === "solid") {
      const plan = nextTexturePlans[i];
      if (!plan) return false;
      if (
        !updateSolidElementWithStablePlan(
          item.element,
          plan,
          polygons[i],
          textureLighting,
          options,
          projectiveQuadGuards,
          internalOptions.solidPaintDefaults,
        )
      ) {
        return false;
      }
    } else if (item.kind === "border") {
      const plan = nextTexturePlans[i];
      if (!plan) return false;
      updateBorderShapeElementWithStablePlan(item.element, plan, textureLighting, internalOptions.solidPaintDefaults);
    } else if (item.kind === "corner") {
      const plan = nextTexturePlans[i];
      const geometry = plan ? cornerShapeGeometryForPlan(plan) : null;
      if (!plan || !geometry) return false;
      updateCornerShapeElementWithStablePlan(
        item.element,
        plan,
        geometry,
        textureLighting,
        internalOptions.solidPaintDefaults,
      );
    }
  }

  return true;
}
