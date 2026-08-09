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
export function assertWellFormed(text, label, allowed, onError = fail) {
  const MARKER_RE = /<!-- polycss:shared:([a-z-]+):(start|end) -->/g;
  const names = new Set();
  let open = null;

  for (const m of text.matchAll(MARKER_RE)) {
    const [, name, kind] = m;
    if (kind === "start") {
      if (open)
        return onError(
          `${label}: block "${name}" starts inside block "${open}" — blocks may not nest or cross`,
        );
      if (names.has(name))
        return onError(`${label}: block "${name}" appears more than once`);
      if (allowed && !allowed.has(name))
        return onError(`${label}: block "${name}" is not defined in the root README`);
      open = name;
    } else {
      if (open === null)
        return onError(
          `${label}: block "${name}" has an end marker before its start marker`,
        );
      if (open !== name)
        return onError(
          `${label}: block "${open}" is closed by "${name}" — blocks may not nest or cross`,
        );
      names.add(name);
      open = null;
    }
  }

  if (open) return onError(`${label}: block "${open}" is never closed`);
  return names;
}

function main() {
const rootText = readFileSync(source, "utf8");
const names = [...assertWellFormed(rootText, "root README", null)];

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
  } catch (err) {
    // A listed package must have a readable README — packages opt out by
    // carrying no markers, not by going missing. Skipping here would let a
    // deleted or unreadable README pass both `--check` and `prepack`.
    fail(`${target}: cannot be read (${err.code ?? err.message})`);
  }

  const present = assertWellFormed(text, target, new Set(names));

  let next = text;
  for (const name of present) {
    // Replacement passed as a callback: README content is arbitrary text and
    // `$&` / `` $` `` / `$'` in a replacement STRING would be expanded.
    next = next.replace(blockRe(name), () => blocks.get(name));
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
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
