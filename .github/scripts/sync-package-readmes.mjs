/**
 * Syncs the SHARED blocks of the root README into each package README.
 *
 * Each package README is a real, hand-written, committed file — what you read
 * in the repo is what publishes to npm. This script only refreshes the regions
 * delimited by:
 *
 *   <!-- polycss:shared:<name>:start -->  …  <!-- polycss:shared:<name>:end -->
 *
 * Everything between those blocks is package-specific and never touched. A
 * package opts in per block simply by containing the matching markers; a
 * package with no markers (or a subset) is left alone accordingly.
 *
 * Runs as `prepack` in every publishable package, so a stale block can never
 * reach npm. Run with `--check` in CI to fail on drift instead of writing.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const source = resolve(repoRoot, "README.md");

const targets = [
  "packages/core/README.md",
  "packages/polycss/README.md",
  "packages/react/README.md",
  "packages/vue/README.md",
  "packages/fonts/README.md",
  "packages/morph/README.md",
];

const checkOnly = process.argv.includes("--check");

const blockRe = (name) =>
  new RegExp(
    `<!-- polycss:shared:${name}:start -->[\\s\\S]*?<!-- polycss:shared:${name}:end -->`,
  );

const START_RE = /<!-- polycss:shared:([a-z-]+):start -->/g;
const END_RE = /<!-- polycss:shared:([a-z-]+):end -->/g;

const fail = (message) => {
  console.error(`[sync-package-readmes] ${message}`);
  process.exit(1);
};

const countByName = (text, re) => {
  const counts = new Map();
  for (const m of text.matchAll(re)) {
    counts.set(m[1], (counts.get(m[1]) ?? 0) + 1);
  }
  return counts;
};

/**
 * Every marker must appear exactly once and be balanced. Anything else is a
 * malformed file, not a partially-syncable one: silently skipping it is how a
 * stale block reaches npm.
 */
function assertWellFormed(text, label, allowed) {
  const starts = countByName(text, START_RE);
  const ends = countByName(text, END_RE);

  for (const [name, n] of starts) {
    if (n > 1) fail(`${label}: block "${name}" has ${n} start markers, expected 1`);
    if ((ends.get(name) ?? 0) !== 1)
      fail(`${label}: block "${name}" has a start marker but no matching end marker`);
    if (allowed && !allowed.has(name))
      fail(`${label}: block "${name}" is not defined in the root README`);
  }
  for (const [name, n] of ends) {
    if (n > 1) fail(`${label}: block "${name}" has ${n} end markers, expected 1`);
    if (!starts.has(name))
      fail(`${label}: block "${name}" has an end marker but no matching start marker`);
  }
  return starts;
}

const rootText = readFileSync(source, "utf8");
const rootStarts = assertWellFormed(rootText, "root README", null);
const names = [...rootStarts.keys()];

if (names.length === 0) {
  fail("no shared blocks found in the root README — refusing to run");
}

const blocks = new Map();
for (const name of names) {
  blocks.set(name, rootText.match(blockRe(name))[0]);
}

const drifted = [];
let updated = 0;

for (const target of targets) {
  const path = resolve(repoRoot, target);
  let text;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    continue;
  }

  const present = assertWellFormed(text, target, new Set(names));

  let next = text;
  for (const name of present.keys()) {
    next = next.replace(blockRe(name), blocks.get(name));
  }

  if (next === text) continue;
  if (checkOnly) {
    drifted.push(target);
    continue;
  }
  writeFileSync(path, next);
  updated += 1;
  console.log(`[sync-package-readmes] updated ${relative(repoRoot, path)}`);
}

if (checkOnly) {
  if (drifted.length > 0) {
    console.error(
      `[sync-package-readmes] shared blocks are stale in:\n  ${drifted.join("\n  ")}\n` +
        "Edit the block in the root README, then run `pnpm sync:readmes`.",
    );
    process.exit(1);
  }
  console.log("[sync-package-readmes] shared blocks are up to date");
  process.exit(0);
}

console.log(
  `[sync-package-readmes] ${updated} README${updated === 1 ? "" : "s"} updated, ${names.length} shared block${names.length === 1 ? "" : "s"}`,
);
