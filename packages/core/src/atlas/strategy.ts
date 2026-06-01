import type { PolyTextureLightingMode } from "../types";
import type {
  TextureAtlasPlan,
  PolyRenderStrategy,
  RGB,
} from "./types";
import { cornerShapeGeometryForPlan } from "./borderShape";

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

export interface FilterAtlasPlansEnv {
  solidTriangleSupported: boolean;
  projectiveQuadSupported: boolean;
  borderShapeSupported: boolean;
  /** When true, non-triangle non-rect non-projective polys whose plan has
   *  cornerShapeGeometryForPlan != null are excluded from the atlas (they
   *  render as <u> via corner-*-shape: bevel CSS — matches vanilla's
   *  createCornerShapeSolidElement path). Falsy / undefined preserves the
   *  earlier core behaviour (those polys stay in atlas as <s> fallback). */
  cornerShapeSupported?: boolean;
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
  env: FilterAtlasPlansEnv,
): Array<TextureAtlasPlan | null> {
  const useFullRectSolid = !disabled.has("b");
  const useProjectiveQuad = useFullRectSolid && env.projectiveQuadSupported;
  const useStableTriangle = !disabled.has("u") && env.solidTriangleSupported;
  const useCornerShapeSolid = !disabled.has("i") && !!env.cornerShapeSupported;
  // borderShape applies in both lighting modes (vanilla never gates this on
  // textureLighting). Earlier core implementation disabled it in dynamic
  // mode, which forced solid non-rect non-triangle polys through the atlas
  // bitmap path — in dynamic mode that produced light-baked atlas pixels
  // that didn't pick up the CSS-driven lambert calc, drifting the visual
  // output away from vanilla.
  const useBorderShape = !disabled.has("i") && env.borderShapeSupported;
  const disableB = disabled.has("b");
  return plans.map((plan) => {
    if (!plan || plan.texture) return plan;
    if (useStableTriangle && isSolidTrianglePlan(plan)) return null;
    const fullRect = isFullRectSolid(plan);
    // CornerShape solid catches non-rect non-triangle non-projective polys
    // with a valid corner-shape geometry — vanilla renders these as <u>
    // with corner-*-shape: bevel CSS. Without this branch, multi-vertex
    // polygons (e.g. 12-vertex tower caps in the castle mesh) fell through
    // to the atlas bitmap path, producing visible parity drift in dynamic
    // mode (the atlas pixel was light-baked at compile time, not by the
    // runtime CSS lambert calc).
    if (
      useCornerShapeSolid &&
      !fullRect &&
      !(useProjectiveQuad && isProjectiveQuadPlan(plan)) &&
      cornerShapeGeometryForPlan(plan) !== null
    ) return null;
    if (
      (useFullRectSolid && fullRect) ||
      (useProjectiveQuad && isProjectiveQuadPlan(plan)) ||
      (useBorderShape && (!fullRect || disableB))
    ) return null;
    return plan;
  });
}

export interface GetSolidPaintDefaultsEnv {
  solidTriangleSupported: boolean;
  projectiveQuadSupported: boolean;
  cornerShapeSupported: boolean;
  borderShapeSupported: boolean;
}

export function getSolidPaintDefaultsForPlansCore(
  plans: Array<TextureAtlasPlan | null>,
  textureLighting: PolyTextureLightingMode,
  disabled: ReadonlySet<PolyRenderStrategy>,
  env: GetSolidPaintDefaultsEnv,
  parseHexFn: (color: string) => RGB,
  rgbKeyFn: (rgb: RGB) => string,
  cornerShapeGeometryForPlanFn?: (plan: TextureAtlasPlan) => unknown,
): { paintColor?: string; dynamicColorKey?: string; dynamicColor?: RGB } {
  const paintCounts = new Map<string, number>();
  const dynamicCounts = new Map<string, number>();
  const dynamicColors = new Map<string, RGB>();
  const useFullRectSolid = !disabled.has("b");
  const useProjectiveQuad = useFullRectSolid && env.projectiveQuadSupported;
  const useStableTriangle = !disabled.has("u") && env.solidTriangleSupported;
  const useCornerShapeSolid = !disabled.has("i") && env.cornerShapeSupported;
  const useBorderShape = !disabled.has("i") && env.borderShapeSupported;

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
      const color = parseHexFn(plan.polygon.color ?? "#cccccc");
      const key = rgbKeyFn(color);
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
