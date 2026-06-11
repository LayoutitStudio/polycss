import { useRef, useCallback, useEffect, useMemo } from "react";
import { buildPolySceneTransform, createIsometricCamera } from "@layoutit/polycss-core";
import type { CameraState, CameraHandle, Vec3 } from "@layoutit/polycss-core";
import { createSceneStore, type SceneStore } from "../store/sceneStore";

export interface UseCameraOptions {
  zoom?: number;
  target?: Vec3;
  rotX?: number;
  rotY?: number;
  distance?: number;
}

export interface UseCameraResult {
  store: SceneStore;
  cameraRef: React.MutableRefObject<CameraHandle>;
  sceneElRef: React.MutableRefObject<HTMLElement | null>;
  /**
   * Attach to the camera root element. Layered components like
   * <PolyOrbitControls> need the underlying ref to wire non-passive wheel /
   * pointer listeners (React's synthetic onWheel is passive in modern
   * versions and can't preventDefault).
   */
  cameraElRef: React.MutableRefObject<HTMLDivElement | null>;
  /**
   * Apply the current camera state (from cameraRef.current.state) directly
   * to sceneEl.style.transform — bypasses React. Exposed so layered
   * components like <PolyOrbitControls> can call it after mutating state.
   */
  applyTransformDirect: () => void;
}

export function usePolyCamera(options: UseCameraOptions): UseCameraResult {
  const handleRef = useRef<CameraHandle | null>(null);
  if (!handleRef.current) {
    handleRef.current = createIsometricCamera({
      zoom: options.zoom,
      target: options.target,
      rotX: options.rotX,
      rotY: options.rotY,
      distance: options.distance,
    });
  }

  const sceneElRef = useRef<HTMLElement | null>(null);
  const cameraElRef = useRef<HTMLDivElement | null>(null);

  // Create store once; camera props and controls sync into this store.
  const store = useMemo(
    () => createSceneStore(handleRef.current!.state),
    []
  );

  // Sync prop changes to camera handle
  useEffect(() => {
    const handle = handleRef.current!;
    const next: Partial<CameraState> = {};
    if (options.zoom !== undefined) next.zoom = options.zoom;
    if (options.target !== undefined) next.target = options.target;
    if (options.rotX !== undefined) next.rotX = options.rotX;
    if (options.rotY !== undefined) next.rotY = options.rotY;
    if (options.distance !== undefined) next.distance = options.distance;
    if (Object.keys(next).length > 0) {
      handle.update(next);
      // Apply transform directly to DOM — fold in autoCenterOffset so the
      // camera continues to orbit the bbox center even during prop-driven moves.
      const el = sceneElRef.current;
      if (el) {
        el.style.transform = buildPolySceneTransform({
          ...handle.state,
          autoCenterOffset: store.getState().autoCenterOffset,
        });
      }
      store.updateCameraFromRef(handle);
      store.notifyAll(); // props changed — always notify
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [options.zoom, options.target, options.rotX, options.rotY, options.distance, store]);

  // Apply camera transform directly to scene element (bypasses React).
  // Reads autoCenterOffset from the store so orbit/pan always pivots around
  // target + autoCenterOffset — the same point PolyScene writes to the scene transform.
  const applyTransformDirect = useCallback(() => {
    const el = sceneElRef.current;
    if (!el) return;
    const handle = handleRef.current!;
    el.style.transform = buildPolySceneTransform({
      ...handle.state,
      autoCenterOffset: store.getState().autoCenterOffset,
    });
  }, [store]);

  return {
    store,
    cameraRef: handleRef as React.MutableRefObject<CameraHandle>,
    sceneElRef,
    cameraElRef,
    applyTransformDirect,
  };
}
