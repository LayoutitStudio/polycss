import { memo, useCallback, useDeferredValue, useEffect, useMemo, useRef } from "react";
import type { ProjectionMode, VoxelGrid, WallsMask } from "@layoutit/voxcss-core";
import { BASE_TILE, DEFAULT_WALL_COLOR, computeWallMask } from "@layoutit/voxcss-core";
import { createIsometricCamera } from "@layoutit/voxcss-core";
import { shadeColor, shadeWallFace } from "@layoutit/voxcss-core";
import type { MergeVoxelsOption } from "@layoutit/voxcss-core";
import { useCameraContext } from "./context";
import { useStoreSelector } from "./sceneStore";
import { useSceneContext } from "./useSceneContext";
import { VoxLayer } from "./VoxLayer";
import { useSliceBrushes, SliceZBrushes, SliceAxisHost } from "./VoxSliceRenderer";
import type { PlaneAxis } from "@layoutit/voxcss-core";

const X_AXES = new Set<PlaneAxis>(["x"]);
const Y_AXES = new Set<PlaneAxis>(["y"]);
import { injectBaseStyles } from "./styles";

const FLOOR_BASE_DELTA = 120;
const DIMETRIC_CLASS = "voxcss-projection--dimetric";
const FLOOR_GRID_ALPHA = 0.12;
const WALL_GRID_ALPHA = 0.1;
const GRID_DISABLE_THRESHOLD = 20;

const gridSvgCache = new Map<string, string>();

function buildGridSvgDataUrl(width: number, height: number, alpha: number): string {
  const key = `${width}x${height}:${alpha}`;
  const cached = gridSvgCache.get(key);
  if (cached) return cached;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" shape-rendering="crispEdges"><rect x="0" y="0" width="1" height="${height}" fill="rgb(0, 0, 0)" fill-opacity="${alpha}"/><rect x="0" y="0" width="${width}" height="1" fill="rgb(0, 0, 0)" fill-opacity="${alpha}"/></svg>`;
  const url = `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
  gridSvgCache.set(key, url);
  return url;
}

export interface VoxSceneProps {
  voxels: VoxelGrid;
  rows?: number;
  cols?: number;
  depth?: number;
  showFloor?: boolean;
  showWalls?: boolean;
  projection?: ProjectionMode;
  mergeVoxels?: MergeVoxelsOption;
  wallColor?: string;
}

function VoxSceneInner({
  voxels,
  rows,
  cols,
  depth,
  showFloor = false,
  showWalls = false,
  projection = "cubic",
  mergeVoxels: mergeOption,
  wallColor = DEFAULT_WALL_COLOR,
}: VoxSceneProps) {
  const { store, cameraRef, sceneElRef } = useCameraContext();

  // Read camera state once for initial render — transform updates go via direct DOM
  const initialCameraState = useRef(store.getState().cameraState);
  const cameraState = initialCameraState.current;

  // Subscribe to wall mask — re-renders only when mask changes (a few times per rotation)
  const wallMaskRaw = useStoreSelector(store, (s) => s.wallMask);
  // Defer the wall mask update so it doesn't block the animation frame
  const wallMask = useDeferredValue(wallMaskRaw);

  const localSceneRef = useCallback((el: HTMLDivElement | null) => {
    sceneElRef.current = el;
  }, [sceneElRef]);

  // Inject base styles once
  const injectedRef = useRef(false);
  useEffect(() => {
    if (injectedRef.current) return;
    if (typeof document !== "undefined") {
      injectBaseStyles(document);
      injectedRef.current = true;
    }
  }, []);

  // Scene context uses the actual wall mask — only visible faces are rendered.
  // When mask changes (a few times per rotation), React re-renders the scene.
  const { context, dimensions, layers } = useSceneContext(voxels, {
    rows,
    cols,
    depth,
    projection,
    showFloor,
    showWalls,
    wallColor,
    wallMask,
    mergeVoxels: mergeOption,
  });

  // Compute camera style for scene positioning
  const sceneStyle = useMemo(() => {
    const handle = createIsometricCamera(cameraState);
    return handle.getStyle({
      rows: dimensions.rows,
      cols: dimensions.cols,
      depth: dimensions.depth,
      dimetric: projection === "dimetric",
    });
  }, [cameraState, dimensions, projection]);

  const className = `voxcss-scene${projection === "dimetric" ? ` ${DIMETRIC_CLASS}` : ""}`;

  const floorVisible = showFloor && wallMask.b;
  const floorColor = floorVisible ? shadeColor(wallColor, FLOOR_BASE_DELTA) : undefined;
  const tileSize = context.tileSize;
  const layerElevation = context.layerElevation ?? tileSize;
  const disableGrid = dimensions.rows > GRID_DISABLE_THRESHOLD && dimensions.cols > GRID_DISABLE_THRESHOLD;
  const floorGrid = floorVisible && !disableGrid
    ? buildGridSvgDataUrl(tileSize, tileSize, FLOOR_GRID_ALPHA)
    : undefined;

  const is3d = mergeOption === "3d";
  const floorRef = useRef<HTMLDivElement>(null);
  const sliceBrushes = useSliceBrushes(
    is3d ? layers : [],
    context,
  );

  return (
    <div
      ref={localSceneRef}
      className={className}
      data-vox-depth-offset={String(
        dimensions.depth * cameraState.depthOffset * (projection === "dimetric" ? 0.5 : 1)
      )}
      style={
        {
          ...sceneStyle,
          "--voxcss-rows": dimensions.rows,
          "--voxcss-cols": dimensions.cols,
        } as React.CSSProperties
      }
    >
      <div
        ref={floorRef}
        className="voxcss-floor-z"
        style={
          {
            "--voxcss-floor-base": floorColor,
            "--voxcss-grid-x": floorVisible ? `${tileSize}px` : undefined,
            "--voxcss-grid-y": floorVisible ? `${tileSize}px` : undefined,
            "--voxcss-floor-grid": floorGrid,
            background: floorVisible ? undefined : "none",
            pointerEvents: "none",
            ...(is3d ? {
              display: "grid",
              gridTemplateColumns: `repeat(${dimensions.cols}, ${tileSize}px)`,
              gridTemplateRows: `repeat(${dimensions.rows}, ${tileSize}px)`,
            } : undefined),
          } as React.CSSProperties
        }
      >
        {is3d ? (
          <SliceZBrushes
            floorRef={floorRef}
            plans={sliceBrushes.plans}
            store={store}
            tileSize={tileSize}
            layerElevation={layerElevation}
          />
        ) : (
          layers.map((layerVoxels, i) => (
            <VoxLayer key={i} layerIndex={i} voxels={layerVoxels} context={context} />
          ))
        )}
      </div>
      {is3d && (
        <>
          <SliceAxisHost
            className="voxcss-floor-x"
            style={{
              width: `${dimensions.cols * tileSize}px`,
              height: `${dimensions.depth * layerElevation}px`,
              display: "grid",
              gridTemplateColumns: `repeat(${dimensions.cols}, ${tileSize}px)`,
              gridTemplateRows: `repeat(${dimensions.depth}, ${layerElevation}px)`,
            }}
            plans={sliceBrushes.plans}
            store={store}
            tileSize={tileSize}
            layerElevation={layerElevation}
            axes={X_AXES}
          />
          <SliceAxisHost
            className="voxcss-floor-y"
            style={{
              width: `${dimensions.depth * layerElevation}px`,
              height: `${dimensions.rows * tileSize}px`,
              display: "grid",
              gridTemplateColumns: `repeat(${dimensions.depth}, ${layerElevation}px)`,
              gridTemplateRows: `repeat(${dimensions.rows}, ${tileSize}px)`,
            }}
            plans={sliceBrushes.plans}
            store={store}
            tileSize={tileSize}
            layerElevation={layerElevation}
            axes={Y_AXES}
          />
        </>
      )}
      {showFloor && wallMask.t && (
        <Ceiling
          wallColor={wallColor}
          dimensions={dimensions}
          tileSize={context.tileSize}
        />
      )}
      {showWalls && (
        <Walls
          walls={context.walls}
          wallColor={wallColor}
          dimensions={dimensions}
          tileSize={tileSize}
          disableGrid={disableGrid}
          wallElevation={layerElevation}
        />
      )}
    </div>
  );
}

export const VoxScene = memo(VoxSceneInner);

interface CeilingProps {
  wallColor: string;
  dimensions: { rows: number; cols: number; depth: number };
  tileSize: number;
}

function Ceiling({ wallColor, dimensions, tileSize }: CeilingProps) {
  const ceilingColor = shadeColor(wallColor, FLOOR_BASE_DELTA);
  return (
    <div
      className="voxcss-ceiling"
      style={
        {
          width: `${dimensions.cols * tileSize}px`,
          height: `${dimensions.rows * tileSize}px`,
          transform: `translateZ(${dimensions.depth * tileSize}px)`,
          "--voxcss-ceiling-base": ceilingColor,
          "--voxcss-ceiling-opacity": "0.35",
        } as React.CSSProperties
      }
    />
  );
}

interface WallsProps {
  walls: WallsMask;
  wallColor: string;
  dimensions: { rows: number; cols: number; depth: number };
  tileSize: number;
  disableGrid: boolean;
  wallElevation: number;
}

const WALL_DEFINITIONS: Array<{
  key: keyof WallsMask;
  className: string;
  useAltGrid: boolean;
  getSize: (rows: number, cols: number, depth: number, tile: number) => [number, number];
  getTransform: (rows: number, cols: number, depth: number, halfTile: number) => string;
}> = [
  {
    key: "bl",
    className: "voxcss-wall voxcss-wall--backLeft",
    useAltGrid: true,
    getSize: (rows, _cols, depth, tile) => [depth * tile, rows * tile],
    getTransform: (_rows, _cols, depth, halfTile) =>
      `rotateY(-90deg) translateZ(${halfTile * depth}px) translateX(${halfTile * depth}px)`,
  },
  {
    key: "fr",
    className: "voxcss-wall voxcss-wall--frontRight",
    useAltGrid: true,
    getSize: (rows, _cols, depth, tile) => [depth * tile, rows * tile],
    getTransform: (_rows, _cols, depth, halfTile) =>
      `rotateY(-90deg) translateZ(-${halfTile * depth}px) translateX(${halfTile * depth}px)`,
  },
  {
    key: "br",
    className: "voxcss-wall voxcss-wall--backRight",
    useAltGrid: false,
    getSize: (_rows, cols, depth, tile) => [cols * tile, depth * tile],
    getTransform: (_rows, _cols, depth, halfTile) =>
      `rotateX(90deg) translateZ(${halfTile * depth}px) translateY(${halfTile * depth}px)`,
  },
  {
    key: "fl",
    className: "voxcss-wall voxcss-wall--frontLeft",
    useAltGrid: false,
    getSize: (_rows, cols, depth, tile) => [cols * tile, depth * tile],
    getTransform: (rows, _cols, depth, halfTile) =>
      `rotateX(-90deg) translateZ(${halfTile * (2 * rows - depth)}px) translateY(-${halfTile * depth}px)`,
  },
];

function Walls({ walls, wallColor, dimensions, tileSize, disableGrid, wallElevation }: WallsProps) {
  const halfTile = tileSize / 2;
  const { rows, cols, depth } = dimensions;

  const wallGridUrl = disableGrid ? undefined : buildGridSvgDataUrl(tileSize, wallElevation, WALL_GRID_ALPHA);
  const wallGridAltUrl = disableGrid ? undefined
    : tileSize === wallElevation ? wallGridUrl
    : buildGridSvgDataUrl(wallElevation, tileSize, WALL_GRID_ALPHA);

  return (
    <>
      {WALL_DEFINITIONS.map((def) => {
        if (!walls[def.key]) return null;
        const [width, height] = def.getSize(rows, cols, depth, tileSize);
        const transform = def.getTransform(rows, cols, depth, halfTile);
        const bgColor = shadeWallFace(wallColor, def.key);
        const gridUrl = def.useAltGrid ? wallGridAltUrl : wallGridUrl;

        return (
          <div
            key={def.key}
            className={def.className}
            style={{
              width: `${width}px`,
              height: `${height}px`,
              transform,
              backgroundColor: bgColor,
              "--voxcss-wall-grid": gridUrl,
            } as React.CSSProperties}
          />
        );
      })}
    </>
  );
}
