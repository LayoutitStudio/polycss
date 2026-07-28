import {
  POLY_MORPH_MODEL_SCHEMA,
  type PolyMorphAnimationChannel,
  type PolyMorphAnimationTarget,
  type PolyMorphAtlasSlice,
  type PolyMorphCapability,
  type PolyMorphControl,
  type PolyMorphDeformation,
  type PolyMorphJoint,
  type PolyMorphMat4,
  type PolyMorphModel,
  type PolyMorphPlayback,
  type PolyMorphProfile,
  type PolyMorphProvenanceSource,
  type PolyMorphRenderFallback,
  type PolyMorphRenderLeaf,
  type PolyMorphRenderStrategy,
  type PolyMorphTopology,
  type PolyMorphVec3,
} from "./types.js";

const ID = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const PATH_SEGMENT = /^[a-z0-9][a-z0-9._-]*$/;
const REVISION = /^\d+\.\d+\.\d+$/;
const SHA256 = /^[a-f0-9]{64}$/;
const PROFILES = new Set<PolyMorphProfile>([
  "joint-skin",
  "morph-regions",
  "prepared-playback",
  "static-prepared",
]);
const CAPABILITIES = new Set<PolyMorphCapability>([
  "animation",
  "joint-skinning",
  "morph-targets",
  "prepared-playback",
  "retained-render",
  "semantic-controls",
  "sparse-updates",
  "springs",
]);
const STRATEGIES = new Set<PolyMorphRenderStrategy>([
  "atlas-slice",
  "direct-image",
  "solid-quad",
  "solid-triangle",
]);
const ANIMATION_TARGETS = new Set<PolyMorphAnimationTarget>([
  "control-value",
  "joint-rotation",
  "joint-scale",
  "joint-translation",
  "morph-weight",
  "shape-matrix",
]);

export class PolyMorphContractError extends TypeError {
  readonly code: string;
  readonly path: string;

  constructor(code: string, path: string, message: string) {
    super(`${path}: ${message}`);
    this.name = "PolyMorphContractError";
    this.code = code;
    this.path = path;
  }
}

function fail(code: string, path: string, message: string): never {
  throw new PolyMorphContractError(code, path, message);
}

function record(
  value: unknown,
  path: string,
  keys: readonly string[],
): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("invalid-type", path, "expected an object");
  }
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    fail("invalid-keys", path, `expected exactly ${expected.join(", ")}`);
  }
  return value as Record<string, unknown>;
}

function array(value: unknown, path: string): readonly unknown[] {
  if (!Array.isArray(value)) fail("invalid-type", path, "expected an array");
  return value;
}

function string(value: unknown, path: string): string {
  if (typeof value !== "string" || value.length === 0) {
    fail("invalid-string", path, "expected a non-empty string");
  }
  return value;
}

function number(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    fail("invalid-number", path, "expected a finite number");
  }
  return value;
}

function integer(value: unknown, path: string, minimum = 0): number {
  const result = number(value, path);
  if (!Number.isSafeInteger(result) || result < minimum) {
    fail("invalid-integer", path, `expected an integer >= ${minimum}`);
  }
  return result;
}

function boolean(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") fail("invalid-boolean", path, "expected a boolean");
  return value;
}

function id(value: unknown, path: string): string {
  const result = string(value, path);
  if (!ID.test(result)) fail("invalid-id", path, "expected a normalized kebab-case id");
  return result;
}

function uniqueIds(values: readonly string[], path: string): void {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) fail("duplicate-id", path, `duplicate id ${value}`);
    seen.add(value);
  }
}

function vec3(value: unknown, path: string): PolyMorphVec3 {
  const values = array(value, path);
  if (values.length !== 3) fail("invalid-vector", path, "expected three components");
  return values.map((part, index) => number(part, `${path}[${index}]`)) as unknown as PolyMorphVec3;
}

function mat4(value: unknown, path: string): PolyMorphMat4 {
  const values = array(value, path);
  if (values.length !== 16) fail("invalid-matrix", path, "expected sixteen components");
  return values.map((part, index) => number(part, `${path}[${index}]`)) as unknown as PolyMorphMat4;
}

function normalizedPath(value: unknown, path: string): string {
  const result = string(value, path);
  if (
    result.split("/").some((part) => !PATH_SEGMENT.test(part))
  ) {
    fail(
      "invalid-path",
      path,
      "expected lowercase URL-safe package path segments",
    );
  }
  return result;
}

function indexInRange(value: unknown, path: string, length: number): number {
  const result = integer(value, path);
  if (result >= length) fail("out-of-range", path, `expected an index below ${length}`);
  return result;
}

function validateTopology(value: unknown, path: string): PolyMorphTopology {
  const input = record(value, path, ["normals", "polygons", "vertices"]);
  const vertices = array(input.vertices, `${path}.vertices`).map((entry, index) =>
    vec3(entry, `${path}.vertices[${index}]`));
  const normals = array(input.normals, `${path}.normals`).map((entry, index) =>
    vec3(entry, `${path}.normals[${index}]`));
  if (vertices.length === 0) fail("missing-topology", `${path}.vertices`, "expected at least one vertex");
  if (normals.length === 0) fail("missing-topology", `${path}.normals`, "expected at least one normal");
  const polygons = array(input.polygons, `${path}.polygons`).map((entry, index) => {
    const itemPath = `${path}.polygons[${index}]`;
    const polygon = record(entry, itemPath, ["id", "normalIndices", "vertexIndices"]);
    const vertexIndices = array(polygon.vertexIndices, `${itemPath}.vertexIndices`).map((part, partIndex) =>
      indexInRange(part, `${itemPath}.vertexIndices[${partIndex}]`, vertices.length));
    const normalIndices = array(polygon.normalIndices, `${itemPath}.normalIndices`).map((part, partIndex) =>
      indexInRange(part, `${itemPath}.normalIndices[${partIndex}]`, normals.length));
    if (vertexIndices.length < 3) fail("invalid-polygon", itemPath, "expected at least three vertices");
    if (normalIndices.length !== vertexIndices.length) {
      fail("invalid-polygon", itemPath, "normal and vertex index counts must match");
    }
    if (new Set(vertexIndices).size !== vertexIndices.length) {
      fail("invalid-polygon", itemPath, "vertex indices must be unique");
    }
    return {
      id: id(polygon.id, `${itemPath}.id`),
      vertexIndices,
      normalIndices,
    };
  });
  if (polygons.length === 0) fail("missing-topology", `${path}.polygons`, "expected at least one polygon");
  uniqueIds(polygons.map((polygon) => polygon.id), `${path}.polygons`);
  return { vertices, normals, polygons };
}

function validateRenderLeaf(
  value: unknown,
  path: string,
  references: {
    readonly polygonIds: ReadonlySet<string>;
    readonly shapeIds: ReadonlySet<string>;
    readonly materialIds: ReadonlySet<string>;
  },
): PolyMorphRenderLeaf {
  const input = record(value, path, [
    "atlas",
    "fallback",
    "height",
    "id",
    "materialId",
    "matrix",
    "polygonId",
    "shapeId",
    "strategy",
    "width",
  ]);
  const strategy = string(input.strategy, `${path}.strategy`) as PolyMorphRenderStrategy;
  if (!STRATEGIES.has(strategy)) fail("invalid-strategy", `${path}.strategy`, "unknown render strategy");
  const polygonId = id(input.polygonId, `${path}.polygonId`);
  const shapeId = id(input.shapeId, `${path}.shapeId`);
  const materialId = id(input.materialId, `${path}.materialId`);
  if (!references.polygonIds.has(polygonId)) fail("unknown-reference", `${path}.polygonId`, polygonId);
  if (!references.shapeIds.has(shapeId)) fail("unknown-reference", `${path}.shapeId`, shapeId);
  if (!references.materialIds.has(materialId)) fail("unknown-reference", `${path}.materialId`, materialId);
  const width = number(input.width, `${path}.width`);
  const height = number(input.height, `${path}.height`);
  if (width <= 0 || height <= 0) fail("invalid-size", path, "leaf dimensions must be positive");
  const needsAtlas = strategy === "atlas-slice" || strategy === "direct-image";
  const atlas = input.atlas === null
    ? null
    : validateAtlasSlice(input.atlas, `${path}.atlas`);
  if (needsAtlas !== (atlas !== null)) {
    fail("invalid-strategy", `${path}.atlas`, needsAtlas
      ? "image strategies require an atlas/source slice"
      : "solid strategies cannot declare an atlas/source slice");
  }
  const fallback = input.fallback === null
    ? null
    : validateRenderFallback(input.fallback, `${path}.fallback`);
  if (fallback !== null && strategy !== "solid-triangle") {
    fail(
      "invalid-strategy",
      `${path}.fallback`,
      "only solid-triangle leaves may declare a prepared fallback",
    );
  }
  return {
    id: id(input.id, `${path}.id`),
    polygonId,
    shapeId,
    materialId,
    strategy,
    width,
    height,
    matrix: mat4(input.matrix, `${path}.matrix`),
    atlas,
    fallback,
  };
}

function validateRenderFallback(
  value: unknown,
  path: string,
): PolyMorphRenderFallback {
  const input = record(value, path, [
    "atlas",
    "height",
    "matrixFromLeaf",
    "width",
  ]);
  const width = integer(input.width, `${path}.width`, 1);
  const height = integer(input.height, `${path}.height`, 1);
  const atlas = validateAtlasSlice(input.atlas, `${path}.atlas`);
  if (atlas.width !== width || atlas.height !== height) {
    fail(
      "invalid-size",
      path,
      "fallback dimensions must match its per-polygon atlas slice",
    );
  }
  return {
    width,
    height,
    matrixFromLeaf: mat4(input.matrixFromLeaf, `${path}.matrixFromLeaf`),
    atlas,
  };
}

function validateAtlasSlice(
  value: unknown,
  path: string,
): PolyMorphAtlasSlice {
  const input = record(value, path, [
    "height",
    "pageHeight",
    "pageWidth",
    "resourcePath",
    "width",
    "x",
    "y",
  ]);
  const atlas = {
    resourcePath: normalizedPath(input.resourcePath, `${path}.resourcePath`),
    x: integer(input.x, `${path}.x`),
    y: integer(input.y, `${path}.y`),
    width: integer(input.width, `${path}.width`, 1),
    height: integer(input.height, `${path}.height`, 1),
    pageWidth: integer(input.pageWidth, `${path}.pageWidth`, 1),
    pageHeight: integer(input.pageHeight, `${path}.pageHeight`, 1),
  };
  if (atlas.x + atlas.width > atlas.pageWidth || atlas.y + atlas.height > atlas.pageHeight) {
    fail("out-of-range", path, "slice must fit inside its page");
  }
  return atlas;
}

function validateDeformation(
  value: unknown,
  path: string,
  topology: PolyMorphTopology,
): PolyMorphDeformation {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("invalid-type", path, "expected a deformation object");
  }
  const kind = string((value as Record<string, unknown>).kind, `${path}.kind`);
  if (kind === "none") {
    record(value, path, ["kind"]);
    return { kind };
  }
  if (kind === "morph-regions") {
    const input = record(value, path, ["kind", "targets"]);
    const targets = array(input.targets, `${path}.targets`).map((entry, targetIndex) => {
      const targetPath = `${path}.targets[${targetIndex}]`;
      const target = record(entry, targetPath, ["deltas", "id"]);
      const deltas = array(target.deltas, `${targetPath}.deltas`).map((deltaEntry, deltaIndex) => {
        const deltaPath = `${targetPath}.deltas[${deltaIndex}]`;
        const delta = record(deltaEntry, deltaPath, ["normal", "position", "vertexIndex"]);
        const position = delta.position === null ? null : vec3(delta.position, `${deltaPath}.position`);
        const normal = delta.normal === null ? null : vec3(delta.normal, `${deltaPath}.normal`);
        if (position === null && normal === null) {
          fail("empty-delta", deltaPath, "expected a position or normal delta");
        }
        return {
          vertexIndex: indexInRange(delta.vertexIndex, `${deltaPath}.vertexIndex`, topology.vertices.length),
          position,
          normal,
        };
      });
      if (deltas.length === 0) fail("missing-deltas", `${targetPath}.deltas`, "expected at least one delta");
      const indices = deltas.map((delta) => String(delta.vertexIndex));
      uniqueIds(indices, `${targetPath}.deltas`);
      return { id: id(target.id, `${targetPath}.id`), deltas };
    });
    if (targets.length === 0) fail("missing-targets", `${path}.targets`, "expected at least one target");
    uniqueIds(targets.map((target) => target.id), `${path}.targets`);
    return { kind, targets };
  }
  if (kind === "joint-skin") {
    const input = record(value, path, ["joints", "kind", "vertices"]);
    const joints = array(input.joints, `${path}.joints`).map((entry, jointIndex) => {
      const jointPath = `${path}.joints[${jointIndex}]`;
      const joint = record(entry, jointPath, ["id", "inverseBindMatrix", "parentId", "restMatrix"]);
      return {
        id: id(joint.id, `${jointPath}.id`),
        parentId: joint.parentId === null ? null : id(joint.parentId, `${jointPath}.parentId`),
        restMatrix: mat4(joint.restMatrix, `${jointPath}.restMatrix`),
        inverseBindMatrix: mat4(joint.inverseBindMatrix, `${jointPath}.inverseBindMatrix`),
      };
    });
    if (joints.length === 0) fail("missing-joints", `${path}.joints`, "expected at least one joint");
    uniqueIds(joints.map((joint) => joint.id), `${path}.joints`);
    validateJointHierarchy(joints, `${path}.joints`);
    const jointIds = new Set(joints.map((joint) => joint.id));
    const vertices = array(input.vertices, `${path}.vertices`).map((entry, vertexIndex) => {
      const vertexPath = `${path}.vertices[${vertexIndex}]`;
      const vertex = record(entry, vertexPath, ["influences", "vertexIndex"]);
      const resolvedIndex = indexInRange(vertex.vertexIndex, `${vertexPath}.vertexIndex`, topology.vertices.length);
      const influences = array(vertex.influences, `${vertexPath}.influences`).map((entryInfluence, influenceIndex) => {
        const influencePath = `${vertexPath}.influences[${influenceIndex}]`;
        const influence = record(entryInfluence, influencePath, ["jointId", "weight"]);
        const jointId = id(influence.jointId, `${influencePath}.jointId`);
        if (!jointIds.has(jointId)) fail("unknown-reference", `${influencePath}.jointId`, jointId);
        const weight = number(influence.weight, `${influencePath}.weight`);
        if (weight <= 0 || weight > 1) fail("invalid-weight", `${influencePath}.weight`, "expected 0 < weight <= 1");
        return { jointId, weight };
      });
      if (influences.length === 0) fail("missing-influences", `${vertexPath}.influences`, "expected at least one influence");
      uniqueIds(influences.map((influence) => influence.jointId), `${vertexPath}.influences`);
      const total = influences.reduce((sum, influence) => sum + influence.weight, 0);
      if (Math.abs(total - 1) > 1e-6) fail("invalid-weight", `${vertexPath}.influences`, "weights must sum to 1");
      return { vertexIndex: resolvedIndex, influences };
    });
    if (vertices.length !== topology.vertices.length) {
      fail("missing-skin-vertex", `${path}.vertices`, "every topology vertex must have one skin record");
    }
    const skinIndices = vertices.map((vertex) => String(vertex.vertexIndex));
    uniqueIds(skinIndices, `${path}.vertices`);
    return { kind, joints, vertices };
  }
  fail("invalid-deformation", `${path}.kind`, `unknown deformation kind ${kind}`);
}

function validateJointHierarchy(joints: readonly PolyMorphJoint[], path: string): void {
  const byId = new Map(joints.map((joint) => [joint.id, joint]));
  const roots = joints.filter((joint) => joint.parentId === null);
  if (roots.length !== 1) fail("invalid-hierarchy", path, "expected exactly one root joint");
  for (const joint of joints) {
    if (joint.parentId !== null && !byId.has(joint.parentId)) {
      fail("unknown-reference", path, `joint ${joint.id} references ${joint.parentId}`);
    }
    const seen = new Set<string>();
    let ancestor: PolyMorphJoint | undefined = joint;
    while (ancestor) {
      if (seen.has(ancestor.id)) fail("invalid-hierarchy", path, `cycle at joint ${ancestor.id}`);
      seen.add(ancestor.id);
      ancestor = ancestor.parentId === null ? undefined : byId.get(ancestor.parentId);
    }
  }
}

function channelArity(target: PolyMorphAnimationTarget): number {
  if (target === "control-value" || target === "morph-weight") return 1;
  if (target === "joint-rotation") return 4;
  if (target === "shape-matrix") return 16;
  return 3;
}

function validateAnimationChannel(
  value: unknown,
  path: string,
  references: {
    readonly controlIds: ReadonlySet<string>;
    readonly jointIds: ReadonlySet<string>;
    readonly shapeIds: ReadonlySet<string>;
    readonly targetIds: ReadonlySet<string>;
  },
  durationMs: number,
): PolyMorphAnimationChannel {
  const input = record(value, path, ["interpolation", "target", "targetId", "timesMs", "values"]);
  const target = string(input.target, `${path}.target`) as PolyMorphAnimationTarget;
  if (!ANIMATION_TARGETS.has(target)) fail("invalid-animation-target", `${path}.target`, target);
  const targetId = id(input.targetId, `${path}.targetId`);
  const referenceSet = target === "control-value"
    ? references.controlIds
    : target === "morph-weight"
      ? references.targetIds
      : target === "shape-matrix"
        ? references.shapeIds
        : references.jointIds;
  if (!referenceSet.has(targetId)) fail("unknown-reference", `${path}.targetId`, targetId);
  const interpolation = string(input.interpolation, `${path}.interpolation`);
  if (interpolation !== "linear" && interpolation !== "step") {
    fail("invalid-interpolation", `${path}.interpolation`, interpolation);
  }
  if (target === "shape-matrix" && interpolation !== "step") {
    fail(
      "invalid-interpolation",
      `${path}.interpolation`,
      "shape matrices require step interpolation",
    );
  }
  const timesMs = array(input.timesMs, `${path}.timesMs`).map((entry, index) =>
    number(entry, `${path}.timesMs[${index}]`));
  const values = array(input.values, `${path}.values`).map((entry, valueIndex) => {
    const parts = array(entry, `${path}.values[${valueIndex}]`);
    const arity = channelArity(target);
    if (parts.length !== arity) {
      fail("invalid-animation-value", `${path}.values[${valueIndex}]`, `expected ${arity} components`);
    }
    const result = parts.map((part, partIndex) =>
      number(part, `${path}.values[${valueIndex}][${partIndex}]`));
    if (target === "joint-rotation" && Math.hypot(...result) <= 1e-12) {
      fail(
        "invalid-animation-value",
        `${path}.values[${valueIndex}]`,
        "quaternion must be non-zero",
      );
    }
    return result;
  });
  if (timesMs.length === 0 || timesMs.length !== values.length) {
    fail("invalid-animation-samples", path, "times and values must have the same non-zero length");
  }
  if (timesMs[0] !== 0 || timesMs.some((time, index) =>
    time < 0 || time > durationMs || (index > 0 && time <= timesMs[index - 1]!))) {
    fail("invalid-animation-time", `${path}.timesMs`, "times must start at zero and increase within the clip");
  }
  return {
    target,
    targetId,
    interpolation,
    timesMs,
    values,
  };
}

function validatePlayback(
  value: unknown,
  path: string,
  leafIds: ReadonlySet<string>,
  shapeIds: ReadonlySet<string>,
): PolyMorphPlayback {
  const input = record(value, path, ["durationMs", "frames", "loop"]);
  const durationMs = number(input.durationMs, `${path}.durationMs`);
  if (durationMs <= 0) fail("invalid-duration", `${path}.durationMs`, "expected a positive duration");
  const frames = array(input.frames, `${path}.frames`).map((entry, frameIndex) => {
    const framePath = `${path}.frames[${frameIndex}]`;
    const frame = record(entry, framePath, ["leaves", "modelMatrix", "shapes", "timeMs"]);
    const timeMs = number(frame.timeMs, `${framePath}.timeMs`);
    const shapes = array(frame.shapes, `${framePath}.shapes`).map((shapeEntry, shapeIndex) => {
      const shapePath = `${framePath}.shapes[${shapeIndex}]`;
      const shape = record(shapeEntry, shapePath, ["matrix", "shapeId"]);
      const shapeId = id(shape.shapeId, `${shapePath}.shapeId`);
      if (!shapeIds.has(shapeId)) fail("unknown-reference", `${shapePath}.shapeId`, shapeId);
      return { shapeId, matrix: mat4(shape.matrix, `${shapePath}.matrix`) };
    });
    uniqueIds(shapes.map((shape) => shape.shapeId), `${framePath}.shapes`);
    const leaves = array(frame.leaves, `${framePath}.leaves`).map((leafEntry, leafIndex) => {
      const leafPath = `${framePath}.leaves[${leafIndex}]`;
      const leaf = record(leafEntry, leafPath, ["atlasRow", "leafId", "matrix", "opacity", "visible"]);
      const leafId = id(leaf.leafId, `${leafPath}.leafId`);
      if (!leafIds.has(leafId)) fail("unknown-reference", `${leafPath}.leafId`, leafId);
      const opacity = leaf.opacity === null ? null : number(leaf.opacity, `${leafPath}.opacity`);
      if (opacity !== null && (opacity < 0 || opacity > 1)) {
        fail("out-of-range", `${leafPath}.opacity`, "expected 0 <= opacity <= 1");
      }
      return {
        leafId,
        matrix: leaf.matrix === null ? null : mat4(leaf.matrix, `${leafPath}.matrix`),
        visible: leaf.visible === null ? null : boolean(leaf.visible, `${leafPath}.visible`),
        opacity,
        atlasRow: leaf.atlasRow === null ? null : integer(leaf.atlasRow, `${leafPath}.atlasRow`),
      };
    });
    uniqueIds(leaves.map((leaf) => leaf.leafId), `${framePath}.leaves`);
    return {
      timeMs,
      modelMatrix: frame.modelMatrix === null ? null : mat4(frame.modelMatrix, `${framePath}.modelMatrix`),
      shapes,
      leaves,
    };
  });
  if (frames.length === 0) fail("missing-frames", `${path}.frames`, "expected at least one frame");
  if (frames[0]!.timeMs !== 0 || frames.some((frame, index) =>
    frame.timeMs < 0
    || frame.timeMs > durationMs
    || (index > 0 && frame.timeMs <= frames[index - 1]!.timeMs))) {
    fail("invalid-frame-time", `${path}.frames`, "frames must start at zero and increase within the timeline");
  }
  return { durationMs, loop: boolean(input.loop, `${path}.loop`), frames };
}

function requiredCapabilities(
  profile: PolyMorphProfile,
  model: {
    readonly controls: readonly unknown[];
    readonly springs: readonly unknown[];
    readonly animations: readonly unknown[];
  },
): readonly PolyMorphCapability[] {
  const required: PolyMorphCapability[] = ["retained-render"];
  if (profile === "morph-regions") required.push("morph-targets", "sparse-updates");
  if (profile === "joint-skin") required.push("joint-skinning", "sparse-updates");
  if (profile === "prepared-playback") required.push("prepared-playback", "sparse-updates");
  if (model.controls.length > 0) required.push("semantic-controls");
  if (model.springs.length > 0) required.push("springs");
  if (model.animations.length > 0) required.push("animation");
  return required;
}

export function validatePolyMorphModel(value: unknown): PolyMorphModel {
  const path = "$";
  const input = record(value, path, [
    "animations",
    "budgets",
    "capabilities",
    "controls",
    "deformation",
    "identity",
    "materials",
    "playback",
    "profile",
    "provenance",
    "render",
    "schema",
    "springs",
    "topology",
  ]);
  if (input.schema !== POLY_MORPH_MODEL_SCHEMA) {
    fail("invalid-schema", "$.schema", `expected ${POLY_MORPH_MODEL_SCHEMA}`);
  }
  const identityInput = record(input.identity, "$.identity", ["id", "name", "revision"]);
  const identity = {
    id: id(identityInput.id, "$.identity.id"),
    name: string(identityInput.name, "$.identity.name"),
    revision: string(identityInput.revision, "$.identity.revision"),
  };
  if (!REVISION.test(identity.revision)) {
    fail("invalid-revision", "$.identity.revision", "expected x.y.z");
  }
  const profile = string(input.profile, "$.profile") as PolyMorphProfile;
  if (!PROFILES.has(profile)) fail("invalid-profile", "$.profile", profile);
  const capabilities = array(input.capabilities, "$.capabilities").map((entry, index) => {
    const capability = string(entry, `$.capabilities[${index}]`) as PolyMorphCapability;
    if (!CAPABILITIES.has(capability)) {
      fail("invalid-capability", `$.capabilities[${index}]`, capability);
    }
    return capability;
  });
  uniqueIds(capabilities, "$.capabilities");
  if (capabilities.some((capability, index) => index > 0 && capability <= capabilities[index - 1]!)) {
    fail("non-canonical-order", "$.capabilities", "capabilities must be sorted");
  }
  const budgetInput = record(input.budgets, "$.budgets", [
    "maxBytes",
    "maxFrames",
    "maxJoints",
    "maxLeaves",
    "maxPolygons",
    "maxResources",
    "maxVertices",
  ]);
  const budgets = {
    maxVertices: integer(budgetInput.maxVertices, "$.budgets.maxVertices"),
    maxPolygons: integer(budgetInput.maxPolygons, "$.budgets.maxPolygons"),
    maxLeaves: integer(budgetInput.maxLeaves, "$.budgets.maxLeaves"),
    maxFrames: integer(budgetInput.maxFrames, "$.budgets.maxFrames"),
    maxJoints: integer(budgetInput.maxJoints, "$.budgets.maxJoints"),
    maxResources: integer(budgetInput.maxResources, "$.budgets.maxResources"),
    maxBytes: integer(budgetInput.maxBytes, "$.budgets.maxBytes"),
  };
  const topology = validateTopology(input.topology, "$.topology");
  const materials = array(input.materials, "$.materials").map((entry, materialIndex) => {
    const materialPath = `$.materials[${materialIndex}]`;
    const material = record(entry, materialPath, ["color", "id"]);
    const colorParts = array(material.color, `${materialPath}.color`);
    if (colorParts.length !== 4) fail("invalid-color", `${materialPath}.color`, "expected four components");
    const color = colorParts.map((part, partIndex) => {
      const component = number(part, `${materialPath}.color[${partIndex}]`);
      if (component < 0 || component > 1) {
        fail("out-of-range", `${materialPath}.color[${partIndex}]`, "expected 0 <= component <= 1");
      }
      return component;
    }) as [number, number, number, number];
    return { id: id(material.id, `${materialPath}.id`), color };
  });
  if (materials.length === 0) fail("missing-materials", "$.materials", "expected at least one material");
  uniqueIds(materials.map((material) => material.id), "$.materials");
  const renderInput = record(input.render, "$.render", [
    "leaves",
    "modelMatrix",
    "shapes",
  ]);
  const shapes = array(renderInput.shapes, "$.render.shapes").map((entry, shapeIndex) => {
    const shapePath = `$.render.shapes[${shapeIndex}]`;
    const shape = record(entry, shapePath, ["id", "matrix"]);
    return {
      id: id(shape.id, `${shapePath}.id`),
      matrix: mat4(shape.matrix, `${shapePath}.matrix`),
    };
  });
  if (shapes.length === 0) fail("missing-shapes", "$.render.shapes", "expected at least one shape");
  uniqueIds(shapes.map((shape) => shape.id), "$.render.shapes");
  const leaves = array(renderInput.leaves, "$.render.leaves").map((entry, leafIndex) =>
    validateRenderLeaf(entry, `$.render.leaves[${leafIndex}]`, {
      polygonIds: new Set(topology.polygons.map((polygon) => polygon.id)),
      shapeIds: new Set(shapes.map((shape) => shape.id)),
      materialIds: new Set(materials.map((material) => material.id)),
    }));
  uniqueIds(leaves.map((leaf) => leaf.id), "$.render.leaves");
  uniqueIds(leaves.map((leaf) => leaf.polygonId), "$.render.leaves[*].polygonId");
  if (leaves.length !== topology.polygons.length) {
    fail("unstable-topology", "$.render.leaves", "every polygon must bind exactly one retained leaf");
  }
  const render = {
    modelMatrix: mat4(renderInput.modelMatrix, "$.render.modelMatrix"),
    shapes,
    leaves,
  };
  const deformation = validateDeformation(input.deformation, "$.deformation", topology);
  if (
    (profile === "static-prepared" || profile === "prepared-playback")
      ? deformation.kind !== "none"
      : deformation.kind !== profile
  ) {
    fail("profile-mismatch", "$.deformation.kind", `does not match profile ${profile}`);
  }
  const targetIds = new Set(deformation.kind === "morph-regions"
    ? deformation.targets.map((target) => target.id)
    : []);
  const jointIds = new Set(deformation.kind === "joint-skin"
    ? deformation.joints.map((joint) => joint.id)
    : []);
  const controls = array(input.controls, "$.controls").map((entry, controlIndex): PolyMorphControl => {
    const controlPath = `$.controls[${controlIndex}]`;
    const control = record(entry, controlPath, [
      "anchor",
      "axis",
      "id",
      "initial",
      "maximum",
      "minimum",
      "radius",
      "targets",
    ]);
    const minimum = number(control.minimum, `${controlPath}.minimum`);
    const maximum = number(control.maximum, `${controlPath}.maximum`);
    const initial = number(control.initial, `${controlPath}.initial`);
    if (minimum > maximum || initial < minimum || initial > maximum) {
      fail("invalid-control-bounds", controlPath, "expected minimum <= initial <= maximum");
    }
    const anchor = vec3(control.anchor, `${controlPath}.anchor`);
    const axis = vec3(control.axis, `${controlPath}.axis`);
    const axisLength = Math.hypot(...axis);
    if (axisLength < 1e-9) fail("invalid-control-axis", `${controlPath}.axis`, "axis must be non-zero");
    const radius = number(control.radius, `${controlPath}.radius`);
    if (radius <= 0) fail("invalid-control-radius", `${controlPath}.radius`, "radius must be positive");
    const targets = array(control.targets, `${controlPath}.targets`).map((entryTarget, targetIndex) => {
      const targetPath = `${controlPath}.targets[${targetIndex}]`;
      const target = record(entryTarget, targetPath, ["scale", "targetId"]);
      const targetId = id(target.targetId, `${targetPath}.targetId`);
      if (!targetIds.has(targetId)) fail("unknown-reference", `${targetPath}.targetId`, targetId);
      return { targetId, scale: number(target.scale, `${targetPath}.scale`) };
    });
    uniqueIds(targets.map((target) => target.targetId), `${controlPath}.targets`);
    return {
      id: id(control.id, `${controlPath}.id`),
      anchor,
      axis,
      radius,
      minimum,
      maximum,
      initial,
      targets,
    };
  });
  uniqueIds(controls.map((control) => control.id), "$.controls");
  const controlIds = new Set(controls.map((control) => control.id));
  const springs = array(input.springs, "$.springs").map((entry, springIndex) => {
    const springPath = `$.springs[${springIndex}]`;
    const spring = record(entry, springPath, ["controlId", "damping", "id", "stiffness"]);
    const controlId = id(spring.controlId, `${springPath}.controlId`);
    if (!controlIds.has(controlId)) fail("unknown-reference", `${springPath}.controlId`, controlId);
    const stiffness = number(spring.stiffness, `${springPath}.stiffness`);
    const damping = number(spring.damping, `${springPath}.damping`);
    if (stiffness <= 0 || damping < 0) {
      fail("invalid-spring", springPath, "expected stiffness > 0 and damping >= 0");
    }
    return { id: id(spring.id, `${springPath}.id`), controlId, stiffness, damping };
  });
  uniqueIds(springs.map((spring) => spring.id), "$.springs");
  const shapeIds = new Set(shapes.map((shape) => shape.id));
  const animations = array(input.animations, "$.animations").map((entry, clipIndex) => {
    const clipPath = `$.animations[${clipIndex}]`;
    const clip = record(entry, clipPath, ["channels", "durationMs", "id", "loop"]);
    const durationMs = number(clip.durationMs, `${clipPath}.durationMs`);
    if (durationMs <= 0) fail("invalid-duration", `${clipPath}.durationMs`, "expected a positive duration");
    const channels = array(clip.channels, `${clipPath}.channels`).map((channel, channelIndex) =>
      validateAnimationChannel(channel, `${clipPath}.channels[${channelIndex}]`, {
        controlIds,
        jointIds,
        shapeIds,
        targetIds,
      }, durationMs));
    if (channels.length === 0) fail("missing-channels", `${clipPath}.channels`, "expected at least one channel");
    const channelKeys = channels.map((channel) => `${channel.target}:${channel.targetId}`);
    uniqueIds(channelKeys, `${clipPath}.channels`);
    return {
      id: id(clip.id, `${clipPath}.id`),
      durationMs,
      loop: boolean(clip.loop, `${clipPath}.loop`),
      channels,
    };
  });
  uniqueIds(animations.map((clip) => clip.id), "$.animations");
  const playback = input.playback === null
    ? null
    : validatePlayback(
      input.playback,
      "$.playback",
      new Set(leaves.map((leaf) => leaf.id)),
      shapeIds,
    );
  if ((profile === "prepared-playback") !== (playback !== null)) {
    fail("profile-mismatch", "$.playback", "playback is required only by the prepared-playback profile");
  }
  const provenanceInput = record(input.provenance, "$.provenance", [
    "generator",
    "generatorVersion",
    "sources",
  ]);
  const sources = array(provenanceInput.sources, "$.provenance.sources").map((entry, sourceIndex) => {
    const sourcePath = `$.provenance.sources[${sourceIndex}]`;
    const source = record(entry, sourcePath, ["id", "kind", "license", "sha256", "uri"]);
    const kind = string(source.kind, `${sourcePath}.kind`) as PolyMorphProvenanceSource["kind"];
    if (kind !== "authored" && kind !== "generated" && kind !== "open-data") {
      fail("invalid-source-kind", `${sourcePath}.kind`, kind);
    }
    const uri = string(source.uri, `${sourcePath}.uri`);
    if (uri.startsWith("/") || uri.startsWith("file:") || uri.includes("\\")) {
      fail("invalid-source-uri", `${sourcePath}.uri`, "local filesystem paths are forbidden");
    }
    const sha256 = source.sha256 === null ? null : string(source.sha256, `${sourcePath}.sha256`);
    if (sha256 !== null && !SHA256.test(sha256)) {
      fail("invalid-hash", `${sourcePath}.sha256`, "expected lowercase SHA-256");
    }
    return {
      id: id(source.id, `${sourcePath}.id`),
      kind,
      uri,
      sha256,
      license: string(source.license, `${sourcePath}.license`),
    };
  });
  if (sources.length === 0) fail("missing-provenance", "$.provenance.sources", "expected at least one source");
  uniqueIds(sources.map((source) => source.id), "$.provenance.sources");
  const provenance = {
    generator: id(provenanceInput.generator, "$.provenance.generator"),
    generatorVersion: string(provenanceInput.generatorVersion, "$.provenance.generatorVersion"),
    sources,
  };
  if (!REVISION.test(provenance.generatorVersion)) {
    fail("invalid-revision", "$.provenance.generatorVersion", "expected x.y.z");
  }
  const required = requiredCapabilities(profile, { controls, springs, animations });
  for (const capability of required) {
    if (!capabilities.includes(capability)) {
      fail("missing-capability", "$.capabilities", `profile requires ${capability}`);
    }
  }
  const jointCount = deformation.kind === "joint-skin" ? deformation.joints.length : 0;
  const frameCount = playback?.frames.length ?? 0;
  const actualBudgets = [
    ["maxVertices", topology.vertices.length, budgets.maxVertices],
    ["maxPolygons", topology.polygons.length, budgets.maxPolygons],
    ["maxLeaves", leaves.length, budgets.maxLeaves],
    ["maxFrames", frameCount, budgets.maxFrames],
    ["maxJoints", jointCount, budgets.maxJoints],
  ] as const;
  for (const [key, actual, maximum] of actualBudgets) {
    if (actual > maximum) fail("budget-exceeded", `$.budgets.${key}`, `${actual} exceeds ${maximum}`);
  }
  return {
    schema: POLY_MORPH_MODEL_SCHEMA,
    identity,
    profile,
    capabilities,
    budgets,
    topology,
    materials,
    render,
    deformation,
    controls,
    springs,
    animations,
    playback,
    provenance,
  };
}

export function isPolyMorphId(value: string): boolean {
  return ID.test(value);
}

export function isPolyMorphResourcePath(value: string): boolean {
  try {
    normalizedPath(value, "$");
    return true;
  } catch {
    return false;
  }
}
