import {
  BASE_TILE,
  PolyAxesHelper,
  PolyDirectionalLightHelper,
  PolyFirstPersonControls,
  PolyMapControls,
  PolyMesh,
  PolyOrbitControls,
  PolyOrthographicCamera,
  PolyPerspectiveCamera,
  PolyScene,
  PolySelect,
  PolyTransformControls,
  useCameraContext,
} from "@layoutit/polycss-react";
import type {
  PolyAmbientLight,
  PolyDirectionalLight,
  PolyFirstPersonControlsHandle,
  PolyMeshHandle,
  PolyTransformControlsObjectChangeEvent,
  Polygon,
  Vec3,
} from "@layoutit/polycss-react";
import { useEffect, useMemo, useRef, type RefObject } from "react";
import { meshResolutionShowsMesh, type SceneOptionsState } from "../../types";
import { FPV_PERSPECTIVE } from "../../fpv";
import { BUILDER_GROUND_SPAN, BUILDER_MAX_CAMERA_ROT_X } from "../defaults";
import { buildSolidWireframePolygons } from "../geometry/ghost";
import { meshBbox } from "../geometry/meshBbox";
import { projectScreenToWorldGround } from "../geometry/screenToWorld";
import { snapWorldToCellCenter } from "../geometry/snap";
import type { BuilderPlacementTarget, BuilderToolMode, PlacedItem } from "../types";
import { BuilderCameraDragControls } from "./BuilderCameraDragControls";

const GROUND_FILL_COLORS = {
  gray: "#f5f3ea",
  dark: "#05070b",
} as const;

// The Dock's camera slider feeds a unitless 0.05–2.5 zoom value (legacy
// CSS-scale semantics shared with the gallery). Post-parity the camera
// expects px-per-world-unit, so we multiply the slider value by BASE_TILE
// (50) before handing it to the camera, and divide it back before pushing
// updates into sceneOptions. Same shape as gallery's LEGACY_ZOOM_COMPAT.
const LEGACY_ZOOM_COMPAT = 50;

export interface BuilderSceneProps {
  sceneOptions: SceneOptionsState;
  updateScene: (partial: Partial<SceneOptionsState>) => void;
  directionalLight: PolyDirectionalLight;
  ambientLight: PolyAmbientLight;
  /** One polygon per visible grid line, terrain-aware when raised. */
  gridPolygons: Polygon[];
  ghostPolygons: Polygon[];
  placementDraft: boolean;
  renderItems: Array<PlacedItem & { rawPolygons: Polygon[] }>;
  renderedPolygonsById: Map<string, Polygon[]>;
  interiorShellPolygonsById: Map<string, Polygon[]>;
  selectedId: string | null;
  gizmoDragging: boolean;
  meshHandlesRef: RefObject<Map<string, PolyMeshHandle>>;
  getMeshRefCallback: (id: string) => (h: PolyMeshHandle | null) => void;
  fpvControlsRef: RefObject<PolyFirstPersonControlsHandle | null>;
  onSelectionChange: (handles: PolyMeshHandle[]) => void;
  onGizmoDraggingChanged: (dragging: boolean) => void;
  onGizmoObjectChange: (event: PolyTransformControlsObjectChangeEvent) => void;
  onSelectedMeshDrag: (id: string, worldX: number, worldY: number) => void;
  onStepSelectedElevation: (direction: 1 | -1) => void;
  builderTool: BuilderToolMode;
  onAddShapeAt: (target: BuilderPlacementTarget) => void;
  onRemoveItem: (id: string) => void;
  selected: PlacedItem | null;
}

// Post-parity `<PolyMesh position>` is `T·R·S` pivoting at the local origin,
// so visible(v) = T + S·v (no rotation here — XY surfaces are axis-aligned).
// `position[2]` is the world-Z translate, so the visible bottom of a vertex
// at v.z = minZ sits at `position[2] + scale * minZ`.
function selectedSurfaceWorldZ(item: PlacedItem): number {
  if (!item.rawPolygons) return item.elevation ?? 0;
  const bbox = meshBbox(item.rawPolygons);
  const scale = Math.max(item.fitScale * item.scale, 0.0001);
  return item.position[2] + scale * bbox.minZ;
}

function itemTopSurfaceWorldZ(item: PlacedItem & { rawPolygons: Polygon[] }, polygons: Polygon[]): number {
  const bbox = meshBbox(polygons);
  const scale = Math.max(item.fitScale * item.scale, 0.0001);
  return item.position[2] + scale * bbox.maxZ;
}

function itemBaseSurfaceWorldZ(item: PlacedItem & { rawPolygons: Polygon[] }, polygons: Polygon[]): number {
  const bbox = meshBbox(polygons);
  const scale = Math.max(item.fitScale * item.scale, 0.0001);
  return item.position[2] + scale * bbox.minZ;
}

interface PlacementSurface {
  baseWorldZ: number;
  surfaceWorldZ: number;
  minWorldX: number;
  maxWorldX: number;
  minWorldY: number;
  maxWorldY: number;
}

type PaintLeafFace = "top" | "side" | "other";

function transformNormalZ(transform: string): number | null {
  const matrix3d = transform.match(/^matrix3d\((.+)\)$/);
  if (matrix3d) {
    const values = matrix3d[1].split(",").map((value) => Number(value.trim()));
    if (values.length !== 16 || values.some((value) => !Number.isFinite(value))) return null;
    const nx = values[8];
    const ny = values[9];
    const nz = values[10];
    const len = Math.hypot(nx, ny, nz);
    return len > 0 ? nz / len : null;
  }

  const matrix = transform.match(/^matrix\((.+)\)$/);
  if (matrix) return 1;
  return null;
}

function paintLeafFace(target: EventTarget | null): PaintLeafFace {
  const el = target as Element | null;
  const leaf = el?.closest("b,i,s,u") as HTMLElement | null;
  if (!leaf || !leaf.closest(".builder-placed")) return "other";
  const normalZ = transformNormalZ(getComputedStyle(leaf).transform);
  if (normalZ === null) return "other";
  if (normalZ > 0.5) return "top";
  if (Math.abs(normalZ) < 0.25) return "side";
  return "other";
}

function placementSurfaceForItem(item: PlacedItem & { rawPolygons: Polygon[] }, polygons: Polygon[]): PlacementSurface {
  const bbox = meshBbox(polygons);
  const scale = Math.max(item.fitScale * item.scale, 0.0001);
  const rz = ((item.rotation[2] ?? 0) * Math.PI) / 180;
  const cos = Math.cos(rz);
  const sin = Math.sin(rz);
  let minWorldX = Infinity;
  let maxWorldX = -Infinity;
  let minWorldY = Infinity;
  let maxWorldY = -Infinity;
  for (const [x, y] of [
    [bbox.minX, bbox.minY],
    [bbox.maxX, bbox.minY],
    [bbox.maxX, bbox.maxY],
    [bbox.minX, bbox.maxY],
  ] as const) {
    const dx = (x - bbox.midX) * scale;
    const dy = (y - bbox.midY) * scale;
    const worldX = item.worldX + dx * cos - dy * sin;
    const worldY = item.worldY + dx * sin + dy * cos;
    minWorldX = Math.min(minWorldX, worldX);
    maxWorldX = Math.max(maxWorldX, worldX);
    minWorldY = Math.min(minWorldY, worldY);
    maxWorldY = Math.max(maxWorldY, worldY);
  }
  return {
    baseWorldZ: itemBaseSurfaceWorldZ(item, polygons),
    surfaceWorldZ: itemTopSurfaceWorldZ(item, polygons),
    minWorldX,
    maxWorldX,
    minWorldY,
    maxWorldY,
  };
}

function zArrowDirectionFromTarget(target: Element | null): 1 | -1 | null {
  const arrow = target?.closest(".polycss-transform-arrow--z, .polycss-transform-arrow---z");
  if (!arrow) return null;
  return arrow.classList.contains("polycss-transform-arrow---z") ? -1 : 1;
}

function zArrowDirectionFromPoint(clientX: number, clientY: number): 1 | -1 | null {
  for (const [selector, direction] of [
    [".polycss-transform-arrow--z", 1],
    [".polycss-transform-arrow---z", -1],
  ] as const) {
    const arrow = document.querySelector(selector);
    if (!arrow) continue;
    const leaves = arrow.querySelectorAll("b,i,s,u,q,svg");
    for (const leaf of leaves) {
      const rect = leaf.getBoundingClientRect();
      if (rect.width <= 1 || rect.height <= 1) continue;
      if (
        clientX >= rect.left &&
        clientX <= rect.right &&
        clientY >= rect.top &&
        clientY <= rect.bottom
      ) {
        return direction;
      }
    }
  }
  return null;
}

interface BuilderSelectedMeshInteractionControlsProps {
  selected: PlacedItem | null;
  sceneOptions: SceneOptionsState;
  enabled: boolean;
  onSelectedMeshDrag: (id: string, worldX: number, worldY: number) => void;
  onDraggingChanged: (dragging: boolean) => void;
  onStepSelectedElevation: (direction: 1 | -1) => void;
}

function BuilderSelectedMeshInteractionControls({
  selected,
  sceneOptions,
  enabled,
  onSelectedMeshDrag,
  onDraggingChanged,
  onStepSelectedElevation,
}: BuilderSelectedMeshInteractionControlsProps): null {
  const { store, cameraElRef } = useCameraContext();
  const stateRef = useRef({
    selected,
    sceneOptions,
    enabled,
    onSelectedMeshDrag,
    onDraggingChanged,
    onStepSelectedElevation,
  });
  stateRef.current = {
    selected,
    sceneOptions,
    enabled,
    onSelectedMeshDrag,
    onDraggingChanged,
    onStepSelectedElevation,
  };
  const dragRef = useRef<{
    id: string;
    pointerId: number;
    planeWorldZ: number;
    offsetX: number;
    offsetY: number;
    startX: number;
    startY: number;
  } | null>(null);

  useEffect(() => {
    const cameraEl = cameraElRef.current;
    if (!cameraEl) return;

    const armClickSwallow = (): void => {
      const swallow = (event: Event): void => {
        event.stopPropagation();
        event.stopImmediatePropagation();
      };
      window.addEventListener("click", swallow, { capture: true, once: true });
      setTimeout(() => window.removeEventListener("click", swallow, true), 0);
    };

    const projectAt = (clientX: number, clientY: number, planeWorldZ: number): [number, number] | null => {
      const opts = stateRef.current.sceneOptions;
      return projectScreenToWorldGround({
        clientX,
        clientY,
        cameraEl,
        sceneOptions: { ...opts, zoom: opts.zoom * LEGACY_ZOOM_COMPAT },
        autoCenterOffset: store.getState().autoCenterOffset,
        planeWorldZ,
      });
    };

    const armZClickSwallow = (pointerId: number): void => {
      const onUp = (event: PointerEvent): void => {
        if (event.pointerId !== pointerId) return;
        window.removeEventListener("pointerup", onUp, true);
        window.removeEventListener("pointercancel", onUp, true);
        armClickSwallow();
      };
      window.addEventListener("pointerup", onUp, true);
      window.addEventListener("pointercancel", onUp, true);
    };

    const onPointerDown = (event: PointerEvent): void => {
      if (!stateRef.current.enabled) return;
      if (event.button !== 0 || event.isPrimary === false) return;
      const target = event.target as Element | null;

      const zDirection = zArrowDirectionFromTarget(target) ?? zArrowDirectionFromPoint(event.clientX, event.clientY);
      if (zDirection) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        stateRef.current.onStepSelectedElevation(zDirection);
        armZClickSwallow(event.pointerId);
        return;
      }

      if (target?.closest(".polycss-transform-gizmo")) return;
      const current = stateRef.current.selected;
      if (!current) return;
      const meshEl = target?.closest(".builder-placed.is-selected") as HTMLElement | null;
      if (!meshEl || meshEl.dataset.polyMeshId !== current.id) return;

      const planeWorldZ = selectedSurfaceWorldZ(current);
      const hit = projectAt(event.clientX, event.clientY, planeWorldZ);
      if (!hit) return;

      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      dragRef.current = {
        id: current.id,
        pointerId: event.pointerId,
        planeWorldZ,
        offsetX: current.worldX - hit[0],
        offsetY: current.worldY - hit[1],
        startX: event.clientX,
        startY: event.clientY,
      };
      cameraEl.style.cursor = "grabbing";
      stateRef.current.onDraggingChanged(true);
    };

    const onPointerMove = (event: PointerEvent): void => {
      const drag = dragRef.current;
      if (!drag || event.pointerId !== drag.pointerId) return;
      const hit = projectAt(event.clientX, event.clientY, drag.planeWorldZ);
      if (!hit) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      stateRef.current.onSelectedMeshDrag(drag.id, hit[0] + drag.offsetX, hit[1] + drag.offsetY);
    };

    const onPointerDone = (event: PointerEvent): void => {
      const drag = dragRef.current;
      if (!drag || event.pointerId !== drag.pointerId) return;
      dragRef.current = null;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      cameraEl.style.cursor = stateRef.current.sceneOptions.interactive ? "grab" : "";
      stateRef.current.onDraggingChanged(false);
      armClickSwallow();
    };

    cameraEl.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("pointermove", onPointerMove, true);
    window.addEventListener("pointerup", onPointerDone, true);
    window.addEventListener("pointercancel", onPointerDone, true);

    return () => {
      cameraEl.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("pointermove", onPointerMove, true);
      window.removeEventListener("pointerup", onPointerDone, true);
      window.removeEventListener("pointercancel", onPointerDone, true);
      if (dragRef.current) {
        dragRef.current = null;
        stateRef.current.onDraggingChanged(false);
      }
    };
  }, [cameraElRef, store]);

  return null;
}

interface BuilderViewportToolControlsProps {
  tool: BuilderToolMode;
  sceneOptions: SceneOptionsState;
  placementSurfaceById: Map<string, PlacementSurface>;
  onAddShapeAt: (target: BuilderPlacementTarget) => void;
  onRemoveItem: (id: string) => void;
  onDraggingChanged: (dragging: boolean) => void;
}

function BuilderViewportToolControls({
  tool,
  sceneOptions,
  placementSurfaceById,
  onAddShapeAt,
  onRemoveItem,
  onDraggingChanged,
}: BuilderViewportToolControlsProps): null {
  const { store, cameraElRef } = useCameraContext();
  const stateRef = useRef({
    tool,
    sceneOptions,
    placementSurfaceById,
    onAddShapeAt,
    onRemoveItem,
    onDraggingChanged,
  });
  stateRef.current = {
    tool,
    sceneOptions,
    placementSurfaceById,
    onAddShapeAt,
    onRemoveItem,
    onDraggingChanged,
  };
  const downRef = useRef<{ x: number; y: number; target: EventTarget | null } | null>(null);

  useEffect(() => {
    const cameraEl = cameraElRef.current;
    if (!cameraEl) return;

    const isUiOverlay = (target: EventTarget | null): boolean => {
      const el = target as HTMLElement | null;
      if (!el?.closest) return false;
      return Boolean(el.closest(".builder-tool-ribbon, .shape-picker, .builder-camera-mode, .dn-floating-controls"));
    };

    const snapHit = (hit: [number, number]): [number, number] => {
      const { sceneOptions: options } = stateRef.current;
      if (!options.snapToGrid || options.gridResolution <= 0) return hit;
      return snapWorldToCellCenter(hit[0], hit[1], options.gridResolution);
    };

    const projectAt = (clientX: number, clientY: number, planeWorldZ = 0): [number, number] | null => {
      const state = stateRef.current;
      const opts = state.sceneOptions;
      const hit = projectScreenToWorldGround({
        clientX,
        clientY,
        cameraEl,
        sceneOptions: { ...opts, zoom: opts.zoom * LEGACY_ZOOM_COMPAT },
        autoCenterOffset: store.getState().autoCenterOffset,
        planeWorldZ,
      });
      return hit;
    };

    const surfaceForTarget = (target: EventTarget | null): PlacementSurface | null => {
      const el = target as Element | null;
      const meshEl = el?.closest(".builder-placed") as HTMLElement | null;
      const id = meshEl?.dataset.polyMeshId;
      if (!id) return null;
      return stateRef.current.placementSurfaceById.get(id) ?? null;
    };

    const clampToSurface = (hit: [number, number], surface: PlacementSurface): [number, number] => {
      const { sceneOptions: options } = stateRef.current;
      if (!options.snapToGrid || options.gridResolution <= 0) {
        return [
          Math.min(surface.maxWorldX, Math.max(surface.minWorldX, hit[0])),
          Math.min(surface.maxWorldY, Math.max(surface.minWorldY, hit[1])),
        ];
      }

      const step = options.gridResolution;
      const minCenterX = surface.minWorldX + step / 2;
      const maxCenterX = surface.maxWorldX - step / 2;
      const minCenterY = surface.minWorldY + step / 2;
      const maxCenterY = surface.maxWorldY - step / 2;
      const centerX = (surface.minWorldX + surface.maxWorldX) / 2;
      const centerY = (surface.minWorldY + surface.maxWorldY) / 2;
      return [
        minCenterX <= maxCenterX
          ? Math.min(maxCenterX, Math.max(minCenterX, hit[0]))
          : centerX,
        minCenterY <= maxCenterY
          ? Math.min(maxCenterY, Math.max(minCenterY, hit[1]))
          : centerY,
      ];
    };

    const highestSurfaceAt = (worldX: number, worldY: number, fallback: PlacementSurface): number => {
      const epsilon = Math.max(0.001, stateRef.current.sceneOptions.gridResolution * 0.01);
      let top = fallback.surfaceWorldZ;
      for (const surface of stateRef.current.placementSurfaceById.values()) {
        if (
          worldX >= surface.minWorldX - epsilon &&
          worldX <= surface.maxWorldX + epsilon &&
          worldY >= surface.minWorldY - epsilon &&
          worldY <= surface.maxWorldY + epsilon
        ) {
          top = Math.max(top, surface.surfaceWorldZ);
        }
      }
      return top;
    };

    const sidePlacementTarget = (hit: [number, number], surface: PlacementSurface): [number, number] => {
      const { sceneOptions: options } = stateRef.current;
      const step = options.gridResolution > 0
        ? options.gridResolution
        : Math.max(surface.maxWorldX - surface.minWorldX, surface.maxWorldY - surface.minWorldY, 1);
      const centerX = (surface.minWorldX + surface.maxWorldX) / 2;
      const centerY = (surface.minWorldY + surface.maxWorldY) / 2;
      const snapped = options.snapToGrid && options.gridResolution > 0
        ? snapWorldToCellCenter(hit[0], hit[1], step)
        : hit;
      const minCenterX = surface.minWorldX + step / 2;
      const maxCenterX = surface.maxWorldX - step / 2;
      const minCenterY = surface.minWorldY + step / 2;
      const maxCenterY = surface.maxWorldY - step / 2;
      const clampX = (value: number): number =>
        minCenterX <= maxCenterX
          ? Math.min(maxCenterX, Math.max(minCenterX, value))
          : centerX;
      const clampY = (value: number): number =>
        minCenterY <= maxCenterY
          ? Math.min(maxCenterY, Math.max(minCenterY, value))
          : centerY;
      const sides = [
        { axis: "x" as const, sign: -1 as const, distance: Math.abs(hit[0] - surface.minWorldX) },
        { axis: "x" as const, sign: 1 as const, distance: Math.abs(hit[0] - surface.maxWorldX) },
        { axis: "y" as const, sign: -1 as const, distance: Math.abs(hit[1] - surface.minWorldY) },
        { axis: "y" as const, sign: 1 as const, distance: Math.abs(hit[1] - surface.maxWorldY) },
      ].sort((a, b) => a.distance - b.distance);
      const side = sides[0];
      if (side.axis === "x") {
        return [
          side.sign < 0 ? surface.minWorldX - step / 2 : surface.maxWorldX + step / 2,
          clampY(snapped[1]),
        ];
      }
      return [
        clampX(snapped[0]),
        side.sign < 0 ? surface.minWorldY - step / 2 : surface.maxWorldY + step / 2,
      ];
    };

    const onPointerDown = (event: PointerEvent): void => {
      if (stateRef.current.tool === "move") return;
      if (event.button !== 0 || event.isPrimary === false) return;
      if (isUiOverlay(event.target)) return;
      downRef.current = { x: event.clientX, y: event.clientY, target: event.target };
    };

    const onClick = (event: MouseEvent): void => {
      const state = stateRef.current;
      if (state.tool === "move") return;
      if (isUiOverlay(event.target)) return;
      const down = downRef.current;
      downRef.current = null;
      if (down && Math.hypot(event.clientX - down.x, event.clientY - down.y) > 8) return;

      if (state.tool === "remove") {
        const el = event.target as Element | null;
        const meshEl = el?.closest(".builder-placed") as HTMLElement | null;
        const id = meshEl?.dataset.polyMeshId;
        if (!id) return;
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        state.onRemoveItem(id);
        return;
      }

      const face = paintLeafFace(event.target);
      const surface = face !== "other" ? surfaceForTarget(event.target) : null;
      let hit: [number, number] | null = null;
      let surfaceWorldZ: number | null = null;
      if (surface && face === "top") {
        const projected = projectAt(event.clientX, event.clientY, surface.surfaceWorldZ);
        if (!projected) return;
        hit = clampToSurface(snapHit(projected), surface);
        surfaceWorldZ = highestSurfaceAt(hit[0], hit[1], surface);
      } else if (surface && face === "side") {
        const projected = projectAt(event.clientX, event.clientY, surface.baseWorldZ);
        if (!projected) return;
        hit = sidePlacementTarget(projected, surface);
        surfaceWorldZ = surface.baseWorldZ;
      } else {
        const projected = projectAt(event.clientX, event.clientY);
        if (!projected) return;
        hit = snapHit(projected);
      }
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      state.onAddShapeAt({
        worldX: hit[0],
        worldY: hit[1],
        ...(surfaceWorldZ !== null ? { surfaceWorldZ } : null),
      });
    };

    cameraEl.addEventListener("pointerdown", onPointerDown, true);
    cameraEl.addEventListener("click", onClick, true);
    return () => {
      cameraEl.removeEventListener("pointerdown", onPointerDown, true);
      cameraEl.removeEventListener("click", onClick, true);
      downRef.current = null;
      stateRef.current.onDraggingChanged(false);
    };
  }, [cameraElRef, store]);

  return null;
}

export function BuilderScene({
  sceneOptions,
  updateScene,
  directionalLight,
  ambientLight,
  gridPolygons,
  ghostPolygons,
  placementDraft,
  renderItems,
  renderedPolygonsById,
  interiorShellPolygonsById,
  selectedId,
  gizmoDragging,
  meshHandlesRef,
  getMeshRefCallback,
  fpvControlsRef,
  onSelectionChange,
  onGizmoDraggingChanged,
  onGizmoObjectChange,
  onSelectedMeshDrag,
  onStepSelectedElevation,
  builderTool,
  onAddShapeAt,
  onRemoveItem,
  selected,
}: BuilderSceneProps) {
  const perspective = sceneOptions.dragMode === "fpv" ? FPV_PERSPECTIVE : sceneOptions.perspective;
  const Cam = perspective === false ? PolyOrthographicCamera : PolyPerspectiveCamera;
  const sceneKey = sceneOptions.meshResolution;
  const cameraZoom = sceneOptions.zoom * LEGACY_ZOOM_COMPAT;
  const camProps = perspective === false
    ? { zoom: cameraZoom, rotX: sceneOptions.rotX, rotY: sceneOptions.rotY, target: sceneOptions.target }
    : {
      zoom: cameraZoom,
      rotX: sceneOptions.rotX,
      rotY: sceneOptions.rotY,
      target: sceneOptions.target,
      ...(typeof perspective === "number" ? { perspective } : {}),
    };
  const handleCameraChange = (cam: { rotX: number; rotY: number; zoom: number; target?: Vec3 }) => updateScene({
    rotX: cam.rotX,
    rotY: cam.rotY,
    zoom: cam.zoom / LEGACY_ZOOM_COMPAT,
    ...(cam.target ? { target: cam.target } : {}),
  });
  const selectedWireframePolygons = useMemo<Polygon[]>(() => {
    if (!selected?.rawPolygons) return [];
    const polygons = renderedPolygonsById.get(selected.id) ?? selected.rawPolygons;
    const bbox = meshBbox(polygons);
    const fitScale = Math.max(selected.fitScale, 0.0001);
    const combinedScale = Math.max(selected.fitScale * selected.scale, 0.0001);
    const cellSize = sceneOptions.gridResolution > 0 ? sceneOptions.gridResolution : 10;
    const edgeHalf = 0.07 / combinedScale;
    return buildSolidWireframePolygons({
      worldX: bbox.midX,
      worldY: bbox.midY,
      hx: cellSize / (2 * fitScale),
      hy: cellSize / (2 * fitScale),
      height: cellSize / fitScale,
      baseZ: bbox.minZ,
    }, "#00d9ff", edgeHalf);
  }, [renderedPolygonsById, sceneOptions.gridResolution, selected]);
  const placementSurfaceById = useMemo(() => {
    const surfaces = new Map<string, PlacementSurface>();
    for (const item of renderItems) {
      surfaces.set(
        item.id,
        placementSurfaceForItem(item, renderedPolygonsById.get(item.id) ?? item.rawPolygons),
      );
    }
    return surfaces;
  }, [renderItems, renderedPolygonsById]);
  const groundFillPolygons = useMemo<Polygon[]>(() => {
    const half = BUILDER_GROUND_SPAN / 2;
    const [cx, cy] = sceneOptions.target;
    return [{
      vertices: [
        [cx - half, cy - half, -0.03],
        [cx + half, cy - half, -0.03],
        [cx + half, cy + half, -0.03],
        [cx - half, cy + half, -0.03],
      ],
      color: GROUND_FILL_COLORS[sceneOptions.gridTone],
    }];
  }, [sceneOptions.gridTone, sceneOptions.target]);

  return (
    <Cam key={sceneKey} {...camProps}>
      <BuilderSelectedMeshInteractionControls
        selected={selected}
        sceneOptions={sceneOptions}
        enabled={builderTool === "move"}
        onSelectedMeshDrag={onSelectedMeshDrag}
        onDraggingChanged={onGizmoDraggingChanged}
        onStepSelectedElevation={onStepSelectedElevation}
      />
      <BuilderViewportToolControls
        tool={builderTool}
        sceneOptions={sceneOptions}
        placementSurfaceById={placementSurfaceById}
        onAddShapeAt={onAddShapeAt}
        onRemoveItem={onRemoveItem}
        onDraggingChanged={onGizmoDraggingChanged}
      />
      {sceneOptions.dragMode === "pan" ? (
        <>
          <PolyMapControls
            drag={false}
            wheel={sceneOptions.interactive && !gizmoDragging}
            animate={sceneOptions.animate ? { speed: 0.35, axis: "y", pauseOnInteraction: true } : false}
            onInteractionEnd={handleCameraChange}
          />
          <BuilderCameraDragControls
            mode="pan"
            enabled={sceneOptions.interactive && !gizmoDragging}
            maxRotX={BUILDER_MAX_CAMERA_ROT_X}
            onInteractionEnd={handleCameraChange}
          />
        </>
      ) : sceneOptions.dragMode === "fpv" ? (
        <PolyFirstPersonControls
          ref={fpvControlsRef}
          lookEnabled={sceneOptions.fpvLook}
          moveEnabled={sceneOptions.fpvMove}
          jumpEnabled={sceneOptions.fpvJump}
          crouchEnabled={sceneOptions.fpvCrouch}
          moveSpeed={sceneOptions.fpvMoveSpeed}
          jumpVelocity={sceneOptions.fpvJumpVelocity}
          gravity={sceneOptions.fpvGravity}
          eyeHeight={sceneOptions.fpvEyeHeight}
          crouchHeight={sceneOptions.fpvCrouchHeight}
          lookSensitivity={sceneOptions.fpvLookSensitivity}
          invertY={sceneOptions.fpvInvertY}
        />
      ) : (
        <>
          <PolyOrbitControls
            drag={false}
            wheel={sceneOptions.interactive && !gizmoDragging}
            animate={sceneOptions.animate ? { speed: 0.35, axis: "y", pauseOnInteraction: true } : false}
            onInteractionEnd={handleCameraChange}
          />
          <BuilderCameraDragControls
            mode="orbit"
            enabled={sceneOptions.interactive && !gizmoDragging}
            maxRotX={BUILDER_MAX_CAMERA_ROT_X}
            onInteractionEnd={handleCameraChange}
          />
        </>
      )}
      <PolyScene
        polygons={[]}
        autoCenter={sceneOptions.autoCenter}
        directionalLight={directionalLight}
        ambientLight={ambientLight}
        textureLighting={sceneOptions.textureLighting}
        textureQuality={sceneOptions.textureQuality}
        strategies={{ disable: sceneOptions.disableStrategies }}
        shadow={{ maxExtend: sceneOptions.shadowMaxExtend }}
      >
        {sceneOptions.showGround && (
          <>
            <PolyMesh polygons={groundFillPolygons} className="builder-ground-fill" />
            <PolyMesh polygons={gridPolygons} />
          </>
        )}
        {sceneOptions.showAxes && <PolyAxesHelper size={3} />}
        {sceneOptions.showLight && (
          <PolyDirectionalLightHelper
            light={directionalLight}
            target={[0, 0, 0]}
            distance={10}
            size={0.6}
          />
        )}
        {/* Placement-mode ghost wireframe — bbox edges of the
            preset, positioned with its bottom face touching the
            floor at the cursor's projected ground point. Pointer
            events that drive the cursor + commit live on the
            viewport DOM — no catcher mesh. */}
        {placementDraft && (
          <PolyMesh
            polygons={ghostPolygons}
            className="builder-ghost"
          />
        )}
        <PolySelect onChange={onSelectionChange} clearOnMiss={true}>
          {renderItems.map((it) => {
            const shell = interiorShellPolygonsById.get(it.id) ?? [];
            return (
              <PolyMesh
                key={it.id}
                ref={getMeshRefCallback(it.id)}
                id={it.id}
                polygons={renderedPolygonsById.get(it.id) ?? it.rawPolygons}
                position={it.position}
                rotation={it.rotation}
                scale={it.fitScale * it.scale}
                castShadow={sceneOptions.castShadow}
                style={{ cursor: "pointer" }}
                className={[
                  "builder-placed",
                  it.id === selectedId ? "is-selected" : "",
                  !meshResolutionShowsMesh(sceneOptions.meshResolution) ? "is-mesh-hidden" : "",
                ].filter(Boolean).join(" ")}
              >
                {shell.length > 0 ? (
                  <PolyMesh polygons={shell} className="dn-interior-shell-mesh" />
                ) : null}
                {it.id === selectedId && selectedWireframePolygons.length > 0 ? (
                  <PolyMesh id={it.id} polygons={selectedWireframePolygons} className="builder-selection-wireframe" />
                ) : null}
              </PolyMesh>
            );
          })}
        </PolySelect>
        {selected && builderTool === "move" && (
          <PolyTransformControls
            object={meshHandlesRef.current.get(selected.id) ?? null}
            mode="translate"
            size={selected.fitScale * selected.scale}
            showX={false}
            showY={false}
            showZ={true}
            translationSnap={sceneOptions.snapToGrid ? sceneOptions.gridResolution * BASE_TILE : null}
            onObjectChange={onGizmoObjectChange}
            onDraggingChanged={onGizmoDraggingChanged}
          />
        )}
      </PolyScene>
    </Cam>
  );
}
