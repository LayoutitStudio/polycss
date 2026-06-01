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
import { FPV_PERSPECTIVE } from "../fpv";

export type { GizmoMode, SceneOptionsState };

// Light helper world units → CSS pixels conversion (matches the helper
// components in @layoutit/polycss-react and @layoutit/polycss-vue).
const LIGHT_HELPER_TILE = 50;
// Keep the visible ground just below the model floor; coplanar ground/car
// faces z-fight during repaint-heavy light drags.
const GROUND_Z_OFFSET = -0.04;
const GALLERY_GROUND_COLOR = "#7d848e";
const GALLERY_GROUND_RGB = { r: 0x7d, g: 0x84, b: 0x8e };
const GALLERY_GROUND_LIGHT_RESPONSE = 0.28;
const GALLERY_GROUND_RADIUS_MULTIPLIER = 2.5;
const GALLERY_GROUND_MODEL_RADIUS_MULTIPLIER = 1.75;
const GALLERY_GROUND_MIN_RADIUS = 40;
// Lift the shadow above the ground plane (which sits at GROUND_Z_OFFSET
// below the model floor). The library's `shadow.lift` is now interpreted
// as "world-unit displacement ALONG the receiver face's normal" — for
// the floor that's +Z, so a positive value puts the shadow visibly above
// the ground. (Earlier this constant ALSO added GROUND_Z_OFFSET because
// the old non-receiver cast-shadow path treated `lift` as an absolute
// z relative to caster.minZ, where negative was correct. Once the floor
// became a receiver, that negative result placed the shadow BELOW the
// ground and got occluded by it.)
const GALLERY_SHADOW_LIFT = 0.01;
const ANIMATION_STABLE_TRIANGLE_COLOR_POLICY = "cadence";
// Deforming low-poly triangles can swing face normals sharply; keep the
// mounted baked color pinned and animate transforms only.
const ANIMATION_STABLE_TRIANGLE_COLOR_FREEZE_FRAMES = 0;
const ANIMATION_TRANSFORM_CACHE_FRAMES = 60;

// Transitional compat: the polycss vanilla camera was updated to interpret
// `zoom` as "px per world unit" (Three.js convention) rather than a raw CSS
// scale factor. The shared workbench presets / sceneOptions still carry
// CSS-scale-tuned values that ALSO drive the React renderer (which keeps the
// old semantic until the parity refactor is mirrored there). Multiply by 50
// going into the vanilla camera and divide on the way back out so both
// renderers can keep reading from the same `sceneOptions.zoom` field.
// Remove once @layoutit/polycss-react has been mirrored.
const LEGACY_ZOOM_COMPAT = 50;

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
  // Post-parity: createPolyScene treats `position` as WORLD UNITS and
  // applies the world→CSS axis swap + ×BASE_TILE conversion internally.
  // Pre-parity, this helper used to ×LIGHT_HELPER_TILE + swap manually,
  // which after the parity refactor pushed the helper thousands of CSS
  // pixels off-screen because the renderer multiplied a second time.
  const [dx, dy, dz] = light.direction;
  const len = Math.hypot(dx, dy, dz) || 1;
  return [
    target[0] + (dx / len) * distance,
    target[1] + (dy / len) * distance,
    target[2] + (dz / len) * distance,
  ];
}

function directionalFromOptions(options: SceneOptionsState): PolyDirectionalLight {
  const az = (options.lightAzimuth * Math.PI) / 180;
  const el = (options.lightElevation * Math.PI) / 180;
  const cosEl = Math.cos(el);
  return {
    direction: [
      cosEl * Math.sin(az),
      cosEl * Math.cos(az),
      Math.sin(el),
    ],
    color: options.lightColor,
    intensity: options.lightIntensity,
  };
}

function ambientFromOptions(options: SceneOptionsState): PolyAmbientLight {
  return {
    color: options.ambientColor,
    intensity: options.ambientIntensity,
  };
}

function parseGalleryHexColor(value: string | undefined, fallback: typeof GALLERY_GROUND_RGB): typeof GALLERY_GROUND_RGB {
  if (!value || !/^#[0-9a-f]{6}$/i.test(value)) return fallback;
  return {
    r: Number.parseInt(value.slice(1, 3), 16),
    g: Number.parseInt(value.slice(3, 5), 16),
    b: Number.parseInt(value.slice(5, 7), 16),
  };
}

function clampColorChannel(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function mutedGalleryGroundColor(
  directionalLight: PolyDirectionalLight,
  ambientLight: PolyAmbientLight,
  baseColor: string,
): string {
  const base = parseGalleryHexColor(baseColor, GALLERY_GROUND_RGB);
  const [dx, dy, dz] = directionalLight.direction;
  const len = Math.hypot(dx, dy, dz) || 1;
  const lambert = Math.max(0, dz / len);
  const key = parseGalleryHexColor(directionalLight.color, { r: 255, g: 255, b: 255 });
  const ambient = parseGalleryHexColor(ambientLight.color, { r: 255, g: 255, b: 255 });
  const keyIntensity = directionalLight.intensity ?? 1;
  const ambientIntensity = ambientLight.intensity ?? 0.4;
  const mix = (base: number, ambientChannel: number, keyChannel: number) => {
    const lit = base * (
      (ambientChannel / 255) * ambientIntensity +
      (keyChannel / 255) * keyIntensity * lambert
    );
    return clampColorChannel(base * (1 - GALLERY_GROUND_LIGHT_RESPONSE) + lit * GALLERY_GROUND_LIGHT_RESPONSE);
  };
  return `rgb(${mix(base.r, ambient.r, key.r)} ${mix(base.g, ambient.g, key.g)} ${mix(base.b, ambient.b, key.b)})`;
}

function applyGalleryGroundPaint(
  handle: VanillaPolyMeshHandle | null,
  directionalLight: PolyDirectionalLight,
  ambientLight: PolyAmbientLight,
  baseColor: string,
): void {
  if (!handle) return;
  const color = mutedGalleryGroundColor(directionalLight, ambientLight, baseColor);
  const leaves = handle.element.querySelectorAll<HTMLElement>("b,i,s,u");
  for (const leaf of leaves) {
    leaf.style.setProperty("color", color, "important");
    if (leaf.tagName.toLowerCase() === "s") {
      leaf.style.setProperty("background", color, "important");
      leaf.style.setProperty("background-blend-mode", "normal", "important");
    }
  }
}

function bakedLightingSignature(
  directionalLight: PolyDirectionalLight,
  ambientLight: PolyAmbientLight,
): string {
  return [
    directionalLight.direction.map((value) => value.toFixed(4)).join(","),
    directionalLight.color ?? "",
    directionalLight.intensity ?? "",
    ambientLight.color ?? "",
    ambientLight.intensity ?? "",
  ].join("|");
}

export interface VanillaSceneTransientHandle {
  applySceneOptions(options: SceneOptionsState): void;
  applyLightOptions(options: SceneOptionsState, preview?: { shadow?: boolean }): void;
}

type BakedSolidLightingPreviewSceneHandle = PolySceneHandle & {
  previewBakedSolidLighting?: (next: {
    directionalLight?: PolyDirectionalLight;
    ambientLight?: PolyAmbientLight;
    skipShadows?: boolean;
  }) => boolean;
  commitBakedSolidLighting?: () => boolean;
};

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
  onBuild?: (ms: number) => void;
  onCameraChange?: (camera: { rotX: number; rotY: number; zoom: number; target?: ReactVec3 }) => void;
  enableSelection?: boolean;
  meshId?: string;
  onSelectionChange?: (selectedIds: string[]) => void;
  gizmoMode?: GizmoMode;
  enableHover?: boolean;
  onHoverChange?: (id: string | null) => void;
  onMeshHandleChange?: (handle: VanillaPolyMeshHandle | null) => void;
  onTransientHandleChange?: (handle: VanillaSceneTransientHandle | null) => void;
  onSceneDomChange?: () => void;
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
  onTransientHandleChange,
  onSceneDomChange,
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
  const committedBakedLightingRef = useRef("");
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
  const onTransientHandleChangeRef = useRef(onTransientHandleChange);
  onTransientHandleChangeRef.current = onTransientHandleChange;
  const onSceneDomChangeRef = useRef(onSceneDomChange);
  onSceneDomChangeRef.current = onSceneDomChange;
  const directionalLightRef = useRef(directionalLight);
  directionalLightRef.current = directionalLight;
  const ambientLightRef = useRef(ambientLight);
  ambientLightRef.current = ambientLight;
  const groundColorRef = useRef(options.groundColor);
  groundColorRef.current = options.groundColor;
  const helperScaleRef = useRef(helperScale);
  helperScaleRef.current = helperScale;
  const helperTargetRef = useRef(helperTarget);
  helperTargetRef.current = helperTarget;
  const notifySceneDomChange = useCallback(() => {
    onSceneDomChangeRef.current?.();
  }, []);
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

  const applyTransientLightOptions = useCallback((nextOptions: SceneOptionsState, preview?: { shadow?: boolean }): void => {
    const scene = sceneRef.current;
    if (!scene) return;
    const nextDirectionalLight = directionalFromOptions(nextOptions);
    const nextShadow = { maxExtend: nextOptions.shadowMaxExtend, lift: GALLERY_SHADOW_LIFT };
    const previewShadow = preview?.shadow !== false;
    if (nextOptions.textureLighting === "dynamic") {
      scene.setOptions({
        directionalLight: nextDirectionalLight,
        ...(previewShadow ? { shadow: nextShadow } : {}),
      });
    } else {
      // Baked mode: match the bench three-parity flow — push the new light
      // direction to the scene so shadow SVGs re-emit live during drag,
      // but DON'T install the CSS-cascade preview on solid leaves. The
      // preview makes leaves brighter than the eventual bake (different
      // gamma/dot-product paths) which reads as "the face just darkened
      // and disappeared" the instant the user releases the helper. The
      // bench's solid leaves stay at the LAST baked color through the
      // drag, then commit on release — no perceived flicker.
      //
      // Trade-off: textured atlas leaves likewise stay frozen during
      // drag; only shadows follow live. The atlas re-bakes on commit
      // via commitBakedSolidLighting → rebakeRenderEntryInPlace (in-place
      // bitmap swap, no DOM teardown).
      if (previewShadow) {
        scene.setOptions({ directionalLight: nextDirectionalLight, shadow: nextShadow });
      } else {
        scene.setOptions({ directionalLight: nextDirectionalLight });
      }
    }
    lightHandleRef.current?.setTransform({
      position: lightHelperPosition(
        nextDirectionalLight,
        helperTargetRef.current,
        helperScaleRef.current * 0.7,
      ),
    });
    applyGalleryGroundPaint(groundHandleRef.current, nextDirectionalLight, ambientFromOptions(nextOptions), nextOptions.groundColor);
  }, []);

  const applyTransientSceneOptions = useCallback((nextOptions: SceneOptionsState): void => {
    const scene = sceneRef.current;
    const camera = cameraRef.current;
    if (!scene || !camera) return;
    const nextDirectionalLight = directionalFromOptions(nextOptions);
    camera.update({
      rotX: nextOptions.rotX,
      rotY: nextOptions.rotY,
      zoom: nextOptions.zoom * LEGACY_ZOOM_COMPAT,
      target: nextOptions.target as Vec3,
    });
    scene.applyCamera();
    scene.setOptions({
      directionalLight: nextDirectionalLight,
      ambientLight: ambientFromOptions(nextOptions),
      textureLighting: nextOptions.textureLighting,
      shadow: { maxExtend: nextOptions.shadowMaxExtend, lift: GALLERY_SHADOW_LIFT },
    });
    lightHandleRef.current?.setTransform({
      position: lightHelperPosition(
        nextDirectionalLight,
        helperTargetRef.current,
        helperScaleRef.current * 0.7,
      ),
    });
    applyGalleryGroundPaint(groundHandleRef.current, nextDirectionalLight, ambientFromOptions(nextOptions), nextOptions.groundColor);
  }, []);

  useEffect(() => {
    onTransientHandleChangeRef.current?.({
      applySceneOptions: applyTransientSceneOptions,
      applyLightOptions: applyTransientLightOptions,
    });
    return () => onTransientHandleChangeRef.current?.(null);
  }, [applyTransientLightOptions, applyTransientSceneOptions]);

  // Split structural options (require destroying the scene) from incremental
  // lighting/camera options. Baked light changes commit solid colors in place;
  // rebuilding the whole mesh on mouseup causes visible polygon flicker.
  const stableDirectionalForRebuild = null;
  const stableAmbientForRebuild = null;

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
      zoom: options.zoom * LEGACY_ZOOM_COMPAT,
      target: options.target as Vec3 | undefined,
    };
    const perspective = options.dragMode === "fpv" ? FPV_PERSPECTIVE : options.perspective;
    const camera = perspective === false
      ? createPolyOrthographicCamera(cameraOpts)
      : createPolyPerspectiveCamera(
        typeof perspective === "number" ? { ...cameraOpts, perspective } : cameraOpts,
      );
    cameraRef.current = camera;
    const sceneOptions: PolySceneOptions = {
      camera,
      directionalLight,
      ambientLight,
      textureLighting: options.textureLighting,
      autoCenter: options.autoCenter,
      textureQuality: options.textureQuality,
      strategies: { disable: options.disableStrategies },
      shadow: { maxExtend: options.shadowMaxExtend, lift: GALLERY_SHADOW_LIFT },
    };
    const scene = createPolyScene(host, sceneOptions);
    sceneRef.current = scene;
    committedBakedLightingRef.current = bakedLightingSignature(directionalLight, ambientLight);
    const meshTransform = {
      merge: mergePolygonsForMesh,
      stableDom: stableDomForMesh,
      id: meshId,
      castShadow: options.castShadow,
      receiveShadow: options.selfShadow,
    } as PolyMeshTransform;
    const modelParseResult: ParseResult = parseResult
      ? {
        ...parseResult,
        polygons,
        dispose: () => { },
      }
      : {
        polygons,
        objectUrls: [],
        warnings: [],
        dispose: () => { },
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
    notifySceneDomChange();
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
    notifySceneDomChange,
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
          dispose: () => { },
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
      onBuildRef.current?.(performance.now() - started),
    );
    notifySceneDomChange();
  }, [
    polygons,
    interiorShellPolygons,
    mergePolygonsForMesh,
    stableDomForMesh,
    mountChildMeshInsideModel,
    notifySceneDomChange,
  ]);

  // Effect 1.6 — live-toggle castShadow / selfShadow (receiveShadow on the
  // mesh) without rebuilding the scene.
  useEffect(() => {
    const handle = meshHandleRef.current;
    if (!handle) return;
    handle.setTransform({ castShadow: options.castShadow });
  }, [options.castShadow]);
  useEffect(() => {
    const handle = meshHandleRef.current;
    if (!handle) return;
    handle.setTransform({ receiveShadow: options.selfShadow });
  }, [options.selfShadow]);

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
      notifySceneDomChange();
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
    notifySceneDomChange();
    return () => {
      select.destroy();
      tc.destroy();
      selectionRef.current = null;
      transformControlsRef.current = null;
      notifySceneDomChange();
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
    notifySceneDomChange,
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

  // Effect 2a — camera-only updates. Runs every drag tick. Pushes the new
  // camera state and re-applies the scene transform. Does NOT call
  // scene.setOptions — camera changes don't change lighting/shadow, and
  // calling setOptions({shadow:...}) here would trigger a full receiver-
  // shadow rebuild every drag tick, causing visible mid-frame flicker
  // ("shadows disappear when rotating") in real Chrome.
  useEffect(() => {
    const scene = sceneRef.current;
    const camera = cameraRef.current;
    if (!scene || !camera) return;
    camera.update({
      rotX: options.rotX,
      rotY: options.rotY,
      zoom: options.zoom * LEGACY_ZOOM_COMPAT,
      target: options.target as Vec3,
    });
    scene.applyCamera();
  }, [options.rotX, options.rotY, options.zoom, options.target]);

  // Effect 2b — lighting + shadow updates. Runs only when the light, shadow,
  // textureLighting, or ground color actually change (sliders, not camera).
  // setOptions triggers the receiver-shadow rebuild via emitSceneShadows();
  // keep it off the camera-tick path.
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    scene.setOptions({
      directionalLight,
      ambientLight,
      textureLighting: options.textureLighting,
      shadow: { maxExtend: options.shadowMaxExtend, lift: GALLERY_SHADOW_LIFT },
    });
    const nextLightingSignature = bakedLightingSignature(directionalLight, ambientLight);
    if (
      options.textureLighting === "baked" &&
      committedBakedLightingRef.current !== nextLightingSignature
    ) {
      (scene as BakedSolidLightingPreviewSceneHandle).commitBakedSolidLighting?.();
      committedBakedLightingRef.current = nextLightingSignature;
    } else if (options.textureLighting !== "baked") {
      committedBakedLightingRef.current = nextLightingSignature;
    }
    applyGalleryGroundPaint(groundHandleRef.current, directionalLight, ambientLight, options.groundColor);
  }, [
    options.textureLighting,
    options.groundColor,
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
    applyGalleryGroundPaint(groundHandleRef.current, directionalLightRef.current, ambientLightRef.current, groundColorRef.current);
    notifySceneDomChange();
  }, [options.disableStrategies, notifySceneDomChange]);

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
        // Convert back to legacy CSS-scale zoom on the way out — see LEGACY_ZOOM_COMPAT.
        onCameraChangeRef.current?.({ ...e.camera, zoom: e.camera.zoom / LEGACY_ZOOM_COMPAT });
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
      if (axesHandleRef.current) {
        axesHandleRef.current.dispose();
        axesHandleRef.current = null;
        notifySceneDomChange();
      }
      return;
    }
    axesHandleRef.current = scene.add(
      {
        polygons: axesHelperPolygons({ size: helperScale * 0.6 }),
        objectUrls: [],
        warnings: [],
        dispose: () => { },
      },
      { excludeFromAutoCenter: true },
    );
    notifySceneDomChange();
    return () => {
      axesHandleRef.current?.dispose();
      axesHandleRef.current = null;
      notifySceneDomChange();
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
    notifySceneDomChange,
  ]);

  // Effect 3.5 — ground receiver. A flat quad in the XY plane (Z is "up"
  // in PolyCSS's world convention — the red-green plane in the axes helper
  // is the floor) at the model's min-Z. Size from both footprint and full
  // model scale so tall/narrow assets still get a usable floor. Gives shadows
  // something to land on. excludeFromAutoCenter so toggling it doesn't shift
  // the camera pivot; castShadow:false because the floor doesn't shadow itself.
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    if (!showGround || polygons.length === 0) {
      if (groundHandleRef.current) {
        groundHandleRef.current.dispose();
        groundHandleRef.current = null;
        notifySceneDomChange();
      }
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
      if (groundHandleRef.current) {
        groundHandleRef.current.dispose();
        groundHandleRef.current = null;
        notifySceneDomChange();
      }
      return;
    }
    const footprintSpan = Math.max(maxX - minX, maxY - minY, 1);
    const modelSpan = Math.max(footprintSpan, maxZ - minZ, 1);
    const pad = Math.max(
      footprintSpan * GALLERY_GROUND_RADIUS_MULTIPLIER,
      modelSpan * GALLERY_GROUND_MODEL_RADIUS_MULTIPLIER,
      GALLERY_GROUND_MIN_RADIUS,
    );
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    const z = minZ + GROUND_Z_OFFSET;
    const groundPoly: Polygon = {
      vertices: [
        [cx - pad, cy - pad, z],
        [cx + pad, cy - pad, z],
        [cx + pad, cy + pad, z],
        [cx - pad, cy + pad, z],
      ],
      // Medium gray — needs to be light enough that the 25% black shadow
      // on top has visible contrast (the page background is near-black).
      color: options.groundColor || GALLERY_GROUND_COLOR,
    };
    groundHandleRef.current = scene.add(
      {
        polygons: [groundPoly],
        objectUrls: [],
        warnings: [],
        dispose: () => { },
      },
      // receiveShadow:true is load-bearing — the gallery floor is the
      // canonical shadow receiver. Without it, enabling Self-shadow on
      // the model would flip the "only-receiver-paints-shadows" semantic
      // ON and the floor (not marked as receiver) would lose its cast
      // shadow entirely. With it, the floor always paints the cast
      // shadow regardless of the model's self-shadow state.
      { excludeFromAutoCenter: true, castShadow: false, receiveShadow: true },
    );
    groundHandleRef.current.element.classList.add("dn-gallery-ground");
    applyGalleryGroundPaint(groundHandleRef.current, directionalLightRef.current, ambientLightRef.current, groundColorRef.current);
    notifySceneDomChange();
    return () => {
      groundHandleRef.current?.dispose();
      groundHandleRef.current = null;
      notifySceneDomChange();
    };
  }, [
    showGround,
    polygons,
    options.autoCenter,
    options.textureQuality,
    options.textureLighting,
    options.groundColor,
    options.perspective,
    stableDirectionalForRebuild,
    stableAmbientForRebuild,
    parseResult,
    notifySceneDomChange,
  ]);

  // Effect 4 — light helper. Octahedron at LOCAL origin so polygons stay
  // stable across light moves; the light direction only updates the
  // mesh wrapper transform.
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    if (!showLight) {
      if (lightHandleRef.current) {
        lightHandleRef.current.dispose();
        lightHandleRef.current = null;
        notifySceneDomChange();
      }
      return;
    }
    const swatch = directionalLight.color ?? "#ffd54a";
    const handle = scene.add(
      {
        polygons: octahedronPolygons({ center: [0, 0, 0], size: helperScale * 0.05, color: swatch }),
        objectUrls: [],
        warnings: [],
        dispose: () => { },
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
    notifySceneDomChange();
    return () => {
      lightHandleRef.current?.dispose();
      lightHandleRef.current = null;
      notifySceneDomChange();
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
    notifySceneDomChange,
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
