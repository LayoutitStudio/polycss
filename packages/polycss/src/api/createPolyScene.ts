/**
 * createPolyScene — imperative scene API. The vanilla counterpart to
 * `<PolyScene>` in React / Vue.
 *
 * Takes a host element + scene options and returns a `PolySceneHandle` whose
 * `add(parseResult, transform?)` mounts a mesh under the scene root and returns
 * a removable `PolyMeshHandle`.
 *
 * Implementation:
 *   - Inserts a `<div class="polycss-scene">` into the host.
 *   - Each `add(...)` creates a `<div class="polycss-mesh">` with the mesh
 *     transform; mounts every valid polygon using the cheapest supported
 *     render-strategy leaf.
 *   - `destroy()` removes the scene element and disposes every mesh
 *     (which in turn disposes generated atlas blob URLs).
 *
 * The scene element is a 0×0 anchor at world (0,0,0) — pinned via
 * top:50%/left:50% so it sits at the visible center of the host. This
 * matches React/Vue's PolyScene anchor pattern. Polygons render around
 * the anchor via their own matrix3d translations.
 */
import type {
  ParseResult,
  Polygon,
  Vec3,
  PolyPointLight,
} from "@layoutit/polycss-core";
import type {
  PolyPerspectiveCameraHandle,
  PolyOrthographicCameraHandle,
} from "./createPolyCamera";
import {
  DEFAULT_SEAM_BLEED,
  computeSceneBbox,
  computeLightVisibility,
  capturePolyCameraSnapshot,
  inverseRotateVec3,
  optimizeMeshPolygons,

} from "@layoutit/polycss-core";
import {
  getSolidPaintDefaults,
  renderPolygonsWithTextureAtlas,
  renderPolygonsWithTextureAtlasAsync,
  renderPolygonsWithStableTriangles,
  updateStableTriangleFrame,
  updatePolygonsWithStableTopology,
  type SolidPaintDefaults,
} from "../render/textureAtlas";
import {
  createPolyVoxelRenderer,
  type PolyVoxelRenderer,
} from "../render/voxelRenderer";
import { injectPolyBaseStyles } from "../styles/styles";
import {
  DEFAULT_TILE,
  applyCssZoomCompensation,
  buildMeshTransform,
  buildSceneTransformFromCamera,
  effectiveCssZoom,
  worldDirectionalLightToCss,
} from "./scene/transforms";
import {
  shadowOptsEqual,
  strategiesEqual,
  vec3Equal,
} from "./scene/equality";
import {
  applyDynamicLightVars,
  applySolidPaintVars,
} from "./scene/lightingVars";
import type {
  MeshEntry,
} from "./scene/internalTypes";
import { createSceneContext } from "./scene/sceneContext";
import type { SceneContext } from "./scene/sceneContext";
import {
  TEXTURES_READY,
  clearRendered,
  setRendered,
} from "./scene/mountLifecycle";
import {
  cameraCullRotation,
  canDomCullCamera,
  recomputeCameraCullGroups,
  syncCameraCullSignature,
} from "./scene/cameraCull";
import {
  syncMountedRendered,
  syncMountedRenderedChunked,
  syncMountedRenderedForCameraChange,
} from "./scene/mountSync";
import {
  canRenderVoxelDirect,
  localPointLightsForEntry,
  requestRebakeAtlas,
} from "./scene/rebake";
import {
  applyMeshLightVarOverride,
  clearBakedSolidLightingPreview,
  commitBakedSolidLighting,
  previewBakedSolidLighting,
} from "./scene/bakedLighting";
import { tryUpdatePolygonLeafOnly } from "./scene/polygonPatch";
import { disposeReceiverShadowMounts } from "./scene/receiverShadow";
import {
  clearCasterItemsCache as clearCasterItemsCacheImpl,
  clearReceiverShadowCache as clearReceiverShadowCacheImpl,
} from "./scene/shadowCache";
import {
  cachedOverlappingPolygonDuplicates,
  emitSceneShadows,
  emitShadowLeaves,
  invalidateShadowLightCache,
  maybeEmitAnimationShadow,
  recomputeShadowGround,
  syncShadowsForCameraChange,
} from "./scene/shadowOrchestrator";
import type {
  InternalPolyMeshHandle,
  InternalSetPolygonsOptions,
  PolyAnimationTriangleFrame,
  PolyMeshHandle,
  PolyMeshTransform,
  PolySceneHandle,
  PolySceneOptions,
} from "./scene/types";
import { POLY_ANIMATION_TRIANGLE_FRAME_TARGET } from "./scene/types";

export type {
  PolyMeshHandle,
  PolyMeshTransform,
  PolySceneHandle,
  PolySceneOptions,
  PolyShadowOptions,
} from "./scene/types";

function normalizeSceneOptions<T extends Partial<Omit<PolySceneOptions, "camera">>>(options: T): T {
  if (!Object.prototype.hasOwnProperty.call(options, "seamBleed") || options.seamBleed !== undefined) {
    return options;
  }
  return { ...options, seamBleed: DEFAULT_SEAM_BLEED };
}


export function createPolyScene(
  host: HTMLElement,
  options: PolySceneOptions,
): PolySceneHandle {
  if (!host || typeof host.appendChild !== "function") {
    throw new Error("createPolyScene: host must be an HTMLElement");
  }
  if (!options?.camera) {
    throw new Error(
      "createPolyScene: a camera handle is required. " +
      "Use createPolyCamera({...}) or createPolyPerspectiveCamera({...}) and pass as { camera }."
    );
  }

  const camera = options.camera;

  // Inject base styles into the host's owning document so .polycss-scene
  // has perspective + preserve-3d defaults.
  if (host.ownerDocument) injectPolyBaseStyles(host.ownerDocument);

  // The scene element pins itself at top:50%/left:50% — needs the host to
  // be a positioned ancestor or the offsets resolve against the document.
  // Force `position: relative` only if the host has no positioning yet, so
  // we don't clobber a deliberate `absolute`/`fixed`/`sticky` from the user.
  if (host.ownerDocument?.defaultView) {
    const computed = host.ownerDocument.defaultView.getComputedStyle(host);
    if (computed.position === "static") host.style.position = "relative";
  }

  // currentOptions holds non-camera scene options only.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { camera: _cameraOption, ...nonCameraOptions } = options;
  let currentOptions: Omit<PolySceneOptions, "camera"> = normalizeSceneOptions({
    seamBleed: DEFAULT_SEAM_BLEED,
    ...nonCameraOptions,
  });
  const layoutScale = effectiveCssZoom(host);

  // Bbox-center of all live meshes (helpers opt out). Auto-managed by
  // `recomputeAutoCenter`. Folded into the scene transform alongside
  // `target` so the camera orbits the model's visible center without
  // shifting the mesh DOM. Independent of `target` so user pan survives
  // mesh add/remove. Declared here (above the first `applySceneStyle`
  // call) so it's initialized before the closure reads it.
  let autoCenterOffset: Vec3 = [0, 0, 0];

  const doc = host.ownerDocument ?? document;
  // Camera wrapper: carries the CSS `perspective` so it foreshortens the
  // scene's direct 3D children correctly. Matches React/Vue's
  // `<div class="polycss-camera">` wrapper emitted by PolyPerspectiveCamera.
  const cameraEl = doc.createElement("div");
  cameraEl.className = "polycss-camera";
  applyCameraStyle(cameraEl, currentOptions);
  host.appendChild(cameraEl);

  const sceneEl = doc.createElement("div");
  sceneEl.className = "polycss-scene";
  sceneEl.setAttribute("aria-hidden", "true");
  // 0×0 anchor at the host's visible center. Polygons render around it.
  applySceneStyle(sceneEl, currentOptions);

  cameraEl.appendChild(sceneEl);

  // Bundle every mutable scene-state field into a SceneContext. Extracted
  // scene/* helpers take this object as their first arg instead of capturing
  // a 30-symbol closure. `meshes`, `shadowSvgState`, the cache maps, etc.
  // are aliased below so the rest of the closure body uses the same names
  // it always did; the alias and the ctx field reference the same object.
  const ctx: SceneContext = createSceneContext({
    host,
    doc,
    cameraEl,
    sceneEl,
    camera,
    layoutScale,
    options: currentOptions,
  });
  const meshes = ctx.meshes;
  // Element → MeshEntry index. Outside the SceneContext because it's a
  // pure-DOM lookup that the extracted shadow helpers never need; only
  // findMeshByElement and click-target resolution use it.
  const meshByElement = new WeakMap<HTMLElement, MeshEntry>();

  // Cache-management closures over the SceneContext. The actual maps live
  // on `ctx` and are read/written by the extracted shadow emitters.
  const clearReceiverShadowCache = (entry?: MeshEntry) =>
    clearReceiverShadowCacheImpl(ctx, entry);
  const clearCasterItemsCache = (entry?: MeshEntry) =>
    clearCasterItemsCacheImpl(ctx, entry);

  // Apply CSS perspective on the camera wrapper, not the scene element.
  // CSS `perspective` only foreshortens direct children's 3D transforms, so
  // the wrapper must be the perspective context for .polycss-scene to work
  // correctly — matching React/Vue's PolyPerspectiveCamera wrapper shape.
  function applyCameraStyle(el: HTMLElement, _opts: Omit<PolySceneOptions, "camera">): void {
    const snapshot = capturePolyCameraSnapshot(camera);
    el.style.perspective = snapshot.appliedPerspectiveStyle;
    el.dataset.polycssCameraProjection = snapshot.projection;
    el.dataset.polycssCameraPerspective = snapshot.perspectiveStyle;
    el.dataset.polycssCameraAppliedPerspective = snapshot.appliedPerspectiveStyle;
    el.dataset.polycssCameraZoom = String(snapshot.state.zoom);
    el.dataset.polycssCameraDistance = String(snapshot.state.distance);
    el.dataset.polycssCameraRotX = String(snapshot.state.rotX);
    el.dataset.polycssCameraRotY = String(snapshot.state.rotY);
    el.dataset.polycssCameraTarget = snapshot.state.target.join(",");
  }

  // Dynamic lighting cascade vars: PolyScene writes the directional + ambient
  // light setup to these custom properties on the scene root. Each polygon's
  // <i> bakes its own normal directly into an inline calc() that reads these
  // vars to resolve the Lambert dot product and per-channel tint. Sliding
  // the light only writes these scene-root vars — no JS, no atlas redraw.
  //
  // Additionally emits --clx/--cly/--clz: the directional light expressed in
  // CSS coordinate space (world-Y→CSS-X, world-X→CSS-Y, world-Z→CSS-Z). These
  // are used by the shadow projection matrix (--shadow-proj) which must operate
  // on matrix3d positions that live in CSS space — not world space. The Lambert
  // dot product can use world-space normals because both normals and light sit
  // in the same frame there; the shadow projection works against 3D positions
  // that have already been through the axis swap, so it needs the light in
  // that same swapped frame.
  function applySceneStyle(el: HTMLElement, opts: Omit<PolySceneOptions, "camera">): void {
    applyCssZoomCompensation(el, layoutScale);
    el.style.transform = buildSceneTransformFromCamera(camera, autoCenterOffset, layoutScale);
    applyDynamicLightVars(el, opts);
  }

  function applySceneCameraTransform(el: HTMLElement): void {
    el.style.transform = buildSceneTransformFromCamera(camera, autoCenterOffset, layoutScale);
  }

  // Per-light raytrace cache. Returns the set of polygon indices the
  // directional light cannot reach (occluded by another polygon of the
  // same mesh). Used by baked atlas planning to force directScale=0 on
  // those polys so they render ambient-only — matches what a shadow-map
  // depth-test would do, without running per-frame.
  //
  // The mesh's bakedRotation already lives in the (lightDir) passed by
  // rebakeAtlas (light is inverse-rotated to mesh-local frame), so the
  // raytrace can run directly against entry.polygons.
  function occludedPolyIndicesForEntry(
    entry: MeshEntry,
    lightDir: Vec3 | undefined,
  ): ReadonlySet<number> | undefined {
    if (!lightDir) return undefined;
    if (!entry.polygons || entry.polygons.length < 2) return undefined;
    const lLen = Math.hypot(lightDir[0], lightDir[1], lightDir[2]);
    if (!Number.isFinite(lLen) || lLen <= 0) return undefined;
    const lx = lightDir[0] / lLen, ly = lightDir[1] / lLen, lz = lightDir[2] / lLen;
    // Quantize so jittery slider input doesn't bust the cache every frame.
    const k = (v: number) => Math.round(v * 1000) / 1000;
    const lightDirKey = `${k(lx)},${k(ly)},${k(lz)}`;
    const cached = entry.lightOcclusionCache;
    if (cached && cached.polygons === entry.polygons && cached.lightDirKey === lightDirKey) {
      return cached.occluded;
    }
    // Reuse the dedup drop-set across light-direction changes — it's a
    // pure geometric property of the polygon set, not of the light. This
    // matters because dedup is O(n²) and the raytrace itself is BVH-fast.
    // Tight thresholds vs the shadow-rendering dedup (distanceTolerance:
    // 0.5, overlapFraction: 0.95): only drop near-coincident back-to-back
    // wall pairs (~0.05-0.1 mesh units apart — the OBJ double-face quirk
    // that caused the cottage false-positive). With distanceTolerance: 0.5
    // the bench castle drops 104/681 polys including legitimate occluded
    // walls (polygon 111). Tightening to 0.12 + overlapFraction 0.98
    // captures the cottage case and leaves merlon/tower geometry intact.
    const dedupDropped = cachedOverlappingPolygonDuplicates(entry.polygons, {
      normalTolerance: 0.1,
      distanceTolerance: 0.12,
      overlapFraction: 0.98,
      preserveDoubleSidedBackfaces: false,
    });
    const occluded = computeLightVisibility(entry.polygons, [lx, ly, lz], dedupDropped);
    entry.lightOcclusionCache = {
      polygons: entry.polygons,
      lightDirKey,
      occluded,
      dedupDropped,
    };
    return occluded;
  }

  function renderEntry(entry: MeshEntry, lightDirectionOverride?: Vec3): void {
    clearRendered(ctx, entry);
    const baseDirLight = currentOptions.directionalLight;
    // lightDirectionOverride and baseDirLight.direction are both in user
    // world frame; convert to renderer CSS frame for the lambert dot product.
    const userDirLight: typeof baseDirLight = lightDirectionOverride
      ? { ...baseDirLight, direction: lightDirectionOverride }
      : baseDirLight;
    const directionalLight = worldDirectionalLightToCss(userDirLight);
    // Per-light raytrace occlusion (task #121). Re-enabled — the cottage
    // false-positive (back-to-back inner/outer wall pairs ~0.05-0.1 mesh
    // units apart self-occluding the outer face) is dropped via the
    // dedup-before-raytrace path inside occludedPolyIndicesForEntry. We
    // pass `findOverlappingPolygonDuplicates`'s drop-set as `skipIndices`
    // to `computeLightVisibility`, which removes those polys from both
    // the source loop AND the BVH candidate set.
    //
    // Frame: pass the USER-WORLD light direction, not the CSS-frame one.
    // `computeLightVisibility` raytraces against polygon vertices in
    // their original frame (vertex arrays as the parser produced them),
    // so the light direction must match that frame. Passing the CSS-
    // converted direction here mismatches axes (X↔Y swap) and silently
    // gives wrong occlusion results — matches the regression from
    // task #126.
    // Per-light occlusion raytrace (task #121) used to mark polygons in
    // ray-traced shadow with `directScale=0` so they baked at ambient-only.
    // Three.js doesn't bake shadow into the diffuse atlas — it uses a real
    // shadow map at render time, so a "in shadow" polygon's diffuse stays
    // at full Lambert(n·L) and the shadow darkens it later. Matching that
    // contract avoids the gallery's "first render looks dim, brightens
    // after I move a light" symptom (the commit-on-light bake never knew
    // about the occluded set and so always produced the bright look —
    // which is the correct one). The occluded set is still computed by
    // the dynamic path for per-leaf SH-1 visibility (task #128).
    const lightOccludedPolyIndices: ReadonlySet<number> | undefined = undefined;
    void occludedPolyIndicesForEntry; // keep helper exported for dynamic path
    if (canRenderVoxelDirect(ctx, entry)) {
      const renderer = createPolyVoxelRenderer({
        doc,
        wrapper: entry.wrapper,
        polygons: entry.parseResult.polygons,
        directionalLight,
        ambientLight: currentOptions.ambientLight,
      });
      if (renderer) {
        entry.voxelRenderer = renderer;
        renderer.render(cameraCullRotation(ctx, entry));
        entry.cameraCullSignature = "voxel-direct";
        entry.textureReadyPromise = TEXTURES_READY;
        return;
      }
    }

    const renderOptions = {
      doc,
      directionalLight,
      pointLights: localPointLightsForEntry(ctx, entry),
      ambientLight: currentOptions.ambientLight,
      textureLighting: currentOptions.textureLighting,
      textureQuality: currentOptions.textureQuality,
      textureLeafSizing: currentOptions.textureLeafSizing,
      textureImageRendering: currentOptions.textureImageRendering,
      textureBackend: currentOptions.textureBackend,
      textureProjection: currentOptions.textureProjection,
      seamBleed: currentOptions.seamBleed,
      strategies: currentOptions.strategies,
      lightOccludedPolyIndices,
    };
    const atlas = entry.stableDom
      ? (() => {
          const solidPaintDefaults = getSolidPaintDefaults(entry.polygons, renderOptions);
          applySolidPaintVars(entry.wrapper, solidPaintDefaults);
          return renderPolygonsWithStableTriangles(entry.polygons, {
            ...renderOptions,
            solidPaintDefaults,
          }) ?? renderPolygonsWithTextureAtlas(entry.polygons, {
            ...renderOptions,
            solidPaintDefaults,
          });
        })()
      : renderPolygonsWithTextureAtlas(entry.polygons, {
          ...renderOptions,
          computeSolidPaintDefaults: true,
          skipDynamicNormalVars: currentOptions.textureLighting === "dynamic",
        } as typeof renderOptions & { computeSolidPaintDefaults: true });
    if (!entry.stableDom) {
      applySolidPaintVars(
        entry.wrapper,
        (atlas as { solidPaintDefaults?: SolidPaintDefaults }).solidPaintDefaults ?? {},
      );
    }
    setRendered(entry, atlas.rendered, atlas.dispose, atlas.pagesReady);
    entry.skipBucketNormalCleanupOnce =
      currentOptions.textureLighting === "dynamic" && !entry.stableDom;
    recomputeCameraCullGroups(entry);
    syncMountedRendered(ctx, entry);
    emitShadowLeaves(ctx, entry);
  }

  async function renderEntryChunked(
    entry: MeshEntry,
    shouldCancel: () => boolean,
  ): Promise<boolean> {
    clearRendered(ctx, entry);
    const directionalLight = worldDirectionalLightToCss(currentOptions.directionalLight);
    const renderOptions = {
      doc,
      directionalLight,
      pointLights: localPointLightsForEntry(ctx, entry),
      ambientLight: currentOptions.ambientLight,
      textureLighting: currentOptions.textureLighting,
      textureQuality: currentOptions.textureQuality,
      textureLeafSizing: currentOptions.textureLeafSizing,
      textureImageRendering: currentOptions.textureImageRendering,
      textureBackend: currentOptions.textureBackend,
      textureProjection: currentOptions.textureProjection,
      seamBleed: currentOptions.seamBleed,
      strategies: currentOptions.strategies,
      // Per-light raytrace occlusion (task #121) disabled — see renderEntry.
      lightOccludedPolyIndices: undefined as ReadonlySet<number> | undefined,
    };
    const atlas = entry.stableDom
      ? renderPolygonsWithStableTriangles(entry.polygons, renderOptions)
      : null;
    if (atlas) {
      const solidPaintDefaults = getSolidPaintDefaults(entry.polygons, renderOptions);
      applySolidPaintVars(entry.wrapper, solidPaintDefaults);
      setRendered(entry, atlas.rendered, atlas.dispose, atlas.pagesReady);
      recomputeCameraCullGroups(entry);
      syncMountedRendered(ctx, entry);
      emitShadowLeaves(ctx, entry);
      return !shouldCancel();
    }

    const asyncAtlas = await renderPolygonsWithTextureAtlasAsync(
      entry.polygons,
      {
        ...renderOptions,
        skipDynamicNormalVars: currentOptions.textureLighting === "dynamic",
      } as typeof renderOptions & { skipDynamicNormalVars: boolean },
      shouldCancel,
    );
    if (shouldCancel()) {
      asyncAtlas.dispose();
      return false;
    }
    applySolidPaintVars(entry.wrapper, asyncAtlas.solidPaintDefaults);
    setRendered(entry, asyncAtlas.rendered, asyncAtlas.dispose, asyncAtlas.pagesReady);
    entry.skipBucketNormalCleanupOnce =
      currentOptions.textureLighting === "dynamic" && !entry.stableDom;
    recomputeCameraCullGroups(entry);
    const mounted = await syncMountedRenderedChunked(ctx, entry, shouldCancel);
    if (mounted) emitShadowLeaves(ctx, entry);
    return mounted;
  }

  function recomputeAutoCenter(): void {
    // Three.js–style: instead of moving the meshes (via a wrapper translate),
    // store the bbox center as a camera-target offset. `buildSceneTransform`
    // folds it into the scene's rotation pivot, so the visible center stays
    // at the viewport without adding a DOM wrapper or shifting polygon
    // coordinates.
    const prev = autoCenterOffset;
    let next: Vec3 = [0, 0, 0];
    if (currentOptions.autoCenter) {
      const all: Polygon[] = [];
      for (const m of meshes) {
        if (!m.disposed && !m.excludeFromAutoCenter) all.push(...m.polygons);
      }
      if (all.length > 0) {
        const bbox = computeSceneBbox(all);
        next = [
          (bbox.min[0] + bbox.max[0]) / 2,
          (bbox.min[1] + bbox.max[1]) / 2,
          (bbox.min[2] + bbox.max[2]) / 2,
        ];
      }
    }
    if (prev[0] === next[0] && prev[1] === next[1] && prev[2] === next[2]) return;
    autoCenterOffset = next;
    ctx.autoCenter.offset = next;
    applySceneStyle(sceneEl, currentOptions);
  }

  function add(parseResult: ParseResult, transformIn: PolyMeshTransform = {}): PolyMeshHandle {
    const mountDoc = sceneEl.ownerDocument ?? document;
    const wrapper = mountDoc.createElement("div");
    wrapper.className = "polycss-mesh";
    if (transformIn.id) wrapper.setAttribute("data-poly-mesh-id", transformIn.id);
    const autoMeshId = `polycss-mesh-${ctx.meshAutoCounter.next++}`;
    wrapper.setAttribute("data-poly-mesh-index", autoMeshId);

    let transform: PolyMeshTransform = { ...transformIn };
    let mergeOnUpdate = transformIn.merge !== false;
    let stableDomOnUpdate = !!transformIn.stableDom;
    let polygonUpdateVersion = 0;
    const css = buildMeshTransform(transform);
    if (css) wrapper.style.transform = css;

    // Static meshes use the full optimizer by default; meshResolution selects
    // the quality intent. Explicit merge:false remains the escape hatch for
    // animated topology updates and helper meshes that are already prepared.
    //
    // Interior culling is applied independently of `merge`. It removes
    // polygons that are fully enclosed by other geometry of the same
    // mesh (e.g. cottage interior walls, doors, frames) — those serve
    // no rendering purpose and they generate phantom shadow casts on
    // any receiver the ray-test would project them onto. Three.js gets
    // this for free from its depth pass; PolyCSS needs the explicit
    // cull. Skipped on voxel-source meshes (every voxel face is
    // visible by construction) and on stable-DOM meshes (animation
    // frame topology must stay constant).
    const preparePolygons = (polygons: Polygon[], merge: boolean): Polygon[] => {
      if (parseResult.voxelSource) return polygons;
      if (merge) return optimizeMeshPolygons(polygons, { meshResolution: transformIn.meshResolution });
      if (stableDomOnUpdate) return polygons;
      // Helpers (axes, lights, transform gizmos) are author-curated
      // tiny meshes whose polygons are all meant to be visible — they
      // commonly have faces that point "inward" toward the helper's
      // bbox center (arrow heads, axis crosses) which the interior
      // cull would falsely drop. `excludeFromAutoCenter` is the
      // existing flag library helpers set on themselves; reuse it as
      // the "skip topology pruning" signal.
      if (transformIn.excludeFromAutoCenter) return polygons;
      // No automatic interior cull for merge:false meshes — callers
      // commonly use that flag to preserve raw author-curated geometry
      // (the bench parity E is 4 overlapping boxes; cull falsely
      // identifies some box-junction faces as enclosed). Building OBJs
      // that DO want interior cull go through optimizeMeshPolygons
      // via merge:true (the default), which already runs cull as part
      // of its preprocess.
      return polygons;
    };
    const sourcePolygons = preparePolygons(parseResult.polygons, mergeOnUpdate);

    // Three.js parity: wrapper rotation, scale and translate all pivot at
    // the wrapper's local (0,0,0). Parser places geometry either with
    // bbox-min at origin (default) or centered (parser `{ center: true }`);
    // callers wanting "rotate in place around centroid" use the centered
    // variant. `bboxCenterCssCache` still tracks the geometry bbox center
    // because the shadow cache keys on it (receiverShadow.ts) — same data,
    // but it no longer drives transform-origin.
    let bboxCenterCssCache: Vec3 | null = null;
    function reapplyWrapperTransform(): void {
      const css = buildMeshTransform(transform);
      wrapper.style.transform = css ?? "";
    }
    function applyTransformOrigin(polygons: Polygon[]): void {
      if (polygons.length === 0) {
        bboxCenterCssCache = null;
        if (entryRef) entryRef.bboxCenterCss = null;
        reapplyWrapperTransform();
        return;
      }
      let minX = Infinity, minY = Infinity, minZ = Infinity;
      let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
      for (const poly of polygons) {
        for (const v of poly.vertices) {
          if (v[0] < minX) minX = v[0];
          if (v[0] > maxX) maxX = v[0];
          if (v[1] < minY) minY = v[1];
          if (v[1] > maxY) maxY = v[1];
          if (v[2] < minZ) minZ = v[2];
          if (v[2] > maxZ) maxZ = v[2];
        }
      }
      if (!Number.isFinite(minX)) {
        bboxCenterCssCache = null;
        if (entryRef) entryRef.bboxCenterCss = null;
        reapplyWrapperTransform();
        return;
      }
      // World→CSS axis remap (matches polygonGeometry / autoCenter).
      const cssX = ((minY + maxY) / 2) * DEFAULT_TILE;
      const cssY = ((minX + maxX) / 2) * DEFAULT_TILE;
      const cssZ = ((minZ + maxZ) / 2) * DEFAULT_TILE;
      bboxCenterCssCache = [cssX, cssY, cssZ];
      if (entryRef) entryRef.bboxCenterCss = bboxCenterCssCache;
      reapplyWrapperTransform();
    }
    let entryRef: MeshEntry | null = null;
    applyTransformOrigin(sourcePolygons);

    sceneEl.appendChild(wrapper);

    const entry: MeshEntry = {
      handle: undefined as unknown as PolyMeshHandle,
      wrapper,
      parseResult,
      rendered: [],
      renderedByPolygonIndex: [],
      shadowRendered: [],
      polygons: sourcePolygons,
      voxelSource: parseResult.voxelSource,
      disposed: false,
      stableDom: stableDomOnUpdate,
      hasBuckets: false,
      skipBucketNormalCleanupOnce: false,
      excludeFromAutoCenter: !!transformIn.excludeFromAutoCenter,
      castShadow: !!transformIn.castShadow,
      bboxCenterCss: bboxCenterCssCache,
      receiveShadow: !!transformIn.receiveShadow,
      shadowDefinition: transformIn.shadowDefinition,
      cameraCullGroups: [],
      cameraCullSignature: "",
      lightOverrideSignature: "clear",
      stableTriangleColorFrame: 0,
      solidLightingPreviewPrepared: false,
      solidLightingPreviewActive: false,
      bakedRotation: (transformIn.rotation ? [...transformIn.rotation] : [0, 0, 0]) as Vec3,
      autoMeshId,
      rebakeInFlight: false,
      rebakeQueuedLightDir: null,
      textureReadyPromise: TEXTURES_READY,
    };

    let currentTriangleFrame: PolyAnimationTriangleFrame | null = null;
    let currentTriangleFrameVersion = 0;
    let materializedTriangleFrameVersion = -1;
    let materializedTriangleFramePolygons: Polygon[] | null = null;

    function clearCurrentTriangleFrame(): void {
      currentTriangleFrame = null;
      materializedTriangleFramePolygons = null;
      materializedTriangleFrameVersion = -1;
    }

    function currentPolygons(): Polygon[] {
      const frame = currentTriangleFrame;
      if (!frame || frame.polygonCount !== entry.polygons.length) return entry.polygons;
      if (
        materializedTriangleFramePolygons &&
        materializedTriangleFrameVersion === currentTriangleFrameVersion
      ) {
        return materializedTriangleFramePolygons;
      }
      const values = frame.vertices;
      const out: Polygon[] = new Array(frame.polygonCount);
      for (let polygonIndex = 0; polygonIndex < frame.polygonCount; polygonIndex++) {
        const base = entry.polygons[polygonIndex]!;
        const offset = polygonIndex * 9;
        out[polygonIndex] = {
          ...base,
          color: frame.colors?.[polygonIndex] ?? base.color,
          vertices: [
            [values[offset]!, values[offset + 1]!, values[offset + 2]!] as Vec3,
            [values[offset + 3]!, values[offset + 4]!, values[offset + 5]!] as Vec3,
            [values[offset + 6]!, values[offset + 7]!, values[offset + 8]!] as Vec3,
          ],
        };
      }
      materializedTriangleFramePolygons = out;
      materializedTriangleFrameVersion = currentTriangleFrameVersion;
      return out;
    }

    function applyStableTopologyUpdate(
      options: InternalSetPolygonsOptions | undefined,
      shouldRecomputeAutoCenter: boolean,
    ): boolean {
      const colorOnlyStableTriangleUpdate =
        options?.stableTriangleUpdateMode === "color-only";
      entry.stableTriangleColorFrame++;
      const shouldSkipTransformOrigin =
        entry.stableDom && !shouldRecomputeAutoCenter;
      if (!shouldSkipTransformOrigin) applyTransformOrigin(entry.polygons);
      if (entry.stableDom && !entry.hasBuckets) {
        const renderOptions = {
          doc,
          directionalLight: worldDirectionalLightToCss(currentOptions.directionalLight),
          ambientLight: currentOptions.ambientLight,
          textureLighting: currentOptions.textureLighting,
          textureQuality: currentOptions.textureQuality,
          textureLeafSizing: currentOptions.textureLeafSizing,
          textureImageRendering: currentOptions.textureImageRendering,
          textureBackend: currentOptions.textureBackend,
          textureProjection: currentOptions.textureProjection,
          seamBleed: currentOptions.seamBleed,
        };
        const allStableTriangles =
          entry.rendered.length === entry.polygons.length &&
          entry.rendered.every((item) => item.kind === "triangle");
        const optimizeStableTopology =
          entry.stableDom && !shouldRecomputeAutoCenter;
        const solidPaintDefaults = allStableTriangles || optimizeStableTopology
          ? {}
          : getSolidPaintDefaults(entry.polygons, renderOptions);
        if (!allStableTriangles) applySolidPaintVars(entry.wrapper, solidPaintDefaults);
        const stableTopologyOptions = {
          ...renderOptions,
          solidPaintDefaults,
          optimizeStableTriangleStyle: true,
          stableTriangleDebug: options?.stableTriangleDebug,
          stableTriangleUpdateMode: options?.stableTriangleUpdateMode,
          stableTriangleColorPolicy: options?.stableTriangleColorPolicy,
          stableTriangleColorSteps: options?.stableTriangleColorSteps,
          stableTriangleColorFreezeFrames: options?.stableTriangleColorFreezeFrames,
          stableTriangleColorBudget: options?.stableTriangleColorBudget,
          stableTriangleColorMaxAge: options?.stableTriangleColorMaxAge,
          stableTriangleColorMaxStep: options?.stableTriangleColorMaxStep,
          stableTriangleMatrixDecimals: options?.stableTriangleMatrixDecimals,
          stableTriangleColorFrame: entry.stableTriangleColorFrame,
        } as Parameters<typeof updatePolygonsWithStableTopology>[2] & {
          optimizeStableTriangleStyle: boolean;
          stableTriangleDebug?: "transform-only" | "plan-only";
          stableTriangleUpdateMode?: "full" | "transform-only" | "color-only";
          stableTriangleColorPolicy?: "cadence" | "adaptive";
          stableTriangleColorSteps?: number;
          stableTriangleColorFreezeFrames?: number;
          stableTriangleColorBudget?: number;
          stableTriangleColorMaxAge?: number;
          stableTriangleColorMaxStep?: number;
          stableTriangleMatrixDecimals?: number;
          stableTriangleColorFrame?: number;
        };
        if (
          updatePolygonsWithStableTopology(
            entry.rendered,
            entry.polygons,
            stableTopologyOptions,
          )
        ) {
          if (!colorOnlyStableTriangleUpdate) {
            recomputeCameraCullGroups(entry);
            syncMountedRenderedForCameraChange(ctx, entry, true);
            if (shouldRecomputeAutoCenter) recomputeAutoCenter();
          }
          return true;
        }
      }
      if (shouldSkipTransformOrigin) applyTransformOrigin(entry.polygons);
      return false;
    }

    const handle: InternalPolyMeshHandle = {
      get polygons() { return currentPolygons(); },
      set polygons(polygons: Polygon[]) {
        clearCurrentTriangleFrame();
        entry.polygons = polygons;
      },
      element: wrapper,
      id: transformIn.id,
      get transform() { return transform; },
      remove() {
        polygonUpdateVersion++;
        if (wrapper.parentNode) wrapper.parentNode.removeChild(wrapper);
        // Removing from DOM doesn't auto-dispose generated atlas/blob URLs.
        clearRendered(ctx, entry);
        meshes.delete(entry);
        meshByElement.delete(wrapper);
        clearReceiverShadowCache(entry);
        clearCasterItemsCache(entry);
        recomputeAutoCenter();
        recomputeShadowGround(ctx);
      },
      setPolygons(polygons: Polygon[], options?: InternalSetPolygonsOptions) {
        polygonUpdateVersion++;
        mergeOnUpdate = options?.merge ?? mergeOnUpdate;
        stableDomOnUpdate = options?.stableDom ?? stableDomOnUpdate;
        entry.stableDom = stableDomOnUpdate;
        entry.voxelSource = undefined;
        entry.polygons = preparePolygons(polygons, mergeOnUpdate);
        clearCasterItemsCache(entry);
        clearReceiverShadowCache(entry);
        clearCurrentTriangleFrame();
        handle.polygons = entry.polygons;
        const shouldRecomputeAutoCenter = options?.recomputeAutoCenter ?? true;
        // Animated shadows: re-project (throttled) from the freshly-deformed
        // polygons so the shadow tracks the pose. entry.polygons is already the
        // current frame's geometry here; the caster-item cache was just cleared.
        maybeEmitAnimationShadow(ctx, entry);
        if (applyStableTopologyUpdate(options, shouldRecomputeAutoCenter)) return;
        renderEntry(entry);
        if (shouldRecomputeAutoCenter) recomputeAutoCenter();
      },
      [POLY_ANIMATION_TRIANGLE_FRAME_TARGET](
        frame: PolyAnimationTriangleFrame,
        options?: InternalSetPolygonsOptions,
      ) {
        const nextMergeOnUpdate = options?.merge ?? mergeOnUpdate;
        const nextStableDomOnUpdate = options?.stableDom ?? stableDomOnUpdate;
        if (
          !frame.solidTriangles ||
          !nextStableDomOnUpdate ||
          nextMergeOnUpdate ||
          transformIn.meshResolution !== undefined ||
          entry.hasBuckets ||
          frame.polygonCount !== entry.polygons.length ||
          frame.vertices.length < frame.polygonCount * 9 ||
          entry.rendered.length !== frame.polygonCount
        ) {
          return false;
        }
        for (let i = 0; i < entry.rendered.length; i++) {
          const rendered = entry.rendered[i];
          const polygon = entry.polygons[i];
          if (
            rendered?.kind !== "triangle" ||
            rendered.polygonIndex !== i ||
            !polygon ||
            polygon.vertices.length !== 3 ||
            polygon.texture ||
            polygon.material?.texture
          ) {
            return false;
          }
        }

        const shouldRecomputeAutoCenter = options?.recomputeAutoCenter ?? true;
        if (!shouldRecomputeAutoCenter) {
          const colorFrame = entry.stableTriangleColorFrame + 1;
          const stableTopologyOptions = {
            doc,
            directionalLight: worldDirectionalLightToCss(currentOptions.directionalLight),
            ambientLight: currentOptions.ambientLight,
            textureLighting: currentOptions.textureLighting,
            textureQuality: currentOptions.textureQuality,
            textureLeafSizing: currentOptions.textureLeafSizing,
            textureImageRendering: currentOptions.textureImageRendering,
            textureBackend: currentOptions.textureBackend,
            textureProjection: currentOptions.textureProjection,
            seamBleed: currentOptions.seamBleed,
            solidPaintDefaults: {},
            optimizeStableTriangleStyle: true,
            stableTriangleDebug: options?.stableTriangleDebug,
            stableTriangleUpdateMode: options?.stableTriangleUpdateMode,
            stableTriangleColorPolicy: options?.stableTriangleColorPolicy,
            stableTriangleColorSteps: options?.stableTriangleColorSteps,
            // Triangle-frame animation updates transforms directly; pin baked
            // color unless an internal caller opts into color refresh.
            stableTriangleColorFreezeFrames: options?.stableTriangleColorFreezeFrames ?? 0,
            stableTriangleColorBudget: options?.stableTriangleColorBudget,
            stableTriangleColorMaxAge: options?.stableTriangleColorMaxAge,
            stableTriangleColorMaxStep: options?.stableTriangleColorMaxStep,
            stableTriangleMatrixDecimals: options?.stableTriangleMatrixDecimals,
            stableTriangleColorFrame: colorFrame,
          } as Parameters<typeof updateStableTriangleFrame>[3] & {
            optimizeStableTriangleStyle: boolean;
            stableTriangleDebug?: "transform-only" | "plan-only";
            stableTriangleUpdateMode?: "full" | "transform-only" | "color-only";
            stableTriangleColorPolicy?: "cadence" | "adaptive";
            stableTriangleColorSteps?: number;
            stableTriangleColorFreezeFrames?: number;
            stableTriangleColorBudget?: number;
            stableTriangleColorMaxAge?: number;
            stableTriangleColorMaxStep?: number;
            stableTriangleMatrixDecimals?: number;
            stableTriangleColorFrame?: number;
          };
          if (
            updateStableTriangleFrame(
              entry.rendered,
              entry.polygons,
              frame,
              stableTopologyOptions,
            )
          ) {
            polygonUpdateVersion++;
            mergeOnUpdate = nextMergeOnUpdate;
            stableDomOnUpdate = nextStableDomOnUpdate;
            entry.stableDom = stableDomOnUpdate;
            entry.voxelSource = undefined;
            entry.stableTriangleColorFrame = colorFrame;
            currentTriangleFrame = frame;
            currentTriangleFrameVersion++;
            materializedTriangleFramePolygons = null;
            materializedTriangleFrameVersion = -1;
            if (canDomCullCamera(entry)) {
              recomputeCameraCullGroups(entry);
              syncMountedRenderedForCameraChange(ctx, entry, true);
            } else {
              syncCameraCullSignature(ctx, entry);
            }
            return true;
          }
        }

        polygonUpdateVersion++;
        mergeOnUpdate = nextMergeOnUpdate;
        stableDomOnUpdate = nextStableDomOnUpdate;
        entry.stableDom = stableDomOnUpdate;
        entry.voxelSource = undefined;

        const values = frame.vertices;
        for (let polygonIndex = 0; polygonIndex < frame.polygonCount; polygonIndex++) {
          const polygon = entry.polygons[polygonIndex]!;
          const color = frame.colors?.[polygonIndex];
          if (color) polygon.color = color;
          const vertices = polygon.vertices;
          const offset = polygonIndex * 9;
          vertices[0]![0] = values[offset]!;
          vertices[0]![1] = values[offset + 1]!;
          vertices[0]![2] = values[offset + 2]!;
          vertices[1]![0] = values[offset + 3]!;
          vertices[1]![1] = values[offset + 4]!;
          vertices[1]![2] = values[offset + 5]!;
          vertices[2]![0] = values[offset + 6]!;
          vertices[2]![1] = values[offset + 7]!;
          vertices[2]![2] = values[offset + 8]!;
        }
        clearCurrentTriangleFrame();
        handle.polygons = entry.polygons;
        return applyStableTopologyUpdate(
          options,
          shouldRecomputeAutoCenter,
        );
      },
      updatePolygon(target: Polygon | number, partial: Partial<Polygon>) {
        let idx = typeof target === "number"
          ? target
          : entry.polygons.indexOf(target);
        if (idx < 0 && typeof target !== "number" && currentTriangleFrame) {
          idx = currentPolygons().indexOf(target);
        }
        if (idx < 0 || idx >= entry.polygons.length) return;
        clearCurrentTriangleFrame();
        entry.voxelSource = undefined;
        // Shadow caches derive from polygon geometry, but their bust keys
        // (polygon count + transform + bbox center, or polygon-array
        // identity) all survive an in-place vertex edit. Mirror setPolygons:
        // clear the caster/receiver caches explicitly and give the array a
        // fresh identity so the identity-keyed caches (overlap dedup,
        // shared-edge map, light occlusion) bust too. Color/data-only edits
        // skip this — those caches are pure geometry.
        if ("vertices" in partial && (entry.castShadow || entry.receiveShadow)) {
          entry.polygons = entry.polygons.slice();
          clearCasterItemsCache(entry);
          clearReceiverShadowCache(entry);
        }
        Object.assign(entry.polygons[idx], partial);
        const partialKeys = Object.keys(partial);
        if (tryUpdatePolygonLeafOnly(ctx, entry, idx, partialKeys)) {
          return;
        }
        renderEntry(entry);
      },
      async setPolygonsChunked(polygons: Polygon[], options?: {
        merge?: boolean;
        stableDom?: boolean;
        recomputeAutoCenter?: boolean;
      }) {
        const version = ++polygonUpdateVersion;
        mergeOnUpdate = options?.merge ?? mergeOnUpdate;
        stableDomOnUpdate = options?.stableDom ?? stableDomOnUpdate;
        entry.stableDom = stableDomOnUpdate;
        entry.voxelSource = undefined;
        entry.polygons = preparePolygons(polygons, mergeOnUpdate);
        clearCurrentTriangleFrame();
        handle.polygons = entry.polygons;
        applyTransformOrigin(entry.polygons);
        const shouldRecomputeAutoCenter = options?.recomputeAutoCenter ?? true;
        const shouldCancel = () => entry.disposed || version !== polygonUpdateVersion;
        const completed = await renderEntryChunked(entry, shouldCancel);
        if (!completed) {
          clearRendered(ctx, entry);
          return;
        }
        if (shouldRecomputeAutoCenter) recomputeAutoCenter();
      },
      setTransform(t: Partial<PolyMeshTransform>) {
        const prevCastShadow = entry.castShadow;
        const prevReceiveShadow = entry.receiveShadow;
        const prevShadowDef = entry.shadowDefinition;
        if (t.castShadow !== undefined) entry.castShadow = !!t.castShadow;
        if (t.receiveShadow !== undefined) entry.receiveShadow = !!t.receiveShadow;
        if (t.shadowDefinition !== undefined) entry.shadowDefinition = t.shadowDefinition;
        transform = { ...transform, ...t };
        const css2 = buildMeshTransform(transform);
        wrapper.style.transform = css2 ?? "";
        applyMeshLightVarOverride(ctx, entry, transform.rotation);
        if (t.rotation !== undefined) syncMountedRenderedForCameraChange(ctx, entry, true);
        if (entry.castShadow !== prevCastShadow) {
          // Voxel-eligible meshes use the direct-matrix fast path only when
          // castShadow is false (canRenderVoxelDirect). Toggling castShadow
          // flips that eligibility — if it changes, the mesh has to switch
          // renderer (direct-voxel ↔ polygon), so re-render the whole entry.
          // Otherwise emitShadowLeaves runs on the wrong leaf set (the
          // voxel-direct path has no polygon leaves to project from), and
          // shadows silently fail to emit.
          if (entry.voxelSource) renderEntry(entry);
          emitShadowLeaves(ctx, entry);
          recomputeShadowGround(ctx);
        }
        // Receiver toggled: rebuild the scene-level shadow set so this
        // mesh's faces are added (or removed) as receivers. When flipping
        // OFF, the per-frame emitter for THIS mesh would never run again
        // (emitSceneShadows skips meshes with !receiveShadow), so its
        // previously-mounted receiver SVGs would linger in the DOM. Tear
        // them down explicitly before the rebuild.
        if (entry.receiveShadow !== prevReceiveShadow) {
          if (!entry.receiveShadow) disposeReceiverShadowMounts(entry);
          invalidateShadowLightCache(ctx);
          emitSceneShadows(ctx);
        }
        // Position / rotation / scale change: shadow geometry depends on
        // world-space coords AND the mesh's wrapper scale (which pivots from
        // the bbox center). Rotation belongs here too — it moves every caster
        // vertex and every receiver face plane, and the camera-visibility
        // short-circuit in emitSceneShadows reads the CACHED planes, so
        // skipping the re-emit leaves that gate comparing rotated camera state
        // against identity-pose normals (stale SVGs across a later orbit).
        // Non-shadow helpers (e.g. the light helper) must not overwrite
        // transient preview shadows with the committed light, so the gate is
        // on castShadow || receiveShadow.
        if ((t.position !== undefined || t.rotation !== undefined || t.scale !== undefined)
          && (entry.castShadow || entry.receiveShadow)) {
          recomputeShadowGround(ctx);
          invalidateShadowLightCache(ctx);
          emitSceneShadows(ctx);
        }
        // Per-mesh shadow definition changed: re-emit at the new detail.
        if (entry.shadowDefinition !== prevShadowDef && (entry.castShadow || entry.receiveShadow)) {
          invalidateShadowLightCache(ctx);
          emitSceneShadows(ctx);
        }
      },
      dispose() {
        if (entry.disposed) return;
        entry.disposed = true;
        polygonUpdateVersion++;
        if (wrapper.parentNode) wrapper.parentNode.removeChild(wrapper);
        clearRendered(ctx, entry);
        try { parseResult.dispose(); } catch { /* ignore */ }
        meshes.delete(entry);
        meshByElement.delete(wrapper);
        recomputeAutoCenter();
        recomputeShadowGround(ctx);
      },
      rebakeAtlas() {
        // Advance the baked rotation to match the current live rotation.
        // The atlas baker will use this to inverse-rotate the world light
        // into the mesh's local frame so Lambert shading stays correct.
        entry.bakedRotation = (transform.rotation ? [...transform.rotation] : [0, 0, 0]) as Vec3;
        // Compute the local-frame light direction by inverse-rotating the
        // world-space directional light through the baked rotation.
        // dot(localNormal, localLight) === dot(worldNormal, worldLight),
        // so the rasterized atlas produces correct shading after rotation.
        const worldDir = currentOptions.directionalLight?.direction ?? [0.4, -0.7, 0.59] as Vec3;
        const localLightDir = inverseRotateVec3(worldDir as Vec3, entry.bakedRotation);
        // Serialised in-place swap: only one rebake runs at a time and
        // intermediate slider ticks just update the queued target. Avoids
        // both blank-flash AND the out-of-order bitmap swaps that look
        // like flicker when many rebakes finish at slightly different
        // moments.
        requestRebakeAtlas(ctx, entry, renderEntry, localLightDir);
      },
      whenTexturesReady() { return entry.textureReadyPromise; },
      getPosition() { return transform.position; },
      getRotation() { return transform.rotation; },
      getScale() { return transform.scale; },
      getPolygons() { return handle.polygons; },
    };

    entry.handle = handle;
    entryRef = entry;
    meshByElement.set(wrapper, entry);
    meshes.add(entry);
    renderEntry(entry);
    applyMeshLightVarOverride(ctx, entry, transform.rotation);
    recomputeAutoCenter();
    recomputeShadowGround(ctx);
    // New receiver: the scene-level shadow set must rebuild so existing
    // casters get faces to project onto. recomputeShadowGround only
    // does this when the global ground changes; force a rebuild for the
    // receiver-only case.
    if (entry.receiveShadow) {
      invalidateShadowLightCache(ctx);
      emitSceneShadows(ctx);
    }
    return handle;
  }

  function setOptions(partial: Partial<Omit<PolySceneOptions, "camera">>): void {
    const prevAutoCenter = !!currentOptions.autoCenter;
    const prevStrategies = currentOptions.strategies;
    const prevSeamBleed = currentOptions.seamBleed;
    const prevTextureLeafSizing = currentOptions.textureLeafSizing;
    const prevTextureImageRendering = currentOptions.textureImageRendering;
    const prevTextureBackend = currentOptions.textureBackend;
    const prevTextureProjection = currentOptions.textureProjection;
    const prevTextureLighting = currentOptions.textureLighting;
    const prevLightDir = currentOptions.directionalLight?.direction;
    const prevDirIntensity = currentOptions.directionalLight?.intensity;
    const prevDirColor = currentOptions.directionalLight?.color;
    const prevShadow = currentOptions.shadow;
    const prevPointLights = currentOptions.pointLights;
    const normalizedPartial = normalizeSceneOptions(partial);
    currentOptions = { ...currentOptions, ...normalizedPartial };
    // Keep the SceneContext's options ref pointing to the latest snapshot so
    // extracted scene/* helpers see the new value on their next read.
    ctx.options.current = currentOptions;
    applySceneStyle(sceneEl, currentOptions);
    const nextAutoCenter = !!currentOptions.autoCenter;
    // Re-evaluate per-mesh light overrides when lighting settings change —
    // textureLighting or directionalLight may have changed.
    for (const entry of meshes) {
      applyMeshLightVarOverride(ctx, entry, entry.handle.transform.rotation);
    }
    // `strategies` controls which leaf tags the renderer emits. A change
    // means we have to re-render every mesh against the new constraint.
    // Skip the re-render when the value didn't actually change so callers
    // that pass the same strategies on every tick (bundled with camera
    // updates) don't blow up the atlas every frame.
    const strategiesChanged = partial.strategies !== undefined &&
      !strategiesEqual(partial.strategies, prevStrategies);
    const seamBleedChanged = Object.prototype.hasOwnProperty.call(partial, "seamBleed") &&
      normalizedPartial.seamBleed !== prevSeamBleed;
    const textureLeafSizingChanged =
      Object.prototype.hasOwnProperty.call(partial, "textureLeafSizing") &&
      normalizedPartial.textureLeafSizing !== prevTextureLeafSizing;
    const textureImageRenderingChanged =
      Object.prototype.hasOwnProperty.call(partial, "textureImageRendering") &&
      normalizedPartial.textureImageRendering !== prevTextureImageRendering;
    const textureBackendChanged =
      Object.prototype.hasOwnProperty.call(partial, "textureBackend") &&
      normalizedPartial.textureBackend !== prevTextureBackend;
    const textureProjectionChanged =
      Object.prototype.hasOwnProperty.call(partial, "textureProjection") &&
      normalizedPartial.textureProjection !== prevTextureProjection;
    // Point lights are baked per-face into the atlas/solid colors, so any
    // change (added/removed/moved/recolored) requires a re-bake of every
    // mesh. Compare a compact signature so passing the same array each tick
    // (e.g. bundled with camera updates) doesn't re-bake needlessly.
    const pointLightSig = (pls: PolyPointLight[] | undefined): string =>
      (pls ?? []).map((p) => `${p.position.join(",")}|${p.color ?? ""}|${p.intensity ?? 1}|${p.castShadow ? 1 : 0}`).join(";");
    const pointLightsChanged =
      Object.prototype.hasOwnProperty.call(partial, "pointLights") &&
      pointLightSig(currentOptions.pointLights) !== pointLightSig(prevPointLights);
    if (
      strategiesChanged ||
      seamBleedChanged ||
      textureLeafSizingChanged ||
      textureImageRenderingChanged ||
      textureBackendChanged ||
      textureProjectionChanged ||
      pointLightsChanged
    ) {
      for (const entry of meshes) renderEntry(entry);
    }
    if (prevAutoCenter !== nextAutoCenter) recomputeAutoCenter();
    // Shadows now use the same per-mesh SVG path in both lighting modes,
    // so any of these changes require explicit re-emission:
    //  - lighting mode toggled (the regular leaves change)
    //  - light direction changed (projection is CPU-baked into each path)
    //  - shadow color/opacity/lift changed (color/opacity are inline on the
    //    <path>; lift shifts the ground plane and rebuilds geometry)
    const textureLightingChanged = partial.textureLighting !== undefined &&
      prevTextureLighting !== currentOptions.textureLighting;
    const nextDirLight = currentOptions.directionalLight;
    // ANY directional change re-emits shadows — not just direction, but also
    // intensity and color: the shadow only emits for intensity > 0 (and its
    // shaded fill depends on intensity/color), so toggling a light off or
    // sliding its intensity must re-project. The emit short-circuit key is
    // keyed on direction only, so intensity/color changes also bust the cache
    // below (otherwise emitSceneShadows would no-op).
    const directionalChanged = partial.directionalLight !== undefined && (
      !vec3Equal(prevLightDir, nextDirLight?.direction) ||
      (prevDirIntensity ?? 1) !== (nextDirLight?.intensity ?? 1) ||
      (prevDirColor ?? "#ffffff") !== (nextDirLight?.color ?? "#ffffff")
    );
    const nextShadow = currentOptions.shadow;
    const shadowAppearanceChanged = partial.shadow !== undefined
      && !shadowOptsEqual(prevShadow, nextShadow);
    // Point-light changes also re-emit: the emit short-circuit key folds in
    // each shadow point light's CSS position, so a moved/toggled point light
    // produces a different key and re-projects its radial shadow.
    const shadowReemitNeeded = directionalChanged || shadowAppearanceChanged || pointLightsChanged;
    if (textureLightingChanged) {
      // Every mesh needs a full re-render to swap baked/dynamic leaf
      // emission. Baked leaves carry inline `color: rgb(...)`; dynamic
      // leaves carry inline `--pnx/y/z` and rely on a wrapper-level
      // `--psr/g/b` (set via applySolidPaintVars) for the CSS calc().
      // Without re-rendering, switching baked→dynamic leaves stale inline
      // `color` on most leaves (looks fine) but any leaf that gets even
      // a partial restyle (e.g. plan recomputation downstream) loses its
      // inline color and falls through to the CSS calc reading the
      // @property defaults — rendering WHITE polygons on the model.
      // Skip when texture-affecting option changes already triggered a
      // re-render above.
      if (
        !strategiesChanged &&
        !seamBleedChanged &&
        !textureLeafSizingChanged &&
        !textureImageRenderingChanged &&
        !textureBackendChanged &&
        !textureProjectionChanged
      ) {
        for (const entry of meshes) renderEntry(entry);
      }
      recomputeShadowGround(ctx);
      invalidateShadowLightCache(ctx);
      emitSceneShadows(ctx);
    } else if (shadowReemitNeeded) {
      // The emit short-circuit key only discriminates by light DIRECTION, so a
      // direction change self-busts, but shadow-appearance and directional
      // intensity/color changes must bust the cache explicitly or
      // emitSceneShadows would no-op.
      if (shadowAppearanceChanged || directionalChanged) invalidateShadowLightCache(ctx);
      // A light-DIRECTION or point-light move is "motion" → eligible for the
      // progressive drag-definition pass. Shadow-appearance edits (opacity,
      // definition, dragDefinition) render at full definition immediately.
      emitSceneShadows(ctx, undefined, { progressive: (directionalChanged || pointLightsChanged) && !shadowAppearanceChanged });
    }
    if (shadowAppearanceChanged && partial.shadow?.lift !== prevShadow?.lift) {
      recomputeShadowGround(ctx);
    }
  }

  function getOptions(): Readonly<Omit<PolySceneOptions, "camera">> {
    return currentOptions;
  }

  function applyCamera(): void {
    applyCameraStyle(cameraEl, currentOptions);
    applySceneCameraTransform(sceneEl);
    for (const entry of meshes) syncMountedRenderedForCameraChange(ctx, entry);
    // Receiver shadows are camera-dependent (face culling + crease bleed), so
    // they must not ride an orbit frozen. Signature-gated: this costs one
    // per-plane facing sweep unless the camera crossed a visibility boundary.
    syncShadowsForCameraChange(ctx);
  }

  function listMeshes(): readonly PolyMeshHandle[] {
    const out: PolyMeshHandle[] = [];
    for (const entry of meshes) out.push(entry.handle);
    return out;
  }

  function whenTexturesReady(): Promise<void> {
    return Promise.all(Array.from(meshes, (entry) => entry.handle.whenTexturesReady())).then(() => undefined);
  }

  function findMeshByElement(el: Element | null): PolyMeshHandle | null {
    let cur: Element | null = el;
    while (cur) {
      if (cur instanceof HTMLElement) {
        const entry = meshByElement.get(cur);
        if (entry && !entry.disposed) return entry.handle;
        if (cur.classList.contains("polycss-mesh")) {
          return null;
        }
      }
      cur = cur.parentElement;
    }
    return null;
  }

  function destroy(): void {
    if (ctx.shadowRefineTimer) { clearTimeout(ctx.shadowRefineTimer); ctx.shadowRefineTimer = null; }
    if (ctx.animationShadowTrailingTimer) {
      clearTimeout(ctx.animationShadowTrailingTimer);
      ctx.animationShadowTrailingTimer = null;
    }
    // Dispose all meshes (revokes blob URLs) before removing the scene.
    // Snapshot first since dispose() mutates the set.
    const snapshot = Array.from(meshes);
    for (const m of snapshot) {
      try { m.handle.dispose(); } catch { /* ignore */ }
    }
    // Remove the camera wrapper (cameraEl is the host-level child; sceneEl is
    // inside it, so removing the wrapper also removes the scene element).
    if (cameraEl.parentNode) cameraEl.parentNode.removeChild(cameraEl);
  }

  const handle = {
    add,
    setOptions,
    destroy,
    host,
    camera,
    cameraEl,
    sceneElement: sceneEl,
    applyCamera,
    getOptions,
    meshes: listMeshes,
    whenTexturesReady,
    findMeshByElement,
    previewBakedSolidLighting: (next: Parameters<typeof previewBakedSolidLighting>[1]) =>
      previewBakedSolidLighting(ctx, next),
    commitBakedSolidLighting: () => commitBakedSolidLighting(ctx, renderEntry),
    clearBakedSolidLightingPreview: () => clearBakedSolidLightingPreview(ctx),
  };
  return handle;
}
