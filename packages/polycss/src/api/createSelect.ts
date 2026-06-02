/**
 * createSelect — additive selection layer for vanilla PolyCSS scenes.
 * Mirrors the React `<Select>` API: tracks one or more selected
 * meshes, fires `onChange` whenever the set changes, supports
 * single-click toggle (re-clicking the selected mesh deselects it),
 * shift/meta/ctrl + click for multi-select extension, and a JS bbox
 * hit-test fallback for clicks that fall through native polygon
 * hit-testing (e.g. CSS `border-shape` clipping).
 *
 * Usage:
 *   const select = createSelect(scene, { onChange: (meshes) => ... });
 *   select.set([handle]);            // imperative selection
 *   select.toggle(handle);
 *   select.clear();
 *   select.destroy();                // remove listeners
 */
import type { PolyMeshHandle, PolySceneHandle } from "./createPolyScene";
import { findMeshUnderPoint as findMeshUnderPointInMeshes } from "./meshHitTest";

export interface PolySelectOptions {
  /** Allow multiple meshes selected at once. Default false. */
  multiple?: boolean;
  /** When true (default), clicking the background clears selection.
   *  Set false to keep the current selection on background clicks. */
  clearOnMiss?: boolean;
  /** Optional filter applied to every selection change — return the
   *  array that should become the new selection (drop / reorder). */
  filter?: (meshes: PolyMeshHandle[]) => PolyMeshHandle[];
  /** Fires after every selection change with the new array. */
  onChange?: (meshes: PolyMeshHandle[]) => void;
  /** Fires when a click resolves to no mesh (background click). */
  onPointerMissed?: (event: MouseEvent) => void;
}

export interface PolySelectionHandle {
  /** Current selection. Reference is stable until selection changes. */
  readonly selected: ReadonlyArray<PolyMeshHandle>;
  /** Replace selection wholesale. */
  set(next: PolyMeshHandle[]): void;
  /** Add to selection (or replace, when `multiple` is false). */
  add(mesh: PolyMeshHandle): void;
  /** Remove from selection. No-op if not present. */
  remove(mesh: PolyMeshHandle): void;
  /** Toggle membership. With single-mode, toggling a non-selected
   *  mesh replaces selection; toggling the selected mesh clears. */
  toggle(mesh: PolyMeshHandle): void;
  /** Clear selection. */
  clear(): void;
  /** Membership test. */
  has(mesh: PolyMeshHandle): boolean;
  /** Remove the host listener. Idempotent. */
  destroy(): void;
}

export function createSelect(
  scene: PolySceneHandle,
  options: PolySelectOptions = {},
): PolySelectionHandle {
  let selected: PolyMeshHandle[] = [];
  const subscribers = new Set<(meshes: PolyMeshHandle[]) => void>();
  if (options.onChange) subscribers.add(options.onChange);

  function notify(): void {
    const filtered = options.filter ? options.filter(selected) : selected;
    selected = filtered;
    for (const fn of subscribers) {
      try { fn(selected); } catch (err) {
        // eslint-disable-next-line no-console
        console.error("[polycss/createSelect] onChange threw:", err);
      }
    }
  }

  function set(next: PolyMeshHandle[]): void {
    selected = next;
    notify();
  }

  function add(mesh: PolyMeshHandle): void {
    if (options.multiple) {
      if (!selected.includes(mesh)) selected = [...selected, mesh];
    } else {
      selected = [mesh];
    }
    notify();
  }

  function remove(mesh: PolyMeshHandle): void {
    if (!selected.includes(mesh)) return;
    selected = selected.filter((m) => m !== mesh);
    notify();
  }

  function toggle(mesh: PolyMeshHandle): void {
    if (selected.includes(mesh)) {
      selected = selected.filter((m) => m !== mesh);
    } else if (options.multiple) {
      selected = [...selected, mesh];
    } else {
      selected = [mesh];
    }
    notify();
  }

  function clear(): void {
    if (selected.length === 0) return;
    selected = [];
    notify();
  }

  function has(mesh: PolyMeshHandle): boolean {
    return selected.includes(mesh);
  }

  function findMeshUnderPoint(clientX: number, clientY: number): PolyMeshHandle | null {
    return findMeshUnderPointInMeshes(
      scene.meshes(),
      clientX,
      clientY,
      // Skip gizmo meshes — they're managed by transform-controls and
      // shouldn't resolve as user-selectable content. The shared
      // `polycss-transform-gizmo` class is set on every gizmo mesh
      // (translate arrows + rotate rings).
      (mesh) => !mesh.element.classList.contains("polycss-transform-gizmo"),
    );
  }

  // Click delegation on the scene host. Matches the React equivalent
  // — we listen on the host (not the scene root) because:
  //   1. polygons may not be hit-testable when a downstream stylesheet
  //      forces `pointer-events: none`, so clicks bubble up to the host
  //      directly with target=host.
  //   2. `border-shape` (Chrome) clips polygon hit areas to the visible
  //      shape, so even with pointer-events enabled, clicks on the
  //      transparent corners of a polygon `<i>` rect fall through.
  // The JS bbox fallback covers both cases.
  const onClick = (event: MouseEvent): void => {
    const target = event.target as Element | null;
    if (target?.closest(".polycss-transform-gizmo")) return;
    const handle =
      scene.findMeshByElement(target) ??
      findMeshUnderPoint(event.clientX, event.clientY);
    if (!handle) {
      if (options.onPointerMissed) options.onPointerMissed(event);
      if (options.clearOnMiss !== false) clear();
      return;
    }
    const additive = options.multiple && (event.shiftKey || event.metaKey || event.ctrlKey);
    if (additive) {
      toggle(handle);
    } else if (selected.length === 1 && selected[0] === handle) {
      // Re-clicking the only-selected mesh deselects it. Mirrors the
      // single-select UX of three.js editor and the React <Select>.
      clear();
    } else {
      set([handle]);
    }
  };
  scene.host.addEventListener("click", onClick);

  function destroy(): void {
    scene.host.removeEventListener("click", onClick);
    subscribers.clear();
  }

  return {
    get selected() { return selected; },
    set,
    add,
    remove,
    toggle,
    clear,
    has,
    destroy,
  };
}
