/**
 * useMeshLighting — baked/dynamic light resolution against the scene
 * context (effective texture options, per-mesh dynamic light var override,
 * baked directional/point lights in the mesh-local frame). Extracted
 * verbatim from PolyMesh.ts.
 */
import { computed, ref } from "vue";
import type { ComputedRef, CSSProperties } from "vue";
import type {
  PolyTextureBackend,
  PolyTextureImageRendering,
  PolyTextureLeafSizing,
  PolyTextureLightingMode,
  PolyTextureProjection,
  Vec3,
} from "@layoutit/polycss-core";
import {
  DEFAULT_SEAM_BLEED,
  inverseRotateVec3,
  worldDirectionalLightToCss,
} from "@layoutit/polycss-core";
import type { PolySeamBleed, SolidPaintDefaults, TextureQuality } from "../atlas";
import type { PolySceneContextValue } from "../sceneContext";

export function solidPaintVars(defaults: SolidPaintDefaults): CSSProperties | null {
  const out: CSSProperties = {};
  if (defaults.paintColor) out["--polycss-paint"] = defaults.paintColor;
  if (defaults.dynamicColor) {
    out["--psr"] = (defaults.dynamicColor.r / 255).toFixed(4);
    out["--psg"] = (defaults.dynamicColor.g / 255).toFixed(4);
    out["--psb"] = (defaults.dynamicColor.b / 255).toFixed(4);
  }
  return Object.keys(out).length > 0 ? out : null;
}

export type MeshLighting = ReturnType<typeof useMeshLighting>;

export interface MeshLightingProps {
  textureLighting?: PolyTextureLightingMode;
  textureQuality?: TextureQuality;
  textureLeafSizing?: PolyTextureLeafSizing;
  textureImageRendering?: PolyTextureImageRendering;
  textureBackend?: PolyTextureBackend;
  textureProjection?: PolyTextureProjection;
  seamBleed?: PolySeamBleed;
  position?: Vec3;
  rotation?: Vec3;
}

export function useMeshLighting(
  props: MeshLightingProps,
  sceneCtx: ComputedRef<PolySceneContextValue> | null,
) {
  const atlasTextureLighting = computed<PolyTextureLightingMode>(
    () => props.textureLighting ?? sceneCtx?.value.textureLighting ?? "baked",
  );
  const atlasStrategies = computed(() => sceneCtx?.value.strategies);
  const atlasSeamBleed = computed(() => props.seamBleed ?? sceneCtx?.value.seamBleed ?? DEFAULT_SEAM_BLEED);
  const atlasTextureLeafSizing = computed(() => props.textureLeafSizing ?? sceneCtx?.value.textureLeafSizing);
  const atlasTextureImageRendering = computed(() => props.textureImageRendering ?? sceneCtx?.value.textureImageRendering);
  const atlasTextureBackend = computed(() => props.textureBackend ?? sceneCtx?.value.textureBackend);
  const atlasTextureProjection = computed(() => props.textureProjection ?? sceneCtx?.value.textureProjection);
  // Always forward the scene's lights to atlas plan, including in dynamic
  // mode (vanilla parity — see React PolyMesh comment).
  const atlasDirectional = computed(() => sceneCtx?.value.directionalLight);
  const atlasPointLights = computed(() => sceneCtx?.value.pointLights);
  const atlasAmbient = computed(() => sceneCtx?.value.ambientLight);

  // Dynamic lighting override: when textureLighting is "dynamic" AND the
  // mesh has a non-zero rotation, we emit overridden --plx/ly/lz
  // vars on the wrapper. The scene emits world-space light vars; polygons
  // use local-space normals for the Lambert dot product, so when a mesh
  // rotates, we must supply the light direction in the mesh-local frame
  // via inverseRotateVec3. Cascade rules mean these vars shadow the scene-
  // level values only for this mesh's polygons.
  const dynamicLightOverride = computed<Record<string, string> | null>(() => {
    if (atlasTextureLighting.value !== "dynamic") return null;
    const rot = props.rotation;
    if (!rot || (rot[0] === 0 && rot[1] === 0 && rot[2] === 0)) return null;
    const dir = sceneCtx?.value.directionalLight?.direction;
    if (!dir) return null;
    const localDir = inverseRotateVec3(dir, rot);
    const len = Math.hypot(localDir[0], localDir[1], localDir[2]) || 1;
    // Quantize to 0.01 — matches H10 in PolyScene + vanilla lightingVars.
    return {
      "--plx": (localDir[0] / len).toFixed(2),
      "--ply": (localDir[1] / len).toFixed(2),
      "--plz": (localDir[2] / len).toFixed(2),
    };
  });

  // bakedRotation is the rotation snapshot used by the atlas baker.
  // It only advances when rebakeAtlas() is called (or on initial mount),
  // NOT on every prop change — that would rebake every frame during a drag.
  // The visual wrapper uses the live `rotation` prop (smooth feedback);
  // the atlas uses bakedRotation (jumps to current rotation on release).
  const bakedRotation = ref<Vec3 | undefined>(props.rotation);

  const bakedDirectional = computed(() => {
    const baseLight = atlasDirectional.value;
    if (!baseLight) return baseLight;
    // Vanilla applies a world→CSS axis swap (x↔y) on the directional
    // light before passing it to renderPolygonsWithTextureAtlas — the
    // polygon basis stores normals in the CSS frame, so light vectors
    // must match before any dot product. Vue mirrors that here so
    // buildBasisHints and computeTextureAtlasPlan see the same light
    // vector vanilla sees.
    const cssLight = worldDirectionalLightToCss(baseLight);
    if (!bakedRotation.value) return cssLight;
    return { ...cssLight, direction: inverseRotateVec3(cssLight.direction, bakedRotation.value) };
  });

  // Point lights converted to mesh-local USER coords (plan.ts applies the
  // CSS x↔y swap). Mirrors bakedDirectional + vanilla's
  // localPointLightsForEntry: subtract mesh position, then inverse-rotate
  // into the mesh's local frame so per-face Lambert matches the rendered
  // orientation.
  const bakedPointLights = computed(() => {
    const pls = atlasPointLights.value;
    if (!pls || pls.length === 0) return undefined;
    const pos = (props.position ?? [0, 0, 0]) as Vec3;
    const rot = bakedRotation.value ?? ([0, 0, 0] as Vec3);
    const hasRot = rot[0] !== 0 || rot[1] !== 0 || rot[2] !== 0;
    return pls.map((pl) => {
      const rel: Vec3 = [
        pl.position[0] - pos[0],
        pl.position[1] - pos[1],
        pl.position[2] - pos[2],
      ];
      const local = hasRot ? inverseRotateVec3(rel, rot) : rel;
      return { ...pl, position: local };
    });
  });

  // Per-light occlusion raytrace (task #121) used to mark polygons in
  // ray-traced shadow with `directScale=0` so they baked at ambient-only.
  // Three.js doesn't bake shadow into the diffuse atlas — the real shadow
  // map darkens occluded geometry at render time, so a "in shadow"
  // polygon's diffuse stays at full Lambert(n·L). Vanilla disabled this
  // in createPolyScene.ts:1162 for three.js parity.
  const lightOccludedPolyIndices: ReadonlySet<number> | undefined = undefined;

  return {
    atlasTextureLighting,
    atlasStrategies,
    atlasSeamBleed,
    atlasTextureLeafSizing,
    atlasTextureImageRendering,
    atlasTextureBackend,
    atlasTextureProjection,
    atlasDirectional,
    atlasPointLights,
    atlasAmbient,
    dynamicLightOverride,
    bakedRotation,
    bakedDirectional,
    bakedPointLights,
    lightOccludedPolyIndices,
  };
}
