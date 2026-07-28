import { PolyMorphPackageError } from "./error.js";

function canonicalValue(value: unknown, path: string, seen: WeakSet<object>): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new PolyMorphPackageError("invalid-json", path, "numbers must be finite");
    }
    return JSON.stringify(Object.is(value, -0) ? 0 : value);
  }
  if (Array.isArray(value)) {
    if (seen.has(value)) throw new PolyMorphPackageError("invalid-json", path, "cycles are forbidden");
    seen.add(value);
    const result = `[${value.map((entry, index) =>
      canonicalValue(entry, `${path}[${index}]`, seen)).join(",")}]`;
    seen.delete(value);
    return result;
  }
  if (typeof value === "object" && value) {
    if (seen.has(value)) throw new PolyMorphPackageError("invalid-json", path, "cycles are forbidden");
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new PolyMorphPackageError("invalid-json", path, "expected a plain object");
    }
    seen.add(value);
    const input = value as Record<string, unknown>;
    const result = `{${Object.keys(input).sort().map((key) => {
      const entry = input[key];
      if (entry === undefined || typeof entry === "function" || typeof entry === "symbol") {
        throw new PolyMorphPackageError("invalid-json", `${path}.${key}`, "value is not JSON");
      }
      return `${JSON.stringify(key)}:${canonicalValue(entry, `${path}.${key}`, seen)}`;
    }).join(",")}}`;
    seen.delete(value);
    return result;
  }
  throw new PolyMorphPackageError("invalid-json", path, "value is not JSON");
}

export function stringifyPolyMorphCanonicalJson(value: unknown): string {
  return canonicalValue(value, "$", new WeakSet());
}

export function encodePolyMorphCanonicalJson(value: unknown): Uint8Array {
  return new TextEncoder().encode(stringifyPolyMorphCanonicalJson(value));
}

export function decodePolyMorphJson(bytes: Uint8Array, path = "$"): unknown {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new PolyMorphPackageError("invalid-utf8", path, "expected UTF-8 bytes");
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new PolyMorphPackageError("invalid-json", path, "expected valid JSON");
  }
}

export async function hashPolyMorphBytes(bytes: Uint8Array): Promise<string> {
  if (!globalThis.crypto?.subtle) {
    throw new PolyMorphPackageError("missing-crypto", "$", "Web Crypto is required");
  }
  const copy = Uint8Array.from(bytes);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", copy);
  return [...new Uint8Array(digest)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}
