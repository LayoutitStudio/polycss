export class PolyMorphPrepareError extends Error {
  readonly code: string;
  readonly path: string;

  constructor(code: string, path: string, message: string) {
    super(`${path}: ${message}`);
    this.name = "PolyMorphPrepareError";
    this.code = code;
    this.path = path;
  }
}

export function failPolyMorphPrepare(
  code: string,
  path: string,
  message: string,
): never {
  throw new PolyMorphPrepareError(code, path, message);
}
