export class PolyMorphRenderError extends Error {
  readonly code: string;
  readonly path: string;

  constructor(code: string, path: string, message: string) {
    super(`${path}: ${message}`);
    this.name = "PolyMorphRenderError";
    this.code = code;
    this.path = path;
  }
}
