import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import type {
  PolyMeshHandle as ReactPolyMeshHandle,
  Polygon,
  Vec3 as ReactVec3,
} from "@layoutit/polycss-react";
import type {
  PolyMeshHandle as VanillaPolyMeshHandle,
} from "@layoutit/polycss";
import { optimizeAnimatedMeshPolygons, parsePureColor } from "@layoutit/polycss";
import type { InspectorColorGroup, InspectorMesh } from "../Inspector";
import { VanillaScene } from "../VanillaScene";
import { ReactScene } from "../ReactScene";
import {
  Dock,
  DockModel,
  DockRendering,
  DockAnimation,
  DockInteraction,
  DockCamera,
  DockLighting,
  DockMaterials,
} from "../Dock";
import { ModelsSidebar } from "../ModelsSidebar";
import { DropOverlay } from "../DropOverlay";
import { StatsOverlay } from "../StatsOverlay";
import {
  activeMeshResolution,
  type GizmoMode,
  type SceneOptionsState,
  type DomMetrics,
} from "../types";
import "./gallery-workbench.css";
import type {
  PresetModel,
  LoadedModel,
  ParserOptionsState,
} from "./types";
import {
  PRESETS,
  GALLERY_BUCKET_ORDER,
  galleryBucketForPreset,
  galleryBucketRank,
  stripParenthesizedText,
} from "./presets";
import {
  EMPTY_METRICS,
  measureDom,
} from "./helpers/domMetrics";
import {
  applyDebugMatrixPrecision,
  applyDebugBorderShapePrecision,
  applyDebugTriangleBrushPrecision,
  applyDebugSolidColorHex,
  applyDebugInlineStyleOrder,
  applyDebugInlineStyleMinify,
} from "./helpers/debugPrecision";
import { defaultZoomForModel } from "./helpers/smartDefaults";
import { directionalFromOptions, ambientFromOptions } from "./helpers/lighting";
import {
  useDroppedFiles,
  usePresetLoader,
  useScenePolygons,
  useAnimationFrames,
  useRouteSync,
  useGuiCameraSync,
  setRoutePresetId,
  routeInitialPresetId,
} from "./hooks";
import { useFpvHost } from "../fpv";
import type { ObjParseOptions, GltfParseOptions, VoxParseOptions } from "@layoutit/polycss";

type AnimationClip = NonNullable<LoadedModel["animation"]>["clips"][number];
type MobileGalleryPanel = "models" | "controls" | null;

function presetPickerItem(preset: PresetModel, local = false) {
  const label = local ? `Dropped: ${stripParenthesizedText(preset.label)}` : stripParenthesizedText(preset.label);
  const category = galleryBucketForPreset(preset);
  return {
    id: preset.id,
    label,
    category,
    searchText: [
      label,
      preset.label,
      category,
      preset.category,
      preset.kind,
      preset.attribution?.creator,
      preset.attribution?.license,
    ].filter(Boolean).join(" ").toLowerCase(),
  };
}

const PRESET_PICKER_ITEMS = PRESETS.map((preset) => presetPickerItem(preset));
const ALL_PRESET_IDS = PRESETS.map((p) => p.id);

const DEFAULT_SCENE: SceneOptionsState = {
  renderer: "vanilla",
  animationPaused: false,
  animationTimeScale: 1,
  autoCenter: true,
  interactive: true,
  animate: false,
  showAxes: false,
  selection: false,
  hoverEffects: false,
  showLight: false,
  zoom: PRESETS[0].zoom ?? 0.35,
  rotX: PRESETS[0].rotX ?? 65,
  rotY: PRESETS[0].rotY ?? 45,
  perspective: false,
  lightAzimuth: 50,
  lightElevation: 45,
  lightIntensity: 1,
  lightColor: "#ffffff",
  ambientIntensity: 0.4,
  ambientColor: "#ffffff",
  textureLighting: "baked",
  textureQuality: "auto",
  solidMaterials: false,
  matrixPrecision: "exact",
  borderShapePrecision: "exact",
  meshResolution: "lossy",
  interiorFill: false,
  outlinePolygons: false,
  dragMode: "orbit",
  target: [0, 0, 0],
  disableStrategies: [],
  castShadow: false,
  shadowMaxExtend: 2000,
  showGround: false,
  fpvLook: true,
  fpvMove: true,
  fpvJump: true,
  fpvCrouch: true,
  fpvMoveSpeed: 30,
  fpvJumpVelocity: 25,
  fpvGravity: 60,
  fpvEyeHeight: 6,
  fpvCrouchHeight: 3,
  fpvLookSensitivity: 0.15,
  fpvInvertY: false,
  fpvRenderDistance: 40,
  snapToGrid: true,
  gridResolution: 5,
};

const DEFAULT_PARSER: ParserOptionsState = {
  targetSize: 60,
  gridShift: 1,
  defaultColor: "#8b95a1",
};

const LIGHT_HELPER_TILE = 50;
const LIGHT_HELPER_SELECTOR = ".dn-light-helper";

interface ScreenPoint {
  x: number;
  y: number;
}

function wrapDegrees(value: number): number {
  return ((value % 360) + 360) % 360;
}

function clampLightElevation(value: number): number {
  return Math.max(-90, Math.min(90, value));
}

function lightDirectionFromAngles(azimuth: number, elevation: number): ReactVec3 {
  const az = (azimuth * Math.PI) / 180;
  const el = (elevation * Math.PI) / 180;
  const cosEl = Math.cos(el);
  return [
    cosEl * Math.sin(az),
    cosEl * Math.cos(az),
    Math.sin(el),
  ];
}

function projectLightDirectionToScreen(
  direction: ReactVec3,
  sceneOptions: SceneOptionsState,
  radiusCss: number,
): ReactVec3 {
  const [dx, dy, dz] = direction;
  const x = dx * radiusCss;
  const y = dy * radiusCss;
  const z = dz * radiusCss;
  const rotY = (sceneOptions.rotY * Math.PI) / 180;
  const rotX = (sceneOptions.rotX * Math.PI) / 180;
  const cosY = Math.cos(rotY);
  const sinY = Math.sin(rotY);
  const cosX = Math.cos(rotX);
  const sinX = Math.sin(rotX);
  const x1 = x * cosY - y * sinY;
  const y1 = x * sinY + y * cosY;
  const y2 = y1 * cosX - z * sinX;
  const z2 = y1 * sinX + z * cosX;
  return [x1 * sceneOptions.zoom, y2 * sceneOptions.zoom, z2 * sceneOptions.zoom];
}

function lightAnglesFromScreenOffset(
  offset: ScreenPoint,
  sceneOptions: SceneOptionsState,
  radiusCss: number,
): { lightAzimuth: number; lightElevation: number } {
  const zoomedRadius = Math.max(1, radiusCss * Math.max(0.001, sceneOptions.zoom));
  let qx = offset.x / zoomedRadius;
  let qy = offset.y / zoomedRadius;
  const len = Math.hypot(qx, qy);
  if (len > 1) {
    qx /= len;
    qy /= len;
  }

  const currentDirection = lightDirectionFromAngles(
    sceneOptions.lightAzimuth,
    sceneOptions.lightElevation,
  );
  const currentProjected = projectLightDirectionToScreen(currentDirection, sceneOptions, 1);
  const qzSign = currentProjected[2] >= 0 ? 1 : -1;
  const qz = qzSign * Math.sqrt(Math.max(0, 1 - qx * qx - qy * qy));

  const rotY = (sceneOptions.rotY * Math.PI) / 180;
  const rotX = (sceneOptions.rotX * Math.PI) / 180;
  const cosY = Math.cos(rotY);
  const sinY = Math.sin(rotY);
  const cosX = Math.cos(rotX);
  const sinX = Math.sin(rotX);

  const x1 = qx;
  const y1 = qy * cosX + qz * sinX;
  const z = -qy * sinX + qz * cosX;
  const dx = x1 * cosY + y1 * sinY;
  const dy = -x1 * sinY + y1 * cosY;
  const dz = Math.max(-1, Math.min(1, z));
  return {
    lightAzimuth: wrapDegrees((Math.atan2(dx, dy) * 180) / Math.PI),
    lightElevation: clampLightElevation((Math.asin(dz) * 180) / Math.PI),
  };
}

function elementScreenCenter(element: HTMLElement): ScreenPoint {
  const leaves = Array.from(element.querySelectorAll<HTMLElement>("b,i,s,u"));
  const rects = (leaves.length > 0 ? leaves : [element])
    .map((el) => el.getBoundingClientRect())
    .filter((rect) => rect.width > 0 || rect.height > 0);
  if (rects.length === 0) {
    const rect = element.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  }
  const minX = Math.min(...rects.map((rect) => rect.left));
  const maxX = Math.max(...rects.map((rect) => rect.right));
  const minY = Math.min(...rects.map((rect) => rect.top));
  const maxY = Math.max(...rects.map((rect) => rect.bottom));
  return { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
}

function useLightRotationDrag(
  viewportRef: RefObject<HTMLDivElement | null>,
  sceneOptions: SceneOptionsState,
  helperScale: number,
  gizmoDragging: boolean,
  onUpdateScene: (partial: Partial<SceneOptionsState>) => void,
): void {
  const sceneOptionsRef = useRef(sceneOptions);
  const helperScaleRef = useRef(helperScale);
  const gizmoDraggingRef = useRef(gizmoDragging);
  const onUpdateSceneRef = useRef(onUpdateScene);
  sceneOptionsRef.current = sceneOptions;
  helperScaleRef.current = helperScale;
  gizmoDraggingRef.current = gizmoDragging;
  onUpdateSceneRef.current = onUpdateScene;

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;

    let activePointerId: number | null = null;
    let helperTargetScreen = { x: 0, y: 0 };
    let helperGrabOffset = { x: 0, y: 0 };
    let helperRadiusCss = 1;

    const helperDragEnabled = (): boolean => {
      const options = sceneOptionsRef.current;
      return options.interactive && options.showLight && !gizmoDraggingRef.current;
    };

    const stopDrag = (event: PointerEvent): void => {
      if (activePointerId !== event.pointerId) return;
      activePointerId = null;
      viewport.classList.remove("is-light-rotating");
      try { viewport.releasePointerCapture(event.pointerId); } catch { /* ignore */ }
    };

    const onPointerDown = (event: PointerEvent): void => {
      if (activePointerId !== null) return;
      if (event.isPrimary === false) return;
      if (event.button !== 0) return;
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest("[data-poly-transform-controls]")) return;
      const helper = target?.closest<HTMLElement>(LIGHT_HELPER_SELECTOR) ?? null;
      if (!helper || !helperDragEnabled()) return;
      event.preventDefault();
      event.stopPropagation();
      activePointerId = event.pointerId;
      const options = sceneOptionsRef.current;
      helperRadiusCss = Math.max(1, helperScaleRef.current * 0.7 * LIGHT_HELPER_TILE);
      const helperCenter = elementScreenCenter(helper);
      const currentOffset = projectLightDirectionToScreen(
        lightDirectionFromAngles(options.lightAzimuth, options.lightElevation),
        options,
        helperRadiusCss,
      );
      helperTargetScreen = {
        x: helperCenter.x - currentOffset[0],
        y: helperCenter.y - currentOffset[1],
      };
      helperGrabOffset = {
        x: event.clientX - helperCenter.x,
        y: event.clientY - helperCenter.y,
      };
      viewport.classList.add("is-light-rotating");
      try { viewport.setPointerCapture(event.pointerId); } catch { /* ignore */ }
    };

    const onPointerMove = (event: PointerEvent): void => {
      if (activePointerId !== event.pointerId) return;
      if (!helperDragEnabled()) {
        stopDrag(event);
        return;
      }
      event.preventDefault();
      const helperCenter = {
        x: event.clientX - helperGrabOffset.x,
        y: event.clientY - helperGrabOffset.y,
      };
      onUpdateSceneRef.current(lightAnglesFromScreenOffset(
        {
          x: helperCenter.x - helperTargetScreen.x,
          y: helperCenter.y - helperTargetScreen.y,
        },
        sceneOptionsRef.current,
        helperRadiusCss,
      ));
    };

    viewport.addEventListener("pointerdown", onPointerDown, { capture: true });
    viewport.addEventListener("pointermove", onPointerMove);
    viewport.addEventListener("pointerup", stopDrag);
    viewport.addEventListener("pointercancel", stopDrag);
    return () => {
      viewport.removeEventListener("pointerdown", onPointerDown, { capture: true });
      viewport.removeEventListener("pointermove", onPointerMove);
      viewport.removeEventListener("pointerup", stopDrag);
      viewport.removeEventListener("pointercancel", stopDrag);
      viewport.classList.remove("is-light-rotating");
    };
  }, [viewportRef]);
}

function parserDefaultsFor(model: PresetModel): Partial<ParserOptionsState> {
  const options = model.options as (ObjParseOptions & GltfParseOptions & VoxParseOptions) | undefined;
  return {
    ...(typeof options?.targetSize === "number" ? { targetSize: options.targetSize } : {}),
    ...(typeof options?.gridShift === "number" ? { gridShift: options.gridShift } : {}),
    ...(typeof options?.defaultColor === "string" ? { defaultColor: options.defaultColor } : {}),
  };
}

function randomPreset(): PresetModel {
  return PRESETS[Math.floor(Math.random() * PRESETS.length)] ?? PRESETS[0];
}

function sceneDefaultsFor(model: PresetModel): SceneOptionsState {
  return {
    ...DEFAULT_SCENE,
    zoom: model.zoom ?? DEFAULT_SCENE.zoom,
    rotX: model.rotX ?? DEFAULT_SCENE.rotX,
    rotY: model.rotY ?? DEFAULT_SCENE.rotY,
  };
}

function parserStateFor(model: PresetModel): ParserOptionsState {
  return {
    ...DEFAULT_PARSER,
    ...parserDefaultsFor(model),
  };
}

function withSolidMaterials(polygons: Polygon[], fallbackColor: string): Polygon[] {
  return polygons.map((polygon) => {
    if (!polygonHasTextureData(polygon)) {
      return polygon;
    }
    return {
      ...polygon,
      texture: undefined,
      material: undefined,
      uvs: undefined,
      textureTriangles: undefined,
      color: polygon.color ?? fallbackColor,
    };
  });
}

function polygonHasTextureData(polygon: Polygon): boolean {
  return Boolean(
    polygonHasTexturePaint(polygon) ||
    polygon.uvs?.length
  );
}

function polygonHasTexturePaint(polygon: Polygon): boolean {
  return Boolean(polygon.texture || polygon.material?.texture || polygon.textureTriangles?.length);
}

function inspectorColorKey(color: string): string {
  const parsed = parsePureColor(color);
  if (!parsed || parsed.alpha < 1) return color.trim().toLowerCase();
  return `#${parsed.rgb
    .map((channel) => Math.max(0, Math.min(255, Math.round(channel))).toString(16).padStart(2, "0"))
    .join("")}`;
}

interface InspectorColorSortKey {
  bucket: number;
  hue: number;
  saturation: number;
  value: number;
  label: string;
}

function inspectorColorSortKey(color: string): InspectorColorSortKey {
  const parsed = parsePureColor(color);
  if (!parsed) return { bucket: 2, hue: 0, saturation: 0, value: 0, label: color };
  const [r, g, b] = parsed.rgb.map((channel) => Math.max(0, Math.min(255, channel)) / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  const saturation = max === 0 ? 0 : delta / max;
  let hue = 0;
  if (delta !== 0) {
    if (max === r) hue = 60 * (((g - b) / delta) % 6);
    else if (max === g) hue = 60 * ((b - r) / delta + 2);
    else hue = 60 * ((r - g) / delta + 4);
  }
  if (hue < 0) hue += 360;
  const neutral = saturation < 0.08;
  return {
    bucket: neutral ? 0 : 1,
    hue: neutral ? 0 : hue,
    saturation: neutral ? 0 : saturation,
    value: max,
    label: color,
  };
}

function compareInspectorColors(a: string, b: string): number {
  const ak = inspectorColorSortKey(a);
  const bk = inspectorColorSortKey(b);
  return (
    ak.bucket - bk.bucket ||
    ak.hue - bk.hue ||
    bk.saturation - ak.saturation ||
    ak.value - bk.value ||
    ak.label.localeCompare(bk.label)
  );
}

function displayAnimationName(name: string): string {
  const localName = (name.split("|").pop() ?? name).trim();
  return localName
    .replace(/^(Animal|Character|Fish|Human|Monster|Robot|Snake)[ _-]+/i, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim() || name;
}

function animationOptionKey(name: string): string {
  return displayAnimationName(name).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function animationNameHasArmaturePrefix(name: string): boolean {
  return name.includes("|");
}

function dedupeAnimationClips(clips: AnimationClip[]): AnimationClip[] {
  const byName = new Map<string, AnimationClip>();
  for (const clip of clips) {
    const key = animationOptionKey(clip.name);
    const existing = byName.get(key);
    if (!existing || (animationNameHasArmaturePrefix(existing.name) && !animationNameHasArmaturePrefix(clip.name))) {
      byName.set(key, clip);
    }
  }
  return Array.from(byName.values());
}

function animationClipValue(clip: AnimationClip): string {
  return String(clip.index);
}

function animationSearchText(name: string): string {
  return `${name} ${displayAnimationName(name)}`
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function isWalkingAnimationClip(clip: AnimationClip): boolean {
  return /\bwalk(?:ing)?\b/.test(animationSearchText(clip.name));
}

function isIdleAnimationClip(clip: AnimationClip): boolean {
  return /\bidle\b/.test(animationSearchText(clip.name));
}

function firstSelectableAnimationValue(model: LoadedModel): string {
  const clips = dedupeAnimationClips(model.animation?.clips ?? []);
  const preferred = clips.find(isWalkingAnimationClip) ?? clips.find((clip) => !isIdleAnimationClip(clip)) ?? clips[0];
  return preferred ? animationClipValue(preferred) : "";
}

function hasAnimationValue(model: LoadedModel, value: string): boolean {
  if (value === "") return true;
  return dedupeAnimationClips(model.animation?.clips ?? []).some((clip) => animationClipValue(clip) === value);
}

function resolveInitialPreset(): PresetModel {
  const id = routeInitialPresetId(ALL_PRESET_IDS);
  return (id ? PRESETS.find((p) => p.id === id) : null) ?? randomPreset();
}

export default function GalleryWorkbench() {
  const [initialPreset] = useState<PresetModel>(resolveInitialPreset);
  const [sceneOptions, setSceneOptions] = useState<SceneOptionsState>(() => sceneDefaultsFor(initialPreset));
  const [parserOptions, setParserOptions] = useState<ParserOptionsState>(() => parserStateFor(initialPreset));
  const [presetId, setPresetId] = useState(initialPreset.id);
  const [loaded, setLoaded] = useState<LoadedModel | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [selectedAnimation, setSelectedAnimation] = useState("");
  const [metrics, setMetrics] = useState<DomMetrics>(EMPTY_METRICS);
  const [vanillaBuildMs, setVanillaBuildMs] = useState(0);
  const [modelSearch, setModelSearch] = useState("");
  const [openModelCategory, setOpenModelCategory] = useState<string | null>(null);
  const [mobilePanel, setMobilePanel] = useState<MobileGalleryPanel>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const autoZoomPresetRef = useRef<string | null>(null);
  const autoAmbientPresetRef = useRef<string | null>(null);
  const autoKeyPresetRef = useRef<string | null>(null);
  const loadedModelKeyRef = useRef<string | null>(null);

  // Selection + drag state for the React renderer's <PolyMesh> wrapper.
  // Lives at this level so a model swap can reset both — the gizmo
  // shouldn't follow a stale handle, and a freshly loaded mesh should
  // sit at its authored origin.
  const meshRef = useRef<ReactPolyMeshHandle>(null);
  const [meshPosition, setMeshPosition] = useState<ReactVec3>([0, 0, 0]);
  const [meshRotation, setMeshRotation] = useState<ReactVec3>([0, 0, 0]);
  const [gizmoMode, setGizmoMode] = useState<GizmoMode>("translate");
  const [selectedMeshes, setSelectedMeshes] = useState<ReactPolyMeshHandle[]>([]);
  // Mirror of PolyTransformControls' drag state — three.js convention is to
  // disable OrbitControls while a transform gizmo is being dragged so
  // the camera doesn't co-rotate. Same idea here: gate PolyOrbitControls'
  // drag/wheel on this flag.
  const [gizmoDragging, setGizmoDragging] = useState(false);
  // Hover state for the mesh — wired the r3f / three.js way via
  // onPointerOver / onPointerOut on <PolyMesh>. Demonstrates the
  // mesh-event API (events.ts → InteractionProps) — same shape as
  // r3f, no raycasting needed because polycss uses DOM events.
  const [hoveredMeshId, setHoveredMeshId] = useState<string | null>(null);
  // Mesh handle for the currently rendered model (vanilla path only). The
  // Inspector folder uses this to push color-group edits back into the
  // scene via setPolygons. Set by VanillaScene's onMeshHandleChange.
  const activeMeshHandleRef = useRef<VanillaPolyMeshHandle | null>(null);
  const [materialEditVersion, setMaterialEditVersion] = useState(0);
  // Vanilla selection state — kept separate from React's
  // `selectedMeshes` because vanilla MeshHandles aren't comparable to
  // React PolyMeshHandles. Stored as IDs since that's what both paths
  // can agree on for the toolbar display.
  const [, setVanillaSelectedIds] = useState<string[]>([]);

  const updateScene = useCallback((partial: Partial<SceneOptionsState>) => {
    setSceneOptions((current) => ({ ...current, ...partial }));
  }, []);

  const { handleCameraChange } = useGuiCameraSync({ setSceneOptions });

  const dropped = useDroppedFiles({
    onDroppedSource: (source) => {
      autoZoomPresetRef.current = null;
      autoAmbientPresetRef.current = null;
      autoKeyPresetRef.current = null;
      setRoutePresetId(null);
      setPresetId(source.id);
      if (loadedModelKeyRef.current !== source.id) loadedModelKeyRef.current = null;
      setSelectedAnimation("");
      setParserOptions((current) => ({
        ...current,
        ...parserDefaultsFor(source.preset),
      }));
      setSceneOptions((current) => ({
        ...current,
        rotX: source.preset.rotX ?? current.rotX,
        rotY: source.preset.rotY ?? current.rotY,
      }));
    },
    onDropError: (message) => setLoadError(message),
  });

  const availablePresets = useMemo(
    () => dropped.droppedSource ? [dropped.droppedSource.preset, ...PRESETS] : PRESETS,
    [dropped.droppedSource],
  );
  const pickerItems = useMemo(
    () => dropped.droppedSource ? [presetPickerItem(dropped.droppedSource.preset, true), ...PRESET_PICKER_ITEMS] : PRESET_PICKER_ITEMS,
    [dropped.droppedSource],
  );
  const selectedPreset = availablePresets.find((preset) => preset.id === presetId) ?? PRESETS[0];
  const selectedDroppedSource = dropped.droppedSource?.id === selectedPreset.id ? dropped.droppedSource : null;
  const loadMeshResolution = activeMeshResolution(sceneOptions.meshResolution);
  const handleLoaded = useCallback((model: LoadedModel) => {
    const modelKey = selectedPreset.id;
    const modelChanged = loadedModelKeyRef.current !== modelKey;
    loadedModelKeyRef.current = modelKey;
    setLoaded(model);
    setSelectedAnimation((current) => {
      const first = firstSelectableAnimationValue(model);
      if (!first) return "";
      if (!modelChanged && hasAnimationValue(model, current)) return current;
      return first;
    });
  }, [selectedPreset.id]);
  const selectedPresetPickerCategory =
    pickerItems.find((preset) => preset.id === selectedPreset.id)?.category ??
    galleryBucketForPreset(selectedPreset);
  const trimmedModelSearch = modelSearch.trim().toLowerCase();
  const filteredPresetItems = useMemo(() => {
    if (!trimmedModelSearch) return pickerItems;
    return pickerItems.filter((preset) =>
      preset.searchText.includes(trimmedModelSearch),
    );
  }, [pickerItems, trimmedModelSearch]);
  const modelCategories = useMemo(() => {
    const buckets = new Map<string, { id: string; label: string; models: typeof PRESET_PICKER_ITEMS }>();
    if (!trimmedModelSearch) {
      for (const category of GALLERY_BUCKET_ORDER) {
        buckets.set(category, { id: category, label: category, models: [] as typeof PRESET_PICKER_ITEMS });
      }
    }
    for (const preset of filteredPresetItems) {
      const category = preset.category || "Other";
      if (!buckets.has(category)) {
        buckets.set(category, { id: category, label: category, models: [] as typeof PRESET_PICKER_ITEMS });
      }
      buckets.get(category)!.models.push(preset);
    }
    const orderedCategories = Array.from(buckets.values()).sort((a, b) =>
      galleryBucketRank(a.id) - galleryBucketRank(b.id)
    );
    for (const category of orderedCategories) {
      category.models.sort((a, b) => a.label.localeCompare(b.label));
    }
    return orderedCategories;
  }, [filteredPresetItems, trimmedModelSearch]);
  const defaultCategoryId = modelCategories.find((category) => category.models.length > 0)?.id ?? modelCategories[0]?.id;
  const isCategoryOpen = useCallback(
    (categoryId: string): boolean => {
      if (trimmedModelSearch) return true;
      if (openModelCategory !== null) return categoryId === openModelCategory;
      return categoryId === selectedPresetPickerCategory || categoryId === defaultCategoryId;
    },
    [trimmedModelSearch, openModelCategory, selectedPresetPickerCategory, defaultCategoryId],
  );
  const handleToggleCategory = useCallback((categoryId: string) => {
    setOpenModelCategory((prev) => (prev === categoryId ? null : categoryId));
  }, []);
  const modelTreeId = useMemo(() => {
    const slug = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/gi, "-").replace(/(^-|-$)/g, "");
    return modelCategories.map((category) => `debug-model-cat-${slug(category.id) || "category"}`);
  }, [modelCategories]);

  useEffect(() => {
    if (trimmedModelSearch) {
      return;
    }
    setOpenModelCategory((prev) => (prev === selectedPresetPickerCategory ? prev : selectedPresetPickerCategory));
  }, [trimmedModelSearch, selectedPresetPickerCategory]);

  usePresetLoader({
    selectedPreset,
    selectedDroppedSource,
    parserOptions,
    meshResolution: loadMeshResolution,
    onLoaded: handleLoaded,
    onLoadError: (msg) => {
      setLoaded(null);
      setLoadError(msg || null);
    },
    onLoadingChange: setLoading,
    onSceneDefaults: (zoom, ambientIntensity, lightIntensity) => {
      setSceneOptions((current) => {
        const nextZoom = zoom ?? current.zoom;
        const nextAmbient = ambientIntensity ?? current.ambientIntensity;
        const nextKey = lightIntensity ?? current.lightIntensity;
        if (
          current.zoom === nextZoom &&
          current.ambientIntensity === nextAmbient &&
          current.lightIntensity === nextKey
        ) return current;
        return { ...current, zoom: nextZoom, ambientIntensity: nextAmbient, lightIntensity: nextKey };
      });
    },
    autoZoomPresetRef,
    autoAmbientPresetRef,
    autoKeyPresetRef,
  });

  // Drop selection + reset gizmo position when the model changes. The
  // PolyMesh wrapper persists across model swaps, so without this the
  // user would inherit the previous model's drag offset.
  useEffect(() => {
    setSelectedMeshes([]);
    setVanillaSelectedIds([]);
    setMeshPosition([0, 0, 0]);
    setMeshRotation([0, 0, 0]);
  }, [loaded?.label]);

  const directionalLight = useMemo(
    () => directionalFromOptions(sceneOptions),
    [
      sceneOptions.lightAzimuth,
      sceneOptions.lightElevation,
      sceneOptions.lightColor,
      sceneOptions.lightIntensity,
    ],
  );
  const ambientLight = useMemo(
    () => ambientFromOptions(sceneOptions),
    [sceneOptions.ambientColor, sceneOptions.ambientIntensity],
  );
  const textureQuality = sceneOptions.textureQuality;

  const animationClips = loaded?.animation?.clips ?? [];
  const selectableAnimationClips = useMemo(
    () => dedupeAnimationClips(animationClips),
    [animationClips],
  );
  const activeAnimation = useMemo(
    () => animationClips.find((clip) => String(clip.index) === selectedAnimation) ?? null,
    [animationClips, selectedAnimation],
  );
  const hasActiveAnimation = activeAnimation !== null;
  const effectiveMeshResolution = activeMeshResolution(sceneOptions.meshResolution);
  const renderLoaded = useMemo(() => {
    if (!loaded || !activeAnimation || effectiveMeshResolution !== "lossy") return loaded;
    const optimized = optimizeAnimatedMeshPolygons(loaded.parseResult, {
      meshResolution: effectiveMeshResolution,
    });
    if (optimized === loaded.parseResult) return loaded;
    return {
      ...loaded,
      parseResult: optimized,
      rawPolygons: optimized.polygons,
      polygons: optimized.polygons,
      animation: optimized.animation,
    };
  }, [loaded, activeAnimation, effectiveMeshResolution]);

  const animation = useAnimationFrames({
    loaded: renderLoaded,
    activeAnimation,
    renderer: sceneOptions.renderer,
    animationPaused: sceneOptions.animationPaused,
    animationTimeScale: sceneOptions.animationTimeScale,
    reactMeshRef: meshRef,
  });

  const {
    modelPolygons,
    interiorShellPolygons,
    scenePolygons,
    helperScale,
    helperTarget,
  } = useScenePolygons({
    loaded: renderLoaded,
    hasActiveAnimation,
    meshResolution: sceneOptions.meshResolution,
    renderer: sceneOptions.renderer,
    reactAnimatedPolygons: animation.reactAnimatedPolygons,
    interiorFill: sceneOptions.interiorFill,
  });
  useLightRotationDrag(viewportRef, sceneOptions, helperScale, gizmoDragging, updateScene);
  const renderModelPolygons = useMemo(
    () => sceneOptions.solidMaterials
      ? withSolidMaterials(modelPolygons, parserOptions.defaultColor)
      : modelPolygons,
    [modelPolygons, sceneOptions.solidMaterials, parserOptions.defaultColor],
  );
  const renderPolygons = useMemo(
    () => renderModelPolygons,
    [renderModelPolygons],
  );
  const hasSpriteLeaves = useMemo(
    () => metrics.sprites > 0 || scenePolygons.some(polygonHasTextureData),
    [metrics.sprites, scenePolygons],
  );
  const vanillaAnimationFrameFactory = useMemo(() => {
    if (!animation.vanillaAnimationFrameFactory) return undefined;
    if (!sceneOptions.solidMaterials) return animation.vanillaAnimationFrameFactory;
    return (timeSeconds: number) =>
      withSolidMaterials(animation.vanillaAnimationFrameFactory!(timeSeconds), parserOptions.defaultColor);
  }, [
    animation.vanillaAnimationFrameFactory,
    sceneOptions.solidMaterials,
    parserOptions.defaultColor,
  ]);

  useFpvHost({
    dragMode: sceneOptions.dragMode,
    autoCenter: sceneOptions.autoCenter,
    perspective: sceneOptions.perspective,
    rotY: sceneOptions.rotY,
    scenePolygons,
    updateScene,
  });

  const resetToPreset = useCallback((id: string, options: { updateRoute?: boolean } = {}) => {
    const next = availablePresets.find((preset) => preset.id === id);
    autoZoomPresetRef.current = null;
    autoAmbientPresetRef.current = null;
    autoKeyPresetRef.current = null;
    setPresetId(id);
    if (loadedModelKeyRef.current !== id) loadedModelKeyRef.current = null;
    setSelectedAnimation("");
    animation.setReactAnimatedPolygons(null);
    if (!next) return;
    if (options.updateRoute) {
      if (dropped.droppedSource?.id === next.id) setRoutePresetId(null);
      else setRoutePresetId(next.id);
    }
    setParserOptions((current) => ({
      ...current,
      ...parserDefaultsFor(next),
    }));
    setSceneOptions((current) => ({
      ...current,
      rotX: next.rotX ?? current.rotX,
      rotY: next.rotY ?? current.rotY,
    }));
  }, [availablePresets, dropped.droppedSource, animation.setReactAnimatedPolygons]);

  const handleRandomPreset = useCallback(() => {
    const next = randomPreset();
    resetToPreset(next.id, { updateRoute: true });
    setMobilePanel(null);
  }, [resetToPreset]);

  const handlePresetClick = useCallback((id: string) => {
    resetToPreset(id, { updateRoute: true });
    setMobilePanel(null);
  }, [resetToPreset]);

  useEffect(() => {
    if (!mobilePanel) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMobilePanel(null);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [mobilePanel]);

  useRouteSync({
    presetId,
    presetIds: ALL_PRESET_IDS,
    resetToPreset,
  });

  useEffect(() => {
    const root = viewportRef.current;
    if (!root) return;
    let raf = 0;
    const update = () => {
      raf = 0;
      setMetrics(measureDom(root));
    };
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(update);
    };
    schedule();
    const observer = new MutationObserver(schedule);
    observer.observe(root, {
      childList: true,
      subtree: true,
    });
    return () => {
      observer.disconnect();
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  useEffect(() => {
    const root = viewportRef.current;
    if (!root) return;
    let raf = 0;
    const apply = () => {
      raf = 0;
      applyDebugMatrixPrecision(root, sceneOptions.matrixPrecision);
      applyDebugBorderShapePrecision(root, sceneOptions.borderShapePrecision);
      applyDebugTriangleBrushPrecision(root);
      applyDebugSolidColorHex(root);
      applyDebugInlineStyleOrder(root);
      applyDebugInlineStyleMinify(root);
    };
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(apply);
    };
    schedule();
    const observer = new MutationObserver(schedule);
    observer.observe(root, {
      childList: true,
      subtree: true,
    });
    return () => {
      observer.disconnect();
      if (raf) cancelAnimationFrame(raf);
    };
  }, [
    sceneOptions.matrixPrecision,
    sceneOptions.borderShapePrecision,
    sceneOptions.renderer,
    sceneOptions.textureLighting,
    sceneOptions.textureQuality,
    sceneOptions.solidMaterials,
    scenePolygons,
    renderPolygons,
    vanillaBuildMs,
  ]);

  const rendererDebugKey = useMemo(
    () => [
      sceneOptions.renderer,
      sceneOptions.matrixPrecision,
      sceneOptions.borderShapePrecision,
      sceneOptions.textureLighting,
      sceneOptions.textureQuality,
      sceneOptions.solidMaterials ? "solid-materials" : "authored-materials",
      sceneOptions.interiorFill ? "interior-fill" : "no-interior-fill",
      sceneOptions.autoCenter,
      sceneOptions.perspective === false ? "none" : sceneOptions.perspective,
      loaded?.label ?? "none",
    ].join(":"),
    [
      sceneOptions.renderer,
      sceneOptions.matrixPrecision,
      sceneOptions.borderShapePrecision,
      sceneOptions.textureLighting,
      sceneOptions.textureQuality,
      sceneOptions.solidMaterials,
      sceneOptions.interiorFill,
      sceneOptions.autoCenter,
      sceneOptions.perspective,
      loaded?.label,
    ],
  );

  const animationOptions = useMemo(() => {
    const options: Record<string, string> = { None: "" };
    for (const clip of selectableAnimationClips) {
      options[`${displayAnimationName(clip.name)} (${clip.duration.toFixed(2)}s)`] = String(clip.index);
    }
    return options;
  }, [selectableAnimationClips]);
  const perspectiveMode = sceneOptions.perspective === false ? "orthographic" : "perspective";
  const perspectivePx = sceneOptions.perspective === false ? 8000 : sceneOptions.perspective;

  // Materials data — grouped by mesh, then by canonical polygon color.
  const inspectorMeshes = useMemo<InspectorMesh[]>(() => {
    if (renderModelPolygons.length === 0) return [];
    const colorGroups = new Map<string, Polygon[]>();
    const textured: Polygon[] = [];
    for (const p of renderModelPolygons) {
      if (polygonHasTexturePaint(p)) {
        textured.push(p);
        continue;
      }
      if (!p.color) continue;
      const key = inspectorColorKey(p.color);
      let arr = colorGroups.get(key);
      if (!arr) {
        arr = [];
        colorGroups.set(key, arr);
      }
      arr.push(p);
    }
    if (colorGroups.size === 0 && textured.length === 0) return [];
    const sortedColors = [...colorGroups.entries()]
      .sort((a, b) => compareInspectorColors(a[0], b[0]) || b[1].length - a[1].length)
      .map(([color, polys]) => ({
        color,
        count: polys.length,
        editable: true,
        polygons: polys,
      }));
    const groups: InspectorColorGroup[] = sortedColors;
    if (textured.length > 0) {
      groups.push({
        color: "textured",
        count: textured.length,
        editable: false,
        polygons: textured,
      });
    }
    const label = loaded?.label ?? "model";
    return [{ id: label, label, groups }];
  }, [renderModelPolygons, loaded?.label, materialEditVersion]);

  const handleInspectorColorChange = useCallback(
    (
      _mesh: InspectorMesh,
      group: InspectorColorGroup,
      next: string,
    ) => {
      for (const p of group.polygons) p.color = next;
      const handle = activeMeshHandleRef.current;
      // Pass the *source* polygons (pre-merge) — the renderer holds a
      // merged copy that doesn't see in-place edits. setPolygons without
      // an explicit merge flag reuses the mesh's current merge setting
      // (true for static models, false during animation playback).
      if (handle) handle.setPolygons(renderModelPolygons);
      setMaterialEditVersion((version) => version + 1);
    },
    [renderModelPolygons],
  );

  return (
    <div
      className={[
        "dn-root",
        "dn-root--gallery",
        dropped.dropActive ? "dn-root--drop-active" : "",
      ].filter(Boolean).join(" ")}
      onDragEnter={dropped.handleDragEnter}
      onDragOver={dropped.handleDragOver}
      onDragLeave={dropped.handleDragLeave}
      onDrop={dropped.handleDrop}
    >
      <ModelsSidebar
        id="gallery-models-panel"
        className={mobilePanel === "models" ? "is-mobile-open" : ""}
        modelSearch={modelSearch}
        onModelSearchChange={setModelSearch}
        onImportClick={() => dropped.fileInputRef.current?.click()}
        fileInputRef={dropped.fileInputRef}
        onFileInputChange={dropped.handleFileInputChange}
        onRandomPreset={handleRandomPreset}
        modelCategories={modelCategories}
        isCategoryOpen={isCategoryOpen}
        onToggleCategory={handleToggleCategory}
        modelTreeId={modelTreeId}
        presetId={presetId}
        onPresetClick={handlePresetClick}
        attribution={selectedPreset.attribution}
      />

      <main className="dn-main">
        <div
          className={`dn-viewport${sceneOptions.outlinePolygons ? " dn-viewport--outline-polygons" : ""}`}
          ref={viewportRef}
        >
          {sceneOptions.renderer === "vanilla" ? (
            <VanillaScene
              key={rendererDebugKey}
              polygons={renderModelPolygons}
              interiorShellPolygons={interiorShellPolygons}
              parseResult={renderLoaded?.parseResult}
              options={sceneOptions}
              directionalLight={directionalLight}
              ambientLight={ambientLight}
              showAxes={sceneOptions.showAxes}
              showLight={sceneOptions.showLight}
              showGround={sceneOptions.showGround}
              helperScale={helperScale}
              helperTarget={helperTarget}
              mergePolygonsForMesh={false}
              stableDomForMesh={hasActiveAnimation}
              animationKey={activeAnimation ? `${selectedAnimation}:${renderLoaded?.label ?? ""}` : undefined}
              animationDurationSeconds={activeAnimation?.duration}
              animationFrameFactory={vanillaAnimationFrameFactory}
              onBuild={setVanillaBuildMs}
              onCameraChange={handleCameraChange}
              enableSelection={sceneOptions.selection}
              meshId={renderLoaded?.label ?? "model"}
              onSelectionChange={setVanillaSelectedIds}
              gizmoMode={gizmoMode}
              enableHover={sceneOptions.hoverEffects}
              onHoverChange={setHoveredMeshId}
              onMeshHandleChange={(h) => { activeMeshHandleRef.current = h; }}
            />
          ) : (
            <ReactScene
              rendererDebugKey={rendererDebugKey}
              sceneOptions={sceneOptions}
              scenePolygons={renderModelPolygons}
              interiorShellPolygons={interiorShellPolygons}
              directionalLight={directionalLight}
              ambientLight={ambientLight}
              textureQuality={textureQuality}
              gizmoDragging={gizmoDragging}
              setGizmoDragging={setGizmoDragging}
              handleCameraChange={handleCameraChange}
              loaded={loaded}
              selectedMeshes={selectedMeshes}
              setSelectedMeshes={setSelectedMeshes}
              meshRef={meshRef}
              meshPosition={meshPosition}
              setMeshPosition={setMeshPosition}
              meshRotation={meshRotation}
              setMeshRotation={setMeshRotation}
              hoveredMeshId={hoveredMeshId}
              setHoveredMeshId={setHoveredMeshId}
              gizmoMode={gizmoMode}
              helperScale={helperScale}
              helperTarget={helperTarget}
            />
          )}
        </div>
        <DropOverlay active={dropped.dropActive} />
      </main>

      <StatsOverlay />

      <Dock
        id="gallery-controls-panel"
        className={mobilePanel === "controls" ? "is-mobile-open" : ""}
        loading={loading}
        loadError={loadError}
      >
        <DockModel
          metrics={metrics}
          disableStrategies={sceneOptions.disableStrategies}
          onUpdateScene={updateScene}
        />
        <DockMaterials
          meshes={inspectorMeshes}
          onColorChange={handleInspectorColorChange}
        />
        <DockRendering
          meshResolution={sceneOptions.meshResolution}
          interiorFill={sceneOptions.interiorFill}
          solidMaterials={sceneOptions.solidMaterials}
          textureLighting={sceneOptions.textureLighting}
          textureQuality={sceneOptions.textureQuality}
          hasActiveAnimation={hasActiveAnimation}
          hasSpriteLeaves={hasSpriteLeaves}
          onUpdateScene={updateScene}
        />
        <DockAnimation
          selectedAnimation={selectedAnimation}
          animationOptions={animationOptions}
          animationPaused={sceneOptions.animationPaused}
          animationTimeScale={sceneOptions.animationTimeScale}
          animationClipCount={selectableAnimationClips.length}
          onAnimationChange={setSelectedAnimation}
          onResetAnimatedPolygons={() => animation.setReactAnimatedPolygons(null)}
          onSelectAnimationClear={() => setSelectedAnimation("")}
          onUpdateScene={updateScene}
        />
        <DockInteraction
          interactive={sceneOptions.interactive}
          hoverEffects={sceneOptions.hoverEffects}
          selection={sceneOptions.selection}
          gizmoMode={gizmoMode}
          onUpdateScene={updateScene}
          onGizmoModeChange={setGizmoMode}
        />
        <DockCamera
          autoCenter={sceneOptions.autoCenter}
          showAxes={sceneOptions.showAxes}
          animate={sceneOptions.animate}
          dragMode={sceneOptions.dragMode}
          fpvLook={sceneOptions.fpvLook}
          fpvMove={sceneOptions.fpvMove}
          fpvJump={sceneOptions.fpvJump}
          fpvCrouch={sceneOptions.fpvCrouch}
          fpvMoveSpeed={sceneOptions.fpvMoveSpeed}
          fpvJumpVelocity={sceneOptions.fpvJumpVelocity}
          fpvGravity={sceneOptions.fpvGravity}
          fpvEyeHeight={sceneOptions.fpvEyeHeight}
          fpvCrouchHeight={sceneOptions.fpvCrouchHeight}
          fpvLookSensitivity={sceneOptions.fpvLookSensitivity}
          fpvInvertY={sceneOptions.fpvInvertY}
          fpvRenderDistance={sceneOptions.fpvRenderDistance}
          perspectiveMode={perspectiveMode}
          perspectivePx={perspectivePx}
          perspective={sceneOptions.perspective}
          zoom={sceneOptions.zoom}
          rotX={sceneOptions.rotX}
          rotY={sceneOptions.rotY}
          target={sceneOptions.target}
          loaded={loaded}
          selectedPreset={selectedPreset}
          defaultZoomForModel={(preset, polys) => defaultZoomForModel(preset as PresetModel, polys as Polygon[])}
          onUpdateScene={updateScene}
        />
        <DockLighting
          castShadow={sceneOptions.castShadow}
          shadowMaxExtend={sceneOptions.shadowMaxExtend}
          showGround={sceneOptions.showGround}
          showLight={sceneOptions.showLight}
          lightAzimuth={sceneOptions.lightAzimuth}
          lightElevation={sceneOptions.lightElevation}
          lightIntensity={sceneOptions.lightIntensity}
          lightColor={sceneOptions.lightColor}
          ambientIntensity={sceneOptions.ambientIntensity}
          ambientColor={sceneOptions.ambientColor}
          onUpdateScene={updateScene}
        />
      </Dock>

      <nav className="dn-mobile-tabs" aria-label="Gallery panels">
        <button
          type="button"
          className={`dn-mobile-tabs__button${mobilePanel === "models" ? " is-active" : ""}`}
          aria-controls="gallery-models-panel"
          aria-expanded={mobilePanel === "models"}
          onClick={() => setMobilePanel((current) => current === "models" ? null : "models")}
        >
          Models
        </button>
        <button
          type="button"
          className="dn-mobile-tabs__button dn-mobile-tabs__button--random"
          aria-label="Load random model"
          onClick={handleRandomPreset}
        >
          Random
        </button>
        <button
          type="button"
          className={`dn-mobile-tabs__button${mobilePanel === "controls" ? " is-active" : ""}`}
          aria-controls="gallery-controls-panel"
          aria-expanded={mobilePanel === "controls"}
          onClick={() => setMobilePanel((current) => current === "controls" ? null : "controls")}
        >
          Controls
        </button>
      </nav>
    </div>
  );
}
