import { invariant } from "../errors.js";
import { cssNumber } from "./numeric.js";
import type { DomBindingChannel, DomBindings, DomState, DomStateChannel } from "../public-types.js";
import type { MountedTree } from "../retained-dom.js";
import type { PagedPlaybackStage, PagedStateStage, PolycssPagedState, PolycssPublicationDiagnostics } from "./paged-state.js";
import type { PolycssCompositorTiming } from "./compositor-timing.js";

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
    statePacking: Readonly<{
      stateCount: number;
      sourceFrameDeltas: readonly number[];
      positionDictionary?: readonly (readonly [number, number])[];
      positionIndicesBase64?: string;
    }>;
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
      positionProperty: "backgroundPosition" | "backgroundPositionY";
      positions: readonly string[];
      positionIndicesBase64?: string;
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

interface PlaybackTimeline {
  readonly frames: readonly number[];
  readonly introTicks: number;
  readonly loopTicks: number;
  readonly deadlineMicros?: readonly number[];
}

interface PlaybackProfileTimeline extends PlaybackTimeline {
  readonly profileId: string;
}

interface PlaybackBank {
  readonly id: string;
  readonly entryFrame: number;
  readonly timeline: PlaybackTimeline;
  readonly profileTimelines?: readonly PlaybackProfileTimeline[];
}

interface WirePlaybackPacket {
  readonly shapeCount: number;
  readonly leafCount: number;
  readonly appearances: readonly Appearance[];
  readonly timeline: PlaybackTimeline;
  readonly profileTimelines?: readonly PlaybackProfileTimeline[];
  readonly initialBankId?: string;
  readonly banks?: readonly PlaybackBank[];
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

interface WirePagedPlaybackPacket {
  readonly version: 0;
  readonly shapeCount: number;
  readonly leafCount: number;
  readonly appearances: readonly Appearance[];
  readonly timeline: PlaybackTimeline;
  readonly profileTimelines?: readonly PlaybackProfileTimeline[];
  readonly initialBankId?: string;
  readonly banks?: readonly PlaybackBank[];
  readonly initial: Readonly<{ sourceFrame: number; appearance: number }>;
  readonly pages: readonly Readonly<{
    resource: string;
    startFrame: number;
    endFrame: number;
    transformCount: number;
    shapeChangeCount: number;
    leafChangeCount: number;
    materializedByteLength: number;
  }>[];
  readonly lookaheadPages: number;
  readonly maxResidentPages: number;
}

interface ExpandedPlaybackPacket extends Omit<WirePlaybackPacket, "initial" | "shapeChanges" | "leafChanges" | "transforms"> {
  readonly kind: "inline";
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

export interface ExpandedPagedPlaybackPacket extends WirePagedPlaybackPacket {
  readonly kind: "paged";
}

interface WirePlaybackData {
  readonly packet: WirePlaybackPacket;
  readonly leafFit: readonly Readonly<{ canonicalSize: number }>[];
}

interface WireVariantPacket {
  readonly version: number;
  readonly frameCount: number;
  readonly classes: readonly string[];
  readonly initial: Readonly<{ frame: number; classIndicesBase64: string }>;
  readonly sequential: Readonly<{
    offsetsBase64: string;
    targetIndicesBase64: string;
    classIndicesBase64: string;
  }>;
  readonly nonInteractiveJumps: readonly Readonly<{
    fromFrame: number;
    toFrame: number;
    targetIndicesBase64: string;
    classIndicesBase64: string;
  }>[];
}

interface ExpandedVariantPacket {
  readonly frameCount: number;
  readonly classes: readonly string[];
  readonly initial: Uint16Array;
  readonly sequentialOffsets: Uint32Array;
  readonly sequentialTargets: Uint16Array;
  readonly sequentialClasses: Uint16Array;
  readonly jumps: ReadonlyMap<string, Readonly<{ targets: Uint16Array; classes: Uint16Array }>>;
}

interface WireViewportProfile {
  readonly id: string;
  readonly width?: number;
  readonly height?: number;
  readonly transformIndicesBase64: string;
  readonly visibleBitsBase64: string;
  readonly visibilityChanges?: Readonly<{
    offsetsBase64: string;
    leafIndicesBase64: string;
  }>;
  readonly responsiveAffine?: Readonly<{
    scale: Readonly<{
      baseWidth: number;
      baseHeight: number;
      multiplier: number;
      max?: number;
    }>;
    presentBitsBase64: string;
    coefficientsBase64: string;
  }>;
}

interface WireViewportProfilesPacket {
  readonly version: number;
  readonly selection: Readonly<{ mode: "presentation-profile" | "smallest-covering" }>;
  readonly transforms: readonly (readonly number[])[];
  readonly profiles: readonly WireViewportProfile[];
}

interface ExpandedViewportProfile {
  readonly id: string;
  readonly width?: number;
  readonly height?: number;
  readonly transformIndices: Uint16Array;
  readonly visible: Uint8Array;
  readonly visibilityOffsets: Uint32Array | null;
  readonly visibilityLeaves: Uint16Array | null;
  readonly responsiveAffine: Readonly<{
    scale: Readonly<{ baseWidth: number; baseHeight: number; multiplier: number; max?: number }>;
    present: Uint8Array;
    coefficients: Float64Array;
  }> | null;
}

interface ExpandedViewportProfiles {
  readonly selectionMode: "presentation-profile" | "smallest-covering";
  readonly transforms: readonly string[];
  readonly profiles: readonly ExpandedViewportProfile[];
}

export interface MaterializedPolycssState {
  readonly channels: Map<string, DomStateChannel>;
  readonly lighting: ExpandedLighting | null;
  readonly playback: ExpandedPlaybackPacket | ExpandedPagedPlaybackPacket | null;
  readonly surface: Readonly<Record<string, unknown>> | null;
  readonly variants: ExpandedVariantPacket | null;
  readonly viewportProfiles: ExpandedViewportProfiles | null;
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

function float64(value: string): Float64Array {
  const input = bytes(value);
  invariant(input.length % 8 === 0, "TRUNCATED_STATE_TABLE", "Base64 float table is truncated.");
  const view = new DataView(input.buffer, input.byteOffset, input.byteLength);
  return Float64Array.from({ length: input.length / 8 }, (_, index) => view.getFloat64(index * 8, true));
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
  const coordinate = (value: number): string => value === 0 ? "0" : `${value}px`;
  const positions = packing.positionDictionary
    ? packing.positionDictionary.map((position) => position.map(coordinate).join(" "))
    : new Array<string>(packing.stateCount);
  for (const face of surface.faces) {
    let frame = 0;
    for (let local = 0; local < face.stateCount; local += 1) {
      const index = face.stateOffset + local;
      frame += packing.sourceFrameDeltas[index];
      sourceFrames[index] = frame;
      if (!packing.positionDictionary) positions[index] = `${frame === 0 ? 0 : -frame * face.leafHeight}px`;
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
        positionProperty: packing.positionDictionary ? "backgroundPosition" : "backgroundPositionY",
        positions,
        ...(packing.positionIndicesBase64 === undefined ? {} : { positionIndicesBase64: packing.positionIndicesBase64 }),
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
      statePacking: { stateCount: 0, sourceFramesBase64: "", positionProperty: "backgroundPositionY", positions: [] },
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

function expandViewportProfiles(section: Readonly<Record<string, unknown>>, leafCount: number): ExpandedViewportProfiles {
  const packet = section.packet as unknown as WireViewportProfilesPacket;
  return Object.freeze({
    selectionMode: packet.selection.mode,
    transforms: Object.freeze(packet.transforms.map(matrix)),
    profiles: Object.freeze(packet.profiles.map((profile) => Object.freeze({
      id: profile.id,
      ...(profile.width === undefined ? {} : { width: profile.width }),
      ...(profile.height === undefined ? {} : { height: profile.height }),
      transformIndices: uint16(profile.transformIndicesBase64),
      visible: bitset(profile.visibleBitsBase64, leafCount),
      visibilityOffsets: profile.visibilityChanges ? uint32(profile.visibilityChanges.offsetsBase64) : null,
      visibilityLeaves: profile.visibilityChanges ? uint16(profile.visibilityChanges.leafIndicesBase64) : null,
      responsiveAffine: profile.responsiveAffine ? Object.freeze({
        scale: Object.freeze({ ...profile.responsiveAffine.scale }),
        present: bitset(profile.responsiveAffine.presentBitsBase64, leafCount),
        coefficients: float64(profile.responsiveAffine.coefficientsBase64),
      }) : null,
    }))),
  });
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
    kind: "inline",
    initial,
    shapeChanges: expandChanges(raw.shapeChanges, raw.frameRows, 4, true),
    leafChanges: expandChanges(raw.leafChanges, raw.frameRows, 6, false),
  };
  return {
    ...packet,
    kind: "inline",
    transforms: expandTransforms(raw.transforms, packet, data.leafFit, lighting.surface.faces),
  };
}

function expandVariants(section: Readonly<Record<string, unknown>>): ExpandedVariantPacket {
  const packet = section.packet as unknown as WireVariantPacket;
  const initial = uint16(packet.initial.classIndicesBase64);
  const offsets = uint32(packet.sequential.offsetsBase64);
  const targets = uint16(packet.sequential.targetIndicesBase64);
  const classes = uint16(packet.sequential.classIndicesBase64);
  invariant(offsets.length === packet.frameCount + 1 && targets.length === classes.length, "TRUNCATED_VARIANTS", "Prepared variant transitions are incomplete.");
  const jumps = new Map<string, Readonly<{ targets: Uint16Array; classes: Uint16Array }>>();
  for (const jump of packet.nonInteractiveJumps) {
    const jumpTargets = uint16(jump.targetIndicesBase64);
    const jumpClasses = uint16(jump.classIndicesBase64);
    invariant(jumpTargets.length === jumpClasses.length, "TRUNCATED_VARIANTS", `Prepared variant jump ${jump.fromFrame}>${jump.toFrame} is incomplete.`);
    jumps.set(`${jump.fromFrame}>${jump.toFrame}`, Object.freeze({ targets: jumpTargets, classes: jumpClasses }));
  }
  return Object.freeze({
    frameCount: packet.frameCount,
    classes: Object.freeze([...packet.classes]),
    initial,
    sequentialOffsets: offsets,
    sequentialTargets: targets,
    sequentialClasses: classes,
    jumps,
  });
}

interface VisibilityState {
  readonly initial: Uint8Array;
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
  const jumps = new Map<string, Uint16Array>(schedule.nonInteractiveJumps.map((jump): [string, Uint16Array] => [`${jump.fromFrame}>${jump.toFrame}`, uint16(jump.faceIndicesBase64)]));
  return { initial, sequentialOffsets, sequentialFaces, jumps };
}

interface LightingFace extends SurfaceFace {
  readonly sourceFrames: Uint16Array;
}

interface LightingState {
  readonly faces: LightingFace[];
  readonly positionProperty: "backgroundPosition" | "backgroundPositionY";
  readonly positions: readonly string[];
  readonly positionIndices: Uint16Array | null;
  readonly sequentialOffsets: Uint32Array;
  readonly sequentialFaces: Uint16Array;
  readonly sequentialStates: Uint16Array;
  readonly jumps: Map<string, { faces: Uint16Array; states: Uint16Array }>;
}

function lightingState(lighting: ExpandedLighting): LightingState {
  const packing = lighting.surface.statePacking;
  const sourceFrames = uint16(packing.sourceFramesBase64);
  const positionIndices = packing.positionIndicesBase64 === undefined ? null : uint16(packing.positionIndicesBase64);
  invariant(sourceFrames.length === packing.stateCount && (positionIndices === null ? packing.positions.length === packing.stateCount : positionIndices.length === packing.stateCount), "TRUNCATED_LIGHTING", "Lighting states are incomplete.");
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
    positionProperty: packing.positionProperty,
    positions: packing.positions,
    positionIndices,
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
  const pagedPlaybackChannel = [...channels.values()].find((channel) => channel.codec === "polycss-paged-playback@0");
  const variantChannel = [...channels.values()].find((channel) => channel.codec === "polycss-variants-packed@0");
  const viewportProfileChannel = [...channels.values()].find((channel) => channel.codec === "polycss-viewport-profiles-packed@0");
  if (!playbackChannel && !pagedPlaybackChannel) return Object.freeze({ channels, lighting: null, playback: null, surface: null, variants: null, viewportProfiles: null });
  const playbackData = playbackChannel?.data as unknown as WirePlaybackData | undefined;
  const pagedPacket = (pagedPlaybackChannel?.data as unknown as { readonly packet: WirePagedPlaybackPacket } | undefined)?.packet;
  const rawPacket = playbackData?.packet ?? pagedPacket!;
  invariant(surfaceChannel || rawPacket.leafCount === 0, "MISSING_POLYCSS_CHANNEL", "Prepared playback leaves require a surface channel.");
  const lighting = surfaceChannel
    ? expandLighting(surfaceChannel.data)
    : emptyLighting(playbackData?.packet.frameRows.length ?? pagedPacket!.pages.at(-1)!.endFrame);
  const playback = playbackData ? expandPlayback(playbackData, lighting) : Object.freeze({ ...pagedPacket!, kind: "paged" as const });
  const variants = variantChannel
    ? expandVariants(variantChannel.data)
    : null;
  const viewportProfiles = viewportProfileChannel
    ? expandViewportProfiles(viewportProfileChannel.data, playback.leafCount)
    : null;
  return Object.freeze({ channels, lighting, playback, surface: surfaceChannel?.data ?? null, variants, viewportProfiles });
}

function timelineFrame(timeline: PlaybackTimeline, tick: number): number {
  const index = tick < timeline.frames.length
    ? tick
    : timeline.introTicks + (tick - timeline.introTicks) % timeline.loopTicks;
  return timeline.frames[index];
}

function fixedTickIntervalMs(parameters: PlaybackParameters): number {
  return parameters.tickIntervalUs
    ? parameters.tickIntervalUs[0] / parameters.tickIntervalUs[1] / 1000
    : 1000 / parameters.tickRateHz!;
}

function timelineDeadlineMicros(timeline: PlaybackTimeline, tick: number): number {
  const deadlines = timeline.deadlineMicros;
  invariant(deadlines && Number.isSafeInteger(tick) && tick >= 0, "INVALID_PLAYBACK_PUBLICATION", "Prepared playback deadline tick is invalid.");
  if (tick < deadlines.length) return deadlines[tick];
  const loopStart = timeline.introTicks;
  const loopOffset = tick - loopStart;
  const cycles = Math.floor(loopOffset / timeline.loopTicks);
  const remainder = loopOffset % timeline.loopTicks;
  const loopDuration = deadlines.at(-1)! - deadlines[loopStart];
  const result = deadlines[loopStart] + cycles * loopDuration + deadlines[loopStart + remainder] - deadlines[loopStart];
  invariant(Number.isSafeInteger(result), "INVALID_PLAYBACK_PUBLICATION", "Prepared playback deadline tick exceeds the safe integer range.");
  return result;
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
  readonly bankId: string | null;
  tickSpan(count: number): number;
  ticksWithin(elapsedMs: number, maximum?: number): number;
  frameAfter(count: number): number;
  publishInitial(): number;
  advance(): number;
  advanceMany(count: number): readonly number[];
  advanceCollapsed(count: number): number;
  seek(frame: number): number;
  bankEntryFrame(id: string): number;
  selectBank(id: string): number;
  restart(shapeIndices?: readonly number[], leafIndices?: readonly number[]): number;
  selectProfileTimeline(presentationProfileId: string | null): boolean;
  applySurfaceFrame(frame: number): number;
  applyViewportProfile(width: number, height: number, presentationProfileId: string | null): string | null;
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
    get bankId() { return null; },
    tickSpan(count: number) {
      invariant(Number.isSafeInteger(count) && count >= 1, "INVALID_PLAYBACK_PUBLICATION", "Static playback timing count must be a positive integer.");
      return count * (1000 / 30);
    },
    ticksWithin(elapsedMs: number, maximum = Number.MAX_SAFE_INTEGER) {
      invariant(Number.isFinite(elapsedMs) && elapsedMs >= 0 && Number.isSafeInteger(maximum) && maximum >= 1, "INVALID_PLAYBACK_PUBLICATION", "Static playback elapsed timing is invalid.");
      return Math.min(maximum, Math.floor(elapsedMs / (1000 / 30)));
    },
    frameAfter(count: number) {
      invariant(Number.isSafeInteger(count) && count >= 1, "INVALID_PLAYBACK_PUBLICATION", "Static playback preview count must be a positive integer.");
      return 1;
    },
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
    advanceCollapsed(count: number) {
      invariant(Number.isSafeInteger(count) && count >= 1, "INVALID_PLAYBACK_PUBLICATION", "Static playback collapsed count must be a positive integer.");
      return 1;
    },
    seek,
    bankEntryFrame(id: string) {
      invariant(false, "UNKNOWN_PREPARED_BANK", `Prepared bank ${String(id)} is unsupported by this document.`);
    },
    selectBank(id: string) {
      invariant(false, "UNKNOWN_PREPARED_BANK", `Prepared bank ${String(id)} is unsupported by this document.`);
    },
    restart() { return 1; },
    selectProfileTimeline(presentationProfileId: string | null) {
      invariant(presentationProfileId === null || typeof presentationProfileId === "string", "INVALID_PLAYBACK_PUBLICATION", "Static presentation profile id is invalid.");
      return false;
    },
    applySurfaceFrame: seek,
    applyViewportProfile(width: number, height: number, presentationProfileId: string | null) {
      invariant(Number.isFinite(width) && width >= 0 && Number.isFinite(height) && height >= 0 && (presentationProfileId === null || typeof presentationProfileId === "string"), "INVALID_VIEWPORT_PROFILE_PUBLICATION", "Static presentation viewport profile input is invalid.");
      return null;
    },
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
  readonly tickRateHz?: number;
  readonly tickIntervalUs?: readonly [number, number];
}

type BoundPlaybackTargets = Readonly<{
  model?: HTMLElement;
  shapes?: readonly HTMLElement[];
  leaves?: readonly HTMLElement[];
}>;

type BoundVariantTargets = Readonly<{ nodes?: readonly HTMLElement[] }>;

export function createPolycssPlayback(
  materialized: MaterializedPolycssState,
  bindings: DomBindings,
  mounted: MountedTree,
  options: {
    readonly publishAppearance?: (appearance: Appearance) => void;
    readonly boundTargets?: ReadonlyMap<string, Readonly<{ targets: unknown }>>;
    readonly pagedState?: PolycssPagedState | null;
    readonly assertPagedFrameReady?: (frame: number) => void;
    readonly compositorTiming?: PolycssCompositorTiming | null;
    readonly diagnostics?: PolycssPublicationDiagnostics;
  } = {},
): PolycssPlayback {
  const publishAppearance = options.publishAppearance;
  invariant(typeof publishAppearance === "function", "MISSING_PRESENTATION_PUBLISHER", "Playback requires the static presentation publisher.");
  const playbackBinding = bindings.channels.find((channel) => channel.interpreter === "polycss-playback@0" || channel.interpreter === "polycss-paged-playback@0");
  if (!playbackBinding) return createStaticPlayback(publishAppearance);
  const packet = materialized.playback;
  const surfaceBinding = bindings.channels.find((channel) => channel.interpreter === "polycss-surface@0");
  const variantBinding = bindings.channels.find((channel) => channel.interpreter === "polycss-variants@0");
  const pagedVariantBinding = bindings.channels.find((channel) => channel.interpreter === "polycss-paged-variants@0");
  const viewportProfileBinding = bindings.channels.find((channel) => channel.interpreter === "polycss-viewport-profiles@0");
  invariant(packet && materialized.lighting && (surfaceBinding || packet.leafCount === 0), "MISSING_POLYCSS_BINDING", "Executable playback requires its materialized state and surface binding.");
  invariant((packet.kind === "paged") === Boolean(options.pagedState?.hasPlayback), "MISSING_POLYCSS_BINDING", "Executable paged playback requires the document page coordinator.");
  invariant(Boolean(variantBinding) === Boolean(materialized.variants), "MISSING_POLYCSS_BINDING", "Executable prepared variants require matching state and binding channels.");
  invariant(Boolean(pagedVariantBinding) === Boolean(options.pagedState?.hasVariants), "MISSING_POLYCSS_BINDING", "Executable paged variants require a prepared page runtime.");
  invariant(Boolean(viewportProfileBinding) === Boolean(materialized.viewportProfiles), "MISSING_POLYCSS_BINDING", "Executable viewport profiles require matching state and binding channels.");
  const playbackTargets = playbackBinding.targets as unknown as PlaybackTargets;
  const playbackParameters = playbackBinding.parameters as unknown as PlaybackParameters;
  const bound = options.boundTargets?.get(playbackBinding.id)?.targets as BoundPlaybackTargets | undefined;
  const scene = bound?.model ?? mounted.byId.get(playbackTargets.model);
  const shapeTargets = bound?.shapes ?? playbackTargets.shapes.map((id) => mounted.byId.get(id));
  const leafTargets = bound?.leaves ?? playbackTargets.leaves.map((id) => mounted.byId.get(id));
  invariant(scene && shapeTargets.every(Boolean) && leafTargets.every(Boolean), "MISSING_TARGET_NODE", "Playback target nodes are not mounted.");
  const shapes = shapeTargets as readonly HTMLElement[];
  const leaves = leafTargets as readonly HTMLElement[];
  const variantIds = variantBinding ? (variantBinding.targets as unknown as { readonly nodes: readonly string[] }).nodes : [];
  const variantBound = variantBinding ? options.boundTargets?.get(variantBinding.id)?.targets as BoundVariantTargets | undefined : undefined;
  const variantTargets = variantBound?.nodes ?? variantIds.map((id) => mounted.byId.get(id));
  invariant(variantTargets.every(Boolean), "MISSING_TARGET_NODE", "Prepared variant target nodes are not mounted.");
  const variants = materialized.variants;
  const variantNodes = variantTargets as readonly HTMLElement[];
  const appliedVariants = variants?.initial.slice() ?? new Uint16Array(0);
  let variantFrame = variants ? 1 : 0;
  const baseSceneTransform = playbackParameters.baseSceneTransform;
  const shapeTransforms = new Array<string>(packet.shapeCount);
  const shapeVisibility = new Uint8Array(packet.shapeCount);
  const leafTransforms = new Array<string>(packet.leafCount);
  const dirtyHiddenTransforms = new Uint8Array(packet.leafCount);
  const interactionTransforms = new Uint8Array(packet.leafCount);
  const profileTransformOverrides = new Uint16Array(packet.leafCount);
  profileTransformOverrides.fill(0xffff);
  const profileResponsiveTransforms = new Array<string | null>(packet.leafCount).fill(null);
  const profileVisible = new Uint8Array(packet.leafCount);
  profileVisible.fill(1);
  const profileVisibilityDirty = new Uint16Array(packet.leafCount);
  const pagedInitial = packet.kind === "paged" ? options.pagedState?.initialPlayback : null;
  if (packet.kind === "inline") {
    for (let offset = 0; offset < packet.initial.shapes.length; offset += 3) {
      shapeTransforms[packet.initial.shapes[offset]] = packet.transforms[packet.initial.shapes[offset + 1]];
      shapeVisibility[packet.initial.shapes[offset]] = packet.initial.shapes[offset + 2];
    }
    for (let offset = 0; offset < packet.initial.leaves.length; offset += 2) leafTransforms[packet.initial.leaves[offset]] = packet.transforms[packet.initial.leaves[offset + 1]];
  } else {
    invariant(pagedInitial && pagedInitial.shapeTransforms.length === packet.shapeCount && pagedInitial.leafTransforms.length === packet.leafCount, "STATE_PAGE_NOT_READY", "Paged playback initial canonical row is unavailable.");
    for (let index = 0; index < packet.shapeCount; index += 1) { shapeTransforms[index] = pagedInitial.shapeTransforms[index]; shapeVisibility[index] = pagedInitial.shapeVisibility[index]; }
    for (let index = 0; index < packet.leafCount; index += 1) leafTransforms[index] = pagedInitial.leafTransforms[index];
  }
  const visibility = visibilityState(materialized.lighting, packet.leafCount, playbackParameters.frameCount);
  const light = lightingState(materialized.lighting);
  const visible = visibility.initial.slice();
  const forced = new Uint8Array(packet.leafCount);
  const degenerate = new Uint8Array(packet.leafCount);
  const appliedStates = new Uint16Array(packet.leafCount);
  const dirtySurfaceStates = new Uint8Array(packet.leafCount);
  const surfaceScratchStates = new Uint16Array(packet.leafCount);
  const surfaceDirtyFlags = new Uint8Array(packet.leafCount);
  const surfaceDirtyIndices = new Uint16Array(packet.leafCount);
  const visibilityDirtyFlags = new Uint8Array(packet.leafCount);
  const visibilityDirtyIndices = new Uint16Array(packet.leafCount);
  let currentForced = new Uint16Array(0);
  let sourceFrame = packet.initial.sourceFrame;
  let surfaceFrame = packet.initial.sourceFrame;
  let appearanceIndex = packet.initial.appearance;
  let modelTransform = packet.kind === "inline" ? packet.transforms[packet.initial.modelTransform] : pagedInitial!.modelTransform;
  let tick = 0;
  let initialPublished = false;
  let selectedViewportProfile = -2;
  let selectedViewportWidth = -1;
  let selectedViewportHeight = -1;
  let profileVisibilityFrame = packet.initial.sourceFrame;
  const banks = new Map(packet.banks?.map((bank): [string, PlaybackBank] => [bank.id, bank]) ?? []);
  let activeBank = packet.initialBankId === undefined ? null : banks.get(packet.initialBankId) ?? null;
  let selectedTimelineProfileId: string | null = null;
  const timelineFor = (bank: PlaybackBank | null, profileId: string | null): PlaybackTimeline => {
    const baseline = bank?.timeline ?? packet.timeline;
    const profiles = bank?.profileTimelines ?? packet.profileTimelines;
    return profileId === null ? baseline : profiles?.find((timeline) => timeline.profileId === profileId) ?? baseline;
  };
  let activeTimeline: PlaybackTimeline = timelineFor(activeBank, null);

  const applyAppearance = () => publishAppearance(packet.appearances[appearanceIndex]);

  const writeModel = () => {
    const next = modelTransform === "" ? baseSceneTransform : `${baseSceneTransform} ${modelTransform}`;
    if (scene.style.transform !== next) scene.style.transform = next;
  };

  const isPaintVisible = (index: number): boolean => ((visible[index] === 1 && profileVisible[index] === 1) || forced[index] === 1) && degenerate[index] === 0;

  const preparedLeafTransform = (index: number): string => {
    const responsive = profileResponsiveTransforms[index];
    if (responsive !== null) return responsive;
    const override = profileTransformOverrides[index];
    return override === 0xffff ? leafTransforms[index] : materialized.viewportProfiles!.transforms[override];
  };

  const profileVisibilityAt = (profile: ExpandedViewportProfile, frame: number): Uint8Array => {
    const result = profile.visible.slice();
    const offsets = profile.visibilityOffsets;
    const targets = profile.visibilityLeaves;
    if (!offsets || !targets) return result;
    for (let next = 2; next <= frame; next += 1) {
      for (let cursor = offsets[next - 1]; cursor < offsets[next]; cursor += 1) result[targets[cursor]] ^= 1;
    }
    return result;
  };

  const stageProfileVisibility = (frame: number): number => {
    const profile = selectedViewportProfile < 0 ? null : materialized.viewportProfiles!.profiles[selectedViewportProfile];
    if (!profile) {
      profileVisibilityFrame = frame;
      return 0;
    }
    let changed = 0;
    const offsets = profile.visibilityOffsets;
    const targets = profile.visibilityLeaves;
    if (offsets && targets && frame === (profileVisibilityFrame === playbackParameters.frameCount ? 1 : profileVisibilityFrame + 1)) {
      for (let cursor = offsets[frame - 1]; cursor < offsets[frame]; cursor += 1) {
        const leaf = targets[cursor];
        profileVisible[leaf] ^= 1;
        profileVisibilityDirty[changed++] = leaf;
      }
    } else {
      const next = profileVisibilityAt(profile, frame);
      for (let leaf = 0; leaf < packet.leafCount; leaf += 1) {
        if (profileVisible[leaf] === next[leaf]) continue;
        profileVisible[leaf] = next[leaf];
        profileVisibilityDirty[changed++] = leaf;
      }
    }
    profileVisibilityFrame = frame;
    return changed;
  };

  const roundedAffine = (value: number): string => {
    const rounded = Math.round(value * 1_000_000) / 1_000_000;
    return String(Object.is(rounded, -0) ? 0 : rounded);
  };

  const responsiveAffineTransforms = (profile: ExpandedViewportProfile | null, width: number, height: number): (string | null)[] => {
    const affine = profile?.responsiveAffine;
    if (!affine) return new Array<string | null>(packet.leafCount).fill(null);
    const rawScale = affine.scale.multiplier * Math.min(width / affine.scale.baseWidth, height / affine.scale.baseHeight);
    const scale = affine.scale.max === undefined ? rawScale : Math.min(affine.scale.max, rawScale);
    const result = new Array<string | null>(packet.leafCount).fill(null);
    let cursor = 0;
    for (let leaf = 0; leaf < packet.leafCount; leaf += 1) {
      if (affine.present[leaf] === 0) continue;
      const coefficients = affine.coefficients.subarray(cursor, cursor + 16);
      const values = [
        coefficients[0] + coefficients[1] * scale,
        coefficients[2] + coefficients[3] * scale,
        coefficients[4] + coefficients[5] * scale,
        coefficients[6] + coefficients[7] * scale,
        coefficients[8] + coefficients[9] * width + coefficients[10] * height + coefficients[11] * scale,
        coefficients[12] + coefficients[13] * width + coefficients[14] * height + coefficients[15] * scale,
      ];
      invariant(values.every(Number.isFinite), "INVALID_VIEWPORT_PROFILE_PUBLICATION", "Responsive affine publication produced a non-finite matrix component.");
      result[leaf] = `matrix(${values.map(roundedAffine).join(",")})`;
      cursor += 16;
    }
    invariant(cursor === affine.coefficients.length, "INVALID_VIEWPORT_PROFILE_PUBLICATION", "Responsive affine coefficients are incomplete.");
    return result;
  };

  const writePreparedLeafTransform = (index: number): void => {
    leaves[index].style.transform = preparedLeafTransform(index);
    dirtyHiddenTransforms[index] = 0;
    interactionTransforms[index] = 0;
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
    for (let index = 0; index < leaves.length; index += 1) {
      if (dirtyHiddenTransforms[index] === 1 || interactionTransforms[index] === 1) writePreparedLeafTransform(index);
    }
  };

  const writePreparedSurfaceState = (index: number, state: number): void => {
    const face = light.faces[index];
    const packedState = face.stateOffset + state;
    const positionIndex = light.positionIndices?.[packedState] ?? packedState;
    leaves[index].style[light.positionProperty] = light.positions[positionIndex];
    appliedStates[index] = state;
    dirtySurfaceStates[index] = 0;
  };

  const flushPreparedSurfaceState = (index: number, frame: number): void => {
    const face = light.faces[index];
    const state = stateAt(face, frame - 1);
    invariant(state >= 0 && state < face.stateCount, "INVALID_SURFACE_PUBLICATION", `Prepared surface leaf ${index} has no state for frame ${frame}.`);
    if (dirtySurfaceStates[index] === 1 || appliedStates[index] !== state) writePreparedSurfaceState(index, state);
  };

  const writeVisibility = (index: number, frame = surfaceFrame): void => {
    const paintVisible = isPaintVisible(index);
    const next = paintVisible ? "visible" : "hidden";
    if (paintVisible) {
      if (interactionTransforms[index] === 0) flushPreparedLeafTransform(index);
      flushPreparedSurfaceState(index, frame);
    }
    if (leaves[index].style.visibility !== next) leaves[index].style.visibility = next;
  };

  const applyVariants = (frame: number): void => {
    if (options.pagedState) {
      options.pagedState.publishVariants(frame);
      variantFrame = frame;
      return;
    }
    if (!variants || frame === variantFrame) return;
    const applyChanges = (targets: Uint16Array, classes: Uint16Array, start = 0, end = targets.length): void => {
      invariant(end <= targets.length && end <= classes.length, "INVALID_VARIANT_PUBLICATION", `Prepared variants have an incomplete state for frame ${frame}.`);
      for (let cursor = start; cursor < end; cursor += 1) {
        const index = targets[cursor];
        const value = classes[cursor];
        const previous = appliedVariants[index];
        if (previous === value) continue;
        if (previous !== 0xffff) variantNodes[index].classList.remove(variants.classes[previous]);
        if (value !== 0xffff) variantNodes[index].classList.add(variants.classes[value]);
        appliedVariants[index] = value;
      }
    };
    const sequentialFrame = variantFrame === variants.frameCount ? 1 : variantFrame + 1;
    if (frame === sequentialFrame) {
      const start = variants.sequentialOffsets[frame - 1];
      const end = variants.sequentialOffsets[frame];
      applyChanges(variants.sequentialTargets, variants.sequentialClasses, start, end);
    } else {
      const jump = variants.jumps.get(`${variantFrame}>${frame}`);
      if (jump) applyChanges(jump.targets, jump.classes);
      else {
        const pending = new Map<number, number>();
        let nextFrame = variantFrame;
        while (nextFrame !== frame) {
          nextFrame = nextFrame === variants.frameCount ? 1 : nextFrame + 1;
          const start = variants.sequentialOffsets[nextFrame - 1];
          const end = variants.sequentialOffsets[nextFrame];
          for (let cursor = start; cursor < end; cursor += 1) pending.set(variants.sequentialTargets[cursor], variants.sequentialClasses[cursor]);
        }
        const targets = Uint16Array.from([...pending.keys()].sort((left, right) => left - right));
        const classes = Uint16Array.from(targets, (target) => pending.get(target)!);
        applyChanges(targets, classes);
      }
    }
    variantFrame = frame;
  };

  const publishSurfaceState = (frame: number): void => {
    if (options.diagnostics) {
      options.diagnostics.surfaceFullReconstructions += 1;
      options.diagnostics.surfaceLightingTargetVisits += leaves.length;
      options.diagnostics.surfaceVisibilityTargetVisits += leaves.length;
    }
    for (let index = 0; index < leaves.length; index += 1) {
      const face = light.faces[index];
      const state = stateAt(face, frame - 1);
      invariant(state >= 0 && state < face.stateCount, "INVALID_SURFACE_PUBLICATION", `Prepared surface leaf ${index} has no state for frame ${frame}.`);
      writePreparedSurfaceState(index, state);
      writeVisibility(index, frame);
    }
    surfaceFrame = frame;
  };

  const publishSurfaceTarget = (index: number, state: number, frame: number): void => {
    const face = light.faces[index];
    invariant(state >= 0 && state < face.stateCount, "INVALID_SURFACE_PUBLICATION", `Prepared surface leaf ${index} has no state for frame ${frame}.`);
    if (isPaintVisible(index) && (appliedStates[index] !== state || dirtySurfaceStates[index] === 1)) writePreparedSurfaceState(index, state);
    else if (!isPaintVisible(index)) dirtySurfaceStates[index] = appliedStates[index] === state ? 0 : 1;
  };

  const publishSurfaceRangeWithForced = (faces: Uint16Array, states: Uint16Array, start: number, end: number, frame: number): void => {
    let cursor = start;
    let forcedCursor = 0;
    while (cursor < end || forcedCursor < currentForced.length) {
      const scheduled = cursor < end ? faces[cursor] : 0x10000;
      const forcedIndex = forcedCursor < currentForced.length ? currentForced[forcedCursor] : 0x10000;
      let index: number;
      let state: number;
      if (scheduled < forcedIndex) {
        index = scheduled;
        state = states[cursor++];
      } else if (forcedIndex < scheduled) {
        index = forcedIndex;
        state = stateAt(light.faces[index], frame - 1);
        forcedCursor += 1;
      } else {
        index = scheduled;
        state = states[cursor++];
        forcedCursor += 1;
      }
      if (options.diagnostics) options.diagnostics.surfaceLightingTargetVisits += 1;
      publishSurfaceTarget(index, state, frame);
    }
  };

  const markSurfaceSegment = (segment: number): void => {
    for (let cursor = light.sequentialOffsets[segment]; cursor < light.sequentialOffsets[segment + 1]; cursor += 1) {
      const index = light.sequentialFaces[cursor];
      surfaceScratchStates[index] = light.sequentialStates[cursor];
      surfaceDirtyFlags[index] = 1;
    }
  };

  const toggleVisibilitySegment = (segment: number, markDirty: boolean): void => {
    for (let cursor = visibility.sequentialOffsets[segment]; cursor < visibility.sequentialOffsets[segment + 1]; cursor += 1) {
      const index = visibility.sequentialFaces[cursor];
      visible[index] ^= 1;
      if (markDirty) visibilityDirtyFlags[index] = 1;
    }
  };

  const applySurface = (nextFrame: number): void => {
    if (nextFrame === surfaceFrame) return;
    const frameCount = playbackParameters.frameCount;
    const sequential = nextFrame === (surfaceFrame === frameCount ? 1 : surfaceFrame + 1);
    const jump = sequential ? undefined : light.jumps.get(`${surfaceFrame}>${nextFrame}`);
    const visibilityJump = sequential ? undefined : visibility.jumps.get(`${surfaceFrame}>${nextFrame}`);
    if (sequential) {
      const visibilityStart = visibility.sequentialOffsets[nextFrame - 1];
      const visibilityEnd = visibility.sequentialOffsets[nextFrame];
      toggleVisibilitySegment(nextFrame - 1, false);
      publishSurfaceRangeWithForced(light.sequentialFaces, light.sequentialStates, light.sequentialOffsets[nextFrame - 1], light.sequentialOffsets[nextFrame], nextFrame);
      if (options.diagnostics) options.diagnostics.surfaceVisibilityTargetVisits += visibilityEnd - visibilityStart;
      for (let cursor = visibilityStart; cursor < visibilityEnd; cursor += 1) writeVisibility(visibility.sequentialFaces[cursor], nextFrame);
    } else if (jump && visibilityJump) {
      for (const index of visibilityJump) {
        visible[index] ^= 1;
      }
      publishSurfaceRangeWithForced(jump.faces, jump.states, 0, jump.faces.length, nextFrame);
      if (options.diagnostics) options.diagnostics.surfaceVisibilityTargetVisits += visibilityJump.length;
      for (const index of visibilityJump) writeVisibility(index, nextFrame);
    } else {
      if (options.diagnostics) options.diagnostics.surfaceFullReconstructions += 1;
      let frame = surfaceFrame;
      while (frame !== nextFrame) {
        frame = frame === frameCount ? 1 : frame + 1;
        toggleVisibilitySegment(frame - 1, true);
        markSurfaceSegment(frame - 1);
      }
      for (const index of currentForced) {
        surfaceScratchStates[index] = stateAt(light.faces[index], nextFrame - 1);
        surfaceDirtyFlags[index] = 1;
      }
      let surfaceDirtyCount = 0;
      let visibilityDirtyCount = 0;
      for (let index = 0; index < packet.leafCount; index += 1) {
        if (surfaceDirtyFlags[index] === 1) { surfaceDirtyFlags[index] = 0; surfaceDirtyIndices[surfaceDirtyCount++] = index; }
        if (visibilityDirtyFlags[index] === 1) { visibilityDirtyFlags[index] = 0; visibilityDirtyIndices[visibilityDirtyCount++] = index; }
      }
      if (options.diagnostics) {
        options.diagnostics.surfaceLightingTargetVisits += surfaceDirtyCount;
        options.diagnostics.surfaceVisibilityTargetVisits += visibilityDirtyCount;
      }
      for (let cursor = 0; cursor < surfaceDirtyCount; cursor += 1) {
        const index = surfaceDirtyIndices[cursor];
        publishSurfaceTarget(index, surfaceScratchStates[index], nextFrame);
      }
      for (let cursor = 0; cursor < visibilityDirtyCount; cursor += 1) writeVisibility(visibilityDirtyIndices[cursor], nextFrame);
    }
    surfaceFrame = nextFrame;
  };

  const stageFrame = (frame: number, includePagedVariants = true): PagedStateStage => {
    if (packet.kind === "paged") return options.pagedState!.stage(frame, true);
    const row = packet.frameRows[frame - 1];
    invariant(row?.[0] === frame, "FRAME_INDEX_MISMATCH", `Prepared playback frame ${frame} is not directly indexed.`);
    const shapeTargets = new Uint32Array(row[4]);
    const stagedShapeTransforms = new Array<string>(row[4]);
    const stagedShapeVisibility = new Uint8Array(row[4]);
    for (let index = 0; index < row[4]; index += 1) {
      const base = (row[3] + index) * 3;
      shapeTargets[index] = packet.shapeChanges[base];
      stagedShapeTransforms[index] = packet.transforms[packet.shapeChanges[base + 1]];
      stagedShapeVisibility[index] = packet.shapeChanges[base + 2];
    }
    const leafTargets = new Uint32Array(row[6]);
    const stagedLeafTransforms = new Array<string>(row[6]);
    for (let index = 0; index < row[6]; index += 1) {
      const base = (row[5] + index) * 2;
      leafTargets[index] = packet.leafChanges[base];
      stagedLeafTransforms[index] = packet.transforms[packet.leafChanges[base + 1]];
    }
    const playbackStage: PagedPlaybackStage = Object.freeze({ frame, kind: "materialized", appearance: row[1], ...(row[2] === -1 ? {} : { modelTransform: packet.transforms[row[2]] }), shapeTargets, shapeTransforms: Object.freeze(stagedShapeTransforms), shapeVisibility: stagedShapeVisibility, leafTargets, leafTransforms: Object.freeze(stagedLeafTransforms) });
    return Object.freeze({ frame, playback: playbackStage, variants: includePagedVariants ? options.pagedState?.stage(frame, false).variants ?? null : null });
  };

  const applyStage = (staged: PagedStateStage, publish: boolean, dirtyShapes?: Set<number>, dirtyLeaves?: Set<number>, dirtyProfileLeaves?: Set<number>): void => {
    const next = staged.playback;
    invariant(next, "INVALID_PLAYBACK_PUBLICATION", `Prepared playback frame ${staged.frame} has no transform stage.`);
    if (publish && options.pagedState) options.pagedState.commit(packet.kind === "paged" ? staged : Object.freeze({ frame: staged.frame, playback: null, variants: staged.variants }));
    const nextFrame = next.frame;
    if (next.appearance !== appearanceIndex) {
      appearanceIndex = next.appearance;
      if (publish) applyAppearance();
    }
    if (next.modelTransform !== undefined) {
      modelTransform = next.modelTransform;
      if (publish) writeModel();
    }
    if (next.kind === "range") {
      if (options.diagnostics) {
        options.diagnostics.playbackPublicationShapeVisits += next.shapeEnd - next.shapeStart;
        options.diagnostics.playbackPublicationLeafVisits += next.leafEnd - next.leafStart;
      }
      for (let cursor = next.shapeStart; cursor < next.shapeEnd; cursor += 1) {
        const shape = next.page.shapeTargets[cursor];
        shapeTransforms[shape] = next.page.transforms[next.page.shapeTransforms[cursor]];
        shapeVisibility[shape] = next.page.shapeVisibility[cursor];
        dirtyShapes?.add(shape);
        if (publish) shapes[shape].style.transform = shapeTransforms[shape];
      }
      for (let cursor = next.leafStart; cursor < next.leafEnd; cursor += 1) {
        const leaf = next.page.leafTargets[cursor];
        leafTransforms[leaf] = next.page.transforms[next.page.leafTransforms[cursor]];
        dirtyLeaves?.add(leaf);
        if (publish) publishOrDeferPreparedLeafTransform(leaf);
      }
    } else if (next.kind === "complete") {
      if (options.diagnostics) {
        options.diagnostics.playbackPublicationShapeVisits += next.shapeTransforms.length;
        options.diagnostics.playbackPublicationLeafVisits += next.leafTransforms.length;
      }
      for (let shape = 0; shape < next.shapeTransforms.length; shape += 1) {
        shapeTransforms[shape] = next.shapeTransforms[shape];
        shapeVisibility[shape] = next.shapeVisibility[shape];
        dirtyShapes?.add(shape);
        if (publish) shapes[shape].style.transform = shapeTransforms[shape];
      }
      for (let leaf = 0; leaf < next.leafTransforms.length; leaf += 1) {
        leafTransforms[leaf] = next.leafTransforms[leaf];
        dirtyLeaves?.add(leaf);
        if (publish) publishOrDeferPreparedLeafTransform(leaf);
      }
    } else {
      if (options.diagnostics) {
        options.diagnostics.playbackPublicationShapeVisits += next.shapeTargets.length;
        options.diagnostics.playbackPublicationLeafVisits += next.leafTargets.length;
      }
      for (let index = 0; index < next.shapeTargets.length; index += 1) {
        const shape = next.shapeTargets[index];
        shapeTransforms[shape] = next.shapeTransforms[index];
        shapeVisibility[shape] = next.shapeVisibility[index];
        dirtyShapes?.add(shape);
        if (publish) shapes[shape].style.transform = shapeTransforms[shape];
      }
      for (let index = 0; index < next.leafTargets.length; index += 1) {
        const leaf = next.leafTargets[index];
        leafTransforms[leaf] = next.leafTransforms[index];
        dirtyLeaves?.add(leaf);
        if (publish) publishOrDeferPreparedLeafTransform(leaf);
      }
    }
    const profileVisibilityChangeCount = stageProfileVisibility(nextFrame);
    for (let cursor = 0; cursor < profileVisibilityChangeCount; cursor += 1) dirtyProfileLeaves?.add(profileVisibilityDirty[cursor]);
    if (publish) {
      if (!options.pagedState) applyVariants(nextFrame);
      applySurface(nextFrame);
      for (let cursor = 0; cursor < profileVisibilityChangeCount; cursor += 1) writeVisibility(profileVisibilityDirty[cursor], nextFrame);
      if (next.kind === "range") {
        for (let cursor = next.shapeStart; cursor < next.shapeEnd; cursor += 1) {
          const shape = next.page.shapeTargets[cursor];
          shapes[shape].style.visibility = shapeVisibility[shape] === 1 ? "visible" : "hidden";
        }
      } else if (next.kind === "complete") {
        for (let shape = 0; shape < next.shapeTransforms.length; shape += 1) shapes[shape].style.visibility = shapeVisibility[shape] === 1 ? "visible" : "hidden";
      } else {
        for (let cursor = 0; cursor < next.shapeTargets.length; cursor += 1) {
          const shape = next.shapeTargets[cursor];
          shapes[shape].style.visibility = shapeVisibility[shape] === 1 ? "visible" : "hidden";
        }
      }
    }
    sourceFrame = nextFrame;
  };

  const seekTo = (
    target: number,
    synchronize: boolean,
    publicationKind: "seek" | "restart" | null = "seek",
    publicationTick = tick,
  ): number => {
    invariant(Number.isSafeInteger(target) && target >= 1 && target <= playbackParameters.frameCount, "FRAME_RANGE", `Prepared playback frame ${target} is out of range.`);
    options.assertPagedFrameReady?.(target);
    const preflight = options.pagedState?.stage(target, packet.kind === "paged" && target !== sourceFrame);
    const dirtyProfileLeaves = new Set<number>();
    if (publicationKind) options.compositorTiming?.before(publicationKind, publicationTick);
    if (target !== sourceFrame) {
      const dirtyShapes = new Set<number>();
      const dirtyLeaves = new Set<number>();
      let pagedStage: PagedStateStage | undefined = preflight;
      if (packet.kind === "paged") {
        invariant(pagedStage?.playback, "INVALID_PLAYBACK_PUBLICATION", `Paged playback frame ${target} has no staged transform row.`);
        applyStage(pagedStage, false, dirtyShapes, dirtyLeaves, dirtyProfileLeaves);
      } else {
        let next = sourceFrame;
        while (next !== target) {
          next = next === playbackParameters.frameCount ? 1 : next + 1;
          applyStage(stageFrame(next, false), false, dirtyShapes, dirtyLeaves, dirtyProfileLeaves);
        }
      }
      if (pagedStage) options.pagedState!.commit(packet.kind === "paged" ? pagedStage : Object.freeze({ frame: target, playback: null, variants: pagedStage.variants }));
      writeModel();
      applyAppearance();
      for (const index of [...dirtyShapes].sort((left, right) => left - right)) {
        shapes[index].style.transform = shapeTransforms[index];
        shapes[index].style.visibility = shapeVisibility[index] === 1 ? "visible" : "hidden";
      }
      for (const index of [...dirtyLeaves].sort((left, right) => left - right)) {
        if (synchronize) dirtyHiddenTransforms[index] = 1;
        else publishOrDeferPreparedLeafTransform(index);
      }
      sourceFrame = target;
    }
    else if (preflight) options.pagedState!.commit(Object.freeze({ frame: target, playback: null, variants: preflight.variants }));
    if (synchronize) synchronizePreparedLeafTransforms();
    if (packet.kind === "inline" && !options.pagedState) applyVariants(target);
    const profileVisibilityChangeCount = stageProfileVisibility(target);
    applySurface(target);
    for (let cursor = 0; cursor < profileVisibilityChangeCount; cursor += 1) dirtyProfileLeaves.add(profileVisibilityDirty[cursor]);
    for (const index of dirtyProfileLeaves) writeVisibility(index, target);
    if (publicationKind) options.compositorTiming?.after(publicationKind, publicationTick);
    return target;
  };

  const seek = (target: number): number => seekTo(target, true);

  const tickSpan = (count: number): number => {
    invariant(Number.isSafeInteger(count) && count >= 1 && Number.isSafeInteger(tick + count), "INVALID_PLAYBACK_PUBLICATION", "Prepared playback timing count is invalid.");
    if (!activeTimeline.deadlineMicros) return count * fixedTickIntervalMs(playbackParameters);
    return (timelineDeadlineMicros(activeTimeline, tick + count) - timelineDeadlineMicros(activeTimeline, tick)) / 1000;
  };

  const ticksWithin = (elapsedMs: number, maximum = Number.MAX_SAFE_INTEGER): number => {
    invariant(Number.isFinite(elapsedMs) && elapsedMs >= 0 && Number.isSafeInteger(maximum) && maximum >= 1, "INVALID_PLAYBACK_PUBLICATION", "Prepared playback elapsed timing is invalid.");
    const safeMaximum = Math.min(maximum, Number.MAX_SAFE_INTEGER - tick);
    if (safeMaximum < 1 || tickSpan(1) > elapsedMs) return 0;
    if (!activeTimeline.deadlineMicros) return Math.min(safeMaximum, Math.floor(elapsedMs / fixedTickIntervalMs(playbackParameters)));
    let lower = 1;
    let upper = 1;
    while (upper < safeMaximum && tickSpan(upper) <= elapsedMs) {
      lower = upper;
      upper = Math.min(safeMaximum, upper * 2);
    }
    if (lower === upper || tickSpan(upper) <= elapsedMs) return upper;
    while (lower + 1 < upper) {
      const middle = lower + Math.floor((upper - lower) / 2);
      if (tickSpan(middle) <= elapsedMs) lower = middle;
      else upper = middle;
    }
    return lower;
  };

  const frameAfter = (count: number): number => {
    invariant(Number.isSafeInteger(count) && count >= 1, "INVALID_PLAYBACK_PUBLICATION", "Prepared playback preview count must be a positive integer.");
    return timelineFrame(activeTimeline, tick + count);
  };

  const advanceOne = (publish: boolean, dirtyShapes?: Set<number>, dirtyLeaves?: Set<number>, dirtyProfileLeaves?: Set<number>): number => {
    const nextTick = tick + 1;
    const target = timelineFrame(activeTimeline, nextTick);
    options.assertPagedFrameReady?.(target);
    tick = nextTick;
    if (target === sourceFrame) return target;
    const expected = sourceFrame === playbackParameters.frameCount ? 1 : sourceFrame + 1;
    if (target === expected) {
      if (publish) options.compositorTiming?.before(target === 1 ? "wrap" : "advance", tick);
      const staged = stageFrame(target);
      if (!publish && packet.kind === "paged") options.pagedState!.commit(staged, false);
      applyStage(staged, publish, dirtyShapes, dirtyLeaves, dirtyProfileLeaves);
      if (publish) options.compositorTiming?.after(target === 1 ? "wrap" : "advance", tick);
    }
    else if (publish) seekTo(target, false);
    else if (packet.kind === "paged") {
      const staged = stageFrame(target);
      options.pagedState!.commit(staged, false);
      applyStage(staged, false, dirtyShapes, dirtyLeaves, dirtyProfileLeaves);
    }
    else {
      let next = sourceFrame;
      while (next !== target) {
        next = next === playbackParameters.frameCount ? 1 : next + 1;
        const staged = stageFrame(next);
        applyStage(staged, false, dirtyShapes, dirtyLeaves, dirtyProfileLeaves);
      }
    }
    return target;
  };

  const advanceMany = (count: number): readonly number[] => {
    invariant(Number.isSafeInteger(count) && count >= 1, "INVALID_PLAYBACK_PUBLICATION", "Prepared playback catch-up count must be a positive integer.");
    for (let offset = 1; offset <= count; offset += 1) options.assertPagedFrameReady?.(frameAfter(offset));
    if (count === 1) return Object.freeze([advanceOne(true)]);
    const catchupTick = tick + count;
    options.compositorTiming?.before("catch-up", catchupTick);
    const initialAppearance = appearanceIndex;
    const initialModelTransform = modelTransform;
    const dirtyShapes = new Set<number>();
    const dirtyLeaves = new Set<number>();
    const dirtyProfileLeaves = new Set<number>();
    const frames: number[] = [];
    for (let index = 0; index < count; index += 1) frames.push(advanceOne(false, dirtyShapes, dirtyLeaves, dirtyProfileLeaves));
    applyVariants(sourceFrame);
    if (modelTransform !== initialModelTransform) writeModel();
    if (appearanceIndex !== initialAppearance) applyAppearance();
    for (const index of [...dirtyShapes].sort((left, right) => left - right)) {
      const transform = shapeTransforms[index];
      if (shapes[index].style.transform !== transform) shapes[index].style.transform = transform;
    }
    for (const index of [...dirtyLeaves].sort((left, right) => left - right)) publishOrDeferPreparedLeafTransform(index);
    applySurface(sourceFrame);
    for (const index of [...dirtyProfileLeaves].sort((left, right) => left - right)) writeVisibility(index, sourceFrame);
    for (const index of [...dirtyShapes].sort((left, right) => left - right)) {
      const nextVisibility = shapeVisibility[index] === 1 ? "visible" : "hidden";
      if (shapes[index].style.visibility !== nextVisibility) shapes[index].style.visibility = nextVisibility;
    }
    options.compositorTiming?.after("catch-up", tick);
    return Object.freeze(frames);
  };

  const advanceCollapsed = (count: number): number => {
    invariant(Number.isSafeInteger(count) && count >= 1 && Number.isSafeInteger(tick + count), "INVALID_PLAYBACK_PUBLICATION", "Prepared playback collapsed count is invalid.");
    const nextTick = tick + count;
    const target = timelineFrame(activeTimeline, nextTick);
    options.assertPagedFrameReady?.(target);
    options.compositorTiming?.before("catch-up", nextTick);
    tick = nextTick;
    seekTo(target, false, null, nextTick);
    options.compositorTiming?.after("catch-up", tick);
    return target;
  };

  const forceVisible = (indices: Iterable<number>): void => {
    invariant(indices && typeof indices[Symbol.iterator] === "function", "INVALID_INTERACTION_PUBLICATION", "Forced-visible leaves must be iterable.");
    const next = new Uint8Array(packet.leafCount);
    const nextIndices: number[] = [];
    for (const index of indices) {
      invariant(Number.isSafeInteger(index) && index >= 0 && index < packet.leafCount, "INVALID_INTERACTION_PUBLICATION", `Forced-visible leaf ${index} is out of range.`);
      if (next[index] === 0) nextIndices.push(index);
      next[index] = 1;
    }
    nextIndices.sort((left, right) => left - right);
    const changed = new Set([...currentForced, ...nextIndices]);
    for (const index of changed) {
      forced[index] = next[index];
      writeVisibility(index);
    }
    currentForced = Uint16Array.from(nextIndices);
  };

  const applyViewportProfile = (width: number, height: number, presentationProfileId: string | null): string | null => {
    invariant(Number.isFinite(width) && width >= 0 && width <= 1_000_000 && Number.isFinite(height) && height >= 0 && height <= 1_000_000 && (presentationProfileId === null || typeof presentationProfileId === "string"), "INVALID_VIEWPORT_PROFILE_PUBLICATION", "Viewport profile input is invalid.");
    const viewportProfiles = materialized.viewportProfiles;
    if (!viewportProfiles) return null;
    let selected = -1;
    if (viewportProfiles.selectionMode === "presentation-profile") {
      selected = viewportProfiles.profiles.findIndex((profile) => profile.id === presentationProfileId);
      invariant(selected >= 0, "INVALID_VIEWPORT_PROFILE_PUBLICATION", `Presentation profile ${presentationProfileId ?? "<none>"} has no prepared target profile.`);
    } else {
      selected = viewportProfiles.profiles.findIndex((profile) => profile.width! >= width && profile.height! >= height);
    }
    const selectedProfile = selected < 0 ? null : viewportProfiles.profiles[selected];
    if (selected === selectedViewportProfile && (!selectedProfile?.responsiveAffine || width === selectedViewportWidth && height === selectedViewportHeight)) return selectedProfile?.id ?? null;
    const profile = selectedProfile;
    const nextProfileVisible = profile ? profileVisibilityAt(profile, sourceFrame) : new Uint8Array(packet.leafCount).fill(1);
    const nextResponsiveTransforms = responsiveAffineTransforms(profile, width, height);
    for (let index = 0; index < packet.leafCount; index += 1) {
      const wasPaintVisible = isPaintVisible(index);
      const nextVisible = nextProfileVisible[index];
      const nextTransform = profile?.transformIndices[index] ?? 0xffff;
      profileVisible[index] = nextVisible;
      const paintVisible = isPaintVisible(index);
      if (wasPaintVisible && !paintVisible) writeVisibility(index);
      if (profileTransformOverrides[index] !== nextTransform || profileResponsiveTransforms[index] !== nextResponsiveTransforms[index]) {
        profileTransformOverrides[index] = nextTransform;
        profileResponsiveTransforms[index] = nextResponsiveTransforms[index];
        if (paintVisible && interactionTransforms[index] === 0) writePreparedLeafTransform(index);
        else dirtyHiddenTransforms[index] = 1;
      }
      if (!wasPaintVisible && paintVisible) writeVisibility(index);
    }
    selectedViewportProfile = selected;
    selectedViewportWidth = width;
    selectedViewportHeight = height;
    profileVisibilityFrame = sourceFrame;
    return profile?.id ?? null;
  };

  const restoreInteraction = (shapeIndices: readonly number[], leafIndices: readonly number[]): void => {
    for (const index of shapeIndices) {
      invariant(Number.isSafeInteger(index) && index >= 0 && index < packet.shapeCount, "INVALID_INTERACTION_PUBLICATION", `Interaction shape ${index} is out of range.`);
      shapes[index].style.transform = shapeTransforms[index];
      shapes[index].style.visibility = shapeVisibility[index] === 1 ? "visible" : "hidden";
    }
    for (const index of leafIndices) {
      invariant(Number.isSafeInteger(index) && index >= 0 && index < packet.leafCount, "INVALID_INTERACTION_PUBLICATION", `Interaction leaf ${index} is out of range.`);
      degenerate[index] = 0;
      writePreparedLeafTransform(index);
      writeVisibility(index);
    }
  };

  return Object.freeze({
    get tick() { return tick; },
    get sourceFrame() { return sourceFrame; },
    get bankId() { return activeBank?.id ?? null; },
    tickSpan,
    ticksWithin,
    frameAfter,
    publishInitial() {
      if (initialPublished) return sourceFrame;
      options.compositorTiming?.before("initial", tick);
      writeModel();
      for (let index = 0; index < shapes.length; index += 1) {
        shapes[index].style.transform = shapeTransforms[index];
        shapes[index].style.visibility = shapeVisibility[index] === 1 ? "visible" : "hidden";
      }
      for (let index = 0; index < leaves.length; index += 1) writePreparedLeafTransform(index);
      applyVariants(sourceFrame);
      publishSurfaceState(sourceFrame);
      applyAppearance();
      initialPublished = true;
      options.compositorTiming?.after("initial", tick);
      return sourceFrame;
    },
    advance() {
      return advanceOne(true);
    },
    advanceMany,
    advanceCollapsed,
    seek,
    bankEntryFrame(id: string) {
      invariant(typeof id === "string" && id.length > 0, "UNKNOWN_PREPARED_BANK", "Prepared bank id is invalid.");
      const bank = banks.get(id);
      invariant(bank, "UNKNOWN_PREPARED_BANK", `Prepared bank ${id} is not declared by this document.`);
      return bank.entryFrame;
    },
    selectBank(id: string) {
      invariant(typeof id === "string" && id.length > 0, "UNKNOWN_PREPARED_BANK", "Prepared bank id is invalid.");
      const bank = banks.get(id);
      invariant(bank, "UNKNOWN_PREPARED_BANK", `Prepared bank ${id} is not declared by this document.`);
      options.assertPagedFrameReady?.(bank.entryFrame);
      const previousBank = activeBank;
      const previousTimeline = activeTimeline;
      const previousTick = tick;
      activeBank = bank;
      activeTimeline = timelineFor(bank, selectedTimelineProfileId);
      try {
        tick = 0;
        return seekTo(bank.entryFrame, true, "restart", 0);
      } catch (error) {
        activeBank = previousBank;
        activeTimeline = previousTimeline;
        tick = previousTick;
        throw error;
      }
    },
    restart(shapeIndices = [], leafIndices = []) {
      options.compositorTiming?.before("restart", 0);
      seekTo(activeBank?.entryFrame ?? packet.initial.sourceFrame, true, null, 0);
      restoreInteraction(shapeIndices, leafIndices);
      forceVisible(new Uint16Array(0));
      tick = 0;
      options.compositorTiming?.after("restart", tick);
      return sourceFrame;
    },
    selectProfileTimeline(presentationProfileId: string | null) {
      invariant(presentationProfileId === null || typeof presentationProfileId === "string", "INVALID_PLAYBACK_PUBLICATION", "Presentation profile id is invalid.");
      selectedTimelineProfileId = presentationProfileId;
      const next = timelineFor(activeBank, presentationProfileId);
      if (next === activeTimeline) return false;
      activeTimeline = next;
      return true;
    },
    applySurfaceFrame(nextFrame: number) {
      invariant(Number.isSafeInteger(nextFrame) && nextFrame >= 1 && nextFrame <= playbackParameters.frameCount, "FRAME_RANGE", `Prepared surface frame ${nextFrame} is out of range.`);
      options.assertPagedFrameReady?.(nextFrame);
      const staged = options.pagedState ? options.pagedState.stage(nextFrame, false) : null;
      if (staged) options.pagedState!.commit(staged);
      else applyVariants(nextFrame);
      const profileVisibilityChangeCount = stageProfileVisibility(nextFrame);
      applySurface(nextFrame);
      for (let cursor = 0; cursor < profileVisibilityChangeCount; cursor += 1) writeVisibility(profileVisibilityDirty[cursor], nextFrame);
      return nextFrame;
    },
    applyViewportProfile,
    forceVisible,
    applyInteractionLeaf(index: number, transform: string | null) {
      invariant(Number.isSafeInteger(index) && index >= 0 && index < packet.leafCount, "INVALID_INTERACTION_PUBLICATION", `Interaction leaf ${index} is out of range.`);
      invariant(transform === null || typeof transform === "string", "INVALID_INTERACTION_PUBLICATION", `Interaction leaf ${index} transform is invalid.`);
      degenerate[index] = transform === null ? 1 : 0;
      if (transform !== null) {
        if (leaves[index].style.transform !== transform) leaves[index].style.transform = transform;
        interactionTransforms[index] = leaves[index].style.transform === preparedLeafTransform(index) ? 0 : 1;
      }
      writeVisibility(index);
    },
    restoreInteraction,
  });
}
