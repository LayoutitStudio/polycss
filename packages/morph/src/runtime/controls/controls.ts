import {
  validatePolyMorphModel,
  type PolyMorphControl,
  type PolyMorphModel,
  type PolyMorphVec3,
} from "../../contracts/index.js";
import { PolyMorphRuntimeError } from "../runtimeError.js";

export interface PolyMorphControlRuntime {
  readonly model: PolyMorphModel;
  readonly controlIds: readonly string[];
  readonly controls: ReadonlyMap<string, PolyMorphControl>;
}

export interface PolyMorphControlState {
  readonly tick: number;
  readonly active: boolean;
  readonly heldControlId: string | null;
  readonly holdStartPoint: PolyMorphVec3 | null;
  readonly holdStartValue: number;
  readonly values: Readonly<Record<string, number>>;
  readonly frozenControlIds: readonly string[];
}

export interface PolyMorphControlInput {
  readonly point: PolyMorphVec3 | null;
  readonly active: boolean;
  readonly freezeOnRelease?: boolean;
}

export interface PolyMorphControlStep {
  readonly state: PolyMorphControlState;
  readonly pickedControlId: string | null;
  readonly releasedControlId: string | null;
  readonly heldTarget: Readonly<{ controlId: string; value: number }> | null;
}

function fail(code: string, path: string, message: string): never {
  throw new PolyMorphRuntimeError(code, path, message);
}

function point(value: PolyMorphVec3 | null): PolyMorphVec3 | null {
  if (value === null) return null;
  if (
    !Array.isArray(value)
    || value.length !== 3
    || value.some((part) => typeof part !== "number" || !Number.isFinite(part))
  ) {
    fail("invalid-point", "$.point", "expected three finite components or null");
  }
  return [value[0], value[1], value[2]];
}

function normalizedAxis(control: PolyMorphControl): PolyMorphVec3 {
  const length = Math.hypot(...control.axis);
  return [
    control.axis[0] / length,
    control.axis[1] / length,
    control.axis[2] / length,
  ];
}

export function createPolyMorphControlRuntime(modelInput: unknown): PolyMorphControlRuntime {
  const model = validatePolyMorphModel(modelInput);
  return Object.freeze({
    model,
    controlIds: Object.freeze(model.controls.map((control) => control.id)),
    controls: new Map(model.controls.map((control) => [control.id, control])),
  });
}

export function createPolyMorphControlState(
  runtime: PolyMorphControlRuntime,
): PolyMorphControlState {
  return Object.freeze({
    tick: -1,
    active: false,
    heldControlId: null,
    holdStartPoint: null,
    holdStartValue: 0,
    values: Object.freeze(Object.fromEntries(
      runtime.controlIds.map((id) => [id, runtime.controls.get(id)!.initial]),
    )),
    frozenControlIds: Object.freeze([]),
  });
}

export function pickPolyMorphControl(
  runtime: PolyMorphControlRuntime,
  inputPoint: PolyMorphVec3,
): string | null {
  const resolved = point(inputPoint)!;
  let best: { id: string; distance: number } | null = null;
  for (const controlId of runtime.controlIds) {
    const control = runtime.controls.get(controlId)!;
    const distance = Math.hypot(
      resolved[0] - control.anchor[0],
      resolved[1] - control.anchor[1],
      resolved[2] - control.anchor[2],
    );
    if (distance <= control.radius && (!best || distance < best.distance)) {
      best = { id: controlId, distance };
    }
  }
  return best?.id ?? null;
}

export function stepPolyMorphControls(
  runtime: PolyMorphControlRuntime,
  state: PolyMorphControlState,
  input: PolyMorphControlInput,
): PolyMorphControlStep {
  if (!state || !Number.isSafeInteger(state.tick) || state.tick < -1) {
    fail("invalid-state", "$.state", "control state is invalid");
  }
  if (typeof input?.active !== "boolean") fail("invalid-input", "$.active", "expected a boolean");
  const resolvedPoint = point(input.point);
  let heldControlId = state.heldControlId;
  let holdStartPoint = state.holdStartPoint;
  let holdStartValue = state.holdStartValue;
  let pickedControlId: string | null = null;
  let releasedControlId: string | null = null;
  const values = { ...state.values };
  const frozen = new Set(state.frozenControlIds);
  const pressed = input.active && !state.active;
  const released = !input.active && state.active;
  if (pressed && resolvedPoint) {
    heldControlId = pickPolyMorphControl(runtime, resolvedPoint);
    if (heldControlId) {
      pickedControlId = heldControlId;
      holdStartPoint = resolvedPoint;
      holdStartValue = values[heldControlId] ?? runtime.controls.get(heldControlId)!.initial;
      frozen.delete(heldControlId);
    }
  }
  if (input.active && heldControlId && resolvedPoint && holdStartPoint) {
    const control = runtime.controls.get(heldControlId)!;
    const axis = normalizedAxis(control);
    const displacement =
      (resolvedPoint[0] - holdStartPoint[0]) * axis[0]
      + (resolvedPoint[1] - holdStartPoint[1]) * axis[1]
      + (resolvedPoint[2] - holdStartPoint[2]) * axis[2];
    values[heldControlId] = Math.max(
      control.minimum,
      Math.min(control.maximum, holdStartValue + displacement),
    );
  }
  if (released) {
    releasedControlId = heldControlId;
    if (heldControlId) {
      if (input.freezeOnRelease === true) frozen.add(heldControlId);
      else frozen.delete(heldControlId);
    }
    heldControlId = null;
    holdStartPoint = null;
    holdStartValue = 0;
  }
  const next = Object.freeze({
    tick: state.tick + 1,
    active: input.active,
    heldControlId,
    holdStartPoint,
    holdStartValue,
    values: Object.freeze(values),
    frozenControlIds: Object.freeze([...frozen].sort()),
  });
  return Object.freeze({
    state: next,
    pickedControlId,
    releasedControlId,
    heldTarget: input.active && heldControlId
      ? Object.freeze({ controlId: heldControlId, value: values[heldControlId]! })
      : null,
  });
}
