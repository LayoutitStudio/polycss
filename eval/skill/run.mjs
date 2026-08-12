#!/usr/bin/env node
/**
 * Runs the PolyCSS skill evaluation.
 *
 * For each (agent, task) pair:
 *   1. build a throwaway workspace containing ONLY the installed skill and a
 *      TASK.md — no repo access, no examples, nothing to copy from;
 *   2. run the agent's CLI non-interactively in that workspace;
 *   3. bundle whatever `scene.mjs` it produced and grade what renders.
 *
 * The workspace isolation is the whole point. An agent that scores well here
 * did it from the skill, not from the surrounding source tree.
 *
 * Usage:
 *   node eval/skill/run.mjs --agent oracle
 *   node eval/skill/run.mjs --agent claude,codex --task 01-static-cube
 *   node eval/skill/run.mjs --agent all --json results.json
 */
import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { AGENTS, AGENT_NAMES, availableAgents, expandAgents, isAvailable } from "./agents.mjs";
import { TASK_IDS, selectTasks } from "./tasks.mjs";
import { verifyCandidates } from "./verify.mjs";

const here = resolve(fileURLToPath(import.meta.url), "..");
const repoRoot = resolve(here, "..", "..");
const workRoot = join(here, ".work");
const installer = join(repoRoot, "packages/skills/bin/polycss-skills.mjs");

const USAGE = `Usage: node eval/skill/run.mjs [options]

Options
  --agent <names>   Comma-separated: ${AGENT_NAMES.join(", ")}, or all.
                    Default: oracle.
  --task <ids>      Comma-separated task ids. Default: all.
  --keep            Keep the agent workspaces for inspection.
  --headed          Run Chromium headed.
  --settle <ms>     Delay between the two DOM samples (default 1200).
  --timeout <s>     Per-agent-invocation timeout (default 600).
  --json <file>     Also write the full result as JSON.
  --list            List agents and tasks, then exit.

Tasks
${TASK_IDS.map((id) => `  ${id}`).join("\n")}
`;

function parseArgs(argv) {
  const options = {
    agents: [],
    tasks: [],
    keep: false,
    headed: false,
    settle: 1200,
    timeout: 600,
    json: null,
    list: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const value = () => {
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) throw new Error(`${arg} requires a value`);
      i += 1;
      return next;
    };
    if (arg === "--agent") options.agents.push(value());
    else if (arg === "--task") options.tasks.push(...value().split(",").map((t) => t.trim()));
    else if (arg === "--keep") options.keep = true;
    else if (arg === "--headed") options.headed = true;
    else if (arg === "--settle") options.settle = Number(value());
    else if (arg === "--timeout") options.timeout = Number(value());
    else if (arg === "--json") options.json = value();
    else if (arg === "--list") options.list = true;
    else if (arg === "--help" || arg === "-h") return null;
    else throw new Error(`unknown option "${arg}"`);
  }
  return options;
}

/**
 * A workspace holds the installed skill and the task, and nothing else. Agents
 * read their skills directory relative to the working directory, so installing
 * both flavours covers every CLI without special-casing.
 */
function makeWorkspace(agent, task) {
  const dir = join(workRoot, agent, task.id);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });

  execFileSync(process.execPath, [installer, "--cwd", dir, "--agent", "all"], {
    stdio: "pipe",
  });

  writeFileSync(join(dir, "TASK.md"), `# Task\n\n${task.prompt}\n`);
  return dir;
}

function runAgent(name, dir, task, timeoutSeconds) {
  const agent = AGENTS[name];

  if (name === "oracle") {
    copyFileSync(join(here, "oracle", `${task.id}.mjs`), join(dir, "scene.mjs"));
    return { ok: true, ms: 0, output: "reference solution copied" };
  }

  const prompt = `Read TASK.md in this directory and complete it. You have the PolyCSS skill installed in this workspace — use it.\n\n${task.prompt}`;
  const started = Date.now();
  try {
    const output = execFileSync(agent.bin, agent.argv(prompt, dir), {
      cwd: dir,
      encoding: "utf8",
      timeout: timeoutSeconds * 1000,
      maxBuffer: 64 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { ok: true, ms: Date.now() - started, output };
  } catch (error) {
    return {
      ok: false,
      ms: Date.now() - started,
      output: `${error.stdout ?? ""}${error.stderr ?? ""}`.trim() || String(error.message),
    };
  }
}

const bar = (passed, total) => {
  const filled = total === 0 ? 0 : Math.round((passed / total) * 10);
  return `${"#".repeat(filled)}${".".repeat(10 - filled)}`;
};

async function main(argv) {
  let options;
  try {
    options = parseArgs(argv);
  } catch (error) {
    console.error(`${error.message}\n\n${USAGE}`);
    return 1;
  }
  if (options === null) {
    console.log(USAGE);
    return 0;
  }
  if (options.list) {
    console.log("Agents:");
    for (const name of AGENT_NAMES) {
      console.log(`  ${name.padEnd(8)} ${isAvailable(name) ? "available" : "not on PATH"}`);
    }
    console.log(`\nTasks:\n${TASK_IDS.map((id) => `  ${id}`).join("\n")}`);
    return 0;
  }

  let agents;
  let tasks;
  try {
    agents = expandAgents(options.agents.length > 0 ? options.agents : ["oracle"]);
    tasks = selectTasks(options.tasks);
  } catch (error) {
    console.error(error.message);
    return 1;
  }

  const missing = agents.filter((name) => !AGENT_NAMES.includes(name));
  if (missing.length > 0) {
    console.error(`unknown agent(s): ${missing.join(", ")}\nknown: ${AGENT_NAMES.join(", ")}`);
    return 1;
  }
  const offline = agents.filter((name) => !isAvailable(name));
  if (offline.length > 0) {
    console.error(
      `not on PATH: ${offline.join(", ")}\navailable: ${availableAgents().join(", ")}`,
    );
    return 1;
  }

  console.log(
    `[eval] ${agents.length} agent(s) x ${tasks.length} task(s) = ${agents.length * tasks.length} run(s)\n`,
  );

  const candidates = [];

  for (const name of agents) {
    for (const task of tasks) {
      process.stdout.write(`[eval] ${name} / ${task.id} ... `);
      const dir = makeWorkspace(name, task);
      const run = runAgent(name, dir, task, options.timeout);

      let source = null;
      try {
        source = readFileSync(join(dir, "scene.mjs"), "utf8");
      } catch {
        /* the agent never produced one */
      }

      console.log(
        source === null
          ? `no scene.mjs (${(run.ms / 1000).toFixed(0)}s)`
          : `wrote scene.mjs (${(run.ms / 1000).toFixed(0)}s)`,
      );

      candidates.push({
        key: `${name}__${task.id}`,
        agent: name,
        task,
        dir,
        run,
        source,
        entry: source === null ? null : join(dir, "scene.mjs"),
      });
    }
  }

  const buildable = candidates.filter((c) => c.entry !== null);
  console.log(`\n[eval] grading ${buildable.length} scene(s) in Chromium ...\n`);

  const graded =
    buildable.length === 0
      ? []
      : await verifyCandidates(buildable, { headed: options.headed, settleMs: options.settle });
  const byKey = new Map(graded.map((g) => [g.key, g]));

  const rows = candidates.map((candidate) => {
    const result = byKey.get(candidate.key);
    const checks =
      result?.checks ??
      candidate.task.checks.map((check) => ({
        id: check.id,
        describe: check.describe,
        pass: false,
        reason: "not run — the agent produced no scene.mjs",
      }));
    const passed = checks.filter((c) => c.pass).length;
    return {
      agent: candidate.agent,
      task: candidate.task.id,
      wroteScene: candidate.source !== null,
      buildOk: result?.build?.ok ?? false,
      buildError: result?.build?.ok === false ? result.build.error : null,
      seconds: Math.round(candidate.run.ms / 1000),
      passed,
      total: checks.length,
      checks,
    };
  });

  for (const agent of agents) {
    const mine = rows.filter((r) => r.agent === agent);
    const passed = mine.reduce((n, r) => n + r.passed, 0);
    const total = mine.reduce((n, r) => n + r.total, 0);
    console.log(`${AGENTS[agent].label} — ${passed}/${total} checks`);
    for (const row of mine) {
      console.log(`  ${bar(row.passed, row.total)} ${row.passed}/${row.total}  ${row.task}  (${row.seconds}s)`);
      if (row.buildError) console.log(`      build failed: ${row.buildError}`);
      for (const check of row.checks.filter((c) => !c.pass)) {
        console.log(`      x ${check.id}: ${check.reason}`);
      }
    }
    console.log();
  }

  if (options.json) {
    writeFileSync(resolve(options.json), `${JSON.stringify({ rows }, null, 2)}\n`);
    console.log(`[eval] wrote ${options.json}`);
  }
  if (!options.keep) {
    rmSync(workRoot, { recursive: true, force: true });
  } else {
    console.log(`[eval] workspaces kept in ${workRoot.replace(`${repoRoot}/`, "")}`);
  }

  const allPassed = rows.every((r) => r.passed === r.total);
  // Only the reference solution is expected to be perfect; a real agent
  // scoring below 100% is a finding, not a harness failure.
  return agents.length === 1 && agents[0] === "oracle" && !allPassed ? 1 : 0;
}

process.exitCode = await main(process.argv.slice(2));
