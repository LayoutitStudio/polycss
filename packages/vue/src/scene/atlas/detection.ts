import type { PolyTextureLightingMode } from "@layoutit/polycss-core";
import {
  getSolidPaintDefaultsForPlansCore,
  safariCssProjectiveUnsupported,
  parseHex,
  rgbKey,
} from "@layoutit/polycss-core";
import type {
  TextureAtlasPlan,
  PolyRenderStrategy,
  PolyRenderStrategiesOption,
  SolidPaintDefaults,
} from "@layoutit/polycss-core";

// ---------------------------------------------------------------------------
// Browser-capability detection (copied from packages/polycss/src/render/atlas/strategy.ts)
// ---------------------------------------------------------------------------

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
