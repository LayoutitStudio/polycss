import {
  validatePolyMorphModel,
  type PolyMorphAnimationChannel,
  type PolyMorphAnimationClip,
  type PolyMorphMat4,
  type PolyMorphModel,
  type PolyMorphQuat,
  type PolyMorphVec3,
} from "../../contracts/index.js";
import { PolyMorphRuntimeError } from "../runtimeError.js";

export interface PolyMorphJointAnimationSample {
  readonly translation?: PolyMorphVec3;
  readonly rotation?: PolyMorphQuat;
  readonly scale?: PolyMorphVec3;
}

export interface PolyMorphAnimationSample {
  readonly clipId: string;
  readonly requestedTimeMs: number;
  readonly sampledTimeMs: number;
  readonly morphWeights: Readonly<Record<string, number>>;
  readonly controlValues: Readonly<Record<string, number>>;
  readonly jointTransforms: ReadonlyMap<string, PolyMorphJointAnimationSample>;
  readonly shapeMatrices: ReadonlyMap<string, PolyMorphMat4>;
}

export interface PolyMorphAnimationRuntime {
  readonly model: PolyMorphModel;
  readonly clipIds: readonly string[];
  sample(clipId: string, timeMs: number): PolyMorphAnimationSample;
}

function fail(code: string, path: string, message: string): never {
  throw new PolyMorphRuntimeError(code, path, message);
}

function frozenSample(value: readonly number[]): readonly number[] {
  return Object.freeze([...value]);
}

function sampleChannel(channel: PolyMorphAnimationChannel, timeMs: number): readonly number[] {
  const { timesMs, values } = channel;
  if (timeMs <= timesMs[0]!) return frozenSample(values[0]!);
  for (let index = 1; index < timesMs.length; index += 1) {
    const rightTime = timesMs[index]!;
    if (timeMs > rightTime) continue;
    const leftTime = timesMs[index - 1]!;
    const left = values[index - 1]!;
    const right = values[index]!;
    if (timeMs === rightTime) return frozenSample(right);
    if (channel.interpolation === "step") return frozenSample(left);
    const amount = (timeMs - leftTime) / (rightTime - leftTime);
    if (channel.target === "joint-rotation") {
      const dot = left.reduce(
        (sum, value, part) => sum + value * right[part]!,
        0,
      );
      const direction = dot < 0 ? -1 : 1;
      const interpolated = left.map((value, part) =>
        value + (right[part]! * direction - value) * amount);
      const length = Math.hypot(...interpolated);
      return Object.freeze(interpolated.map((value) => value / length));
    }
    return Object.freeze(
      left.map((value, part) => value + (right[part]! - value) * amount),
    );
  }
  return frozenSample(values[values.length - 1]!);
}

function sampleTime(clip: PolyMorphAnimationClip, requested: number): number {
  if (clip.loop) {
    const wrapped = requested % clip.durationMs;
    return Object.is(wrapped, -0) ? 0 : wrapped;
  }
  return Math.min(requested, clip.durationMs);
}

export function createPolyMorphAnimationRuntime(modelInput: unknown): PolyMorphAnimationRuntime {
  const model = validatePolyMorphModel(modelInput);
  const clips = new Map(model.animations.map((clip) => [clip.id, clip]));
  return Object.freeze({
    model,
    clipIds: Object.freeze([...clips.keys()]),
    sample(clipId: string, timeMs: number): PolyMorphAnimationSample {
      const clip = clips.get(clipId);
      if (!clip) fail("unknown-clip", "$.clipId", clipId);
      if (!Number.isFinite(timeMs) || timeMs < 0) {
        fail("invalid-time", "$.timeMs", "expected a finite non-negative time");
      }
      const resolvedTime = sampleTime(clip, timeMs);
      const morphWeights: Record<string, number> = {};
      const controlValues: Record<string, number> = {};
      const joints = new Map<string, {
        translation?: PolyMorphVec3;
        rotation?: PolyMorphQuat;
        scale?: PolyMorphVec3;
      }>();
      const shapeMatrices = new Map<string, PolyMorphMat4>();
      for (const channel of clip.channels) {
        const value = sampleChannel(channel, resolvedTime);
        if (channel.target === "morph-weight") morphWeights[channel.targetId] = value[0]!;
        if (channel.target === "control-value") controlValues[channel.targetId] = value[0]!;
        if (channel.target === "shape-matrix") {
          shapeMatrices.set(channel.targetId, value as unknown as PolyMorphMat4);
        }
        if (channel.target.startsWith("joint-")) {
          const joint = joints.get(channel.targetId) ?? {};
          if (channel.target === "joint-translation") {
            joint.translation = value as unknown as PolyMorphVec3;
          } else if (channel.target === "joint-rotation") {
            joint.rotation = value as unknown as PolyMorphQuat;
          } else {
            joint.scale = value as unknown as PolyMorphVec3;
          }
          joints.set(channel.targetId, joint);
        }
      }
      return {
        clipId,
        requestedTimeMs: timeMs,
        sampledTimeMs: resolvedTime,
        morphWeights: Object.freeze(morphWeights),
        controlValues: Object.freeze(controlValues),
        jointTransforms: joints,
        shapeMatrices,
      };
    },
  });
}
