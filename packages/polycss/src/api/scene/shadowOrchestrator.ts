/**
 * Scene-level shadow emission + caching orchestration: the H3 light-quantize
 * short-circuit, the progressive (light-drag) refine timer, the animated-
 * shadow throttle, the shared overlap-dedup cache, and the ground-plane
 * recompute.
 *
 * Extracted verbatim from createPolyScene.ts; the mutable emit state
 * (`lastEmittedShadowLightKey`, the two timers) lives on the SceneContext.
 */
import type { CameraCullRotation, Polygon, ReceiverFacePlane, Vec3 } from "@layoutit/polycss-core";
import {
  findOverlappingPolygonDuplicates,
  receiverShadowCameraSignature,
  POLY_DEFAULT_SHADOW_LIFT,
} from "@layoutit/polycss-core";
import {
  DEFAULT_TILE,
  worldDirectionToCss,
  worldPositionToCss,
} from "./transforms";
import { hideGroundShadow } from "./shadowSvg";
import { emitReceiverShadows } from "./receiverShadow";
import { clearAllSceneShadows } from "./shadowCache";
import type { SceneContext } from "./sceneContext";
import type { MeshEntry } from "./internalTypes";

// Progressive refinement: a light-drag emit renders at `shadow.dragDefinition`
// (laggless), then the ctx timer re-emits at full `shadow.definition` once the
// light settles. Reset on every progressive emit; cleared on dispose.
const SHADOW_REFINE_MS = 140;
// Animated-shadow throttle: re-emit shadows at most this often while a mesh
// deforms (shadow.followAnimation). ~12fps keeps a parametric reproject cheap.
// Trailing-edge: a deform landing inside the window schedules one deferred
// emit for when the window elapses, so a paused animation never leaves a
// stale shadow (the emit reads entry.polygons at fire time — latest pose).
const ANIMATION_SHADOW_MS = 80;

/** Shared overlap-dedup cache. `findOverlappingPolygonDuplicates` is O(n²)
 *  and a pure geometric property of the polygon array + options, so both
 *  the shadow-emit path (0.5/0.95 thresholds) and the raytrace path
 *  (0.12/0.98 thresholds) reuse one cache keyed on polygon-array identity
 *  with the option set as the inner key. WeakMap → dropped arrays free
 *  their entries. */
const overlapDedupCache = new WeakMap<readonly Polygon[], Map<string, ReadonlySet<number>>>();
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
  let byOptions = overlapDedupCache.get(polygons);
  if (!byOptions) {
    byOptions = new Map();
    overlapDedupCache.set(polygons, byOptions);
  }
  let dropped = byOptions.get(optKey);
  if (!dropped) {
    dropped = findOverlappingPolygonDuplicates(polygons, options);
    byOptions.set(optKey, dropped);
  }
  return dropped;
}

function emitAnimationShadowNow(ctx: SceneContext): void {
  ctx.lastAnimationShadowEmit =
    typeof performance !== "undefined" ? performance.now() : Date.now();
  invalidateShadowLightCache(ctx);
  emitSceneShadows(ctx);
}

export function maybeEmitAnimationShadow(ctx: SceneContext, entry: MeshEntry): void {
  if (!ctx.options.current.shadow?.followAnimation) return;
  if (!entry.castShadow && !entry.receiveShadow) return;
  const now = typeof performance !== "undefined" ? performance.now() : Date.now();
  const elapsed = now - ctx.lastAnimationShadowEmit;
  if (elapsed < ANIMATION_SHADOW_MS) {
    if (ctx.animationShadowTrailingTimer === null) {
      ctx.animationShadowTrailingTimer = setTimeout(() => {
        ctx.animationShadowTrailingTimer = null;
        if (!ctx.options.current.shadow?.followAnimation) return;
        emitAnimationShadowNow(ctx);
      }, ANIMATION_SHADOW_MS - elapsed);
    }
    return;
  }
  if (ctx.animationShadowTrailingTimer !== null) {
    clearTimeout(ctx.animationShadowTrailingTimer);
    ctx.animationShadowTrailingTimer = null;
  }
  emitAnimationShadowNow(ctx);
}

export function quantizeLightDirKey(d: Vec3 | undefined): string | null {
  if (!d) return null;
  const len = Math.hypot(d[0], d[1], d[2]);
  if (!Number.isFinite(len) || len <= 0) return null;
  const nx = Math.round((d[0] / len) * 100) / 100;
  const ny = Math.round((d[1] / len) * 100) / 100;
  const nz = Math.round((d[2] / len) * 100) / 100;
  return `${nx}|${ny}|${nz}`;
}

export function invalidateShadowLightCache(ctx: SceneContext): void {
  ctx.lastEmittedShadowLightKey = null;
}

/**
 * Signature of every camera-dependent decision in the scene's receiver
 * shadows: which receiver faces are camera-facing, which in turn also decides
 * which creases may bleed (and therefore whether a face paints its opaque
 * pre-blend or its alpha form). Folded into the emit short-circuit key so a
 * camera move re-emits exactly when it crosses a facing boundary — not on
 * every frame, and not never.
 *
 * Reads the CACHED face planes: a receiver whose planes have not been prepared
 * yet gets a `?` sentinel, which forces the emit that prepares them.
 */
function receiverCameraSignature(
  ctx: SceneContext,
  lights: { lightDir?: Vec3 | null; pointLightPositions?: Vec3[] },
): string {
  let out = "";
  for (const receiver of ctx.meshes) {
    if (receiver.disposed || !receiver.receiveShadow) continue;
    const planes = ctx.receiverShadowCache.get(receiver) as ReceiverFacePlane[] | undefined;
    if (!planes) { out += "?"; continue; }
    // Camera rotation only: `plane.n` is already in world frame (the plane
    // build applies the mesh rotation), so handing `meshRotation` down would be
    // dead weight at best — the signature strips it — and a second application
    // at worst. A mesh rotation change instead rebuilds the planes and re-emits
    // through `setTransform`, which is what makes this key valid to compare.
    const cameraRot: CameraCullRotation = {
      rotX: ctx.camera.state.rotX,
      rotY: ctx.camera.state.rotY,
    };
    out += `${receiverShadowCameraSignature(planes, cameraRot, lights)};`;
  }
  return out;
}

/**
 * Camera-move entry point. The receiver-shadow pipeline is camera-dependent
 * (back-facing receiver faces are culled, and a crease only bleeds toward a
 * camera-facing neighbour), so shadows left frozen through an orbit go stale
 * and then visibly pop on the next unrelated light or geometry change. Re-emit
 * only when the visibility signature changes — expensive work runs on boundary
 * crossings, not per pointermove.
 */
export function syncShadowsForCameraChange(ctx: SceneContext): void {
  if (ctx.lastEmittedShadowLightKey === null) return;
  let hasCaster = false;
  let hasReceiver = false;
  for (const m of ctx.meshes) {
    if (m.disposed) continue;
    if (m.castShadow) hasCaster = true;
    if (m.receiveShadow) hasReceiver = true;
  }
  if (!hasCaster || !hasReceiver) return;
  // The signature comparison itself lives in emitSceneShadows' short-circuit,
  // so an unchanged camera costs one plane sweep and returns.
  emitSceneShadows(ctx);
}

// Refreshes scene-level shadow SVGs for both lighting modes. Callers pass the
// entry that changed, but emission is scene-wide because every receiving
// surface aggregates every caster into one compound path. This is the
// geometry-change entry point — bust the H3 light-quantize cache so the
// next emit isn't short-circuited against a stale frame.
export function emitShadowLeaves(ctx: SceneContext, _entry: MeshEntry): void {
  invalidateShadowLightCache(ctx);
  emitSceneShadows(ctx);
}

// Refreshes every shadow SVG in the scene. Iterates each SURFACE (the
// global ground + every receiver face) once, then sweeps every caster's
// projection onto that surface into the same compound path. Mounted SVG
// elements are reused across light changes; fill-rule=nonzero collapses
// overlapping CCW outlines into one filled silhouette per surface.
export function emitSceneShadows(
  ctx: SceneContext,
  lightDirectionOverride?: Vec3,
  opts?: { progressive?: boolean },
): void {
  const currentOptions = ctx.options.current;
  const meshes = ctx.meshes;
  // Progressive: a light-drag emit uses `dragDefinition` (set the ctx flag the
  // receiver projector reads), then schedules ONE debounced full-def refine
  // after motion stops. Reset the timer each progressive call so a continuous
  // drag stays low-def until it settles. Geometry/texture-change emits pass
  // no `progressive` flag and always render at full definition.
  const sh = currentOptions.shadow;
  const wantProgressive = !!opts?.progressive
    && !!sh?.parametric
    && sh?.dragDefinition != null
    && sh.dragDefinition < (sh.definition ?? 16);
  ctx.shadowDragActive = wantProgressive;
  if (wantProgressive) {
    if (ctx.shadowRefineTimer) clearTimeout(ctx.shadowRefineTimer);
    ctx.shadowRefineTimer = setTimeout(() => {
      ctx.shadowRefineTimer = null;
      ctx.shadowDragActive = false;
      invalidateShadowLightCache(ctx);
      emitSceneShadows(ctx);
    }, SHADOW_REFINE_MS);
  }
  const casters: MeshEntry[] = [];
  for (const m of meshes) if (!m.disposed && m.castShadow) casters.push(m);
  if (casters.length === 0) {
    clearAllSceneShadows(ctx);
    ctx.lastEmittedShadowLightKey = null;
    return;
  }

  const shadowOpacity = currentOptions.shadow?.opacity ?? 0.25;
  // Vertices flow into shadow projection in CSS frame (worldPositionToCss);
  // the light direction must be in the same frame for the projection math.
  const userLightDir = lightDirectionOverride
    ?? currentOptions.directionalLight?.direction
    ?? ([0.4, -0.7, 0.59] as Vec3);
  const lightDir = worldDirectionToCss(userLightDir);

  // H3: short-circuit when the quantized light direction matches the cached
  // frame. invalidateShadowLightCache() is called by every code path that
  // mutates caster/receiver geometry or shadow appearance, so a cache hit
  // here means "same light, same scene → previous SVG content is still valid".
  // Point lights are baked-mode only (they don't drive dynamic-mode surface
  // shading), so in dynamic mode they must not drive shadows either —
  // otherwise colored point shadows appear over a floor the same lights
  // never lit, which reads as broken. Dynamic mode → directional shadows
  // only (ambient fill). Baked mode → full point participation.
  const pointLightsForShadow = currentOptions.textureLighting === "dynamic"
    ? []
    : (currentOptions.pointLights ?? []);
  // ALL point lights in CSS frame — the shaded shadow color needs every
  // light that illuminates the receiver (even non-casters), minus the one
  // being shadowed. `shadowPointIndices` are the entries that cast.
  const allPointLightsCss = pointLightsForShadow.map((pl) => ({
    position: worldPositionToCss(pl.position),
    color: pl.color,
    intensity: pl.intensity,
  }));
  const shadowPointIndices = pointLightsForShadow
    .map((pl, i) => (pl.castShadow ? i : -1))
    .filter((i) => i >= 0);
  const cssPointPositions = shadowPointIndices.map((i) => allPointLightsCss[i]!.position);
  // The directional pass runs only for an actual directional light with
  // nonzero intensity. Three.js parity: a zero-intensity (or absent)
  // directional light removes no light, so a blocked region is indistinct
  // from a lit one — no shadow. (The old implicit-sun fallback that drew a
  // default-direction shadow when no light was configured is gone.)
  const dirLight = currentOptions.directionalLight;
  const runDirectionalShadow = !!dirLight?.direction && (dirLight.intensity ?? 1) > 0;
  const dirKey = quantizeLightDirKey(lightDir);
  // Fold point-light positions into the short-circuit key so moving (or
  // toggling) a shadow point light re-emits even when the directional
  // vector is unchanged.
  const pointKey = cssPointPositions
    .map((p) => `${Math.round(p[0])},${Math.round(p[1])},${Math.round(p[2])}`)
    .join(";");
  const lightKey = dirKey === null && pointKey === "" ? null : `${dirKey ?? ""}|${pointKey}`;
  // The camera participates in receiver-shadow GEOMETRY (back-facing receiver
  // faces are culled) and PAINT (a crease bleeds only toward a camera-facing
  // neighbour, which also flips that face between the opaque pre-blend and the
  // alpha form), so it belongs in the short-circuit next to the light.
  const signatureLights = {
    lightDir: runDirectionalShadow ? lightDir : null,
    pointLightPositions: cssPointPositions,
  };
  const cameraKey = receiverCameraSignature(ctx, signatureLights);
  if (lightKey !== null && lightKey === ctx.lastEmittedShadowLightKey
    && cameraKey === ctx.lastEmittedShadowCameraKey) return;

  // Per-caster shadow dedup (independent meshes can't dedup against
  // each other). Computed once per caster, reused across surfaces.
  // The threshold has to be NEAR-IDENTICAL (~0.95) rather than loose
  // (0.4): `overlapScore2D` returns max(aInB, bInA), so a small
  // coplanar polygon entirely inside a larger one (e.g. the spine's
  // 1×1 top face contained in a 4×1 arm's top face on a multi-box
  // mesh like the parity bench E) scores 1.0 — and the dedup would
  // drop the smaller-area spine face. The dropped face has unique
  // x/y extent the survivor doesn't cover, so its shadow projection
  // is lost and the floor shadow develops visible stripes between
  // arms. True back-to-back or importer-duplicate faces have BOTH
  // fractions ≈ 1.0 so they still dedup at 0.95.
  // NOTE: the drop-set no longer flows into emitReceiverShadows (casting is
  // deliberately dedup-free there — see the prepareCasterPolyItems comment);
  // this loop's remaining job is warming the shared overlap cache once per
  // caster polygons identity, a behavior pinned by receiverShadowPerf tests.
  const dedupByCaster = new Map<MeshEntry, ReadonlySet<number>>();
  for (const c of casters) {
    dedupByCaster.set(c, cachedOverlappingPolygonDuplicates(c.polygons, {
      normalTolerance: 0.1,
      distanceTolerance: 0.5,
      overlapFraction: 0.95,
      // Authored double-sided backfaces would project coincident
      // shadows that stack their alpha against the front face — drop
      // them at the dedup step instead of in the SVG fill rule.
      preserveDoubleSidedBackfaces: false,
    }));
  }
  // Same dedup applied to RECEIVER polygons. Meshes with both inner
  // and outer wall layers (e.g. the bench cottage's OBJ has back-to-back
  // wall pairs) would otherwise emit one ReceiverFacePlane per layer,
  // each picking up casters and painting shadow independently — the
  // inner-wall shadow shows through PolyCSS's compositor because there's
  // no z-buffer to occlude it the way Three.js's depth pass would. The
  // dedup drops the inward-facing duplicate of each pair so only the
  // visible outer wall ends up as a receiver, matching what the user
  // can actually see. Same 0.95 overlap threshold as the caster dedup
  // — only near-identical back-to-back pairs match, adjacent walls of
  // different sizes don't get falsely merged.
  const dedupByReceiver = new Map<MeshEntry, Set<number>>();
  for (const m of meshes) {
    if (m.disposed || !m.receiveShadow) continue;
    // Receiver-side dedup disabled. The `facesInward` heuristic that
    // picks the "winner" of a duplicate pair was selecting the INNER
    // hidden polygon as the receiver for castle outer walls (109, 111
    // etc.), so the shadow got projected onto a polygon the user
    // couldn't see and the visible outer face was left un-shadowed.
    // preserveDoubleSidedBackfaces:true only helps opposite-normal
    // pairs; same-normal duplicates (the more common OBJ export
    // pattern) still mis-keep the inner side. The downside of leaving
    // all polys in is mild double-shadowing on shared pixels — much
    // smaller visual regression than missing shadows entirely.
    dedupByReceiver.set(m, new Set());
  }


  // Three.js parity: shadows render only on explicit `receiveShadow:true`
  // meshes. A caster with no receiver in the scene draws no shadow —
  // matching Three.js's `mesh.castShadow` contract. The legacy virtual
  // ground-shadow path (camera-agnostic projection onto an implicit
  // plane at scene.minZ) used to provide a convenience fallback for
  // scenes that forgot to add a floor receiver; we dropped it for
  // Three.js parity. Any per-mesh ground shadow SVG that the legacy
  // path may have mounted is hidden every tick.
  hideGroundShadow(ctx.shadowSvgState);
  for (const receiver of meshes) {
    if (receiver.disposed || !receiver.receiveShadow) continue;
    const dedup = dedupByReceiver.get(receiver) ?? new Set();
    // All of this receiver's light passes are merged into one SVG per face
    // (base = full-lit color, each pass a multiply layer) so overlapping
    // shadows composite to the both-blocked color. The directional pass runs
    // whenever a directional light is configured, or — to preserve the
    // implicit-sun shadow — when there are no shadow-casting point lights;
    // a point-only scene skips it so no phantom default-sun shadow appears.
    emitReceiverShadows(ctx, casters, receiver, dedup, lightDir, shadowOpacity, {
      runDirectional: runDirectionalShadow,
      points: cssPointPositions.map((lightPos, li) => ({ lightPos, index: shadowPointIndices[li]! })),
      allPointLights: allPointLightsCss,
    });
  }
  ctx.lastEmittedShadowLightKey = lightKey;
  // Recomputed AFTER the emit: this pass may have prepared face planes that
  // were absent (and stood in as `?`) when the key was checked above.
  ctx.lastEmittedShadowCameraKey = receiverCameraSignature(ctx, signatureLights);
}

// Recomputes the shadow ground plane from the minimum world-Z across all
// casting meshes. World Z stays as CSS Z under the world→CSS axis swap.
// In PolyCSS's world convention Z is up — the red-green plane in the axes
// helper is the floor. An optional `lift` (in world units) raises the
// plane slightly above the bbox floor to prevent z-fighting with
// receiver polygons.
//
// The ground value is folded into each mesh's SVG shadow path on the
// CPU, so a change requires re-emission of every caster's shadow.
export function recomputeShadowGround(ctx: SceneContext): void {
  const currentOptions = ctx.options.current;
  const meshes = ctx.meshes;
  const shadowSvgState = ctx.shadowSvgState;
  let minWorldZ = Infinity;
  // If any receivers exist, anchor the ground plane to the lowest
  // receiver bottom — that's the actual scene floor. Otherwise fall
  // back to the lowest caster bottom when no receiver mesh is registered.
  let hasReceiver = false;
  for (const m of meshes) if (!m.disposed && m.receiveShadow) { hasReceiver = true; break; }
  for (const m of meshes) {
    if (m.disposed) continue;
    const eligible = hasReceiver ? m.receiveShadow : m.castShadow;
    if (!eligible) continue;
    const dz = m.handle.transform.position?.[2] ?? 0;
    for (const poly of m.polygons) {
      for (const v of poly.vertices) {
        const wz = v[2] + dz;
        if (wz < minWorldZ) minWorldZ = wz;
      }
    }
  }
  if (!Number.isFinite(minWorldZ)) {
    const hadGround = shadowSvgState.currentGroundCssZ !== null;
    shadowSvgState.currentGroundCssZ = null;
    // No casters left: drop any shadow elements still mounted.
    if (hadGround) {
      clearAllSceneShadows(ctx);
      invalidateShadowLightCache(ctx);
    }
    return;
  }
  const lift = currentOptions.shadow?.lift ?? POLY_DEFAULT_SHADOW_LIFT;
  // World Z → CSS Z: the ground plane in CSS-Z coordinates. Lift is added
  // (not subtracted) so the shadow plane sits slightly *above* the model
  // bbox floor — putting it on top of a receiver mesh placed at minZ
  // rather than below it, where the receiver would occlude the shadow.
  const groundCssZ = (minWorldZ + lift) * DEFAULT_TILE;
  const prevGround = shadowSvgState.currentGroundCssZ;
  shadowSvgState.currentGroundCssZ = groundCssZ;
  // Ground changed: rebuild the scene-level shadow set once.
  if (prevGround !== groundCssZ) {
    invalidateShadowLightCache(ctx);
    emitSceneShadows(ctx);
  }
}
