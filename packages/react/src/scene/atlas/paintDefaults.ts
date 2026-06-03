import type {
  TextureAtlasPlan,
  Polygon,
  PolyTextureLightingMode,
  SolidPaintDefaults,
  PolyRenderStrategy,
  PolyRenderStrategiesOption,
  ComputeTextureAtlasPlanOptions,
} from "@layoutit/polycss-core";
import { computeTextureAtlasPlanPublic } from "@layoutit/polycss-core";
import type { BasisHint } from "@layoutit/polycss-core";
import { getSolidPaintDefaultsFromPlans } from "./detection";

// Public re-export of computeTextureAtlasPlan (simple signature) so callers
// that import it from this module continue to work. Accepts the optional
// pre-computed cross-polygon basis hint so PolyMesh's atlas pipeline can
// match vanilla's renderer (which always passes one).
export function computeTextureAtlasPlan(
  polygon: Polygon,
  index: number,
  options: ComputeTextureAtlasPlanOptions = {},
  basisHint?: BasisHint,
): TextureAtlasPlan | null {
  return computeTextureAtlasPlanPublic(polygon, index, options, undefined, basisHint);
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
