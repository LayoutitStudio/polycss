import { fail, invariant } from "./errors.js";
import { DEFAULT_JSON_STRUCTURE_LIMITS } from "./constants.js";
import type { DomJsonStructureLimits } from "./constants.js";
import type { DomJsonValue } from "./public-types.js";

const MAX_CANONICAL_DEPTH = 256;

function assertUnicodeScalarString(value: string, label: string): void {
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      invariant(
        next >= 0xdc00 && next <= 0xdfff,
        "INVALID_UNICODE",
        `${label} contains an unpaired high surrogate.`,
      );
      index += 1;
    } else {
      invariant(
        unit < 0xdc00 || unit > 0xdfff,
        "INVALID_UNICODE",
        `${label} contains an unpaired low surrogate.`,
      );
    }
  }
}

function normalize(
  value: unknown,
  path: string,
  depth: number,
  seen: Set<object>,
  structureLimits: DomJsonStructureLimits,
): DomJsonValue {
  invariant(depth <= MAX_CANONICAL_DEPTH, "JSON_DEPTH", "Canonical JSON nesting is too deep.");
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "string") {
    assertUnicodeScalarString(value, path);
    return value.normalize("NFC");
  }
  if (typeof value === "number") {
    invariant(Number.isFinite(value), "INVALID_NUMBER", `${path} must be a finite JSON number.`);
    return Object.is(value, -0) ? 0 : value;
  }
  invariant(typeof value === "object", "INVALID_JSON_VALUE", `${path} is not a JSON value.`);
  invariant(!seen.has(value), "JSON_CYCLE", `${path} contains a cycle.`);
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      invariant(value.length <= structureLimits.maxArrayItems, "JSON_ARRAY_LIMIT", `${path} has too many array items.`);
      const output: DomJsonValue[] = [];
      for (let index = 0; index < value.length; index += 1) {
        invariant(Object.hasOwn(value, index), "INVALID_JSON_ARRAY", `${path} contains a sparse array slot at ${index}.`);
        output.push(normalize(value[index], `${path}[${index}]`, depth + 1, seen, structureLimits));
      }
      return output;
    }
    const prototype = Object.getPrototypeOf(value);
    invariant(prototype === Object.prototype || prototype === null, "INVALID_JSON_OBJECT", `${path} must be a plain JSON object.`);
    const record = value as Record<string, unknown>;
    const output: Record<string, DomJsonValue> = {};
    const normalizedKeys = new Set<string>();
    const rawKeys: string[] = [];
    for (const rawKey in record) {
      if (!Object.hasOwn(record, rawKey)) continue;
      invariant(rawKey.length <= (structureLimits.maxKeyCodeUnits ?? 256), "JSON_KEY_LIMIT", `${path} has an excessive object key.`);
      rawKeys.push(rawKey);
      invariant(rawKeys.length <= structureLimits.maxObjectMembers, "JSON_OBJECT_LIMIT", `${path} has too many object members.`);
    }
    rawKeys.sort();
    for (const rawKey of rawKeys) {
      assertUnicodeScalarString(rawKey, `${path} key`);
      const key = rawKey.normalize("NFC");
      invariant(!normalizedKeys.has(key), "DUPLICATE_NORMALIZED_KEY", `${path} has colliding normalized keys.`);
      normalizedKeys.add(key);
      const entry = record[rawKey];
      invariant(entry !== undefined, "UNDEFINED_JSON_VALUE", `${path}.${key} is undefined.`);
      // Defining an own data property keeps keys such as "__proto__" from
      // invoking Object.prototype setters while returning the same ordinary
      // object shape produced by JSON.parse.
      Object.defineProperty(output, key, {
        configurable: true,
        enumerable: true,
        value: normalize(entry, `${path}.${key}`, depth + 1, seen, structureLimits),
        writable: true,
      });
    }
    return output;
  } finally {
    seen.delete(value);
  }
}

export function canonicalize<T>(value: T, structureLimits: DomJsonStructureLimits = DEFAULT_JSON_STRUCTURE_LIMITS): T {
  return normalize(value, "$", 0, new Set<object>(), structureLimits) as T;
}

export function deepFreezeJson<T>(value: T): T {
  if (value === null || typeof value !== "object") return value;
  const stack: object[] = [value];
  const seen = new WeakSet<object>();
  while (stack.length > 0) {
    const current = stack.pop()!;
    if (seen.has(current)) continue;
    seen.add(current);
    for (const entry of Array.isArray(current) ? current : Object.values(current)) {
      if (entry !== null && typeof entry === "object") stack.push(entry);
    }
    Object.freeze(current);
  }
  return value;
}

function serializeCanonical(value: DomJsonValue): string {
  if (value === null || typeof value === "boolean" || typeof value === "number" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(serializeCanonical).join(",")}]`;
  const record = value as Readonly<Record<string, DomJsonValue>>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${serializeCanonical(record[key])}`).join(",")}}`;
}

export function encodeCanonicalJson(value: unknown, structureLimits: DomJsonStructureLimits = DEFAULT_JSON_STRUCTURE_LIMITS): Uint8Array {
  // JSON.stringify applies the ECMAScript property-enumeration special case
  // for array-index-looking object keys.  Serializing entries ourselves keeps
  // every object in the format's declared UTF-16 lexical order, including
  // objects such as { "10": ..., "2": ... }.
  const canonical = normalize(value, "$", 0, new Set<object>(), structureLimits);
  return new TextEncoder().encode(serializeCanonical(canonical));
}

function decodeUtf8(bytes: Uint8Array, label: string): string {
  try {
    // Preserve a leading BOM so the lexical parser rejects it instead of
    // allowing TextDecoder's default BOM stripping to accept it silently.
    const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
    invariant(text.charCodeAt(0) !== 0xfeff, "MALFORMED_UTF8", `${label} begins with a byte-order mark.`);
    return text;
  } catch (error) {
    fail("MALFORMED_UTF8", `${label} is not valid UTF-8.`, { cause: String(error) });
  }
}

interface JsonPreflightOptions {
  readonly structureLimits?: DomJsonStructureLimits;
  readonly allowNonNormalized?: boolean;
  readonly allowNegativeZero?: boolean;
}

function preflightJson(text: string, label: string, options: JsonPreflightOptions = {}): void {
  const structureLimits = options.structureLimits ?? DEFAULT_JSON_STRUCTURE_LIMITS;
  const numberPattern = /-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/uy;
  let offset = 0;
  const whitespace = () => {
    while (offset < text.length && (text[offset] === " " || text[offset] === "\t" || text[offset] === "\n" || text[offset] === "\r")) offset += 1;
  };
  const malformed = (message: string): never => fail("MALFORMED_JSON", `${label} ${message}`);
  const string = (maximumCodeUnits?: number): string => {
    const start = offset;
    if (text[offset] !== '"') malformed(`has an invalid string at character ${offset}.`);
    offset += 1;
    while (offset < text.length) {
      const code = text.charCodeAt(offset);
      if (code === 0x22) {
        offset += 1;
        if (maximumCodeUnits !== undefined) {
          invariant(offset - start <= maximumCodeUnits * 6 + 2, "JSON_KEY_LIMIT", `${label} object key is excessive.`);
        }
        let value: string;
        try {
          value = JSON.parse(text.slice(start, offset));
        } catch (error) {
          fail("MALFORMED_JSON", `${label} has an invalid string.`, { cause: String(error) });
        }
        assertUnicodeScalarString(value, label);
        if (maximumCodeUnits !== undefined) invariant(value.length <= maximumCodeUnits, "JSON_KEY_LIMIT", `${label} object key is excessive.`);
        if (!options.allowNonNormalized) {
          invariant(value === value.normalize("NFC"), "NON_NORMALIZED_JSON", `${label} strings and keys must use NFC.`);
        }
        return value;
      }
      invariant(code >= 0x20, "MALFORMED_JSON", `${label} contains an unescaped control character.`);
      if (code === 0x5c) {
        offset += 1;
        if (offset >= text.length || !'"\\/bfnrtu'.includes(text[offset])) malformed("contains an invalid string escape.");
        if (text[offset] === "u") {
          invariant(/^[0-9a-fA-F]{4}$/u.test(text.slice(offset + 1, offset + 5)), "MALFORMED_JSON", `${label} contains an invalid Unicode escape.`);
          offset += 4;
        }
      }
      offset += 1;
    }
    return malformed("contains an unterminated string.");
  };
  const number = () => {
    numberPattern.lastIndex = offset;
    const match = numberPattern.exec(text);
    invariant(match, "MALFORMED_JSON", `${label} has an invalid number at character ${offset}.`);
    offset += match[0].length;
    const value = Number(match[0]);
    invariant(Number.isFinite(value), "INVALID_NUMBER", `${label} contains a non-finite JSON number.`);
    if (!options.allowNegativeZero) invariant(!Object.is(value, -0), "INVALID_NUMBER", `${label} must not encode negative zero.`);
  };
  const literal = (value: string): void => {
    if (!text.startsWith(value, offset)) malformed(`has an invalid token at character ${offset}.`);
    offset += value.length;
  };
  const value = (depth: number): void => {
    invariant(depth <= MAX_CANONICAL_DEPTH, "JSON_DEPTH", `${label} nesting is too deep.`);
    whitespace();
    const token = text[offset];
    if (token === '"') {
      string();
    } else if (token === "{") {
      offset += 1;
      whitespace();
      const keys = new Set<string>();
      let members = 0;
      if (text[offset] === "}") {
        offset += 1;
        return;
      }
      while (true) {
        whitespace();
        const key = string(structureLimits.maxKeyCodeUnits ?? 256).normalize("NFC");
        members += 1;
        invariant(members <= structureLimits.maxObjectMembers, "JSON_OBJECT_LIMIT", `${label} object has too many members.`);
        invariant(!keys.has(key), "DUPLICATE_NORMALIZED_KEY", `${label} contains duplicate object key ${JSON.stringify(key)}.`);
        keys.add(key);
        whitespace();
        if (text[offset] !== ":") malformed(`is missing ':' after an object key at character ${offset}.`);
        offset += 1;
        value(depth + 1);
        whitespace();
        if (text[offset] === "}") {
          offset += 1;
          return;
        }
        if (text[offset] !== ",") malformed(`is missing ',' between object members at character ${offset}.`);
        offset += 1;
      }
    } else if (token === "[") {
      offset += 1;
      whitespace();
      let items = 0;
      if (text[offset] === "]") {
        offset += 1;
        return;
      }
      while (true) {
        items += 1;
        invariant(items <= structureLimits.maxArrayItems, "JSON_ARRAY_LIMIT", `${label} array has too many items.`);
        value(depth + 1);
        whitespace();
        if (text[offset] === "]") {
          offset += 1;
          return;
        }
        if (text[offset] !== ",") malformed(`is missing ',' between array values at character ${offset}.`);
        offset += 1;
      }
    } else if (token === "t") {
      literal("true");
    } else if (token === "f") {
      literal("false");
    } else if (token === "n") {
      literal("null");
    } else {
      number();
    }
  };
  whitespace();
  value(0);
  whitespace();
  invariant(offset === text.length, "MALFORMED_JSON", `${label} has trailing non-whitespace data.`);
}

export function decodeJson(bytes: Uint8Array, label = "JSON document", structureLimits: DomJsonStructureLimits = DEFAULT_JSON_STRUCTURE_LIMITS): unknown {
  const text = decodeUtf8(bytes, label);
  preflightJson(text, label, { structureLimits });
  try {
    return JSON.parse(text);
  } catch (error) {
    fail("MALFORMED_JSON", `${label} is not valid JSON.`, { cause: String(error) });
  }
}
