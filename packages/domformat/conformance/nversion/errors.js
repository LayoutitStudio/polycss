// Conformance-only error surface. This directory is mechanically forbidden
// from importing the production implementation.

export class NVersionError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "NVersionError";
    this.code = code;
  }
}

export function requireContract(condition, code, message) {
  if (!condition) throw new NVersionError(code, message);
}
