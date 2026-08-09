import { invariant } from "./errors.js";

type InteractionKey = "left" | "right" | "up" | "down" | "grab" | "hold";

interface InteractionPresentation {
  readonly fitWidth: number;
  readonly fitHeight: number;
  readonly sourceWidth: number;
  readonly sourceHeight: number;
}

interface InteractionViewportOptions {
  readonly viewportWidth?: number;
  readonly viewportHeight?: number;
}

export interface InteractionSample {
  readonly stickX: -128 | 0 | 127;
  readonly stickY: -128 | 0 | 127;
  readonly pressed: boolean;
  readonly hold: boolean;
  readonly pointer: Readonly<{ x: number; y: number }> | null;
}

export interface InteractionInput {
  setEnabled(enabled: boolean): void;
  sample(): InteractionSample;
  destroy(): boolean;
}

type ListenerTarget = Pick<EventTarget, "addEventListener" | "removeEventListener">;
type Registration = readonly [ListenerTarget, string, EventListener];

export function createInteractionInput(
  host: HTMLElement,
  viewport: HTMLElement,
  presentation: InteractionPresentation,
  options: InteractionViewportOptions = {},
): InteractionInput {
  const win = host.ownerDocument.defaultView;
  invariant(win, "INVALID_DOCUMENT_HOST", "The mount host requires a browser window.");
  const keys = new Set<InteractionKey>();
  let enabled = false;
  let pointerId: number | null = null;
  let pointerHeld = false;
  let pendingPointer: Readonly<{ x: number; y: number }> | null = null;
  let destroyed = false;
  const keyMap = new Map<string, InteractionKey>([
    ["ArrowLeft", "left"], ["KeyA", "left"],
    ["ArrowRight", "right"], ["KeyD", "right"],
    ["ArrowUp", "up"], ["KeyW", "up"],
    ["ArrowDown", "down"], ["KeyS", "down"],
    ["Space", "grab"], ["KeyR", "hold"],
  ]);
  const editable = (target: EventTarget | null): boolean => target instanceof win.HTMLInputElement
    || target instanceof win.HTMLTextAreaElement
    || target instanceof win.HTMLSelectElement
    || (target instanceof win.Element && target.closest("[contenteditable='true']") !== null);
  const mapPointer = (event: PointerEvent): void => {
    const bounds = viewport.getBoundingClientRect();
    const width = viewport.clientWidth || options.viewportWidth || presentation.sourceWidth;
    const height = viewport.clientHeight || options.viewportHeight || presentation.sourceHeight;
    if (!(width > 0) || !(height > 0)) return;
    const localX = bounds.width > 0
      ? (event.clientX - bounds.left) * width / bounds.width
      : event.clientX - bounds.left;
    const localY = bounds.height > 0
      ? (event.clientY - bounds.top) * height / bounds.height
      : event.clientY - bounds.top;
    const scale = Math.min(width / presentation.fitWidth, height / presentation.fitHeight);
    const offsetX = (width - presentation.sourceWidth * scale) / 2;
    const offsetY = (height - presentation.sourceHeight * scale) / 2;
    pendingPointer = Object.freeze({
      x: (localX - offsetX) / scale,
      y: (localY - offsetY) / scale,
    });
  };
  const keydown: EventListener = (value) => {
    const event = value as KeyboardEvent;
    const key = keyMap.get(event.code);
    if (!enabled || !key || editable(event.target)) return;
    event.preventDefault();
    keys.add(key);
  };
  const keyup: EventListener = (value) => {
    const event = value as KeyboardEvent;
    const key = keyMap.get(event.code);
    if (!enabled || !key) return;
    if (keys.delete(key) && !editable(event.target)) event.preventDefault();
  };
  const pointermove: EventListener = (value) => {
    const event = value as PointerEvent;
    if (enabled && event.isPrimary !== false) mapPointer(event);
  };
  const pointerdown: EventListener = (value) => {
    const event = value as PointerEvent;
    if (!enabled || event.isPrimary === false || event.button !== 0) return;
    event.preventDefault();
    mapPointer(event);
    pointerHeld = true;
    pointerId = event.pointerId;
    host.focus?.({ preventScroll: true });
    host.setPointerCapture?.(event.pointerId);
  };
  const release = (): void => {
    if (pointerId !== null && host.hasPointerCapture?.(pointerId)) host.releasePointerCapture?.(pointerId);
  };
  const pointerup: EventListener = (value) => {
    const event = value as PointerEvent;
    if (pointerId === null || event.pointerId !== pointerId) return;
    mapPointer(event);
    pointerHeld = false;
    release();
    pointerId = null;
  };
  const pointercancel: EventListener = (value) => {
    const event = value as PointerEvent;
    if (pointerId === null || event.pointerId !== pointerId) return;
    pointerHeld = false;
    pendingPointer = null;
    release();
    pointerId = null;
  };
  const blur = () => {
    keys.clear();
    pointerHeld = false;
    pendingPointer = null;
    release();
    pointerId = null;
  };
  const registrations: Registration[] = [
    [host, "keydown", keydown],
    [host, "keyup", keyup],
    [host, "blur", blur],
    [win, "blur", blur],
    [host, "pointermove", pointermove],
    [host, "pointerdown", pointerdown],
    [host, "pointerup", pointerup],
    [host, "pointercancel", pointercancel],
    [host, "lostpointercapture", pointercancel],
  ];
  const attached: Registration[] = [];
  try {
    for (const registration of registrations) {
      registration[0].addEventListener(registration[1], registration[2]);
      attached.push(registration);
    }
  } catch (error) {
    for (const [target, name, listener] of attached.reverse()) {
      try { target.removeEventListener(name, listener); } catch {}
    }
    throw error;
  }
  return Object.freeze({
    setEnabled(next: boolean) {
      invariant(!destroyed, "INPUT_DESTROYED", "The mounted input adapter is destroyed.");
      enabled = next;
      if (!enabled) blur();
    },
    sample() {
      invariant(!destroyed, "INPUT_DESTROYED", "The mounted input adapter is destroyed.");
      const x = Number(keys.has("right")) - Number(keys.has("left"));
      const y = Number(keys.has("up")) - Number(keys.has("down"));
      const pointer = pendingPointer;
      pendingPointer = null;
      return Object.freeze({
        stickX: pointer ? 0 : x < 0 ? -128 : x > 0 ? 127 : 0,
        stickY: pointer ? 0 : y < 0 ? -128 : y > 0 ? 127 : 0,
        pressed: keys.has("grab") || pointerHeld,
        hold: keys.has("hold"),
        pointer,
      });
    },
    destroy() {
      if (destroyed) return false;
      destroyed = true;
      try { release(); } catch {}
      for (const [target, name, listener] of registrations) {
        try { target.removeEventListener(name, listener); } catch {}
      }
      return true;
    },
  });
}
