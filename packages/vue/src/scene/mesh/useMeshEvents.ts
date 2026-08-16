/**
 * useMeshEvents — pointer-event synthesis (polycss-shaped payloads from
 * native DOM events) and the union of wrapper DOM handlers built per
 * render. Extracted verbatim from PolyMesh.ts.
 */
import type { PolyCameraContextValue } from "../../camera/context";
import {
  findPolyMeshHandle,
  type PolyEventHandler,
  type PolyMeshHandle,
  type PolyPointerEvent,
} from "../events";

export interface MeshEventsProps {
  onClick?: PolyEventHandler<MouseEvent>;
  onContextMenu?: PolyEventHandler<MouseEvent>;
  onDoubleClick?: PolyEventHandler<MouseEvent>;
  onWheel?: PolyEventHandler<WheelEvent>;
  onPointerDown?: PolyEventHandler<PointerEvent>;
  onPointerUp?: PolyEventHandler<PointerEvent>;
  onPointerMove?: PolyEventHandler<PointerEvent>;
  onPointerOver?: PolyEventHandler<PointerEvent>;
  onPointerOut?: PolyEventHandler<PointerEvent>;
  onPointerEnter?: PolyEventHandler<PointerEvent>;
  onPointerLeave?: PolyEventHandler<PointerEvent>;
  onPointerCancel?: PolyEventHandler<PointerEvent>;
}

export function useMeshEvents({
  props,
  cameraCtx,
  handle,
}: {
  props: MeshEventsProps;
  cameraCtx: PolyCameraContextValue | null;
  handle: PolyMeshHandle;
}) {
  let pointerDownAt: { x: number; y: number } | null = null;

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
    const camEl = cameraCtx?.cameraElRef.value;
    if (camEl) {
      const r = camEl.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) {
        nx = ((clientX - r.left) / r.width) * 2 - 1;
        ny = -(((clientY - r.top) / r.height) * 2 - 1);
      }
    }
    let delta = 0;
    if (pointerDownAt) {
      delta = Math.hypot(clientX - pointerDownAt.x, clientY - pointerDownAt.y);
    }
    return {
      object: intersections[0]?.object ?? handle,
      eventObject: handle,
      intersections,
      pointer: { x: nx, y: ny },
      delta,
      nativeEvent,
      stopPropagation: () => nativeEvent.stopPropagation(),
    };
  }

  function dispatch<E extends Event>(
    handler: PolyEventHandler<E> | undefined,
    nativeEvent: E,
    clientX: number,
    clientY: number,
  ): void {
    if (!handler) return;
    handler(makeEvent(nativeEvent, clientX, clientY));
  }

  // Build the union of DOM handlers we need to attach. Each
  // registered prop becomes a `onXxx` attr on the wrapper div;
  // omitted props add zero overhead. pointerOver/pointerOut are
  // mapped to enter/leave so they fire once per mesh boundary
  // crossing (not per internal polygon transition).
  const buildHandlers = (): Record<string, (e: Event) => void> => {
    const handlers: Record<string, (e: Event) => void> = {};
    if (props.onClick) {
      handlers.onClick = (e) => {
        const m = e as MouseEvent;
        dispatch(props.onClick, m, m.clientX, m.clientY);
      };
    }
    if (props.onContextMenu) {
      handlers.onContextmenu = (e) => {
        const m = e as MouseEvent;
        dispatch(props.onContextMenu, m, m.clientX, m.clientY);
      };
    }
    if (props.onDoubleClick) {
      handlers.onDblclick = (e) => {
        const m = e as MouseEvent;
        dispatch(props.onDoubleClick, m, m.clientX, m.clientY);
      };
    }
    if (props.onWheel) {
      handlers.onWheel = (e) => {
        const m = e as WheelEvent;
        dispatch(props.onWheel, m, m.clientX, m.clientY);
      };
    }
    // pointerdown is always wired (even without user handler) so we
    // can track delta for click-vs-drag discrimination.
    handlers.onPointerdown = (e) => {
      const p = e as PointerEvent;
      pointerDownAt = { x: p.clientX, y: p.clientY };
      dispatch(props.onPointerDown, p, p.clientX, p.clientY);
    };
    handlers.onPointerup = (e) => {
      const p = e as PointerEvent;
      dispatch(props.onPointerUp, p, p.clientX, p.clientY);
      pointerDownAt = null;
    };
    if (props.onPointerMove) {
      handlers.onPointermove = (e) => {
        const p = e as PointerEvent;
        dispatch(props.onPointerMove, p, p.clientX, p.clientY);
      };
    }
    if (props.onPointerOver || props.onPointerEnter) {
      handlers.onPointerenter = (e) => {
        const p = e as PointerEvent;
        dispatch(props.onPointerOver, p, p.clientX, p.clientY);
        dispatch(props.onPointerEnter, p, p.clientX, p.clientY);
      };
    }
    if (props.onPointerOut || props.onPointerLeave) {
      handlers.onPointerleave = (e) => {
        const p = e as PointerEvent;
        dispatch(props.onPointerOut, p, p.clientX, p.clientY);
        dispatch(props.onPointerLeave, p, p.clientX, p.clientY);
      };
    }
    if (props.onPointerCancel) {
      handlers.onPointercancel = (e) => {
        const p = e as PointerEvent;
        dispatch(props.onPointerCancel, p, p.clientX, p.clientY);
        pointerDownAt = null;
      };
    }
    return handlers;
  };

  return { buildHandlers };
}
