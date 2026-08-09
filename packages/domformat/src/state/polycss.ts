import { invariant } from "../errors.js";
import { cssNumber } from "./numeric.js";
import type { DomBindingChannel, DomBindings, DomState, DomStateChannel } from "../public-types.js";
import type { MountedTree } from "../retained-dom.js";

const MATRIX_WIDTH = 12;
const SOURCE_MILLI_FACTOR = 1e3;

interface SurfaceFace {
  readonly stateOffset: number;
  readonly stateCount: number;
  readonly leafWidth: number;
  readonly leafHeight: number;
}

interface SurfaceJump {
  readonly fromFrame: number;
  readonly toFrame: number;
  readonly faceIndicesBase64: string;
  readonly stateIndicesBase64: string;
}

interface VisibilityJump {
  readonly fromFrame: number;
  readonly toFrame: number;
  readonly faceIndicesBase64: string;
}

interface SurfaceWirePacket {
  readonly surface: Readonly<{
    faces: readonly SurfaceFace[];
    statePacking: Readonly<{ stateCount: number; sourceFrameDeltas: readonly number[] }>;
  }>;
  readonly transitions: Readonly<{
    initialFrame: number;
    sequential: Readonly<{
      offsetsBase64: string;
      faceIndexDeltas: readonly number[];
      stateIndexDeltas: readonly number[];
    }>;
    nonInteractiveJumps: readonly SurfaceJump[];
  }>;
  readonly visibility: Readonly<{
    initialFrame: number;
    initialVisibleBitsBase64: string;
    sequential: Readonly<{ offsetsBase64: string; faceIndicesBase64: string }>;
    nonInteractiveJumps: readonly VisibilityJump[];
  }>;
}

interface ExpandedLighting {
  readonly surface: Readonly<{
    faces: readonly SurfaceFace[];
    statePacking: Readonly<{
      stateCount: number;
      sourceFramesBase64: string;
      backgroundPositionYs: readonly string[];
    }>;
  }>;
  readonly transitions: Readonly<{
    initialFrame: number;
    sequential: Readonly<{
      offsetsBase64: string;
      faceIndicesBase64: string;
      stateIndicesBase64: string;
    }>;
    nonInteractiveJumps: readonly SurfaceJump[];
  }>;
  readonly visibilityCulling: Readonly<{
    initialFrame: number;
    initialVisibleBitsBase64: string;
    sequential: Readonly<{ offsetsBase64: string; faceIndicesBase64: string }>;
    nonInteractiveJumps: readonly VisibilityJump[];
  }>;
}

type Appearance = readonly [string, number, number];

interface InitialTable {
  readonly count: number;
  readonly transforms: readonly number[];
  readonly visibility?: readonly number[];
}

interface ChangeTable {
  readonly sources: readonly number[];
  readonly transforms: readonly number[];
  readonly visibility?: readonly number[];
}

interface TransformGroup {
  readonly encoding: string;
  readonly empty: readonly number[];
  readonly scales: readonly number[];
  readonly columns: readonly (readonly number[])[];
}

interface TransformTable {
  readonly count: number;
  readonly groups: readonly TransformGroup[];
}

interface WirePlaybackPacket {
  readonly shapeCount: number;
  readonly leafCount: number;
  readonly appearances: readonly Appearance[];
  readonly timeline: Readonly<{ frames: readonly number[]; introTicks: number; loopTicks: number }>;
  readonly initial: Readonly<{
    sourceFrame: number;
    appearance: number;
    modelTransform: number;
    shapes: InitialTable;
    leaves: InitialTable;
  }>;
  readonly frameRows: readonly (readonly number[])[];
  readonly shapeChanges: ChangeTable;
  readonly leafChanges: ChangeTable;
  readonly transforms: TransformTable;
}

interface ExpandedPlaybackPacket extends Omit<WirePlaybackPacket, "initial" | "shapeChanges" | "leafChanges" | "transforms"> {
  readonly initial: Readonly<{
    sourceFrame: number;
    appearance: number;
    modelTransform: number;
    shapes: readonly number[];
    leaves: readonly number[];
  }>;
  readonly shapeChanges: readonly number[];
  readonly leafChanges: readonly number[];
  readonly transforms: readonly string[];
}

interface WirePlaybackData {
  readonly packet: WirePlaybackPacket;
  readonly leafFit: readonly Readonly<{ canonicalSize: number }>[];
}

export interface MaterializedPolycssState {
  readonly channels: Map<string, DomStateChannel>;
  readonly lighting: ExpandedLighting | null;
  readonly playback: ExpandedPlaybackPacket | null;
  readonly surface: Readonly<Record<string, unknown>> | null;
}

function bytes(value: string): Uint8Array {
  const binary = globalThis.atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function fromBase64(value: string, width: number): number[] {
  const input = bytes(value);
  invariant(input.length % width === 0, "TRUNCATED_STATE_TABLE", "Base64 integer table is truncated.");
  return Array.from({ length: input.length / width }, (_, index) => {
    let result = 0;
    for (let byte = 0; byte < width; byte += 1) result += input[index * width + byte] * 2 ** (byte * 8);
    return result;
  });
}

function toBase64(values: readonly number[], width: number): string {
  const output = new Uint8Array(values.length * width);
  for (let index = 0; index < values.length; index += 1) {
    for (let byte = 0; byte < width; byte += 1) output[index * width + byte] = Math.floor(values[index] / 2 ** (byte * 8)) & 255;
  }
  const chunks: string[] = [];
  for (let offset = 0; offset < output.length; offset += 32768) chunks.push(String.fromCharCode(...output.subarray(offset, offset + 32768)));
  return globalThis.btoa(chunks.join(""));
}

function uint16(value: string): Uint16Array {
  return Uint16Array.from(fromBase64(value, 2));
}

function uint32(value: string): Uint32Array {
  return Uint32Array.from(fromBase64(value, 4));
}

function bitset(value: string, count: number): Uint8Array {
  const packed = bytes(value);
  invariant(packed.length === Math.ceil(count / 8), "TRUNCATED_STATE_TABLE", "Visibility bitset is truncated.");
  return Uint8Array.from({ length: count }, (_, index) => (packed[index >> 3] >> (index & 7)) & 1);
}

function expandLighting(section: Readonly<Record<string, unknown>>): ExpandedLighting {
  const contract = section.packet as unknown as SurfaceWirePacket;
  const surface = contract.surface;
  const packing = surface.statePacking;
  const sourceFrames = new Array<number>(packing.stateCount);
  const positions = new Array<string>(packing.stateCount);
  for (const face of surface.faces) {
    let frame = 0;
    for (let local = 0; local < face.stateCount; local += 1) {
      const index = face.stateOffset + local;
      frame += packing.sourceFrameDeltas[index];
      sourceFrames[index] = frame;
      positions[index] = `${frame === 0 ? 0 : -frame * face.leafHeight}px`;
    }
  }
  const sequential = contract.transitions.sequential;
  const offsets = fromBase64(sequential.offsetsBase64, 4);
  const faces = new Array<number>(sequential.faceIndexDeltas.length);
  const states = new Array<number>(sequential.stateIndexDeltas.length);
  const previousStates = new Array<number>(surface.faces.length).fill(0);
  for (let frame = 0; frame < offsets.length - 1; frame += 1) {
    let face = 0;
    for (let index = offsets[frame]; index < offsets[frame + 1]; index += 1) {
      face += sequential.faceIndexDeltas[index];
      previousStates[face] += sequential.stateIndexDeltas[index];
      faces[index] = face;
      states[index] = previousStates[face];
    }
  }
  return {
    surface: {
      faces: surface.faces,
      statePacking: {
        stateCount: packing.stateCount,
        sourceFramesBase64: toBase64(sourceFrames, 2),
        backgroundPositionYs: positions,
      },
    },
    transitions: {
      initialFrame: contract.transitions.initialFrame,
      sequential: {
        offsetsBase64: sequential.offsetsBase64,
        faceIndicesBase64: toBase64(faces, 2),
        stateIndicesBase64: toBase64(states, 2),
      },
      nonInteractiveJumps: contract.transitions.nonInteractiveJumps,
    },
    visibilityCulling: contract.visibility,
  };
}

function emptyLighting(frameCount: number): ExpandedLighting {
  const offsetsBase64 = toBase64(new Array(frameCount + 1).fill(0), 4);
  return {
    surface: {
      faces: [],
      statePacking: { stateCount: 0, sourceFramesBase64: "", backgroundPositionYs: [] },
    },
    transitions: {
      initialFrame: 1,
      sequential: { offsetsBase64, faceIndicesBase64: "", stateIndicesBase64: "" },
      nonInteractiveJumps: [],
    },
    visibilityCulling: {
      initialFrame: 1,
      initialVisibleBitsBase64: "",
      sequential: { offsetsBase64, faceIndicesBase64: "" },
      nonInteractiveJumps: [],
    },
  };
}

function expandInitial(table: InitialTable, visibility: boolean): number[] {
  const rows: number[] = [];
  let transform = 0;
  for (let index = 0; index < table.count; index += 1) {
    transform += table.transforms[index];
    rows.push(index, transform);
    if (visibility) {
      invariant(table.visibility, "TRUNCATED_STATE_TABLE", "Initial visibility table is absent.");
      rows.push(table.visibility[index]);
    }
  }
  return rows;
}

function expandChanges(table: ChangeTable, frameRows: readonly (readonly number[])[], countColumn: number, visibility: boolean): number[] {
  const rows: number[] = [];
  let transform = 0;
  let cursor = 0;
  for (const frame of frameRows) {
    let source = 0;
    for (let index = 0; index < frame[countColumn]; index += 1) {
      source += table.sources[cursor];
      transform += table.transforms[cursor];
      rows.push(source, transform);
      if (visibility) {
        invariant(table.visibility, "TRUNCATED_STATE_TABLE", "Change visibility table is absent.");
        rows.push(table.visibility[cursor]);
      }
      cursor += 1;
    }
  }
  return rows;
}

function assignTriplets(owners: Array<string | undefined>, rows: readonly number[], kind: string): void {
  for (let offset = 0; offset < rows.length; offset += 3) owners[rows[offset + 1]] ??= `${kind}:${rows[offset]}`;
}

function assignPairs(owners: Array<string | undefined>, rows: readonly number[], kind: string): void {
  for (let offset = 0; offset < rows.length; offset += 2) owners[rows[offset + 1]] ??= `${kind}:${rows[offset]}`;
}

function transformGroups(packet: Omit<ExpandedPlaybackPacket, "transforms">, count: number): Array<{ owner: string; indices: number[] }> {
  const owners = new Array<string | undefined>(count);
  owners[packet.initial.modelTransform] = "model";
  assignTriplets(owners, packet.initial.shapes, "shape");
  assignPairs(owners, packet.initial.leaves, "leaf");
  for (const frame of packet.frameRows) if (frame[2] !== -1) owners[frame[2]] ??= "model";
  assignTriplets(owners, packet.shapeChanges, "shape");
  assignPairs(owners, packet.leafChanges, "leaf");
  const groups = new Map<string, number[]>();
  for (let index = 0; index < owners.length; index += 1) {
    const owner = owners[index];
    invariant(typeof owner === "string", "TRANSFORM_GROUP_MISMATCH", `Prepared transform ${index} has no owner.`);
    const indices = groups.get(owner);
    if (indices) indices.push(index);
    else groups.set(owner, [index]);
  }
  return [...groups].map(([owner, indices]) => ({ owner, indices }));
}

function matrix(values: readonly number[]): string {
  invariant(values.length === MATRIX_WIDTH && values.every(Number.isFinite), "INVALID_PLAYBACK_PUBLICATION", "Prepared playback matrix contains a non-finite component.");
  return `matrix3d(${[values[0], values[1], values[2], 0, values[3], values[4], values[5], 0, values[6], values[7], values[8], 0, values[9], values[10], values[11], 1].join(",")})`;
}

function milli(value: number): string {
  if (value === 0) return "0";
  const sign = value < 0 ? "-" : "";
  const absolute = Math.abs(value);
  const whole = Math.floor(absolute / SOURCE_MILLI_FACTOR);
  const remainder = absolute % SOURCE_MILLI_FACTOR;
  return remainder === 0 ? `${sign}${whole}` : `${sign}${whole}.${String(remainder).padStart(3, "0").replace(/0+$/u, "")}`;
}

function fittedMatrix(values: readonly number[], canonicalSize: number, width: number, height: number): string {
  const basis = values.slice(0, 9).map((value) => value / SOURCE_MILLI_FACTOR);
  for (const index of [0, 1, 2]) basis[index] *= canonicalSize / width;
  for (const index of [3, 4, 5]) basis[index] *= canonicalSize / height;
  return matrix([
    ...basis.slice(0, 6).map((value) => Number(cssNumber(value))),
    ...values.slice(6).map((value) => Number(milli(value))),
  ]);
}

function expandTransforms(
  table: TransformTable,
  packet: Omit<ExpandedPlaybackPacket, "transforms">,
  leafFit: readonly Readonly<{ canonicalSize: number }>[],
  lightingFaces: readonly SurfaceFace[],
): string[] {
  const transforms = new Array<string>(table.count);
  const groups = transformGroups(packet, table.count);
  invariant(groups.length === table.groups.length, "TRANSFORM_GROUP_MISMATCH", "Prepared transform groups do not match their owners.");
  for (let groupIndex = 0; groupIndex < groups.length; groupIndex += 1) {
    const { owner, indices } = groups[groupIndex];
    const group = table.groups[groupIndex];
    const empty = new Set(group.empty);
    const presentCount = indices.length - empty.size;
    const columns = group.columns.map((column, columnIndex) => {
      const scale = group.scales[columnIndex];
      if (!scale) return column;
      let current = 0;
      return column.map((delta) => {
        current += delta;
        return current / scale;
      });
    });
    invariant(columns.length === MATRIX_WIDTH, "TRANSFORM_COLUMN_MISMATCH", "Prepared transform matrix width is invalid.");
    let cursor = 0;
    for (let row = 0; row < indices.length; row += 1) {
      const transformIndex = indices[row];
      if (empty.has(row)) {
        transforms[transformIndex] = "";
        continue;
      }
      const values = Array.from({ length: MATRIX_WIDTH }, (_, column) => columns[column][cursor]);
      if (group.encoding === "source-milli-fitted-leaf") {
        const leafIndex = Number(owner.slice("leaf:".length));
        const fit = leafFit[leafIndex];
        const face = lightingFaces[leafIndex];
        invariant(fit && face, "MISSING_LEAF_FIT", `Prepared leaf fit ${leafIndex} is absent.`);
        transforms[transformIndex] = fittedMatrix(
          values.map((value) => Math.round(value * SOURCE_MILLI_FACTOR)),
          fit.canonicalSize,
          face.leafWidth,
          face.leafHeight,
        );
      } else {
        invariant(group.encoding === "decimal-component-streams", "UNSUPPORTED_TRANSFORM_ENCODING", `Prepared transform encoding ${group.encoding} is unsupported.`);
        transforms[transformIndex] = matrix(values);
      }
      cursor += 1;
    }
    invariant(cursor === presentCount, "TRANSFORM_STREAM_MISMATCH", "Prepared transform stream has the wrong row count.");
  }
  invariant(transforms.every((value) => typeof value === "string"), "INCOMPLETE_TRANSFORMS", "Prepared transform table has unowned values.");
  return transforms;
}

function expandPlayback(data: WirePlaybackData, lighting: ExpandedLighting): ExpandedPlaybackPacket {
  const raw = data.packet;
  const initial = {
    ...raw.initial,
    shapes: expandInitial(raw.initial.shapes, true),
    leaves: expandInitial(raw.initial.leaves, false),
  };
  const packet: Omit<ExpandedPlaybackPacket, "transforms"> = {
    ...raw,
    initial,
    shapeChanges: expandChanges(raw.shapeChanges, raw.frameRows, 4, true),
    leafChanges: expandChanges(raw.leafChanges, raw.frameRows, 6, false),
  };
  return {
    ...packet,
    transforms: expandTransforms(raw.transforms, packet, data.leafFit, lighting.surface.faces),
  };
}

interface VisibilityState {
  readonly rows: Uint8Array[];
  readonly sequentialOffsets: Uint32Array;
  readonly sequentialFaces: Uint16Array;
  readonly jumps: Map<string, Uint16Array>;
}

function visibilityState(lighting: ExpandedLighting, leafCount: number, frameCount: number): VisibilityState {
  const schedule = lighting.visibilityCulling;
  const initial = bitset(schedule.initialVisibleBitsBase64, leafCount);
  const sequentialOffsets = uint32(schedule.sequential.offsetsBase64);
  const sequentialFaces = uint16(schedule.sequential.faceIndicesBase64);
  invariant(sequentialOffsets.length === frameCount + 1, "TRUNCATED_VISIBILITY", "Visibility offsets do not cover the prepared frame range.");
  const current = initial.slice();
  const rows: Uint8Array[] = [current.slice()];
  for (let targetFrame = 2; targetFrame <= frameCount; targetFrame += 1) {
    const transition = targetFrame - 1;
    for (const index of sequentialFaces.subarray(sequentialOffsets[transition], sequentialOffsets[transition + 1])) current[index] ^= 1;
    rows.push(current.slice());
  }
  const jumps = new Map<string, Uint16Array>(schedule.nonInteractiveJumps.map((jump): [string, Uint16Array] => [`${jump.fromFrame}>${jump.toFrame}`, uint16(jump.faceIndicesBase64)]));
  return { rows, sequentialOffsets, sequentialFaces, jumps };
}

interface LightingFace extends SurfaceFace {
  readonly sourceFrames: Uint16Array;
}

interface LightingState {
  readonly faces: LightingFace[];
  readonly positions: readonly string[];
  readonly sequentialOffsets: Uint32Array;
  readonly sequentialFaces: Uint16Array;
  readonly sequentialStates: Uint16Array;
  readonly jumps: Map<string, { faces: Uint16Array; states: Uint16Array }>;
}

function lightingState(lighting: ExpandedLighting): LightingState {
  const packing = lighting.surface.statePacking;
  const sourceFrames = uint16(packing.sourceFramesBase64);
  invariant(sourceFrames.length === packing.stateCount && packing.backgroundPositionYs.length === packing.stateCount, "TRUNCATED_LIGHTING", "Lighting states are incomplete.");
  const faces = lighting.surface.faces.map((face) => ({
    ...face,
    sourceFrames: sourceFrames.subarray(face.stateOffset, face.stateOffset + face.stateCount),
  }));
  const sequential = lighting.transitions.sequential;
  const jumps = new Map<string, { faces: Uint16Array; states: Uint16Array }>(lighting.transitions.nonInteractiveJumps.map((jump): [string, { faces: Uint16Array; states: Uint16Array }] => [`${jump.fromFrame}>${jump.toFrame}`, {
    faces: uint16(jump.faceIndicesBase64),
    states: uint16(jump.stateIndicesBase64),
  }]));
  return {
    faces,
    positions: packing.backgroundPositionYs,
    sequentialOffsets: uint32(sequential.offsetsBase64),
    sequentialFaces: uint16(sequential.faceIndicesBase64),
    sequentialStates: uint16(sequential.stateIndicesBase64),
    jumps,
  };
}

function stateAt(face: LightingFace, frameIndex: number): number {
  let lower = 0;
  let upper = face.sourceFrames.length;
  while (lower < upper) {
    const middle = lower + Math.floor((upper - lower) / 2);
    if (face.sourceFrames[middle] <= frameIndex) lower = middle + 1;
    else upper = middle;
  }
  return lower - 1;
}

export function materializePolycssState(state: DomState): MaterializedPolycssState {
  const channels = new Map<string, DomStateChannel>(state.channels.map((channel): [string, DomStateChannel] => [channel.id, channel]));
  const surfaceChannel = [...channels.values()].find((channel) => channel.codec === "polycss-surface-packed@0");
  const playbackChannel = [...channels.values()].find((channel) => channel.codec === "polycss-playback-packed@0");
  if (!playbackChannel) return Object.freeze({ channels, lighting: null, playback: null, surface: null });
  const playbackData = playbackChannel.data as unknown as WirePlaybackData;
  invariant(surfaceChannel || playbackData.packet.leafCount === 0, "MISSING_POLYCSS_CHANNEL", "Prepared playback leaves require a surface channel.");
  const lighting = surfaceChannel
    ? expandLighting(surfaceChannel.data)
    : emptyLighting(playbackData.packet.frameRows.length);
  const playback = expandPlayback(playbackData, lighting);
  return Object.freeze({ channels, lighting, playback, surface: surfaceChannel?.data ?? null });
}

function timelineFrame(packet: ExpandedPlaybackPacket, tick: number): number {
  const index = tick < packet.timeline.frames.length
    ? tick
    : packet.timeline.introTicks + (tick - packet.timeline.introTicks) % packet.timeline.loopTicks;
  return packet.timeline.frames[index];
}

function loadTriples(source: readonly number[], transforms: Uint32Array, visibility: Uint8Array): void {
  for (let offset = 0; offset < source.length; offset += 3) {
    transforms[source[offset]] = source[offset + 1];
    visibility[source[offset]] = source[offset + 2];
  }
}

function loadPairs(source: readonly number[], transforms: Uint32Array): void {
  for (let offset = 0; offset < source.length; offset += 2) transforms[source[offset]] = source[offset + 1];
}

export interface PolycssPlayback {
  readonly tick: number;
  readonly sourceFrame: number;
  publishInitial(): number;
  advance(): number;
  advanceMany(count: number): readonly number[];
  seek(frame: number): number;
  restart(shapeIndices?: readonly number[], leafIndices?: readonly number[]): number;
  applySurfaceFrame(frame: number): number;
  forceVisible(indices: Iterable<number>): void;
  applyInteractionLeaf(index: number, transform: string | null): void;
  restoreInteraction(shapeIndices: readonly number[], leafIndices: readonly number[]): void;
}

function createStaticPlayback(publishAppearance: (appearance: Appearance) => void): PolycssPlayback {
  let initialPublished = false;
  const seek = (target: number): number => {
    invariant(target === 1, "FRAME_RANGE", `Static presentation frame ${target} is out of range.`);
    return 1;
  };
  return Object.freeze({
    get tick() { return 0; },
    get sourceFrame() { return 1; },
    publishInitial() {
      if (!initialPublished) {
        publishAppearance(["default", 1, 0]);
        initialPublished = true;
      }
      return 1;
    },
    advance() { return 1; },
    advanceMany(count: number) {
      invariant(Number.isSafeInteger(count) && count >= 1, "INVALID_PLAYBACK_PUBLICATION", "Static playback catch-up count must be a positive integer.");
      return Object.freeze(new Array<number>(count).fill(1));
    },
    seek,
    restart() { return 1; },
    applySurfaceFrame: seek,
    forceVisible(indices: Iterable<number>) {
      invariant(indices && [...indices].length === 0, "INVALID_INTERACTION_PUBLICATION", "Static presentation has no visibility targets.");
    },
    applyInteractionLeaf() {
      invariant(false, "INVALID_INTERACTION_PUBLICATION", "Static presentation has no interaction leaves.");
    },
    restoreInteraction(shapeIndices: readonly number[], leafIndices: readonly number[]) {
      invariant(shapeIndices.length === 0 && leafIndices.length === 0, "INVALID_INTERACTION_PUBLICATION", "Static presentation has no interaction targets.");
    },
  });
}

interface PlaybackTargets {
  readonly model: string;
  readonly shapes: readonly string[];
  readonly leaves: readonly string[];
}

interface PlaybackParameters {
  readonly baseSceneTransform: string;
  readonly frameCount: number;
}

type BoundPlaybackTargets = Readonly<{
  model?: HTMLElement;
  shapes?: readonly HTMLElement[];
  leaves?: readonly HTMLElement[];
}>;

export function createPolycssPlayback(
  materialized: MaterializedPolycssState,
  bindings: DomBindings,
  mounted: MountedTree,
  options: {
    readonly publishAppearance?: (appearance: Appearance) => void;
    readonly boundTargets?: ReadonlyMap<string, Readonly<{ targets: unknown }>>;
  } = {},
): PolycssPlayback {
  const publishAppearance = options.publishAppearance;
  invariant(typeof publishAppearance === "function", "MISSING_PRESENTATION_PUBLISHER", "Playback requires the static presentation publisher.");
  const playbackBinding = bindings.channels.find((channel) => channel.interpreter === "polycss-playback@0");
  if (!playbackBinding) return createStaticPlayback(publishAppearance);
  const packet = materialized.playback;
  const surfaceBinding = bindings.channels.find((channel) => channel.interpreter === "polycss-surface@0");
  invariant(packet && materialized.lighting && (surfaceBinding || packet.leafCount === 0), "MISSING_POLYCSS_BINDING", "Executable playback leaves require a surface binding.");
  const playbackTargets = playbackBinding.targets as unknown as PlaybackTargets;
  const playbackParameters = playbackBinding.parameters as unknown as PlaybackParameters;
  const bound = options.boundTargets?.get(playbackBinding.id)?.targets as BoundPlaybackTargets | undefined;
  const scene = bound?.model ?? mounted.byId.get(playbackTargets.model);
  const shapeTargets = bound?.shapes ?? playbackTargets.shapes.map((id) => mounted.byId.get(id));
  const leafTargets = bound?.leaves ?? playbackTargets.leaves.map((id) => mounted.byId.get(id));
  invariant(scene && shapeTargets.every(Boolean) && leafTargets.every(Boolean), "MISSING_TARGET_NODE", "Playback target nodes are not mounted.");
  const shapes = shapeTargets as readonly HTMLElement[];
  const leaves = leafTargets as readonly HTMLElement[];
  const baseSceneTransform = playbackParameters.baseSceneTransform;
  const shapeTransforms = new Uint32Array(packet.shapeCount);
  const shapeVisibility = new Uint8Array(packet.shapeCount);
  const leafTransforms = new Uint32Array(packet.leafCount);
  const dirtyHiddenTransforms = new Uint8Array(packet.leafCount);
  loadTriples(packet.initial.shapes, shapeTransforms, shapeVisibility);
  loadPairs(packet.initial.leaves, leafTransforms);
  const visibility = visibilityState(materialized.lighting, packet.leafCount, playbackParameters.frameCount);
  const light = lightingState(materialized.lighting);
  const visible = visibility.rows[0].slice();
  const forced = new Uint8Array(packet.leafCount);
  const degenerate = new Uint8Array(packet.leafCount);
  const appliedStates = new Uint16Array(packet.leafCount);
  let currentForced = new Uint16Array(0);
  let sourceFrame = packet.initial.sourceFrame;
  let surfaceFrame = packet.initial.sourceFrame;
  let appearanceIndex = packet.initial.appearance;
  let modelTransform = packet.initial.modelTransform;
  let tick = 0;
  let initialPublished = false;

  const applyAppearance = () => publishAppearance(packet.appearances[appearanceIndex]);

  const writeModel = () => {
    const transform = packet.transforms[modelTransform];
    const next = transform === "" ? baseSceneTransform : `${baseSceneTransform} ${transform}`;
    if (scene.style.transform !== next) scene.style.transform = next;
  };

  const isPaintVisible = (index: number): boolean => (visible[index] === 1 || forced[index] === 1) && degenerate[index] === 0;

  const writePreparedLeafTransform = (index: number): void => {
    leaves[index].style.transform = packet.transforms[leafTransforms[index]];
    dirtyHiddenTransforms[index] = 0;
  };

  const flushPreparedLeafTransform = (index: number): void => {
    if (dirtyHiddenTransforms[index] === 0) return;
    writePreparedLeafTransform(index);
  };

  const publishOrDeferPreparedLeafTransform = (index: number): void => {
    if (isPaintVisible(index)) writePreparedLeafTransform(index);
    else dirtyHiddenTransforms[index] = 1;
  };

  const synchronizePreparedLeafTransforms = () => {
    for (let index = 0; index < leaves.length; index += 1) flushPreparedLeafTransform(index);
  };

  const writeVisibility = (index: number): void => {
    const paintVisible = isPaintVisible(index);
    const next = paintVisible ? "visible" : "hidden";
    if (paintVisible) flushPreparedLeafTransform(index);
    if (leaves[index].style.visibility !== next) leaves[index].style.visibility = next;
  };

  const publishSurfaceState = (frame: number): void => {
    for (let index = 0; index < leaves.length; index += 1) {
      const face = light.faces[index];
      const state = stateAt(face, frame - 1);
      invariant(state >= 0 && state < face.stateCount, "INVALID_SURFACE_PUBLICATION", `Prepared surface leaf ${index} has no state for frame ${frame}.`);
      leaves[index].style.backgroundPositionY = light.positions[face.stateOffset + state];
      appliedStates[index] = state;
      writeVisibility(index);
    }
    surfaceFrame = frame;
  };

  const applySurface = (nextFrame: number): void => {
    if (nextFrame === surfaceFrame) return;
    const frameCount = playbackParameters.frameCount;
    const sequential = nextFrame === (surfaceFrame === frameCount ? 1 : surfaceFrame + 1);
    let changed = sequential
      ? visibility.sequentialFaces.subarray(visibility.sequentialOffsets[nextFrame - 1], visibility.sequentialOffsets[nextFrame])
      : visibility.jumps.get(`${surfaceFrame}>${nextFrame}`);
    if (!changed) {
      const target = visibility.rows[nextFrame - 1];
      const changedIndices: number[] = [];
      for (let index = 0; index < target.length; index += 1) {
        if (target[index] !== visible[index]) changedIndices.push(index);
      }
      changed = Uint16Array.from(changedIndices);
    }
    for (const index of changed) {
      visible[index] ^= 1;
      writeVisibility(index);
    }
    const jump = sequential ? undefined : light.jumps.get(`${surfaceFrame}>${nextFrame}`);
    let faceIndices: Uint16Array;
    let stateIndices: Uint16Array;
    let start = 0;
    let end;
    if (sequential) {
      faceIndices = light.sequentialFaces;
      stateIndices = light.sequentialStates;
      start = light.sequentialOffsets[nextFrame - 1];
      end = light.sequentialOffsets[nextFrame];
    } else if (jump) {
      faceIndices = jump.faces;
      stateIndices = jump.states;
      end = faceIndices.length;
    } else {
      const changedFaces: number[] = [];
      const changedStates: number[] = [];
      for (let index = 0; index < light.faces.length; index += 1) {
        if (visible[index] !== 1) continue;
        const state = stateAt(light.faces[index], nextFrame - 1);
        if (appliedStates[index] === state) continue;
        changedFaces.push(index);
        changedStates.push(state);
      }
      faceIndices = Uint16Array.from(changedFaces);
      stateIndices = Uint16Array.from(changedStates);
      end = faceIndices.length;
    }
    for (let cursor = start; cursor < end; cursor += 1) {
      const index = faceIndices[cursor];
      if (visible[index] !== 1) continue;
      const face = light.faces[index];
      const state = stateIndices[cursor];
      leaves[index].style.backgroundPositionY = light.positions[face.stateOffset + state];
      appliedStates[index] = state;
    }
    surfaceFrame = nextFrame;
  };

  const row = (frame: number): readonly number[] => {
    const value = packet.frameRows[frame - 1];
    invariant(value?.[0] === frame, "FRAME_INDEX_MISMATCH", `Prepared playback frame ${frame} is not directly indexed.`);
    return value;
  };

  const applyRow = (next: readonly number[], publish: boolean, dirtyShapes?: Set<number>, dirtyLeaves?: Set<number>): void => {
    const nextFrame = next[0];
    if (next[1] !== appearanceIndex) {
      appearanceIndex = next[1];
      if (publish) applyAppearance();
    }
    if (next[2] !== -1) {
      modelTransform = next[2];
      if (publish) writeModel();
    }
    for (let index = 0; index < next[4]; index += 1) {
      const base = (next[3] + index) * 3;
      const shape = packet.shapeChanges[base];
      shapeTransforms[shape] = packet.shapeChanges[base + 1];
      shapeVisibility[shape] = packet.shapeChanges[base + 2];
      dirtyShapes?.add(shape);
      if (publish) {
        shapes[shape].style.transform = packet.transforms[shapeTransforms[shape]];
        shapes[shape].style.visibility = shapeVisibility[shape] === 1 ? "visible" : "hidden";
      }
    }
    for (let index = 0; index < next[6]; index += 1) {
      const base = (next[5] + index) * 2;
      const leaf = packet.leafChanges[base];
      leafTransforms[leaf] = packet.leafChanges[base + 1];
      dirtyLeaves?.add(leaf);
      if (publish) publishOrDeferPreparedLeafTransform(leaf);
    }
    if (publish) applySurface(nextFrame);
    sourceFrame = nextFrame;
  };

  const seekTo = (target: number, synchronize: boolean): number => {
    invariant(Number.isSafeInteger(target) && target >= 1 && target <= playbackParameters.frameCount, "FRAME_RANGE", `Prepared playback frame ${target} is out of range.`);
    if (target !== sourceFrame) {
      const dirtyShapes = new Set<number>();
      const dirtyLeaves = new Set<number>();
      let next = sourceFrame;
      while (next !== target) {
        next = next === playbackParameters.frameCount ? 1 : next + 1;
        applyRow(row(next), false, dirtyShapes, dirtyLeaves);
      }
      writeModel();
      applyAppearance();
      for (const index of [...dirtyShapes].sort((left, right) => left - right)) {
        shapes[index].style.transform = packet.transforms[shapeTransforms[index]];
        shapes[index].style.visibility = shapeVisibility[index] === 1 ? "visible" : "hidden";
      }
      for (const index of [...dirtyLeaves].sort((left, right) => left - right)) {
        if (synchronize) dirtyHiddenTransforms[index] = 1;
        else publishOrDeferPreparedLeafTransform(index);
      }
      if (synchronize) synchronizePreparedLeafTransforms();
      applySurface(target);
      sourceFrame = target;
    }
    if (synchronize) synchronizePreparedLeafTransforms();
    return target;
  };

  const seek = (target: number): number => seekTo(target, true);

  const advanceOne = (publish: boolean, dirtyShapes?: Set<number>, dirtyLeaves?: Set<number>): number => {
    tick += 1;
    const target = timelineFrame(packet, tick);
    if (target === sourceFrame) return target;
    const expected = sourceFrame === playbackParameters.frameCount ? 1 : sourceFrame + 1;
    if (target === expected) applyRow(row(target), publish, dirtyShapes, dirtyLeaves);
    else if (publish) seekTo(target, false);
    else {
      let next = sourceFrame;
      while (next !== target) {
        next = next === playbackParameters.frameCount ? 1 : next + 1;
        applyRow(row(next), false, dirtyShapes, dirtyLeaves);
      }
    }
    return target;
  };

  const advanceMany = (count: number): readonly number[] => {
    invariant(Number.isSafeInteger(count) && count >= 1, "INVALID_PLAYBACK_PUBLICATION", "Prepared playback catch-up count must be a positive integer.");
    if (count === 1) return Object.freeze([advanceOne(true)]);
    const initialAppearance = appearanceIndex;
    const initialModelTransform = modelTransform;
    const dirtyShapes = new Set<number>();
    const dirtyLeaves = new Set<number>();
    const frames: number[] = [];
    for (let index = 0; index < count; index += 1) frames.push(advanceOne(false, dirtyShapes, dirtyLeaves));
    if (modelTransform !== initialModelTransform) writeModel();
    if (appearanceIndex !== initialAppearance) applyAppearance();
    for (const index of [...dirtyShapes].sort((left, right) => left - right)) {
      const transform = packet.transforms[shapeTransforms[index]];
      const nextVisibility = shapeVisibility[index] === 1 ? "visible" : "hidden";
      if (shapes[index].style.transform !== transform) shapes[index].style.transform = transform;
      if (shapes[index].style.visibility !== nextVisibility) shapes[index].style.visibility = nextVisibility;
    }
    for (const index of [...dirtyLeaves].sort((left, right) => left - right)) publishOrDeferPreparedLeafTransform(index);
    applySurface(sourceFrame);
    return Object.freeze(frames);
  };

  return Object.freeze({
    get tick() { return tick; },
    get sourceFrame() { return sourceFrame; },
    publishInitial() {
      if (initialPublished) return sourceFrame;
      writeModel();
      for (let index = 0; index < shapes.length; index += 1) {
        shapes[index].style.transform = packet.transforms[shapeTransforms[index]];
        shapes[index].style.visibility = shapeVisibility[index] === 1 ? "visible" : "hidden";
      }
      for (let index = 0; index < leaves.length; index += 1) writePreparedLeafTransform(index);
      publishSurfaceState(sourceFrame);
      applyAppearance();
      initialPublished = true;
      return sourceFrame;
    },
    advance() {
      return advanceOne(true);
    },
    advanceMany,
    seek,
    restart(shapeIndices = [], leafIndices = []) {
      seek(packet.initial.sourceFrame);
      this.restoreInteraction(shapeIndices, leafIndices);
      tick = 0;
      return sourceFrame;
    },
    applySurfaceFrame(nextFrame: number) {
      invariant(Number.isSafeInteger(nextFrame) && nextFrame >= 1 && nextFrame <= playbackParameters.frameCount, "FRAME_RANGE", `Prepared surface frame ${nextFrame} is out of range.`);
      applySurface(nextFrame);
      return nextFrame;
    },
    forceVisible(indices: Iterable<number>) {
      invariant(indices && typeof indices[Symbol.iterator] === "function", "INVALID_INTERACTION_PUBLICATION", "Forced-visible leaves must be iterable.");
      const next = new Uint8Array(packet.leafCount);
      const nextIndices: number[] = [];
      for (const index of indices) {
        invariant(Number.isSafeInteger(index) && index >= 0 && index < packet.leafCount, "INVALID_INTERACTION_PUBLICATION", `Forced-visible leaf ${index} is out of range.`);
        if (next[index] === 0) nextIndices.push(index);
        next[index] = 1;
      }
      const changed = new Set([...currentForced, ...nextIndices]);
      for (const index of changed) {
        forced[index] = next[index];
        writeVisibility(index);
      }
      currentForced = Uint16Array.from(nextIndices);
    },
    applyInteractionLeaf(index: number, transform: string | null) {
      invariant(Number.isSafeInteger(index) && index >= 0 && index < packet.leafCount, "INVALID_INTERACTION_PUBLICATION", `Interaction leaf ${index} is out of range.`);
      invariant(transform === null || typeof transform === "string", "INVALID_INTERACTION_PUBLICATION", `Interaction leaf ${index} transform is invalid.`);
      degenerate[index] = transform === null ? 1 : 0;
      writeVisibility(index);
      if (transform !== null && leaves[index].style.transform !== transform) leaves[index].style.transform = transform;
    },
    restoreInteraction(shapeIndices: readonly number[], leafIndices: readonly number[]) {
      for (const index of shapeIndices) {
        invariant(Number.isSafeInteger(index) && index >= 0 && index < packet.shapeCount, "INVALID_INTERACTION_PUBLICATION", `Interaction shape ${index} is out of range.`);
        shapes[index].style.transform = packet.transforms[shapeTransforms[index]];
        shapes[index].style.visibility = shapeVisibility[index] === 1 ? "visible" : "hidden";
      }
      for (const index of leafIndices) {
        invariant(Number.isSafeInteger(index) && index >= 0 && index < packet.leafCount, "INVALID_INTERACTION_PUBLICATION", `Interaction leaf ${index} is out of range.`);
        degenerate[index] = 0;
        writePreparedLeafTransform(index);
        writeVisibility(index);
      }
    },
  });
}
