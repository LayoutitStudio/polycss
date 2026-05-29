import { useMemo, useRef, type RefObject } from "react";
import { optimizeMeshPolygons } from "@layoutit/polycss-react";
import type { PolyFirstPersonControlsHandle, Polygon } from "@layoutit/polycss-react";
import { interiorShellPolygons } from "../../helpers/interiorShell";
import { useFpvHost, useFpvCull } from "../../fpv";
import { activeMeshResolution, type SceneOptionsState } from "../../types";
import { BUILDER_GROUND_SPAN } from "../defaults";
import { buildGridPolygons } from "../geometry/grid";
import type { TerrainVertices } from "../geometry/terrain";
import type { PlacedItem } from "../types";

const GRID_LINE_COLORS = {
  gray: "#9aa3ad",
  dark: "#1f2937",
} as const;

function applySolidColor(polygons: Polygon[], color: string): Polygon[] {
  return polygons.map((polygon) => ({ ...polygon, color }));
}

function hasRawPolygons(item: PlacedItem): item is PlacedItem & { rawPolygons: Polygon[] } {
  return item.rawPolygons !== null;
}

type ActiveMeshResolution = ReturnType<typeof activeMeshResolution>;

interface CachedRenderGeometry {
  rawPolygons: Polygon[];
  meshResolution: ActiveMeshResolution;
  optimized: Polygon[];
  rendered: Polygon[];
  renderedMode: "source" | "solid";
  renderedColor: string | null;
  interiorShell: Polygon[] | null;
}

function cachedGeometryFor(
  cache: Map<string, CachedRenderGeometry>,
  item: PlacedItem & { rawPolygons: Polygon[] },
  meshResolution: ActiveMeshResolution,
): CachedRenderGeometry {
  const cached = cache.get(item.id);
  if (
    cached?.rawPolygons === item.rawPolygons &&
    cached.meshResolution === meshResolution
  ) {
    return cached;
  }

  const optimized = optimizeMeshPolygons(item.rawPolygons, { meshResolution });
  const entry: CachedRenderGeometry = {
    rawPolygons: item.rawPolygons,
    meshResolution,
    optimized,
    rendered: optimized,
    renderedMode: "source",
    renderedColor: null,
    interiorShell: null,
  };
  cache.set(item.id, entry);
  return entry;
}

function renderedPolygonsFor(entry: CachedRenderGeometry, item: PlacedItem): Polygon[] {
  const renderedMode = item.colorOverride === false ? "source" : "solid";
  const renderedColor = renderedMode === "solid" ? item.color : null;
  if (entry.renderedMode !== renderedMode || entry.renderedColor !== renderedColor) {
    entry.rendered = renderedMode === "source"
      ? entry.optimized
      : applySolidColor(entry.optimized, item.color);
    entry.renderedMode = renderedMode;
    entry.renderedColor = renderedColor;
  }
  return entry.rendered;
}

export interface UseSceneRenderOptions {
  placedItems: PlacedItem[];
  selectedId: string | null;
  sceneOptions: SceneOptionsState;
  fpvControlsRef: RefObject<PolyFirstPersonControlsHandle | null>;
  updateScene: (partial: Partial<SceneOptionsState>) => void;
  /** Heightmap. Drives the grid's per-cell segment elevation so the
   *  floor grid is unified with the terrain — raised vertices bend
   *  the grid lines instead of leaving a separate fill mesh on top. */
  terrainVertices: TerrainVertices;
}

export interface UseSceneRenderResult {
  renderedPolygonsById: Map<string, Polygon[]>;
  interiorShellPolygonsById: Map<string, Polygon[]>;
  renderItems: Array<PlacedItem & { rawPolygons: Polygon[] }>;
  gridPolygons: Polygon[];
}

export function useSceneRender({
  placedItems,
  selectedId,
  sceneOptions,
  fpvControlsRef,
  updateScene,
  terrainVertices,
}: UseSceneRenderOptions): UseSceneRenderResult {
  const effectiveMeshResolution = activeMeshResolution(sceneOptions.meshResolution);
  const geometryCacheRef = useRef(new Map<string, CachedRenderGeometry>());
  const { renderedPolygonsById, interiorShellPolygonsById } = useMemo(() => {
    const cache = geometryCacheRef.current;
    const liveIds = new Set<string>();
    const rendered = new Map<string, Polygon[]>();
    const interior = new Map<string, Polygon[]>();

    for (const it of placedItems) {
      if (!hasRawPolygons(it)) continue;
      liveIds.add(it.id);
      const entry = cachedGeometryFor(cache, it, effectiveMeshResolution);
      rendered.set(it.id, renderedPolygonsFor(entry, it));

      if (sceneOptions.interiorFill && it.preset.kind !== "vox") {
        if (entry.interiorShell === null) {
          entry.interiorShell = interiorShellPolygons(entry.optimized);
        }
        if (entry.interiorShell.length > 0) interior.set(it.id, entry.interiorShell);
      }
    }

    for (const id of cache.keys()) {
      if (!liveIds.has(id)) cache.delete(id);
    }

    return {
      renderedPolygonsById: rendered,
      interiorShellPolygonsById: interior,
    };
  }, [
    placedItems,
    effectiveMeshResolution,
    sceneOptions.interiorFill,
  ]);

  // World-space polygons for FPV bbox sampling. `useFpvHost` only reads
  // vertex extents when `dragMode` transitions to "fpv".
  const worldPolygons = useMemo<Polygon[]>(() => {
    const out: Polygon[] = [];
    for (const it of placedItems) {
      const polys = renderedPolygonsById.get(it.id);
      if (!polys) continue;
      const s = it.scale * it.fitScale;
      const [px, py, pz] = it.position;
      for (const polygon of polys) {
        out.push({
          ...polygon,
          vertices: polygon.vertices.map(([x, y, z]) => [px + x * s, py + y * s, pz + z * s]),
        });
      }
    }
    return out;
  }, [placedItems, renderedPolygonsById]);

  useFpvHost({
    dragMode: sceneOptions.dragMode,
    autoCenter: sceneOptions.autoCenter,
    perspective: sceneOptions.perspective,
    rotY: sceneOptions.rotY,
    scenePolygons: worldPolygons,
    updateScene,
  });

  const visibleIds = useFpvCull({
    controlsRef: fpvControlsRef,
    items: placedItems,
    renderDistance: sceneOptions.fpvRenderDistance,
    enabled: sceneOptions.dragMode === "fpv" && sceneOptions.fpvRenderDistance > 0,
    alwaysIncludeId: selectedId,
  });

  const renderItems = useMemo(() => {
    const loaded = placedItems.filter(hasRawPolygons);
    return visibleIds === null ? loaded : loaded.filter((it) => visibleIds.has(it.id));
  }, [placedItems, visibleIds]);

  const gridPolygons = useMemo(
    () => buildGridPolygons({
      size: BUILDER_GROUND_SPAN,
      spacing: sceneOptions.gridResolution,
      center: [sceneOptions.target[0], sceneOptions.target[1]],
      color: GRID_LINE_COLORS[sceneOptions.gridTone],
      vertices: terrainVertices,
    }),
    [sceneOptions.gridResolution, sceneOptions.gridTone, sceneOptions.target, terrainVertices],
  );

  return { renderedPolygonsById, interiorShellPolygonsById, renderItems, gridPolygons };
}
