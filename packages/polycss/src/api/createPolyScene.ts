/**
 * createPolyScene — imperative scene API. The vanilla counterpart to
 * `<PolyScene>` in React / Vue.
 *
 * Per §API freeze: takes a host element + scene options, returns a
 * `PolySceneHandle` whose `add(parseResult, transform?)` mounts a mesh under
 * the scene root and returns a removable `PolyMeshHandle`.
 *
 * Implementation:
 *   - Inserts a `<div class="polycss-scene">` into the host.
 *   - Each `add(...)` creates a `<div class="polycss-mesh">` with the
 *     mesh transform; mounts every valid polygon as an atlas-backed
 *     background sprite.
 *   - `destroy()` removes the scene element and disposes every mesh
 *     (which in turn disposes generated atlas blob URLs).
 *
 * The scene element is a 0×0 anchor at world (0,0,0) — pinned via
 * top:50%/left:50% so it sits at the visible center of the host. This
 * matches React/Vue's PolyScene anchor pattern. Polygons render around
 * the anchor via their own matrix3d translations.
 */
import type {
  MeshResolution,
  PolyAmbientLight,
  PolyDirectionalLight,
  ParseResult,
  Polygon,
  PolyTextureLightingMode,
  Vec3,
  CameraCullNormalGroup,
  CameraCullRotation,
} from "@layoutit/polycss-core";
import type {
  PolyPerspectiveCameraHandle,
  PolyOrthographicCameraHandle,
} from "./createPolyCamera";
import {
  BASE_TILE,
  CAMERA_BACKFACE_CULL_EPS,
  DEFAULT_SEAM_BLEED,
  VOXEL_CAMERA_CULL_NORMAL_LIMIT,
  cameraCullNormalKey,
  cameraCullVisibleSignature,
  clipPolygonToConvex2D,
  computeSceneBbox,
  convexHull2D,
  ensureCcw2D,
  findOverlappingPolygonDuplicates,
  inverseRotateVec3,
  isAxisAlignedSurfaceNormal,
  isVoxelCameraCullableNormalGroups,
  normalFacesCamera,
  optimizeMeshPolygons,
  parseHex,
  parseHexColor,
  polygonCssSurfaceNormal,
  projectCssVertexToGround,
  parsePureColor,
} from "@layoutit/polycss-core";
import {
  cssBorderShapeForPlan,
  getSolidPaintDefaults,
  renderPolygonsWithTextureAtlas,
  renderPolygonsWithTextureAtlasAsync,
  renderPolygonsWithStableTriangles,
  updateStableTriangleFrame,
  updatePolygonsWithStableTopology,
  type TextureQuality,
  type PolySeamBleed,
  type PolyRenderStrategiesOption,
  type RenderedPoly,
  type SolidPaintDefaults,
} from "../render/textureAtlas";
import { applySolidPaint } from "../render/atlas/paintDefaults";
import {
  applyPolygonDataAttrs,
  shadedSolidPlanForNormal,
} from "../render/atlas/emit";
import {
  createPolyVoxelRenderer,
  type PolyVoxelRenderer,
} from "../render/voxelRenderer";
import { injectPolyBaseStyles } from "../styles/styles";

// Used only by the internal async mesh update path. Batching DOM insertion
// keeps large gallery meshes below Chrome's long-task warning threshold
// without changing the synchronous public setPolygons() contract.
const ASYNC_MOUNT_BATCH_SIZE = 750;
const DEFAULT_SCENE_PERSPECTIVE = 32000;
const BAKED_SOLID_PREVIEW_ACTIVE_VAR = "--polycss-light-preview-active";
const BAKED_SOLID_PREVIEW_ACTIVE = `var(${BAKED_SOLID_PREVIEW_ACTIVE_VAR}, 0)`;
const BAKED_SOLID_PREVIEW_LAMBERT =
  "max(0, calc(var(--pnx, 0) * var(--plx, 0) + var(--pny, 0) * var(--ply, 0) + var(--pnz, 1) * var(--plz, 1)))";
const BAKED_SOLID_PREVIEW_R =
  "calc(255 * var(--psr, 1) * (var(--par, 1) * var(--pai, 0.4) + var(--plr, 1) * var(--pli, 1) * var(--plam, 0)))";
const BAKED_SOLID_PREVIEW_G =
  "calc(255 * var(--psg, 1) * (var(--pag, 1) * var(--pai, 0.4) + var(--plg, 1) * var(--pli, 1) * var(--plam, 0)))";
const BAKED_SOLID_PREVIEW_B =
  "calc(255 * var(--psb, 1) * (var(--pab, 1) * var(--pai, 0.4) + var(--plb, 1) * var(--pli, 1) * var(--plam, 0)))";
const LIGHTING_VAR_NAMES = [
  "--plx", "--ply", "--plz",
  "--plr", "--plg", "--plb", "--pli",
  "--par", "--pag", "--pab", "--pai",
  "--clx", "--cly", "--clz",
] as const;

function normalizeSceneOptions<T extends Partial<Omit<PolySceneOptions, "camera">>>(options: T): T {
  if (!Object.prototype.hasOwnProperty.call(options, "seamBleed") || options.seamBleed !== undefined) {
    return options;
  }
  return { ...options, seamBleed: DEFAULT_SEAM_BLEED };
}

export interface PolySceneOptions {
  /**
   * Camera handle created by `createPolyCamera`, `createPolyOrthographicCamera`,
   * or `createPolyPerspectiveCamera`. Required — `createPolyScene` will throw if
   * this field is missing.
   */
  camera: PolyPerspectiveCameraHandle | PolyOrthographicCameraHandle;
  directionalLight?: PolyDirectionalLight;
  ambientLight?: PolyAmbientLight;
  /** Textured polygon lighting mode. Defaults to "baked". */
  textureLighting?: PolyTextureLightingMode;
  /** Atlas bitmap budget and CSS sprite size. `"auto"` uses a
   *  device-appropriate memory budget (~4 MB mobile / ~16 MB desktop) and
   *  desktop/mobile sprite sizing. Numeric values 0.1..1 force an explicit
   *  raster scale and the 64px sprite. */
  textureQuality?: TextureQuality;
  /** Solid seam overscan. `"auto"` computes a fitted per-edge amount from the polygon plan. */
  seamBleed?: PolySeamBleed;
  /**
   * Skip specific render-strategy tags. Polygons that would normally use a
   * disabled tag fall through the chain (b → i → s, u → i → s, i → s).
   * `<s>` is the universal fallback and cannot be disabled.
   */
  strategies?: PolyRenderStrategiesOption;
  /**
   * When `true`, rotation pivots around the union bbox of all added meshes
   * instead of world (0,0,0). The scene wraps polygons in an inner div
   * translated by `-bboxCenter`. Updates whenever a mesh is added/removed
   * or `setOptions` is called. Mirrors React's `<PolyScene autoCenter>`.
   */
  autoCenter?: boolean;
  /**
   * Shadow appearance for meshes with `castShadow: true`. Works in both
   * lighting modes — dynamic mode projects via CSS vars so shadows
   * follow a moving light, baked mode CPU-bakes the projection into
   * each leaf's inline `matrix3d` and drops back-facing polys from the
   * DOM entirely. Defaults: `{ color: "#000000", opacity: 0.25, lift: 0.05, maxExtend: 2000 }`.
   */
  shadow?: {
    /** Shadow color as a CSS hex string. Default: `"#000000"`. */
    color?: string;
    /** Shadow opacity 0..1. Default: `0.25`. */
    opacity?: number;
    /**
     * Raises the shadow plane slightly above the model bbox floor along
     * +Z (Z up) so it sits on top of a receiver mesh placed at the bbox
     * bottom, rather than below it where the receiver would occlude the
     * shadow. In world units. Default: `0.05`.
     */
    lift?: number;
    /**
     * Maximum CSS pixels the shadow may extend beyond the mesh's
     * footprint (the no-shear silhouette directly under the mesh). The
     * footprint area is always preserved; only the sheared tail at low
     * light elevations is truncated. Default: `2000`.
     *
     * **Trade-off:** larger values give longer shadows but the SVG
     * backing store grows quadratically with this value, which can
     * cause repaint flicker at extreme low-elevation angles. Pass a
     * very large number (e.g. `Infinity`) to disable the cap entirely.
     */
    maxExtend?: number;
  };
}

export interface PolyMeshTransform {
  /** Stable identifier — exposed on the handle and reflected on the
   *  wrapper as `data-poly-mesh-id`. Used by selection helpers to
   *  resolve clicks back to the mesh and to dedupe selection state. */
  id?: string;
  position?: Vec3;
  scale?: number | Vec3;
  rotation?: Vec3;
  /**
   * Whether `scene.add()` should merge coplanar polygons before rendering.
   * Defaults to `true`. Set `false` for animated/deforming meshes whose
   * triangle topology must remain stable from frame to frame.
   */
  merge?: boolean;
  /**
   * Mesh optimization intent. Defaults to `"lossy"` (bounded geometric
   * approximation when it reduces polygon count). Set `"lossless"` to preserve
   * the authored surface — only exact coplanar merges are applied.
   */
  meshResolution?: MeshResolution;
  /**
   * Keep polygon leaf DOM nodes stable across setPolygons() calls when the
   * mesh topology is unchanged. Intended for animated/deforming meshes.
   */
  stableDom?: boolean;
  /**
   * When `true`, this mesh's polygons are NOT included in the scene's
   * auto-center bbox. Use for debug overlays / helpers that shouldn't
   * shift the camera target when toggled. Defaults to `false`.
   */
  excludeFromAutoCenter?: boolean;
  /**
   * When `true`, this mesh casts a shadow onto the scene's shadow ground
   * plane (and onto any meshes marked `receiveShadow: true`). The shadow
   * emits as one per-mesh `<svg>` whose path is the union of every
   * casting polygon's projection. Works in both lighting modes.
   * Defaults to `false`.
   */
  castShadow?: boolean;
  /**
   * **(experimental)** When `true`, this mesh acts as a shadow receiver:
   * each of its polygon faces becomes a target plane that casting meshes'
   * shadows project onto and get clipped to. Useful for "shadow on table"
   * scenarios. Currently only convex face outlines clip cleanly. When no
   * receivers are present the global ground plane is used as today.
   * Defaults to `false`.
   */
  receiveShadow?: boolean;
}

export interface PolyMeshHandle {
  /** The polygons that were loaded after normalization and automatic merge. */
  polygons: Polygon[];
  /** The `.polycss-mesh` wrapper div for this mesh. Exposed so layered
   *  helpers (selection, transform controls) can resolve a click target
   *  back to its owning mesh, attach event listeners, or measure the
   *  mesh's screen position via `getBoundingClientRect`. */
  readonly element: HTMLElement;
  /** Identifier passed via `PolyMeshTransform.id` (if any). Reflected on
   *  the wrapper as `data-poly-mesh-id`. */
  readonly id?: string;
  /** Current transform snapshot (position / rotation / scale). Returned
   *  by reference — treat as read-only and use `setTransform` to
   *  mutate. */
  readonly transform: PolyMeshTransform;
  /** Remove the mesh from the scene. */
  remove(): void;
  /** Replace polygon geometry without tearing down the scene or controls. */
  setPolygons(polygons: Polygon[], options?: {
    merge?: boolean;
    stableDom?: boolean;
    recomputeAutoCenter?: boolean;
  }): void;
  /**
   * Update a single polygon in place. `target` is either a polygon
   * reference (as returned by `getPolygons()`) or its index. `partial`
   * fields are merged onto the polygon; the mesh is then re-rendered.
   * Skips the merge pass, so this is cheaper than `setPolygons` for
   * targeted edits like color picker updates from an inspector UI.
   * Silently no-ops if `target` isn't found.
   */
  updatePolygon(target: Polygon | number, partial: Partial<Polygon>): void;
  /** Update transform without re-parsing. */
  setTransform(t: Partial<PolyMeshTransform>): void;
  /** Revoke any blob URLs the parse created. Idempotent. */
  dispose(): void;
  /**
   * Re-rasterize the atlas using the directional light inverse-rotated into
   * the mesh's local frame. Call this after a mesh rotation has been
   * committed (e.g., on pointer release in rotate-mode transform controls) to
   * correct stale baked shading.
   *
   * **Background:** Baked atlas tiles encode `baseColor × Lambert(worldNormal,
   * worldLight)`. When the mesh wrapper rotates via CSS, the polygon's normal
   * in world space changes but the baked color doesn't — faces stay lit/unlit
   * incorrectly. `rebakeAtlas()` inverse-rotates the world light into the
   * mesh's local frame and re-runs the rasterizer; because
   * `dot(localNormal, localLight) === dot(worldNormal, worldLight)` the
   * output is correct for any rotation.
   *
   * **Performance note:** This does NOT run on every `setTransform` call —
   * only when explicitly invoked, so dragging remains smooth. Call it on
   * pointer release (or any point where you want to commit the new shading).
   */
  rebakeAtlas(): void;
  /** Current `position` from the transform (matches framework API). */
  getPosition(): Vec3 | undefined;
  /** Current `rotation` from the transform (matches framework API). */
  getRotation(): Vec3 | undefined;
  /** Current `scale` from the transform (matches framework API). */
  getScale(): number | Vec3 | undefined;
  /** Polygons currently being rendered (matches framework API). */
  getPolygons(): Polygon[];
}

// Internal-only async update hook for large imperative scene users. Keeping it
// off PolyMeshHandle avoids turning a debug-workbench long-task fix into a
// public API contract that React/Vue also need to mirror.
interface InternalPolyMeshHandle extends PolyMeshHandle, PolyAnimationTriangleFrameTarget {
  setPolygonsChunked(polygons: Polygon[], options?: {
    merge?: boolean;
    stableDom?: boolean;
    recomputeAutoCenter?: boolean;
  }): Promise<void>;
}

export interface PolySceneHandle {
  /** Add a mesh to the scene. Returns a handle for later removal. */
  add(mesh: ParseResult, opts?: PolyMeshTransform): PolyMeshHandle;
  /** Update scene-level config (lighting, autoCenter, strategies, etc.). Camera state is on `scene.camera`. */
  setOptions(partial: Partial<Omit<PolySceneOptions, "camera">>): void;
  /** Tear down the scene; revokes all blob URLs of registered meshes. */
  destroy(): void;
  /**
   * The host element passed to `createPolyScene`. Exposed for layered
   * helpers like `createPolyOrbitControls` that need to attach event listeners
   * without tracking the host separately.
   */
  readonly host: HTMLElement;
  /**
   * The `.polycss-camera` wrapper element created by `createPolyScene` between
   * the host and the `.polycss-scene` element. Carries the CSS `perspective`
   * that matches React/Vue's `<div class="polycss-camera">` wrapper shape.
   * FPV controls toggle `.polycss-fpv-host` on this element.
   */
  readonly cameraEl: HTMLElement;
  /**
   * The camera handle this scene is bound to. Controls update camera state
   * via `scene.camera.update({...})` then call `scene.applyCamera()` to
   * re-apply the transform.
   */
  readonly camera: PolyPerspectiveCameraHandle | PolyOrthographicCameraHandle;
  /**
   * Re-applies the scene transform from the current camera state. Call this
   * after mutating `scene.camera.update({...})` to make the change visible.
   * Controls call this once per interaction event after updating camera state.
   */
  applyCamera(): void;
  /**
   * Snapshot of the current non-camera scene options (lighting, autoCenter,
   * textureQuality, strategies, shadow). Returned by reference — treat as
   * read-only; use `setOptions` to update.
   */
  getOptions(): Readonly<Omit<PolySceneOptions, "camera">>;
  /** Snapshot of mesh handles currently in the scene (insertion order).
   *  Used by selection helpers to enumerate hit-test candidates. */
  meshes(): readonly PolyMeshHandle[];
  /** Resolve a `.polycss-mesh` element back to its handle, or `null` if
   *  the element doesn't belong to this scene. */
  findMeshByElement(element: Element | null): PolyMeshHandle | null;
}

const DEFAULT_ZOOM = 1;
const DEFAULT_TILE = BASE_TILE;
const POLY_ANIMATION_TRIANGLE_FRAME_TARGET = Symbol.for("polycss.animation.triangleFrameTarget");
// Sentinel that keeps broad camera DOM culling disabled once a mesh proves
// it has non-voxel normals; callers never inspect group contents directly.
const NON_CULLABLE_CAMERA_GROUP: CameraCullNormalGroup = {
  key: "non-cullable",
  normal: [1, 1, 0],
};

function nonCullableCameraGroups(): CameraCullNormalGroup[] {
  return [NON_CULLABLE_CAMERA_GROUP];
}

interface InternalSetPolygonsOptions {
  merge?: boolean;
  stableDom?: boolean;
  recomputeAutoCenter?: boolean;
  stableTriangleDebug?: "transform-only" | "plan-only";
  stableTriangleUpdateMode?: "full" | "transform-only" | "color-only";
  stableTriangleColorPolicy?: "cadence" | "adaptive";
  stableTriangleColorSteps?: number;
  stableTriangleColorFreezeFrames?: number;
  stableTriangleColorBudget?: number;
  stableTriangleColorMaxAge?: number;
  stableTriangleColorMaxStep?: number;
  stableTriangleMatrixDecimals?: number;
}

interface PolyAnimationTriangleFrame {
  polygonCount: number;
  vertices: ArrayLike<number>;
  colors?: readonly (string | undefined)[];
  solidTriangles?: boolean;
}

interface PolyAnimationTriangleFrameTarget {
  [POLY_ANIMATION_TRIANGLE_FRAME_TARGET]?: (
    frame: PolyAnimationTriangleFrame,
    options?: InternalSetPolygonsOptions,
  ) => boolean;
}

function strategiesEqual(
  a: PolyRenderStrategiesOption | undefined,
  b: PolyRenderStrategiesOption | undefined,
): boolean {
  const da = a?.disable ?? [];
  const db = b?.disable ?? [];
  if (da.length !== db.length) return false;
  for (const s of da) if (!db.includes(s)) return false;
  return true;
}

function vec3Equal(a: Vec3 | undefined, b: Vec3 | undefined): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
}

function shadowOptsEqual(
  a: PolySceneOptions["shadow"] | undefined,
  b: PolySceneOptions["shadow"] | undefined,
): boolean {
  if (a === b) return true;
  return (a?.color ?? "#000000") === (b?.color ?? "#000000")
    && (a?.opacity ?? 0.25) === (b?.opacity ?? 0.25)
    && (a?.lift ?? 0.05) === (b?.lift ?? 0.05)
    && (a?.maxExtend ?? 2000) === (b?.maxExtend ?? 2000);
}

function buildMeshTransform(t: PolyMeshTransform): string | undefined {
  const parts: string[] = [];
  if (t.position) {
    parts.push(
      `translate3d(${t.position[0]}px, ${t.position[1]}px, ${t.position[2]}px)`
    );
  }
  if (t.scale !== undefined) {
    if (typeof t.scale === "number") {
      if (t.scale !== 1) parts.push(`scale3d(${t.scale}, ${t.scale}, ${t.scale})`);
    } else {
      parts.push(`scale3d(${t.scale[0]}, ${t.scale[1]}, ${t.scale[2]})`);
    }
  }
  if (t.rotation) {
    if (t.rotation[0]) parts.push(`rotateX(${t.rotation[0]}deg)`);
    if (t.rotation[1]) parts.push(`rotateY(${t.rotation[1]}deg)`);
    if (t.rotation[2]) parts.push(`rotateZ(${t.rotation[2]}deg)`);
  }
  return parts.length > 0 ? parts.join(" ") : undefined;
}

function buildSceneTransformFromCamera(
  camera: PolyPerspectiveCameraHandle | PolyOrthographicCameraHandle,
  autoCenterOffset: Vec3 = [0, 0, 0],
  layoutScale = 1,
): string {
  const state = camera.state;
  const rotX = state.rotX;
  const rotY = state.rotY;
  const zoom = (state.zoom ?? DEFAULT_ZOOM) * layoutScale;
  const distance = (state.distance ?? 0) * layoutScale;
  const target = state.target ?? [0, 0, 0];
  // World→CSS axis swap: world[0]→CSS Y, world[1]→CSS X, world[2]→CSS Z.
  // Negate so the scene moves such that `target + autoCenterOffset` appears
  // at viewport centre. `autoCenterOffset` is the bbox-center of all meshes
  // (auto-managed); `target` is the user-driven pan delta (orbit/map
  // controls). Keeping them separate means panning is preserved across
  // mesh add/remove, and an automatic recenter doesn't fight the user's
  // chosen view target.
  const wx = target[0] + autoCenterOffset[0];
  const wy = target[1] + autoCenterOffset[1];
  const wz = target[2] + autoCenterOffset[2];
  const cssX = wy * DEFAULT_TILE;  // world Y → CSS X
  const cssY = wx * DEFAULT_TILE;  // world X → CSS Y
  const cssZ = wz * DEFAULT_TILE;  // world Z → CSS Z
  // Match React's PolyCamera transform: rotate() (i.e. rotateZ) — NOT
  // rotateY. After the rotateX tilt, the world's Z axis is what reads
  // as "spin in place"; rotateY rotates around an oblique axis and
  // makes the mesh wobble. Names line up: rotY in our API == CSS rotate.
  // translate3d is innermost (applied first) → world-space pan at any tilt.
  // translateZ(-distance) is outermost (applied last) — pulls the camera
  // back from the target along the view axis (dolly). Matches core's getStyle().
  const distancePart = distance !== 0 ? `translateZ(${-distance}px) ` : "";
  return `${distancePart}scale(${zoom}) rotateX(${rotX}deg) rotate(${rotY}deg) translate3d(${-cssX}px, ${-cssY}px, ${-cssZ}px)`;
}

function parseCssZoom(value: string): number {
  const text = value.trim();
  if (!text || text === "normal") return 1;
  const numeric = text.endsWith("%")
    ? Number(text.slice(0, -1)) / 100
    : Number(text);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : 1;
}

function effectiveCssZoom(element: HTMLElement): number {
  const win = element.ownerDocument?.defaultView;
  if (!win) return 1;

  let zoom = 1;
  for (let current: HTMLElement | null = element; current; current = current.parentElement) {
    zoom *= parseCssZoom(win.getComputedStyle(current).getPropertyValue("zoom"));
  }
  return Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
}

function applyCssZoomCompensation(el: HTMLElement, scale: number): void {
  // Chromium's CSS zoom can scale layout metrics without scaling the
  // preserve-3d rasterization path consistently. Neutralize zoom on the scene
  // root, then fold the same scale into scene geometry transforms explicitly.
  if (Math.abs(scale - 1) < 1e-6) {
    el.style.removeProperty("zoom");
  } else {
    el.style.setProperty("zoom", String(1 / scale));
  }
}

// ─── Lambert-bucket grouping ────────────────────────────────────────────────
// For dynamic-mode scenes: group polygons by quantized face normal + color
// into wrapper divs. The wrapper has the bucket's normal as inline CSS
// vars; the per-bucket cascade rule computes `--plam` ONCE per
// wrapper. Polys inside inherit the lambert and skip the per-poly dot
// product. For voxel meshes (chicken, castle walls) this collapses
// thousands of per-frame calc()s into a few dozen; for organic meshes
// (saucer) the quantization gives ~7× fewer dot products at sub-1 %
// lighting error per channel.
//
// Quantization precision: each normal component is rounded to the nearest
// LAMBERT_BUCKET_PRECISION step then re-normalized. Voxel face normals
// (±1, 0, 0) are already on the grid so they bucket exactly; curved-mesh
// normals snap to the nearest cell on the unit sphere. With precision 0.1
// the worst-case angular error is ~6° → cos delta < 0.005, visually
// imperceptible.
const LAMBERT_BUCKET_PRECISION = 0.1;

function quantizeNormalKey(p: Polygon): { key: string; vec: Vec3 } | null {
  if (p.vertices.length < 3) return null;
  // CSS-space edges — must match `computeTextureAtlasPlan` exactly so the
  // bucket's normal sits in the same frame as `--plx/ly/lz`. The
  // atlas applies `toCss(v) = [v.y, v.x, v.z]` (x↔y swap) and then takes
  // a NEGATED cross product. Reproducing both here means the cascade
  // dot(normal, light) computes the same value as the original per-poly
  // path that was set inline by `applyDynamicNormalVars`.
  const v0 = p.vertices[0];
  let nx = 0;
  let ny = 0;
  let nz = 0;
  for (let i = 1; i + 1 < p.vertices.length; i++) {
    const v1 = p.vertices[i];
    const v2 = p.vertices[i + 1];
    const e1x = v1[1] - v0[1], e1y = v1[0] - v0[0], e1z = v1[2] - v0[2];
    const e2x = v2[1] - v0[1], e2y = v2[0] - v0[0], e2z = v2[2] - v0[2];
    nx -= e1y * e2z - e1z * e2y;
    ny -= e1z * e2x - e1x * e2z;
    nz -= e1x * e2y - e1y * e2x;
  }
  const len = Math.hypot(nx, ny, nz);
  if (len < 1e-9) return null;
  nx /= len; ny /= len; nz /= len;
  // Quantize each component to the precision grid, then renormalize so the
  // bucket's normal stays a true unit vector. Two polys with identical
  // quantized triples land in the same bucket.
  const inv = 1 / LAMBERT_BUCKET_PRECISION;
  const qx = Math.round(nx * inv) / inv;
  const qy = Math.round(ny * inv) / inv;
  const qz = Math.round(nz * inv) / inv;
  const qLen = Math.hypot(qx, qy, qz);
  if (qLen < 1e-9) return null;
  return {
    key: qx + "," + qy + "," + qz,
    vec: [qx / qLen, qy / qLen, qz / qLen],
  };
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

  interface MeshEntry {
    handle: PolyMeshHandle;
    wrapper: HTMLDivElement;
    parseResult: ParseResult;
    rendered: RenderedPoly[];
    renderedByPolygonIndex: Array<RenderedPoly | undefined>;
    /** Dynamic-mode shadow `<q>` leaves, one per non-deduped casting
     *  polygon. Empty in baked mode (which uses `shadowSvg` instead). */
    shadowRendered: HTMLElement[];
    voxelRenderer?: PolyVoxelRenderer;
    disposeAtlas?: () => void;
    polygons: Polygon[];
    voxelSource: ParseResult["voxelSource"];
    disposed: boolean;
    stableDom: boolean;
    hasBuckets: boolean;
    skipBucketNormalCleanupOnce: boolean;
    excludeFromAutoCenter: boolean;
    castShadow: boolean;
    receiveShadow: boolean;
    cameraCullGroups: CameraCullNormalGroup[];
    cameraCullSignature: string;
    lightOverrideSignature: string;
    stableTriangleColorFrame: number;
    solidLightingPreviewPrepared: boolean;
    solidLightingPreviewActive: boolean;
    /** Rotation snapshot used by the baked atlas baker. Advances only when
     *  `rebakeAtlas()` is called — not on every `setTransform`. */
    bakedRotation: Vec3;
  }
  const meshes = new Set<MeshEntry>();

  // Cached CSS-Z of the shadow ground plane. Set by `recomputeShadowGround`.
  // In dynamic mode this also flows into the `--shadow-ground-cssz` CSS var
  // that drives `--shadow-proj`. In baked mode it's read by `emitShadowLeaves`
  // to bake the per-leaf inline projection matrix on the CPU. `null` means
  // no casting mesh exists yet, so no shadow leaves should be emitted.
  let currentGroundCssZ: number | null = null;

  // Scene-level shadow SVGs. One per surface (ground + each receiver
  // face). Every caster's projection onto a given surface ends up in
  // that surface's single SVG path, so overlapping shadows from
  // different casters composite via SVG fill-rule=nonzero (one solid
  // silhouette per surface) rather than stacking opacity at the DOM
  // level. Surface elements are reused across light changes; only the
  // SVG attributes/path data change.
  let groundShadowSvg: SVGSVGElement | null = null;
  let groundShadowPath: SVGPathElement | null = null;
  let groundShadowVisible = false;
  function disposeGroundShadow(): void {
    if (groundShadowSvg?.parentNode) groundShadowSvg.parentNode.removeChild(groundShadowSvg);
    groundShadowSvg = null;
    groundShadowPath = null;
    groundShadowVisible = false;
  }
  function hideGroundShadow(): void {
    if (groundShadowSvg && groundShadowVisible) {
      groundShadowSvg.style.display = "none";
      groundShadowVisible = false;
    }
  }
  function ensureGroundShadow(): { svg: SVGSVGElement; path: SVGPathElement } {
    const svgNS = "http://www.w3.org/2000/svg";
    let svg = groundShadowSvg;
    let path = groundShadowPath;
    if (!svg || !path) {
      svg = doc.createElementNS(svgNS, "svg");
      svg.setAttribute("class", "polycss-shadow polycss-shadow-svg");
      svg.style.position = "absolute";
      svg.style.top = "0";
      svg.style.left = "0";
      svg.style.display = "block";
      svg.style.overflow = "hidden";
      svg.style.transformOrigin = "0 0";
      svg.style.pointerEvents = "none";
      svg.style.willChange = "transform";
      path = doc.createElementNS(svgNS, "path");
      path.setAttribute("fill-rule", "nonzero");
      path.setAttribute("stroke-width", "2");
      path.setAttribute("stroke-linejoin", "round");
      svg.appendChild(path);
      groundShadowSvg = svg;
      groundShadowPath = path;
      const sceneFirst = sceneEl.firstChild;
      if (sceneFirst) sceneEl.insertBefore(svg, sceneFirst);
      else sceneEl.appendChild(svg);
    } else if (!svg.parentNode) {
      const sceneFirst = sceneEl.firstChild;
      if (sceneFirst) sceneEl.insertBefore(svg, sceneFirst);
      else sceneEl.appendChild(svg);
    }
    if (!groundShadowVisible) {
      svg.style.display = "block";
      groundShadowVisible = true;
    }
    return { svg, path };
  }
  function clearAllSceneShadows(): void {
    disposeGroundShadow();
    // Mark all cached receiver-face SVGs as hidden. Per-frame
    // emitSceneReceiverShadows will reveal the ones with shadow
    // content and leave the rest in `display:none`, which keeps the
    // compositor layer count low without tearing the elements down.
    hideAllReceiverFaceSvgs();
  }

  // Per-receiver cached face geometry. Each entry holds one record
  // per coplanar face group on the receiver: plane (O, n, u, v),
  // outline polygon (used as Sutherland-Hodgman clip), bbox in (u, v)
  // for SVG sizing, and the pre-stringified matrix3d transform that
  // places an SVG on that face plane.
  //
  // All of this is invariant under light/caster changes. Per light
  // tick we just re-run the per-tri SH and build the path `d` —
  // never recompute groups or basis. Cache invalidated when the
  // receiver's polygon count or position changes.
  interface ReceiverFacePlane {
    O: Vec3;
    n: Vec3;
    u: Vec3;
    v: Vec3;
    outlineUv: Array<[number, number]>;
    minU: number;
    minV: number;
    width: number;
    height: number;
    matrixCss: string;
    // Mount-once SVG + path: created on first non-empty frame for
    // this face, then kept in the DOM. Per-frame we just mutate
    // `d`/`fill`/`opacity` and toggle `display`. Avoids per-frame
    // ~248 createElementNS + insertBefore + 248 layer churn that
    // dominated gpuViz (~40 ms/frame).
    svg: SVGSVGElement | null;
    path: SVGPathElement | null;
    visible: boolean;
  }
  const receiverShadowCache = new Map<MeshEntry, ReceiverFacePlane[]>();
  const receiverShadowCacheKey = new Map<MeshEntry, string>();
  function disposeReceiverPlanes(planes: ReceiverFacePlane[]): void {
    for (const p of planes) {
      if (p.svg && p.svg.parentNode) p.svg.parentNode.removeChild(p.svg);
      p.svg = null;
      p.path = null;
    }
  }
  function clearReceiverShadowCache(entry?: MeshEntry): void {
    if (entry) {
      const planes = receiverShadowCache.get(entry);
      if (planes) disposeReceiverPlanes(planes);
      receiverShadowCache.delete(entry);
      receiverShadowCacheKey.delete(entry);
    } else {
      for (const planes of receiverShadowCache.values()) disposeReceiverPlanes(planes);
      receiverShadowCache.clear();
      receiverShadowCacheKey.clear();
    }
  }
  function hideAllReceiverFaceSvgs(): void {
    for (const planes of receiverShadowCache.values()) {
      for (const p of planes) {
        if (p.svg && p.visible) {
          p.svg.style.display = "none";
          p.visible = false;
        }
      }
    }
  }

  // Per-caster cached per-polygon data: world-space vertices + 3D
  // AABB corners. Invariant under light direction; depends only on
  // the caster mesh's geometry and position. Reused across every
  // receiver-face SH-clip in a frame and across frames within a
  // drag, so the caching pays for itself many times over.
  interface CasterPolyItem {
    wv: Vec3[];
    bboxCorners: Vec3[];
  }
  const casterItemsCache = new Map<MeshEntry, CasterPolyItem[]>();
  const casterItemsCacheKey = new Map<MeshEntry, string>();
  function clearCasterItemsCache(entry?: MeshEntry): void {
    if (entry) {
      casterItemsCache.delete(entry);
      casterItemsCacheKey.delete(entry);
    } else {
      casterItemsCache.clear();
      casterItemsCacheKey.clear();
    }
  }

  // Apply CSS perspective on the camera wrapper, not the scene element.
  // CSS `perspective` only foreshortens direct children's 3D transforms, so
  // the wrapper must be the perspective context for .polycss-scene to work
  // correctly — matching React/Vue's PolyPerspectiveCamera wrapper shape.
  function applyCameraStyle(el: HTMLElement, _opts: Omit<PolySceneOptions, "camera">): void {
    // The orthographic camera returns "none" — but true `perspective: none`
    // triggers a Chrome compositor fast path that mis-rasterizes <u>
    // border-triangle leaves. A very large finite value is visually
    // orthographic but routes Chrome through the normal compositor path.
    const perspStyle = camera.perspectiveStyle;
    if (perspStyle === "none") {
      el.style.perspective = "1000000px";
    } else {
      // perspStyle is e.g. "32000px" — strip "px", normalize, re-apply.
      const px = parseFloat(perspStyle);
      if (Number.isFinite(px)) {
        el.style.perspective = `${px}px`;
      }
    }
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
  function clearLightingVars(el: HTMLElement): void {
    for (const v of LIGHTING_VAR_NAMES) {
      if (el.style.getPropertyValue(v)) el.style.removeProperty(v);
    }
  }

  function setStylePropertyIfChanged(el: HTMLElement, name: string, value: string): boolean {
    if (el.style.getPropertyValue(name) === value) return false;
    el.style.setProperty(name, value);
    return true;
  }

  function applyLightingVars(el: HTMLElement, opts: Omit<PolySceneOptions, "camera">): void {
    const dir = opts.directionalLight?.direction ?? [0.4, -0.7, 0.59];
    const len = Math.hypot(dir[0], dir[1], dir[2]) || 1;
    const lx = dir[0] / len, ly = dir[1] / len, lz = dir[2] / len;
    const lightRgb = parseHexColor(opts.directionalLight?.color ?? "#ffffff")?.rgb ?? [255, 255, 255];
    const ambRgb = parseHexColor(opts.ambientLight?.color ?? "#ffffff")?.rgb ?? [255, 255, 255];
    const lightIntensity = opts.directionalLight?.intensity ?? 1;
    const ambientIntensity = opts.ambientLight?.intensity ?? 0.4;
    const ch = (n: number) => (n / 255).toFixed(4);
    setStylePropertyIfChanged(el, "--plx", lx.toFixed(4));
    setStylePropertyIfChanged(el, "--ply", ly.toFixed(4));
    setStylePropertyIfChanged(el, "--plz", lz.toFixed(4));
    setStylePropertyIfChanged(el, "--plr", ch(lightRgb[0]));
    setStylePropertyIfChanged(el, "--plg", ch(lightRgb[1]));
    setStylePropertyIfChanged(el, "--plb", ch(lightRgb[2]));
    setStylePropertyIfChanged(el, "--pli", lightIntensity.toFixed(4));
    setStylePropertyIfChanged(el, "--par", ch(ambRgb[0]));
    setStylePropertyIfChanged(el, "--pag", ch(ambRgb[1]));
    setStylePropertyIfChanged(el, "--pab", ch(ambRgb[2]));
    setStylePropertyIfChanged(el, "--pai", ambientIntensity.toFixed(4));
    // Light direction vars for the shadow projection. These match the
    // axis convention used by Lambert (`--plx/--ply/--plz`) where the
    // X and Y component naming follows the user-facing light direction
    // vector directly (NO world→CSS axis swap). The shadow projection
    // matrix in styles.ts is written against this same convention.
    // Clamp clz away from zero — shadow projection divides by clz (the
    // up-axis component), so a near-horizontal light would project
    // shadows to infinity.
    const rawClz = lz;
    const clz = Math.sign(rawClz || 1) * Math.max(Math.abs(rawClz), 0.01);
    setStylePropertyIfChanged(el, "--clx", lx.toFixed(4));
    setStylePropertyIfChanged(el, "--cly", ly.toFixed(4));
    setStylePropertyIfChanged(el, "--clz", clz.toFixed(4));
  }

  function applyDynamicLightVars(el: HTMLElement, opts: Omit<PolySceneOptions, "camera">): void {
    const dynamic = opts.textureLighting === "dynamic";
    el.dataset.polycssLighting = opts.textureLighting ?? "baked";
    if (!dynamic) {
      clearLightingVars(el);
      return;
    }
    applyLightingVars(el, opts);
  }

  function clearRendered(entry: MeshEntry): void {
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
    // Per-entry `<q>` leaves (dynamic-mode chain + legacy callers) still
    // hang off the mesh and must be cleared individually.
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

  function setRendered(entry: MeshEntry, rendered: RenderedPoly[], disposeAtlas?: () => void): void {
    entry.rendered = rendered;
    entry.renderedByPolygonIndex = [];
    for (const item of rendered) {
      entry.renderedByPolygonIndex[item.polygonIndex] = item;
    }
    entry.disposeAtlas = disposeAtlas;
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

    const localDir = inverseRotateVec3(dir as Vec3, rotation as Vec3);
    const len = Math.hypot(localDir[0], localDir[1], localDir[2]) || 1;
    const plx = (localDir[0] / len).toFixed(4);
    const ply = (localDir[1] / len).toFixed(4);
    const plz = (localDir[2] / len).toFixed(4);
    const signature = `${plx}|${ply}|${plz}`;
    if (entry.lightOverrideSignature === signature) return;
    entry.wrapper.style.setProperty("--plx", plx);
    entry.wrapper.style.setProperty("--ply", ply);
    entry.wrapper.style.setProperty("--plz", plz);
    entry.lightOverrideSignature = signature;
  }

  function applySolidPaintVars(wrapper: HTMLDivElement, defaults: SolidPaintDefaults): void {
    if (defaults.paintColor) {
      wrapper.style.setProperty("--polycss-paint", defaults.paintColor);
    } else if (wrapper.style.getPropertyValue("--polycss-paint")) {
      wrapper.style.removeProperty("--polycss-paint");
    }

    if (defaults.dynamicColor) {
      wrapper.style.setProperty("--psr", (defaults.dynamicColor.r / 255).toFixed(4));
      wrapper.style.setProperty("--psg", (defaults.dynamicColor.g / 255).toFixed(4));
      wrapper.style.setProperty("--psb", (defaults.dynamicColor.b / 255).toFixed(4));
    } else if (
      wrapper.style.getPropertyValue("--psr") ||
      wrapper.style.getPropertyValue("--psg") ||
      wrapper.style.getPropertyValue("--psb")
    ) {
      wrapper.style.removeProperty("--psr");
      wrapper.style.removeProperty("--psg");
      wrapper.style.removeProperty("--psb");
    }
  }

  function applyDynamicColorVars(el: HTMLElement, color: string | undefined): void {
    const rgb = parseHex(color ?? "#cccccc");
    el.style.setProperty("--psr", (rgb.r / 255).toFixed(4));
    el.style.setProperty("--psg", (rgb.g / 255).toFixed(4));
    el.style.setProperty("--psb", (rgb.b / 255).toFixed(4));
  }

  function applyBakedSolidColor(item: RenderedPoly, polygon: Polygon): boolean {
    if (!item.plan || item.kind === "atlas" || item.plan.texture) return false;
    const textureLighting: PolyTextureLightingMode = currentOptions.textureLighting ?? "baked";
    const renderOptions = {
      directionalLight: currentOptions.directionalLight,
      ambientLight: currentOptions.ambientLight,
      textureLighting,
      textureQuality: currentOptions.textureQuality,
      seamBleed: currentOptions.seamBleed,
      strategies: currentOptions.strategies,
    };
    const shaded = shadedSolidPlanForNormal(
      item.plan,
      polygon,
      item.plan.normal,
      textureLighting,
      renderOptions,
    );
    applySolidPaint(item.element, shaded, textureLighting);
    if (textureLighting === "baked") clearBakedSolidPreviewPaintVars(item.element);
    return true;
  }

  function bakedSolidPreviewPaintColor(bakedColor: string): string {
    const parsed = parsePureColor(bakedColor) ?? { rgb: [255, 255, 255] as [number, number, number], alpha: 1 };
    const [r, g, b] = parsed.rgb;
    const mix = (baked: number, previewVar: string) =>
      `calc(${baked} * (1 - ${BAKED_SOLID_PREVIEW_ACTIVE}) + var(${previewVar}, ${baked}) * ${BAKED_SOLID_PREVIEW_ACTIVE})`;
    const alpha = parsed.alpha < 1 ? ` / ${parsed.alpha}` : "";
    return `rgb(${mix(r, "--polycss-preview-r")} ${mix(g, "--polycss-preview-g")} ${mix(b, "--polycss-preview-b")}${alpha})`;
  }

  function applyBakedSolidPreviewPaint(item: RenderedPoly, polygon: Polygon, bakedColor: string): boolean {
    if (!item.plan || item.kind === "atlas" || item.plan.texture) return false;
    const el = item.element;
    const normal = item.plan.normal;
    const rgb = parseHex(polygon.color ?? "#cccccc");
    let changed = false;
    changed = setStylePropertyIfChanged(el, "--pnx", normal[0].toFixed(4)) || changed;
    changed = setStylePropertyIfChanged(el, "--pny", normal[1].toFixed(4)) || changed;
    changed = setStylePropertyIfChanged(el, "--pnz", normal[2].toFixed(4)) || changed;
    changed = setStylePropertyIfChanged(el, "--psr", (rgb.r / 255).toFixed(4)) || changed;
    changed = setStylePropertyIfChanged(el, "--psg", (rgb.g / 255).toFixed(4)) || changed;
    changed = setStylePropertyIfChanged(el, "--psb", (rgb.b / 255).toFixed(4)) || changed;
    changed = setStylePropertyIfChanged(el, "--plam", BAKED_SOLID_PREVIEW_LAMBERT) || changed;
    changed = setStylePropertyIfChanged(el, "--polycss-preview-r", BAKED_SOLID_PREVIEW_R) || changed;
    changed = setStylePropertyIfChanged(el, "--polycss-preview-g", BAKED_SOLID_PREVIEW_G) || changed;
    changed = setStylePropertyIfChanged(el, "--polycss-preview-b", BAKED_SOLID_PREVIEW_B) || changed;
    changed = setStylePropertyIfChanged(el, "--polycss-paint", bakedSolidPreviewPaintColor(bakedColor)) || changed;
    if (el.style.getPropertyValue("color")) {
      el.style.removeProperty("color");
      changed = true;
    }
    return changed;
  }

  function clearBakedSolidPreviewPaintVars(el: HTMLElement): void {
    el.style.removeProperty("--pnx");
    el.style.removeProperty("--pny");
    el.style.removeProperty("--pnz");
    el.style.removeProperty("--psr");
    el.style.removeProperty("--psg");
    el.style.removeProperty("--psb");
    el.style.removeProperty("--plam");
    el.style.removeProperty("--polycss-preview-r");
    el.style.removeProperty("--polycss-preview-g");
    el.style.removeProperty("--polycss-preview-b");
    el.style.removeProperty("--polycss-paint");
  }

  function restoreBakedSolidPaint(entry: MeshEntry): boolean {
    let changed = false;
    for (const item of entry.rendered) {
      if (!item.plan || item.kind === "atlas" || item.plan.texture) continue;
      const polygon = entry.polygons[item.polygonIndex];
      if (!polygon) continue;
      changed = applyBakedSolidColor(item, polygon) || changed;
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
      if (entry.rendered.some(needsBakedAtlasCommit)) {
        renderEntry(entry);
        updated = true;
        continue;
      }
      updated = restoreBakedSolidPaint(entry) || updated;
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
      return applyBakedSolidColor(item, polygon);
    }
    return false;
  }

  function tryUpdatePolygonDataOnly(entry: MeshEntry, polygonIndex: number): boolean {
    const polygon = entry.polygons[polygonIndex];
    if (!polygon) return false;
    const item = renderedItemForPolygon(entry, polygonIndex);
    if (!item) return false;
    applyPolygonDataAttrs(item.element, polygon);
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

  // Emits the per-mesh shadow `<svg>`. Same path for both lighting modes:
  // every casting polygon is projected to the ground on the CPU and
  // concatenated into a single compound `<path>` (M…L…Z subpaths) under
  // fill-rule=nonzero. Overlapping outlines composite as one filled
  // silhouette without alpha stacking; gaps between subpaths remain as
  // gaps (silhouette holes are preserved); back-facing polys are dropped
  // up front. One SVG element per mesh regardless of polygon count.
  //
  // Trade-off vs. the old dynamic-mode per-`<q>` CSS path: live light
  // updates now require a JS re-projection pass (`setOptions` triggers
  // re-emit when directionalLight.direction changes) instead of being
  // free CSS variable updates. The visual upside (no alpha stacking,
  // preserved holes, fewer DOM nodes) is worth the JS cost for typical
  // scenes — huge meshes during light-slider drag can profile if needed.
  // Per-entry trigger: callers pass the entry that changed, but emission
  // is scene-wide. Drop the arg here so any change rebuilds the whole
  // shadow set in one shot — every surface aggregates every caster.
  function emitShadowLeaves(_entry: MeshEntry): void {
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
      return;
    }
    hideAllReceiverFaceSvgs();

    const shadowColor = currentOptions.shadow?.color ?? "#000000";
    const shadowOpacity = currentOptions.shadow?.opacity ?? 0.25;
    const parsed = parseHexColor(shadowColor)?.rgb ?? [0, 0, 0];
    const r = parsed[0], g = parsed[1], b = parsed[2];
    const lightDir = lightDirectionOverride
      ?? currentOptions.directionalLight?.direction
      ?? ([0.4, -0.7, 0.59] as Vec3);

    // Per-caster shadow dedup (independent meshes can't dedup against
    // each other). Computed once per caster, reused across surfaces.
    // Loose tolerances catch back-to-back doubled faces and minor
    // importer artifacts without false-positively dropping legitimate
    // inner/outer wall pairs that cast genuinely distinct shadows.
    const dedupByCaster = new Map<MeshEntry, Set<number>>();
    for (const c of casters) {
      dedupByCaster.set(c, findOverlappingPolygonDuplicates(c.polygons, {
        normalTolerance: 0.1,
        distanceTolerance: 0.5,
        overlapFraction: 0.4,
        // Authored double-sided backfaces would project coincident
        // shadows that stack their alpha against the front face — drop
        // them at the dedup step instead of in the SVG fill rule.
        preserveDoubleSidedBackfaces: false,
      }));
    }

    if (currentGroundCssZ !== null) {
      const emittedGround = emitSceneGroundShadow(casters, dedupByCaster, lightDir, currentGroundCssZ, r, g, b, shadowOpacity);
      if (!emittedGround) hideGroundShadow();
    }
    for (const receiver of meshes) {
      if (receiver.disposed || !receiver.receiveShadow) continue;
      emitSceneReceiverShadows(casters, dedupByCaster, receiver, lightDir, r, g, b, shadowOpacity);
    }
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
  function emitSceneGroundShadow(
    casters: MeshEntry[],
    dedupByCaster: Map<MeshEntry, Set<number>>,
    lightDir: Vec3,
    groundCssZ: number,
    r: number, g: number, b: number,
    opacity: number,
  ): boolean {
    const polyProjections: Array<Array<[number, number]>> = [];
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    let fpMinX = Infinity, fpMinY = Infinity, fpMaxX = -Infinity, fpMaxY = -Infinity;
    for (const caster of casters) {
      const cpos = caster.handle.transform.position ?? [0, 0, 0];
      const dedupDrop = dedupByCaster.get(caster)!;
      for (const item of caster.rendered) {
        if (dedupDrop.has(item.polygonIndex)) continue;
        const plan = item.plan;
        if (!plan) continue;
        const polygon = caster.polygons[item.polygonIndex];
        if (!polygon) continue;

        const projected: Array<[number, number]> = [];
        for (const v of polygon.vertices) {
          // World vertex (mesh-local, world units) → CSS via the same
          // axis swap (world.x → CSS-Y, world.y → CSS-X) and tile scale
          // (× DEFAULT_TILE) that the atlas builder applies per leaf.
          // Then add transform.position as raw CSS px — that's how the
          // mesh WRAPPER applies it (translate3d(pos[0]px, pos[1]px,
          // pos[2]px), no axis swap, no tile multiplier).
          const cssVertex: Vec3 = [
            v[1] * DEFAULT_TILE + cpos[0],
            v[0] * DEFAULT_TILE + cpos[1],
            v[2] * DEFAULT_TILE + cpos[2],
          ];
          if (cssVertex[0] < fpMinX) fpMinX = cssVertex[0];
          if (cssVertex[1] < fpMinY) fpMinY = cssVertex[1];
          if (cssVertex[0] > fpMaxX) fpMaxX = cssVertex[0];
          if (cssVertex[1] > fpMaxY) fpMaxY = cssVertex[1];
          const p = projectCssVertexToGround(cssVertex, lightDir, groundCssZ);
          projected.push(p);
          if (p[0] < minX) minX = p[0];
          if (p[1] < minY) minY = p[1];
          if (p[0] > maxX) maxX = p[0];
          if (p[1] > maxY) maxY = p[1];
        }
        // Per-polygon convex hull on the projected 2D points. N-gons
        // from glTF imports aren't always perfectly planar in 3D, and
        // projecting a non-planar N-gon yields a SELF-INTERSECTING 2D
        // polygon. The signed-area-based winding check
        // (`ensureCcw2D`) returns the NET signed area, which can
        // disagree with the actual visual winding for self-intersecting
        // shapes — leading to one rogue subpath rendered with
        // opposite winding under fill-rule=nonzero, which then
        // SUBTRACTS from neighboring CCW shadows (visible as wedge-
        // shaped holes in the final shadow). Hull-per-polygon
        // guarantees each subpath is a simple convex polygon →
        // winding is always reliable. Triangles are unchanged
        // (already simple); only N-gons get hulled.
        const simplified = projected.length > 3 ? convexHull2D(projected) : projected;
        if (simplified.length >= 3) polyProjections.push(simplified);
      }
    }

    if (polyProjections.length === 0) return false;
    const maxExtend = currentOptions.shadow?.maxExtend ?? 2000;
    const bx0 = Math.max(minX, fpMinX - maxExtend);
    const by0 = Math.max(minY, fpMinY - maxExtend);
    const bx1 = Math.min(maxX, fpMaxX + maxExtend);
    const by1 = Math.min(maxY, fpMaxY + maxExtend);
    const width = bx1 - bx0;
    const height = by1 - by0;
    if (!(width > 0) || !(height > 0)) return false;

    const clipBounds: Array<[number, number]> = [
      [bx0, by0],
      [bx1, by0],
      [bx1, by1],
      [bx0, by1],
    ];
    let d = "";
    for (const verts of polyProjections) {
      const clipped = clipPolygonToConvex2D(ensureCcw2D(verts), clipBounds);
      if (clipped.length < 3) continue;
      const ccw = ensureCcw2D(clipped);
      d += `M${(ccw[0]![0] - bx0).toFixed(3)},${(ccw[0]![1] - by0).toFixed(3)}`;
      for (let i = 1; i < ccw.length; i++) {
        d += `L${(ccw[i]![0] - bx0).toFixed(3)},${(ccw[i]![1] - by0).toFixed(3)}`;
      }
      d += "Z";
    }
    if (!d) return false;
    // (No receiver-footprint subtraction.) The earlier "cut every
    // receiver's hull as a CW hole" approach broke fill-rule=nonzero
    // wherever a receiver overlapped the caster's silhouette: a CCW
    // caster (+1) plus a CW receiver (-1) cancels at every single-
    // coverage edge, leaving only doubled-coverage interior and
    // producing visible wedge holes / halos along every shadow edge.
    //
    // Physically the cut was trying to express "this receiver blocks
    // light from reaching the ground under it." But for casters that
    // already include the receiver's body in their own silhouette
    // (apple on ground), the cut redundantly cancels the very shadow
    // we want. For casters above an elevated receiver (pole on cube),
    // the right fix is volumetric occlusion, not 2D subtraction.
    // Deferred until we hit a scene where shadow-through-elevated-
    // receiver is actually distracting.

    const { svg, path } = ensureGroundShadow();
    const widthStr = String(width);
    const heightStr = String(height);
    const viewBox = `0 0 ${width} ${height}`;
    if (svg.getAttribute("width") !== widthStr) svg.setAttribute("width", widthStr);
    if (svg.getAttribute("height") !== heightStr) svg.setAttribute("height", heightStr);
    if (svg.getAttribute("viewBox") !== viewBox) svg.setAttribute("viewBox", viewBox);
    const transform = `translate3d(${bx0.toFixed(3)}px,${by0.toFixed(3)}px,${groundCssZ.toFixed(3)}px)`;
    if (svg.style.transform !== transform) svg.style.transform = transform;
    path.setAttribute("d", d);
    const fillColor = `rgb(${r},${g},${b})`;
    if (path.getAttribute("fill") !== fillColor) path.setAttribute("fill", fillColor);
    if (path.getAttribute("stroke") !== fillColor) path.setAttribute("stroke", fillColor);
    const opStr = opacity.toFixed(4);
    if (path.getAttribute("opacity") !== opStr) path.setAttribute("opacity", opStr);
    return true;
  }

  type ReceiverPlaneGroup = {
    O: Vec3;       // CSS-3D origin (representative face vertex 0)
    n: Vec3;       // unit normal
    u: Vec3;       // in-plane u basis
    v: Vec3;       // in-plane v basis (= n × u)
    outlineUv: Array<[number, number]>;  // CCW convex hull of group's (u,v) coords
  };

  // Groups a receiver's polygons by shared plane (matching normal +
  // plane offset within tolerance), then computes a 2D convex-hull
  // outline per group in the group's own (u, v) coords. Each returned
  // group becomes one shadow-receiving surface.
  //
  // Why convex hull instead of a proper polygon union: Sutherland-
  // Hodgman (used downstream for caster clipping) only handles convex
  // clip polygons, and the hull is cheap and stable. For typical
  // receivers (cubes, planes, simple platforms) the hull is the exact
  // outline. For L-shaped coplanar regions it over-extends — shadows
  // would extend past the receiver in the L's concave corner — but
  // those are rare in practice.
  //
  // Tolerance choices: dot-product > 0.999 (~2.5° angular) catches
  // tessellation artifacts on flat surfaces without merging adjacent
  // faces of a low-poly curved mesh. Plane-offset tolerance is 0.5
  // CSS px — sub-pixel coplanarity drift in glTF imports doesn't
  // separate what should be a single surface.
  function groupReceiverFaceGroups(
    receiver: MeshEntry,
    rpos: Vec3,
    worldCss: (vert: Vec3, pos: Vec3) => Vec3,
  ): ReceiverPlaneGroup[] {
    type FacePlane = {
      face: Polygon;
      O: Vec3; n: Vec3; u: Vec3; v: Vec3;
      offset: number;  // plane offset = n · O, used as the hashing dim
    };
    const facePlanes: FacePlane[] = [];
    for (const face of receiver.polygons) {
      if (face.vertices.length < 3) continue;
      const O = worldCss(face.vertices[0]!, rpos);
      const w1 = worldCss(face.vertices[1]!, rpos);
      const w2 = worldCss(face.vertices[2]!, rpos);
      const e1: Vec3 = [w1[0] - O[0], w1[1] - O[1], w1[2] - O[2]];
      const e2: Vec3 = [w2[0] - O[0], w2[1] - O[1], w2[2] - O[2]];
      // Normal = e2 × e1 (NOT e1 × e2). PolyCSS uses an axis swap
      // (world Y → CSS X) when emitting leaves, which flips
      // handedness. The atlas builder's outward face normal in CSS
      // coords is the LEFT-hand cross product (= -right-hand). For
      // shadow projection we need the same outward direction so the
      // back-face cull aligns with what the renderer treats as the
      // lit side. e1 × e2 would point inward → shadow would land on
      // the side of the apple facing AWAY from the light (visible as
      // "shadow on back/bottom of apple" instead of the lit side).
      const nx = e2[1] * e1[2] - e2[2] * e1[1];
      const ny = e2[2] * e1[0] - e2[0] * e1[2];
      const nz = e2[0] * e1[1] - e2[1] * e1[0];
      const nLen = Math.hypot(nx, ny, nz);
      if (nLen < 1e-9) continue;
      const n: Vec3 = [nx / nLen, ny / nLen, nz / nLen];
      const e1Len = Math.hypot(e1[0], e1[1], e1[2]);
      if (e1Len < 1e-9) continue;
      const u: Vec3 = [e1[0] / e1Len, e1[1] / e1Len, e1[2] / e1Len];
      const v: Vec3 = [
        n[1] * u[2] - n[2] * u[1],
        n[2] * u[0] - n[0] * u[2],
        n[0] * u[1] - n[1] * u[0],
      ];
      const offset = n[0] * O[0] + n[1] * O[1] + n[2] * O[2];
      facePlanes.push({ face, O, n, u, v, offset });
    }

    const NORMAL_TOL = 0.001;  // 1 - dot < 0.001  → ~2.5°
    const OFFSET_TOL = 0.5;    // CSS px
    type Group = { rep: FacePlane; faces: FacePlane[] };
    const groups: Group[] = [];
    // First-fit O(F²) grouping. Apple-class meshes (~300 faces) are
    // fine; higher-poly receivers may need a bucketed lookup later.
    for (const fp of facePlanes) {
      let merged = false;
      for (const g of groups) {
        const r = g.rep;
        const dot = fp.n[0] * r.n[0] + fp.n[1] * r.n[1] + fp.n[2] * r.n[2];
        if (1 - dot > NORMAL_TOL) continue;
        if (Math.abs(fp.offset - r.offset) > OFFSET_TOL) continue;
        g.faces.push(fp);
        merged = true;
        break;
      }
      if (!merged) groups.push({ rep: fp, faces: [fp] });
    }

    const out: ReceiverPlaneGroup[] = [];
    for (const g of groups) {
      const { O, n, u, v } = g.rep;
      const uvs: Array<[number, number]> = [];
      for (const fp of g.faces) {
        for (const vert of fp.face.vertices) {
          const w = worldCss(vert, rpos);
          const dx = w[0] - O[0];
          const dy = w[1] - O[1];
          const dz = w[2] - O[2];
          uvs.push([
            dx * u[0] + dy * u[1] + dz * u[2],
            dx * v[0] + dy * v[1] + dz * v[2],
          ]);
        }
      }
      if (uvs.length < 3) continue;
      const hull = convexHull2D(uvs);
      if (hull.length < 3) continue;
      out.push({ O, n, u, v, outlineUv: ensureCcw2D(hull) });
    }
    return out;
  }

  // Scene-level per-receiver-surface shadow. For each coplanar face
  // group on the receiver, project EVERY caster's polygons onto that
  // group's plane, clip each projection to the group's outline
  // (Sutherland-Hodgman), and emit ONE SVG per group whose path is the
  // union of every clipped caster shadow. The SVG sits on the scene
  // root with a matrix3d that orients its 2D content to the group
  // plane in 3D.
  //
  // Aggregating all casters into one SVG per surface is the whole point
  // of the scene-level refactor: overlapping shadows from different
  // casters share one alpha pass instead of stacking under
  // multiply/screen.
  //
  // NOTE: assumes casters and receivers have identity rotation/scale
  // (positions are baked). Rotation/scale support requires extending
  // worldCss to apply the wrapper's full transform; deferred.
  function emitSceneReceiverShadows(
    casters: MeshEntry[],
    dedupByCaster: Map<MeshEntry, Set<number>>,
    receiverEntry: MeshEntry,
    lightDir: Vec3,
    r: number, g: number, b: number,
    opacity: number,
  ): void {
    const llen = Math.hypot(lightDir[0], lightDir[1], lightDir[2]) || 1;
    const Lx = lightDir[0] / llen;
    const Ly = lightDir[1] / llen;
    const Lz = lightDir[2] / llen;
    const svgNS = "http://www.w3.org/2000/svg";
    const rpos = receiverEntry.handle.transform.position ?? [0, 0, 0];
    // Mesh-local vertex (world units) → CSS via the same axis swap
    // (world.x → CSS-Y, world.y → CSS-X) and tile scale that the atlas
    // builder applies. transform.position is then added as raw CSS px
    // — that's how the mesh wrapper's translate3d treats it. Mixing
    // tile-scaled position into the same expression would shift the
    // shadow at a different rate than the visible mesh.
    const worldCss = (vert: Vec3, pos: Vec3): Vec3 => [
      vert[1] * DEFAULT_TILE + pos[0],
      vert[0] * DEFAULT_TILE + pos[1],
      vert[2] * DEFAULT_TILE + pos[2],
    ];

    // Group receiver polygons by shared plane (matching normal AND offset
    // within tolerance). Each group becomes ONE shadow surface: instead
    // of N tiny SVGs along a tessellated quad we emit a single SVG whose
    // outline is the convex hull of the group's coplanar faces. Cubes
    // stay at 6 surfaces (each face is its own group); a flat plane
    // subdivided into N triangles collapses to 1 surface; an apple
    // shrinks from O(triangles) to O(distinct normals * planes).
    // Per-receiver face cache: plane data invariant under light. We
    // recompute groups (which is O(F²) and allocates lots of vectors)
    // only when receiver polygons or position change. SVGs are created
    // lazily the first time a face has shadow content, then hidden when
    // later light positions do not project onto that face.
    const cacheKey = `${receiverEntry.polygons.length}|${rpos.join(",")}`;
    let cachedPlanes = receiverShadowCache.get(receiverEntry);
    if (cachedPlanes === undefined || receiverShadowCacheKey.get(receiverEntry) !== cacheKey) {
      const surfaces = groupReceiverFaceGroups(receiverEntry, rpos, worldCss);
      cachedPlanes = surfaces.map((group): ReceiverFacePlane => {
        const { O, n, u, v, outlineUv } = group;
        let minU = Infinity, minV = Infinity, maxU = -Infinity, maxV = -Infinity;
        for (const pt of outlineUv) {
          if (pt[0] < minU) minU = pt[0];
          if (pt[1] < minV) minV = pt[1];
          if (pt[0] > maxU) maxU = pt[0];
          if (pt[1] > maxV) maxV = pt[1];
        }
        const width = maxU - minU;
        const height = maxV - minV;
        const lift = 5;
        const Ox = O[0] + minU * u[0] + minV * v[0] + lift * n[0];
        const Oy = O[1] + minU * u[1] + minV * v[1] + lift * n[1];
        const Oz = O[2] + minU * u[2] + minV * v[2] + lift * n[2];
        const m = [
          u[0], u[1], u[2], 0,
          v[0], v[1], v[2], 0,
          n[0], n[1], n[2], 0,
          Ox,   Oy,   Oz,   1,
        ];
        const matrixCss = `matrix3d(${m.map((x) => x.toFixed(4)).join(",")})`;
        return {
          O, n, u, v, outlineUv, minU, minV, width, height, matrixCss,
          svg: null, path: null, visible: false,
        };
      });
      receiverShadowCache.set(receiverEntry, cachedPlanes);
      receiverShadowCacheKey.set(receiverEntry, cacheKey);
    }

    // Per-caster cached items: world-vertices + 3D AABB per polygon.
    // Geometry is invariant under light direction, so once cached
    // every receiver-face SH-clip across every drag tick reads from
    // the cache. Invalidated when a caster mesh changes geometry or
    // position (clearCasterItemsCache from mesh setters).
    const casterItems: CasterPolyItem[] = [];
    for (const caster of casters) {
      if (caster === receiverEntry) continue;
      const cpos = caster.handle.transform.position ?? [0, 0, 0];
      const ckey = `${caster.polygons.length}|${cpos.join(",")}`;
      let cached = casterItemsCache.get(caster);
      if (cached === undefined || casterItemsCacheKey.get(caster) !== ckey) {
        const dedupDrop = dedupByCaster.get(caster)!;
        cached = [];
        for (const item of caster.rendered) {
          if (dedupDrop.has(item.polygonIndex)) continue;
          const plan = item.plan;
          if (!plan) continue;
          const polygon = caster.polygons[item.polygonIndex];
          if (!polygon) continue;
          const wv = polygon.vertices.map((vert) => worldCss(vert, cpos));
          let minX = Infinity, minY = Infinity, minZ = Infinity;
          let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
          for (const w of wv) {
            if (w[0] < minX) minX = w[0]; if (w[0] > maxX) maxX = w[0];
            if (w[1] < minY) minY = w[1]; if (w[1] > maxY) maxY = w[1];
            if (w[2] < minZ) minZ = w[2]; if (w[2] > maxZ) maxZ = w[2];
          }
          const bboxCorners: Vec3[] = [
            [minX, minY, minZ], [maxX, minY, minZ],
            [minX, maxY, minZ], [maxX, maxY, minZ],
            [minX, minY, maxZ], [maxX, minY, maxZ],
            [minX, maxY, maxZ], [maxX, maxY, maxZ],
          ];
          cached.push({ wv, bboxCorners });
        }
        casterItemsCache.set(caster, cached);
        casterItemsCacheKey.set(caster, ckey);
      }
      for (const it of cached) casterItems.push(it);
    }

    for (const group of cachedPlanes) {
      const { O, n, u, v, outlineUv, minU, minV, width, height, matrixCss } = group;
      // Cull back-facing surfaces. A back-facing receiver face has
      // its outward normal pointing AWAY from the light — physically
      // it can't receive light at all (the receiver's own body
      // occludes it). Projecting a caster shadow onto it computes a
      // "virtual" intersection BEHIND the front of the receiver, but
      // the receiver's lit polygons would render in front of it
      // anyway. Skip them to avoid painting shadow on faces that
      // already sit in their own self-shadow.
      const Ldotn = Lx * n[0] + Ly * n[1] + Lz * n[2];
      if (Ldotn <= 1e-6) continue;

      // Per-triangle 3D-clip then project. For each caster polygon
      // (fan-triangulated), 3D-clip the tri against the receiver
      // plane half-space (keeping only the above-plane part), project
      // the surviving 3D polygon onto the face's 2D plane along the
      // light, then Sutherland-Hodgman-clip against the face outline.
      //
      // This matches a true raytracer's per-tri occlusion test
      // (verified against a Möller-Trumbore reference: 0 false
      // negatives on front-facing receiver faces; ~10% false
      // positives in edge-case projection geometry, which present
      // as faint extra shadow on faces adjacent to true shadow).
      //
      // Earlier per-vertex approaches failed because (a) projecting
      // only above-plane vertices loses the silhouette contribution
      // of tris that straddle the plane (their projected shape
      // collapses to a line), and (b) per-caster hull engulfs faces
      // in the bounding silhouette but outside the actual occluding
      // geometry.
      const planeDist = (w: Vec3): number =>
        (w[0] - O[0]) * n[0] + (w[1] - O[1]) * n[1] + (w[2] - O[2]) * n[2];
      const planeCross = (a: Vec3, b: Vec3, da: number, db: number): Vec3 => {
        const s = da / (da - db);
        return [a[0] + s * (b[0] - a[0]), a[1] + s * (b[1] - a[1]), a[2] + s * (b[2] - a[2])];
      };
      const projectOntoPlane = (w: Vec3): [number, number] => {
        const VmOx = w[0] - O[0];
        const VmOy = w[1] - O[1];
        const VmOz = w[2] - O[2];
        const t = (VmOx * n[0] + VmOy * n[1] + VmOz * n[2]) / Ldotn;
        const Px = w[0] - t * Lx;
        const Py = w[1] - t * Ly;
        const Pz = w[2] - t * Lz;
        const dx = Px - O[0];
        const dy = Py - O[1];
        const dz = Pz - O[2];
        return [dx * u[0] + dy * u[1] + dz * u[2], dx * v[0] + dy * v[1] + dz * v[2]];
      };
      const clipped: Array<Array<[number, number]>> = [];
      const fMinU = minU, fMinV = minV;
      const fMaxU = group.minU + width;
      const fMaxV = group.minV + height;
      for (const item of casterItems) {
        // Project 3D bbox corners onto the face plane; if the bbox of
        // those projections is disjoint from the face outline bbox in
        // (u, v), this polygon casts no shadow on this face. Cheap
        // 8-projection prefilter that skips the per-tri 3D-clip + SH.
        // Also confirms the polygon has at least one corner ABOVE the
        // receiver plane — if all 8 corners are below, no shadow.
        const corners = item.bboxCorners;
        let anyAbove = false;
        let pMinU = Infinity, pMinV = Infinity, pMaxU = -Infinity, pMaxV = -Infinity;
        for (let ci = 0; ci < 8; ci++) {
          const c = corners[ci]!;
          if (planeDist(c) >= 0) anyAbove = true;
          const pr = projectOntoPlane(c);
          if (pr[0] < pMinU) pMinU = pr[0];
          if (pr[0] > pMaxU) pMaxU = pr[0];
          if (pr[1] < pMinV) pMinV = pr[1];
          if (pr[1] > pMaxV) pMaxV = pr[1];
        }
        if (!anyAbove) continue;
        if (pMaxU < fMinU || pMinU > fMaxU || pMaxV < fMinV || pMinV > fMaxV) continue;
        const wv = item.wv;
        // Fan-triangulate the polygon.
        for (let triIdx = 1; triIdx < wv.length - 1; triIdx++) {
          const tA = wv[0]!, tB = wv[triIdx]!, tC = wv[triIdx + 1]!;
          const dA = planeDist(tA), dB = planeDist(tB), dC = planeDist(tC);
          const above: Vec3[] = [];
          const cycle: Array<[Vec3, number]> = [[tA, dA], [tB, dB], [tC, dC]];
          for (let k = 0; k < 3; k++) {
            const [p, dp] = cycle[k]!;
            const [q, dq] = cycle[(k + 1) % 3]!;
            if (dp >= 0) above.push(p);
            if ((dp >= 0) !== (dq >= 0)) above.push(planeCross(p, q, dp, dq));
          }
          if (above.length < 3) continue;
          const projected = above.map(projectOntoPlane);
          const subjectCcw = ensureCcw2D(projected);
          const clip = clipPolygonToConvex2D(subjectCcw, outlineUv);
          if (clip.length < 3) continue;
          clipped.push(clip);
        }
      }

      if (clipped.length === 0 || !(width > 0) || !(height > 0)) continue;

      // Coordinate precision of 1 decimal is sub-pixel for typical
      // CSS-px values; the path is sized in receiver-plane CSS px
      // (often 100-1000). Cutting from .toFixed(3) drops path string
      // size by ~30%, less browser parsing + raster fast path.
      let d = "";
      for (const verts of clipped) {
        d += `M${(verts[0]![0] - minU).toFixed(1)},${(verts[0]![1] - minV).toFixed(1)}`;
        for (let i = 1; i < verts.length; i++) {
          d += `L${(verts[i]![0] - minU).toFixed(1)},${(verts[i]![1] - minV).toFixed(1)}`;
        }
        d += "Z";
      }

      // Mount-once SVG + path. First frame this face has a shadow
      // we allocate the elements and parent them; subsequent frames
      // mutate `d`/`fill`/`opacity` and just flip `display`.
      let svg = group.svg;
      let path = group.path;
      if (!svg || !path) {
        svg = doc.createElementNS(svgNS, "svg");
        svg.setAttribute("class", "polycss-shadow polycss-shadow-svg polycss-shadow-receiver");
        svg.setAttribute("width", String(width));
        svg.setAttribute("height", String(height));
        svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
        svg.setAttribute(
          "style",
          `position:absolute;top:0;left:0;display:block;overflow:hidden;` +
          `transform-origin:0 0;pointer-events:none;will-change:transform;` +
          `transform:${matrixCss}`,
        );
        path = doc.createElementNS(svgNS, "path");
        path.setAttribute("fill-rule", "nonzero");
        svg.appendChild(path);
        sceneEl.insertBefore(svg, sceneEl.firstChild);
        group.svg = svg;
        group.path = path;
      } else if (!group.visible) {
        svg.style.display = "block";
      }
      group.visible = true;
      path.setAttribute("d", d);
      const fillColor = `rgb(${r},${g},${b})`;
      if (path.getAttribute("fill") !== fillColor) path.setAttribute("fill", fillColor);
      const opStr = opacity.toFixed(4);
      if (path.getAttribute("opacity") !== opStr) path.setAttribute("opacity", opStr);
    }
  }

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

  function canRenderVoxelDirect(entry: MeshEntry): boolean {
    return !!entry.voxelSource &&
      currentOptions.textureLighting !== "dynamic" &&
      !entry.stableDom &&
      !entry.castShadow;
  }

  function renderEntry(entry: MeshEntry, lightDirectionOverride?: Vec3): void {
    clearRendered(entry);
    const baseDirLight = currentOptions.directionalLight;
    const directionalLight: typeof baseDirLight = lightDirectionOverride
      ? { ...baseDirLight, direction: lightDirectionOverride }
      : baseDirLight;
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
        return;
      }
    }

    const renderOptions = {
      doc,
      directionalLight,
      ambientLight: currentOptions.ambientLight,
      textureLighting: currentOptions.textureLighting,
      textureQuality: currentOptions.textureQuality,
      seamBleed: currentOptions.seamBleed,
      strategies: currentOptions.strategies,
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
    setRendered(entry, atlas.rendered, atlas.dispose);
    entry.skipBucketNormalCleanupOnce =
      currentOptions.textureLighting === "dynamic" && !entry.stableDom;
    recomputeCameraCullGroups(entry);
    syncMountedRendered(entry);
    emitShadowLeaves(entry);
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
    // back to the lowest caster bottom (legacy behavior, used when no
    // receiver mesh is registered).
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
      const hadGround = currentGroundCssZ !== null;
      currentGroundCssZ = null;
      // No casters left: drop any shadow elements still mounted.
      if (hadGround) clearAllSceneShadows();
      return;
    }
    const lift = currentOptions.shadow?.lift ?? 0.05;
    // World Z → CSS Z: the ground plane in CSS-Z coordinates. Lift is added
    // (not subtracted) so the shadow plane sits slightly *above* the model
    // bbox floor — putting it on top of a receiver mesh placed at minZ
    // rather than below it, where the receiver would occlude the shadow.
    const groundCssZ = (minWorldZ + lift) * DEFAULT_TILE;
    const prevGround = currentGroundCssZ;
    currentGroundCssZ = groundCssZ;
    // Ground changed: rebuild the scene-level shadow set once.
    if (prevGround !== groundCssZ) emitSceneShadows();
  }

  async function renderEntryChunked(
    entry: MeshEntry,
    shouldCancel: () => boolean,
  ): Promise<boolean> {
    clearRendered(entry);
    const renderOptions = {
      doc,
      directionalLight: currentOptions.directionalLight,
      ambientLight: currentOptions.ambientLight,
      textureLighting: currentOptions.textureLighting,
      textureQuality: currentOptions.textureQuality,
      seamBleed: currentOptions.seamBleed,
      strategies: currentOptions.strategies,
    };
    const atlas = entry.stableDom
      ? renderPolygonsWithStableTriangles(entry.polygons, renderOptions)
      : null;
    if (atlas) {
      const solidPaintDefaults = getSolidPaintDefaults(entry.polygons, renderOptions);
      applySolidPaintVars(entry.wrapper, solidPaintDefaults);
      setRendered(entry, atlas.rendered, atlas.dispose);
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
    setRendered(entry, asyncAtlas.rendered, asyncAtlas.dispose);
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
    applySceneStyle(sceneEl, currentOptions);
  }

  function add(parseResult: ParseResult, transformIn: PolyMeshTransform = {}): PolyMeshHandle {
    const mountDoc = sceneEl.ownerDocument ?? document;
    const wrapper = mountDoc.createElement("div");
    wrapper.className = "polycss-mesh";
    if (transformIn.id) wrapper.setAttribute("data-poly-mesh-id", transformIn.id);

    let transform: PolyMeshTransform = { ...transformIn };
    let mergeOnUpdate = transformIn.merge !== false;
    let stableDomOnUpdate = !!transformIn.stableDom;
    let polygonUpdateVersion = 0;
    const css = buildMeshTransform(transform);
    if (css) wrapper.style.transform = css;

    // Static meshes use the full optimizer by default; meshResolution selects
    // the quality intent. Explicit merge:false remains the escape hatch for
    // animated topology updates and helper meshes that are already prepared.
    const preparePolygons = (polygons: Polygon[], merge: boolean): Polygon[] => {
      if (parseResult.voxelSource || !merge) return polygons;
      return optimizeMeshPolygons(polygons, { meshResolution: transformIn.meshResolution });
    };
    const sourcePolygons = preparePolygons(parseResult.polygons, mergeOnUpdate);

    // Pivot rotations around the mesh's polygon bbox center, not the
    // wrapper's local (0,0,0). The wrapper sits at `transform.position`
    // inside the scene element, but its polygons live at their world coords
    // — without an explicit transform-origin, rotateX/Y/Z would pivot
    // at the wrapper's anchor (= world origin in mesh-local), so the
    // mesh would orbit around world (0,0,0) rather than rotating in
    // place. Setting transform-origin to the polygon bbox center makes
    // setTransform({rotation}) behave intuitively.
    function applyTransformOrigin(polygons: Polygon[]): void {
      if (polygons.length === 0) {
        wrapper.style.removeProperty("--origin");
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
        wrapper.style.removeProperty("--origin");
        return;
      }
      // World→CSS axis remap (matches polygonGeometry / autoCenter).
      const cssX = ((minY + maxY) / 2) * DEFAULT_TILE;
      const cssY = ((minX + maxX) / 2) * DEFAULT_TILE;
      const cssZ = ((minZ + maxZ) / 2) * DEFAULT_TILE;
      wrapper.style.setProperty("--origin", `${cssX}px ${cssY}px ${cssZ}px`);
    }
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
      receiveShadow: !!transformIn.receiveShadow,
      cameraCullGroups: [],
      cameraCullSignature: "",
      lightOverrideSignature: "clear",
      stableTriangleColorFrame: 0,
      solidLightingPreviewPrepared: false,
      solidLightingPreviewActive: false,
      bakedRotation: (transformIn.rotation ? [...transformIn.rotation] : [0, 0, 0]) as Vec3,
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
          directionalLight: currentOptions.directionalLight,
          ambientLight: currentOptions.ambientLight,
          textureLighting: currentOptions.textureLighting,
          textureQuality: currentOptions.textureQuality,
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
            directionalLight: currentOptions.directionalLight,
            ambientLight: currentOptions.ambientLight,
            textureLighting: currentOptions.textureLighting,
            textureQuality: currentOptions.textureQuality,
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
          emitShadowLeaves(entry);
          recomputeShadowGround();
        }
        // Receiver toggled: rebuild the scene-level shadow set so this
        // mesh's faces are added (or removed) as receivers.
        if (entry.receiveShadow !== prevReceiveShadow) emitSceneShadows();
        // Position change: shadow geometry depends on world-space coords,
        // but non-shadow helpers (e.g. the light helper) must not overwrite
        // transient preview shadows with the committed light.
        if (t.position !== undefined && (entry.castShadow || entry.receiveShadow)) {
          recomputeShadowGround();
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
        renderEntry(entry, localLightDir);
      },
      getPosition() { return transform.position; },
      getRotation() { return transform.rotation; },
      getScale() { return transform.scale; },
      getPolygons() { return handle.polygons; },
    };

    entry.handle = handle;
    meshes.add(entry);
    renderEntry(entry);
    applyMeshLightVarOverride(entry, transform.rotation);
    recomputeAutoCenter();
    recomputeShadowGround();
    // New receiver: the scene-level shadow set must rebuild so existing
    // casters get faces to project onto. recomputeShadowGround only
    // does this when the global ground changes; force a rebuild for the
    // receiver-only case.
    if (entry.receiveShadow) emitSceneShadows();
    return handle;
  }

  function setOptions(partial: Partial<Omit<PolySceneOptions, "camera">>): void {
    const prevAutoCenter = !!currentOptions.autoCenter;
    const prevStrategies = currentOptions.strategies;
    const prevSeamBleed = currentOptions.seamBleed;
    const prevTextureLighting = currentOptions.textureLighting;
    const prevLightDir = currentOptions.directionalLight?.direction;
    const prevShadow = currentOptions.shadow;
    const normalizedPartial = normalizeSceneOptions(partial);
    currentOptions = { ...currentOptions, ...normalizedPartial };
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
    if (strategiesChanged || seamBleedChanged) {
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
    const nextLightDir = currentOptions.directionalLight?.direction;
    const lightDirChanged = partial.directionalLight !== undefined
      && !vec3Equal(prevLightDir, nextLightDir);
    const nextShadow = currentOptions.shadow;
    const shadowAppearanceChanged = partial.shadow !== undefined
      && !shadowOptsEqual(prevShadow, nextShadow);
    const shadowReemitNeeded = lightDirChanged || shadowAppearanceChanged;
    if (textureLightingChanged) {
      // Voxel meshes need a full re-render to swap baked/dynamic leaf
      // emission; everything else just needs the shadow set rebuilt
      // (one scene-level pass at the end covers all casters).
      for (const entry of meshes) {
        if (!strategiesChanged && !seamBleedChanged && (entry.voxelSource || entry.voxelRenderer)) {
          renderEntry(entry);
        }
      }
      recomputeShadowGround();
      emitSceneShadows();
    } else if (shadowReemitNeeded) {
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
    applySceneCameraTransform(sceneEl);
    for (const entry of meshes) syncMountedRenderedForCameraChange(entry);
  }

  function listMeshes(): readonly PolyMeshHandle[] {
    const out: PolyMeshHandle[] = [];
    for (const entry of meshes) out.push(entry.handle);
    return out;
  }

  function findMeshByElement(el: Element | null): PolyMeshHandle | null {
    let cur: Element | null = el;
    while (cur) {
      if (cur instanceof HTMLElement && cur.classList.contains("polycss-mesh")) {
        for (const entry of meshes) {
          if (entry.wrapper === cur) return entry.handle;
        }
        return null;
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
    applyCamera,
    getOptions,
    meshes: listMeshes,
    findMeshByElement,
    previewBakedSolidLighting,
    commitBakedSolidLighting,
    clearBakedSolidLightingPreview,
  };
  return handle;
}
