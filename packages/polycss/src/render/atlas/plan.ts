import type {
  ProjectiveQuadGuardGlobal,
  ProjectiveQuadGuardOverrides,
  ProjectiveQuadGuardSettings,
} from "@layoutit/polycss-core";
import {
  resolveProjectiveQuadGuards as resolveProjectiveQuadGuardsCore,
} from "@layoutit/polycss-core";

// Pure plan functions — all math, no DOM.
export {
  computeProjectiveQuadCoefficients,
  computeProjectiveQuadMatrix,
  dotVec,
  crossVec,
  isBasisOptimizable,
  getPolygonBasisInfo,
  compatibleSurface,
  compatibleBleedSurface,
  seamLightBrightness,
  basisAxisKey,
  makeLocalBasis,
  evaluateIslandAxis,
  chooseIslandXAxis,
  buildBasisHints,
  chooseLocalBasis,
  isFullRectBasis,
  computeUvAffine,
  computeUvSampleRect,
  projectTextureTriangle,
  computeTextureAtlasPlan,
  computeTextureAtlasPlanPublic,
  stableBasisFromPlan,
} from "@layoutit/polycss-core";

/**
 * Polycss wrapper: extracts the `__polycssProjectiveQuadGuards` override bag
 * from `doc.defaultView` and delegates to the pure-math core function.
 */
export function resolveProjectiveQuadGuards(
  doc: Document | null,
): ProjectiveQuadGuardSettings {
  const win = doc?.defaultView as (Window & ProjectiveQuadGuardGlobal) | null | undefined;
  const overrides: ProjectiveQuadGuardOverrides | undefined = win?.__polycssProjectiveQuadGuards;
  return resolveProjectiveQuadGuardsCore(overrides);
}
