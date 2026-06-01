/**
 * PolySceneContext — propagates scene-level rendering options
 * (textureLighting + lights) to descendants. PolyMesh / Poly children
 * inherit these as fallbacks when their own equivalent props are
 * undefined, so a helper rendered inside `<PolyScene textureLighting="dynamic">`
 * picks up the dynamic mode automatically (per-polygon normal vars + mask).
 */
import { createContext, useContext } from "react";
import type {
  PolyAmbientLight,
  PolyDirectionalLight,
  PolyTextureLightingMode,
  Polygon,
  Vec3,
} from "@layoutit/polycss-core";
import type { PolyRenderStrategiesOption, PolySeamBleed } from "./atlas";

/** Caster mesh data registered with the scene so other meshes (receivers)
 *  can run the receiver-shadow algorithm without traversing the React tree.
 *  Both registration and lookup go through the scene context's caster
 *  registry. */
export interface ShadowCasterRegistration {
  polygons: Polygon[];
  position: Vec3;
  scale: number | Vec3 | undefined;
  rotation: Vec3 | undefined;
  /** Polygon indices that have a valid atlas plan (= are actually rendered).
   *  Receiver-shadow algorithm skips polygons NOT in this set, mirroring
   *  vanilla which iterates `caster.rendered` (only rendered polys cast
   *  shadow). Undefined means "include all polygons" (used when the caller
   *  doesn't have plan information). */
  renderedPolygonIndices?: ReadonlySet<number>;
}

export interface ShadowOptions {
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

export interface PolySceneContextValue {
  textureLighting: PolyTextureLightingMode;
  directionalLight?: PolyDirectionalLight;
  ambientLight?: PolyAmbientLight;
  strategies?: PolyRenderStrategiesOption;
  seamBleed?: PolySeamBleed;
  shadow?: ShadowOptions;
  /**
   * Called by PolyMesh to register/unregister itself as a shadow caster.
   * Pass `null` to deregister (castShadow flipped off or unmount).
   * Casters expose their full transform + polygons so receiver meshes can
   * project the shadow into world space without re-traversing the tree.
   */
  registerShadowCaster?: (meshId: symbol, data: ShadowCasterRegistration | null) => void;
  /** All currently registered casters keyed by mesh symbol. Receivers iterate
   *  this to know what's in the scene. */
  shadowCasters?: Map<symbol, ShadowCasterRegistration>;
  /** Bumps every time a caster registers/unregisters/transforms so receivers
   *  re-compute via useMemo dependency. */
  shadowCastersVersion?: number;
  /** Whether at least one mesh has `receiveShadow={true}`. Tells caster
   *  meshes to drop their ground-shadow SVG (Three.js parity: only-
   *  receiver-paints-shadows when a real receiver exists). */
  hasShadowReceiver?: boolean;
  /** Receiver registration mirror. */
  registerShadowReceiver?: (meshId: symbol, registered: boolean) => void;
  /**
   * Computed CSS-Z of the shadow ground plane (= min world Z across all
   * casting meshes + scene.shadow.lift, in CSS pixels). Dynamic mode also
   * mirrors this into the `--shadow-ground-cssz` CSS var. Baked-mode
   * mesh code reads it directly to bake the inline `matrix3d(...)` on
   * each shadow leaf. `null` means there are no caster meshes yet.
   */
  groundCssZ?: number | null;
  /**
   * The `.polycss-scene` DOM element, available once mounted. Receivers
   * portal their per-face shadow SVGs into this element so the mesh
   * wrapper's `translate3d(position)` does NOT double-count the position
   * already baked into the SVG's `matrix3d(...)` (vanilla mounts shadows
   * at scene-root for the same reason). `null` before mount.
   */
  sceneEl?: HTMLDivElement | null;
}

export const PolySceneContext = createContext<PolySceneContextValue | null>(null);

export function usePolySceneContext(): PolySceneContextValue | null {
  return useContext(PolySceneContext);
}
