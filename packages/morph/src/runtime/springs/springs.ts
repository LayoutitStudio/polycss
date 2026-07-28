import {
  validatePolyMorphModel,
  type PolyMorphControl,
  type PolyMorphModel,
  type PolyMorphSpring,
} from "../../contracts/index.js";
import { PolyMorphRuntimeError } from "../runtimeError.js";

export interface PolyMorphSpringRuntime {
  readonly model: PolyMorphModel;
  readonly controlIds: readonly string[];
  readonly controls: ReadonlyMap<string, PolyMorphControl>;
  readonly springs: ReadonlyMap<string, PolyMorphSpring>;
}

export interface PolyMorphSpringState {
  readonly tick: number;
  readonly values: Readonly<Record<string, number>>;
  readonly velocities: Readonly<Record<string, number>>;
  readonly atRest: boolean;
}

export interface PolyMorphSpringStepOptions {
  readonly deltaMs: number;
  readonly heldTarget?: Readonly<{ controlId: string; value: number }> | null;
  readonly frozenControlIds?: readonly string[];
}

function fail(code: string, path: string, message: string): never {
  throw new PolyMorphRuntimeError(code, path, message);
}

function integrateSpring(
  displacement: number,
  velocity: number,
  stiffness: number,
  damping: number,
  deltaSeconds: number,
): readonly [number, number] {
  const discriminant = damping * damping - 4 * stiffness;
  const criticalTolerance = 1e-9 * Math.max(1, damping * damping, stiffness);
  if (Math.abs(discriminant) <= criticalTolerance) {
    const decay = damping / 2;
    const slope = velocity + decay * displacement;
    const envelope = Math.exp(-decay * deltaSeconds);
    return [
      envelope * (displacement + slope * deltaSeconds),
      envelope * (velocity - decay * slope * deltaSeconds),
    ];
  }
  if (discriminant < 0) {
    const decay = damping / 2;
    const frequency = Math.sqrt(stiffness - decay * decay);
    const angle = frequency * deltaSeconds;
    const cosine = Math.cos(angle);
    const sine = Math.sin(angle);
    const envelope = Math.exp(-decay * deltaSeconds);
    return [
      envelope * (
        displacement * cosine
        + ((velocity + decay * displacement) / frequency) * sine
      ),
      envelope * (
        velocity * cosine
        - ((decay * velocity + stiffness * displacement) / frequency) * sine
      ),
    ];
  }
  const root = Math.sqrt(discriminant);
  const firstRate = (-damping + root) / 2;
  const secondRate = (-damping - root) / 2;
  const firstWeight = (velocity - secondRate * displacement)
    / (firstRate - secondRate);
  const secondWeight = displacement - firstWeight;
  const firstTerm = firstWeight * Math.exp(firstRate * deltaSeconds);
  const secondTerm = secondWeight * Math.exp(secondRate * deltaSeconds);
  return [
    firstTerm + secondTerm,
    firstRate * firstTerm + secondRate * secondTerm,
  ];
}

export function createPolyMorphSpringRuntime(modelInput: unknown): PolyMorphSpringRuntime {
  const model = validatePolyMorphModel(modelInput);
  const springs = new Map<string, PolyMorphSpring>();
  for (const spring of model.springs) springs.set(spring.controlId, spring);
  return Object.freeze({
    model,
    controlIds: Object.freeze(model.controls.map((control) => control.id)),
    controls: new Map(model.controls.map((control) => [control.id, control])),
    springs,
  });
}

export function createPolyMorphSpringState(
  runtime: PolyMorphSpringRuntime,
  values?: Readonly<Record<string, number>>,
): PolyMorphSpringState {
  const unknown = Object.keys(values ?? {}).find((id) => !runtime.controls.has(id));
  if (unknown) fail("unknown-id", "$.values", unknown);
  const initial = Object.fromEntries(runtime.controlIds.map((id) => {
    const control = runtime.controls.get(id)!;
    const value = values?.[id] ?? control.initial;
    if (!Number.isFinite(value) || value < control.minimum || value > control.maximum) {
      fail("out-of-range", `$.values.${id}`, "value is outside control bounds");
    }
    return [id, value];
  }));
  return Object.freeze({
    tick: -1,
    values: Object.freeze(initial),
    velocities: Object.freeze(Object.fromEntries(runtime.controlIds.map((id) => [id, 0]))),
    atRest: runtime.controlIds.every((id) => initial[id] === runtime.controls.get(id)!.initial),
  });
}

export function stepPolyMorphSprings(
  runtime: PolyMorphSpringRuntime,
  state: PolyMorphSpringState,
  options: PolyMorphSpringStepOptions,
): PolyMorphSpringState {
  if (!state || !Number.isSafeInteger(state.tick) || state.tick < -1) {
    fail("invalid-state", "$.state", "spring state is invalid");
  }
  if (!Number.isFinite(options?.deltaMs) || options.deltaMs <= 0 || options.deltaMs > 1000) {
    fail("invalid-time", "$.deltaMs", "expected 0 < deltaMs <= 1000");
  }
  const held = options.heldTarget ?? null;
  if (held) {
    const control = runtime.controls.get(held.controlId);
    if (!control) fail("unknown-id", "$.heldTarget.controlId", held.controlId);
    if (!Number.isFinite(held.value) || held.value < control.minimum || held.value > control.maximum) {
      fail("out-of-range", "$.heldTarget.value", "value is outside control bounds");
    }
  }
  const frozen = new Set(options.frozenControlIds ?? []);
  for (const id of frozen) {
    if (!runtime.controls.has(id)) fail("unknown-id", "$.frozenControlIds", id);
  }
  const dt = options.deltaMs / 1000;
  const values: Record<string, number> = {};
  const velocities: Record<string, number> = {};
  let atRest = true;
  for (const id of runtime.controlIds) {
    const control = runtime.controls.get(id)!;
    const priorValue = state.values[id] ?? control.initial;
    const priorVelocity = state.velocities[id] ?? 0;
    if (held?.controlId === id) {
      values[id] = held.value;
      velocities[id] = 0;
    } else if (frozen.has(id) || !runtime.springs.has(id)) {
      values[id] = priorValue;
      velocities[id] = 0;
    } else {
      const spring = runtime.springs.get(id)!;
      const displacement = priorValue - control.initial;
      const [nextDisplacement, nextVelocity] = integrateSpring(
        displacement,
        priorVelocity,
        spring.stiffness,
        spring.damping,
        dt,
      );
      let velocity = nextVelocity;
      let value = control.initial + nextDisplacement;
      const clamped = Math.max(control.minimum, Math.min(control.maximum, value));
      if (clamped !== value) velocity = 0;
      value = clamped;
      if (Math.abs(value - control.initial) < 1e-6 && Math.abs(velocity) < 1e-6) {
        value = control.initial;
        velocity = 0;
      }
      values[id] = Object.is(value, -0) ? 0 : value;
      velocities[id] = Object.is(velocity, -0) ? 0 : velocity;
    }
    if (values[id] !== control.initial || velocities[id] !== 0) atRest = false;
  }
  return Object.freeze({
    tick: state.tick + 1,
    values: Object.freeze(values),
    velocities: Object.freeze(velocities),
    atRest,
  });
}
