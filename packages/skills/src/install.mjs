/**
 * Installs the bundled PolyCSS skill into an agent's skills directory.
 *
 * The package ships `skill/SKILL.md` plus `skill/docs/*.md`. Installing copies
 * that tree verbatim into `<project>/<agent skills dir>/polycss/` and records a
 * manifest of content hashes alongside it, so a later upgrade can tell an
 * untouched install (safe to overwrite) from one the user has edited (refuse
 * unless `--force`). Files the user adds themselves are never touched.
 *
 * Zero runtime dependencies: this runs under `npx` in someone else's project.
 */
import { createHash, randomBytes } from "node:crypto";
import {
  lstatSync,
  mkdirSync,
  realpathSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join, posix, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const SKILL_NAME = "polycss";
export const MANIFEST_FILE = ".polycss-skill.json";

/**
 * Where each agent runtime looks for project-local skills. `root` is the
 * marker directory used for auto-detection — a project that already has
 * `.claude/` is a Claude Code project even if it has no skills yet.
 */
export const AGENTS = {
  claude: { label: "Claude Code", root: ".claude", skills: ".claude/skills" },
  codex: { label: "Codex", root: ".agents", skills: ".agents/skills" },
};

export const DEFAULT_AGENT = "claude";

/** Root of the shipped skill tree (`packages/skills/skill`). */
export function bundledSkillDir() {
  return resolve(dirname(fileURLToPath(import.meta.url)), "..", "skill");
}

const sha256 = (buffer) => createHash("sha256").update(buffer).digest("hex");

/**
 * Every file under `dir`, as POSIX-style relative paths, sorted. POSIX
 * separators keep the manifest byte-identical across Windows and Unix installs.
 */
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

const toNative = (rel) => rel.split("/").join(sep);

/**
 * A path we are willing to act on inside the skill directory.
 *
 * Manifest keys are read off disk and are therefore untrusted input: a
 * `../../../package.json` entry whose hash matched would otherwise be joined to
 * `destDir` and deleted during stale-file cleanup. Everything must be a plain
 * forward-slash relative path with no traversal, no root, and no drive letter.
 */
export function isSafeRelativePath(rel) {
  if (typeof rel !== "string" || rel.length === 0) return false;
  if (rel.includes("\\") || rel.includes("\u0000")) return false;
  if (rel.startsWith("/") || /^[a-zA-Z]:/.test(rel)) return false;
  const parts = rel.split("/");
  if (parts.some((part) => part === "" || part === "." || part === "..")) return false;
  return true;
}

/**
 * Real location of `path`, resolving through the nearest ancestor that exists.
 *
 * A plain `realpathSync` throws when the destination has not been created yet
 * and the lexical fallback then hides a symlinked ANCESTOR — so a planted
 * `.claude/skills -> /elsewhere` would be silently followed on a first install.
 */
function realpathThroughAncestors(path) {
  const absolute = resolve(path);
  const trailing = [];
  let current = absolute;

  for (;;) {
    try {
      return join(realpathSync(current), ...trailing);
    } catch {
      const parent = dirname(current);
      if (parent === current) return absolute;
      trailing.unshift(current.slice(parent.length + 1));
      current = parent;
    }
  }
}

/**
 * Resolve `rel` under `root`, returning null unless it genuinely stays inside.
 *
 * Lexical resolution is not enough. `resolve()` does not follow symlinked path
 * COMPONENTS, so a planted `docs -> /elsewhere` directory passes a
 * `startsWith(base)` check while every write under it lands outside the skill
 * directory — reproduced: an ordinary install wrote all 13 docs into the link
 * target. So every intermediate component is `lstat`ed and a symlink anywhere
 * along the path refuses the operation outright.
 *
 * The leaf is deliberately exempt: a symlinked managed FILE is still resolved
 * here, and the caller treats it as a conflict (or, under `--force`, unlinks
 * and replaces the link itself rather than writing through it).
 */
function containedPath(root, rel) {
  if (!isSafeRelativePath(rel)) return null;
  // The destination root may legitimately be a symlink — a shared skills
  // directory is a reasonable layout — so containment is measured against its
  // real location rather than refused.
  const base = realpathThroughAncestors(root);
  const parts = rel.split("/");
  let current = base;

  for (let i = 0; i < parts.length; i += 1) {
    current = join(current, parts[i]);
    const isLeaf = i === parts.length - 1;
    let stat = null;
    try {
      stat = lstatSync(current);
    } catch {
      // Nothing exists from here down; the rest is ours to create inside base.
      break;
    }
    if (!isLeaf && stat.isSymbolicLink()) return null;
  }

  const target = join(base, ...parts.map((part) => part));
  return target.startsWith(base + sep) ? target : null;
}

function readManifest(destDir) {
  const path = containedPath(destDir, MANIFEST_FILE);
  if (path === null || isSymlink(path)) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    if (!parsed || typeof parsed !== "object") return null;
    const files = parsed.files;
    if (!files || typeof files !== "object" || Array.isArray(files)) return null;
    // A manifest we cannot fully trust is worse than none: a bad entry would
    // read as "unmodified" and silently overwrite the user's edit, and an
    // unsafe key would send a delete outside the skill directory entirely.
    for (const [key, value] of Object.entries(files)) {
      if (typeof value !== "string") return null;
      if (containedPath(destDir, key) === null) return null;
    }
    return { version: typeof parsed.version === "string" ? parsed.version : null, files };
  } catch {
    return null;
  }
}

const isSymlink = (path) => {
  try {
    return lstatSync(path).isSymbolicLink();
  } catch {
    return false;
  }
};

/**
 * Read a managed file, refusing to follow symlinks.
 *
 * Returns `SYMLINK` for a link so callers treat it as a conflict rather than
 * silently writing through it: installing over a `SKILL.md` symlink otherwise
 * overwrites whatever it points at, anywhere on disk.
 */
const SYMLINK = Symbol("symlink");

function readIfFile(path) {
  try {
    const stat = lstatSync(path);
    if (stat.isSymbolicLink()) return SYMLINK;
    if (!stat.isFile()) return null;
    return readFileSync(path);
  } catch {
    return null;
  }
}

/** Replace `path` without following a symlink that may sit at it. */
function writeFileNoFollow(path, bytes) {
  mkdirSync(dirname(path), { recursive: true });
  if (isSymlink(path)) unlinkSync(path);
  // Same-directory temp + rename: rename replaces the entry itself, so a link
  // created between the check and the write cannot be followed either.
  // Random suffix + exclusive create: a predictable temp name is a file another
  // local process can plant and win a race against.
  const temp = `${path}.${randomBytes(6).toString("hex")}.polycss-skill-tmp`;
  try {
    writeFileSync(temp, bytes, { flag: "wx" });
    renameSync(temp, path);
  } finally {
    rmSync(temp, { force: true });
  }
}

/**
 * Decide what installing into `destDir` would do, without touching disk.
 *
 * `conflicts` are files that exist on disk, differ from what we would write,
 * and are not accounted for by the manifest — i.e. hand-edited. They block the
 * install unless `force` is set.
 */
export function planInstall({ sourceDir, destDir, force = false }) {
  const sourceFiles = listFiles(sourceDir);
  if (sourceFiles.length === 0) {
    throw new Error(`no skill files found in ${sourceDir}`);
  }

  const manifest = readManifest(destDir);
  const write = [];
  const unchanged = [];
  const conflicts = [];
  const remove = [];
  const kept = [];

  for (const rel of sourceFiles) {
    const target = containedPath(destDir, rel);
    if (target === null) {
      conflicts.push(rel);
      continue;
    }
    const next = readFileSync(join(sourceDir, toNative(rel)));
    const current = readIfFile(target);

    if (current === SYMLINK) {
      // A managed path that is a link points somewhere we do not own, so it is
      // never written *through*. Under an explicit --force the link itself is
      // replaced by a real file; without one it blocks the install.
      if (force) write.push(rel);
      else conflicts.push(rel);
      continue;
    }
    if (current === null) {
      write.push(rel);
      continue;
    }
    if (current.equals(next)) {
      unchanged.push(rel);
      continue;
    }
    const recorded = manifest?.files?.[rel];
    if (recorded && recorded === sha256(current)) write.push(rel);
    else if (force) write.push(rel);
    else conflicts.push(rel);
  }

  const shipped = new Set(sourceFiles);
  for (const rel of Object.keys(manifest?.files ?? {})) {
    if (shipped.has(rel)) continue;
    const target = containedPath(destDir, rel);
    if (target === null) continue;
    const current = readIfFile(target);
    if (current === null || current === SYMLINK) continue;
    // Dropped from a newer version of the skill. Reclaim it only if it still
    // matches what we installed; an edited leftover is the user's file now.
    if (sha256(current) === manifest.files[rel] || force) remove.push(rel);
    else kept.push(rel);
  }

  return {
    sourceFiles,
    write,
    unchanged,
    conflicts,
    remove,
    kept,
    hadManifest: manifest !== null,
    previousVersion: manifest?.version ?? null,
  };
}

/**
 * Apply a plan. Returns the plan, annotated with `applied: false` when it was a
 * dry run or was blocked by conflicts.
 */
export function installSkill({
  sourceDir = bundledSkillDir(),
  destDir,
  version = "0.0.0",
  force = false,
  dryRun = false,
} = {}) {
  const plan = planInstall({ sourceDir, destDir, force });

  if (plan.conflicts.length > 0 || dryRun) {
    return { ...plan, destDir, applied: false };
  }

  const files = {};
  for (const rel of plan.sourceFiles) {
    const target = containedPath(destDir, rel);
    if (target === null) continue;
    const bytes = readFileSync(join(sourceDir, toNative(rel)));
    files[rel] = sha256(bytes);
    if (!plan.write.includes(rel)) continue;
    writeFileNoFollow(target, bytes);
  }

  for (const rel of plan.remove) {
    const target = containedPath(destDir, rel);
    if (target === null) continue;
    rmSync(target, { force: true });
  }

  mkdirSync(destDir, { recursive: true });
  writeFileNoFollow(
    containedPath(destDir, MANIFEST_FILE),
    `${JSON.stringify({ skill: SKILL_NAME, version, files }, null, 2)}\n`,
  );

  return { ...plan, destDir, applied: true };
}

/**
 * Resolve which agent directories to install into.
 *
 * Explicit `--agent` wins. Otherwise every agent whose marker directory already
 * exists is selected, so a project set up for both gets both. A project with
 * neither falls back to a single default rather than prompting — `npx` runs
 * unattended often enough that a prompt is a worse default than a printed note.
 */
export function resolveTargets({ cwd, requested = [], global = false } = {}) {
  const base = global ? homedir() : cwd;
  const names = requested.length > 0 ? requested : null;

  if (names) {
    return names.map((name) => {
      const agent = AGENTS[name];
      if (!agent) {
        throw new Error(
          `unknown agent "${name}" — expected one of: ${Object.keys(AGENTS).join(", ")}, all`,
        );
      }
      return { agent: name, label: agent.label, dir: join(base, agent.skills, SKILL_NAME) };
    });
  }

  const detected = Object.entries(AGENTS).filter(([, agent]) => {
    try {
      return statSync(join(base, agent.root)).isDirectory();
    } catch {
      return false;
    }
  });

  const chosen = detected.length > 0 ? detected : [[DEFAULT_AGENT, AGENTS[DEFAULT_AGENT]]];
  return chosen.map(([name, agent]) => ({
    agent: name,
    label: agent.label,
    dir: join(base, agent.skills, SKILL_NAME),
    detected: detected.length > 0,
  }));
}

/** Expand `--agent` values, including the `all` alias and comma-separated lists. */
export function expandAgents(values) {
  const out = [];
  for (const value of values) {
    for (const part of value.split(",")) {
      const name = part.trim();
      if (!name) continue;
      if (name === "all") out.push(...Object.keys(AGENTS));
      else out.push(name);
    }
  }
  return [...new Set(out)];
}
