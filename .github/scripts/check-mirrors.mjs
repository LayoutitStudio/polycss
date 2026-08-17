/**
 * Enforces the three-way renderer copy discipline from AGENTS.md
 * ("Renderer-owned browser glue"): the canvas atlas pipeline, feature
 * detection, voxel renderer, base styles, and a few pure helpers exist as
 * independent copies in packages/polycss, packages/react, and packages/vue.
 * A fix in one copy MUST land in the others — historically that rule lived
 * only in a PR checklist, and it failed silently (unmirrored fixes shipped).
 *
 * Three enforcement modes:
 *
 * - IDENTICAL groups: files that must stay byte-for-byte equal (the react↔vue
 *   clones). Any divergence fails.
 *
 * - SYNC sets: files that mirror each other *semantically* but not textually
 *   (vanilla↔react/vue). Their content hashes are pinned in
 *   .github/mirror-lock.json. Editing any file in a set fails CI until the
 *   author re-pins with `pnpm check:mirrors --update`. The lock proves the
 *   tree matches what was reviewed; on its own it does NOT prove the change
 *   was mirrored, because `--update` regenerates it from the current tree.
 *
 * - LANE PARITY: the part that actually enforces mirroring. Each sync set is
 *   partitioned into renderer lanes (packages/polycss, packages/react,
 *   packages/vue) and compared against a base ref. If one lane changed and
 *   another lane in the same set did not, the check fails — re-pinning the
 *   lock cannot launder it, because the lock is not consulted here.
 *   Intentional per-renderer divergence is declared in
 *   .github/mirror-waivers.json, which `--update` never writes, so a waiver
 *   is always visible in the PR diff.
 *
 * Run: `node .github/scripts/check-mirrors.mjs [--update] [--base <ref>]`
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** Files that must be byte-identical. First entry is the reference copy. */
export const IDENTICAL_GROUPS = [
  {
    name: "voxel-renderer (react↔vue)",
    files: [
      "packages/react/src/scene/voxelRenderer.ts",
      "packages/vue/src/scene/voxelRenderer.ts",
    ],
  },
  {
    name: "atlas buildAtlasPages (react↔vue)",
    files: [
      "packages/react/src/scene/atlas/buildAtlasPages.ts",
      "packages/vue/src/scene/atlas/buildAtlasPages.ts",
    ],
  },
  {
    name: "atlas detection (react↔vue)",
    files: [
      "packages/react/src/scene/atlas/detection.ts",
      "packages/vue/src/scene/atlas/detection.ts",
    ],
  },
  {
    name: "atlas filterPlans (react↔vue)",
    files: [
      "packages/react/src/scene/atlas/filterPlans.ts",
      "packages/vue/src/scene/atlas/filterPlans.ts",
    ],
  },
  {
    name: "atlas packing (react↔vue)",
    files: [
      "packages/react/src/scene/atlas/packing.ts",
      "packages/vue/src/scene/atlas/packing.ts",
    ],
  },
  {
    name: "atlas paintDefaults (react↔vue)",
    files: [
      "packages/react/src/scene/atlas/paintDefaults.ts",
      "packages/vue/src/scene/atlas/paintDefaults.ts",
    ],
  },
  {
    name: "three subpath index (react↔vue)",
    files: [
      "packages/react/src/three/index.ts",
      "packages/vue/src/three/index.ts",
    ],
  },
  {
    name: "PolyCamera alias (react↔vue)",
    files: [
      "packages/react/src/camera/PolyCamera.tsx",
      "packages/vue/src/camera/PolyCamera.ts",
    ],
  },
  {
    name: "helpers index (react↔vue)",
    files: [
      "packages/react/src/helpers/index.ts",
      "packages/vue/src/helpers/index.ts",
    ],
  },
];

/**
 * Semantically-mirrored sets whose copies are structurally different.
 * Hashes are pinned in mirror-lock.json; any edit requires --update.
 * Lane parity (below) is what proves the edit reached every renderer.
 */
export const SYNC_SETS = [
  {
    name: "atlas-pipeline",
    hint:
      "The canvas atlas pipeline is copied per renderer (AGENTS.md). A change " +
      "to any of these files must be mirrored into the other two renderers.",
    files: [
      "packages/polycss/src/render/atlas/emit.ts",
      "packages/polycss/src/render/atlas/packing.ts",
      "packages/polycss/src/render/atlas/paintDefaults.ts",
      "packages/polycss/src/render/atlas/plan.ts",
      "packages/polycss/src/render/atlas/rasterise.ts",
      "packages/polycss/src/render/atlas/renderPolygons.ts",
      "packages/polycss/src/render/atlas/solidTrianglePlan.ts",
      "packages/polycss/src/render/atlas/stableTriangle.ts",
      "packages/polycss/src/render/atlas/strategy.ts",
      "packages/react/src/scene/atlas/buildAtlasPages.ts",
      "packages/react/src/scene/atlas/detection.ts",
      "packages/react/src/scene/atlas/filterPlans.ts",
      "packages/react/src/scene/atlas/packing.ts",
      "packages/react/src/scene/atlas/paintDefaults.ts",
      "packages/react/src/scene/atlas/solidTriangleStyle.ts",
      "packages/react/src/scene/atlas/stableTriangleDom.ts",
      "packages/vue/src/scene/atlas/buildAtlasPages.ts",
      "packages/vue/src/scene/atlas/detection.ts",
      "packages/vue/src/scene/atlas/filterPlans.ts",
      "packages/vue/src/scene/atlas/packing.ts",
      "packages/vue/src/scene/atlas/paintDefaults.ts",
      "packages/vue/src/scene/atlas/solidTriangleStyle.ts",
      "packages/vue/src/scene/atlas/stableTriangleDom.ts",
    ],
  },
  {
    name: "voxel-renderer",
    hint:
      "The direct voxel renderer is copied per renderer (AGENTS.md). A change " +
      "to one copy must land in the other two in the same PR.",
    files: [
      "packages/polycss/src/render/voxelRenderer.ts",
      "packages/react/src/scene/voxelRenderer.ts",
      "packages/vue/src/scene/voxelRenderer.ts",
    ],
  },
  {
    name: "base-styles",
    hint:
      "The injected .polycss-scene/.polycss-camera base styles exist per " +
      "renderer. CSS rules must cover every emitted tag for both lighting " +
      "modes in all three copies (AGENTS.md checklist).",
    files: [
      "packages/polycss/src/styles/styles.ts",
      "packages/react/src/styles/styles.ts",
      "packages/vue/src/styles/styles.ts",
    ],
  },
];

/** Renderer packages that form the parity lanes. */
export const RENDERER_LANES = ["polycss", "react", "vue"];

const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");

export function checkIdenticalGroups(root, groups) {
  const failures = [];
  for (const group of groups) {
    const contents = group.files.map((file) => {
      const abs = resolve(root, file);
      if (!existsSync(abs)) return { file, missing: true };
      return { file, hash: sha256(readFileSync(abs)) };
    });
    const missing = contents.filter((c) => c.missing);
    if (missing.length > 0) {
      failures.push({
        group: group.name,
        reason: `missing file(s): ${missing.map((m) => m.file).join(", ")}`,
      });
      continue;
    }
    const reference = contents[0];
    const diverged = contents.slice(1).filter((c) => c.hash !== reference.hash);
    if (diverged.length > 0) {
      failures.push({
        group: group.name,
        reason:
          `copies diverged from ${reference.file}: ` +
          diverged.map((d) => d.file).join(", "),
      });
    }
  }
  return failures;
}

export function computeSyncHashes(root, sets) {
  const lock = {};
  for (const set of sets) {
    lock[set.name] = {};
    for (const file of set.files) {
      const abs = resolve(root, file);
      lock[set.name][file] = existsSync(abs)
        ? sha256(readFileSync(abs))
        : "<missing>";
    }
  }
  return lock;
}

export function checkSyncSets(root, sets, lock) {
  const failures = [];
  for (const set of sets) {
    const pinned = lock[set.name];
    if (!pinned) {
      failures.push({
        set: set.name,
        files: set.files,
        reason: "set is not pinned in mirror-lock.json",
        hint: set.hint,
      });
      continue;
    }
    const current = computeSyncHashes(root, [set])[set.name];
    const changed = set.files.filter((file) => pinned[file] !== current[file]);
    const stale = Object.keys(pinned).filter(
      (file) => !set.files.includes(file),
    );
    if (changed.length > 0 || stale.length > 0) {
      failures.push({ set: set.name, files: changed, stale, hint: set.hint });
    }
  }
  return failures;
}

function git(root, args) {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
  if (result.error || result.status !== 0) return null;
  return result.stdout.trim();
}

const verifyRef = (root, ref) => git(root, ["rev-parse", "--verify", `${ref}^{commit}`]);

/**
 * Base resolution order: --base <ref> → origin/$GITHUB_BASE_REF → merge-base
 * with origin/main → origin/main. A checkout that resolves none of these
 * (shallow clone, no remote) SKIPS the lane check loudly instead of passing.
 */
export function resolveBaseRef(root, argv = [], env = process.env) {
  const flagIndex = argv.indexOf("--base");
  if (flagIndex !== -1) {
    const ref = argv[flagIndex + 1];
    if (!ref || ref.startsWith("--")) {
      return { skip: true, reason: "--base was passed without a ref" };
    }
    const resolved = verifyRef(root, ref);
    if (!resolved) {
      return {
        skip: true,
        reason: `--base ref "${ref}" cannot be resolved in this checkout`,
      };
    }
    return { base: resolved, source: `--base ${ref}` };
  }

  if (env.GITHUB_BASE_REF) {
    const ref = `origin/${env.GITHUB_BASE_REF}`;
    const resolved = verifyRef(root, ref);
    if (resolved) return { base: resolved, source: ref };
  }

  const mergeBase = git(root, ["merge-base", "HEAD", "origin/main"]);
  if (mergeBase) return { base: mergeBase, source: "merge-base(HEAD, origin/main)" };

  const originMain = verifyRef(root, "origin/main");
  if (originMain) return { base: originMain, source: "origin/main" };

  return {
    skip: true,
    reason:
      "no base ref could be resolved (no --base, no usable GITHUB_BASE_REF, " +
      "no origin/main). Shallow clone or missing remote? CI must check out " +
      "with fetch-depth: 0.",
  };
}

/** Repo-relative paths changed between `base` and the working tree. */
export function changedFilesSince(root, base) {
  const out = git(root, ["diff", "--name-only", base, "--"]);
  if (out === null) return null;
  return out.length === 0 ? [] : out.split("\n").filter(Boolean);
}

export function resolveLane(file) {
  const match = /^packages\/([^/]+)\//.exec(file);
  if (!match) return null;
  return RENDERER_LANES.includes(match[1]) ? match[1] : null;
}

export function partitionLanes(files) {
  const lanes = new Map();
  for (const file of files) {
    const lane = resolveLane(file);
    if (!lane) continue;
    if (!lanes.has(lane)) lanes.set(lane, []);
    lanes.get(lane).push(file);
  }
  return lanes;
}

/**
 * A waiver is `"<set>": "<reason>"` or
 * `"<set>": { "reason": "...", "files": ["..."] }`. An empty reason is an
 * error, not a waiver — the point is that the divergence is explained.
 */
export function loadWaivers(waiverPath) {
  if (!existsSync(waiverPath)) return { waivers: {}, errors: [] };
  let raw;
  try {
    raw = JSON.parse(readFileSync(waiverPath, "utf8"));
  } catch (error) {
    return { waivers: {}, errors: [`mirror-waivers.json is not valid JSON: ${error.message}`] };
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { waivers: {}, errors: ["mirror-waivers.json must be a JSON object"] };
  }
  const waivers = {};
  const errors = [];
  for (const [name, value] of Object.entries(raw)) {
    if (typeof value === "string") {
      if (value.trim().length === 0) {
        errors.push(`waiver "${name}" has an empty reason`);
        continue;
      }
      waivers[name] = { reason: value.trim(), files: null };
      continue;
    }
    if (
      value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      typeof value.reason === "string" &&
      value.reason.trim().length > 0
    ) {
      const files = value.files;
      if (
        files !== undefined &&
        (!Array.isArray(files) || files.some((f) => typeof f !== "string"))
      ) {
        errors.push(`waiver "${name}" has a non string-array "files"`);
        continue;
      }
      waivers[name] = {
        reason: value.reason.trim(),
        files: Array.isArray(files) && files.length > 0 ? files : null,
      };
      continue;
    }
    errors.push(
      `waiver "${name}" must be a non-empty reason string, or an object with a ` +
        "non-empty \"reason\" (and optional \"files\")",
    );
  }
  return { waivers, errors };
}

/**
 * Fails when a set's renderer lanes changed unevenly. Waived sets are
 * reported rather than failed; a file-scoped waiver only excuses the files it
 * names, so any other uneven change in the same set still fails.
 */
export function checkLaneParity(sets, changedFiles, waivers = {}) {
  const changed = new Set(changedFiles);
  const failures = [];
  const waived = [];

  for (const set of sets) {
    const lanes = partitionLanes(set.files);
    if (lanes.size < 2) continue;

    const classify = (exclude) => {
      const changedLanes = [];
      const unchangedLanes = [];
      for (const [lane, files] of lanes) {
        const touched = files.some(
          (file) => changed.has(file) && !exclude?.has(file),
        );
        (touched ? changedLanes : unchangedLanes).push(lane);
      }
      return { changedLanes, unchangedLanes };
    };
    const isUneven = (r) => r.changedLanes.length > 0 && r.unchangedLanes.length > 0;

    const touchedFiles = (result, exclude) =>
      result.changedLanes.flatMap((lane) =>
        lanes.get(lane).filter((file) => changed.has(file) && !exclude?.has(file)),
      );

    const raw = classify(null);
    if (!isUneven(raw)) continue;

    const waiver = waivers[set.name];
    if (!waiver) {
      failures.push({
        set: set.name,
        changed: raw.changedLanes,
        unchanged: raw.unchangedLanes,
        changedFiles: touchedFiles(raw, null),
        hint: set.hint,
      });
      continue;
    }

    if (!waiver.files) {
      waived.push({
        set: set.name,
        reason: waiver.reason,
        files: null,
        changed: raw.changedLanes,
        unchanged: raw.unchangedLanes,
      });
      continue;
    }

    const scoped = classify(new Set(waiver.files));
    if (!isUneven(scoped)) {
      waived.push({
        set: set.name,
        reason: waiver.reason,
        files: waiver.files,
        changed: raw.changedLanes,
        unchanged: raw.unchangedLanes,
      });
      continue;
    }
    failures.push({
      set: set.name,
      changed: scoped.changedLanes,
      unchanged: scoped.unchangedLanes,
      changedFiles: touchedFiles(scoped, new Set(waiver.files)),
      hint: set.hint,
      note:
        "a file-scoped waiver exists for this set but does not cover these " +
        "changes",
    });
  }

  return { failures, waived };
}

export function run(argv = [], options = {}) {
  const root = options.root ?? repoRoot;
  const groups = options.groups ?? IDENTICAL_GROUPS;
  const sets = options.sets ?? SYNC_SETS;
  const lockPath = options.lockPath ?? resolve(root, ".github", "mirror-lock.json");
  const waiverPath =
    options.waiverPath ?? resolve(root, ".github", "mirror-waivers.json");
  const env = options.env ?? process.env;
  const log = options.log ?? console.log;
  const err = options.error ?? console.error;

  const identicalFailures = checkIdenticalGroups(root, groups);
  if (identicalFailures.length > 0) {
    err("Mirror check failed — byte-identical copies diverged:\n");
    for (const failure of identicalFailures) {
      err(`  ${failure.group}\n    ${failure.reason}\n`);
    }
    err(
      "These copies must stay byte-for-byte equal. Apply the same change to " +
        "every file in the group (AGENTS.md → Renderer-owned browser glue).",
    );
    return 1;
  }

  if (argv.includes("--update")) {
    // Deliberately never touches mirror-waivers.json: a waiver must be an
    // explicit, reviewable edit in the PR diff.
    const lock = computeSyncHashes(root, sets);
    writeFileSync(lockPath, `${JSON.stringify(lock, null, 2)}\n`);
    log(`Pinned ${sets.length} mirror sets to ${lockPath}`);
    return 0;
  }

  let failed = false;

  if (!existsSync(lockPath)) {
    err(`Missing ${lockPath}. Run \`pnpm check:mirrors --update\` and commit it.`);
    failed = true;
  } else {
    const lock = JSON.parse(readFileSync(lockPath, "utf8"));
    const syncFailures = checkSyncSets(root, sets, lock);
    if (syncFailures.length > 0) {
      failed = true;
      err("Mirror check failed — pinned mirror sets changed:\n");
      for (const failure of syncFailures) {
        err(`  set: ${failure.set}`);
        for (const file of failure.files ?? []) err(`    changed: ${file}`);
        for (const file of failure.stale ?? []) err(`    stale pin: ${file}`);
        if (failure.hint) err(`    ${failure.hint}`);
        err("");
      }
      err(
        "If the change is already mirrored into every renderer copy, re-pin " +
          "with `pnpm check:mirrors --update` and commit mirror-lock.json.",
      );
    }
  }

  const { waivers, errors: waiverErrors } = loadWaivers(waiverPath);
  if (waiverErrors.length > 0) {
    failed = true;
    err("Mirror check failed — invalid mirror waivers:\n");
    for (const message of waiverErrors) err(`  ${message}`);
    err("");
  }
  const setNames = new Set(sets.map((set) => set.name));
  const unknownWaivers = Object.keys(waivers).filter((name) => !setNames.has(name));
  if (unknownWaivers.length > 0) {
    failed = true;
    err(
      "Mirror check failed — waivers name sets that do not exist: " +
        `${unknownWaivers.join(", ")}\n`,
    );
  }

  const base = resolveBaseRef(root, argv, env);
  if (base.skip) {
    log(`MIRROR LANE CHECK SKIPPED: ${base.reason}`);
  } else {
    const changedFiles = changedFilesSince(root, base.base);
    if (changedFiles === null) {
      log(
        "MIRROR LANE CHECK SKIPPED: `git diff` against " +
          `${base.source} failed in this checkout.`,
      );
    } else {
      const { failures, waived } = checkLaneParity(sets, changedFiles, waivers);
      for (const entry of waived) {
        log(
          `MIRROR WAIVER APPLIED: set "${entry.set}" — changed lane(s) ` +
            `${entry.changed.join(", ")}, unchanged lane(s) ` +
            `${entry.unchanged.join(", ")}` +
            (entry.files ? ` (scoped to ${entry.files.join(", ")})` : "") +
            `\n  reason: ${entry.reason}`,
        );
      }
      if (failures.length > 0) {
        failed = true;
        err(
          "Mirror check failed — renderer lanes changed unevenly against " +
            `${base.source}:\n`,
        );
        for (const failure of failures) {
          err(`  set: ${failure.set}`);
          err(`    changed lane(s):   ${failure.changed.join(", ")}`);
          err(`    unchanged lane(s): ${failure.unchanged.join(", ")}`);
          for (const file of failure.changedFiles ?? []) err(`    changed: ${file}`);
          if (failure.note) err(`    ${failure.note}`);
          if (failure.hint) err(`    ${failure.hint}`);
          err("");
        }
        err(
          "Mirror the change into every renderer lane, or declare the " +
            "divergence in .github/mirror-waivers.json with a reason " +
            "(re-pinning mirror-lock.json does NOT satisfy this check).",
        );
      }
    }
  }

  if (failed) return 1;
  log("Mirror check passed.");
  return 0;
}

const isDirectRun =
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) process.exit(run(process.argv.slice(2)));
