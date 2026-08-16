/**
 * useMeshLighting — baked/dynamic light resolution against the scene
 * context (effective texture options, per-mesh dynamic light var override,
 * baked directional/point lights in the mesh-local frame). Extracted
 * verbatim from PolyMesh.tsx.
 */
import { useMemo, useState } from "react";
import type { CSSProperties } from "react";
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
import type { PolySeamBleed, SolidPaintDefaults } from "../atlas";
import type { PolySceneContextValue } from "../sceneContext";

export function solidPaintVars(defaults: SolidPaintDefaults): CSSProperties | null {
  const out: Record<string, string> = {};
  if (defaults.paintColor) out["--polycss-paint"] = defaults.paintColor;
  if (defaults.dynamicColor) {
    out["--psr"] = (defaults.dynamicColor.r / 255).toFixed(4);
    out["--psg"] = (defaults.dynamicColor.g / 255).toFixed(4);
    out["--psb"] = (defaults.dynamicColor.b / 255).toFixed(4);
  }
  return Object.keys(out).length > 0 ? out as CSSProperties : null;
}

export type MeshLighting = ReturnType<typeof useMeshLighting>;

export interface UseMeshLightingOptions {
  sceneCtx: PolySceneContextValue | null;
  textureLighting?: PolyTextureLightingMode;
  textureLeafSizing?: PolyTextureLeafSizing;
  textureImageRendering?: PolyTextureImageRendering;
  textureBackend?: PolyTextureBackend;
  textureProjection?: PolyTextureProjection;
  seamBleed?: PolySeamBleed;
  position?: Vec3;
  rotation?: Vec3;
}

export function useMeshLighting({
  sceneCtx,
  textureLighting,
  textureLeafSizing,
  textureImageRendering,
  textureBackend,
  textureProjection,
  seamBleed,
  position,
  rotation,
}: UseMeshLightingOptions) {
  // Inherit textureLighting + lights from the parent <PolyScene> so that
  // helper polygons (e.g. light marker octahedron) participate in the
  // scene's dynamic mode instead of getting overpainted by the scene's
  // global CSS rule with default normals.
  const effectiveTextureLighting = textureLighting ?? sceneCtx?.textureLighting ?? "baked";
  const effectiveStrategies = sceneCtx?.strategies;
  const disabledStrategies = useMemo(
    () => effectiveStrategies?.disable?.length ? new Set(effectiveStrategies.disable) : undefined,
    [effectiveStrategies],
  );
  const effectiveSeamBleed = seamBleed ?? sceneCtx?.seamBleed ?? DEFAULT_SEAM_BLEED;
  const effectiveTextureLeafSizing = textureLeafSizing ?? sceneCtx?.textureLeafSizing;
  const effectiveTextureImageRendering = textureImageRendering ?? sceneCtx?.textureImageRendering;
  const effectiveTextureBackend = textureBackend ?? sceneCtx?.textureBackend;
  const effectiveTextureProjection = textureProjection ?? sceneCtx?.textureProjection;
  // Always forward the scene's lights to atlas plan, including in dynamic
  // mode. Vanilla passes the (CSS-frame) directional light to its render
  // pipeline in every mode — the dynamic-mode atlas doesn't bake Lambert
  // into pixels, but buildBasisHints' seamLightBrightness still needs the
  // light vector, and computeTextureAtlasPlan computes shadedColor for the
  // fallback paint. Earlier React gated this on textureLighting === "dynamic"
  // which stripped the light, broke buildBasisHints' seam classification,
  // and visually transposed the cornerShape <u> matrix3d output vs vanilla.
  const effectiveDirectional = sceneCtx?.directionalLight;
  const effectiveAmbient = sceneCtx?.ambientLight;

  // `bakedRotation` is the rotation that was in effect when the atlas was
  // last rasterized. It starts equal to the initial `rotation` prop and
  // only advances when `rebakeAtlas()` is called (e.g. on rotate-drag
  // release). This decouples the smooth CSS wrapper transform (live
  // `rotation`) from the atlas baker, so we don't re-bake every frame
  // during a drag.
  const [bakedRotation, setBakedRotation] = useState<Vec3 | undefined>(rotation);

  // Dynamic-mode rotation fix: when the mesh has a non-zero rotation the
  // world-space light vars cascaded from <PolyScene> are wrong for the
  // per-polygon Lambert calc (which uses mesh-local normals). Override
  // --plx/ly/lz on the mesh wrapper with the light direction
  // inverse-rotated into the mesh's local frame. CSS cascade ensures the
  // override only affects this mesh's polygons. No debounce — CSS var
  // writes are cheap and this must track rotation in real time.
  const sceneDirectionalLight = sceneCtx?.directionalLight;
  const dynamicLightOverride = useMemo<CSSProperties | null>(() => {
    if (effectiveTextureLighting !== "dynamic") return null;
    if (!rotation || (rotation[0] === 0 && rotation[1] === 0 && rotation[2] === 0)) return null;
    if (!sceneDirectionalLight) return null;
    const dir = sceneDirectionalLight.direction;
    const localDir = inverseRotateVec3(dir, rotation);
    const len = Math.hypot(localDir[0], localDir[1], localDir[2]) || 1;
    // Quantize to 0.01 — matches H10 in PolyScene + vanilla lightingVars.
    return {
      ["--plx" as string]: (localDir[0] / len).toFixed(2),
      ["--ply" as string]: (localDir[1] / len).toFixed(2),
      ["--plz" as string]: (localDir[2] / len).toFixed(2),
    };
  }, [effectiveTextureLighting, rotation, sceneDirectionalLight]);

  // Compute the effective light direction for baking. If the mesh has been
  // rotated since mount (bakedRotation), inverse-rotate the world-space
  // light direction into the mesh's local frame so the Lambert dot product
  // stays correct: dot(localNormal, localLight) === dot(worldNormal, worldLight).
  const bakedDirectional = useMemo(() => {
    if (!effectiveDirectional) return effectiveDirectional;
    const rot = bakedRotation ?? [0, 0, 0] as Vec3;
    // Vanilla applies a world→CSS axis swap (x↔y) on the directional light
    // before passing it to renderPolygonsWithTextureAtlas — the polygon
    // basis stores normals in the CSS frame, so light vectors must match
    // before any dot product. React/Vue mirror that here so buildBasisHints
    // and computeTextureAtlasPlan see the same light vector vanilla sees.
    const cssLight = worldDirectionalLightToCss(effectiveDirectional);
    if (rot[0] === 0 && rot[1] === 0 && rot[2] === 0) return cssLight;
    return {
      ...cssLight,
      direction: inverseRotateVec3(cssLight.direction, rot),
    };
  }, [effectiveDirectional, bakedRotation]);

  // Point lights → mesh-local frame (subtract mesh position, inverse-rotate),
  // mirroring vanilla's localPointLightsForEntry. The atlas plan applies the
  // CSS axis-swap itself, so we pass mesh-local USER coords here.
  const bakedPointLights = useMemo(() => {
    const pls = sceneCtx?.pointLights;
    if (!pls || pls.length === 0) return undefined;
    const pos = (position ?? [0, 0, 0]) as Vec3;
    const rot = bakedRotation ?? ([0, 0, 0] as Vec3);
    const hasRot = rot[0] !== 0 || rot[1] !== 0 || rot[2] !== 0;
    return pls.map((pl) => {
      const rel: Vec3 = [pl.position[0] - pos[0], pl.position[1] - pos[1], pl.position[2] - pos[2]];
      const local = hasRot ? inverseRotateVec3(rel, rot) : rel;
      return { ...pl, position: local };
    });
  }, [sceneCtx?.pointLights, position, bakedRotation]);

  // Per-light occlusion raytrace (task #121) used to mark polygons in
  // ray-traced shadow with `directScale=0` so they baked at ambient-only.
  // Three.js doesn't bake shadow into the diffuse atlas — the real shadow
  // map darkens occluded geometry at render time, so a "in shadow" polygon's
  // diffuse stays at full Lambert(n·L). Vanilla disabled this in createPoly-
  // Scene.ts:1162 for three.js parity (see "rock1 baked-mode" divergence).
  const lightOccludedPolyIndices: ReadonlySet<number> | undefined = undefined;

  return {
    effectiveTextureLighting,
    effectiveStrategies,
    disabledStrategies,
    effectiveSeamBleed,
    effectiveTextureLeafSizing,
    effectiveTextureImageRendering,
    effectiveTextureBackend,
    effectiveTextureProjection,
    effectiveAmbient,
    bakedRotation,
    setBakedRotation,
    dynamicLightOverride,
    bakedDirectional,
    bakedPointLights,
    lightOccludedPolyIndices,
  };
}
