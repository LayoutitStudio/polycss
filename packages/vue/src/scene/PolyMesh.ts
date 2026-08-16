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
 *
 * The implementation is decomposed into concept-scoped composables under
 * `./mesh/` (geometry, lighting, atlas, stable-DOM handle, events,
 * receiver/ground shadows, voxel fast path); this file owns the prop/slot
 * surface, composable composition, and the final VNode assembly.
 */
import { defineComponent, h, Teleport, computed, inject } from "vue";
import type { PropType, SlotsType, VNode, CSSProperties } from "vue";
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
  buildPolyMeshTransform,
  cornerShapeGeometryForPlan,
  resolvePolyTextureLeafGeometry,
} from "@layoutit/polycss-core";
import { type UseMeshOptions } from "./useMesh";
import {
  isProjectiveQuadPlan,
  isSolidTrianglePlan,
  type TextureQuality,
  type PolySeamBleed,
  renderTextureBorderShapePoly,
  renderTextureAtlasPoly,
  renderTextureCornerShapeSolidPoly,
  renderTextureImagePoly,
  renderTextureProjectiveSolidPoly,
  renderTextureTrianglePoly,
} from "./atlas";
import { usePolySceneContext } from "./sceneContext";
import { PolyCameraContextKey } from "../camera";
import { type InteractionProps, type PolyEventHandler } from "./events";
import { useMeshGeometry } from "./mesh/useMeshGeometry";
import { useMeshLighting } from "./mesh/useMeshLighting";
import { useMeshAtlas } from "./mesh/useMeshAtlas";
import { useStableDom } from "./mesh/useStableDom";
import { useMeshEvents } from "./mesh/useMeshEvents";
import { useReceiverShadows } from "./mesh/useReceiverShadows";
import { useGroundShadow } from "./mesh/useGroundShadow";
import { useVoxelFastPath } from "./mesh/useVoxelFastPath";

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
  /** Solid seam overscan in CSS px (no upper clamp; each edge is still fitted to the polygon plan). `"auto"`/omitted = the 1.5px default; `0` disables every bleed; sub-1.5 values also shrink per-strategy primitive bleeds proportionally. */
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

export const PolyMesh = defineComponent({
  name: "PolyMesh",
  inheritAttrs: false,
  // Typed slots so `#polygon` consumers see the scoped { polygon, index }
  // payload instead of Vue's untyped default slot signature.
  slots: Object as SlotsType<{
    default?: Record<string, never>;
    polygon?: { polygon: Polygon; index: number };
    fallback?: Record<string, never>;
    error?: { error: unknown };
  }>,
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
    const { fetched, externalVoxelSource, polygonOverride, imperativePolygons, polygons } =
      useMeshGeometry(props);
    const atlasAutoRender = !slots.polygon;

    // Inherit textureLighting + lights from the parent <PolyScene> so that
    // helper polygons (e.g. light marker octahedron) participate in the
    // scene's dynamic mode instead of getting overpainted by the scene's
    // global CSS rule with default normals.
    const sceneCtx = usePolySceneContext();
    // Camera ctx — referenced by both event synthesis and the receiver-
    // shadow back-face cull. Declared early so the shadow computed can
    // close over it.
    // NO camera subscription here — receiver shadows do not re-emit on
    // camera motion (they ride the scene transform). The receiver-face
    // back-face cull reads the camera state at emit time and may go stale
    // during an orbit — the same deliberate trade vanilla makes in
    // emitSceneShadows (shadows are not re-emitted from applyCamera).
    const cameraCtx = inject(PolyCameraContextKey, null);

    const lighting = useMeshLighting(props, sceneCtx);
    const {
      atlasTextureLighting,
      atlasStrategies,
      atlasTextureImageRendering,
      atlasTextureBackend,
      atlasTextureProjection,
      dynamicLightOverride,
    } = lighting;

    const directVoxelEnabled = computed(() => Boolean(
      externalVoxelSource.value &&
      polygonOverride.value === null &&
      !slots.polygon &&
      !slots.default &&
      atlasTextureLighting.value === "baked" &&
      !props.castShadow,
    ));

    const { textureAtlasPlans, textureAtlas, whenTexturesReady, solidPaintDefaults, defaultPaintVars } =
      useMeshAtlas({ props, atlasAutoRender, directVoxelEnabled, polygons, lighting });

    const { wrapperRef, handle } = useStableDom({
      props,
      expose,
      atlasAutoRender,
      polygons,
      polygonOverride,
      imperativePolygons,
      lighting,
      whenTexturesReady,
    });

    const { buildHandlers } = useMeshEvents({ props, cameraCtx, handle });

    const { receiverShadowSvgs } = useReceiverShadows({
      props,
      polygons,
      textureAtlasPlans,
      atlasTextureLighting,
      sceneCtx,
      cameraCtx,
    });

    const { shadowSvg } = useGroundShadow({ props, slots, polygons, textureAtlasPlans, sceneCtx });

    useVoxelFastPath({ props, directVoxelEnabled, polygons, lighting, cameraCtx, wrapperRef });

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

      // Union of wrapper DOM handlers — built per render so omitted props
      // add zero overhead (see useMeshEvents).
      const handlers = buildHandlers();

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
                doc: sceneCtx?.value.sceneEl?.ownerDocument,
                strategies: atlasStrategies.value,
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
      // are coplanar in 3D. Single <svg> per mesh (see useGroundShadow).
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
