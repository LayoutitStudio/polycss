import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";

import { listFiles, rewriteEntryLinks } from "./sync-skill-docs.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..");
const script = join(here, "sync-skill-docs.mjs");

const temps = [];
after(() => {
  for (const dir of temps) rmSync(dir, { recursive: true, force: true });
});
const tmp = () => {
  const dir = mkdtempSync(join(tmpdir(), "skill-docs-"));
  temps.push(dir);
  return dir;
};

test("listFiles returns sorted POSIX paths and skips directories", () => {
  const dir = tmp();
  mkdirSync(join(dir, "docs"));
  writeFileSync(join(dir, "SKILL.md"), "a");
  writeFileSync(join(dir, "docs", "b.md"), "b");
  writeFileSync(join(dir, "docs", "a.md"), "a");

  assert.deepEqual(listFiles(dir), ["SKILL.md", "docs/a.md", "docs/b.md"]);
});

test("listFiles tolerates a missing directory", () => {
  assert.deepEqual(listFiles(join(tmp(), "nope")), []);
});

test("rewriteEntryLinks makes doc links site-absolute", () => {
  assert.equal(
    rewriteEntryLinks("see [x](docs/lighting.md) and [y](docs/shadows.md)"),
    "see [x](/skill/docs/lighting.md) and [y](/skill/docs/shadows.md)",
  );
});

test("rewriteEntryLinks leaves other links alone", () => {
  const input = "[a](https://polycss.com) [b](/skill/docs/x.md) [c](./docs/x.md) `docs/x.md`";
  assert.equal(rewriteEntryLinks(input), input);
});

test("--check exits 0 on a synced tree", () => {
  // The committed website copy must already match the package source.
  execFileSync(process.execPath, [script, "--check"], { cwd: repoRoot, stdio: "pipe" });
});

test("--check fails and writes nothing when the website copy drifts", () => {
  const target = join(repoRoot, "website/public/skill/SKILL.md");
  const original = readFileSync(target);
  writeFileSync(target, `${original}\ndrift\n`);
  try {
    assert.throws(
      () => execFileSync(process.execPath, [script, "--check"], { cwd: repoRoot, stdio: "pipe" }),
      (error) => error.status === 1,
    );
    // --check must never repair what it reports.
    assert.equal(readFileSync(target).toString(), `${original}\ndrift\n`);
  } finally {
    writeFileSync(target, original);
  }
});

test("--check reports a file the skill no longer ships", () => {
  const stale = join(repoRoot, "website/public/skill/docs/__stale__.md");
  writeFileSync(stale, "gone");
  try {
    assert.throws(
      () => execFileSync(process.execPath, [script, "--check"], { cwd: repoRoot, stdio: "pipe" }),
      (error) => error.status === 1 && /stale/.test(String(error.stderr)),
    );
  } finally {
    rmSync(stale, { force: true });
  }
});
