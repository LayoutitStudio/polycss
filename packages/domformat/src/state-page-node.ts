import { gunzipSync } from "node:zlib";
import { invariant } from "./errors.js";
import { sha256Hex } from "./hash.js";
import type { DomResourceRecord } from "./public-types.js";

export function decodeStatePageNode(record: DomResourceRecord, encoded: Uint8Array): Uint8Array {
  invariant(record.kind === "state-page" && record.decodedByteLength !== undefined && record.decodedDigest, "INVALID_STATE_PAGE_RESOURCE", `Resource ${record.id} is not a complete state page.`);
  let decoded: Uint8Array;
  if (record.encoding === "identity") decoded = encoded.slice();
  else {
    try {
      decoded = Uint8Array.from(gunzipSync(encoded, { maxOutputLength: record.decodedByteLength + 1 }));
    } catch (error) {
      invariant(false, "STATE_PAGE_DECODE_FAILED", `State page ${record.id} gzip decoding failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  invariant(decoded.length === record.decodedByteLength, "STATE_PAGE_DECODED_SIZE_MISMATCH", `State page ${record.id} decoded length does not match RCRD.`);
  invariant(sha256Hex(decoded) === record.decodedDigest.value, "STATE_PAGE_DECODED_DIGEST_MISMATCH", `State page ${record.id} decoded digest does not match RCRD.`);
  return decoded;
}
