import type { PolyTextureLightingMode, Polygon } from "@layoutit/polycss-core";
import type {
  TextureAtlasPlan,
  PolyRenderStrategy,
  PolyRenderStrategiesOption,
  SolidPaintDefaults,
  RGB,
} from "./types";
import { parseHex, rgbKey } from "./paintDefaults";
import {
  isFullRectBasis,
  computeTextureAtlasPlan,
  resolveProjectiveQuadGuards,
  buildBasisHints,
} from "./plan";

export function fullRectBounds(entry: TextureAtlasPlan): { left: number; top: number; width: number; height: number } | null {
  if (entry.screenPts.length !== 8) return null;

  const xs: number[] = [];
  const ys: number[] = [];
  const RECT_EPS = 1e-3;
  const addUnique = (list: number[], value: number): void => {
    for (const existing of list) {
      if (Math.abs(existing - value) <= RECT_EPS) return;
    }
    list.push(value);
  };

  for (let i = 0; i < entry.screenPts.length; i += 2) {
    addUnique(xs, entry.screenPts[i]);
    addUnique(ys, entry.screenPts[i + 1]);
  }
  if (xs.length !== 2 || ys.length !== 2) return null;

  xs.sort((a, b) => a - b);
  ys.sort((a, b) => a - b);
  if (
    Math.abs(xs[0]) > RECT_EPS ||
    Math.abs(ys[0]) > RECT_EPS ||
    xs[1] - xs[0] <= RECT_EPS ||
    ys[1] - ys[0] <= RECT_EPS
  ) {
    return null;
  }

  for (let i = 0; i < entry.screenPts.length; i += 2) {
    const x = entry.screenPts[i];
    const y = entry.screenPts[i + 1];
    const onX = Math.abs(x - xs[0]) <= RECT_EPS || Math.abs(x - xs[1]) <= RECT_EPS;
    const onY = Math.abs(y - ys[0]) <= RECT_EPS || Math.abs(y - ys[1]) <= RECT_EPS;
    if (!onX || !onY) return null;
  }

  return {
    left: xs[0],
    top: ys[0],
    width: xs[1] - xs[0],
    height: ys[1] - ys[0],
  };
}

export function isFullRectSolid(entry: TextureAtlasPlan): boolean {
  return !!fullRectBounds(entry);
}

export function isSolidTrianglePlan(entry: TextureAtlasPlan): boolean {
  return !entry.texture && entry.polygon.vertices.length === 3;
}

export function isProjectiveQuadPlan(entry: TextureAtlasPlan): entry is TextureAtlasPlan & { projectiveMatrix: string } {
  return !entry.texture && !!entry.projectiveMatrix && !isFullRectSolid(entry);
}

export function borderShapeSupported(doc: Document): boolean {
  const css = doc.defaultView?.CSS ?? (typeof CSS !== "undefined" ? CSS : undefined);
  const supportsBorderShape = !!css?.supports?.(
    "border-shape",
    "polygon(0 0, 100% 0, 0 100%) circle(0)",
  );
  if (!supportsBorderShape) return false;

  const win = doc.defaultView ?? (typeof window !== "undefined" ? window : undefined);
  const media = win?.matchMedia;
  if (!media) return true;

  return media("(pointer: fine)").matches && media("(hover: hover)").matches;
}

export function solidTriangleSupported(doc: Document): boolean {
  const win = doc.defaultView ?? (typeof window !== "undefined" ? window : undefined);
  const userAgent = win?.navigator?.userAgent ?? "";
  if (!userAgent) return true;

  return !safariCssProjectiveUnsupported(userAgent);
}

export function cornerShapeSupported(doc: Document): boolean {
  const css = doc.defaultView?.CSS ?? (typeof CSS !== "undefined" ? CSS : undefined);
  return !!css?.supports?.("corner-top-left-shape", "bevel") &&
    !!css.supports("corner-top-right-shape", "bevel") &&
    !!css.supports("corner-bottom-right-shape", "bevel") &&
    !!css.supports("corner-bottom-left-shape", "bevel");
}

export function cornerTriangleSupported(doc: Document): boolean {
  const css = doc.defaultView?.CSS ?? (typeof CSS !== "undefined" ? CSS : undefined);
  return !!css?.supports?.("corner-top-left-shape", "bevel") &&
    !!css.supports("corner-top-right-shape", "bevel");
}

export function resolveSolidTrianglePrimitive(
  doc: Document,
  strategies?: PolyRenderStrategiesOption,
): "border" | "corner-bevel" | null {
  if (strategies?.disable?.includes("u")) return null;
  if (cornerTriangleSupported(doc)) return "corner-bevel";
  return solidTriangleSupported(doc) ? "border" : null;
}

export function projectiveQuadSupported(doc: Document): boolean {
  const win = doc.defaultView ?? (typeof window !== "undefined" ? window : undefined);
  const userAgent = win?.navigator?.userAgent ?? "";
  if (!userAgent) return true;

  return !safariCssProjectiveUnsupported(userAgent);
}

export function safariCssProjectiveUnsupported(userAgent: string): boolean {
  const isChromiumFamily = /\b(?:Chrome|HeadlessChrome|Chromium|Edg|OPR)\//.test(userAgent);
  const isSafariFamily = /\bVersion\/[\d.]+.*\bSafari\//.test(userAgent);
  return isSafariFamily && !isChromiumFamily;
}

export function incrementCount(map: Map<string, number>, key: string): void {
  map.set(key, (map.get(key) ?? 0) + 1);
}

export function dominantCountKey(map: Map<string, number>): string | undefined {
  let bestKey: string | undefined;
  let bestCount = 1;
  for (const [key, count] of map) {
    if (count > bestCount) {
      bestKey = key;
      bestCount = count;
    }
  }
  return bestKey;
}

export function getSolidPaintDefaultsForPlans(
  plans: Array<TextureAtlasPlan | null>,
  textureLighting: PolyTextureLightingMode,
  doc: Document,
  strategies?: PolyRenderStrategiesOption,
  cornerShapeGeometryForPlanFn?: (plan: TextureAtlasPlan) => unknown,
): SolidPaintDefaults {
  const paintCounts = new Map<string, number>();
  const dynamicCounts = new Map<string, number>();
  const dynamicColors = new Map<string, RGB>();
  const disabled = new Set(strategies?.disable ?? []);
  const useFullRectSolid = !disabled.has("b");
  const useProjectiveQuad = useFullRectSolid && projectiveQuadSupported(doc);
  const useStableTriangle = resolveSolidTrianglePrimitive(doc, strategies) !== null;
  const useCornerShapeSolid = !disabled.has("i") && cornerShapeSupported(doc);
  const useBorderShape = !disabled.has("i") && borderShapeSupported(doc);

  for (const plan of plans) {
    if (!plan || plan.texture) continue;
    const usesCornerShape = useCornerShapeSolid && !!cornerShapeGeometryForPlanFn?.(plan);

    if (textureLighting === "dynamic") {
      if (
        !(useStableTriangle && isSolidTrianglePlan(plan)) &&
        !(useFullRectSolid && isFullRectSolid(plan)) &&
        !(useProjectiveQuad && isProjectiveQuadPlan(plan)) &&
        !usesCornerShape &&
        !useBorderShape
      ) continue;
      const color = parseHex(plan.polygon.color ?? "#cccccc");
      const key = rgbKey(color);
      incrementCount(dynamicCounts, key);
      if (!dynamicColors.has(key)) dynamicColors.set(key, color);
      continue;
    }

    if (
      !(useStableTriangle && isSolidTrianglePlan(plan)) &&
      !(useFullRectSolid && isFullRectSolid(plan)) &&
      !(useProjectiveQuad && isProjectiveQuadPlan(plan)) &&
      !usesCornerShape &&
      !useBorderShape
    ) continue;
    incrementCount(paintCounts, plan.shadedColor);
  }

  const paintColor = dominantCountKey(paintCounts);
  const dynamicColorKey = dominantCountKey(dynamicCounts);
  return {
    paintColor,
    dynamicColorKey,
    dynamicColor: dynamicColorKey ? dynamicColors.get(dynamicColorKey) : undefined,
  };
}

/**
 * Compute the dominant paint defaults from an already-computed array of plans.
 *
 * React and Vue compute plans first (to drive the atlas packing), then pass
 * the plan array here so they don't need access to the raw polygon list.
 * Requires access to a Document to check browser support for solid-triangle
 * and border-shape strategies.
 */
export function getSolidPaintDefaultsFromPlans(
  plans: Array<TextureAtlasPlan | null>,
  textureLighting: PolyTextureLightingMode,
  disabled: ReadonlySet<PolyRenderStrategy> = new Set(),
  doc?: Document | null,
): SolidPaintDefaults {
  const resolvedDoc = doc ?? (typeof document !== "undefined" ? document : null);
  if (!resolvedDoc) return {};
  const strategies: PolyRenderStrategiesOption | undefined =
    disabled.size > 0 ? { disable: Array.from(disabled) as PolyRenderStrategy[] } : undefined;
  return getSolidPaintDefaultsForPlans(plans, textureLighting, resolvedDoc, strategies);
}

/**
 * Returns true when the browser supports the `border-shape` CSS property and
 * the pointer/hover media queries indicate a fine-pointer device (desktop-class).
 * Falls back to a globalThis-based check when no Document is available.
 */
export function isBorderShapeSupported(doc?: Document | null): boolean {
  const d = doc ?? (typeof document !== "undefined" ? document : null);
  if (!d) {
    const css = typeof CSS !== "undefined" ? CSS : undefined;
    const supportsBorderShape = !!css?.supports?.("border-shape", "polygon(0 0, 100% 0, 0 100%) circle(0)");
    if (!supportsBorderShape) return false;
    const media = typeof matchMedia !== "undefined" ? matchMedia : undefined;
    if (!media) return true;
    return media("(pointer: fine)").matches && media("(hover: hover)").matches;
  }
  return borderShapeSupported(d);
}

/**
 * Returns true when the browser renders CSS border-trick triangles correctly.
 * WebKit/Safari renders them incorrectly when transformed — this check gates
 * the `<u>` strategy path.
 */
export function isSolidTriangleSupported(doc?: Document | null): boolean {
  const d = doc ?? (typeof document !== "undefined" ? document : null);
  if (!d) {
    const userAgent = (typeof navigator !== "undefined" ? navigator : globalThis.navigator)?.userAgent ?? "";
    if (!userAgent) return true;
    const isChromiumFamily = /\b(?:Chrome|HeadlessChrome|Chromium|Edg|OPR)\//.test(userAgent);
    const isSafariFamily = /\bVersion\/[\d.]+.*\bSafari\//.test(userAgent);
    return !isSafariFamily || isChromiumFamily;
  }
  return solidTriangleSupported(d);
}

/**
 * Filter a plan array to the subset that needs atlas packing, given the active
 * render strategies and texture-lighting mode. Plans excluded from the atlas
 * will be rendered via `<b>`, `<i>`, or `<u>` by the framework components.
 */
export function filterAtlasPlans(
  plans: Array<TextureAtlasPlan | null>,
  textureLighting: PolyTextureLightingMode,
  disabled: ReadonlySet<PolyRenderStrategy>,
  doc?: Document | null,
): Array<TextureAtlasPlan | null> {
  const useFullRectSolid = !disabled.has("b");
  const useProjectiveQuad = useFullRectSolid;
  const useStableTriangle = !disabled.has("u") && isSolidTriangleSupported(doc);
  const useBorderShape = !disabled.has("i") && textureLighting !== "dynamic" && isBorderShapeSupported(doc);
  const disableB = disabled.has("b");
  return plans.map((plan) => {
    if (!plan || plan.texture) return plan;
    if (useStableTriangle && isSolidTrianglePlan(plan)) return null;
    const fullRect = isFullRectSolid(plan);
    if (
      (useFullRectSolid && fullRect) ||
      (useProjectiveQuad && isProjectiveQuadPlan(plan)) ||
      (textureLighting !== "dynamic" && useBorderShape && (!fullRect || disableB))
    ) return null;
    return plan;
  });
}

export function getSolidPaintDefaults(
  polygons: Polygon[],
  options: import("./types.ts").RenderTextureAtlasOptions,
  cornerShapeGeometryForPlanFn?: (plan: TextureAtlasPlan) => unknown,
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
    cornerShapeGeometryForPlanFn,
  );
}
