import {
  validatePolyMorphModel,
  type PolyMorphMat4,
  type PolyMorphPlaybackFrame,
} from "../../contracts/index.js";
import type {
  PolyMorphLeafUpdate,
  PolyMorphRetainedUpdate,
  PolyMorphShapeUpdate,
} from "../../render/index.js";
import { PolyMorphRuntimeError } from "../runtimeError.js";

export interface PolyMorphPreparedShapeState {
  readonly shapeId: string;
  readonly matrix: PolyMorphMat4;
}

export interface PolyMorphPreparedLeafState {
  readonly leafId: string;
  readonly matrix: PolyMorphMat4;
  readonly visible: boolean;
  readonly opacity: number;
  readonly atlasRow: number;
}

export interface PolyMorphPreparedState {
  readonly modelMatrix: PolyMorphMat4;
  readonly shapes: readonly PolyMorphPreparedShapeState[];
  readonly leaves: readonly PolyMorphPreparedLeafState[];
}

export interface PolyMorphPreparedStateDiff {
  readonly update: PolyMorphRetainedUpdate;
  readonly modelChanged: boolean;
  readonly dirtyShapeIds: readonly string[];
  readonly dirtyLeafIds: readonly string[];
}

function fail(code: string, path: string, message: string): never {
  throw new PolyMorphRuntimeError(code, path, message);
}

function cloneMatrix(value: PolyMorphMat4): PolyMorphMat4 {
  return [...value] as unknown as PolyMorphMat4;
}

function matrixEqual(left: PolyMorphMat4, right: PolyMorphMat4): boolean {
  return left.every((value, index) => value === right[index]);
}

export function createPolyMorphPreparedState(modelInput: unknown): PolyMorphPreparedState {
  const model = validatePolyMorphModel(modelInput);
  return Object.freeze({
    modelMatrix: cloneMatrix(model.render.modelMatrix),
    shapes: Object.freeze(model.render.shapes.map((shape) => Object.freeze({
      shapeId: shape.id,
      matrix: cloneMatrix(shape.matrix),
    }))),
    leaves: Object.freeze(model.render.leaves.map((leaf) => Object.freeze({
      leafId: leaf.id,
      matrix: cloneMatrix(leaf.matrix),
      visible: true,
      opacity: 1,
      atlasRow: 0,
    }))),
  });
}

export function applyPolyMorphPlaybackFrame(
  state: PolyMorphPreparedState,
  frame: PolyMorphPlaybackFrame,
): PolyMorphPreparedState {
  const shapeUpdates = new Map(frame.shapes.map((shape) => [shape.shapeId, shape]));
  const leafUpdates = new Map(frame.leaves.map((leaf) => [leaf.leafId, leaf]));
  for (const id of shapeUpdates.keys()) {
    if (!state.shapes.some((shape) => shape.shapeId === id)) {
      fail("unknown-shape", "$.frame.shapes", id);
    }
  }
  for (const id of leafUpdates.keys()) {
    if (!state.leaves.some((leaf) => leaf.leafId === id)) {
      fail("unknown-leaf", "$.frame.leaves", id);
    }
  }
  return Object.freeze({
    modelMatrix: frame.modelMatrix === null
      ? state.modelMatrix
      : cloneMatrix(frame.modelMatrix),
    shapes: Object.freeze(state.shapes.map((shape) => {
      const update = shapeUpdates.get(shape.shapeId);
      return update
        ? Object.freeze({ shapeId: shape.shapeId, matrix: cloneMatrix(update.matrix) })
        : shape;
    })),
    leaves: Object.freeze(state.leaves.map((leaf) => {
      const update = leafUpdates.get(leaf.leafId);
      if (!update) return leaf;
      return Object.freeze({
        leafId: leaf.leafId,
        matrix: update.matrix === null ? leaf.matrix : cloneMatrix(update.matrix),
        visible: update.visible ?? leaf.visible,
        opacity: update.opacity ?? leaf.opacity,
        atlasRow: update.atlasRow ?? leaf.atlasRow,
      });
    })),
  });
}

export function diffPolyMorphPreparedStates(
  previous: PolyMorphPreparedState,
  next: PolyMorphPreparedState,
): PolyMorphPreparedStateDiff {
  if (
    previous.shapes.length !== next.shapes.length
    || previous.leaves.length !== next.leaves.length
  ) {
    fail("state-mismatch", "$", "prepared state topology differs");
  }
  const modelChanged = !matrixEqual(previous.modelMatrix, next.modelMatrix);
  const shapes: PolyMorphShapeUpdate[] = [];
  for (let index = 0; index < next.shapes.length; index += 1) {
    const left = previous.shapes[index]!;
    const right = next.shapes[index]!;
    if (left.shapeId !== right.shapeId) fail("state-mismatch", "$.shapes", "source order differs");
    if (!matrixEqual(left.matrix, right.matrix)) {
      shapes.push({ shapeId: right.shapeId, matrix: right.matrix });
    }
  }
  const leaves: PolyMorphLeafUpdate[] = [];
  for (let index = 0; index < next.leaves.length; index += 1) {
    const left = previous.leaves[index]!;
    const right = next.leaves[index]!;
    if (left.leafId !== right.leafId) fail("state-mismatch", "$.leaves", "source order differs");
    const update: {
      leafId: string;
      matrix?: PolyMorphMat4;
      visible?: boolean;
      opacity?: number;
      atlasRow?: number;
    } = { leafId: right.leafId };
    if (!matrixEqual(left.matrix, right.matrix)) update.matrix = right.matrix;
    if (left.visible !== right.visible) update.visible = right.visible;
    if (left.opacity !== right.opacity) update.opacity = right.opacity;
    if (left.atlasRow !== right.atlasRow) update.atlasRow = right.atlasRow;
    if (Object.keys(update).length > 1) leaves.push(update);
  }
  return Object.freeze({
    update: Object.freeze({
      ...(modelChanged ? { modelMatrix: next.modelMatrix } : {}),
      ...(shapes.length > 0 ? { shapes: Object.freeze(shapes) } : {}),
      ...(leaves.length > 0 ? { leaves: Object.freeze(leaves) } : {}),
    }),
    modelChanged,
    dirtyShapeIds: Object.freeze(shapes.map((shape) => shape.shapeId)),
    dirtyLeafIds: Object.freeze(leaves.map((leaf) => leaf.leafId)),
  });
}
