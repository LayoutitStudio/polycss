import {
  createPolyPerspectiveCamera,
  formatMatrix3dValues,
} from "@layoutit/polycss";
import {
  createPolyMorphDeformationRuntime,
  mountPolyMorphModel,
  validatePolyMorphModel,
  type PolyMorphMat4,
  type PolyMorphModel,
  type PolyMorphVec3,
} from "@layoutit/polycss-morph";
import solidTriangleFallbackUrl from "./assets/package/assets/solid-triangle.png?url";

export interface MorphTargetsSphereDemoController {
  readonly leaves: number;
  readonly points: number;
  readonly playing: boolean;
  setPlaying(playing: boolean): void;
  toggle(): void;
  destroy(): void;
}

const RED_LIGHT = normalize([1, 1, 1]);
const GREEN_LIGHT = normalize([-1, -1, -1]);

function clamp(value: number, minimum = 0, maximum = 1): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function normalize(value: PolyMorphVec3): PolyMorphVec3 {
  const length = Math.hypot(...value) || 1;
  return [value[0] / length, value[1] / length, value[2] / length];
}

function dot(left: PolyMorphVec3, right: PolyMorphVec3): number {
  return left[0] * right[0] + left[1] * right[1] + left[2] * right[2];
}

function matrixText(value: PolyMorphMat4): string {
  return `matrix3d(${formatMatrix3dValues(value)})`;
}

function shadeLeaves(
  model: PolyMorphModel,
  mounted: ReturnType<typeof mountPolyMorphModel>,
): void {
  const polygons = new Map(
    model.topology.polygons.map((polygon) => [polygon.id, polygon]),
  );
  for (const handle of mounted.leafHandles.values()) {
    const polygon = polygons.get(handle.plan.polygonId)!;
    const normal = normalize(polygon.normalIndices.reduce<PolyMorphVec3>(
      (sum, index) => {
        const value = model.topology.normals[index]!;
        return [sum[0] + value[0], sum[1] + value[1], sum[2] + value[2]];
      },
      [0, 0, 0],
    ));
    const red = Math.max(0, dot(normal, RED_LIGHT));
    const green = Math.max(0, dot(normal, GREEN_LIGHT));
    const r = Math.round(clamp(0.055 + red * 0.94 + green * 0.035) * 255);
    const g = Math.round(clamp(0.04 + green * 0.48 + red * 0.045) * 255);
    const b = Math.round(clamp(0.025 + red * 0.035 + green * 0.02) * 255);
    handle.element.style.color = `rgb(${r} ${g} ${b})`;
  }
}

function configureBlobAnimation(
  model: PolyMorphModel,
  mounted: ReturnType<typeof mountPolyMorphModel>,
): void {
  const runtime = createPolyMorphDeformationRuntime(model);
  const frame = runtime.sample({
    tick: 0,
    morphWeights: { blob: 1 },
  });
  const endMatrixByLeaf = new Map(
    frame.leafUpdates
      .filter((update) => update.matrix)
      .map((update) => [update.leafId, update.matrix!]),
  );

  for (const handle of mounted.leafHandles.values()) {
    handle.element.style.setProperty(
      "--morph-sphere-from",
      handle.element.style.transform,
    );
    handle.element.style.setProperty(
      "--morph-sphere-to",
      matrixText(endMatrixByLeaf.get(handle.id) ?? handle.plan.matrix),
    );
  }
  for (const handle of mounted.leafHandles.values()) {
    handle.element.dataset.morphSphereLeaf = "";
  }
}

function createPointShell(
  model: PolyMorphModel,
  modelElement: HTMLElement,
): HTMLElement {
  const shell = modelElement.ownerDocument.createElement("div");
  shell.className = "morph-sphere-points";
  shell.setAttribute("aria-hidden", "true");
  const fragment = modelElement.ownerDocument.createDocumentFragment();
  for (const [index, [x, y, z]] of model.topology.vertices.entries()) {
    const point = modelElement.ownerDocument.createElement("span");
    point.className = "morph-sphere-point";
    point.dataset.morphSpherePoint = String(index);
    point.style.transform = `translate3d(${x}px, ${y}px, ${z}px)`;
    fragment.appendChild(point);
  }
  shell.appendChild(fragment);
  modelElement.appendChild(shell);
  return shell;
}

export function mountMorphTargetsSphereDemo(
  root: HTMLElement,
  modelInput: unknown,
): MorphTargetsSphereDemoController {
  const host = root.querySelector<HTMLElement>("[data-cube-sphere-scene]")!;
  const action = root.querySelector<HTMLButtonElement>("[data-morph-action]")!;
  const state = root.querySelector<HTMLElement>("[data-morph-state]")!;
  const output = root.querySelector<HTMLOutputElement>("[data-morph-output]")!;
  const leafCount = root.querySelector<HTMLElement>("[data-leaf-count]")!;
  const pointCount = root.querySelector<HTMLElement>("[data-point-count]")!;
  const model = validatePolyMorphModel(modelInput);
  if (
    model.deformation.kind !== "morph-regions"
    || !model.deformation.targets.some((target) => target.id === "blob")
  ) {
    throw new TypeError("Animated Morph Sphere requires the prepared blob target");
  }

  const initialZoom = clamp(host.clientHeight * 0.082, 44, 76);
  const camera = createPolyPerspectiveCamera({
    perspective: 1_100,
    distance: 180,
    rotX: 18,
    rotY: -18,
    zoom: initialZoom,
    target: [0, 0, 0],
  });
  const mounted = mountPolyMorphModel(host, model, {
    camera,
    resolveResourceUrl: (path) => {
      if (path === "assets/solid-triangle.png") return solidTriangleFallbackUrl;
      throw new TypeError(`Unknown Animated Morph Sphere resource: ${path}`);
    },
  });
  mounted.modelElement.dataset.morphSphereSpin = "";
  shadeLeaves(model, mounted);
  configureBlobAnimation(model, mounted);
  const pointShell = createPointShell(model, mounted.modelElement);
  const win = root.ownerDocument.defaultView!;
  let playing = true;
  let activePointer: {
    readonly id: number;
    readonly x: number;
    readonly y: number;
    readonly rotX: number;
    readonly rotY: number;
  } | null = null;

  leafCount.textContent = String(mounted.stats.leafCount);
  pointCount.textContent = String(model.topology.vertices.length);

  function updateUi(): void {
    root.dataset.playing = String(playing);
    root.classList.toggle("is-paused", !playing);
    state.textContent = "SPHERE ↔ BLOB";
    output.value = playing ? "AUTO" : "PAUSED";
    action.textContent = playing ? "Pause" : "Play";
    action.setAttribute("aria-pressed", String(!playing));
  }

  function setPlaying(next: boolean): void {
    playing = next;
    updateUi();
  }

  function toggle(): void {
    setPlaying(!playing);
  }

  function onPointerDown(event: PointerEvent): void {
    if (event.button !== 0) return;
    activePointer = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      rotX: camera.state.rotX,
      rotY: camera.state.rotY,
    };
    host.setPointerCapture(event.pointerId);
    root.classList.add("is-rotating");
    event.preventDefault();
  }

  function onPointerMove(event: PointerEvent): void {
    if (!activePointer || activePointer.id !== event.pointerId) return;
    camera.update({
      rotX: clamp(
        activePointer.rotX - (event.clientY - activePointer.y) * 0.28,
        -80,
        80,
      ),
      rotY: activePointer.rotY - (event.clientX - activePointer.x) * 0.34,
    });
    mounted.updateCamera();
  }

  function onPointerEnd(event: PointerEvent): void {
    if (!activePointer || activePointer.id !== event.pointerId) return;
    if (host.hasPointerCapture(event.pointerId)) host.releasePointerCapture(event.pointerId);
    activePointer = null;
    root.classList.remove("is-rotating");
  }

  function onWheel(event: WheelEvent): void {
    camera.update({
      zoom: clamp(
        camera.state.zoom * Math.exp(-event.deltaY * 0.0012),
        24,
        120,
      ),
    });
    mounted.updateCamera();
    event.preventDefault();
  }

  action.addEventListener("click", toggle);
  host.addEventListener("pointerdown", onPointerDown);
  host.addEventListener("pointermove", onPointerMove);
  host.addEventListener("pointerup", onPointerEnd);
  host.addEventListener("pointercancel", onPointerEnd);
  host.addEventListener("wheel", onWheel, { passive: false });
  updateUi();

  return {
    leaves: mounted.stats.leafCount,
    points: model.topology.vertices.length,
    get playing() {
      return playing;
    },
    setPlaying,
    toggle,
    destroy(): void {
      action.removeEventListener("click", toggle);
      host.removeEventListener("pointerdown", onPointerDown);
      host.removeEventListener("pointermove", onPointerMove);
      host.removeEventListener("pointerup", onPointerEnd);
      host.removeEventListener("pointercancel", onPointerEnd);
      host.removeEventListener("wheel", onWheel);
      pointShell.remove();
      mounted.destroy();
      delete root.dataset.playing;
    },
  };
}
