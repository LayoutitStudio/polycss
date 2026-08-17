import { invariant } from "../errors.js";
import { cssNumber } from "./numeric.js";
import type { DomBindings, DomState } from "../public-types.js";
import type { MountedTree } from "../retained-dom.js";

interface OrbitPacket {
  readonly version: number;
  readonly initial: Readonly<{ pitch: number; yaw: number; zoom: number }>;
  readonly ranges: Readonly<{
    pitch: readonly [number, number];
    yaw: readonly [number, number];
    zoom: readonly [number, number];
  }>;
  readonly model: Readonly<{ translation: readonly number[]; scale: readonly number[] }>;
  readonly surface: Readonly<{
    stateCount: number;
    positionDictionary: readonly (readonly number[])[];
    initialPositionIndicesBase64: string;
    transitions: Readonly<{
      offsetsBase64: string;
      leafIndicesBase64: string;
      forwardPositionIndicesBase64: string;
      backwardPositionIndicesBase64: string;
    }>;
  }>;
}

interface OrbitTargets {
  readonly model: string;
  readonly leaves: readonly string[];
}

function integers(value: string, width: 2 | 4): Uint16Array | Uint32Array {
  const source = globalThis.atob(value);
  invariant(source.length % width === 0, "TRUNCATED_ORBIT_STATE", "Prepared orbit table is truncated.");
  const values = width === 2 ? new Uint16Array(source.length / width) : new Uint32Array(source.length / width);
  for (let index = 0; index < values.length; index += 1) {
    let result = 0;
    for (let byte = 0; byte < width; byte += 1) result += source.charCodeAt(index * width + byte) * 2 ** (byte * 8);
    values[index] = result;
  }
  return values;
}

function coordinate(value: number): string {
  return value === 0 ? "0" : `${value}px`;
}

export function formatOrbitPosition(position: readonly number[]): string {
  return `${coordinate(position[0])} ${coordinate(position[1])}`;
}

export function formatOrbitModelTransform(
  model: OrbitPacket["model"],
  pitch: number,
  yaw: number,
  zoom: number,
): string {
  const translation = model.translation.map(cssNumber);
  const scale = model.scale.map((value) => cssNumber(value * zoom));
  return `translate3d(${translation[0]}px, ${translation[1]}px, ${translation[2]}px) rotateX(${cssNumber(pitch)}deg) rotateY(${cssNumber(yaw)}deg) scale3d(${scale[0]}, ${scale[1]}, ${scale[2]})`;
}

export interface PolycssOrbitInput {
  publishInitial(): void;
  setInput(id: "orbit.pitch" | "orbit.yaw" | "orbit.zoom", value: number): number;
  destroy(): void;
}

export function createPolycssOrbitInput(
  state: DomState,
  bindings: DomBindings,
  mounted: MountedTree,
  options: { readonly boundTargets?: ReadonlyMap<string, Readonly<{ targets: unknown }>> } = {},
): PolycssOrbitInput | null {
  const binding = bindings.channels.find((channel) => channel.interpreter === "polycss-orbit-input@0");
  if (!binding) return null;
  const channel = state.channels.find((candidate) => candidate.id === binding.state);
  invariant(channel, "MISSING_POLYCSS_CHANNEL", "Prepared orbit state is absent.");
  const packet = (channel.data as unknown as Readonly<{ packet: OrbitPacket }>).packet;
  const targets = binding.targets as unknown as OrbitTargets;
  const bound = options.boundTargets?.get(binding.id)?.targets as Readonly<{ model?: HTMLElement; leaves?: readonly HTMLElement[] }> | undefined;
  const model = bound?.model ?? mounted.byId.get(targets.model);
  const leaves = bound?.leaves ?? targets.leaves.map((id) => mounted.byId.get(id));
  invariant(model && leaves.every(Boolean), "MISSING_TARGET_NODE", "Prepared orbit target nodes are not mounted.");
  const leafElements = leaves as readonly HTMLElement[];
  const positions = packet.surface.positionDictionary.map(formatOrbitPosition);
  const currentPositions = integers(packet.surface.initialPositionIndicesBase64, 2) as Uint16Array;
  const offsets = integers(packet.surface.transitions.offsetsBase64, 4) as Uint32Array;
  const transitionLeaves = integers(packet.surface.transitions.leafIndicesBase64, 2) as Uint16Array;
  const forwardPositions = integers(packet.surface.transitions.forwardPositionIndicesBase64, 2) as Uint16Array;
  const backwardPositions = integers(packet.surface.transitions.backwardPositionIndicesBase64, 2) as Uint16Array;
  const dirtyFlags = new Uint8Array(leafElements.length);
  const dirtyLeaves = new Uint16Array(leafElements.length);
  const pendingPositions = currentPositions.slice();
  let pitch = packet.initial.pitch;
  let yaw = packet.initial.yaw;
  let zoom = packet.initial.zoom;
  let currentState = 0;
  let published = false;
  let destroyed = false;

  const publishModel = (): void => {
    const transform = formatOrbitModelTransform(packet.model, pitch, yaw, zoom);
    if (model.style.transform !== transform) model.style.transform = transform;
  };
  const collect = (edge: number, values: Uint16Array, count: number): number => {
    let dirtyCount = count;
    for (let cursor = offsets[edge]; cursor < offsets[edge + 1]; cursor += 1) {
      const leaf = transitionLeaves[cursor];
      if (dirtyFlags[leaf] === 0) {
        dirtyFlags[leaf] = 1;
        dirtyLeaves[dirtyCount] = leaf;
        dirtyCount += 1;
      }
      pendingPositions[leaf] = values[cursor];
    }
    return dirtyCount;
  };
  const publishYawSurface = (): void => {
    const normalized = ((yaw % 360) + 360) % 360;
    const nextState = Math.round(normalized * packet.surface.stateCount / 360) % packet.surface.stateCount;
    if (nextState === currentState) return;
    const forwardDistance = (nextState - currentState + packet.surface.stateCount) % packet.surface.stateCount;
    const backwardDistance = (currentState - nextState + packet.surface.stateCount) % packet.surface.stateCount;
    let dirtyCount = 0;
    let stateIndex = currentState;
    if (forwardDistance <= backwardDistance) {
      for (let step = 0; step < forwardDistance; step += 1) {
        stateIndex = (stateIndex + 1) % packet.surface.stateCount;
        dirtyCount = collect(stateIndex, forwardPositions, dirtyCount);
      }
    } else {
      for (let step = 0; step < backwardDistance; step += 1) {
        const edge = stateIndex;
        stateIndex = (stateIndex + packet.surface.stateCount - 1) % packet.surface.stateCount;
        dirtyCount = collect(edge, backwardPositions, dirtyCount);
      }
    }
    const ordered = Array.from(dirtyLeaves.subarray(0, dirtyCount)).sort((left, right) => left - right);
    for (const leaf of ordered) {
      const position = positions[pendingPositions[leaf]];
      if (leafElements[leaf].style.backgroundPosition !== position) leafElements[leaf].style.backgroundPosition = position;
      currentPositions[leaf] = pendingPositions[leaf];
      dirtyFlags[leaf] = 0;
    }
    currentState = nextState;
  };
  const setInput = (id: "orbit.pitch" | "orbit.yaw" | "orbit.zoom", value: number): number => {
    invariant(!destroyed, "MOUNT_DESTROYED", "The prepared orbit input is destroyed.");
    invariant(id === "orbit.pitch" || id === "orbit.yaw" || id === "orbit.zoom", "UNKNOWN_EXTERNAL_INPUT", `External input ${String(id)} is unsupported.`);
    invariant(typeof value === "number" && Number.isFinite(value), "INVALID_EXTERNAL_INPUT", `External input ${id} must be finite.`);
    const range = packet.ranges[id.slice("orbit.".length) as keyof OrbitPacket["ranges"]];
    const next = Math.min(range[1], Math.max(range[0], value));
    if (id === "orbit.pitch") {
      if (pitch === next) return next;
      pitch = next;
    } else if (id === "orbit.yaw") {
      if (yaw === next) return next;
      yaw = next;
    } else {
      if (zoom === next) return next;
      zoom = next;
    }
    publishModel();
    if (id === "orbit.yaw") publishYawSurface();
    return next;
  };

  return Object.freeze({
    publishInitial() {
      invariant(!destroyed, "MOUNT_DESTROYED", "The prepared orbit input is destroyed.");
      if (published) return;
      publishModel();
      for (let index = 0; index < leafElements.length; index += 1) leafElements[index].style.backgroundPosition = positions[currentPositions[index]];
      published = true;
    },
    setInput,
    destroy() { destroyed = true; },
  });
}
