import type { PolyTextureLightingMode } from "@layoutit/polycss-core";
import {
  isFullRectSolid,
  isSolidTrianglePlan,
  isProjectiveQuadPlan,
  fullRectBounds,
  safariCssProjectiveUnsupported,
  incrementCount,
  dominantCountKey,
  filterAtlasPlans as filterAtlasPlansCore,
  getSolidPaintDefaultsForPlansCore,
} from "@layoutit/polycss-core";
import type {
  TextureAtlasPlan,
  PolyRenderStrategy,
  PolyRenderStrategiesOption,
  SolidPaintDefaults,
  RGB,
} from "@layoutit/polycss-core";
import { parseHex, rgbKey } from "@layoutit/polycss-core";
import {
  isFullRectBasis,
  computeTextureAtlasPlan,
  buildBasisHints,
} from "@layoutit/polycss-core";
import { resolveProjectiveQuadGuards } from "./plan";

// Pure predicates re-exported from core.
export {
  fullRectBounds,
  isFullRectSolid,
  isSolidTrianglePlan,
  isProjectiveQuadPlan,
  safariCssProjectiveUnsupported,
  incrementCount,
  dominantCountKey,
};

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
  if (cornerTriangleSupported(doc)) return true;
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

function firefoxNeedsLargeBorderTriangle(doc: Document): boolean {
  const win = doc.defaultView ?? (typeof window !== "undefined" ? window : undefined);
  const userAgent = win?.navigator?.userAgent ?? "";
  return /\bFirefox\//.test(userAgent);
}

export function resolveSolidTrianglePrimitive(
  doc: Document,
  strategies?: PolyRenderStrategiesOption,
): "border" | "border-large" | "corner-bevel" | null {
  if (strategies?.disable?.includes("u")) return null;
  if (cornerTriangleSupported(doc)) return "corner-bevel";
  if (!solidTriangleSupported(doc)) return null;
  return firefoxNeedsLargeBorderTriangle(doc) ? "border-large" : "border";
}

export function projectiveQuadSupported(doc: Document): boolean {
  const win = doc.defaultView ?? (typeof window !== "undefined" ? window : undefined);
  const userAgent = win?.navigator?.userAgent ?? "";
  if (!userAgent) return true;

  return !safariCssProjectiveUnsupported(userAgent);
}

export function getSolidPaintDefaultsForPlans(
  plans: Array<TextureAtlasPlan | null>,
  textureLighting: PolyTextureLightingMode,
  doc: Document,
  strategies?: PolyRenderStrategiesOption,
  cornerShapeGeometryForPlanFn?: (plan: TextureAtlasPlan) => unknown,
): SolidPaintDefaults {
  const disabled = new Set(strategies?.disable ?? []);
  return getSolidPaintDefaultsForPlansCore(
    plans,
    textureLighting,
    disabled,
    {
      solidTriangleSupported: solidTriangleSupported(doc),
      projectiveQuadSupported: projectiveQuadSupported(doc),
      cornerShapeSupported: cornerShapeSupported(doc),
      borderShapeSupported: borderShapeSupported(doc),
    },
    parseHex,
    rgbKey,
    cornerShapeGeometryForPlanFn,
  );
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
    const css = typeof CSS !== "undefined" ? CSS : undefined;
    if (
      !!css?.supports?.("corner-top-left-shape", "bevel") &&
      !!css.supports("corner-top-right-shape", "bevel")
    ) return true;
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
  return filterAtlasPlansCore(plans, textureLighting, disabled, {
    solidTriangleSupported: isSolidTriangleSupported(doc),
    borderShapeSupported: isBorderShapeSupported(doc),
  });
}

export function getSolidPaintDefaults(
  polygons: import("@layoutit/polycss-core").Polygon[],
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
