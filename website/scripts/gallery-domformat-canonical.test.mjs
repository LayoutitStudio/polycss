import test from "node:test";
import assert from "node:assert/strict";
import { canonicalJsonBytes, serializeCanonicalJson } from "./gallery-domformat-canonical.mjs";

test("Gallery canonical JSON sorts every object key lexicographically", () => {
  const value = { 2: "two", 10: "ten", nested: { z: 1, a: 2 }, array: [{ 3: true, 11: false }] };
  assert.equal(
    serializeCanonicalJson(value),
    '{"10":"ten","2":"two","array":[{"11":false,"3":true}],"nested":{"a":2,"z":1}}',
  );
});

test("Gallery canonical bytes add a newline only when requested", () => {
  assert.equal(canonicalJsonBytes({ b: 1, a: 2 }).toString(), '{"a":2,"b":1}');
  assert.equal(canonicalJsonBytes({ b: 1, a: 2 }, true).toString(), '{"a":2,"b":1}\n');
});
