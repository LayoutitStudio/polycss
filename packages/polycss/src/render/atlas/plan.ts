import type {
  ProjectiveQuadGuardGlobal,
  ProjectiveQuadGuardOverrides,
  ProjectiveQuadGuardSettings,
} from "@layoutit/polycss-core";
import {
  resolveProjectiveQuadGuards as resolveProjectiveQuadGuardsCore,
} from "@layoutit/polycss-core";

/**
 * PolyCSS wrapper: extracts the `__polycssProjectiveQuadGuards` override bag
 * from `doc.defaultView` and delegates to the pure-math core function.
 * Caller-supplied `defaults` (e.g. `{ bleed: PROJECTIVE_QUAD_BLEED * ratio }`)
 * are merged UNDER the window-level overrides so the seam-bleed ratio
 * scales the bleed unless the user has set an explicit DevTools override.
 */
export function resolveProjectiveQuadGuards(
  doc: Document | null,
  defaults?: ProjectiveQuadGuardOverrides,
): ProjectiveQuadGuardSettings {
  const win = doc?.defaultView as (Window & ProjectiveQuadGuardGlobal) | null | undefined;
  const windowOverrides: ProjectiveQuadGuardOverrides | undefined = win?.__polycssProjectiveQuadGuards;
  const merged = defaults && windowOverrides
    ? { ...defaults, ...windowOverrides }
    : (windowOverrides ?? defaults);
  return resolveProjectiveQuadGuardsCore(merged);
}
