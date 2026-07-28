import {
  POLY_MORPH_CATALOG_SCHEMA,
  POLY_MORPH_PACKAGE_SCHEMA,
  isPolyMorphId,
  isPolyMorphResourcePath,
  type PolyMorphProfile,
} from "../contracts/index.js";
import { PolyMorphPackageError } from "./error.js";
import type {
  PolyMorphCatalog,
  PolyMorphCatalogRow,
  PolyMorphPackageManifest,
  PolyMorphResourceDescriptor,
  PolyMorphResourceRole,
} from "./types.js";

const SHA256 = /^[a-f0-9]{64}$/;
const REVISION = /^\d+\.\d+\.\d+$/;
const MEDIA_TYPE = /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/;
const PROFILES = new Set<PolyMorphProfile>([
  "joint-skin",
  "morph-regions",
  "prepared-playback",
  "static-prepared",
]);
const ROLES = new Set<PolyMorphResourceRole>([
  "data",
  "image",
  "model",
]);

function fail(code: string, path: string, message: string): never {
  throw new PolyMorphPackageError(code, path, message);
}

function record(value: unknown, path: string, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("invalid-type", path, "expected an object");
  }
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    fail("invalid-keys", path, `expected exactly ${expected.join(", ")}`);
  }
  return value as Record<string, unknown>;
}

function array(value: unknown, path: string): readonly unknown[] {
  if (!Array.isArray(value)) fail("invalid-type", path, "expected an array");
  return value;
}

function text(value: unknown, path: string): string {
  if (typeof value !== "string" || value.length === 0) {
    fail("invalid-string", path, "expected a non-empty string");
  }
  return value;
}

function normalizedId(value: unknown, path: string): string {
  const result = text(value, path);
  if (!isPolyMorphId(result)) fail("invalid-id", path, "expected a normalized kebab-case id");
  return result;
}

function normalizedPath(value: unknown, path: string): string {
  const result = text(value, path);
  if (!isPolyMorphResourcePath(result)) {
    fail("invalid-path", path, "expected a normalized package-relative path");
  }
  return result;
}

function revision(value: unknown, path: string): string {
  const result = text(value, path);
  if (!REVISION.test(result)) fail("invalid-revision", path, "expected x.y.z");
  return result;
}

function profile(value: unknown, path: string): PolyMorphProfile {
  const result = text(value, path) as PolyMorphProfile;
  if (!PROFILES.has(result)) fail("invalid-profile", path, result);
  return result;
}

function sha256(value: unknown, path: string): string {
  const result = text(value, path);
  if (!SHA256.test(result)) fail("invalid-hash", path, "expected lowercase SHA-256");
  return result;
}

function byteCount(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    fail("invalid-bytes", path, "expected a non-negative safe integer");
  }
  return value;
}

function resource(value: unknown, path: string): PolyMorphResourceDescriptor {
  const input = record(value, path, ["bytes", "mediaType", "path", "role", "sha256"]);
  const role = text(input.role, `${path}.role`) as PolyMorphResourceRole;
  if (!ROLES.has(role)) fail("invalid-role", `${path}.role`, role);
  const mediaType = text(input.mediaType, `${path}.mediaType`).toLowerCase();
  if (!MEDIA_TYPE.test(mediaType) || mediaType !== input.mediaType) {
    fail("invalid-media-type", `${path}.mediaType`, "expected a normalized type/subtype");
  }
  if (role === "image" && !mediaType.startsWith("image/")) {
    fail(
      "invalid-media-type",
      `${path}.mediaType`,
      "image resources require an image media type",
    );
  }
  return {
    path: normalizedPath(input.path, `${path}.path`),
    role,
    mediaType,
    bytes: byteCount(input.bytes, `${path}.bytes`),
    sha256: sha256(input.sha256, `${path}.sha256`),
  };
}

function unique(values: readonly string[], path: string): void {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) fail("duplicate", path, value);
    seen.add(value);
  }
}

function assertCanonicalOrder(values: readonly string[], path: string): void {
  if (values.some((value, index) => index > 0 && value <= values[index - 1]!)) {
    fail("non-canonical-order", path, "entries must be unique and sorted");
  }
}

export function validatePolyMorphPackageManifest(value: unknown): PolyMorphPackageManifest {
  const input = record(value, "$", ["identity", "modelPath", "profile", "resources", "schema"]);
  if (input.schema !== POLY_MORPH_PACKAGE_SCHEMA) {
    fail("invalid-schema", "$.schema", `expected ${POLY_MORPH_PACKAGE_SCHEMA}`);
  }
  const identityInput = record(input.identity, "$.identity", ["id", "name", "revision"]);
  const identity = {
    id: normalizedId(identityInput.id, "$.identity.id"),
    name: text(identityInput.name, "$.identity.name"),
    revision: revision(identityInput.revision, "$.identity.revision"),
  };
  const resources = array(input.resources, "$.resources").map((entry, index) =>
    resource(entry, `$.resources[${index}]`));
  if (resources.length === 0) fail("missing-resource", "$.resources", "expected at least the model resource");
  const paths = resources.map((entry) => entry.path);
  unique(paths, "$.resources");
  assertCanonicalOrder(paths, "$.resources");
  const modelPath = normalizedPath(input.modelPath, "$.modelPath");
  const models = resources.filter((entry) => entry.role === "model");
  if (models.length !== 1 || models[0]!.path !== modelPath) {
    fail("invalid-model-resource", "$.resources", "expected exactly one model resource matching modelPath");
  }
  if (models[0]!.mediaType !== "application/json") {
    fail("invalid-model-resource", "$.resources", "model resource must be application/json");
  }
  return {
    schema: POLY_MORPH_PACKAGE_SCHEMA,
    identity,
    profile: profile(input.profile, "$.profile"),
    modelPath,
    resources,
  };
}

function catalogRow(value: unknown, path: string): PolyMorphCatalogRow {
  const input = record(value, path, [
    "id",
    "manifestPath",
    "manifestSha256",
    "name",
    "profile",
    "revision",
  ]);
  const manifestPath = normalizedPath(input.manifestPath, `${path}.manifestPath`);
  if (!manifestPath.endsWith("/manifest.json")) {
    fail("invalid-manifest-path", `${path}.manifestPath`, "expected a package manifest.json path");
  }
  return {
    id: normalizedId(input.id, `${path}.id`),
    name: text(input.name, `${path}.name`),
    revision: revision(input.revision, `${path}.revision`),
    profile: profile(input.profile, `${path}.profile`),
    manifestPath,
    manifestSha256: sha256(input.manifestSha256, `${path}.manifestSha256`),
  };
}

export function validatePolyMorphCatalog(value: unknown): PolyMorphCatalog {
  const input = record(value, "$", ["defaultId", "packages", "schema"]);
  if (input.schema !== POLY_MORPH_CATALOG_SCHEMA) {
    fail("invalid-schema", "$.schema", `expected ${POLY_MORPH_CATALOG_SCHEMA}`);
  }
  const packages = array(input.packages, "$.packages").map((entry, index) =>
    catalogRow(entry, `$.packages[${index}]`));
  if (packages.length === 0) fail("missing-package", "$.packages", "expected at least one package");
  const ids = packages.map((entry) => entry.id);
  unique(ids, "$.packages");
  assertCanonicalOrder(ids, "$.packages");
  unique(packages.map((entry) => entry.manifestPath), "$.packages[*].manifestPath");
  const defaultId = normalizedId(input.defaultId, "$.defaultId");
  if (!ids.includes(defaultId)) fail("unknown-default", "$.defaultId", defaultId);
  return {
    schema: POLY_MORPH_CATALOG_SCHEMA,
    defaultId,
    packages,
  };
}
