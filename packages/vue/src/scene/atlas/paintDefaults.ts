import type {
  TextureAtlasPlan,
  Polygon,
  PolyTextureLightingMode,
  SolidPaintDefaults,
  PolyRenderStrategy,
  PolyRenderStrategiesOption,
  ComputeTextureAtlasPlanOptions,
  ProjectiveQuadGuardGlobal,
  ProjectiveQuadGuardOverrides,
} from "@layoutit/polycss-core";
import {
  computeTextureAtlasPlanPublic,
  PROJECTIVE_QUAD_BLEED,
  seamBleedPrimitiveRatio,
} from "@layoutit/polycss-core";
import type { BasisHint } from "@layoutit/polycss-core";
import { getSolidPaintDefaultsFromPlans } from "./detection";

// Public re-export of computeTextureAtlasPlan (simple signature) so callers
// that import it from this module continue to work. Accepts the optional
// pre-computed cross-polygon basis hint so PolyMesh's atlas pipeline can
// match vanilla's renderer (which always passes one).
//
// Mirrors vanilla's resolveProjectiveQuadGuards wrapper: the projective-quad
// guard bleed default is PROJECTIVE_QUAD_BLEED scaled by the seamBleed-derived
// primitive ratio, merged UNDER the `window.__polycssProjectiveQuadGuards`
// debug override bag.
export function computeTextureAtlasPlan(
  polygon: Polygon,
  index: number,
  options: ComputeTextureAtlasPlanOptions = {},
  basisHint?: BasisHint,
): TextureAtlasPlan | null {
  const win = typeof window !== "undefined"
    ? (window as Window & ProjectiveQuadGuardGlobal)
    : undefined;
  const windowOverrides = win?.__polycssProjectiveQuadGuards;
  const defaults: ProjectiveQuadGuardOverrides = {
    bleed: PROJECTIVE_QUAD_BLEED * seamBleedPrimitiveRatio(options.seamBleed),
  };
  const overrides = windowOverrides ? { ...defaults, ...windowOverrides } : defaults;
  return computeTextureAtlasPlanPublic(polygon, index, options, overrides, basisHint);
}

// --- getSolidPaintDefaults (plan-array signature used by PolyMesh) ----------

export function getSolidPaintDefaults(
  plans: Array<TextureAtlasPlan | null>,
  textureLighting: PolyTextureLightingMode,
  strategies?: PolyRenderStrategiesOption,
): SolidPaintDefaults {
  const disabled = new Set<PolyRenderStrategy>((strategies?.disable ?? []) as PolyRenderStrategy[]);
  return getSolidPaintDefaultsFromPlans(plans, textureLighting, disabled);
}
