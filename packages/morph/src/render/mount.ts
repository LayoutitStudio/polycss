import {
  buildPolyCameraSceneTransform,
  capturePolyCameraSnapshot,
  createPolyCamera,
  formatMatrix3dValues,
  injectPolyBaseStyles,
  isSolidTriangleSupported,
} from "@layoutit/polycss";
import {
  validatePolyMorphModel,
  type PolyMorphAtlasSlice,
  type PolyMorphMat4,
  type PolyMorphRenderLeaf,
} from "../contracts/index.js";
import { PolyMorphRenderError } from "./renderError.js";
import type {
  PolyMorphApplyResult,
  PolyMorphLeafHandle,
  PolyMorphLeafUpdate,
  PolyMorphMountedModel,
  PolyMorphMountOptions,
  PolyMorphRetainedUpdate,
  PolyMorphShapeUpdate,
} from "./types.js";

const TAG_BY_STRATEGY = {
  "atlas-slice": "s",
  "direct-image": "s",
  "solid-quad": "b",
  "solid-triangle": "u",
} as const;

function fail(code: string, path: string, message: string): never {
  throw new PolyMorphRenderError(code, path, message);
}

function matrix(value: unknown, path: string): PolyMorphMat4 {
  if (
    !Array.isArray(value)
    || value.length !== 16
    || value.some((entry) => typeof entry !== "number" || !Number.isFinite(entry))
  ) {
    fail("invalid-matrix", path, "expected sixteen finite components");
  }
  return value as unknown as PolyMorphMat4;
}

function matrixText(value: PolyMorphMat4): string {
  return `matrix3d(${formatMatrix3dValues(value)})`;
}

function multiply(left: PolyMorphMat4, right: PolyMorphMat4): PolyMorphMat4 {
  const output = new Array<number>(16).fill(0);
  for (let column = 0; column < 4; column += 1) {
    for (let row = 0; row < 4; row += 1) {
      let sum = 0;
      for (let axis = 0; axis < 4; axis += 1) {
        sum += left[axis * 4 + row]! * right[column * 4 + axis]!;
      }
      output[column * 4 + row] = Object.is(sum, -0) ? 0 : sum;
    }
  }
  return output as unknown as PolyMorphMat4;
}

function resolvedLeafMatrix(
  leaf: PolyMorphRenderLeaf,
  value: PolyMorphMat4,
  useFallback: boolean,
): PolyMorphMat4 {
  return useFallback && leaf.fallback
    ? multiply(value, leaf.fallback.matrixFromLeaf)
    : value;
}

function colorText(color: readonly [number, number, number, number]): string {
  const [red, green, blue, alpha] = color;
  return `rgba(${Math.round(red * 255)}, ${Math.round(green * 255)}, ${Math.round(blue * 255)}, ${alpha})`;
}

function exactKeys(
  value: unknown,
  path: string,
  required: readonly string[],
  optional: readonly string[] = [],
): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("invalid-update", path, "expected an object");
  }
  const allowed = new Set([...required, ...optional]);
  const keys = Object.keys(value);
  if (required.some((key) => !keys.includes(key)) || keys.some((key) => !allowed.has(key))) {
    fail("invalid-update", path, `allowed keys are ${[...allowed].sort().join(", ")}`);
  }
  return value as Record<string, unknown>;
}

function orderedUnique(values: readonly string[], path: string): void {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) fail("duplicate-update", path, value);
    seen.add(value);
  }
}

function validateShapeUpdate(value: unknown, path: string): PolyMorphShapeUpdate {
  const input = exactKeys(value, path, ["matrix", "shapeId"]);
  if (typeof input.shapeId !== "string") fail("invalid-update", `${path}.shapeId`, "expected a string");
  return {
    shapeId: input.shapeId,
    matrix: matrix(input.matrix, `${path}.matrix`),
  };
}

function validateLeafUpdate(value: unknown, path: string): PolyMorphLeafUpdate {
  const input = exactKeys(value, path, ["leafId"], ["atlasRow", "matrix", "opacity", "visible"]);
  if (typeof input.leafId !== "string") fail("invalid-update", `${path}.leafId`, "expected a string");
  const result: {
    leafId: string;
    matrix?: PolyMorphMat4;
    visible?: boolean;
    opacity?: number;
    atlasRow?: number;
  } = { leafId: input.leafId };
  if (input.matrix !== undefined) result.matrix = matrix(input.matrix, `${path}.matrix`);
  if (input.visible !== undefined) {
    if (typeof input.visible !== "boolean") {
      fail("invalid-update", `${path}.visible`, "expected a boolean");
    }
    result.visible = input.visible;
  }
  if (input.opacity !== undefined) {
    if (
      typeof input.opacity !== "number"
      || !Number.isFinite(input.opacity)
      || input.opacity < 0
      || input.opacity > 1
    ) {
      fail("invalid-update", `${path}.opacity`, "expected 0 <= opacity <= 1");
    }
    result.opacity = input.opacity;
  }
  if (input.atlasRow !== undefined) {
    if (!Number.isSafeInteger(input.atlasRow) || (input.atlasRow as number) < 0) {
      fail("invalid-update", `${path}.atlasRow`, "expected a non-negative integer");
    }
    result.atlasRow = input.atlasRow as number;
  }
  return result;
}

function validateUpdate(value: unknown): PolyMorphRetainedUpdate {
  const input = exactKeys(value, "$", [], ["leaves", "modelMatrix", "shapes"]);
  const shapes = input.shapes === undefined
    ? undefined
    : (() => {
      if (!Array.isArray(input.shapes)) fail("invalid-update", "$.shapes", "expected an array");
      const result = input.shapes.map((entry, index) =>
        validateShapeUpdate(entry, `$.shapes[${index}]`));
      orderedUnique(result.map((entry) => entry.shapeId), "$.shapes");
      return result;
    })();
  const leaves = input.leaves === undefined
    ? undefined
    : (() => {
      if (!Array.isArray(input.leaves)) fail("invalid-update", "$.leaves", "expected an array");
      const result = input.leaves.map((entry, index) =>
        validateLeafUpdate(entry, `$.leaves[${index}]`));
      orderedUnique(result.map((entry) => entry.leafId), "$.leaves");
      return result;
    })();
  return {
    ...(input.modelMatrix === undefined
      ? {}
      : { modelMatrix: matrix(input.modelMatrix, "$.modelMatrix") }),
    ...(shapes === undefined ? {} : { shapes }),
    ...(leaves === undefined ? {} : { leaves }),
  };
}

function applyAtlasPaint(
  element: HTMLElement,
  leaf: PolyMorphRenderLeaf,
  atlas: PolyMorphAtlasSlice,
  resourceUrl: string,
): void {
  element.style.setProperty("--polycss-atlas-width", `${leaf.width}px`);
  element.style.setProperty("--polycss-atlas-height", `${leaf.height}px`);
  element.style.backgroundImage = `url("${resourceUrl.replace(/"/gu, "%22")}")`;
  element.style.backgroundPosition = `${-atlas.x}px ${-atlas.y}px`;
  element.style.backgroundSize = `${atlas.pageWidth}px ${atlas.pageHeight}px`;
}

function applySolidTriangleFallbackPaint(
  element: HTMLElement,
  atlas: PolyMorphAtlasSlice,
  width: number,
  height: number,
  resourceUrl: string,
): void {
  const image = `url("${resourceUrl.replace(/"/gu, "%22")}")`;
  const position = `${-atlas.x}px ${-atlas.y}px`;
  const size = `${atlas.pageWidth}px ${atlas.pageHeight}px`;
  element.style.width = `${width}px`;
  element.style.height = `${height}px`;
  element.style.backgroundColor = "currentColor";
  element.style.setProperty("mask-image", image);
  element.style.setProperty("mask-mode", "alpha");
  element.style.setProperty("mask-position", position);
  element.style.setProperty("mask-repeat", "no-repeat");
  element.style.setProperty("mask-size", size);
  element.style.setProperty("-webkit-mask-image", image);
  element.style.setProperty("-webkit-mask-position", position);
  element.style.setProperty("-webkit-mask-repeat", "no-repeat");
  element.style.setProperty("-webkit-mask-size", size);
}

function createLeaf(
  doc: Document,
  leaf: PolyMorphRenderLeaf,
  materialColor: readonly [number, number, number, number],
  resolveVerifiedImageUrl: (path: string, errorPath: string) => string,
  useSolidTriangleFallback: boolean,
): HTMLElement {
  const fallback = useSolidTriangleFallback ? leaf.fallback : null;
  const element = doc.createElement(
    fallback ? "s" : TAG_BY_STRATEGY[leaf.strategy],
  );
  element.className = "polycss-morph-leaf";
  element.dataset.polyMorphLeaf = leaf.id;
  element.dataset.polyMorphStrategy = leaf.strategy;
  element.dataset.polyMorphResolvedStrategy = fallback
    ? "atlas-slice"
    : leaf.strategy;
  element.style.transform = matrixText(
    resolvedLeafMatrix(leaf, leaf.matrix, fallback !== null),
  );
  element.style.color = colorText(materialColor);
  element.style.backfaceVisibility = "visible";
  element.style.backgroundRepeat = "no-repeat";
  element.style.opacity = "1";
  element.style.transformOrigin = "0 0";
  element.style.visibility = "visible";
  if (leaf.atlas) {
    element.style.width = `${leaf.width}px`;
    element.style.height = `${leaf.height}px`;
    applyAtlasPaint(
      element,
      leaf,
      leaf.atlas,
      resolveVerifiedImageUrl(leaf.atlas.resourcePath, leaf.id),
    );
  } else if (fallback) {
    applySolidTriangleFallbackPaint(
      element,
      fallback.atlas,
      fallback.width,
      fallback.height,
      resolveVerifiedImageUrl(fallback.atlas.resourcePath, leaf.id),
    );
  } else if (leaf.strategy === "solid-quad") {
    element.style.width = `${leaf.width}px`;
    element.style.height = `${leaf.height}px`;
  }
  return element;
}

export function mountPolyMorphModel(
  host: HTMLElement,
  modelInput: unknown,
  options: PolyMorphMountOptions = {},
): PolyMorphMountedModel {
  if (!host || typeof host.appendChild !== "function" || !host.ownerDocument) {
    fail("invalid-host", "$.host", "expected an HTMLElement");
  }
  const model = validatePolyMorphModel(modelInput);
  const doc = host.ownerDocument;
  const useSolidTriangleFallback = model.render.leaves.some(
    (leaf) => leaf.strategy === "solid-triangle",
  ) && !isSolidTriangleSupported(doc);
  const resourceUrls = new Map<string, string>();
  const objectUrlApi = typeof doc.defaultView?.URL?.createObjectURL === "function"
    ? doc.defaultView.URL
    : globalThis.URL;
  const blobConstructor = doc.defaultView?.Blob ?? globalThis.Blob;
  const releaseResourceUrls = (): void => {
    for (const url of resourceUrls.values()) objectUrlApi.revokeObjectURL(url);
    resourceUrls.clear();
  };
  const resolveVerifiedImageUrl = (path: string, errorPath: string): string => {
    const cached = resourceUrls.get(path);
    if (cached) return cached;
    const resource = options.resources?.get(path);
    if (
      !resource
      || resource.descriptor.path !== path
      || resource.descriptor.role !== "image"
    ) {
      fail(
        "missing-resource",
        errorPath,
        "image-backed leaves require their verified package resource",
      );
    }
    if (
      typeof objectUrlApi?.createObjectURL !== "function"
      || typeof objectUrlApi?.revokeObjectURL !== "function"
      || typeof blobConstructor !== "function"
    ) {
      fail(
        "missing-object-url",
        errorPath,
        "this browser cannot mount verified image bytes",
      );
    }
    const bytes = resource.bytes.slice();
    const resolved = objectUrlApi.createObjectURL(new blobConstructor(
      [bytes.buffer],
      { type: resource.descriptor.mediaType },
    ));
    resourceUrls.set(path, resolved);
    return resolved;
  };
  try {
    for (const leaf of model.render.leaves) {
      if (leaf.atlas) {
        resolveVerifiedImageUrl(leaf.atlas.resourcePath, leaf.id);
      }
      if (useSolidTriangleFallback && leaf.strategy === "solid-triangle") {
        if (!leaf.fallback) {
          fail(
            "missing-solid-triangle-fallback",
            `${leaf.id}.fallback`,
            "this browser requires a prepared per-polygon atlas slice",
          );
        }
        resolveVerifiedImageUrl(leaf.fallback.atlas.resourcePath, leaf.id);
      }
    }
  } catch (error) {
    releaseResourceUrls();
    throw error;
  }
  injectPolyBaseStyles(doc);
  const computed = doc.defaultView?.getComputedStyle(host);
  const initialHostPosition = host.style.position;
  let changedHostPosition = false;
  if (!computed || computed.position === "static" || computed.position === "") {
    host.style.position = "relative";
    changedHostPosition = true;
  }
  const camera = options.camera ?? createPolyCamera({ zoom: 1 });
  const cameraElement = doc.createElement("div");
  cameraElement.className = "polycss-camera polycss-morph-camera";
  const cameraSnapshot = capturePolyCameraSnapshot(camera);
  cameraElement.style.perspective = cameraSnapshot.appliedPerspectiveStyle;
  cameraElement.dataset.polycssCameraProjection = cameraSnapshot.projection;
  host.appendChild(cameraElement);

  const sceneElement = doc.createElement("div");
  sceneElement.className = "polycss-scene polycss-morph-scene";
  sceneElement.setAttribute("aria-hidden", "true");
  const initialCameraTransform = buildPolyCameraSceneTransform(camera.state);
  sceneElement.style.transform = initialCameraTransform;
  cameraElement.appendChild(sceneElement);

  const modelElement = doc.createElement("div");
  modelElement.className = "polycss-mesh polycss-morph-model";
  modelElement.dataset.polyMorphModel = model.identity.id;
  let modelTransform = matrixText(model.render.modelMatrix);
  modelElement.style.transform = modelTransform;
  sceneElement.appendChild(modelElement);

  const shapeElements = new Map<string, HTMLElement>();
  const shapeTransforms = new Map<string, string>();
  for (const shape of model.render.shapes) {
    const element = doc.createElement("div");
    element.className = "polycss-mesh polycss-morph-shape";
    element.dataset.polyMorphShape = shape.id;
    const transform = matrixText(shape.matrix);
    element.style.transform = transform;
    modelElement.appendChild(element);
    shapeElements.set(shape.id, element);
    shapeTransforms.set(shape.id, transform);
  }

  const materialById = new Map(model.materials.map((material) => [material.id, material]));
  const leafHandles = new Map<string, PolyMorphLeafHandle>();
  const leafStates = new Map<string, {
    transform: string;
    visible: boolean;
    opacity: number;
    atlasRow: number;
  }>();
  for (const leaf of model.render.leaves) {
    const shapeElement = shapeElements.get(leaf.shapeId);
    const material = materialById.get(leaf.materialId);
    if (!shapeElement || !material) {
      fail("mount-coverage", leaf.id, "leaf references are incomplete");
    }
    const element = createLeaf(
      doc,
      leaf,
      material.color,
      resolveVerifiedImageUrl,
      useSolidTriangleFallback && leaf.strategy === "solid-triangle",
    );
    shapeElement.appendChild(element);
    leafHandles.set(leaf.id, { id: leaf.id, plan: leaf, element });
    leafStates.set(leaf.id, {
      transform: matrixText(resolvedLeafMatrix(
        leaf,
        leaf.matrix,
        useSolidTriangleFallback && leaf.strategy === "solid-triangle",
      )),
      visible: true,
      opacity: 1,
      atlasRow: 0,
    });
  }

  const stableShapes = [...shapeElements.entries()];
  const stableLeaves = [...leafHandles.entries()];
  let destroyed = false;
  let cameraTransform = initialCameraTransform;
  const counters = {
    applyCount: 0,
    totalTransformWrites: 0,
    totalVisibilityWrites: 0,
    totalOpacityWrites: 0,
    totalAtlasRowWrites: 0,
  };

  const assertActive = (): void => {
    if (destroyed) fail("destroyed", "$", "mounted model is destroyed");
  };

  const assertStableDomIdentity = (): void => {
    assertActive();
    if (shapeElements.size !== stableShapes.length || leafHandles.size !== stableLeaves.length) {
      fail("identity-drift", "$", "retained handle maps changed");
    }
    for (const [id, element] of stableShapes) {
      if (shapeElements.get(id) !== element || element.parentElement !== modelElement) {
        fail("identity-drift", id, "shape element identity changed");
      }
    }
    for (const [id, handle] of stableLeaves) {
      const shape = shapeElements.get(handle.plan.shapeId);
      if (leafHandles.get(id) !== handle || handle.element.parentElement !== shape) {
        fail("identity-drift", id, "leaf element identity changed");
      }
    }
  };

  const apply = (updateInput: PolyMorphRetainedUpdate): PolyMorphApplyResult => {
    assertActive();
    const update = validateUpdate(updateInput);
    const resolvedShapes = (update.shapes ?? []).map((shape) => {
      const element = shapeElements.get(shape.shapeId);
      if (!element) fail("unknown-shape", shape.shapeId, "no retained shape handle");
      return { shape, element };
    });
    const resolvedLeaves = (update.leaves ?? []).map((leaf) => {
      const handle = leafHandles.get(leaf.leafId);
      const state = leafStates.get(leaf.leafId);
      if (!handle || !state) {
        fail("unknown-leaf", leaf.leafId, "no retained leaf handle");
      }
      let atlasPosition: string | undefined;
      if (leaf.atlasRow !== undefined) {
        const atlas = handle.plan.atlas;
        if (!atlas) fail("invalid-atlas-row", leaf.leafId, "leaf has no image rows");
        const y = atlas.y + leaf.atlasRow * atlas.height;
        if (y + atlas.height > atlas.pageHeight) {
          fail("invalid-atlas-row", leaf.leafId, "row exceeds the image page");
        }
        atlasPosition = `${-atlas.x}px ${-y}px`;
      }
      return { leaf, handle, state, atlasPosition };
    });
    assertStableDomIdentity();
    let modelTransformWrites = 0;
    let shapeTransformWrites = 0;
    let leafTransformWrites = 0;
    let visibilityWrites = 0;
    let opacityWrites = 0;
    let atlasRowWrites = 0;
    if (update.modelMatrix) {
      const next = matrixText(update.modelMatrix);
      if (modelTransform !== next) {
        modelTransform = next;
        modelElement.style.transform = next;
        modelTransformWrites += 1;
      }
    }
    for (const { shape, element } of resolvedShapes) {
      const next = matrixText(shape.matrix);
      if (shapeTransforms.get(shape.shapeId) !== next) {
        shapeTransforms.set(shape.shapeId, next);
        element.style.transform = next;
        shapeTransformWrites += 1;
      }
    }
    for (const { leaf, handle, state, atlasPosition } of resolvedLeaves) {
      if (leaf.matrix) {
        const next = matrixText(resolvedLeafMatrix(
          handle.plan,
          leaf.matrix,
          useSolidTriangleFallback && handle.plan.strategy === "solid-triangle",
        ));
        if (state.transform !== next) {
          state.transform = next;
          handle.element.style.transform = next;
          leafTransformWrites += 1;
        }
      }
      if (leaf.visible !== undefined) {
        const next = leaf.visible ? "visible" : "hidden";
        if (state.visible !== leaf.visible) {
          state.visible = leaf.visible;
          handle.element.style.visibility = next;
          visibilityWrites += 1;
        }
      }
      if (leaf.opacity !== undefined) {
        const next = String(leaf.opacity);
        if (state.opacity !== leaf.opacity) {
          state.opacity = leaf.opacity;
          handle.element.style.opacity = next;
          opacityWrites += 1;
        }
      }
      if (leaf.atlasRow !== undefined) {
        if (state.atlasRow !== leaf.atlasRow) {
          state.atlasRow = leaf.atlasRow;
          handle.element.style.backgroundPosition = atlasPosition!;
          atlasRowWrites += 1;
        }
      }
    }
    assertStableDomIdentity();
    counters.applyCount += 1;
    counters.totalTransformWrites += modelTransformWrites + shapeTransformWrites + leafTransformWrites;
    counters.totalVisibilityWrites += visibilityWrites;
    counters.totalOpacityWrites += opacityWrites;
    counters.totalAtlasRowWrites += atlasRowWrites;
    return {
      modelTransformWrites,
      shapeTransformWrites,
      leafTransformWrites,
      visibilityWrites,
      opacityWrites,
      atlasRowWrites,
      dirtyLeavesVisited: update.leaves?.length ?? 0,
      domCreations: 0,
      domRemovals: 0,
      topologyConstructions: 0,
      atlasRedraws: 0,
      schedulerCallbacks: 0,
    };
  };

  const mounted: PolyMorphMountedModel = {
    model,
    camera,
    cameraElement,
    sceneElement,
    modelElement,
    shapeElements,
    leafHandles,
    get stats() {
      return {
        mountCount: 1 as const,
        shapeRoots: shapeElements.size,
        leafCount: leafHandles.size,
        topologyConstructions: 1 as const,
        atlasConstructions: 0 as const,
        schedulerCount: 0 as const,
        ...counters,
      };
    },
    get destroyed() {
      return destroyed;
    },
    apply,
    updateCamera(): boolean {
      assertActive();
      const next = buildPolyCameraSceneTransform(camera.state);
      if (cameraTransform === next) return false;
      cameraTransform = next;
      sceneElement.style.transform = next;
      const snapshot = capturePolyCameraSnapshot(camera);
      cameraElement.style.perspective = snapshot.appliedPerspectiveStyle;
      cameraElement.dataset.polycssCameraProjection = snapshot.projection;
      return true;
    },
    assertStableDomIdentity,
    destroy(): void {
      if (destroyed) return;
      destroyed = true;
      cameraElement.remove();
      shapeElements.clear();
      leafHandles.clear();
      leafStates.clear();
      shapeTransforms.clear();
      releaseResourceUrls();
      if (changedHostPosition && host.style.position === "relative") {
        host.style.position = initialHostPosition;
      }
    },
  };
  mounted.assertStableDomIdentity();
  return mounted;
}
