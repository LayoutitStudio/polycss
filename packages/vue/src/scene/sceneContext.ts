/**
 * PolySceneContext — propagates scene-level rendering options
 * (textureLighting + lights) to descendants. PolyMesh / Poly children
 * inherit these as fallbacks when their own equivalent props are
 * undefined, so a helper rendered inside `<PolyScene texture-lighting="dynamic">`
 * picks up the dynamic mode automatically (per-polygon normal vars + mask).
 */
import { inject, type ComputedRef, type InjectionKey, type Ref } from "vue";
import type {
  PolyAmbientLight,
  PolyDirectionalLight,
  PolyTextureLightingMode,
  Polygon,
  Vec3,
} from "@layoutit/polycss-core";
import type { PolyRenderStrategiesOption, PolySeamBleed } from "./atlas";

/** Caster mesh data registered with the scene so receiver meshes can run
 *  the receiver-shadow algorithm without traversing the Vue component tree. */
export interface ShadowCasterRegistration {
  polygons: Polygon[];
  position: Vec3;
  scale: number | Vec3 | undefined;
  rotation: Vec3 | undefined;
}

export interface PolyShadowOptions {
  color?: string;
  opacity?: number;
  lift?: number;
  /**
   * Maximum CSS pixels the shadow may extend beyond the mesh's
   * footprint. Caps the SVG backing store at low light elevations to
   * prevent repaint flicker. Default: `2000`. Pass `Infinity` to
   * disable the cap entirely.
   */
  maxExtend?: number;
}

export interface PolyShadowRegistry {
  /** Register a casting mesh's full data getter. Pass `null` to unregister. */
  register(id: symbol, getData: () => ShadowCasterRegistration): void;
  /** Unregister a casting mesh on unmount or castShadow toggle. */
  unregister(id: symbol): void;
  /** Reactive signal that increments whenever the registry changes. */
  version: Ref<number>;
  /** Snapshot of all registered caster data getters. */
  getEntries(): Array<() => ShadowCasterRegistration>;
}

export interface PolyReceiverRegistry {
  register(id: symbol): void;
  unregister(id: symbol): void;
  hasAny: Ref<boolean>;
}

export interface PolySceneContextValue {
  textureLighting: PolyTextureLightingMode;
  directionalLight?: PolyDirectionalLight;
  ambientLight?: PolyAmbientLight;
  strategies?: PolyRenderStrategiesOption;
  seamBleed?: PolySeamBleed;
  shadow?: PolyShadowOptions;
  shadowRegistry?: PolyShadowRegistry;
  receiverRegistry?: PolyReceiverRegistry;
  /**
   * Computed CSS-Z of the shadow ground plane (= min world Z across all
   * casting meshes + scene.shadow.lift, in CSS pixels). Dynamic mode also
   * mirrors this into `--shadow-ground-cssz`. Baked mode reads it here to
   * bake the inline `matrix3d(...)` on each shadow leaf. `null` when no
   * casting meshes are registered.
   */
  groundCssZ?: number | null;
}

/**
 * The provided value is a `ComputedRef` so children stay reactive when the
 * scene's textureLighting / lights props change at runtime.
 */
export const PolySceneContextKey: InjectionKey<ComputedRef<PolySceneContextValue>> = Symbol(
  "polycss/scene-context",
);

export function usePolySceneContext(): ComputedRef<PolySceneContextValue> | null {
  return inject(PolySceneContextKey, null);
}
