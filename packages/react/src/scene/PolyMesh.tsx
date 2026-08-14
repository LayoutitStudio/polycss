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
 */
import {
  forwardRef,
  useCallback,
  useContext,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { CSSProperties, ReactNode, PointerEvent as ReactPointerEvent, MouseEvent as ReactMouseEvent, WheelEvent as ReactWheelEvent } from "react";
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
  BASE_TILE,
  buildParametricCasterOverride,
  buildPolyMeshTransform,
  buildSharedEdgeMap,
  computeMergedReceiverShadows,
  computeSceneBbox,
  DEFAULT_SEAM_BLEED,
  ensureCcw2D,
  findOverlappingPolygonDuplicates,
  inverseRotateVec3,
  optimizeMeshPolygons,
  parseHexColor,
  prepareCasterEdgeOwners,
  prepareCasterPolyItems,
  prepareReceiverFacePlanes,
  projectCssVertexToGround,
  resolvePolyTextureLeafGeometry,
  worldDirectionToCss,
  worldPositionToCss,
  type CameraCullRotation,
  type EdgeOwners,
  type ReceiverCasterInput,
  POLY_DEFAULT_SHADOW_LIFT,
} from "@layoutit/polycss-core";
import type { TransformProps } from "../shapes/types";
import { usePolyMesh, type UseMeshOptions } from "./useMesh";
import { buildBasisHints, cornerShapeGeometryForPlan, worldDirectionalLightToCss } from "@layoutit/polycss-core";
import {
  buildSeamBleedPolygonEdges,
  buildTextureEdgeRepairSets,
  computeTextureAtlasPlan,
  cssBorderShapeForPlan,
  getSolidPaintDefaults,
  isProjectiveQuadPlan,
  isSolidTrianglePlan,
  type TextureAtlasPlan,
  type TextureQuality,
  type PolySeamBleed,
  type SolidPaintDefaults,
  TextureBorderShapePoly,
  TextureAtlasPoly,
  TextureCornerShapeSolidPoly,
  TextureImagePoly,
  TextureProjectiveSolidPoly,
  TextureTrianglePoly,
  updateStableTriangleDom,
  useTextureAtlas,
} from "./atlas";
import { createPortal } from "react-dom";
import { usePolySceneContext } from "./sceneContext";
import { PolyCameraContext } from "../camera/context";
import { createPolyVoxelRenderer, type PolyVoxelRenderer } from "./voxelRenderer";
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
 *  caster's polygons array identity (snapshot from `shadowCasters`) +
 *  position/scale/rotation bust key. Used by the H9 silhouette path in
 *  `computeReceiverShadowFaces`. Lives at module scope so callsites share
 *  cache across receivers in a single frame. */
const reactEdgeOwnersCache = new WeakMap<readonly Polygon[], ReadonlyMap<string, EdgeOwners>>();
const reactEdgeOwnersCacheKey = new WeakMap<readonly Polygon[], string>();

function solidPaintVars(defaults: SolidPaintDefaults): CSSProperties | null {
  const out: Record<string, string> = {};
  if (defaults.paintColor) out["--polycss-paint"] = defaults.paintColor;
  if (defaults.dynamicColor) {
    out["--psr"] = (defaults.dynamicColor.r / 255).toFixed(4);
    out["--psg"] = (defaults.dynamicColor.g / 255).toFixed(4);
    out["--psb"] = (defaults.dynamicColor.b / 255).toFixed(4);
  }
  return Object.keys(out).length > 0 ? out as CSSProperties : null;
}

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
  /** Solid seam overscan. `"auto"` computes a fitted per-edge amount from the polygon plan. */
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
  // Compose mtl + meshResolution props into the parser options threaded to
  // useMesh. The top-level meshResolution prop wins over parseOptions.meshResolution
  // when both are present — top-level is the discoverable route; parseOptions is
  // for niche parser flags.
  const mergedOptions = useMemo<UseMeshOptions | undefined>(() => {
    if (!mtl && !parseOptions && meshResolution === undefined) return undefined;
    return {
      ...(parseOptions ?? {}),
      ...(mtl ? { mtlUrl: mtl } : {}),
      ...(meshResolution !== undefined ? { meshResolution } : {}),
    };
  }, [mtl, parseOptions, meshResolution]);

  // Either fetch via useMesh, or use the supplied polygons array.
  // useMesh tolerates an empty src (sits idle) so we always call it for
  // hook-rules consistency.
  const fetched = usePolyMesh(src ?? "", mergedOptions);

  const externalPolygons = src ? fetched.polygons : (polygonsProp ?? []);
  const externalVoxelSource = src ? fetched.voxelSource : voxelSourceProp;

  // Local override array written by updatePolygon(). Null means no
  // imperative edits have been applied — the external source is used as-is.
  // Reset whenever the external source identity changes so stale overrides
  // don't leak across prop/fetch updates.
  const [localPolygons, setLocalPolygons] = useState<Polygon[] | null>(null);
  const prevExternalRef = useRef(externalPolygons);
  if (prevExternalRef.current !== externalPolygons) {
    prevExternalRef.current = externalPolygons;
    // Synchronous state reset during render (safe in React — equivalent to
    // getDerivedStateFromProps). Avoids a stale-override flash on the next
    // paint before a useEffect would fire.
    if (localPolygons !== null) setLocalPolygons(null);
  }

  const rawSourcePolygons = localPolygons ?? externalPolygons;
  // Apply mesh optimization (coplanar merge + interior cull) — mirrors
  // vanilla's scene.add path which always runs optimizeMeshPolygons. Skip
  // when `merge={false}` (helpers, imperative-edit callers that need
  // stable polygon refs).
  const sourcePolygons = useMemo(
    () => merge
      ? optimizeMeshPolygons(rawSourcePolygons, meshResolution !== undefined ? { meshResolution } : undefined)
      : rawSourcePolygons,
    [rawSourcePolygons, merge, meshResolution],
  );
  const hasRenderProp = typeof children === "function";
  const renderPolygon = hasRenderProp
    ? children as (polygon: Polygon, index: number) => ReactNode
    : null;
  const staticChildren: ReactNode = hasRenderProp ? null : children as ReactNode;
  const hasStaticChildren = staticChildren !== null && staticChildren !== undefined && staticChildren !== false;

  // Re-center vertices into mesh-local space if autoCenter is set. Done
  // once per polygon-list identity — bake into vertices, not per frame.
  const polygons = useMemo(
    () => (autoCenter ? recenterPolygons(sourcePolygons) : sourcePolygons),
    [sourcePolygons, autoCenter]
  );

  const transform = buildPolyMeshTransform({ position, scale, rotation });

  // ── Imperative ref handle + DOM registry ──────────────────────────────
  // The handle is a stable object whose getters always read the latest
  // props. Refs keep getters cheap without rebuilding the handle on every
  // render. The DOM-element registry lets <Select> and <TransformControls>
  // resolve a click target back to its owning mesh in O(depth).
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const propsRef = useRef({ position, scale, rotation });
  propsRef.current = { position, scale, rotation };
  const polygonsRef = useRef(polygons);
  polygonsRef.current = polygons;

  // `bakedRotation` is the rotation that was in effect when the atlas was
  // last rasterized. It starts equal to the initial `rotation` prop and
  // only advances when `rebakeAtlas()` is called (e.g. on rotate-drag
  // release). This decouples the smooth CSS wrapper transform (live
  // `rotation`) from the atlas baker, so we don't re-bake every frame
  // during a drag.
  const [bakedRotation, setBakedRotation] = useState<Vec3 | undefined>(rotation);
  const stableTriangleColorFrameRef = useRef(0);
  const setPolygonsImplRef = useRef<(next: Polygon[]) => void>(() => {});
  const textureReadyRef = useRef(true);
  const textureReadyWaitersRef = useRef<Array<() => void>>([]);

  const resolveTextureReadyWaiters = useCallback(() => {
    const waiters = textureReadyWaitersRef.current.splice(0);
    for (const resolve of waiters) resolve();
  }, []);

  const handle = useMemo<PolyMeshHandle>(() => ({
    get element() { return wrapperRef.current; },
    id,
    getPosition: () => propsRef.current.position,
    getRotation: () => propsRef.current.rotation,
    getScale: () => propsRef.current.scale,
    getPolygons: () => polygonsRef.current,
    setPolygons(nextPolygons: Polygon[]) {
      setPolygonsImplRef.current(nextPolygons);
    },
    rebakeAtlas: () => setBakedRotation(propsRef.current.rotation),
    whenTexturesReady() {
      if (textureReadyRef.current) return Promise.resolve();
      return new Promise<void>((resolve) => {
        textureReadyWaitersRef.current.push(resolve);
      });
    },
    updatePolygon(target: Polygon | number, partial: Partial<Polygon>) {
      const current = polygonsRef.current;
      const idx = typeof target === "number"
        ? target
        : current.indexOf(target);
      if (idx < 0 || idx >= current.length) return;
      Object.assign(current[idx], partial);
      // Shallow-copy the array to produce a new identity, which causes the
      // sourcePolygons → polygons useMemo chain to re-run and re-render.
      setLocalPolygons([...current]);
    },
  }), [id]);

  useImperativeHandle(forwardedRef, () => handle, [handle]);

  useEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;
    registerMeshElement(el, handle);
    return () => unregisterMeshElement(el);
  }, [handle]);

  // ── Pointer event synthesis ───────────────────────────────────────────
  // Build the polycss-shaped payload from a native React synthetic event.
  // intersections come from elementsFromPoint, walked up to nearest mesh
  // ancestor — front-to-back order matches DOM stacking. NDC pointer is
  // computed against the camera viewport bounds (falls back to (0,0) when
  // PolyMesh is rendered outside a <PolyCamera>).
  const cameraCtx = useContext(PolyCameraContext);
  const cameraElRef = cameraCtx?.cameraElRef ?? null;
  const pointerDownAtRef = useRef<{ x: number; y: number } | null>(null);

  const makeEvent = useCallback(
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
      const camEl = cameraElRef?.current;
      if (camEl) {
        const r = camEl.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) {
          nx = ((clientX - r.left) / r.width) * 2 - 1;
          ny = -(((clientY - r.top) / r.height) * 2 - 1);
        }
      }
      let delta = 0;
      const pd = pointerDownAtRef.current;
      if (pd) delta = Math.hypot(clientX - pd.x, clientY - pd.y);
      return {
        object: intersections[0]?.object ?? handle,
        eventObject: handle,
        intersections,
        pointer: { x: nx, y: ny },
        delta,
        nativeEvent,
        stopPropagation: () => nativeEvent.stopPropagation(),
      };
    },
    [cameraElRef, handle],
  );

  // Build the union of DOM handlers we need to attach. Wiring stays inert
  // when the user provides no handlers — `wrapperHandlers` ends up empty.
  const wrapperHandlers = useMemo(() => {
    // Wrap the polycss event's stopPropagation to ALSO stop React's
    // synthetic event propagation (which is the relevant tree-bubbling
    // for ancestor handlers in JSX). Without this, calling
    // event.stopPropagation() from a polycss handler would only stop
    // native DOM bubbling — React's tree bubbling would still hit
    // ancestor onClick handlers, surprising consumers.
    const dispatch = <E extends Event, R extends { stopPropagation(): void }>(
      polyHandler: PolyEventHandler<E> | undefined,
      reactEvent: R,
      nativeEvent: E,
      clientX: number,
      clientY: number,
    ): void => {
      if (!polyHandler) return;
      const polyEvent = makeEvent(nativeEvent, clientX, clientY);
      const originalStop = polyEvent.stopPropagation;
      polyEvent.stopPropagation = () => {
        originalStop();
        reactEvent.stopPropagation();
      };
      polyHandler(polyEvent);
    };
    const out: {
      onClick?: (e: ReactMouseEvent<HTMLDivElement>) => void;
      onContextMenu?: (e: ReactMouseEvent<HTMLDivElement>) => void;
      onDoubleClick?: (e: ReactMouseEvent<HTMLDivElement>) => void;
      onWheel?: (e: ReactWheelEvent<HTMLDivElement>) => void;
      onPointerDown?: (e: ReactPointerEvent<HTMLDivElement>) => void;
      onPointerUp?: (e: ReactPointerEvent<HTMLDivElement>) => void;
      onPointerMove?: (e: ReactPointerEvent<HTMLDivElement>) => void;
      onPointerEnter?: (e: ReactPointerEvent<HTMLDivElement>) => void;
      onPointerLeave?: (e: ReactPointerEvent<HTMLDivElement>) => void;
      onPointerCancel?: (e: ReactPointerEvent<HTMLDivElement>) => void;
    } = {};
    if (onClick) {
      out.onClick = (e) => dispatch(onClick, e, e.nativeEvent, e.clientX, e.clientY);
    }
    if (onContextMenu) {
      out.onContextMenu = (e) => dispatch(onContextMenu, e, e.nativeEvent, e.clientX, e.clientY);
    }
    if (onDoubleClick) {
      out.onDoubleClick = (e) => dispatch(onDoubleClick, e, e.nativeEvent, e.clientX, e.clientY);
    }
    if (onWheel) {
      out.onWheel = (e) => dispatch(onWheel, e, e.nativeEvent, e.clientX, e.clientY);
    }
    if (onPointerDown) {
      out.onPointerDown = (e) => {
        pointerDownAtRef.current = { x: e.clientX, y: e.clientY };
        dispatch(onPointerDown, e, e.nativeEvent, e.clientX, e.clientY);
      };
    } else {
      // Still need to track pointerdown for delta computation when other
      // handlers (move/up/click) want it.
      out.onPointerDown = (e) => {
        pointerDownAtRef.current = { x: e.clientX, y: e.clientY };
      };
    }
    if (onPointerUp) {
      out.onPointerUp = (e) => {
        dispatch(onPointerUp, e, e.nativeEvent, e.clientX, e.clientY);
        pointerDownAtRef.current = null;
      };
    } else {
      out.onPointerUp = () => { pointerDownAtRef.current = null; };
    }
    if (onPointerMove) {
      out.onPointerMove = (e) => dispatch(onPointerMove, e, e.nativeEvent, e.clientX, e.clientY);
    }
    // r3f: onPointerOver and onPointerEnter both fire on entering the
    // mesh; onPointerOut and onPointerLeave on leaving. DOM enter/leave
    // (no bubble for child→child transitions) is the right primitive.
    if (onPointerOver || onPointerEnter) {
      out.onPointerEnter = (e) => {
        if (onPointerOver) dispatch(onPointerOver, e, e.nativeEvent, e.clientX, e.clientY);
        if (onPointerEnter) dispatch(onPointerEnter, e, e.nativeEvent, e.clientX, e.clientY);
      };
    }
    if (onPointerOut || onPointerLeave) {
      out.onPointerLeave = (e) => {
        if (onPointerOut) dispatch(onPointerOut, e, e.nativeEvent, e.clientX, e.clientY);
        if (onPointerLeave) dispatch(onPointerLeave, e, e.nativeEvent, e.clientX, e.clientY);
      };
    }
    if (onPointerCancel) {
      out.onPointerCancel = (e) => {
        dispatch(onPointerCancel, e, e.nativeEvent, e.clientX, e.clientY);
        pointerDownAtRef.current = null;
      };
    }
    return out;
  }, [
    makeEvent,
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
  ]);

  // Inherit textureLighting + lights from the parent <PolyScene> so that
  // helper polygons (e.g. light marker octahedron) participate in the
  // scene's dynamic mode instead of getting overpainted by the scene's
  // global CSS rule with default normals.
  const sceneCtx = usePolySceneContext();
  const effectiveTextureLighting = textureLighting ?? sceneCtx?.textureLighting ?? "baked";
  const effectiveStrategies = sceneCtx?.strategies;
  const disabledStrategies = useMemo(
    () => effectiveStrategies?.disable?.length ? new Set(effectiveStrategies.disable) : undefined,
    [effectiveStrategies],
  );
  const effectiveSeamBleed = seamBleed ?? sceneCtx?.seamBleed ?? DEFAULT_SEAM_BLEED;
  const effectiveTextureLeafSizing = textureLeafSizing ?? sceneCtx?.textureLeafSizing;
  const effectiveTextureImageRendering = textureImageRendering ?? sceneCtx?.textureImageRendering;
  const effectiveTextureBackend = textureBackend ?? sceneCtx?.textureBackend;
  const effectiveTextureProjection = textureProjection ?? sceneCtx?.textureProjection;
  // Always forward the scene's lights to atlas plan, including in dynamic
  // mode. Vanilla passes the (CSS-frame) directional light to its render
  // pipeline in every mode — the dynamic-mode atlas doesn't bake Lambert
  // into pixels, but buildBasisHints' seamLightBrightness still needs the
  // light vector, and computeTextureAtlasPlan computes shadedColor for the
  // fallback paint. Earlier React gated this on textureLighting === "dynamic"
  // which stripped the light, broke buildBasisHints' seam classification,
  // and visually transposed the cornerShape <u> matrix3d output vs vanilla.
  const effectiveDirectional = sceneCtx?.directionalLight;
  const effectiveAmbient = sceneCtx?.ambientLight;

  const directVoxelEnabled = Boolean(
    externalVoxelSource &&
    localPolygons === null &&
    !renderPolygon &&
    !hasStaticChildren &&
    effectiveTextureLighting === "baked" &&
    !castShadow,
  );

  // Dynamic-mode rotation fix: when the mesh has a non-zero rotation the
  // world-space light vars cascaded from <PolyScene> are wrong for the
  // per-polygon Lambert calc (which uses mesh-local normals). Override
  // --plx/ly/lz on the mesh wrapper with the light direction
  // inverse-rotated into the mesh's local frame. CSS cascade ensures the
  // override only affects this mesh's polygons. No debounce — CSS var
  // writes are cheap and this must track rotation in real time.
  const sceneDirectionalLight = sceneCtx?.directionalLight;
  const dynamicLightOverride = useMemo<CSSProperties | null>(() => {
    if (effectiveTextureLighting !== "dynamic") return null;
    if (!rotation || (rotation[0] === 0 && rotation[1] === 0 && rotation[2] === 0)) return null;
    if (!sceneDirectionalLight) return null;
    const dir = sceneDirectionalLight.direction;
    const localDir = inverseRotateVec3(dir, rotation);
    const len = Math.hypot(localDir[0], localDir[1], localDir[2]) || 1;
    // Quantize to 0.01 — matches H10 in PolyScene + vanilla lightingVars.
    return {
      ["--plx" as string]: (localDir[0] / len).toFixed(2),
      ["--ply" as string]: (localDir[1] / len).toFixed(2),
      ["--plz" as string]: (localDir[2] / len).toFixed(2),
    };
  }, [effectiveTextureLighting, rotation, sceneDirectionalLight]);

  // Compute the effective light direction for baking. If the mesh has been
  // rotated since mount (bakedRotation), inverse-rotate the world-space
  // light direction into the mesh's local frame so the Lambert dot product
  // stays correct: dot(localNormal, localLight) === dot(worldNormal, worldLight).
  const bakedDirectional = useMemo(() => {
    if (!effectiveDirectional) return effectiveDirectional;
    const rot = bakedRotation ?? [0, 0, 0] as Vec3;
    // Vanilla applies a world→CSS axis swap (x↔y) on the directional light
    // before passing it to renderPolygonsWithTextureAtlas — the polygon
    // basis stores normals in the CSS frame, so light vectors must match
    // before any dot product. React/Vue mirror that here so buildBasisHints
    // and computeTextureAtlasPlan see the same light vector vanilla sees.
    const cssLight = worldDirectionalLightToCss(effectiveDirectional);
    if (rot[0] === 0 && rot[1] === 0 && rot[2] === 0) return cssLight;
    return {
      ...cssLight,
      direction: inverseRotateVec3(cssLight.direction, rot),
    };
  }, [effectiveDirectional, bakedRotation]);

  // Point lights → mesh-local frame (subtract mesh position, inverse-rotate),
  // mirroring vanilla's localPointLightsForEntry. The atlas plan applies the
  // CSS axis-swap itself, so we pass mesh-local USER coords here.
  const bakedPointLights = useMemo(() => {
    const pls = sceneCtx?.pointLights;
    if (!pls || pls.length === 0) return undefined;
    const pos = (position ?? [0, 0, 0]) as Vec3;
    const rot = bakedRotation ?? ([0, 0, 0] as Vec3);
    const hasRot = rot[0] !== 0 || rot[1] !== 0 || rot[2] !== 0;
    return pls.map((pl) => {
      const rel: Vec3 = [pl.position[0] - pos[0], pl.position[1] - pos[1], pl.position[2] - pos[2]];
      const local = hasRot ? inverseRotateVec3(rel, rot) : rel;
      return { ...pl, position: local };
    });
  }, [sceneCtx?.pointLights, position, bakedRotation]);

  // Per-light occlusion raytrace (task #121) used to mark polygons in
  // ray-traced shadow with `directScale=0` so they baked at ambient-only.
  // Three.js doesn't bake shadow into the diffuse atlas — the real shadow
  // map darkens occluded geometry at render time, so a "in shadow" polygon's
  // diffuse stays at full Lambert(n·L). Vanilla disabled this in createPoly-
  // Scene.ts:1162 for three.js parity (see "rock1 baked-mode" divergence).
  const lightOccludedPolyIndices: ReadonlySet<number> | undefined = undefined;

  const atlasPlans = useMemo(
    () => {
      if (renderPolygon || directVoxelEnabled) return [];
      const repairEdges = buildTextureEdgeRepairSets(polygons);
      const seamBleedEdges = effectiveSeamBleed === "auto" || (
        typeof effectiveSeamBleed === "number" &&
        Number.isFinite(effectiveSeamBleed) &&
        effectiveSeamBleed > 0
      )
        ? buildSeamBleedPolygonEdges(polygons, {
            directionalLight: bakedDirectional,
            ambientLight: effectiveAmbient,
          })
        : null;
      // Cross-polygon basis hints (shared-edge adjacency, connected
      // components) — vanilla's renderer always computes these because they
      // affect which polygons qualify for the stable-solid-triangle path.
      // Without them, ~8 polygons in a typical castle mesh fall through to
      // the atlas bitmap path instead of <u>, producing visible parity
      // drift vs vanilla in dynamic mode.
      const basisHints = buildBasisHints(polygons, {
        directionalLight: bakedDirectional,
        ambientLight: effectiveAmbient,
      });
      return polygons.map((p, i) => computeTextureAtlasPlan(
        p,
        i,
        {
          directionalLight: bakedDirectional,
          pointLights: bakedPointLights,
          ambientLight: effectiveAmbient,
          seamBleed: seamBleedEdges?.has(i) ? effectiveSeamBleed : undefined,
          seamEdges: seamBleedEdges?.get(i),
          textureEdgeRepairEdges: repairEdges[i],
          lightOccludedPolyIndices,
        },
        basisHints[i],
      ));
    },
    [renderPolygon, directVoxelEnabled, polygons, bakedDirectional, bakedPointLights, effectiveAmbient, effectiveSeamBleed, lightOccludedPolyIndices],
  );
  const textureAtlas = useTextureAtlas(
    atlasPlans,
    effectiveTextureLighting,
    textureQuality,
    effectiveTextureLeafSizing,
    effectiveTextureBackend,
    effectiveTextureImageRendering,
    effectiveTextureProjection,
    effectiveStrategies,
    atomicAtlas,
  );
  textureReadyRef.current = textureAtlas.ready;
  useEffect(() => {
    if (textureAtlas.ready) resolveTextureReadyWaiters();
  }, [textureAtlas.ready, resolveTextureReadyWaiters]);
  useEffect(() => resolveTextureReadyWaiters, [resolveTextureReadyWaiters]);
  // Use the displayed plans (which lag in atomic mode) so solid leaves swap in
  // lockstep with the textured ones.
  const solidPaintDefaults = useMemo(
    () => !renderPolygon ? getSolidPaintDefaults(textureAtlas.plans, effectiveTextureLighting, effectiveStrategies) : {},
    [renderPolygon, textureAtlas.plans, effectiveTextureLighting, effectiveStrategies],
  );
  // In atomic mode the returned entries reference only changes when the frame
  // actually swaps (decoded), so fire onFrameReady there for preview handoff.
  // useLayoutEffect (not useEffect) so a consumer that resets a preview
  // transform does it BEFORE the swapped frame paints — otherwise the new
  // geometry paints one frame with the stale preview scale still applied.
  const onFrameReadyRef = useRef(onFrameReady);
  onFrameReadyRef.current = onFrameReady;
  useLayoutEffect(() => {
    if (atomicAtlas && textureAtlas.ready) onFrameReadyRef.current?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [textureAtlas.entries]);
  const defaultPaintVars = useMemo(
    () => solidPaintVars(solidPaintDefaults),
    [solidPaintDefaults],
  );

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
    // uses, with the same 0.5/0.95 thresholds).
    const dedupDrop = findOverlappingPolygonDuplicates(polygons, {
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
  useEffect(() => {
    if (!sceneRegisterShadowCaster || !castShadow) return;
    return () => {
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
    lastShadowPolyCountRef.current = polygons.length;
    shadowCasterRegisteredRef.current = true;
    sceneRegisterShadowCaster(meshIdRef.current, {
      polygons,
      position: position ?? [0, 0, 0],
      scale,
      rotation,
      renderedPolygonIndices,
      shadowDefinition,
    });
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

  // Per-mesh shadow `<svg>` — same path for both lighting modes. Every
  // casting polygon is projected to the ground on the CPU and
  // concatenated into one compound <path d="M…L…Z M…L…Z …"> under
  // fill-rule=nonzero, so overlapping CCW outlines composite as one
  // filled silhouette without alpha stacking; gaps between subpaths
  // remain as gaps (the shadow preserves the silhouette's holes for
  // free); back-facing polys are dropped up front.
  const bakedShadowGroundCssZ = sceneCtx?.groundCssZ ?? null;
  const sceneShadow = sceneCtx?.shadow;
  const sceneHasReceiver = sceneCtx?.hasShadowReceiver ?? false;
  const shadowSvgNode = useMemo<ReactNode>(() => {
    if (!castShadow || renderPolygon) return null;
    // Three.js parity: when a receiveShadow mesh exists, casters drop their
    // ground-shadow fallback so the receiver paints the only shadow pass.
    if (sceneHasReceiver) return null;
    if (bakedShadowGroundCssZ === null) return null;

    // World→CSS axis swap so the light direction matches the CSS-frame
    // vertex projection below (vertices are × BASE_TILE with v[1]→x, v[0]→y).
    const userGroundLightDir = sceneDirectionalLight?.direction
      ?? ([0.4, -0.7, 0.59] as Vec3);
    const lightDir = worldDirectionToCss(userGroundLightDir);

    // Project shadows into the MESH WRAPPER's local frame so that the
    // SVG, which is rendered as a child of `.polycss-mesh` and inherits
    // its `translate3d(position * BASE_TILE)`, lands on the absolute
    // scene ground (cssZ = bakedShadowGroundCssZ) — not lifted by the
    // mesh's own world position. Vanilla's groundShadow.ts handles this
    // by adding `worldPositionToCss(position)` to every vertex and
    // mounting the SVG directly on the scene root; we keep the SVG in
    // the wrapper and compensate by subtracting the wrapper's Z
    // translation from the projection plane instead.
    const meshPosZ = position?.[2] ?? 0;
    const localGroundCssZ = bakedShadowGroundCssZ - meshPosZ * BASE_TILE;
    const shadowDedupDrop = findOverlappingPolygonDuplicates(polygons, {
      normalTolerance: 0.1,
      distanceTolerance: 0.5,
      overlapFraction: 0.95,
      preserveDoubleSidedBackfaces: false,
    });

    const projections: Array<Array<[number, number]>> = [];
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    // Footprint = the mesh's straight-down (no-shear) silhouette bbox,
    // used by the cap below as the anchor the shadow must always fully
    // contain.
    let fpMinX = Infinity, fpMinY = Infinity, fpMaxX = -Infinity, fpMaxY = -Infinity;
    // Iterate every casting polygon — no Lambert cull. Closed convex
    // meshes don't need the back side, but thin/open meshes (bat wings,
    // cloth, single quad) need both sides projected or the silhouette
    // gets real holes.
    for (let i = 0; i < polygons.length; i++) {
      const polygon = polygons[i]!;
      if (shadowDedupDrop.has(i)) continue;
      const plan = atlasPlans[i];
      if (!plan) continue;
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
    // which forces the browser to rasterize a >100M-pixel backing store
    // on every repaint (visible as scene-wide flicker when the camera
    // or light moves). The footprint (no-shear silhouette) stays fully
    // inside the SVG so the shadow under/next to the mesh is preserved
    // — we only truncate the sheared end that's off-screen anyway.
    // overflow:hidden does the actual clipping. Callers can disable
    // the cap by passing shadow.maxExtend=Infinity on PolyScene.
    const maxExtend = sceneShadow?.maxExtend ?? 2000;
    const bx0 = Math.max(minX, fpMinX - maxExtend);
    const by0 = Math.max(minY, fpMinY - maxExtend);
    const bx1 = Math.min(maxX, fpMaxX + maxExtend);
    const by1 = Math.min(maxY, fpMaxY + maxExtend);
    const width = bx1 - bx0;
    const height = by1 - by0;
    if (!(width > 0) || !(height > 0)) return null;

    const shadowColor = sceneShadow?.color ?? "#000000";
    const shadowOpacity = sceneShadow?.opacity ?? 0.25;
    const parsed = parseHexColor(shadowColor)?.rgb ?? [0, 0, 0];

    // Concatenate every projection into ONE compound `d` string. Each
    // polygon becomes its own M…L…Z subpath, normalized to CCW so all
    // windings agree and fill-rule=nonzero paints overlapping outlines
    // as one filled silhouette without alpha stacking. Gaps between
    // subpaths remain as gaps (the shadow preserves the silhouette's
    // holes for free).
    let d = "";
    for (const verts of projections) {
      const ccw = ensureCcw2D(verts);
      d += `M${(ccw[0]![0] - bx0).toFixed(3)},${(ccw[0]![1] - by0).toFixed(3)}`;
      for (let j = 1; j < ccw.length; j++) {
        d += `L${(ccw[j]![0] - bx0).toFixed(3)},${(ccw[j]![1] - by0).toFixed(3)}`;
      }
      d += "Z";
    }

    return (
      <svg
        key="shadow-svg"
        className="polycss-shadow polycss-shadow-svg"
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          display: "block",
          overflow: "hidden",
          transformOrigin: "0 0",
          pointerEvents: "none",
          willChange: "transform",
          transform: `translate3d(${bx0.toFixed(3)}px,${by0.toFixed(3)}px,${localGroundCssZ.toFixed(3)}px)`,
        }}
      >
        <path
          d={d}
          fill={`rgb(${parsed[0]},${parsed[1]},${parsed[2]})`}
          fillRule="nonzero"
          stroke={`rgb(${parsed[0]},${parsed[1]},${parsed[2]})`}
          strokeWidth="3"
          strokeLinejoin="round"
          opacity={shadowOpacity.toFixed(4)}
        />
      </svg>
    );
  }, [castShadow, renderPolygon, polygons, atlasPlans, sceneDirectionalLight, bakedShadowGroundCssZ, sceneShadow, sceneHasReceiver]);

  // Receiver-face shadows. For each coplanar surface group on this mesh,
  // project every registered caster polygon along the directional light,
  // Sutherland-Hodgman-clip to the face outline, and emit one <svg> per
  // visible group. Mirrors vanilla's emitReceiverShadows path.
  const shadowCasters = sceneCtx?.shadowCasters;
  const shadowCastersVersion = sceneCtx?.shadowCastersVersion ?? 0;
  const [cameraTick, setCameraTick] = useState(0);
  useEffect(() => {
    if (!receiveShadow) return;
    return cameraCtx?.store.subscribe(() => setCameraTick((n) => n + 1));
  }, [receiveShadow, cameraCtx?.store]);
  void cameraTick;
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
      // Cast from EVERY polygon — geometry casts a shadow regardless of
      // whether it's painted for the camera (atlas plan / renderedPolygon-
      // Indices). Filtering to rendered polys left camera-dependent holes in
      // the floor shadow of imported meshes (a poly facing the light but not
      // the camera vanished). Coincident projections merge under the
      // per-mesh `fill-rule: nonzero`, so no dedup is needed here. Mirrors
      // the vanilla fix in packages/polycss/src/api/scene/receiverShadow.ts.
      const items = prepareCasterPolyItems(
        data.polygons,
        data.position,
        data.scale,
        () => true,
        data.rotation ?? null,
      );
      // Self-shadow seam cull: when the caster IS this mesh, pass the
      // shared-edge adjacency map so the algorithm skips projecting
      // edge-sharing neighbour polygons (kills the spiderweb seam
      // shadows on smooth GLB meshes — apple, sphere, teapot).
      const isSelf = data.polygons === polygons;
      const selfMap = isSelf ? selfShadowEdgeMap : undefined;
      // H9 silhouette path: build/reuse world-frame edge owners for
      // non-self casters with enough polygons. The cache key matches the
      // transform fields fed into `prepareCasterPolyItems` so the world-
      // frame owners stay consistent with the matching items.
      // Point-light passes always need edgeOwners (the radial shadow projects
      // the caster silhouette, even for a small cube). Directional keeps the
      // ≥40-poly gate; core's directional branch ignores edgeOwners below that
      // threshold, so providing it here doesn't change directional behavior.
      let edgeOwners: ReadonlyMap<string, EdgeOwners> | undefined;
      if (!isSelf && (data.polygons.length >= 40 || hasShadowPoints)) {
        const dposArr = data.position;
        const drot = data.rotation ?? null;
        const dsKey = JSON.stringify(data.scale ?? null);
        const eoKey = `${dposArr[0]},${dposArr[1]},${dposArr[2]}|${drot ? drot.join(",") : "n"}|${dsKey}`;
        let cachedOwners = reactEdgeOwnersCache.get(data.polygons);
        if (cachedOwners === undefined || reactEdgeOwnersCacheKey.get(data.polygons) !== eoKey) {
          cachedOwners = prepareCasterEdgeOwners(data.polygons, dposArr, data.scale, drot);
          reactEdgeOwnersCache.set(data.polygons, cachedOwners);
          reactEdgeOwnersCacheKey.set(data.polygons, eoKey);
        }
        edgeOwners = cachedOwners;
      }
      // Parametric override: low-res silhouette loops (shared core helper, so
      // vanilla/React/Vue are identical). Per-mesh `shadowDefinition` beats the
      // scene default; directional + per-point-light radial silhouettes.
      let overrideSilhouette: Vec3[][] | undefined;
      let overridePointSilhouettes: Array<Vec3[][] | undefined> | undefined;
      if (sceneShadow?.parametric) {
        const def = data.shadowDefinition ?? sceneShadow.definition ?? 16;
        const result = buildParametricCasterOverride({
          polysWorldVerts: items.map((it) => it.wv),
          lightDir,
          definition: def,
          isSelf,
          style: sceneShadow.style,
          pointLights: shadowPointIndices.map((i) => ({ position: allPointLightsCss[i]!.position, index: i })),
        });
        overrideSilhouette = result.overrideSilhouette;
        overridePointSilhouettes = result.overridePointSilhouettes;
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
  }, [receiveShadow, shadowCasters, shadowCastersVersion, polygons, position, scale, rotation, sceneDirectionalLight, sceneCtx?.pointLights, effectiveTextureLighting, sceneShadow, sceneCtx?.ambientLight, cameraCtx?.store, cameraTick, selfShadowEdgeMap]);

  // Portal receiver shadow SVGs OUT of `.polycss-mesh` into `.polycss-scene`.
  // The SVG `matrix3d(...)` already includes this mesh's `position` (baked
  // into world space by `prepareReceiverFacePlanes`), so leaving them inside
  // the mesh wrapper would double-count `translate3d(position)`. Vanilla
  // mounts these at scene-root for the same reason.
  const portalSceneEl = sceneCtx?.sceneEl ?? null;
  const portaledReceiverShadowSvgs = portalSceneEl && receiverShadowSvgs
    ? createPortal(receiverShadowSvgs, portalSceneEl)
    : null;

  setPolygonsImplRef.current = (nextPolygons: Polygon[]) => {
    const nextRenderedPolygons = autoCenter ? recenterPolygons(nextPolygons) : nextPolygons;
    polygonsRef.current = nextRenderedPolygons;
    const root = wrapperRef.current;
    if (
      root &&
      !renderPolygon &&
      updateStableTriangleDom(root, nextRenderedPolygons, {
        directionalLight: bakedDirectional,
        ambientLight: effectiveAmbient,
        textureLighting: effectiveTextureLighting,
        strategies: effectiveStrategies,
        seamBleed: effectiveSeamBleed,
        colorFrame: ++stableTriangleColorFrameRef.current,
        // Animated low-poly triangles can swing face normals sharply; keep the
        // mounted baked color pinned and animate transforms only.
        colorFreezeFrames: 0,
      })
    ) {
      return;
    }
    setLocalPolygons([...nextPolygons]);
  };

  const voxelRendererRef = useRef<PolyVoxelRenderer | null>(null);
  useLayoutEffect(() => {
    const root = wrapperRef.current;
    voxelRendererRef.current?.dispose();
    voxelRendererRef.current = null;
    if (!directVoxelEnabled || !root) return;

    const renderer = createPolyVoxelRenderer({
      doc: root.ownerDocument,
      wrapper: root,
      polygons,
      directionalLight: bakedDirectional,
      ambientLight: effectiveAmbient,
    });
    if (!renderer) return;

    const cameraRotation = () => {
      const cameraState = cameraCtx?.store.getState().cameraState;
      return {
        rotX: cameraState?.rotX ?? 65,
        rotY: cameraState?.rotY ?? 45,
        meshRotation: rotation,
      };
    };

    voxelRendererRef.current = renderer;
    renderer.render(cameraRotation());
    const unsubscribe = cameraCtx?.store.subscribe(() => {
      renderer.syncCamera(cameraRotation());
    });

    return () => {
      unsubscribe?.();
      renderer.dispose();
      if (voxelRendererRef.current === renderer) voxelRendererRef.current = null;
    };
  }, [
    directVoxelEnabled,
    polygons,
    bakedDirectional,
    effectiveAmbient,
    cameraCtx?.store,
    rotation,
  ]);

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
