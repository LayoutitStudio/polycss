import { invariant } from "../errors.js";
import { checkedF32, cssNumber } from "./numeric.js";
import type { DomBindings, DomState, DomStateChannel } from "../public-types.js";
import type { MountedTree } from "../retained-dom.js";

const f32 = (value: number): number => checkedF32(value, "INVALID_EFFECT_PUBLICATION", "Prepared effect result");

function sparkleTransform(x: number, y: number, z: number): string {
  return "matrix3d(0,1,0,0,0,0,-1,0,1,0,0,0,"
    + `${cssNumber(z)},${cssNumber(x - 32)},${cssNumber(y + 64)},1)`;
}

interface EffectStarDefinition {
  readonly positions: readonly number[];
  readonly transforms: readonly string[];
  readonly backgroundPositions: readonly string[];
  readonly frameIndices: readonly number[];
}

interface EffectEmitterDefinition {
  readonly mode: "grab" | "follow-star";
  readonly poolSize: number;
  readonly sourceStar: number;
  readonly backgroundPositions: readonly string[];
}

interface EffectPacket {
  readonly frameCount: number;
  readonly stars: readonly EffectStarDefinition[];
  readonly emitters: readonly EffectEmitterDefinition[];
  readonly spawnStream: Readonly<{
    count: number;
    tuples: readonly (readonly [number, number, number, number])[];
  }>;
  readonly particle: Readonly<{
    sparkleFrameTable: readonly number[];
    gravityY: number;
    damping: number;
  }>;
  readonly biases: Readonly<{
    continuous: readonly [number, number, number];
    grab: readonly [number, number, number];
  }>;
}

interface MaterializedState {
  readonly channels: Map<string, DomStateChannel>;
}

interface EffectGrab {
  readonly active: boolean;
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface PolycssEffects {
  readonly sourceFrame: number;
  readonly spawnCursor: number;
  publish(nextFrame: number, grab?: EffectGrab | null): number;
  publishMany(nextFrames: readonly number[]): number;
  inspect(): unknown;
  destroy(): void;
}

interface EffectEmitter {
  readonly definition: EffectEmitterDefinition;
  readonly elements: readonly HTMLElement[];
  readonly activeParticles: Uint8Array;
  readonly visibleParticles: Uint8Array;
  readonly x: Float32Array;
  readonly y: Float32Array;
  readonly z: Float32Array;
  readonly vx: Float32Array;
  readonly vy: Float32Array;
  readonly vz: Float32Array;
  readonly timeout: Float32Array;
  emitterX: number;
  emitterY: number;
  emitterZ: number;
  emitterVx: number;
  emitterVy: number;
  emitterVz: number;
  active: number;
  armed: boolean;
  emitted: boolean;
}

type BoundEffectTargets = Readonly<{
  stars?: readonly HTMLElement[];
  emitters?: readonly (readonly HTMLElement[])[];
}>;

function effectStateChannel(state: MaterializedState | DomState): DomStateChannel | undefined {
  const channels: readonly DomStateChannel[] = state.channels instanceof Map ? [...state.channels.values()] : state.channels;
  return channels.find((channel) => channel.codec === "polycss-effects-prepared@0");
}

export function createPolycssEffects(
  state: MaterializedState | DomState,
  bindings: DomBindings,
  mounted: MountedTree,
  options: { readonly boundTargets?: ReadonlyMap<string, Readonly<{ targets: unknown }>> } = {},
): PolycssEffects {
  const stateChannel = effectStateChannel(state);
  const binding = bindings.channels.find((channel) => channel.interpreter === "polycss-effects@0");
  invariant(stateChannel && binding?.status === "executable", "MISSING_POLYCSS_BINDING", "Executable prepared effects state and binding are required.");
  const packet = stateChannel.data.packet as unknown as EffectPacket;
  const targets = binding.targets as unknown as Readonly<{ stars: readonly string[]; emitters: readonly (readonly string[])[] }>;
  const bound = options.boundTargets?.get(binding.id)?.targets as BoundEffectTargets | undefined;
  const starElements = bound?.stars ?? targets.stars.map((id) => mounted.byId.get(id));
  invariant(starElements.every(Boolean), "MISSING_TARGET_NODE", "Effect star target nodes are not mounted.");
  const mountedStars = starElements as readonly HTMLElement[];
  const starX = new Float64Array(packet.stars.length);
  const starY = new Float64Array(packet.stars.length);
  const starZ = new Float64Array(packet.stars.length);
  const emitters: EffectEmitter[] = packet.emitters.map((definition, emitterIndex) => {
    const elements = bound?.emitters?.[emitterIndex] ?? targets.emitters[emitterIndex].map((id) => mounted.byId.get(id));
    invariant(elements.every(Boolean), "MISSING_TARGET_NODE", `Effect emitter ${emitterIndex} target nodes are not mounted.`);
    const mountedElements = elements as readonly HTMLElement[];
    const timeout = new Float32Array(definition.poolSize);
    timeout.fill(-1);
    return {
      definition,
      elements: mountedElements,
      activeParticles: new Uint8Array(definition.poolSize),
      visibleParticles: new Uint8Array(definition.poolSize),
      x: new Float32Array(definition.poolSize),
      y: new Float32Array(definition.poolSize),
      z: new Float32Array(definition.poolSize),
      vx: new Float32Array(definition.poolSize),
      vy: new Float32Array(definition.poolSize),
      vz: new Float32Array(definition.poolSize),
      timeout,
      emitterX: 0,
      emitterY: 0,
      emitterZ: 0,
      emitterVx: 0,
      emitterVy: 0,
      emitterVz: 0,
      active: 0,
      armed: false,
      emitted: false,
    };
  });
  let sourceFrame = 0;
  let spawnCursor = 0;
  let destroyed = false;
  let deferred = false;
  const pendingStyles = new Map<HTMLElement, Map<string, string>>();

  const writeStyle = (element: HTMLElement, property: string, value: string): void => {
    const style = element.style as CSSStyleDeclaration & Record<string, string>;
    if (!deferred) {
      if (style[property] !== value) style[property] = value;
      return;
    }
    let styles = pendingStyles.get(element);
    const previous = styles?.has(property) ? styles.get(property) : style[property];
    if (previous === value) return;
    if (!styles) {
      styles = new Map();
      pendingStyles.set(element, styles);
    }
    styles.set(property, value);
  };

  const commitStyles = (): void => {
    for (const [element, styles] of pendingStyles) {
      const style = element.style as CSSStyleDeclaration & Record<string, string>;
      for (const [property, value] of styles) {
        if (style[property] !== value) style[property] = value;
      }
    }
    pendingStyles.clear();
  };

  const publishStars = (frameIndex: number): void => {
    for (let index = 0; index < packet.stars.length; index += 1) {
      const definition = packet.stars[index];
      const position = frameIndex * 3;
      starX[index] = definition.positions[position];
      starY[index] = definition.positions[position + 1];
      starZ[index] = definition.positions[position + 2];
      const element = mountedStars[index];
      const transform = definition.transforms[frameIndex];
      writeStyle(element, "transform", transform);
      const backgroundPosition = definition.backgroundPositions[definition.frameIndices[frameIndex]];
      writeStyle(element, "backgroundPosition", backgroundPosition);
    }
  };

  const spawn = (emitter: EffectEmitter, index: number, bias: readonly [number, number, number]): void => {
    const tuple = packet.spawnStream.tuples[spawnCursor];
    spawnCursor = (spawnCursor + 1) % packet.spawnStream.count;
    emitter.x[index] = emitter.emitterX;
    emitter.y[index] = emitter.emitterY;
    emitter.z[index] = emitter.emitterZ;
    emitter.timeout[index] = f32(tuple[0]);
    emitter.vx[index] = f32(tuple[1] + bias[0]);
    emitter.vy[index] = f32(tuple[2] + bias[1]);
    emitter.vz[index] = f32(tuple[3] + bias[2]);
    if (emitter.activeParticles[index] === 0) emitter.active += 1;
    emitter.activeParticles[index] = 1;
  };

  const hideParticle = (emitter: EffectEmitter, index: number): void => {
    emitter.visibleParticles[index] = 0;
    const element = emitter.elements[index];
    writeStyle(element, "visibility", "hidden");
    if (emitter.activeParticles[index] === 0) writeStyle(element, "opacity", "0");
  };

  const publishParticle = (emitter: EffectEmitter, index: number): void => {
    if (emitter.activeParticles[index] === 0 || !(emitter.timeout[index] > 0)) {
      hideParticle(emitter, index);
      return;
    }
    const displayList = Math.trunc(emitter.timeout[index]);
    if (displayList === 0) {
      hideParticle(emitter, index);
      return;
    }
    const element = emitter.elements[index];
    const transform = sparkleTransform(emitter.x[index], emitter.y[index], emitter.z[index]);
    writeStyle(element, "transform", transform);
    const frame = packet.particle.sparkleFrameTable[displayList - 1];
    const backgroundPosition = emitter.definition.backgroundPositions[frame];
    writeStyle(element, "backgroundPosition", backgroundPosition);
    const opacity = cssNumber(f32(emitter.timeout[index] / 10));
    writeStyle(element, "opacity", opacity);
    if (emitter.visibleParticles[index] === 0) {
      emitter.visibleParticles[index] = 1;
      writeStyle(element, "visibility", "visible");
    }
  };

  const advanceParticles = (emitter: EffectEmitter): void => {
    for (let index = 0; index < emitter.definition.poolSize; index += 1) {
      if (emitter.activeParticles[index] === 1) {
        emitter.x[index] = f32(emitter.x[index] + emitter.vx[index]);
        emitter.y[index] = f32(emitter.y[index] + emitter.vy[index]);
        emitter.z[index] = f32(emitter.z[index] + emitter.vz[index]);
        emitter.vy[index] = f32(emitter.vy[index] + packet.particle.gravityY);
        emitter.vx[index] = f32(emitter.vx[index] * packet.particle.damping);
        emitter.vy[index] = f32(emitter.vy[index] * packet.particle.damping);
        emitter.vz[index] = f32(emitter.vz[index] * packet.particle.damping);
        const timeout = emitter.timeout[index];
        emitter.timeout[index] = f32(timeout - 1);
        if (timeout <= 0) {
          emitter.activeParticles[index] = 0;
          emitter.active -= 1;
        }
      }
      publishParticle(emitter, index);
    }
  };

  const positionEmitter = (emitter: EffectEmitter, x: number, y: number, z: number): void => {
    emitter.emitterX = f32(x + emitter.emitterVx);
    emitter.emitterY = f32(y + emitter.emitterVy);
    emitter.emitterZ = f32(z + emitter.emitterVz);
    emitter.emitterVx = f32(emitter.emitterVx * packet.particle.damping);
    emitter.emitterVy = f32(emitter.emitterVy * packet.particle.damping);
    emitter.emitterVz = f32(emitter.emitterVz * packet.particle.damping);
  };

  const publishContinuous = (emitter: EffectEmitter): void => {
    const star = emitter.definition.sourceStar;
    positionEmitter(emitter, starX[star], starY[star], starZ[star]);
    for (let index = 0; index < emitter.definition.poolSize; index += 1) {
      if (emitter.activeParticles[index] === 0) spawn(emitter, index, packet.biases.continuous);
    }
    advanceParticles(emitter);
  };

  const publishGrab = (emitter: EffectEmitter, grabActive: boolean, grabX: number, grabY: number, grabZ: number): void => {
    if (!grabActive && emitter.active === 0) {
      emitter.armed = false;
      emitter.emitted = false;
      for (let index = 0; index < emitter.definition.poolSize; index += 1) hideParticle(emitter, index);
      return;
    }
    emitter.armed = grabActive;
    if (!grabActive) emitter.emitted = false;
    positionEmitter(emitter, grabActive ? grabX : 0, grabActive ? grabY : 0, grabActive ? grabZ : 0);
    if (emitter.armed && !emitter.emitted) {
      for (let index = 0; index < emitter.definition.poolSize; index += 1) {
        if (emitter.activeParticles[index] === 0) spawn(emitter, index, packet.biases.grab);
      }
      emitter.emitted = true;
    }
    advanceParticles(emitter);
  };

  const applyFrame = (nextFrame: number, grab: EffectGrab | null, publish: boolean): number => {
    invariant(Number.isSafeInteger(nextFrame) && nextFrame >= 1 && nextFrame <= packet.frameCount, "FRAME_RANGE", `Prepared effects frame ${nextFrame} is out of range.`);
    const grabActive = grab !== null && grab.active === true;
    if (grab !== null) {
      invariant(grab && typeof grab === "object" && typeof grab.active === "boolean", "INVALID_EFFECT_INPUT", "Prepared grab input is invalid.");
      invariant(Number.isFinite(grab.x) && Number.isFinite(grab.y) && Number.isFinite(grab.z), "INVALID_EFFECT_INPUT", "Prepared grab coordinates must be finite.");
    }
    const frameIndex = nextFrame - 1;
    publishStars(frameIndex);
    for (let index = 0; index < emitters.length; index += 1) {
      const emitter = emitters[index];
      if (emitter.definition.mode === "grab") publishGrab(emitter, grabActive, grab?.x ?? 0, grab?.y ?? 0, grab?.z ?? 0);
      else publishContinuous(emitter);
    }
    sourceFrame = nextFrame;
    if (publish) commitStyles();
    return nextFrame;
  };

  const inspect = () => Object.freeze({
    sourceFrame,
    spawnCursor,
    stars: packet.stars.length,
    emitters: Object.freeze(emitters.map((emitter) => Object.freeze({
      mode: emitter.definition.mode,
      poolSize: emitter.definition.poolSize,
      active: emitter.active,
      visible: emitter.visibleParticles.reduce((sum, value) => sum + value, 0),
    }))),
  });

  return Object.freeze({
    get sourceFrame() { return sourceFrame; },
    get spawnCursor() { return spawnCursor; },
    publish(nextFrame: number, grab: EffectGrab | null = null) {
      invariant(!destroyed, "EFFECTS_DESTROYED", "Prepared effects interpreter is destroyed.");
      return applyFrame(nextFrame, grab, true);
    },
    publishMany(nextFrames: readonly number[]) {
      invariant(!destroyed, "EFFECTS_DESTROYED", "Prepared effects interpreter is destroyed.");
      invariant(Array.isArray(nextFrames) && nextFrames.length > 0, "INVALID_EFFECT_PUBLICATION", "Prepared effects catch-up frames must be a nonempty array.");
      const frames: number[] = [];
      let previous = sourceFrame;
      for (const frame of nextFrames) {
        invariant(Number.isSafeInteger(frame) && frame >= 1 && frame <= packet.frameCount, "FRAME_RANGE", `Prepared effects frame ${frame} is out of range.`);
        if (frame !== previous) frames.push(frame);
        previous = frame;
      }
      deferred = true;
      try {
        for (let index = 0; index < frames.length; index += 1) applyFrame(frames[index], null, index === frames.length - 1);
        return sourceFrame;
      } finally {
        deferred = false;
        pendingStyles.clear();
      }
    },
    inspect,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      deferred = false;
      pendingStyles.clear();
      for (const element of mountedStars) element.style.visibility = "hidden";
      for (const emitter of emitters) {
        emitter.active = 0;
        emitter.armed = false;
        emitter.emitted = false;
        emitter.activeParticles.fill(0);
        emitter.visibleParticles.fill(0);
        emitter.timeout.fill(-1);
        for (const element of emitter.elements) {
          element.style.visibility = "hidden";
          element.style.opacity = "0";
        }
      }
    },
  });
}
