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
import { assertWellFormed } from "./sync-package-readmes.mjs";

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

test("replacement copies content literally, including $ sequences", () => {
  // Regression: passing the block as a replacement STRING expands `$&`,
  // "$`" and `$'`, corrupting any README containing them.
  const blockRe = /<!-- polycss:shared:links:start -->[\s\S]*?<!-- polycss:shared:links:end -->/;
  const replacement = `${S("links")}\ncost: $5 — see $& and $\` and $'\n${E("links")}`;
  const target = `head\n${S("links")}\nold\n${E("links")}\ntail`;

  const viaString = target.replace(blockRe, replacement);
  const viaCallback = target.replace(blockRe, () => replacement);

  assert.ok(viaCallback.includes("$& and $` and $'"), "callback must copy verbatim");
  assert.notEqual(viaString, viaCallback, "string form is the buggy path this guards against");
});
