import { defineComponent, h, computed, shallowRef, ref, inject, onMounted, onBeforeUnmount, watch } from "vue";
import type { PropType } from "vue";
import type { ProjectionMode, VoxelGrid, WallsMask } from "@layoutit/voxcss-core";
import { DEFAULT_WALL_COLOR, wallMasksEqual } from "@layoutit/voxcss-core";
import { createIsometricCamera } from "@layoutit/voxcss-core";
import { shadeColor, shadeWallFace } from "@layoutit/voxcss-core";
import type { MergeVoxelsOption, PlaneAxis } from "@layoutit/voxcss-core";
import { VoxCameraContextKey } from "./context";
import { useSceneContext } from "./composables/useSceneContext";
import { VoxLayer } from "./VoxLayer";
import { useSliceBrushes, SliceZBrushes, SliceAxisHost } from "./VoxSliceRenderer";
import { injectBaseStyles } from "./styles";
import type { SceneStore } from "./sceneStore";

const X_AXES = new Set<PlaneAxis>(["x"]);
const Y_AXES = new Set<PlaneAxis>(["y"]);

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

export const VoxScene = defineComponent({
  name: "VoxScene",
  props: {
    voxels: { type: Array as PropType<VoxelGrid>, required: true },
    rows: { type: Number },
    cols: { type: Number },
    depth: { type: Number },
    showFloor: { type: Boolean, default: false },
    showWalls: { type: Boolean, default: false },
    projection: { type: String as PropType<ProjectionMode>, default: "cubic" },
    mergeVoxels: { type: [String, Boolean] as PropType<MergeVoxelsOption> },
    wallColor: { type: String, default: DEFAULT_WALL_COLOR },
  },
  setup(props) {
    const cameraCtx = inject(VoxCameraContextKey);
    if (!cameraCtx) {
      throw new Error("voxcss: VoxScene must be used inside a VoxCamera.");
    }

    const { store, sceneElRef } = cameraCtx;

    // Read camera state once for initial render — transform updates go via direct DOM
    const cameraState = store.getState().cameraState;

    // Subscribe to wall mask — re-renders only when mask actually changes.
    // Use shallowRef + equality check to avoid spurious Vue reactivity triggers.
    const wallMask = shallowRef(store.getState().wallMask);
    let unsubscribe: (() => void) | null = null;

    onMounted(() => {
      unsubscribe = store.subscribe(() => {
        const next = store.getState().wallMask;
        if (!wallMasksEqual(wallMask.value, next)) {
          wallMask.value = next;
        }
      });
    });

    onBeforeUnmount(() => {
      unsubscribe?.();
      unsubscribe = null;
    });

    // Inject base styles once
    let injected = false;
    onMounted(() => {
      if (injected) return;
      if (typeof document !== "undefined") {
        injectBaseStyles(document);
        injected = true;
      }
    });

    const sceneElLocalRef = ref<HTMLElement | null>(null);

    // Sync local ref to camera context's sceneElRef
    watch(sceneElLocalRef, (el) => {
      sceneElRef.value = el;
    });

    const sceneContextOptions = computed(() => ({
      rows: props.rows,
      cols: props.cols,
      depth: props.depth,
      projection: props.projection,
      showFloor: props.showFloor,
      showWalls: props.showWalls,
      wallColor: props.wallColor,
      // Only include wallMask for non-3d modes — 3d uses NO_WALLS internally
      wallMask: props.mergeVoxels === "3d" ? undefined : wallMask.value,
      mergeVoxels: props.mergeVoxels,
    }));

    const voxelsRef = computed(() => props.voxels);
    const sceneResult = useSceneContext(voxelsRef, sceneContextOptions);

    // Stable dimensions ref — only updates when rows/cols/depth actually change,
    // NOT on every wall mask change. This prevents sceneStyle from recomputing
    // and resetting the live camera transform set by applyTransformDirect.
    const stableDimensions = computed(() => sceneResult.value.dimensions);
    let prevDims = { rows: 0, cols: 0, depth: 0 };
    const dimensions = computed(() => {
      const dims = stableDimensions.value;
      if (dims.rows === prevDims.rows && dims.cols === prevDims.cols && dims.depth === prevDims.depth) {
        return prevDims;
      }
      prevDims = { rows: dims.rows, cols: dims.cols, depth: dims.depth };
      return prevDims;
    });

    // Scene style: ONLY width/height. Transform is NEVER in Vue's style.
    // Direct DOM exclusively owns el.style.transform.
    const sceneStyle = computed(() => {
      const dims = dimensions.value;
      const tileSize = 50;
      return {
        width: `${dims.cols * tileSize}px`,
        height: `${dims.rows * tileSize}px`,
      };
    });

    // Apply transform via direct DOM whenever scene element or dimensions change.
    // This is the ONLY place transform is set — Vue never touches it.
    watch(
      [sceneElLocalRef, dimensions],
      ([el, dims]) => {
        if (!el) return;
        const cam = cameraCtx.cameraRef.value;
        const handle = createIsometricCamera(cam.state);
        const camStyle = handle.getStyle({
          rows: dims.rows,
          cols: dims.cols,
          depth: dims.depth,
          dimetric: props.projection === "dimetric",
        });
        el.style.transform = camStyle.transform;
        el.dataset.voxDepthOffset = String(
          dims.depth * cam.state.depthOffset * (props.projection === "dimetric" ? 0.5 : 1)
        );
      },
      { flush: "post" }
    );

    const is3d = computed(() => props.mergeVoxels === "3d");

    const sliceLayers = computed(() => is3d.value ? sceneResult.value.layers : []);
    const sliceContext = computed(() => sceneResult.value.context);
    const sliceBrushes = useSliceBrushes(sliceLayers, sliceContext);

    const floorRef = ref<HTMLElement | null>(null);

    return () => {
      // Don't render until voxels arrive — prevents flash with default zoom
      if (!props.voxels || props.voxels.length === 0) {
        return h("div", { ref: sceneElLocalRef, class: "voxcss-scene", style: { display: "none" } });
      }

      const { context, dimensions, layers } = sceneResult.value;
      const mask = wallMask.value;
      const tileSize = context.tileSize;
      const layerElevation = context.layerElevation ?? tileSize;
      const className = `voxcss-scene${props.projection === "dimetric" ? ` ${DIMETRIC_CLASS}` : ""}`;

      const floorVisible = props.showFloor && mask.b;
      const floorColor = floorVisible ? shadeColor(props.wallColor, FLOOR_BASE_DELTA) : undefined;
      const disableGrid = dimensions.rows > GRID_DISABLE_THRESHOLD && dimensions.cols > GRID_DISABLE_THRESHOLD;
      const floorGrid = floorVisible && !disableGrid
        ? buildGridSvgDataUrl(tileSize, tileSize, FLOOR_GRID_ALPHA)
        : undefined;

      const sceneChildren = [];

      // Floor div
      const floorChildren: any[] = [];
      if (is3d.value) {
        floorChildren.push(
          h(SliceZBrushes, {
            key: "slice-z",
            floorRef,
            plans: sliceBrushes.plans.value,
            store: store as SceneStore,
            tileSize,
            layerElevation,
          })
        );
      } else {
        for (let i = 0; i < layers.length; i++) {
          floorChildren.push(
            h(VoxLayer, { key: i, layerIndex: i, voxels: layers[i], context })
          );
        }
      }

      const floorStyle: Record<string, string | undefined> = {
        "--voxcss-floor-base": floorColor,
        "--voxcss-grid-x": floorVisible ? `${tileSize}px` : undefined,
        "--voxcss-grid-y": floorVisible ? `${tileSize}px` : undefined,
        "--voxcss-floor-grid": floorGrid,
        background: floorVisible ? undefined : "none",
        pointerEvents: "none",
      };

      if (is3d.value) {
        floorStyle.display = "grid";
        floorStyle.gridTemplateColumns = `repeat(${dimensions.cols}, ${tileSize}px)`;
        floorStyle.gridTemplateRows = `repeat(${dimensions.rows}, ${tileSize}px)`;
      }

      sceneChildren.push(
        h("div", {
          ref: floorRef,
          class: "voxcss-floor-z",
          style: floorStyle,
        }, floorChildren)
      );

      // X/Y slice hosts for 3d mode
      if (is3d.value) {
        sceneChildren.push(
          h(SliceAxisHost, {
            key: "slice-x",
            className: "voxcss-floor-x",
            hostStyle: {
              width: `${dimensions.cols * tileSize}px`,
              height: `${dimensions.depth * layerElevation}px`,
              display: "grid",
              gridTemplateColumns: `repeat(${dimensions.cols}, ${tileSize}px)`,
              gridTemplateRows: `repeat(${dimensions.depth}, ${layerElevation}px)`,
            },
            plans: sliceBrushes.plans.value,
            store: store as SceneStore,
            tileSize,
            layerElevation,
            axes: X_AXES,
          })
        );
        sceneChildren.push(
          h(SliceAxisHost, {
            key: "slice-y",
            className: "voxcss-floor-y",
            hostStyle: {
              width: `${dimensions.depth * layerElevation}px`,
              height: `${dimensions.rows * tileSize}px`,
              display: "grid",
              gridTemplateColumns: `repeat(${dimensions.depth}, ${layerElevation}px)`,
              gridTemplateRows: `repeat(${dimensions.rows}, ${tileSize}px)`,
            },
            plans: sliceBrushes.plans.value,
            store: store as SceneStore,
            tileSize,
            layerElevation,
            axes: Y_AXES,
          })
        );
      }

      // Ceiling
      if (props.showFloor && mask.t) {
        const ceilingColor = shadeColor(props.wallColor, FLOOR_BASE_DELTA);
        sceneChildren.push(
          h("div", {
            key: "ceiling",
            class: "voxcss-ceiling",
            style: {
              width: `${dimensions.cols * tileSize}px`,
              height: `${dimensions.rows * tileSize}px`,
              transform: `translateZ(${dimensions.depth * tileSize}px)`,
              "--voxcss-ceiling-base": ceilingColor,
              "--voxcss-ceiling-opacity": "0.35",
            },
          })
        );
      }

      // Walls
      if (props.showWalls) {
        const halfTile = tileSize / 2;
        const { rows, cols, depth } = dimensions;
        const wallGridUrl = disableGrid ? undefined : buildGridSvgDataUrl(tileSize, layerElevation, WALL_GRID_ALPHA);
        const wallGridAltUrl = disableGrid ? undefined
          : tileSize === layerElevation ? wallGridUrl
          : buildGridSvgDataUrl(layerElevation, tileSize, WALL_GRID_ALPHA);

        for (const def of WALL_DEFINITIONS) {
          if (!context.walls[def.key]) continue;
          const [width, height] = def.getSize(rows, cols, depth, tileSize);
          const transform = def.getTransform(rows, cols, depth, halfTile);
          const bgColor = shadeWallFace(props.wallColor, def.key);
          const gridUrl = def.useAltGrid ? wallGridAltUrl : wallGridUrl;

          sceneChildren.push(
            h("div", {
              key: def.key,
              class: def.className,
              style: {
                width: `${width}px`,
                height: `${height}px`,
                transform,
                backgroundColor: bgColor,
                "--voxcss-wall-grid": gridUrl,
              },
            })
          );
        }
      }

      return h(
        "div",
        {
          ref: sceneElLocalRef,
          class: className,
          "data-vox-depth-offset": String(
            dimensions.depth * cameraCtx.cameraRef.value.state.depthOffset * (props.projection === "dimetric" ? 0.5 : 1)
          ),
          style: {
            ...sceneStyle.value,
            "--voxcss-rows": dimensions.rows,
            "--voxcss-cols": dimensions.cols,
          },
        },
        sceneChildren
      );
    };
  },
});
