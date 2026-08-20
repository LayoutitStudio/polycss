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
  baseFileHash,
  bindWaivers,
  checkIdenticalGroups,
  checkLaneParity,
  checkSyncSets,
  computeSyncHashes,
  derivePairs,
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

/**
 * A waiver bound to the fixture's base commit. Every waiver must pin the
 * waived files' base content, so tests build it from the real hasher.
 */
function waiverEntry(root, { reason, files, expectedLanes }) {
  const baseHashes = {};
  for (const file of files) {
    baseHashes[file] = baseFileHash(root, "origin/main", file);
  }
  return { reason, files, expectedLanes, baseHashes };
}

const writeWaivers = (root, entries) =>
  writeFileSync(
    resolve(root, ".github", "mirror-waivers.json"),
    `${JSON.stringify(entries, null, 2)}\n`,
  );

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

test("an unscoped waiver no longer excuses the set", () => {
  const { failures, waived } = checkLaneParity(
    LANE_SETS,
    ["packages/react/src/scene/x.ts"],
    { s: { reason: "vanilla has no equivalent", files: null } },
  );
  assert.deepEqual(waived, []);
  assert.equal(failures.length, 1);
  assert.match(failures[0].note, /not scoped to specific files/);
});

test("a waiver without expectedLanes does not apply", () => {
  const { failures, waived } = checkLaneParity(
    LANE_SETS,
    ["packages/react/src/scene/x.ts"],
    { s: { reason: "r", files: ["packages/react/src/scene/x.ts"] } },
  );
  assert.deepEqual(waived, []);
  assert.equal(failures.length, 1);
  assert.match(failures[0].note, /expectedLanes/);
});

test("a file-scoped waiver excuses exactly the files it names", () => {
  const waivers = {
    s: {
      reason: "react caught up",
      files: ["packages/react/src/scene/x.ts"],
      expectedLanes: ["react"],
    },
  };
  const covered = checkLaneParity(
    LANE_SETS,
    ["packages/react/src/scene/x.ts"],
    waivers,
  );
  assert.deepEqual(covered.failures, []);
  assert.equal(covered.waived.length, 1);
  assert.deepEqual(covered.waived[0].expectedLanes, ["react"]);
});

test("a divergence outside the waived files still fails", () => {
  const sets = [
    {
      name: "s",
      hint: "mirror it",
      files: [
        ...LANE_SETS[0].files,
        "packages/react/src/scene/y.ts",
        "packages/vue/src/scene/y.ts",
      ],
    },
  ];
  const waivers = {
    s: {
      reason: "react caught up",
      files: ["packages/react/src/scene/x.ts"],
      expectedLanes: ["react"],
    },
  };
  const result = checkLaneParity(
    sets,
    ["packages/react/src/scene/x.ts", "packages/react/src/scene/y.ts"],
    waivers,
  );
  assert.deepEqual(result.waived, []);
  assert.equal(result.failures.length, 1);
  assert.deepEqual(result.failures[0].changedFiles, [
    "packages/react/src/scene/y.ts",
  ]);
  assert.match(result.failures[0].note, /does not name these diverging files/);
});

test("a lane pattern the waiver did not record still fails", () => {
  const waivers = {
    s: {
      reason: "react+vue caught up to vanilla",
      files: [
        "packages/react/src/scene/x.ts",
        "packages/vue/src/scene/x.ts",
      ],
      expectedLanes: ["react", "vue"],
    },
  };
  const both = checkLaneParity(
    LANE_SETS,
    ["packages/react/src/scene/x.ts", "packages/vue/src/scene/x.ts"],
    waivers,
  );
  assert.deepEqual(both.failures, []);
  assert.equal(both.waived.length, 1);

  // Same set, same waived files — but only ONE of the two lanes moved this
  // time. The waiver documented a different divergence and must not apply.
  const vueAlone = checkLaneParity(
    LANE_SETS,
    ["packages/vue/src/scene/x.ts"],
    waivers,
  );
  assert.deepEqual(vueAlone.waived, []);
  assert.equal(vueAlone.failures.length, 1);
  assert.match(vueAlone.failures[0].note, /records changed lane\(s\) react, vue/);
  assert.match(vueAlone.failures[0].note, /touched vue/);
});

test("waivers must be objects scoped to files with expected lanes", () => {
  const scoped = (extra) =>
    JSON.stringify({ s: { reason: "ok", files: ["a"], ...extra } });
  const root = makeRepo({
    "bare.json": JSON.stringify({ s: "whole set, forever" }),
    "empty.json": JSON.stringify({ s: "   " }),
    "noreason.json": JSON.stringify({ s: { files: ["a"], expectedLanes: ["vue"] } }),
    "nofiles.json": JSON.stringify({ s: { reason: "ok", expectedLanes: ["vue"] } }),
    "emptyfiles.json": JSON.stringify({
      s: { reason: "ok", files: [], expectedLanes: ["vue"] },
    }),
    "badfiles.json": JSON.stringify({
      s: { reason: "ok", files: [7], expectedLanes: ["vue"] },
    }),
    "nolanes.json": scoped({}),
    "badlane.json": scoped({ expectedLanes: ["svelte"] }),
    "good.json": JSON.stringify({
      s: { reason: "why", files: ["a"], expectedLanes: ["react", "vue"] },
    }),
  });
  const errorOf = (name) => loadWaivers(resolve(root, name)).errors[0];

  assert.match(errorOf("bare.json"), /unscoped whole-set waiver/);
  assert.match(errorOf("empty.json"), /unscoped whole-set waiver/);
  assert.match(errorOf("noreason.json"), /empty or missing "reason"/);
  assert.match(errorOf("nofiles.json"), /not scoped to specific files/);
  assert.match(errorOf("emptyfiles.json"), /not scoped to specific files/);
  assert.match(errorOf("badfiles.json"), /not scoped to specific files/);
  assert.match(errorOf("nolanes.json"), /no "expectedLanes"/);
  assert.match(errorOf("badlane.json"), /unknown lane\(s\) svelte/);

  const good = loadWaivers(resolve(root, "good.json"));
  assert.deepEqual(good.errors, []);
  assert.equal(good.waivers.s.reason, "why");
  assert.deepEqual(good.waivers.s.files, ["a"]);
  assert.deepEqual(good.waivers.s.expectedLanes, ["react", "vue"]);

  assert.deepEqual(loadWaivers(resolve(root, "absent.json")), {
    waivers: {},
    errors: [],
  });
  cleanup(root);
});

test("a bare-string waiver fails the run with a validation error", () => {
  const root = makeGitRepo();
  edit(root, "packages/react/src/scene/x.ts", "react v2\n");
  writeFileSync(
    resolve(root, ".github", "mirror-waivers.json"),
    `${JSON.stringify({ s: "react is catching up to vanilla" }, null, 2)}\n`,
  );
  assert.equal(runFixture(root, ["--update"]).code, 0);

  const result = runFixture(root);
  assert.equal(result.code, 1);
  assert.match(result.err, /invalid mirror waivers/);
  assert.match(result.err, /unscoped whole-set waiver/);
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
    resolveBaseRef(root, ["--base", "nope/nope"], {}).error,
    /cannot be resolved/,
  );
  assert.match(resolveBaseRef(root, ["--base"], {}).error, /without a ref/);
  assert.deepEqual(resolveBaseRef(root, [], { GITHUB_BASE_REF: "main" }), {
    base: head,
    source: "origin/main",
  });
  assert.equal(resolveBaseRef(root, [], {}).source, "merge-base(HEAD, origin/main)");
  cleanup(root);
});

test("a local run with no base and no remote skips loudly and exits 0", () => {
  const root = makeRepo(LANE_FILES);
  mkdirSync(resolve(root, ".github"), { recursive: true });

  const resolved = resolveBaseRef(root, [], {});
  assert.equal(resolved.skip, true);
  assert.match(resolved.reason, /no base ref could be resolved/);

  assert.equal(runFixture(root, ["--update"]).code, 0);
  const result = runFixture(root);
  assert.equal(result.code, 0);
  assert.match(result.out, /MIRROR LANE CHECK SKIPPED/);
  assert.match(result.out, /NOT ENFORCED/);
  assert.match(result.out, /fetch-depth: 0/);
  assert.match(result.out, /--require-base/);
  cleanup(root);
});

test("an explicitly requested base that cannot be resolved is an error", () => {
  const root = makeGitRepo();
  assert.equal(runFixture(root, ["--update"]).code, 0);

  const result = runFixture(root, ["--base", "does-not-exist"]);
  assert.equal(result.code, 1, "an unresolvable --base must never skip");
  assert.match(result.err, /lane check could not run/);
  assert.match(result.err, /does-not-exist/);
  assert.doesNotMatch(result.out, /SKIPPED/);
  cleanup(root);
});

test("--require-base turns an unresolvable base into an error", () => {
  const root = makeRepo(LANE_FILES);
  mkdirSync(resolve(root, ".github"), { recursive: true });
  assert.equal(runFixture(root, ["--update"]).code, 0);

  assert.match(resolveBaseRef(root, ["--require-base"], {}).error, /no base ref/);

  const result = runFixture(root, ["--require-base"]);
  assert.equal(result.code, 1);
  assert.match(result.err, /lane check could not run/);
  assert.doesNotMatch(result.out, /SKIPPED/);
  cleanup(root);
});

test("a git diff failure against a resolved base is an error, not a skip", () => {
  const root = makeGitRepo();
  assert.equal(runFixture(root, ["--update"]).code, 0);
  const head = git(root, ["rev-parse", "HEAD"]);
  const tree = git(root, ["rev-parse", "HEAD^{tree}"]);
  // The commit still resolves, but its tree is gone: `git diff` fails while
  // the base ref verifies. That must fail, not silently pass.
  rmSync(resolve(root, ".git", "objects", tree.slice(0, 2), tree.slice(2)), {
    force: true,
  });

  assert.equal(resolveBaseRef(root, ["--base", head], {}).base, head);
  const result = runFixture(root, ["--base", head]);
  assert.equal(result.code, 1);
  assert.match(result.err, /git diff.*failed/s);
  assert.doesNotMatch(result.out, /SKIPPED/);
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
  writeWaivers(root, {
    s: waiverEntry(root, {
      reason: "react is catching up to vanilla",
      files: ["packages/react/src/scene/x.ts"],
      expectedLanes: ["react"],
    }),
  });
  assert.equal(runFixture(root, ["--update"]).code, 0);

  const result = runFixture(root);
  assert.equal(result.code, 0);
  assert.match(result.out, /MIRROR WAIVER APPLIED: set "s"/);
  assert.match(result.out, /react is catching up to vanilla/);
  assert.match(result.out, /scoped to packages\/react\/src\/scene\/x\.ts/);
  cleanup(root);
});

test("end to end: a waiver does not cover a later, different divergence", () => {
  const root = makeGitRepo();
  writeWaivers(root, {
    s: waiverEntry(root, {
      reason: "react is catching up to vanilla",
      files: ["packages/react/src/scene/x.ts"],
      expectedLanes: ["react"],
    }),
  });
  // The next PR changes vue alone. Same set, same stale waiver, different
  // divergence — it must fail.
  edit(root, "packages/vue/src/scene/x.ts", "vue v2\n");
  assert.equal(runFixture(root, ["--update"]).code, 0);

  const result = runFixture(root);
  assert.equal(result.code, 1);
  assert.doesNotMatch(result.out, /MIRROR WAIVER APPLIED/);
  assert.match(result.err, /lanes changed unevenly/);
  assert.match(result.err, /records changed lane\(s\) react/);
  cleanup(root);
});

test("--update never creates or refreshes waivers", () => {
  const root = makeGitRepo();
  const waiverPath = resolve(root, ".github", "mirror-waivers.json");
  edit(root, "packages/react/src/scene/x.ts", "react v2\n");

  assert.equal(runFixture(root, ["--update"]).code, 0);
  assert.equal(existsSync(waiverPath), false, "--update must not author a waiver");

  writeWaivers(root, {
    s: waiverEntry(root, {
      reason: "declared",
      files: ["packages/react/src/scene/x.ts"],
      expectedLanes: ["react"],
    }),
  });
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
    `${JSON.stringify(
      {
        "does-not-exist": {
          reason: "stale",
          files: ["packages/react/src/scene/x.ts"],
          expectedLanes: ["react"],
        },
      },
      null,
      2,
    )}\n`,
  );
  const result = runFixture(root);
  assert.equal(result.code, 1);
  assert.match(result.err, /waivers name sets that do not exist: does-not-exist/);
  cleanup(root);
});

test("committed waivers are valid, scoped, and name real sets", () => {
  const repoRoot = resolve(import.meta.dirname, "..", "..");
  const { waivers, errors } = loadWaivers(
    resolve(repoRoot, ".github", "mirror-waivers.json"),
  );
  assert.deepEqual(errors, []);
  const setsByName = new Map(SYNC_SETS.map((set) => [set.name, set]));
  for (const [name, waiver] of Object.entries(waivers)) {
    const set = setsByName.get(name);
    assert.notEqual(set, undefined, `unknown waived set: ${name}`);
    assert.equal(waiver.reason.length > 0, true);
    assert.equal(waiver.files.length > 0, true, `waiver "${name}" is unscoped`);
    for (const file of waiver.files) {
      assert.equal(
        set.files.includes(file),
        true,
        `waiver "${name}" names ${file}, which is not in the set`,
      );
    }
    for (const lane of waiver.expectedLanes) {
      assert.equal(
        set.files.some((file) => resolveLane(file) === lane),
        true,
        `waiver "${name}" expects lane ${lane}, which the set has no files in`,
      );
    }
  }
});

test("mesh-modules covers every react↔vue scene/mesh pair on both lanes", () => {
  const set = SYNC_SETS.find((entry) => entry.name === "mesh-modules");
  assert.notEqual(set, undefined, "the mesh-modules sync set must exist");

  const lanes = partitionLanes(set.files);
  assert.deepEqual([...lanes.keys()].sort(), ["react", "vue"]);

  const basename = (file) => file.split("/").pop().replace(/\.tsx?$/, "");
  assert.deepEqual(
    lanes.get("react").map(basename).sort(),
    lanes.get("vue").map(basename).sort(),
    "every react hook under scene/mesh must have its vue counterpart listed",
  );
  assert.equal(
    lanes.get("react").some((file) => file.endsWith("useReceiverShadows.tsx")),
    true,
  );
});

test("mesh-modules: a one-lane edit fails even after re-pinning", () => {
  const meshSet = SYNC_SETS.find((entry) => entry.name === "mesh-modules");
  const root = makeGitRepo(
    Object.fromEntries(meshSet.files.map((file) => [file, `${file} v1\n`])),
  );
  const sets = [meshSet];
  const withMeshSet = { sets };

  assert.equal(runFixture(root, ["--update"], withMeshSet).code, 0);
  assert.equal(runFixture(root, [], withMeshSet).code, 0, "clean tree passes");

  const reactFile = "packages/react/src/scene/mesh/useReceiverShadows.tsx";
  edit(root, reactFile, "react receiver shadows v2\n");
  assert.equal(runFixture(root, ["--update"], withMeshSet).code, 0);

  const result = runFixture(root, [], withMeshSet);
  assert.equal(result.code, 1, "a vue-less react mesh change must fail");
  assert.match(result.err, /set: mesh-modules/);
  assert.match(result.err, /changed lane\(s\):\s+react/);
  assert.match(result.err, /unchanged lane\(s\):\s+vue/);
  assert.match(result.err, new RegExp(reactFile.replace(/\//g, "\\/")));
  cleanup(root);
});

test("pairing is declared per set, not inferred across every lane", () => {
  for (const set of SYNC_SETS) {
    assert.equal(
      Array.isArray(set.pairLanes) && set.pairLanes.length > 0,
      true,
      `set "${set.name}" must declare pairLanes`,
    );
  }
  const atlas = SYNC_SETS.find((entry) => entry.name === "atlas-pipeline");
  assert.deepEqual(atlas.pairLanes, ["react", "vue"]);
  for (const pair of derivePairs(atlas.files, atlas.pairLanes)) {
    assert.deepEqual([...pair.lanes.keys()].sort(), ["react", "vue"]);
  }
});

test("atlas-pipeline does not pair the vanilla lane by file name", () => {
  // Real change from this PR: React/Vue mirrored the projective-quad guard
  // default into paintDefaults.ts, while vanilla carries the same semantics in
  // plan.ts. Pairing that lane by basename reports mirrored work as diverged.
  const atlas = SYNC_SETS.find((entry) => entry.name === "atlas-pipeline");
  const { failures } = checkLaneParity(
    [atlas],
    [
      "packages/react/src/scene/atlas/paintDefaults.ts",
      "packages/vue/src/scene/atlas/paintDefaults.ts",
      "packages/polycss/src/render/atlas/plan.ts",
    ],
  );
  assert.deepEqual(failures, []);
});

test("mesh-modules: unrelated one-lane edits in each lane do not cancel out", () => {
  // The reported bypass: set-wide lane parity sees both lanes "touched" and
  // passes, though neither edit was mirrored.
  const meshSet = SYNC_SETS.find((entry) => entry.name === "mesh-modules");
  const { failures } = checkLaneParity(
    [meshSet],
    [
      "packages/react/src/scene/mesh/useReceiverShadows.tsx",
      "packages/vue/src/scene/mesh/useMeshEvents.ts",
    ],
  );
  assert.equal(failures.length, 2);
  assert.deepEqual(
    failures.map((failure) => failure.pair).sort(),
    ["useMeshEvents", "useReceiverShadows"],
  );
});

test("mesh-modules: a correctly mirrored pair passes", () => {
  const meshSet = SYNC_SETS.find((entry) => entry.name === "mesh-modules");
  const { failures, waived } = checkLaneParity(
    [meshSet],
    [
      "packages/react/src/scene/mesh/useReceiverShadows.tsx",
      "packages/vue/src/scene/mesh/useReceiverShadows.ts",
    ],
  );
  assert.deepEqual(failures, []);
  assert.deepEqual(waived, []);
});

test("mesh-modules: a one-lane edit fails even once both lanes are touched", () => {
  // useMeshAtlas is mirrored properly, so both lanes are already "touched";
  // the useStableDom straggler must still be caught.
  const meshSet = SYNC_SETS.find((entry) => entry.name === "mesh-modules");
  const { failures } = checkLaneParity(
    [meshSet],
    [
      "packages/react/src/scene/mesh/useMeshAtlas.ts",
      "packages/vue/src/scene/mesh/useMeshAtlas.ts",
      "packages/react/src/scene/mesh/useStableDom.ts",
    ],
  );
  assert.equal(failures.length, 1);
  assert.equal(failures[0].pair, "useStableDom");
  assert.deepEqual(failures[0].changed, ["react"]);
  assert.deepEqual(failures[0].unchanged, ["vue"]);
});

test("baseHashes must be a hash map covering only the waived files", () => {
  const entry = (baseHashes) =>
    JSON.stringify({
      s: { reason: "r", files: ["a"], expectedLanes: ["vue"], baseHashes },
    });
  const root = makeRepo({
    "notobj.json": entry("nope"),
    "badhash.json": entry({ a: "zz" }),
    "extra.json": entry({ a: "0".repeat(64), b: "1".repeat(64) }),
    "ok.json": entry({ a: "<absent>" }),
  });
  const errorOf = (name) => loadWaivers(resolve(root, name)).errors[0];

  assert.match(errorOf("notobj.json"), /not an object mapping/);
  assert.match(errorOf("badhash.json"), /malformed "baseHashes"/);
  assert.match(errorOf("extra.json"), /not in its "files" list/);
  assert.deepEqual(loadWaivers(resolve(root, "ok.json")).errors, []);
  cleanup(root);
});

test("a waiver already merged at the base ref no longer applies", () => {
  const root = makeGitRepo();
  const entry = waiverEntry(root, {
    reason: "reviewed once, last month",
    files: ["packages/react/src/scene/x.ts"],
    expectedLanes: ["react"],
  });
  writeWaivers(root, { s: entry });
  git(root, ["add", "."]);
  git(root, ["commit", "--quiet", "-m", "merge the waiver"]);
  git(root, ["update-ref", "refs/remotes/origin/main", "HEAD"]);

  const base = git(root, ["rev-parse", "origin/main"]);
  const { applicable, rejections } = bindWaivers(root, base, { s: entry });
  assert.deepEqual(applicable, {});
  assert.match(rejections.get("s").reason, /identical to the one already at the base ref/);
  assert.match(rejections.get("s").reason, /does not carry over to later work/);
  cleanup(root);
});

test("a waiver binds to the base content it names", () => {
  const root = makeGitRepo();
  const base = git(root, ["rev-parse", "origin/main"]);
  const file = "packages/react/src/scene/x.ts";
  const fresh = waiverEntry(root, {
    reason: "declared for this diff",
    files: [file],
    expectedLanes: ["react"],
  });

  const bound = bindWaivers(root, base, { s: fresh });
  assert.deepEqual(Object.keys(bound.applicable), ["s"]);
  assert.equal(bound.rejections.size, 0);

  const { baseHashes, ...withoutHashes } = fresh;
  const missing = bindWaivers(root, base, { s: withoutHashes });
  assert.deepEqual(missing.applicable, {});
  assert.match(missing.rejections.get("s").reason, /no "baseHashes"/);
  assert.equal(missing.rejections.get("s").expectedHashes[file], baseHashes[file]);

  const wrong = bindWaivers(root, base, {
    s: { ...fresh, baseHashes: { [file]: "0".repeat(64) } },
  });
  assert.deepEqual(wrong.applicable, {});
  assert.match(wrong.rejections.get("s").reason, /no longer match the waived files/);

  assert.equal(baseFileHash(root, base, "packages/nope/gone.ts"), "<absent>");
  cleanup(root);
});

test("end to end: a merged waiver does not authorize the next PR's divergence", () => {
  const root = makeGitRepo();
  const files = ["packages/react/src/scene/x.ts", "packages/vue/src/scene/x.ts"];

  // The divergence and its waiver are reviewed, merged, and now sit on main.
  edit(root, files[0], "react v2\n");
  edit(root, files[1], "vue v2\n");
  writeWaivers(root, {
    s: waiverEntry(root, {
      reason: "react+vue caught up to vanilla",
      files,
      expectedLanes: ["react", "vue"],
    }),
  });
  assert.equal(runFixture(root, ["--update"]).code, 0);
  git(root, ["add", "."]);
  git(root, ["commit", "--quiet", "-m", "merged divergence + waiver"]);
  git(root, ["update-ref", "refs/remotes/origin/main", "HEAD"]);

  // A follow-up PR changes the same files in the same lane pattern and never
  // opens mirror-waivers.json. That is new, unreviewed divergence.
  edit(root, files[0], "react v3\n");
  edit(root, files[1], "vue v3\n");
  assert.equal(runFixture(root, ["--update"]).code, 0);

  const result = runFixture(root, ["--require-base"]);
  assert.equal(result.code, 1, "a merged waiver must not excuse later work");
  assert.doesNotMatch(result.out, /MIRROR WAIVER APPLIED/);
  assert.match(result.err, /WAIVER REJECTED/);
  assert.match(result.err, /does not carry over to later work/);
  assert.match(result.err, /Re-justify it with a FRESH entry/);
  assert.match(result.err, /"baseHashes"/);
  cleanup(root);
});

test("committed waivers pin the base content of every file they name", () => {
  const repoRoot = resolve(import.meta.dirname, "..", "..");
  const { waivers } = loadWaivers(
    resolve(repoRoot, ".github", "mirror-waivers.json"),
  );
  for (const [name, waiver] of Object.entries(waivers)) {
    assert.notEqual(waiver.baseHashes, undefined, `waiver "${name}" has no baseHashes`);
    for (const file of waiver.files) {
      assert.match(
        waiver.baseHashes[file] ?? "",
        /^([0-9a-f]{64}|<absent>)$/,
        `waiver "${name}" does not pin ${file}`,
      );
    }
  }
});
