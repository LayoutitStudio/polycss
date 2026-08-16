/**
 * Enforces the package dependency rules documented in AGENTS.md:
 *
 *   core     → (nothing; pure ES2020, no browser or node builtins)
 *   polycss  → core
 *   react    → core (+ react, react-dom)   — NEVER polycss
 *   vue      → core (+ vue)                — NEVER polycss
 *   fonts    → core + earcut
 *   morph    → polycss public API (+ core); node builtins only under prepare/
 *   domformat→ (no workspace deps)
 *
 * Also forbids, everywhere in the repo, deep imports into another package's
 * src (e.g. `@layoutit/polycss-core/src/...` or `../../packages/x/src/...`)
 * except for explicitly allowlisted dev-tooling entries.
 *
 * These rules previously lived only in prose + a PR checklist; this script is
 * the CI-enforced version. Run: `node .github/scripts/check-boundaries.mjs`
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** Allowed EXTERNAL specifier prefixes per package (workspace + third-party). */
export const PACKAGE_RULES = {
  core: { allow: [] },
  polycss: { allow: ["@layoutit/polycss-core"] },
  react: { allow: ["@layoutit/polycss-core", "react", "react-dom"] },
  vue: { allow: ["@layoutit/polycss-core", "vue"] },
  fonts: { allow: ["@layoutit/polycss-core", "earcut"] },
  morph: { allow: ["@layoutit/polycss", "@layoutit/polycss-core"] },
  domformat: { allow: [] },
};

/** Packages whose runtime source must not touch node builtins. */
const NO_NODE_BUILTINS = new Set(["core", "polycss", "react", "vue", "fonts"]);

/** morph is Node-only under prepare/; its browser graph must stay clean. */
const MORPH_NODE_PREFIX = `src${sep}prepare${sep}`;

/**
 * Known deep-src imports that are accepted for now. Keep this list SHORT and
 * annotated; every entry is debt.
 */
export const DEEP_IMPORT_ALLOWLIST = new Set([
  // bench/ is not a workspace member, and the atlas emit surface it measures
  // is intentionally not public API. Tracked as F1 in the architecture notes.
  "bench/entries/atlasBackground.ts",
]);

const SOURCE_RE = /\.(ts|tsx|mts|cts)$/;
const IMPORT_RE =
  /(?:^|\s)(?:import|export)\s+(?:[^"'`]*?\s+from\s+)?["']([^"']+)["']|(?:^|[^.\w])(?:import|require)\s*\(\s*["']([^"']+)["']\s*\)/gm;

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "dist" || entry === ".generated")
      continue;
    const abs = resolve(dir, entry);
    if (statSync(abs).isDirectory()) yield* walk(abs);
    else if (SOURCE_RE.test(entry)) yield abs;
  }
}

export function extractSpecifiers(source) {
  const specifiers = [];
  for (const match of source.matchAll(IMPORT_RE)) {
    const spec = match[1] ?? match[2];
    if (spec) specifiers.push(spec);
  }
  return specifiers;
}

const isRelative = (spec) => spec.startsWith(".");
const isTestFile = (file) => /\.test\.(ts|tsx|mts|cts)$/.test(file);

function checkPackage(root, pkg, rules, violations) {
  const srcDir = resolve(root, "packages", pkg, "src");
  for (const abs of walk(srcDir)) {
    const rel = relative(root, abs);
    const relInPkg = relative(resolve(root, "packages", pkg), abs);
    const source = readFileSync(abs, "utf8");
    for (const spec of extractSpecifiers(source)) {
      if (isRelative(spec)) {
        // Same-package escapes above src (e.g. ../../package.json) are fine;
        // only crossing into ANOTHER package's tree is a violation.
        const pkgDir = resolve(root, "packages", pkg);
        const resolved = resolve(dirname(abs), spec);
        if (!resolved.startsWith(pkgDir + sep) && resolved !== pkgDir) {
          violations.push(
            `${rel}: relative import escapes the package: "${spec}"`,
          );
        }
        continue;
      }
      if (/^@layoutit\/[^"']+\/src(\/|$)/.test(spec)) {
        violations.push(`${rel}: deep import into a package's src: "${spec}"`);
        continue;
      }
      // Test files may use dev-only tooling (vitest, happy-dom, node:test…).
      if (isTestFile(abs)) continue;
      if (spec.startsWith("node:")) {
        const nodeAllowed =
          !NO_NODE_BUILTINS.has(pkg) &&
          (pkg !== "morph" || relInPkg.startsWith(MORPH_NODE_PREFIX));
        if (!nodeAllowed) {
          violations.push(`${rel}: node builtin not allowed here: "${spec}"`);
        }
        continue;
      }
      const base = spec.startsWith("@")
        ? spec.split("/").slice(0, 2).join("/")
        : spec.split("/")[0];
      if (!rules.allow.includes(base)) {
        violations.push(`${rel}: disallowed dependency "${spec}"`);
      }
    }
  }
}

function checkDeepImportsOutsidePackages(root, violations) {
  const scanRoots = ["website/src", "website/scripts", "bench", "examples"]
    .map((dir) => resolve(root, dir))
    .filter((dir) => {
      try {
        return statSync(dir).isDirectory();
      } catch {
        return false;
      }
    });
  for (const scanRoot of scanRoots) {
    for (const abs of walk(scanRoot)) {
      const rel = relative(root, abs).split(sep).join("/");
      if (DEEP_IMPORT_ALLOWLIST.has(rel)) continue;
      const source = readFileSync(abs, "utf8");
      for (const spec of extractSpecifiers(source)) {
        const deepBare = /^@layoutit\/[^"']+\/src(\/|$)/.test(spec);
        const deepRelative =
          isRelative(spec) &&
          /(^|\/)packages\/[^/]+\/src(\/|$)/.test(
            relative(root, resolve(dirname(abs), spec)).split(sep).join("/"),
          );
        if (deepBare || deepRelative) {
          violations.push(
            `${rel}: deep import into a package's src: "${spec}"`,
          );
        }
      }
    }
  }
}

export function runChecks(root) {
  const violations = [];
  for (const [pkg, rules] of Object.entries(PACKAGE_RULES)) {
    checkPackage(root, pkg, rules, violations);
  }
  checkDeepImportsOutsidePackages(root, violations);
  return violations;
}

const isDirectRun =
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) {
  const violations = runChecks(repoRoot);
  if (violations.length > 0) {
    console.error("Boundary check failed:\n");
    for (const violation of violations) console.error(`  ${violation}`);
    console.error(
      `\n${violations.length} violation(s). The dependency rules live in ` +
        "AGENTS.md (monorepo table + PolyCSS Morph/domformat boundaries).",
    );
    process.exit(1);
  }
  console.log("Boundary check passed.");
}
