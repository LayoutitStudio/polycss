import { useCallback, useEffect, useRef } from "react";
import type { ParseAnimationController, PolyAmbientLight, PolyDirectionalLight, Polygon, Vec3 as ReactVec3 } from "@layoutit/polycss-react";
import {
  axesHelperPolygons,
  createPolyFirstPersonControls,
  createPolyOrbitControls,
  createPolyMapControls,
  createPolyOrthographicCamera,
  createPolyPerspectiveCamera,
  createPolyScene,
  createSelect,
  createTransformControls,
  octahedronPolygons,
} from "@layoutit/polycss";
import type {
  PolyControlsHandle,
  PolyFirstPersonControlsHandle,
  PolyMeshHandle as VanillaPolyMeshHandle,
  PolyMeshTransform,
  ParseResult,
  PolyOrthographicCameraHandle,
  PolyPerspectiveCameraHandle,
  PolySceneOptions,
  PolySceneHandle,
  PolySelectionHandle,
  PolyTransformControlsHandle,
  Vec3,
} from "@layoutit/polycss";
import { meshResolutionShowsMesh, type GizmoMode, type SceneOptionsState } from "../types";

export type { GizmoMode, SceneOptionsState };

// Light helper world units → CSS pixels conversion (matches the helper
// components in @layoutit/polycss-react and @layoutit/polycss-vue).
const LIGHT_HELPER_TILE = 50;
const ANIMATION_STABLE_TRIANGLE_COLOR_POLICY = "cadence";
// Deforming low-poly triangles can swing face normals sharply; keep the
// mounted baked color pinned and animate transforms only.
const ANIMATION_STABLE_TRIANGLE_COLOR_FREEZE_FRAMES = 0;
const ANIMATION_TRANSFORM_CACHE_FRAMES = 60;

interface StableTriangleTransformFrameItem {
  transform: string;
  visibility: string;
}

interface StableTriangleTransformCache {
  frames: Array<StableTriangleTransformFrameItem[] | undefined>;
  leaves: HTMLElement[] | null;
  leafCount: number;
  filled: number;
  disabled: boolean;
  canRefreshColor: boolean;
  lastAppliedFrameIndex: number;
}

function createStableTriangleTransformCache(): StableTriangleTransformCache {
  return {
    frames: Array.from({ length: ANIMATION_TRANSFORM_CACHE_FRAMES }),
    leaves: null,
    leafCount: 0,
    filled: 0,
    disabled: false,
    canRefreshColor: false,
    lastAppliedFrameIndex: -1,
  };
}

function resetStableTriangleTransformCache(cache: StableTriangleTransformCache): void {
  cache.frames.fill(undefined);
  cache.leaves = null;
  cache.leafCount = 0;
  cache.filled = 0;
  cache.canRefreshColor = false;
  cache.lastAppliedFrameIndex = -1;
}

function directStableAnimationLeaves(handle: VanillaPolyMeshHandle): HTMLElement[] {
  return Array.from(handle.element.querySelectorAll<HTMLElement>(":scope > u,:scope > s"));
}

function captureStableTriangleTransformFrame(
  handle: VanillaPolyMeshHandle,
  cache: StableTriangleTransformCache,
  frameIndex: number,
): void {
  if (cache.disabled) return;
  const leaves = directStableAnimationLeaves(handle);
  const expectedCount = handle.polygons.length;
  if (
    expectedCount <= 0 ||
    leaves.length !== expectedCount
  ) {
    cache.disabled = true;
    resetStableTriangleTransformCache(cache);
    return;
  }
  const canRefreshColor = leaves.every((leaf) => leaf.tagName === "U");
  if (
    cache.leafCount !== 0 &&
    (leaves.length !== cache.leafCount || cache.canRefreshColor !== canRefreshColor)
  ) {
    resetStableTriangleTransformCache(cache);
  }
  cache.leaves = leaves;
  cache.leafCount = leaves.length;
  cache.canRefreshColor = canRefreshColor;
  if (!cache.frames[frameIndex]) cache.filled += 1;
  cache.frames[frameIndex] = leaves.map((leaf) => ({
    transform: leaf.style.transform || "none",
    visibility: leaf.style.visibility === "hidden" ? "hidden" : "",
  }));
  cache.lastAppliedFrameIndex = frameIndex;
}

function applyStableTriangleTransformFrame(
  handle: VanillaPolyMeshHandle,
  cache: StableTriangleTransformCache,
  frameIndex: number,
): boolean {
  if (cache.disabled) return false;
  const frame = cache.frames[frameIndex];
  if (!frame) return false;
  if (
    cache.lastAppliedFrameIndex === frameIndex &&
    cache.leaves &&
    cache.leafCount === frame.length
  ) {
    return true;
  }
  const leaves = cache.leaves ?? directStableAnimationLeaves(handle);
  if (leaves.length !== frame.length) {
    resetStableTriangleTransformCache(cache);
    return false;
  }
  const previousFrame = cache.lastAppliedFrameIndex >= 0
    ? cache.frames[cache.lastAppliedFrameIndex]
    : undefined;
  cache.leaves = leaves;
  cache.leafCount = leaves.length;
  for (let i = 0; i < leaves.length; i += 1) {
    const leaf = leaves[i];
    const next = frame[i];
    const previous = previousFrame?.[i];
    if (previous?.transform !== next.transform) {
      leaf.style.transform = next.transform;
    }
    if (previous?.visibility !== next.visibility) {
      leaf.style.visibility = next.visibility;
    }
  }
  cache.lastAppliedFrameIndex = frameIndex;
  return true;
}

function animationCacheFrameIndex(
  timeSeconds: number,
  durationSeconds: number,
): number {
  const duration = Math.max(0.001, durationSeconds);
  const localTime = ((timeSeconds % duration) + duration) % duration;
  return Math.floor(
    (localTime / duration) * ANIMATION_TRANSFORM_CACHE_FRAMES,
  ) % ANIMATION_TRANSFORM_CACHE_FRAMES;
}

function lightHelperPosition(
  light: PolyDirectionalLight,
  target: Vec3,
  distance: number,
): Vec3 {
  const [dx, dy, dz] = light.direction;
  const len = Math.hypot(dx, dy, dz) || 1;
  return [
    (target[1] + (dx / len) * distance) * LIGHT_HELPER_TILE,
    (target[0] + (dy / len) * distance) * LIGHT_HELPER_TILE,
    (target[2] + (dz / len) * distance) * LIGHT_HELPER_TILE,
  ];
}

export interface VanillaSceneProps {
  polygons: Polygon[];
  interiorShellPolygons: Polygon[];
  parseResult?: ParseResult;
  options: SceneOptionsState;
  directionalLight: PolyDirectionalLight;
  ambientLight: PolyAmbientLight;
  showAxes: boolean;
  showLight: boolean;
  showGround: boolean;
  helperScale: number;
  helperTarget: Vec3;
  mergePolygonsForMesh: boolean;
  stableDomForMesh: boolean;
  animationKey?: string;
  animationDurationSeconds?: number;
  animationFrameFactory?: (timeSeconds: number) => Polygon[];
  onBuild: (ms: number) => void;
  onCameraChange?: (camera: { rotX: number; rotY: number; zoom: number; target?: ReactVec3 }) => void;
  enableSelection?: boolean;
  meshId?: string;
  onSelectionChange?: (selectedIds: string[]) => void;
  gizmoMode?: GizmoMode;
  enableHover?: boolean;
  onHoverChange?: (id: string | null) => void;
  onMeshHandleChange?: (handle: VanillaPolyMeshHandle | null) => void;
}

export function VanillaScene({
  polygons,
  interiorShellPolygons,
  parseResult,
  options,
  directionalLight,
  ambientLight,
  showAxes,
  showLight,
  showGround,
  helperScale,
  helperTarget,
  mergePolygonsForMesh,
  stableDomForMesh,
  animationKey,
  animationDurationSeconds,
  animationFrameFactory,
  onBuild,
  onCameraChange,
  enableSelection,
  meshId,
  onSelectionChange,
  gizmoMode,
  enableHover,
  onHoverChange,
  onMeshHandleChange,
}: VanillaSceneProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<PolySceneHandle | null>(null);
  const cameraRef = useRef<PolyPerspectiveCameraHandle | PolyOrthographicCameraHandle | null>(null);
  const controlsRef = useRef<PolyControlsHandle | PolyFirstPersonControlsHandle | null>(null);
  const meshHandleRef = useRef<VanillaPolyMeshHandle | null>(null);
  const interiorShellHandleRef = useRef<VanillaPolyMeshHandle | null>(null);
  const axesHandleRef = useRef<VanillaPolyMeshHandle | null>(null);
  const lightHandleRef = useRef<VanillaPolyMeshHandle | null>(null);
  const groundHandleRef = useRef<VanillaPolyMeshHandle | null>(null);
  const selectionRef = useRef<PolySelectionHandle | null>(null);
  const transformControlsRef = useRef<PolyTransformControlsHandle | null>(null);
  const onBuildRef = useRef(onBuild);
  onBuildRef.current = onBuild;
  const onCameraChangeRef = useRef(onCameraChange);
  onCameraChangeRef.current = onCameraChange;
  const onSelectionChangeRef = useRef(onSelectionChange);
  onSelectionChangeRef.current = onSelectionChange;
  const onHoverChangeRef = useRef(onHoverChange);
  onHoverChangeRef.current = onHoverChange;
  const onMeshHandleChangeRef = useRef(onMeshHandleChange);
  onMeshHandleChangeRef.current = onMeshHandleChange;
  const animationPausedRef = useRef(options.animationPaused);
  animationPausedRef.current = options.animationPaused;
  const animationTimeScaleRef = useRef(options.animationTimeScale);
  animationTimeScaleRef.current = options.animationTimeScale;
  const mountedModelRef = useRef<{
    handle: VanillaPolyMeshHandle;
    polygons: Polygon[];
    merge: boolean;
    stableDom: boolean;
  } | null>(null);
  const mountChildMeshInsideModel = useCallback((child: VanillaPolyMeshHandle | null) => {
    const modelEl = meshHandleRef.current?.element;
    const childEl = child?.element;
    if (!modelEl || !childEl) return;
    if (childEl.parentElement !== modelEl || childEl.nextSibling !== null) {
      modelEl.appendChild(childEl);
    }
  }, []);

  // Split things into "structural" (require destroying the scene) vs
  // "incremental" (can be applied via setOptions / setTransform). In
  // dynamic mode the chicken's atlas is light-independent, so we drop the
  // light from the structural deps — sliding the light then only flows
  // through the cheap setOptions effect, no flicker.
  const stableDirectionalForRebuild =
    options.textureLighting === "dynamic" ? null : directionalLight;
  const stableAmbientForRebuild =
    options.textureLighting === "dynamic" ? null : ambientLight;

  // Effect 1 — heavy: create the scene + add the current polygons once.
  // Polygon replacement is handled by Effect 1.5 so animation frames do not
  // tear down controls/helpers.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    host.innerHTML = "";
    const cameraOpts = {
      rotX: options.rotX,
      rotY: options.rotY,
      zoom: options.zoom,
      target: options.target as Vec3 | undefined,
    };
    const camera = options.perspective
      ? createPolyPerspectiveCamera({ ...cameraOpts, perspective: options.perspective })
      : createPolyOrthographicCamera(cameraOpts);
    cameraRef.current = camera;
    const sceneOptions: PolySceneOptions = {
      camera,
      directionalLight,
      ambientLight,
      textureLighting: options.textureLighting,
      autoCenter: options.autoCenter,
      textureQuality: options.textureQuality,
      strategies: { disable: options.disableStrategies },
      shadow: { maxExtend: options.shadowMaxExtend },
    };
    const scene = createPolyScene(host, sceneOptions);
    sceneRef.current = scene;
    const meshTransform = {
      merge: mergePolygonsForMesh,
      stableDom: stableDomForMesh,
      id: meshId,
      castShadow: options.castShadow,
    } as PolyMeshTransform;
    const modelParseResult: ParseResult = parseResult
      ? {
          ...parseResult,
          polygons,
          dispose: () => {},
        }
      : {
          polygons,
          objectUrls: [],
          warnings: [],
          dispose: () => {},
        };
    meshHandleRef.current = scene.add(modelParseResult, meshTransform);
    mountedModelRef.current = {
      handle: meshHandleRef.current,
      polygons,
      merge: mergePolygonsForMesh,
      stableDom: stableDomForMesh,
    };
    meshHandleRef.current.element.classList.add("dn-model-mesh");
    meshHandleRef.current.element.classList.toggle("is-mesh-hidden", !meshResolutionShowsMesh(options.meshResolution));
    onMeshHandleChangeRef.current?.(meshHandleRef.current);
    return () => {
      // Tear controls down BEFORE destroying the scene — otherwise the
      // controls' rAF tick could fire one more time against a stale handle.
      onMeshHandleChangeRef.current?.(null);
      controlsRef.current?.destroy();
      controlsRef.current = null;
      axesHandleRef.current = null;
      lightHandleRef.current = null;
      groundHandleRef.current = null;
      interiorShellHandleRef.current = null;
      mountedModelRef.current = null;
      meshHandleRef.current = null;
      sceneRef.current = null;
      cameraRef.current = null;
      scene.destroy();
    };
  }, [
    options.autoCenter,
    options.textureQuality,
    options.textureLighting,
    options.perspective,
    stableDirectionalForRebuild,
    stableAmbientForRebuild,
    stableDomForMesh,
    parseResult,
  ]);

  useEffect(() => {
    meshHandleRef.current?.element.classList.toggle("is-mesh-hidden", !meshResolutionShowsMesh(options.meshResolution));
  }, [options.meshResolution]);

  // Effect 1.5 — replace geometry on the existing mesh. This is the path
  // used by animated GLB playback; seam bleed is already baked into the
  // polygon list before the mesh reaches this renderer. The interior shell
  // is a separate non-shadow mesh mounted inside the model wrapper so it
  // inherits the same mesh transform without changing auto-centering.
  useEffect(() => {
    const handle = meshHandleRef.current;
    const scene = sceneRef.current;
    if (!handle || !scene) return;
    const started = performance.now();
    const mounted = mountedModelRef.current;
    const modelAlreadyMounted =
      mounted?.handle === handle &&
      mounted.polygons === polygons &&
      mounted.merge === mergePolygonsForMesh &&
      mounted.stableDom === stableDomForMesh;
    if (!modelAlreadyMounted) {
      handle.setPolygons(polygons, {
        merge: mergePolygonsForMesh,
        stableDom: stableDomForMesh,
      });
      mountedModelRef.current = {
        handle,
        polygons,
        merge: mergePolygonsForMesh,
        stableDom: stableDomForMesh,
      };
    }

    let shellHandle = interiorShellHandleRef.current;
    if (interiorShellPolygons.length === 0) {
      shellHandle?.dispose();
      interiorShellHandleRef.current = null;
    } else if (shellHandle) {
      shellHandle.setPolygons(interiorShellPolygons, {
        merge: false,
        stableDom: stableDomForMesh,
        recomputeAutoCenter: false,
      });
      mountChildMeshInsideModel(shellHandle);
    } else {
      shellHandle = scene.add(
        {
          polygons: interiorShellPolygons,
          objectUrls: [],
          warnings: [],
          dispose: () => {},
        },
        {
          merge: false,
          stableDom: stableDomForMesh,
          excludeFromAutoCenter: true,
          castShadow: false,
        },
      );
      shellHandle.element.classList.add("dn-interior-shell-mesh");
      interiorShellHandleRef.current = shellHandle;
      mountChildMeshInsideModel(shellHandle);
    }

    requestAnimationFrame(() =>
      onBuildRef.current(performance.now() - started),
    );
  }, [
    polygons,
    interiorShellPolygons,
    mergePolygonsForMesh,
    stableDomForMesh,
    mountChildMeshInsideModel,
  ]);

  // Effect 1.6 — live-toggle castShadow without rebuilding the scene.
  useEffect(() => {
    const handle = meshHandleRef.current;
    if (!handle) return;
    handle.setTransform({ castShadow: options.castShadow });
  }, [options.castShadow]);

  // Selection + transform-controls layer. Selection toggle controls
  // both — when on, clicking the mesh selects it (and attaches the
  // gizmo); clicking again deselects (and detaches). The gizmo's
  // mode follows `gizmoMode` (translate / rotate).
  useEffect(() => {
    if (!enableSelection) {
      selectionRef.current?.destroy();
      selectionRef.current = null;
      transformControlsRef.current?.destroy();
      transformControlsRef.current = null;
      onSelectionChangeRef.current?.([]);
      return;
    }
    const scene = sceneRef.current;
    if (!scene) return;
    const tc = createTransformControls(scene, {
      mode: gizmoMode ?? "translate",
    });
    transformControlsRef.current = tc;
    const select = createSelect(scene, {
      clearOnMiss: false,
      onChange: (meshes) => {
        // Drive the gizmo from selection: attach to the first selected
        // mesh, or detach when nothing is selected.
        tc.attach(meshes[0] ?? null);
        onSelectionChangeRef.current?.(meshes.map((m) => m.id ?? ""));
      },
    });
    selectionRef.current = select;
    return () => {
      select.destroy();
      tc.destroy();
      selectionRef.current = null;
      transformControlsRef.current = null;
    };
  }, [
    enableSelection,
    // Same deps as the scene-init effect so the selection rebinds to
    // the new PolySceneHandle whenever the scene tears down + rebuilds.
    options.autoCenter,
    options.textureQuality,
    options.textureLighting,
    options.perspective,
    stableDirectionalForRebuild,
    stableAmbientForRebuild,
    stableDomForMesh,
    parseResult,
  ]);

  // Forward gizmo mode changes to the live PolyTransformControls handle.
  useEffect(() => {
    transformControlsRef.current?.setMode(gizmoMode ?? "translate");
  }, [gizmoMode]);

  // Hover layer for vanilla — pointerenter / pointerleave on the mesh
  // wrapper. DOM enter/leave semantics fire only when the pointer
  // actually crosses the wrapper boundary (not on every internal
  // polygon-to-polygon transition), so the hover state stays stable
  // across the chicken's many `<i>` polygons. Adds the `is-hovered`
  // class so the same `.polycss-mesh.is-hovered i { filter: brightness }`
  // rule the React path uses kicks in here too.
  useEffect(() => {
    const mesh = meshHandleRef.current;
    if (!mesh || !enableHover) {
      onHoverChangeRef.current?.(null);
      return;
    }
    const onEnter = (): void => {
      mesh.element.classList.add("is-hovered");
      onHoverChangeRef.current?.(mesh.id ?? null);
    };
    const onLeave = (): void => {
      mesh.element.classList.remove("is-hovered");
      onHoverChangeRef.current?.(null);
    };
    mesh.element.addEventListener("pointerenter", onEnter);
    mesh.element.addEventListener("pointerleave", onLeave);
    return () => {
      mesh.element.removeEventListener("pointerenter", onEnter);
      mesh.element.removeEventListener("pointerleave", onLeave);
      mesh.element.classList.remove("is-hovered");
    };
  }, [
    enableHover,
    // Same deps as the scene-init effect so the hover listener
    // reattaches to the new mesh wrapper after a scene rebuild.
    options.autoCenter,
    options.textureQuality,
    options.textureLighting,
    options.perspective,
    stableDirectionalForRebuild,
    stableAmbientForRebuild,
    stableDomForMesh,
    parseResult,
  ]);

  useEffect(() => {
    if (!animationFrameFactory || !animationKey) return;
    let raf = 0;
    let last = performance.now();
    let elapsedSeconds = 0;
    let sampledSeconds: number | null = null;
    let animationFrameCount = 0;
    let lastAnimatedPolygonCount = 0;
    const transformCache =
      stableDomForMesh &&
      options.textureLighting === "baked" &&
      typeof animationDurationSeconds === "number" &&
      animationDurationSeconds > 0
        ? createStableTriangleTransformCache()
        : null;

    const tick = (now: number) => {
      const deltaSeconds = Math.max(0, (now - last) / 1000);
      last = now;
      if (!animationPausedRef.current) {
        elapsedSeconds += deltaSeconds * animationTimeScaleRef.current;
      }
      const handle = meshHandleRef.current;
      if (handle && sampledSeconds !== elapsedSeconds) {
        sampledSeconds = elapsedSeconds;
        animationFrameCount += 1;
        const debugTarget = window as unknown as {
          __polycssGalleryAnimationSamples?: Array<{
            t: number;
            sampleMs: number;
            setPolygonsMs: number;
            polygons: number;
            transformCacheHit?: boolean;
            transformCacheFilled?: number;
            transformCacheMs?: number;
          }>;
          __polycssStableTriangleDebug?: "transform-only" | "plan-only";
        };
        const stableTriangleDebug = debugTarget.__polycssStableTriangleDebug;
        const setPolygonsOptions = {
          merge: false,
          stableDom: true,
          recomputeAutoCenter: false,
          ...(stableTriangleDebug === "transform-only" || stableTriangleDebug === "plan-only"
            ? { stableTriangleDebug }
            : {}),
          stableTriangleColorPolicy: ANIMATION_STABLE_TRIANGLE_COLOR_POLICY,
          stableTriangleColorFreezeFrames: ANIMATION_STABLE_TRIANGLE_COLOR_FREEZE_FRAMES,
        } satisfies Parameters<VanillaPolyMeshHandle["setPolygons"]>[1] & {
          stableTriangleDebug?: "transform-only" | "plan-only";
          stableTriangleUpdateMode?: "full" | "transform-only" | "color-only";
          stableTriangleColorPolicy: "cadence" | "adaptive";
          stableTriangleColorFreezeFrames: number;
        };
        const canUseTransformCache =
          transformCache &&
          !transformCache.disabled &&
          !stableTriangleDebug &&
          animationDurationSeconds !== undefined;
        const frameIndex = canUseTransformCache
          ? animationCacheFrameIndex(elapsedSeconds, animationDurationSeconds)
          : -1;
        const shouldRefreshColor =
          canUseTransformCache &&
          transformCache.canRefreshColor &&
          ANIMATION_STABLE_TRIANGLE_COLOR_FREEZE_FRAMES > 0 &&
          animationFrameCount % ANIMATION_STABLE_TRIANGLE_COLOR_FREEZE_FRAMES === 0;
        const samples = debugTarget.__polycssGalleryAnimationSamples;
        let sampleMs = 0;
        let setPolygonsMs = 0;
        let transformCacheMs = 0;
        let transformCacheHit = false;
        if (canUseTransformCache) {
          const cacheStart = samples ? performance.now() : 0;
          transformCacheHit = applyStableTriangleTransformFrame(
            handle,
            transformCache,
            frameIndex,
          );
          transformCacheMs = samples ? performance.now() - cacheStart : 0;
        }
        if (transformCacheHit && shouldRefreshColor) {
          const sampleStart = samples ? performance.now() : 0;
          const animatedPolygons = animationFrameFactory(elapsedSeconds);
          sampleMs = samples ? performance.now() - sampleStart : 0;
          lastAnimatedPolygonCount = animatedPolygons.length;
          const setStart = samples ? performance.now() : 0;
          handle.setPolygons(animatedPolygons, {
            ...setPolygonsOptions,
            stableTriangleUpdateMode: "color-only",
          });
          setPolygonsMs = samples ? performance.now() - setStart : 0;
        } else if (!transformCacheHit) {
          const sampleStart = samples ? performance.now() : 0;
          const animatedPolygons = animationFrameFactory(elapsedSeconds);
          sampleMs = samples ? performance.now() - sampleStart : 0;
          lastAnimatedPolygonCount = animatedPolygons.length;
          const setStart = samples ? performance.now() : 0;
          handle.setPolygons(animatedPolygons, setPolygonsOptions);
          setPolygonsMs = samples ? performance.now() - setStart : 0;
          if (canUseTransformCache) {
            captureStableTriangleTransformFrame(handle, transformCache, frameIndex);
          }
        }
        if (samples) {
          samples.push({
            t: now,
            sampleMs,
            setPolygonsMs,
            polygons: lastAnimatedPolygonCount,
            transformCacheHit,
            transformCacheFilled: transformCache?.filled,
            transformCacheMs,
          });
          if (samples.length > 1800) samples.splice(0, samples.length - 1800);
        }
      }
      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [
    animationKey,
    animationFrameFactory,
    animationDurationSeconds,
    options.textureLighting,
    stableDomForMesh,
  ]);

  // Effect 2 — cheap: live transform + lighting updates via setOptions.
  // Sliding sliders only flows through this path.
  useEffect(() => {
    const scene = sceneRef.current;
    const camera = cameraRef.current;
    if (!scene || !camera) return;
    camera.update({
      rotX: options.rotX,
      rotY: options.rotY,
      zoom: options.zoom,
      target: options.target as Vec3,
    });
    scene.applyCamera();
    scene.setOptions({
      directionalLight,
      ambientLight,
      textureLighting: options.textureLighting,
      shadow: { maxExtend: options.shadowMaxExtend },
    });
  }, [
    options.rotX,
    options.rotY,
    options.zoom,
    options.target,
    options.textureLighting,
    options.shadowMaxExtend,
    directionalLight,
    ambientLight,
  ]);

  // Effect 2b — render strategy controls. Kept separate from Effect 2 because
  // these options trigger a full mesh re-render in
  // createPolyScene; folding it into the camera/lighting effect would
  // re-render on every rotation/zoom tick.
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    scene.setOptions({
      strategies: { disable: options.disableStrategies },
    });
  }, [options.disableStrategies]);

  // Effect 2.5 — vanilla controls. The React renderer wires interactive +
  // animate through <PolyCamera>; the vanilla path uses createPolyOrbitControls.
  // The handle is created lazily once the scene is ready and we're on the
  // vanilla renderer; subsequent prop changes flow through controls.update().
  useEffect(() => {
    if (options.renderer !== "vanilla") {
      controlsRef.current?.destroy();
      controlsRef.current = null;
      return;
    }
    const scene = sceneRef.current;
    if (!scene) return;
    const buildControls = (): PolyControlsHandle | PolyFirstPersonControlsHandle => {
      if (options.dragMode === "fpv") {
        const fpv = createPolyFirstPersonControls(scene, {
          enabled: options.interactive,
          lookEnabled: options.fpvLook,
          moveEnabled: options.fpvMove,
          jumpEnabled: options.fpvJump,
          crouchEnabled: options.fpvCrouch,
          moveSpeed: options.fpvMoveSpeed,
          jumpVelocity: options.fpvJumpVelocity,
          gravity: options.fpvGravity,
          eyeHeight: options.fpvEyeHeight,
          crouchHeight: options.fpvCrouchHeight,
          lookSensitivity: options.fpvLookSensitivity,
          invertY: options.fpvInvertY,
        });
        // FPV is authoritative over the camera while engaged — don't echo
        // its per-frame writes back into React state; that round-trip fights
        // the rAF tick and causes visible jitter on mouselook and walk.
        // The React side picks up the final camera state when the user
        // exits FPV mode (next controls rebuild reads scene.getOptions()).
        return fpv;
      }
      const factory = options.dragMode === "pan" ? createPolyMapControls : createPolyOrbitControls;
      const controls: PolyControlsHandle = factory(scene, {
        drag: options.interactive,
        wheel: options.interactive,
        animate: options.animate
          ? { speed: 0.3, axis: "y" as const, pauseOnInteraction: true }
          : false as const,
      });
      controls.addEventListener("end", ((e: { camera: { rotX: number; rotY: number; zoom: number; target?: ReactVec3 } }) => {
        onCameraChangeRef.current?.(e.camera);
      }) as any);
      return controls;
    };
    if (controlsRef.current) controlsRef.current.destroy();
    controlsRef.current = buildControls();
    return () => {
      // Effect re-runs when deps change — destroy only on full unmount,
      // which is signaled by the scene Effect 1 cleanup destroying scene.
      // Until then, the next effect run will reuse + update controlsRef.
    };
  }, [
    options.renderer,
    options.interactive,
    options.animate,
    options.dragMode,
    polygons,
    options.autoCenter,
    options.textureQuality,
    options.textureLighting,
    options.perspective,
    stableDirectionalForRebuild,
    stableAmbientForRebuild,
    stableDomForMesh,
    parseResult,
  ]);

  // Effect 2.6 — live-update FPV options (booleans + numerics) without
  // destroying the controls. Keeps the pointer-lock + camera target intact
  // while sliders are dragged.
  useEffect(() => {
    if (options.dragMode !== "fpv") return;
    const handle = controlsRef.current as PolyFirstPersonControlsHandle | null;
    if (!handle || !("lock" in handle)) return;
    handle.update({
      enabled: options.interactive,
      lookEnabled: options.fpvLook,
      moveEnabled: options.fpvMove,
      jumpEnabled: options.fpvJump,
      crouchEnabled: options.fpvCrouch,
      moveSpeed: options.fpvMoveSpeed,
      jumpVelocity: options.fpvJumpVelocity,
      gravity: options.fpvGravity,
      eyeHeight: options.fpvEyeHeight,
      crouchHeight: options.fpvCrouchHeight,
      lookSensitivity: options.fpvLookSensitivity,
      invertY: options.fpvInvertY,
    });
  }, [
    options.dragMode,
    options.interactive,
    options.fpvLook,
    options.fpvMove,
    options.fpvJump,
    options.fpvCrouch,
    options.fpvMoveSpeed,
    options.fpvJumpVelocity,
    options.fpvGravity,
    options.fpvEyeHeight,
    options.fpvCrouchHeight,
    options.fpvLookSensitivity,
    options.fpvInvertY,
  ]);

  // Effect 3 — axes helper. Add/remove based on toggle; rebuild when scale
  // changes (different bar lengths bake into different polygons).
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    if (!showAxes) {
      axesHandleRef.current?.dispose();
      axesHandleRef.current = null;
      return;
    }
    axesHandleRef.current = scene.add(
      {
        polygons: axesHelperPolygons({ size: helperScale * 0.6 }),
        objectUrls: [],
        warnings: [],
        dispose: () => {},
      },
      { excludeFromAutoCenter: true },
    );
    return () => {
      axesHandleRef.current?.dispose();
      axesHandleRef.current = null;
    };
  }, [
    showAxes,
    helperScale,
    polygons,
    options.autoCenter,
    options.textureQuality,
    options.textureLighting,
    options.perspective,
    stableDirectionalForRebuild,
    stableAmbientForRebuild,
    parseResult,
  ]);

  // Effect 3.5 — ground receiver. A flat quad in the XY plane (Z is "up"
  // in polycss's world convention — the red-green plane in the axes helper
  // is the floor) at the model's min-Z, sized to ~3× the model's horizontal
  // span. Gives shadows something to land on. excludeFromAutoCenter so
  // toggling it doesn't shift the camera pivot; castShadow:false because
  // the floor doesn't shadow itself.
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    if (!showGround || polygons.length === 0) {
      groundHandleRef.current?.dispose();
      groundHandleRef.current = null;
      return;
    }
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (const p of polygons) {
      for (const v of p.vertices) {
        if (v[0] < minX) minX = v[0]; if (v[0] > maxX) maxX = v[0];
        if (v[1] < minY) minY = v[1]; if (v[1] > maxY) maxY = v[1];
        if (v[2] < minZ) minZ = v[2]; if (v[2] > maxZ) maxZ = v[2];
      }
    }
    if (!Number.isFinite(minZ)) {
      groundHandleRef.current?.dispose();
      groundHandleRef.current = null;
      return;
    }
    const span = Math.max(maxX - minX, maxY - minY, 1);
    const pad = span * 1.5;
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    const z = minZ;
    const groundPoly: Polygon = {
      vertices: [
        [cx - pad, cy - pad, z],
        [cx + pad, cy - pad, z],
        [cx + pad, cy + pad, z],
        [cx - pad, cy + pad, z],
      ],
      // Medium gray — needs to be light enough that the 25% black shadow
      // on top has visible contrast (the page background is near-black).
      color: "#7d848e",
    };
    groundHandleRef.current = scene.add(
      {
        polygons: [groundPoly],
        objectUrls: [],
        warnings: [],
        dispose: () => {},
      },
      { excludeFromAutoCenter: true, castShadow: false },
    );
    return () => {
      groundHandleRef.current?.dispose();
      groundHandleRef.current = null;
    };
  }, [
    showGround,
    polygons,
    options.autoCenter,
    options.textureQuality,
    options.textureLighting,
    options.perspective,
    stableDirectionalForRebuild,
    stableAmbientForRebuild,
    parseResult,
  ]);

  // Effect 4 — light helper. Octahedron at LOCAL origin so polygons stay
  // stable across light moves; the light direction only updates the
  // mesh wrapper transform.
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    if (!showLight) {
      lightHandleRef.current?.dispose();
      lightHandleRef.current = null;
      return;
    }
    const swatch = directionalLight.color ?? "#ffd54a";
    const handle = scene.add(
      {
        polygons: octahedronPolygons({ center: [0, 0, 0], size: helperScale * 0.05, color: swatch }),
        objectUrls: [],
        warnings: [],
        dispose: () => {},
      },
      {
        position: lightHelperPosition(
          directionalLight,
          helperTarget,
          helperScale * 0.7,
        ),
        excludeFromAutoCenter: true,
      },
    );
    handle.element.classList.add("dn-light-helper");
    lightHandleRef.current = handle;
    return () => {
      lightHandleRef.current?.dispose();
      lightHandleRef.current = null;
    };
    // directionalLight.color triggers a remount because the swatch is
    // baked into polygon data; direction is handled by Effect 5 below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    showLight,
    helperScale,
    directionalLight.color,
    polygons,
    options.autoCenter,
    options.textureQuality,
    options.textureLighting,
    options.perspective,
    stableDirectionalForRebuild,
    stableAmbientForRebuild,
    parseResult,
  ]);

  // Effect 5 — slide the light helper to the new orbit position whenever
  // direction or target/distance change. Only updates the wrapper
  // transform, no atlas work.
  useEffect(() => {
    const handle = lightHandleRef.current;
    if (!handle) return;
    handle.setTransform({
      position: lightHelperPosition(
        directionalLight,
        helperTarget,
        helperScale * 0.7,
      ),
    });
  }, [directionalLight, helperTarget, helperScale]);

  return <div className="dn-vanilla-host" ref={hostRef} />;
}
