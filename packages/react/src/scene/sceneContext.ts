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
} from "@layoutit/polycss-core";
import type { PolyRenderStrategiesOption, PolySeamBleed } from "./atlas";

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
   * `polygons` is null when unregistering or when castShadow is false.
   */
  registerShadowCaster?: (meshId: symbol, polygons: Polygon[] | null) => void;
  /**
   * Computed CSS-Z of the shadow ground plane (= min world Z across all
   * casting meshes + scene.shadow.lift, in CSS pixels). Mesh shadow SVGs
   * read it directly when projecting caster geometry. Dynamic mode also
   * mirrors this into `--shadow-ground-cssz` for the retained internal
   * `<q>` shadow CSS path. `null` means there are no caster meshes yet.
   */
  groundCssZ?: number | null;
}

export const PolySceneContext = createContext<PolySceneContextValue | null>(null);

export function usePolySceneContext(): PolySceneContextValue | null {
  return useContext(PolySceneContext);
}
