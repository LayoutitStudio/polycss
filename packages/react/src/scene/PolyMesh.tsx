/**
 * PolyMesh — load a mesh URL (or accept a polygons array) and render its
 * polygons inside a `.polycss-mesh` wrapper that carries the mesh-wide
 * position/scale/rotation transform.
 *
 * Uses nested DOM (preserve-3d) so the wrapper transform composes with each
 * atlas polygon's vertex matrix3d via CSS without JS doing the matrix math.
 *
 * Render-prop semantics:
 *   - `children(polygon, index)` is called once per parsed polygon.
 *   - Returned elements render INSIDE the .polycss-mesh wrapper, so they
 *     inherit the mesh transform automatically. Don't re-apply position
 *     or you'll double-transform.
 *   - Non-function children are static wrapper children, matching Vue's
 *     default slot behavior.
 *
 * The implementation is decomposed into concept-scoped hooks under
 * `./mesh/` (geometry, lighting, atlas, stable-DOM handle, events,
 * receiver/ground shadows, voxel fast path); this file owns the prop
 * surface, hook composition, and the final render assembly.
 */
import { forwardRef, useContext } from "react";
import type { CSSProperties, ReactNode } from "react";
import type {
  MeshResolution,
  Polygon,
  PolyTextureBackend,
  PolyTextureImageRendering,
  PolyTextureLeafSizing,
  PolyTextureLightingMode,
  PolyTextureProjection,
} from "@layoutit/polycss-core";
import {
  buildPolyMeshTransform,
  cornerShapeGeometryForPlan,
  resolvePolyTextureLeafGeometry,
} from "@layoutit/polycss-core";
import type { TransformProps } from "../shapes/types";
import { type UseMeshOptions } from "./useMesh";
import {
  isProjectiveQuadPlan,
  isSolidTrianglePlan,
  type TextureQuality,
  type PolySeamBleed,
  TextureBorderShapePoly,
  TextureAtlasPoly,
  TextureCornerShapeSolidPoly,
  TextureImagePoly,
  TextureProjectiveSolidPoly,
  TextureTrianglePoly,
} from "./atlas";
import { createPortal } from "react-dom";
import { useSceneContextValue } from "./sceneContext";
import { PolyCameraContext } from "../camera/context";
import type { InteractionProps, PolyMeshHandle } from "./events";
import { useMeshGeometry } from "./mesh/useMeshGeometry";
import { useMeshLighting } from "./mesh/useMeshLighting";
import { useMeshAtlas } from "./mesh/useMeshAtlas";
import { useStableDom } from "./mesh/useStableDom";
import { useMeshEvents } from "./mesh/useMeshEvents";
import { useReceiverShadows } from "./mesh/useReceiverShadows";
import { useGroundShadow } from "./mesh/useGroundShadow";
import { useVoxelFastPath } from "./mesh/useVoxelFastPath";

export interface PolyMeshProps extends TransformProps, InteractionProps {
  /** Stable identifier — exposed on the mesh handle and reflected as
   *  `data-poly-mesh-id` on the wrapper div. Use for selection lookups. */
  id?: string;
  /** URL to .obj / .glb / .gltf. Mutually exclusive with `polygons`. */
  src?: string;
  /**
   * Companion `.mtl` URL for OBJ models. When set, materials defined in
   * the mtl (Kd colors, map_Kd textures) are applied to the loaded mesh.
   * Ignored for GLB/GLTF (they carry materials inline).
   */
  mtl?: string;
  /** Pre-parsed polygons. Mutually exclusive with `src`. */
  polygons?: Polygon[];
  /** Optional `parseResult.voxelSource` companion for `.vox` meshes. When
   *  set alongside `polygons`, the direct voxel renderer fast path activates
   *  — emitting one `<b>` per visible voxel quad inside `.polycss-voxel-face`
   *  wrappers (matches vanilla's `scene.add(parseResult)` behaviour).
   *  Callers fetching via core's `loadMesh()` pass `parseResult.voxelSource`
   *  here so the fast path engages; callers fetching via PolyMesh's `src`
   *  prop get the same data wired through `useMesh` automatically. */
  voxelSource?: import("@layoutit/polycss-core").ParseResult["voxelSource"];
  /** Translate so mesh's bbox center is at local origin before applying `position`. */
  autoCenter?: boolean;
  /** Textured polygon lighting mode. Defaults to "baked". */
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
   * Hold the whole previous frame (geometry + texture) until the next atlas is
   * decoded, then swap atomically — so a geometry edit never shows geometry
   * before its texture. Best when edits arrive as discrete commits (no
   * continuous drag). Defaults to false (bitmap streams in over live geometry).
   */
  atomicAtlas?: boolean;
  /** Fires when the displayed atlas frame swaps to a ready one (atomic mode). */
  onFrameReady?: () => void;
  /** Per-polygon override render, or static children mounted inside the mesh wrapper. */
  children?: ((polygon: Polygon, index: number) => ReactNode) | ReactNode;
  /** Loading slot — rendered while `src` is being fetched/parsed. */
  fallback?: ReactNode;
  /** Error slot — rendered if parse fails. Receives the Error. */
  errorFallback?: (error: Error) => ReactNode;
  /** Parser options forwarded to parseObj/parseGltf. */
  parseOptions?: UseMeshOptions;
  /** Mesh optimization intent. Defaults to "lossy"; set "lossless" to keep
   *  authored surface fidelity. Top-level prop wins over `parseOptions.meshResolution`
   *  when both are present. */
  meshResolution?: MeshResolution;
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
   * shadows onto each visible surface of this mesh, matching Three.js's
   * `mesh.receiveShadow` semantics. Disables the ground-shadow fallback
   * for caster meshes — receivers handle shadow display. Defaults to `false`.
   */
  receiveShadow?: boolean;
  /**
   * Per-mesh parametric-shadow detail, overriding the scene's
   * `shadow.definition` for this mesh's cast/self shadow. Only used when the
   * scene's `shadow.parametric` is true. Unset → inherit the scene definition.
   */
  shadowDefinition?: number;
  /**
   * Apply mesh optimization (coplanar merge + interior cull) before
   * rendering. Defaults to `true` — matches vanilla `scene.add`'s default.
   * Set `false` for helper meshes (axes, light markers) whose geometry
   * shouldn't be merged, or when the imperative `updatePolygon` API needs
   * polygon refs to survive across updates.
   */
  merge?: boolean;
  className?: string;
  style?: CSSProperties;
}

export const PolyMesh = forwardRef<PolyMeshHandle, PolyMeshProps>(function PolyMesh(
  {
    id,
    src,
    mtl,
    polygons: polygonsProp,
    voxelSource: voxelSourceProp,
    autoCenter,
    textureLighting,
    textureQuality,
    textureLeafSizing,
    textureImageRendering,
    textureBackend,
    textureProjection,
    seamBleed,
    atomicAtlas,
    onFrameReady,
    castShadow,
    receiveShadow,
    shadowDefinition,
    merge = true,
    children,
    fallback,
    errorFallback,
    parseOptions,
    meshResolution,
    position,
    scale,
    rotation,
    className,
    style,
    onClick,
    onContextMenu,
    onDoubleClick,
    onWheel,
    onPointerDown,
    onPointerUp,
    onPointerMove,
    onPointerOver,
    onPointerOut,
    onPointerEnter,
    onPointerLeave,
    onPointerCancel,
  }: PolyMeshProps,
  forwardedRef,
) {
  const { fetched, externalVoxelSource, localPolygons, setLocalPolygons, polygons } = useMeshGeometry({
    src,
    mtl,
    parseOptions,
    meshResolution,
    polygonsProp,
    voxelSourceProp,
    merge,
    autoCenter,
  });

  const hasRenderProp = typeof children === "function";
  const renderPolygon = hasRenderProp
    ? children as (polygon: Polygon, index: number) => ReactNode
    : null;
  const staticChildren: ReactNode = hasRenderProp ? null : children as ReactNode;
  const hasStaticChildren = staticChildren !== null && staticChildren !== undefined && staticChildren !== false;

  const transform = buildPolyMeshTransform({ position, scale, rotation });

  const cameraCtx = useContext(PolyCameraContext);
  const sceneCtx = useSceneContextValue();

  const lighting = useMeshLighting({
    sceneCtx,
    textureLighting,
    textureLeafSizing,
    textureImageRendering,
    textureBackend,
    textureProjection,
    seamBleed,
    position,
    rotation,
  });
  const {
    effectiveTextureLighting,
    effectiveStrategies,
    disabledStrategies,
    effectiveTextureImageRendering,
    effectiveTextureBackend,
    effectiveTextureProjection,
    dynamicLightOverride,
  } = lighting;

  const directVoxelEnabled = Boolean(
    externalVoxelSource &&
    localPolygons === null &&
    !renderPolygon &&
    !hasStaticChildren &&
    effectiveTextureLighting === "baked" &&
    !castShadow,
  );

  const { atlasPlans, textureAtlas, whenTexturesReady, solidPaintDefaults, defaultPaintVars } = useMeshAtlas({
    renderPolygon,
    directVoxelEnabled,
    polygons,
    lighting,
    textureQuality,
    atomicAtlas,
    onFrameReady,
  });

  const { wrapperRef, handle } = useStableDom({
    id,
    forwardedRef,
    position,
    scale,
    rotation,
    autoCenter,
    polygons,
    renderPolygon,
    setLocalPolygons,
    lighting,
    whenTexturesReady,
  });

  const { wrapperHandlers } = useMeshEvents({
    cameraCtx,
    handle,
    onClick,
    onContextMenu,
    onDoubleClick,
    onWheel,
    onPointerDown,
    onPointerUp,
    onPointerMove,
    onPointerOver,
    onPointerOut,
    onPointerEnter,
    onPointerLeave,
    onPointerCancel,
  });

  const { receiverShadowSvgs } = useReceiverShadows({
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
  });

  // Portal receiver shadow SVGs OUT of `.polycss-mesh` into `.polycss-scene`.
  // The SVG `matrix3d(...)` already includes this mesh's `position` (baked
  // into world space by `prepareReceiverFacePlanes`), so leaving them inside
  // the mesh wrapper would double-count `translate3d(position)`. Vanilla
  // mounts these at scene-root for the same reason.
  const portalSceneEl = sceneCtx?.sceneEl ?? null;
  const portaledReceiverShadowSvgs = portalSceneEl && receiverShadowSvgs
    ? createPortal(receiverShadowSvgs, portalSceneEl)
    : null;

  const shadowSvgNode = useGroundShadow({
    castShadow,
    renderPolygon,
    polygons,
    atlasPlans,
    position,
    sceneCtx,
  });

  useVoxelFastPath({
    directVoxelEnabled,
    polygons,
    lighting,
    cameraCtx,
    rotation,
    wrapperRef,
  });

  const wrapperStyle: CSSProperties = {
    transform,
    ...dynamicLightOverride,
    ...style,
    ...defaultPaintVars,
  };

  const renderedPolygons = renderPolygon
    ? polygons.map((p, i) => (
        // Render-prop: caller controls how each polygon renders. We still
        // wrap in a fragment with key so React reconciliation works.
        <RenderPropPolygon key={i} polygon={p} index={i}>
          {renderPolygon}
        </RenderPropPolygon>
      ))
    : textureAtlas.entries.map((entry, index) => {
        if (entry) {
          return (
            <TextureAtlasPoly
              key={entry.index}
              entry={entry}
              page={textureAtlas.pages[entry.pageIndex]}
              textureLighting={effectiveTextureLighting}
              textureImageRendering={effectiveTextureImageRendering}
              solidPaintDefaults={solidPaintDefaults}
            />
          );
        }

        const plan = textureAtlas.plans[index];
        const imageGeometry = plan
          ? resolvePolyTextureLeafGeometry(plan, {
              imageRendering: effectiveTextureImageRendering,
              backend: effectiveTextureBackend,
              projection: effectiveTextureProjection,
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
        if (isProjectiveQuadPlan(plan)) {
          return (
            <TextureProjectiveSolidPoly
              key={plan.index}
              entry={plan}
              textureLighting={effectiveTextureLighting}
              solidPaintDefaults={solidPaintDefaults}
            />
          );
        }
        if (isSolidTrianglePlan(plan)) {
          return (
            <TextureTrianglePoly
              key={plan.index}
              entry={plan}
              textureLighting={effectiveTextureLighting}
              solidPaintDefaults={solidPaintDefaults}
              doc={sceneCtx?.sceneEl?.ownerDocument}
              strategies={effectiveStrategies}
            />
          );
        }
        // CornerShape solid (corner-*-shape: bevel <u>) — mirrors vanilla
        // createCornerShapeSolidElement. Catches multi-vertex non-rect non-
        // triangle polys whose plan has a valid cornerShape geometry.
        // Without this branch, those polys fall through to atlas bitmap and
        // drift from vanilla in dynamic mode.
        const cornerGeo = !disabledStrategies?.has("i") ? cornerShapeGeometryForPlan(plan) : null;
        if (cornerGeo) {
          return (
            <TextureCornerShapeSolidPoly
              key={plan.index}
              entry={plan}
              geometry={cornerGeo}
              textureLighting={effectiveTextureLighting}
              solidPaintDefaults={solidPaintDefaults}
            />
          );
        }
        return (
          <TextureBorderShapePoly
            key={plan.index}
            entry={plan}
            textureLighting={effectiveTextureLighting}
            solidPaintDefaults={solidPaintDefaults}
            disabledStrategies={disabledStrategies}
          />
        );
      });

  // Loading + error slots only apply when we're fetching from `src`.
  if (src) {
    if (fetched.loading && fetched.polygons.length === 0) {
      return (
        <div
          ref={wrapperRef}
          data-poly-mesh-id={id}
          className={`polycss-mesh polycss-mesh-loading${className ? ` ${className}` : ""}`}
          style={wrapperStyle}
          {...wrapperHandlers}
        >
          {fallback ?? null}
        </div>
      );
    }
    if (fetched.error && fetched.polygons.length === 0) {
      return (
        <div
          ref={wrapperRef}
          data-poly-mesh-id={id}
          className={`polycss-mesh polycss-mesh-error${className ? ` ${className}` : ""}`}
          style={wrapperStyle}
          {...wrapperHandlers}
        >
          {errorFallback ? errorFallback(fetched.error) : null}
        </div>
      );
    }
  }

  return (
    <div
      ref={wrapperRef}
      data-poly-mesh-id={id}
      className={`polycss-mesh${directVoxelEnabled ? " polycss-voxel-mesh" : ""}${className ? ` ${className}` : ""}`}
      style={wrapperStyle}
      {...wrapperHandlers}
    >
      {shadowSvgNode}
      {portaledReceiverShadowSvgs}
      {renderedPolygons}
      {staticChildren}
    </div>
  );
});

// Helper component so the render-prop call sits inside React's tree (vs. an
// inline call in the parent's render) — keeps key handling consistent and
// makes profiler output more readable.
function RenderPropPolygon({
  polygon,
  index,
  children,
}: {
  polygon: Polygon;
  index: number;
  children: (polygon: Polygon, index: number) => ReactNode;
}) {
  return <>{children(polygon, index)}</>;
}
