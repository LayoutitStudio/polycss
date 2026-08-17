export { DomFormatError } from "./errors.js";
export { buildDom } from "./writer.js";
export { readDom, readDomFile } from "./reader.js";
import { validateDocument as validateDocumentSchema } from "./schema.js";
import type { DomDocument, DomLimitOverrides } from "./public-types.js";

export function validateDocument(
  document: unknown,
  options: { readonly limits?: DomLimitOverrides } = {},
): asserts document is DomDocument {
  validateDocumentSchema(document, options);
}
