import type {
  ProjectiveQuadGuardGlobal,
  ProjectiveQuadGuardOverrides,
  ProjectiveQuadGuardSettings,
} from "@layoutit/polycss-core";
import {
  resolveProjectiveQuadGuards as resolveProjectiveQuadGuardsCore,
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
