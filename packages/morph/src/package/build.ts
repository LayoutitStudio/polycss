import {
  POLY_MORPH_CATALOG_SCHEMA,
  POLY_MORPH_PACKAGE_SCHEMA,
  validatePolyMorphModel,
  type PolyMorphModel,
} from "../contracts/index.js";
import {
  encodePolyMorphCanonicalJson,
  hashPolyMorphBytes,
} from "./canonical.js";
import { PolyMorphPackageError } from "./error.js";
import type {
  PolyMorphBuiltCatalog,
  PolyMorphBuiltPackage,
  PolyMorphCatalogRow,
  PolyMorphPackageManifest,
  PolyMorphResourceDescriptor,
  PolyMorphResourceInput,
} from "./types.js";
import {
  validatePolyMorphCatalog,
  validatePolyMorphPackageManifest,
} from "./validation.js";

const MODEL_PATH = "model.json";

function modelImagePaths(model: PolyMorphModel): readonly string[] {
  return [...new Set(model.render.leaves.flatMap((leaf) => [
    ...(leaf.atlas ? [leaf.atlas.resourcePath] : []),
    ...(leaf.fallback ? [leaf.fallback.atlas.resourcePath] : []),
  ]))].sort();
}

export async function buildPolyMorphPackage(
  modelInput: unknown,
  resourceInputs: readonly PolyMorphResourceInput[] = [],
): Promise<PolyMorphBuiltPackage> {
  const model = validatePolyMorphModel(modelInput);
  const modelBytes = encodePolyMorphCanonicalJson(model);
  const files = new Map<string, Uint8Array>([[MODEL_PATH, modelBytes]]);
  const descriptors: PolyMorphResourceDescriptor[] = [
    {
      path: MODEL_PATH,
      role: "model",
      mediaType: "application/json",
      bytes: modelBytes.byteLength,
      sha256: await hashPolyMorphBytes(modelBytes),
    },
  ];
  for (const input of resourceInputs) {
    if (files.has(input.path)) {
      throw new PolyMorphPackageError("duplicate", input.path, "resource path is already present");
    }
    const bytes = Uint8Array.from(input.bytes);
    files.set(input.path, bytes);
    descriptors.push({
      path: input.path,
      role: input.role,
      mediaType: input.mediaType,
      bytes: bytes.byteLength,
      sha256: await hashPolyMorphBytes(bytes),
    });
  }
  for (const path of modelImagePaths(model)) {
    const descriptor = descriptors.find((entry) => entry.path === path);
    if (!descriptor) {
      throw new PolyMorphPackageError(
        "missing-resource",
        path,
        "model image is not included in the package",
      );
    }
    if (descriptor.role !== "image") {
      throw new PolyMorphPackageError(
        "invalid-role",
        path,
        "model image resource must use the image role",
      );
    }
  }
  descriptors.sort((left, right) =>
    left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
  const manifest: PolyMorphPackageManifest = validatePolyMorphPackageManifest({
    schema: POLY_MORPH_PACKAGE_SCHEMA,
    identity: model.identity,
    profile: model.profile,
    modelPath: MODEL_PATH,
    resources: descriptors,
  });
  const totalBytes = descriptors.reduce((sum, descriptor) => sum + descriptor.bytes, 0);
  if (descriptors.length > model.budgets.maxResources) {
    throw new PolyMorphPackageError(
      "budget-exceeded",
      "$.budgets.maxResources",
      `${descriptors.length} resources exceed ${model.budgets.maxResources}`,
    );
  }
  if (totalBytes > model.budgets.maxBytes) {
    throw new PolyMorphPackageError(
      "budget-exceeded",
      "$.budgets.maxBytes",
      `${totalBytes} bytes exceed ${model.budgets.maxBytes}`,
    );
  }
  const manifestBytes = encodePolyMorphCanonicalJson(manifest);
  return {
    manifest,
    manifestBytes,
    manifestSha256: await hashPolyMorphBytes(manifestBytes),
    files,
  };
}

export async function buildPolyMorphCatalog(
  defaultId: string,
  packages: readonly {
    readonly manifest: PolyMorphPackageManifest;
    readonly manifestPath: string;
    readonly manifestSha256: string;
  }[],
): Promise<PolyMorphBuiltCatalog> {
  const rows: PolyMorphCatalogRow[] = packages.map((entry) => ({
    id: entry.manifest.identity.id,
    name: entry.manifest.identity.name,
    revision: entry.manifest.identity.revision,
    profile: entry.manifest.profile,
    manifestPath: entry.manifestPath,
    manifestSha256: entry.manifestSha256,
  }));
  rows.sort((left, right) =>
    left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
  const catalog = validatePolyMorphCatalog({
    schema: POLY_MORPH_CATALOG_SCHEMA,
    defaultId,
    packages: rows,
  });
  const bytes = encodePolyMorphCanonicalJson(catalog);
  return {
    catalog,
    bytes,
    sha256: await hashPolyMorphBytes(bytes),
  };
}

export function assertPolyMorphPackageModelBinding(
  manifest: PolyMorphPackageManifest,
  model: PolyMorphModel,
): void {
  if (
    model.identity.id !== manifest.identity.id
    || model.identity.name !== manifest.identity.name
    || model.identity.revision !== manifest.identity.revision
    || model.profile !== manifest.profile
  ) {
    throw new PolyMorphPackageError(
      "profile-mismatch",
      "$.model",
      "model identity or profile does not match its manifest",
    );
  }
}
