/**
 * useVoxelFastPath — direct voxel renderer lifecycle for eligible `.vox`
 * meshes (mount/dispose + camera-store subscription). Extracted verbatim
 * from PolyMesh.tsx.
 */
import { useLayoutEffect, useRef } from "react";
import type { RefObject } from "react";
import type { Polygon, Vec3 } from "@layoutit/polycss-core";
import type { PolyCameraContextValue } from "../../camera/context";
import { createPolyVoxelRenderer, type PolyVoxelRenderer } from "../voxelRenderer";
import type { MeshLighting } from "./useMeshLighting";

export interface UseVoxelFastPathOptions {
  directVoxelEnabled: boolean;
  polygons: Polygon[];
  lighting: MeshLighting;
  cameraCtx: PolyCameraContextValue | null;
  rotation?: Vec3;
  wrapperRef: RefObject<HTMLDivElement | null>;
}

export function useVoxelFastPath({
  directVoxelEnabled,
  polygons,
  lighting,
  cameraCtx,
  rotation,
  wrapperRef,
}: UseVoxelFastPathOptions) {
  const { bakedDirectional, effectiveAmbient } = lighting;

  const voxelRendererRef = useRef<PolyVoxelRenderer | null>(null);
  useLayoutEffect(() => {
    const root = wrapperRef.current;
    voxelRendererRef.current?.dispose();
    voxelRendererRef.current = null;
    if (!directVoxelEnabled || !root) return;

    const renderer = createPolyVoxelRenderer({
      doc: root.ownerDocument,
      wrapper: root,
      polygons,
      directionalLight: bakedDirectional,
      ambientLight: effectiveAmbient,
    });
    if (!renderer) return;

    const cameraRotation = () => {
      const cameraState = cameraCtx?.store.getState().cameraState;
      return {
        rotX: cameraState?.rotX ?? 65,
        rotY: cameraState?.rotY ?? 45,
        meshRotation: rotation,
      };
    };

    voxelRendererRef.current = renderer;
    renderer.render(cameraRotation());
    const unsubscribe = cameraCtx?.store.subscribe(() => {
      renderer.syncCamera(cameraRotation());
    });

    return () => {
      unsubscribe?.();
      renderer.dispose();
      if (voxelRendererRef.current === renderer) voxelRendererRef.current = null;
    };
  }, [
    directVoxelEnabled,
    polygons,
    bakedDirectional,
    effectiveAmbient,
    cameraCtx?.store,
    rotation,
  ]);
}
