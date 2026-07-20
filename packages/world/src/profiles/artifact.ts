export type PolyWorldProfileArtifactProfile = "bsp-pvs" | "area-portals" | "portal-flow" | "chunk-traversal";

export type PolyWorldProfileArtifactKind =
  | "compiled-bsp-pvs"
  | "authored-area-portals"
  | "authored-area-portal-flow"
  | "chunk-working-set";

export type PolyWorldProfileArtifactSourceKind =
  | "compiled"
  | "authored"
  | "authored-runtime-selection";

export interface PolyWorldProfileArtifactDiagnostic {
  code: string;
  message: string;
  id?: string;
  field?: string;
  kind?: string;
}

export interface PolyWorldProfileArtifactProof {
  schemaVersion: 1;
  profile: PolyWorldProfileArtifactProfile;
  artifactKind: PolyWorldProfileArtifactKind;
  sourceKind: PolyWorldProfileArtifactSourceKind;
  producedBy: string;
  guarantees: readonly string[];
  knownWeaknesses: readonly string[];
  counts: Readonly<Record<string, number>>;
  coverage: Readonly<Record<string, number>>;
  diagnostics: readonly PolyWorldProfileArtifactDiagnostic[];
}

export interface PolyWorldProfileArtifactProofInput {
  profile: PolyWorldProfileArtifactProfile;
  artifactKind: PolyWorldProfileArtifactKind;
  sourceKind: PolyWorldProfileArtifactSourceKind;
  producedBy: string;
  guarantees?: readonly string[];
  knownWeaknesses?: readonly string[];
  counts?: Readonly<Record<string, number | undefined>>;
  coverage?: Readonly<Record<string, number | undefined>>;
  diagnostics?: readonly PolyWorldProfileArtifactDiagnostic[];
}

export interface PolyWorldProfileArtifactProofAudit {
  schemaVersion: 1;
  profile: PolyWorldProfileArtifactProfile;
  valid: boolean;
  diagnostics: readonly PolyWorldProfileArtifactDiagnostic[];
}

export interface PolyWorldProfileArtifactBundleRef {
  id: string;
  profile: PolyWorldProfileArtifactProfile;
  artifactKind?: PolyWorldProfileArtifactKind;
  sourceKind?: PolyWorldProfileArtifactSourceKind;
  producedBy?: string;
  elementIds?: readonly string[];
  spatialElementIds?: readonly string[];
  resourceIds?: readonly string[];
}

export interface PolyWorldProfileArtifactBundleEntryInput {
  id?: string;
  ref: PolyWorldProfileArtifactBundleRef;
  proof: PolyWorldProfileArtifactProof;
}

export interface PolyWorldProfileArtifactBundleEntry {
  schemaVersion: 1;
  id: string;
  ref: PolyWorldProfileArtifactBundleRef;
  proof: PolyWorldProfileArtifactProof;
  audit: PolyWorldProfileArtifactProofAudit;
  valid: boolean;
  diagnostics: readonly PolyWorldProfileArtifactDiagnostic[];
}

export interface PolyWorldProfileArtifactBundleInput {
  entries: readonly PolyWorldProfileArtifactBundleEntryInput[];
}

export interface PolyWorldProfileArtifactBundle {
  schemaVersion: 1;
  entries: readonly PolyWorldProfileArtifactBundleEntry[];
  entriesById: ReadonlyMap<string, PolyWorldProfileArtifactBundleEntry>;
  entryIdsByProfile: ReadonlyMap<PolyWorldProfileArtifactProfile, readonly string[]>;
  valid: boolean;
  diagnostics: readonly PolyWorldProfileArtifactDiagnostic[];
}

interface PolyWorldProfileArtifactRule {
  artifactKind: PolyWorldProfileArtifactKind;
  sourceKinds: readonly PolyWorldProfileArtifactSourceKind[];
  fallbackSourceKind: PolyWorldProfileArtifactSourceKind;
  forbiddenGuarantees: readonly string[];
}

const bspPvsGuarantees = [
  "tree-root-leaf-reference-audit",
  "portal-endpoint-audit",
  "portal-leaf-adjacency-audit",
  "pvs-bitset-width-audit",
  "pvs-direct-adjacency-audit",
  "pvs-metadata-decode-audit",
  "compiled-bsp-pvs",
  "baked-pvs-bitsets",
  "portal-flood-broad-visibility",
  "portal-clipped-baked-pvs",
  "view-clipped-pvs-traversal",
] as const;

const portalFlowOnlyGuarantees = [
  "camera-frustum-portal-clipping",
  "trace-status-counts",
] as const;

const artifactRules: Readonly<Record<PolyWorldProfileArtifactProfile, PolyWorldProfileArtifactRule>> = {
  "bsp-pvs": {
    artifactKind: "compiled-bsp-pvs",
    sourceKinds: ["compiled", "authored"],
    fallbackSourceKind: "authored",
    forbiddenGuarantees: [],
  },
  "area-portals": {
    artifactKind: "authored-area-portals",
    sourceKinds: ["authored-runtime-selection"],
    fallbackSourceKind: "authored-runtime-selection",
    forbiddenGuarantees: [...bspPvsGuarantees, ...portalFlowOnlyGuarantees],
  },
  "portal-flow": {
    artifactKind: "authored-area-portal-flow",
    sourceKinds: ["authored-runtime-selection"],
    fallbackSourceKind: "authored-runtime-selection",
    forbiddenGuarantees: bspPvsGuarantees,
  },
  "chunk-traversal": {
    artifactKind: "chunk-working-set",
    sourceKinds: ["authored-runtime-selection"],
    fallbackSourceKind: "authored-runtime-selection",
    forbiddenGuarantees: bspPvsGuarantees,
  },
};

export function createPolyWorldProfileArtifactProof(
  input: PolyWorldProfileArtifactProofInput,
): PolyWorldProfileArtifactProof {
  const rule = artifactRules[input.profile];
  const artifactKind = input.artifactKind === rule.artifactKind
    ? input.artifactKind
    : rule.artifactKind;
  const sourceKind = rule.sourceKinds.includes(input.sourceKind)
    ? input.sourceKind
    : rule.fallbackSourceKind;
  const guaranteeResult = resolveArtifactGuarantees(input.guarantees ?? [], rule.forbiddenGuarantees);
  const diagnostics = [
    ...(input.artifactKind === artifactKind ? [] : [{
      code: "poly-world-profile-artifact-kind-mismatch",
      message: `PolyWorld profile artifact "${input.profile}" cannot use artifact kind "${input.artifactKind}".`,
      field: "artifactKind",
      kind: input.artifactKind,
    }]),
    ...(input.sourceKind === sourceKind ? [] : [{
      code: "poly-world-profile-artifact-source-kind-mismatch",
      message: `PolyWorld profile artifact "${input.profile}" cannot use source kind "${input.sourceKind}".`,
      field: "sourceKind",
      kind: input.sourceKind,
    }]),
    ...guaranteeResult.diagnostics,
    ...(input.diagnostics?.map((diagnostic) => ({ ...diagnostic })) ?? []),
  ];
  return {
    schemaVersion: 1,
    profile: input.profile,
    artifactKind,
    sourceKind,
    producedBy: input.producedBy,
    guarantees: guaranteeResult.guarantees,
    knownWeaknesses: unique(input.knownWeaknesses ?? []),
    counts: finiteRecord(input.counts ?? {}),
    coverage: finiteRecord(input.coverage ?? {}),
    diagnostics,
  };
}

export function auditPolyWorldProfileArtifactProof(
  proof: PolyWorldProfileArtifactProof,
): PolyWorldProfileArtifactProofAudit {
  const diagnostics: PolyWorldProfileArtifactDiagnostic[] = [];
  const rule = artifactRules[proof.profile];

  if (proof.schemaVersion !== 1) {
    diagnostics.push({
      code: "poly-world-profile-artifact-invalid-schema-version",
      message: `PolyWorld profile artifact "${proof.profile}" has invalid schemaVersion "${String(proof.schemaVersion)}".`,
      field: "schemaVersion",
      kind: String(proof.schemaVersion),
    });
  }

  if (rule === undefined) {
    diagnostics.push({
      code: "poly-world-profile-artifact-invalid-profile",
      message: `PolyWorld profile artifact has invalid profile "${String(proof.profile)}".`,
      field: "profile",
      kind: String(proof.profile),
    });
  } else {
    if (proof.artifactKind !== rule.artifactKind) {
      diagnostics.push({
        code: "poly-world-profile-artifact-kind-mismatch",
        message: `PolyWorld profile artifact "${proof.profile}" cannot use artifact kind "${proof.artifactKind}".`,
        field: "artifactKind",
        kind: proof.artifactKind,
      });
    }
    if (!rule.sourceKinds.includes(proof.sourceKind)) {
      diagnostics.push({
        code: "poly-world-profile-artifact-source-kind-mismatch",
        message: `PolyWorld profile artifact "${proof.profile}" cannot use source kind "${proof.sourceKind}".`,
        field: "sourceKind",
        kind: proof.sourceKind,
      });
    }
    for (const guarantee of proof.guarantees) {
      if (!rule.forbiddenGuarantees.includes(guarantee)) continue;
      diagnostics.push({
        code: "poly-world-profile-artifact-forbidden-guarantee",
        message: `PolyWorld profile artifact cannot claim guarantee "${guarantee}".`,
        id: guarantee,
        field: "guarantees",
      });
    }
  }

  if (typeof proof.producedBy !== "string" || proof.producedBy.length === 0) {
    diagnostics.push({
      code: "poly-world-profile-artifact-empty-produced-by",
      message: `PolyWorld profile artifact "${proof.profile}" requires a non-empty producedBy value.`,
      field: "producedBy",
    });
  }

  if (
    proof.profile === "bsp-pvs" &&
    proof.knownWeaknesses.includes("bsp-certification-failed") &&
    proof.guarantees.length > 0
  ) {
    diagnostics.push({
      code: "poly-world-profile-artifact-uncertified-bsp-guarantees",
      message: "PolyWorld BSP/PVS artifact cannot claim guarantees when BSP certification failed.",
      field: "guarantees",
      kind: "bsp-pvs",
    });
  }

  validateFiniteRecord(proof.profile, "counts", proof.counts, diagnostics);
  validateFiniteRecord(proof.profile, "coverage", proof.coverage, diagnostics);

  return {
    schemaVersion: 1,
    profile: proof.profile,
    valid: diagnostics.length === 0,
    diagnostics,
  };
}

export function createPolyWorldProfileArtifactBundle(
  input: PolyWorldProfileArtifactBundleInput,
): PolyWorldProfileArtifactBundle {
  const entries: PolyWorldProfileArtifactBundleEntry[] = [];
  const entriesById = new Map<string, PolyWorldProfileArtifactBundleEntry>();
  const entryIdsByProfile = new Map<PolyWorldProfileArtifactProfile, string[]>();
  const diagnostics: PolyWorldProfileArtifactDiagnostic[] = [];

  for (const entryInput of input.entries) {
    const entry = createPolyWorldProfileArtifactBundleEntry(entryInput);
    entries.push(entry);
    if (entriesById.has(entry.id)) {
      diagnostics.push({
        code: "poly-world-profile-artifact-bundle-duplicate-id",
        message: `Duplicate PolyWorld profile artifact bundle id "${entry.id}".`,
        id: entry.id,
        field: "entries.id",
      });
    } else if (entry.id.length > 0) {
      entriesById.set(entry.id, entry);
    }
    pushMap(entryIdsByProfile, entry.proof.profile, entry.id);
    diagnostics.push(...entry.diagnostics);
  }

  return {
    schemaVersion: 1,
    entries,
    entriesById,
    entryIdsByProfile,
    valid: diagnostics.length === 0 && entries.every((entry) => entry.valid),
    diagnostics,
  };
}

export function createPolyWorldProfileArtifactBundleEntry(
  input: PolyWorldProfileArtifactBundleEntryInput,
): PolyWorldProfileArtifactBundleEntry {
  const id = input.id ?? input.ref.id;
  const audit = auditPolyWorldProfileArtifactProof(input.proof);
  const diagnostics = [
    ...validateProfileArtifactBundleRef(id, input),
    ...validateProfileArtifactBundleProofRef(input.ref, input.proof),
    ...audit.diagnostics,
  ];
  return {
    schemaVersion: 1,
    id,
    ref: cloneProfileArtifactBundleRef(input.ref),
    proof: cloneProfileArtifactProof(input.proof),
    audit,
    valid: diagnostics.length === 0,
    diagnostics,
  };
}

function resolveArtifactGuarantees(
  guarantees: readonly string[],
  forbiddenGuarantees: readonly string[],
): {
  guarantees: readonly string[];
  diagnostics: readonly PolyWorldProfileArtifactDiagnostic[];
} {
  const forbidden = new Set(forbiddenGuarantees);
  const accepted: string[] = [];
  const diagnostics: PolyWorldProfileArtifactDiagnostic[] = [];
  for (const guarantee of unique(guarantees)) {
    if (!forbidden.has(guarantee)) {
      accepted.push(guarantee);
      continue;
    }
    diagnostics.push({
      code: "poly-world-profile-artifact-forbidden-guarantee",
      message: `PolyWorld profile artifact cannot claim guarantee "${guarantee}".`,
      id: guarantee,
      field: "guarantees",
    });
  }
  return { guarantees: accepted, diagnostics };
}

function validateProfileArtifactBundleRef(
  id: string,
  input: PolyWorldProfileArtifactBundleEntryInput,
): PolyWorldProfileArtifactDiagnostic[] {
  const diagnostics: PolyWorldProfileArtifactDiagnostic[] = [];
  if (typeof id !== "string" || id.length === 0) {
    diagnostics.push({
      code: "poly-world-profile-artifact-bundle-empty-id",
      message: "PolyWorld profile artifact bundle entries require a non-empty id.",
      field: "entries.id",
    });
  }
  if (input.id !== undefined && input.ref.id !== input.id) {
    diagnostics.push({
      code: "poly-world-profile-artifact-bundle-id-mismatch",
      message: `PolyWorld profile artifact bundle id "${input.id}" does not match ref id "${input.ref.id}".`,
      id: input.id,
      field: "entries.ref.id",
    });
  }
  return diagnostics;
}

function validateProfileArtifactBundleProofRef(
  ref: PolyWorldProfileArtifactBundleRef,
  proof: PolyWorldProfileArtifactProof,
): PolyWorldProfileArtifactDiagnostic[] {
  const diagnostics: PolyWorldProfileArtifactDiagnostic[] = [];
  if (ref.profile !== proof.profile) {
    diagnostics.push({
      code: "poly-world-profile-artifact-bundle-profile-mismatch",
      message: `PolyWorld profile artifact ref "${ref.id}" uses profile "${ref.profile}" but proof uses "${proof.profile}".`,
      id: ref.id,
      field: "entries.proof.profile",
      kind: proof.profile,
    });
  }
  if (ref.artifactKind !== undefined && ref.artifactKind !== proof.artifactKind) {
    diagnostics.push({
      code: "poly-world-profile-artifact-bundle-kind-mismatch",
      message: `PolyWorld profile artifact ref "${ref.id}" uses kind "${ref.artifactKind}" but proof uses "${proof.artifactKind}".`,
      id: ref.id,
      field: "entries.proof.artifactKind",
      kind: proof.artifactKind,
    });
  }
  if (ref.sourceKind !== undefined && ref.sourceKind !== proof.sourceKind) {
    diagnostics.push({
      code: "poly-world-profile-artifact-bundle-source-kind-mismatch",
      message: `PolyWorld profile artifact ref "${ref.id}" uses source kind "${ref.sourceKind}" but proof uses "${proof.sourceKind}".`,
      id: ref.id,
      field: "entries.proof.sourceKind",
      kind: proof.sourceKind,
    });
  }
  if (ref.producedBy !== undefined && ref.producedBy !== proof.producedBy) {
    diagnostics.push({
      code: "poly-world-profile-artifact-bundle-producer-mismatch",
      message: `PolyWorld profile artifact ref "${ref.id}" was produced by "${ref.producedBy}" but proof was produced by "${proof.producedBy}".`,
      id: ref.id,
      field: "entries.proof.producedBy",
      kind: proof.producedBy,
    });
  }
  return diagnostics;
}

function cloneProfileArtifactBundleRef(
  ref: PolyWorldProfileArtifactBundleRef,
): PolyWorldProfileArtifactBundleRef {
  return {
    id: ref.id,
    profile: ref.profile,
    ...(ref.artifactKind === undefined ? {} : { artifactKind: ref.artifactKind }),
    ...(ref.sourceKind === undefined ? {} : { sourceKind: ref.sourceKind }),
    ...(ref.producedBy === undefined ? {} : { producedBy: ref.producedBy }),
    ...(ref.elementIds === undefined ? {} : { elementIds: [...ref.elementIds] }),
    ...(ref.spatialElementIds === undefined ? {} : { spatialElementIds: [...ref.spatialElementIds] }),
    ...(ref.resourceIds === undefined ? {} : { resourceIds: [...ref.resourceIds] }),
  };
}

function cloneProfileArtifactProof(
  proof: PolyWorldProfileArtifactProof,
): PolyWorldProfileArtifactProof {
  return {
    schemaVersion: proof.schemaVersion,
    profile: proof.profile,
    artifactKind: proof.artifactKind,
    sourceKind: proof.sourceKind,
    producedBy: proof.producedBy,
    guarantees: [...proof.guarantees],
    knownWeaknesses: [...proof.knownWeaknesses],
    counts: { ...proof.counts },
    coverage: { ...proof.coverage },
    diagnostics: proof.diagnostics.map((diagnostic) => ({ ...diagnostic })),
  };
}

function pushMap<TKey extends string>(
  map: Map<TKey, string[]>,
  key: TKey,
  value: string,
): void {
  const existing = map.get(key);
  if (existing === undefined) map.set(key, [value]);
  else existing.push(value);
}

function finiteRecord(input: Readonly<Record<string, number | undefined>>): Record<string, number> {
  const entries = Object.entries(input)
    .filter((entry): entry is [string, number] => Number.isFinite(entry[1]));
  entries.sort(([a], [b]) => compareStrings(a, b));
  return Object.fromEntries(entries);
}

function validateFiniteRecord(
  profile: string,
  field: "counts" | "coverage",
  input: Readonly<Record<string, number>>,
  diagnostics: PolyWorldProfileArtifactDiagnostic[],
): void {
  for (const [key, value] of Object.entries(input)) {
    if (Number.isFinite(value)) continue;
    diagnostics.push({
      code: `poly-world-profile-artifact-nonfinite-${field}`,
      message: `PolyWorld profile artifact "${profile}" has non-finite ${field}.${key}.`,
      id: key,
      field: `${field}.${key}`,
    });
  }
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function compareStrings(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}
