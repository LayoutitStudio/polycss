import type {
  PolyWorldSpatialElement,
  PolyWorldSpatialElementRole,
  PolyWorldSpatialElementVisibility,
} from "./types";

export interface PolyWorldSpatialElementRoleSummary {
  role: PolyWorldSpatialElementRole;
  count: number;
  spatialElementIds: readonly string[];
  elementIds: readonly string[];
}

export function resolvePolyWorldSpatialElementRole(
  spatialElement: PolyWorldSpatialElement,
): PolyWorldSpatialElementRole {
  if (spatialElement.role !== undefined) return spatialElement.role;
  if (spatialElement.visibility === "structural") return "shell";
  if (spatialElement.visibility === "detail") return "detail";
  return spatialElement.leafId === undefined ? "detail" : "shell";
}

export function resolvePolyWorldSpatialElementVisibility(
  spatialElement: PolyWorldSpatialElement,
): PolyWorldSpatialElementVisibility {
  if (spatialElement.visibility !== undefined) return spatialElement.visibility;
  switch (resolvePolyWorldSpatialElementRole(spatialElement)) {
    case "root":
    case "shell":
    case "opening":
      return "structural";
    case "detail":
    case "prop":
      return "detail";
  }
}

export function summarizePolyWorldSpatialElementRoles(
  spatialElements: readonly PolyWorldSpatialElement[],
): PolyWorldSpatialElementRoleSummary[] {
  const summaries = new Map<PolyWorldSpatialElementRole, {
    spatialElementIds: string[];
    elementIds: string[];
  }>();
  for (const spatialElement of spatialElements) {
    const role = resolvePolyWorldSpatialElementRole(spatialElement);
    const summary = summaries.get(role);
    if (summary === undefined) {
      summaries.set(role, {
        spatialElementIds: [spatialElement.id],
        elementIds: [spatialElement.elementId ?? spatialElement.id],
      });
      continue;
    }
    summary.spatialElementIds.push(spatialElement.id);
    add(summary.elementIds, spatialElement.elementId ?? spatialElement.id);
  }
  return polyWorldSpatialElementRoleOrder.flatMap((role) => {
    const summary = summaries.get(role);
    if (summary === undefined) return [];
    return [{
      role,
      count: summary.spatialElementIds.length,
      spatialElementIds: summary.spatialElementIds,
      elementIds: summary.elementIds,
    }];
  });
}

const polyWorldSpatialElementRoleOrder: readonly PolyWorldSpatialElementRole[] = [
  "root",
  "shell",
  "opening",
  "detail",
  "prop",
];

function add<T>(values: T[], value: T): void {
  if (!values.includes(value)) values.push(value);
}
