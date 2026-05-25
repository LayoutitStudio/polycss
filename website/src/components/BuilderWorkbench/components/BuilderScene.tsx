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
import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { meshResolutionShowsMesh, type SceneOptionsState } from "../../types";
import { BUILDER_GROUND_SPAN, BUILDER_MAX_CAMERA_ROT_X } from "../defaults";
import { buildSolidWireframePolygons } from "../geometry/ghost";
import { meshBbox } from "../geometry/meshBbox";
import { projectScreenToWorldGround } from "../geometry/screenToWorld";
import { snapWorldToCellCenter, worldToGridCell } from "../geometry/snap";
import type { BuilderToolMode, PlacedItem } from "../types";
import { BuilderCameraDragControls } from "./BuilderCameraDragControls";

const GROUND_FILL_COLORS = {
  gray: "#f5f3ea",
  dark: "#05070b",
} as const;

export interface BuilderSceneProps {
  sceneOptions: SceneOptionsState;
  updateScene: (partial: Partial<SceneOptionsState>) => void;
  directionalLight: PolyDirectionalLight;
  ambientLight: PolyAmbientLight;
  /** One polygon per visible grid line, terrain-aware when raised. */
  gridPolygons: Polygon[];
  ghostPolygons: Polygon[];
  /** Single-quad outline showing the vertex the terrain-tool cursor is
   *  currently over. Empty when no terrain tool is active. */
  terrainHoverPolygons: Polygon[];
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
  onAddShapeAt: (worldX: number, worldY: number) => void;
  onRemoveItem: (id: string) => void;
  selected: PlacedItem | null;
}

function selectedSurfaceWorldZ(item: PlacedItem): number {
  if (!item.rawPolygons) return item.elevation ?? 0;
  const bbox = meshBbox(item.rawPolygons);
  const scale = Math.max(item.fitScale * item.scale, 0.0001);
  return item.position[2] / BASE_TILE + bbox.midZ * (1 - scale) + scale * bbox.minZ;
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

    const projectAt = (clientX: number, clientY: number, planeWorldZ: number): [number, number] | null =>
      projectScreenToWorldGround({
        clientX,
        clientY,
        cameraEl,
        sceneOptions: stateRef.current.sceneOptions,
        autoCenterOffset: store.getState().autoCenterOffset,
        planeWorldZ,
      });

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
  onAddShapeAt: (worldX: number, worldY: number) => void;
  onRemoveItem: (id: string) => void;
  onDraggingChanged: (dragging: boolean) => void;
  onHoverCellChange: (cell: [number, number] | null) => void;
}

function BuilderViewportToolControls({
  tool,
  sceneOptions,
  onAddShapeAt,
  onRemoveItem,
  onDraggingChanged,
  onHoverCellChange,
}: BuilderViewportToolControlsProps): null {
  const { store, cameraElRef } = useCameraContext();
  const stateRef = useRef({ tool, sceneOptions, onAddShapeAt, onRemoveItem, onDraggingChanged, onHoverCellChange });
  stateRef.current = { tool, sceneOptions, onAddShapeAt, onRemoveItem, onDraggingChanged, onHoverCellChange };
  const downRef = useRef<{ x: number; y: number; target: EventTarget | null } | null>(null);
  const hoverCellRef = useRef<[number, number] | null>(null);

  useEffect(() => {
    const cameraEl = cameraElRef.current;
    if (!cameraEl) return;

    const isUiOverlay = (target: EventTarget | null): boolean => {
      const el = target as HTMLElement | null;
      if (!el?.closest) return false;
      return Boolean(el.closest(".builder-tool-ribbon, .shape-picker, .builder-camera-mode, .dn-floating-controls"));
    };

    const projectAt = (clientX: number, clientY: number): [number, number] | null => {
      const state = stateRef.current;
      const hit = projectScreenToWorldGround({
        clientX,
        clientY,
        cameraEl,
        sceneOptions: state.sceneOptions,
        autoCenterOffset: store.getState().autoCenterOffset,
      });
      if (!hit) return null;
      if (!state.sceneOptions.snapToGrid || state.sceneOptions.gridResolution <= 0) return hit;
      return snapWorldToCellCenter(hit[0], hit[1], state.sceneOptions.gridResolution);
    };

    const setHoverCell = (cell: [number, number] | null): void => {
      const prev = hoverCellRef.current;
      if (prev?.[0] === cell?.[0] && prev?.[1] === cell?.[1]) return;
      hoverCellRef.current = cell;
      stateRef.current.onHoverCellChange(cell);
    };

    const onPointerMove = (event: PointerEvent): void => {
      const state = stateRef.current;
      if (state.tool !== "add" || isUiOverlay(event.target)) {
        setHoverCell(null);
        return;
      }
      const hit = projectAt(event.clientX, event.clientY);
      if (!hit) {
        setHoverCell(null);
        return;
      }
      setHoverCell(worldToGridCell(hit[0], hit[1], state.sceneOptions.gridResolution));
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

      const hit = projectAt(event.clientX, event.clientY);
      if (!hit) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      state.onAddShapeAt(hit[0], hit[1]);
    };
    const onPointerLeave = (): void => setHoverCell(null);

    cameraEl.addEventListener("pointerdown", onPointerDown, true);
    cameraEl.addEventListener("pointermove", onPointerMove, true);
    cameraEl.addEventListener("pointerleave", onPointerLeave, true);
    cameraEl.addEventListener("click", onClick, true);
    return () => {
      cameraEl.removeEventListener("pointerdown", onPointerDown, true);
      cameraEl.removeEventListener("pointermove", onPointerMove, true);
      cameraEl.removeEventListener("pointerleave", onPointerLeave, true);
      cameraEl.removeEventListener("click", onClick, true);
      downRef.current = null;
      setHoverCell(null);
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
  terrainHoverPolygons,
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
  const Cam = sceneOptions.perspective === false ? PolyOrthographicCamera : PolyPerspectiveCamera;
  const sceneKey = sceneOptions.meshResolution;
  const [addHoverCell, setAddHoverCell] = useState<[number, number] | null>(null);
  const camProps = sceneOptions.perspective === false
    ? { zoom: sceneOptions.zoom, rotX: sceneOptions.rotX, rotY: sceneOptions.rotY, target: sceneOptions.target }
    : { zoom: sceneOptions.zoom, rotX: sceneOptions.rotX, rotY: sceneOptions.rotY, target: sceneOptions.target, perspective: sceneOptions.perspective };
  const handleCameraChange = (cam: { rotX: number; rotY: number; zoom: number; target?: Vec3 }) => updateScene({
    rotX: cam.rotX,
    rotY: cam.rotY,
    zoom: cam.zoom,
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
  const addHoverPolygons = useMemo<Polygon[]>(() => {
    if (!addHoverCell || builderTool !== "add" || !sceneOptions.showGround) return [];
    const [cellX, cellY] = addHoverCell;
    const cellSize = sceneOptions.gridResolution > 0 ? sceneOptions.gridResolution : 10;
    const x0 = cellX * cellSize;
    const x1 = (cellX + 1) * cellSize;
    const y0 = cellY * cellSize;
    const y1 = (cellY + 1) * cellSize;
    const z = 0.04;
    const color = "rgba(34, 211, 238, 0.22)";
    return [{
      vertices: [
        [x0, y0, z],
        [x1, y0, z],
        [x1, y1, z],
        [x0, y1, z],
      ],
      color,
    }];
  }, [addHoverCell, builderTool, sceneOptions.gridResolution, sceneOptions.showGround]);
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

  useEffect(() => {
    if (builderTool !== "add") setAddHoverCell(null);
  }, [builderTool]);

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
        onAddShapeAt={onAddShapeAt}
        onRemoveItem={onRemoveItem}
        onDraggingChanged={onGizmoDraggingChanged}
        onHoverCellChange={setAddHoverCell}
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
      >
        {sceneOptions.showGround && (
          <>
            <PolyMesh polygons={groundFillPolygons} className="builder-ground-fill" />
            <PolyMesh polygons={gridPolygons} />
          </>
        )}
        {addHoverPolygons.length > 0 && (
          <PolyMesh polygons={addHoverPolygons} className="builder-add-hover" />
        )}
        {/* Terrain hover ghost — small cyan marker over the vertex the
            next click will modify. */}
        {terrainHoverPolygons.length > 0 && (
          <PolyMesh polygons={terrainHoverPolygons} className="builder-terrain-hover" />
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
