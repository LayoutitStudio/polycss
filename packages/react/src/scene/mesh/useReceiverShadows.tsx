/**
 * useReceiverShadows — shadow caster/receiver registration (with the
 * followAnimation throttle), the module-scope caster caches, and the
 * receiver-face shadow SVG computation. Extracted verbatim from
 * PolyMesh.tsx.
 */
import { useEffect, useMemo, useRef } from "react";
import type { ReactNode } from "react";
import type { Polygon, Vec3 } from "@layoutit/polycss-core";
import {
  POLY_DEFAULT_SHADOW_LIFT,
  buildParametricCasterOverride,
  buildSharedEdgeMap,
  computeMergedReceiverShadows,
  findOverlappingPolygonDuplicates,
  prepareCasterEdgeOwners,
  prepareCasterPolyItems,
  prepareReceiverFacePlanes,
  worldDirectionToCss,
  worldPositionToCss,
  type CameraCullRotation,
  type CasterPolyItem,
  type EdgeOwners,
  type ReceiverCasterInput,
} from "@layoutit/polycss-core";
import type { PolyTextureLightingMode } from "@layoutit/polycss-core";
import type { PolyCameraContextValue } from "../../camera/context";
import type { PolySceneContextValue, ShadowCasterRegistration } from "../sceneContext";
import type { TextureAtlasPlan } from "../atlas";

/** Per-frame caster-mesh silhouette edge owner cache. Keyed by the
 *  caster's polygons array identity (snapshot from `shadowCasters`) +
 *  position/scale/rotation bust key. Used by the H9 silhouette path in
 *  `computeReceiverShadowFaces`. Lives at module scope so callsites share
 *  cache across receivers in a single frame. */
const reactEdgeOwnersCache = new WeakMap<readonly Polygon[], ReadonlyMap<string, EdgeOwners>>();
const reactEdgeOwnersCacheKey = new WeakMap<readonly Polygon[], string>();

/** Per-caster precomputed world vertices/planes, keyed on the caster's
 *  polygons array identity + the same position/scale/rotation bust key as
 *  the edge-owner cache. Mirrors vanilla's `casterItemsCache` on the scene
 *  context — without it every receiver re-ran `prepareCasterPolyItems` for
 *  every caster on every emit. */
const reactCasterItemsCache = new WeakMap<readonly Polygon[], CasterPolyItem[]>();
const reactCasterItemsCacheKey = new WeakMap<readonly Polygon[], string>();

/** Per-caster parametric override cache, keyed on the cached CasterPolyItem[]
 *  identity (which busts on polygon/transform changes via the caster-items
 *  key). The override depends only on caster world verts + light config +
 *  definition/style + the self/cross flag — NOT on the receiver — so one
 *  caster needs at most two variants shared across every receiver. Mirrors
 *  vanilla receiverShadow.ts. `worldVerts` hoists the per-call
 *  `items.map((it) => it.wv)` allocation. */
interface ParametricCasterCacheEntry {
  worldVerts: Vec3[][];
  self?: { key: string; result: ReturnType<typeof buildParametricCasterOverride> };
  cross?: { key: string; result: ReturnType<typeof buildParametricCasterOverride> };
}
const reactParametricCasterCache = new WeakMap<CasterPolyItem[], ParametricCasterCacheEntry>();

/** Shared overlap-dedup cache. `findOverlappingPolygonDuplicates` is O(n²)
 *  and a pure geometric property of the polygon array + options, so every
 *  call site (caster registration + ground-shadow path) reuses one cache
 *  keyed on polygon-array identity with the option set as the inner key.
 *  Mirrors vanilla createPolyScene's shared dedup cache. */
const reactDedupDropCache = new WeakMap<readonly Polygon[], Map<string, ReadonlySet<number>>>();

// Animated-shadow throttle: with `shadow.followAnimation`, same-topology
// deforms re-register the caster (→ receiver re-emit) at most this often
// (~12fps), leading + trailing edge. Mirrors vanilla createPolyScene's
// ANIMATION_SHADOW_MS / maybeEmitAnimationShadow semantics: the last deform
// inside a window is deferred and still lands once the window elapses, so a
// paused animation never leaves a stale shadow.
const ANIMATION_SHADOW_MS = 80;
export function cachedOverlappingPolygonDuplicates(
  polygons: Polygon[],
  options: {
    normalTolerance: number;
    distanceTolerance: number;
    overlapFraction: number;
    preserveDoubleSidedBackfaces: boolean;
  },
): ReadonlySet<number> {
  const optKey =
    `${options.normalTolerance}|${options.distanceTolerance}|` +
    `${options.overlapFraction}|${options.preserveDoubleSidedBackfaces ? 1 : 0}`;
  let byOptions = reactDedupDropCache.get(polygons);
  if (!byOptions) {
    byOptions = new Map();
    reactDedupDropCache.set(polygons, byOptions);
  }
  let dropped = byOptions.get(optKey);
  if (!dropped) {
    dropped = findOverlappingPolygonDuplicates(polygons, options);
    byOptions.set(optKey, dropped);
  }
  return dropped;
}

export interface UseReceiverShadowsOptions {
  castShadow?: boolean;
  receiveShadow?: boolean;
  shadowDefinition?: number;
  polygons: Polygon[];
  position?: Vec3;
  scale?: number | Vec3;
  rotation?: Vec3;
  atlasPlans: Array<TextureAtlasPlan | null>;
  effectiveTextureLighting: PolyTextureLightingMode;
  sceneCtx: PolySceneContextValue | null;
  cameraCtx: PolyCameraContextValue | null;
}

export function useReceiverShadows({
  castShadow,
  receiveShadow,
  shadowDefinition,
  polygons,
  position,
  scale,
  rotation,
  atlasPlans,
  effectiveTextureLighting,
  sceneCtx,
  cameraCtx,
}: UseReceiverShadowsOptions) {
  // Shadow casting. Stable mesh identity key — survives re-renders without
  // re-registering. Defined at component top-level via useRef.
  const meshIdRef = useRef<symbol>(Symbol());
  const sceneRegisterShadowCaster = sceneCtx?.registerShadowCaster;

  // Register/unregister as a shadow caster whenever castShadow or polygons /
  // transform change. The full transform is registered so receiver meshes
  // can project the shadow into world space directly. renderedPolygonIndices
  // tells the receiver to skip polygons that have no atlas plan (e.g.
  // degenerate or filtered-out) — vanilla iterates `caster.rendered` for
  // the same effect.
  const renderedPolygonIndices = useMemo(() => {
    // Mirror vanilla: skip polygons that have no atlas plan AND skip
    // overlapping duplicates (vanilla's `dedupByCaster` filter — the same
    // findOverlappingPolygonDuplicates pass that the ground-shadow path
    // uses, with the same 0.5/0.95 thresholds — shared via the module
    // dedup cache so the O(n²) pass runs once per polygon-array identity).
    const dedupDrop = cachedOverlappingPolygonDuplicates(polygons, {
      normalTolerance: 0.1,
      distanceTolerance: 0.5,
      overlapFraction: 0.95,
      preserveDoubleSidedBackfaces: false,
    });
    const s = new Set<number>();
    for (let i = 0; i < atlasPlans.length; i++) {
      if (atlasPlans[i] && !dedupDrop.has(i)) s.add(i);
    }
    return s;
  }, [atlasPlans, polygons]);
  // Caster registration is split so a deforming (animated) mesh can FREEZE its
  // shadow by default — re-registering the caster on every animation frame
  // re-emits the receiver shadow each frame (expensive). Effect A owns
  // register/unregister lifecycle (castShadow on/off, unmount). Effect B pushes
  // updated geometry, but skips same-topology deforms unless `shadow.
  // followAnimation` is set — then the shadow tracks the pose (throttle this
  // with a low parametric `definition`). Mirrors vanilla `setPolygons`.
  const shadowCasterRegisteredRef = useRef(false);
  const lastShadowPolyCountRef = useRef(-1);
  const lastShadowRegisterAtRef = useRef(0);
  const shadowTrailingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingShadowRegistrationRef = useRef<ShadowCasterRegistration | null>(null);
  useEffect(() => {
    if (!sceneRegisterShadowCaster || !castShadow) return;
    return () => {
      if (shadowTrailingTimerRef.current !== null) {
        clearTimeout(shadowTrailingTimerRef.current);
        shadowTrailingTimerRef.current = null;
      }
      pendingShadowRegistrationRef.current = null;
      sceneRegisterShadowCaster(meshIdRef.current, null);
      shadowCasterRegisteredRef.current = false;
      lastShadowPolyCountRef.current = -1;
    };
  }, [sceneRegisterShadowCaster, castShadow]);
  useEffect(() => {
    if (!sceneRegisterShadowCaster || !castShadow) return;
    const followAnimation = sceneCtx?.shadow?.followAnimation ?? false;
    const topologyChanged = polygons.length !== lastShadowPolyCountRef.current;
    // Freeze: a same-topology deform with followAnimation off keeps the last
    // registered pose (no re-emit). No cleanup here, so this never unregisters.
    if (shadowCasterRegisteredRef.current && !followAnimation && !topologyChanged) return;
    const registration: ShadowCasterRegistration = {
      polygons,
      position: position ?? [0, 0, 0],
      scale,
      rotation,
      renderedPolygonIndices,
      shadowDefinition,
    };
    // Same-topology followAnimation deforms are throttled to
    // ANIMATION_SHADOW_MS, leading + trailing edge (mirrors vanilla
    // maybeEmitAnimationShadow): inside a window the latest pose is parked and
    // registered once the window elapses, so a paused animation still lands
    // its final pose. First registration and topology changes are immediate.
    if (shadowCasterRegisteredRef.current && followAnimation && !topologyChanged) {
      const now = typeof performance !== "undefined" ? performance.now() : Date.now();
      const elapsed = now - lastShadowRegisterAtRef.current;
      if (elapsed < ANIMATION_SHADOW_MS) {
        pendingShadowRegistrationRef.current = registration;
        if (shadowTrailingTimerRef.current === null) {
          shadowTrailingTimerRef.current = setTimeout(() => {
            shadowTrailingTimerRef.current = null;
            const pending = pendingShadowRegistrationRef.current;
            pendingShadowRegistrationRef.current = null;
            if (!pending) return;
            lastShadowRegisterAtRef.current =
              typeof performance !== "undefined" ? performance.now() : Date.now();
            sceneRegisterShadowCaster(meshIdRef.current, pending);
          }, ANIMATION_SHADOW_MS - elapsed);
        }
        return;
      }
    }
    if (shadowTrailingTimerRef.current !== null) {
      clearTimeout(shadowTrailingTimerRef.current);
      shadowTrailingTimerRef.current = null;
    }
    pendingShadowRegistrationRef.current = null;
    lastShadowPolyCountRef.current = polygons.length;
    shadowCasterRegisteredRef.current = true;
    lastShadowRegisterAtRef.current =
      typeof performance !== "undefined" ? performance.now() : Date.now();
    sceneRegisterShadowCaster(meshIdRef.current, registration);
  }, [sceneRegisterShadowCaster, castShadow, polygons, position, scale, rotation, renderedPolygonIndices, shadowDefinition, sceneCtx?.shadow]);

  // Mirror receiveShadow registration so the scene knows whether at least
  // one receiver exists (drives the ground-shadow-disable rule on casters).
  const sceneRegisterShadowReceiver = sceneCtx?.registerShadowReceiver;
  useEffect(() => {
    if (!sceneRegisterShadowReceiver) return;
    sceneRegisterShadowReceiver(meshIdRef.current, !!receiveShadow);
    return () => {
      sceneRegisterShadowReceiver(meshIdRef.current, false);
    };
  }, [sceneRegisterShadowReceiver, receiveShadow]);

  // Receiver-face shadows. For each coplanar surface group on this mesh,
  // project every registered caster polygon along the directional light,
  // Sutherland-Hodgman-clip to the face outline, and emit one <svg> per
  // visible group. Mirrors vanilla's emitReceiverShadows path.
  const shadowCasters = sceneCtx?.shadowCasters;
  const shadowCastersVersion = sceneCtx?.shadowCastersVersion ?? 0;
  const sceneShadow = sceneCtx?.shadow;
  const sceneDirectionalLight = sceneCtx?.directionalLight;
  // NO camera subscription here — receiver shadows do not re-emit on camera
  // motion (they ride the scene transform). The receiver-face back-face cull
  // reads the camera state at emit time (light/geometry/registration change)
  // and may go stale during an orbit — the same deliberate trade vanilla
  // makes in emitSceneShadows (shadows are not re-emitted from applyCamera).
  // Cached shared-edge adjacency for the self-shadow seam cull. Polygon
  // identity is the bust key (re-built when geometry changes).
  const selfShadowEdgeMap = useMemo(
    () => receiveShadow ? buildSharedEdgeMap(polygons) : undefined,
    [polygons, receiveShadow],
  );
  const receiverShadowSvgs = useMemo<ReactNode>(() => {
    if (!receiveShadow) return null;
    if (!shadowCasters || shadowCasters.size === 0) return null;
    // Caster vertices and receiver plane both live in the CSS axis-swap
    // frame after worldCssForMesh; the light direction must be in the
    // same frame for the shadow projection math to land correctly. (Matches
    // vanilla emitGround/emitReceiverShadows pipelines.)
    const userLightDir = sceneDirectionalLight?.direction ?? ([0.4, -0.7, 0.59] as Vec3);
    const lightDir = worldDirectionToCss(userLightDir);
    // Point lights are baked-mode only — in dynamic mode they drive neither
    // surface shading nor shadows (a colored point shadow on a floor those
    // lights never lit reads as broken). Mirrors vanilla createPolyScene.
    const dynamicShading = effectiveTextureLighting === "dynamic";
    const scenePoints = dynamicShading ? [] : (sceneCtx?.pointLights ?? []);
    // ALL point lights in CSS frame — the shaded shadow color needs every
    // light that illuminates the receiver (even non-casters), minus the one
    // being shadowed. `shadowPointIndices` are the entries that cast.
    const allPointLightsCss = scenePoints.map((pl) => ({
      position: worldPositionToCss(pl.position),
      color: pl.color,
      intensity: pl.intensity,
    }));
    const shadowPointIndices = scenePoints
      .map((pl, i) => (pl.castShadow ? i : -1))
      .filter((i) => i >= 0);
    // Directional pass runs only for a real, nonzero-intensity directional
    // light (Three.js parity: zero-intensity removes no light → no shadow; the
    // old implicit-sun fallback is gone).
    const runDirectionalShadow =
      !!sceneDirectionalLight?.direction && (sceneDirectionalLight.intensity ?? 1) > 0;
    const hasShadowPoints = shadowPointIndices.length > 0;
    const shadowLift = sceneShadow?.lift ?? POLY_DEFAULT_SHADOW_LIFT;
    const planes = prepareReceiverFacePlanes(
      polygons,
      position ?? [0, 0, 0],
      scale,
      new Set(),
      shadowLift,
      rotation,
    );
    if (planes.length === 0) return null;
    const casterInputs: ReceiverCasterInput<symbol>[] = [];
    for (const [casterId, data] of shadowCasters) {
      // Shared bust key for the caster-items + edge-owners caches — the
      // transform fields fed into `prepareCasterPolyItems`, so cached world-
      // frame data stays coherent with the registered transform. Polygon
      // content identity is the WeakMap key itself.
      const dposArr = data.position;
      const drot = data.rotation ?? null;
      const casterKey = `${dposArr[0]},${dposArr[1]},${dposArr[2]}|${drot ? drot.join(",") : "n"}|${JSON.stringify(data.scale ?? null)}`;
      // Cast from EVERY polygon — geometry casts a shadow regardless of
      // whether it's painted for the camera (atlas plan / renderedPolygon-
      // Indices). Filtering to rendered polys left camera-dependent holes in
      // the floor shadow of imported meshes (a poly facing the light but not
      // the camera vanished). Coincident projections merge under the
      // per-mesh `fill-rule: nonzero`, so no dedup is needed here. Mirrors
      // the vanilla fix in packages/polycss/src/api/scene/receiverShadow.ts.
      // Cached per caster (vanilla `casterItemsCache` parity) so a re-emit
      // with unchanged polygons + transform skips the world-space rebuild.
      let items = reactCasterItemsCache.get(data.polygons);
      if (items === undefined || reactCasterItemsCacheKey.get(data.polygons) !== casterKey) {
        items = prepareCasterPolyItems(
          data.polygons,
          data.position,
          data.scale,
          () => true,
          data.rotation ?? null,
        );
        reactCasterItemsCache.set(data.polygons, items);
        reactCasterItemsCacheKey.set(data.polygons, casterKey);
      }
      // Self-shadow seam cull: when the caster IS this mesh, pass the
      // shared-edge adjacency map so the algorithm skips projecting
      // edge-sharing neighbour polygons (kills the spiderweb seam
      // shadows on smooth GLB meshes — apple, sphere, teapot).
      const isSelf = data.polygons === polygons;
      const selfMap = isSelf ? selfShadowEdgeMap : undefined;
      // H9 silhouette path: build/reuse world-frame edge owners for
      // non-self casters with enough polygons.
      // Point-light passes always need edgeOwners (the radial shadow projects
      // the caster silhouette, even for a small cube). Directional keeps the
      // ≥40-poly gate; core's directional branch ignores edgeOwners below that
      // threshold, so providing it here doesn't change directional behavior.
      let edgeOwners: ReadonlyMap<string, EdgeOwners> | undefined;
      if (!isSelf && (data.polygons.length >= 40 || hasShadowPoints)) {
        let cachedOwners = reactEdgeOwnersCache.get(data.polygons);
        if (cachedOwners === undefined || reactEdgeOwnersCacheKey.get(data.polygons) !== casterKey) {
          cachedOwners = prepareCasterEdgeOwners(data.polygons, dposArr, data.scale, drot);
          reactEdgeOwnersCache.set(data.polygons, cachedOwners);
          reactEdgeOwnersCacheKey.set(data.polygons, casterKey);
        }
        edgeOwners = cachedOwners;
      }
      // Parametric override: low-res silhouette loops (shared core helper, so
      // vanilla/React/Vue are identical). Per-mesh `shadowDefinition` beats the
      // scene default; directional + per-point-light radial silhouettes.
      // Cached per caster-items identity + parameter key: the override does
      // not depend on the receiver beyond the self/cross flag, so one caster
      // reuses one cross variant across every receiver (mirrors vanilla).
      let overrideSilhouette: Vec3[][] | undefined;
      let overridePointSilhouettes: Array<Vec3[][] | undefined> | undefined;
      if (sceneShadow?.parametric) {
        const def = data.shadowDefinition ?? sceneShadow.definition ?? 16;
        const paramKey =
          `${def}|${sceneShadow.style ?? "vector"}|` +
          `${lightDir[0]},${lightDir[1]},${lightDir[2]}|` +
          shadowPointIndices.map((i) => `${i}:${allPointLightsCss[i]!.position.join(",")}`).join(";");
        let paramEntry = reactParametricCasterCache.get(items);
        if (!paramEntry) {
          paramEntry = { worldVerts: items.map((it) => it.wv) };
          reactParametricCasterCache.set(items, paramEntry);
        }
        const variantKey = isSelf ? "self" : "cross";
        let variant = paramEntry[variantKey];
        if (!variant || variant.key !== paramKey) {
          variant = {
            key: paramKey,
            result: buildParametricCasterOverride({
              polysWorldVerts: paramEntry.worldVerts,
              lightDir,
              definition: def,
              isSelf,
              style: sceneShadow.style,
              pointLights: shadowPointIndices.map((i) => ({ position: allPointLightsCss[i]!.position, index: i })),
            }),
          };
          paramEntry[variantKey] = variant;
        }
        overrideSilhouette = variant.result.overrideSilhouette;
        overridePointSilhouettes = variant.result.overridePointSilhouettes;
      }
      casterInputs.push({
        id: casterId,
        items,
        selfShadowEdgeMap: selfMap,
        edgeOwners,
        casterPolygonCount: data.polygons.length,
        overrideSilhouette,
        overridePointSilhouettes,
      });
    }
    // Camera state captured at EMIT time (light/geometry/registration
    // change) for the receiver-face back-face cull — never a reactive
    // dependency. It may go stale during an orbit; vanilla makes the same
    // trade (shadows ride the scene transform, camera motion is free).
    const cameraState = cameraCtx?.store.getState().cameraState;
    const cameraRot: CameraCullRotation = {
      rotX: cameraState?.rotX ?? 65,
      rotY: cameraState?.rotY ?? 45,
      meshRotation: rotation,
    };
    // Shared core merge: one SVG per receiver face, all its lights merged so
    // overlaps composite correctly (single light → one path; multi-light solid
    // → base + per-light multiply layers). Identical to vanilla + Vue.
    const faces = computeMergedReceiverShadows<symbol>({
      receiverPlanes: planes,
      receiverPolygons: polygons,
      receiverHasTexture: polygons.some((p) => p.texture !== undefined),
      casters: casterInputs,
      lightDir,
      runDirectional: runDirectionalShadow,
      pointPasses: shadowPointIndices.map((i) => ({ lightPos: allPointLightsCss[i]!.position, index: i })),
      allPointLights: allPointLightsCss,
      cameraRot,
      ambientLight: sceneCtx?.ambientLight,
      directionalLight: sceneDirectionalLight,
      shadow: { color: sceneShadow?.color, opacity: sceneShadow?.opacity ?? 0.25, maxExtend: sceneShadow?.maxExtend },
    });
    if (faces.length === 0) return null;
    return (
      <>
        {faces.map((fc) => (
          <svg
            key={`receiver-${fc.faceIndex}`}
            className="polycss-shadow polycss-shadow-svg polycss-shadow-receiver"
            data-poly-shadow-type="receiver"
            data-poly-shadow-receiver-face={fc.faceIndex}
            data-poly-shadow-receiver-polys={JSON.stringify(fc.memberPolyIndices)}
            width={fc.width}
            height={fc.height}
            viewBox={`0 0 ${fc.width} ${fc.height}`}
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              display: "block",
              overflow: "hidden",
              transformOrigin: "0 0",
              pointerEvents: "none",
              willChange: "transform",
              opacity: fc.svgOpacity,
              transform: fc.matrixCss,
            }}
          >
            {fc.baseFill && fc.baseD ? (
              <path d={fc.baseD} fill={fc.baseFill} fillRule="nonzero" />
            ) : null}
            {fc.layers.map((layer, i) => (
              <path
                key={i}
                d={layer.d}
                fill={layer.fill}
                fillRule="nonzero"
                opacity={layer.opacity !== 1 ? layer.opacity.toFixed(4) : undefined}
                style={layer.multiply ? { mixBlendMode: "multiply" } : undefined}
              />
            ))}
          </svg>
        ))}
      </>
    );
  }, [receiveShadow, shadowCasters, shadowCastersVersion, polygons, position, scale, rotation, sceneDirectionalLight, sceneCtx?.pointLights, effectiveTextureLighting, sceneShadow, sceneCtx?.ambientLight, cameraCtx?.store, selfShadowEdgeMap]);

  return { receiverShadowSvgs };
}
