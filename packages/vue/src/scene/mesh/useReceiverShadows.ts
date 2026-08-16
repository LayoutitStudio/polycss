/**
 * useReceiverShadows — shadow caster/receiver registration (with the
 * followAnimation throttle), the module-scope caster caches, and the
 * receiver-face shadow SVG computation. Extracted verbatim from
 * PolyMesh.ts.
 */
import { computed, h, onBeforeUnmount, shallowRef, watch } from "vue";
import type { ComputedRef, CSSProperties, VNode } from "vue";
import type { Polygon, PolyTextureLightingMode, Vec3 } from "@layoutit/polycss-core";
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
import type { PolyCameraContextValue } from "../../camera/context";
import type { PolySceneContextValue } from "../sceneContext";
import type { TextureAtlasPlan } from "../atlas";

/** Per-frame caster-mesh silhouette edge owner cache. Keyed by the
 *  caster's polygons array identity + position/scale/rotation bust key.
 *  Used by the H9 silhouette path in `computeReceiverShadowFaces`. Lives
 *  at module scope so multiple receivers in one frame share the cache. */
const vueEdgeOwnersCache = new WeakMap<readonly Polygon[], ReadonlyMap<string, EdgeOwners>>();
const vueEdgeOwnersCacheKey = new WeakMap<readonly Polygon[], string>();

/** Per-caster precomputed world vertices/planes, keyed on the caster's
 *  polygons array identity + the same position/scale/rotation bust key as
 *  the edge-owner cache. Mirrors vanilla's `casterItemsCache` on the scene
 *  context — without it every receiver re-ran `prepareCasterPolyItems` for
 *  every caster on every emit. */
const vueCasterItemsCache = new WeakMap<readonly Polygon[], CasterPolyItem[]>();
const vueCasterItemsCacheKey = new WeakMap<readonly Polygon[], string>();

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
const vueParametricCasterCache = new WeakMap<CasterPolyItem[], ParametricCasterCacheEntry>();

/** Shared overlap-dedup cache. `findOverlappingPolygonDuplicates` is O(n²)
 *  and a pure geometric property of the polygon array + options, so every
 *  call site (caster registration + ground-shadow path) reuses one cache
 *  keyed on polygon-array identity with the option set as the inner key.
 *  Mirrors vanilla createPolyScene's shared dedup cache. */
const vueDedupDropCache = new WeakMap<readonly Polygon[], Map<string, ReadonlySet<number>>>();

// Animated-shadow throttle: with `shadow.followAnimation`, same-topology
// deforms bump the caster geometry ref (→ receiver re-emit) at most this
// often (~12fps), leading + trailing edge. Mirrors vanilla createPolyScene's
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
  let byOptions = vueDedupDropCache.get(polygons);
  if (!byOptions) {
    byOptions = new Map();
    vueDedupDropCache.set(polygons, byOptions);
  }
  let dropped = byOptions.get(optKey);
  if (!dropped) {
    dropped = findOverlappingPolygonDuplicates(polygons, options);
    byOptions.set(optKey, dropped);
  }
  return dropped;
}

export interface ReceiverShadowsProps {
  castShadow: boolean;
  receiveShadow: boolean;
  shadowDefinition?: number;
  position?: Vec3;
  scale?: number | Vec3;
  rotation?: Vec3;
}

export function useReceiverShadows({
  props,
  polygons,
  textureAtlasPlans,
  atlasTextureLighting,
  sceneCtx,
  cameraCtx,
}: {
  props: ReceiverShadowsProps;
  polygons: ComputedRef<Polygon[]>;
  textureAtlasPlans: ComputedRef<Array<TextureAtlasPlan | null>>;
  atlasTextureLighting: ComputedRef<PolyTextureLightingMode>;
  sceneCtx: ComputedRef<PolySceneContextValue> | null;
  cameraCtx: PolyCameraContextValue | null;
}) {
  // Receiver-face shadows. Mirror of vanilla emitReceiverShadows: for
  // each coplanar surface group on this mesh, project every registered
  // caster polygon along the directional light, Sutherland-Hodgman-clip
  // to the face outline, emit one <svg> per visible face.
  // Cached shared-edge adjacency for the self-shadow seam cull.
  // Polygon identity is the bust key — re-built only when geometry
  // changes, mirroring React's useMemo([polygons, receiveShadow]).
  const selfShadowEdgeMap = computed(() =>
    props.receiveShadow ? buildSharedEdgeMap(polygons.value) : undefined,
  );

  const receiverShadowSvgs = computed<VNode[]>(() => {
    if (!props.receiveShadow) return [];
    const ctx = sceneCtx?.value;
    const registry = ctx?.shadowRegistry;
    if (!registry) return [];
    void registry.version.value;
    const entries = registry.getEntries();
    if (entries.length === 0) return [];
    // Caster vertices and receiver plane both live in the CSS axis-swap
    // frame after worldCssForMesh; the light direction must be in the
    // same frame for the shadow projection math to land correctly.
    const userLightDir = ctx?.directionalLight?.direction ?? ([0.4, -0.7, 0.59] as Vec3);
    const lightDir = worldDirectionToCss(userLightDir);
    // Point lights are baked-mode only — in dynamic mode they drive neither
    // surface shading nor shadows (a colored point shadow on a floor those
    // lights never lit reads as broken). Mirrors vanilla createPolyScene.
    const dynamicShading = atlasTextureLighting.value === "dynamic";
    const scenePoints = dynamicShading ? [] : (ctx?.pointLights ?? []);
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
    // light (Three.js parity; the old implicit-sun fallback is gone).
    const runDirectionalShadow =
      !!ctx?.directionalLight?.direction && (ctx.directionalLight.intensity ?? 1) > 0;
    const hasShadowPoints = shadowPointIndices.length > 0;
    const shadowLift = ctx?.shadow?.lift ?? POLY_DEFAULT_SHADOW_LIFT;
    const planes = prepareReceiverFacePlanes(
      polygons.value,
      props.position ?? [0, 0, 0],
      props.scale,
      new Set(),
      shadowLift,
      props.rotation,
    );
    if (planes.length === 0) return [];
    const casterInputs: ReceiverCasterInput<symbol>[] = [];
    let i = 0;
    const cachedSelfMap = selfShadowEdgeMap.value;
    for (const getData of entries) {
      const data = getData();
      // Shared bust key for the caster-items + edge-owners caches — the
      // transform fields fed into `prepareCasterPolyItems`, so cached
      // world-frame data stays coherent with the registered transform.
      // Polygon content identity is the WeakMap key itself.
      const dposArr = data.position;
      const drot = data.rotation ?? null;
      const casterKey = `${dposArr[0]},${dposArr[1]},${dposArr[2]}|${drot ? drot.join(",") : "n"}|${JSON.stringify(data.scale ?? null)}`;
      // Cast from EVERY polygon — geometry casts a shadow regardless of
      // whether it's painted for the camera (atlas plan / renderedPolygon-
      // Indices). Filtering to rendered polys left camera-dependent holes
      // in the floor shadow of imported meshes. Coincident projections
      // merge under the per-mesh `fill-rule: nonzero`, so no dedup is
      // needed. Mirrors packages/polycss/src/api/scene/receiverShadow.ts.
      // Cached per caster (vanilla `casterItemsCache` parity) so a re-emit
      // with unchanged polygons + transform skips the world-space rebuild.
      let items = vueCasterItemsCache.get(data.polygons);
      if (items === undefined || vueCasterItemsCacheKey.get(data.polygons) !== casterKey) {
        items = prepareCasterPolyItems(
          data.polygons,
          data.position,
          data.scale,
          () => true,
          data.rotation ?? null,
        );
        vueCasterItemsCache.set(data.polygons, items);
        vueCasterItemsCacheKey.set(data.polygons, casterKey);
      }
      const isSelf = data.polygons === polygons.value;
      // Self-shadow seam cull: when caster IS this mesh, pass the
      // cached shared-edge map so the algorithm skips projecting
      // edge-sharing neighbour polygons (kills spiderweb seam
      // shadows on smooth GLB meshes — apple, sphere, teapot).
      // H9 silhouette path: build/reuse world-frame edge owners for
      // non-self casters with enough polygons.
      // Point-light passes always need edgeOwners (radial shadow projects the
      // caster silhouette, even for a small cube). Directional keeps the ≥40
      // gate; core's directional branch ignores edgeOwners below that.
      let edgeOwners: ReadonlyMap<string, EdgeOwners> | undefined;
      if (!isSelf && (data.polygons.length >= 40 || hasShadowPoints)) {
        let cachedOwners = vueEdgeOwnersCache.get(data.polygons);
        if (cachedOwners === undefined || vueEdgeOwnersCacheKey.get(data.polygons) !== casterKey) {
          cachedOwners = prepareCasterEdgeOwners(data.polygons, dposArr, data.scale, drot);
          vueEdgeOwnersCache.set(data.polygons, cachedOwners);
          vueEdgeOwnersCacheKey.set(data.polygons, casterKey);
        }
        edgeOwners = cachedOwners;
      }
      // Parametric override: low-res silhouette loops via the shared core
      // helper (identical to vanilla + React). Per-mesh `shadowDefinition`
      // beats the scene default; directional + per-point-light radial.
      // Cached per caster-items identity + parameter key: the override does
      // not depend on the receiver beyond the self/cross flag, so one caster
      // reuses one cross variant across every receiver (mirrors vanilla).
      let overrideSilhouette: Vec3[][] | undefined;
      let overridePointSilhouettes: Array<Vec3[][] | undefined> | undefined;
      if (ctx?.shadow?.parametric) {
        const def = data.shadowDefinition ?? ctx.shadow.definition ?? 16;
        const paramKey =
          `${def}|${ctx.shadow.style ?? "vector"}|` +
          `${lightDir[0]},${lightDir[1]},${lightDir[2]}|` +
          shadowPointIndices.map((idx) => `${idx}:${allPointLightsCss[idx]!.position.join(",")}`).join(";");
        let paramEntry = vueParametricCasterCache.get(items);
        if (!paramEntry) {
          paramEntry = { worldVerts: items.map((it) => it.wv) };
          vueParametricCasterCache.set(items, paramEntry);
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
              style: ctx.shadow.style,
              pointLights: shadowPointIndices.map((idx) => ({ position: allPointLightsCss[idx]!.position, index: idx })),
            }),
          };
          paramEntry[variantKey] = variant;
        }
        overrideSilhouette = variant.result.overrideSilhouette;
        overridePointSilhouettes = variant.result.overridePointSilhouettes;
      }
      casterInputs.push({
        id: Symbol(`caster-${i++}`),
        items,
        selfShadowEdgeMap: isSelf ? cachedSelfMap : undefined,
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
      meshRotation: props.rotation,
    };
    // Shared core merge: one SVG per receiver face, all its lights merged so
    // overlaps composite correctly (single light → one path; multi-light
    // solid → base + per-light multiply layers). Identical to vanilla + React.
    const faces = computeMergedReceiverShadows<symbol>({
      receiverPlanes: planes,
      receiverPolygons: polygons.value,
      receiverHasTexture: polygons.value.some((p) => p.texture !== undefined),
      casters: casterInputs,
      lightDir,
      runDirectional: runDirectionalShadow,
      pointPasses: shadowPointIndices.map((i) => ({ lightPos: allPointLightsCss[i]!.position, index: i })),
      allPointLights: allPointLightsCss,
      cameraRot,
      ambientLight: ctx?.ambientLight,
      directionalLight: ctx?.directionalLight,
      shadow: { color: ctx?.shadow?.color, opacity: ctx?.shadow?.opacity ?? 0.25, maxExtend: ctx?.shadow?.maxExtend },
    });
    return faces.map((fc) =>
      h(
        "svg",
        {
          key: `receiver-${fc.faceIndex}`,
          class: "polycss-shadow polycss-shadow-svg polycss-shadow-receiver",
          "data-poly-shadow-type": "receiver",
          "data-poly-shadow-receiver-face": String(fc.faceIndex),
          "data-poly-shadow-receiver-polys": JSON.stringify(fc.memberPolyIndices),
          width: String(fc.width),
          height: String(fc.height),
          viewBox: `0 0 ${fc.width} ${fc.height}`,
          style: {
            position: "absolute",
            top: "0",
            left: "0",
            display: "block",
            overflow: "hidden",
            transformOrigin: "0 0",
            pointerEvents: "none",
            willChange: "transform",
            opacity: String(fc.svgOpacity),
            transform: fc.matrixCss,
          } as CSSProperties,
        },
        [
          ...(fc.baseFill && fc.baseD
            ? [h("path", { d: fc.baseD, fill: fc.baseFill, "fill-rule": "nonzero" })]
            : []),
          ...fc.layers.map((layer, idx) =>
            h("path", {
              key: idx,
              d: layer.d,
              fill: layer.fill,
              "fill-rule": "nonzero",
              ...(layer.opacity !== 1 ? { opacity: layer.opacity.toFixed(4) } : {}),
              ...(layer.multiply ? { style: { mixBlendMode: "multiply" } as CSSProperties } : {}),
            }),
          ),
        ],
      ),
    );
  });

  // Gated shadow-caster geometry: an animated (deforming) mesh FREEZES its
  // shadow by default — the receiver shadow re-projects whenever this ref
  // updates, so re-emitting every frame is expensive. Update it on real
  // topology changes always, but on a same-topology deform only when
  // `shadow.followAnimation` is set (then the shadow tracks the pose; pair
  // with a low parametric `definition`). Mirrors vanilla `setPolygons`.
  const shadowCasterPolygons = shallowRef(polygons.value);
  let lastShadowPolyCount = -1;
  let lastShadowBumpAt = 0;
  let shadowTrailingTimer: ReturnType<typeof setTimeout> | null = null;
  let pendingShadowPolygons: Polygon[] | null = null;
  const bumpShadowCasterPolygons = (polys: Polygon[]): void => {
    lastShadowBumpAt =
      typeof performance !== "undefined" ? performance.now() : Date.now();
    lastShadowPolyCount = polys.length;
    shadowCasterPolygons.value = polys;
  };
  watch(
    polygons,
    (polys) => {
      const follow = sceneCtx?.value.shadow?.followAnimation ?? false;
      const topologyChanged = polys.length !== lastShadowPolyCount;
      if (lastShadowPolyCount >= 0 && !follow && !topologyChanged) return;
      // Same-topology followAnimation deforms are throttled to
      // ANIMATION_SHADOW_MS, leading + trailing edge (mirrors vanilla
      // maybeEmitAnimationShadow): inside a window the latest pose is
      // parked and bumped once the window elapses, so a paused animation
      // still lands its final pose. First bump and topology changes are
      // immediate.
      if (lastShadowPolyCount >= 0 && follow && !topologyChanged) {
        const now =
          typeof performance !== "undefined" ? performance.now() : Date.now();
        const elapsed = now - lastShadowBumpAt;
        if (elapsed < ANIMATION_SHADOW_MS) {
          pendingShadowPolygons = polys;
          if (shadowTrailingTimer === null) {
            shadowTrailingTimer = setTimeout(() => {
              shadowTrailingTimer = null;
              const pending = pendingShadowPolygons;
              pendingShadowPolygons = null;
              if (pending) bumpShadowCasterPolygons(pending);
            }, ANIMATION_SHADOW_MS - elapsed);
          }
          return;
        }
      }
      if (shadowTrailingTimer !== null) {
        clearTimeout(shadowTrailingTimer);
        shadowTrailingTimer = null;
      }
      pendingShadowPolygons = null;
      bumpShadowCasterPolygons(polys);
    },
    { immediate: true },
  );
  onBeforeUnmount(() => {
    if (shadowTrailingTimer !== null) {
      clearTimeout(shadowTrailingTimer);
      shadowTrailingTimer = null;
    }
    pendingShadowPolygons = null;
  });

  // Register this mesh with the shadow registry when castShadow=true in
  // either lighting mode — the scene needs caster polygons (with their
  // full transforms) to derive the ground plane and to feed receiver
  // meshes' per-face shadow projection.
  const shadowRegistryId = Symbol();
  watch(
    () => props.castShadow,
    (castShadow, _, onCleanup) => {
      const registry = sceneCtx?.value.shadowRegistry;
      if (!registry) return;
      if (castShadow) {
        registry.register(shadowRegistryId, () => {
          const casterPolygons = shadowCasterPolygons.value;
          // Mirror vanilla: skip no-plan polys AND overlapping duplicates
          // (vanilla's dedupByCaster filter, same 0.5/0.95 thresholds —
          // shared via the module dedup cache so the O(n²) pass runs once
          // per polygon-array identity even across receiver re-emits).
          const dedupDrop = cachedOverlappingPolygonDuplicates(casterPolygons, {
            normalTolerance: 0.1,
            distanceTolerance: 0.5,
            overlapFraction: 0.95,
            preserveDoubleSidedBackfaces: false,
          });
          const s = new Set<number>();
          const plans = textureAtlasPlans.value;
          for (let i = 0; i < plans.length; i++) {
            if (plans[i] && !dedupDrop.has(i)) s.add(i);
          }
          return {
            polygons: casterPolygons,
            position: props.position ?? [0, 0, 0],
            scale: props.scale,
            rotation: props.rotation,
            renderedPolygonIndices: s,
            shadowDefinition: props.shadowDefinition,
          };
        });
      } else {
        registry.unregister(shadowRegistryId);
      }
      onCleanup(() => registry.unregister(shadowRegistryId));
    },
    { immediate: true },
  );

  // Receiver registration: mirror toggle on props.receiveShadow so the
  // scene knows whether to disable the caster ground-shadow fallback.
  const receiverRegistryId = Symbol();
  watch(
    () => props.receiveShadow,
    (receive, _, onCleanup) => {
      const registry = sceneCtx?.value.receiverRegistry;
      if (!registry) return;
      if (receive) registry.register(receiverRegistryId);
      else registry.unregister(receiverRegistryId);
      onCleanup(() => registry.unregister(receiverRegistryId));
    },
    { immediate: true },
  );

  onBeforeUnmount(() => {
    sceneCtx?.value.shadowRegistry?.unregister(shadowRegistryId);
    sceneCtx?.value.receiverRegistry?.unregister(receiverRegistryId);
  });

  return { receiverShadowSvgs };
}
