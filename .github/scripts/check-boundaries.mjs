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
 *   skills   → (no workspace deps; a Node CLI that only copies markdown)
 *
 * The rules are applied to BOTH the source imports and the package manifest:
 * a package whose `dependencies` / `optionalDependencies` / `peerDependencies`
 * name something outside its allow-list fails even if no source file imports
 * it yet. (`devDependencies` are tooling and are not constrained.) Manifest
 * checking resolves the dependency VALUE — `npm:` aliases, `link:`/`file:`/
 * `portal:` local paths, `workspace:` aliases and `workspace:` relative paths
 * — because the key is not the package that gets installed. Specifier forms
 * whose target cannot be determined from the repo (`catalog:`, git specs,
 * tarball URLs, `jsr:`, unknown protocols) are reported as violations rather
 * than falling back to the key, since falling back to the key IS the bypass.
 *
 * Also forbids, everywhere in the repo, deep imports into another package's
 * src (e.g. `@layoutit/polycss-core/src/...` or `../../packages/x/src/...`)
 * except for explicitly allowlisted dev-tooling entries.
 *
 * These rules previously lived only in prose + a PR checklist; this script is
 * the CI-enforced version. Run: `node .github/scripts/check-boundaries.mjs`
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

/**
 * Allowed EXTERNAL specifier prefixes per package (workspace + third-party).
 * `dirs` lists the scanned source roots; it defaults to just `src`.
 */
export const PACKAGE_RULES = {
  core: { allow: [] },
  polycss: { allow: ["@layoutit/polycss-core"] },
  react: { allow: ["@layoutit/polycss-core", "react", "react-dom"] },
  vue: { allow: ["@layoutit/polycss-core", "vue"] },
  fonts: { allow: ["@layoutit/polycss-core", "earcut"] },
  morph: { allow: ["@layoutit/polycss", "@layoutit/polycss-core"] },
  domformat: { allow: [] },
  // The skill installer copies markdown with node builtins only; it must never
  // pull a renderer in, or `npx polycss-skills` would install a whole engine.
  skills: { allow: [], dirs: ["src", "bin"] },
};

/** Manifest fields that declare shipped dependencies. */
export const MANIFEST_DEPENDENCY_FIELDS = [
  "dependencies",
  "optionalDependencies",
  "peerDependencies",
];

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

const SOURCE_RE = /\.(ts|tsx|mts|cts|mjs|cjs|js)$/;
const IMPORT_RE =
  /(?:^|\s)(?:import|export)\s+(?:[^"'`]*?\s+from\s+)?["']([^"']+)["']|(?:^|[^.\w])(?:import|require)\s*\(\s*["']([^"']+)["']\s*\)/gm;

/** Build output and vendored trees are never authored source. */
const SKIPPED_DIRS = new Set([
  "node_modules",
  "dist",
  ".generated",
  "coverage",
  "build",
  "vendor",
]);

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    if (SKIPPED_DIRS.has(entry)) continue;
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
const isTestFile = (file) => /\.test\.(ts|tsx|mts|cts|mjs|cjs|js)$/.test(file);

/** `<name>` or `<name>@<range>`, scoped names included. */
function splitNameAtRange(spec) {
  if (!spec) return null;
  const at = spec.startsWith("@") ? spec.indexOf("@", 1) : spec.indexOf("@");
  const name = at === -1 ? spec : spec.slice(0, at);
  return name.length > 0 ? name : null;
}

function readLocalPackageName(packageDir, relPath) {
  if (!packageDir) return null;
  const manifestPath = resolve(packageDir, relPath, "package.json");
  if (!existsSync(manifestPath)) return null;
  try {
    const parsed = JSON.parse(readFileSync(manifestPath, "utf8"));
    return typeof parsed?.name === "string" && parsed.name.length > 0
      ? parsed.name
      : null;
  } catch {
    return null;
  }
}

/**
 * A `workspace:` / `link:` target that is a path rather than a package name.
 * `workspace:../polycss` and `workspace:packages/polycss` both mount a
 * different local package under the declared key; only a leading `@` marks a
 * scoped package NAME rather than a path.
 */
const isLocalPathSpec = (rest) =>
  rest.startsWith(".") ||
  rest.startsWith("/") ||
  rest.startsWith("~/") ||
  (rest.includes("/") && !rest.startsWith("@"));

/**
 * A bare semver range or range operator, which leaves the key as the installed
 * package: `^`, `*`, `~`, `1.2.3`, `^0.2.0`, `>=1 <2`, `1.x`. Anything else
 * after `workspace:` is a package name — with or without an `@range` suffix.
 */
const isVersionRange = (rest) => /^[\s*^~><=v\d.|xX+-]+$/.test(rest);

/** Specifier protocols whose install target this checker cannot determine. */
const UNRESOLVABLE_PROTOCOLS = new Map([
  [
    "catalog",
    "is a pnpm catalog reference whose target lives in pnpm-workspace.yaml",
  ],
  [
    "jsr",
    "is a JSR specifier, which installs under a rewritten npm name (@jsr/…)",
  ],
  ["git", "is a git specifier, whose installed package name is in the repo"],
  ["github", "is a git specifier, whose installed package name is in the repo"],
  ["gitlab", "is a git specifier, whose installed package name is in the repo"],
  [
    "bitbucket",
    "is a git specifier, whose installed package name is in the repo",
  ],
  ["gist", "is a git specifier, whose installed package name is in the repo"],
  ["http", "is a remote tarball, whose package name is inside the tarball"],
  ["https", "is a remote tarball, whose package name is inside the tarball"],
]);

/**
 * The manifest KEY is not the package that gets installed. `npm:` aliases,
 * `link:`/`file:`/`portal:` local paths, `workspace:<name>[@<range>]` aliases
 * and `workspace:<path>` targets all mount a DIFFERENT package under the
 * declared key, so `"@layoutit/polycss-core": "npm:@layoutit/polycss@0.2.0"`
 * would pass a key-only allow-list while installing the forbidden graph. The
 * allow-list is therefore applied to the resolved target, not the key.
 *
 * Anything this function cannot resolve is `unresolved`, which the caller
 * turns into a violation. That is deliberate: an unverifiable target is not a
 * permitted one, and the alternative — falling back to the key — is precisely
 * the bypass. Catalog references, git specs and tarball URLs therefore FAIL
 * with an explanation rather than passing; a package that needs one must
 * declare it in a form the checker can see through.
 */
export function resolveDependencyTarget(name, spec, options = {}) {
  if (typeof spec !== "string") {
    return { unresolved: "has a non-string version specifier" };
  }
  const value = spec.trim();
  if (value.length === 0) {
    return { unresolved: "has an empty version specifier" };
  }

  if (value.startsWith("npm:")) {
    const target = splitNameAtRange(value.slice("npm:".length));
    return target
      ? { name: target, via: `npm alias "${value}"` }
      : { unresolved: `has an unparseable npm alias "${value}"` };
  }

  const local = /^(link|file|portal):(.*)$/.exec(value);
  if (local) {
    const target = readLocalPackageName(options.packageDir, local[2]);
    return target
      ? { name: target, via: `${local[1]}: target ${local[2]}` }
      : {
          unresolved:
            `points at local target "${value}", whose package.json name ` +
            "could not be read",
        };
  }

  if (value.startsWith("workspace:")) {
    const rest = value.slice("workspace:".length);
    if (rest.length === 0) {
      return { unresolved: 'has an empty "workspace:" specifier' };
    }
    if (isLocalPathSpec(rest)) {
      const target = readLocalPackageName(options.packageDir, rest);
      return target
        ? { name: target, via: `workspace path target ${rest}` }
        : {
            unresolved:
              `points at workspace path "${value}", whose package.json name ` +
              "could not be read",
          };
    }
    // `workspace:^`, `workspace:*`, `workspace:1.2.3` keep the key; every
    // other form names a package, whether or not it carries an `@range`.
    if (isVersionRange(rest)) return { name };
    const target = splitNameAtRange(rest);
    return target
      ? { name: target, via: `workspace alias "${value}"` }
      : { unresolved: `has an unparseable workspace alias "${value}"` };
  }

  const protocol = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(value);
  if (protocol) {
    const base = protocol[1].toLowerCase().split("+")[0];
    const known = UNRESOLVABLE_PROTOCOLS.get(base);
    return {
      unresolved: known
        ? `${known}, so the installed package cannot be verified here`
        : `uses an unrecognised specifier protocol "${protocol[1]}:"`,
    };
  }

  // npm's `owner/repo` shorthand is a git dependency. A semver range or a
  // dist-tag never contains a slash, so this is unambiguous.
  if (value.includes("/")) {
    return {
      unresolved:
        `looks like a git shorthand ("${value}"), whose installed package ` +
        "name is inside the repository",
    };
  }

  return { name };
}

/**
 * The manifest is the other half of the boundary: an unused-but-declared
 * dependency still ships to npm and still puts the package on the wrong graph.
 */
export function checkManifestDependencies(manifest, pkg, rules, options = {}) {
  const violations = [];
  for (const field of MANIFEST_DEPENDENCY_FIELDS) {
    const declared = manifest?.[field];
    if (!declared || typeof declared !== "object") continue;
    for (const [name, spec] of Object.entries(declared)) {
      if (!rules.allow.includes(name)) {
        violations.push(
          `packages/${pkg}/package.json: disallowed ${field} entry "${name}"`,
        );
        continue;
      }
      const resolved = resolveDependencyTarget(name, spec, {
        packageDir: options.packageDir,
      });
      if (resolved.unresolved) {
        violations.push(
          `packages/${pkg}/package.json: ${field} entry "${name}" ` +
            `${resolved.unresolved}, so the allow-list cannot be applied`,
        );
        continue;
      }
      if (resolved.name !== name && !rules.allow.includes(resolved.name)) {
        violations.push(
          `packages/${pkg}/package.json: ${field} entry "${name}" resolves to ` +
            `disallowed package "${resolved.name}" via ${resolved.via}`,
        );
      }
    }
  }
  return violations;
}

function checkPackageManifest(root, pkg, rules, violations) {
  const manifestPath = resolve(root, "packages", pkg, "package.json");
  if (!existsSync(manifestPath)) {
    violations.push(`packages/${pkg}/package.json: missing manifest`);
    return;
  }
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch (error) {
    violations.push(
      `packages/${pkg}/package.json: unreadable manifest (${error.message})`,
    );
    return;
  }
  violations.push(
    ...checkManifestDependencies(manifest, pkg, rules, {
      packageDir: resolve(root, "packages", pkg),
    }),
  );
}

function checkPackage(root, pkg, rules, violations) {
  for (const dir of rules.dirs ?? ["src"]) {
    checkPackageDir(root, pkg, dir, rules, violations);
  }
}

function checkPackageDir(root, pkg, dir, rules, violations) {
  const srcDir = resolve(root, "packages", pkg, dir);
  if (!existsSync(srcDir)) return;
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
    checkPackageManifest(root, pkg, rules, violations);
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
