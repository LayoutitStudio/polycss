import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ParseResult, Polygon } from "@layoutit/polycss-core";
import { createPolyScene, type PolySceneHandle } from "./createPolyScene";
import { createTransformControls } from "./createTransformControls";
import { createPolyOrthographicCamera } from "./createPolyCamera";

const TRIANGLE: Polygon = {
  vertices: [[0, 0, 0], [1, 0, 0], [0, 1, 0]],
  color: "#fff",
};

function parseResult(polygons: Polygon[] = [TRIANGLE]): ParseResult {
  return { polygons, objectUrls: [], warnings: [], dispose: () => {} };
}

/**
 * Fake screen layout for drag math: each element's getBoundingClientRect
 * walks ancestor translate3d(x, y, z)px values, scaled by `cameraScale`.
 * Lets the test assert deterministic drag deltas without a real layout
 * engine (happy-dom returns 0×0 for everything by default).
 */
function withFakeLayout(cameraScale: number, fn: () => void): void {
  const TRANSFORM_RE = /translate3d\(\s*(-?[\d.]+)px,\s*(-?[\d.]+)px,\s*(-?[\d.]+)px\s*\)/;
  const orig = Element.prototype.getBoundingClientRect;
  Element.prototype.getBoundingClientRect = function fakeRect(this: Element): DOMRect {
    let x = 0, y = 0;
    let cur: Element | null = this;
    while (cur && cur instanceof HTMLElement) {
      const t = cur.style.transform;
      if (t) {
        const m = TRANSFORM_RE.exec(t);
        if (m) {
          x += parseFloat(m[1]) * cameraScale;
          y += parseFloat(m[2]) * cameraScale;
        }
      }
      cur = cur.parentElement;
    }
    const w = this instanceof HTMLElement ? parseFloat(this.style.width || "0") || 0 : 0;
    const h = this instanceof HTMLElement ? parseFloat(this.style.height || "0") || 0 : 0;
    return {
      left: x, top: y, right: x + w, bottom: y + h, width: w, height: h, x, y,
      toJSON() { return this; },
    } as DOMRect;
  };
  try {
    fn();
  } finally {
    Element.prototype.getBoundingClientRect = orig;
  }
}

/**
 * Dispatch a pointerdown on an arrow/ring element and simulate a drag.
 * Uses polygon rects for the hit-test: sets the gizmo's leaf children
 * to have known rects that include clientX/clientY.
 */
function triggerPointerDownOnGizmoEl(
  host: HTMLElement,
  selector: string,
  clientX = 0,
  clientY = 0,
): void {
  const el = host.querySelector(selector) as HTMLElement | null;
  if (!el) throw new Error(`No element matching ${selector}`);

  // Give each leaf child a bounding rect that covers the pointer position
  // by injecting a style that withFakeLayout can pick up, OR by directly
  // creating a leaf element with position. Since pointInMeshElement checks leaf
  // rects via getBoundingClientRect, we need to patch getBoundingClientRect
  // on the leaf elements inside this gizmo mesh to return rects containing the
  // pointer coordinates.
  const iEls = el.querySelectorAll("i,b,s,u");
  const origRects = new Map<Element, () => DOMRect>();
  // Offset bbox so the click sits at the bbox's right edge instead of its
  // center. Rings use a donut-shaped hit-test that rejects clicks AT the
  // bbox center (it's the inner hole). A click at the boundary passes both
  // the arrow rect test (clientX <= r.right) AND the donut test (normalized
  // distance from bbox center = 1, on the outer edge).
  iEls.forEach((i) => {
    origRects.set(i, i.getBoundingClientRect.bind(i));
    i.getBoundingClientRect = () => ({
      left: clientX - 2,
      top: clientY - 1,
      right: clientX,
      bottom: clientY + 1,
      width: 2,
      height: 2,
      x: clientX - 2,
      y: clientY - 1,
      toJSON() { return this; },
    } as DOMRect);
  });

  host.dispatchEvent(
    new PointerEvent("pointerdown", { bubbles: true, clientX, clientY, pointerId: 1 }),
  );

  // Restore original rects
  iEls.forEach((i) => {
    const original = origRects.get(i);
    if (original) i.getBoundingClientRect = original;
  });
}

describe("createTransformControls", () => {
  let host: HTMLElement;
  let scene: PolySceneHandle;
  let tc: ReturnType<typeof createTransformControls> | null = null;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
    scene = createPolyScene(host, { camera: createPolyOrthographicCamera() });
  });

  afterEach(() => {
    tc?.destroy();
    tc = null;
    scene.destroy();
    if (host.parentNode) host.parentNode.removeChild(host);
  });

  // ── Test 1: attach(null) renders nothing ────────────────────────────────────
  it("attach(null) renders no gizmo meshes in the scene", () => {
    tc = createTransformControls(scene);
    tc.attach(null);
    const gizmos = host.querySelectorAll(".polycss-transform-gizmo");
    expect(gizmos.length).toBe(0);
  });

  // ── Test 2: translate mode renders 6 arrows + 3 plane handles ───────────────
  it("attach(mesh) in translate mode mounts 6 arrows + 3 plane handles", () => {
    const mesh = scene.add(parseResult(), { id: "target" });
    tc = createTransformControls(scene, { mode: "translate" });
    tc.attach(mesh);

    const arrows = host.querySelectorAll(".polycss-transform-arrow");
    expect(arrows.length).toBe(6);

    const arrowKeys = Array.from(arrows).map((el) => {
      const m = /polycss-transform-arrow--(-?[a-z])/.exec(el.className);
      return m ? m[1] : null;
    });
    expect(arrowKeys).toEqual(["x", "-x", "y", "-y", "z", "-z"]);

    const planes = host.querySelectorAll(".polycss-transform-plane");
    expect(planes.length).toBe(3);
    const planeKeys = Array.from(planes).map((el) => {
      const m = /polycss-transform-plane--([a-z]+)/.exec(el.className);
      return m ? m[1] : null;
    });
    expect(planeKeys.sort()).toEqual(["xy", "xz", "yz"]);

    // All nine carry the shared gizmo class.
    const gizmos = host.querySelectorAll(".polycss-transform-gizmo");
    expect(gizmos.length).toBe(9);
  });

  // ── Test 3: rotate mode renders 3 rings ─────────────────────────────────────
  it("rotate mode renders 3 .polycss-transform-ring meshes (one per axis)", () => {
    const mesh = scene.add(parseResult(), { id: "target" });
    tc = createTransformControls(scene, { mode: "rotate" });
    tc.attach(mesh);

    const rings = host.querySelectorAll(".polycss-transform-ring");
    expect(rings.length).toBe(3);

    const keys = Array.from(rings).map((el) => {
      const m = /polycss-transform-ring--([a-z])/.exec(el.className);
      return m ? m[1] : null;
    });
    expect(keys).toEqual(["x", "y", "z"]);

    // No arrows should be present
    expect(host.querySelectorAll(".polycss-transform-arrow").length).toBe(0);
  });

  // ── Test 4: no-target attach renders nothing ─────────────────────────────────
  it("attach(null) followed by attach(mesh) shows the gizmo", () => {
    const mesh = scene.add(parseResult(), { id: "target" });
    tc = createTransformControls(scene);
    tc.attach(null);
    expect(host.querySelectorAll(".polycss-transform-gizmo").length).toBe(0);
    tc.attach(mesh);
    expect(host.querySelectorAll(".polycss-transform-gizmo").length).toBeGreaterThan(0);
  });

  // ── Test 5: showX/Y/Z=false hides the corresponding pair ────────────────────
  it("showX=false showZ=false hides X and Z pairs, only Y arrows remain", () => {
    const mesh = scene.add(parseResult(), { id: "target" });
    tc = createTransformControls(scene, { showX: false, showZ: false });
    tc.attach(mesh);

    const arrows = host.querySelectorAll(".polycss-transform-arrow");
    expect(arrows.length).toBe(2);

    const keys = Array.from(arrows).map((el) => {
      const m = /polycss-transform-arrow--(-?[a-z])/.exec(el.className);
      return m ? m[1] : null;
    });
    expect(keys).toEqual(["y", "-y"]);
  });

  it("showY=false in rotate mode hides the Y ring, leaving X and Z", () => {
    const mesh = scene.add(parseResult(), { id: "target" });
    tc = createTransformControls(scene, { mode: "rotate", showY: false });
    tc.attach(mesh);

    const rings = host.querySelectorAll(".polycss-transform-ring");
    expect(rings.length).toBe(2);

    const keys = Array.from(rings).map((el) => {
      const m = /polycss-transform-ring--([a-z])/.exec(el.className);
      return m ? m[1] : null;
    });
    expect(keys).toEqual(["x", "z"]);
  });

  // ── Test 6: setMode("rotate") swaps geometry ────────────────────────────────
  it("setMode('rotate') tears down arrows and replaces with 3 rings", () => {
    const mesh = scene.add(parseResult(), { id: "target" });
    tc = createTransformControls(scene, { mode: "translate" });
    tc.attach(mesh);

    expect(host.querySelectorAll(".polycss-transform-arrow").length).toBe(6);

    tc.setMode("rotate");

    expect(host.querySelectorAll(".polycss-transform-arrow").length).toBe(0);
    expect(host.querySelectorAll(".polycss-transform-ring").length).toBe(3);
  });

  // ── Test 7: drag X arrow → onObjectChange fires with new position ────────────
  it("dragging X arrow fires onObjectChange with updated position.x", () => {
    withFakeLayout(2, () => {
      const onObjectChange = vi.fn();
      const mesh = scene.add(parseResult(), { id: "target", position: [100, 200, 0] });
      tc = createTransformControls(scene, { onObjectChange });
      tc.attach(mesh);

      // Give the X arrow's <i> children real rects so the hit-test passes,
      // then dispatch pointerdown on the host at (0, 0).
      triggerPointerDownOnGizmoEl(host, ".polycss-transform-arrow--x", 0, 0);

      // cameraScale=2, X arrow is cssAxis=0 → probe at translate3d(shaft,0,0).
      // Screen probe ratio 2, dot product with pointer (10,0) gives t=5 CSS px.
      // Post-parity drag math: t/SCENE_TILE_SIZE = 0.1 world units, applied
      // to world axis WORLD_AXIS_FOR_CSS[0] = 1 (world Y). So position[1]
      // moves 0.1 from 200 → 200.1; world X and Z unchanged.
      window.dispatchEvent(
        new PointerEvent("pointermove", { clientX: 10, clientY: 0, pointerId: 1 }),
      );

      expect(onObjectChange).toHaveBeenCalled();
      const evt = onObjectChange.mock.calls[0][0];
      expect(evt.position).toEqual([100, 200.1, 0]);
      expect(evt.object).toBe(mesh);

      window.dispatchEvent(new PointerEvent("pointerup", { clientX: 10, clientY: 0, pointerId: 1 }));
    });
  });

  // ── Test 8: drag Y arrow → only position[1] changes ─────────────────────────
  it("dragging Y arrow only changes position[1]; perpendicular X pointer has no effect", () => {
    withFakeLayout(2, () => {
      const onObjectChange = vi.fn();
      const mesh = scene.add(parseResult(), { id: "target", position: [10, 20, 30] });
      tc = createTransformControls(scene, { onObjectChange });
      tc.attach(mesh);

      triggerPointerDownOnGizmoEl(host, ".polycss-transform-arrow--y", 0, 0);

      // Y arrow is cssAxis=1 → screen probe (0, 2). Pointer (0, 6) → t=3 CSS px.
      // Post-parity: t/SCENE_TILE_SIZE = 0.06 world units, applied to world
      // axis WORLD_AXIS_FOR_CSS[1] = 0 (world X). position[0] moves 0.06 from
      // 10 → 10.06; Y and Z unchanged.
      window.dispatchEvent(
        new PointerEvent("pointermove", { clientX: 0, clientY: 6, pointerId: 1 }),
      );
      expect(onObjectChange.mock.calls[0][0].position).toEqual([10.06, 20, 30]);

      // Perpendicular X-only pointer motion: dot([100, 0], [0, 2]) = 0 → t=0.
      // Cumulative pointer (100, 6) re-projects to t=3 (same as before), so
      // position[0] stays at 10.06 and Y/Z stay unchanged.
      window.dispatchEvent(
        new PointerEvent("pointermove", { clientX: 100, clientY: 6, pointerId: 1 }),
      );
      expect(onObjectChange.mock.calls[1][0].position[1]).toBe(20); // y unchanged
      expect(onObjectChange.mock.calls[1][0].position[2]).toBe(30); // z unchanged

      window.dispatchEvent(new PointerEvent("pointerup", { clientX: 100, clientY: 6, pointerId: 1 }));
    });
  });

  // ── Test 9: translationSnap rounds the projected delta ──────────────────────
  it("translationSnap=5 rounds the projected delta to step boundaries", () => {
    withFakeLayout(2, () => {
      const onObjectChange = vi.fn();
      const mesh = scene.add(parseResult(), { id: "target", position: [0, 0, 0] });
      tc = createTransformControls(scene, { translationSnap: 5, onObjectChange });
      tc.attach(mesh);

      triggerPointerDownOnGizmoEl(host, ".polycss-transform-arrow--x", 0, 0);

      // Pointer (14, 0): raw t = 7 CSS px, snap(7, 5) = 5 CSS px. The snap
      // value is in CSS pixels (callers like the builder pre-multiply by
      // BASE_TILE so a "10 world unit" snap reads as 500 CSS px). After
      // post-parity drag math: 5 CSS px / SCENE_TILE_SIZE = 0.1 world units
      // along world axis WORLD_AXIS_FOR_CSS[0] = 1 (world Y).
      window.dispatchEvent(
        new PointerEvent("pointermove", { clientX: 14, clientY: 0, pointerId: 1 }),
      );

      expect(onObjectChange).toHaveBeenCalled();
      expect(onObjectChange.mock.calls[0][0].position).toEqual([0, 0.1, 0]);

      window.dispatchEvent(new PointerEvent("pointerup", { clientX: 14, clientY: 0, pointerId: 1 }));
    });
  });

  // ── Test 10: onDraggingChanged fires true on down, false on up ───────────────
  it("onDraggingChanged fires true on pointerdown then false on pointerup", () => {
    withFakeLayout(2, () => {
      const onDraggingChanged = vi.fn();
      const onMouseDown = vi.fn();
      const onMouseUp = vi.fn();
      const mesh = scene.add(parseResult(), { id: "target" });
      tc = createTransformControls(scene, { onDraggingChanged, onMouseDown, onMouseUp });
      tc.attach(mesh);

      triggerPointerDownOnGizmoEl(host, ".polycss-transform-arrow--x", 0, 0);

      expect(onDraggingChanged).toHaveBeenCalledTimes(1);
      expect(onDraggingChanged).toHaveBeenLastCalledWith(true);
      expect(onMouseDown).toHaveBeenCalledTimes(1);

      window.dispatchEvent(new PointerEvent("pointerup", { clientX: 0, clientY: 0, pointerId: 1 }));

      expect(onDraggingChanged).toHaveBeenCalledTimes(2);
      expect(onDraggingChanged).toHaveBeenLastCalledWith(false);
      expect(onMouseUp).toHaveBeenCalledTimes(1);
    });
  });

  // ── Test 11: rotate ring drag → onObjectChange fires with new rotation ───────
  it("dragging X ring fires onObjectChange with updated rotation around world Y", () => {
    withFakeLayout(2, () => {
      const onObjectChange = vi.fn();
      const mesh = scene.add(parseResult(), { id: "target" });
      mesh.setTransform({ rotation: [0, 0, 0] });
      tc = createTransformControls(scene, { mode: "rotate", onObjectChange });
      tc.attach(mesh);

      // Pointerdown at (100, 100); gizmo wrapper at (0, 0) so the start
      // angle is atan2(100, 100) = 45° in screen space.
      triggerPointerDownOnGizmoEl(host, ".polycss-transform-ring--x", 100, 100);

      // Move pointer to (200, 100): atan2(100, 200) ≈ 26.57°. Screen delta is
      // CCW-negative ≈ -18.43°. Post-parity: the "X" ring is built around
      // WORLD_AXIS_FOR_CSS[0] = world Y, so the rotation goes into
      // `rotation[1]`, not `rotation[0]`. A single global sign flip
      // (-degrees) maps CCW-in-screen to CW-in-world, matching what the
      // user sees when they drag the visible ring.
      window.dispatchEvent(
        new PointerEvent("pointermove", { clientX: 200, clientY: 100, pointerId: 1 }),
      );

      expect(onObjectChange).toHaveBeenCalled();
      const evt = onObjectChange.mock.calls[0][0];
      expect(evt.rotation).toBeDefined();
      expect(evt.rotation![1]).toBeTypeOf("number");
      expect(Math.abs(evt.rotation![1])).toBeGreaterThan(0);
      // X and Z should stay ~0. Quaternion → Euler round-trip can yield -0
      // for nominally-zero components, so compare magnitudes.
      expect(Math.abs(evt.rotation![0])).toBeLessThan(1e-6);
      expect(Math.abs(evt.rotation![2])).toBeLessThan(1e-6);
      expect(evt.object).toBe(mesh);

      window.dispatchEvent(new PointerEvent("pointerup", { clientX: 200, clientY: 100, pointerId: 1 }));
    });
  });

  // ── Test 12: destroy() removes all gizmo meshes ──────────────────────────────
  it("destroy() removes all gizmo meshes from the scene and unbinds listeners", () => {
    const onObjectChange = vi.fn();
    const mesh = scene.add(parseResult(), { id: "target" });
    tc = createTransformControls(scene, { onObjectChange });
    tc.attach(mesh);

    // Confirm gizmos are present
    expect(host.querySelectorAll(".polycss-transform-gizmo").length).toBe(9);

    tc.destroy();
    tc = null;

    // All gizmo meshes should be gone from the DOM
    expect(host.querySelectorAll(".polycss-transform-gizmo").length).toBe(0);

    // No more events after destroy — pointerdown on host should not trigger anything
    withFakeLayout(2, () => {
      triggerPointerDownOnGizmoEl(host, ".polycss-mesh", 0, 0);
      window.dispatchEvent(new PointerEvent("pointermove", { clientX: 100, clientY: 0, pointerId: 1 }));
      window.dispatchEvent(new PointerEvent("pointerup", { clientX: 100, clientY: 0, pointerId: 1 }));
    });
    // onObjectChange should not have fired (no target attached)
    expect(onObjectChange).not.toHaveBeenCalled();
  });

  // ── Bonus: detach() is equivalent to attach(null) ───────────────────────────
  it("detach() removes gizmo meshes and is equivalent to attach(null)", () => {
    const mesh = scene.add(parseResult(), { id: "target" });
    tc = createTransformControls(scene, { mode: "translate" });
    tc.attach(mesh);
    expect(host.querySelectorAll(".polycss-transform-gizmo").length).toBe(9);

    tc.detach();
    expect(host.querySelectorAll(".polycss-transform-gizmo").length).toBe(0);
  });

  // ── Bonus: enabled=false prevents drag callbacks ─────────────────────────────
  it("enabled=false: pointerdown does not fire any callbacks", () => {
    withFakeLayout(2, () => {
      const onMouseDown = vi.fn();
      const onObjectChange = vi.fn();
      const mesh = scene.add(parseResult(), { id: "target" });
      tc = createTransformControls(scene, { enabled: false, onMouseDown, onObjectChange });
      tc.attach(mesh);

      triggerPointerDownOnGizmoEl(host, ".polycss-transform-arrow--x", 0, 0);
      window.dispatchEvent(new PointerEvent("pointermove", { clientX: 100, clientY: 0, pointerId: 1 }));
      window.dispatchEvent(new PointerEvent("pointerup", { clientX: 100, clientY: 0, pointerId: 1 }));

      expect(onMouseDown).not.toHaveBeenCalled();
      expect(onObjectChange).not.toHaveBeenCalled();
    });
  });

  // ── Bonus: onChange fires alongside onObjectChange during drag ───────────────
  it("onChange fires on every drag move (mirrors three.js onChange)", () => {
    withFakeLayout(2, () => {
      const onChange = vi.fn();
      const mesh = scene.add(parseResult(), { id: "target", position: [0, 0, 0] });
      tc = createTransformControls(scene, { onChange });
      tc.attach(mesh);

      triggerPointerDownOnGizmoEl(host, ".polycss-transform-arrow--x", 0, 0);

      window.dispatchEvent(new PointerEvent("pointermove", { clientX: 10, clientY: 0, pointerId: 1 }));
      expect(onChange).toHaveBeenCalledTimes(1);

      window.dispatchEvent(new PointerEvent("pointermove", { clientX: 20, clientY: 0, pointerId: 1 }));
      expect(onChange).toHaveBeenCalledTimes(2);

      window.dispatchEvent(new PointerEvent("pointerup", { clientX: 20, clientY: 0, pointerId: 1 }));
    });
  });

  // ── rebakeAtlas on ring release ─────────────────────────────────────────────
  it("ring pointerdown→up calls rebakeAtlas() once on the target mesh", () => {
    withFakeLayout(2, () => {
      const mesh = scene.add(parseResult(), { id: "target" });
      mesh.setTransform({ rotation: [0, 0, 0] });

      // Spy on rebakeAtlas before attaching so the spy is in place.
      const rebakeSpy = vi.spyOn(mesh, "rebakeAtlas");

      tc = createTransformControls(scene, { mode: "rotate" });
      tc.attach(mesh);

      triggerPointerDownOnGizmoEl(host, ".polycss-transform-ring--x", 100, 100);

      // rebakeAtlas must NOT fire during the drag — only on release.
      expect(rebakeSpy).not.toHaveBeenCalled();

      window.dispatchEvent(new PointerEvent("pointerup", { clientX: 100, clientY: 100, pointerId: 1 }));

      expect(rebakeSpy).toHaveBeenCalledTimes(1);
    });
  });

  it("axis-arrow (translate) pointerup does NOT call rebakeAtlas()", () => {
    withFakeLayout(2, () => {
      const mesh = scene.add(parseResult(), { id: "target", position: [0, 0, 0] });
      const rebakeSpy = vi.spyOn(mesh, "rebakeAtlas");

      tc = createTransformControls(scene, { mode: "translate" });
      tc.attach(mesh);

      triggerPointerDownOnGizmoEl(host, ".polycss-transform-arrow--x", 0, 0);
      window.dispatchEvent(new PointerEvent("pointermove", { clientX: 10, clientY: 0, pointerId: 1 }));
      window.dispatchEvent(new PointerEvent("pointerup", { clientX: 10, clientY: 0, pointerId: 1 }));

      // Translation does not change world normals — no rebake needed.
      expect(rebakeSpy).not.toHaveBeenCalled();
    });
  });
});
