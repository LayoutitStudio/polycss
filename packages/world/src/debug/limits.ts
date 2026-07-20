export interface PolyWorldDebugListLimitOptions {
  listLimit?: number;
}

export interface PolyWorldDebugEntryLimitOptions {
  entryLimit?: number;
}

export interface PolyWorldDebugLimitedList<T> {
  values: readonly T[];
  omitted: number;
}

export function limitPolyWorldDebugList<T>(
  values: readonly T[],
  limit: number | undefined,
): PolyWorldDebugLimitedList<T> {
  const normalizedLimit = normalizeLimit(limit);
  if (normalizedLimit === undefined) return { values, omitted: 0 };

  return {
    values: values.slice(0, normalizedLimit),
    omitted: Math.max(0, values.length - normalizedLimit),
  };
}

function normalizeLimit(limit: number | undefined): number | undefined {
  if (limit === undefined) return undefined;
  if (!Number.isFinite(limit)) return undefined;
  return Math.max(0, Math.floor(limit));
}
