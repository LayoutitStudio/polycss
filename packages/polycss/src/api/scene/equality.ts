/**
 * Small structural-equality predicates used by `createPolyScene` to decide
 * whether a `setOptions` call actually changed something. Extracted so they
 * can be unit-tested in isolation and so the main scene factory stays
 * focused on wiring rather than primitive comparisons.
 */
import type { Vec3 } from "@layoutit/polycss-core";
import type { PolyRenderStrategiesOption } from "../../render/textureAtlas";
import type { PolySceneOptions } from "./types";

export function strategiesEqual(
  a: PolyRenderStrategiesOption | undefined,
  b: PolyRenderStrategiesOption | undefined,
): boolean {
  const da = a?.disable ?? [];
  const db = b?.disable ?? [];
  if (da.length !== db.length) return false;
  for (const s of da) if (!db.includes(s)) return false;
  return true;
}

export function vec3Equal(a: Vec3 | undefined, b: Vec3 | undefined): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
}

export function shadowOptsEqual(
  a: PolySceneOptions["shadow"] | undefined,
  b: PolySceneOptions["shadow"] | undefined,
): boolean {
  if (a === b) return true;
  return (
    (a?.color ?? "#000000") === (b?.color ?? "#000000")
    && (a?.opacity ?? 0.25) === (b?.opacity ?? 0.25)
    && (a?.lift ?? 0.05) === (b?.lift ?? 0.05)
    && (a?.maxExtend ?? 2000) === (b?.maxExtend ?? 2000)
    && (a?.parametric ?? false) === (b?.parametric ?? false)
    && (a?.definition ?? 16) === (b?.definition ?? 16)
    && (a?.dragDefinition ?? -1) === (b?.dragDefinition ?? -1)
    && (a?.style ?? "vector") === (b?.style ?? "vector")
    && (a?.followAnimation ?? false) === (b?.followAnimation ?? false)
  );
}
