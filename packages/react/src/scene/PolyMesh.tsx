/**
 * PolyMesh — load a mesh URL (or accept a polygons array) and render its
 * polygons inside a `.polycss-mesh` wrapper that carries the mesh-wide
 * position/scale/rotation transform. Per §API freeze and §Design.4c.
 *
 * Uses nested DOM (preserve-3d) so the wrapper transform composes with each
 * atlas polygon's vertex matrix3d via CSS without JS doing the matrix math.
 *
 * Render-prop semantics (per §2a "Render-prop semantics"):
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
  PolyTextureLightingMode,
  Vec3,
} from "@layoutit/polycss-core";
import {
  BASE_TILE,
  computeSceneBbox,
  DEFAULT_SEAM_BLEED,
  ensureCcw2D,
  findOverlappingPolygonDuplicates,
  inverseRotateVec3,
  parseHexColor,
  projectCssVertexToGround,
} from "@layoutit/polycss-core";
import type { TransformProps } from "../shapes/types";
import { usePolyMesh, type UseMeshOptions } from "./useMesh";
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
  TextureProjectiveSolidPoly,
  TextureTrianglePoly,
  updateStableTriangleDom,
  useTextureAtlas,
} from "./atlas";
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
  /** Translate so mesh's bbox center is at local origin before applying `position`. */
  autoCenter?: boolean;
  /** Textured polygon lighting mode. Defaults to "baked". */
  textureLighting?: PolyTextureLightingMode;
  /** Atlas bitmap budget and CSS sprite size. `"auto"` (default) uses a
   *  device-appropriate memory budget (~4 MB mobile / ~16 MB desktop) and
   *  desktop/mobile sprite sizing. Numeric values 0.1..1 force an explicit
   *  raster scale and the 64px sprite. */
  textureQuality?: TextureQuality;
  /** Solid seam overscan. `"auto"` computes a fitted per-edge amount from the polygon plan. */
  seamBleed?: PolySeamBleed;
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
   * When `true` and the scene is in dynamic lighting mode, emits a flat
   * shadow leaf (`<q class="polycss-shadow">`) sibling for each polygon.
   * The shadow is projected onto the ground plane along the CSS-space light
   * direction via `--shadow-proj` (a CSS var on the scene root). Zero JS in
   * the render loop — projection is pure `calc()`. Defaults to `false`.
   */
  castShadow?: boolean;
  className?: string;
  style?: CSSProperties;
}

/**
 * Build the mesh wrapper's CSS transform from a Three.js-style transform
 * (post-parity convention):
 *   - `position` is in WORLD UNITS (`+X right, +Y forward, +Z up`); the
 *     renderer applies the world→CSS axis swap (`world.x → CSS.y`,
 *     `world.y → CSS.x`) and ×`BASE_TILE` scale here.
 *   - `scale` pivots from the mesh ORIGIN (Three.js `mesh.scale` semantics —
 *     a vertex at z=0 stays at z=0 so a scaled mesh "lands" on the floor
 *     instead of floating). The browser's `transform-origin` is the polygon
 *     bbox center, so we compose `M_string = T(pos - bbox) · S · T(bbox)` to
 *     end up with `M_eff = T(pos) · S(around origin) · R(around bbox)`.
 *   - `rotation` pivots from the bbox center (PolyCSS UX — rotating around
 *     the visible center feels right).
 *
 * Mirror of the vanilla `buildMeshTransform` in
 * `packages/polycss/src/api/scene/transforms.ts`.
 */
function buildTransform(
  position: Vec3 | undefined,
  scale: number | Vec3 | undefined,
  rotation: Vec3 | undefined,
  bboxCenterCss: Vec3 | undefined,
): string | undefined {
  const sx = typeof scale === "number" ? scale : (scale?.[0] ?? 1);
  const sy = typeof scale === "number" ? scale : (scale?.[1] ?? 1);
  const sz = typeof scale === "number" ? scale : (scale?.[2] ?? 1);
  const hasScale = sx !== 1 || sy !== 1 || sz !== 1;
  const hasRotation = !!rotation && (!!rotation[0] || !!rotation[1] || !!rotation[2]);
  // World→CSS axis swap + ×BASE_TILE on `position`.
  const cssPos: Vec3 = position
    ? [position[1] * BASE_TILE, position[0] * BASE_TILE, position[2] * BASE_TILE]
    : [0, 0, 0];
  const bx = bboxCenterCss?.[0] ?? 0;
  const by = bboxCenterCss?.[1] ?? 0;
  const bz = bboxCenterCss?.[2] ?? 0;
  const hasBbox = bx !== 0 || by !== 0 || bz !== 0;

  const parts: string[] = [];
  const tx = cssPos[0] - (hasScale && hasBbox ? bx : 0);
  const ty = cssPos[1] - (hasScale && hasBbox ? by : 0);
  const tz = cssPos[2] - (hasScale && hasBbox ? bz : 0);
  if (tx !== 0 || ty !== 0 || tz !== 0) {
    parts.push(`translate3d(${tx}px, ${ty}px, ${tz}px)`);
  }
  if (hasScale) {
    parts.push(`scale3d(${sx}, ${sy}, ${sz})`);
    if (hasBbox) parts.push(`translate3d(${bx}px, ${by}px, ${bz}px)`);
  }
  if (hasRotation) {
    if (rotation![0]) parts.push(`rotateX(${rotation![0]}deg)`);
    if (rotation![1]) parts.push(`rotateY(${rotation![1]}deg)`);
    if (rotation![2]) parts.push(`rotateZ(${rotation![2]}deg)`);
  }
  return parts.length > 0 ? parts.join(" ") : undefined;
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
    autoCenter,
    textureLighting,
    textureQuality,
    seamBleed,
    castShadow,
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
  const externalVoxelSource = src ? fetched.voxelSource : undefined;

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

  const sourcePolygons = localPolygons ?? externalPolygons;
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

  // Polygon bbox CENTER in CSS world coords. Shared by `transformOrigin`
  // (the `.polycss-mesh` CSS pivot, matching vanilla's
  // `transform-origin: var(--origin)`) AND by `buildTransform` (the
  // scale-from-mesh-origin math needs the bbox to compute its T(pos - bbox)
  // pre-translation). Computed once per polygon-list identity.
  const bboxCenterCss = useMemo<Vec3 | undefined>(() => {
    if (polygons.length === 0) return undefined;
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (const poly of polygons) {
      for (const v of poly.vertices) {
        if (v[0] < minX) minX = v[0]; if (v[0] > maxX) maxX = v[0];
        if (v[1] < minY) minY = v[1]; if (v[1] > maxY) maxY = v[1];
        if (v[2] < minZ) minZ = v[2]; if (v[2] > maxZ) maxZ = v[2];
      }
    }
    if (!Number.isFinite(minX)) return undefined;
    // World→CSS axis swap: world[1]→CSS x, world[0]→CSS y, world[2]→CSS z.
    return [
      ((minY + maxY) / 2) * BASE_TILE,
      ((minX + maxX) / 2) * BASE_TILE,
      ((minZ + maxZ) / 2) * BASE_TILE,
    ];
  }, [polygons]);

  const transform = buildTransform(position, scale, rotation, bboxCenterCss);

  const transformOrigin = useMemo(
    () => bboxCenterCss
      ? `${bboxCenterCss[0]}px ${bboxCenterCss[1]}px ${bboxCenterCss[2]}px`
      : undefined,
    [bboxCenterCss],
  );

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
  const effectiveDirectional =
    effectiveTextureLighting === "dynamic" ? undefined : sceneCtx?.directionalLight;
  const effectiveAmbient =
    effectiveTextureLighting === "dynamic" ? undefined : sceneCtx?.ambientLight;

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
    return {
      ["--plx" as string]: (localDir[0] / len).toFixed(4),
      ["--ply" as string]: (localDir[1] / len).toFixed(4),
      ["--plz" as string]: (localDir[2] / len).toFixed(4),
    };
  }, [effectiveTextureLighting, rotation, sceneDirectionalLight]);

  // Compute the effective light direction for baking. If the mesh has been
  // rotated since mount (bakedRotation), inverse-rotate the world-space
  // light direction into the mesh's local frame so the Lambert dot product
  // stays correct: dot(localNormal, localLight) === dot(worldNormal, worldLight).
  const bakedDirectional = useMemo(() => {
    if (!effectiveDirectional) return effectiveDirectional;
    const rot = bakedRotation ?? [0, 0, 0] as Vec3;
    if (rot[0] === 0 && rot[1] === 0 && rot[2] === 0) return effectiveDirectional;
    return {
      ...effectiveDirectional,
      direction: inverseRotateVec3(effectiveDirectional.direction, rot),
    };
  }, [effectiveDirectional, bakedRotation]);

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
      return polygons.map((p, i) => computeTextureAtlasPlan(p, i, {
        directionalLight: bakedDirectional,
        ambientLight: effectiveAmbient,
        seamBleed: seamBleedEdges?.has(i) ? effectiveSeamBleed : undefined,
        seamEdges: seamBleedEdges?.get(i),
        textureEdgeRepairEdges: repairEdges[i],
      }));
    },
    [renderPolygon, directVoxelEnabled, polygons, bakedDirectional, effectiveAmbient, effectiveSeamBleed],
  );
  const textureAtlas = useTextureAtlas(
    atlasPlans,
    effectiveTextureLighting,
    textureQuality,
    effectiveStrategies,
  );
  const solidPaintDefaults = useMemo(
    () => !renderPolygon ? getSolidPaintDefaults(atlasPlans, effectiveTextureLighting, effectiveStrategies) : {},
    [renderPolygon, atlasPlans, effectiveTextureLighting, effectiveStrategies],
  );
  const defaultPaintVars = useMemo(
    () => solidPaintVars(solidPaintDefaults),
    [solidPaintDefaults],
  );

  // Shadow casting. Stable mesh identity key — survives re-renders without
  // re-registering. Defined at component top-level via useRef.
  const meshIdRef = useRef<symbol>(Symbol());
  const sceneRegisterShadowCaster = sceneCtx?.registerShadowCaster;

  // Register/unregister as a shadow caster whenever castShadow or polygons change.
  // Both lighting modes need the registration so the scene can derive the
  // shadow ground plane from caster bboxes. Cleanup on unmount passes null
  // to deregister.
  useEffect(() => {
    if (!sceneRegisterShadowCaster) return;
    if (castShadow) {
      sceneRegisterShadowCaster(meshIdRef.current, polygons);
    } else {
      sceneRegisterShadowCaster(meshIdRef.current, null);
    }
    return () => {
      sceneRegisterShadowCaster(meshIdRef.current, null);
    };
  }, [sceneRegisterShadowCaster, castShadow, polygons]);

  // Per-mesh shadow `<svg>` — same path for both lighting modes. Every
  // casting polygon is projected to the ground on the CPU and
  // concatenated into one compound <path d="M…L…Z M…L…Z …"> under
  // fill-rule=nonzero, so overlapping CCW outlines composite as one
  // filled silhouette without alpha stacking; gaps between subpaths
  // remain as gaps (the shadow preserves the silhouette's holes for
  // free); back-facing polys are dropped up front.
  const bakedShadowGroundCssZ = sceneCtx?.groundCssZ ?? null;
  const sceneShadow = sceneCtx?.shadow;
  const shadowSvgNode = useMemo<ReactNode>(() => {
    if (!castShadow || renderPolygon) return null;
    if (bakedShadowGroundCssZ === null) return null;

    const lightDir = sceneDirectionalLight?.direction
      ?? ([0.4, -0.7, 0.59] as Vec3);
    const shadowDedupDrop = findOverlappingPolygonDuplicates(polygons, {
      normalTolerance: 0.1,
      distanceTolerance: 0.5,
      overlapFraction: 0.4,
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
        const p = projectCssVertexToGround(cssVertex, lightDir, bakedShadowGroundCssZ);
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
          transform: `translate3d(${bx0.toFixed(3)}px,${by0.toFixed(3)}px,${bakedShadowGroundCssZ.toFixed(3)}px)`,
        }}
      >
        <path
          d={d}
          fill={`rgb(${parsed[0]},${parsed[1]},${parsed[2]})`}
          fillRule="nonzero"
          stroke={`rgb(${parsed[0]},${parsed[1]},${parsed[2]})`}
          strokeWidth="2"
          strokeLinejoin="round"
          opacity={shadowOpacity.toFixed(4)}
        />
      </svg>
    );
  }, [castShadow, renderPolygon, polygons, atlasPlans, sceneDirectionalLight, bakedShadowGroundCssZ, sceneShadow]);

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
    ...(transformOrigin ? { transformOrigin } : null),
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
              solidPaintDefaults={solidPaintDefaults}
            />
          );
        }

        const plan = atlasPlans[index];
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
        return isSolidTrianglePlan(plan)
          ? (
              <TextureTrianglePoly
                key={plan.index}
                entry={plan}
                textureLighting={effectiveTextureLighting}
                solidPaintDefaults={solidPaintDefaults}
              />
            )
          : (
              <TextureBorderShapePoly
                key={plan.index}
                entry={plan}
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
