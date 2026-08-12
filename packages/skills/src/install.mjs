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
import { createHash } from "node:crypto";
import {
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
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

function readManifest(destDir) {
  try {
    const parsed = JSON.parse(readFileSync(join(destDir, MANIFEST_FILE), "utf8"));
    if (!parsed || typeof parsed !== "object") return null;
    const files = parsed.files;
    if (!files || typeof files !== "object" || Array.isArray(files)) return null;
    // A manifest we cannot fully trust is worse than none: a bad entry would
    // read as "unmodified" and silently overwrite the user's edit.
    for (const value of Object.values(files)) {
      if (typeof value !== "string") return null;
    }
    return { version: typeof parsed.version === "string" ? parsed.version : null, files };
  } catch {
    return null;
  }
}

function readIfFile(path) {
  try {
    if (!statSync(path).isFile()) return null;
    return readFileSync(path);
  } catch {
    return null;
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
    const next = readFileSync(join(sourceDir, toNative(rel)));
    const current = readIfFile(join(destDir, toNative(rel)));

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
    const current = readIfFile(join(destDir, toNative(rel)));
    if (current === null) continue;
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
    const target = join(destDir, toNative(rel));
    const bytes = readFileSync(join(sourceDir, toNative(rel)));
    files[rel] = sha256(bytes);
    if (!plan.write.includes(rel)) continue;
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, bytes);
  }

  for (const rel of plan.remove) {
    rmSync(join(destDir, toNative(rel)), { force: true });
  }

  mkdirSync(destDir, { recursive: true });
  writeFileSync(
    join(destDir, MANIFEST_FILE),
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
