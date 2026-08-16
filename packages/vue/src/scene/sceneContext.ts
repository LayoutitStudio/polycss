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
  PolyPointLight,
  PolyTextureBackend,
  PolyTextureImageRendering,
  PolyTextureLeafSizing,
  PolyTextureLightingMode,
  PolyTextureProjection,
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
  /** Polygon indices that have a valid atlas plan (= are actually rendered).
   *  Receiver-shadow algorithm skips polygons NOT in this set — mirrors
   *  vanilla which iterates `caster.rendered`. Undefined → include all. */
  renderedPolygonIndices?: ReadonlySet<number>;
  /** Per-mesh parametric-shadow definition override (scene default when
   *  undefined). Mirrors `PolyMeshTransform.shadowDefinition` in vanilla. */
  shadowDefinition?: number;
}

export interface PolyShadowOptions {
  color?: string;
  opacity?: number;
  /**
   * Raises the shadow plane along +Z (world units) so it clears the surface
   * beneath it. Defaults to `POLY_DEFAULT_SHADOW_LIFT` (`0.05`) on both the
   * ground-plane fallback path and the receiver-face (`receiveShadow`) path.
   */
  lift?: number;
  /**
   * Maximum CSS pixels the shadow may extend beyond the mesh's
   * footprint. Caps the SVG backing store at low light elevations to
   * prevent repaint flicker. Default: `2000`. Pass `Infinity` to
   * disable the cap entirely.
   */
  maxExtend?: number;
  /**
   * Cast a low-resolution parametric silhouette per caster instead of full
   * geometry — lighter DOM + cheaper projection. Directional + point lights.
   * Default: `false`.
   */
  parametric?: boolean;
  /**
   * Parametric-shadow detail (max silhouette points / pixel-grid resolution).
   * Only used when `parametric` is true. Default: `16`. Override per mesh via
   * `<poly-mesh shadow-definition>`.
   */
  definition?: number;
  /**
   * Parametric render style: `"vector"` (smooth contour, default) or `"pixel"`
   * (greedy-meshed voxel blocks; `definition` becomes the grid resolution).
   */
  style?: "vector" | "pixel";
  /**
   * Re-emit a caster's shadow while it animates (deforms) so the shadow follows
   * the pose instead of freezing. Default `false`: a same-topology deform keeps
   * the last shadow pose (re-emitting every frame is expensive). Best with
   * `parametric`. Topology changes (different polygon count) always re-emit.
   */
  followAnimation?: boolean;
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
  pointLights?: PolyPointLight[];
  ambientLight?: PolyAmbientLight;
  strategies?: PolyRenderStrategiesOption;
  seamBleed?: PolySeamBleed;
  textureLeafSizing?: PolyTextureLeafSizing;
  textureImageRendering?: PolyTextureImageRendering;
  textureBackend?: PolyTextureBackend;
  textureProjection?: PolyTextureProjection;
  shadow?: PolyShadowOptions;
  shadowRegistry?: PolyShadowRegistry;
  receiverRegistry?: PolyReceiverRegistry;
  /**
   * Computed CSS-Z of the shadow ground plane (= min world Z across all
   * casting meshes + scene.shadow.lift, in CSS pixels). Mesh shadow SVGs
   * read it directly when projecting caster geometry. Dynamic mode also
   * mirrors this into `--shadow-ground-cssz` for the retained internal
   * `<q>` shadow CSS path. `null` when no casting meshes are registered.
   */
  groundCssZ?: number | null;
  /**
   * The `.polycss-scene` DOM element, available once mounted. Receivers
   * teleport their per-face shadow SVGs into this element so the mesh
   * wrapper's `translate3d(position)` does NOT double-count the position
   * already baked into the SVG's `matrix3d(...)` (vanilla mounts shadows
   * at scene-root for the same reason). `null` before mount.
   */
  sceneEl?: HTMLElement | null;
}

/**
 * The provided value is a `ComputedRef` so children stay reactive when the
 * scene's textureLighting / lights props change at runtime.
 */
export const PolySceneContextKey: InjectionKey<ComputedRef<PolySceneContextValue>> = Symbol(
  "polycss/scene-context",
);

export function useSceneContextValue(): ComputedRef<PolySceneContextValue> | null {
  return inject(PolySceneContextKey, null);
}
