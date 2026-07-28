export class PolyMorphRuntimeError extends Error {
  readonly code: string;
  readonly path: string;

  constructor(code: string, path: string, message: string) {
    super(`${path}: ${message}`);
    this.name = "PolyMorphRuntimeError";
    this.code = code;
    this.path = path;
  }
}
