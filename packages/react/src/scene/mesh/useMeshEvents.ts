/**
 * useMeshEvents — pointer-event synthesis (polycss-shaped payloads from
 * React synthetic events) and the union of wrapper DOM handlers. Extracted
 * verbatim from PolyMesh.tsx.
 */
import { useCallback, useMemo, useRef } from "react";
import type { PointerEvent as ReactPointerEvent, MouseEvent as ReactMouseEvent, WheelEvent as ReactWheelEvent } from "react";
import type { PolyCameraContextValue } from "../../camera/context";
import {
  findPolyMeshHandle,
  type InteractionProps,
  type PolyEventHandler,
  type PolyMeshHandle,
  type PolyPointerEvent,
} from "../events";

export interface UseMeshEventsOptions extends InteractionProps {
  cameraCtx: PolyCameraContextValue | null;
  handle: PolyMeshHandle;
}

export function useMeshEvents({
  cameraCtx,
  handle,
  onClick,
  onContextMenu,
  onDoubleClick,
  onWheel,
  onPointerDown,
  onPointerUp,
  onPointerMove,
  onPointerOver,
  onPointerOut,
  onPointerEnter,
  onPointerLeave,
  onPointerCancel,
}: UseMeshEventsOptions) {
  // ── Pointer event synthesis ───────────────────────────────────────────
  // Build the polycss-shaped payload from a native React synthetic event.
  // intersections come from elementsFromPoint, walked up to nearest mesh
  // ancestor — front-to-back order matches DOM stacking. NDC pointer is
  // computed against the camera viewport bounds (falls back to (0,0) when
  // PolyMesh is rendered outside a <PolyCamera>).
  const cameraElRef = cameraCtx?.cameraElRef ?? null;
  const pointerDownAtRef = useRef<{ x: number; y: number } | null>(null);

  const makeEvent = useCallback(
    function makeEvent<E extends Event>(
      nativeEvent: E,
      clientX: number,
      clientY: number,
    ): PolyPointerEvent<E> {
      const intersections: Array<{ object: PolyMeshHandle }> = [];
      if (typeof document !== "undefined" && typeof document.elementsFromPoint === "function") {
        const stacked = document.elementsFromPoint(clientX, clientY);
        const seen = new Set<PolyMeshHandle>();
        for (const el of stacked) {
          const h = findPolyMeshHandle(el);
          if (h && !seen.has(h)) {
            seen.add(h);
            intersections.push({ object: h });
          }
        }
      }
      let nx = 0;
      let ny = 0;
      const camEl = cameraElRef?.current;
      if (camEl) {
        const r = camEl.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) {
          nx = ((clientX - r.left) / r.width) * 2 - 1;
          ny = -(((clientY - r.top) / r.height) * 2 - 1);
        }
      }
      let delta = 0;
      const pd = pointerDownAtRef.current;
      if (pd) delta = Math.hypot(clientX - pd.x, clientY - pd.y);
      return {
        object: intersections[0]?.object ?? handle,
        eventObject: handle,
        intersections,
        pointer: { x: nx, y: ny },
        delta,
        nativeEvent,
        stopPropagation: () => nativeEvent.stopPropagation(),
      };
    },
    [cameraElRef, handle],
  );

  // Build the union of DOM handlers we need to attach. Wiring stays inert
  // when the user provides no handlers — `wrapperHandlers` ends up empty.
  const wrapperHandlers = useMemo(() => {
    // Wrap the polycss event's stopPropagation to ALSO stop React's
    // synthetic event propagation (which is the relevant tree-bubbling
    // for ancestor handlers in JSX). Without this, calling
    // event.stopPropagation() from a polycss handler would only stop
    // native DOM bubbling — React's tree bubbling would still hit
    // ancestor onClick handlers, surprising consumers.
    const dispatch = <E extends Event, R extends { stopPropagation(): void }>(
      polyHandler: PolyEventHandler<E> | undefined,
      reactEvent: R,
      nativeEvent: E,
      clientX: number,
      clientY: number,
    ): void => {
      if (!polyHandler) return;
      const polyEvent = makeEvent(nativeEvent, clientX, clientY);
      const originalStop = polyEvent.stopPropagation;
      polyEvent.stopPropagation = () => {
        originalStop();
        reactEvent.stopPropagation();
      };
      polyHandler(polyEvent);
    };
    const out: {
      onClick?: (e: ReactMouseEvent<HTMLDivElement>) => void;
      onContextMenu?: (e: ReactMouseEvent<HTMLDivElement>) => void;
      onDoubleClick?: (e: ReactMouseEvent<HTMLDivElement>) => void;
      onWheel?: (e: ReactWheelEvent<HTMLDivElement>) => void;
      onPointerDown?: (e: ReactPointerEvent<HTMLDivElement>) => void;
      onPointerUp?: (e: ReactPointerEvent<HTMLDivElement>) => void;
      onPointerMove?: (e: ReactPointerEvent<HTMLDivElement>) => void;
      onPointerEnter?: (e: ReactPointerEvent<HTMLDivElement>) => void;
      onPointerLeave?: (e: ReactPointerEvent<HTMLDivElement>) => void;
      onPointerCancel?: (e: ReactPointerEvent<HTMLDivElement>) => void;
    } = {};
    if (onClick) {
      out.onClick = (e) => dispatch(onClick, e, e.nativeEvent, e.clientX, e.clientY);
    }
    if (onContextMenu) {
      out.onContextMenu = (e) => dispatch(onContextMenu, e, e.nativeEvent, e.clientX, e.clientY);
    }
    if (onDoubleClick) {
      out.onDoubleClick = (e) => dispatch(onDoubleClick, e, e.nativeEvent, e.clientX, e.clientY);
    }
    if (onWheel) {
      out.onWheel = (e) => dispatch(onWheel, e, e.nativeEvent, e.clientX, e.clientY);
    }
    if (onPointerDown) {
      out.onPointerDown = (e) => {
        pointerDownAtRef.current = { x: e.clientX, y: e.clientY };
        dispatch(onPointerDown, e, e.nativeEvent, e.clientX, e.clientY);
      };
    } else {
      // Still need to track pointerdown for delta computation when other
      // handlers (move/up/click) want it.
      out.onPointerDown = (e) => {
        pointerDownAtRef.current = { x: e.clientX, y: e.clientY };
      };
    }
    if (onPointerUp) {
      out.onPointerUp = (e) => {
        dispatch(onPointerUp, e, e.nativeEvent, e.clientX, e.clientY);
        pointerDownAtRef.current = null;
      };
    } else {
      out.onPointerUp = () => { pointerDownAtRef.current = null; };
    }
    if (onPointerMove) {
      out.onPointerMove = (e) => dispatch(onPointerMove, e, e.nativeEvent, e.clientX, e.clientY);
    }
    // r3f: onPointerOver and onPointerEnter both fire on entering the
    // mesh; onPointerOut and onPointerLeave on leaving. DOM enter/leave
    // (no bubble for child→child transitions) is the right primitive.
    if (onPointerOver || onPointerEnter) {
      out.onPointerEnter = (e) => {
        if (onPointerOver) dispatch(onPointerOver, e, e.nativeEvent, e.clientX, e.clientY);
        if (onPointerEnter) dispatch(onPointerEnter, e, e.nativeEvent, e.clientX, e.clientY);
      };
    }
    if (onPointerOut || onPointerLeave) {
      out.onPointerLeave = (e) => {
        if (onPointerOut) dispatch(onPointerOut, e, e.nativeEvent, e.clientX, e.clientY);
        if (onPointerLeave) dispatch(onPointerLeave, e, e.nativeEvent, e.clientX, e.clientY);
      };
    }
    if (onPointerCancel) {
      out.onPointerCancel = (e) => {
        dispatch(onPointerCancel, e, e.nativeEvent, e.clientX, e.clientY);
        pointerDownAtRef.current = null;
      };
    }
    return out;
  }, [
    makeEvent,
    onClick,
    onContextMenu,
    onDoubleClick,
    onWheel,
    onPointerDown,
    onPointerUp,
    onPointerMove,
    onPointerOver,
    onPointerOut,
    onPointerEnter,
    onPointerLeave,
    onPointerCancel,
  ]);

  return { wrapperHandlers };
}
