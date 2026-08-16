#!/usr/bin/env node
/**
 * Runs the PolyCSS skill evaluation.
 *
 * For each (agent, task) pair:
 *   1. build a throwaway workspace containing only the installed skill and a
 *      TASK.md;
 *   2. run the agent's CLI non-interactively in that workspace;
 *   3. bundle whatever `scene.mjs` it produced and grade what renders.
 *
 * WHAT THE ISOLATION IS, AND IS NOT
 *
 * The workspace sits outside the repository, so an agent cannot reach this
 * monorepo by walking up from its working directory — which one did, on the
 * no-skill control track, before the move.
 *
 * It is NOT a sandbox. The agent still has the host filesystem by absolute
 * path, the real HOME and any globally installed skills, network access, and
 * sibling task workspaces under the same root. Several adapters also run with
 * approvals bypassed. So a score here is evidence that the skill is sufficient,
 * not proof that it was the only source used. Treat cross-track differences as
 * the signal and single-track absolutes as approximate; for a stronger claim,
 * run each case in a container with a temporary HOME and no network.
 *
 * Usage:
 *   node eval/skill/run.mjs --agent oracle
 *   node eval/skill/run.mjs --agent claude,codex --task 01-static-cube
 *   node eval/skill/run.mjs --agent all --json results.json
 */
import { randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { AGENTS, AGENT_NAMES, availableAgents, expandAgents, isAvailable } from "./agents.mjs";
import { allChecks, TASK_IDS, selectTasks } from "./tasks.mjs";
import { selectTracks, TRACK_NAMES, TRACKS } from "./tracks.mjs";
import { verifyCandidates } from "./verify.mjs";

const here = resolve(fileURLToPath(import.meta.url), "..");
const repoRoot = resolve(here, "..", "..");
/**
 * Workspaces live OUTSIDE the repository. Inside it, an agent can walk up out
 * of its workspace and read the PolyCSS monorepo — measured: a control-track
 * run with no skill installed found `@layoutit/polycss/three` in the source
 * tree and imported it, which is not the clean room this is supposed to be.
 */
const workRoot = join(tmpdir(), "polycss-skill-eval");
const installer = join(repoRoot, "packages/skills/bin/polycss-skills.mjs");

const USAGE = `Usage: node eval/skill/run.mjs [options]

Options
  --agent <names>   Comma-separated: ${AGENT_NAMES.join(", ")}, or all.
                    Default: oracle.
  --track <names>   Comma-separated: ${TRACK_NAMES.join(", ")}, or all.
                    Default: polycss. "polycss-noskill" is the control (same
                    library, skill withheld); "three" is an external baseline,
                    not a control.
  --task <ids>      Comma-separated task ids. Default: all.
  --keep            Keep the agent workspaces for inspection.
  --reuse           Grade existing workspaces only. Never invokes an agent:
                    a case with no scene.mjs is SKIPPED, not re-run.
  --run <id>        Namespace this run's workspaces. Defaults to a fresh unique
                    id, printed on start, so no run can overwrite another's.
                    Required with --reuse, which needs a specific run to grade.
  --allow-missing   With --reuse, tolerate requested cases that have no
                    scene.mjs instead of failing.
  --replace         Clear an existing run root before a fresh run.
  --no-preflight    Skip the per-agent readiness probe.
  --headed          Run Chromium headed.
  --settle <ms>     Delay between the two DOM samples (default 2000).
  --timeout <s>     Per-agent-invocation timeout (default 600).
  --json <file>     Also write the full result as JSON.
  --list            List agents and tasks, then exit.

Tasks
${TASK_IDS.map((id) => `  ${id}`).join("\n")}
`;

/** `--timeout nope` used to become NaN, pass silently, and land as null in the JSON. */
function positiveNumber(flag, raw) {
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${flag} needs a positive number, got ${JSON.stringify(raw)}`);
  }
  return value;
}

function parseArgs(argv) {
  const options = {
    agents: [],
    tracks: [],
    tasks: [],
    keep: false,
    reuse: false,
    allowMissing: false,
    replace: false,
    run: null,
    preflight: true,
    headed: false,
    settle: 2000,
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
    else if (arg === "--track") options.tracks.push(...value().split(",").map((t) => t.trim()));
    else if (arg === "--task") options.tasks.push(...value().split(",").map((t) => t.trim()));
    else if (arg === "--keep") options.keep = true;
    else if (arg === "--reuse") options.reuse = true;
    else if (arg === "--allow-missing") options.allowMissing = true;
    else if (arg === "--replace") options.replace = true;
    else if (arg === "--run") options.run = value();
    else if (arg === "--no-preflight") options.preflight = false;
    else if (arg === "--headed") options.headed = true;
    else if (arg === "--settle") options.settle = positiveNumber(arg, value());
    else if (arg === "--timeout") options.timeout = positiveNumber(arg, value());
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
function makeWorkspace(runId, track, agent, task) {
  const dir = workspaceDir(runId, track, agent, task);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });

  // Only the track under test gets the skill. The control measures what the
  // model already knows, so handing it anything would defeat the comparison.
  if (TRACKS[track].installSkill) {
    execFileSync(process.execPath, [installer, "--cwd", dir, "--agent", "all"], { stdio: "pipe" });
  }

  writeFileSync(join(dir, "TASK.md"), `# Task\n\n${taskPrompt(track, task)}\n`);
  return dir;
}

const taskPrompt = (track, task) => `${task.prompt}\n\n${TRACKS[track].contract}`;

/**
 * Workspaces are namespaced per run. Without that, every run owned the same
 * `track/agent/task` path and wiped it before starting — a second `--keep` run
 * silently destroyed the evidence the first one was asked to preserve, and two
 * concurrent runs would fight over the same directories.
 */
const workspaceDir = (runId, track, agent, task) =>
  join(workRoot, runId, `track-${track}`, agent, task.id);

/**
 * Control tracks run first, and each track owns a separate root.
 *
 * With one shared root the no-skill control could read the intervention's
 * installed skill through a sibling path — reproduced at
 * `../../../polycss/<task>/.agents/skills/polycss/SKILL.md`. Ordering the
 * skill-less tracks first means those workspaces do not exist yet while the
 * control runs. This narrows the leak; it is not a sandbox, and the README
 * says so.
 */
const orderTracks = (names) =>
  [...names].sort((a, b) => Number(TRACKS[a].installSkill) - Number(TRACKS[b].installSkill));

/**
 * Run ids name a directory that gets recursively deleted, so they are
 * validated rather than trusted: `--run ..` resolved above the workspace root
 * and would have taken a sibling directory with it.
 */
function assertSafeRunId(runId) {
  if (!/^[A-Za-z0-9._-]+$/.test(runId) || runId === "." || runId === "..") {
    throw new Error(
      `invalid --run id ${JSON.stringify(runId)} — use letters, digits, dot, dash or underscore`,
    );
  }
  return runId;
}

function runAgent(name, track, dir, task, timeoutSeconds) {
  const agent = AGENTS[name];

  if (name === "oracle") {
    // The control shares the intervention's reference solutions — it differs
    // only in whether the agent was given the skill.
    const oracleTrack = track === "polycss-noskill" ? "polycss" : track;
    const from = join(here, "oracle", oracleTrack, `${task.id}.mjs`);
    copyFileSync(from, join(dir, "scene.mjs"));
    // The Three reference scenes share a small setup helper; the bundler
    // resolves it relative to the copied entry.
    const shared = join(here, "oracle", oracleTrack, "_common.mjs");
    if (existsSync(shared)) copyFileSync(shared, join(dir, "_common.mjs"));
    return { ok: true, ms: 0, output: "reference solution copied" };
  }

  // IDENTICAL on every track. The intervention used to carry an extra "you
  // have the skill installed — use it" cue, which measured the files plus an
  // activation prompt rather than the skill. Whether the agent discovers the
  // project-local skill IS the intervention; telling it to is not.
  const prompt = `Read TASK.md in this directory and complete it.\n\n${taskPrompt(track, task)}`;
  const started = Date.now();
  try {
    const output = execFileSync(agent.bin, agent.argv(prompt, dir), {
      cwd: dir,
      encoding: "utf8",
      timeout: timeoutSeconds * 1000,
      // SIGTERM is advisory and some CLIs ignore it while blocked on an
      // interactive prompt — one unauthenticated agent sat on a task for 48
      // minutes past its timeout before this was SIGKILL.
      killSignal: "SIGKILL",
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

/**
 * One trivial task per agent before the real matrix starts. An agent that is
 * not logged in blocks on an interactive prompt forever; finding that out now
 * costs one minute instead of an hour of dead runs.
 */
function preflight(name, runId, timeoutSeconds = 90) {
  if (name === "oracle") return { ok: true };
  const dir = join(workRoot, runId, "__preflight__", name);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const agent = AGENTS[name];
  try {
    execFileSync(
      agent.bin,
      agent.argv("Write a file named ready.txt containing the word READY. Then stop.", dir),
      {
        cwd: dir,
        encoding: "utf8",
        timeout: timeoutSeconds * 1000,
        killSignal: "SIGKILL",
        maxBuffer: 8 * 1024 * 1024,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
  } catch (error) {
    const out = `${error.stdout ?? ""}${error.stderr ?? ""}`;
    if (/authenticat|sign in|login|api key/i.test(out)) {
      return { ok: false, reason: "needs authentication — run the CLI once interactively and log in" };
    }
    return { ok: false, reason: `probe failed after ${timeoutSeconds}s (${error.code ?? error.message})` };
  }
  return existsSync(join(dir, "ready.txt"))
    ? { ok: true }
    : { ok: false, reason: "probe returned but wrote no file" };
}

/** Best-effort CLI version string, so a result can be tied to what produced it. */
function agentVersion(name) {
  const agent = AGENTS[name];
  if (!agent?.bin) return null;
  try {
    return execFileSync(agent.bin, ["--version"], {
      encoding: "utf8",
      timeout: 20000,
      killSignal: "SIGKILL",
      stdio: ["ignore", "pipe", "ignore"],
    })
      .trim()
      .split("\n")[0];
  } catch {
    return null;
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
  let tracks;
  try {
    agents = expandAgents(options.agents.length > 0 ? options.agents : ["oracle"]);
    tasks = selectTasks(options.tasks);
    tracks = selectTracks(options.tracks);
    if (options.reuse && options.run === null) {
      throw new Error("--reuse needs --run <id>: it grades a specific retained run");
    }
    if (options.run === null) options.run = `run-${randomBytes(4).toString("hex")}`;
    assertSafeRunId(options.run);
    // Track-first ordering only isolates a CLEAN root. Naming an existing kept
    // run leaves the previous track's installed skill readable by this run's
    // control, so a fresh run refuses it unless the caller asks to replace it.
    if (!options.reuse && existsSync(join(workRoot, options.run))) {
      if (!options.replace) {
        throw new Error(
          `run "${options.run}" already exists — pass --replace to clear it, --reuse to grade it, or omit --run for a fresh id`,
        );
      }
      rmSync(join(workRoot, options.run), { recursive: true, force: true });
    }
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

  if (options.preflight && !options.reuse) {
    for (const name of [...agents]) {
      process.stdout.write(`[eval] preflight ${name} ... `);
      const ready = preflight(name, options.run);
      console.log(ready.ok ? "ready" : `SKIPPED: ${ready.reason}`);
      if (!ready.ok) agents.splice(agents.indexOf(name), 1);
    }
    rmSync(join(workRoot, options.run, "__preflight__"), { recursive: true, force: true });
    if (agents.length === 0) {
      console.error("[eval] no agent is ready");
      return 1;
    }
    console.log();
  }

  console.log(
    `[eval] run ${options.run} — ${agents.length} agent(s) x ${tracks.length} track(s) x ${tasks.length} task(s) = ${agents.length * tracks.length * tasks.length} run(s)\n`,
  );

  const startedAt = new Date();
  const candidates = [];
  const created = new Set();
  let skipped = 0;

  // Track is the OUTER loop. With agents outermost, ordering tracks only
  // isolated the FIRST agent: once Claude's with-skill workspaces existed,
  // Codex's control could read them at
  // ../../../track-polycss/claude/<task>/.agents/skills/polycss/SKILL.md.
  for (const track of orderTracks(tracks)) {
    for (const name of agents) {
      for (const task of tasks) {
      process.stdout.write(`[eval] ${name} / ${track} / ${task.id} ... `);
      const existingDir = workspaceDir(options.run, track, name, task);
      const reusing = options.reuse && existsSync(join(existingDir, "scene.mjs"));

      // Reuse means "grade what is already there". Falling through to the
      // agent here would spend real, paid calls behind a flag documented as
      // costing none.
      if (options.reuse && !reusing) {
        console.log("skipped — no scene.mjs to reuse");
        skipped += 1;
        continue;
      }

      const dir = reusing ? existingDir : makeWorkspace(options.run, track, name, task);
      if (!reusing) created.add(dir);
      const run = reusing
        ? { ok: true, ms: 0, output: "reused existing workspace" }
        : runAgent(name, track, dir, task, options.timeout);

      let source = null;
      try {
        source = readFileSync(join(dir, "scene.mjs"), "utf8");
      } catch {
        /* the agent never produced one */
      }

      console.log(
        source === null
          ? `no scene.mjs (${(run.ms / 1000).toFixed(0)}s)`
          : reusing
            ? "reused scene.mjs"
            : `wrote scene.mjs (${(run.ms / 1000).toFixed(0)}s)`,
      );

      candidates.push({
        order: candidates.length,
        key: `${name}__${track}__${task.id}`,
        agent: name,
        trackName: track,
        track: TRACKS[track],
        task,
        dir,
        run,
        source,
        entry: source === null ? null : join(dir, "scene.mjs"),
      });
      }
    }
  }

  if (skipped > 0) {
    console.log(`\n[eval] skipped ${skipped} case(s) with nothing to reuse`);
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
    const applicable = candidate.track.installSkill
      ? allChecks(candidate.task)
      : candidate.task.visual;
    const checks =
      result?.checks ??
      applicable.map((check) => ({
        id: check.id,
        describe: check.describe,
        pass: false,
        reason: "not run — the agent produced no scene.mjs",
      }));
    const passed = checks.filter((c) => c.pass).length;
    return {
      order: candidate.order,
      agent: candidate.agent,
      track: candidate.trackName,
      task: candidate.task.id,
      wroteScene: candidate.source !== null,
      buildOk: result?.build?.ok ?? false,
      buildError: result?.build?.ok === false ? result.build.error : null,
      seconds: Math.round(candidate.run.ms / 1000),
      passed,
      total: checks.length,
      visualPassed: checks.filter((c) => c.pass && candidate.task.visual.some((v) => v.id === c.id)).length,
      visualTotal: candidate.task.visual.length,
      checks,
    };
  });

  for (const agent of agents) {
    for (const track of tracks) {
      const mine = rows.filter((r) => r.agent === agent && r.track === track);
      if (mine.length === 0) continue;
      const passed = mine.reduce((n, r) => n + r.passed, 0);
      const total = mine.reduce((n, r) => n + r.total, 0);
      console.log(`${AGENTS[agent].label} / ${TRACKS[track].label} — ${passed}/${total} checks`);
      for (const row of mine) {
        console.log(
          `  ${bar(row.passed, row.total)} ${row.passed}/${row.total}  ${row.task}  (${row.seconds}s)`,
        );
        if (row.buildError) console.log(`      build failed: ${row.buildError}`);
        for (const check of row.checks.filter((c) => !c.pass)) {
          console.log(`      x ${check.id}: ${check.reason}`);
        }
      }
      console.log();
    }
  }

  // The comparison the control exists for: the same visual criteria, scored on
  // each track independently. Never a pixel diff between the two.
  if (tracks.length > 1) {
    console.log(
      "Visual criteria only. polycss vs polycss-noskill isolates the skill;\n" +
        "three is an external baseline, not a control.\n",
    );
    const width = Math.max(...agents.map((a) => AGENTS[a].label.length));
    console.log(`${"agent".padEnd(width)}  ${tracks.map((t) => TRACKS[t].label.padEnd(10)).join(" ")}`);
    for (const agent of agents) {
      const cells = tracks.map((track) => {
        const mine = rows.filter((r) => r.agent === agent && r.track === track);
        const p = mine.reduce((n, r) => n + r.visualPassed, 0);
        const t = mine.reduce((n, r) => n + r.visualTotal, 0);
        return `${p}/${t}`.padEnd(10);
      });
      console.log(`${AGENTS[agent].label.padEnd(width)}  ${cells.join(" ")}`);
    }
    console.log();
  }

  if (options.json) {
    // Rows alone cannot be audited. Record what produced them.
    const provenance = {
      runId: options.run,
      commit: (() => {
        try {
          return execFileSync("git", ["rev-parse", "HEAD"], {
            cwd: repoRoot,
            encoding: "utf8",
          }).trim();
        } catch {
          return null;
        }
      })(),
      startedAt: startedAt.toISOString(),
      finishedAt: new Date().toISOString(),
      agents,
      tracks,
      tasks: tasks.map((t) => t.id),
      timeoutSeconds: options.timeout,
      settleMs: options.settle,
      reuse: options.reuse,
      trackOrder: orderTracks(tracks),
      agentVersions: Object.fromEntries(
        agents.map((name) => [name, agentVersion(name)]),
      ),
    };
    writeFileSync(resolve(options.json), `${JSON.stringify({ provenance, rows }, null, 2)}\n`);
    console.log(`[eval] wrote ${options.json}`);
  }
  if (!options.keep) {
    // Remove only what THIS run created. Wiping the shared root also deleted
    // workspaces another run had deliberately kept, which lost evidence that
    // had already cost real agent invocations to produce.
    // Only directories this invocation created. Reused inputs belong to an
    // earlier run that was explicitly kept; deleting them destroyed the very
    // evidence the reuse flow exists to re-grade.
    for (const dir of created) {
      rmSync(dir, { recursive: true, force: true });
    }
  } else {
    console.log(`[eval] workspaces kept in ${join(workRoot, options.run)}`);
  }

  if (rows.length === 0) {
    // `rows.every` is vacuously true, so a run where every case was skipped
    // would otherwise exit 0 and read as a green result in CI.
    console.error("[eval] no scenes were graded");
    return 1;
  }

  if (skipped > 0 && !options.allowMissing) {
    console.error(
      `[eval] ${skipped} requested case(s) had nothing to reuse — pass --allow-missing to tolerate that`,
    );
    return 1;
  }

  // The oracle is the harness's own correctness gate, so it fails the run even
  // when other agents are selected — a broken oracle beside a passing agent
  // used to exit 0.
  const oracleRows = rows.filter((r) => r.agent === "oracle");
  if (oracleRows.some((r) => r.passed !== r.total)) {
    console.error("[eval] reference solutions regressed — the graders or the oracles are wrong");
    return 1;
  }

  const allPassed = rows.every((r) => r.passed === r.total);
  // Only the reference solution is expected to be perfect; a real agent
  // scoring below 100% is a finding, not a harness failure.
  // Real agents scoring below 100% is a finding, not a harness failure.
  return allPassed || agents.some((a) => a !== "oracle") ? 0 : 1;
}

process.exitCode = await main(process.argv.slice(2));
