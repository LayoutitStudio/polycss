/**
 * createTransformControls — vanilla equivalent of `<TransformControls>`.
 * Builds the same six-arrow translate gizmo / three-ring rotate gizmo
 * around an attached mesh and emits `objectChange` events as the user
 * drags. Mirrors the React API surface (mode, size, snap, draggingChanged
 * event) and uses the same shared geometry helpers in `@layoutit/polycss-core`
 * (`arrowPolygons`, `ringQuadPolygons`).
 *
 * Usage:
 *   const tc = createTransformControls(scene, {
 *     mode: "translate",
 *     // Events are constructor options — the handle has no `on(...)`.
 *     onObjectChange: ({ position, rotation }) => {
 *       // Apply to your own state if you need to keep it in sync; the
 *       // gizmo already calls target.setTransform internally.
 *     },
 *   });
 *   tc.attach(meshHandle);
 *   tc.setMode("rotate");
 *   tc.detach();
 *   tc.destroy();
 */
import {
  ALPHA_DRAGGING,
  ALPHA_HOVER,
  ALPHA_IDLE,
  ARROW_SPECS,
  HEAD_HALF_THICKNESS_RATIO,
  HEAD_LENGTH_RATIO,
  PLANE_HALF_SIZE_RATIO,
  PLANE_OFFSET_RATIO,
  PLANE_SPECS,
  RING_QUAD_OUTER_RATIO,
  RING_HALF_THICKNESS_RATIO,
  RING_RADIUS_RATIO,
  RING_SPECS,
  SCENE_TILE_SIZE,
  SCREEN_AXIS_DEAD_ZONE_SQ,
  SHAFT_HALF_THICKNESS_RATIO,
  WORLD_AXIS_FOR_CSS,
  arrowPolygons,
  eulerXYZFromQuat,
  gizmoLengthForMesh,
  isAxisBackFacing,
  planePolygons,
  quatFromAxisAngle,
  quatFromEulerXYZ,
  quatMultiply,
  ringQuadPolygons,
  rotateVec3,
  screenPlaneDet,
  snap,
  solveAxisDragDelta,
  solvePlaneDragDeltas,
  unwrapAngleDelta,
  withAlpha,
} from "@layoutit/polycss-core";
import type { Polygon, Vec3 } from "@layoutit/polycss-core";
import type { PolyMeshHandle, PolySceneHandle } from "./createPolyScene";
import { pointInMeshElement } from "./meshHitTest";

type Mode = "translate" | "rotate";

/** Compute the bbox center of a mesh's polygons in WORLD units, world-axis
 *  order (`+X right, +Y forward, +Z up`). Added to `target.transform.position`
 *  (also world units, world-axis) to place the gizmo at the mesh's visible
 *  centroid. PolyMesh's buildMeshTransform applies the world→CSS axis swap +
 *  ×BASE_TILE on the resulting position, so consumers stay in world units.
 *  Collapses to (0,0,0) when the mesh is already centered (e.g. when
 *  PolyMesh autoCenter or `loadMesh(..., { center: true })` was used). */
function bboxCenterWorld(polygons: Polygon[]): Vec3 {
  if (polygons.length === 0) return [0, 0, 0];
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (const poly of polygons) {
    for (const v of poly.vertices) {
      if (v[0] < minX) minX = v[0];
      if (v[0] > maxX) maxX = v[0];
      if (v[1] < minY) minY = v[1];
      if (v[1] > maxY) maxY = v[1];
      if (v[2] < minZ) minZ = v[2];
      if (v[2] > maxZ) maxZ = v[2];
    }
  }
  if (!Number.isFinite(minX)) return [0, 0, 0];
  return [
    (minX + maxX) / 2,
    (minY + maxY) / 2,
    (minZ + maxZ) / 2,
  ];
}

export interface PolyTransformControlsObjectChangeEvent {
  object: PolyMeshHandle;
  position?: Vec3;
  rotation?: Vec3;
}

export interface PolyTransformControlsOptions {
  /** Drag mode. "translate" → axial arrows, "rotate" → axial rings. */
  mode?: Mode;
  /** Multiplier on gizmo size (shaft length / ring radius). Default 1. */
  size?: number;
  /** Snap step (CSS pixels) for translate-mode. */
  translationSnap?: number | null;
  /** Snap step (degrees) for rotate-mode. */
  rotationSnap?: number | null;
  /** Show / hide axis pairs. Default true for all. */
  showX?: boolean;
  showY?: boolean;
  showZ?: boolean;
  /** Disable interaction without unmounting. Default true. */
  enabled?: boolean;
  /** Fires for any transform change. Argument-less, mirrors three.js. */
  onChange?: () => void;
  /** Fires with the new transform during drag. The gizmo also calls
   *  `target.setTransform` internally; this callback lets parent code
   *  mirror the change into its own state. */
  onObjectChange?: (event: PolyTransformControlsObjectChangeEvent) => void;
  /** Fires once on drag start. */
  onMouseDown?: () => void;
  /** Fires once on drag end. */
  onMouseUp?: () => void;
  /** Fires with `true` on drag start, `false` on drag end. */
  onDraggingChanged?: (dragging: boolean) => void;
}

export interface PolyTransformControlsHandle {
  /** Bind to a mesh — gizmo follows the mesh's transform. Pass `null`
   *  to detach. Calling `attach` again with a new target swaps the
   *  binding without rebuilding the gizmo geometry. */
  attach(mesh: PolyMeshHandle | null): void;
  /** Equivalent to `attach(null)`. */
  detach(): void;
  /** Switch between translate and rotate. Tears down the old gizmo
   *  and rebuilds the new one. */
  setMode(mode: Mode): void;
  /** Re-read the target's transform and reposition the gizmo. Call
   *  after mutating `target.setTransform` externally if you want the
   *  gizmo to follow. */
  update(): void;
  /** Remove all listeners + gizmo meshes from the scene. Idempotent. */
  destroy(): void;
}

interface DragOptions {
  cssAxis: 0 | 1 | 2;
  sign: 1 | -1;
  shaftLengthCss: number;
  wrapper: HTMLElement;
  target: PolyMeshHandle;
  startClientX: number;
  startClientY: number;
  translationSnap: number | null;
  onAxisDelta(t: number, axisVec: Vec3): void;
  onMouseDown?: () => void;
  onMouseUp?: () => void;
  onDraggingChanged?: (dragging: boolean) => void;
}

/** Project pointer screen-px deltas onto the screen projection of an
 *  axis vector via a temporary probe element. Matches React's
 *  `startAxisDrag`. */
function startAxisDrag(opts: DragOptions): void {
  const {
    cssAxis,
    sign,
    shaftLengthCss,
    wrapper,
    target: _target,
    startClientX,
    startClientY,
    translationSnap,
    onAxisDelta,
    onMouseDown,
    onMouseUp,
    onDraggingChanged,
  } = opts;

  const probeDistance = shaftLengthCss;
  const axisVec: Vec3 = [0, 0, 0];
  axisVec[cssAxis] = sign;
  const probe = wrapper.ownerDocument!.createElement("div");
  probe.style.position = "absolute";
  probe.style.left = "0";
  probe.style.top = "0";
  probe.style.width = "0";
  probe.style.height = "0";
  probe.style.transform = `translate3d(${axisVec[0] * probeDistance}px, ${axisVec[1] * probeDistance}px, ${axisVec[2] * probeDistance}px)`;
  wrapper.appendChild(probe);
  const wRect = wrapper.getBoundingClientRect();
  const pRect = probe.getBoundingClientRect();
  wrapper.removeChild(probe);
  const screenAxisX = (pRect.left - wRect.left) / probeDistance;
  const screenAxisY = (pRect.top - wRect.top) / probeDistance;
  const screenAxisLenSq = screenAxisX * screenAxisX + screenAxisY * screenAxisY;
  if (screenAxisLenSq < SCREEN_AXIS_DEAD_ZONE_SQ) return;

  onMouseDown?.();
  onDraggingChanged?.(true);

  const handleMove = (ev: PointerEvent): void => {
    const dx = ev.clientX - startClientX;
    const dy = ev.clientY - startClientY;
    let t = solveAxisDragDelta(dx, dy, screenAxisX, screenAxisY);
    t = snap(t, translationSnap);
    onAxisDelta(t, axisVec);
  };
  const handleUp = (): void => {
    window.removeEventListener("pointermove", handleMove);
    window.removeEventListener("pointerup", handleUp);
    window.removeEventListener("pointercancel", handleUp);
    // Swallow the click that follows pointerup so a release-over-mesh
    // doesn't toggle selection in createSelect.
    const swallow = (e: Event): void => {
      e.stopPropagation();
      e.stopImmediatePropagation();
    };
    window.addEventListener("click", swallow, { capture: true, once: true });
    setTimeout(() => window.removeEventListener("click", swallow, true), 0);
    onMouseUp?.();
    onDraggingChanged?.(false);
  };
  window.addEventListener("pointermove", handleMove);
  window.addEventListener("pointerup", handleUp);
  window.addEventListener("pointercancel", handleUp);
}

interface PlaneDragOptions {
  axisA: 0 | 1 | 2;
  axisB: 0 | 1 | 2;
  probeDistanceCss: number;
  wrapper: HTMLElement;
  target: PolyMeshHandle;
  startClientX: number;
  startClientY: number;
  translationSnap: number | null;
  onPlaneDelta(tA: number, tB: number, axisAVec: Vec3, axisBVec: Vec3): void;
  onMouseDown?: () => void;
  onMouseUp?: () => void;
  onDraggingChanged?: (dragging: boolean) => void;
}

/** Project pointer screen-px deltas onto a 2D basis (screen projections of
 *  two world axes) and solve a 2x2 system for the planar motion. Mirror of
 *  the single-axis projection in `startAxisDrag`, extended to two axes. */
function startPlaneDrag(opts: PlaneDragOptions): void {
  const {
    axisA,
    axisB,
    probeDistanceCss,
    wrapper,
    startClientX,
    startClientY,
    translationSnap,
    onPlaneDelta,
    onMouseDown,
    onMouseUp,
    onDraggingChanged,
  } = opts;

  // Probe both in-plane axes to measure their screen projections. Same
  // technique as startAxisDrag: place a 0×0 element at `axis * dist`, read
  // its bounding rect against the wrapper's, divide by `dist` to get the
  // unit screen vector for that world axis.
  const axisAVec: Vec3 = [0, 0, 0]; axisAVec[axisA] = 1;
  const axisBVec: Vec3 = [0, 0, 0]; axisBVec[axisB] = 1;
  function probe(axisVec: Vec3): { x: number; y: number } {
    const el = wrapper.ownerDocument!.createElement("div");
    el.style.position = "absolute";
    el.style.left = "0";
    el.style.top = "0";
    el.style.width = "0";
    el.style.height = "0";
    el.style.transform = `translate3d(${axisVec[0] * probeDistanceCss}px, ${axisVec[1] * probeDistanceCss}px, ${axisVec[2] * probeDistanceCss}px)`;
    wrapper.appendChild(el);
    const wR = wrapper.getBoundingClientRect();
    const pR = el.getBoundingClientRect();
    wrapper.removeChild(el);
    return {
      x: (pR.left - wR.left) / probeDistanceCss,
      y: (pR.top - wR.top) / probeDistanceCss,
    };
  }
  const pA = probe(axisAVec);
  const pB = probe(axisBVec);
  const det = screenPlaneDet(pA, pB);
  if (Math.abs(det) < SCREEN_AXIS_DEAD_ZONE_SQ) return; // plane edge-on to camera

  onMouseDown?.();
  onDraggingChanged?.(true);

  const handleMove = (ev: PointerEvent): void => {
    const dx = ev.clientX - startClientX;
    const dy = ev.clientY - startClientY;
    const solved = solvePlaneDragDeltas(dx, dy, pA, pB, det);
    const tA = snap(solved.tA, translationSnap);
    const tB = snap(solved.tB, translationSnap);
    onPlaneDelta(tA, tB, axisAVec, axisBVec);
  };
  const handleUp = (): void => {
    window.removeEventListener("pointermove", handleMove);
    window.removeEventListener("pointerup", handleUp);
    window.removeEventListener("pointercancel", handleUp);
    const swallow = (e: Event): void => {
      e.stopPropagation();
      e.stopImmediatePropagation();
    };
    window.addEventListener("click", swallow, { capture: true, once: true });
    setTimeout(() => window.removeEventListener("click", swallow, true), 0);
    onMouseUp?.();
    onDraggingChanged?.(false);
  };
  window.addEventListener("pointermove", handleMove);
  window.addEventListener("pointerup", handleUp);
  window.addEventListener("pointercancel", handleUp);
}

interface RingDragOptions {
  cssAxis: 0 | 1 | 2;
  wrapper: HTMLElement;
  target: PolyMeshHandle;
  startClientX: number;
  startClientY: number;
  rotationSnap: number | null;
  onAngleDelta(degrees: number): void;
  onMouseDown?: () => void;
  onMouseUp?: () => void;
  onDraggingChanged?: (dragging: boolean) => void;
}

/** Track pointer angle around the gizmo center, accumulate the
 *  unwrapped delta, and feed it back as degrees of rotation. Matches
 *  React's `startRingDrag`. */
function startRingDrag(opts: RingDragOptions): void {
  const {
    cssAxis: _cssAxis,
    wrapper,
    target: _target,
    startClientX,
    startClientY,
    rotationSnap,
    onAngleDelta,
    onMouseDown,
    onMouseUp,
    onDraggingChanged,
  } = opts;

  const wRect = wrapper.getBoundingClientRect();
  const centerX = wRect.left;
  const centerY = wRect.top;

  let lastAngle = Math.atan2(startClientY - centerY, startClientX - centerX);
  let cumulative = 0;

  onMouseDown?.();
  onDraggingChanged?.(true);

  const handleMove = (ev: PointerEvent): void => {
    const a = Math.atan2(ev.clientY - centerY, ev.clientX - centerX);
    cumulative += unwrapAngleDelta(a, lastAngle);
    lastAngle = a;
    let degrees = (cumulative * 180) / Math.PI;
    degrees = snap(degrees, rotationSnap);
    onAngleDelta(degrees);
  };
  const handleUp = (): void => {
    window.removeEventListener("pointermove", handleMove);
    window.removeEventListener("pointerup", handleUp);
    window.removeEventListener("pointercancel", handleUp);
    const swallow = (e: Event): void => {
      e.stopPropagation();
      e.stopImmediatePropagation();
    };
    window.addEventListener("click", swallow, { capture: true, once: true });
    setTimeout(() => window.removeEventListener("click", swallow, true), 0);
    onMouseUp?.();
    onDraggingChanged?.(false);
  };
  window.addEventListener("pointermove", handleMove);
  window.addEventListener("pointerup", handleUp);
  window.addEventListener("pointercancel", handleUp);
}

export function createTransformControls(
  scene: PolySceneHandle,
  options: PolyTransformControlsOptions = {},
): PolyTransformControlsHandle {
  let target: PolyMeshHandle | null = null;
  let mode: Mode = options.mode ?? "translate";
  const size = options.size ?? 1;
  const opts: PolyTransformControlsOptions = { ...options };

  // No standalone wrapper element. The earlier draft appended a
  // wrapper to `scene.host`, but that lives OUTSIDE the camera-
  // transformed scene root (`.polycss-camera` carries the scale +
  // rotateX/rotateY), so the gizmo polygons rendered in screen space
  // and ignored the camera. Going through `scene.add` for each gizmo
  // mesh puts it inside the centerWrapper (camera-space), which is
  // exactly the same coordinate frame the user mesh lives in. Each
  // gizmo mesh is positioned at `target.transform.position` via
  // setTransform — that's the gizmo origin.

  // Per-key tracking. Each gizmo arrow / ring / plane is a polycss
  // PolyMeshHandle added to the scene, then re-parented under our wrapper.
  type GizmoSpec =
    | { kind: "arrow"; key: string; cssAxis: 0 | 1 | 2; sign: 1 | -1; color: string }
    | { kind: "ring"; key: string; cssAxis: 0 | 1 | 2; color: string }
    | { kind: "plane"; key: string; perpAxis: 0 | 1 | 2; axisA: 0 | 1 | 2; axisB: 0 | 1 | 2; color: string };
  type GizmoMesh = { handle: PolyMeshHandle; spec: GizmoSpec };
  const gizmos = new Map<string, GizmoMesh>();
  let hoveredKey: string | null = null;
  let draggingKey: string | null = null;
  // Offset added to `target.transform.position` to place the gizmo at
  // the mesh's visible center under scene-level autoCenter. Cached on
  // attach because it depends only on the target's polygon bbox.
  let centerOffset: Vec3 = [0, 0, 0];

  function gizmoPosition(): Vec3 {
    if (!target) return [0, 0, 0];
    const t = target.transform.position ?? ([0, 0, 0] as Vec3);
    const r = target.transform.rotation ?? ([0, 0, 0] as Vec3);
    const s = typeof target.transform.scale === "number"
      ? target.transform.scale
      : (target.transform.scale?.[0] ?? 1);
    // Visible mesh center under the post-parity wrapper transform
    // `T · R · S · p`: at p = bboxCenter (mesh-local), visible center
    // = T + scale * R(rotation) * bboxCenter. Apply current rotation so
    // the gizmo follows the mesh while it spins — without this, the
    // rotation handler's pivot compensation slides position around to
    // keep the visible center fixed and the gizmo (placed at
    // position + centerOffset) drifts off-axis.
    const rc = rotateVec3(centerOffset, r[0], r[1], r[2]);
    return [t[0] + s * rc[0], t[1] + s * rc[1], t[2] + s * rc[2]];
  }

  function alphaFor(key: string): number {
    if (draggingKey === key) return ALPHA_DRAGGING;
    if (hoveredKey === key) return ALPHA_HOVER;
    return ALPHA_IDLE;
  }

  function rebuildGizmoColors(): void {
    // Re-emit each arrow/ring's polygons with the updated alpha. Cheap
    // — geometry hasn't changed, just the per-polygon color string.
    for (const [key, gm] of gizmos) {
      const polys = buildPolygonsFor(gm.spec, alphaFor(key));
      gm.handle.setPolygons(polys, { recomputeAutoCenter: false });
    }
  }

  function buildPolygonsFor(spec: GizmoSpec, alpha: number): Polygon[] {
    const baseLength = gizmoLengthForMesh(target?.polygons ?? []);
    const shaftLengthCss = baseLength * size;
    const lengthWorld = shaftLengthCss / SCENE_TILE_SIZE;
    const color = withAlpha(spec.color, alpha);
    if (spec.kind === "arrow") {
      // Strip the shaft for back-facing arrows so the visible-only-from-
      // outside silhouette stays clean. Both halves of a pair otherwise
      // share the same shaft volume at the gizmo origin.
      const cameraState = scene.camera.state;
      const backFacing = isAxisBackFacing(
        spec.cssAxis,
        spec.sign,
        cameraState.rotX ?? 65,
        cameraState.rotY ?? 45,
      );
      return arrowPolygons({
        axis: WORLD_AXIS_FOR_CSS[spec.cssAxis],
        sign: spec.sign,
        shaftLength: lengthWorld,
        shaftHalfThickness: lengthWorld * SHAFT_HALF_THICKNESS_RATIO,
        headLength: lengthWorld * HEAD_LENGTH_RATIO,
        headHalfThickness: lengthWorld * HEAD_HALF_THICKNESS_RATIO,
        color,
        shaft: !backFacing,
      });
    }
    if (spec.kind === "plane") {
      // Place the quad in the camera-facing octant: for each in-plane axis,
      // flip the offset sign if the +axis is back-facing. planePolygons
      // works in WORLD axes (a = (perp+1)%3, b = (perp+2)%3); since
      // WORLD_AXIS_FOR_CSS is involutive, the CSS axis we test for back-
      // facing is just WORLD_AXIS_FOR_CSS[worldA / worldB].
      const cameraState = scene.camera.state;
      const rotX = cameraState.rotX ?? 65;
      const rotY = cameraState.rotY ?? 45;
      const worldPerp = WORLD_AXIS_FOR_CSS[spec.perpAxis];
      const worldA = ((worldPerp + 1) % 3) as 0 | 1 | 2;
      const worldB = ((worldPerp + 2) % 3) as 0 | 1 | 2;
      const cssAForOffset = WORLD_AXIS_FOR_CSS[worldA];
      const cssBForOffset = WORLD_AXIS_FOR_CSS[worldB];
      const signA = isAxisBackFacing(cssAForOffset, 1, rotX, rotY) ? -1 : 1;
      const signB = isAxisBackFacing(cssBForOffset, 1, rotX, rotY) ? -1 : 1;
      const mag = lengthWorld * PLANE_OFFSET_RATIO;
      return planePolygons({
        axis: worldPerp,
        size: lengthWorld * PLANE_HALF_SIZE_RATIO,
        offset: [signA * mag, signB * mag],
        color,
      });
    }
    // ring — single square quad masked to a donut via CSS (see
    // .polycss-transform-ring rule in styles.ts). One DOM node per ring
    // instead of N segment quads. Quad outer radius is sized by
    // RING_QUAD_OUTER_RATIO so the hit footprint stays generous even when
    // the visible band (driven by RING_HALF_THICKNESS_RATIO) is thin.
    const radiusWorld = (shaftLengthCss * RING_RADIUS_RATIO) / SCENE_TILE_SIZE;
    const outerWorld = radiusWorld * RING_QUAD_OUTER_RATIO;
    return ringQuadPolygons({
      axis: WORLD_AXIS_FOR_CSS[spec.cssAxis],
      outerRadius: outerWorld,
      color,
    });
  }

  function classPrefixFor(spec: GizmoSpec): string {
    if (spec.kind === "arrow") return "polycss-transform-arrow";
    if (spec.kind === "plane") return "polycss-transform-plane";
    return "polycss-transform-ring";
  }

  /** Resolve the active spec list for the current mode. Translate mode mixes
   *  the 6 axis arrows with the 3 planar handles; rotate mode just rings. */
  function activeSpecs(): GizmoSpec[] {
    if (mode === "translate") {
      const arrows: GizmoSpec[] = ARROW_SPECS.map((a) => ({
        kind: "arrow",
        key: a.key,
        cssAxis: a.cssAxis,
        sign: a.sign,
        color: a.color,
      }));
      const planes: GizmoSpec[] = PLANE_SPECS.map((p) => ({
        kind: "plane",
        key: p.key,
        perpAxis: p.perpAxis,
        axisA: p.axisA,
        axisB: p.axisB,
        color: p.color,
      }));
      return [...arrows, ...planes];
    }
    if (mode === "rotate") {
      return RING_SPECS.map((r) => ({ kind: "ring", key: r.key, cssAxis: r.cssAxis, color: r.color }));
    }
    return [];
  }

  function buildGizmos(): void {
    teardownGizmos();
    if (!target) return;
    const showByKey = {
      x: opts.showX !== false,
      y: opts.showY !== false,
      z: opts.showZ !== false,
    };
    function specVisible(spec: GizmoSpec): boolean {
      if (spec.kind === "arrow") {
        const userAxis = spec.key.replace("-", "")[0] as "x" | "y" | "z";
        return showByKey[userAxis];
      }
      if (spec.kind === "ring") {
        return showByKey[spec.key as "x" | "y" | "z"];
      }
      // Plane handles need BOTH in-plane axes visible.
      const aName = (["x", "y", "z"] as const)[spec.axisA];
      const bName = (["x", "y", "z"] as const)[spec.axisB];
      return showByKey[aName] && showByKey[bName];
    }
    const targetPos = gizmoPosition();
    for (const spec of activeSpecs()) {
      if (!specVisible(spec)) continue;
      const polys = buildPolygonsFor(spec, alphaFor(spec.key));
      // Each gizmo mesh is added directly to the scene at the target's
      // position. scene.add appends to centerWrapper (the camera-
      // transformed scene root), so the arrow inherits the scene's
      // perspective + rotateX/rotateY/scale automatically — no
      // separate wrapper needed.
      const handle = scene.add(
        { polygons: polys, objectUrls: [], warnings: [], dispose: () => {} },
        {
          excludeFromAutoCenter: true,
          id: `__poly-gizmo-${spec.key}`,
          position: targetPos,
        },
      );
      const classPrefix = classPrefixFor(spec);
      handle.element.classList.add(
        "polycss-transform-gizmo",
        classPrefix,
        `${classPrefix}--${spec.key}`,
      );
      if (spec.kind === "ring") {
        // Two CSS vars consumed by the .polycss-transform-ring mask: where
        // the visible band STARTS and ENDS, both as a fraction of the quad
        // edge (50%). The quad's outer radius is RING_QUAD_OUTER_RATIO ·
        // mid-radius, so we normalize the visible inner/outer edges
        // (mid ± halfThickness) against the quad outer to get the mask
        // positions inside the quad.
        const innerRatio = (1 - RING_HALF_THICKNESS_RATIO) / RING_QUAD_OUTER_RATIO;
        const outerRatio = (1 + RING_HALF_THICKNESS_RATIO) / RING_QUAD_OUTER_RATIO;
        handle.element.style.setProperty("--ring-inner-ratio", `${innerRatio}`);
        handle.element.style.setProperty("--ring-outer-ratio", `${outerRatio}`);
      }
      gizmos.set(spec.key, { handle, spec });
    }
  }

  function teardownGizmos(): void {
    for (const { handle } of gizmos.values()) handle.remove();
    gizmos.clear();
    hoveredKey = null;
    draggingKey = null;
  }

  function syncGizmoPositions(): void {
    if (!target) return;
    const pos = gizmoPosition();
    for (const { handle } of gizmos.values()) handle.setTransform({ position: pos });
  }

  function update(): void {
    if (!target) return;
    if (gizmos.size === 0) buildGizmos();
    else syncGizmoPositions();
  }

  function attach(t: PolyMeshHandle | null): void {
    target = t;
    if (!t) {
      centerOffset = [0, 0, 0];
      teardownGizmos();
      return;
    }
    centerOffset = bboxCenterWorld(t.polygons);
    teardownGizmos();
    buildGizmos();
  }

  function detach(): void {
    attach(null);
  }

  function setMode(m: Mode): void {
    if (m === mode) return;
    mode = m;
    if (target) {
      teardownGizmos();
      buildGizmos();
    }
  }

  function applyAxisDelta(spec: { cssAxis: 0 | 1 | 2 }, t: number, axisVec: Vec3): void {
    if (!target) return;
    // Snapshot at drag start lives in the closure passed to
    // startAxisDrag — but applyAxisDelta is called per move with the
    // raw cumulative `t`, so we need to anchor each application to
    // the drag-start position, not the live (already-mutated) one.
    // The dragStartPosition snapshot is captured in the pointerdown
    // handler below.
    if (!dragStartPosition) return;
    // Translate the drag from CSS-pixel CSS-axis space (where the screen
    // probe was measured) to world-unit world-axis space (where
    // `transform.position` lives post-parity). t is CSS px along the
    // visible arrow direction; divide by SCENE_TILE_SIZE for world units.
    // axisVec encodes the ±sign at index cssAxis; the corresponding
    // world axis is WORLD_AXIS_FOR_CSS[cssAxis].
    const sign = axisVec[spec.cssAxis];
    const worldAxis = WORLD_AXIS_FOR_CSS[spec.cssAxis];
    const worldStep = (t * sign) / SCENE_TILE_SIZE;
    const next = dragStartPosition.slice() as Vec3;
    next[worldAxis] = dragStartPosition[worldAxis] + worldStep;
    target.setTransform({ position: next });
    syncGizmoPositions();
    opts.onObjectChange?.({ object: target, position: next });
    opts.onChange?.();
  }
  let dragStartPosition: Vec3 | null = null;

  // Track the start-of-drag rotation snapshot so accumulated deltas
  // are anchored to the rotation at pointerdown rather than the live
  // (already-mutated) rotation each move.
  let dragStartRotation: Vec3 | null = null;

  // Pointerdown listener on the host. Same JS bbox hit-test the React
  // version uses — reliable regardless of CSS pointer-events / border-
  // shape clipping issues.
  const onPointerDown = (event: PointerEvent): void => {
    if (!target || opts.enabled === false) return;
    const showByKey = {
      x: opts.showX !== false,
      y: opts.showY !== false,
      z: opts.showZ !== false,
    };
    if (mode === "translate") {
      // Plane handles are hit-tested FIRST so they win when overlapping with
      // the arrow shafts at the corner.
      for (const spec of PLANE_SPECS) {
        const aName = (["x", "y", "z"] as const)[spec.axisA];
        const bName = (["x", "y", "z"] as const)[spec.axisB];
        if (!showByKey[aName] || !showByKey[bName]) continue;
        const gm = gizmos.get(spec.key);
        if (!gm) continue;
        if (!pointInMeshElement(gm.handle.element, event.clientX, event.clientY)) continue;
        event.preventDefault();
        event.stopPropagation();
        draggingKey = spec.key;
        rebuildGizmoColors();
        dragStartPosition = (target.transform.position ?? [0, 0, 0]).slice() as Vec3;
        startPlaneDrag({
          axisA: spec.axisA,
          axisB: spec.axisB,
          probeDistanceCss: gizmoLengthForMesh(target.polygons) * size,
          wrapper: gm.handle.element,
          target,
          startClientX: event.clientX,
          startClientY: event.clientY,
          translationSnap: opts.translationSnap ?? null,
          onPlaneDelta: (tA, tB, aVec, bVec) => {
            if (!target || !dragStartPosition) return;
            // Same CSS→world translation as applyAxisDelta. aVec/bVec
            // encode the ±sign at index axisA/axisB (CSS-axis order);
            // the world axes to translate along are WORLD_AXIS_FOR_CSS.
            const signA = aVec[spec.axisA];
            const signB = bVec[spec.axisB];
            const worldAxisA = WORLD_AXIS_FOR_CSS[spec.axisA];
            const worldAxisB = WORLD_AXIS_FOR_CSS[spec.axisB];
            const next = dragStartPosition.slice() as Vec3;
            next[worldAxisA] += (tA * signA) / SCENE_TILE_SIZE;
            next[worldAxisB] += (tB * signB) / SCENE_TILE_SIZE;
            target.setTransform({ position: next });
            syncGizmoPositions();
            opts.onObjectChange?.({ object: target, position: next });
            opts.onChange?.();
          },
          onMouseDown: opts.onMouseDown,
          onMouseUp: opts.onMouseUp,
          onDraggingChanged: (d) => {
            if (!d) {
              draggingKey = null;
              dragStartPosition = null;
              rebuildGizmoColors();
            }
            opts.onDraggingChanged?.(d);
          },
        });
        return;
      }
      for (const spec of ARROW_SPECS) {
        const userAxis = spec.key.replace("-", "")[0] as "x" | "y" | "z";
        if (!showByKey[userAxis]) continue;
        const gm = gizmos.get(spec.key);
        if (!gm) continue;
        if (!pointInMeshElement(gm.handle.element, event.clientX, event.clientY)) continue;
        event.preventDefault();
        event.stopPropagation();
        draggingKey = spec.key;
        rebuildGizmoColors();
        // Snapshot the position at drag start so each pointermove
        // applies its cumulative `t` against the same anchor instead
        // of compounding off the live (already-mutated) position.
        dragStartPosition = (target.transform.position ?? [0, 0, 0]).slice() as Vec3;
        startAxisDrag({
          cssAxis: spec.cssAxis,
          sign: spec.sign,
          shaftLengthCss: gizmoLengthForMesh(target.polygons) * size,
          // Use the arrow's own mesh wrapper as the probe target —
          // it's positioned at target.position and lives in the same
          // camera-transformed scene root as the polygons we're
          // dragging, so probe-vs-wrapper bbox math gives px-per-
          // scene-px directly.
          wrapper: gm.handle.element,
          target,
          startClientX: event.clientX,
          startClientY: event.clientY,
          translationSnap: opts.translationSnap ?? null,
          onAxisDelta: (t, axisVec) => applyAxisDelta(spec, t, axisVec),
          onMouseDown: opts.onMouseDown,
          onMouseUp: opts.onMouseUp,
          onDraggingChanged: (d) => {
            if (!d) {
              draggingKey = null;
              dragStartPosition = null;
              rebuildGizmoColors();
            }
            opts.onDraggingChanged?.(d);
          },
        });
        return;
      }
    } else if (mode === "rotate") {
      for (const spec of RING_SPECS) {
        if (!showByKey[spec.key as "x" | "y" | "z"]) continue;
        const gm = gizmos.get(spec.key);
        if (!gm) continue;
        // Plain bbox-containment hit-test. The donut mask is decoration; the
        // entire ring quad bbox is clickable so the rings are easy to land on.
        if (!pointInMeshElement(gm.handle.element, event.clientX, event.clientY)) continue;
        event.preventDefault();
        event.stopPropagation();
        draggingKey = spec.key;
        rebuildGizmoColors();
        dragStartRotation = (target.transform.rotation ?? [0, 0, 0]).slice() as Vec3;
        // Snapshot the position too so the per-tick pivot compensation
        // anchors to the drag-start state (otherwise compounding rounding
        // drift across moves slowly slides the mesh off-pivot).
        dragStartPosition = (target.transform.position ?? [0, 0, 0]).slice() as Vec3;
        startRingDrag({
          cssAxis: spec.cssAxis,
          wrapper: gm.handle.element,
          target,
          startClientX: event.clientX,
          startClientY: event.clientY,
          rotationSnap: opts.rotationSnap ?? null,
          onAngleDelta: (degrees) => {
            if (!target || !dragStartRotation || !dragStartPosition) return;
            // Each ring rotates the mesh around the WORLD axis the ring
            // visually wraps. Ring quads are built with axis =
            // WORLD_AXIS_FOR_CSS[cssAxis] (see `buildPolygonsFor`), so the
            // rotation axis here must match — otherwise the mesh spins
            // around a different axis than the ring the user grabbed.
            const worldAxis = WORLD_AXIS_FOR_CSS[spec.cssAxis];
            const axisVec: Vec3 = [0, 0, 0];
            axisVec[worldAxis] = 1;
            // Negate the screen-derived angle: `startRingDrag` returns a
            // CCW-in-screen-space delta, but the world↔CSS axis swap is a
            // reflection (det -1) so the same screen direction maps to a
            // CW world rotation around the ring's axis. Flip once globally
            // rather than per-axis empirically.
            const deltaRad = (-degrees * Math.PI) / 180;
            const qStart = quatFromEulerXYZ(dragStartRotation);
            const qDelta = quatFromAxisAngle(axisVec, deltaRad);
            const nextRot = eulerXYZFromQuat(quatMultiply(qDelta, qStart));
            // Pivot the mesh around its visible bbox center, not its
            // local origin. Post-parity `<PolyMesh rotation>` pivots at
            // (0,0,0) by design — for callers that haven't pre-centered
            // their geometry (most loaders default to `{ center: "min" }`),
            // raw rotation would swing the mesh around its bbox-min corner.
            // We compensate by re-translating so the world-space point
            // `position + scale * R * bboxCenter` stays put across the drag.
            const scaleVal = typeof target.transform.scale === "number"
              ? target.transform.scale
              : (target.transform.scale?.[0] ?? 1);
            const startC = rotateVec3(
              centerOffset,
              dragStartRotation[0],
              dragStartRotation[1],
              dragStartRotation[2],
            );
            const nextC = rotateVec3(centerOffset, nextRot[0], nextRot[1], nextRot[2]);
            const nextPos: Vec3 = [
              dragStartPosition[0] + scaleVal * (startC[0] - nextC[0]),
              dragStartPosition[1] + scaleVal * (startC[1] - nextC[1]),
              dragStartPosition[2] + scaleVal * (startC[2] - nextC[2]),
            ];
            target.setTransform({ rotation: nextRot, position: nextPos });
            syncGizmoPositions();
            opts.onObjectChange?.({ object: target, rotation: nextRot, position: nextPos });
            opts.onChange?.();
          },
          onMouseDown: opts.onMouseDown,
          onMouseUp: opts.onMouseUp,
          onDraggingChanged: (d) => {
            if (!d) {
              draggingKey = null;
              dragStartRotation = null;
              dragStartPosition = null;
              rebuildGizmoColors();
              // Rebake the atlas now that the rotation is committed. The
              // mesh wrapper's CSS rotation has already been applied via
              // setTransform; rebakeAtlas() inverse-rotates the world light
              // into the mesh's new local frame and re-rasterizes the atlas
              // so baked Lambert shading is correct for the new orientation.
              target?.rebakeAtlas();
            }
            opts.onDraggingChanged?.(d);
          },
        });
        return;
      }
    }
  };
  // Capture-phase so we fire BEFORE createPolyOrbitControls' bubble-phase
  // pointerdown listener on the same host element. If the click hits
  // a gizmo arrow / ring we call stopPropagation, which prevents
  // the orbit/map controls from starting a camera-rotate gesture in parallel.
  // If the click misses every gizmo, we don't stop — PolyControls
  // gets the event during its bubble phase and rotates as usual.
  scene.host.addEventListener("pointerdown", onPointerDown, { capture: true });

  // Hover tracking — listen at the host and figure out which gizmo
  // mesh (if any) is under the cursor. Cheaper than per-element
  // listeners and works regardless of pointer-events quirks.
  const onPointerMove = (event: MouseEvent): void => {
    if (!target || draggingKey || opts.enabled === false) return;
    let next: string | null = null;
    for (const [key, gm] of gizmos) {
      if (pointInMeshElement(gm.handle.element, event.clientX, event.clientY)) {
        next = key;
        break;
      }
    }
    if (next === hoveredKey) return;
    hoveredKey = next;
    rebuildGizmoColors();
  };
  scene.host.addEventListener("pointermove", onPointerMove);

  function destroy(): void {
    scene.host.removeEventListener("pointerdown", onPointerDown, { capture: true });
    scene.host.removeEventListener("pointermove", onPointerMove);
    teardownGizmos();
  }

  return { attach, detach, setMode, update, destroy };
}
