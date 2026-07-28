import {
  cssPositionToWorld,
  createPolyOrthographicCamera,
  createPolyScene,
  queryPolyLeaves,
  type ParseResult,
  type Polygon,
} from "@layoutit/polycss";
import {
  createPolyMorphDeformationRuntime,
  validatePolyMorphModel,
  type PolyMorphApplyResult,
  type PolyMorphModel,
  type PolyMorphVec3,
} from "@layoutit/polycss-morph";

export type PolyMorphPlaneView = "filled" | "outline";
export type PolyMorphPlaneRelease = "keep" | "spring";

export type PolyMorphPlaneDemoSnapshot = {
  readonly ready: true;
  readonly mode: string;
  readonly view: PolyMorphPlaneView;
  readonly release: PolyMorphPlaneRelease;
  readonly profile: string;
  readonly leaves: number;
  readonly dirtyLeafIds: readonly string[];
  readonly patchIds: readonly string[];
  readonly patchValues: Readonly<Record<string, number>>;
  readonly selectedPatchId: string | null;
  readonly springFrames: number;
  readonly camera: {
    readonly rotX: number;
    readonly rotY: number;
    readonly zoom: number;
  };
  readonly identityStable: boolean;
  readonly lastApply: PolyMorphApplyResult;
  readonly forbidden: {
    readonly domCreations: number;
    readonly domRemovals: number;
    readonly topologyConstructions: number;
    readonly atlasRedraws: number;
    readonly schedulerCallbacks: number;
  };
};

export type PolyMorphPlaneDemoController = {
  readonly ready: true;
  randomize(): PolyMorphPlaneDemoSnapshot;
  reset(): PolyMorphPlaneDemoSnapshot;
  setPatch(patchId: string, value: number): PolyMorphPlaneDemoSnapshot;
  setRelease(release: PolyMorphPlaneRelease): PolyMorphPlaneDemoSnapshot;
  setView(view: PolyMorphPlaneView): PolyMorphPlaneDemoSnapshot;
  setZoom(zoom: number): PolyMorphPlaneDemoSnapshot;
  snapshot(): PolyMorphPlaneDemoSnapshot;
  destroy(): void;
};

export type PolyMorphPlaneDemoOptions = {
  readonly resolveResourceUrl?: (path: string) => string;
};

type Patch = {
  readonly id: string;
  readonly liftTargetId: string;
  readonly pressTargetId: string;
  readonly center: PolyMorphVec3;
  readonly leafIds: readonly string[];
};

type ActiveDrag = {
  readonly pointerId: number;
  readonly patchId: string;
  readonly startY: number;
  readonly startValue: number;
};

type ActiveRotation = {
  readonly pointerId: number;
  readonly startX: number;
  readonly startY: number;
  readonly startRotX: number;
  readonly startRotY: number;
};

const INITIAL_ZOOM = 72;
const MIN_ZOOM = 20;
const MAX_ZOOM = 300;

function initialCameraState() {
  return {
    rotX: 45,
    rotY: -8,
    zoom: INITIAL_ZOOM,
    target: [0, 0, 0] as [number, number, number],
  };
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function centroid(
  indices: readonly number[],
  positions: readonly PolyMorphVec3[],
): PolyMorphVec3 {
  const sum = indices.reduce(
    (value, index) => {
      const position = positions[index]!;
      value[0] += position[0];
      value[1] += position[1];
      value[2] += position[2];
      return value;
    },
    [0, 0, 0],
  );
  return [
    sum[0] / indices.length,
    sum[1] / indices.length,
    sum[2] / indices.length,
  ];
}

function distanceSquared(left: PolyMorphVec3, right: PolyMorphVec3): number {
  return (left[0] - right[0]) ** 2
    + (left[1] - right[1]) ** 2
    + (left[2] - right[2]) ** 2;
}

function terrainColor(elevation: number): string {
  const value = clamp(elevation / 110, -1, 1);
  const stops = [
    [-1, [31, 44, 82]],
    [-0.55, [55, 76, 111]],
    [-0.18, [91, 117, 139]],
    [0, [189, 153, 72]],
    [0.3, [215, 181, 86]],
    [0.62, [180, 105, 58]],
    [0.84, [203, 190, 169]],
    [1, [242, 240, 232]],
  ] as const;
  for (let index = 1; index < stops.length; index += 1) {
    const [endValue, endColor] = stops[index]!;
    if (value > endValue) continue;
    const [startValue, startColor] = stops[index - 1]!;
    const progress = (value - startValue) / (endValue - startValue);
    const color = startColor.map((component, colorIndex) =>
      Math.round(component + (endColor[colorIndex]! - component) * progress));
    return `#${color.map((component) => component.toString(16).padStart(2, "0")).join("")}`;
  }
  return "#f2f0e8";
}

function polygonsForPositions(
  model: PolyMorphModel,
  positions: readonly PolyMorphVec3[],
): Polygon[] {
  const leafByPolygon = new Map(
    model.render.leaves.map((leaf) => [leaf.polygonId, leaf.id]),
  );
  return model.topology.polygons.map((polygon) => ({
    vertices: [...polygon.vertexIndices].reverse().map((index) =>
      cssPositionToWorld([...positions[index]!])),
    color: terrainColor(centroid(polygon.vertexIndices, positions)[2]),
    doubleSided: true,
    data: {
      "poly-morph-leaf": leafByPolygon.get(polygon.id) ?? polygon.id,
    },
  }));
}

function parseResult(polygons: Polygon[]): ParseResult {
  return {
    polygons,
    objectUrls: [],
    warnings: [],
    dispose() {},
  };
}

function applyResult(dirtyLeaves: number): PolyMorphApplyResult {
  return {
    modelTransformWrites: 0,
    shapeTransformWrites: 0,
    leafTransformWrites: dirtyLeaves,
    visibilityWrites: 0,
    opacityWrites: 0,
    atlasRowWrites: 0,
    dirtyLeavesVisited: dirtyLeaves,
    domCreations: 0,
    domRemovals: 0,
    topologyConstructions: 0,
    atlasRedraws: 0,
    schedulerCallbacks: 0,
  };
}

function randomHeightmap(positions: readonly PolyMorphVec3[]): number[] {
  const xs = positions.map((position) => position[0]);
  const ys = positions.map((position) => position[1]);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const features = Array.from({ length: 5 }, (_, index) => ({
    x: 0.1 + Math.random() * 0.8,
    y: 0.1 + Math.random() * 0.8,
    spreadX: 0.22 + Math.random() * 0.22,
    spreadY: 0.22 + Math.random() * 0.22,
    height: index < 3
      ? 28 + Math.random() * 42
      : -(12 + Math.random() * 24),
  }));
  const ridgePhase = Math.random() * Math.PI * 2;

  return positions.map((position) => {
    const u = (position[0] - minX) / (maxX - minX);
    const v = (position[1] - minY) / (maxY - minY);
    const broadTerrain = features.reduce((height, feature) => {
      const dx = (u - feature.x) / feature.spreadX;
      const dy = (v - feature.y) / feature.spreadY;
      return height + feature.height * Math.exp(-0.5 * (dx * dx + dy * dy));
    }, 0);
    const ridge = Math.sin((u * 0.8 + v * 0.45) * Math.PI * 2 + ridgePhase) * 7;
    const edgeTaper = Math.pow(
      Math.max(0, Math.sin(Math.PI * u) * Math.sin(Math.PI * v)),
      0.45,
    );
    return clamp((broadTerrain + ridge) * edgeTaper, -42, 88);
  });
}

function patchRows(model: PolyMorphModel): readonly Patch[] {
  if (model.deformation.kind !== "morph-regions") {
    throw new TypeError("The plane fixture requires morph-regions");
  }
  const targetById = new Map(model.deformation.targets.map((target) => [target.id, target]));
  const polygonsByVertex = new Map<number, string[]>();
  for (const polygon of model.topology.polygons) {
    for (const vertexIndex of polygon.vertexIndices) {
      const polygonIds = polygonsByVertex.get(vertexIndex) ?? [];
      polygonIds.push(polygon.id);
      polygonsByVertex.set(vertexIndex, polygonIds);
    }
  }
  const leafByPolygon = new Map(
    model.render.leaves.map((leaf) => [leaf.polygonId, leaf.id]),
  );
  return model.deformation.targets
    .filter((target) => target.id.endsWith("-lift"))
    .map((liftTarget) => {
      const id = liftTarget.id.slice(0, -"-lift".length);
      const pressTargetId = `${id}-press`;
      if (!targetById.has(pressTargetId)) {
        throw new TypeError(`Missing paired target ${pressTargetId}`);
      }
      const strongest = [...liftTarget.deltas].sort((left, right) =>
        Math.hypot(...(right.position ?? [0, 0, 0]))
        - Math.hypot(...(left.position ?? [0, 0, 0])))[0]!;
      const affectedLeafIds = new Set<string>();
      for (const delta of liftTarget.deltas) {
        for (const polygonId of polygonsByVertex.get(delta.vertexIndex) ?? []) {
          const leafId = leafByPolygon.get(polygonId);
          if (leafId) affectedLeafIds.add(leafId);
        }
      }
      return {
        id,
        liftTargetId: liftTarget.id,
        pressTargetId,
        center: model.topology.vertices[strongest.vertexIndex]!,
        leafIds: [...affectedLeafIds],
      };
    });
}

function leafFromPointer(event: PointerEvent): HTMLElement | null {
  return event.composedPath().find((entry) =>
    entry instanceof HTMLElement && entry.dataset.polyMorphLeaf) as HTMLElement | null;
}

export async function mountPolyMorphPlaneDemo(
  root: HTMLElement,
  modelInput: unknown,
  _options: PolyMorphPlaneDemoOptions = {},
): Promise<PolyMorphPlaneDemoController> {
  const model = validatePolyMorphModel(modelInput);

  const host = root.querySelector<HTMLElement>("[data-scene]")!;
  const previous = (root as HTMLElement & {
    __polyMorphDemo?: PolyMorphPlaneDemoController;
  }).__polyMorphDemo;
  previous?.destroy();
  host.replaceChildren();
  const sceneWrap = root.querySelector<HTMLElement>("[data-scene-wrap]")!;
  const sceneLabel = root.querySelector<HTMLElement>("[data-scene-label]")!;
  const dragIndicator = root.querySelector<HTMLElement>("[data-drag-indicator]")!;
  const debug = root.querySelector<HTMLElement>("[data-debug]")!;
  const zoomInput = root.querySelector<HTMLInputElement>("[data-zoom]")!;
  const zoomOutput = root.querySelector<HTMLOutputElement>("[data-zoom-output]")!;
  const readouts = new Map(
    [...root.querySelectorAll<HTMLElement>("[data-readout]")]
      .map((element) => [element.dataset.readout!, element]),
  );

  const scene = createPolyScene(host, {
    camera: createPolyOrthographicCamera(initialCameraState()),
    autoCenter: false,
    seamBleed: 1,
  });
  const mesh = scene.add(
    parseResult(polygonsForPositions(model, model.topology.vertices)),
    {
      id: model.identity.id,
      merge: false,
      stableDom: true,
      excludeFromAutoCenter: true,
    },
  );
  mesh.element.dataset.polyMorphModel = model.identity.id;
  const deformation = createPolyMorphDeformationRuntime(model);
  const patches = patchRows(model);
  const patchById = new Map(patches.map((patch) => [patch.id, patch]));
  const polygonById = new Map(
    model.topology.polygons.map((polygon) => [polygon.id, polygon]),
  );
  const leafById = new Map(model.render.leaves.map((leaf) => [leaf.id, leaf]));
  const leafElements = new Map(
    queryPolyLeaves(mesh.element)
      .map(({ element }) => [element.dataset.polyMorphLeaf!, element] as const),
  );
  const initialLeafElements = [...leafElements.values()];
  const patchValues = new Map<string, number>();
  const randomBaseOffsets = model.topology.vertices.map(() => 0);
  const demoWindow = (() => {
    const value = root.ownerDocument.defaultView;
    if (!value) throw new TypeError("The plane fixture requires a browser window");
    return value;
  })();
  const forbidden = {
    domCreations: 0,
    domRemovals: 0,
    topologyConstructions: 0,
    atlasRedraws: 0,
    schedulerCallbacks: 0,
  };

  let tick = 0;
  let mode = "ready";
  let view: PolyMorphPlaneView = "outline";
  let release: PolyMorphPlaneRelease = "keep";
  let dirtyLeafIds: readonly string[] = [];
  let selectedPatchId: string | null = null;
  let activeDrag: ActiveDrag | null = null;
  let activeRotation: ActiveRotation | null = null;
  let springRequest: number | null = null;
  let springPatchId: string | null = null;
  let springVelocity = 0;
  let springLastTime: number | null = null;
  let springFrames = 0;
  let lastApply = applyResult(0);

  function identityStable(): boolean {
    const current = queryPolyLeaves(mesh.element).map(({ element }) => element);
    return current.length === initialLeafElements.length
      && current.every((element, index) => element === initialLeafElements[index]);
  }

  function snapshot(): PolyMorphPlaneDemoSnapshot {
    return {
      ready: true,
      mode,
      view,
      release,
      profile: model.profile,
      leaves: initialLeafElements.length,
      dirtyLeafIds,
      patchIds: patches.map((patch) => patch.id),
      patchValues: Object.fromEntries(patchValues),
      selectedPatchId,
      springFrames,
      camera: {
        rotX: scene.camera.state.rotX,
        rotY: scene.camera.state.rotY,
        zoom: scene.camera.state.zoom ?? INITIAL_ZOOM,
      },
      identityStable: identityStable(),
      lastApply,
      forbidden: { ...forbidden },
    };
  }

  function updateUi(): PolyMorphPlaneDemoSnapshot {
    const state = snapshot();
    if (readouts.get("mode")) readouts.get("mode")!.textContent = state.mode;
    if (readouts.get("leaves")) readouts.get("leaves")!.textContent = String(state.leaves);
    if (readouts.get("dirty")) readouts.get("dirty")!.textContent = state.dirtyLeafIds.length === 0
      ? "0"
      : `${state.dirtyLeafIds.length} / ${state.leaves}`;
    if (readouts.get("sculpts")) readouts.get("sculpts")!.textContent = String(
      Object.values(state.patchValues).filter((value) => value !== 0).length,
    );
    sceneLabel.textContent = activeRotation
      ? "DRAG TO ORBIT"
      : activeDrag
        ? "DRAG UP / DOWN"
        : springRequest !== null
          ? "SPRINGING BACK"
          : state.mode.toUpperCase();
    zoomInput.value = String(state.camera.zoom);
    zoomOutput.value = `${Math.round((state.camera.zoom / INITIAL_ZOOM) * 100)}%`;
    root.dataset.ready = "true";
    root.dataset.view = state.view;
    root.dataset.release = state.release;
    for (const button of root.querySelectorAll<HTMLButtonElement>("[data-view]")) {
      button.setAttribute("aria-pressed", String(button.dataset.view === state.view));
    }
    for (const button of root.querySelectorAll<HTMLButtonElement>("[data-release]")) {
      button.setAttribute("aria-pressed", String(button.dataset.release === state.release));
    }
    debug.textContent = JSON.stringify({
      profile: state.profile,
      retainedLeaves: state.leaves,
      stableDom: state.identityStable,
      release: state.release,
      camera: state.camera,
      activeRegion: state.selectedPatchId,
      editedRegions: Object.keys(state.patchValues).length,
      dirtyLeaves: state.dirtyLeafIds.length,
      transformWrites: state.lastApply.leafTransformWrites,
      springFrames: state.springFrames,
      forbidden: state.forbidden,
    }, null, 2);
    return state;
  }

  function recordApply(result: PolyMorphApplyResult): void {
    forbidden.domCreations += result.domCreations;
    forbidden.domRemovals += result.domRemovals;
    forbidden.topologyConstructions += result.topologyConstructions;
    forbidden.atlasRedraws += result.atlasRedraws;
    forbidden.schedulerCallbacks += result.schedulerCallbacks;
  }

  function selectPatch(patchId: string | null): void {
    for (const element of leafElements.values()) element.classList.remove("is-selected-region");
    selectedPatchId = patchId;
    if (!patchId) return;
    for (const leafId of patchById.get(patchId)!.leafIds) {
      leafElements.get(leafId)?.classList.add("is-selected-region");
    }
  }

  function applyPatchValues(): void {
    const morphWeights: Record<string, number> = {};
    for (const patch of patches) {
      const value = patchValues.get(patch.id) ?? 0;
      if (value > 0) morphWeights[patch.liftTargetId] = value;
      if (value < 0) morphWeights[patch.pressTargetId] = -value;
    }
    const frame = deformation.sample({ tick, morphWeights });
    tick += 1;
    dirtyLeafIds = frame.dirtyLeafIds;
    const positions = frame.positions.map((position, index) => [
      position[0],
      position[1],
      position[2] + randomBaseOffsets[index]!,
    ] as PolyMorphVec3);
    mesh.setPolygons(polygonsForPositions(model, positions), {
      merge: false,
      stableDom: true,
      recomputeAutoCenter: false,
    });
    lastApply = applyResult(frame.dirtyLeafIds.length);
    forbidden.topologyConstructions += frame.runtimeTopologyConstructions;
    forbidden.atlasRedraws += frame.atlasRedraws;
    recordApply(lastApply);
  }

  function cancelSpring(): void {
    if (springRequest !== null) demoWindow.cancelAnimationFrame(springRequest);
    springRequest = null;
    springPatchId = null;
    springVelocity = 0;
    springLastTime = null;
  }

  function stepSpring(time: number): void {
    if (!springPatchId) return;
    const patchId = springPatchId;
    const deltaSeconds = springLastTime === null
      ? 1 / 60
      : Math.min(0.032, (time - springLastTime) / 1000);
    springLastTime = time;
    const current = patchValues.get(patchId) ?? 0;
    const acceleration = -150 * current - 19 * springVelocity;
    springVelocity += acceleration * deltaSeconds;
    const next = current + springVelocity * deltaSeconds;
    springFrames += 1;
    if (Math.abs(next) < 0.0015 && Math.abs(springVelocity) < 0.012) {
      patchValues.delete(patchId);
      applyPatchValues();
      selectPatch(null);
      springRequest = null;
      springPatchId = null;
      springVelocity = 0;
      springLastTime = null;
      mode = patchValues.size === 0 ? "ready" : "sculpted";
      updateUi();
      return;
    }
    patchValues.set(patchId, clamp(next, -1, 1));
    applyPatchValues();
    mode = "springing";
    updateUi();
    springRequest = demoWindow.requestAnimationFrame(stepSpring);
  }

  function startSpring(patchId: string): void {
    cancelSpring();
    springPatchId = patchId;
    springVelocity = 0;
    springLastTime = null;
    springFrames = 0;
    springRequest = demoWindow.requestAnimationFrame(stepSpring);
  }

  function reset(): PolyMorphPlaneDemoSnapshot {
    cancelSpring();
    deformation.reset();
    patchValues.clear();
    randomBaseOffsets.fill(0);
    selectPatch(null);
    mesh.setPolygons(polygonsForPositions(model, model.topology.vertices), {
      merge: false,
      stableDom: true,
      recomputeAutoCenter: false,
    });
    lastApply = applyResult(model.render.leaves.length);
    scene.camera.update(initialCameraState());
    scene.applyCamera();
    dirtyLeafIds = [];
    springFrames = 0;
    mode = "ready";
    return updateUi();
  }

  function randomize(): PolyMorphPlaneDemoSnapshot {
    cancelSpring();
    deformation.reset();
    patchValues.clear();
    randomBaseOffsets.splice(
      0,
      randomBaseOffsets.length,
      ...randomHeightmap(model.topology.vertices),
    );
    selectPatch(null);
    const positions = model.topology.vertices.map((position, index) => [
      position[0],
      position[1],
      position[2] + randomBaseOffsets[index]!,
    ] as PolyMorphVec3);
    mode = "heightmap";
    mesh.setPolygons(polygonsForPositions(model, positions), {
      merge: false,
      stableDom: true,
      recomputeAutoCenter: false,
    });
    dirtyLeafIds = model.render.leaves.map((leaf) => leaf.id);
    lastApply = applyResult(dirtyLeafIds.length);
    return updateUi();
  }

  function setPatch(patchId: string, value: number): PolyMorphPlaneDemoSnapshot {
    cancelSpring();
    if (!patchById.has(patchId)) throw new TypeError(`Unknown patch ${patchId}`);
    const next = clamp(value, -1, 1);
    if (Math.abs(next) < 0.001) patchValues.delete(patchId);
    else patchValues.set(patchId, next);
    selectPatch(patchId);
    applyPatchValues();
    mode = "sculpted";
    return updateUi();
  }

  function setRelease(nextRelease: PolyMorphPlaneRelease): PolyMorphPlaneDemoSnapshot {
    if (nextRelease !== "keep" && nextRelease !== "spring") {
      throw new TypeError(`Unknown release ${String(nextRelease)}`);
    }
    release = nextRelease;
    return updateUi();
  }

  function setView(nextView: PolyMorphPlaneView): PolyMorphPlaneDemoSnapshot {
    if (nextView !== "filled" && nextView !== "outline") {
      throw new TypeError(`Unknown view ${String(nextView)}`);
    }
    view = nextView;
    return updateUi();
  }

  function setZoom(nextZoom: number): PolyMorphPlaneDemoSnapshot {
    const zoom = clamp(nextZoom, MIN_ZOOM, MAX_ZOOM);
    scene.camera.update({ zoom });
    scene.applyCamera();
    return updateUi();
  }

  function patchForLeaf(leafId: string): Patch {
    const leaf = leafById.get(leafId)!;
    const polygon = polygonById.get(leaf.polygonId)!;
    const center = centroid(polygon.vertexIndices, model.topology.vertices);
    return [...patches].sort((left, right) =>
      distanceSquared(left.center, center) - distanceSquared(right.center, center))[0]!;
  }

  function patchAtPointer(event: PointerEvent): Patch | null {
    const direct = leafFromPointer(event)?.dataset.polyMorphLeaf;
    if (direct) return patchForLeaf(direct);
    const stacked = root.ownerDocument.elementsFromPoint(event.clientX, event.clientY)
      .find((element) => element instanceof HTMLElement && element.dataset.polyMorphLeaf);
    return stacked instanceof HTMLElement && stacked.dataset.polyMorphLeaf
      ? patchForLeaf(stacked.dataset.polyMorphLeaf)
      : null;
  }

  function positionIndicator(event: PointerEvent): void {
    const bounds = sceneWrap.getBoundingClientRect();
    dragIndicator.style.transform = `translate3d(${event.clientX - bounds.left}px, ${event.clientY - bounds.top}px, 0)`;
  }

  function onPointerDown(event: PointerEvent): void {
    if (event.button !== 0) return;
    cancelSpring();
    const patch = patchAtPointer(event);
    if (!patch) {
      selectPatch(null);
      activeRotation = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        startRotX: scene.camera.state.rotX,
        startRotY: scene.camera.state.rotY,
      };
      host.setPointerCapture(event.pointerId);
      root.classList.add("is-rotating");
      mode = "rotating";
      updateUi();
      event.preventDefault();
      return;
    }
    selectPatch(patch.id);
    activeDrag = {
      pointerId: event.pointerId,
      patchId: patch.id,
      startY: event.clientY,
      startValue: patchValues.get(patch.id) ?? 0,
    };
    host.setPointerCapture(event.pointerId);
    root.classList.add("is-dragging");
    positionIndicator(event);
    mode = "dragging";
    updateUi();
    event.preventDefault();
  }

  function onPointerMove(event: PointerEvent): void {
    if (activeRotation?.pointerId === event.pointerId) {
      scene.camera.update({
        rotX: clamp(
          activeRotation.startRotX - (event.clientY - activeRotation.startY) * 0.32,
          -80,
          260,
        ),
        rotY: activeRotation.startRotY - (event.clientX - activeRotation.startX) * 0.36,
      });
      scene.applyCamera();
      updateUi();
      return;
    }
    if (!activeDrag || activeDrag.pointerId !== event.pointerId) return;
    const value = activeDrag.startValue + (activeDrag.startY - event.clientY) / 65;
    const next = clamp(value, -1, 1);
    if (Math.abs(next) < 0.001) patchValues.delete(activeDrag.patchId);
    else patchValues.set(activeDrag.patchId, next);
    applyPatchValues();
    positionIndicator(event);
    updateUi();
  }

  function finishPointer(event: PointerEvent): void {
    if (activeRotation?.pointerId === event.pointerId) {
      if (host.hasPointerCapture(event.pointerId)) host.releasePointerCapture(event.pointerId);
      activeRotation = null;
      root.classList.remove("is-rotating");
      mode = patchValues.size === 0 ? "ready" : "sculpted";
      updateUi();
      return;
    }
    if (!activeDrag || activeDrag.pointerId !== event.pointerId) return;
    const releasedPatchId = activeDrag.patchId;
    if (host.hasPointerCapture(event.pointerId)) host.releasePointerCapture(event.pointerId);
    activeDrag = null;
    root.classList.remove("is-dragging");
    if (release === "spring" && patchValues.has(releasedPatchId)) {
      startSpring(releasedPatchId);
      mode = "springing";
      updateUi();
    } else {
      mode = patchValues.size === 0 ? "ready" : "sculpted";
      updateUi();
    }
  }

  function onViewClick(event: Event): void {
    const button = event.currentTarget as HTMLButtonElement;
    setView(button.dataset.view as PolyMorphPlaneView);
  }

  function onReleaseClick(event: Event): void {
    const button = event.currentTarget as HTMLButtonElement;
    setRelease(button.dataset.release as PolyMorphPlaneRelease);
  }

  function onResetClick(): void {
    reset();
  }

  function onRandomClick(): void {
    randomize();
  }

  function onZoomInput(event: Event): void {
    setZoom(Number((event.currentTarget as HTMLInputElement).value));
  }

  function onZoomOutClick(): void {
    setZoom((scene.camera.state.zoom ?? INITIAL_ZOOM) / 1.12);
  }

  function onZoomInClick(): void {
    setZoom((scene.camera.state.zoom ?? INITIAL_ZOOM) * 1.12);
  }

  function onWheel(event: WheelEvent): void {
    const deltaScale = event.deltaMode === WheelEvent.DOM_DELTA_LINE
      ? 16
      : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
        ? 400
        : 1;
    const currentZoom = scene.camera.state.zoom ?? INITIAL_ZOOM;
    setZoom(currentZoom * Math.exp(-event.deltaY * deltaScale * 0.0012));
    event.preventDefault();
  }

  host.addEventListener("pointerdown", onPointerDown);
  host.addEventListener("pointermove", onPointerMove);
  host.addEventListener("pointerup", finishPointer);
  host.addEventListener("pointercancel", finishPointer);
  host.addEventListener("wheel", onWheel, { passive: false });
  for (const button of root.querySelectorAll<HTMLButtonElement>("[data-view]")) {
    button.addEventListener("click", onViewClick);
  }
  for (const button of root.querySelectorAll<HTMLButtonElement>("[data-release]")) {
    button.addEventListener("click", onReleaseClick);
  }
  root.querySelector<HTMLButtonElement>("[data-action='reset']")!
    .addEventListener("click", onResetClick);
  root.querySelector<HTMLButtonElement>("[data-action='random']")!
    .addEventListener("click", onRandomClick);
  root.querySelector<HTMLButtonElement>("[data-action='zoom-out']")!
    .addEventListener("click", onZoomOutClick);
  root.querySelector<HTMLButtonElement>("[data-action='zoom-in']")!
    .addEventListener("click", onZoomInClick);
  zoomInput.addEventListener("input", onZoomInput);

  updateUi();

  const controller: PolyMorphPlaneDemoController = {
    ready: true,
    randomize,
    reset,
    setPatch,
    setRelease,
    setView,
    setZoom,
    snapshot,
    destroy(): void {
      host.removeEventListener("pointerdown", onPointerDown);
      host.removeEventListener("pointermove", onPointerMove);
      host.removeEventListener("pointerup", finishPointer);
      host.removeEventListener("pointercancel", finishPointer);
      host.removeEventListener("wheel", onWheel);
      for (const button of root.querySelectorAll<HTMLButtonElement>("[data-view]")) {
        button.removeEventListener("click", onViewClick);
      }
      for (const button of root.querySelectorAll<HTMLButtonElement>("[data-release]")) {
        button.removeEventListener("click", onReleaseClick);
      }
      root.querySelector<HTMLButtonElement>("[data-action='reset']")!
        .removeEventListener("click", onResetClick);
      root.querySelector<HTMLButtonElement>("[data-action='random']")!
        .removeEventListener("click", onRandomClick);
      root.querySelector<HTMLButtonElement>("[data-action='zoom-out']")!
        .removeEventListener("click", onZoomOutClick);
      root.querySelector<HTMLButtonElement>("[data-action='zoom-in']")!
        .removeEventListener("click", onZoomInClick);
      zoomInput.removeEventListener("input", onZoomInput);
      cancelSpring();
      root.classList.remove("is-dragging", "is-rotating");
      const ownedRoot = root as HTMLElement & {
        __polyMorphDemo?: PolyMorphPlaneDemoController;
      };
      if (ownedRoot.__polyMorphDemo === controller) {
        delete ownedRoot.__polyMorphDemo;
      }
      scene.destroy();
    },
  };
  (root as HTMLElement & {
    __polyMorphDemo?: PolyMorphPlaneDemoController;
  }).__polyMorphDemo = controller;
  return controller;
}
