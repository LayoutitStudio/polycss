/**
 * Enforces the three-way renderer copy discipline from AGENTS.md
 * ("Renderer-owned browser glue"): the canvas atlas pipeline, feature
 * detection, voxel renderer, base styles, and a few pure helpers exist as
 * independent copies in packages/polycss, packages/react, and packages/vue.
 * A fix in one copy MUST land in the others — historically that rule lived
 * only in a PR checklist, and it failed silently (unmirrored fixes shipped).
 *
 * Two enforcement modes:
 *
 * - IDENTICAL groups: files that must stay byte-for-byte equal (the
 *   react↔vue clones, and the renderStats trio). Any divergence fails.
 *
 * - SYNC sets: files that mirror each other *semantically* but not textually
 *   (vanilla↔react/vue). Their content hashes are pinned in
 *   .github/mirror-lock.json. Editing any file in a set fails CI until the
 *   author re-pins with `pnpm check:mirrors --update` — a deliberate
 *   speed bump that forces the "did I mirror this into the other two
 *   renderers?" question at the moment the answer is cheap.
 *
 * Run: `node .github/scripts/check-mirrors.mjs [--update]`
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const lockPath = resolve(repoRoot, ".github", "mirror-lock.json");

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
    name: "colorResolver (react↔vue)",
    files: [
      "packages/react/src/styles/colorResolver.ts",
      "packages/vue/src/styles/colorResolver.ts",
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

function main() {
  const update = process.argv.includes("--update");

  const identicalFailures = checkIdenticalGroups(repoRoot, IDENTICAL_GROUPS);
  if (identicalFailures.length > 0) {
    console.error("Mirror check failed — byte-identical copies diverged:\n");
    for (const failure of identicalFailures) {
      console.error(`  ${failure.group}\n    ${failure.reason}\n`);
    }
    console.error(
      "These copies must stay byte-for-byte equal. Apply the same change to " +
        "every file in the group (AGENTS.md → Renderer-owned browser glue).",
    );
    process.exit(1);
  }

  if (update) {
    const lock = computeSyncHashes(repoRoot, SYNC_SETS);
    writeFileSync(lockPath, `${JSON.stringify(lock, null, 2)}\n`);
    console.log(`Pinned ${SYNC_SETS.length} mirror sets to ${lockPath}`);
    return;
  }

  if (!existsSync(lockPath)) {
    console.error(
      `Missing ${lockPath}. Run \`pnpm check:mirrors --update\` and commit it.`,
    );
    process.exit(1);
  }
  const lock = JSON.parse(readFileSync(lockPath, "utf8"));
  const syncFailures = checkSyncSets(repoRoot, SYNC_SETS, lock);
  if (syncFailures.length > 0) {
    console.error("Mirror check failed — pinned mirror sets changed:\n");
    for (const failure of syncFailures) {
      console.error(`  set: ${failure.set}`);
      for (const file of failure.files ?? []) console.error(`    changed: ${file}`);
      for (const file of failure.stale ?? []) console.error(`    stale pin: ${file}`);
      if (failure.hint) console.error(`    ${failure.hint}`);
      console.error("");
    }
    console.error(
      "If the change is already mirrored into every renderer copy (or is an " +
        "intentional per-renderer divergence documented in AGENTS.md), re-pin " +
        "with `pnpm check:mirrors --update` and commit mirror-lock.json.",
    );
    process.exit(1);
  }

  console.log("Mirror check passed.");
}

const isDirectRun =
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) main();
