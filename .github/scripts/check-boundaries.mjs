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

/**
 * Keywords after which a `/` starts a regex literal rather than a division.
 * Everything else that can END an expression (identifier, number, string,
 * `)`, `]`, `}`, `++`, `--`) means division.
 */
const REGEX_PRECEDING_KEYWORDS = new Set([
  "await",
  "case",
  "delete",
  "do",
  "else",
  "in",
  "instanceof",
  "new",
  "of",
  "return",
  "throw",
  "typeof",
  "void",
  "yield",
]);

const NO_REGEX_AFTER_PUNCT = new Set([")", "]", "}", "++", "--", "/regex/"]);

const isIdentStart = (ch) => /[A-Za-z_$]/.test(ch);
const isIdentPart = (ch) => /[A-Za-z0-9_$]/.test(ch);
const isDigit = (ch) => ch >= "0" && ch <= "9";

function regexAllowedAfter(prev) {
  if (!prev) return true;
  if (prev.type === "name") return REGEX_PRECEDING_KEYWORDS.has(prev.value);
  if (prev.type === "punct") return !NO_REGEX_AFTER_PUNCT.has(prev.value);
  return false;
}

/**
 * A single-pass lexer over JS/TS/TSX source.
 *
 * It exists because pattern-matching raw source for imports is wrong in both
 * directions: a regex misses valid forms (`from /* c *\/ "x"`, an interpolation-
 * free template specifier, an `import` split across lines) and matches text that
 * is not code (a commented-out import, an import-shaped string). Tokenising once
 * removes both classes of error.
 *
 * Tokens are only what the specifier scanner needs: `name`, `punct`, `string`
 * (with `static` marking a literal value — a template WITH `${}` is a token but
 * not a static specifier), and `number`. Comments produce no tokens at all.
 *
 * Two deliberate recovery rules keep a mis-lex from swallowing real code: a
 * quoted string and a regex literal may never span a newline (JS forbids it),
 * so on hitting one we rewind to just after the opening delimiter and continue
 * in code mode. That matters for TSX, where JSX text (`It's`) and closing tags
 * (`</div>`) otherwise look like an open quote and an open regex.
 */
function tokenize(source) {
  const tokens = [];
  const templates = [];
  const push = (type, value, extra) =>
    tokens.push({ type, value, ...(extra ?? {}) });
  const last = () => tokens[tokens.length - 1];
  let i = 0;

  const readTemplateChunk = (start) => {
    const context = templates[templates.length - 1];
    let j = start;
    while (j < source.length) {
      const ch = source[j];
      if (ch === "\\") {
        context.raw += source[j + 1] ?? "";
        j += 2;
        continue;
      }
      if (ch === "`") {
        templates.pop();
        push("string", context.raw, { static: !context.hasSubstitution });
        return j + 1;
      }
      if (ch === "$" && source[j + 1] === "{") {
        context.hasSubstitution = true;
        context.braceDepth = 0;
        return j + 2;
      }
      context.raw += ch;
      j += 1;
    }
    // Unterminated template: nothing left to lex.
    templates.pop();
    return source.length;
  };

  while (i < source.length) {
    const ch = source[i];

    if (ch === "/" && source[i + 1] === "/") {
      const nl = source.indexOf("\n", i);
      i = nl === -1 ? source.length : nl;
      continue;
    }
    if (ch === "/" && source[i + 1] === "*") {
      const end = source.indexOf("*/", i + 2);
      i = end === -1 ? source.length : end + 2;
      continue;
    }
    if (ch === '"' || ch === "'") {
      let j = i + 1;
      let value = "";
      let closed = false;
      while (j < source.length) {
        const c = source[j];
        if (c === "\\") {
          value += source[j + 1] ?? "";
          j += 2;
          continue;
        }
        if (c === "\n") break;
        if (c === ch) {
          closed = true;
          break;
        }
        value += c;
        j += 1;
      }
      if (closed) {
        push("string", value, { static: true });
        i = j + 1;
      } else {
        i += 1;
      }
      continue;
    }
    if (ch === "`") {
      templates.push({ raw: "", hasSubstitution: false, braceDepth: 0 });
      i = readTemplateChunk(i + 1);
      continue;
    }
    if (ch === "/" && regexAllowedAfter(last())) {
      let j = i + 1;
      let inClass = false;
      let closed = false;
      while (j < source.length) {
        const c = source[j];
        if (c === "\\") {
          j += 2;
          continue;
        }
        if (c === "\n") break;
        if (c === "[") inClass = true;
        else if (c === "]") inClass = false;
        else if (c === "/" && !inClass) {
          closed = true;
          break;
        }
        j += 1;
      }
      if (closed) {
        while (j + 1 < source.length && isIdentPart(source[j + 1])) j += 1;
        push("punct", "/regex/");
        i = j + 1;
      } else {
        push("punct", "/");
        i += 1;
      }
      continue;
    }
    if (isIdentStart(ch)) {
      let j = i + 1;
      while (j < source.length && isIdentPart(source[j])) j += 1;
      push("name", source.slice(i, j));
      i = j;
      continue;
    }
    if (isDigit(ch)) {
      let j = i + 1;
      while (j < source.length && /[0-9a-zA-Z_.]/.test(source[j])) j += 1;
      push("number", source.slice(i, j));
      i = j;
      continue;
    }
    if (ch === "{" && templates.length > 0) {
      templates[templates.length - 1].braceDepth += 1;
    } else if (ch === "}" && templates.length > 0) {
      const context = templates[templates.length - 1];
      if (context.braceDepth === 0) {
        i = readTemplateChunk(i + 1);
        continue;
      }
      context.braceDepth -= 1;
    }
    if (/\s/.test(ch)) {
      i += 1;
      continue;
    }
    if ((ch === "+" || ch === "-") && source[i + 1] === ch) {
      push("punct", ch + ch);
      i += 2;
      continue;
    }
    push("punct", ch);
    i += 1;
  }
  return tokens;
}

const isStaticString = (token) =>
  token !== undefined && token.type === "string" && token.static === true;

const isKeywordAt = (tokens, index, value) => {
  const token = tokens[index];
  if (!token || token.type !== "name" || token.value !== value) return false;
  const prev = tokens[index - 1];
  return !(prev && prev.type === "punct" && prev.value === ".");
};

/**
 * Every module specifier a file references: static `import`/`export … from`,
 * bare side-effect `import "x"`, dynamic `import("x")` and `require("x")`.
 *
 * Non-static specifiers (a template with `${}`, a variable) are ignored rather
 * than being an error — they carry no name this checker could rule on.
 */
export function extractSpecifiers(source) {
  const tokens = tokenize(source);
  const specifiers = [];
  for (let i = 0; i < tokens.length; i += 1) {
    const isImport = isKeywordAt(tokens, i, "import");
    const isExport = isKeywordAt(tokens, i, "export");
    if (!isImport && !isExport && !isKeywordAt(tokens, i, "require")) continue;

    const next = tokens[i + 1];
    if (!isExport && next?.type === "punct" && next.value === "(") {
      // `import("x")` / `require("x")`; extra args (import attributes) are fine.
      if (isStaticString(tokens[i + 2])) specifiers.push(tokens[i + 2].value);
      continue;
    }
    if (!isImport && !isExport) continue;
    if (isImport && isStaticString(next)) {
      specifiers.push(next.value);
      continue;
    }
    // `import`/`export` … `from` "x", possibly spanning lines. `from` is a
    // legal binding name (`import { from } from "x"`), so only a `from`
    // followed by a static string ends the scan.
    for (let j = i + 1; j < tokens.length; j += 1) {
      const token = tokens[j];
      if (token.type === "punct" && token.value === ";") break;
      if (isKeywordAt(tokens, j, "import") || isKeywordAt(tokens, j, "export")) {
        break;
      }
      if (isKeywordAt(tokens, j, "from") && isStaticString(tokens[j + 1])) {
        specifiers.push(tokens[j + 1].value);
        break;
      }
    }
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
