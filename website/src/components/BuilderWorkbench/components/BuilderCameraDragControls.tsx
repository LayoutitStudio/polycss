import { useEffect, useRef } from "react";
import { BASE_TILE, useCameraContext, type Vec3 } from "@layoutit/polycss-react";

type BuilderCameraMode = "orbit" | "pan";

export interface BuilderCameraDragControlsProps {
  mode: BuilderCameraMode;
  enabled: boolean;
  maxRotX: number;
  onInteractionEnd: (camera: { rotX: number; rotY: number; zoom: number; target: Vec3 }) => void;
}

const POINTER_DRAG_SPEED = 4;

function applyOrbit(
  dx: number,
  dy: number,
  state: { rotX: number; rotY: number },
  maxRotX: number,
): { rotX: number; rotY: number } {
  const dX = dx / POINTER_DRAG_SPEED;
  const dY = dy / POINTER_DRAG_SPEED;
  return {
    rotX: Math.max(0, Math.min(maxRotX, state.rotX - dY)),
    rotY: (((state.rotY - dX) % 360) + 360) % 360,
  };
}

function applyPan(
  dx: number,
  dy: number,
  state: { zoom: number; rotX: number; rotY: number; target: Vec3 },
): Vec3 {
  const z = Math.max(0.01, state.zoom);
  const cosRotXRaw = Math.cos((state.rotX * Math.PI) / 180);
  const cosRotX = cosRotXRaw >= 0 ? Math.max(0.1, cosRotXRaw) : Math.min(-0.1, cosRotXRaw);
  const cZ = Math.cos((state.rotY * Math.PI) / 180);
  const sZ = Math.sin((state.rotY * Math.PI) / 180);
  const k = z * BASE_TILE;
  const targetD0 = (dx * sZ - dy * cZ / cosRotX) / k;
  const targetD1 = -(dx * cZ + dy * sZ / cosRotX) / k;
  const target = state.target;
  return [target[0] + targetD0, target[1] + targetD1, Math.max(0, target[2])];
}

export function BuilderCameraDragControls({
  mode,
  enabled,
  maxRotX,
  onInteractionEnd,
}: BuilderCameraDragControlsProps): null {
  const { store, cameraRef, cameraElRef, applyTransformDirect } = useCameraContext();
  const stateRef = useRef({ mode, enabled, maxRotX, onInteractionEnd });
  stateRef.current = { mode, enabled, maxRotX, onInteractionEnd };

  useEffect(() => {
    const element = cameraElRef.current;
    if (!element) return;

    let activePointerId: number | null = null;
    let pointer = { x: 0, y: 0 };
    let rightDragActive = false;
    let rightPointer = { x: 0, y: 0 };

    const snapshot = () => {
      const state = cameraRef.current.state;
      return {
        rotX: state.rotX,
        rotY: state.rotY,
        zoom: state.zoom,
        target: state.target,
      };
    };

    const applyDrag = (dx: number, dy: number, dragKind: BuilderCameraMode): void => {
      const handle = cameraRef.current;
      const state = handle.state;
      if (dragKind === "orbit") {
        handle.update(applyOrbit(dx, dy, state, stateRef.current.maxRotX));
      } else {
        handle.update({ target: applyPan(dx, dy, state) });
      }
      applyTransformDirect();
      store.updateCameraFromRef(handle);
    };

    const onDown = (event: PointerEvent): void => {
      if (!stateRef.current.enabled) return;
      if (activePointerId !== null) return;
      if (event.isPrimary === false) return;
      if (event.button !== 0) return;
      event.preventDefault();
      activePointerId = event.pointerId;
      pointer = { x: event.clientX, y: event.clientY };
      element.style.cursor = "grabbing";
      try {
        (event.target as Element).setPointerCapture(event.pointerId);
      } catch {
        // Pointer capture can fail if the event target is already gone.
      }
    };

    const onMove = (event: PointerEvent): void => {
      if (!stateRef.current.enabled) return;
      if (activePointerId === null || event.pointerId !== activePointerId) return;
      event.preventDefault();
      const dx = event.clientX - pointer.x;
      const dy = event.clientY - pointer.y;
      pointer = { x: event.clientX, y: event.clientY };
      const isAlternate = event.shiftKey;
      const dragKind = stateRef.current.mode === "pan"
        ? (isAlternate ? "orbit" : "pan")
        : (isAlternate ? "pan" : "orbit");
      applyDrag(dx, dy, dragKind);
    };

    const onUp = (event: PointerEvent): void => {
      if (activePointerId !== event.pointerId) return;
      activePointerId = null;
      element.style.cursor = stateRef.current.enabled ? "grab" : "";
      try {
        (event.target as Element).releasePointerCapture(event.pointerId);
      } catch {
        // Ignore release errors for stale event targets.
      }
      stateRef.current.onInteractionEnd(snapshot());
    };

    const onContextMenu = (event: Event): void => {
      event.preventDefault();
    };

    const onMouseDown = (event: MouseEvent): void => {
      if (!stateRef.current.enabled) return;
      if (event.button !== 2) return;
      rightDragActive = true;
      rightPointer = { x: event.clientX, y: event.clientY };
      element.style.cursor = "grabbing";
    };

    const onMouseMove = (event: MouseEvent): void => {
      if (!stateRef.current.enabled || !rightDragActive) return;
      const dx = event.clientX - rightPointer.x;
      const dy = event.clientY - rightPointer.y;
      rightPointer = { x: event.clientX, y: event.clientY };
      applyDrag(dx, dy, stateRef.current.mode === "pan" ? "orbit" : "pan");
    };

    const onMouseUp = (event: MouseEvent): void => {
      if (event.button !== 2 || !rightDragActive) return;
      rightDragActive = false;
      element.style.cursor = stateRef.current.enabled ? "grab" : "";
      stateRef.current.onInteractionEnd(snapshot());
    };

    element.style.cursor = enabled ? "grab" : "";
    element.style.touchAction = "none";
    element.style.userSelect = "none";
    element.addEventListener("pointerdown", onDown);
    element.addEventListener("pointermove", onMove);
    element.addEventListener("pointerup", onUp);
    element.addEventListener("pointercancel", onUp);
    element.addEventListener("contextmenu", onContextMenu);
    element.addEventListener("mousedown", onMouseDown);
    element.addEventListener("mousemove", onMouseMove);
    element.addEventListener("mouseup", onMouseUp);

    return () => {
      element.removeEventListener("pointerdown", onDown);
      element.removeEventListener("pointermove", onMove);
      element.removeEventListener("pointerup", onUp);
      element.removeEventListener("pointercancel", onUp);
      element.removeEventListener("contextmenu", onContextMenu);
      element.removeEventListener("mousedown", onMouseDown);
      element.removeEventListener("mousemove", onMouseMove);
      element.removeEventListener("mouseup", onMouseUp);
      element.style.cursor = "";
      element.style.touchAction = "";
      element.style.userSelect = "";
    };
  }, [applyTransformDirect, cameraElRef, cameraRef, enabled, store]);

  return null;
}
