import {
  validatePolyMorphModel,
  type PolyMorphJoint,
  type PolyMorphMat4,
  type PolyMorphModel,
  type PolyMorphQuat,
  type PolyMorphVec3,
} from "../../contracts/index.js";
import type { PolyMorphLeafUpdate } from "../../render/index.js";
import {
  createPolyMorphAnimationRuntime,
  type PolyMorphJointAnimationSample,
} from "../animation/index.js";
import {
  compilePolyMorphPreparedLeaf,
  computePolyMorphPreparedLeafMatrix,
} from "../deformation/deformation.js";
import { PolyMorphRuntimeError } from "../runtimeError.js";

type MutableVec3 = [number, number, number];

export interface PolyMorphSkinningInput {
  readonly tick: number;
  readonly jointTransforms?: ReadonlyMap<string, PolyMorphJointAnimationSample>;
}

export interface PolyMorphSkinningFrame {
  readonly tick: number;
  readonly positions: readonly PolyMorphVec3[];
  readonly normals: readonly PolyMorphVec3[];
  readonly globalJointMatrices: ReadonlyMap<string, PolyMorphMat4>;
  readonly skinMatrices: ReadonlyMap<string, PolyMorphMat4>;
  readonly dirtyLeafIds: readonly string[];
  readonly leafUpdates: readonly PolyMorphLeafUpdate[];
  readonly runtimePolygonConstructions: 0;
  readonly runtimeTopologyConstructions: 0;
  readonly atlasRedraws: 0;
}

export interface PolyMorphSkinningRuntime {
  readonly model: PolyMorphModel;
  readonly jointIds: readonly string[];
  readonly basePositions: readonly PolyMorphVec3[];
  readonly baseNormals: readonly PolyMorphVec3[];
  sample(input: PolyMorphSkinningInput): PolyMorphSkinningFrame;
  sampleClip(clipId: string, timeMs: number, tick: number): PolyMorphSkinningFrame;
  reset(): void;
}

function fail(code: string, path: string, message: string): never {
  throw new PolyMorphRuntimeError(code, path, message);
}

function identity(): PolyMorphMat4 {
  return [
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    0, 0, 0, 1,
  ];
}

function multiply(left: PolyMorphMat4, right: PolyMorphMat4): PolyMorphMat4 {
  const output = new Array<number>(16).fill(0);
  for (let column = 0; column < 4; column += 1) {
    for (let row = 0; row < 4; row += 1) {
      let sum = 0;
      for (let index = 0; index < 4; index += 1) {
        sum += left[index * 4 + row]! * right[column * 4 + index]!;
      }
      output[column * 4 + row] = Object.is(sum, -0) ? 0 : sum;
    }
  }
  return Object.freeze(output) as unknown as PolyMorphMat4;
}

function normalizedQuaternion(value: PolyMorphQuat | undefined, path: string): PolyMorphQuat {
  if (value === undefined) return [0, 0, 0, 1];
  if (
    !Array.isArray(value)
    || value.length !== 4
    || value.some((part) => typeof part !== "number" || !Number.isFinite(part))
  ) {
    fail("invalid-quaternion", path, "expected four finite components");
  }
  const length = Math.hypot(...value);
  if (length <= 1e-12) fail("invalid-quaternion", path, "quaternion must be non-zero");
  return [value[0] / length, value[1] / length, value[2] / length, value[3] / length];
}

function vector(
  value: PolyMorphVec3 | undefined,
  fallback: PolyMorphVec3,
  path: string,
  positive = false,
): PolyMorphVec3 {
  if (value === undefined) return fallback;
  if (
    !Array.isArray(value)
    || value.length !== 3
    || value.some((part) => typeof part !== "number" || !Number.isFinite(part))
  ) {
    fail("invalid-vector", path, "expected three finite components");
  }
  if (positive && value.some((part) => part <= 0)) {
    fail("invalid-scale", path, "scale components must be positive");
  }
  return [value[0], value[1], value[2]];
}

function transformMatrix(
  value: PolyMorphJointAnimationSample | undefined,
  path: string,
): PolyMorphMat4 {
  if (value === undefined) return identity();
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("invalid-joint-transform", path, "expected an object");
  }
  const keys = Object.keys(value);
  if (keys.some((key) => key !== "translation" && key !== "rotation" && key !== "scale")) {
    fail("invalid-joint-transform", path, "unknown transform field");
  }
  const translation = vector(value.translation, [0, 0, 0], `${path}.translation`);
  const scale = vector(value.scale, [1, 1, 1], `${path}.scale`, true);
  const [x, y, z, w] = normalizedQuaternion(value.rotation, `${path}.rotation`);
  const xx = x * x;
  const yy = y * y;
  const zz = z * z;
  const xy = x * y;
  const xz = x * z;
  const yz = y * z;
  const wx = w * x;
  const wy = w * y;
  const wz = w * z;
  return [
    (1 - 2 * (yy + zz)) * scale[0],
    (2 * (xy + wz)) * scale[0],
    (2 * (xz - wy)) * scale[0],
    0,
    (2 * (xy - wz)) * scale[1],
    (1 - 2 * (xx + zz)) * scale[1],
    (2 * (yz + wx)) * scale[1],
    0,
    (2 * (xz + wy)) * scale[2],
    (2 * (yz - wx)) * scale[2],
    (1 - 2 * (xx + yy)) * scale[2],
    0,
    translation[0],
    translation[1],
    translation[2],
    1,
  ];
}

function transformPoint(matrix: PolyMorphMat4, point: PolyMorphVec3): MutableVec3 {
  return [
    matrix[0] * point[0] + matrix[4] * point[1] + matrix[8] * point[2] + matrix[12],
    matrix[1] * point[0] + matrix[5] * point[1] + matrix[9] * point[2] + matrix[13],
    matrix[2] * point[0] + matrix[6] * point[1] + matrix[10] * point[2] + matrix[14],
  ];
}

function transformNormal(
  matrix: PolyMorphMat4,
  normal: PolyMorphVec3,
  path: string,
): MutableVec3 {
  const [a, d, g] = matrix;
  const b = matrix[4];
  const e = matrix[5];
  const h = matrix[6];
  const c = matrix[8];
  const f = matrix[9];
  const i = matrix[10];
  const determinant = a! * (e! * i! - f! * h!)
    - b! * (d! * i! - f! * g!)
    + c! * (d! * h! - e! * g!);
  if (Math.abs(determinant) <= 1e-12) {
    fail("invalid-normal-transform", path, "joint skin matrix is singular");
  }
  return [
    (
      (e! * i! - f! * h!) * normal[0]
      + (f! * g! - d! * i!) * normal[1]
      + (d! * h! - e! * g!) * normal[2]
    ) / determinant,
    (
      (c! * h! - b! * i!) * normal[0]
      + (a! * i! - c! * g!) * normal[1]
      + (b! * g! - a! * h!) * normal[2]
    ) / determinant,
    (
      (b! * f! - c! * e!) * normal[0]
      + (c! * d! - a! * f!) * normal[1]
      + (a! * e! - b! * d!) * normal[2]
    ) / determinant,
  ];
}

function normalize(value: MutableVec3): MutableVec3 {
  const length = Math.hypot(...value);
  if (length <= 1e-12) return [0, 0, 0];
  return [value[0] / length, value[1] / length, value[2] / length];
}

function freezeVectors(values: MutableVec3[]): readonly PolyMorphVec3[] {
  for (const value of values) Object.freeze(value);
  return Object.freeze(values);
}

function matricesEqual(left: PolyMorphMat4, right: PolyMorphMat4): boolean {
  return left.every((value, index) => Math.abs(value - right[index]!) <= 1e-12);
}

function globalMatrices(
  joints: readonly PolyMorphJoint[],
  transforms: ReadonlyMap<string, PolyMorphJointAnimationSample>,
): ReadonlyMap<string, PolyMorphMat4> {
  const byId = new Map(joints.map((joint) => [joint.id, joint]));
  const resolved = new Map<string, PolyMorphMat4>();
  const resolve = (joint: PolyMorphJoint): PolyMorphMat4 => {
    const cached = resolved.get(joint.id);
    if (cached) return cached;
    const local = multiply(
      joint.restMatrix,
      transformMatrix(transforms.get(joint.id), `$.jointTransforms.${joint.id}`),
    );
    const global = joint.parentId === null
      ? local
      : multiply(resolve(byId.get(joint.parentId)!), local);
    resolved.set(joint.id, global);
    return global;
  };
  for (const joint of joints) resolve(joint);
  return resolved;
}

function skinMatrices(
  joints: readonly PolyMorphJoint[],
  globals: ReadonlyMap<string, PolyMorphMat4>,
): ReadonlyMap<string, PolyMorphMat4> {
  return new Map(joints.map((joint) => [
    joint.id,
    multiply(globals.get(joint.id)!, joint.inverseBindMatrix),
  ]));
}

function validateTransforms(
  value: ReadonlyMap<string, PolyMorphJointAnimationSample> | undefined,
  jointIds: ReadonlySet<string>,
): ReadonlyMap<string, PolyMorphJointAnimationSample> {
  const transforms = value ?? new Map();
  if (!transforms || typeof transforms.entries !== "function") {
    fail("invalid-joint-transform", "$.jointTransforms", "expected a map");
  }
  for (const [id, transform] of transforms) {
    if (!jointIds.has(id)) fail("unknown-joint", "$.jointTransforms", id);
    transformMatrix(transform, `$.jointTransforms.${id}`);
  }
  return transforms;
}

export function createPolyMorphSkinningRuntime(
  modelInput: unknown,
): PolyMorphSkinningRuntime {
  const model = validatePolyMorphModel(modelInput);
  if (model.deformation.kind !== "joint-skin") {
    fail("profile-mismatch", "$.profile", "skinning requires the joint-skin profile");
  }
  const deformation = model.deformation;
  const jointIds = deformation.joints.map((joint) => joint.id);
  const jointIdSet = new Set(jointIds);
  const restGlobals = globalMatrices(deformation.joints, new Map());
  const restSkin = skinMatrices(deformation.joints, restGlobals);
  const basePositions = freezeVectors(
    model.topology.vertices.map((value) => [...value] as MutableVec3),
  );
  const baseNormals = freezeVectors(
    model.topology.normals.map((value) => [...value] as MutableVec3),
  );
  const compiledLeaves = new Map(model.render.leaves.map((leaf) => [
    leaf.id,
    compilePolyMorphPreparedLeaf(model, leaf),
  ]));
  const polygonsByVertex = new Map<number, string[]>();
  for (const polygon of model.topology.polygons) {
    for (const vertexIndex of polygon.vertexIndices) {
      const values = polygonsByVertex.get(vertexIndex) ?? [];
      values.push(polygon.id);
      polygonsByVertex.set(vertexIndex, values);
    }
  }
  const leafByPolygon = new Map(model.render.leaves.map((leaf) => [leaf.polygonId, leaf.id]));
  const skinVertexByIndex = new Map(deformation.vertices.map((vertex) => [
    vertex.vertexIndex,
    vertex,
  ]));

  const skinGeometry = (
    matrices: ReadonlyMap<string, PolyMorphMat4>,
  ): { positions: MutableVec3[]; normals: MutableVec3[] } => {
    const positions: MutableVec3[] = [];
    const normals: MutableVec3[] = [];
    for (let vertexIndex = 0; vertexIndex < basePositions.length; vertexIndex += 1) {
      const skin = skinVertexByIndex.get(vertexIndex)!;
      const position: MutableVec3 = [0, 0, 0];
      const normal: MutableVec3 = [0, 0, 0];
      for (const influence of skin.influences) {
        const matrix = matrices.get(influence.jointId)!;
        const transformedPosition = transformPoint(matrix, basePositions[vertexIndex]!);
        const transformedNormal = transformNormal(
          matrix,
          baseNormals[vertexIndex]!,
          `$.skinMatrices.${influence.jointId}`,
        );
        position[0] += transformedPosition[0] * influence.weight;
        position[1] += transformedPosition[1] * influence.weight;
        position[2] += transformedPosition[2] * influence.weight;
        normal[0] += transformedNormal[0] * influence.weight;
        normal[1] += transformedNormal[1] * influence.weight;
        normal[2] += transformedNormal[2] * influence.weight;
      }
      positions.push(position);
      normals.push(normalize(normal));
    }
    return { positions, normals };
  };

  const restGeometry = skinGeometry(restSkin);
  const restPositions = freezeVectors(restGeometry.positions);
  const restNormals = freezeVectors(restGeometry.normals);
  let priorSkin = new Map(restSkin);
  let lastPositions = restPositions;
  let lastNormals = restNormals;
  const animation = createPolyMorphAnimationRuntime(model);

  const sample = (input: PolyMorphSkinningInput): PolyMorphSkinningFrame => {
    if (!input || !Number.isSafeInteger(input.tick) || input.tick < 0) {
      fail("invalid-tick", "$.tick", "expected a non-negative safe integer");
    }
    const transforms = validateTransforms(input.jointTransforms, jointIdSet);
    const globals = globalMatrices(deformation.joints, transforms);
    const matrices = skinMatrices(deformation.joints, globals);
    const changedJoints = new Set(jointIds.filter((id) =>
      !matricesEqual(matrices.get(id)!, priorSkin.get(id)!)));
    let positions: readonly PolyMorphVec3[] = lastPositions;
    let normals: readonly PolyMorphVec3[] = lastNormals;
    if (changedJoints.size > 0) {
      const geometry = skinGeometry(matrices);
      positions = freezeVectors(geometry.positions);
      normals = freezeVectors(geometry.normals);
    }
    const dirtyVertices = new Set<number>();
    if (changedJoints.size > 0) {
      for (const vertex of deformation.vertices) {
        if (vertex.influences.some((influence) => changedJoints.has(influence.jointId))) {
          dirtyVertices.add(vertex.vertexIndex);
        }
      }
    }
    const dirtyLeafSet = new Set<string>();
    for (const vertexIndex of dirtyVertices) {
      for (const polygonId of polygonsByVertex.get(vertexIndex) ?? []) {
        const leafId = leafByPolygon.get(polygonId);
        if (leafId) dirtyLeafSet.add(leafId);
      }
    }
    const dirtyLeafIds = model.render.leaves
      .map((leaf) => leaf.id)
      .filter((id) => dirtyLeafSet.has(id));
    const leafUpdates = dirtyLeafIds.map((leafId): PolyMorphLeafUpdate => {
      const prepared = computePolyMorphPreparedLeafMatrix(
        compiledLeaves.get(leafId)!,
        positions,
      );
      return {
        leafId,
        visible: prepared.visible,
        ...(prepared.matrix ? { matrix: prepared.matrix } : {}),
      };
    });
    lastPositions = positions;
    lastNormals = normals;
    priorSkin = new Map(matrices);
    return {
      tick: input.tick,
      positions,
      normals,
      globalJointMatrices: globals,
      skinMatrices: matrices,
      dirtyLeafIds: Object.freeze(dirtyLeafIds),
      leafUpdates: Object.freeze(leafUpdates),
      runtimePolygonConstructions: 0,
      runtimeTopologyConstructions: 0,
      atlasRedraws: 0,
    };
  };

  return Object.freeze({
    model,
    jointIds: Object.freeze(jointIds),
    basePositions: Object.freeze(basePositions),
    baseNormals: Object.freeze(baseNormals),
    sample,
    sampleClip(clipId: string, timeMs: number, tick: number): PolyMorphSkinningFrame {
      const animationFrame = animation.sample(clipId, timeMs);
      return sample({ tick, jointTransforms: animationFrame.jointTransforms });
    },
    reset(): void {
      priorSkin = new Map(restSkin);
      lastPositions = restPositions;
      lastNormals = restNormals;
    },
  });
}
