export class FakeElement {
  constructor(ownerDocument, name = "div", namespaceURI = "http://www.w3.org/1999/xhtml") {
    this.ownerDocument = ownerDocument;
    this.localName = name;
    this.namespaceURI = namespaceURI;
    this.childNodes = [];
    this.parentNode = null;
    this.attributes = new Map();
    const styleTarget = {};
    this.stylePriorities = new Map();
    Object.defineProperty(styleTarget, "setProperty", {
      enumerable: false,
      value: (name, value, priority = "") => {
        const property = String(name).replace(/-([a-z])/gu, (_match, letter) => letter.toUpperCase());
        this.stylePriorities.set(String(name), String(priority));
        this.style[property] = String(value);
      },
    });
    this.style = new Proxy(styleTarget, {
      set: (target, property, value) => {
        target[property] = value;
        ownerDocument?.writes?.push(Object.freeze({ element: this, property: String(property), value: String(value) }));
        return true;
      },
    });
    this.dataset = {};
    this.classes = [];
    this.classList = {
      add: (...tokens) => {
        for (const token of tokens) {
          if (this.classes.includes(token)) continue;
          this.classes.push(token);
          ownerDocument?.writes?.push(Object.freeze({ element: this, property: "class:add", value: String(token) }));
        }
      },
      remove: (...tokens) => {
        for (const token of tokens) {
          if (!this.classes.includes(token)) continue;
          this.classes = this.classes.filter((entry) => entry !== token);
          ownerDocument?.writes?.push(Object.freeze({ element: this, property: "class:remove", value: String(token) }));
        }
      },
    };
    this.listeners = new Map();
    this.listenerSequence = 0;
    this.capturedPointers = new Set();
    this.animations = [];
    this.clientWidth = 320;
    this.clientHeight = 240;
  }

  appendChild(child) {
    child.parentNode = this;
    this.childNodes.push(child);
    return child;
  }

  replaceChildren(...children) {
    for (const child of this.childNodes) child.parentNode = null;
    this.childNodes = [];
    for (const child of children) this.appendChild(child);
  }

  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  hasAttribute(name) { return this.attributes.has(name); }
  removeAttribute(name) { this.attributes.delete(name); }
  addEventListener(name, listener) { this.listeners.set(`${name}:${this.listenerSequence++}`, listener); }
  removeEventListener(name, listener) {
    for (const [key, value] of this.listeners) if (key.startsWith(`${name}:`) && value === listener) this.listeners.delete(key);
  }
  getBoundingClientRect() { return { left: 0, top: 0, width: this.clientWidth, height: this.clientHeight }; }
  closest() { return null; }
  focus(options) { this.focusOptions = options; }
  setPointerCapture(pointerId) { this.capturedPointers.add(pointerId); }
  hasPointerCapture(pointerId) { return this.capturedPointers.has(pointerId); }
  releasePointerCapture(pointerId) { this.capturedPointers.delete(pointerId); }
  animate(keyframes, options) {
    const animation = {
      keyframes,
      options,
      currentTime: 0,
      playState: "running",
      cancel() { this.playState = "idle"; },
      pause() { this.playState = "paused"; },
      play() { this.playState = "running"; },
    };
    this.animations.push(animation);
    return animation;
  }
  remove() {
    if (!this.parentNode) return;
    const index = this.parentNode.childNodes.indexOf(this);
    if (index >= 0) this.parentNode.childNodes.splice(index, 1);
    this.parentNode = null;
  }
}

export function fakeBrowserDocument() {
  const urls = { created: [], revoked: [] };
  const observers = [];
  const bitmaps = [];
  const namespaced = [];
  const writes = [];
  const raf = new Map();
  const timers = new Map();
  let rafSequence = 1;
  let timerSequence = 1;
  let clock = 0;
  class FakeResizeObserver {
    constructor(callback) {
      this.callback = callback;
      this.observed = [];
      this.disconnected = false;
      observers.push(this);
    }
    observe(value) { this.observed.push(value); }
    disconnect() { this.disconnected = true; }
  }
  const windowListeners = new Map();
  const win = {
    Blob,
    URL: {
      createObjectURL() {
        const value = `blob:fake-${urls.created.length}`;
        urls.created.push(value);
        return value;
      },
      revokeObjectURL(value) { urls.revoked.push(value); },
    },
    performance: { now: () => clock },
    Element: FakeElement,
    HTMLInputElement: class extends FakeElement {},
    HTMLTextAreaElement: class extends FakeElement {},
    HTMLSelectElement: class extends FakeElement {},
    ResizeObserver: FakeResizeObserver,
    async createImageBitmap() {
      const bitmap = { width: 2, height: 2, closed: false, close() { this.closed = true; } };
      bitmaps.push(bitmap);
      return bitmap;
    },
    requestAnimationFrame(callback) {
      const id = rafSequence++;
      raf.set(id, callback);
      return id;
    },
    cancelAnimationFrame(id) { raf.delete(id); },
    setTimeout(callback, delay = 0) {
      const id = timerSequence++;
      timers.set(id, { callback, delay, due: clock + Math.max(0, Number(delay) || 0) });
      return id;
    },
    clearTimeout(id) { timers.delete(id); },
    listeners: windowListeners,
    addEventListener(name, listener) {
      if (!windowListeners.has(name)) windowListeners.set(name, new Set());
      windowListeners.get(name).add(listener);
    },
    removeEventListener(name, listener) { windowListeners.get(name)?.delete(listener); },
  };
  const document = {
    defaultView: win,
    writes,
    createElement(name) { return new FakeElement(document, name); },
    createElementNS(namespace, name) {
      const element = new FakeElement(document, name, namespace);
      namespaced.push(element);
      return element;
    },
  };
  document.head = new FakeElement(document, "head");
  const run = (timestamp, forceTimers) => {
    clock = timestamp;
    const pendingTimers = [...timers.entries()].filter(([, timer]) => forceTimers || timer.due <= timestamp);
    for (const [id, timer] of pendingTimers) {
      timers.delete(id);
      timer.callback();
    }
    const callbacks = [...raf.values()];
    raf.clear();
    for (const callback of callbacks) callback(timestamp);
    return callbacks.length;
  };
  const frame = (timestamp) => run(timestamp, true);
  const advance = (timestamp) => run(timestamp, false);
  return { document, win, urls, observers, bitmaps, namespaced, writes, raf, timers, frame, advance };
}

export function dispatch(element, name, values = {}) {
  let prevented = false;
  const event = {
    target: element,
    isPrimary: true,
    preventDefault() { prevented = true; },
    ...values,
  };
  for (const [key, listener] of element.listeners) if (key.startsWith(`${name}:`)) listener(event);
  return Object.freeze({ event, get prevented() { return prevented; } });
}
