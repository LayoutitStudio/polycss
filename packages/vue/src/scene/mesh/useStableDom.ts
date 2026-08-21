/**
 * useStableDom — the imperative PolyMeshHandle (setPolygons / updatePolygon /
 * rebakeAtlas / whenTexturesReady), the wrapper-element registry wiring, and
 * the `updateStableTriangleDom` same-topology fast path used by
 * `setPolygons`. Extracted verbatim from PolyMesh.ts.
 */
import { onBeforeUnmount, onMounted, ref } from "vue";
import type { ComputedRef, Ref } from "vue";
import type { Polygon, Vec3 } from "@layoutit/polycss-core";
import { updateStableTriangleDom } from "../atlas";
import {
  registerMeshElement,
  unregisterMeshElement,
  type PolyMeshHandle,
} from "../events";
import { recenterPolygons } from "./useMeshGeometry";
import type { MeshLighting } from "./useMeshLighting";

export interface StableDomProps {
  id?: string;
  position?: Vec3;
  scale?: number | Vec3;
  rotation?: Vec3;
  autoCenter: boolean;
}

export function useStableDom({
  props,
  expose,
  atlasAutoRender,
  polygons,
  polygonOverride,
  imperativePolygons,
  lighting,
  whenTexturesReady,
}: {
  props: StableDomProps;
  expose: (exposed?: PolyMeshHandle) => void;
  atlasAutoRender: boolean;
  polygons: ComputedRef<Polygon[]>;
  polygonOverride: Ref<Polygon[] | null>;
  imperativePolygons: { current: Polygon[] | null };
  lighting: MeshLighting;
  whenTexturesReady: () => Promise<void>;
}) {
  const {
    atlasTextureLighting,
    atlasStrategies,
    atlasSeamBleed,
    atlasAmbient,
    bakedRotation,
    bakedDirectional,
    bakedPointLights,
  } = lighting;

  const stableTriangleColorFrame = ref(0);

  // Imperative handle exposed via defineExpose. Read-only view of
  // the mesh's element + transform + polygons. Stable getter object;
  // refs keep getters cheap without rebuilding on every render.
  const wrapperRef = ref<HTMLDivElement | null>(null);
  const handle: PolyMeshHandle = {
    get element() { return wrapperRef.value; },
    get id() { return props.id; },
    getPosition: () => props.position,
    getRotation: () => props.rotation,
    getScale: () => props.scale,
    getPolygons: () => imperativePolygons.current ?? polygons.value,
    setPolygons(nextPolygons: Polygon[]) {
      const nextRenderedPolygons = props.autoCenter ? recenterPolygons(nextPolygons) : nextPolygons;
      imperativePolygons.current = nextRenderedPolygons;
      const root = wrapperRef.value;
      const fastPathHandled =
        root &&
        atlasAutoRender &&
        updateStableTriangleDom(root, nextRenderedPolygons, {
          directionalLight: bakedDirectional.value,
          ambientLight: atlasAmbient.value,
          pointLights: bakedPointLights.value,
          textureLighting: atlasTextureLighting.value,
          strategies: atlasStrategies.value,
          seamBleed: atlasSeamBleed.value,
          colorFrame: ++stableTriangleColorFrame.value,
          // Animated low-poly triangles can swing face normals sharply; keep the
          // mounted baked color pinned and animate transforms only.
          colorFreezeFrames: 0,
        });
      // ALWAYS update polygonOverride so Vue's render fn re-evaluates with the
      // new polygons. Otherwise any reactive dependency that re-fires after
      // setPolygons (cameraTick, sceneCtx, etc.) re-emits the <u> VNode from
      // stale polygons.value and Vue patches the leaf style back to the old
      // transform — undoing the imperative write from updateStableTriangleDom.
      polygonOverride.value = nextPolygons.slice();
      void fastPathHandled;
    },
    updatePolygon(target: Polygon | number, partial: Partial<Polygon>) {
      const current = imperativePolygons.current ?? polygons.value;
      const idx = typeof target === "number"
        ? target
        : current.indexOf(target);
      if (idx < 0 || idx >= current.length) return;
      Object.assign(current[idx], partial);
      // Produce a new array reference so Vue's computed reacts and
      // re-renders the atlas (the polygon object itself is mutated
      // in place to preserve identity for callers holding a ref).
      polygonOverride.value = current.slice();
      imperativePolygons.current = null;
    },
    rebakeAtlas: () => {
      bakedRotation.value = props.rotation;
    },
    whenTexturesReady,
  };
  expose(handle);

  // Register the wrapper element so Select / TransformControls can
  // resolve clicks back to this handle via findMeshHandle.
  onMounted(() => {
    if (wrapperRef.value) registerMeshElement(wrapperRef.value, handle);
  });
  onBeforeUnmount(() => {
    if (wrapperRef.value) unregisterMeshElement(wrapperRef.value);
  });

  return { wrapperRef, handle };
}
