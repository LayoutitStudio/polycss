/**
 * Public + internal types for the scene module, extracted from
 * createPolyScene.ts so other scene/* helpers can import them without
 * pulling in the whole factory body. createPolyScene.ts re-exports the
 * public ones so the polycss package public surface is unchanged.
 */
import type {
  MeshResolution,
  ParseResult,
  PolyAmbientLight,
  PolyDirectionalLight,
  PolyPointLight,
  Polygon,
  PolyTextureBackend,
  PolyTextureImageRendering,
  PolyTextureLeafSizing,
  PolyTextureLightingMode,
  PolyTextureProjection,
  Vec3,
} from "@layoutit/polycss-core";
import type {
  PolyOrthographicCameraHandle,
  PolyPerspectiveCameraHandle,
} from "../createPolyCamera";
import type {
  PolyRenderStrategiesOption,
  PolySeamBleed,
  TextureQuality,
} from "../../render/textureAtlas";

export interface PolySceneOptions {
  /**
   * Camera handle created by `createPolyCamera`, `createPolyOrthographicCamera`,
   * or `createPolyPerspectiveCamera`. Required — `createPolyScene` will throw if
   * this field is missing.
   */
  camera: PolyPerspectiveCameraHandle | PolyOrthographicCameraHandle;
  directionalLight?: PolyDirectionalLight;
  /** Point lights (world-space positions). Direction-only per-face Lambert
   *  shading (no distance falloff). Baked-mode only. */
  pointLights?: PolyPointLight[];
  ambientLight?: PolyAmbientLight;
  /** Textured polygon lighting mode. Defaults to "baked". */
  textureLighting?: PolyTextureLightingMode;
  /** Atlas bitmap budget and CSS sprite size. `"auto"` uses a
   *  device-appropriate memory budget (~4 MB mobile / ~16 MB desktop) and
   *  desktop/mobile sprite sizing. Numeric values 0.1..1 force an explicit
   *  raster scale and the 64px sprite. */
  textureQuality?: TextureQuality;
  /** Texture leaf primitive sizing. Defaults to "canonical". */
  textureLeafSizing?: PolyTextureLeafSizing;
  /** Default image filtering for atlas and direct image texture leaves. */
  textureImageRendering?: PolyTextureImageRendering;
  /** Default texture backend request. Defaults to "auto". */
  textureBackend?: PolyTextureBackend;
  /** Default texture projection request. Defaults to "affine". */
  textureProjection?: PolyTextureProjection;
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
    /**
     * Experimental: cast a single low-resolution parametric **silhouette**
     * outline per caster instead of projecting its full geometry. Lighter DOM
     * + cheaper projection, at the cost of an approximate (convex) outline.
     * Casts onto every receiver through the normal pipeline. Default: `false`.
     */
    parametric?: boolean;
    /**
     * Parametric-shadow detail: the max number of points in the silhouette
     * outline. Lower → blobbier + lighter; higher → closer to the exact convex
     * outline. Only used when `parametric` is true. Default: `16`.
     *
     * Can be overridden per mesh via `PolyMeshTransform.shadowDefinition`.
     */
    definition?: number;
    /**
     * Progressive refinement: the definition used WHILE the directional light
     * is actively changing (a drag). When set (and `parametric` is true), each
     * light-direction change emits at `min(definition, dragDefinition)` for a
     * laggless drag, then a debounced pass re-emits at full `definition` once
     * the light settles — mirroring the atlas-rebake-at-rest escape hatch.
     * Self-shadow recompute is O(faces × bands), so dropping detail during
     * motion is the only way to keep a complex mesh smooth. Unset → no
     * progressive pass (every change renders at full `definition`).
     */
    dragDefinition?: number;
  };
  /**
   * When `true`, emit `data-poly-shadow-*` attribution attributes on every
   * shadow SVG and path (type, receiver mesh id, receiver face index,
   * member poly indices, caster ids, caster poly indices). Useful for
   * DevTools inspection and per-poly attribution in debug benches. When
   * `false` (default), these attributes are suppressed entirely — production
   * scenes ship a cleaner DOM and avoid serializing per-frame JSON.
   */
  debugShadowAttrs?: boolean;
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
  /**
   * Per-mesh parametric-shadow detail (overrides the scene's
   * `shadow.definition` for THIS mesh's cast/self shadow). Lets a detailed
   * caster stay high-resolution while a simple prop runs cheap in the same
   * scene. Only used when `shadow.parametric` is true. Unset → inherit the
   * scene definition.
   */
  shadowDefinition?: number;
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
   *  by reference — treat as read-only and use `setTransform` to mutate. */
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
  /** Resolves when this mesh's current texture generation has usable backgrounds. */
  whenTexturesReady(): Promise<void>;
  /** Current `position` from the transform (matches framework API). */
  getPosition(): Vec3 | undefined;
  /** Current `rotation` from the transform (matches framework API). */
  getRotation(): Vec3 | undefined;
  /** Current `scale` from the transform (matches framework API). */
  getScale(): number | Vec3 | undefined;
  /** Polygons currently being rendered (matches framework API). */
  getPolygons(): Polygon[];
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
   * The `.polycss-scene` root element inside `cameraEl`. Mesh wrappers, shadow
   * roots, and helper DOM are mounted under this element.
   */
  readonly sceneElement: HTMLElement;
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
  /** Resolves when every mesh currently in the scene has usable texture backgrounds. */
  whenTexturesReady(): Promise<void>;
  /** Resolve a `.polycss-mesh` element back to its handle, or `null` if
   *  the element doesn't belong to this scene. */
  findMeshByElement(element: Element | null): PolyMeshHandle | null;
}

/** Symbol-keyed extension point on `PolyMeshHandle` for the animation mixer.
 *  Lets the animation system push pre-built triangle frames into a mesh
 *  without expanding the public `PolyMeshHandle` surface. */
export const POLY_ANIMATION_TRIANGLE_FRAME_TARGET = Symbol.for(
  "polycss.animation.triangleFrameTarget",
);

export interface InternalSetPolygonsOptions {
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

export interface PolyAnimationTriangleFrame {
  polygonCount: number;
  vertices: ArrayLike<number>;
  colors?: readonly (string | undefined)[];
  solidTriangles?: boolean;
}

export interface PolyAnimationTriangleFrameTarget {
  [POLY_ANIMATION_TRIANGLE_FRAME_TARGET]?: (
    frame: PolyAnimationTriangleFrame,
    options?: InternalSetPolygonsOptions,
  ) => boolean;
}

export interface InternalPolyMeshHandle
  extends PolyMeshHandle,
    PolyAnimationTriangleFrameTarget {
  setPolygonsChunked(polygons: Polygon[], options?: {
    merge?: boolean;
    stableDom?: boolean;
    recomputeAutoCenter?: boolean;
  }): Promise<void>;
}
