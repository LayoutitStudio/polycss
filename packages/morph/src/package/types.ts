import type {
  POLY_MORPH_CATALOG_SCHEMA,
  POLY_MORPH_PACKAGE_SCHEMA,
  PolyMorphModel,
  PolyMorphModelIdentity,
  PolyMorphProfile,
} from "../contracts/index.js";

export type PolyMorphResourceRole =
  | "data"
  | "image"
  | "model"
  | "stylesheet";

export interface PolyMorphResourceDescriptor {
  readonly path: string;
  readonly role: PolyMorphResourceRole;
  readonly mediaType: string;
  readonly bytes: number;
  readonly sha256: string;
}

export interface PolyMorphPackageManifest {
  readonly schema: typeof POLY_MORPH_PACKAGE_SCHEMA;
  readonly identity: PolyMorphModelIdentity;
  readonly profile: PolyMorphProfile;
  readonly modelPath: string;
  readonly resources: readonly PolyMorphResourceDescriptor[];
}

export interface PolyMorphCatalogRow {
  readonly id: string;
  readonly name: string;
  readonly revision: string;
  readonly profile: PolyMorphProfile;
  readonly manifestPath: string;
  readonly manifestSha256: string;
}

export interface PolyMorphCatalog {
  readonly schema: typeof POLY_MORPH_CATALOG_SCHEMA;
  readonly defaultId: string;
  readonly packages: readonly PolyMorphCatalogRow[];
}

export interface PolyMorphResourceInput {
  readonly path: string;
  readonly role: Exclude<PolyMorphResourceRole, "model">;
  readonly mediaType: string;
  readonly bytes: Uint8Array;
}

export interface PolyMorphBuiltPackage {
  readonly manifest: PolyMorphPackageManifest;
  readonly manifestBytes: Uint8Array;
  readonly manifestSha256: string;
  readonly files: ReadonlyMap<string, Uint8Array>;
}

export interface PolyMorphBuiltCatalog {
  readonly catalog: PolyMorphCatalog;
  readonly bytes: Uint8Array;
  readonly sha256: string;
}

export interface PolyMorphLoadedResource {
  readonly descriptor: PolyMorphResourceDescriptor;
  readonly bytes: Uint8Array;
}

export interface PolyMorphLoadedPackage {
  readonly catalog: PolyMorphCatalog;
  readonly catalogSha256: string;
  readonly catalogRow: PolyMorphCatalogRow;
  readonly manifest: PolyMorphPackageManifest;
  readonly manifestSha256: string;
  readonly model: PolyMorphModel;
  readonly resources: ReadonlyMap<string, PolyMorphLoadedResource>;
}
