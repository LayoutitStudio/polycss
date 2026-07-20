import type {
  PolyWorldProfileArtifactKind,
  PolyWorldProfileArtifactProfile,
  PolyWorldProfileArtifactSourceKind,
} from "../profiles/artifact";
import type { PolyWorldResourceReadinessState } from "../planner/resources";
import type { PolyWorldLayerPlanPolicy } from "../planner/types";
import {
  createPolyWorldTopology,
  validatePolyWorldTopology,
} from "./createTopology";
import {
  createPolyWorldTopologyCapabilityContract,
  type PolyWorldTopologyCapability,
  type PolyWorldTopologyCapabilityContract,
  type PolyWorldTopologyCapabilityId,
} from "./capabilities";
import type {
  PolyWorldData,
  PolyWorldTopology,
  PolyWorldTopologyInput,
  PolyWorldValidationDiagnostic,
} from "./types";

export type PolyWorldDocumentDiagnosticKind =
  | NonNullable<PolyWorldValidationDiagnostic["kind"]>
  | "document"
  | "capability"
  | "profileArtifact"
  | "resource"
  | "planPolicy";

export interface PolyWorldDocumentDiagnostic {
  code: string;
  message: string;
  id?: string;
  field?: string;
  kind?: PolyWorldDocumentDiagnosticKind;
}

export interface PolyWorldDocumentProfileArtifactRef {
  id: string;
  profile: PolyWorldProfileArtifactProfile;
  artifactKind?: PolyWorldProfileArtifactKind;
  sourceKind?: PolyWorldProfileArtifactSourceKind;
  producedBy?: string;
  elementIds?: readonly string[];
  spatialElementIds?: readonly string[];
  resourceIds?: readonly string[];
  data?: PolyWorldData;
}

export interface PolyWorldDocumentResourceDeclaration {
  id: string;
  state?: PolyWorldResourceReadinessState;
  renderBlocking?: boolean;
  preloadOnly?: boolean;
  elementIds?: readonly string[];
  spatialElementIds?: readonly string[];
  label?: string;
  message?: string;
  data?: PolyWorldData;
}

export interface PolyWorldDocumentPlanPolicy extends PolyWorldLayerPlanPolicy {
  id: string;
}

export interface PolyWorldDocumentInput {
  id?: string;
  label?: string;
  topology: PolyWorldTopologyInput;
  capabilityIds?: readonly PolyWorldTopologyCapabilityId[];
  profileArtifacts?: readonly PolyWorldDocumentProfileArtifactRef[];
  resources?: readonly PolyWorldDocumentResourceDeclaration[];
  planPolicies?: readonly PolyWorldDocumentPlanPolicy[];
  data?: PolyWorldData;
}

export interface PolyWorldDocumentSummary {
  regionCount: number;
  linkCount: number;
  elementCount: number;
  spatialElementCount: number;
  profileArtifactCount: number;
  resourceCount: number;
  planPolicyCount: number;
  capabilityIds: readonly PolyWorldTopologyCapabilityId[];
}

export interface PolyWorldDocument {
  schemaVersion: 1;
  id?: string;
  label?: string;
  topology: PolyWorldTopology;
  capabilityContract: PolyWorldTopologyCapabilityContract;
  capabilityIds: readonly PolyWorldTopologyCapabilityId[];
  capabilities: readonly PolyWorldTopologyCapability[];
  profileArtifacts: readonly PolyWorldDocumentProfileArtifactRef[];
  resources: readonly PolyWorldDocumentResourceDeclaration[];
  planPolicies: readonly PolyWorldDocumentPlanPolicy[];
  profileArtifactsById: ReadonlyMap<string, PolyWorldDocumentProfileArtifactRef>;
  profileArtifactIdsByProfile: ReadonlyMap<PolyWorldProfileArtifactProfile, readonly string[]>;
  resourcesById: ReadonlyMap<string, PolyWorldDocumentResourceDeclaration>;
  planPoliciesById: ReadonlyMap<string, PolyWorldDocumentPlanPolicy>;
  summary: PolyWorldDocumentSummary;
  data?: PolyWorldData;
}

export class PolyWorldDocumentError extends Error {
  readonly diagnostics: readonly PolyWorldDocumentDiagnostic[];

  constructor(diagnostics: readonly PolyWorldDocumentDiagnostic[]) {
    super(diagnostics.map((diagnostic) => diagnostic.message).join("\n"));
    this.name = "PolyWorldDocumentError";
    this.diagnostics = diagnostics;
  }
}

const validProfileArtifactProfiles = new Set<PolyWorldProfileArtifactProfile>([
  "bsp-pvs",
  "area-portals",
  "portal-flow",
  "chunk-traversal",
]);

const profileArtifactKindByProfile: Readonly<Record<
  PolyWorldProfileArtifactProfile,
  PolyWorldProfileArtifactKind
>> = {
  "bsp-pvs": "compiled-bsp-pvs",
  "area-portals": "authored-area-portals",
  "portal-flow": "authored-area-portal-flow",
  "chunk-traversal": "chunk-working-set",
};

const profileArtifactCapabilityByProfile: Readonly<Record<
  PolyWorldProfileArtifactProfile,
  PolyWorldTopologyCapabilityId
>> = {
  "bsp-pvs": "compiled-bsp-pvs",
  "area-portals": "area-portals",
  "portal-flow": "area-portals",
  "chunk-traversal": "chunk-hierarchy",
};

const validProfileArtifactSourceKinds = new Set<PolyWorldProfileArtifactSourceKind>([
  "compiled",
  "authored",
  "authored-runtime-selection",
]);

const validResourceReadinessStates = new Set<PolyWorldResourceReadinessState>([
  "missing",
  "requested",
  "loading",
  "ready",
  "failed",
  "stale",
]);

export function validatePolyWorldDocument(
  input: PolyWorldDocumentInput,
): PolyWorldDocumentDiagnostic[] {
  const diagnostics: PolyWorldDocumentDiagnostic[] = [];
  const topology = input.topology;
  if (topology === undefined) {
    diagnostics.push({
      code: "poly-world-document-missing-topology",
      message: "PolyWorld document requires topology input.",
      field: "topology",
      kind: "document",
    });
    return diagnostics;
  }

  diagnostics.push(...validatePolyWorldTopology(topology).map((diagnostic) => ({ ...diagnostic })));
  validateOptionalId(input.id, "document", diagnostics);

  const capabilityContract = createPolyWorldTopologyCapabilityContract();
  const allCapabilityIds = capabilityContract.capabilities.map((capability) => capability.id);
  const knownCapabilityIds = new Set(allCapabilityIds);
  const enabledCapabilityIds = new Set(input.capabilityIds ?? allCapabilityIds);
  validateCapabilityIds(input.capabilityIds, knownCapabilityIds, diagnostics);

  const elementIds = new Set((topology.elements ?? []).map((element) => element.id));
  const spatialElementIds = new Set((topology.spatialElements ?? []).map((spatialElement) => spatialElement.id));
  validateProfileArtifacts(input.profileArtifacts ?? [], enabledCapabilityIds, elementIds, spatialElementIds, diagnostics);
  validateResources(input.resources ?? [], elementIds, spatialElementIds, diagnostics);
  validatePlanPolicies(input.planPolicies ?? [], elementIds, diagnostics);

  return diagnostics;
}

export function createPolyWorldDocument(input: PolyWorldDocumentInput): PolyWorldDocument {
  const diagnostics = validatePolyWorldDocument(input);
  if (diagnostics.length > 0) {
    throw new PolyWorldDocumentError(diagnostics);
  }

  const topology = createPolyWorldTopology(input.topology);
  const capabilityContract = createPolyWorldTopologyCapabilityContract();
  const capabilityIds = [...(input.capabilityIds ?? capabilityContract.capabilities.map((capability) => capability.id))];
  const capabilityIdSet = new Set(capabilityIds);
  const capabilities = capabilityContract.capabilities.filter((capability) => capabilityIdSet.has(capability.id));
  const profileArtifacts = (input.profileArtifacts ?? []).map(cloneProfileArtifact);
  const resources = (input.resources ?? []).map(cloneResource);
  const planPolicies = (input.planPolicies ?? []).map(clonePlanPolicy);
  const profileArtifactsById = new Map<string, PolyWorldDocumentProfileArtifactRef>();
  const profileArtifactIdsByProfile = new Map<PolyWorldProfileArtifactProfile, string[]>();
  const resourcesById = new Map<string, PolyWorldDocumentResourceDeclaration>();
  const planPoliciesById = new Map<string, PolyWorldDocumentPlanPolicy>();

  for (const artifact of profileArtifacts) {
    profileArtifactsById.set(artifact.id, artifact);
    pushMap(profileArtifactIdsByProfile, artifact.profile, artifact.id);
  }
  for (const resource of resources) resourcesById.set(resource.id, resource);
  for (const policy of planPolicies) planPoliciesById.set(policy.id, policy);

  return {
    schemaVersion: 1,
    ...(input.id === undefined ? {} : { id: input.id }),
    ...(input.label === undefined ? {} : { label: input.label }),
    topology,
    capabilityContract,
    capabilityIds,
    capabilities,
    profileArtifacts,
    resources,
    planPolicies,
    profileArtifactsById,
    profileArtifactIdsByProfile,
    resourcesById,
    planPoliciesById,
    summary: {
      regionCount: topology.regions.length,
      linkCount: topology.links.length,
      elementCount: topology.elements.length,
      spatialElementCount: topology.spatialElements.length,
      profileArtifactCount: profileArtifacts.length,
      resourceCount: resources.length,
      planPolicyCount: planPolicies.length,
      capabilityIds,
    },
    ...(input.data === undefined ? {} : { data: input.data }),
  };
}

function validateCapabilityIds(
  capabilityIds: readonly PolyWorldTopologyCapabilityId[] | undefined,
  knownCapabilityIds: ReadonlySet<string>,
  diagnostics: PolyWorldDocumentDiagnostic[],
): void {
  if (capabilityIds === undefined) return;
  if (capabilityIds.length === 0) {
    diagnostics.push({
      code: "poly-world-document-empty-capability-ids",
      message: "PolyWorld document capabilityIds must not be empty when provided.",
      field: "capabilityIds",
      kind: "capability",
    });
    return;
  }

  const seen = new Set<string>();
  for (const capabilityId of capabilityIds) {
    if (typeof capabilityId !== "string" || capabilityId.length === 0) {
      diagnostics.push({
        code: "poly-world-document-empty-capability-id",
        message: "PolyWorld document capabilityIds must contain only non-empty strings.",
        field: "capabilityIds",
        kind: "capability",
      });
      continue;
    }
    if (seen.has(capabilityId)) {
      diagnostics.push({
        code: "poly-world-document-duplicate-capability-id",
        message: `Duplicate PolyWorld document capability id "${capabilityId}".`,
        id: capabilityId,
        field: "capabilityIds",
        kind: "capability",
      });
    }
    seen.add(capabilityId);
    if (!knownCapabilityIds.has(capabilityId)) {
      diagnostics.push({
        code: "poly-world-document-invalid-capability-id",
        message: `PolyWorld document references unknown capability id "${capabilityId}".`,
        id: capabilityId,
        field: "capabilityIds",
        kind: "capability",
      });
    }
  }
}

function validateProfileArtifacts(
  profileArtifacts: readonly PolyWorldDocumentProfileArtifactRef[],
  enabledCapabilityIds: ReadonlySet<string>,
  elementIds: ReadonlySet<string>,
  spatialElementIds: ReadonlySet<string>,
  diagnostics: PolyWorldDocumentDiagnostic[],
): void {
  const seen = new Set<string>();
  for (const artifact of profileArtifacts) {
    validateRequiredId(artifact.id, "profileArtifact", diagnostics);
    if (artifact.id.length > 0 && seen.has(artifact.id)) {
      diagnostics.push({
        code: "poly-world-document-duplicate-profile-artifact-id",
        message: `Duplicate PolyWorld document profile artifact id "${artifact.id}".`,
        id: artifact.id,
        field: "profileArtifacts.id",
        kind: "profileArtifact",
      });
    }
    if (artifact.id.length > 0) seen.add(artifact.id);

    if (!validProfileArtifactProfiles.has(artifact.profile)) {
      diagnostics.push({
        code: "poly-world-document-invalid-profile-artifact-profile",
        message: `PolyWorld document profile artifact "${artifact.id}" has invalid profile "${String(artifact.profile)}".`,
        id: artifact.id,
        field: "profileArtifacts.profile",
        kind: "profileArtifact",
      });
    } else if (
      artifact.artifactKind !== undefined &&
      artifact.artifactKind !== profileArtifactKindByProfile[artifact.profile]
    ) {
      diagnostics.push({
        code: "poly-world-document-profile-artifact-kind-mismatch",
        message: `PolyWorld document profile artifact "${artifact.id}" cannot use artifact kind "${artifact.artifactKind}" for profile "${artifact.profile}".`,
        id: artifact.id,
        field: "profileArtifacts.artifactKind",
        kind: "profileArtifact",
      });
    }
    validateProfileArtifactCapability(artifact, enabledCapabilityIds, diagnostics);

    if (artifact.sourceKind !== undefined && !validProfileArtifactSourceKinds.has(artifact.sourceKind)) {
      diagnostics.push({
        code: "poly-world-document-invalid-profile-artifact-source-kind",
        message: `PolyWorld document profile artifact "${artifact.id}" has invalid source kind "${String(artifact.sourceKind)}".`,
        id: artifact.id,
        field: "profileArtifacts.sourceKind",
        kind: "profileArtifact",
      });
    }
    validateStringArray(artifact.id, "profileArtifacts.elementIds", artifact.elementIds, diagnostics, "profileArtifact");
    validateStringArray(artifact.id, "profileArtifacts.spatialElementIds", artifact.spatialElementIds, diagnostics, "profileArtifact");
    validateStringArray(artifact.id, "profileArtifacts.resourceIds", artifact.resourceIds, diagnostics, "profileArtifact");
    validateElementReferences(artifact.id, "profileArtifacts.elementIds", artifact.elementIds, elementIds, diagnostics, "profileArtifact");
    validateSpatialElementReferences(artifact.id, "profileArtifacts.spatialElementIds", artifact.spatialElementIds, spatialElementIds, diagnostics, "profileArtifact");
  }
}

function validateProfileArtifactCapability(
  artifact: PolyWorldDocumentProfileArtifactRef,
  enabledCapabilityIds: ReadonlySet<string>,
  diagnostics: PolyWorldDocumentDiagnostic[],
): void {
  if (!validProfileArtifactProfiles.has(artifact.profile)) return;
  const capabilityId = profileArtifactCapabilityByProfile[artifact.profile];
  if (enabledCapabilityIds.has(capabilityId)) return;
  diagnostics.push({
    code: "poly-world-document-profile-artifact-capability-disabled",
    message: `PolyWorld document profile artifact "${artifact.id}" requires disabled capability "${capabilityId}".`,
    id: artifact.id,
    field: "profileArtifacts.profile",
    kind: "profileArtifact",
  });
}

function validateResources(
  resources: readonly PolyWorldDocumentResourceDeclaration[],
  elementIds: ReadonlySet<string>,
  spatialElementIds: ReadonlySet<string>,
  diagnostics: PolyWorldDocumentDiagnostic[],
): void {
  const seen = new Set<string>();
  for (const resource of resources) {
    validateRequiredId(resource.id, "resource", diagnostics);
    if (resource.id.length > 0 && seen.has(resource.id)) {
      diagnostics.push({
        code: "poly-world-document-duplicate-resource-id",
        message: `Duplicate PolyWorld document resource id "${resource.id}".`,
        id: resource.id,
        field: "resources.id",
        kind: "resource",
      });
    }
    if (resource.id.length > 0) seen.add(resource.id);
    if (resource.state !== undefined && !validResourceReadinessStates.has(resource.state)) {
      diagnostics.push({
        code: "poly-world-document-invalid-resource-state",
        message: `PolyWorld document resource "${resource.id}" has invalid state "${String(resource.state)}".`,
        id: resource.id,
        field: "resources.state",
        kind: "resource",
      });
    }
    validateStringArray(resource.id, "resources.elementIds", resource.elementIds, diagnostics, "resource");
    validateStringArray(resource.id, "resources.spatialElementIds", resource.spatialElementIds, diagnostics, "resource");
    validateElementReferences(resource.id, "resources.elementIds", resource.elementIds, elementIds, diagnostics, "resource");
    validateSpatialElementReferences(resource.id, "resources.spatialElementIds", resource.spatialElementIds, spatialElementIds, diagnostics, "resource");
  }
}

function validatePlanPolicies(
  planPolicies: readonly PolyWorldDocumentPlanPolicy[],
  elementIds: ReadonlySet<string>,
  diagnostics: PolyWorldDocumentDiagnostic[],
): void {
  const seen = new Set<string>();
  for (const policy of planPolicies) {
    validateRequiredId(policy.id, "planPolicy", diagnostics);
    if (policy.id.length > 0 && seen.has(policy.id)) {
      diagnostics.push({
        code: "poly-world-document-duplicate-plan-policy-id",
        message: `Duplicate PolyWorld document plan policy id "${policy.id}".`,
        id: policy.id,
        field: "planPolicies.id",
        kind: "planPolicy",
      });
    }
    if (policy.id.length > 0) seen.add(policy.id);
    if (typeof policy.layer !== "string" || policy.layer.length === 0) {
      diagnostics.push({
        code: "poly-world-document-empty-plan-policy-layer",
        message: `PolyWorld document plan policy "${policy.id}" requires a non-empty layer.`,
        id: policy.id,
        field: "planPolicies.layer",
        kind: "planPolicy",
      });
    }
    validateStringArray(policy.id, "planPolicies.elementLayers", policy.elementLayers, diagnostics, "planPolicy");
    validateStringArray(policy.id, "planPolicies.tags", policy.tags, diagnostics, "planPolicy");
    validateStringArray(policy.id, "planPolicies.elementKinds", policy.elementKinds, diagnostics, "planPolicy");
    validateStringArray(policy.id, "planPolicies.elementIds", policy.elementIds, diagnostics, "planPolicy");
    validateElementReferences(policy.id, "planPolicies.elementIds", policy.elementIds, elementIds, diagnostics, "planPolicy");
  }
}

function validateOptionalId(
  id: string | undefined,
  kind: PolyWorldDocumentDiagnosticKind,
  diagnostics: PolyWorldDocumentDiagnostic[],
): void {
  if (id === undefined) return;
  if (typeof id === "string" && id.length > 0) return;
  diagnostics.push({
    code: "poly-world-document-empty-id",
    message: `PolyWorld ${kind} id must be a non-empty string when provided.`,
    field: "id",
    kind,
  });
}

function validateRequiredId(
  id: string,
  kind: PolyWorldDocumentDiagnosticKind,
  diagnostics: PolyWorldDocumentDiagnostic[],
): void {
  if (typeof id === "string" && id.length > 0) return;
  diagnostics.push({
    code: `poly-world-document-empty-${kind}-id`,
    message: `PolyWorld document ${kind} requires a non-empty id.`,
    field: "id",
    kind,
  });
}

function validateStringArray(
  id: string,
  field: string,
  values: readonly string[] | undefined,
  diagnostics: PolyWorldDocumentDiagnostic[],
  kind: PolyWorldDocumentDiagnosticKind,
): void {
  if (values === undefined) return;
  if (values.length === 0) {
    diagnostics.push({
      code: "poly-world-document-empty-array",
      message: `PolyWorld document "${id}" has empty ${field}.`,
      id,
      field,
      kind,
    });
    return;
  }
  for (const value of values) {
    if (typeof value === "string" && value.length > 0) continue;
    diagnostics.push({
      code: "poly-world-document-empty-array-value",
      message: `PolyWorld document "${id}" has an empty value in ${field}.`,
      id,
      field,
      kind,
    });
  }
}

function validateElementReferences(
  id: string,
  field: string,
  values: readonly string[] | undefined,
  elementIds: ReadonlySet<string>,
  diagnostics: PolyWorldDocumentDiagnostic[],
  kind: PolyWorldDocumentDiagnosticKind,
): void {
  for (const elementId of values ?? []) {
    if (!elementIds.has(elementId)) {
      diagnostics.push({
        code: "poly-world-document-missing-element",
        message: `PolyWorld document "${id}" references missing element "${elementId}".`,
        id,
        field,
        kind,
      });
    }
  }
}

function validateSpatialElementReferences(
  id: string,
  field: string,
  values: readonly string[] | undefined,
  spatialElementIds: ReadonlySet<string>,
  diagnostics: PolyWorldDocumentDiagnostic[],
  kind: PolyWorldDocumentDiagnosticKind,
): void {
  for (const spatialElementId of values ?? []) {
    if (!spatialElementIds.has(spatialElementId)) {
      diagnostics.push({
        code: "poly-world-document-missing-spatial-element",
        message: `PolyWorld document "${id}" references missing spatial element "${spatialElementId}".`,
        id,
        field,
        kind,
      });
    }
  }
}

function cloneProfileArtifact(
  artifact: PolyWorldDocumentProfileArtifactRef,
): PolyWorldDocumentProfileArtifactRef {
  return {
    ...artifact,
    ...(artifact.elementIds === undefined ? {} : { elementIds: [...artifact.elementIds] }),
    ...(artifact.spatialElementIds === undefined ? {} : { spatialElementIds: [...artifact.spatialElementIds] }),
    ...(artifact.resourceIds === undefined ? {} : { resourceIds: [...artifact.resourceIds] }),
  };
}

function cloneResource(
  resource: PolyWorldDocumentResourceDeclaration,
): PolyWorldDocumentResourceDeclaration {
  return {
    ...resource,
    ...(resource.elementIds === undefined ? {} : { elementIds: [...resource.elementIds] }),
    ...(resource.spatialElementIds === undefined ? {} : { spatialElementIds: [...resource.spatialElementIds] }),
  };
}

function clonePlanPolicy(policy: PolyWorldDocumentPlanPolicy): PolyWorldDocumentPlanPolicy {
  return {
    ...policy,
    ...(policy.elementLayers === undefined ? {} : { elementLayers: [...policy.elementLayers] }),
    ...(policy.tags === undefined ? {} : { tags: [...policy.tags] }),
    ...(policy.elementKinds === undefined ? {} : { elementKinds: [...policy.elementKinds] }),
    ...(policy.elementIds === undefined ? {} : { elementIds: [...policy.elementIds] }),
  };
}

function pushMap<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const values = map.get(key);
  if (values === undefined) {
    map.set(key, [value]);
    return;
  }
  values.push(value);
}
