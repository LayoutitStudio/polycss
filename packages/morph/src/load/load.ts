import { validatePolyMorphModel } from "../contracts/index.js";
import {
  assertPolyMorphPackageModelBinding,
  decodePolyMorphJson,
  hashPolyMorphBytes,
  PolyMorphPackageError,
  validatePolyMorphCatalog,
  validatePolyMorphPackageManifest,
  type PolyMorphCatalog,
  type PolyMorphLoadedPackage,
  type PolyMorphLoadedResource,
  type PolyMorphResourceDescriptor,
} from "../package/index.js";

const DEFAULT_MAX_RESOURCE_BYTES = 64 * 1024 * 1024;
const DEFAULT_MAX_RESOURCES = 1024;
const DEFAULT_MAX_TOTAL_BYTES = 128 * 1024 * 1024;
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;

export interface PolyMorphLoadOptions {
  readonly fetchImpl?: typeof fetch;
  readonly modelId?: string;
  readonly maxResourceBytes?: number;
  readonly maxResources?: number;
  readonly maxTotalBytes?: number;
  readonly requestTimeoutMs?: number;
  readonly signal?: AbortSignal;
}

function boundedInteger(value: number | undefined, fallback: number, path: string): number {
  const result = value ?? fallback;
  if (!Number.isSafeInteger(result) || result <= 0) {
    throw new PolyMorphPackageError("invalid-limit", path, "expected a positive safe integer");
  }
  return result;
}

function resolveBaseUrl(baseUrl: string): URL {
  if (
    typeof baseUrl !== "string"
    || baseUrl.length === 0
    || baseUrl.includes("\\")
    || baseUrl.includes("#")
    || baseUrl.includes("?")
  ) {
    throw new PolyMorphPackageError("invalid-base-url", "$.baseUrl", "expected a clean HTTP(S) base URL");
  }
  let url: URL;
  try {
    url = new URL(baseUrl, globalThis.location?.href ?? "https://polycss.invalid/");
  } catch {
    throw new PolyMorphPackageError("invalid-base-url", "$.baseUrl", "expected a valid URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new PolyMorphPackageError("invalid-base-url", "$.baseUrl", "expected HTTP or HTTPS");
  }
  if (!url.pathname.endsWith("/")) url.pathname += "/";
  return url;
}

async function readBounded(
  response: Response,
  path: string,
  maximum: number,
): Promise<Uint8Array> {
  const header = response.headers.get("content-length");
  if (header !== null) {
    const declared = Number(header);
    if (!Number.isSafeInteger(declared) || declared < 0 || declared > maximum) {
      throw new PolyMorphPackageError("resource-too-large", path, `declared bytes exceed ${maximum}`);
    }
  }
  if (response.body?.getReader) {
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let length = 0;
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      length += result.value.byteLength;
      if (length > maximum) {
        await reader.cancel();
        throw new PolyMorphPackageError("resource-too-large", path, `bytes exceed ${maximum}`);
      }
      chunks.push(result.value);
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return bytes;
  }
  if (header === null) {
    throw new PolyMorphPackageError(
      "resource-too-large",
      path,
      "content-length is required without a readable body",
    );
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > maximum) {
    throw new PolyMorphPackageError("resource-too-large", path, `bytes exceed ${maximum}`);
  }
  return bytes;
}

async function requestBytes(
  fetchImpl: typeof fetch,
  url: URL,
  maximum: number,
  signal: AbortSignal | undefined,
  timeoutMs: number,
): Promise<Uint8Array> {
  const requestSignal = signal ?? AbortSignal.timeout(timeoutMs);
  let response: Response;
  try {
    response = await fetchImpl(url, { cache: "no-store", signal: requestSignal });
  } catch (cause) {
    if (requestSignal.aborted) throw cause;
    throw new PolyMorphPackageError(
      "request-failed",
      url.pathname,
      "request failed",
      { cause },
    );
  }
  if (!response.ok) {
    throw new PolyMorphPackageError("request-failed", url.pathname, `HTTP ${response.status}`);
  }
  return readBounded(response, url.pathname, maximum);
}

async function assertHash(bytes: Uint8Array, expected: string, path: string): Promise<void> {
  const actual = await hashPolyMorphBytes(bytes);
  if (actual !== expected) {
    throw new PolyMorphPackageError("stale-hash", path, `expected ${expected}, received ${actual}`);
  }
}

function packageRoot(baseUrl: URL, manifestPath: string): URL {
  const slash = manifestPath.lastIndexOf("/");
  return resolvePackageUrl(baseUrl, manifestPath.slice(0, slash + 1));
}

function resolvePackageUrl(baseUrl: URL, path: string): URL {
  const resolved = new URL(path, baseUrl);
  if (
    resolved.origin !== baseUrl.origin
    || !resolved.href.startsWith(baseUrl.href)
  ) {
    throw new PolyMorphPackageError(
      "invalid-path",
      path,
      "package path escapes its base URL",
    );
  }
  return resolved;
}

export async function loadPolyMorphCatalog(
  baseUrl: string,
  options: Omit<
    PolyMorphLoadOptions,
    "maxResources" | "maxTotalBytes" | "modelId"
  > = {},
): Promise<{ readonly catalog: PolyMorphCatalog; readonly bytes: Uint8Array; readonly sha256: string }> {
  const base = resolveBaseUrl(baseUrl);
  const maximum = boundedInteger(
    options.maxResourceBytes,
    DEFAULT_MAX_RESOURCE_BYTES,
    "$.maxResourceBytes",
  );
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== "function") {
    throw new PolyMorphPackageError("missing-fetch", "$.fetchImpl", "a fetch implementation is required");
  }
  const timeoutMs = boundedInteger(
    options.requestTimeoutMs,
    DEFAULT_REQUEST_TIMEOUT_MS,
    "$.requestTimeoutMs",
  );
  const bytes = await requestBytes(
    fetchImpl,
    resolvePackageUrl(base, "catalog.json"),
    maximum,
    options.signal,
    timeoutMs,
  );
  const catalog = validatePolyMorphCatalog(decodePolyMorphJson(bytes, "$.catalog"));
  return { catalog, bytes, sha256: await hashPolyMorphBytes(bytes) };
}

export async function loadPolyMorphPackage(
  baseUrl: string,
  options: PolyMorphLoadOptions = {},
): Promise<PolyMorphLoadedPackage> {
  const base = resolveBaseUrl(baseUrl);
  const maxResourceBytes = boundedInteger(
    options.maxResourceBytes,
    DEFAULT_MAX_RESOURCE_BYTES,
    "$.maxResourceBytes",
  );
  const maxResources = boundedInteger(
    options.maxResources,
    DEFAULT_MAX_RESOURCES,
    "$.maxResources",
  );
  const maxTotalBytes = boundedInteger(
    options.maxTotalBytes,
    DEFAULT_MAX_TOTAL_BYTES,
    "$.maxTotalBytes",
  );
  const requestTimeoutMs = boundedInteger(
    options.requestTimeoutMs,
    DEFAULT_REQUEST_TIMEOUT_MS,
    "$.requestTimeoutMs",
  );
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== "function") {
    throw new PolyMorphPackageError("missing-fetch", "$.fetchImpl", "a fetch implementation is required");
  }
  const loadedCatalog = await loadPolyMorphCatalog(base.href, {
    fetchImpl,
    maxResourceBytes,
    requestTimeoutMs,
    signal: options.signal,
  });
  const selected = options.modelId ?? loadedCatalog.catalog.defaultId;
  const row = loadedCatalog.catalog.packages.find((entry) => entry.id === selected);
  if (!row) throw new PolyMorphPackageError("unknown-package", "$.modelId", selected);
  const manifestBytes = await requestBytes(
    fetchImpl,
    resolvePackageUrl(base, row.manifestPath),
    maxResourceBytes,
    options.signal,
    requestTimeoutMs,
  );
  await assertHash(manifestBytes, row.manifestSha256, row.manifestPath);
  const manifest = validatePolyMorphPackageManifest(
    decodePolyMorphJson(manifestBytes, "$.manifest"),
  );
  if (
    manifest.identity.id !== row.id
    || manifest.identity.name !== row.name
    || manifest.identity.revision !== row.revision
    || manifest.profile !== row.profile
  ) {
    throw new PolyMorphPackageError(
      "profile-mismatch",
      "$.manifest",
      "catalog row does not match its manifest",
    );
  }
  const root = packageRoot(base, row.manifestPath);
  if (manifest.resources.length > maxResources) {
    throw new PolyMorphPackageError(
      "package-too-large",
      "$.manifest.resources",
      `${manifest.resources.length} resources exceed ${maxResources}`,
    );
  }
  let totalBytes = 0;
  for (const descriptor of manifest.resources) {
    if (descriptor.bytes > maxResourceBytes) {
      throw new PolyMorphPackageError(
        "resource-too-large",
        descriptor.path,
        `declared bytes exceed ${maxResourceBytes}`,
      );
    }
    totalBytes += descriptor.bytes;
    if (totalBytes > maxTotalBytes) {
      throw new PolyMorphPackageError(
        "package-too-large",
        descriptor.path,
        `declared package bytes exceed ${maxTotalBytes}`,
      );
    }
  }
  const resources = new Map<string, PolyMorphLoadedResource>();
  const loadResource = async (
    descriptor: PolyMorphResourceDescriptor,
  ): Promise<PolyMorphLoadedResource> => {
    const bytes = await requestBytes(
      fetchImpl,
      resolvePackageUrl(root, descriptor.path),
      Math.min(maxResourceBytes, descriptor.bytes),
      options.signal,
      requestTimeoutMs,
    );
    if (bytes.byteLength !== descriptor.bytes) {
      throw new PolyMorphPackageError(
        "stale-size",
        descriptor.path,
        `expected ${descriptor.bytes}, received ${bytes.byteLength}`,
      );
    }
    await assertHash(bytes, descriptor.sha256, descriptor.path);
    return { descriptor, bytes };
  };
  const modelDescriptor = manifest.resources.find(
    (descriptor) => descriptor.path === manifest.modelPath,
  )!;
  const modelResource = await loadResource(modelDescriptor);
  resources.set(modelDescriptor.path, modelResource);
  const model = validatePolyMorphModel(
    decodePolyMorphJson(modelResource.bytes, "$.model"),
  );
  assertPolyMorphPackageModelBinding(manifest, model);
  if (manifest.resources.length > model.budgets.maxResources) {
    throw new PolyMorphPackageError(
      "budget-exceeded",
      "$.budgets.maxResources",
      `${manifest.resources.length} resources exceed ${model.budgets.maxResources}`,
    );
  }
  if (totalBytes > model.budgets.maxBytes) {
    throw new PolyMorphPackageError(
      "budget-exceeded",
      "$.budgets.maxBytes",
      `${totalBytes} bytes exceed ${model.budgets.maxBytes}`,
    );
  }
  for (const descriptor of manifest.resources) {
    if (descriptor === modelDescriptor) continue;
    resources.set(descriptor.path, await loadResource(descriptor));
  }
  const imagePaths = new Set(model.render.leaves.flatMap((leaf) => [
    ...(leaf.atlas ? [leaf.atlas.resourcePath] : []),
    ...(leaf.fallback ? [leaf.fallback.atlas.resourcePath] : []),
  ]));
  for (const path of imagePaths) {
    const resource = resources.get(path);
    if (!resource) {
      throw new PolyMorphPackageError(
        "missing-resource",
        path,
        "model image is not declared by the package",
      );
    }
    if (resource.descriptor.role !== "image") {
      throw new PolyMorphPackageError(
        "invalid-role",
        path,
        "model image resource must use the image role",
      );
    }
  }
  return {
    catalog: loadedCatalog.catalog,
    catalogSha256: loadedCatalog.sha256,
    catalogRow: row,
    manifest,
    manifestSha256: row.manifestSha256,
    model,
    resources,
  };
}
