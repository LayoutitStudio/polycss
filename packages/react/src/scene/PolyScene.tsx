import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import type {
  Polygon,
  PolyDirectionalLight,
  PolyPointLight,
  PolyAmbientLight,
  PolyTextureBackend,
  PolyTextureImageRendering,
  PolyTextureLeafSizing,
  PolyTextureLightingMode,
  PolyTextureProjection,
} from "@layoutit/polycss-core";
import {
  BASE_TILE,
  DEFAULT_SEAM_BLEED,
  resolveSeamBleedPx,
  parseHexColor,
  resolvePolyTextureLeafGeometry,
  worldDirectionToCss,
  POLY_DEFAULT_SHADOW_LIFT,
} from "@layoutit/polycss-core";
import type { ShadowCasterRegistration, ShadowOptions } from "./sceneContext";
import { useCameraContext } from "../camera/context";
import { usePolySceneContext } from "./useSceneContext";
import { injectPolyBaseStyles } from "../styles/styles";
import type { TransformProps } from "../shapes/types";
import {
  buildSeamBleedPolygonEdges,
  buildTextureEdgeRepairSets,
  computeTextureAtlasPlan,
  isProjectiveQuadPlan,
  isSolidTrianglePlan,
  type TextureQuality,
  type PolySeamBleed,
  type PolyRenderStrategiesOption,
  TextureBorderShapePoly,
  TextureAtlasPoly,
  TextureImagePoly,
  TextureProjectiveSolidPoly,
  TextureTrianglePoly,
  useTextureAtlas,
} from "./atlas";
import { PolySceneContext } from "./sceneContext";

export interface PolySceneProps extends TransformProps {
  /** Polygons to render. Composes additively with `children`. */
  polygons?: Polygon[];
  /**
   * Polygons used ONLY for the `autoCenter` bbox computation. When provided,
   * the autoCenter translate is derived from this list instead of `polygons`.
   *
   * Use this when the scene's renderable polygons live inside a child
   * `<PolyMesh>` (e.g. in selection mode) rather than in `polygons`. Passing
   * the full mesh polygon list here ensures the autoCenter wrapper shifts
   * all children — including helpers like `<PolyAxesHelper>` — by the same
   * -bboxCenter amount as the vanilla renderer's `centerWrapper`. Without it,
   * `autoCenter` computes its bbox from an empty `polygons=[]` and produces
   * no shift, so helpers stay at world origin while the mesh is recentered by
   * PolyMesh's own `autoCenter`.
   */
  centerPolygons?: Polygon[];
  perspective?: number;
  rotX?: number;
  rotY?: number;
  zoom?: number;
  directionalLight?: PolyDirectionalLight;
  /** Point lights (world-space positions). Direction-only per-face Lambert,
   *  baked-mode only. */
  pointLights?: PolyPointLight[];
  ambientLight?: PolyAmbientLight;
  /** Textured polygon lighting mode. Defaults to "baked". */
  textureLighting?: PolyTextureLightingMode;
  /** Atlas bitmap budget and CSS sprite size. `"auto"` (default) uses a
   *  device-appropriate memory budget (~4 MB mobile / ~16 MB desktop) and
   *  desktop/mobile sprite sizing. Numeric values 0.1..1 force an explicit
   *  raster scale and the 64px sprite. */
  textureQuality?: TextureQuality;
  /** Atlas leaf CSS primitive sizing. Defaults to canonical browser-fast sizing. */
  textureLeafSizing?: PolyTextureLeafSizing;
  /** Default image filtering for atlas and direct image texture leaves. */
  textureImageRendering?: PolyTextureImageRendering;
  /** Default texture backend request. Defaults to "auto". */
  textureBackend?: PolyTextureBackend;
  /** Default texture projection request. Defaults to "affine". */
  textureProjection?: PolyTextureProjection;
  /** Solid seam overscan in CSS px (no upper clamp; each edge is still fitted to the polygon plan). `"auto"`/omitted = the 1.5px default; `0` disables every bleed; sub-1.5 values also shrink per-strategy primitive bleeds proportionally. */
  seamBleed?: PolySeamBleed;
  /**
   * Render strategy overrides. Use `{ disable: ["u"] }` to force solid
   * triangles through the atlas path (`<s>`), or `{ disable: ["b", "i", "u"] }`
   * to force every polygon through the atlas. Mirrors the same option on
   * `renderPolygonsWithTextureAtlas` in `@layoutit/polycss`.
   */
  strategies?: PolyRenderStrategiesOption;
  /**
   * When `true`, rotation pivots around the mesh's bbox center instead of
   * world (0,0,0). Polygon data is not mutated — the scene element's
   * `transform-origin` is moved to the bbox center in CSS. Equivalent to
   * setting Three.js's `OrbitControls.target` to the mesh centroid. Off
   * by default to match Three.js: meshes load at their authored origin
   * unless the user opts in. Use this for loaded OBJ/GLB assets whose
   * origin is at a corner / feet / arbitrary point.
   */
  autoCenter?: boolean;
  /**
   * Shadow appearance for meshes with `castShadow={true}`. Works in both
   * lighting modes. Shadows emit as SVG paths and reproject when light,
   * ground, or mesh geometry changes. Defaults:
   * `{ color: "#000000", opacity: 0.25, lift: 0.05, maxExtend: 2000 }`.
   */
  shadow?: ShadowOptions;
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;

  // Debug toggles retained for external tooling.
  debugShowLabels?: boolean;
  debugShowBackfaces?: boolean;
}

function PolySceneInner({
  polygons: polygonsProp,
  centerPolygons: centerPolygonsProp,
  perspective: _perspective,
  rotX: _rotX,
  rotY: _rotY,
  zoom: _zoom,
  directionalLight,
  pointLights,
  ambientLight,
  textureLighting = "baked",
  textureQuality,
  textureLeafSizing,
  textureImageRendering,
  textureBackend,
  textureProjection,
  seamBleed = DEFAULT_SEAM_BLEED,
  strategies,
  autoCenter = false,
  shadow,
  className,
  style,
  children,
  position: _position,
  scale: _scale,
  rotation: _rotation,
  debugShowLabels: _debugShowLabels,
  debugShowBackfaces,
}: PolySceneProps) {
  const { store, sceneElRef, applyTransformDirect } = useCameraContext();
  const [sceneEl, setSceneEl] = useState<HTMLDivElement | null>(null);

  const localSceneRef = useCallback(
    (el: HTMLDivElement | null) => {
      sceneElRef.current = el;
      setSceneEl(el);
    },
    [sceneElRef]
  );

  // Retain the debug class for external tooling. The atlas renderer no longer
  // emits separate backface elements.
  useEffect(() => {
    const el = sceneElRef.current;
    if (!el) return;
    el.classList.toggle("polycss-debug-show-backfaces", !!debugShowBackfaces);
  }, [debugShowBackfaces, sceneElRef]);

  // Inject base styles once
  const injectedRef = useRef(false);
  useEffect(() => {
    if (injectedRef.current) return;
    if (typeof document !== "undefined") {
      injectPolyBaseStyles(document);
      injectedRef.current = true;
    }
  }, []);

  // Resolve polygons input. Empty array if none provided so useSceneContext
  // still computes a sane (empty) sceneBbox.
  const inputPolygons = useMemo(() => polygonsProp ?? [], [polygonsProp]);

  // centerPolygons, if provided, is used ONLY for the autoCenter bbox.
  // This lets the caller put the renderable polygons inside a child PolyMesh
  // (for selection interactivity) while still centering all children — including
  // helpers like <PolyAxesHelper> — around the correct bbox.
  const centerInputPolygons = useMemo(
    () => centerPolygonsProp ?? null,
    [centerPolygonsProp],
  );

  // Run mesh post-processing pipeline (normalize + automatic merge).
  const { polygons, sceneBbox: renderSceneBbox } = usePolySceneContext(inputPolygons, {
    directionalLight,
  });

  // Bbox for autoCenter: prefer centerPolygons (if provided) over the render
  // polygon bbox. centerPolygons are NOT normalized/merged here — they're used
  // raw for bbox so the shift matches the vanilla renderer (which also uses
  // raw merged polygons, not normalized ones, for its centerWrapper calc).
  const { sceneBbox: centerSceneBbox } = usePolySceneContext(
    centerInputPolygons ?? inputPolygons,
    { directionalLight },
  );
  const sceneBbox = centerInputPolygons ? centerSceneBbox : renderSceneBbox;

  // Per-polygon context: lighting + scene units. In dynamic mode the
  // atlas is light-independent (CSS does the shading), so we deliberately
  // drop both lights from the plan inputs — that prevents the atlas from
  // rebuilding (and the polygons from blanking) every time the user moves
  // a light slider.
  const directionalForAtlas = textureLighting === "dynamic" ? undefined : directionalLight;
  const ambientForAtlas = textureLighting === "dynamic" ? undefined : ambientLight;
  // Scene-level polygons sit at world origin (no mesh transform), so point
  // lights pass through in world coords. Baked-mode only.
  const pointLightsForAtlas = textureLighting === "dynamic" ? undefined : pointLights;
  const polyContext = useMemo(() => {
    const tileSize = 50;
    return {
      tileSize,
      layerElevation: tileSize,
      directionalLight: directionalForAtlas,
      pointLights: pointLightsForAtlas,
      ambientLight: ambientForAtlas,
      textureLighting,
      seamBleed,
    };
  }, [directionalForAtlas, pointLightsForAtlas, ambientForAtlas, textureLighting, seamBleed]);

  // Bbox center of all auto-centerable meshes in world coords. Kept as a Vec3
  // so it can be added to `target` inside the scene transform — same
  // approach as vanilla's buildSceneTransform. This
  // means the camera orbits `target + autoCenterOffset` with no extra DOM layer.
  // World axes: [0]=X, [1]=Y, [2]=Z. autoCenterOffset is [0,0,0] when disabled.
  const autoCenterOffset = useMemo((): [number, number, number] => {
    if (!autoCenter) return [0, 0, 0];
    return [
      (sceneBbox.min[0] + sceneBbox.max[0]) / 2,
      (sceneBbox.min[1] + sceneBbox.max[1]) / 2,
      (sceneBbox.min[2] + sceneBbox.max[2]) / 2,
    ];
  }, [autoCenter, sceneBbox]);

  // Push the current autoCenterOffset into the store so applyTransformDirect
  // (called by controls during drag, bypassing React render) uses the same offset.
  useLayoutEffect(() => {
    store.setAutoCenterOffset(autoCenterOffset);
    applyTransformDirect();
  }, [store, autoCenterOffset, applyTransformDirect]);

  // Scene transform is applied imperatively via applyTransformDirect (below),
  // not via React's style prop. This prevents Concurrent Mode from committing
  // a stale snapshot-time transform and overwriting the current DOM value that
  // applyTransformDirect wrote on the previous rAF tick — which is the root
  // cause of the baked-shapes flicker on solid-triangle meshes (always visible,
  // unlike atlas <s> elements which hide behind opacity:0 until loaded).
  //
  // useLayoutEffect (no deps) fires synchronously after every commit, before
  // the browser paints, ensuring the scene element always reflects the current
  // camera state regardless of when React chose to schedule the render.
  useLayoutEffect(() => {
    applyTransformDirect();
  });

  const computedClassName = `polycss-scene${className ? ` ${className}` : ""}`;

  const textureAtlasPlans = useMemo(
    () => {
      const repairEdges = buildTextureEdgeRepairSets(polygons);
      // Core owns seamBleed resolution (resolveSeamBleedPx): "auto"/undefined
      // → the 1.5px default, numbers are absolute px. Skip the seam-edge map
      // only when the resolved overscan is 0.
      const seamBleedEdges = resolveSeamBleedPx(seamBleed) > 0
        ? buildSeamBleedPolygonEdges(polygons, {
            tileSize: polyContext.tileSize,
            layerElevation: polyContext.layerElevation,
            directionalLight: directionalForAtlas,
            ambientLight: ambientForAtlas,
          })
        : null;
      return polygons.map((p, i) => computeTextureAtlasPlan(p, i, {
        ...polyContext,
        seamBleed,
        seamEdges: seamBleedEdges?.get(i),
        textureEdgeRepairEdges: repairEdges[i],
      }));
    },
    [polygons, polyContext, seamBleed, directionalForAtlas, ambientForAtlas],
  );
  const textureAtlas = useTextureAtlas(
    textureAtlasPlans,
    textureLighting,
    textureQuality,
    textureLeafSizing,
    textureBackend,
    textureImageRendering,
    textureProjection,
    strategies,
  );

  // Dynamic mode plumbing: emit normalized light direction + light/ambient
  // color/intensity as CSS custom properties on the scene root. They
  // cascade into every polygon, where a per-element calc resolves the
  // Lambert dot product and tints via background-blend-mode.
  //
  // Also emits --clx/--cly/--clz: the light direction in CSS coordinate space
  // (matches the convention in vanilla's applyDynamicLightVars — NO axis swap
  // relative to --plx/--ply/--plz). Retained internal <q> projection CSS uses
  // these vars. --clz is clamped away from zero to avoid divide-by-zero when
  // the light is near-horizontal.
  const dynamicLightVars = useMemo<CSSProperties | null>(() => {
    if (textureLighting !== "dynamic") return null;
    // The user-supplied light direction is in world frame (+X right, +Y
    // forward, +Z up). Polygon normals (--pnx/--pny/--pnz) are in CSS frame
    // (CSS-X = world-Y, CSS-Y = world-X), so the Lambert dot product
    // requires the light vector in the same CSS frame. Vanilla applies
    // worldDirectionToCss inside applyLightingVars; React+Vue must do the
    // same or the lighting cancels out wrongly at off-axis light angles.
    const userDir = directionalLight?.direction ?? [0.4, -0.7, 0.59];
    const dir = worldDirectionToCss(userDir as [number, number, number]);
    const len = Math.hypot(dir[0], dir[1], dir[2]) || 1;
    const lx = dir[0] / len, ly = dir[1] / len, lz = dir[2] / len;
    const lightRgb = parseHexColor(directionalLight?.color ?? "#ffffff")?.rgb ?? [255, 255, 255];
    const ambRgb = parseHexColor(ambientLight?.color ?? "#ffffff")?.rgb ?? [255, 255, 255];
    const lightIntensity = directionalLight?.intensity ?? 1;
    const ambientIntensity = ambientLight?.intensity ?? 0.4;
    const ch = (n: number) => (n / 255).toFixed(4);
    const rawClz = lz;
    const clz = Math.sign(rawClz || 1) * Math.max(Math.abs(rawClz), 0.01);
    // Quantize direction-derived vars to 0.01 (~0.57° angular resolution).
    // Matches the vanilla H10 fix in scene/lightingVars.ts: at toFixed(4)
    // every 0.5°/frame drag tick wrote new strings, triggering ~53ms style
    // recalc on dynamic-mode leaves with calc()-driven Lambert. At
    // toFixed(2) ~half of drag ticks land on the same rounded value →
    // React's diff sees no prop change → no recalc.
    return {
      ["--plx" as string]: lx.toFixed(2),
      ["--ply" as string]: ly.toFixed(2),
      ["--plz" as string]: lz.toFixed(2),
      ["--plr" as string]: ch(lightRgb[0]),
      ["--plg" as string]: ch(lightRgb[1]),
      ["--plb" as string]: ch(lightRgb[2]),
      ["--pli" as string]: lightIntensity.toFixed(4),
      ["--par" as string]: ch(ambRgb[0]),
      ["--pag" as string]: ch(ambRgb[1]),
      ["--pab" as string]: ch(ambRgb[2]),
      ["--pai" as string]: ambientIntensity.toFixed(4),
      ["--clx" as string]: lx.toFixed(2),
      ["--cly" as string]: ly.toFixed(2),
      ["--clz" as string]: clz.toFixed(2),
    };
  }, [textureLighting, directionalLight, ambientLight]);

  // Shadow caster registry. PolyMesh children call registerShadowCaster when
  // their castShadow prop or polygon list changes. The scene accumulates the
  // full caster transforms, derives the ground-plane CSS-Z, and mirrors it
  // into either the `--shadow-ground-cssz` CSS var (dynamic mode) or the
  // scene context (baked mode, where each mesh embeds the value in its
  // inline matrix3d). Receiver meshes read the same registry to project
  // per-receiver-face shadows.
  const shadowCastersRef = useRef<Map<symbol, ShadowCasterRegistration>>(new Map());
  const shadowReceiversRef = useRef<Set<symbol>>(new Set());
  const [groundCssZ, setGroundCssZ] = useState<number | null>(null);
  // Bumped on every caster mutation so receiver useMemo deps re-fire.
  const [shadowCastersVersion, setShadowCastersVersion] = useState(0);
  const [hasShadowReceiver, setHasShadowReceiver] = useState(false);

  const recomputeGroundCssZ = useCallback(() => {
    let minWorldZ = Infinity;
    for (const data of shadowCastersRef.current.values()) {
      for (const poly of data.polygons) {
        for (const v of poly.vertices) {
          // Apply caster z-position so receiver and ground stay coherent.
          const z = v[2] + (data.position[2] ?? 0);
          if (z < minWorldZ) minWorldZ = z;
        }
      }
    }
    if (!Number.isFinite(minWorldZ)) return null;
    const lift = shadow?.lift ?? POLY_DEFAULT_SHADOW_LIFT;
    return (minWorldZ + lift) * BASE_TILE;
  }, [shadow]);

  const registerShadowCaster = useCallback((meshId: symbol, data: ShadowCasterRegistration | null) => {
    if (data === null) {
      shadowCastersRef.current.delete(meshId);
    } else {
      shadowCastersRef.current.set(meshId, data);
    }
    setShadowCastersVersion((v) => v + 1);
    const next = recomputeGroundCssZ();
    setGroundCssZ((prev) => (prev === next ? prev : next));
    const el = sceneElRef.current;
    if (!el) return;
    if (textureLighting === "dynamic" && next !== null) {
      el.style.setProperty("--shadow-ground-cssz", next.toFixed(3));
    } else {
      el.style.removeProperty("--shadow-ground-cssz");
    }
  }, [sceneElRef, textureLighting, recomputeGroundCssZ]);

  const registerShadowReceiver = useCallback((meshId: symbol, registered: boolean) => {
    if (registered) shadowReceiversRef.current.add(meshId);
    else shadowReceiversRef.current.delete(meshId);
    setHasShadowReceiver(shadowReceiversRef.current.size > 0);
  }, []);

  // Re-sync the CSS var on lighting-mode swaps. Dynamic mode needs the var
  // (the --shadow-proj calc reads it); baked mode strips it so a stale
  // value can't accidentally drive --shadow-proj for legacy leaves.
  useEffect(() => {
    const el = sceneElRef.current;
    if (!el) return;
    if (textureLighting === "dynamic" && groundCssZ !== null) {
      el.style.setProperty("--shadow-ground-cssz", groundCssZ.toFixed(3));
    } else {
      el.style.removeProperty("--shadow-ground-cssz");
    }
  }, [textureLighting, sceneElRef, groundCssZ]);

  // Lift change in baked mode: recompute groundCssZ so meshes re-derive
  // their inline matrix3d. (Dynamic mode handles it via the CSS var path
  // — recomputeGroundCssZ + the useEffect above keeps that consistent too.)
  useEffect(() => {
    setGroundCssZ((prev) => {
      const next = recomputeGroundCssZ();
      return prev === next ? prev : next;
    });
  }, [recomputeGroundCssZ]);

  const disabledStrategies = useMemo(
    () => strategies?.disable?.length ? new Set(strategies.disable) : undefined,
    [strategies],
  );

  const polyChildren = textureAtlas.entries.map((entry, index) => {
    if (entry) {
      return (
        <TextureAtlasPoly
          key={entry.index}
          entry={entry}
          page={textureAtlas.pages[entry.pageIndex]}
          textureLighting={textureLighting}
          textureImageRendering={textureImageRendering}
        />
      );
    }

    const plan = textureAtlasPlans[index];
    const imageGeometry = plan
      ? resolvePolyTextureLeafGeometry(plan, {
          imageRendering: textureImageRendering,
          backend: textureBackend,
          projection: textureProjection,
        })
      : null;
    if (plan && imageGeometry) {
      return (
        <TextureImagePoly
          key={plan.index}
          plan={plan}
          geometry={imageGeometry}
        />
      );
    }
    if (!plan || plan.texture) return null;
    // Solid triangles go through <u> only when that strategy is active.
    // When "u" is disabled they fall to <i> (border-shape, if supported) or
    // <s> (atlas). The atlas path is handled above via packed.entries; the <i>
    // fallback lands here via TextureBorderShapePoly (same as non-rect solids).
    const useU = !disabledStrategies?.has("u");
    const useProjectiveSolid = !disabledStrategies?.has("b");
    if (useU && isSolidTrianglePlan(plan)) {
      return (
        <TextureTrianglePoly
          key={plan.index}
          entry={plan}
          textureLighting={textureLighting}
          doc={sceneEl?.ownerDocument}
          strategies={strategies}
        />
      );
    }
    if (useProjectiveSolid && isProjectiveQuadPlan(plan)) {
      return <TextureProjectiveSolidPoly key={plan.index} entry={plan} textureLighting={textureLighting} />;
    }
    return <TextureBorderShapePoly key={plan.index} entry={plan} textureLighting={textureLighting} disabledStrategies={disabledStrategies} />;
  });

  // Propagate scene-level rendering options to descendants (PolyMesh /
  // helpers) so they pick up the same dynamic mode + lights as the scene.
  // Without this, a helper PolyMesh would default to baked rendering
  // while the scene's global CSS rule paints over it with the dynamic
  // calc — producing corrupt tints.
  const sceneCtxValue = useMemo(
    () => ({
      textureLighting,
      directionalLight,
      pointLights,
      ambientLight,
      strategies,
      seamBleed,
      textureLeafSizing,
      textureImageRendering,
      textureBackend,
      textureProjection,
      shadow,
      registerShadowCaster,
      registerShadowReceiver,
      shadowCasters: shadowCastersRef.current,
      shadowCastersVersion,
      hasShadowReceiver,
      groundCssZ,
      sceneEl,
    }),
    [textureLighting, directionalLight, pointLights, ambientLight, strategies, seamBleed, textureLeafSizing, textureImageRendering, textureBackend, textureProjection, shadow, registerShadowCaster, registerShadowReceiver, shadowCastersVersion, hasShadowReceiver, groundCssZ, sceneEl],
  );

  return (
    <PolySceneContext.Provider value={sceneCtxValue}>
      <div
        ref={localSceneRef}
        className={computedClassName}
        data-polycss-lighting={textureLighting}
        aria-hidden="true"
        style={
          {
            ...(dynamicLightVars ?? null),
            ...style,
          } as CSSProperties
        }
      >
        {polyChildren}
        {children}
      </div>
    </PolySceneContext.Provider>
  );
}

export const PolyScene = memo(PolySceneInner);
