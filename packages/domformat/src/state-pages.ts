import { canonicalBase64DecodedLength } from "./base64.js";
import { decodeJson, decodeJsonSteps, encodeCanonicalJson, encodeCanonicalJsonSteps } from "./canonical-json.js";
import { jsonStructureLimits } from "./constants.js";
import { invariant } from "./errors.js";
import { cssNumber } from "./state/numeric.js";
import type { DomLimits } from "./constants.js";
import type { DomDocument, DomPagedPlaybackPageDescriptor, DomPagedVariantPageDescriptor } from "./public-types.js";

export type PagedVariantPageDescriptor = DomPagedVariantPageDescriptor;
export type PagedPlaybackPageDescriptor = DomPagedPlaybackPageDescriptor;

export interface DecodedPagedVariantPage {
  readonly codec: "polycss-paged-variants-page@0";
  readonly channel: string;
  readonly startFrame: number;
  readonly endFrame: number;
  readonly materializedByteLength: number;
  readonly keyframe: Uint16Array;
  readonly offsets: Uint32Array;
  readonly targets: Uint16Array;
  readonly classes: Uint16Array;
}

export interface DecodedPagedPlaybackPage {
  readonly codec: "polycss-paged-playback-page@0";
  readonly channel: string;
  readonly startFrame: number;
  readonly endFrame: number;
  readonly materializedByteLength: number;
  readonly transforms: readonly string[];
  readonly keyframe: Readonly<{
    appearance: number;
    modelTransform: number;
    shapeTransforms: Uint32Array;
    shapeVisibility: Uint8Array;
    leafTransforms: Uint32Array;
  }>;
  readonly appearances: Uint16Array;
  readonly modelTransforms: Uint32Array;
  readonly shapeOffsets: Uint32Array;
  readonly shapeTargets: Uint32Array;
  readonly shapeTransforms: Uint32Array;
  readonly shapeVisibility: Uint8Array;
  readonly leafOffsets: Uint32Array;
  readonly leafTargets: Uint32Array;
  readonly leafTransforms: Uint32Array;
}

export type DecodedStatePage = DecodedPagedVariantPage | DecodedPagedPlaybackPage;

function variantRow(page: DecodedPagedVariantPage, frame: number): Uint16Array {
  const row = page.keyframe.slice();
  for (let local = 1; local <= frame - page.startFrame; local += 1) {
    for (let cursor = page.offsets[local]; cursor < page.offsets[local + 1]; cursor += 1) row[page.targets[cursor]] = page.classes[cursor];
  }
  return row;
}

export function statePageValidationWorkspaceBytes(decodedByteLength: number, materializedByteLength: number): number {
  // At the validation peak the fixed JSON path can retain the loader bytes and canonical bytes (2D),
  // decoded, parsed-string, normalized-string, and canonical UTF-16 text (8D), plus parsed reference
  // slots and the final typed/string representation (2M). Integer columns never become boxed arrays.
  const value = decodedByteLength * 10 + materializedByteLength * 2;
  invariant(Number.isSafeInteger(value), "STATE_PAGE_RESIDENCY_LIMIT", "State-page validation workspace accounting overflowed.");
  return value;
}

export function pagedPlaybackLiveRowCeiling(materializedByteLength: number, shapeCount: number, leafCount: number): number {
  const value = materializedByteLength + 16 + (shapeCount + leafCount) * 8 + shapeCount;
  invariant(Number.isSafeInteger(value), "STATE_PAGE_RESIDENCY_LIMIT", "Paged playback live-row accounting overflowed.");
  return value;
}

export function pagedPlaybackPublicationWorkspaceBytes(materializedByteLength: number, shapeCount: number, leafCount: number): number {
  const value = pagedPlaybackLiveRowCeiling(materializedByteLength, shapeCount, leafCount)
    + (shapeCount + leafCount) * 12 + shapeCount;
  invariant(Number.isSafeInteger(value), "STATE_PAGE_RESIDENCY_LIMIT", "Paged playback publication workspace accounting overflowed.");
  return value;
}

export function pagedVariantRetainedRowsBytes(targetCount: number): number {
  const value = targetCount * 4;
  invariant(Number.isSafeInteger(value), "STATE_PAGE_RESIDENCY_LIMIT", "Paged variant retained-row accounting overflowed.");
  return value;
}

export function pagedVariantPublicationWorkspaceBytes(targetCount: number): number {
  const value = targetCount * 4;
  invariant(Number.isSafeInteger(value), "STATE_PAGE_RESIDENCY_LIMIT", "Paged variant publication workspace accounting overflowed.");
  return value;
}

function plain(value: unknown, label: string): Record<string, unknown> {
  invariant(value && typeof value === "object" && !Array.isArray(value), "INVALID_STATE_PAGE", `${label} must be an object.`);
  const prototype = Object.getPrototypeOf(value);
  invariant(prototype === Object.prototype || prototype === null, "INVALID_STATE_PAGE", `${label} must be a plain object.`);
  return value as Record<string, unknown>;
}

function keys(value: Record<string, unknown>, expected: readonly string[], label: string): void {
  invariant(Object.keys(value).length === expected.length && expected.every((key) => Object.hasOwn(value, key)), "INVALID_STATE_PAGE", `${label} fields are incomplete or noncanonical.`);
  for (const key of Object.keys(value)) invariant(expected.includes(key), "INVALID_STATE_PAGE", `${label} contains unsupported field ${key}.`);
}

function base64Value(code: number): number {
  if (code >= 0x41 && code <= 0x5a) return code - 0x41;
  if (code >= 0x61 && code <= 0x7a) return code - 0x61 + 26;
  if (code >= 0x30 && code <= 0x39) return code - 0x30 + 52;
  return code === 0x2b ? 62 : code === 0x2f ? 63 : 0;
}

function decodedBase64Byte(value: string, byteIndex: number): number {
  const group = Math.floor(byteIndex / 3) * 4;
  const first = base64Value(value.charCodeAt(group));
  const second = base64Value(value.charCodeAt(group + 1));
  const third = base64Value(value.charCodeAt(group + 2));
  const fourth = base64Value(value.charCodeAt(group + 3));
  if (byteIndex % 3 === 0) return (first << 2) | (second >> 4);
  if (byteIndex % 3 === 1) return ((second & 15) << 4) | (third >> 2);
  return ((third & 3) << 6) | fourth;
}

function integers(value: unknown, width: 1, maximum: number, label: string): Uint8Array;
function integers(value: unknown, width: 2, maximum: number, label: string): Uint16Array;
function integers(value: unknown, width: 4, maximum: number, label: string): Uint32Array;
function integers(value: unknown, width: 1 | 2 | 4, maximum: number, label: string): Uint8Array | Uint16Array | Uint32Array {
  const decodedLength = canonicalBase64DecodedLength(value, label, "INVALID_STATE_PAGE");
  invariant(typeof value === "string" && decodedLength % width === 0 && decodedLength / width <= maximum, "INVALID_STATE_PAGE", `${label} is truncated or excessive.`);
  const count = decodedLength / width;
  const output = width === 1 ? new Uint8Array(count) : width === 2 ? new Uint16Array(count) : new Uint32Array(count);
  for (let index = 0; index < count; index += 1) {
    let result = 0;
    for (let byte = 0; byte < width; byte += 1) result += decodedBase64Byte(value, index * width + byte) * 2 ** (byte * 8);
    output[index] = result;
  }
  return output;
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function canonicalPage(decodedBytes: Uint8Array, resource: string, limits: DomLimits): Record<string, unknown> {
  const parsed = decodeJson(decodedBytes, `State page ${resource}`, jsonStructureLimits(limits));
  invariant(sameBytes(decodedBytes, encodeCanonicalJson(parsed, jsonStructureLimits(limits))), "NONCANONICAL_STATE_PAGE", `State page ${resource} is not canonical JSON.`);
  return plain(parsed, `State page ${resource}`);
}

function matrix(value: string, label: string): string {
  invariant(value.startsWith("matrix3d(") && value.endsWith(")"), "INVALID_STATE_PAGE", `${label} is not a matrix3d transform.`);
  const tokens = value.slice(9, -1).split(",");
  invariant(tokens.length === 16, "INVALID_STATE_PAGE", `${label} must contain sixteen matrix3d components.`);
  const components = tokens.map((token) => {
    invariant(token.length > 0 && token === String(Number(token)), "INVALID_STATE_PAGE", `${label} contains a noncanonical CSS number.`);
    const component = Math.fround(Number(token));
    invariant(Number.isFinite(component) && cssNumber(component) === token, "INVALID_STATE_PAGE", `${label} contains a noncanonical binary32 component.`);
    return component;
  });
  invariant(components[3] === 0 && components[7] === 0 && components[11] === 0 && components[15] === 1, "INVALID_STATE_PAGE", `${label} is not an affine prepared matrix.`);
  invariant(value !== "matrix3d(1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1)", "INVALID_STATE_PAGE", `${label} must encode identity as null.`);
  return value;
}

function bitset(value: unknown, count: number, label: string): Uint8Array {
  const packed = integers(value, 1, Math.ceil(count / 8), label);
  invariant(packed.length === Math.ceil(count / 8), "STATE_COLUMN_MISMATCH", `${label} is truncated.`);
  if (count % 8 !== 0 && packed.length > 0) invariant((packed.at(-1)! >> (count % 8)) === 0, "INVALID_STATE_PAGE", `${label} has nonzero unused bits.`);
  const output = new Uint8Array(count);
  for (let index = 0; index < count; index += 1) output[index] = (packed[index >> 3] >> (index & 7)) & 1;
  return output;
}

export function validatePagedVariantPageBytes(
  decodedBytes: Uint8Array,
  expected: PagedVariantPageDescriptor & Readonly<{ channel: string }>,
  targetCount: number,
  classCount: number,
  limits: DomLimits,
): DecodedPagedVariantPage {
  const page = canonicalPage(decodedBytes, expected.resource, limits);
  keys(page, ["version", "codec", "channel", "startFrame", "endFrame", "keyframeClassIndicesBase64", "sequential"], `State page ${expected.resource}`);
  invariant(page.version === 0 && page.codec === "polycss-paged-variants-page@0" && page.channel === expected.channel, "INVALID_STATE_PAGE", `State page ${expected.resource} identity is invalid.`);
  invariant(page.startFrame === expected.startFrame && page.endFrame === expected.endFrame, "STATE_PAGE_COVERAGE_MISMATCH", `State page ${expected.resource} coverage disagrees with its descriptor.`);
  const frameCount = expected.endFrame - expected.startFrame + 1;
  invariant(frameCount > 0 && frameCount <= limits.maxStatePageFrames, "STATE_PAGE_COVERAGE_MISMATCH", `State page ${expected.resource} coverage is invalid.`);
  const keyframe = integers(page.keyframeClassIndicesBase64, 2, targetCount, `State page ${expected.resource} keyframe`);
  invariant(keyframe.length === targetCount && keyframe.every((value) => value === 0xffff || value < classCount), "STATE_COLUMN_MISMATCH", `State page ${expected.resource} keyframe is invalid.`);
  const sequential = plain(page.sequential, `State page ${expected.resource} sequential transitions`);
  keys(sequential, ["offsetsBase64", "targetIndicesBase64", "classIndicesBase64"], `State page ${expected.resource} sequential transitions`);
  const offsets = integers(sequential.offsetsBase64, 4, frameCount + 1, `State page ${expected.resource} offsets`);
  const targets = integers(sequential.targetIndicesBase64, 2, limits.maxPreparedChanges, `State page ${expected.resource} targets`);
  const classes = integers(sequential.classIndicesBase64, 2, limits.maxPreparedChanges, `State page ${expected.resource} classes`);
  invariant(offsets.length === frameCount + 1 && offsets[0] === 0 && offsets[1] === 0 && offsets.at(-1) === targets.length && offsets.every((value, index) => index === 0 || value >= offsets[index - 1]), "STATE_COLUMN_MISMATCH", `State page ${expected.resource} offsets are invalid.`);
  invariant(targets.length === classes.length && targets.length === expected.changeCount, "STATE_COLUMN_MISMATCH", `State page ${expected.resource} transition columns or declared count disagree.`);
  const row = keyframe.slice();
  for (let localFrame = 1; localFrame < frameCount; localFrame += 1) {
    let previousTarget = -1;
    for (let cursor = offsets[localFrame]; cursor < offsets[localFrame + 1]; cursor += 1) {
      const target = targets[cursor];
      const classIndex = classes[cursor];
      invariant(target > previousTarget && target < targetCount && (classIndex === 0xffff || classIndex < classCount), "INVALID_STATE_PAGE", `State page ${expected.resource} frame ${expected.startFrame + localFrame} transition is invalid.`);
      invariant(row[target] !== classIndex, "INVALID_STATE_PAGE", `State page ${expected.resource} frame ${expected.startFrame + localFrame} contains a no-op transition.`);
      row[target] = classIndex;
      previousTarget = target;
    }
  }
  const materializedByteLength = targetCount * 2 + (frameCount + 1) * 4 + targets.length * 4;
  invariant(materializedByteLength === expected.materializedByteLength, "STATE_PAGE_MATERIALIZED_SIZE_MISMATCH", `State page ${expected.resource} materialized size disagrees with its descriptor.`);
  return Object.freeze({ codec: "polycss-paged-variants-page@0", channel: expected.channel, startFrame: expected.startFrame, endFrame: expected.endFrame, materializedByteLength, keyframe, offsets, targets, classes });
}

const PLAYBACK_VALIDATION_SLICE_OPERATIONS = 256;
const PLAYBACK_INITIAL_VALIDATION_SLICE_OPERATIONS = 64;

function* playbackPageValidationSteps(
  decodedBytes: Uint8Array,
  expected: PagedPlaybackPageDescriptor & Readonly<{ channel: string }>,
  shapeCount: number,
  leafCount: number,
  appearanceCount: number,
  limits: DomLimits,
): Generator<void, DecodedPagedPlaybackPage> {
  let sliceOperations = 0;
  let sliceLimit = PLAYBACK_INITIAL_VALIDATION_SLICE_OPERATIONS;
  const sliceBoundary = (): boolean => {
    sliceOperations += 1;
    if (sliceOperations < sliceLimit) return false;
    sliceOperations = 0;
    sliceLimit = PLAYBACK_VALIDATION_SLICE_OPERATIONS;
    return true;
  };
  const parsed = yield* decodeJsonSteps(decodedBytes, `State page ${expected.resource}`, jsonStructureLimits(limits));
  const canonical = yield* encodeCanonicalJsonSteps(parsed, jsonStructureLimits(limits));
  yield;
  invariant(sameBytes(decodedBytes, canonical), "NONCANONICAL_STATE_PAGE", `State page ${expected.resource} is not canonical JSON.`);
  const page = plain(parsed, `State page ${expected.resource}`);
  keys(page, ["version", "codec", "channel", "startFrame", "endFrame", "transforms", "keyframe", "sequential"], `State page ${expected.resource}`);
  invariant(page.version === 0 && page.codec === "polycss-paged-playback-page@0" && page.channel === expected.channel, "INVALID_STATE_PAGE", `State page ${expected.resource} identity is invalid.`);
  invariant(page.startFrame === expected.startFrame && page.endFrame === expected.endFrame, "STATE_PAGE_COVERAGE_MISMATCH", `State page ${expected.resource} coverage disagrees with its descriptor.`);
  const frameCount = expected.endFrame - expected.startFrame + 1;
  invariant(frameCount > 0 && frameCount <= limits.maxStatePageFrames, "STATE_PAGE_COVERAGE_MISMATCH", `State page ${expected.resource} coverage is invalid.`);
  invariant(Array.isArray(page.transforms) && page.transforms.length === expected.transformCount && page.transforms.length > 0 && page.transforms.length <= limits.maxPreparedTransforms, "TRANSFORM_ALLOCATION_LIMIT", `State page ${expected.resource} transform dictionary is invalid.`);
  const transforms: string[] = [];
  for (let index = 0; index < page.transforms.length; index += 1) {
    const value = page.transforms[index];
    invariant(value === null || typeof value === "string", "INVALID_STATE_PAGE", `State page ${expected.resource} transform ${index} is invalid.`);
    transforms.push(value === null ? "" : matrix(value, `State page ${expected.resource} transform ${index}`));
    if (sliceBoundary()) yield;
  }
  const keyframe = plain(page.keyframe, `State page ${expected.resource} keyframe`);
  keys(keyframe, ["appearance", "modelTransform", "shapeTransformIndicesBase64", "shapeVisibilityBitsBase64", "leafTransformIndicesBase64"], `State page ${expected.resource} keyframe`);
  invariant(Number.isSafeInteger(keyframe.appearance) && (keyframe.appearance as number) >= 0 && (keyframe.appearance as number) < appearanceCount, "INVALID_STATE_PAGE", `State page ${expected.resource} keyframe appearance is invalid.`);
  invariant(Number.isSafeInteger(keyframe.modelTransform) && (keyframe.modelTransform as number) >= 0 && (keyframe.modelTransform as number) < transforms.length, "INVALID_STATE_PAGE", `State page ${expected.resource} keyframe model transform is invalid.`);
  const keyframeShapeTransforms = integers(keyframe.shapeTransformIndicesBase64, 4, shapeCount, `State page ${expected.resource} keyframe shape transforms`);
  const keyframeShapeVisibility = bitset(keyframe.shapeVisibilityBitsBase64, shapeCount, `State page ${expected.resource} keyframe shape visibility`);
  const keyframeLeafTransforms = integers(keyframe.leafTransformIndicesBase64, 4, leafCount, `State page ${expected.resource} keyframe leaf transforms`);
  invariant(keyframeShapeTransforms.length === shapeCount && keyframeShapeTransforms.every((value) => value < transforms.length), "STATE_COLUMN_MISMATCH", `State page ${expected.resource} keyframe shape transforms are invalid.`);
  invariant(keyframeLeafTransforms.length === leafCount && keyframeLeafTransforms.every((value) => value < transforms.length), "STATE_COLUMN_MISMATCH", `State page ${expected.resource} keyframe leaf transforms are invalid.`);
  const sequential = plain(page.sequential, `State page ${expected.resource} sequential transitions`);
  keys(sequential, ["appearanceIndicesBase64", "modelTransformIndicesBase64", "shapeOffsetsBase64", "shapeTargetIndicesBase64", "shapeTransformIndicesBase64", "shapeVisibilityBase64", "leafOffsetsBase64", "leafTargetIndicesBase64", "leafTransformIndicesBase64"], `State page ${expected.resource} sequential transitions`);
  const appearances = integers(sequential.appearanceIndicesBase64, 2, frameCount, `State page ${expected.resource} appearances`);
  const modelTransforms = integers(sequential.modelTransformIndicesBase64, 4, frameCount, `State page ${expected.resource} model transforms`);
  const shapeOffsets = integers(sequential.shapeOffsetsBase64, 4, frameCount + 1, `State page ${expected.resource} shape offsets`);
  const shapeTargets = integers(sequential.shapeTargetIndicesBase64, 4, limits.maxPreparedChanges, `State page ${expected.resource} shape targets`);
  const shapeTransforms = integers(sequential.shapeTransformIndicesBase64, 4, limits.maxPreparedChanges, `State page ${expected.resource} shape transforms`);
  const shapeVisibility = integers(sequential.shapeVisibilityBase64, 1, limits.maxPreparedChanges, `State page ${expected.resource} shape visibility`);
  const leafOffsets = integers(sequential.leafOffsetsBase64, 4, frameCount + 1, `State page ${expected.resource} leaf offsets`);
  const leafTargets = integers(sequential.leafTargetIndicesBase64, 4, limits.maxPreparedChanges, `State page ${expected.resource} leaf targets`);
  const leafTransforms = integers(sequential.leafTransformIndicesBase64, 4, limits.maxPreparedChanges, `State page ${expected.resource} leaf transforms`);
  invariant(appearances.length === frameCount && appearances.every((value) => value < appearanceCount) && appearances[0] === keyframe.appearance, "STATE_COLUMN_MISMATCH", `State page ${expected.resource} appearances are invalid.`);
  invariant(modelTransforms.length === frameCount && modelTransforms.every((value) => value === 0xffffffff || value < transforms.length), "STATE_COLUMN_MISMATCH", `State page ${expected.resource} model transforms are invalid.`);
  invariant(shapeOffsets.length === frameCount + 1 && shapeOffsets[0] === 0 && shapeOffsets.at(-1) === shapeTargets.length && shapeOffsets.every((value, index) => index === 0 || value >= shapeOffsets[index - 1]), "STATE_COLUMN_MISMATCH", `State page ${expected.resource} shape offsets are invalid.`);
  invariant(leafOffsets.length === frameCount + 1 && leafOffsets[0] === 0 && leafOffsets.at(-1) === leafTargets.length && leafOffsets.every((value, index) => index === 0 || value >= leafOffsets[index - 1]), "STATE_COLUMN_MISMATCH", `State page ${expected.resource} leaf offsets are invalid.`);
  invariant(shapeTargets.length === shapeTransforms.length && shapeTargets.length === shapeVisibility.length && shapeTargets.length === expected.shapeChangeCount, "STATE_COLUMN_MISMATCH", `State page ${expected.resource} shape columns or declared count disagree.`);
  invariant(leafTargets.length === leafTransforms.length && leafTargets.length === expected.leafChangeCount, "STATE_COLUMN_MISMATCH", `State page ${expected.resource} leaf columns or declared count disagree.`);
  const owners = new Map<number, string>();
  const values = new Map<string, number>();
  let nextFirstUse = 0;
  const claim = (index: number, owner: string, label: string): void => {
    invariant(index >= 0 && index < transforms.length, "INVALID_STATE_PAGE", `${label} references a missing transform.`);
    const existingOwner = owners.get(index);
    if (existingOwner === undefined) {
      invariant(index === nextFirstUse, "TRANSFORM_GROUP_MISMATCH", `${label} violates canonical transform first-use order.`);
      owners.set(index, owner);
      nextFirstUse += 1;
    } else invariant(existingOwner === owner, "TRANSFORM_GROUP_MISMATCH", `${label} aliases a transform across incompatible owners.`);
    const valueKey = `${owner}\0${transforms[index]}`;
    const existingIndex = values.get(valueKey);
    invariant(existingIndex === undefined || existingIndex === index, "TRANSFORM_GROUP_MISMATCH", `${label} duplicates a transform within one owner domain.`);
    values.set(valueKey, index);
  };
  claim(keyframe.modelTransform as number, "model", `State page ${expected.resource} keyframe model`);
  if (sliceBoundary()) yield;
  for (let index = 0; index < keyframeShapeTransforms.length; index += 1) {
    claim(keyframeShapeTransforms[index], "shape", `State page ${expected.resource} keyframe shape ${index}`);
    if (sliceBoundary()) yield;
  }
  for (let index = 0; index < keyframeLeafTransforms.length; index += 1) {
    claim(keyframeLeafTransforms[index], `leaf:${index}`, `State page ${expected.resource} keyframe leaf ${index}`);
    if (sliceBoundary()) yield;
  }
  let currentModel = keyframe.modelTransform as number;
  const currentShapes = keyframeShapeTransforms.slice();
  const currentVisibility = keyframeShapeVisibility.slice();
  const currentLeaves = keyframeLeafTransforms.slice();
  for (let localFrame = 0; localFrame < frameCount; localFrame += 1) {
    const model = modelTransforms[localFrame];
    if (model !== 0xffffffff) {
      claim(model, "model", `State page ${expected.resource} frame ${expected.startFrame + localFrame} model`);
      if (localFrame > 0) {
        invariant(model !== currentModel, "INVALID_STATE_PAGE", `State page ${expected.resource} frame ${expected.startFrame + localFrame} contains a no-op model transform.`);
        currentModel = model;
      }
      if (sliceBoundary()) yield;
    }
    let previousShape = -1;
    for (let cursor = shapeOffsets[localFrame]; cursor < shapeOffsets[localFrame + 1]; cursor += 1) {
      const target = shapeTargets[cursor];
      const transform = shapeTransforms[cursor];
      const visibility = shapeVisibility[cursor];
      invariant(target > previousShape && target < shapeCount && visibility <= 1, "INVALID_STATE_PAGE", `State page ${expected.resource} frame ${expected.startFrame + localFrame} shape transition is invalid.`);
      claim(transform, "shape", `State page ${expected.resource} frame ${expected.startFrame + localFrame} shape ${target}`);
      if (localFrame > 0) {
        invariant(currentShapes[target] !== transform || currentVisibility[target] !== visibility, "INVALID_STATE_PAGE", `State page ${expected.resource} frame ${expected.startFrame + localFrame} contains a no-op shape transition.`);
        currentShapes[target] = transform;
        currentVisibility[target] = visibility;
      }
      previousShape = target;
      if (sliceBoundary()) yield;
    }
    let previousLeaf = -1;
    for (let cursor = leafOffsets[localFrame]; cursor < leafOffsets[localFrame + 1]; cursor += 1) {
      const target = leafTargets[cursor];
      const transform = leafTransforms[cursor];
      invariant(target > previousLeaf && target < leafCount, "INVALID_STATE_PAGE", `State page ${expected.resource} frame ${expected.startFrame + localFrame} leaf transition is invalid.`);
      claim(transform, `leaf:${target}`, `State page ${expected.resource} frame ${expected.startFrame + localFrame} leaf ${target}`);
      if (localFrame > 0) {
        invariant(currentLeaves[target] !== transform, "INVALID_STATE_PAGE", `State page ${expected.resource} frame ${expected.startFrame + localFrame} contains a no-op leaf transition.`);
        currentLeaves[target] = transform;
      }
      previousLeaf = target;
      if (sliceBoundary()) yield;
    }
  }
  invariant(owners.size === transforms.length, "TRANSFORM_GROUP_MISMATCH", `State page ${expected.resource} transform dictionary contains an unreferenced row.`);
  let transformBytes = 0;
  for (const transform of transforms) {
    transformBytes += 8 + transform.length * 2;
    if (sliceBoundary()) yield;
  }
  const materializedByteLength = transformBytes
    + keyframeShapeTransforms.length * 4 + keyframeShapeVisibility.length + keyframeLeafTransforms.length * 4
    + appearances.length * 2 + modelTransforms.length * 4
    + shapeOffsets.length * 4 + shapeTargets.length * 4 + shapeTransforms.length * 4 + shapeVisibility.length
    + leafOffsets.length * 4 + leafTargets.length * 4 + leafTransforms.length * 4;
  invariant(materializedByteLength === expected.materializedByteLength, "STATE_PAGE_MATERIALIZED_SIZE_MISMATCH", `State page ${expected.resource} materialized size disagrees with its descriptor.`);
  return Object.freeze({
    codec: "polycss-paged-playback-page@0", channel: expected.channel, startFrame: expected.startFrame, endFrame: expected.endFrame, materializedByteLength,
    transforms: Object.freeze(transforms),
    keyframe: Object.freeze({ appearance: keyframe.appearance as number, modelTransform: keyframe.modelTransform as number, shapeTransforms: keyframeShapeTransforms, shapeVisibility: keyframeShapeVisibility, leafTransforms: keyframeLeafTransforms }),
    appearances, modelTransforms,
    shapeOffsets, shapeTargets, shapeTransforms, shapeVisibility,
    leafOffsets, leafTargets, leafTransforms,
  });
}

function completePlaybackPageValidation(validation: Generator<void, DecodedPagedPlaybackPage>): DecodedPagedPlaybackPage {
  let result = validation.next();
  while (!result.done) result = validation.next();
  return result.value;
}

export function validatePagedPlaybackPageBytes(
  decodedBytes: Uint8Array,
  expected: PagedPlaybackPageDescriptor & Readonly<{ channel: string }>,
  shapeCount: number,
  leafCount: number,
  appearanceCount: number,
  limits: DomLimits,
): DecodedPagedPlaybackPage {
  return completePlaybackPageValidation(playbackPageValidationSteps(decodedBytes, expected, shapeCount, leafCount, appearanceCount, limits));
}

async function yieldPlaybackPageValidation(signal?: AbortSignal): Promise<void> {
  invariant(!signal?.aborted, "OPERATION_ABORTED", "State-page validation was aborted.");
  const scheduler = globalThis as typeof globalThis & Readonly<{
    requestIdleCallback?: (callback: () => void, options?: Readonly<{ timeout: number }>) => number;
    cancelIdleCallback?: (handle: number) => void;
  }>;
  await new Promise<void>((resolve) => {
    let resolved = false;
    let cancelPending: (() => void) | undefined;
    const done = (): void => {
      if (resolved) return;
      resolved = true;
      cancelPending = undefined;
      signal?.removeEventListener("abort", abort);
      resolve();
    };
    const abort = (): void => {
      cancelPending?.();
      done();
    };
    signal?.addEventListener("abort", abort, { once: true });
    if (scheduler.requestIdleCallback) {
      const handle = scheduler.requestIdleCallback(done, { timeout: 16 });
      cancelPending = () => scheduler.cancelIdleCallback?.(handle);
    } else {
      const handle = setTimeout(done, 0);
      cancelPending = () => clearTimeout(handle);
    }
  });
  invariant(!signal?.aborted, "OPERATION_ABORTED", "State-page validation was aborted.");
}

export async function validatePagedPlaybackPageBytesAsync(
  decodedBytes: Uint8Array,
  expected: PagedPlaybackPageDescriptor & Readonly<{ channel: string }>,
  shapeCount: number,
  leafCount: number,
  appearanceCount: number,
  limits: DomLimits,
  signal?: AbortSignal,
): Promise<DecodedPagedPlaybackPage> {
  const validation = playbackPageValidationSteps(decodedBytes, expected, shapeCount, leafCount, appearanceCount, limits);
  await yieldPlaybackPageValidation(signal);
  let result = validation.next();
  while (!result.done) {
    await yieldPlaybackPageValidation(signal);
    result = validation.next();
  }
  invariant(!signal?.aborted, "OPERATION_ABORTED", "State-page validation was aborted.");
  return result.value;
}

export interface CanonicalPlaybackRow {
  readonly appearance: number;
  readonly modelTransform: string;
  readonly shapeTransforms: readonly string[];
  readonly shapeVisibility: ArrayLike<number>;
  readonly leafTransforms: readonly string[];
}

function playbackRow(page: DecodedPagedPlaybackPage, localFrame: number): CanonicalPlaybackRow {
  let appearance = page.keyframe.appearance;
  let modelTransform = page.transforms[page.keyframe.modelTransform];
  const shapeTransforms = Array.from(page.keyframe.shapeTransforms, (index) => page.transforms[index]);
  const shapeVisibility = [...page.keyframe.shapeVisibility];
  const leafTransforms = Array.from(page.keyframe.leafTransforms, (index) => page.transforms[index]);
  for (let frame = 1; frame <= localFrame; frame += 1) {
    appearance = page.appearances[frame];
    if (page.modelTransforms[frame] !== 0xffffffff) modelTransform = page.transforms[page.modelTransforms[frame]];
    for (let cursor = page.shapeOffsets[frame]; cursor < page.shapeOffsets[frame + 1]; cursor += 1) {
      const target = page.shapeTargets[cursor];
      shapeTransforms[target] = page.transforms[page.shapeTransforms[cursor]];
      shapeVisibility[target] = page.shapeVisibility[cursor];
    }
    for (let cursor = page.leafOffsets[frame]; cursor < page.leafOffsets[frame + 1]; cursor += 1) {
      const target = page.leafTargets[cursor];
      leafTransforms[target] = page.transforms[page.leafTransforms[cursor]];
    }
  }
  return { appearance, modelTransform, shapeTransforms, shapeVisibility, leafTransforms };
}

export function validatePagedPlaybackBoundaryFromCanonical(from: CanonicalPlaybackRow, target: DecodedPagedPlaybackPage): void {
  const to = playbackRow(target, 0);
  invariant(target.appearances[0] === to.appearance, "STATE_PAGE_BOUNDARY_MISMATCH", `State page ${target.channel}/${target.startFrame} boundary appearance disagrees with its keyframe.`);
  const expectedModel = from.modelTransform === to.modelTransform ? 0xffffffff : target.keyframe.modelTransform;
  invariant(target.modelTransforms[0] === expectedModel, "STATE_PAGE_BOUNDARY_MISMATCH", `State page ${target.channel}/${target.startFrame} boundary model delta is incomplete or excessive.`);
  const expectedShapes: number[] = [];
  for (let index = 0; index < to.shapeTransforms.length; index += 1) {
    if (from.shapeTransforms[index] !== to.shapeTransforms[index] || from.shapeVisibility[index] !== to.shapeVisibility[index]) expectedShapes.push(index);
  }
  const actualShapes = [...target.shapeTargets.subarray(target.shapeOffsets[0], target.shapeOffsets[1])];
  invariant(actualShapes.length === expectedShapes.length && actualShapes.every((value, index) => value === expectedShapes[index]), "STATE_PAGE_BOUNDARY_MISMATCH", `State page ${target.channel}/${target.startFrame} boundary shape targets are incomplete or excessive.`);
  for (let cursor = target.shapeOffsets[0]; cursor < target.shapeOffsets[1]; cursor += 1) {
    const shape = target.shapeTargets[cursor];
    invariant(target.transforms[target.shapeTransforms[cursor]] === to.shapeTransforms[shape] && target.shapeVisibility[cursor] === to.shapeVisibility[shape], "STATE_PAGE_BOUNDARY_MISMATCH", `State page ${target.channel}/${target.startFrame} boundary shape ${shape} disagrees with its keyframe.`);
  }
  const expectedLeaves: number[] = [];
  for (let index = 0; index < to.leafTransforms.length; index += 1) if (from.leafTransforms[index] !== to.leafTransforms[index]) expectedLeaves.push(index);
  const actualLeaves = [...target.leafTargets.subarray(target.leafOffsets[0], target.leafOffsets[1])];
  invariant(actualLeaves.length === expectedLeaves.length && actualLeaves.every((value, index) => value === expectedLeaves[index]), "STATE_PAGE_BOUNDARY_MISMATCH", `State page ${target.channel}/${target.startFrame} boundary leaf targets are incomplete or excessive.`);
  for (let cursor = target.leafOffsets[0]; cursor < target.leafOffsets[1]; cursor += 1) {
    const leaf = target.leafTargets[cursor];
    invariant(target.transforms[target.leafTransforms[cursor]] === to.leafTransforms[leaf], "STATE_PAGE_BOUNDARY_MISMATCH", `State page ${target.channel}/${target.startFrame} boundary leaf ${leaf} disagrees with its keyframe.`);
  }
}

export function validatePagedPlaybackBoundary(previous: DecodedPagedPlaybackPage, target: DecodedPagedPlaybackPage): void {
  validatePagedPlaybackBoundaryFromCanonical(playbackRow(previous, previous.endFrame - previous.startFrame), target);
}

export function validateDecodedStatePages(document: DomDocument, decodedByResource: ReadonlyMap<string, Uint8Array>, limits: DomLimits): Map<string, DecodedStatePage> {
  const decoded = new Map<string, DecodedStatePage>();
  const variantState = document.state.channels.find((channel) => channel.codec === "polycss-paged-variants@0");
  if (variantState) {
    const packet = (variantState.data as unknown as { readonly packet: { readonly classes: readonly string[]; readonly initial: { readonly frame: number; readonly classIndicesBase64: string }; readonly pages: readonly PagedVariantPageDescriptor[] } }).packet;
    const binding = document.bindings.channels.find((channel) => channel.interpreter === "polycss-paged-variants@0");
    invariant(binding, "MISSING_POLYCSS_BINDING", "Paged variants require a matching binding.");
    const targetCount = (binding.targets as unknown as { readonly nodes: readonly string[] }).nodes.length;
    for (const page of packet.pages) {
      const bytes = decodedByResource.get(page.resource);
      if (bytes) decoded.set(page.resource, validatePagedVariantPageBytes(bytes, { ...page, channel: variantState.id }, targetCount, packet.classes.length, limits));
    }
    const initialPage = decoded.get(packet.pages.find((page) => packet.initial.frame >= page.startFrame && packet.initial.frame <= page.endFrame)?.resource ?? "");
    if (initialPage?.codec === "polycss-paged-variants-page@0") {
      const expected = integers(packet.initial.classIndicesBase64, 2, targetCount, "Paged variant shell initial row");
      const actual = variantRow(initialPage, packet.initial.frame);
      invariant(actual.length === expected.length && actual.every((value, index) => value === expected[index]), "STATE_PAGE_INITIAL_MISMATCH", "Paged variant initial page disagrees with its shell/TREE row.");
    }
  }
  const playbackState = document.state.channels.find((channel) => channel.codec === "polycss-paged-playback@0");
  if (playbackState) {
    const packet = (playbackState.data as unknown as { readonly packet: { readonly shapeCount: number; readonly leafCount: number; readonly appearances: readonly unknown[]; readonly initial: { readonly sourceFrame: number; readonly appearance: number }; readonly pages: readonly PagedPlaybackPageDescriptor[] } }).packet;
    for (const page of packet.pages) {
      const bytes = decodedByResource.get(page.resource);
      if (bytes) decoded.set(page.resource, validatePagedPlaybackPageBytes(bytes, { ...page, channel: playbackState.id }, packet.shapeCount, packet.leafCount, packet.appearances.length, limits));
    }
    const decodedPages = packet.pages.map((page) => decoded.get(page.resource)).filter((page): page is DecodedPagedPlaybackPage => page?.codec === "polycss-paged-playback-page@0");
    if (decodedPages.length === packet.pages.length) {
      for (let index = 0; index < decodedPages.length; index += 1) validatePagedPlaybackBoundary(decodedPages[(index + decodedPages.length - 1) % decodedPages.length], decodedPages[index]);
    }
    const initialPage = decoded.get(packet.pages.find((page) => packet.initial.sourceFrame >= page.startFrame && packet.initial.sourceFrame <= page.endFrame)?.resource ?? "");
    if (initialPage?.codec === "polycss-paged-playback-page@0") {
      const initial = playbackRow(initialPage, packet.initial.sourceFrame - initialPage.startFrame);
      invariant(initial.appearance === packet.initial.appearance, "STATE_PAGE_INITIAL_MISMATCH", "Paged playback initial page disagrees with its shell appearance.");
      const binding = document.bindings.channels.find((channel) => channel.interpreter === "polycss-paged-playback@0");
      invariant(binding, "MISSING_POLYCSS_BINDING", "Paged playback requires a matching binding.");
      const targets = binding.targets as unknown as { readonly model: string; readonly shapes: readonly string[]; readonly leaves: readonly string[] };
      const parameters = binding.parameters as unknown as { readonly baseSceneTransform: string };
      const nodes = new Map(document.tree.nodes.map((node) => [node.id, node]));
      const model = nodes.get(targets.model);
      const expectedModel = initial.modelTransform === "" ? parameters.baseSceneTransform : `${parameters.baseSceneTransform} ${initial.modelTransform}`;
      invariant(model?.styles?.transform === expectedModel, "STATE_PAGE_INITIAL_MISMATCH", "Paged playback initial page disagrees with TREE model transform.");
      for (let index = 0; index < targets.shapes.length; index += 1) {
        const node = nodes.get(targets.shapes[index]);
        invariant(node?.styles?.transform === initial.shapeTransforms[index] && node.styles.visibility === (initial.shapeVisibility[index] === 1 ? "visible" : "hidden"), "STATE_PAGE_INITIAL_MISMATCH", `Paged playback initial page disagrees with TREE shape ${index}.`);
      }
      for (let index = 0; index < targets.leaves.length; index += 1) invariant(nodes.get(targets.leaves[index])?.styles?.transform === initial.leafTransforms[index], "STATE_PAGE_INITIAL_MISMATCH", `Paged playback initial page disagrees with TREE leaf ${index}.`);
    }
  }
  for (const resource of decodedByResource.keys()) invariant(decoded.has(resource), "UNEXPECTED_STATE_PAGE", `Decoded state page ${resource} is not referenced by a fixed paged state channel.`);
  return decoded;
}
