import { jsonStructureLimits, mergeLimits, validateLimitOverrides } from "./constants.js";
import { decodeJson, deepFreezeJson } from "./canonical-json.js";
import { fail, invariant } from "./errors.js";
import { validateDocumentInternal } from "./schema.js";
import {
  assertSafeRelativePath,
  byteView,
  validateCssBytes,
  materializeCss,
  validateResourceBytes,
} from "./resources.js";
import { applyInitialResources, instantiateTree } from "./retained-dom.js";
import { materializeVariantEffectsCss, preparedVariantClassTokens } from "./variant-effects.js";
import { createLifecycle } from "./lifecycle.js";
import { createInteractionInput } from "./browser-input.js";
import { createPolycssEffects } from "./state/effects.js";
import { createPolycssInteraction } from "./state/interaction.js";
import { createPolycssPlayback, materializePolycssState } from "./state/polycss.js";
import { createPolycssOrbitInput, type PolycssOrbitInput } from "./state/orbit.js";
import { createPolycssPagedState, type PolycssPagedState, type StatePageBytesLoader } from "./state/paged-state.js";
import { createPolycssCompositorTiming, type PolycssCompositorTiming } from "./state/compositor-timing.js";
import { createStaticPresentation } from "./state/presentation.js";
import type {
  DomBrowserReadOptions,
  DomBrowserReadResult,
  DomBrowserUrlOptions,
  DomBytes,
  DomDocument,
  DomExternalInputId,
  DomExperienceMode,
  DomLimitOverrides,
  DomMountOptions,
  DomMountRuntime,
  DomResourceRecord,
  DomTransport,
} from "./public-types.js";
import type { DomLimits } from "./constants.js";
import type { DomBindingTarget, DomBindings } from "./public-types.js";
import type { MountedTree } from "./retained-dom.js";
import type { InteractionInput, InteractionSample } from "./browser-input.js";
import type { InteractionParameters, PlaybackParameters } from "./schema.js";
import type { PolycssEffects } from "./state/effects.js";
import type { PolycssInteraction } from "./state/interaction.js";
import type { MaterializedPolycssState, PolycssPlayback } from "./state/polycss.js";
import type { StaticPresentation } from "./state/presentation.js";

const RUNTIME_SCOPE_ATTRIBUTE = "data-domformat-instance";
const MAX_CATCH_UP_TICKS = 8;
interface ValidatedBrowserResult {
  readonly document: DomDocument;
  readonly limits: DomLimits;
  readonly resourceBytes: ReadonlyMap<string, Uint8Array>;
  readonly loadStatePage: StatePageBytesLoader;
}

interface RuntimeScope {
  readonly name: typeof RUNTIME_SCOPE_ATTRIBUTE;
  readonly selector: string;
  readonly value: string;
}

interface BrowserReader {
  read(): Promise<Readonly<{ done: boolean; value?: unknown }>>;
  cancel?(): unknown;
}

interface BrowserBody {
  getReader(): BrowserReader;
  cancel?(): unknown;
}

interface BrowserResponse {
  readonly ok: boolean;
  readonly status?: number;
  readonly headers?: Readonly<{ get?(name: string): string | null }>;
  readonly body?: BrowserBody | null;
}

type BrowserWindow = Window & Readonly<{
  URL?: typeof URL;
  Blob?: typeof Blob;
  ResizeObserver?: typeof ResizeObserver;
}>;

interface ResponseByteOptions {
  readonly expectedLength?: number;
  readonly label: string;
  readonly limit: number;
  readonly limitCode: string;
  readonly mismatchCode: string;
  readonly signal?: AbortSignal;
}

interface FetchByteOptions extends ResponseByteOptions {
  readonly fetchCode: string;
}

type BrowserFetcher = (input: string, init: RequestInit) => Promise<unknown>;

interface BoundTargetGroup {
  readonly [key: string]: BoundTargetGraph;
}

type BoundTargetGraph = HTMLElement | readonly BoundTargetGraph[] | BoundTargetGroup;

interface BoundMountedChannel {
  readonly targets: Readonly<Record<string, BoundTargetGraph>>;
}

interface MountedRuntimeState {
  readonly bindings: DomBindings;
  readonly mounted: MountedTree;
  readonly materialized: MaterializedPolycssState;
  readonly preparedPlayback: PolycssPlayback;
  readonly boundTargets: ReadonlyMap<string, BoundMountedChannel>;
}

interface MountRuntimeOwner {
  readonly lifecycle: ReturnType<typeof createLifecycle>;
  readonly urls: Map<string, string>;
  readonly styles: HTMLStyleElement[];
  win: BrowserWindow | null;
  urlApi: typeof URL | null;
  restoreHost: (() => void) | null;
  hostMutated: boolean;
  runtimeState: MountedRuntimeState | null;
  effects: PolycssEffects | null;
  input: InteractionInput | null;
  resizeObserver: ResizeObserver | null;
  request: number | null;
  timer: number | null;
  reschedule: (() => void) | null;
  mode: DomExperienceMode;
  animateEnabled: boolean;
  destroyedSourceFrame: number;
  interaction: PolycssInteraction | null;
  orbit: PolycssOrbitInput | null;
  pagedState: PolycssPagedState | null;
  compositorTiming: PolycssCompositorTiming | null;
  reservedHost: HTMLElement | null;
  presentation: StaticPresentation | null;
  interactionViewport: Readonly<{ viewportWidth?: number; viewportHeight?: number }> | null;
}

const validatedBrowserResults = new WeakMap<DomBrowserReadResult, ValidatedBrowserResult>();
const activeMountHosts = new WeakSet<HTMLElement>();
let runtimeScopeSequence = 0;
const BROWSER_DEFAULT_LIMITS = Object.freeze({
  maxFileBytes: 32 * 1024 * 1024,
  maxDecodedInputBytes: 32 * 1024 * 1024,
  maxAggregateDecodedBytes: 32 * 1024 * 1024,
  maxNodes: 10_000,
  maxResources: 64,
  maxStatePages: 512,
  maxResourceBytes: 8 * 1024 * 1024,
  maxAggregateResourceBytes: 16 * 1024 * 1024,
  maxAggregateStatePageBytes: 32 * 1024 * 1024,
  maxImagePixels: 16 * 1024 * 1024,
  maxAggregateImagePixels: 16 * 1024 * 1024,
  maxCssBytes: 1024 * 1024,
  maxFrames: 2_000,
  maxPagedFrames: 64_000,
  maxStatePageFrames: 2_000,
  maxTimelineTicks: 200_000,
  maxPreparedTransforms: 500_000,
  maxPreparedStates: 500_000,
  maxPreparedChanges: 1_000_000,
  maxVisibilityCells: 4 * 1024 * 1024,
  maxEffectParticles: 2_000,
  maxEffectSpawnTuples: 100_000,
  maxInteractionObjects: 4_096,
  maxInteractionVertices: 100_000,
  maxInteractionWeights: 250_000,
  maxInteractionWeightReferences: 1_000_000,
  maxInteractionLeafRows: 250_000,
}) satisfies DomLimitOverrides;

function mergeBrowserLimits(overrides: DomLimitOverrides = {}): DomLimits {
  validateLimitOverrides(overrides);
  return mergeLimits({ ...BROWSER_DEFAULT_LIMITS, ...overrides });
}

function throwIfAborted(signal?: AbortSignal): void {
  invariant(!signal?.aborted, "OPERATION_ABORTED", "The browser domformat operation was aborted by its host.");
}

function runtimeScope(document: Document): RuntimeScope {
  let value: string;
  do {
    value = `d${(runtimeScopeSequence++).toString(36)}`;
  } while (document.querySelector?.(`[${RUNTIME_SCOPE_ATTRIBUTE}="${value}"]`));
  return Object.freeze({
    name: RUNTIME_SCOPE_ATTRIBUTE,
    selector: `[${RUNTIME_SCOPE_ATTRIBUTE}="${value}"]`,
    value,
  });
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  const digestFunction = subtle?.digest;
  invariant(typeof digestFunction === "function", "MISSING_BROWSER_API", "SHA-256 support is required before a package can be verified.");
  try {
    const digest = new Uint8Array(await Reflect.apply(digestFunction, subtle, ["SHA-256", browserBufferView(bytes)]));
    return [...digest].map((value) => value.toString(16).padStart(2, "0")).join("");
  } catch (error) {
    fail("RESOURCE_DIGEST_FAILED", "Browser SHA-256 verification failed.", { cause: String(error) });
  }
}

async function decodeBrowserStatePage(record: DomResourceRecord, encoded: Uint8Array, signal?: AbortSignal): Promise<Uint8Array> {
  invariant(record.kind === "state-page" && record.decodedByteLength !== undefined && record.decodedDigest, "INVALID_STATE_PAGE_RESOURCE", `Resource ${record.id} is not a complete state page.`);
  if (record.encoding === "identity") return encoded;
  const DecompressionStreamClass = globalThis.DecompressionStream;
  invariant(typeof DecompressionStreamClass === "function", "MISSING_BROWSER_API", "Gzip state pages require DecompressionStream support.");
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    const stream = new Blob([browserBufferView(encoded)]).stream().pipeThrough(new DecompressionStreamClass("gzip"));
    reader = stream.getReader() as ReadableStreamDefaultReader<Uint8Array>;
    const decoded = new Uint8Array(record.decodedByteLength);
    let length = 0;
    while (true) {
      throwIfAborted(signal);
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = externalBytes(value, `Decoded state page ${record.id}`);
      length += chunk.length;
      invariant(length <= record.decodedByteLength, "STATE_PAGE_DECODED_SIZE_MISMATCH", `State page ${record.id} exceeds its declared decoded length.`);
      decoded.set(chunk, length - chunk.length);
    }
    invariant(length === record.decodedByteLength, "STATE_PAGE_DECODED_SIZE_MISMATCH", `State page ${record.id} decoded length does not match RCRD.`);
    invariant(await sha256Hex(decoded) === record.decodedDigest.value, "STATE_PAGE_DECODED_DIGEST_MISMATCH", `State page ${record.id} decoded digest does not match RCRD.`);
    return decoded;
  } catch (error) {
    try { await reader?.cancel(); } catch {}
    if ((error as { name?: string })?.name === "DomFormatError") throw error;
    fail("STATE_PAGE_DECODE_FAILED", `State page ${record.id} gzip decoding failed.`, { cause: String(error) });
  }
}

function browserBufferView(bytes: Uint8Array) {
  return bytes.buffer instanceof ArrayBuffer
    ? new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    : Uint8Array.from(bytes);
}

function externalBytes(value: unknown, label: string): Uint8Array {
  const bytes = byteView(value);
  invariant(bytes, "INVALID_RESOURCE_BYTES", `${label} did not return an ArrayBuffer or ArrayBufferView.`);
  return bytes;
}

function requiredResourceBytes(resources: ReadonlyMap<string, Uint8Array>, id: string): Uint8Array {
  const bytes = resources.get(id);
  invariant(bytes, "MISSING_EXTERNAL_RESOURCE", `External resource ${id} is missing.`);
  return bytes;
}

const JSON_DOCUMENT_FIELDS = Object.freeze(["meta", "tree", "cssBinding", "state", "bindings", "resources"]);
function browserPlainRecord(value: unknown, code: string, label: string): Record<string, unknown> {
  invariant(value && typeof value === "object" && !Array.isArray(value), code, `${label} must be an object.`);
  const prototype = Object.getPrototypeOf(value);
  invariant(prototype === Object.prototype || prototype === null, code, `${label} must be a plain object.`);
  return value as Record<string, unknown>;
}

async function decodeBrowserJsonTransport(value: DomBytes, limits: DomLimits, signal?: AbortSignal): Promise<DomTransport> {
  throwIfAborted(signal);
  const bytes = externalBytes(value, "Model");
  invariant(bytes.length <= limits.maxFileBytes, "FILE_LIMIT", "Browser JSON exceeds its file byte limit.");
  invariant(!(bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b), "UNSUPPORTED_TRANSPORT", "domformat@0 accepts plain JSON only.");
  invariant(bytes.length <= limits.maxAggregateDecodedBytes, "DOCUMENT_DECODED_LIMIT", "Browser JSON exceeds its byte limit.");
  return Object.freeze({ encoding: "json", totalLength: bytes.length, decodedLength: bytes.length, bytes: bytes.slice() });
}

function browserDocumentEnvelope(value: unknown): Record<string, unknown> {
  const document = browserPlainRecord(value, "INVALID_DOCUMENT", "Decoded document");
  const allowed = new Set(JSON_DOCUMENT_FIELDS);
  for (const key of Object.keys(document)) invariant(allowed.has(key), "INVALID_DOCUMENT", `Decoded document contains unsupported field ${key}.`);
  return Object.fromEntries(JSON_DOCUMENT_FIELDS.map((name) => [name, document[name]]));
}

async function readResponseBytes(
  response: BrowserResponse,
  { expectedLength, label, limit, limitCode, mismatchCode, signal }: ResponseByteOptions,
): Promise<Uint8Array> {
  invariant(response && typeof response.ok === "boolean", "INVALID_FETCH_RESPONSE", `${label} fetch did not return a Response-like object.`);
  try {
    const contentEncoding = response.headers?.get?.("content-encoding")?.trim().toLowerCase() ?? "";
    const contentLength = response.headers?.get?.("content-length");
    if ((!contentEncoding || contentEncoding === "identity") && typeof contentLength === "string" && /^\d+$/u.test(contentLength)) {
      const declared = Number(contentLength);
      invariant(Number.isSafeInteger(declared) && declared <= limit, limitCode, `${label} response exceeds its byte limit.`);
      if (expectedLength !== undefined) invariant(declared === expectedLength, mismatchCode, `${label} HTTP length does not match its declared package length.`);
    }
  } catch (error) {
    try { await response.body?.cancel?.(); } catch {}
    throw error;
  }

  const chunks: Uint8Array[] = [];
  let total = 0;
  invariant(typeof response.body?.getReader === "function", "UNSTREAMABLE_FETCH_RESPONSE", `${label} response does not expose a bounded readable stream.`);
  const reader = response.body.getReader();
  try {
    while (true) {
      throwIfAborted(signal);
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = externalBytes(value, label);
      total += chunk.byteLength;
      invariant(total <= limit, limitCode, `${label} response exceeds its byte limit.`);
      chunks.push(chunk);
    }
  } catch (error) {
    try { await reader.cancel?.(); } catch {}
    throw error;
  }
  if (expectedLength !== undefined) invariant(total === expectedLength, mismatchCode, `${label} response length does not match its declared package length.`);
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function resolveModelUrl(value: string | URL, baseUrl?: string | URL): URL {
  let url: URL;
  try {
    url = baseUrl === undefined ? new URL(value) : new URL(value, baseUrl);
  } catch {
    invariant(false, "UNSAFE_MODEL_URL", "The domformat JSON URL is invalid or lacks a trusted base URL.");
  }
  invariant((url.protocol === "http:" || url.protocol === "https:") && !url.username && !url.password, "UNSAFE_MODEL_URL", "The domformat JSON URL must use HTTP(S) without credentials.");
  return url;
}

async function fetchBytes(fetcher: BrowserFetcher, url: URL, options: FetchByteOptions): Promise<Uint8Array> {
  throwIfAborted(options.signal);
  let response: unknown;
  try {
    response = await fetcher(url.href, {
      cache: "no-store",
      credentials: "omit",
      redirect: "error",
      signal: options.signal,
    });
  } catch (error) {
    throwIfAborted(options.signal);
    invariant(false, options.fetchCode, `${options.label} request failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  invariant(response && typeof response === "object" && typeof Reflect.get(response, "ok") === "boolean", "INVALID_FETCH_RESPONSE", `${options.label} fetch did not return a Response-like object.`);
  const browserResponse = response as BrowserResponse;
  if (!browserResponse.ok) {
    try { await browserResponse.body?.cancel?.(); } catch {}
    invariant(false, options.fetchCode, `${options.label} request failed with HTTP ${browserResponse.status}.`);
  }
  return readResponseBytes(browserResponse, options);
}

export function readDomBrowser(value: DomBytes, options?: DomBrowserReadOptions): Promise<DomBrowserReadResult>;
export async function readDomBrowser(value: DomBytes, options: DomBrowserReadOptions = {}): Promise<DomBrowserReadResult> {
  const limits = mergeBrowserLimits(options.limits);
  throwIfAborted(options.signal);
  const transport = await decodeBrowserJsonTransport(value, limits, options.signal);
  const parsed = decodeJson(transport.bytes, "domformat JSON document", jsonStructureLimits(limits));
  throwIfAborted(options.signal);
  const envelope = browserDocumentEnvelope(parsed);
  const validated = validateDocumentInternal(envelope, { limits });
  const document = envelope as unknown as DomDocument;
  const variantClasses = preparedVariantClassTokens(document.state);
  const resourceBytes = new Map<string, Uint8Array>();
  const providedStatePages = new Map<string, Uint8Array>();
  const provided = options.externalResources;
  const loader = options.loadExternalResource;
  invariant(provided === undefined || provided instanceof Map, "INVALID_EXTERNAL_RESOURCES", "externalResources must be a Map keyed by logical resource id.");
  invariant(document.resources.resources.length === 0 || provided instanceof Map || typeof loader === "function", "MISSING_EXTERNAL_RESOURCE", "Browser loading requires external resource bytes or a trusted loader.");
  if (provided instanceof Map) {
    const declared = new Set(document.resources.resources.map((record) => record.id));
    for (const id of provided.keys()) invariant(declared.has(id), "UNEXPECTED_EXTERNAL_RESOURCE", `External resource ${String(id)} is not declared by this document.`);
    for (const record of document.resources.resources) {
      if (record.kind !== "state-page" || !provided.has(record.id)) continue;
      providedStatePages.set(record.id, externalBytes(provided.get(record.id), `Resource ${record.id}`).slice());
    }
  }
  for (const record of document.resources.resources) {
    if (record.kind === "state-page") continue;
    throwIfAborted(options.signal);
    const loaded = provided?.get(record.id) ?? await loader?.(record, options.signal);
    throwIfAborted(options.signal);
    invariant(loaded !== undefined, "MISSING_EXTERNAL_RESOURCE", `External resource ${record.id} is missing.`);
    resourceBytes.set(record.id, externalBytes(loaded, `Resource ${record.id}`).slice());
  }
  for (const record of document.resources.resources) {
    if (record.kind === "state-page") continue;
    throwIfAborted(options.signal);
    const bytes = resourceBytes.get(record.id);
    invariant(bytes, "MISSING_EXTERNAL_RESOURCE", `External resource ${record.id} is missing.`);
    invariant(bytes.length === record.byteLength, "RESOURCE_SIZE_MISMATCH", `Resource ${record.id} byte length does not match RCRD.`);
    invariant(await sha256Hex(bytes) === record.digest.value, "RESOURCE_DIGEST_MISMATCH", `Resource ${record.id} integrity failed.`);
    throwIfAborted(options.signal);
    validateResourceBytes(record, bytes, validated.limits);
  }
  const loadStatePage: StatePageBytesLoader = async (record, signal) => {
    invariant(record.kind === "state-page", "INVALID_STATE_PAGE_RESOURCE", `Resource ${record.id} is not a state page.`);
    throwIfAborted(signal);
    const loaded = providedStatePages.get(record.id) ?? await loader?.(record, signal);
    throwIfAborted(signal);
    invariant(loaded !== undefined, "MISSING_EXTERNAL_RESOURCE", `External resource ${record.id} is missing.`);
    const encoded = externalBytes(loaded, `Resource ${record.id}`).slice();
    invariant(encoded.length === record.byteLength, "RESOURCE_SIZE_MISMATCH", `Resource ${record.id} byte length does not match RCRD.`);
    invariant(await sha256Hex(encoded) === record.digest.value, "RESOURCE_DIGEST_MISMATCH", `Resource ${record.id} integrity failed.`);
    validateResourceBytes(record, encoded, validated.limits);
    return decodeBrowserStatePage(record, encoded, signal);
  };
  for (const binding of document.cssBinding.stylesheets) {
    validateCssBytes(requiredResourceBytes(resourceBytes, binding.resource), binding, validated.resourceIds, validated.limits, { forbiddenClassTokens: variantClasses });
  }
  deepFreezeJson(document);
  const publicResourceBytes = new Map<string, Uint8Array>([...resourceBytes].map(([id, bytes]) => [id, bytes.slice()]));
  const result: DomBrowserReadResult = Object.freeze({ transport, document, resourceBytes: publicResourceBytes });
  validatedBrowserResults.set(result, Object.freeze({ document, limits: validated.limits, resourceBytes, loadStatePage }));
  return result;
}

export function readDomBrowserUrl(modelUrl: string | URL, options?: DomBrowserUrlOptions): Promise<DomBrowserReadResult>;
export async function readDomBrowserUrl(modelUrl: string | URL, options: DomBrowserUrlOptions = {}): Promise<DomBrowserReadResult> {
  const limits = mergeBrowserLimits(options.limits);
  const baseUrl = options.baseUrl ?? globalThis.document?.baseURI;
  const resolvedModel = resolveModelUrl(modelUrl, baseUrl);
  const fetcher = options.fetch ?? globalThis.fetch;
  invariant(typeof fetcher === "function", "MISSING_FETCH", "Browser URL loading requires fetch.");
  const modelBytes = await fetchBytes(fetcher, resolvedModel, {
    fetchCode: "MODEL_FETCH_FAILED",
    label: "Model",
    limit: limits.maxFileBytes,
    limitCode: "FILE_LIMIT",
    mismatchCode: "TOTAL_LENGTH_MISMATCH",
    signal: options.signal,
  });
  const defaultLoader = async (record: DomResourceRecord, signal?: AbortSignal): Promise<Uint8Array> => {
    const relative = assertSafeRelativePath(record.path, `Resource ${record.id} path`);
    const resourceUrl = new URL(relative, resolvedModel);
    invariant(resourceUrl.origin === resolvedModel.origin && !resourceUrl.username && !resourceUrl.password, "UNSAFE_RESOURCE_URL", `Resource ${record.id} escapes the model origin.`);
    return fetchBytes(fetcher, resourceUrl, {
      expectedLength: record.byteLength,
      fetchCode: "RESOURCE_FETCH_FAILED",
      label: `Resource ${record.id}`,
      limit: record.byteLength,
      limitCode: "RESOURCE_SIZE_MISMATCH",
      mismatchCode: "RESOURCE_SIZE_MISMATCH",
      signal: signal ?? options.signal,
    });
  };
  return readDomBrowser(modelBytes, {
    ...options,
    limits,
    loadExternalResource: options.loadExternalResource ?? defaultLoader,
  });
}

function captureHostState(host: HTMLElement): () => void {
  invariant(host && typeof host.replaceChildren === "function" && host.style, "INVALID_DOCUMENT_HOST", "A mount host is required.");
  const children = [...host.childNodes];
  const tabindex = {
    present: host.hasAttribute("tabindex"),
    value: host.getAttribute("tabindex"),
  };
  let restored = false;
  return () => {
    if (restored) return;
    restored = true;
    host.replaceChildren(...children);
    if (tabindex.present) host.setAttribute("tabindex", tabindex.value ?? "");
    else host.removeAttribute("tabindex");
  };
}

function applyMountBoundary(surface: HTMLElement): void {
  const declarations: readonly (readonly [string, string])[] = [
    ["display", "block"],
    ["position", "relative"],
    ["inset", "0"],
    ["width", "100%"],
    ["height", "100%"],
    ["max-width", "none"],
    ["margin", "0"],
    ["padding", "0"],
    ["border", "0"],
    ["box-sizing", "border-box"],
    ["overflow", "hidden"],
    ["contain", "strict"],
    ["isolation", "isolate"],
    ["transform", "none"],
    ["z-index", "auto"],
    ["opacity", "1"],
    ["visibility", "visible"],
    ["pointer-events", "auto"],
  ];
  const camel = (name: string): string => name.replace(/-([a-z])/gu, (_match, letter: string) => letter.toUpperCase());
  const style = surface.style as CSSStyleDeclaration & Record<string, string>;
  for (const [name, value] of declarations) {
    if (typeof style.setProperty === "function") style.setProperty(name, value, "important");
    else style[camel(name)] = value;
  }
  surface.setAttribute("data-domformat-mount-surface", "");
}

async function decodeImageResources(
  document: DomDocument,
  resourceBytes: ReadonlyMap<string, Uint8Array>,
  win: Window,
  BlobClass: typeof Blob,
  signal?: AbortSignal,
): Promise<void> {
  const receiver = typeof win.createImageBitmap === "function" ? win : globalThis;
  const decode = receiver.createImageBitmap;
  invariant(typeof decode === "function", "MISSING_BROWSER_API", "Image decoding support is required before a package can publish.");
  for (const record of document.resources.resources) {
    if (record.kind !== "image") continue;
    throwIfAborted(signal);
    const bytes = resourceBytes.get(record.id);
    invariant(bytes && record.dimensions, "MISSING_EXTERNAL_RESOURCE", `Image resource ${record.id} is incomplete.`);
    let bitmap: ImageBitmap | undefined;
    try {
      bitmap = await Reflect.apply(decode, receiver, [new BlobClass([browserBufferView(bytes)], { type: record.mediaType })]) as ImageBitmap;
    } catch (error) {
      throwIfAborted(signal);
      fail("IMAGE_DECODE_FAILED", `Browser decoding rejected image resource ${record.id}.`, { cause: String(error) });
    }
    try {
      throwIfAborted(signal);
      invariant(bitmap && bitmap.width === record.dimensions.width && bitmap.height === record.dimensions.height, "IMAGE_DIMENSION_MISMATCH", `Browser-decoded image ${record.id} dimensions do not match RCRD.`);
    } finally {
      try { bitmap?.close?.(); } catch {}
    }
  }
}

function bindTargetGraph(value: DomBindingTarget, mounted: MountedTree): BoundTargetGraph {
  if (typeof value === "string") {
    const element = value === "$host" ? mounted.host : mounted.byId.get(value);
    invariant(element, "MISSING_TARGET_NODE", `Declared binding target ${value} is not mounted.`);
    return element;
  }
  if (Array.isArray(value)) return Object.freeze(value.map((entry) => bindTargetGraph(entry, mounted)));
  const bound: Record<string, BoundTargetGraph> = {};
  for (const [name, entry] of Object.entries(value)) bound[name] = bindTargetGraph(entry, mounted);
  return Object.freeze(bound);
}

function bindMountedChannels(bindings: DomBindings, mounted: MountedTree): ReadonlyMap<string, BoundMountedChannel> {
  const channels = new Map<string, BoundMountedChannel>();
  for (const channel of bindings.channels) {
    const targets = bindTargetGraph(channel.targets, mounted) as BoundTargetGroup;
    channels.set(channel.id, Object.freeze({ targets }));
  }
  return channels;
}

function cleanupMount(owner: MountRuntimeOwner): boolean {
  if (owner.lifecycle.isDestroyed()) return false;
  const attempt = (operation?: (() => unknown) | null): void => {
    try { operation?.(); } catch {}
  };
  const request = owner.request;
  if (request !== null) attempt(() => owner.win?.cancelAnimationFrame(request));
  owner.request = null;
  const timer = owner.timer;
  if (timer !== null) attempt(() => owner.win?.clearTimeout(timer));
  owner.timer = null;
  owner.reschedule = null;
  attempt(() => owner.resizeObserver?.disconnect());
  owner.resizeObserver = null;
  attempt(() => owner.input?.destroy());
  owner.input = null;
  attempt(() => owner.interaction?.destroy());
  owner.interaction = null;
  attempt(() => owner.effects?.destroy());
  owner.effects = null;
  attempt(() => owner.orbit?.destroy());
  owner.orbit = null;
  attempt(() => owner.pagedState?.destroy());
  owner.pagedState = null;
  attempt(() => owner.compositorTiming?.destroy());
  owner.compositorTiming = null;
  if (owner.runtimeState) owner.destroyedSourceFrame = owner.runtimeState.preparedPlayback.sourceFrame;
  owner.runtimeState = null;
  owner.presentation = null;
  owner.interactionViewport = null;
  for (const style of owner.styles) attempt(() => style.remove());
  owner.styles.length = 0;
  for (const url of owner.urls.values()) attempt(() => owner.urlApi?.revokeObjectURL(url));
  owner.urls.clear();
  if (owner.hostMutated) attempt(owner.restoreHost);
  owner.hostMutated = false;
  owner.restoreHost = null;
  if (owner.reservedHost) activeMountHosts.delete(owner.reservedHost);
  owner.reservedHost = null;
  owner.urlApi = null;
  owner.win = null;
  owner.lifecycle.destroy();
  return true;
}

function assertMounted(owner: MountRuntimeOwner): void {
  invariant(!owner.lifecycle.isDestroyed(), "MOUNT_DESTROYED", "The mounted DOM runtime is destroyed.");
  owner.lifecycle.assertPublished();
}

function requireRuntimeState(owner: MountRuntimeOwner): MountedRuntimeState {
  invariant(owner.runtimeState, "MOUNT_DESTROYED", "The mounted DOM runtime is destroyed.");
  return owner.runtimeState;
}

function mountedRuntime(owner: MountRuntimeOwner): MountedRuntimeState {
  assertMounted(owner);
  return requireRuntimeState(owner);
}

function publishPlaybackFrame(owner: MountRuntimeOwner, frame: number): number {
  if (owner.effects && owner.effects.sourceFrame !== frame) owner.effects.publish(frame);
  return frame;
}

function applyResponsivePlaybackProfile(
  owner: MountRuntimeOwner,
  mountSurface: HTMLElement,
  options: DomMountOptions,
): void {
  const presentation = owner.presentation;
  invariant(presentation, "MISSING_POLYCSS_BINDING", "Static presentation is not mounted.");
  presentation.resize();
  const playback = requireRuntimeState(owner).preparedPlayback;
  const changed = playback.selectProfileTimeline(presentation.profileId);
  if (changed && owner.mode === "animation") {
    const frame = publishPlaybackFrame(owner, playback.restart());
    owner.reschedule?.();
    owner.pagedState?.resetPreload(frame);
  }
  playback.applyViewportProfile(
    mountSurface.clientWidth || options.viewportWidth || presentation.sourceWidth,
    mountSurface.clientHeight || options.viewportHeight || presentation.sourceHeight,
    presentation.profileId,
  );
}

function advancePlayback(owner: MountRuntimeOwner): number {
  const frame = publishPlaybackFrame(owner, mountedRuntime(owner).preparedPlayback.advance());
  owner.pagedState?.preloadAfter(frame);
  return frame;
}

function advancePlaybackMany(owner: MountRuntimeOwner, count: number): number {
  const frames = mountedRuntime(owner).preparedPlayback.advanceMany(count);
  owner.effects?.publishMany(frames);
  const latest = frames.at(-1);
  invariant(latest !== undefined, "INVALID_PLAYBACK_PUBLICATION", "Prepared playback produced no catch-up frame.");
  owner.pagedState?.preloadAfter(latest);
  return latest;
}

function advancePlaybackCollapsed(owner: MountRuntimeOwner, count: number): number {
  const frame = publishPlaybackFrame(owner, mountedRuntime(owner).preparedPlayback.advanceCollapsed(count));
  owner.pagedState?.preloadAfter(frame);
  return frame;
}

function seekPlayback(owner: MountRuntimeOwner, frame: number): number {
  return publishPlaybackFrame(owner, mountedRuntime(owner).preparedPlayback.seek(frame));
}

function selectPlaybackBank(owner: MountRuntimeOwner, id: string): number {
  invariant(owner.mode === "animation", "INVALID_EXPERIENCE_MODE", "Prepared banks can be selected only in animation mode.");
  const frame = publishPlaybackFrame(owner, mountedRuntime(owner).preparedPlayback.selectBank(id));
  owner.pagedState?.setActiveFramePin(frame);
  owner.interaction?.invalidatePublication();
  return frame;
}

function makeInteraction(owner: MountRuntimeOwner): Readonly<{ initialFrame: number; interpreter: PolycssInteraction }> {
  const state = requireRuntimeState(owner);
  const binding = state.bindings.channels.find((channel) => channel.interpreter === "polycss-pointer-grab@0");
  const parameters = binding?.parameters as unknown as InteractionParameters | undefined;
  invariant(binding && parameters && owner.presentation && owner.interactionViewport, "MISSING_POLYCSS_BINDING", "Executable pointer interaction parameters are required.");
  return Object.freeze({
    initialFrame: parameters.initialFrame,
    interpreter: createPolycssInteraction(state.materialized, state.bindings, state.mounted, state.preparedPlayback, {
      ...owner.interactionViewport,
      boundTargets: state.boundTargets,
      presentation: owner.presentation,
    }),
  });
}

function activateInteraction(owner: MountRuntimeOwner): void {
  assertMounted(owner);
  const next = makeInteraction(owner);
  try {
    const playback = mountedRuntime(owner).preparedPlayback;
    playback.seek(next.initialFrame);
    publishPlaybackFrame(owner, playback.sourceFrame);
    owner.input?.setEnabled(true);
  } catch (error) {
    next.interpreter.destroy();
    throw error;
  }
  owner.interaction = next.interpreter;
}

function stepInteraction(owner: MountRuntimeOwner, sample?: InteractionSample) {
  assertMounted(owner);
  invariant(owner.interaction, "INVALID_EXPERIENCE_MODE", "Interaction mode is not active.");
  invariant(owner.input, "INVALID_EXPERIENCE_MODE", "Interaction input is not mounted.");
  owner.pagedState?.assertFrameReady(owner.interaction.inspect().sourceFrame);
  const frame = owner.interaction.step(sample ?? owner.input.sample());
  owner.effects?.publish(frame.sourceFrame, frame.selectedId && frame.selectedMatrix
    ? { active: true, x: frame.selectedMatrix[12], y: frame.selectedMatrix[13], z: frame.selectedMatrix[14] }
    : { active: false, x: 0, y: 0, z: 0 });
  owner.pagedState?.preloadAfter(frame.sourceFrame);
  return frame;
}

function setRuntimeMode(owner: MountRuntimeOwner, next: DomExperienceMode): DomExperienceMode {
  assertMounted(owner);
  invariant(next === "animation" || next === "interaction", "INVALID_EXPERIENCE_MODE", "Browser mode must be animation or interaction.");
  if (next === owner.mode) return owner.mode;
  try {
    if (next === "interaction") {
      activateInteraction(owner);
      invariant(owner.interaction, "MISSING_POLYCSS_BINDING", "Interaction mode did not initialize its interpreter.");
      owner.interaction.publishInitial();
    } else {
      owner.input?.setEnabled(false);
      const modified = owner.interaction?.restore() ?? { shapeIndices: [], leafIndices: [] };
      owner.interaction?.destroy();
      owner.interaction = null;
      const sourceFrame = mountedRuntime(owner).preparedPlayback.restart(modified.shapeIndices, modified.leafIndices);
      if (owner.effects && owner.effects.sourceFrame !== sourceFrame) owner.effects.publish(sourceFrame);
    }
    owner.mode = next;
    owner.compositorTiming?.setActive(next === "animation" && owner.animateEnabled);
    owner.reschedule?.();
    owner.pagedState?.resetPreload(mountedRuntime(owner).preparedPlayback.sourceFrame);
    return owner.mode;
  } catch (error) {
    cleanupMount(owner);
    throw error;
  }
}

function createMountedRuntime(owner: MountRuntimeOwner): DomMountRuntime {
  return Object.freeze({
    lifecycle: owner.lifecycle.view as DomMountRuntime["lifecycle"],
    get mode() { return owner.mode; },
    get sourceFrame() {
      return owner.lifecycle.isDestroyed()
        ? owner.destroyedSourceFrame
        : mountedRuntime(owner).preparedPlayback.sourceFrame;
    },
    get bankId() {
      return owner.lifecycle.isDestroyed()
        ? null
        : mountedRuntime(owner).preparedPlayback.bankId;
    },
    seek(frame: number) {
      owner.pagedState?.assertFrameReady(frame);
      const nextFrame = seekPlayback(owner, frame);
      owner.reschedule?.();
      owner.pagedState?.preloadAfter(nextFrame);
      owner.interaction?.invalidatePublication();
      return nextFrame;
    },
    async seekAsync(frame: number) {
      assertMounted(owner);
      try {
        await owner.pagedState?.ensureFrame(frame);
        const nextFrame = seekPlayback(owner, frame);
        owner.reschedule?.();
        owner.pagedState?.preloadAfter(nextFrame);
        owner.interaction?.invalidatePublication();
        return nextFrame;
      } catch (error) {
        if ((error as { code?: string })?.code !== "OPERATION_ABORTED") cleanupMount(owner);
        throw error;
      }
    },
    selectBank(id: string) {
      assertMounted(owner);
      const playback = mountedRuntime(owner).preparedPlayback;
      const frame = playback.bankEntryFrame(id);
      owner.pagedState?.assertFrameReady(frame);
      const nextFrame = selectPlaybackBank(owner, id);
      owner.reschedule?.();
      owner.pagedState?.resetPreload(nextFrame);
      return nextFrame;
    },
    async selectBankAsync(id: string) {
      assertMounted(owner);
      invariant(owner.mode === "animation", "INVALID_EXPERIENCE_MODE", "Prepared banks can be selected only in animation mode.");
      const playback = mountedRuntime(owner).preparedPlayback;
      const frame = playback.bankEntryFrame(id);
      await owner.pagedState?.ensureFrame(frame);
      const nextFrame = selectPlaybackBank(owner, id);
      owner.reschedule?.();
      owner.pagedState?.resetPreload(nextFrame);
      return nextFrame;
    },
    setMode(next: DomExperienceMode) {
      return setRuntimeMode(owner, next);
    },
    setInput(id: DomExternalInputId, value: number) {
      assertMounted(owner);
      invariant(owner.orbit, "UNKNOWN_EXTERNAL_INPUT", `External input ${String(id)} is unsupported by this document.`);
      try {
        return owner.orbit.setInput(id, value);
      } catch (error) {
        if ((error as { code?: string })?.code === "MOUNT_DESTROYED") cleanupMount(owner);
        throw error;
      }
    },
    destroy() {
      return cleanupMount(owner);
    },
  });
}

export function mountDom(result: DomBrowserReadResult, host: HTMLElement, options?: DomMountOptions): Promise<DomMountRuntime>;
export async function mountDom(
  result: DomBrowserReadResult,
  host: HTMLElement,
  options: DomMountOptions = {},
): Promise<DomMountRuntime> {
  const lifecycle = createLifecycle(options.onLifecyclePhase);
  const owner: MountRuntimeOwner = {
    lifecycle,
    urls: new Map(),
    styles: [],
    win: null,
    urlApi: null,
    restoreHost: null,
    hostMutated: false,
    runtimeState: null,
    effects: null,
    input: null,
    resizeObserver: null,
    request: null,
    timer: null,
    reschedule: null,
    mode: "animation",
    animateEnabled: options.animate !== false,
    destroyedSourceFrame: 0,
    interaction: null,
    orbit: null,
    pagedState: null,
    compositorTiming: null,
    reservedHost: null,
    presentation: null,
    interactionViewport: null,
  };
  let ownerDocument: Document;

  try {
    throwIfAborted(options.signal);
    const validated = result && typeof result === "object" ? validatedBrowserResults.get(result) : undefined;
    invariant(validated, "LIFECYCLE_PRECONDITION", "mountDom requires a result returned by readDomBrowser or readDomBrowserUrl.");
    const packageDocument = validated.document;
    const packageResources = validated.resourceBytes;
    owner.mode = options.mode ?? packageDocument.meta.initialExperience ?? "animation";
    invariant(owner.mode === "animation" || owner.mode === "interaction", "INVALID_EXPERIENCE_MODE", "Browser mode must be animation or interaction.");
    ownerDocument = host?.ownerDocument;
    const browserWindow = ownerDocument?.defaultView as BrowserWindow | null;
    invariant(ownerDocument && browserWindow, "INVALID_DOCUMENT_HOST", "A connected browser document host is required.");
    invariant(!activeMountHosts.has(host), "HOST_ALREADY_MOUNTED", "The mount host already owns a live domformat runtime.");
    activeMountHosts.add(host);
    owner.reservedHost = host;
    owner.win = browserWindow;
    const RuntimeUrl = browserWindow.URL ?? globalThis.URL;
    const RuntimeBlob = browserWindow.Blob ?? globalThis.Blob;
    invariant(typeof RuntimeUrl?.createObjectURL === "function" && typeof RuntimeUrl?.revokeObjectURL === "function" && typeof RuntimeBlob === "function", "MISSING_BROWSER_API", "Object URL and Blob support are required.");
    owner.urlApi = RuntimeUrl;

    const mountValidation = validateDocumentInternal(packageDocument, { limits: validated.limits });
    const variantClasses = preparedVariantClassTokens(packageDocument.state);
    throwIfAborted(options.signal);
    const interpreters = new Set(packageDocument.bindings.channels.map((channel) => channel.interpreter));
    invariant(interpreters.has("static-presentation@0"), "UNSUPPORTED_MOUNT_CONTRACT", "mountDom requires executable static presentation.");
    if (owner.mode === "interaction") invariant(interpreters.has("polycss-pointer-grab@0"), "UNSUPPORTED_MOUNT_CONTRACT", "The interaction experience requires an executable pointer interaction channel.");
    invariant(packageResources instanceof Map, "LIFECYCLE_PRECONDITION", "The validated browser result has no private resource snapshot.");
    invariant(packageResources.size === packageDocument.resources.resources.filter((record) => record.kind !== "state-page").length, "RESOURCE_CARDINALITY_MISMATCH", "Mounted eager resource count does not match RCRD.");
    for (const record of packageDocument.resources.resources) {
      if (record.kind === "state-page") continue;
      const bytes = externalBytes(packageResources.get(record.id), `Resource ${record.id}`);
      invariant(bytes.length === record.byteLength, "RESOURCE_SIZE_MISMATCH", `Resource ${record.id} byte length does not match RCRD.`);
      invariant(await sha256Hex(bytes) === record.digest.value, "RESOURCE_DIGEST_MISMATCH", `Resource ${record.id} integrity failed before mounting.`);
      throwIfAborted(options.signal);
      validateResourceBytes(record, bytes, mountValidation.limits);
    }
    for (const binding of packageDocument.cssBinding.stylesheets) {
      validateCssBytes(requiredResourceBytes(packageResources, binding.resource), binding, mountValidation.resourceIds, mountValidation.limits, { forbiddenClassTokens: variantClasses });
    }
    lifecycle.advance("validate");

    const isolation = runtimeScope(ownerDocument);
    owner.restoreHost = captureHostState(host);
    const mountSurface = ownerDocument.createElement("div");
    mountSurface.setAttribute(isolation.name, isolation.value);
    const mounted = instantiateTree(ownerDocument, mountSurface, { tree: packageDocument.tree });
    applyMountBoundary(mountSurface);
    lifecycle.advance("construct");

    for (const record of packageDocument.resources.resources) {
      if (record.kind !== "image") continue;
      owner.urls.set(record.id, RuntimeUrl.createObjectURL(new RuntimeBlob([Uint8Array.from(requiredResourceBytes(packageResources, record.id))], { type: record.mediaType })));
    }
    await decodeImageResources(packageDocument, packageResources, browserWindow, RuntimeBlob, options.signal);
    throwIfAborted(options.signal);
    applyInitialResources(mounted, owner.urls);
    for (const binding of packageDocument.cssBinding.stylesheets) {
      const css = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(requiredResourceBytes(packageResources, binding.resource));
      const element = ownerDocument.createElement("style");
      element.dataset.domformatStylesheet = binding.id;
      element.textContent = materializeCss(css, binding, owner.urls, { scope: isolation.selector, limits: mountValidation.limits });
      ownerDocument.head.appendChild(element);
      owner.styles.push(element);
    }
    const variantCss = materializeVariantEffectsCss(packageDocument, isolation.selector);
    if (variantCss) {
      const element = ownerDocument.createElement("style");
      element.dataset.domformatStylesheet = "prepared-variants";
      element.textContent = variantCss;
      ownerDocument.head.appendChild(element);
      owner.styles.push(element);
    }
    const mountedTargets = bindMountedChannels(packageDocument.bindings, mounted);
    lifecycle.advance("bind");

    const materialized = materializePolycssState(packageDocument.state);
    throwIfAborted(options.signal);
    const presentationController = createStaticPresentation(packageDocument.bindings, mounted, { ...options, boundTargets: mountedTargets });
    owner.pagedState = createPolycssPagedState(packageDocument, mounted, mountValidation.limits, validated.loadStatePage, {
      boundTargets: mountedTargets,
      onLateFailure: () => cleanupMount(owner),
    });
    await owner.pagedState?.prepareInitial(options.signal);
    owner.compositorTiming = createPolycssCompositorTiming(packageDocument.state, packageDocument.bindings, materialized, mounted, { boundTargets: mountedTargets });
    const preparedPlayback = createPolycssPlayback(materialized, packageDocument.bindings, mounted, {
      ...options,
      boundTargets: mountedTargets,
      publishAppearance: presentationController.publishAppearance,
      pagedState: owner.pagedState,
      assertPagedFrameReady: (frame) => owner.pagedState?.assertFrameReady(frame),
      compositorTiming: owner.compositorTiming,
    });
    owner.runtimeState = Object.freeze({
      bindings: packageDocument.bindings,
      mounted,
      materialized,
      preparedPlayback,
      boundTargets: mountedTargets,
    });
    owner.effects = interpreters.has("polycss-effects@0")
      ? createPolycssEffects(materialized, packageDocument.bindings, mounted, { boundTargets: mountedTargets })
      : null;
    owner.orbit = createPolycssOrbitInput(packageDocument.state, packageDocument.bindings, mounted, { boundTargets: mountedTargets });
    owner.presentation = presentationController;
    owner.input = interpreters.has("polycss-pointer-grab@0") ? createInteractionInput(host, mountSurface, owner.presentation, options) : null;
    const ResizeObserverClass = browserWindow.ResizeObserver;
    owner.resizeObserver = typeof ResizeObserverClass === "function"
      ? new ResizeObserverClass(() => {
          if (lifecycle.history.at(-1) !== "publish") return;
          try {
            applyResponsivePlaybackProfile(owner, mountSurface, options);
          } catch (error) {
            cleanupMount(owner);
            throw error;
          }
        })
      : null;
    const interactionBinding = packageDocument.bindings.channels.find((channel) => channel.interpreter === "polycss-pointer-grab@0");
    const interactionParameters = interactionBinding?.parameters as unknown as InteractionParameters | undefined;
    owner.interactionViewport = Object.freeze({
      viewportWidth: options.viewportWidth,
      viewportHeight: options.viewportHeight,
    });
    if (owner.mode === "interaction") owner.interaction = makeInteraction(owner).interpreter;
    lifecycle.advance("initialize");
    lifecycle.begin("publish");

    presentationController.resize();
    preparedPlayback.selectProfileTimeline(presentationController.profileId);
    preparedPlayback.publishInitial();
    owner.compositorTiming?.publishInitial(preparedPlayback.tick);
    owner.compositorTiming?.setActive(owner.mode === "animation" && owner.animateEnabled);
    owner.orbit?.publishInitial();
    preparedPlayback.applyViewportProfile(
      mountSurface.clientWidth || options.viewportWidth || presentationController.sourceWidth,
      mountSurface.clientHeight || options.viewportHeight || presentationController.sourceHeight,
      presentationController.profileId,
    );
    if (owner.mode === "interaction") {
      invariant(interactionParameters, "MISSING_POLYCSS_BINDING", "Executable pointer interaction parameters are required.");
      owner.pagedState?.assertFrameReady(interactionParameters.initialFrame);
      preparedPlayback.seek(interactionParameters.initialFrame);
      owner.input?.setEnabled(true);
    } else owner.input?.setEnabled(false);
    owner.effects?.publish(preparedPlayback.sourceFrame);
    if (owner.mode === "interaction") {
      invariant(owner.interaction, "MISSING_POLYCSS_BINDING", "Interaction mode did not initialize its interpreter.");
      owner.interaction.publishInitial();
    }
    throwIfAborted(options.signal);
    owner.hostMutated = true;
    if (interpreters.has("polycss-pointer-grab@0") && !host.hasAttribute("tabindex")) host.setAttribute("tabindex", "0");
    host.replaceChildren(mountSurface);
    owner.pagedState?.preloadAfter(preparedPlayback.sourceFrame);
    applyResponsivePlaybackProfile(owner, mountSurface, options);
    owner.resizeObserver?.observe(host);
    const playbackBinding = packageDocument.bindings.channels.find((channel) => channel.interpreter === "polycss-playback@0" || channel.interpreter === "polycss-paged-playback@0");
    if (owner.animateEnabled && playbackBinding) {
      const playbackParameters = playbackBinding.parameters as unknown as PlaybackParameters | undefined;
      invariant(playbackParameters, "MISSING_POLYCSS_BINDING", "Executable playback parameters are required.");
      invariant(
        typeof browserWindow.requestAnimationFrame === "function"
        && typeof browserWindow.cancelAnimationFrame === "function"
        && typeof browserWindow.setTimeout === "function"
        && typeof browserWindow.clearTimeout === "function",
        "MISSING_BROWSER_API",
        "Deadline timers and animation-frame support are required for animated mounting.",
      );
      const now = (): number => browserWindow.performance?.now?.() ?? globalThis.performance.now();
      let clockOrigin = now();
      let pageWait: Promise<void> | null = null;
      const cancelScheduled = (): void => {
        if (owner.timer !== null) browserWindow.clearTimeout(owner.timer);
        if (owner.request !== null) browserWindow.cancelAnimationFrame(owner.request);
        owner.timer = null;
        owner.request = null;
      };
      const schedule = (): void => {
        if (lifecycle.isDestroyed() || pageWait || owner.timer !== null || owner.request !== null) return;
        const delay = Math.max(0, clockOrigin + preparedPlayback.tickSpan(1) - now() - 1);
        owner.timer = browserWindow.setTimeout(() => {
          owner.timer = null;
          if (!lifecycle.isDestroyed()) owner.request = browserWindow.requestAnimationFrame(loop);
        }, delay);
      };
      const waitForPage = (frame: number, resume: () => void): void => {
        const pagedState = owner.pagedState;
        invariant(pagedState && !pagedState.isFrameReady(frame), "INVALID_PLAYBACK_PUBLICATION", "Paged playback wait requires a nonresident target frame.");
        const wait = pagedState.ensureFrame(frame);
        pageWait = wait;
        void wait.then(() => {
          if (pageWait !== wait || lifecycle.isDestroyed()) return;
          pageWait = null;
          try {
            resume();
          } catch {
            cleanupMount(owner);
            return;
          }
          if (!lifecycle.isDestroyed()) {
            clockOrigin = now();
            schedule();
          }
        }, (error: unknown) => {
          if (pageWait !== wait || lifecycle.isDestroyed()) return;
          pageWait = null;
          if ((error as { code?: string })?.code !== "OPERATION_ABORTED") cleanupMount(owner);
        });
      };
      const drainPlaybackCatchUp = (count: number): void => {
        const playback = mountedRuntime(owner).preparedPlayback;
        let ready = count;
        if (owner.pagedState) {
          ready = 0;
          while (ready < count && owner.pagedState.isFrameReady(playback.frameAfter(ready + 1))) ready += 1;
        }
        if (ready === 1) advancePlayback(owner);
        else if (ready > 1) advancePlaybackMany(owner, ready);
        const remaining = count - ready;
        if (remaining === 0) return;
        const frame = playback.frameAfter(1);
        const tick = playback.tick;
        const sourceFrame = playback.sourceFrame;
        waitForPage(frame, () => {
          if (owner.mode === "animation" && playback.tick === tick && playback.sourceFrame === sourceFrame) drainPlaybackCatchUp(remaining);
        });
      };
      const drainPlaybackCollapsed = (count: number): void => {
        const playback = mountedRuntime(owner).preparedPlayback;
        const frame = playback.frameAfter(count);
        if (owner.pagedState && !owner.pagedState.isFrameReady(frame)) {
          const tick = playback.tick;
          const sourceFrame = playback.sourceFrame;
          waitForPage(frame, () => {
            if (owner.mode === "animation" && playback.tick === tick && playback.sourceFrame === sourceFrame) drainPlaybackCollapsed(count);
          });
          return;
        }
        advancePlaybackCollapsed(owner, count);
      };
      const drainInteractionCatchUp = (count: number): void => {
        let remaining = count;
        while (remaining > 0) {
          const interaction = owner.interaction;
          invariant(interaction, "INVALID_EXPERIENCE_MODE", "Interaction mode is not active.");
          const frame = interaction.inspect().sourceFrame;
          if (owner.pagedState && !owner.pagedState.isFrameReady(frame)) {
            const ticks = interaction.ticks;
            waitForPage(frame, () => {
              if (owner.mode === "interaction" && owner.interaction === interaction && interaction.ticks === ticks) drainInteractionCatchUp(remaining);
            });
            return;
          }
          stepInteraction(owner);
          remaining -= 1;
        }
      };
      const loop = (timestamp: number): void => {
        owner.request = null;
        if (lifecycle.isDestroyed()) return;
        try {
          const playback = mountedRuntime(owner).preparedPlayback;
          const policy = playbackParameters.catchUpPolicy ?? "bounded";
          const maximum = policy === "elapsed" ? Number.MAX_SAFE_INTEGER - playback.tick : MAX_CATCH_UP_TICKS + 1;
          let due = playback.ticksWithin(Math.max(0, timestamp - clockOrigin + 0.5), maximum);
          let resetClock = false;
          if (policy === "single-step" && due > 0) {
            due = 1;
            resetClock = true;
          } else if (policy === "bounded" && due > MAX_CATCH_UP_TICKS) {
            due = 1;
            resetClock = true;
          }
          const elapsed = due > 0 ? playback.tickSpan(due) : 0;
          if (owner.mode === "interaction") {
            drainInteractionCatchUp(due);
            if (pageWait) return;
          } else if (due > 0) {
            if (policy === "elapsed") drainPlaybackCollapsed(due);
            else drainPlaybackCatchUp(due);
            if (pageWait) return;
          }
          if (due > 0) clockOrigin = resetClock ? timestamp : clockOrigin + elapsed;
        } catch (error) {
          cleanupMount(owner);
          throw error;
        }
        schedule();
      };
      owner.reschedule = () => {
        if (pageWait) {
          pageWait = null;
          owner.pagedState?.cancelPending();
        }
        cancelScheduled();
        clockOrigin = now();
        schedule();
      };
      schedule();
    }
    lifecycle.advance("publish");
    return createMountedRuntime(owner);
  } catch (error) {
    cleanupMount(owner);
    throw error;
  }
}
