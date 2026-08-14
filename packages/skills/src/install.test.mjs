import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { symlinkSync } from "node:fs";
import {
  AGENTS,
  bundledSkillDir,
  DEFAULT_AGENT,
  expandAgents,
  installSkill,
  isSafeRelativePath,
  listFiles,
  MANIFEST_FILE,
  planInstall,
  resolveTargets,
  SKILL_NAME,
} from "./install.mjs";

const temps = [];
const tmp = () => {
  const dir = mkdtempSync(join(tmpdir(), "polycss-skills-"));
  temps.push(dir);
  return dir;
};
afterEach(() => {
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function fixture(files) {
  const dir = tmp();
  for (const [rel, body] of Object.entries(files)) {
    const path = join(dir, rel);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, body);
  }
  return dir;
}

const read = (dir, rel) => readFileSync(join(dir, rel), "utf8");
const manifest = (dir) => JSON.parse(read(dir, MANIFEST_FILE));

describe("listFiles", () => {
  it("returns sorted POSIX-relative paths and ignores directories", () => {
    const dir = fixture({ "SKILL.md": "a", "docs/b.md": "b", "docs/a.md": "a" });
    expect(listFiles(dir)).toEqual(["SKILL.md", "docs/a.md", "docs/b.md"]);
  });

  it("returns an empty list for a missing directory", () => {
    expect(listFiles(join(tmp(), "nope"))).toEqual([]);
  });
});

describe("installSkill", () => {
  it("writes every file and a manifest on a fresh install", () => {
    const sourceDir = fixture({ "SKILL.md": "hello", "docs/a.md": "aye" });
    const destDir = join(tmp(), "polycss");

    const result = installSkill({ sourceDir, destDir, version: "1.2.3" });

    expect(result.applied).toBe(true);
    expect(result.write).toEqual(["SKILL.md", "docs/a.md"]);
    expect(read(destDir, "SKILL.md")).toBe("hello");
    expect(read(destDir, "docs/a.md")).toBe("aye");
    expect(manifest(destDir)).toMatchObject({ skill: SKILL_NAME, version: "1.2.3" });
    expect(Object.keys(manifest(destDir).files)).toEqual(["SKILL.md", "docs/a.md"]);
  });

  it("is idempotent — a second run writes nothing", () => {
    const sourceDir = fixture({ "SKILL.md": "hello" });
    const destDir = join(tmp(), "polycss");

    installSkill({ sourceDir, destDir, version: "1.0.0" });
    const again = installSkill({ sourceDir, destDir, version: "1.0.0" });

    expect(again.write).toEqual([]);
    expect(again.unchanged).toEqual(["SKILL.md"]);
  });

  it("upgrades an untouched install in place", () => {
    const destDir = join(tmp(), "polycss");
    installSkill({ sourceDir: fixture({ "SKILL.md": "v1" }), destDir, version: "1.0.0" });

    const result = installSkill({
      sourceDir: fixture({ "SKILL.md": "v2" }),
      destDir,
      version: "2.0.0",
    });

    expect(result.applied).toBe(true);
    expect(read(destDir, "SKILL.md")).toBe("v2");
    expect(manifest(destDir).version).toBe("2.0.0");
  });

  it("refuses to overwrite a file the user edited", () => {
    const destDir = join(tmp(), "polycss");
    installSkill({ sourceDir: fixture({ "SKILL.md": "v1" }), destDir, version: "1.0.0" });
    writeFileSync(join(destDir, "SKILL.md"), "my notes");

    const result = installSkill({
      sourceDir: fixture({ "SKILL.md": "v2" }),
      destDir,
      version: "2.0.0",
    });

    expect(result.applied).toBe(false);
    expect(result.conflicts).toEqual(["SKILL.md"]);
    expect(read(destDir, "SKILL.md")).toBe("my notes");
  });

  it("overwrites an edited file under force", () => {
    const destDir = join(tmp(), "polycss");
    installSkill({ sourceDir: fixture({ "SKILL.md": "v1" }), destDir, version: "1.0.0" });
    writeFileSync(join(destDir, "SKILL.md"), "my notes");

    const result = installSkill({
      sourceDir: fixture({ "SKILL.md": "v2" }),
      destDir,
      version: "2.0.0",
      force: true,
    });

    expect(result.applied).toBe(true);
    expect(read(destDir, "SKILL.md")).toBe("v2");
  });

  it("treats a pre-existing directory with no manifest as a conflict", () => {
    const destDir = fixture({ "SKILL.md": "someone else's file" });

    const result = installSkill({
      sourceDir: fixture({ "SKILL.md": "ours" }),
      destDir,
      version: "1.0.0",
    });

    expect(result.applied).toBe(false);
    expect(result.conflicts).toEqual(["SKILL.md"]);
  });

  it("adopts a manifest-less directory whose content already matches", () => {
    const destDir = fixture({ "SKILL.md": "same" });

    const result = installSkill({
      sourceDir: fixture({ "SKILL.md": "same" }),
      destDir,
      version: "1.0.0",
    });

    expect(result.applied).toBe(true);
    expect(result.conflicts).toEqual([]);
    expect(manifest(destDir).files["SKILL.md"]).toBe(
      createHash("sha256").update("same").digest("hex"),
    );
  });

  it("removes files dropped from a newer version", () => {
    const destDir = join(tmp(), "polycss");
    installSkill({
      sourceDir: fixture({ "SKILL.md": "v1", "docs/gone.md": "old" }),
      destDir,
      version: "1.0.0",
    });

    const result = installSkill({
      sourceDir: fixture({ "SKILL.md": "v2" }),
      destDir,
      version: "2.0.0",
    });

    expect(result.remove).toEqual(["docs/gone.md"]);
    expect(() => read(destDir, "docs/gone.md")).toThrow();
    expect(manifest(destDir).files["docs/gone.md"]).toBeUndefined();
  });

  it("keeps an edited file that a newer version dropped", () => {
    const destDir = join(tmp(), "polycss");
    installSkill({
      sourceDir: fixture({ "SKILL.md": "v1", "docs/gone.md": "old" }),
      destDir,
      version: "1.0.0",
    });
    writeFileSync(join(destDir, "docs/gone.md"), "my notes");

    const result = installSkill({
      sourceDir: fixture({ "SKILL.md": "v2" }),
      destDir,
      version: "2.0.0",
    });

    expect(result.applied).toBe(true);
    expect(result.remove).toEqual([]);
    expect(result.kept).toEqual(["docs/gone.md"]);
    expect(read(destDir, "docs/gone.md")).toBe("my notes");
  });

  it("leaves files the user added alone", () => {
    const destDir = join(tmp(), "polycss");
    installSkill({ sourceDir: fixture({ "SKILL.md": "v1" }), destDir, version: "1.0.0" });
    writeFileSync(join(destDir, "MY-NOTES.md"), "mine");

    installSkill({ sourceDir: fixture({ "SKILL.md": "v2" }), destDir, version: "2.0.0" });

    expect(read(destDir, "MY-NOTES.md")).toBe("mine");
    expect(manifest(destDir).files["MY-NOTES.md"]).toBeUndefined();
  });

  it("writes nothing on a dry run", () => {
    const sourceDir = fixture({ "SKILL.md": "hello" });
    const destDir = join(tmp(), "polycss");

    const result = installSkill({ sourceDir, destDir, version: "1.0.0", dryRun: true });

    expect(result.applied).toBe(false);
    expect(result.write).toEqual(["SKILL.md"]);
    expect(() => read(destDir, "SKILL.md")).toThrow();
  });

  it("ignores a corrupt manifest rather than trusting it", () => {
    const destDir = join(tmp(), "polycss");
    installSkill({ sourceDir: fixture({ "SKILL.md": "v1" }), destDir, version: "1.0.0" });
    writeFileSync(join(destDir, MANIFEST_FILE), "{ not json");
    writeFileSync(join(destDir, "SKILL.md"), "edited");

    const result = installSkill({
      sourceDir: fixture({ "SKILL.md": "v2" }),
      destDir,
      version: "2.0.0",
    });

    expect(result.conflicts).toEqual(["SKILL.md"]);
  });

  it("rejects a manifest whose hashes are not strings", () => {
    const destDir = join(tmp(), "polycss");
    installSkill({ sourceDir: fixture({ "SKILL.md": "v1" }), destDir, version: "1.0.0" });
    writeFileSync(
      join(destDir, MANIFEST_FILE),
      JSON.stringify({ skill: SKILL_NAME, files: { "SKILL.md": { sha: 1 } } }),
    );
    writeFileSync(join(destDir, "SKILL.md"), "edited");

    const result = installSkill({
      sourceDir: fixture({ "SKILL.md": "v2" }),
      destDir,
      version: "2.0.0",
    });

    expect(result.conflicts).toEqual(["SKILL.md"]);
  });

  it("throws when the source tree is empty", () => {
    expect(() =>
      installSkill({ sourceDir: fixture({}), destDir: join(tmp(), "polycss") }),
    ).toThrow(/no skill files/);
  });
});

describe("hostile manifests and links stay inside the skill directory", () => {
  it("rejects traversal, absolute, backslash and dot path segments", () => {
    for (const bad of [
      "../package.json",
      "../../../package.json",
      "docs/../../escape.md",
      "/etc/passwd",
      "C:/Windows/system.ini",
      "docs\\win.md",
      "./docs/a.md",
      "docs//a.md",
      "",
    ]) {
      expect(isSafeRelativePath(bad), bad).toBe(false);
    }
    for (const good of ["SKILL.md", "docs/a.md", "docs/nested/b.md"]) {
      expect(isSafeRelativePath(good), good).toBe(true);
    }
  });

  it("does not delete a file outside the skill directory named by the manifest", () => {
    const project = tmp();
    const destDir = join(project, ".claude", "skills", "polycss");
    const outsider = join(project, "package.json");
    writeFileSync(outsider, '{"name":"victim"}');

    installSkill({
      sourceDir: fixture({ "SKILL.md": "v1" }),
      destDir,
      version: "1.0.0",
    });

    // A manifest entry pointing out of the tree, with the hash the cleanup
    // path checks before reclaiming a dropped file.
    writeFileSync(
      join(destDir, MANIFEST_FILE),
      JSON.stringify({
        skill: SKILL_NAME,
        version: "1.0.0",
        files: {
          "SKILL.md": createHash("sha256").update("v1").digest("hex"),
          "../../../package.json": createHash("sha256")
            .update('{"name":"victim"}')
            .digest("hex"),
        },
      }),
    );

    installSkill({ sourceDir: fixture({ "SKILL.md": "v2" }), destDir, version: "2.0.0" });

    expect(readFileSync(outsider, "utf8")).toBe('{"name":"victim"}');
  });

  it("does not delete outside the skill directory under --force either", () => {
    const project = tmp();
    const destDir = join(project, "skills", "polycss");
    const outsider = join(project, "package.json");
    writeFileSync(outsider, "keep me");

    installSkill({ sourceDir: fixture({ "SKILL.md": "v1" }), destDir, version: "1.0.0" });
    writeFileSync(
      join(destDir, MANIFEST_FILE),
      JSON.stringify({
        skill: SKILL_NAME,
        files: { "../../package.json": "whatever" },
      }),
    );

    installSkill({
      sourceDir: fixture({ "SKILL.md": "v2" }),
      destDir,
      version: "2.0.0",
      force: true,
    });

    expect(readFileSync(outsider, "utf8")).toBe("keep me");
  });

  it("refuses to write through a symlinked managed file", () => {
    const project = tmp();
    const destDir = join(project, "skills", "polycss");
    const outsider = join(project, "secret.txt");
    writeFileSync(outsider, "original");

    installSkill({ sourceDir: fixture({ "SKILL.md": "v1" }), destDir, version: "1.0.0" });
    rmSync(join(destDir, "SKILL.md"));
    symlinkSync(outsider, join(destDir, "SKILL.md"));

    const result = installSkill({
      sourceDir: fixture({ "SKILL.md": "v2" }),
      destDir,
      version: "2.0.0",
    });

    expect(result.applied).toBe(false);
    expect(result.conflicts).toEqual(["SKILL.md"]);
    expect(readFileSync(outsider, "utf8")).toBe("original");
  });

  it("replaces a symlink rather than following it under --force", () => {
    const project = tmp();
    const destDir = join(project, "skills", "polycss");
    const outsider = join(project, "secret.txt");
    writeFileSync(outsider, "original");

    installSkill({ sourceDir: fixture({ "SKILL.md": "v1" }), destDir, version: "1.0.0" });
    rmSync(join(destDir, "SKILL.md"));
    symlinkSync(outsider, join(destDir, "SKILL.md"));

    installSkill({
      sourceDir: fixture({ "SKILL.md": "v2" }),
      destDir,
      version: "2.0.0",
      force: true,
    });

    expect(readFileSync(outsider, "utf8")).toBe("original");
    expect(read(destDir, "SKILL.md")).toBe("v2");
  });

  it("ignores a manifest that is itself a symlink", () => {
    const project = tmp();
    const destDir = join(project, "skills", "polycss");
    const planted = join(project, "planted.json");

    installSkill({ sourceDir: fixture({ "SKILL.md": "v1" }), destDir, version: "1.0.0" });
    writeFileSync(
      planted,
      JSON.stringify({ skill: SKILL_NAME, files: { "SKILL.md": "not-the-real-hash" } }),
    );
    rmSync(join(destDir, MANIFEST_FILE));
    symlinkSync(planted, join(destDir, MANIFEST_FILE));
    writeFileSync(join(destDir, "SKILL.md"), "user edit");

    const result = installSkill({
      sourceDir: fixture({ "SKILL.md": "v2" }),
      destDir,
      version: "2.0.0",
    });

    expect(result.applied).toBe(false);
    expect(result.conflicts).toEqual(["SKILL.md"]);
  });
});

describe("planInstall", () => {
  it("does not touch disk", () => {
    const destDir = join(tmp(), "polycss");
    planInstall({ sourceDir: fixture({ "SKILL.md": "hello" }), destDir });
    expect(() => read(destDir, "SKILL.md")).toThrow();
  });
});

describe("resolveTargets", () => {
  it("selects every agent whose marker directory exists", () => {
    const cwd = tmp();
    mkdirSync(join(cwd, AGENTS.claude.root));
    mkdirSync(join(cwd, AGENTS.codex.root));

    expect(resolveTargets({ cwd }).map((t) => t.agent).sort()).toEqual(["claude", "codex"]);
  });

  it("selects only the detected agent", () => {
    const cwd = tmp();
    mkdirSync(join(cwd, AGENTS.codex.root));

    const targets = resolveTargets({ cwd });
    expect(targets).toHaveLength(1);
    expect(targets[0].agent).toBe("codex");
    expect(targets[0].dir).toBe(join(cwd, AGENTS.codex.skills, SKILL_NAME));
  });

  it("falls back to the default agent when nothing is detected", () => {
    const targets = resolveTargets({ cwd: tmp() });
    expect(targets).toHaveLength(1);
    expect(targets[0].agent).toBe(DEFAULT_AGENT);
    expect(targets[0].detected).toBe(false);
  });

  it("honours an explicit request over detection", () => {
    const cwd = tmp();
    mkdirSync(join(cwd, AGENTS.claude.root));

    const targets = resolveTargets({ cwd, requested: ["codex"] });
    expect(targets.map((t) => t.agent)).toEqual(["codex"]);
  });

  it("rejects an unknown agent", () => {
    expect(() => resolveTargets({ cwd: tmp(), requested: ["cursor"] })).toThrow(
      /unknown agent "cursor"/,
    );
  });
});

describe("expandAgents", () => {
  it("expands `all`, splits commas, and dedupes", () => {
    expect(expandAgents(["all"])).toEqual(Object.keys(AGENTS));
    expect(expandAgents(["claude,codex"])).toEqual(["claude", "codex"]);
    expect(expandAgents(["claude", "claude"])).toEqual(["claude"]);
    expect(expandAgents([" codex , "])).toEqual(["codex"]);
  });
});

describe("the shipped skill", () => {
  it("ships SKILL.md plus a docs folder", () => {
    const files = listFiles(bundledSkillDir());
    expect(files).toContain("SKILL.md");
    expect(files.filter((f) => f.startsWith("docs/")).length).toBeGreaterThan(0);
  });

  it("has name and description frontmatter", () => {
    const text = readFileSync(join(bundledSkillDir(), "SKILL.md"), "utf8");
    expect(text.startsWith("---\n")).toBe(true);
    const frontmatter = text.slice(4, text.indexOf("\n---", 4));
    expect(frontmatter).toMatch(/^name: polycss$/m);
    expect(frontmatter).toMatch(/^description: \S/m);
  });

  it("links only to docs that exist", () => {
    const dir = bundledSkillDir();
    const shipped = new Set(listFiles(dir));
    const text = readFileSync(join(dir, "SKILL.md"), "utf8");
    const links = [...text.matchAll(/\]\((docs\/[^)#]+)/g)].map((m) => m[1]);

    expect(links.length).toBeGreaterThan(0);
    for (const link of links) expect(shipped).toContain(link);
  });

  it("indexes every shipped doc from SKILL.md", () => {
    const dir = bundledSkillDir();
    const text = readFileSync(join(dir, "SKILL.md"), "utf8");
    for (const file of listFiles(dir).filter((f) => f.startsWith("docs/"))) {
      expect(text).toContain(file);
    }
  });

  it("resolves every cross-doc relative link", () => {
    const dir = bundledSkillDir();
    const shipped = new Set(listFiles(dir));
    for (const file of listFiles(dir).filter((f) => f.startsWith("docs/"))) {
      const text = readFileSync(join(dir, file), "utf8");
      for (const [, link] of text.matchAll(/\]\((?!https?:|#)([^)#]+)/g)) {
        expect(shipped, `${file} → ${link}`).toContain(`docs/${link}`);
      }
    }
  });
});
