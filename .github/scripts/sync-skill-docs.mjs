/**
 * Publishes the skill tree owned by `packages/skills` to the website.
 *
 * `packages/skills/skill/` is the single source of truth — it is what
 * `npx @layoutit/polycss-skills` installs. The website serves the same bytes so
 * an agent that cannot run npx can fetch them:
 *
 *   website/public/skill/**   — the tree verbatim, relative links intact
 *   website/public/skill.md   — the long-standing entry-point URL, with
 *                               `docs/x.md` links rewritten to `/skill/docs/x.md`
 *                               because it is served one level up from the tree
 *
 * Run with `--check` in CI to fail on drift instead of writing.
 */
import {
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, posix, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const sourceDir = resolve(repoRoot, "packages/skills/skill");
const treeDir = resolve(repoRoot, "website/public/skill");
const entryFile = resolve(repoRoot, "website/public/skill.md");

const checkOnly = process.argv.includes("--check");

const fail = (message) => {
  console.error(`[sync-skill-docs] ${message}`);
  process.exit(1);
};

export function listFiles(dir, prefix = "") {
  const out = [];
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries.sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const rel = prefix ? posix.join(prefix, entry.name) : entry.name;
    if (entry.isDirectory()) out.push(...listFiles(join(dir, entry.name), rel));
    else if (entry.isFile()) out.push(rel);
  }
  return out;
}

/**
 * `website/public/skill.md` sits one directory above `website/public/skill/`,
 * so its relative doc links would 404. Rewrite them to site-absolute paths.
 */
export function rewriteEntryLinks(text) {
  return text.replace(/\]\(docs\//g, "](/skill/docs/");
}

const toNative = (rel) => rel.split("/").join(sep);
const readOrNull = (path) => {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
};

function main() {
  const files = listFiles(sourceDir);
  if (!files.includes("SKILL.md")) {
    fail(`${relative(repoRoot, sourceDir)} has no SKILL.md — refusing to run`);
  }

  const drifted = [];
  let written = 0;

  const write = (path, next) => {
    if (readOrNull(path) === next) return;
    if (checkOnly) {
      drifted.push(relative(repoRoot, path));
      return;
    }
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, next);
    written += 1;
  };

  for (const rel of files) {
    write(join(treeDir, toNative(rel)), readFileSync(join(sourceDir, toNative(rel)), "utf8"));
  }

  write(entryFile, rewriteEntryLinks(readFileSync(join(sourceDir, "SKILL.md"), "utf8")));

  // Files the skill no longer ships must not linger on the website, or an agent
  // fetching by URL keeps reading a doc the package dropped.
  const shipped = new Set(files);
  for (const rel of listFiles(treeDir)) {
    if (shipped.has(rel)) continue;
    const path = join(treeDir, toNative(rel));
    if (checkOnly) {
      drifted.push(`${relative(repoRoot, path)} (stale)`);
      continue;
    }
    rmSync(path, { force: true });
    written += 1;
  }

  if (checkOnly) {
    if (drifted.length > 0) {
      console.error(
        `[sync-skill-docs] website skill copy is stale:\n  ${drifted.join("\n  ")}\n` +
          "Edit packages/skills/skill/, then run `pnpm sync:skill`.",
      );
      process.exit(1);
    }
    console.log("[sync-skill-docs] website skill copy is up to date");
    return;
  }

  console.log(
    `[sync-skill-docs] ${written} file${written === 1 ? "" : "s"} updated from ${files.length} skill file${files.length === 1 ? "" : "s"}`,
  );
}

// `import.meta.url` is realpathed by Node but `argv[1]` is not, so a symlink
// anywhere in the invocation path would make this compare unequal — main()
// would silently never run and `--check` would exit 0 on stale content.
const invokedDirectly = () => {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
};

if (invokedDirectly()) main();
