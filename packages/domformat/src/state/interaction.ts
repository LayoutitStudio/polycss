import { invariant } from "../errors.js";
import { checkedF32, cssNumber } from "./numeric.js";
import { preparedTriangleTransform } from "./triangle.js";
import type { DomBindingChannel, DomBindings, DomState, DomStateChannel } from "../public-types.js";
import type { MountedTree } from "../retained-dom.js";
import type {
  InteractionAnimator,
  InteractionClosure,
  InteractionInputContract,
  InteractionPacket,
  InteractionParameters,
  InteractionProjection,
  InteractionTargets,
} from "../schema.js";
import type { MaterializedPolycssState, PolycssPlayback } from "./polycss.js";

type Vec3 = readonly [number, number, number];
type Matrix4 = readonly number[];

interface PointerPosition {
  readonly x: number;
  readonly y: number;
}

interface NormalizedSample {
  readonly stickX: number;
  readonly stickY: number;
  readonly buttonMask: number;
  readonly pointer: PointerPosition | null;
}

interface ControlState {
  readonly frame: number;
  readonly buttonMask: number;
  readonly stickX: number;
  readonly stickY: number;
  readonly csrX: number;
  readonly csrY: number;
  readonly dragStartX: number;
  readonly dragStartY: number;
  readonly dragStartFrame: number;
  readonly trgR: number;
  readonly dragging: number;
  readonly startedDragging: number;
  readonly cursorVisible: number;
}

interface AnimatorState {
  readonly state: number;
  readonly frame: number;
  readonly nods: number;
  readonly stillTimer: number;
}

interface ActiveControl {
  readonly index: number;
  readonly selected: boolean;
  readonly matrix: Matrix4;
  readonly velocity: Vec3;
  readonly flags: number;
}

interface Movement {
  readonly index: number;
  readonly control: ControlState;
  readonly matrix: Matrix4;
  readonly velocity: Vec3;
  readonly flags: number;
  readonly snapped: boolean;
  readonly offset: Vec3;
}

interface VertexBuffer {
  readonly row: number;
  readonly shapeIndex: number;
  readonly sourceVertexIndex: number;
  readonly position: [number, number, number];
}

interface ShapeMatrixBuffer {
  readonly shapeIndex: number;
  readonly matrix: number[];
}

interface ControlBuffer {
  readonly vertices: VertexBuffer[];
  readonly shapeMatrices: ShapeMatrixBuffer[];
}

interface BoundInteractionTargets {
  readonly shapes: readonly HTMLElement[];
  readonly leaves: readonly HTMLElement[];
  readonly cursorLayer: HTMLElement;
  readonly cursorStates: Readonly<{ open: HTMLElement; closed: HTMLElement }>;
}

interface InteractionPresentation {
  readonly sourceWidth: number;
  readonly sourceHeight: number;
  readonly fitWidth: number;
  readonly fitHeight: number;
}

interface InteractionOptions {
  readonly boundTargets?: ReadonlyMap<string, Readonly<{ targets: unknown }>>;
  readonly presentation?: InteractionPresentation;
  readonly viewportWidth?: number;
  readonly viewportHeight?: number;
}

type InteractionBinding = DomBindingChannel & Readonly<{
  targets: InteractionTargets;
  parameters: InteractionParameters;
}>;

type InteractionPlayback = Pick<
  PolycssPlayback,
  "seek" | "applySurfaceFrame" | "forceVisible" | "applyInteractionLeaf" | "restoreInteraction"
>;

interface InteractionPublication {
  readonly sourceFrame: number;
  readonly control: ControlState;
  readonly selectedId: string | null;
  readonly selectedMatrix: Matrix4 | null;
  readonly publications: readonly Readonly<{
    controlId: string;
    closure: InteractionClosure;
    vertices: readonly VertexBuffer[];
    shapeMatrices: readonly ShapeMatrixBuffer[];
  }>[];
  readonly safeVisibleLeaves: Uint16Array;
}

export interface PolycssInteraction {
  readonly control: ControlState;
  readonly playback: boolean;
  readonly settling: boolean;
  readonly ticks: number;
  inspect(): Readonly<{
    ticks: number;
    sourceFrame: number;
    animatorState: number;
    selectedId: string | null;
    settling: boolean;
    cursor: readonly [number, number];
  }>;
  invalidatePublication(): void;
  restore(): Readonly<{ shapeIndices: readonly number[]; leafIndices: readonly number[] }>;
  publishInitial(): InteractionPublication;
  step(value?: unknown): InteractionPublication;
  destroy(): void;
}

const f32 = (value: number): number => checkedF32(value, "INVALID_INTERACTION_PUBLICATION", "Prepared interaction result");
const add = (left: number, right: number): number => f32(f32(left) + f32(right));
const sub = (left: number, right: number): number => f32(f32(left) - f32(right));
const mul = (left: number, right: number): number => f32(f32(left) * f32(right));
const div = (left: number, right: number): number => f32(f32(left) / f32(right));

function vector(x: number, y: number, z: number): Vec3 {
  return Object.freeze([f32(x), f32(y), f32(z)]);
}

function matrix(values: ArrayLike<number>, offset = 0): Matrix4 {
  return Object.freeze(Array.from({ length: 16 }, (_, index) => f32(values[offset + index])));
}

function position(value: ArrayLike<number>): Vec3 {
  return vector(value[12], value[13], value[14]);
}

function withPosition(value: readonly number[], next: Vec3): Matrix4 {
  const output = [...value];
  output[12] = next[0];
  output[13] = next[1];
  output[14] = next[2];
  return Object.freeze(output);
}

function transform(value: Vec3, source: ArrayLike<number>, translate: boolean): Vec3 {
  const component = (column: number): number => {
    let result = mul(source[column], value[0]);
    result = add(result, mul(source[4 + column], value[1]));
    result = add(result, mul(source[8 + column], value[2]));
    if (translate) result = add(result, source[12 + column]);
    return result;
  };
  return vector(component(0), component(1), component(2));
}

function magnitude(value: Vec3): number {
  let squared = mul(value[0], value[0]);
  squared = add(squared, mul(value[1], value[1]));
  squared = add(squared, mul(value[2], value[2]));
  const input = f32(squared);
  return input < 1e-7 ? 0 : f32(Math.sqrt(input));
}

function normalize(value: Vec3): Vec3 {
  const size = magnitude(value);
  return size === 0
    ? vector(0, 0, 0)
    : vector(div(value[0], size), div(value[1], size), div(value[2], size));
}

function multiplyMatrices(left: ArrayLike<number>, right: ArrayLike<number>): Matrix4 {
  const output = new Array(16);
  for (let row = 0; row < 4; row += 1) {
    for (let column = 0; column < 4; column += 1) {
      let value = mul(left[row * 4], right[column]);
      value = add(value, mul(left[row * 4 + 1], right[4 + column]));
      value = add(value, mul(left[row * 4 + 2], right[8 + column]));
      value = add(value, mul(left[row * 4 + 3], right[12 + column]));
      output[row * 4 + column] = value;
    }
  }
  return Object.freeze(output);
}

function translated(source: readonly number[], offset: Vec3): Matrix4 {
  const output = [...source];
  output[12] = add(output[12], offset[0]);
  output[13] = add(output[13], offset[1]);
  output[14] = add(output[14], offset[2]);
  return Object.freeze(output);
}

function projected(value: Vec3, view: ArrayLike<number>, projection: InteractionProjection): Vec3 {
  const camera = transform(value, view, true);
  invariant(Math.abs(camera[2]) > 1e-6, "INVALID_INTERACTION_PUBLICATION", "Prepared interaction projection crosses the camera plane.");
  const xScale = f32(projection.scale / f32(-camera[2]));
  const yScale = f32(projection.scale / camera[2]);
  return vector(
    add(mul(camera[0], xScale), projection.origin[0]),
    add(mul(camera[1], yScale), projection.origin[1]),
    camera[2],
  );
}

function bool(value: unknown): number {
  return value ? 1 : 0;
}

function initialControl(input: InteractionInputContract): ControlState {
  return Object.freeze({
    frame: 0,
    buttonMask: 0,
    stickX: 0,
    stickY: 0,
    csrX: input.cursorInitial[0],
    csrY: input.cursorInitial[1],
    dragStartX: 0,
    dragStartY: 0,
    dragStartFrame: (-1000) >>> 0,
    trgR: 0,
    dragging: 0,
    startedDragging: 0,
    cursorVisible: 0,
  });
}

function stepControl(previous: ControlState, sample: NormalizedSample, contract: InteractionInputContract): ControlState {
  const positioned = sample.pointer
    ? { ...previous, csrX: sample.pointer.x, csrY: sample.pointer.y }
    : previous;
  const dragging = bool((sample.buttonMask & contract.grabButton) !== 0);
  const startedDragging = bool(dragging === 1 && positioned.dragging === 0);
  let dragStartX = positioned.dragStartX;
  let dragStartY = positioned.dragStartY;
  let dragStartFrame = positioned.dragStartFrame;
  if (startedDragging) {
    dragStartX = positioned.csrX;
    dragStartY = positioned.csrY;
  }
  if (dragging) dragStartFrame = positioned.frame;
  const frame = (positioned.frame + 1) >>> 0;
  let csrX = positioned.csrX;
  let csrY = positioned.csrY;
  if (Math.abs(sample.stickX) >= contract.stickDeadzone) csrX = Math.trunc(csrX + sample.stickX * contract.stickScale);
  if (Math.abs(sample.stickY) >= contract.stickDeadzone) csrY = Math.trunc(csrY - sample.stickY * contract.stickScale);
  csrX = Math.max(contract.cursorBounds[0], Math.min(contract.cursorBounds[1], csrX));
  csrY = Math.max(contract.cursorBounds[2], Math.min(contract.cursorBounds[3], csrY));
  return Object.freeze({
    frame,
    buttonMask: sample.buttonMask,
    stickX: sample.stickX,
    stickY: sample.stickY,
    csrX,
    csrY,
    dragStartX,
    dragStartY,
    dragStartFrame,
    trgR: bool((sample.buttonMask & contract.holdButton) !== 0),
    dragging,
    startedDragging,
    cursorVisible: bool(((frame - dragStartFrame) >>> 0) < contract.cursorVisibleTicks),
  });
}

function mirrorStick(value: number): number {
  if (value === -128) return 127;
  if (value === 127) return -128;
  return -value;
}

function mirrorControl(value: ControlState, input: InteractionInputContract): ControlState {
  const x = (coordinate: number): number => Math.max(input.cursorBounds[0], Math.min(input.cursorBounds[1], input.mirrorX - coordinate));
  return Object.freeze({
    ...value,
    stickX: mirrorStick(value.stickX),
    csrX: x(value.csrX),
    dragStartX: x(value.dragStartX),
  });
}

function sourceSample(sample: NormalizedSample, input: InteractionInputContract): NormalizedSample {
  return Object.freeze({
    stickX: Math.max(input.stickRange[0], Math.min(input.stickRange[1], mirrorStick(sample.stickX))),
    stickY: sample.stickY,
    buttonMask: sample.buttonMask,
    pointer: sample.pointer
      ? Object.freeze({
          x: Math.max(input.cursorBounds[0], Math.min(input.cursorBounds[1], input.mirrorX - sample.pointer.x)),
          y: sample.pointer.y,
        })
      : null,
  });
}

function stepAnimator(previous: AnimatorState, control: ControlState, config: InteractionAnimator): AnimatorState {
  let state: number | null = null;
  let frame = previous.frame;
  let nods = previous.nods;
  let stillTimer = previous.stillTimer;
  if (previous.state === config.dozeState) {
    if (control.dragging === 1) {
      state = config.convergeState;
    } else {
      frame = add(frame, 1);
      if (frame === config.dozeLoopEndFrame) {
        frame = config.dozeLoopStartFrame;
        nods -= 1;
        if (nods === 0) state = config.sleepState;
      }
    }
  } else if (previous.state === config.sleepState) {
    frame = add(frame, 1);
    if (frame === config.sleepEndFrame) {
      frame = config.wakeStartFrame;
      state = config.wakeState;
    }
  } else if (previous.state === config.wakeState) {
    frame = add(frame, 1);
    if (frame === config.eyeFrame) {
      frame = config.eyeFrame + 1;
      state = config.dozeState;
      nods = config.dozeLoopCount;
    }
  } else if (previous.state === config.convergeState) {
    if (frame === config.eyeFrame) state = config.eyeState;
    else if (frame > config.eyeFrame) frame = sub(frame, 1);
    else frame = add(frame, 1);
    stillTimer = config.convergeStillTicks;
  } else if (previous.state === config.eyeState) {
    if (control.dragging === 1) stillTimer = config.eyeStillTicks;
    else if (control.dragging === 0) {
      stillTimer -= 1;
      if (stillTimer === 0) state = config.exitEyeState;
    }
    frame = config.eyeFrame;
  } else if (previous.state === config.exitEyeState) {
    state = config.dozeState;
    nods = config.dozeLoopCount;
  }
  return Object.freeze({ state: state ?? previous.state, frame, nods, stillTimer });
}

function initialMatrix(packet: InteractionPacket, index: number): Matrix4 {
  const source = packet.controls[index].sourcePosition;
  return Object.freeze([
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    f32(source[0]), f32(source[1]), f32(source[2]), 1,
  ]);
}

function offsetFrom(packet: InteractionPacket, index: number, value: ArrayLike<number>): Vec3 {
  const start = packet.controls[index].sourcePosition;
  return vector(sub(value[12], start[0]), sub(value[13], start[1]), sub(value[14], start[2]));
}

function moveGrab(packet: InteractionPacket, active: ActiveControl, parsed: ControlState): Movement {
  const spring = packet.source.spring;
  const start = packet.controls[active.index].sourcePosition;
  let current = active.matrix;
  let currentPosition = position(current);
  let offset = offsetFrom(packet, active.index, current);
  let velocity = active.velocity;
  let flags = active.flags;
  let snapped = false;
  if (active.selected) {
    velocity = vector(
      mul(offset[0], spring.pickedResistance),
      mul(offset[1], spring.pickedResistance),
      mul(offset[2], spring.pickedResistance),
    );
    flags |= spring.grabbedFlag;
  } else if (parsed.trgR === 0) {
    velocity = vector(
      mul(sub(velocity[0], mul(offset[0], spring.releaseAcceleration)), spring.velocityDecay),
      mul(sub(velocity[1], mul(offset[1], spring.releaseAcceleration)), spring.velocityDecay),
      mul(sub(velocity[2], mul(offset[2], spring.releaseAcceleration)), spring.velocityDecay),
    );
    const speed = add(add(Math.abs(velocity[0]), Math.abs(velocity[1])), Math.abs(velocity[2]));
    const distance = add(add(Math.abs(offset[0]), Math.abs(offset[1])), Math.abs(offset[2]));
    if (speed < spring.snapVelocityL1 && distance < spring.snapOffsetL1) {
      velocity = vector(0, 0, 0);
      currentPosition = vector(start[0], start[1], start[2]);
      current = withPosition(current, currentPosition);
      offset = vector(0, 0, 0);
      snapped = true;
    }
    flags &= ~spring.grabbedFlag;
  } else velocity = vector(0, 0, 0);
  currentPosition = vector(
    add(currentPosition[0], velocity[0]),
    add(currentPosition[1], velocity[1]),
    add(currentPosition[2], velocity[2]),
  );
  current = withPosition(current, currentPosition);
  const control = active.selected
    ? Object.freeze({
        ...parsed,
        csrX: Math.trunc(parsed.csrX - (parsed.csrX - parsed.dragStartX) * spring.cursorResistance),
        csrY: Math.trunc(parsed.csrY - (parsed.csrY - parsed.dragStartY) * spring.cursorResistance),
      })
    : parsed;
  offset = offsetFrom(packet, active.index, current);
  return Object.freeze({ index: active.index, control, matrix: current, velocity, flags, snapped, offset });
}

function pick(
  packet: InteractionPacket,
  control: ControlState,
  movement: Movement | null,
  grabIndices: readonly number[],
  view: Matrix4,
): Readonly<{ index: number | null; snap: Vec3 | null }> {
  const camera = packet.source.cameraWorldPosition;
  const hits: { index: number; screen: Vec3; distance: number }[] = [];
  for (const index of grabIndices) {
    const definition = packet.controls[index];
    let screen = vector(definition.screenPosition[0], definition.screenPosition[1], 0);
    let distance = definition.cameraDistance;
    if (movement?.index === index) {
      const world = position(movement.matrix);
      screen = projected(world, view, packet.source.projection);
      distance = magnitude(vector(sub(world[0], camera[0]), sub(world[1], camera[1]), sub(world[2], camera[2])));
    }
    if (Math.abs(control.csrX - screen[0]) < packet.input.hitRadius
      && Math.abs(control.csrY - screen[1]) < packet.input.hitRadius) {
      hits.push({ index, screen, distance });
    }
  }
  let selectedHit: { index: number; screen: Vec3; distance: number } | null = null;
  let nearest = f32(10_000_000);
  for (const hit of hits) {
    if (hit.distance < nearest) {
      nearest = hit.distance;
      selectedHit = hit;
    }
  }
  return Object.freeze({ index: selectedHit?.index ?? null, snap: selectedHit?.screen ?? null });
}

function applyGrab(
  packet: InteractionPacket,
  previous: ActiveControl | null,
  movement: Movement | null,
  input: ControlState,
  grabIndices: readonly number[],
  view: Matrix4,
): Readonly<{ control: ControlState; active: ActiveControl | null; picked: number | null }> {
  let control = input;
  let selected = previous?.selected ? previous.index : null;
  let picked: number | null = null;
  if (control.dragging === 0) selected = null;
  else if (control.startedDragging === 1) {
    const hit = pick(packet, control, movement, grabIndices, view);
    selected = hit.index;
    picked = hit.index;
    if (selected !== null && hit.snap) {
      const x = Math.trunc(hit.snap[0]);
      const y = Math.trunc(hit.snap[1]);
      control = Object.freeze({ ...control, csrX: x, csrY: y, dragStartX: x, dragStartY: y });
    }
  }
  let nextMatrix: Matrix4 | null = null;
  if (selected !== null) {
    nextMatrix = movement?.index === selected ? movement.matrix : initialMatrix(packet, selected);
    const displacement = transform(
      vector(
        mul(control.csrX - control.dragStartX, packet.source.displacementMagnitude),
        mul(-(control.csrY - control.dragStartY), packet.source.displacementMagnitude),
        0,
      ),
      matrix(packet.source.inverseCameraMatrix),
      false,
    );
    nextMatrix = withPosition(nextMatrix, vector(
      add(nextMatrix[12], displacement[0]),
      add(nextMatrix[13], displacement[1]),
      add(nextMatrix[14], displacement[2]),
    ));
  }
  let active: ActiveControl | null = null;
  if (selected !== null && nextMatrix) {
    active = Object.freeze({
      index: selected,
      selected: true,
      matrix: nextMatrix,
      velocity: movement?.index === selected ? movement.velocity : vector(0, 0, 0),
      flags: movement?.index === selected ? movement.flags : 0,
    });
  } else if (movement && !movement.snapped) {
    active = Object.freeze({
      index: movement.index,
      selected: false,
      matrix: movement.matrix,
      velocity: movement.velocity,
      flags: movement.flags,
    });
  }
  return Object.freeze({ control, active, picked });
}

function reconstruct(closure: InteractionClosure, row: number, offset: Vec3, target: [number, number, number]): void {
  const weightOffset = closure.vertexRows[row * 4 + 2];
  const weightCount = closure.vertexRows[row * 4 + 3];
  target[0] = f32(closure.vertexPositions[row * 3]);
  target[1] = f32(closure.vertexPositions[row * 3 + 1]);
  target[2] = f32(closure.vertexPositions[row * 3 + 2]);
  for (let index = weightOffset; index < weightOffset + weightCount; index += 1) {
    const active = closure.weightActiveFlags[index] === 1;
    for (let component = 0; component < 3; component += 1) {
      const translation = add(
        closure.weightBaseTranslations[index * 3 + component],
        active ? offset[component] : 0,
      );
      const contribution = add(closure.weightLinearContributions[index * 3 + component], translation);
      target[component] = add(target[component], mul(contribution, closure.weightScalars[index]));
    }
  }
}

function sourceMatrixTransform(value: readonly number[]): string {
  const identity = value.every((entry: number, index: number) => entry === (index % 5 === 0 ? 1 : 0));
  if (identity) return "";
  const order = [2, 0, 1, 3];
  return `matrix3d(${order.flatMap((row) => order.map((column) => value[row * 4 + column])).join(",")})`;
}

function createBuffers(packet: InteractionPacket): ControlBuffer[] {
  return packet.controls.map((definition) => {
    const closure = definition.closure;
    return {
      vertices: Array.from({ length: closure.vertexRows.length / 4 }, (_, row) => ({
        row,
        shapeIndex: closure.vertexRows[row * 4],
        sourceVertexIndex: closure.vertexRows[row * 4 + 1],
        position: [0, 0, 0] as [number, number, number],
      })),
      shapeMatrices: closure.shapeIndices.map((shapeIndex) => ({ shapeIndex, matrix: new Array<number>(16).fill(0) })),
    };
  });
}

function normalizeSample(value: unknown, packet: InteractionPacket): NormalizedSample {
  const sample = (value ?? {}) as Readonly<{
    stickX?: unknown;
    stickY?: unknown;
    pressed?: unknown;
    hold?: unknown;
    pointer?: unknown;
  }>;
  const stickX = sample.stickX ?? 0;
  const stickY = sample.stickY ?? 0;
  invariant(typeof stickX === "number" && typeof stickY === "number" && Number.isFinite(stickX) && Number.isFinite(stickY), "INVALID_INTERACTION_INPUT", "Interaction axes must be finite.");
  invariant(stickX >= packet.input.stickRange[0] && stickX <= packet.input.stickRange[1]
    && stickY >= packet.input.stickRange[0] && stickY <= packet.input.stickRange[1], "INVALID_INTERACTION_INPUT", "Interaction axes exceed their declared range.");
  invariant(typeof (sample.pressed ?? false) === "boolean" && typeof (sample.hold ?? false) === "boolean", "INVALID_INTERACTION_INPUT", "Interaction buttons must be boolean.");
  let pointer: PointerPosition | null = null;
  const pointerCandidate = sample.pointer ?? null;
  if (pointerCandidate !== null) {
    invariant(pointerCandidate && typeof pointerCandidate === "object", "INVALID_INTERACTION_INPUT", "Interaction pointer coordinates must be finite.");
    const pointerValue = pointerCandidate as Readonly<{ x?: unknown; y?: unknown }>;
    invariant(typeof pointerValue.x === "number" && typeof pointerValue.y === "number" && Number.isFinite(pointerValue.x) && Number.isFinite(pointerValue.y), "INVALID_INTERACTION_INPUT", "Interaction pointer coordinates must be finite.");
    invariant(packet.input.pointerQuantization === "trunc-toward-zero-then-clamp", "INVALID_INTERACTION_INPUT", "Interaction pointer quantization is unsupported.");
    pointer = Object.freeze({
      x: Math.max(packet.input.cursorBounds[0], Math.min(packet.input.cursorBounds[1], Math.trunc(pointerValue.x))),
      y: Math.max(packet.input.cursorBounds[2], Math.min(packet.input.cursorBounds[3], Math.trunc(pointerValue.y))),
    });
  }
  return Object.freeze({
    stickX,
    stickY,
    buttonMask: (sample.pressed === true ? packet.input.grabButton : 0) | (sample.hold === true ? packet.input.holdButton : 0),
    pointer,
  });
}

function publishCursor(
  control: ControlState,
  binding: InteractionBinding,
  mounted: Pick<MountedTree, "byId" | "host">,
  options: InteractionOptions,
  bound: BoundInteractionTargets | undefined,
): void {
  const layer = bound?.cursorLayer ?? mounted.byId.get(binding.targets.cursorLayer);
  const open = bound?.cursorStates?.open ?? mounted.byId.get(binding.targets.cursorStates.open);
  const closed = bound?.cursorStates?.closed ?? mounted.byId.get(binding.targets.cursorStates.closed);
  const presentation = options.presentation;
  if (!layer || !open || !closed || !presentation || !mounted.host) return;
  const width = mounted.host.clientWidth || options.viewportWidth || presentation.sourceWidth;
  const height = mounted.host.clientHeight || options.viewportHeight || presentation.sourceHeight;
  const scale = Math.min(width / presentation.fitWidth, height / presentation.fitHeight);
  const offsetX = (width - presentation.sourceWidth * scale) / 2;
  const offsetY = (height - presentation.sourceHeight * scale) / 2;
  layer.style.transform = `translate3d(${cssNumber(offsetX + control.csrX * scale)}px, ${cssNumber(offsetY + control.csrY * scale)}px, 0) scale(${cssNumber(scale)})`;
  open.style.visibility = control.dragging === 1 ? "hidden" : "visible";
  closed.style.visibility = control.dragging === 1 ? "visible" : "hidden";
}

export function createPolycssInteraction(
  state: DomState | MaterializedPolycssState,
  bindings: DomBindings,
  mounted: Pick<MountedTree, "byId" | "host">,
  playback: InteractionPlayback,
  options: InteractionOptions = {},
): PolycssInteraction {
  const stateChannels: Iterable<DomStateChannel> = state.channels instanceof Map
    ? state.channels.values()
    : state.channels;
  const stateChannel = [...stateChannels].find((channel) => channel.codec === "polycss-pointer-grab-prepared@0");
  const bindingCandidate = bindings.channels.find((channel) => channel.interpreter === "polycss-pointer-grab@0");
  invariant(stateChannel && bindingCandidate?.status === "executable", "MISSING_POLYCSS_BINDING", "Executable prepared interaction state and binding are required.");
  invariant(playback
    && typeof playback.applySurfaceFrame === "function"
    && typeof playback.forceVisible === "function"
    && typeof playback.applyInteractionLeaf === "function"
    && typeof playback.restoreInteraction === "function", "MISSING_POLYCSS_BINDING", "Prepared interaction requires the surface publication interface.");
  const binding = bindingCandidate as InteractionBinding;
  const packet = (stateChannel.data as unknown as Readonly<{ packet: InteractionPacket }>).packet;
  const bound = options.boundTargets?.get(binding.id)?.targets as BoundInteractionTargets | undefined;
  const shapeCandidates = bound?.shapes ?? binding.targets.shapes.map((id) => mounted.byId.get(id));
  const leafCandidates = bound?.leaves ?? binding.targets.leaves.map((id) => mounted.byId.get(id));
  invariant(shapeCandidates.every(Boolean) && leafCandidates.every(Boolean), "MISSING_TARGET_NODE", "Interaction targets are not mounted.");
  const shapes = shapeCandidates as readonly HTMLElement[];
  const leaves = leafCandidates as readonly HTMLElement[];
  const buffers = createBuffers(packet);
  const view = matrix(packet.source.cameraViewMatrix);
  const grabIndices = packet.controls.map((definition, index) => definition.mode === "grab" ? index : -1).filter((index) => index >= 0);
  const eyeIndices = packet.controls.map((definition, index) => definition.mode === "eye-follow" ? index : -1).filter((index) => index >= 0);
  const coordinates = Array.from({ length: packet.leaves.length }, () => new Float64Array(9));
  const coordinatesReady = new Uint8Array(packet.leaves.length);
  const modifiedShapes = new Set<number>();
  const modifiedLeaves = new Set<number>();
  let control = mirrorControl(initialControl(packet.input), packet.input);
  let active: ActiveControl | null = null;
  let animator: AnimatorState = Object.freeze({
    state: packet.animator.eyeState,
    frame: packet.animator.eyeFrame,
    nods: packet.animator.dozeLoopCount,
    stillTimer: packet.animator.eyeStillTicks,
  });
  let ticks = 0;
  let destroyed = false;

  const resetProgram = (restore: boolean): void => {
    const display = mirrorControl(control, packet.input);
    playback.seek(packet.animator.eyeFrame);
    playback.forceVisible(new Uint16Array(0));
    if (restore) {
      playback.restoreInteraction(
        [...modifiedShapes].sort((left, right) => left - right),
        [...modifiedLeaves].sort((left, right) => left - right),
      );
      modifiedShapes.clear();
      modifiedLeaves.clear();
    }
    coordinatesReady.fill(0);
    control = mirrorControl(display, packet.input);
    active = null;
    animator = Object.freeze({
      state: packet.animator.eyeState,
      frame: packet.animator.eyeFrame,
      nods: packet.animator.dozeLoopCount,
      stillTimer: packet.animator.eyeStillTicks,
    });
  };

  const publish = (controlIndex: number, offset: Vec3) => {
    const definition = packet.controls[controlIndex];
    const closure = definition.closure;
    const buffer = buffers[controlIndex];
    for (const vertex of buffer.vertices) reconstruct(closure, vertex.row, offset, vertex.position);
    for (const output of buffer.shapeMatrices) {
      let source = matrix(packet.shapes.baseMatrices, output.shapeIndex * 16);
      if (definition.mode === "eye-follow") {
        const objectIndex = definition.attachmentObjectIndices[0];
        const rotation = matrix(packet.objects.rotationMatrices, objectIndex * 16);
        source = multiplyMatrices(translated(rotation, offset), matrix(closure.rigidRootInverseMatrix));
      }
      for (let index = 0; index < 16; index += 1) output.matrix[index] = source[index];
      const transformText = sourceMatrixTransform(output.matrix);
      if (shapes[output.shapeIndex].style.transform !== transformText) shapes[output.shapeIndex].style.transform = transformText;
      modifiedShapes.add(output.shapeIndex);
    }
    for (let row = 0; row < closure.leafRows.length; row += 4) {
      const leafIndex = closure.leafRows[row];
      const p0 = buffer.vertices[closure.leafRows[row + 1]]?.position;
      const p1 = buffer.vertices[closure.leafRows[row + 2]]?.position;
      const p2 = buffer.vertices[closure.leafRows[row + 3]]?.position;
      invariant(p0 && p1 && p2, "INVALID_INTERACTION_PUBLICATION", `${definition.id} escaped its prepared leaf closure.`);
      const cached = coordinates[leafIndex];
      const values = [...p0, ...p1, ...p2];
      const changed = coordinatesReady[leafIndex] === 0 || values.some((value, index) => cached[index] !== value);
      if (!changed) continue;
      cached.set(values);
      coordinatesReady[leafIndex] = 1;
      const next = preparedTriangleTransform(packet.leaves[leafIndex], [p0, p1, p2], packet.triangle);
      playback.applyInteractionLeaf(leafIndex, next);
      modifiedLeaves.add(leafIndex);
    }
    return Object.freeze({ controlId: definition.id, closure, vertices: buffer.vertices, shapeMatrices: buffer.shapeMatrices });
  };

  const publishEyes = (eyeControl: ControlState) => {
    const publications: ReturnType<typeof publish>[] = [];
    for (const index of eyeIndices) {
      const eye = packet.controls[index];
      const screen = projected(vector(eye.sourcePosition[0], eye.sourcePosition[1], eye.sourcePosition[2]), view, packet.source.projection);
      let eyeOffset = vector(0, 0, 0);
      if (animator.state === packet.animator.eyeState) {
        eyeOffset = vector(
          mul(sub(eyeControl.csrX, screen[0]), packet.source.eyeGain),
          mul(sub(screen[1], eyeControl.csrY), packet.source.eyeGain),
          0,
        );
        if (magnitude(eyeOffset) > packet.source.eyeMaximumOffset) {
          const direction = normalize(eyeOffset);
          eyeOffset = vector(
            mul(direction[0], packet.source.eyeMaximumOffset),
            mul(direction[1], packet.source.eyeMaximumOffset),
            mul(direction[2], packet.source.eyeMaximumOffset),
          );
        }
      }
      publications.push(publish(index, eyeOffset));
    }
    return publications;
  };

  return Object.freeze({
    get control() { return mirrorControl(control, packet.input); },
    get playback() { return active === null && control.dragging === 0; },
    get settling() { return active !== null && !active.selected && control.dragging === 0; },
    get ticks() { return ticks; },
    inspect() {
      return Object.freeze({
        ticks,
        sourceFrame: animator.frame,
        animatorState: animator.state,
        selectedId: active?.selected ? packet.controls[active.index].id : null,
        settling: active !== null && !active.selected,
        cursor: Object.freeze([mirrorControl(control, packet.input).csrX, mirrorControl(control, packet.input).csrY] as const),
      });
    },
    invalidatePublication() {
      invariant(!destroyed, "INTERACTION_DESTROYED", "Prepared interaction interpreter is destroyed.");
      coordinatesReady.fill(0);
    },
    restore() {
      invariant(!destroyed, "INTERACTION_DESTROYED", "Prepared interaction interpreter is destroyed.");
      const shapeIndices = [...modifiedShapes].sort((left, right) => left - right);
      const leafIndices = [...modifiedLeaves].sort((left, right) => left - right);
      playback.forceVisible(new Uint16Array(0));
      playback.restoreInteraction(shapeIndices, leafIndices);
      modifiedShapes.clear();
      modifiedLeaves.clear();
      coordinatesReady.fill(0);
      return Object.freeze({ shapeIndices: Object.freeze(shapeIndices), leafIndices: Object.freeze(leafIndices) });
    },
    publishInitial() {
      invariant(!destroyed, "INTERACTION_DESTROYED", "Prepared interaction interpreter is destroyed.");
      playback.applySurfaceFrame(animator.frame);
      playback.forceVisible(new Uint16Array(0));
      const publications = publishEyes(control);
      publishCursor(mirrorControl(control, packet.input), binding, mounted, options, bound);
      return Object.freeze({
        sourceFrame: animator.frame,
        control: mirrorControl(control, packet.input),
        selectedId: null,
        selectedMatrix: null,
        publications: Object.freeze(publications),
        safeVisibleLeaves: new Uint16Array(0),
      });
    },
    step(value = {}) {
      invariant(!destroyed, "INTERACTION_DESTROYED", "Prepared interaction interpreter is destroyed.");
      const sample = normalizeSample(value, packet);
      if (active !== null && !active.selected && control.dragging === 0 && sample.buttonMask & packet.input.grabButton) resetProgram(true);
      const parsed = stepControl(control, sourceSample(sample, packet.input), packet.input);
      const sourceFrame = animator.frame;
      animator = stepAnimator(animator, parsed, packet.animator);
      const movement = active ? moveGrab(packet, active, parsed) : null;
      const movedControl = movement?.control ?? parsed;
      const eyeControl = movedControl;
      const grab = applyGrab(packet, active, movement, movedControl, grabIndices, view);
      active = grab.active;
      const grabIndex = movement?.index ?? grab.picked;
      const grabDefinition = grabIndex === null ? null : packet.controls[grabIndex];
      const safeVisibleLeaves = grabDefinition?.mode === "grab"
        && (movement?.offset.some((component) => component !== 0) ?? false)
        ? Uint16Array.from(grabDefinition.closure.safeVisibleLeafIndices)
        : new Uint16Array(0);
      playback.applySurfaceFrame(sourceFrame);
      playback.forceVisible(safeVisibleLeaves);
      const publications = [];
      if (grabIndex !== null) {
        publications.push(publish(
          grabIndex,
          movement && movement.index === grabIndex ? movement.offset : vector(0, 0, 0),
        ));
      }
      publications.push(...publishEyes(eyeControl));
      control = grab.control;
      const displayControl = mirrorControl(control, packet.input);
      const selectedId = active?.selected ? packet.controls[active.index].id : null;
      const selectedMatrix = grabIndex === null
        ? null
        : movement && movement.index === grabIndex ? movement.matrix : initialMatrix(packet, grabIndex);
      publishCursor(displayControl, binding, mounted, options, bound);
      ticks += 1;
      return Object.freeze({
        sourceFrame,
        control: displayControl,
        selectedId,
        selectedMatrix,
        publications: Object.freeze(publications),
        safeVisibleLeaves,
      });
    },
    destroy() { destroyed = true; },
  });
}
