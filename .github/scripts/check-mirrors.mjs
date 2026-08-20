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
 *   compared against a base ref at two granularities. Per mirrored PAIR (the
 *   same file name in two lanes — `useReceiverShadows.tsx` ↔ `.ts`): if one
 *   member moved, its counterpart must have moved in the same diff. Per SET
 *   lane partition, for the members that have no counterpart. A set-wide lane
 *   check alone is not enough — it collapses each lane to one boolean, so two
 *   unrelated one-lane edits mark both lanes touched and pass. Re-pinning the
 *   lock cannot launder either check, because the lock is not consulted here.
 *
 *   Intentional per-renderer divergence is declared in
 *   .github/mirror-waivers.json, which `--update` never writes. Each waiver
 *   authorizes ONE reviewed divergence: it must differ from the entry at the
 *   base ref, and its `baseHashes` must match the waived files' base content.
 *   A merged waiver therefore cannot silently excuse later work.
 *
 * The lane check must not be able to disable itself. An explicit `--base` that
 * does not resolve, and a `git diff` that fails once a base HAS resolved, are
 * hard errors. `--require-base` (used by CI) turns "no base resolvable at all"
 * into an error too. The only surviving skip is a local developer run with no
 * `--base`, no GITHUB_BASE_REF and no origin/main, and it shouts.
 *
 * Run: `node .github/scripts/check-mirrors.mjs [--update] [--base <ref>]
 *       [--require-base]`
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
    // react↔vue only: the vanilla lane splits this work into different files
    // (plan.ts, strategy.ts, renderPolygons.ts), so its same-named members are
    // not per-file counterparts. See derivePairs.
    pairLanes: ["react", "vue"],
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
    // One file per renderer, same name, genuine per-file copies.
    pairLanes: ["polycss", "react", "vue"],
    hint:
      "The direct voxel renderer is copied per renderer (AGENTS.md). A change " +
      "to one copy must land in the other two in the same PR.",
    files: [
      "packages/polycss/src/render/voxelRenderer.ts",
      "packages/react/src/scene/voxelRenderer.ts",
      "packages/vue/src/scene/voxelRenderer.ts",
    ],
  },
  // Deliberately two lanes only. The vanilla counterparts in
  // packages/polycss/src/api/scene/* are not per-file copies of these
  // composables — they are an imperative orchestration split (mountSync,
  // shadowOrchestrator, shadowCache) with no 1:1 mapping to a hook. Listing
  // them as a third lane would fire on every vanilla-only refactor.
  {
    name: "mesh-modules",
    // Exact 1:1 hook↔composable counterparts, differing only in extension.
    pairLanes: ["react", "vue"],
    hint:
      "The React hooks and Vue composables under scene/mesh/ are mirrored " +
      "pairs (AGENTS.md → Cross-package discipline). They hold the shadow " +
      "caches, receiver/caster registration, the followAnimation throttle, " +
      "atlas and stable-DOM state — a fix in one lane must land in the other.",
    files: [
      "packages/react/src/scene/mesh/useGroundShadow.tsx",
      "packages/react/src/scene/mesh/useMeshAtlas.ts",
      "packages/react/src/scene/mesh/useMeshEvents.ts",
      "packages/react/src/scene/mesh/useMeshGeometry.ts",
      "packages/react/src/scene/mesh/useMeshLighting.ts",
      "packages/react/src/scene/mesh/useReceiverShadows.tsx",
      "packages/react/src/scene/mesh/useStableDom.ts",
      "packages/react/src/scene/mesh/useVoxelFastPath.ts",
      "packages/vue/src/scene/mesh/useGroundShadow.ts",
      "packages/vue/src/scene/mesh/useMeshAtlas.ts",
      "packages/vue/src/scene/mesh/useMeshEvents.ts",
      "packages/vue/src/scene/mesh/useMeshGeometry.ts",
      "packages/vue/src/scene/mesh/useMeshLighting.ts",
      "packages/vue/src/scene/mesh/useReceiverShadows.ts",
      "packages/vue/src/scene/mesh/useStableDom.ts",
      "packages/vue/src/scene/mesh/useVoxelFastPath.ts",
    ],
  },
  {
    name: "base-styles",
    // One styles.ts per renderer, same name, genuine per-file copies.
    pairLanes: ["polycss", "react", "vue"],
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
 * with origin/main → origin/main.
 *
 * Returns `{ base, source }`, `{ error }` (hard failure), or `{ skip, reason }`.
 * An explicitly requested `--base` that does not resolve is an ERROR — the
 * author asked for a specific comparison and did not get it, so passing would
 * be a lie. With `--require-base`, failing to resolve any base is an error too;
 * CI passes that flag so the pipeline can never silently drop lane parity.
 */
export function resolveBaseRef(root, argv = [], env = process.env) {
  const flagIndex = argv.indexOf("--base");
  if (flagIndex !== -1) {
    const ref = argv[flagIndex + 1];
    if (!ref || ref.startsWith("--")) {
      return { error: "--base was passed without a ref" };
    }
    const resolved = verifyRef(root, ref);
    if (!resolved) {
      return {
        error: `--base ref "${ref}" cannot be resolved in this checkout`,
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

  const reason =
    "no base ref could be resolved (no --base, no usable GITHUB_BASE_REF, " +
    "no origin/main). Shallow clone or missing remote? CI must check out " +
    "with fetch-depth: 0.";
  if (argv.includes("--require-base")) return { error: reason };
  return { skip: true, reason };
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

/** `useReceiverShadows.tsx` and `useReceiverShadows.ts` share this key. */
const pairKey = (file) => file.split("/").pop().replace(/\.[^.]+$/, "");

/**
 * Semantic PAIRS inside a set: same-named files across the lanes the set
 * declares as file-for-file mirrors (`pairLanes`).
 *
 * Pairs must be validated INDEPENDENTLY, because the set-wide lane check
 * collapses each lane to a single "touched" boolean: editing React
 * `useReceiverShadows` and, separately, Vue `useMeshEvents` marks both lanes
 * touched and passes, though nothing was mirrored. Worse, once both lanes are
 * touched by anything, every further one-lane edit in the set is invisible.
 *
 * Pairing is DECLARED per set, not inferred across every lane, because a
 * shared file name is not proof of a counterpart. `atlas-pipeline` pairs
 * react↔vue only: the vanilla lane splits the same work differently
 * (`plan.ts`, `strategy.ts`, `renderPolygons.ts` have no React/Vue file), and
 * the two names it does share are not reliable counterparts — the
 * projective-quad guard default lives in vanilla's `plan.ts` but in React/Vue's
 * `paintDefaults.ts`, so basename-pairing that lane reports a mirrored change
 * as a divergence. Files outside `pairLanes`, and names present in only one
 * paired lane, keep the set-wide lane treatment, which still fires when such a
 * file is the only thing that moved.
 *
 * The residual gap is deliberate and worth stating: an unmirrored vanilla↔
 * React/Vue atlas fix is caught only while no OTHER file in the vanilla lane
 * changed. Closing it needs a real per-file mapping for that set, which does
 * not exist today; inventing one produces false failures on correctly mirrored
 * work, which is strictly worse than the set-wide check.
 */
export function derivePairs(files, pairLanes) {
  const allowed = pairLanes ? new Set(pairLanes) : null;
  const byKey = new Map();
  for (const file of files) {
    const lane = resolveLane(file);
    if (!lane) continue;
    if (allowed && !allowed.has(lane)) continue;
    const key = pairKey(file);
    if (!byKey.has(key)) byKey.set(key, new Map());
    const lanes = byKey.get(key);
    if (!lanes.has(lane)) lanes.set(lane, []);
    lanes.get(lane).push(file);
  }
  const pairs = [];
  for (const [key, lanes] of byKey) {
    if (lanes.size > 1) pairs.push({ key, lanes });
  }
  return pairs;
}

const SCOPE_HELP =
  'every waiver must be an object with a non-empty "reason", a non-empty ' +
  '"files" array naming the exact diverging files, a non-empty ' +
  '"expectedLanes" array naming the lanes that changed (' +
  `${RENDERER_LANES.join(", ")}), and a "baseHashes" map pinning each waived ` +
  "file's content at the base ref";

const isStringArray = (value) =>
  Array.isArray(value) &&
  value.length > 0 &&
  value.every((entry) => typeof entry === "string" && entry.trim().length > 0);

/** sha256 hex, or the sentinel for "this file does not exist at the base". */
export const ABSENT_AT_BASE = "<absent>";
const isBaseHash = (value) =>
  typeof value === "string" &&
  (value === ABSENT_AT_BASE || /^[0-9a-f]{64}$/.test(value));

/**
 * A waiver is `"<set>": { "reason", "files", "expectedLanes", "baseHashes" }`.
 *
 * All four fields are mandatory (`baseHashes` is enforced in `bindWaivers`,
 * which can compute the correct values to print). Whole-set waivers (a bare
 * reason string, or an object without `files`) are rejected: they never
 * expire, cover files that did not exist when they were written, and silently
 * excuse any future divergence in the set. `files` pins WHICH files may
 * diverge, `expectedLanes` pins the SHAPE of the divergence, and `baseHashes`
 * pins the exact content the divergence started from.
 */
export function parseWaivers(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { waivers: {}, errors: ["mirror-waivers.json must be a JSON object"] };
  }
  const waivers = {};
  const errors = [];
  for (const [name, value] of Object.entries(raw)) {
    if (typeof value === "string") {
      errors.push(
        `waiver "${name}" is an unscoped whole-set waiver (a bare reason ` +
          `string). Scope it: ${SCOPE_HELP}.`,
      );
      continue;
    }
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      errors.push(`waiver "${name}" must be an object — ${SCOPE_HELP}.`);
      continue;
    }
    if (typeof value.reason !== "string" || value.reason.trim().length === 0) {
      errors.push(`waiver "${name}" has an empty or missing "reason"`);
      continue;
    }
    if (!isStringArray(value.files)) {
      errors.push(
        `waiver "${name}" is not scoped to specific files. Add a non-empty ` +
          '"files" array naming the exact files that diverge — unscoped ' +
          "whole-set waivers excuse future divergence forever.",
      );
      continue;
    }
    if (!isStringArray(value.expectedLanes)) {
      errors.push(
        `waiver "${name}" has no "expectedLanes". Record the lanes that ` +
          `changed (e.g. ["react", "vue"]) so the waiver stops applying when ` +
          "a different lane pattern shows up.",
      );
      continue;
    }
    const unknownLanes = value.expectedLanes.filter(
      (lane) => !RENDERER_LANES.includes(lane),
    );
    if (unknownLanes.length > 0) {
      errors.push(
        `waiver "${name}" names unknown lane(s) ${unknownLanes.join(", ")} in ` +
          `"expectedLanes" (known lanes: ${RENDERER_LANES.join(", ")})`,
      );
      continue;
    }
    if (value.baseHashes !== undefined) {
      const hashes = value.baseHashes;
      if (!hashes || typeof hashes !== "object" || Array.isArray(hashes)) {
        errors.push(
          `waiver "${name}" has a "baseHashes" that is not an object mapping ` +
            "each waived file to its content hash at the base ref",
        );
        continue;
      }
      const badHashes = Object.entries(hashes).filter(
        ([, hash]) => !isBaseHash(hash),
      );
      if (badHashes.length > 0) {
        errors.push(
          `waiver "${name}" has malformed "baseHashes" value(s) for ` +
            `${badHashes.map(([file]) => file).join(", ")} (expected a sha256 ` +
            `hex digest or "${ABSENT_AT_BASE}")`,
        );
        continue;
      }
      const extra = Object.keys(hashes).filter(
        (file) => !value.files.includes(file),
      );
      if (extra.length > 0) {
        errors.push(
          `waiver "${name}" pins "baseHashes" for ${extra.join(", ")}, which ` +
            'are not in its "files" list',
        );
        continue;
      }
    }
    waivers[name] = {
      reason: value.reason.trim(),
      files: value.files,
      expectedLanes: value.expectedLanes,
      ...(value.baseHashes === undefined
        ? {}
        : { baseHashes: value.baseHashes }),
    };
  }
  return { waivers, errors };
}

export function loadWaivers(waiverPath) {
  if (!existsSync(waiverPath)) return { waivers: {}, errors: [] };
  let raw;
  try {
    raw = JSON.parse(readFileSync(waiverPath, "utf8"));
  } catch (error) {
    return {
      waivers: {},
      errors: [`mirror-waivers.json is not valid JSON: ${error.message}`],
    };
  }
  return parseWaivers(raw);
}

/** Raw blob bytes at a ref, or null. Never trimmed — the hash must be exact. */
function gitShowBytes(root, spec) {
  const result = spawnSync("git", ["show", spec], {
    cwd: root,
    maxBuffer: 1024 * 1024 * 256,
  });
  if (result.error || result.status !== 0) return null;
  return result.stdout;
}

/** sha256 of a file's content at the base ref, or ABSENT_AT_BASE. */
export function baseFileHash(root, base, file) {
  const bytes = gitShowBytes(root, `${base}:${file}`);
  return bytes === null ? ABSENT_AT_BASE : sha256(bytes);
}

const canonicalJson = (value) => {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value === undefined ? null : value);
};

/**
 * Binds each waiver to ONE reviewed divergence, and drops the ones that are
 * not bound to THIS diff. Without this, a merged waiver keeps authorizing the
 * same file+lane pattern forever: the next PR to touch those files is silently
 * excused by an entry that is nowhere in its diff and that nobody re-reviewed.
 *
 * Two independent bindings, both required:
 *
 *  (a) FRESHNESS — the entry must differ from the one at the base ref (absent
 *      there counts). This makes "a waiver must appear in the PR diff"
 *      literally true, and it is the semantic guarantee: an author cannot
 *      inherit someone else's justification, they have to write their own.
 *  (b) BASE CONTENT — `baseHashes` must match the waived files' content at the
 *      base ref. This makes the binding tamper-evident: the entry names the
 *      exact starting point it was reviewed against, so it cannot be quietly
 *      re-pointed at different content, and it stops applying the moment the
 *      divergence it documented is no longer the divergence present.
 *
 * (a) alone would already close the bypass; (b) is cheap and turns a semantic
 * rule into a checkable fact, so both are enforced. A rejected waiver is
 * returned with the reason and the correct hashes so the failure can tell the
 * author exactly what to write.
 */
export function bindWaivers(root, base, waivers, options = {}) {
  const relPath = options.waiverRelPath ?? ".github/mirror-waivers.json";
  const baseBytes = gitShowBytes(root, `${base}:${relPath}`);
  let baseWaivers = {};
  if (baseBytes !== null) {
    try {
      baseWaivers = parseWaivers(JSON.parse(baseBytes.toString("utf8"))).waivers;
    } catch {
      baseWaivers = {};
    }
  }

  const applicable = {};
  const rejections = new Map();

  for (const [name, waiver] of Object.entries(waivers)) {
    const expectedHashes = {};
    for (const file of waiver.files) {
      expectedHashes[file] = baseFileHash(root, base, file);
    }

    const baseEntry = baseWaivers[name];
    if (baseEntry && canonicalJson(baseEntry) === canonicalJson(waiver)) {
      rejections.set(name, {
        reason:
          "this waiver entry is byte-identical to the one already at the base " +
          "ref, so it is not part of this diff. A waiver authorizes ONE " +
          "reviewed divergence and does not carry over to later work",
        expectedHashes,
      });
      continue;
    }

    if (!waiver.baseHashes) {
      rejections.set(name, {
        reason: 'this waiver has no "baseHashes"',
        expectedHashes,
      });
      continue;
    }

    const mismatched = waiver.files.filter(
      (file) => waiver.baseHashes[file] !== expectedHashes[file],
    );
    if (mismatched.length > 0) {
      rejections.set(name, {
        reason:
          `its "baseHashes" no longer match the waived files at the base ref ` +
          `(${mismatched.join(", ")}), so it documents a different divergence ` +
          "than the one in this diff",
        expectedHashes,
      });
      continue;
    }

    applicable[name] = waiver;
  }

  return { applicable, rejections };
}

const sameSet = (a, b) => {
  const left = [...a].sort();
  const right = [...b].sort();
  return (
    left.length === right.length && left.every((entry, i) => entry === right[i])
  );
};

/**
 * Fails when a set's renderer lanes changed unevenly, at two granularities:
 *
 *  - PAIR scope, per mirrored counterpart (see derivePairs). This is the check
 *    that proves a change was mirrored: if one member of a pair moved, the
 *    other must have moved in the same diff.
 *  - SET scope, the original lane partition, which still covers the files that
 *    have no counterpart. Files a pair already reported are not repeated here.
 *
 * A waiver excuses the divergence only when BOTH of its records still describe
 * reality: every diverging file — at either scope — is named in `files`, and
 * the lanes that changed are exactly `expectedLanes`. Anything else fails, so
 * a waiver cannot outlive the divergence it documented. Binding a waiver to
 * the diff it was written for happens in `bindWaivers`, before this runs.
 */
export function checkLaneParity(sets, changedFiles, waivers = {}) {
  const changed = new Set(changedFiles);
  const failures = [];
  const waived = [];

  for (const set of sets) {
    const lanes = partitionLanes(set.files);
    if (lanes.size < 2) continue;

    const classify = (laneMap, exclude) => {
      const changedLanes = [];
      const unchangedLanes = [];
      const files = [];
      for (const [lane, laneFiles] of laneMap) {
        const touched = laneFiles.filter(
          (file) => changed.has(file) && !exclude?.has(file),
        );
        if (touched.length > 0) {
          changedLanes.push(lane);
          files.push(...touched);
        } else {
          unchangedLanes.push(lane);
        }
      }
      return { changedLanes, unchangedLanes, files };
    };
    const isUneven = (r) =>
      r.changedLanes.length > 0 && r.unchangedLanes.length > 0;

    const divergences = [];
    const reportedFiles = new Set();

    for (const pair of derivePairs(set.files, set.pairLanes)) {
      const result = classify(pair.lanes, null);
      if (!isUneven(result)) continue;
      for (const file of result.files) reportedFiles.add(file);
      divergences.push({
        set: set.name,
        pair: pair.key,
        changed: result.changedLanes,
        unchanged: result.unchangedLanes,
        changedFiles: result.files,
        hint: set.hint,
        note:
          `"${pair.key}" is a mirrored pair: lane(s) ` +
          `${result.changedLanes.join(", ")} changed it and lane(s) ` +
          `${result.unchangedLanes.join(", ")} did not`,
      });
    }

    const laneResult = classify(lanes, null);
    if (isUneven(laneResult)) {
      const unreported = laneResult.files.filter(
        (file) => !reportedFiles.has(file),
      );
      if (unreported.length > 0) {
        divergences.push({
          set: set.name,
          changed: laneResult.changedLanes,
          unchanged: laneResult.unchangedLanes,
          changedFiles: unreported,
          hint: set.hint,
        });
      }
    }

    if (divergences.length === 0) continue;

    const divergingFiles = [
      ...new Set(divergences.flatMap((entry) => entry.changedFiles)),
    ];
    // Pair divergences already carry a note; the waiver diagnosis is appended
    // to it rather than replacing it, so the failure says both what diverged
    // and why the waiver did not cover it.
    const withNote = (note) =>
      divergences.map((entry) => ({
        ...entry,
        note: entry.note ? `${entry.note}; ${note}` : note,
      }));

    const waiver = waivers[set.name];
    if (!waiver) {
      failures.push(...divergences);
      continue;
    }

    if (!Array.isArray(waiver.files) || waiver.files.length === 0) {
      failures.push(
        ...withNote(
          "the waiver for this set is not scoped to specific files; unscoped " +
            'whole-set waivers are rejected — add a "files" list',
        ),
      );
      continue;
    }

    if (!Array.isArray(waiver.expectedLanes) || waiver.expectedLanes.length === 0) {
      failures.push(
        ...withNote('the waiver for this set records no "expectedLanes"'),
      );
      continue;
    }

    if (!sameSet(waiver.expectedLanes, laneResult.changedLanes)) {
      failures.push(
        ...withNote(
          `the waiver records changed lane(s) ${[...waiver.expectedLanes].sort().join(", ")} ` +
            `but this change touched ${[...laneResult.changedLanes].sort().join(", ")}; ` +
            "a waiver only excuses the exact divergence it documented",
        ),
      );
      continue;
    }

    const waivedFiles = new Set(waiver.files);
    const uncovered = divergingFiles.filter((file) => !waivedFiles.has(file));
    if (uncovered.length > 0) {
      const scoped = classify(lanes, waivedFiles);
      failures.push({
        set: set.name,
        changed: scoped.changedLanes,
        unchanged: scoped.unchangedLanes,
        changedFiles: uncovered,
        hint: set.hint,
        note:
          "a file-scoped waiver exists for this set but does not name these " +
          "diverging files",
      });
      continue;
    }

    waived.push({
      set: set.name,
      reason: waiver.reason,
      files: waiver.files,
      expectedLanes: waiver.expectedLanes,
      changed: laneResult.changedLanes,
      unchanged: laneResult.unchangedLanes,
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
  if (base.error) {
    failed = true;
    err(`Mirror check failed — the lane check could not run: ${base.error}\n`);
    err(
      "The lane check is not allowed to disable itself. Pass a resolvable " +
        "`--base <ref>`, or drop `--require-base` only for local runs where " +
        "skipping is acceptable.\n",
    );
  } else if (base.skip) {
    log(
      "!!! MIRROR LANE CHECK SKIPPED — RENDERER LANE PARITY IS NOT ENFORCED " +
        `IN THIS RUN !!!\n  ${base.reason}\n  This skip is for local runs ` +
        "only; CI runs `pnpm check:mirrors --require-base`, which turns it " +
        "into a failure.",
    );
  } else {
    const changedFiles = changedFilesSince(root, base.base);
    if (changedFiles === null) {
      failed = true;
      err(
        "Mirror check failed — `git diff` against " +
          `${base.source} failed in this checkout, so lane parity could not ` +
          "be evaluated.\n",
      );
    } else {
      const { applicable, rejections } = bindWaivers(root, base.base, waivers, {
        waiverRelPath: options.waiverRelPath,
      });
      const { failures, waived } = checkLaneParity(
        sets,
        changedFiles,
        applicable,
      );
      const failedSets = new Set(failures.map((failure) => failure.set));
      for (const [name, rejection] of rejections) {
        if (failedSets.has(name)) continue;
        log(
          `MIRROR WAIVER IGNORED: set "${name}" — ${rejection.reason}. It ` +
            "excuses nothing in this diff; delete it once the PR that " +
            "introduced it has merged.",
        );
      }
      for (const entry of waived) {
        log(
          `MIRROR WAIVER APPLIED: set "${entry.set}" — changed lane(s) ` +
            `${entry.changed.join(", ")}, unchanged lane(s) ` +
            `${entry.unchanged.join(", ")}` +
            ` (scoped to ${entry.files.join(", ")})` +
            `\n  reason: ${entry.reason}`,
        );
      }
      if (failures.length > 0) {
        failed = true;
        err(
          "Mirror check failed — renderer lanes changed unevenly against " +
            `${base.source}:\n`,
        );
        const explained = new Set();
        for (const failure of failures) {
          err(`  set: ${failure.set}`);
          if (failure.pair) err(`    mirrored pair: ${failure.pair}`);
          err(`    changed lane(s):   ${failure.changed.join(", ")}`);
          err(`    unchanged lane(s): ${failure.unchanged.join(", ")}`);
          for (const file of failure.changedFiles ?? []) err(`    changed: ${file}`);
          if (failure.note) err(`    ${failure.note}`);
          if (failure.hint) err(`    ${failure.hint}`);
          const rejection = rejections.get(failure.set);
          if (rejection && !explained.has(failure.set)) {
            explained.add(failure.set);
            err(`    WAIVER REJECTED: ${rejection.reason}.`);
            err(
              "    Re-justify it with a FRESH entry describing THIS " +
                "divergence, using these base hashes:",
            );
            err(
              `      "baseHashes": ${JSON.stringify(
                rejection.expectedHashes,
                null,
                2,
              )
                .split("\n")
                .join("\n      ")}`,
            );
          }
          err("");
        }
        err(
          "Mirror the change into every renderer lane, or declare the " +
            "divergence in .github/mirror-waivers.json as " +
            '{ "reason": "...", "files": [the exact diverging files], ' +
            '"expectedLanes": [the lanes that changed], "baseHashes": ' +
            "{ file: its content hash at the base ref } } " +
            "(re-pinning mirror-lock.json does NOT satisfy this check). A " +
            "waiver covers ONE reviewed divergence: it must be new in this " +
            "diff, so an already-merged entry never applies to later work.",
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
