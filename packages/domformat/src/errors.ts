export class DomFormatError extends Error {
  readonly code: string;
  readonly details?: unknown;

  constructor(code: string, message: string, details?: unknown) {
    super(message);
    this.name = "DomFormatError";
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}

export function fail(code: string, message: string, details?: unknown): never {
  throw new DomFormatError(code, message, details);
}

export function invariant(condition: unknown, code: string, message: string, details?: unknown): asserts condition {
  if (!condition) fail(code, message, details);
}

export function errorCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object") return undefined;
  const value = Reflect.get(error, "code");
  return typeof value === "string" ? value : undefined;
}

export function errorName(error: unknown): string | undefined {
  if (!error || typeof error !== "object") return undefined;
  const value = Reflect.get(error, "name");
  return typeof value === "string" ? value : undefined;
}
