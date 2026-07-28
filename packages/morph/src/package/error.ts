export class PolyMorphPackageError extends Error {
  readonly code: string;
  readonly path: string;

  constructor(code: string, path: string, message: string) {
    super(`${path}: ${message}`);
    this.name = "PolyMorphPackageError";
    this.code = code;
    this.path = path;
  }
}
