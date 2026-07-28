import {
  validatePolyMorphModel,
  type PolyMorphModel,
} from "../../contracts/index.js";
import type { PolyMorphRetainedUpdate } from "../../render/index.js";
import {
  applyPolyMorphPlaybackFrame,
  createPolyMorphPreparedState,
  diffPolyMorphPreparedStates,
  type PolyMorphPreparedState,
} from "../prepared-state/index.js";
import { PolyMorphRuntimeError } from "../runtimeError.js";

export interface PolyMorphPlaybackSample {
  readonly requestedTimeMs: number;
  readonly sampledTimeMs: number;
  readonly frameIndex: number;
  readonly state: PolyMorphPreparedState;
  readonly update: PolyMorphRetainedUpdate;
  readonly modelChanged: boolean;
  readonly dirtyShapeIds: readonly string[];
  readonly dirtyLeafIds: readonly string[];
  readonly domCreations: 0;
  readonly domRemovals: 0;
  readonly topologyConstructions: 0;
  readonly atlasConstructions: 0;
  readonly atlasRedraws: 0;
  readonly schedulerCallbacks: 0;
}

export interface PolyMorphPlaybackRuntime {
  readonly model: PolyMorphModel;
  readonly durationMs: number;
  readonly loop: boolean;
  readonly frameCount: number;
  sample(timeMs: number): PolyMorphPlaybackSample;
  reset(): void;
}

function fail(code: string, path: string, message: string): never {
  throw new PolyMorphRuntimeError(code, path, message);
}

function sampledTime(durationMs: number, loop: boolean, timeMs: number): number {
  if (loop) {
    const result = timeMs % durationMs;
    return Object.is(result, -0) ? 0 : result;
  }
  return Math.min(timeMs, durationMs);
}

function frameAt(times: readonly number[], timeMs: number): number {
  let low = 0;
  let high = times.length - 1;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    if (times[middle]! <= timeMs) low = middle + 1;
    else high = middle - 1;
  }
  return Math.max(0, high);
}

export function createPolyMorphPlaybackRuntime(
  modelInput: unknown,
): PolyMorphPlaybackRuntime {
  const model = validatePolyMorphModel(modelInput);
  if (model.profile !== "prepared-playback" || !model.playback) {
    fail("profile-mismatch", "$.profile", "playback requires the prepared-playback profile");
  }
  const playback = model.playback;
  const initial = createPolyMorphPreparedState(model);
  const states: PolyMorphPreparedState[] = [];
  let state = initial;
  const leafById = new Map(model.render.leaves.map((leaf) => [leaf.id, leaf]));
  for (const [index, frame] of playback.frames.entries()) {
    for (const update of frame.leaves) {
      if (update.atlasRow === null) continue;
      const leaf = leafById.get(update.leafId)!;
      if (!leaf.atlas) {
        fail("invalid-atlas-row", `$.playback.frames[${index}]`, `${leaf.id} has no image rows`);
      }
      const y = leaf.atlas.y + update.atlasRow * leaf.atlas.height;
      if (y + leaf.atlas.height > leaf.atlas.pageHeight) {
        fail("invalid-atlas-row", `$.playback.frames[${index}]`, `${leaf.id} row exceeds its page`);
      }
    }
    state = applyPolyMorphPlaybackFrame(state, frame);
    states.push(state);
  }
  const times = playback.frames.map((frame) => frame.timeMs);
  let current = initial;
  const sample = (timeMs: number): PolyMorphPlaybackSample => {
    if (!Number.isFinite(timeMs) || timeMs < 0) {
      fail("invalid-time", "$.timeMs", "expected a finite non-negative time");
    }
    const resolvedTime = sampledTime(playback.durationMs, playback.loop, timeMs);
    const frameIndex = frameAt(times, resolvedTime);
    const next = states[frameIndex]!;
    const diff = diffPolyMorphPreparedStates(current, next);
    current = next;
    return {
      requestedTimeMs: timeMs,
      sampledTimeMs: resolvedTime,
      frameIndex,
      state: next,
      update: diff.update,
      modelChanged: diff.modelChanged,
      dirtyShapeIds: diff.dirtyShapeIds,
      dirtyLeafIds: diff.dirtyLeafIds,
      domCreations: 0,
      domRemovals: 0,
      topologyConstructions: 0,
      atlasConstructions: 0,
      atlasRedraws: 0,
      schedulerCallbacks: 0,
    };
  };
  return Object.freeze({
    model,
    durationMs: playback.durationMs,
    loop: playback.loop,
    frameCount: playback.frames.length,
    sample,
    reset(): void {
      current = initial;
    },
  });
}
