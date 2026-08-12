/**
 * Agent adapters for the skill evaluation.
 *
 * Each adapter turns a prompt + workspace directory into a non-interactive CLI
 * invocation. Every agent runs with approvals bypassed because the workspace is
 * a throwaway temp directory containing nothing but the task and the installed
 * skill — see run.mjs, which builds it.
 *
 * Adding an agent is one entry here. Flags drift between CLI releases; if an
 * adapter stops working, fix the `argv` for that one agent and nothing else.
 */
import { execFileSync } from "node:child_process";

/** Resolve a CLI on PATH without throwing. */
function which(bin) {
  try {
    return execFileSync("command", ["-v", bin], {
      shell: "/bin/sh",
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
}

export const AGENTS = {
  claude: {
    label: "Claude Code",
    bin: "claude",
    argv: (prompt) => ["--print", "--dangerously-skip-permissions", prompt],
  },
  codex: {
    label: "Codex",
    bin: "codex",
    argv: (prompt, cwd) => [
      "exec",
      "--sandbox",
      "workspace-write",
      "--skip-git-repo-check",
      "--cd",
      cwd,
      prompt,
    ],
  },
  gemini: {
    label: "Gemini CLI",
    bin: "gemini",
    argv: (prompt) => ["--prompt", prompt, "--yolo", "--skip-trust"],
  },
  grok: {
    label: "Grok",
    bin: "grok",
    argv: (prompt, cwd) => ["--single", prompt, "--always-approve", "--cwd", cwd],
  },
  /**
   * Not an agent: writes the reference solution straight into the workspace.
   * This is how we test the harness itself — `oracle` must score 100% on every
   * task, or a failure elsewhere is the grader's fault, not the agent's.
   */
  oracle: {
    label: "Reference solution",
    bin: null,
    argv: null,
  },
};

export const AGENT_NAMES = Object.keys(AGENTS);

export function isAvailable(name) {
  const agent = AGENTS[name];
  if (!agent) return false;
  if (agent.bin === null) return true;
  return which(agent.bin) !== null;
}

export function availableAgents() {
  return AGENT_NAMES.filter(isAvailable);
}

/** Expand `all` and comma-separated lists into a deduped agent name list. */
export function expandAgents(values) {
  const out = [];
  for (const value of values) {
    for (const part of value.split(",")) {
      const name = part.trim();
      if (!name) continue;
      if (name === "all") out.push(...availableAgents().filter((n) => n !== "oracle"));
      else out.push(name);
    }
  }
  return [...new Set(out)];
}
