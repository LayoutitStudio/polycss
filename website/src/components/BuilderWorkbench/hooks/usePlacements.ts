import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { optimizeMeshPolygons } from "@layoutit/polycss-react";
import type { PolyMeshHandle, Vec3 } from "@layoutit/polycss-react";
import type { DroppedModelSource, PresetModel } from "../../GalleryWorkbench/types";
import { loadDroppedModel, loadPresetModel } from "../../GalleryWorkbench/helpers/loaders";
import { PARSER_DEFAULTS, NORMALIZED_MAX_DIM } from "../defaults";
import { meshBbox } from "../geometry/meshBbox";
import { placeMeshOnFloor } from "../geometry/placement";
import type { PlacedItem } from "../types";
import { activeMeshResolution, type WorkbenchMeshResolution } from "../../types";

export interface UsePlacementsOptions {
  meshResolution: WorkbenchMeshResolution;
  gridResolution: number;
  onImportError?: (message: string) => void;
}

export interface UsePlacementsResult {
  placedItems: PlacedItem[];
  selectedId: string | null;
  setSelectedId: (id: string | null) => void;
  placementCounter: RefObject<number>;
  buildPlacement: (
    preset: PresetModel,
    worldX: number,
    worldY: number,
    opts?: { rotation?: Vec3; scale?: number; elevation?: number; color?: string },
  ) => Promise<PlacedItem | null>;
  buildDroppedPlacement: (
    source: DroppedModelSource,
    worldX: number,
    worldY: number,
    opts?: { rotation?: Vec3; scale?: number; elevation?: number; color?: string },
  ) => Promise<PlacedItem | null>;
  appendItems: (items: PlacedItem[]) => void;
  replaceItems: (items: PlacedItem[]) => void;
  updateItem: (id: string, partial: Partial<PlacedItem>) => void;
  mapItems: (updater: (item: PlacedItem) => PlacedItem) => void;
  handleDeleteItem: (id: string) => void;
  meshHandlesRef: RefObject<Map<string, PolyMeshHandle>>;
  meshRefCallbacksRef: RefObject<Map<string, (h: PolyMeshHandle | null) => void>>;
  getMeshRefCallback: (id: string) => (h: PolyMeshHandle | null) => void;
  selectedIdRef: RefObject<string | null>;
  handleDeleteSelectedRef: RefObject<() => void>;
  meshHandlesTick: number;
}

export function usePlacements({
  meshResolution,
  gridResolution,
  onImportError,
}: UsePlacementsOptions): UsePlacementsResult {
  const effectiveMeshResolution = activeMeshResolution(meshResolution);
  const [placedItems, setPlacedItems] = useState<PlacedItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [meshHandlesTick, setMeshHandlesTick] = useState(0);
  const placementCounter = useRef(0);
  const placedItemsRef = useRef<PlacedItem[]>([]);

  const disposeItem = (item: PlacedItem): void => {
    item.dispose?.();
  };

  // Per-item handles indexed by id. Populated by each PolyMesh's callback
  // ref on mount and updated/removed on unmount. Storing in a Map (instead of
  // a single shared ref) is what makes selection switching work: a shared ref
  // is updated during commit, but PolyTransformControls reads it during
  // render, so it would render with the previous selection's handle and
  // never see the new one. The Map is populated by the previous commit, so
  // looking up `selectedId` during render always returns the right handle.
  const meshHandlesRef = useRef<Map<string, PolyMeshHandle>>(new Map());
  // A stable callback ref per id, memoized via a Map. Inline `(h) =>
  // registerMeshHandle(id, h)` would create a new function each render and
  // React would re-fire the ref callback (clear + set), bumping the tick and
  // looping. Caching the closure keeps the ref identity stable across
  // renders for the same id; entries are reused as the items list churns.
  const meshRefCallbacksRef = useRef<Map<string, (h: PolyMeshHandle | null) => void>>(new Map());
  const getMeshRefCallback = useCallback((id: string) => {
    let cb = meshRefCallbacksRef.current.get(id);
    if (!cb) {
      cb = (handle: PolyMeshHandle | null) => {
        if (handle) meshHandlesRef.current.set(id, handle);
        else meshHandlesRef.current.delete(id);
        setMeshHandlesTick((n) => n + 1);
      };
      meshRefCallbacksRef.current.set(id, cb);
    }
    return cb;
  }, []);

  // Keep selectedId mirrored in a ref so the Dock callbacks (created once via
  // useCallback) can read the latest id without recreating the handlers.
  const selectedIdRef = useRef<string | null>(null);
  selectedIdRef.current = selectedId;

  // Build a PlacedItem from a preset + a target world (X, Y, Z) and
  // optional rotation/scale. Shared between single-click placement and
  // scene-preset batch loading. Returns null on parse failure.
  //
  // Floor snap + fitScale must use the SAME polygon set that <PolyMesh>
  // renders, because its transform-origin is derived from that set. The
  // dock's meshResolution setting affects optimizeMeshPolygons output,
  // so we run the same pipeline here. The placement is snapped once with
  // this bbox; if the user later toggles meshResolution post-placement,
  // a small Z drift may appear (the user is in control of placement
  // after that).
  const buildPlacement = useCallback(
    async (
      preset: PresetModel,
      worldX: number,
      worldY: number,
      opts: { rotation?: Vec3; scale?: number; elevation?: number; color?: string } = {},
    ): Promise<PlacedItem | null> => {
      try {
        const loaded = await loadPresetModel(preset, PARSER_DEFAULTS, effectiveMeshResolution);
        const optimized = optimizeMeshPolygons(loaded.rawPolygons, {
          meshResolution: effectiveMeshResolution,
        });
        const bbox = meshBbox(optimized);
        const targetSize = gridResolution > 0 ? gridResolution : NORMALIZED_MAX_DIM;
        const fitScale = bbox.span > 0 ? targetSize / bbox.span : 1;
        const placement = placeMeshOnFloor(worldX, worldY, bbox, fitScale);
        const n = placementCounter.current++;
        return {
          id: `placed-${Date.now()}-${n}`,
          preset,
          rawPolygons: loaded.rawPolygons,
          position: placement,
          rotation: opts.rotation ?? [0, 0, 0],
          scale: opts.scale ?? 1,
          elevation: opts.elevation ?? 0,
          color: opts.color ?? loaded.rawPolygons.find((polygon) => polygon.color)?.color ?? "#8b95a1",
          colorOverride: true,
          fitScale,
          worldX,
          worldY,
          dispose: loaded.dispose,
        };
      } catch (e) {
        console.error("[builder] failed to load preset", preset.id, e);
        return null;
      }
    },
    [effectiveMeshResolution, gridResolution],
  );

  const buildDroppedPlacement = useCallback(
    async (
      source: DroppedModelSource,
      worldX: number,
      worldY: number,
      opts: { rotation?: Vec3; scale?: number; elevation?: number; color?: string } = {},
    ): Promise<PlacedItem | null> => {
      let loaded: Awaited<ReturnType<typeof loadDroppedModel>> | null = null;
      try {
        loaded = await loadDroppedModel(source, PARSER_DEFAULTS, effectiveMeshResolution);
        const optimized = optimizeMeshPolygons(loaded.rawPolygons, {
          meshResolution: effectiveMeshResolution,
        });
        const bbox = meshBbox(optimized);
        const targetSize = gridResolution > 0 ? gridResolution : NORMALIZED_MAX_DIM;
        const fitScale = bbox.span > 0 ? targetSize / bbox.span : 1;
        const placement = placeMeshOnFloor(worldX, worldY, bbox, fitScale);
        const n = placementCounter.current++;
        return {
          id: `placed-${Date.now()}-${n}`,
          preset: source.preset,
          rawPolygons: loaded.rawPolygons,
          position: placement,
          rotation: opts.rotation ?? [0, 0, 0],
          scale: opts.scale ?? 1,
          elevation: opts.elevation ?? 0,
          color: opts.color ?? loaded.rawPolygons.find((polygon) => polygon.color)?.color ?? "#8b95a1",
          colorOverride: Boolean(opts.color),
          fitScale,
          worldX,
          worldY,
          dispose: loaded.dispose,
        };
      } catch (e) {
        loaded?.dispose();
        onImportError?.(e instanceof Error ? e.message : String(e));
        console.error("[builder] failed to import model", source.primaryFile.name, e);
        return null;
      }
    },
    [effectiveMeshResolution, gridResolution, onImportError],
  );

  const appendItems = useCallback((items: PlacedItem[]) => {
    setPlacedItems((prev) => [...prev, ...items]);
  }, []);

  const replaceItems = useCallback((items: PlacedItem[]) => {
    setPlacedItems((prev) => {
      for (const item of prev) disposeItem(item);
      return items;
    });
    setSelectedId(null);
    meshHandlesRef.current.clear();
    meshRefCallbacksRef.current.clear();
    setMeshHandlesTick((n) => n + 1);
  }, []);

  const updateItem = useCallback((id: string, partial: Partial<PlacedItem>) => {
    setPlacedItems((items) => items.map((it) => (it.id === id ? { ...it, ...partial } : it)));
  }, []);

  /** Bulk update every item via `updater`. Returning the same object
   *  reference skips replacement for that item — single render for the
   *  whole batch. Used by the terrain-follow effect to re-snap every
   *  placement when the heightmap changes. */
  const mapItems = useCallback((updater: (item: PlacedItem) => PlacedItem) => {
    setPlacedItems((items) => items.map(updater));
  }, []);

  const handleDeleteItem = useCallback((id: string) => {
    setPlacedItems((items) => {
      const removed = items.find((it) => it.id === id);
      if (removed) disposeItem(removed);
      return items.filter((it) => it.id !== id);
    });
    setSelectedId((cur) => (cur === id ? null : cur));
    meshRefCallbacksRef.current.delete(id);
    meshHandlesRef.current.delete(id);
  }, []);

  // Keyboard Delete keeps using a stable ref so the once-mounted effect picks
  // up the latest selection without re-binding.
  const handleDeleteSelectedRef = useRef(() => {
    const id = selectedIdRef.current;
    if (id) handleDeleteItem(id);
  });
  handleDeleteSelectedRef.current = () => {
    const id = selectedIdRef.current;
    if (id) handleDeleteItem(id);
  };

  useEffect(() => {
    placedItemsRef.current = placedItems;
  }, [placedItems]);

  useEffect(() => {
    return () => {
      for (const item of placedItemsRef.current) disposeItem(item);
    };
  }, []);

  return {
    placedItems,
    selectedId,
    setSelectedId,
    placementCounter,
    buildPlacement,
    buildDroppedPlacement,
    appendItems,
    replaceItems,
    updateItem,
    mapItems,
    handleDeleteItem,
    meshHandlesRef,
    meshRefCallbacksRef,
    getMeshRefCallback,
    selectedIdRef,
    handleDeleteSelectedRef,
    meshHandlesTick,
  };
}
