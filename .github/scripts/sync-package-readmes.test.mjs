/**
 * Unit tests for the README shared-block synchroniser's marker validation.
 *
 * `assertWellFormed` is the gate that decides whether a package README is
 * syncable. Every bug found here so far has been a case it accepted and then
 * silently failed to replace, letting `--check` report success while a stale
 * block shipped to npm — so the tests below are all about REJECTION.
 */
import { strict as assert } from "node:assert";
import test from "node:test";
import { applyBlocks, assertWellFormed } from "./sync-package-readmes.mjs";

const S = (n) => `<!-- polycss:shared:${n}:start -->`;
const E = (n) => `<!-- polycss:shared:${n}:end -->`;
const ALLOWED = new Set(["links", "packages", "license"]);

/** Collects the error instead of exiting, so a rejection is observable. */
const check = (text) => {
  let error = null;
  const names = assertWellFormed(text, "fixture", ALLOWED, (m) => {
    error = m;
    return null;
  });
  return { error, names };
};

test("accepts a well-formed file and reports its blocks", () => {
  const { error, names } = check(`# Pkg\n${S("links")}\nx\n${E("links")}\nbody\n${S("license")}\nMIT\n${E("license")}\n`);
  assert.equal(error, null);
  assert.deepEqual([...names], ["links", "license"]);
});

test("accepts a file with no markers at all (opted out)", () => {
  const { error, names } = check("# Pkg\n\nNo shared blocks here.\n");
  assert.equal(error, null);
  assert.equal(names.size, 0);
});

test("rejects an end marker that precedes its start", () => {
  const { error } = check(`${E("links")}\nx\n${S("links")}\n`);
  assert.match(error, /end marker before its start/);
});

test("rejects a duplicated block", () => {
  const { error } = check(`${S("links")}a${E("links")}\n${S("links")}b${E("links")}`);
  assert.match(error, /appears more than once/);
});

test("rejects nested blocks", () => {
  const { error } = check(`${S("links")}\n${S("license")}\nx\n${E("license")}\n${E("links")}`);
  assert.match(error, /may not nest or cross/);
});

test("rejects crossing blocks", () => {
  const { error } = check(`${S("links")}\n${S("license")}\n${E("links")}\n${E("license")}`);
  assert.match(error, /may not nest or cross/);
});

test("rejects an unclosed block", () => {
  const { error } = check(`${S("links")}\nx\n`);
  assert.match(error, /is never closed/);
});

test("rejects a block name the root README does not define", () => {
  const { error } = check(`${S("bogus")}\nx\n${E("bogus")}`);
  assert.match(error, /not defined in the root README/);
});

test("applyBlocks copies content literally, including $ sequences", () => {
  // Regression: a replacement STRING expands `$&`, "$`" and `$'`. This drives
  // the PRODUCTION path, so reverting it to the string form fails here.
  const block = `${S("links")}\ncost: $5 — see $& and $\` and $'\n${E("links")}`;
  const target = `head\n${S("links")}\nold\n${E("links")}\ntail`;

  const out = applyBlocks(target, new Map([["links", block]]), "fixture", ALLOWED);

  assert.ok(out.includes("$& and $` and $'"), "block must be copied byte-for-byte");
  assert.equal(out, `head\n${block}\ntail`);
});

test("applyBlocks leaves a marker-less file untouched", () => {
  const target = "# Pkg\n\nnothing shared here\n";
  assert.equal(applyBlocks(target, new Map(), "fixture", ALLOWED), target);
});

test("rejects marker-like comments that are not canonical", () => {
  for (const bad of [
    "<!-- polycss:shared:links2:start -->",
    "<!-- polycss:shared:Links:start -->",
    "<!-- polycss:shared:links:begin -->",
    "<!--  polycss:shared:links:start  -->",
  ]) {
    const { error } = check(`head\n${bad}\nx\n${E("links")}\n`);
    assert.match(error ?? "", /malformed shared marker/, `should reject ${bad}`);
  }
});

test("rejects a near-miss marker containing '>' (fail-open regression)", () => {
  // Both markers of a block corrupted with `>` made the file look marker-less,
  // so `--check` reported "up to date" while a stale block shipped.
  const { error } = check(
    `head\n<!-- polycss:shared:license:start (see > note) -->\nSTALE\n<!-- polycss:shared:license:end (see > note) -->\n`,
  );
  assert.match(error ?? "", /malformed shared marker/);
});

test("rejects an unterminated marker comment", () => {
  const { error } = check(`head\n<!-- polycss:shared:links:start\nSTALE\n`);
  assert.match(error ?? "", /malformed shared marker/);
});

test("rejects a bogus `--!>` terminator", () => {
  const { error } = check(`head\n<!-- polycss:shared:links:start --!>\nSTALE\n`);
  assert.match(error ?? "", /malformed shared marker/);
});

test("rejects case-altered markers even when paired (fail-open regression)", () => {
  // A matched PAIR of uppercase markers previously read as "no markers", so
  // `--check` passed while the block between them was stale.
  const { error } = check(
    `head\n<!-- POLYCSS:shared:links:start -->\nSTALE\n<!-- POLYCSS:shared:links:end -->\n`,
  );
  assert.match(error ?? "", /malformed shared marker/);
});
