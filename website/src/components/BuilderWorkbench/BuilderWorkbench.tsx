import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import type {
  PolyFirstPersonControlsHandle,
  PolyMeshHandle,
  PolyTransformControlsObjectChangeEvent,
} from "@layoutit/polycss-react";
import { directionalFromOptions, ambientFromOptions } from "../GalleryWorkbench/helpers/lighting";
import { labelFromFile } from "../GalleryWorkbench/presets";
import type { DroppedModelSource, PresetModel } from "../GalleryWorkbench/types";
import type { SceneOptionsState } from "../types";
import { StatsOverlay } from "../StatsOverlay";
import "../GalleryWorkbench/gallery-workbench.css";
import "./builder-workbench.css";
import { BUILDER_MAX_CAMERA_ROT_X, DEFAULT_SCENE } from "./defaults";
import { usePlacements } from "./hooks/usePlacements";
import { useCameraShortcuts } from "./hooks/useCameraShortcuts";
import { useSceneRender } from "./hooks/useSceneRender";
import { useTerrain } from "./hooks/useTerrain";
import { meshBbox } from "./geometry/meshBbox";
import { placeMeshOnFloor } from "./geometry/placement";
import { snapWorldToCellCenter } from "./geometry/snap";
import { sampleTerrain, rotationForSlope, type TerrainVertices } from "./geometry/terrain";
import { BuilderScene } from "./components/BuilderScene";
import { BuilderSceneOutliner } from "./components/BuilderSceneOutliner";
import { BuilderCameraModePill } from "./components/BuilderCameraModePill";
import { BuilderDock } from "./components/BuilderDock";
import { BuilderToolRibbon } from "./components/BuilderToolRibbon";
import { ShapePicker } from "./components/ShapePicker";
import { BUILDER_SHAPE_PRESETS } from "./shapePresets";
import {
  readBuilderSceneFromUrl,
  sceneOptionsFromSerialized,
  serializeBuilderSceneToParam,
  updateBuilderSceneUrl,
} from "./sceneUrl";
import type { BuilderToolMode, PlacedItem, TargetMode, ToolMode } from "./types";

const TILE = 50;
const BUILDER_IMPORT_EXTENSIONS = new Set(["obj", "glb", "vox"]);
const BUILDER_IMPORT_DEFAULT_COLOR = "#8b95a1";

function clampBuilderCameraUpdate(partial: Partial<SceneOptionsState>): Partial<SceneOptionsState> {
  const next = { ...partial };
  if (typeof next.rotX === "number") {
    next.rotX = Math.min(BUILDER_MAX_CAMERA_ROT_X, Math.max(0, next.rotX));
  }
  if (next.target) {
    next.target = [next.target[0], next.target[1], Math.max(0, next.target[2])];
  }
  return next;
}

function fileListToArray(fileList: FileList | null): File[] {
  const files: File[] = [];
  if (!fileList) return files;
  for (let i = 0; i < fileList.length; i += 1) {
    const file = fileList.item(i);
    if (file) files.push(file);
  }
  return files;
}

function fileExtension(name: string): string {
  const clean = name.split("?")[0].split("#")[0];
  const dot = clean.lastIndexOf(".");
  return dot >= 0 ? clean.slice(dot + 1).toLowerCase() : "";
}

function importedKindForFile(file: File): DroppedModelSource["kind"] | null {
  const ext = fileExtension(file.name);
  if (ext === "obj" || ext === "glb" || ext === "vox") return ext;
  return null;
}

function importedSourceFromFiles(files: File[]): DroppedModelSource | null {
  const primaryFile = files.find((file) => BUILDER_IMPORT_EXTENSIONS.has(fileExtension(file.name)));
  if (!primaryFile) return null;

  const kind = importedKindForFile(primaryFile);
  if (!kind) return null;

  const label = labelFromFile(primaryFile.name) || primaryFile.name;
  const id = `builder-import-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const preset: PresetModel = {
    id,
    label,
    kind,
    category: "Imported",
    url: "",
    options: {
      targetSize: 60,
      gridShift: kind === "vox" ? 0 : 1,
      defaultColor: BUILDER_IMPORT_DEFAULT_COLOR,
    },
    galleryBucket: kind === "vox" ? "Voxel" : "Solid",
    attribution: { creator: "Local file" },
  };

  return { id, label, kind, primaryFile, files, preset };
}

/** Re-anchor a placed item to the current terrain at its (worldX, worldY):
 *  recomputes Z so the mesh's bottom sits on the sampled surface (with
 *  the COMBINED scale fitScale × scale, so user-scaling preserves the
 *  floor anchor) and rotation so the mesh tilts to match the local slope.
 *  Items without `rawPolygons` (scene-preset placeholders before lazy
 *  load) are passed through unchanged. */
function snapPlacement(
  item: PlacedItem,
  terrainVertices: TerrainVertices,
  gridResolution: number,
  snapToGrid: boolean,
): PlacedItem {
  if (!item.rawPolygons) return item;
  const [worldX, worldY] = snapToGrid
    ? snapWorldToCellCenter(item.worldX, item.worldY, gridResolution)
    : [item.worldX, item.worldY];
  const bbox = meshBbox(item.rawPolygons);
  const fitScale = bbox.span > 0 && gridResolution > 0 ? gridResolution / bbox.span : item.fitScale;
  const sample = sampleTerrain(terrainVertices, gridResolution, worldX, worldY);
  const elevation = item.elevation ?? 0;
  const position = placeMeshOnFloor(worldX, worldY, bbox, fitScale * item.scale, sample.z + elevation);
  const rotation = rotationForSlope(sample.slopeX, sample.slopeY);
  return { ...item, worldX, worldY, elevation, fitScale, position, rotation };
}

export default function BuilderWorkbench() {
  // Imperative handle for PolyFirstPersonControls — read by useFpvCull to
  // pull the live camera origin without round-tripping through React state.
  const fpvControlsRef = useRef<PolyFirstPersonControlsHandle | null>(null);
  const importInputRef = useRef<HTMLInputElement | null>(null);

  const [sceneOptions, setSceneOptions] = useState<SceneOptionsState>(() => ({ ...DEFAULT_SCENE }));
  const updateScene = useCallback((partial: Partial<SceneOptionsState>) => {
    setSceneOptions((prev) => ({ ...prev, ...clampBuilderCameraUpdate(partial) }));
  }, []);

  const [gizmoDragging, setGizmoDragging] = useState(false);
  const toolMode: ToolMode = "pointer";
  const [builderTool, setBuilderTool] = useState<BuilderToolMode>("move");
  const [selectedShapeId, setSelectedShapeId] = useState<string | null>(null);
  const [placingShapeId, setPlacingShapeId] = useState<string | null>(null);
  const targetMode: TargetMode = "face";

  const {
    placedItems,
    selectedId,
    setSelectedId,
    buildPlacement,
    buildDroppedPlacement,
    appendItems,
    replaceItems,
    updateItem,
    mapItems,
    handleDeleteItem,
    meshHandlesRef,
    getMeshRefCallback,
    selectedIdRef,
    handleDeleteSelectedRef,
  } = usePlacements({
    meshResolution: sceneOptions.meshResolution,
    gridResolution: sceneOptions.gridResolution,
  });

  // Terrain editor — engaged when toolMode is anything other than "pointer".
  // Declared before shape placement because placement reads the
  // heightmap to land meshes on raised terrain with the local slope
  // tilt. The grid polygons in useSceneRender also consume this so the
  // floor grid bends with the terrain — there's no separate solid-fill
  // mesh anymore, the grid IS the terrain.
  const { hoverPolygons, vertices: terrainVertices } = useTerrain({ toolMode, targetMode, sceneOptions });

  useCameraShortcuts({ dragMode: sceneOptions.dragMode, updateScene });

  const [urlSyncReady, setUrlSyncReady] = useState(false);
  const urlRestoreStartedRef = useRef(false);

  useEffect(() => {
    if (urlRestoreStartedRef.current) return;
    urlRestoreStartedRef.current = true;
    const serialized = readBuilderSceneFromUrl();
    if (!serialized) {
      setUrlSyncReady(true);
      return;
    }

    let cancelled = false;
    const options = sceneOptionsFromSerialized(serialized);
    const restoredOptions = { ...DEFAULT_SCENE, ...options };
    updateScene(options);

    void (async () => {
      const restoredItems: PlacedItem[] = [];
      for (const item of serialized.i) {
        const preset = BUILDER_SHAPE_PRESETS.find((shape) => shape.id === item.p);
        if (!preset) continue;
        const placement = await buildPlacement(preset, item.x, item.y, {
          scale: item.s ?? 1,
          elevation: item.z ?? 0,
          color: item.c,
          rotation: item.r,
        });
        if (!placement) continue;
        restoredItems.push(
          snapPlacement(placement, terrainVertices, restoredOptions.gridResolution, restoredOptions.snapToGrid),
        );
      }
      if (cancelled) return;
      replaceItems(restoredItems);
      setSelectedId(null);
      setUrlSyncReady(true);
    })();

    return () => {
      cancelled = true;
    };
  }, [buildPlacement, replaceItems, setSelectedId, terrainVertices, updateScene]);

  useEffect(() => {
    if (!urlSyncReady) return;
    updateBuilderSceneUrl(serializeBuilderSceneToParam(placedItems, sceneOptions));
  }, [placedItems, sceneOptions, urlSyncReady]);

  // Terrain-follow: when the heightmap changes, re-snap every placed
  // item to the current surface at its (worldX, worldY). Note: this
  // overwrites any user-applied gizmo rotation on the next terrain
  // edit, which mirrors what the original placement does on commit —
  // keep terrain shape stable when fine-tuning rotation.
  useEffect(() => {
    mapItems((it) => snapPlacement(it, terrainVertices, sceneOptions.gridResolution, sceneOptions.snapToGrid));
  }, [terrainVertices, mapItems, sceneOptions.gridResolution, sceneOptions.snapToGrid]);

  const { renderedPolygonsById, interiorShellPolygonsById, renderItems, gridPolygons } = useSceneRender({
    placedItems,
    selectedId,
    sceneOptions,
    fpvControlsRef,
    updateScene,
    terrainVertices,
  });

  // Derived lighting + perspective mode for Dock + scene rendering.
  const directionalLight = useMemo(
    () => directionalFromOptions(sceneOptions),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sceneOptions.lightAzimuth, sceneOptions.lightElevation, sceneOptions.lightIntensity, sceneOptions.lightColor],
  );
  const ambientLight = useMemo(
    () => ambientFromOptions(sceneOptions),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sceneOptions.ambientIntensity, sceneOptions.ambientColor],
  );
  const selected = useMemo(
    () => placedItems.find((it) => it.id === selectedId) ?? null,
    [placedItems, selectedId],
  );

  const handleShapeClick = useCallback((id: string) => {
    setSelectedShapeId(id);
    setBuilderTool("add");
  }, []);

  const handleBuilderToolChange = useCallback((mode: BuilderToolMode) => {
    setBuilderTool(mode);
    if (mode === "move") {
      setSelectedShapeId(null);
    } else if (mode === "add" && selectedShapeId === null) {
      setSelectedShapeId(BUILDER_SHAPE_PRESETS[0]?.id ?? null);
    }
  }, [selectedShapeId]);

  const handleToggleGridTone = useCallback(() => {
    updateScene({ gridTone: sceneOptions.gridTone === "gray" ? "dark" : "gray" });
  }, [sceneOptions.gridTone, updateScene]);

  const handleImportShape = useCallback(() => {
    importInputRef.current?.click();
  }, []);

  const handleImportInputChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const files = fileListToArray(event.currentTarget.files);
    event.currentTarget.value = "";

    const source = importedSourceFromFiles(files);
    if (!source) {
      console.warn("[builder] import ignored: choose a .vox, .obj, or .glb file");
      return;
    }

    void (async () => {
      const placement = await buildDroppedPlacement(source, sceneOptions.target[0], sceneOptions.target[1]);
      if (!placement) return;
      const snapped = snapPlacement(placement, terrainVertices, sceneOptions.gridResolution, sceneOptions.snapToGrid);
      appendItems([snapped]);
      setSelectedId(snapped.id);
      setSelectedShapeId(null);
      setBuilderTool("move");
    })();
  }, [
    appendItems,
    buildDroppedPlacement,
    sceneOptions.gridResolution,
    sceneOptions.snapToGrid,
    sceneOptions.target,
    setSelectedId,
    terrainVertices,
  ]);

  const handleRestart = useCallback(() => {
    replaceItems([]);
    setSelectedId(null);
    setSelectedShapeId(null);
    setPlacingShapeId(null);
    setBuilderTool("move");
    setSceneOptions({ ...DEFAULT_SCENE });
  }, [replaceItems, setSelectedId]);

  const handleAddShapeAt = useCallback(async (worldX: number, worldY: number) => {
    if (placingShapeId) return;
    const preset = BUILDER_SHAPE_PRESETS.find((shape) => shape.id === selectedShapeId);
    if (!preset) return;
    setPlacingShapeId(preset.id);
    try {
      const placement = await buildPlacement(preset, worldX, worldY);
      if (!placement) return;
      const snapped = snapPlacement(placement, terrainVertices, sceneOptions.gridResolution, sceneOptions.snapToGrid);
      appendItems([snapped]);
      setSelectedId(snapped.id);
    } finally {
      setPlacingShapeId(null);
    }
  }, [
    appendItems,
    buildPlacement,
    placingShapeId,
    sceneOptions.gridResolution,
    sceneOptions.snapToGrid,
    selectedShapeId,
    setSelectedId,
    terrainVertices,
  ]);

  // Delete (or Backspace on Mac) removes the selected item. Ignored while
  // focus is in a text input so it doesn't fire while editing dock values.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!selectedIdRef.current) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        handleDeleteSelectedRef.current?.();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const handleSelectionChange = useCallback((handles: PolyMeshHandle[]) => {
    const first = handles[0] ?? null;
    if (!first) { setSelectedId(null); return; }
    const id = (first as unknown as { id?: string }).id;
    setSelectedId(typeof id === "string" ? id : null);
  }, [setSelectedId]);

  const handleGizmoObjectChange = useCallback((event: PolyTransformControlsObjectChangeEvent) => {
    if (!selected) return;
    const nextPosition = event.position;
    if (nextPosition) {
      const dxCss = nextPosition[1] - selected.position[1];
      const dyCss = nextPosition[0] - selected.position[0];
      const dzCss = nextPosition[2] - selected.position[2];
      if (Math.abs(dzCss) > Math.max(Math.abs(dxCss), Math.abs(dyCss), 0.001)) {
        const snapped = snapPlacement(
          { ...selected, elevation: Math.max(0, (selected.elevation ?? 0) + dzCss / TILE) },
          terrainVertices,
          sceneOptions.gridResolution,
          sceneOptions.snapToGrid,
        );
        updateItem(selected.id, {
          elevation: snapped.elevation,
          position: snapped.position,
          rotation: snapped.rotation,
        });
        return;
      }

      const newWorldX = selected.worldX + dxCss / TILE;
      const newWorldY = selected.worldY + dyCss / TILE;
      const snapped = snapPlacement(
        { ...selected, worldX: newWorldX, worldY: newWorldY },
        terrainVertices,
        sceneOptions.gridResolution,
        sceneOptions.snapToGrid,
      );
      updateItem(selected.id, {
        worldX: snapped.worldX,
        worldY: snapped.worldY,
        position: snapped.position,
        rotation: snapped.rotation,
      });
    } else if (event.rotation) {
      updateItem(selected.id, { rotation: event.rotation });
    }
  }, [selected, updateItem, terrainVertices, sceneOptions.gridResolution, sceneOptions.snapToGrid]);

  const handleSelectedMeshDrag = useCallback((id: string, worldX: number, worldY: number) => {
    mapItems((it) =>
      it.id === id
        ? snapPlacement({ ...it, worldX, worldY }, terrainVertices, sceneOptions.gridResolution, sceneOptions.snapToGrid)
        : it,
    );
  }, [mapItems, terrainVertices, sceneOptions.gridResolution, sceneOptions.snapToGrid]);

  const handleStepSelectedElevation = useCallback((direction: 1 | -1) => {
    mapItems((it) =>
      it.id === selectedIdRef.current
        ? snapPlacement(
            { ...it, elevation: Math.max(0, (it.elevation ?? 0) + direction * sceneOptions.gridResolution) },
            terrainVertices,
            sceneOptions.gridResolution,
            sceneOptions.snapToGrid,
          )
        : it,
    );
  }, [mapItems, terrainVertices, sceneOptions.gridResolution, sceneOptions.snapToGrid, selectedIdRef]);

  const handleDeleteSelected = useCallback(() => {
    handleDeleteSelectedRef.current?.();
  }, [handleDeleteSelectedRef]);

  // Scale slider — apply new scale AND re-anchor the bottom of the mesh
  // to the surface. Without this, scaling around the bbox centre would
  // make the item sink into / lift off the floor.
  const handleScaleSelected = useCallback((scale: number) => {
    mapItems((it) =>
      it.id === selectedIdRef.current
        ? snapPlacement({ ...it, scale }, terrainVertices, sceneOptions.gridResolution, sceneOptions.snapToGrid)
        : it,
    );
  }, [mapItems, terrainVertices, sceneOptions.gridResolution, sceneOptions.snapToGrid, selectedIdRef]);

  const handleColorSelected = useCallback((color: string) => {
    mapItems((it) => (it.id === selectedIdRef.current ? { ...it, color, colorOverride: true } : it));
  }, [mapItems, selectedIdRef]);

  const sceneFolderContent = (
    <BuilderSceneOutliner
      placedItems={placedItems}
      selectedId={selectedId}
      onSelectItem={setSelectedId}
      onDeleteItem={handleDeleteItem}
    />
  );

  return (
    <div className={`dn-root is-tool-${builderTool} is-grid-${sceneOptions.gridTone}`}>
      <BuilderToolRibbon
        mode={builderTool}
        onChange={handleBuilderToolChange}
        hasActiveShape={selectedShapeId !== null}
        onRestart={handleRestart}
      />
      <ShapePicker
        shapes={BUILDER_SHAPE_PRESETS}
        activeShapeId={selectedShapeId}
        onShapeClick={handleShapeClick}
        gridTone={sceneOptions.gridTone}
        onToggleGridTone={handleToggleGridTone}
        onImportClick={handleImportShape}
      />
      <input
        ref={importInputRef}
        type="file"
        hidden
        multiple
        accept=".vox,.obj,.glb,.mtl,.png,.jpg,.jpeg,.webp,.gif,.bmp"
        onChange={handleImportInputChange}
      />

      <main className="dn-main">
        <div className="dn-viewport">
          <BuilderScene
            sceneOptions={sceneOptions}
            updateScene={updateScene}
            directionalLight={directionalLight}
            ambientLight={ambientLight}
            gridPolygons={gridPolygons}
            ghostPolygons={[]}
            terrainHoverPolygons={hoverPolygons}
            placementDraft={false}
            renderItems={renderItems}
            renderedPolygonsById={renderedPolygonsById}
            interiorShellPolygonsById={interiorShellPolygonsById}
            selectedId={selectedId}
            gizmoDragging={gizmoDragging}
            meshHandlesRef={meshHandlesRef}
            getMeshRefCallback={getMeshRefCallback}
            fpvControlsRef={fpvControlsRef}
            onSelectionChange={handleSelectionChange}
            onGizmoDraggingChanged={setGizmoDragging}
            onGizmoObjectChange={handleGizmoObjectChange}
            onSelectedMeshDrag={handleSelectedMeshDrag}
            onStepSelectedElevation={handleStepSelectedElevation}
            builderTool={builderTool}
            onAddShapeAt={handleAddShapeAt}
            onRemoveItem={handleDeleteItem}
            selected={selected}
          />
          <BuilderCameraModePill dragMode={sceneOptions.dragMode} updateScene={updateScene} />
        </div>
      </main>

      <BuilderDock
        sceneOptions={sceneOptions}
        updateScene={updateScene}
        selected={selected}
        onScaleChange={handleScaleSelected}
        onColorChange={handleColorSelected}
        onStepElevation={handleStepSelectedElevation}
        onDeleteSelected={handleDeleteSelected}
        sceneFolderContent={sceneFolderContent}
      />

      <StatsOverlay />
    </div>
  );
}
