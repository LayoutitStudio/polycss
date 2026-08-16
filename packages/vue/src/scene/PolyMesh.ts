/**
 * PolyMesh — load a mesh URL (or accept a polygons array) and render its
 * polygons inside a `.polycss-mesh` wrapper that carries the mesh-wide
 * position/scale/rotation transform.
 *
 * Uses nested DOM (preserve-3d) so the wrapper transform composes with each
 * atlas polygon's vertex matrix3d via CSS without JS doing the matrix math.
 *
 * Scoped slot semantics (Vue equivalent of React's render-prop child):
 *   - Named scoped slot `polygon({ polygon, index })`: called once per parsed
 *     polygon. Returned elements render INSIDE the .polycss-mesh wrapper.
 *   - Default slot: static children placed inside the wrapper.
 *   - Named slot `fallback`: rendered while loading.
 *   - Named slot `error({ error })`: rendered on parse failure.
 *
 * When no `polygon` slot is provided, each polygon is rendered automatically
 * using the cheapest supported render-strategy leaf.
 */
import { defineComponent, h, Teleport, computed, inject, onMounted, onBeforeUnmount, ref, shallowRef, watch, watchEffect } from "vue";
import type { PropType, VNode, CSSProperties } from "vue";
import type {
  MeshResolution,
  Polygon,
  PolyTextureBackend,
  PolyTextureImageRendering,
  PolyTextureLeafSizing,
  PolyTextureLightingMode,
  PolyTextureProjection,
  Vec3,
} from "@layoutit/polycss-core";
import {
  buildBasisHints,
  buildSharedEdgeMap,
  cornerShapeGeometryForPlan,
  resolvePolyTextureLeafGeometry,
  worldDirectionalLightToCss,
  POLY_DEFAULT_SHADOW_LIFT,
} from "@layoutit/polycss-core";
import {
  BASE_TILE,
  buildParametricCasterOverride,
  buildPolyMeshTransform,
  computeMergedReceiverShadows,
  computeSceneBbox,
  DEFAULT_SEAM_BLEED,
  ensureCcw2D,
  inverseRotateVec3,
  findOverlappingPolygonDuplicates,
  optimizeMeshPolygons,
  parseHexColor,
  prepareCasterEdgeOwners,
  prepareCasterPolyItems,
  prepareReceiverFacePlanes,
  projectCssVertexToGround,
  worldDirectionToCss,
  worldPositionToCss,
  type CameraCullRotation,
  type EdgeOwners,
  type ReceiverCasterInput,
} from "@layoutit/polycss-core";
import { usePolyMesh, type UseMeshOptions } from "./useMesh";
import {
  buildSeamBleedPolygonEdges,
  buildTextureEdgeRepairSets,
  computeTextureAtlasPlan,
  cssBorderShapeForPlan,
  getSolidPaintDefaults,
  isProjectiveQuadPlan,
  isSolidTrianglePlan,
  type TextureQuality,
  type PolySeamBleed,
  type SolidPaintDefaults,
  renderTextureBorderShapePoly,
  renderTextureAtlasPoly,
  renderTextureCornerShapeSolidPoly,
  renderTextureImagePoly,
  renderTextureProjectiveSolidPoly,
  renderTextureTrianglePoly,
  updateStableTriangleDom,
  useTextureAtlas,
} from "./atlas";
import { usePolySceneContext } from "./sceneContext";
import { createPolyVoxelRenderer, type PolyVoxelRenderer } from "./voxelRenderer";
import { PolyCameraContextKey } from "../camera";
import {
  findPolyMeshHandle,
  registerMeshElement,
  unregisterMeshElement,
  type InteractionProps,
  type PolyEventHandler,
  type PolyMeshHandle,
  type PolyPointerEvent,
} from "./events";

/** Per-frame caster-mesh silhouette edge owner cache. Keyed by the
 *  caster's polygons array identity + position/scale/rotation bust key.
 *  Used by the H9 silhouette path in `computeReceiverShadowFaces`. Lives
 *  at module scope so multiple receivers in one frame share the cache. */
const vueEdgeOwnersCache = new WeakMap<readonly Polygon[], ReadonlyMap<string, EdgeOwners>>();
const vueEdgeOwnersCacheKey = new WeakMap<readonly Polygon[], string>();

function solidPaintVars(defaults: SolidPaintDefaults): CSSProperties | null {
  const out: CSSProperties = {};
  if (defaults.paintColor) out["--polycss-paint"] = defaults.paintColor;
  if (defaults.dynamicColor) {
    out["--psr"] = (defaults.dynamicColor.r / 255).toFixed(4);
    out["--psg"] = (defaults.dynamicColor.g / 255).toFixed(4);
    out["--psb"] = (defaults.dynamicColor.b / 255).toFixed(4);
  }
  return Object.keys(out).length > 0 ? out : null;
}

export interface PolyMeshProps extends InteractionProps {
  /** Stable identifier — exposed on the mesh handle and reflected on
   *  the wrapper as `data-poly-mesh-id`. Used by Select / TransformControls
   *  for selection lookups. */
  id?: string;
  src?: string;
  /**
   * Companion `.mtl` URL for OBJ models. When set, materials defined in
   * the mtl are applied to the loaded mesh. Ignored for GLB/GLTF.
   */
  mtl?: string;
  polygons?: Polygon[];
  autoCenter?: boolean;
  textureLighting?: PolyTextureLightingMode;
  /** Atlas bitmap budget and CSS sprite size. `"auto"` (default) uses a
   *  device-appropriate memory budget (~4 MB mobile / ~16 MB desktop) and
   *  desktop/mobile sprite sizing. Numeric values 0.1..1 force an explicit
   *  raster scale and the 64px sprite. */
  textureQuality?: TextureQuality;
  /** Atlas leaf CSS primitive sizing. Defaults to scene context, then canonical. */
  textureLeafSizing?: PolyTextureLeafSizing;
  /** Default image filtering for atlas and direct image texture leaves. */
  textureImageRendering?: PolyTextureImageRendering;
  /** Default texture backend request. Defaults to scene context, then "auto". */
  textureBackend?: PolyTextureBackend;
  /** Default texture projection request. Defaults to scene context, then "affine". */
  textureProjection?: PolyTextureProjection;
  /** Solid seam overscan. `"auto"` computes a fitted per-edge amount from the polygon plan. */
  seamBleed?: PolySeamBleed;
  /**
   * Hold the previous frame until the next atlas is decoded, then swap
   * atomically. Best for discrete geometry edits where a partial texture
   * frame would be visible.
   */
  atomicAtlas?: boolean;
  /** Fires when the displayed atlas frame swaps to a ready one in atomic mode. */
  onFrameReady?: () => void;
  /**
   * When `true`, emits a per-mesh SVG shadow path in both lighting modes.
   * Each casting polygon projects onto the scene ground plane along the
   * directional light; overlapping outlines are merged into one silhouette.
   * Defaults to `false`.
   */
  castShadow?: boolean;
  /**
   * When `true`, this mesh acts as a shadow receiver. The scene's caster
   * meshes (those with `castShadow=true`) project per-coplanar-face SVG
   * shadows onto each visible surface, matching Three.js's `mesh.receiveShadow`
   * semantics. Disables the ground-shadow fallback when at least one
   * receiver exists. Defaults to `false`.
   */
  receiveShadow?: boolean;
  /** Apply mesh optimization (coplanar merge + interior cull) before
   *  rendering. Defaults to `true` — matches vanilla `scene.add`. Set
   *  `false` for helper meshes whose geometry shouldn't be merged. */
  merge?: boolean;
  /** Mesh optimization intent. Defaults to "lossy"; set "lossless" to keep
   *  authored surface fidelity. Top-level prop wins over any meshResolution
   *  that might be set inside parseOptions. */
  meshResolution?: MeshResolution;
  /** Parser options forwarded to parseObj/parseGltf/parseVox. */
  parseOptions?: UseMeshOptions;
  class?: string;
  position?: Vec3;
  scale?: number | Vec3;
  rotation?: Vec3;
}

function recenterPolygons(polygons: Polygon[]): Polygon[] {
  if (polygons.length === 0) return polygons;
  const bbox = computeSceneBbox(polygons);
  const cx = (bbox.min[0] + bbox.max[0]) / 2;
  const cy = (bbox.min[1] + bbox.max[1]) / 2;
  const cz = (bbox.min[2] + bbox.max[2]) / 2;
  if (cx === 0 && cy === 0 && cz === 0) return polygons;
  const shift = (v: Vec3): Vec3 => [v[0] - cx, v[1] - cy, v[2] - cz];
  return polygons.map((p) => ({
    ...p,
    vertices: p.vertices.map(shift),
    ...(p.textureTriangles?.length
      ? {
          textureTriangles: p.textureTriangles.map((triangle) => ({
            ...triangle,
            vertices: triangle.vertices.map(shift) as [Vec3, Vec3, Vec3],
          })),
        }
      : null),
  }));
}

export const PolyMesh = defineComponent({
  name: "PolyMesh",
  inheritAttrs: false,
  props: {
    id: { type: String, default: undefined },
    src: { type: String, default: undefined },
    mtl: { type: String, default: undefined },
    polygons: { type: Array as PropType<Polygon[]>, default: undefined },
    /** Optional `parseResult.voxelSource` companion for `.vox` meshes. When
     *  set alongside `polygons`, the direct voxel renderer fast path
     *  activates — mirrors vanilla's `scene.add(parseResult)` behaviour. */
    voxelSource: { type: Object as PropType<import("@layoutit/polycss-core").ParseResult["voxelSource"]>, default: undefined },
    autoCenter: { type: Boolean, default: false },
    textureLighting: { type: String as PropType<PolyTextureLightingMode>, default: undefined },
    textureQuality: { type: [Number, String] as PropType<TextureQuality>, default: undefined },
    textureLeafSizing: { type: String as PropType<PolyTextureLeafSizing>, default: undefined },
    textureImageRendering: { type: String as PropType<PolyTextureImageRendering>, default: undefined },
    textureBackend: { type: String as PropType<PolyTextureBackend>, default: undefined },
    textureProjection: { type: String as PropType<PolyTextureProjection>, default: undefined },
    seamBleed: { type: [Number, String] as PropType<PolySeamBleed>, default: undefined },
    atomicAtlas: { type: Boolean as PropType<boolean>, default: false },
    onFrameReady: { type: Function as PropType<() => void>, default: undefined },
    castShadow: { type: Boolean as PropType<boolean>, default: false },
    receiveShadow: { type: Boolean as PropType<boolean>, default: false },
    /** Per-mesh parametric-shadow detail override (scene `shadow.definition`
     *  when undefined). Only used when the scene's `shadow.parametric` is true. */
    shadowDefinition: { type: Number as PropType<number>, default: undefined },
    merge: { type: Boolean as PropType<boolean>, default: true },
    meshResolution: { type: String as PropType<MeshResolution>, default: undefined },
    parseOptions: { type: Object as PropType<UseMeshOptions>, default: undefined },
    class: { type: String },
    position: { type: Array as unknown as PropType<Vec3>, default: undefined },
    scale: { type: [Number, Array] as unknown as PropType<number | Vec3>, default: undefined },
    rotation: { type: Array as unknown as PropType<Vec3>, default: undefined },
    onClick: { type: Function as PropType<PolyEventHandler<MouseEvent>>, default: undefined },
    onContextMenu: { type: Function as PropType<PolyEventHandler<MouseEvent>>, default: undefined },
    onDoubleClick: { type: Function as PropType<PolyEventHandler<MouseEvent>>, default: undefined },
    onWheel: { type: Function as PropType<PolyEventHandler<WheelEvent>>, default: undefined },
    onPointerDown: { type: Function as PropType<PolyEventHandler<PointerEvent>>, default: undefined },
    onPointerUp: { type: Function as PropType<PolyEventHandler<PointerEvent>>, default: undefined },
    onPointerMove: { type: Function as PropType<PolyEventHandler<PointerEvent>>, default: undefined },
    onPointerOver: { type: Function as PropType<PolyEventHandler<PointerEvent>>, default: undefined },
    onPointerOut: { type: Function as PropType<PolyEventHandler<PointerEvent>>, default: undefined },
    onPointerEnter: { type: Function as PropType<PolyEventHandler<PointerEvent>>, default: undefined },
    onPointerLeave: { type: Function as PropType<PolyEventHandler<PointerEvent>>, default: undefined },
    onPointerCancel: { type: Function as PropType<PolyEventHandler<PointerEvent>>, default: undefined },
  },
  setup(props, { slots, attrs, expose }) {
    // useMesh requires a Ref<string>. Computed ref wraps the src prop.
    const srcRef = computed(() => props.src ?? "");
    // Merge parseOptions + mtl + meshResolution into the options passed to
    // usePolyMesh. Top-level meshResolution wins over parseOptions.meshResolution.
    const meshOptions = computed(() => {
      const opts: UseMeshOptions = { ...(props.parseOptions ?? {}) };
      if (props.mtl) opts.mtlUrl = props.mtl;
      if (props.meshResolution !== undefined) opts.meshResolution = props.meshResolution;
      return Object.keys(opts).length > 0 ? opts : undefined;
    });
    const fetched = usePolyMesh(srcRef, meshOptions.value);

    const propPolygons = computed<Polygon[]>(() =>
      props.src ? fetched.polygons.value : (props.polygons ?? [])
    );

    // Holds a locally-mutated copy of the polygon array after updatePolygon()
    // is called. Reset to null whenever the upstream polygon source changes so
    // a fresh prop assignment or a completed src-fetch wins over stale edits.
    const polygonOverride = ref<Polygon[] | null>(null);
    let imperativePolygons: Polygon[] | null = null;
    watch(propPolygons, () => {
      polygonOverride.value = null;
      imperativePolygons = null;
    });

    const rawSourcePolygons = computed<Polygon[]>(() =>
      polygonOverride.value ?? propPolygons.value
    );

    // Apply mesh optimization (coplanar merge + interior cull) — mirrors
    // vanilla's scene.add path which always runs optimizeMeshPolygons. Skip
    // when `merge={false}` (helpers, imperative-edit callers that need
    // stable polygon refs).
    const sourcePolygons = computed<Polygon[]>(() =>
      props.merge
        ? optimizeMeshPolygons(
            rawSourcePolygons.value,
            props.meshResolution !== undefined ? { meshResolution: props.meshResolution } : undefined,
          )
        : rawSourcePolygons.value,
    );

    const polygons = computed<Polygon[]>(() =>
      props.autoCenter ? recenterPolygons(sourcePolygons.value) : sourcePolygons.value
    );
    const atlasAutoRender = !slots.polygon;

    // Inherit textureLighting + lights from the parent <PolyScene> so that
    // helper polygons (e.g. light marker octahedron) participate in the
    // scene's dynamic mode instead of getting overpainted by the scene's
    // global CSS rule with default normals.
    const sceneCtx = usePolySceneContext();
    // Camera ctx — referenced by both event synthesis and the receiver-
    // shadow back-face cull. Declared early so the shadow computed can
    // close over it.
    const cameraCtx = inject(PolyCameraContextKey, null);
    // Bumped on every camera tick so the receiver-shadow computed re-runs
    // with up-to-date camera rotation for back-face culling.
    const cameraTick = ref(0);
    let cameraTickUnsub: (() => void) | undefined;
    watchEffect((onCleanup) => {
      cameraTickUnsub?.();
      cameraTickUnsub = cameraCtx?.store.subscribe(() => { cameraTick.value++; });
      onCleanup(() => { cameraTickUnsub?.(); cameraTickUnsub = undefined; });
    });
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
    // voxelSource comes from useMesh (when src is set) OR from the prop
    // (when polygons array is provided directly). Vanilla scene.add receives
    // the full parseResult so it always knows voxelSource; React/Vue allow
    // the polygons-only call shape, so expose voxelSource as a prop.
    const externalVoxelSource = computed(() =>
      props.src ? fetched.voxelSource.value : props.voxelSource ?? undefined,
    );
    const directVoxelEnabled = computed(() => Boolean(
      externalVoxelSource.value &&
      polygonOverride.value === null &&
      !slots.polygon &&
      !slots.default &&
      atlasTextureLighting.value === "baked" &&
      !props.castShadow,
    ));

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
    const stableTriangleColorFrame = ref(0);

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

    const textureAtlasPlans = computed(() => {
      if (!atlasAutoRender || directVoxelEnabled.value) return [];
      const repairEdges = buildTextureEdgeRepairSets(polygons.value);
      const seamBleedEdges = atlasSeamBleed.value === "auto" || (
        typeof atlasSeamBleed.value === "number" &&
        Number.isFinite(atlasSeamBleed.value) &&
        atlasSeamBleed.value > 0
      )
        ? buildSeamBleedPolygonEdges(polygons.value, {
            directionalLight: bakedDirectional.value,
            ambientLight: atlasAmbient.value,
          })
        : null;
      // Cross-polygon basis hints — vanilla's renderer always passes these,
      // and the stable-solid-triangle classification depends on them.
      // Without, ~8 polygons in a castle-class mesh fall through to atlas
      // bitmap instead of <u>, diverging from vanilla.
      const basisHints = buildBasisHints(polygons.value, {
        directionalLight: bakedDirectional.value,
        ambientLight: atlasAmbient.value,
      });
      return polygons.value.map((p, i) =>
        computeTextureAtlasPlan(
          p,
          i,
          {
            directionalLight: bakedDirectional.value,
            pointLights: bakedPointLights.value,
            ambientLight: atlasAmbient.value,
            seamBleed: seamBleedEdges?.has(i) ? atlasSeamBleed.value : undefined,
            seamEdges: seamBleedEdges?.get(i),
            textureEdgeRepairEdges: repairEdges[i],
            lightOccludedPolyIndices,
          },
          basisHints[i],
        ),
      );
    });
    const atlasTextureQuality = computed(() => props.textureQuality);
    const atomicAtlas = computed(() => props.atomicAtlas);
    const textureAtlas = useTextureAtlas(
      textureAtlasPlans,
      atlasTextureLighting,
      atlasTextureQuality,
      atlasTextureLeafSizing,
      atlasTextureBackend,
      atlasTextureImageRendering,
      atlasTextureProjection,
      atlasStrategies,
      atomicAtlas,
    );
    const textureReadyWaiters: Array<() => void> = [];
    const resolveTextureReadyWaiters = (): void => {
      const waiters = textureReadyWaiters.splice(0);
      for (const resolve of waiters) resolve();
    };
    watch(
      () => textureAtlas.ready.value,
      (ready) => { if (ready) resolveTextureReadyWaiters(); },
      { immediate: true },
    );
    onBeforeUnmount(resolveTextureReadyWaiters);
    // Use the displayed plans (which lag in atomic mode) so solid leaves swap in
    // lockstep with the textured ones.
    const solidPaintDefaults = computed<SolidPaintDefaults>(() =>
      atlasAutoRender ? getSolidPaintDefaults(textureAtlas.plans.value, atlasTextureLighting.value, atlasStrategies.value) : {},
    );
    // Fire onFrameReady when the displayed atlas frame swaps (atomic mode) — used
    // by consumers to hand off a preview transform without a one-frame overshoot.
    watch(
      () => textureAtlas.entries.value,
      () => { if (props.atomicAtlas && textureAtlas.ready.value) props.onFrameReady?.(); },
      { flush: "sync" },
    );
    const defaultPaintVars = computed(() => solidPaintVars(solidPaintDefaults.value));

    // Per-mesh SVG shadow — same path for both lighting modes. Every
    // casting polygon is projected to the ground on the CPU and
    // concatenated into one compound <path d="M…L…Z M…L…Z …"> under
    // fill-rule=nonzero so overlapping CCW outlines composite as one
    // filled silhouette without alpha stacking; gaps remain as gaps.
    const shadowSvg = computed<VNode | null>(() => {
      if (!props.castShadow) return null;
      // Three.js parity: when at least one receiver exists, casters drop
      // the ground-shadow fallback so the receiver paints the only pass.
      if (sceneCtx?.value.receiverRegistry?.hasAny.value) return null;
      const ctx = sceneCtx?.value;
      const groundCssZ = ctx?.groundCssZ ?? null;
      if (groundCssZ === null) return null;
      const shadowOpts = ctx?.shadow;

      // World→CSS axis swap so the light direction matches the CSS-frame
      // vertex projection below (vertices are × BASE_TILE with v[1]→x, v[0]→y).
      const userGroundLightDir = ctx?.directionalLight?.direction
        ?? ([0.4, -0.7, 0.59] as Vec3);
      const lightDir = worldDirectionToCss(userGroundLightDir);

      // Project shadows into the MESH WRAPPER's local frame so that the
      // SVG, which is rendered as a child of `.polycss-mesh` and inherits
      // its `translate3d(position * BASE_TILE)`, lands on the absolute
      // scene ground (cssZ = groundCssZ) — not lifted by the mesh's own
      // world position. Mirrors the React path; vanilla handles this by
      // adding `worldPositionToCss(position)` to every vertex and mounting
      // the SVG on the scene root.
      const meshPosZ = props.position?.[2] ?? 0;
      const localGroundCssZ = groundCssZ - meshPosZ * BASE_TILE;
      const dedupDrop = findOverlappingPolygonDuplicates(polygons.value, {
        normalTolerance: 0.1,
        distanceTolerance: 0.5,
        overlapFraction: 0.95,
        preserveDoubleSidedBackfaces: false,
      });

      const projections: Array<Array<[number, number]>> = [];
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      let fpMinX = Infinity, fpMinY = Infinity, fpMaxX = -Infinity, fpMaxY = -Infinity;
      const polys = polygons.value;
      const plans = textureAtlasPlans.value;
      // No Lambert cull — thin/open meshes (bat wings, cloth, single
      // quad) need both sides projected or the silhouette gets holes.
      // We also track the footprint (no-shear XY bbox) so the cap below
      // keeps the area near the mesh fully inside the SVG.
      for (let i = 0; i < polys.length; i++) {
        if (dedupDrop.has(i)) continue;
        const plan = plans[i];
        if (!plan) continue;
        const polygon = polys[i]!;
        const projected: Array<[number, number]> = [];
        for (const v of polygon.vertices) {
          const cssVertex: Vec3 = [
            v[1] * BASE_TILE,
            v[0] * BASE_TILE,
            v[2] * BASE_TILE,
          ];
          if (cssVertex[0] < fpMinX) fpMinX = cssVertex[0];
          if (cssVertex[1] < fpMinY) fpMinY = cssVertex[1];
          if (cssVertex[0] > fpMaxX) fpMaxX = cssVertex[0];
          if (cssVertex[1] > fpMaxY) fpMaxY = cssVertex[1];
          const p = projectCssVertexToGround(cssVertex, lightDir, localGroundCssZ);
          projected.push(p);
          if (p[0] < minX) minX = p[0];
          if (p[1] < minY) minY = p[1];
          if (p[0] > maxX) maxX = p[0];
          if (p[1] > maxY) maxY = p[1];
        }
        projections.push(projected);
      }
      if (projections.length === 0) return null;
      // Cap how far the shadow can extend BEYOND THE MESH FOOTPRINT.
      // Low-elevation lights shear projections across the ground so far
      // that the bbox can exceed tens of thousands of pixels each side,
      // which forces the browser to rasterize a >100M-pixel backing
      // store on every repaint. The footprint stays fully inside the
      // SVG so the shadow under/next to the mesh is preserved; only the
      // sheared end (off-screen anyway) gets clipped by overflow:hidden.
      // Callers can disable the cap by passing shadow.maxExtend=Infinity.
      const maxExtend = shadowOpts?.maxExtend ?? 2000;
      const bx0 = Math.max(minX, fpMinX - maxExtend);
      const by0 = Math.max(minY, fpMinY - maxExtend);
      const bx1 = Math.min(maxX, fpMaxX + maxExtend);
      const by1 = Math.min(maxY, fpMaxY + maxExtend);
      const width = bx1 - bx0;
      const height = by1 - by0;
      if (!(width > 0) || !(height > 0)) return null;

      const shadowColor = shadowOpts?.color ?? "#000000";
      const shadowOpacity = shadowOpts?.opacity ?? 0.25;
      const parsed = parseHexColor(shadowColor)?.rgb ?? [0, 0, 0];

      // Concatenate every projection into ONE compound `d` string. Each
      // polygon becomes its own M…L…Z subpath, normalized to CCW so all
      // windings agree and fill-rule=nonzero paints overlapping outlines
      // as one filled silhouette without alpha stacking. Gaps between
      // subpaths remain as holes — the shadow inherits the silhouette's
      // holes for free.
      let d = "";
      for (const verts of projections) {
        const ccw = ensureCcw2D(verts);
        d += `M${(ccw[0]![0] - bx0).toFixed(3)},${(ccw[0]![1] - by0).toFixed(3)}`;
        for (let j = 1; j < ccw.length; j++) {
          d += `L${(ccw[j]![0] - bx0).toFixed(3)},${(ccw[j]![1] - by0).toFixed(3)}`;
        }
        d += "Z";
      }

      return h(
        "svg",
        {
          class: "polycss-shadow polycss-shadow-svg",
          width: String(width),
          height: String(height),
          viewBox: `0 0 ${width} ${height}`,
          style: {
            position: "absolute",
            top: "0",
            left: "0",
            display: "block",
            overflow: "hidden",
            transformOrigin: "0 0",
            pointerEvents: "none",
            willChange: "transform",
            transform: `translate3d(${bx0.toFixed(3)}px,${by0.toFixed(3)}px,${localGroundCssZ.toFixed(3)}px)`,
          } as CSSProperties,
        },
        [
          h("path", {
            d,
            fill: `rgb(${parsed[0]},${parsed[1]},${parsed[2]})`,
            "fill-rule": "nonzero",
            stroke: `rgb(${parsed[0]},${parsed[1]},${parsed[2]})`,
            "stroke-width": "3",
            "stroke-linejoin": "round",
            opacity: shadowOpacity.toFixed(4),
          }),
        ],
      );
    });

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
      void cameraTick.value;
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
        // Cast from EVERY polygon — geometry casts a shadow regardless of
        // whether it's painted for the camera (atlas plan / renderedPolygon-
        // Indices). Filtering to rendered polys left camera-dependent holes
        // in the floor shadow of imported meshes. Coincident projections
        // merge under the per-mesh `fill-rule: nonzero`, so no dedup is
        // needed. Mirrors packages/polycss/src/api/scene/receiverShadow.ts.
        const items = prepareCasterPolyItems(
          data.polygons,
          data.position,
          data.scale,
          () => true,
          data.rotation ?? null,
        );
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
          const drot = data.rotation ?? null;
          const dposArr = data.position;
          const dsKey = JSON.stringify(data.scale ?? null);
          const eoKey = `${dposArr[0]},${dposArr[1]},${dposArr[2]}|${drot ? drot.join(",") : "n"}|${dsKey}`;
          let cachedOwners = vueEdgeOwnersCache.get(data.polygons);
          if (cachedOwners === undefined || vueEdgeOwnersCacheKey.get(data.polygons) !== eoKey) {
            cachedOwners = prepareCasterEdgeOwners(data.polygons, dposArr, data.scale, drot);
            vueEdgeOwnersCache.set(data.polygons, cachedOwners);
            vueEdgeOwnersCacheKey.set(data.polygons, eoKey);
          }
          edgeOwners = cachedOwners;
        }
        // Parametric override: low-res silhouette loops via the shared core
        // helper (identical to vanilla + React). Per-mesh `shadowDefinition`
        // beats the scene default; directional + per-point-light radial.
        let overrideSilhouette: Vec3[][] | undefined;
        let overridePointSilhouettes: Array<Vec3[][] | undefined> | undefined;
        if (ctx?.shadow?.parametric) {
          const def = data.shadowDefinition ?? ctx.shadow.definition ?? 16;
          const result = buildParametricCasterOverride({
            polysWorldVerts: items.map((it) => it.wv),
            lightDir,
            definition: def,
            isSelf,
            style: ctx.shadow.style,
            pointLights: shadowPointIndices.map((idx) => ({ position: allPointLightsCss[idx]!.position, index: idx })),
          });
          overrideSilhouette = result.overrideSilhouette;
          overridePointSilhouettes = result.overridePointSilhouettes;
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
    watch(
      polygons,
      (polys) => {
        const follow = sceneCtx?.value.shadow?.followAnimation ?? false;
        const topologyChanged = polys.length !== lastShadowPolyCount;
        if (lastShadowPolyCount >= 0 && !follow && !topologyChanged) return;
        lastShadowPolyCount = polys.length;
        shadowCasterPolygons.value = polys;
      },
      { immediate: true },
    );

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
            // (vanilla's dedupByCaster filter, same 0.5/0.95 thresholds).
            const dedupDrop = findOverlappingPolygonDuplicates(casterPolygons, {
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

    // Imperative handle exposed via defineExpose. Read-only view of
    // the mesh's element + transform + polygons. Stable getter object;
    // refs keep getters cheap without rebuilding on every render.
    const wrapperRef = ref<HTMLDivElement | null>(null);
    const handle: PolyMeshHandle = {
      get element() { return wrapperRef.value; },
      get id() { return props.id; },
      getPosition: () => props.position,
      getRotation: () => props.rotation,
      getScale: () => props.scale,
      getPolygons: () => imperativePolygons ?? polygons.value,
      setPolygons(nextPolygons: Polygon[]) {
        const nextRenderedPolygons = props.autoCenter ? recenterPolygons(nextPolygons) : nextPolygons;
        imperativePolygons = nextRenderedPolygons;
        const root = wrapperRef.value;
        const fastPathHandled =
          root &&
          atlasAutoRender &&
          updateStableTriangleDom(root, nextRenderedPolygons, {
            directionalLight: bakedDirectional.value,
            ambientLight: atlasAmbient.value,
            textureLighting: atlasTextureLighting.value,
            strategies: atlasStrategies.value,
            seamBleed: atlasSeamBleed.value,
            colorFrame: ++stableTriangleColorFrame.value,
            // Animated low-poly triangles can swing face normals sharply; keep the
            // mounted baked color pinned and animate transforms only.
            colorFreezeFrames: 0,
          });
        // ALWAYS update polygonOverride so Vue's render fn re-evaluates with the
        // new polygons. Otherwise any reactive dependency that re-fires after
        // setPolygons (cameraTick, sceneCtx, etc.) re-emits the <u> VNode from
        // stale polygons.value and Vue patches the leaf style back to the old
        // transform — undoing the imperative write from updateStableTriangleDom.
        polygonOverride.value = nextPolygons.slice();
        void fastPathHandled;
      },
      updatePolygon(target: Polygon | number, partial: Partial<Polygon>) {
        const current = imperativePolygons ?? polygons.value;
        const idx = typeof target === "number"
          ? target
          : current.indexOf(target);
        if (idx < 0 || idx >= current.length) return;
        Object.assign(current[idx], partial);
        // Produce a new array reference so Vue's computed reacts and
        // re-renders the atlas (the polygon object itself is mutated
        // in place to preserve identity for callers holding a ref).
        polygonOverride.value = current.slice();
        imperativePolygons = null;
      },
      rebakeAtlas: () => {
        bakedRotation.value = props.rotation;
      },
      whenTexturesReady() {
        if (textureAtlas.ready.value) return Promise.resolve();
        return new Promise<void>((resolve) => {
          textureReadyWaiters.push(resolve);
        });
      },
    };
    expose(handle);

    // Register the wrapper element so Select / TransformControls can
    // resolve clicks back to this handle via findMeshHandle.
    onMounted(() => {
      if (wrapperRef.value) registerMeshElement(wrapperRef.value, handle);
    });
    onBeforeUnmount(() => {
      if (wrapperRef.value) unregisterMeshElement(wrapperRef.value);
    });

    const voxelRenderer = ref<PolyVoxelRenderer | null>(null);
    watchEffect((onCleanup) => {
      const root = wrapperRef.value;
      voxelRenderer.value?.dispose();
      voxelRenderer.value = null;
      if (!directVoxelEnabled.value || !root) return;

      const renderer = createPolyVoxelRenderer({
        doc: root.ownerDocument,
        wrapper: root,
        polygons: polygons.value,
        directionalLight: bakedDirectional.value,
        ambientLight: atlasAmbient.value,
      });
      if (!renderer) return;

      const cameraRotation = () => {
        const cameraState = cameraCtx?.store.getState().cameraState;
        return {
          rotX: cameraState?.rotX ?? 65,
          rotY: cameraState?.rotY ?? 45,
          meshRotation: props.rotation,
        };
      };

      voxelRenderer.value = renderer;
      renderer.render(cameraRotation());
      const unsubscribe = cameraCtx?.store.subscribe(() => {
        renderer.syncCamera(cameraRotation());
      });

      onCleanup(() => {
        unsubscribe?.();
        renderer.dispose();
        if (voxelRenderer.value === renderer) voxelRenderer.value = null;
      });
    });

    let pointerDownAt: { x: number; y: number } | null = null;

    function makeEvent<E extends Event>(
      nativeEvent: E,
      clientX: number,
      clientY: number,
    ): PolyPointerEvent<E> {
      const intersections: Array<{ object: PolyMeshHandle }> = [];
      if (typeof document !== "undefined" && typeof document.elementsFromPoint === "function") {
        const stacked = document.elementsFromPoint(clientX, clientY);
        const seen = new Set<PolyMeshHandle>();
        for (const el of stacked) {
          const h = findPolyMeshHandle(el);
          if (h && !seen.has(h)) {
            seen.add(h);
            intersections.push({ object: h });
          }
        }
      }
      let nx = 0;
      let ny = 0;
      const camEl = cameraCtx?.cameraElRef.value;
      if (camEl) {
        const r = camEl.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) {
          nx = ((clientX - r.left) / r.width) * 2 - 1;
          ny = -(((clientY - r.top) / r.height) * 2 - 1);
        }
      }
      let delta = 0;
      if (pointerDownAt) {
        delta = Math.hypot(clientX - pointerDownAt.x, clientY - pointerDownAt.y);
      }
      return {
        object: intersections[0]?.object ?? handle,
        eventObject: handle,
        intersections,
        pointer: { x: nx, y: ny },
        delta,
        nativeEvent,
        stopPropagation: () => nativeEvent.stopPropagation(),
      };
    }

    function dispatch<E extends Event>(
      handler: PolyEventHandler<E> | undefined,
      nativeEvent: E,
      clientX: number,
      clientY: number,
    ): void {
      if (!handler) return;
      handler(makeEvent(nativeEvent, clientX, clientY));
    }

    return () => {
      const transform = buildPolyMeshTransform({
        position: props.position,
        scale: props.scale,
        rotation: props.rotation,
      });
      const wrapperStyle: CSSProperties = {
        transform,
        ...(dynamicLightOverride.value as CSSProperties | null ?? undefined),
        ...(attrs.style as CSSProperties | undefined),
        ...(defaultPaintVars.value ?? undefined),
      };

      const extraAttrs = Object.fromEntries(
        Object.entries(attrs).filter(([k]) => k !== "style" && k !== "class")
      );

      const wrapperClass = `polycss-mesh${directVoxelEnabled.value ? " polycss-voxel-mesh" : ""}${props.class ? ` ${props.class}` : ""}`;

      // Build the union of DOM handlers we need to attach. Each
      // registered prop becomes a `onXxx` attr on the wrapper div;
      // omitted props add zero overhead. pointerOver/pointerOut are
      // mapped to enter/leave so they fire once per mesh boundary
      // crossing (not per internal polygon transition).
      const handlers: Record<string, (e: Event) => void> = {};
      if (props.onClick) {
        handlers.onClick = (e) => {
          const m = e as MouseEvent;
          dispatch(props.onClick, m, m.clientX, m.clientY);
        };
      }
      if (props.onContextMenu) {
        handlers.onContextmenu = (e) => {
          const m = e as MouseEvent;
          dispatch(props.onContextMenu, m, m.clientX, m.clientY);
        };
      }
      if (props.onDoubleClick) {
        handlers.onDblclick = (e) => {
          const m = e as MouseEvent;
          dispatch(props.onDoubleClick, m, m.clientX, m.clientY);
        };
      }
      if (props.onWheel) {
        handlers.onWheel = (e) => {
          const m = e as WheelEvent;
          dispatch(props.onWheel, m, m.clientX, m.clientY);
        };
      }
      // pointerdown is always wired (even without user handler) so we
      // can track delta for click-vs-drag discrimination.
      handlers.onPointerdown = (e) => {
        const p = e as PointerEvent;
        pointerDownAt = { x: p.clientX, y: p.clientY };
        dispatch(props.onPointerDown, p, p.clientX, p.clientY);
      };
      handlers.onPointerup = (e) => {
        const p = e as PointerEvent;
        dispatch(props.onPointerUp, p, p.clientX, p.clientY);
        pointerDownAt = null;
      };
      if (props.onPointerMove) {
        handlers.onPointermove = (e) => {
          const p = e as PointerEvent;
          dispatch(props.onPointerMove, p, p.clientX, p.clientY);
        };
      }
      if (props.onPointerOver || props.onPointerEnter) {
        handlers.onPointerenter = (e) => {
          const p = e as PointerEvent;
          dispatch(props.onPointerOver, p, p.clientX, p.clientY);
          dispatch(props.onPointerEnter, p, p.clientX, p.clientY);
        };
      }
      if (props.onPointerOut || props.onPointerLeave) {
        handlers.onPointerleave = (e) => {
          const p = e as PointerEvent;
          dispatch(props.onPointerOut, p, p.clientX, p.clientY);
          dispatch(props.onPointerLeave, p, p.clientX, p.clientY);
        };
      }
      if (props.onPointerCancel) {
        handlers.onPointercancel = (e) => {
          const p = e as PointerEvent;
          dispatch(props.onPointerCancel, p, p.clientX, p.clientY);
          pointerDownAt = null;
        };
      }

      const meshIdAttr: Record<string, string> = props.id ? { "data-poly-mesh-id": props.id } : {};

      // Loading slot — only when fetching from src
      if (props.src && fetched.loading.value && fetched.polygons.value.length === 0) {
        return h(
          "div",
          {
            ref: wrapperRef,
            class: `polycss-mesh polycss-mesh-loading${props.class ? ` ${props.class}` : ""}`,
            style: wrapperStyle,
            ...meshIdAttr,
            ...handlers,
            ...extraAttrs,
          },
          slots.fallback?.() ?? []
        );
      }

      // Error slot — only when fetching from src
      if (props.src && fetched.error.value && fetched.polygons.value.length === 0) {
        return h(
          "div",
          {
            ref: wrapperRef,
            class: `polycss-mesh polycss-mesh-error${props.class ? ` ${props.class}` : ""}`,
            style: wrapperStyle,
            ...meshIdAttr,
            ...handlers,
            ...extraAttrs,
          },
          slots.error?.({ error: fetched.error.value }) ?? []
        );
      }

      const polys = polygons.value;

      // Build polygon nodes: use `polygon` scoped slot if provided, else auto-render atlas elements.
      const polyNodes: Array<VNode | null> = slots.polygon
        ? polys.map((p, i) => h("template", { key: i }, slots.polygon?.({ polygon: p, index: i })))
        : directVoxelEnabled.value
          ? []
        : textureAtlas.entries.value.map((entry, index) => {
            if (entry) {
              return renderTextureAtlasPoly({
                entry,
                page: textureAtlas.pages.value[entry.pageIndex],
                textureLighting: atlasTextureLighting.value,
                textureImageRendering: atlasTextureImageRendering.value,
                solidPaintDefaults: solidPaintDefaults.value,
              });
            }
            const plan = textureAtlas.plans.value[index];
            const imageGeometry = plan
              ? resolvePolyTextureLeafGeometry(plan, {
                  imageRendering: atlasTextureImageRendering.value,
                  backend: atlasTextureBackend.value,
                  projection: atlasTextureProjection.value,
                })
              : null;
            if (plan && imageGeometry) {
              return renderTextureImagePoly({
                plan,
                geometry: imageGeometry,
              });
            }
            if (!plan || plan.texture) return null;
            if (isProjectiveQuadPlan(plan)) {
              return renderTextureProjectiveSolidPoly({
                entry: plan,
                textureLighting: atlasTextureLighting.value,
                solidPaintDefaults: solidPaintDefaults.value,
              });
            }
            if (isSolidTrianglePlan(plan)) {
              return renderTextureTrianglePoly({
                entry: plan,
                textureLighting: atlasTextureLighting.value,
                solidPaintDefaults: solidPaintDefaults.value,
              });
            }
            // CornerShape solid (corner-*-shape: bevel <u>) — mirrors vanilla
            // createCornerShapeSolidElement. Catches multi-vertex non-rect
            // non-triangle polys with a valid cornerShape geometry. Without
            // this, those polys fall through to atlas bitmap and drift from
            // vanilla in dynamic mode.
            const cornerGeo = !atlasStrategies.value?.disable?.includes("i")
              ? cornerShapeGeometryForPlan(plan)
              : null;
            if (cornerGeo) {
              return renderTextureCornerShapeSolidPoly({
                entry: plan,
                geometry: cornerGeo,
                textureLighting: atlasTextureLighting.value,
                solidPaintDefaults: solidPaintDefaults.value,
              });
            }
            return renderTextureBorderShapePoly({
              entry: plan,
              textureLighting: atlasTextureLighting.value,
              solidPaintDefaults: solidPaintDefaults.value,
              forceBorderShape: !textureAtlas.useFullRectSolid.value,
            });
          });

      // Static default slot children (e.g. additional <PolyMesh> children)
      const defaultChildren = slots.default?.() ?? [];

      // Shadow goes before polygon nodes so it sits below casters in DOM
      // order — painter-order tie-breaking favors earlier nodes when both
      // are coplanar in 3D. Single <svg> per mesh (see shadowSvg above).
      const svgNode = shadowSvg.value;
      const shadowChildren: VNode[] = svgNode ? [svgNode] : [];
      const receiverChildren = receiverShadowSvgs.value;
      // Teleport receiver shadow SVGs OUT of `.polycss-mesh` into
      // `.polycss-scene`. The SVG `matrix3d(...)` already bakes this mesh's
      // `position` (via `prepareReceiverFacePlanes`), so leaving them inside
      // the mesh wrapper would double-count `translate3d(position)`. Vanilla
      // mounts these at scene-root for the same reason.
      const portalTarget = sceneCtx?.value?.sceneEl ?? null;
      const portaledReceiverChildren = portalTarget && receiverChildren.length > 0
        ? [h(Teleport, { to: portalTarget }, receiverChildren)]
        : [];

      return h(
        "div",
        {
          ref: wrapperRef,
          class: wrapperClass,
          style: wrapperStyle,
          ...meshIdAttr,
          ...handlers,
          ...extraAttrs,
        },
        [...shadowChildren, ...portaledReceiverChildren, ...polyNodes, ...defaultChildren]
      );
    };
  },
});
