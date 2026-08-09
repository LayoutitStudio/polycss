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

/** Every block name the root README publishes, in document order. */
function sharedBlockNames(text) {
  return [...text.matchAll(/<!-- polycss:shared:([a-z-]+):start -->/g)].map(
    (m) => m[1],
  );
}

const rootText = readFileSync(source, "utf8");
const names = sharedBlockNames(rootText);

if (names.length === 0) {
  console.error(
    "[sync-package-readmes] no shared blocks found in the root README — refusing to run",
  );
  process.exit(1);
}

const blocks = new Map();
for (const name of names) {
  const match = rootText.match(blockRe(name));
  if (!match) {
    console.error(
      `[sync-package-readmes] block "${name}" has a start marker but no end marker`,
    );
    process.exit(1);
  }
  blocks.set(name, match[0]);
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

  let next = text;
  for (const [name, block] of blocks) {
    const re = blockRe(name);
    if (re.test(next)) next = next.replace(re, block);
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
