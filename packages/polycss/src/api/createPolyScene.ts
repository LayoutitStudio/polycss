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
  CameraCullNormalGroup,
  CameraCullRotation,
} from "@layoutit/polycss-core";
import type {
  PolyPerspectiveCameraHandle,
  PolyOrthographicCameraHandle,
} from "./createPolyCamera";
import {
  CAMERA_BACKFACE_CULL_EPS,
  DEFAULT_SEAM_BLEED,
  VOXEL_CAMERA_CULL_NORMAL_LIMIT,
  cameraCullNormalKey,
  cameraCullVisibleSignature,
  computeSceneBbox,
  computeLightVisibility,
  cullInteriorPolygons,
  capturePolyCameraSnapshot,
  findOverlappingPolygonDuplicates,
  inverseRotateVec3,
  isAxisAlignedSurfaceNormal,
  isVoxelCameraCullableNormalGroups,
  normalFacesCamera,
  optimizeMeshPolygons,
  parseHexColor,
  polygonCssSurfaceNormal,
} from "@layoutit/polycss-core";
import {
  cssBorderShapeForPlan,
  getSolidPaintDefaults,
  renderPolygonsWithTextureAtlas,
  renderPolygonsWithTextureAtlasAsync,
  renderPolygonsWithStableTriangles,
  updateStableTriangleFrame,
  updatePolygonsWithStableTopology,
  type RenderedPoly,
  type SolidPaintDefaults,
} from "../render/textureAtlas";
import {
  applyPolygonDataAttrs,
} from "../render/atlas/emit";
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
  quantizeNormalKey,
  worldDirectionToCss,
  worldDirectionalLightToCss,
  worldPositionToCss,
} from "./scene/transforms";
import {
  shadowOptsEqual,
  strategiesEqual,
  vec3Equal,
} from "./scene/equality";
import {
  BAKED_SOLID_PREVIEW_ACTIVE_VAR,
  applyBakedSolidColor,
  applyBakedSolidPreviewPaint,
  applyDynamicColorVars,
  applyDynamicLightVars,
  applyLightingVars,
  applySolidPaintVars,
  clearLightingVars,
  setStylePropertyIfChanged,
} from "./scene/lightingVars";
import {
  hideGroundShadow as hideGroundShadowImpl,
} from "./scene/shadowSvg";
import type {
  MeshEntry,
} from "./scene/internalTypes";
import { createSceneContext } from "./scene/sceneContext";
import type { SceneContext } from "./scene/sceneContext";
import { emitGroundShadow as emitGroundShadowImpl } from "./scene/groundShadow";
import {
  disposeReceiverShadowMounts,
  emitReceiverShadows as emitReceiverShadowsImpl,
} from "./scene/receiverShadow";
import {
  clearAllSceneShadows as clearAllSceneShadowsImpl,
  clearCasterItemsCache as clearCasterItemsCacheImpl,
  clearReceiverShadowCache as clearReceiverShadowCacheImpl,
} from "./scene/shadowCache";
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
} from "./scene/types";

// Used only by the internal async mesh update path. Batching DOM insertion
// keeps large gallery meshes below Chrome's long-task warning threshold
// without changing the synchronous public setPolygons() contract.
const ASYNC_MOUNT_BATCH_SIZE = 750;
const DEFAULT_SCENE_PERSPECTIVE = 32000;
const TEXTURES_READY = Promise.resolve();
function normalizeSceneOptions<T extends Partial<Omit<PolySceneOptions, "camera">>>(options: T): T {
  if (!Object.prototype.hasOwnProperty.call(options, "seamBleed") || options.seamBleed !== undefined) {
    return options;
  }
  return { ...options, seamBleed: DEFAULT_SEAM_BLEED };
}

// Sentinel that keeps broad camera DOM culling disabled once a mesh proves
// it has non-voxel normals; callers never inspect group contents directly.
const NON_CULLABLE_CAMERA_GROUP: CameraCullNormalGroup = {
  key: "non-cullable",
  normal: [1, 1, 0],
};

function nonCullableCameraGroups(): CameraCullNormalGroup[] {
  return [NON_CULLABLE_CAMERA_GROUP];
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

  // Shadow SVG state (ground SVG element + visibility + cached ground CSS-Z).
  // Sourced from the SceneContext so extracted helpers can read+write the
  // same bag. See ./scene/shadowSvg for the helpers that operate on it.
  const shadowSvgState = ctx.shadowSvgState;
  const hideGroundShadow = () => hideGroundShadowImpl(shadowSvgState);

  const clearAllSceneShadows = () => clearAllSceneShadowsImpl(ctx);

  // H3: quantize the directional light at ~0.57° (rounding each normalized
  // component to 0.01) and skip emitSceneShadows when the rounded vector
  // matches the cached frame. Slow-drag jitter at this resolution is below
  // human perception, and at ~0.5°/frame in the bench most consecutive
  // ticks collapse into the same bucket. Any caster/receiver geometry or
  // shadow-appearance change MUST call invalidateShadowLightCache(); the
  // cache key is light-only.
  let lastEmittedShadowLightKey: string | null = null;
  function quantizeLightDirKey(d: Vec3 | undefined): string | null {
    if (!d) return null;
    const len = Math.hypot(d[0], d[1], d[2]);
    if (!Number.isFinite(len) || len <= 0) return null;
    const nx = Math.round((d[0] / len) * 100) / 100;
    const ny = Math.round((d[1] / len) * 100) / 100;
    const nz = Math.round((d[2] / len) * 100) / 100;
    return `${nx}|${ny}|${nz}`;
  }
  function invalidateShadowLightCache(): void {
    lastEmittedShadowLightKey = null;
  }

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

  function applySceneStyle(el: HTMLElement, opts: Omit<PolySceneOptions, "camera">): void {
    applyCssZoomCompensation(el, layoutScale);
    el.style.transform = buildSceneTransformFromCamera(camera, autoCenterOffset, layoutScale);
    applyDynamicLightVars(el, opts);
  }

  function applySceneCameraTransform(el: HTMLElement): void {
    el.style.transform = buildSceneTransformFromCamera(camera, autoCenterOffset, layoutScale);
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
  function clearRendered(entry: MeshEntry): void {
    entry.textureReadyPromise = TEXTURES_READY;
    entry.voxelRenderer?.dispose();
    entry.voxelRenderer = undefined;
    disposeRendered(entry.rendered, entry.disposeAtlas);
    entry.disposeAtlas = undefined;
    entry.rendered.length = 0;
    entry.renderedByPolygonIndex = [];
    entry.cameraCullGroups = [];
    entry.cameraCullSignature = "";
    entry.solidLightingPreviewPrepared = false;
    entry.solidLightingPreviewActive = false;
    clearShadowLeaves(entry);
    for (const child of Array.from(entry.wrapper.children)) {
      if (child instanceof HTMLElement && child.classList.contains("polycss-bucket")) {
        child.remove();
      }
    }
    entry.hasBuckets = false;
  }

  function firstPreservedChild(entry: MeshEntry): ChildNode | null {
    for (const child of Array.from(entry.wrapper.childNodes)) {
      if (!(child instanceof HTMLElement)) return child;
      if (child.classList.contains("polycss-bucket")) continue;
      if (child.classList.contains("polycss-shadow")) continue;
      const tag = child.tagName.toLowerCase();
      if (tag === "b" || tag === "i" || tag === "s" || tag === "u" || tag === "q") continue;
      return child;
    }
    return null;
  }

  function mountRenderedFragment(entry: MeshEntry, fragment: DocumentFragment, before: ChildNode | null): void {
    if (before?.parentNode === entry.wrapper) {
      entry.wrapper.insertBefore(fragment, before);
    } else {
      entry.wrapper.appendChild(fragment);
    }
  }

  function clearShadowLeaves(entry: MeshEntry): void {
    // Current shadows are scene-level SVGs, but retained internal `<q>` leaves
    // can still be present during cleanup of already-mounted entries.
    for (const el of entry.shadowRendered) {
      if (el.parentNode) el.parentNode.removeChild(el);
    }
    entry.shadowRendered.length = 0;
    // SVG shadow surfaces are scene-scoped (one per ground / receiver
    // face, aggregating every caster). Any per-entry trigger that asks
    // to clear leaves drops the whole scene-level set; emitSceneShadows
    // will rebuild it next.
    clearAllSceneShadows();
  }

  function disposeRendered(rendered: RenderedPoly[], disposeAtlas?: () => void): void {
    disposeAtlas?.();
    for (const r of rendered) {
      try { r.dispose(); } catch { /* ignore */ }
      if (r.element.parentNode) r.element.parentNode.removeChild(r.element);
    }
  }

  function setRendered(
    entry: MeshEntry,
    rendered: RenderedPoly[],
    disposeAtlas?: () => void,
    textureReadyPromise?: Promise<void>,
  ): void {
    entry.rendered = rendered;
    entry.renderedByPolygonIndex = [];
    for (const item of rendered) {
      entry.renderedByPolygonIndex[item.polygonIndex] = item;
    }
    entry.disposeAtlas = disposeAtlas;
    entry.textureReadyPromise = textureReadyPromise
      ? textureReadyPromise.catch(() => undefined)
      : TEXTURES_READY;
    entry.solidLightingPreviewPrepared = false;
  }

  function renderedItemForPolygon(entry: MeshEntry, polygonIndex: number): RenderedPoly | undefined {
    const item = entry.renderedByPolygonIndex[polygonIndex];
    return item?.polygonIndex === polygonIndex ? item : undefined;
  }

  function clearMountedRendered(entry: MeshEntry): void {
    for (const child of Array.from(entry.wrapper.children)) {
      if (child instanceof HTMLElement && child.classList.contains("polycss-bucket")) {
        child.remove();
      }
    }
    entry.hasBuckets = false;
    for (const item of entry.rendered) {
      if (item.element.parentNode) item.element.parentNode.removeChild(item.element);
    }
  }

  function normalForRendered(entry: MeshEntry, item: RenderedPoly): Vec3 | null {
    const poly = entry.polygons[item.polygonIndex];
    if (entry.stableDom && poly) return polygonCssSurfaceNormal(poly);
    return item.plan?.normal ?? (poly ? polygonCssSurfaceNormal(poly) : null);
  }

  function renderedItemsForCamera(entry: MeshEntry): RenderedPoly[] {
    if (!canDomCullCamera(entry)) return entry.rendered;
    const rotation = cameraCullRotation(entry);
    return entry.rendered.filter((item) =>
      renderedItemFacesCamera(entry, item, CAMERA_BACKFACE_CULL_EPS, rotation)
    );
  }

  function cameraCullRotation(entry: MeshEntry): CameraCullRotation {
    return {
      rotX: camera.state.rotX,
      rotY: camera.state.rotY,
      meshRotation: entry.handle.transform.rotation,
    };
  }

  function renderedItemFacesCamera(
    entry: MeshEntry,
    item: RenderedPoly,
    depthThreshold = CAMERA_BACKFACE_CULL_EPS,
    rotation = cameraCullRotation(entry),
  ): boolean {
    const normal = normalForRendered(entry, item);
    return normal === null || normalFacesCamera(normal, rotation, depthThreshold);
  }

  function recomputeCameraCullGroups(entry: MeshEntry): void {
    if (entry.excludeFromAutoCenter) {
      entry.cameraCullGroups = [];
      return;
    }
    const groups = new Map<string, Vec3>();
    for (const item of entry.rendered) {
      const normal = normalForRendered(entry, item);
      if (!normal) continue;
      if (!isAxisAlignedSurfaceNormal(normal)) {
        entry.cameraCullGroups = nonCullableCameraGroups();
        return;
      }
      const key = cameraCullNormalKey(normal);
      if (!groups.has(key)) {
        groups.set(key, normal);
        if (groups.size > VOXEL_CAMERA_CULL_NORMAL_LIMIT) {
          entry.cameraCullGroups = nonCullableCameraGroups();
          return;
        }
      }
    }
    entry.cameraCullGroups = Array.from(groups, ([key, normal]) => ({ key, normal }));
  }

  function cameraCullSignature(entry: MeshEntry): string {
    return canDomCullCamera(entry)
      ? cameraCullVisibleSignature(entry.cameraCullGroups, cameraCullRotation(entry))
      : "all";
  }

  function canDomCullCamera(entry: MeshEntry): boolean {
    return !entry.excludeFromAutoCenter &&
      isVoxelCameraCullableNormalGroups(entry.cameraCullGroups);
  }

  function syncCameraCullSignature(entry: MeshEntry): void {
    entry.cameraCullSignature = canDomCullCamera(entry)
      ? cameraCullSignature(entry)
      : "all";
  }

  function patchMountedRenderedForCamera(entry: MeshEntry, depthThreshold: number): boolean {
    const visible = new Array<boolean>(entry.rendered.length);
    let changed = false;
    const rotation = cameraCullRotation(entry);

    for (let i = 0; i < entry.rendered.length; i += 1) {
      const item = entry.rendered[i];
      const shouldMount = renderedItemFacesCamera(entry, item, depthThreshold, rotation);
      visible[i] = shouldMount;
    }

    let removeStart: HTMLElement | null = null;
    let removeEnd: HTMLElement | null = null;
    const flushRemove = () => {
      if (!removeStart || !removeEnd) return;
      if (removeStart === removeEnd) {
        removeStart.remove();
      } else {
        const range = doc.createRange();
        range.setStartBefore(removeStart);
        range.setEndAfter(removeEnd);
        range.deleteContents();
        range.detach();
      }
      removeStart = null;
      removeEnd = null;
      changed = true;
    };

    for (let i = 0; i < entry.rendered.length; i += 1) {
      const item = entry.rendered[i];
      if (!visible[i] && item.element.parentNode === entry.wrapper) {
        if (removeEnd && removeEnd.nextSibling === item.element) {
          removeEnd = item.element;
        } else {
          flushRemove();
          removeStart = item.element;
          removeEnd = item.element;
        }
      } else {
        flushRemove();
      }
    }
    flushRemove();

    const insertionPointAfter = (index: number): ChildNode | null => {
      for (let i = index; i < entry.rendered.length; i += 1) {
        const next = entry.rendered[i].element;
        if (next.parentNode === entry.wrapper) return next;
      }
      return firstPreservedChild(entry);
    };

    let addStart = -1;
    const flushAdd = (endExclusive: number) => {
      if (addStart < 0) return;
      const fragment = doc.createDocumentFragment();
      for (let i = addStart; i < endExclusive; i += 1) {
        const item = entry.rendered[i];
        restoreInlineDynamicNormalVars(entry, item);
        fragment.appendChild(item.element);
      }
      mountRenderedFragment(entry, fragment, insertionPointAfter(endExclusive));
      addStart = -1;
      changed = true;
    };

    for (let i = 0; i < entry.rendered.length; i += 1) {
      const item = entry.rendered[i];
      if (visible[i] && item.element.parentNode !== entry.wrapper) {
        if (addStart < 0) addStart = i;
      } else {
        flushAdd(i);
      }
    }
    flushAdd(entry.rendered.length);

    return changed;
  }

  function syncMountedRenderedForCameraChange(entry: MeshEntry, force = false): void {
    if (entry.voxelRenderer) {
      if (force) entry.voxelRenderer.render(cameraCullRotation(entry));
      else entry.voxelRenderer.syncCamera(cameraCullRotation(entry));
      entry.cameraCullSignature = "voxel-direct";
      return;
    }

    if (!canDomCullCamera(entry)) {
      const wasCulled = entry.cameraCullSignature !== "all";
      entry.cameraCullSignature = "all";
      if (wasCulled) remountEntry(entry);
      return;
    }

    if (entry.hasBuckets) {
      remountEntryIfCullSignatureChanged(entry, force);
      return;
    }

    const nextSignature = cameraCullSignature(entry);
    if (!force && nextSignature === entry.cameraCullSignature) return;

    const changed = patchMountedRenderedForCamera(entry, CAMERA_BACKFACE_CULL_EPS);
    entry.cameraCullSignature = nextSignature;
    if (changed) emitShadowLeaves(entry);
  }

  function remountEntryIfCullSignatureChanged(entry: MeshEntry, force = false): void {
    const next = canDomCullCamera(entry)
      ? cameraCullSignature(entry)
      : "all";
    if (!force && next === entry.cameraCullSignature) return;
    remountEntry(entry);
  }

  function dynamicNormalForRendered(entry: MeshEntry, item: RenderedPoly): Vec3 | null {
    return normalForRendered(entry, item);
  }

  function restoreInlineDynamicNormalVars(entry: MeshEntry, item: RenderedPoly): void {
    if (currentOptions.textureLighting !== "dynamic") return;
    const normal = dynamicNormalForRendered(entry, item);
    if (!normal) return;
    item.element.style.setProperty("--pnx", normal[0].toFixed(4));
    item.element.style.setProperty("--pny", normal[1].toFixed(4));
    item.element.style.setProperty("--pnz", normal[2].toFixed(4));
  }

  function syncMountedRendered(entry: MeshEntry): void {
    clearMountedRendered(entry);
    entry.hasBuckets = false;
    const skipBucketNormalCleanup = entry.skipBucketNormalCleanupOnce;
    entry.skipBucketNormalCleanupOnce = false;
    const fragment = doc.createDocumentFragment();

    // Lambert-bucketing only pays off in dynamic mode, where the cascade
    // recomputes lambert per polygon every frame. Baked mode bakes lambert
    // into atlas pixels at parse time — no per-frame computation to save.
    const useBuckets =
      currentOptions.textureLighting === "dynamic" && !entry.stableDom;

    interface BucketGroup {
      vec: Vec3;
      items: RenderedPoly[];
    }
    const groups = new Map<string, BucketGroup>();
    const soloItems: RenderedPoly[] = [];

    // Pass 1 — gather per (quantized-normal × color) keys.
    for (const item of renderedItemsForCamera(entry)) {
      const poly = entry.polygons[item.polygonIndex];
      const q = useBuckets && poly ? quantizeNormalKey(poly) : null;
      if (!q) {
        soloItems.push(item);
        continue;
      }
      const key = q.key + "|" + (poly.color ?? "");
      let group = groups.get(key);
      if (!group) {
        group = { vec: q.vec, items: [] };
        groups.set(key, group);
      }
      group.items.push(item);
    }

    // Pass 2 — wrap groups of ≥ 2 (where one bucket-level lambert calc
    // beats the per-poly calcs it replaces). Singletons fall back to the
    // per-poly path so we don't add a wrapper that costs more than it saves.
    for (const item of soloItems) {
      restoreInlineDynamicNormalVars(entry, item);
      fragment.appendChild(item.element);
    }
    for (const group of groups.values()) {
      if (group.items.length < 2) {
        for (const item of group.items) {
          restoreInlineDynamicNormalVars(entry, item);
          fragment.appendChild(item.element);
        }
        continue;
      }
      const bucketEl = doc.createElement("div");
      bucketEl.className = "polycss-bucket";
      entry.hasBuckets = true;
      bucketEl.style.setProperty("--pnx", String(group.vec[0]));
      bucketEl.style.setProperty("--pny", String(group.vec[1]));
      bucketEl.style.setProperty("--pnz", String(group.vec[2]));
      for (const item of group.items) {
        bucketEl.appendChild(item.element);
        // Atlas sets per-poly --pnx/y/z inline (for the non-bucketed
        // dynamic-lighting path used by other consumers). Inside a bucket
        // those inline values are dead weight — the lambert is computed at
        // the wrapper and inherited. Strip them.
        if (!skipBucketNormalCleanup || item.kind === "triangle") {
          item.element.style.removeProperty("--pnx");
          item.element.style.removeProperty("--pny");
          item.element.style.removeProperty("--pnz");
        }
      }
      fragment.appendChild(bucketEl);
    }

    mountRenderedFragment(entry, fragment, firstPreservedChild(entry));
    syncCameraCullSignature(entry);
  }

  function yieldToMainThread(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, 0));
  }

  async function syncMountedRenderedChunked(
    entry: MeshEntry,
    shouldCancel: () => boolean,
  ): Promise<boolean> {
    const useBuckets =
      currentOptions.textureLighting === "dynamic" && !entry.stableDom;
    if (useBuckets) {
      syncMountedRendered(entry);
      return !shouldCancel();
    }

    clearMountedRendered(entry);
    let fragment = doc.createDocumentFragment();
    const before = firstPreservedChild(entry);
    let count = 0;
    for (const item of renderedItemsForCamera(entry)) {
      if (shouldCancel()) return false;
      restoreInlineDynamicNormalVars(entry, item);
      fragment.appendChild(item.element);
      count++;
      if (count % ASYNC_MOUNT_BATCH_SIZE === 0) {
        mountRenderedFragment(entry, fragment, before);
        fragment = doc.createDocumentFragment();
        await yieldToMainThread();
      }
    }
    if (fragment.childNodes.length > 0) mountRenderedFragment(entry, fragment, before);
    syncCameraCullSignature(entry);
    return !shouldCancel();
  }

  // Dynamic-mode per-mesh light override: when the mesh has a non-zero rotation
  // and the scene is in dynamic lighting mode, emit --plx/ly/lz on the
  // wrapper element, computed by inverse-rotating the world-space light into the
  // mesh's local frame. The cascade means these override the scene-level vars
  // only for polygons inside this wrapper. Cleared when conditions are not met.
  function applyMeshLightVarOverride(entry: MeshEntry, rotation: Vec3 | undefined): void {
    const isDynamic = currentOptions.textureLighting === "dynamic";
    const dir = currentOptions.directionalLight?.direction;
    const hasNonZeroRotation = rotation && (rotation[0] !== 0 || rotation[1] !== 0 || rotation[2] !== 0);

    if (!isDynamic || !hasNonZeroRotation || !dir) {
      if (entry.lightOverrideSignature === "clear") return;
      entry.wrapper.style.removeProperty("--plx");
      entry.wrapper.style.removeProperty("--ply");
      entry.wrapper.style.removeProperty("--plz");
      entry.lightOverrideSignature = "clear";
      return;
    }

    // dir is user-frame; rotation is also user-frame (Euler). Apply the
    // inverse rotation first, then swap to CSS frame so the result dots
    // correctly with the leaf's --pnx/--pny/--pnz (also CSS-frame).
    const localDirUser = inverseRotateVec3(dir as Vec3, rotation as Vec3);
    const localDir = worldDirectionToCss(localDirUser);
    const len = Math.hypot(localDir[0], localDir[1], localDir[2]) || 1;
    // H10: quantize to 0.01 (~0.57° angular resolution) matching the
    // scene-root writes in lightingVars.applyLightingVars, so per-mesh
    // overrides don't trigger style recalc on sub-quantum light changes.
    const plx = (localDir[0] / len).toFixed(2);
    const ply = (localDir[1] / len).toFixed(2);
    const plz = (localDir[2] / len).toFixed(2);
    const signature = `${plx}|${ply}|${plz}`;
    if (entry.lightOverrideSignature === signature) return;
    entry.wrapper.style.setProperty("--plx", plx);
    entry.wrapper.style.setProperty("--ply", ply);
    entry.wrapper.style.setProperty("--plz", plz);
    entry.lightOverrideSignature = signature;
  }

  function restoreBakedSolidPaint(entry: MeshEntry): boolean {
    let changed = false;
    for (const item of entry.rendered) {
      if (!item.plan || item.kind === "atlas" || item.plan.texture) continue;
      const polygon = entry.polygons[item.polygonIndex];
      if (!polygon) continue;
      changed = applyBakedSolidColor(item, polygon, currentOptions) || changed;
    }
    entry.solidLightingPreviewPrepared = false;
    entry.solidLightingPreviewActive = false;
    return changed;
  }

  function prepareBakedSolidLightingPreview(entry: MeshEntry): boolean {
    if ((currentOptions.textureLighting ?? "baked") !== "baked") return false;
    let prepared = false;
    for (const item of entry.rendered) {
      if (!item.plan || item.kind === "atlas" || item.plan.texture) continue;
      const polygon = entry.polygons[item.polygonIndex];
      if (!polygon) continue;
      applyBakedSolidPreviewPaint(item, polygon, item.plan.shadedColor);
      prepared = true;
    }
    entry.solidLightingPreviewPrepared = prepared;
    return prepared;
  }

  function installBakedSolidLightingPreview(entry: MeshEntry): boolean {
    if ((currentOptions.textureLighting ?? "baked") !== "baked") return false;
    if (!entry.solidLightingPreviewPrepared && !prepareBakedSolidLightingPreview(entry)) return false;
    entry.solidLightingPreviewActive = true;
    return true;
  }

  function needsBakedAtlasCommit(item: RenderedPoly): boolean {
    return item.kind === "atlas" || !!item.plan?.texture;
  }

  function commitBakedSolidLighting(): boolean {
    if ((currentOptions.textureLighting ?? "baked") !== "baked") return false;
    let updated = false;
    for (const entry of meshes) {
      // Solid leaves (the bulk of the castle / cottage / etc.) always need
      // their inline `color` re-baked at the new light direction — the
      // preview-cascade was making them brighter than the pre-commit
      // baseline, so without this they snap back to the OLD baked color on
      // release and read as "the face just darkened/disappeared." This is
      // CHEAP — `restoreBakedSolidPaint` walks the entry's solid leaves and
      // updates inline color/--polycss-paint in place.
      const solidChanged = restoreBakedSolidPaint(entry);
      updated = solidChanged || updated;
      if (entry.rendered.some(needsBakedAtlasCommit)) {
        // In-place atlas swap (same path `mesh.rebakeAtlas()` uses) instead
        // of the destructive `renderEntry()`. The destructive path calls
        // `clearRendered(entry)` which removes EVERY leaf from the DOM and
        // then asynchronously rebuilds the atlas — during that window the
        // mesh's faces disappear visually. `rebakeRenderEntryInPlace` keeps
        // the existing leaves mounted and only swaps the atlas bitmap URL
        // on textured leaves.
        rebakeRenderEntryInPlace(entry);
        updated = true;
      }
    }
    sceneEl.style.removeProperty(BAKED_SOLID_PREVIEW_ACTIVE_VAR);
    for (const entry of meshes) {
      clearLightingVars(entry.wrapper);
      entry.solidLightingPreviewActive = false;
    }
    clearLightingVars(sceneEl);
    return updated;
  }

  function clearBakedSolidLightingPreview(): void {
    sceneEl.style.removeProperty(BAKED_SOLID_PREVIEW_ACTIVE_VAR);
    for (const entry of meshes) {
      if (!entry.solidLightingPreviewActive) continue;
      restoreBakedSolidPaint(entry);
      clearLightingVars(entry.wrapper);
    }
    if ((currentOptions.textureLighting ?? "baked") !== "dynamic") {
      clearLightingVars(sceneEl);
      // Preview shadow may have used a different light direction than the
      // committed currentOptions; bust the cache so the restored shadow
      // re-emits even if the quantized key happens to match.
      invalidateShadowLightCache();
      emitSceneShadows();
    }
  }

  function applyPreviewMeshLightVars(
    entry: MeshEntry,
    next: Pick<Omit<PolySceneOptions, "camera">, "directionalLight" | "ambientLight">,
  ): void {
    const rotation = entry.handle.transform.rotation;
    const dir = next.directionalLight?.direction ?? currentOptions.directionalLight?.direction;
    const hasNonZeroRotation = rotation && (rotation[0] !== 0 || rotation[1] !== 0 || rotation[2] !== 0);
    if (!hasNonZeroRotation || !dir) {
      clearLightingVars(entry.wrapper);
      return;
    }
    const localDir = inverseRotateVec3(dir as Vec3, rotation as Vec3);
    applyLightingVars(entry.wrapper, {
      ...currentOptions,
      ...next,
      directionalLight: {
        ...currentOptions.directionalLight,
        ...next.directionalLight,
        direction: localDir,
      },
    });
  }

  function previewBakedSolidLighting(
    next: Pick<Omit<PolySceneOptions, "camera">, "directionalLight" | "ambientLight"> & {
      skipShadows?: boolean;
    },
  ): boolean {
    if ((currentOptions.textureLighting ?? "baked") !== "baked") return false;
    applyLightingVars(sceneEl, { ...currentOptions, ...next });
    if (!next.skipShadows && next.directionalLight?.direction) {
      emitSceneShadows(next.directionalLight.direction as Vec3);
    }
    let installed = false;
    for (const entry of meshes) {
      applyPreviewMeshLightVars(entry, next);
      installed = installBakedSolidLightingPreview(entry) || installed;
    }
    if (installed) setStylePropertyIfChanged(sceneEl, BAKED_SOLID_PREVIEW_ACTIVE_VAR, "1");
    else sceneEl.style.removeProperty(BAKED_SOLID_PREVIEW_ACTIVE_VAR);
    return installed;
  }

  function tryUpdatePolygonColorOnly(entry: MeshEntry, polygonIndex: number, color: string | undefined): boolean {
    const polygon = entry.polygons[polygonIndex];
    if (!polygon) return false;
    const item = renderedItemForPolygon(entry, polygonIndex);
    if (!item) return false;
    const textureLighting = currentOptions.textureLighting ?? "baked";
    if (textureLighting === "dynamic") {
      applyDynamicColorVars(item.element, color);
      return true;
    }
    if (textureLighting === "baked") {
      return applyBakedSolidColor(item, polygon, currentOptions);
    }
    return false;
  }

  function tryUpdatePolygonDataOnly(entry: MeshEntry, polygonIndex: number): boolean {
    const polygon = entry.polygons[polygonIndex];
    if (!polygon) return false;
    const item = renderedItemForPolygon(entry, polygonIndex);
    if (!item) return false;
    applyPolygonDataAttrs(item.element, polygon, polygonIndex);
    return true;
  }

  function tryUpdatePolygonLeafOnly(entry: MeshEntry, polygonIndex: number, partialKeys: string[]): boolean {
    if (partialKeys.length === 0 || !partialKeys.every((key) => key === "color" || key === "data")) {
      return false;
    }
    if (
      partialKeys.includes("color") &&
      !tryUpdatePolygonColorOnly(entry, polygonIndex, entry.polygons[polygonIndex]?.color)
    ) {
      return false;
    }
    if (partialKeys.includes("data") && !tryUpdatePolygonDataOnly(entry, polygonIndex)) {
      return false;
    }
    return true;
  }

  // Refreshes scene-level shadow SVGs for both lighting modes. Callers pass the
  // entry that changed, but emission is scene-wide because every receiving
  // surface aggregates every caster into one compound path. This is the
  // geometry-change entry point — bust the H3 light-quantize cache so the
  // next emit isn't short-circuited against a stale frame.
  function emitShadowLeaves(_entry: MeshEntry): void {
    invalidateShadowLightCache();
    emitSceneShadows();
  }

  // Refreshes every shadow SVG in the scene. Iterates each SURFACE (the
  // global ground + every receiver face) once, then sweeps every caster's
  // projection onto that surface into the same compound path. Mounted SVG
  // elements are reused across light changes; fill-rule=nonzero collapses
  // overlapping CCW outlines into one filled silhouette per surface.
  function emitSceneShadows(lightDirectionOverride?: Vec3): void {
    const casters: MeshEntry[] = [];
    for (const m of meshes) if (!m.disposed && m.castShadow) casters.push(m);
    if (casters.length === 0) {
      clearAllSceneShadows();
      lastEmittedShadowLightKey = null;
      return;
    }

    const shadowColor = currentOptions.shadow?.color ?? "#000000";
    const shadowOpacity = currentOptions.shadow?.opacity ?? 0.25;
    const parsed = parseHexColor(shadowColor)?.rgb ?? [0, 0, 0];
    const r = parsed[0], g = parsed[1], b = parsed[2];
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
    if (lightKey !== null && lightKey === lastEmittedShadowLightKey) return;

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
    const dedupByCaster = new Map<MeshEntry, Set<number>>();
    for (const c of casters) {
      dedupByCaster.set(c, findOverlappingPolygonDuplicates(c.polygons, {
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
    hideGroundShadow();
    for (const receiver of meshes) {
      if (receiver.disposed || !receiver.receiveShadow) continue;
      const dedup = dedupByReceiver.get(receiver) ?? new Set();
      // All of this receiver's light passes are merged into one SVG per face
      // (base = full-lit color, each pass a multiply layer) so overlapping
      // shadows composite to the both-blocked color. The directional pass runs
      // whenever a directional light is configured, or — to preserve the
      // implicit-sun shadow — when there are no shadow-casting point lights;
      // a point-only scene skips it so no phantom default-sun shadow appears.
      emitReceiverShadowsImpl(ctx, casters, dedupByCaster, receiver, dedup, lightDir, r, g, b, shadowOpacity, {
        runDirectional: runDirectionalShadow,
        points: cssPointPositions.map((lightPos, li) => ({ lightPos, index: shadowPointIndices[li]! })),
        allPointLights: allPointLightsCss,
      });
    }
    lastEmittedShadowLightKey = lightKey;
  }

  // Builds a single per-mesh <svg> for the mesh's shadow. Projects every
  // casting polygon to the ground on the CPU, concatenates the outlines
  // into one compound <path d="M…L…Z M…L…Z …"> under fill-rule=nonzero so
  // overlapping CCW subpaths composite as one filled silhouette (no alpha
  // accumulation at intersections). SVG content is internally 2D so this
  // sidesteps the `opacity + transform-style: preserve-3d` flatten trap
  // that breaks CSS-only shadow grouping in a 3D scene.
  // Scene-level ground surface: one SVG containing every caster's
  // projection onto the global ground plane. Overlapping caster shadows
  // (e.g. pole shadow + cube shadow) collapse into one filled silhouette
  // via fill-rule=nonzero instead of stacking opacity.

  function remountEntry(entry: MeshEntry): void {
    if (entry.voxelRenderer) {
      entry.voxelRenderer.render(cameraCullRotation(entry));
      entry.cameraCullSignature = "voxel-direct";
      return;
    }
    clearShadowLeaves(entry);
    syncMountedRendered(entry);
    emitShadowLeaves(entry);
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
    const dedupDropped = cached && cached.polygons === entry.polygons
      ? cached.dedupDropped
      : findOverlappingPolygonDuplicates(entry.polygons, {
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

  function canRenderVoxelDirect(entry: MeshEntry): boolean {
    return !!entry.voxelSource &&
      currentOptions.textureLighting !== "dynamic" &&
      !entry.stableDom &&
      !entry.castShadow;
  }

  // Convert the scene's world-space point lights into a mesh's LOCAL frame
  // (subtract the mesh position, inverse-rotate by the mesh rotation) so they
  // match the local vertex frame the atlas plan shades in. The atlas plan
  // applies the CSS axis-swap × tile itself (computePointContribs). Returns
  // undefined when there are no point lights so the shading fast path holds.
  function localPointLightsForEntry(entry: MeshEntry): PolyPointLight[] | undefined {
    const pls = currentOptions.pointLights;
    if (!pls || pls.length === 0) return undefined;
    const pos = entry.handle.transform.position ?? [0, 0, 0];
    const rot = entry.handle.transform.rotation ?? [0, 0, 0];
    const hasRot = rot[0] !== 0 || rot[1] !== 0 || rot[2] !== 0;
    return pls.map((pl) => {
      const rel: Vec3 = [pl.position[0] - pos[0], pl.position[1] - pos[1], pl.position[2] - pos[2]];
      const local = hasRot ? inverseRotateVec3(rel, rot as Vec3) : rel;
      return { ...pl, position: local };
    });
  }

  function renderEntry(entry: MeshEntry, lightDirectionOverride?: Vec3): void {
    clearRendered(entry);
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
    if (canRenderVoxelDirect(entry)) {
      const renderer = createPolyVoxelRenderer({
        doc,
        wrapper: entry.wrapper,
        polygons: entry.parseResult.polygons,
        directionalLight,
        ambientLight: currentOptions.ambientLight,
      });
      if (renderer) {
        entry.voxelRenderer = renderer;
        renderer.render(cameraCullRotation(entry));
        entry.cameraCullSignature = "voxel-direct";
        entry.textureReadyPromise = TEXTURES_READY;
        return;
      }
    }

    const renderOptions = {
      doc,
      directionalLight,
      pointLights: localPointLightsForEntry(entry),
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
    syncMountedRendered(entry);
    emitShadowLeaves(entry);
  }

  // Light-only rebake that mutates the existing leaves in place instead
  // of tearing them down. Used by `rebakeAtlas` so dragging the directional
  // light slider doesn't flash a frame of unstyled mesh on every tick.
  //
  // Polygon vertices are unchanged → `matrix3d` is unchanged → element
  // positions are unchanged. Only the baked Lambert color (inline `color`
  // / `background-color` for solid leaves, atlas bitmap URL for textured
  // <s> leaves) differs. We build a throw-away atlas off-DOM, wait for
  // its bitmap URLs to be applied to its (never-mounted) elements, then
  // copy each new element's `style` attribute onto the existing leaf with
  // the matching polygon index. The new elements are never inserted; the
  // old leaves keep painting with their previous bitmap until the swap.
  //
  // Falls back to plain `renderEntry` for cases where the in-place swap
  // can't safely match (initial render, voxel-direct path, stable-DOM
  // skeletal animation, topology mismatch).
  function rebakeRenderEntryInPlace(
    entry: MeshEntry,
    lightDirectionOverride?: Vec3,
  ): void {
    if (
      entry.rendered.length === 0 ||
      entry.voxelRenderer ||
      entry.stableDom ||
      canRenderVoxelDirect(entry)
    ) {
      renderEntry(entry, lightDirectionOverride);
      return;
    }
    // If the wrapper was emptied externally (e.g. by a test, or a
    // consumer reaching into the DOM), entry.rendered still references
    // the detached leaves. Mutating their styles wouldn't put them back
    // in the DOM — fall back to the destructive rebuild instead.
    if (entry.rendered[0]?.element.parentNode === null) {
      renderEntry(entry, lightDirectionOverride);
      return;
    }

    const baseDirLight = currentOptions.directionalLight;
    const userDirLight: typeof baseDirLight = lightDirectionOverride
      ? { ...baseDirLight, direction: lightDirectionOverride }
      : baseDirLight;
    const directionalLight = worldDirectionalLightToCss(userDirLight);
    const renderOptions = {
      doc,
      directionalLight,
      pointLights: localPointLightsForEntry(entry),
      ambientLight: currentOptions.ambientLight,
      textureLighting: currentOptions.textureLighting,
      textureQuality: currentOptions.textureQuality,
      textureLeafSizing: currentOptions.textureLeafSizing,
      textureImageRendering: currentOptions.textureImageRendering,
      textureBackend: currentOptions.textureBackend,
      textureProjection: currentOptions.textureProjection,
      seamBleed: currentOptions.seamBleed,
      strategies: currentOptions.strategies,
      computeSolidPaintDefaults: true,
      skipDynamicNormalVars: currentOptions.textureLighting === "dynamic",
    };
    const newAtlas = renderPolygonsWithTextureAtlas(
      entry.polygons,
      renderOptions as Parameters<typeof renderPolygonsWithTextureAtlas>[1],
    );

    const finish = (): void => {
      entry.rebakeInFlight = false;
      const queued = entry.rebakeQueuedLightDir;
      if (queued !== null) {
        entry.rebakeQueuedLightDir = null;
        rebakeRenderEntryInPlace(entry, queued);
      }
    };
    const apply = (): void => {
      if (entry.disposed) {
        newAtlas.dispose();
        finish();
        return;
      }
      // Topology mismatch (shouldn't happen for a pure light rebake but
      // guards against pathological cases) → drop the new atlas and let
      // the full destructive renderEntry path rebuild from scratch.
      if (newAtlas.rendered.length !== entry.rendered.length) {
        newAtlas.dispose();
        renderEntry(entry, lightDirectionOverride);
        finish();
        return;
      }
      for (const item of newAtlas.rendered) {
        const existing = entry.renderedByPolygonIndex[item.polygonIndex];
        if (!existing) continue;
        const nextStyle = item.element.getAttribute("style");
        if (nextStyle !== null) existing.element.setAttribute("style", nextStyle);
      }
      const spd = (newAtlas as { solidPaintDefaults?: SolidPaintDefaults })
        .solidPaintDefaults;
      if (spd) applySolidPaintVars(entry.wrapper, spd);
      // Hand off the Blob URL: revoke the previous atlas's URLs only
      // AFTER the existing leaves have been re-styled to point at the
      // new ones. Defer one animation frame so the browser has a chance
      // to commit a paint with the new URL before the old one is freed.
      const previousDisposeAtlas = entry.disposeAtlas;
      entry.disposeAtlas = newAtlas.dispose;
      if (previousDisposeAtlas) {
        const schedule: (cb: () => void) => void =
          typeof requestAnimationFrame === "function"
            ? (cb) => { requestAnimationFrame(cb); }
            : (cb) => { setTimeout(cb, 0); };
        schedule(previousDisposeAtlas);
      }
      // <q> shadow leaves still need to follow the new light direction.
      emitShadowLeaves(entry);
      finish();
    };

    const ready = (newAtlas as { pagesReady?: Promise<void> }).pagesReady;
    if (ready && typeof ready.then === "function") {
      entry.textureReadyPromise = ready.catch(() => undefined);
      // Pre-decode the new atlas bitmaps BEFORE swapping styles. Until
      // a Blob URL is paint-committed at least once the browser hasn't
      // decoded it; copying that URL into a mounted element triggers
      // decode lazily on the next paint, which is exactly the visible
      // blank frame. `Image.decode()` forces decode upfront so the
      // first paint after the style swap composites the bitmap
      // immediately.
      ready
        .then(() => collectAtlasUrlsFromRendered(newAtlas.rendered))
        .then(decodeAtlasUrls)
        .then(apply, () => {
          newAtlas.dispose();
          if (!entry.disposed) renderEntry(entry, lightDirectionOverride);
          finish();
        });
    } else {
      apply();
    }
  }

  // Serialised entry point for rebakeRenderEntryInPlace. Coalesces
  // rapid back-to-back calls: while a rebake is in flight, the latest
  // requested light direction is queued (overwriting any prior queued
  // value) and applied as soon as the in-flight rebake's apply()
  // resolves. The visible bitmap therefore only ever advances to the
  // LATEST-requested direction in order — no out-of-order swaps that
  // would visually flicker between intermediate light directions.
  function requestRebakeAtlas(entry: MeshEntry, lightDir: Vec3): void {
    if (entry.rebakeInFlight) {
      entry.rebakeQueuedLightDir = lightDir;
      return;
    }
    entry.rebakeInFlight = true;
    rebakeRenderEntryInPlace(entry, lightDir);
  }

  function collectAtlasUrlsFromRendered(
    rendered: ReturnType<typeof renderPolygonsWithTextureAtlas>["rendered"],
  ): string[] {
    const urls = new Set<string>();
    for (const item of rendered) {
      const style = item.element.getAttribute("style") ?? "";
      // Match `background:url(blob:...)` or `--polycss-atlas-url:url(blob:...)`.
      const re = /url\((blob:[^)]+)\)/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(style)) !== null) urls.add(m[1]);
    }
    return Array.from(urls);
  }

  function decodeAtlasUrls(urls: string[]): Promise<void> {
    if (urls.length === 0 || typeof Image === "undefined") return Promise.resolve();
    return Promise.all(urls.map((url) => {
      const img = new Image();
      img.src = url;
      const decoded = img.decode?.();
      return decoded ? decoded.catch(() => {}) : Promise.resolve();
    })).then(() => undefined);
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
  function recomputeShadowGround(): void {
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
        clearAllSceneShadows();
        invalidateShadowLightCache();
      }
      return;
    }
    const lift = currentOptions.shadow?.lift ?? 0.05;
    // World Z → CSS Z: the ground plane in CSS-Z coordinates. Lift is added
    // (not subtracted) so the shadow plane sits slightly *above* the model
    // bbox floor — putting it on top of a receiver mesh placed at minZ
    // rather than below it, where the receiver would occlude the shadow.
    const groundCssZ = (minWorldZ + lift) * DEFAULT_TILE;
    const prevGround = shadowSvgState.currentGroundCssZ;
    shadowSvgState.currentGroundCssZ = groundCssZ;
    // Ground changed: rebuild the scene-level shadow set once.
    if (prevGround !== groundCssZ) {
      invalidateShadowLightCache();
      emitSceneShadows();
    }
  }

  async function renderEntryChunked(
    entry: MeshEntry,
    shouldCancel: () => boolean,
  ): Promise<boolean> {
    clearRendered(entry);
    const directionalLight = worldDirectionalLightToCss(currentOptions.directionalLight);
    const renderOptions = {
      doc,
      directionalLight,
      pointLights: localPointLightsForEntry(entry),
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
      syncMountedRendered(entry);
      emitShadowLeaves(entry);
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
    const mounted = await syncMountedRenderedChunked(entry, shouldCancel);
    if (mounted) emitShadowLeaves(entry);
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
            syncMountedRenderedForCameraChange(entry, true);
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
        clearRendered(entry);
        meshes.delete(entry);
        meshByElement.delete(wrapper);
        clearReceiverShadowCache(entry);
        clearCasterItemsCache(entry);
        recomputeAutoCenter();
        recomputeShadowGround();
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
              syncMountedRenderedForCameraChange(entry, true);
            } else {
              syncCameraCullSignature(entry);
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
        Object.assign(entry.polygons[idx], partial);
        const partialKeys = Object.keys(partial);
        if (tryUpdatePolygonLeafOnly(entry, idx, partialKeys)) {
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
          clearRendered(entry);
          return;
        }
        if (shouldRecomputeAutoCenter) recomputeAutoCenter();
      },
      setTransform(t: Partial<PolyMeshTransform>) {
        const prevCastShadow = entry.castShadow;
        const prevReceiveShadow = entry.receiveShadow;
        if (t.castShadow !== undefined) entry.castShadow = !!t.castShadow;
        if (t.receiveShadow !== undefined) entry.receiveShadow = !!t.receiveShadow;
        transform = { ...transform, ...t };
        const css2 = buildMeshTransform(transform);
        wrapper.style.transform = css2 ?? "";
        applyMeshLightVarOverride(entry, transform.rotation);
        if (t.rotation !== undefined) syncMountedRenderedForCameraChange(entry, true);
        if (entry.castShadow !== prevCastShadow) {
          // Voxel-eligible meshes use the direct-matrix fast path only when
          // castShadow is false (canRenderVoxelDirect). Toggling castShadow
          // flips that eligibility — if it changes, the mesh has to switch
          // renderer (direct-voxel ↔ polygon), so re-render the whole entry.
          // Otherwise emitShadowLeaves runs on the wrong leaf set (the
          // voxel-direct path has no polygon leaves to project from), and
          // shadows silently fail to emit.
          if (entry.voxelSource) renderEntry(entry);
          emitShadowLeaves(entry);
          recomputeShadowGround();
        }
        // Receiver toggled: rebuild the scene-level shadow set so this
        // mesh's faces are added (or removed) as receivers. When flipping
        // OFF, the per-frame emitter for THIS mesh would never run again
        // (emitSceneShadows skips meshes with !receiveShadow), so its
        // previously-mounted receiver SVGs would linger in the DOM. Tear
        // them down explicitly before the rebuild.
        if (entry.receiveShadow !== prevReceiveShadow) {
          if (!entry.receiveShadow) disposeReceiverShadowMounts(entry);
          invalidateShadowLightCache();
          emitSceneShadows();
        }
        // Position / scale change: shadow geometry depends on world-space
        // coords AND the mesh's wrapper scale (which pivots from the
        // bbox center). Non-shadow helpers (e.g. the light helper) must
        // not overwrite transient preview shadows with the committed
        // light, so the gate is on castShadow || receiveShadow.
        if ((t.position !== undefined || t.scale !== undefined) && (entry.castShadow || entry.receiveShadow)) {
          recomputeShadowGround();
          invalidateShadowLightCache();
          emitSceneShadows();
        }
      },
      dispose() {
        if (entry.disposed) return;
        entry.disposed = true;
        polygonUpdateVersion++;
        if (wrapper.parentNode) wrapper.parentNode.removeChild(wrapper);
        clearRendered(entry);
        try { parseResult.dispose(); } catch { /* ignore */ }
        meshes.delete(entry);
        meshByElement.delete(wrapper);
        recomputeAutoCenter();
        recomputeShadowGround();
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
        requestRebakeAtlas(entry, localLightDir);
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
    applyMeshLightVarOverride(entry, transform.rotation);
    recomputeAutoCenter();
    recomputeShadowGround();
    // New receiver: the scene-level shadow set must rebuild so existing
    // casters get faces to project onto. recomputeShadowGround only
    // does this when the global ground changes; force a rebuild for the
    // receiver-only case.
    if (entry.receiveShadow) {
      invalidateShadowLightCache();
      emitSceneShadows();
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
      applyMeshLightVarOverride(entry, entry.handle.transform.rotation);
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
      recomputeShadowGround();
      invalidateShadowLightCache();
      emitSceneShadows();
    } else if (shadowReemitNeeded) {
      // The emit short-circuit key only discriminates by light DIRECTION, so a
      // direction change self-busts, but shadow-appearance and directional
      // intensity/color changes must bust the cache explicitly or
      // emitSceneShadows would no-op.
      if (shadowAppearanceChanged || directionalChanged) invalidateShadowLightCache();
      emitSceneShadows();
    }
    if (shadowAppearanceChanged && partial.shadow?.lift !== prevShadow?.lift) {
      recomputeShadowGround();
    }
  }

  function getOptions(): Readonly<Omit<PolySceneOptions, "camera">> {
    return currentOptions;
  }

  function applyCamera(): void {
    applyCameraStyle(cameraEl, currentOptions);
    applySceneCameraTransform(sceneEl);
    for (const entry of meshes) syncMountedRenderedForCameraChange(entry);
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
    previewBakedSolidLighting,
    commitBakedSolidLighting,
    clearBakedSolidLightingPreview,
  };
  return handle;
}
