/**
 * useVoxelFastPath — direct voxel renderer lifecycle for eligible `.vox`
 * meshes (mount/dispose + camera-store subscription). Extracted verbatim
 * from PolyMesh.ts.
 */
import { ref, watchEffect } from "vue";
import type { ComputedRef, Ref } from "vue";
import type { Polygon, Vec3 } from "@layoutit/polycss-core";
import type { PolyCameraContextValue } from "../../camera/context";
import { createPolyVoxelRenderer, type PolyVoxelRenderer } from "../voxelRenderer";
import type { MeshLighting } from "./useMeshLighting";

export interface VoxelFastPathProps {
  rotation?: Vec3;
}

export function useVoxelFastPath({
  props,
  directVoxelEnabled,
  polygons,
  lighting,
  cameraCtx,
  wrapperRef,
}: {
  props: VoxelFastPathProps;
  directVoxelEnabled: ComputedRef<boolean>;
  polygons: ComputedRef<Polygon[]>;
  lighting: MeshLighting;
  cameraCtx: PolyCameraContextValue | null;
  wrapperRef: Ref<HTMLDivElement | null>;
}) {
  const { bakedDirectional, atlasAmbient } = lighting;

  const voxelRenderer = ref<PolyVoxelRenderer | null>(null);
  watchEffect((onCleanup) => {
    const root = wrapperRef.value;
    voxelRenderer.value?.dispose();
    voxelRenderer.value = null;
    if (!directVoxelEnabled.value || !root) return;

    const renderer = createPolyVoxelRenderer({
      doc: root.ownerDocument,
      wrapper: root,
      polygons: polygons.value,
      directionalLight: bakedDirectional.value,
      ambientLight: atlasAmbient.value,
    });
    if (!renderer) return;

    const cameraRotation = () => {
      const cameraState = cameraCtx?.store.getState().cameraState;
      return {
        rotX: cameraState?.rotX ?? 65,
        rotY: cameraState?.rotY ?? 45,
        meshRotation: props.rotation,
      };
    };

    voxelRenderer.value = renderer;
    renderer.render(cameraRotation());
    const unsubscribe = cameraCtx?.store.subscribe(() => {
      renderer.syncCamera(cameraRotation());
    });

    onCleanup(() => {
      unsubscribe?.();
      renderer.dispose();
      if (voxelRenderer.value === renderer) voxelRenderer.value = null;
    });
  });
}
