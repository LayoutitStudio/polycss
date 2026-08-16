import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";

import {
  IDENTICAL_GROUPS,
  SYNC_SETS,
  checkIdenticalGroups,
  checkSyncSets,
  computeSyncHashes,
} from "./check-mirrors.mjs";

function makeRepo(files) {
  const root = mkdtempSync(join(tmpdir(), "mirror-check-"));
  for (const [rel, content] of Object.entries(files)) {
    const abs = resolve(root, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content);
  }
  return root;
}

test("identical groups pass when all copies match", () => {
  const root = makeRepo({ "a/x.ts": "same", "b/x.ts": "same" });
  const failures = checkIdenticalGroups(root, [
    { name: "x", files: ["a/x.ts", "b/x.ts"] },
  ]);
  assert.deepEqual(failures, []);
  rmSync(root, { recursive: true, force: true });
});

test("identical groups fail on divergence and name the diverged copy", () => {
  const root = makeRepo({ "a/x.ts": "same", "b/x.ts": "changed" });
  const failures = checkIdenticalGroups(root, [
    { name: "x", files: ["a/x.ts", "b/x.ts"] },
  ]);
  assert.equal(failures.length, 1);
  assert.match(failures[0].reason, /b\/x\.ts/);
  rmSync(root, { recursive: true, force: true });
});

test("identical groups fail on missing files", () => {
  const root = makeRepo({ "a/x.ts": "same" });
  const failures = checkIdenticalGroups(root, [
    { name: "x", files: ["a/x.ts", "b/x.ts"] },
  ]);
  assert.equal(failures.length, 1);
  assert.match(failures[0].reason, /missing/);
  rmSync(root, { recursive: true, force: true });
});

test("sync sets pass against a fresh pin and fail after an edit", () => {
  const root = makeRepo({ "a/x.ts": "one", "b/x.ts": "two" });
  const sets = [{ name: "s", hint: "h", files: ["a/x.ts", "b/x.ts"] }];
  const lock = computeSyncHashes(root, sets);
  assert.deepEqual(checkSyncSets(root, sets, lock), []);

  writeFileSync(resolve(root, "a/x.ts"), "edited");
  const failures = checkSyncSets(root, sets, lock);
  assert.equal(failures.length, 1);
  assert.deepEqual(failures[0].files, ["a/x.ts"]);
  rmSync(root, { recursive: true, force: true });
});

test("sync sets fail when a set is not pinned at all", () => {
  const root = makeRepo({ "a/x.ts": "one" });
  const failures = checkSyncSets(
    root,
    [{ name: "s", hint: "h", files: ["a/x.ts"] }],
    {},
  );
  assert.equal(failures.length, 1);
  assert.match(failures[0].reason, /not pinned/);
  rmSync(root, { recursive: true, force: true });
});

test("sync sets flag stale pins for files no longer in the set", () => {
  const root = makeRepo({ "a/x.ts": "one" });
  const sets = [{ name: "s", hint: "h", files: ["a/x.ts"] }];
  const lock = computeSyncHashes(root, sets);
  lock.s["a/removed.ts"] = "deadbeef";
  const failures = checkSyncSets(root, sets, lock);
  assert.equal(failures.length, 1);
  assert.deepEqual(failures[0].stale, ["a/removed.ts"]);
  rmSync(root, { recursive: true, force: true });
});

test("configured groups reference files that exist in this repo", () => {
  const repoRoot = resolve(import.meta.dirname, "..", "..");
  const missing = [];
  const allSets = [
    ...IDENTICAL_GROUPS.map((g) => ({ name: g.name, files: g.files })),
    ...SYNC_SETS.map((s) => ({ name: s.name, files: s.files })),
  ];
  const lock = computeSyncHashes(repoRoot, allSets);
  for (const set of Object.values(lock)) {
    for (const [file, hash] of Object.entries(set)) {
      if (hash === "<missing>") missing.push(file);
    }
  }
  assert.deepEqual(missing, []);
});
