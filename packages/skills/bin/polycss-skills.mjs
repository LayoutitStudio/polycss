#!/usr/bin/env node
/**
 * `npx @layoutit/polycss-skills` — install the PolyCSS agent skill into a project.
 */
import { readFileSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  AGENTS,
  bundledSkillDir,
  expandAgents,
  installSkill,
  listFiles,
  resolveTargets,
  SKILL_NAME,
} from "../src/install.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const { version } = JSON.parse(readFileSync(resolve(here, "..", "package.json"), "utf8"));

const USAGE = `polycss-skills ${version}

Installs the PolyCSS skill (SKILL.md + reference docs) so your coding agent
knows how to write PolyCSS.

Usage
  npx @layoutit/polycss-skills [options]

Options
  --agent <name>   Target agent: ${Object.keys(AGENTS).join(", ")}, or all.
                   Repeatable and comma-separated. Defaults to whichever
                   agent directories already exist, else ${AGENTS.claude.root}.
  --dir <path>     Install into this exact directory instead of an agent's.
  --cwd <path>     Project root to install into (default: current directory).
  --global         Install into your home directory instead of the project.
  --force          Overwrite files you have edited since installing.
  --dry-run        Print what would change, write nothing.
  --list           List the files this package would install.
  --help, -h       Show this message.
  --version, -v    Print the version.

Agents
${Object.entries(AGENTS)
  .map(([name, agent]) => `  ${name.padEnd(8)} ${agent.label} — ${agent.skills}/${SKILL_NAME}`)
  .join("\n")}
`;

function parseArgs(argv) {
  const options = {
    agents: [],
    dir: null,
    cwd: process.cwd(),
    global: false,
    force: false,
    dryRun: false,
    list: false,
    help: false,
    version: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const valueOf = (name) => {
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("-")) {
        throw new Error(`${name} requires a value`);
      }
      i += 1;
      return next;
    };

    switch (arg) {
      case "--agent":
      case "-a":
        options.agents.push(valueOf(arg));
        break;
      case "--dir":
        options.dir = valueOf(arg);
        break;
      case "--cwd":
        options.cwd = valueOf(arg);
        break;
      case "--global":
        options.global = true;
        break;
      case "--force":
      case "-f":
        options.force = true;
        break;
      case "--dry-run":
        options.dryRun = true;
        break;
      case "--list":
        options.list = true;
        break;
      case "--help":
      case "-h":
        options.help = true;
        break;
      case "--version":
      case "-v":
        options.version = true;
        break;
      default:
        if (arg.startsWith("--agent=")) options.agents.push(arg.slice(8));
        else if (arg.startsWith("--dir=")) options.dir = arg.slice(6);
        else if (arg.startsWith("--cwd=")) options.cwd = arg.slice(6);
        else throw new Error(`unknown option "${arg}"`);
    }
  }

  return options;
}

function display(path) {
  const rel = relative(process.cwd(), path);
  return !rel || rel.startsWith("..") || isAbsolute(rel) ? path : rel;
}

function main(argv) {
  let options;
  try {
    options = parseArgs(argv);
  } catch (error) {
    console.error(`polycss-skills: ${error.message}\n`);
    console.error(USAGE);
    return 1;
  }

  if (options.help) {
    console.log(USAGE);
    return 0;
  }
  if (options.version) {
    console.log(version);
    return 0;
  }

  const sourceDir = bundledSkillDir();

  if (options.list) {
    for (const file of listFiles(sourceDir)) console.log(file);
    return 0;
  }

  let targets;
  try {
    targets = options.dir
      ? [{ agent: null, label: "custom directory", dir: resolve(options.cwd, options.dir) }]
      : resolveTargets({
          cwd: resolve(options.cwd),
          requested: expandAgents(options.agents),
          global: options.global,
        });
  } catch (error) {
    console.error(`polycss-skills: ${error.message}`);
    return 1;
  }

  let blocked = false;

  for (const target of targets) {
    let result;
    try {
      result = installSkill({
        sourceDir,
        destDir: target.dir,
        version,
        force: options.force,
        dryRun: options.dryRun,
      });
    } catch (error) {
      console.error(`polycss-skills: ${target.label}: ${error.message}`);
      return 1;
    }

    const where = display(target.dir);

    if (result.conflicts.length > 0) {
      blocked = true;
      console.error(
        `polycss-skills: ${where} has local edits to:\n` +
          result.conflicts.map((file) => `  ${file}`).join("\n") +
          "\nRe-run with --force to overwrite them.",
      );
      continue;
    }

    if (options.dryRun) {
      const summary =
        result.write.length === 0 && result.remove.length === 0
          ? "already up to date"
          : `would write ${result.write.length}, remove ${result.remove.length}`;
      console.log(`polycss-skills: ${where} — ${summary} (dry run)`);
      continue;
    }

    if (result.write.length === 0 && result.remove.length === 0) {
      console.log(`polycss-skills: ${where} — already up to date (${version})`);
      continue;
    }

    console.log(
      `polycss-skills: installed ${SKILL_NAME} ${version} into ${where}` +
        ` (${result.write.length} written` +
        (result.remove.length > 0 ? `, ${result.remove.length} removed` : "") +
        ")",
    );
    for (const file of result.kept) {
      console.log(`  kept your edited copy of ${file} (no longer part of the skill)`);
    }
  }

  if (blocked) return 1;

  if (!options.dryRun) {
    console.log("\nStart a new agent session so it picks the skill up.");
  }
  return 0;
}

process.exitCode = main(process.argv.slice(2));
