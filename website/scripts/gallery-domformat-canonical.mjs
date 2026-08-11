export function serializeCanonicalJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(serializeCanonicalJson).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${serializeCanonicalJson(value[key])}`).join(",")}}`;
}

export function canonicalJsonBytes(value, trailingNewline = false) {
  return Buffer.from(`${serializeCanonicalJson(value)}${trailingNewline ? "\n" : ""}`);
}
