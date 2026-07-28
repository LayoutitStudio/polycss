export class PolyMorphPackageError extends Error {
  readonly code: string;
  readonly path: string;
  readonly cause?: unknown;

  constructor(
    code: string,
    path: string,
    message: string,
    options: { readonly cause?: unknown } = {},
  ) {
    super(`${path}: ${message}`);
    this.name = "PolyMorphPackageError";
    this.code = code;
    this.path = path;
    if ("cause" in options) this.cause = options.cause;
  }
}
