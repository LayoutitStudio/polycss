import { invariant } from "./errors.js";

function alphabetValue(code: number): number {
  if (code >= 0x41 && code <= 0x5a) return code - 0x41;
  if (code >= 0x61 && code <= 0x7a) return code - 0x61 + 26;
  if (code >= 0x30 && code <= 0x39) return code - 0x30 + 52;
  if (code === 0x2b) return 62;
  if (code === 0x2f) return 63;
  return -1;
}

export function canonicalBase64DecodedLength(value: unknown, label = "Base64 value", code = "INVALID_RESOURCE_BASE64"): number {
  invariant(typeof value === "string" && value.length % 4 === 0, code, `${label} is not canonical base64.`);
  const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0;
  const bodyLength = value.length - padding;
  for (let index = 0; index < bodyLength; index += 1) {
    invariant(alphabetValue(value.charCodeAt(index)) >= 0, code, `${label} is not canonical base64.`);
  }
  for (let index = bodyLength; index < value.length; index += 1) {
    invariant(value.charCodeAt(index) === 0x3d, code, `${label} is not canonical base64.`);
  }
  if (padding === 2) {
    invariant((alphabetValue(value.charCodeAt(bodyLength - 1)) & 15) === 0, code, `${label} has nonzero padding bits.`);
  } else if (padding === 1) {
    invariant((alphabetValue(value.charCodeAt(bodyLength - 1)) & 3) === 0, code, `${label} has nonzero padding bits.`);
  }
  return value.length / 4 * 3 - padding;
}
