import { FORMAT_ID, PROFILE_ID, jsonStructureLimits, mergeLimits } from "./constants.js";
import { canonicalize, deepFreezeJson, encodeCanonicalJson } from "./canonical-json.js";
import { invariant } from "./errors.js";
import { sha256Hex } from "./hash.js";
import { assertResourceId, assertSafeRelativePath, byteView, imageDimensions, validateCssBytes, validateResourceBytes } from "./resources.js";
import { validateDocumentInternal } from "./schema.js";
import { preparedVariantClassTokens } from "./variant-effects.js";
import { gzipSync } from "node:zlib";
import { validateDecodedStatePages } from "./state-pages.js";
import type { DomBuildResult, DomDocument, DomLimitOverrides, DomResourceInputBytes, DomResourceRecord, DomWriterInput } from "./public-types.js";

function bytesOf(value: DomResourceInputBytes): Uint8Array {
  if (typeof value === "string") return new TextEncoder().encode(value);
  const bytes = byteView(value);
  invariant(bytes, "INVALID_RESOURCE_BYTES", "Resource input bytes must be a string, ArrayBuffer, or ArrayBufferView.");
  return bytes.slice();
}

function plainRecord(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export function buildDom(
  input: DomWriterInput,
  options: { readonly limits?: DomLimitOverrides } = {},
): DomBuildResult {
  const limits = mergeLimits(options.limits);
  const jsonLimits = jsonStructureLimits(limits);
  invariant(plainRecord(input), "INVALID_DOCUMENT_INPUT", "Writer input must be a plain object.");
  for (const key of Object.keys(input)) {
    invariant(["meta", "tree", "cssBinding", "state", "bindings", "resourceInputs"].includes(key), "INVALID_DOCUMENT_INPUT", `Writer input contains unsupported field ${key}.`);
  }
  invariant(Array.isArray(input.resourceInputs) && input.resourceInputs.length <= limits.maxResources + limits.maxStatePages, "INVALID_RESOURCE_INPUTS", "resourceInputs must fit the combined eager and state-page ceilings.");
  const statePageInputs = input.resourceInputs.filter((entry) => entry?.kind === "state-page").length;
  invariant(statePageInputs <= limits.maxStatePages && input.resourceInputs.length - statePageInputs <= limits.maxResources, "INVALID_RESOURCE_INPUTS", "resourceInputs exceed the eager or state-page count limit.");
  const resourceInputs = input.resourceInputs.map((entry, index) => {
    invariant(plainRecord(entry), "INVALID_RESOURCE_INPUT", `Resource input ${index} must be a plain object.`);
    for (const key of Object.keys(entry)) {
      invariant(["id", "kind", "mediaType", "path", "bytes", "encoding", "codec"].includes(key), "INVALID_RESOURCE_INPUT", `Resource input ${index} contains unsupported field ${key}.`);
    }
    const decodedBytes = bytesOf(entry.bytes);
    const bytes = entry.kind === "state-page" && entry.encoding === "gzip"
      ? Uint8Array.from(gzipSync(decodedBytes, { level: 9 }))
      : decodedBytes;
    return { ...entry, id: assertResourceId(entry.id), bytes, decodedBytes };
  }).sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0);

  let aggregateEagerInputBytes = 0;
  let aggregateStatePageInputBytes = 0;
  const seen = new Set<string>();
  const records: DomResourceRecord[] = resourceInputs.map((entry) => {
    invariant(!seen.has(entry.id), "DUPLICATE_RESOURCE_ID", `Resource input ${entry.id} is duplicated.`);
    seen.add(entry.id);
    invariant(entry.kind === "stylesheet" || entry.kind === "image" || entry.kind === "state-page", "INVALID_RESOURCE_KIND", `Resource ${entry.id} kind is invalid.`);
    if (entry.kind === "state-page") invariant(entry.encoding === "identity" || entry.encoding === "gzip", "INVALID_STATE_PAGE_RESOURCE", `Resource ${entry.id} state-page encoding is invalid.`);
    else invariant(entry.encoding === undefined && entry.codec === undefined, "INVALID_RESOURCE_INPUT", `Resource ${entry.id} declares state-page input fields.`);
    const path = assertSafeRelativePath(entry.path, `Resource ${entry.id} path`);
    invariant(entry.bytes.length <= limits.maxResourceBytes, "RESOURCE_SIZE_LIMIT", `Resource input ${entry.id} exceeds its byte limit.`);
    if (entry.kind === "state-page") {
      aggregateStatePageInputBytes += entry.bytes.length;
      invariant(aggregateStatePageInputBytes <= limits.maxAggregateStatePageBytes, "AGGREGATE_RESOURCE_LIMIT", "State-page inputs exceed their aggregate encoded byte limit.");
    } else {
      aggregateEagerInputBytes += entry.bytes.length;
      invariant(aggregateEagerInputBytes <= limits.maxAggregateResourceBytes, "AGGREGATE_RESOURCE_LIMIT", "Eager resource inputs exceed their aggregate byte limit.");
    }
    return {
      id: entry.id,
      kind: entry.kind,
      mediaType: entry.mediaType,
      byteLength: entry.bytes.length,
      digest: { algorithm: "sha256", value: sha256Hex(entry.bytes) },
      path,
      ...(entry.kind === "image" ? { dimensions: imageDimensions(entry.bytes, entry.mediaType) } : {}),
      ...(entry.kind === "state-page" ? {
        encoding: entry.encoding,
        decodedByteLength: entry.decodedBytes.length,
        decodedDigest: { algorithm: "sha256", value: sha256Hex(entry.decodedBytes) },
        codec: entry.codec,
      } : {}),
    };
  });

  const document = {
    meta: canonicalize({
      ...input.meta,
      format: FORMAT_ID,
      profile: PROFILE_ID,
      generator: { name: "domformat", version: "0.0.0" },
    }, jsonLimits),
    tree: canonicalize(input.tree, jsonLimits),
    cssBinding: canonicalize(input.cssBinding, jsonLimits),
    state: canonicalize(input.state, jsonLimits),
    bindings: canonicalize(input.bindings, jsonLimits),
    resources: canonicalize({ version: 0, resources: records }, jsonLimits),
  };
  const validated = validateDocumentInternal(document, options);
  const variantClasses = preparedVariantClassTokens(document.state);
  const resourceMap = new Map<string, Uint8Array>(resourceInputs.map((entry): [string, Uint8Array] => [entry.id, entry.bytes]));
  const decodedStatePages = new Map<string, Uint8Array>(resourceInputs.filter((entry) => entry.kind === "state-page").map((entry): [string, Uint8Array] => [entry.id, entry.decodedBytes]));
  validateDecodedStatePages(document as unknown as DomDocument, decodedStatePages, validated.limits);
  for (const binding of document.cssBinding.stylesheets) {
    const stylesheet = resourceMap.get(binding.resource);
    invariant(stylesheet, "MISSING_CSS_RESOURCE", `Stylesheet bytes ${binding.resource} are absent.`);
    validateCssBytes(stylesheet, binding, validated.resourceIds, validated.limits, { forbiddenClassTokens: variantClasses });
  }
  for (const record of records) validateResourceBytes(record, resourceMap.get(record.id), validated.limits);

  const jsonBytes = encodeCanonicalJson(document, jsonLimits);
  invariant(jsonBytes.length <= limits.maxAggregateDecodedBytes, "DOCUMENT_DECODED_LIMIT", "The JSON document exceeds its configured limit.");
  invariant(jsonBytes.length <= limits.maxFileBytes, "FILE_TOO_LARGE", "The JSON document exceeds its configured file limit.");
  const externalResources = new Map<string, Uint8Array>(records.map((record): [string, Uint8Array] => [record.path, resourceMap.get(record.id)!]));
  return Object.freeze({
    bytes: jsonBytes,
    document: deepFreezeJson(document),
    externalResources,
  }) as DomBuildResult;
}
