import { ref, shallowRef, watch } from "vue";
import type { Ref } from "vue";
import {
  buildPolyCameraSceneTransform,
  capturePolyCameraSnapshot,
  createIsometricCamera,
} from "@layoutit/polycss-core";
import type { CameraState, CameraHandle, PolyCameraProjection, Vec3 } from "@layoutit/polycss-core";
import { createSceneStore, type SceneStore } from "../store";

export interface UseCameraOptions {
  zoom?: number;
  target?: Vec3;
  rotX?: number;
  rotY?: number;
  distance?: number;
  projection?: PolyCameraProjection;
  perspectiveStyle?: string;
}

export interface UseCameraResult {
  store: SceneStore;
  cameraRef: Ref<CameraHandle>;
  sceneElRef: Ref<HTMLElement | null>;
  /**
   * Bind to the camera root element. Layered components like
   * <PolyOrbitControls> need the underlying ref to wire non-passive wheel /
   * pointer listeners (Vue's @wheel is passive by default in modern
   * versions and can't preventDefault).
   */
  cameraElRef: Ref<HTMLDivElement | null>;
  /**
   * Bbox-center of all centerable meshes in world coords. Written by
   * <PolyScene> when autoCenter is enabled. Read by applyTransformDirect
   * to fold the offset into the scene transform without a DOM wrapper.
   */
  autoCenterOffset: Ref<Vec3>;
  /**
   * Apply the current camera state (from cameraRef.value.state) directly
   * to sceneEl.style.transform. Exposed so layered components like
   * <PolyOrbitControls> can call it after mutating cameraRef.value.
   */
  applyTransformDirect: () => void;
}

function writeCameraSnapshotAttrs(
  el: HTMLElement | null,
  camera: CameraHandle,
  projection: PolyCameraProjection | undefined,
  perspectiveStyle: string | undefined,
): void {
  if (!el) return;
  const snapshot = capturePolyCameraSnapshot(camera, { projection, perspectiveStyle });
  el.dataset.polycssCameraProjection = snapshot.projection;
  el.dataset.polycssCameraPerspective = snapshot.perspectiveStyle;
  el.dataset.polycssCameraAppliedPerspective = snapshot.appliedPerspectiveStyle;
  el.dataset.polycssCameraZoom = String(snapshot.state.zoom);
  el.dataset.polycssCameraDistance = String(snapshot.state.distance);
  el.dataset.polycssCameraRotX = String(snapshot.state.rotX);
  el.dataset.polycssCameraRotY = String(snapshot.state.rotY);
  el.dataset.polycssCameraTarget = snapshot.state.target.join(",");
}

export function usePolyCamera(options: Ref<UseCameraOptions>): UseCameraResult {
  const handle = createIsometricCamera({
    zoom: options.value.zoom,
    target: options.value.target,
    rotX: options.value.rotX,
    rotY: options.value.rotY,
    distance: options.value.distance,
  });

  const cameraRef = shallowRef<CameraHandle>(handle);
  const sceneElRef = ref<HTMLElement | null>(null);
  const cameraElRef = ref<HTMLDivElement | null>(null);
  const autoCenterOffset = ref<Vec3>([0, 0, 0]);
  const store = createSceneStore(handle.state);

  // Sync prop changes to camera handle — only update when values actually change
  watch(
    () => ({
      zoom: options.value.zoom,
      target: options.value.target,
      rotX: options.value.rotX,
      rotY: options.value.rotY,
      distance: options.value.distance,
      projection: options.value.projection,
      perspectiveStyle: options.value.perspectiveStyle,
    }),
    (next, prev) => {
      const partial: Partial<CameraState> = {};
      if (next.zoom !== undefined && next.zoom !== prev?.zoom) partial.zoom = next.zoom;
      if (next.target !== undefined && next.target !== prev?.target) partial.target = next.target;
      if (next.rotX !== undefined && next.rotX !== prev?.rotX) partial.rotX = next.rotX;
      if (next.rotY !== undefined && next.rotY !== prev?.rotY) partial.rotY = next.rotY;
      if (next.distance !== undefined && next.distance !== prev?.distance) partial.distance = next.distance;
      if (Object.keys(partial).length > 0) {
        handle.update(partial);
        applyTransformDirect();
        store.updateCameraFromRef(handle);
        store.notifyAll();
      }
      writeCameraSnapshotAttrs(
        cameraElRef.value,
        handle,
        options.value.projection,
        options.value.perspectiveStyle,
      );
    }
  );

  watch(
    cameraElRef,
    (el) => writeCameraSnapshotAttrs(
      el,
      handle,
      options.value.projection,
      options.value.perspectiveStyle,
    ),
    { flush: "post" },
  );

  // Apply camera transform directly to scene element (bypasses Vue reactivity).
  // Folds autoCenterOffset (bbox-center of centerable meshes) into the
  // innermost translate3d alongside `target`, matching vanilla buildSceneTransform.
  // Kept separate from `target` so user pan survives mesh add/remove.
  function applyTransformDirect(): void {
    const el = sceneElRef.value;
    if (!el) return;
    el.style.transform = buildPolyCameraSceneTransform(handle.state, {
      autoCenterOffset: autoCenterOffset.value,
    });
    writeCameraSnapshotAttrs(
      cameraElRef.value,
      handle,
      options.value.projection,
      options.value.perspectiveStyle,
    );
  }

  return {
    store,
    cameraRef,
    sceneElRef,
    cameraElRef,
    autoCenterOffset,
    applyTransformDirect,
  };
}
