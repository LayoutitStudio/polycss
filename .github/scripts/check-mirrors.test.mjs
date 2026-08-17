import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync,
  existsSync,
  readFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";

import {
  IDENTICAL_GROUPS,
  SYNC_SETS,
  checkIdenticalGroups,
  checkLaneParity,
  checkSyncSets,
  computeSyncHashes,
  loadWaivers,
  partitionLanes,
  resolveBaseRef,
  resolveLane,
  run,
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

const LANE_FILES = {
  "packages/polycss/src/render/x.ts": "vanilla v1\n",
  "packages/react/src/scene/x.ts": "react v1\n",
  "packages/vue/src/scene/x.ts": "vue v1\n",
};

const LANE_SETS = [
  {
    name: "s",
    hint: "mirror it",
    files: Object.keys(LANE_FILES),
  },
];

function git(root, args) {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
  assert.equal(result.status, 0, `git ${args.join(" ")}: ${result.stderr}`);
  return result.stdout.trim();
}

/** Fixture repo with a committed base and a synthetic `origin/main`. */
function makeGitRepo(files = LANE_FILES) {
  const root = makeRepo(files);
  mkdirSync(resolve(root, ".github"), { recursive: true });
  git(root, ["init", "--initial-branch", "main", "--quiet"]);
  git(root, ["config", "user.email", "t@example.com"]);
  git(root, ["config", "user.name", "T"]);
  git(root, ["add", "."]);
  git(root, ["commit", "--quiet", "-m", "base"]);
  git(root, ["update-ref", "refs/remotes/origin/main", "HEAD"]);
  git(root, ["checkout", "--quiet", "-b", "feature"]);
  return root;
}

function runFixture(root, argv = [], overrides = {}) {
  const out = [];
  const errs = [];
  const code = run(argv, {
    root,
    groups: [],
    sets: LANE_SETS,
    env: {},
    log: (message) => out.push(String(message)),
    error: (message) => errs.push(String(message)),
    ...overrides,
  });
  return { code, out: out.join("\n"), err: errs.join("\n") };
}

const edit = (root, rel, content) => writeFileSync(resolve(root, rel), content);
const cleanup = (root) => rmSync(root, { recursive: true, force: true });

test("identical groups pass when all copies match", () => {
  const root = makeRepo({ "a/x.ts": "same", "b/x.ts": "same" });
  const failures = checkIdenticalGroups(root, [
    { name: "x", files: ["a/x.ts", "b/x.ts"] },
  ]);
  assert.deepEqual(failures, []);
  cleanup(root);
});

test("identical groups fail on divergence and name the diverged copy", () => {
  const root = makeRepo({ "a/x.ts": "same", "b/x.ts": "changed" });
  const failures = checkIdenticalGroups(root, [
    { name: "x", files: ["a/x.ts", "b/x.ts"] },
  ]);
  assert.equal(failures.length, 1);
  assert.match(failures[0].reason, /b\/x\.ts/);
  cleanup(root);
});

test("identical groups fail on missing files", () => {
  const root = makeRepo({ "a/x.ts": "same" });
  const failures = checkIdenticalGroups(root, [
    { name: "x", files: ["a/x.ts", "b/x.ts"] },
  ]);
  assert.equal(failures.length, 1);
  assert.match(failures[0].reason, /missing/);
  cleanup(root);
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
  cleanup(root);
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
  cleanup(root);
});

test("sync sets flag stale pins for files no longer in the set", () => {
  const root = makeRepo({ "a/x.ts": "one" });
  const sets = [{ name: "s", hint: "h", files: ["a/x.ts"] }];
  const lock = computeSyncHashes(root, sets);
  lock.s["a/removed.ts"] = "deadbeef";
  const failures = checkSyncSets(root, sets, lock);
  assert.equal(failures.length, 1);
  assert.deepEqual(failures[0].stale, ["a/removed.ts"]);
  cleanup(root);
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

test("lanes resolve from the owning renderer package", () => {
  assert.equal(resolveLane("packages/polycss/src/render/atlas/plan.ts"), "polycss");
  assert.equal(resolveLane("packages/react/src/scene/atlas/packing.ts"), "react");
  assert.equal(resolveLane("packages/vue/src/styles/styles.ts"), "vue");
  assert.equal(resolveLane("packages/core/src/index.ts"), null);
  assert.equal(resolveLane("bench/build.mjs"), null);

  const lanes = partitionLanes(LANE_SETS[0].files);
  assert.deepEqual([...lanes.keys()].sort(), ["polycss", "react", "vue"]);
});

test("lane parity fails when only one lane changed", () => {
  const { failures, waived } = checkLaneParity(LANE_SETS, [
    "packages/react/src/scene/x.ts",
  ]);
  assert.deepEqual(waived, []);
  assert.equal(failures.length, 1);
  assert.equal(failures[0].set, "s");
  assert.deepEqual(failures[0].changed, ["react"]);
  assert.deepEqual(failures[0].unchanged.sort(), ["polycss", "vue"]);
});

test("lane parity passes when every lane changed", () => {
  const { failures } = checkLaneParity(LANE_SETS, LANE_SETS[0].files);
  assert.deepEqual(failures, []);
});

test("lane parity passes when nothing in the set changed", () => {
  const { failures, waived } = checkLaneParity(LANE_SETS, [
    "packages/core/src/index.ts",
    "website/src/pages/index.astro",
  ]);
  assert.deepEqual(failures, []);
  assert.deepEqual(waived, []);
});

test("an unscoped waiver excuses the set and carries the reason", () => {
  const { failures, waived } = checkLaneParity(
    LANE_SETS,
    ["packages/react/src/scene/x.ts"],
    { s: { reason: "vanilla has no equivalent", files: null } },
  );
  assert.deepEqual(failures, []);
  assert.equal(waived.length, 1);
  assert.equal(waived[0].reason, "vanilla has no equivalent");
});

test("a file-scoped waiver excuses only the files it names", () => {
  const waivers = {
    s: { reason: "react caught up", files: ["packages/react/src/scene/x.ts"] },
  };
  assert.deepEqual(
    checkLaneParity(LANE_SETS, ["packages/react/src/scene/x.ts"], waivers)
      .failures,
    [],
  );

  const other = checkLaneParity(
    LANE_SETS,
    ["packages/react/src/scene/x.ts", "packages/vue/src/scene/x.ts"],
    waivers,
  );
  assert.equal(other.failures.length, 1);
  assert.deepEqual(other.failures[0].changed, ["vue"]);
  assert.match(other.failures[0].note, /does not cover/);
});

test("waivers reject empty or malformed reasons", () => {
  const root = makeRepo({
    "empty.json": JSON.stringify({ s: "   " }),
    "bad.json": JSON.stringify({ s: { files: ["a"] } }),
    "badfiles.json": JSON.stringify({ s: { reason: "ok", files: [7] } }),
    "good.json": JSON.stringify({ s: "because", t: { reason: "why", files: ["a"] } }),
  });
  assert.match(loadWaivers(resolve(root, "empty.json")).errors[0], /empty reason/);
  assert.match(loadWaivers(resolve(root, "bad.json")).errors[0], /non-empty/);
  assert.match(loadWaivers(resolve(root, "badfiles.json")).errors[0], /string-array/);

  const good = loadWaivers(resolve(root, "good.json"));
  assert.deepEqual(good.errors, []);
  assert.equal(good.waivers.s.reason, "because");
  assert.deepEqual(good.waivers.t.files, ["a"]);

  assert.deepEqual(loadWaivers(resolve(root, "absent.json")), {
    waivers: {},
    errors: [],
  });
  cleanup(root);
});

test("base resolution prefers --base, then GITHUB_BASE_REF, then merge-base", () => {
  const root = makeGitRepo();
  const head = git(root, ["rev-parse", "HEAD"]);

  assert.deepEqual(resolveBaseRef(root, ["--base", "origin/main"], {}), {
    base: head,
    source: "--base origin/main",
  });
  assert.match(
    resolveBaseRef(root, ["--base", "nope/nope"], {}).reason,
    /cannot be resolved/,
  );
  assert.deepEqual(resolveBaseRef(root, [], { GITHUB_BASE_REF: "main" }), {
    base: head,
    source: "origin/main",
  });
  assert.equal(resolveBaseRef(root, [], {}).source, "merge-base(HEAD, origin/main)");
  cleanup(root);
});

test("an unresolvable base skips the lane check with a visible warning", () => {
  const root = makeRepo(LANE_FILES);
  mkdirSync(resolve(root, ".github"), { recursive: true });

  const resolved = resolveBaseRef(root, [], {});
  assert.equal(resolved.skip, true);
  assert.match(resolved.reason, /no base ref could be resolved/);

  assert.equal(runFixture(root, ["--update"]).code, 0);
  const result = runFixture(root);
  assert.equal(result.code, 0);
  assert.match(result.out, /MIRROR LANE CHECK SKIPPED/);
  assert.match(result.out, /fetch-depth: 0/);
  cleanup(root);
});

test("end to end: a single-lane change fails even after re-pinning the lock", () => {
  // The reviewer's exact reproduction: the hash lock alone lets a one-renderer
  // fix pass as soon as the author re-pins. Lane parity must still fail.
  const root = makeGitRepo();
  assert.equal(runFixture(root, ["--update"]).code, 0);
  assert.equal(runFixture(root).code, 0, "clean tree passes");

  edit(root, "packages/react/src/scene/x.ts", "react v2\n");

  const beforeRepin = runFixture(root);
  assert.equal(beforeRepin.code, 1);
  assert.match(beforeRepin.err, /pinned mirror sets changed/);

  assert.equal(runFixture(root, ["--update"]).code, 0);
  const afterRepin = runFixture(root);
  assert.equal(afterRepin.code, 1, "re-pinning must not launder an unmirrored fix");
  assert.doesNotMatch(afterRepin.err, /pinned mirror sets changed/);
  assert.match(afterRepin.err, /lanes changed unevenly/);
  assert.match(afterRepin.err, /changed lane\(s\):\s+react/);
  assert.match(afterRepin.err, /unchanged lane\(s\):\s+polycss, vue/);
  cleanup(root);
});

test("end to end: changing every lane passes", () => {
  const root = makeGitRepo();
  edit(root, "packages/polycss/src/render/x.ts", "vanilla v2\n");
  edit(root, "packages/react/src/scene/x.ts", "react v2\n");
  edit(root, "packages/vue/src/scene/x.ts", "vue v2\n");
  assert.equal(runFixture(root, ["--update"]).code, 0);

  const result = runFixture(root);
  assert.equal(result.code, 0);
  assert.match(result.out, /Mirror check passed/);
  cleanup(root);
});

test("end to end: an unchanged set passes without a waiver", () => {
  const root = makeGitRepo();
  assert.equal(runFixture(root, ["--update"]).code, 0);
  const result = runFixture(root);
  assert.equal(result.code, 0);
  assert.doesNotMatch(result.out, /MIRROR WAIVER/);
  cleanup(root);
});

test("end to end: a waived set passes and echoes the reason loudly", () => {
  const root = makeGitRepo();
  edit(root, "packages/react/src/scene/x.ts", "react v2\n");
  writeFileSync(
    resolve(root, ".github", "mirror-waivers.json"),
    `${JSON.stringify({ s: "react is catching up to vanilla" }, null, 2)}\n`,
  );
  assert.equal(runFixture(root, ["--update"]).code, 0);

  const result = runFixture(root);
  assert.equal(result.code, 0);
  assert.match(result.out, /MIRROR WAIVER APPLIED: set "s"/);
  assert.match(result.out, /react is catching up to vanilla/);
  cleanup(root);
});

test("--update never creates or refreshes waivers", () => {
  const root = makeGitRepo();
  const waiverPath = resolve(root, ".github", "mirror-waivers.json");
  edit(root, "packages/react/src/scene/x.ts", "react v2\n");

  assert.equal(runFixture(root, ["--update"]).code, 0);
  assert.equal(existsSync(waiverPath), false, "--update must not author a waiver");

  writeFileSync(waiverPath, `${JSON.stringify({ s: "declared" }, null, 2)}\n`);
  const before = readFileSync(waiverPath, "utf8");
  edit(root, "packages/vue/src/scene/x.ts", "vue v2\n");
  assert.equal(runFixture(root, ["--update"]).code, 0);
  assert.equal(readFileSync(waiverPath, "utf8"), before);
  cleanup(root);
});

test("a waiver naming an unknown set fails", () => {
  const root = makeGitRepo();
  assert.equal(runFixture(root, ["--update"]).code, 0);
  writeFileSync(
    resolve(root, ".github", "mirror-waivers.json"),
    `${JSON.stringify({ "does-not-exist": "stale" }, null, 2)}\n`,
  );
  const result = runFixture(root);
  assert.equal(result.code, 1);
  assert.match(result.err, /waivers name sets that do not exist: does-not-exist/);
  cleanup(root);
});

test("committed waivers are valid and name real sets", () => {
  const repoRoot = resolve(import.meta.dirname, "..", "..");
  const { waivers, errors } = loadWaivers(
    resolve(repoRoot, ".github", "mirror-waivers.json"),
  );
  assert.deepEqual(errors, []);
  const names = new Set(SYNC_SETS.map((set) => set.name));
  for (const name of Object.keys(waivers)) {
    assert.equal(names.has(name), true, `unknown waived set: ${name}`);
    assert.equal(waivers[name].reason.length > 0, true);
  }
});
