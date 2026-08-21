import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";

import {
  MANIFEST_DEPENDENCY_FIELDS,
  PACKAGE_RULES,
  checkManifestDependencies,
  extractSpecifiers,
  resolveDependencyTarget,
  runChecks,
} from "./check-boundaries.mjs";

function makeRepo(files) {
  const root = mkdtempSync(join(tmpdir(), "boundary-check-"));
  for (const [rel, content] of Object.entries(files)) {
    const abs = resolve(root, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(
      abs,
      typeof content === "string" ? content : `${JSON.stringify(content, null, 2)}\n`,
    );
  }
  return root;
}

/** Every configured package needs a manifest, so fixtures must supply one. */
function withManifests(files, extra = {}) {
  const out = { ...files };
  for (const pkg of Object.keys(PACKAGE_RULES)) {
    const path = `packages/${pkg}/package.json`;
    if (!(path in out)) out[path] = extra[pkg] ?? { name: pkg };
  }
  return out;
}

const cleanup = (root) => rmSync(root, { recursive: true, force: true });

test("extracts static import specifiers", () => {
  const source = `
import { a } from "@layoutit/polycss-core";
import type { B } from "./local";
import * as ns from "../up";
import "side-effect";
export { c } from "@layoutit/polycss-core/three";
export * from "./barrel";
`;
  assert.deepEqual(extractSpecifiers(source), [
    "@layoutit/polycss-core",
    "./local",
    "../up",
    "side-effect",
    "@layoutit/polycss-core/three",
    "./barrel",
  ]);
});

test("extracts dynamic import and require specifiers", () => {
  const source = `
const mod = await import("node:fs");
const legacy = require("earcut");
`;
  assert.deepEqual(extractSpecifiers(source), ["node:fs", "earcut"]);
});

test("does not treat property access named import as a specifier", () => {
  const source = `const x = foo.import("not-an-import");`;
  assert.deepEqual(extractSpecifiers(source), []);
});

test("manifest check rejects a forbidden dependency in every shipped field", () => {
  for (const field of MANIFEST_DEPENDENCY_FIELDS) {
    const violations = checkManifestDependencies(
      { name: "react", [field]: { "@layoutit/polycss": "workspace:^" } },
      "react",
      PACKAGE_RULES.react,
    );
    assert.equal(violations.length, 1, field);
    assert.match(violations[0], new RegExp(`disallowed ${field} entry`));
    assert.match(violations[0], /@layoutit\/polycss"/);
  }
});

test("manifest check accepts allowed dependencies and ignores devDependencies", () => {
  const violations = checkManifestDependencies(
    {
      name: "react",
      dependencies: { "@layoutit/polycss-core": "workspace:^" },
      peerDependencies: { react: "^19", "react-dom": "^19" },
      devDependencies: { vitest: "^3", "happy-dom": "^15" },
    },
    "react",
    PACKAGE_RULES.react,
  );
  assert.deepEqual(violations, []);
});

test("a react package depending on @layoutit/polycss fails end to end", () => {
  const root = makeRepo(
    withManifests(
      { "packages/react/src/index.ts": "export const a = 1;\n" },
      {
        react: {
          name: "@layoutit/polycss-react",
          dependencies: {
            "@layoutit/polycss-core": "workspace:^",
            "@layoutit/polycss": "workspace:^",
          },
        },
      },
    ),
  );
  const violations = runChecks(root);
  assert.equal(violations.length, 1);
  assert.match(
    violations[0],
    /packages\/react\/package\.json: disallowed dependencies entry "@layoutit\/polycss"/,
  );
  cleanup(root);
});

test("a clean set of manifests and sources passes", () => {
  const root = makeRepo(
    withManifests(
      {
        "packages/react/src/index.ts":
          'import { Vec3 } from "@layoutit/polycss-core";\nexport { Vec3 };\n',
      },
      {
        react: {
          name: "@layoutit/polycss-react",
          dependencies: { "@layoutit/polycss-core": "workspace:^" },
          peerDependencies: { react: "^19", "react-dom": "^19" },
        },
      },
    ),
  );
  assert.deepEqual(runChecks(root), []);
  cleanup(root);
});

test("a missing manifest is a violation", () => {
  const files = withManifests({});
  delete files["packages/core/package.json"];
  const root = makeRepo(files);
  const violations = runChecks(root);
  assert.deepEqual(violations, ["packages/core/package.json: missing manifest"]);
  cleanup(root);
});

test("an .mjs import violation is caught", () => {
  const root = makeRepo(
    withManifests({
      "packages/skills/src/install.mjs":
        'import { cp } from "node:fs/promises";\nimport { PolyScene } from "@layoutit/polycss";\ncp; PolyScene;\n',
    }),
  );
  const violations = runChecks(root);
  assert.equal(violations.length, 1);
  assert.match(
    violations[0],
    /packages\/skills\/src\/install\.mjs: disallowed dependency "@layoutit\/polycss"/,
  );
  cleanup(root);
});

test("the skills CLI may use node builtins in src and bin", () => {
  const root = makeRepo(
    withManifests({
      "packages/skills/src/install.mjs":
        'import { cp } from "node:fs/promises";\nexport { cp };\n',
      "packages/skills/bin/polycss-skills.mjs":
        'import { install } from "../src/install.mjs";\nimport { argv } from "node:process";\ninstall(argv);\n',
    }),
  );
  assert.deepEqual(runChecks(root), []);
  cleanup(root);
});

test("a .js deep import outside packages/ is caught", () => {
  const root = makeRepo(
    withManifests({
      "bench/thing.mjs":
        'import { plan } from "@layoutit/polycss-core/src/atlas/plan";\nplan();\n',
    }),
  );
  const violations = runChecks(root);
  assert.equal(violations.length, 1);
  assert.match(violations[0], /bench\/thing\.mjs: deep import into a package's src/);
  cleanup(root);
});

test("generated and built output is not scanned", () => {
  const bad = 'import { x } from "@layoutit/polycss";\nx;\n';
  const root = makeRepo(
    withManifests({
      "packages/react/dist/index.js": bad,
      "packages/react/src/.generated/thing.mjs": bad,
      "bench/.generated/entry.mjs": bad,
    }),
  );
  assert.deepEqual(runChecks(root), []);
  cleanup(root);
});

test("node builtins stay forbidden in the renderer packages", () => {
  const root = makeRepo(
    withManifests({
      "packages/vue/src/index.ts": 'import { readFileSync } from "node:fs";\nreadFileSync;\n',
    }),
  );
  const violations = runChecks(root);
  assert.equal(violations.length, 1);
  assert.match(violations[0], /node builtin not allowed here: "node:fs"/);
  cleanup(root);
});

test("the real repo manifests satisfy the dependency table", () => {
  const repoRoot = resolve(import.meta.dirname, "..", "..");
  assert.deepEqual(runChecks(repoRoot), []);
});

test("dependency targets resolve through alias and protocol forms", () => {
  const target = (spec, options) =>
    resolveDependencyTarget("@layoutit/polycss-core", spec, options);

  assert.equal(target("workspace:^").name, "@layoutit/polycss-core");
  assert.equal(target("workspace:*").name, "@layoutit/polycss-core");
  assert.equal(target("^0.2.0").name, "@layoutit/polycss-core");
  assert.equal(target("npm:@layoutit/polycss@0.2.0").name, "@layoutit/polycss");
  assert.equal(target("npm:evil").name, "evil");
  assert.equal(target("workspace:@layoutit/polycss@*").name, "@layoutit/polycss");
  assert.equal(target("workspace:other@*").name, "other");
  assert.match(target("link:../nope").unresolved, /could not be read/);
});

test("an npm alias to a forbidden package is caught", () => {
  const root = makeRepo(
    withManifests(
      {},
      {
        react: {
          name: "@layoutit/polycss-react",
          // Allowed KEY, forbidden install target.
          dependencies: { "@layoutit/polycss-core": "npm:@layoutit/polycss@0.2.0" },
        },
      },
    ),
  );
  const violations = runChecks(root);
  assert.equal(violations.length, 1);
  assert.match(
    violations[0],
    /resolves to disallowed package "@layoutit\/polycss" via npm alias/,
  );
  cleanup(root);
});

test("a link:/file: dependency is validated against the package it points at", () => {
  for (const protocol of ["link", "file"]) {
    const root = makeRepo(
      withManifests(
        {},
        {
          react: {
            name: "@layoutit/polycss-react",
            dependencies: { "@layoutit/polycss-core": `${protocol}:../polycss` },
          },
          polycss: { name: "@layoutit/polycss" },
        },
      ),
    );
    const violations = runChecks(root);
    assert.equal(violations.length, 1, protocol);
    assert.match(
      violations[0],
      new RegExp(
        `resolves to disallowed package "@layoutit/polycss" via ${protocol}: target`,
      ),
    );
    cleanup(root);
  }
});

test("a local dependency whose target cannot be read is not assumed allowed", () => {
  const root = makeRepo(
    withManifests(
      {},
      {
        react: {
          name: "@layoutit/polycss-react",
          dependencies: { "@layoutit/polycss-core": "link:../nowhere" },
        },
      },
    ),
  );
  const violations = runChecks(root);
  assert.equal(violations.length, 1);
  assert.match(violations[0], /could not be read, so the allow-list cannot be applied/);
  cleanup(root);
});

test("workspace ranges and aliases onto allowed packages still pass", () => {
  const root = makeRepo(
    withManifests(
      {},
      {
        react: {
          name: "@layoutit/polycss-react",
          dependencies: { "@layoutit/polycss-core": "workspace:^" },
          peerDependencies: { react: "^19", "react-dom": "^19" },
        },
        vue: {
          name: "@layoutit/polycss-vue",
          // An alias is fine as long as it lands inside the allow-list.
          dependencies: { "@layoutit/polycss-core": "npm:@layoutit/polycss-core@0.2.0" },
        },
        fonts: {
          name: "@layoutit/polycss-fonts",
          dependencies: { "@layoutit/polycss-core": "workspace:*", earcut: "^3" },
        },
      },
    ),
  );
  assert.deepEqual(runChecks(root), []);
  cleanup(root);
});

test("a workspace: relative path resolves to the package it points at", () => {
  const root = makeRepo(
    withManifests(
      {},
      {
        react: {
          name: "@layoutit/polycss-react",
          // Allowed KEY, forbidden install target, and no `@range` anywhere
          // for the alias parser to notice.
          dependencies: { "@layoutit/polycss-core": "workspace:../polycss" },
        },
        polycss: { name: "@layoutit/polycss" },
      },
    ),
  );
  const violations = runChecks(root);
  assert.equal(violations.length, 1);
  assert.match(
    violations[0],
    /resolves to disallowed package "@layoutit\/polycss" via workspace path target/,
  );
  cleanup(root);
});

test("an un-versioned workspace alias is resolved, not treated as a range", () => {
  for (const spec of ["workspace:@layoutit/polycss", "workspace:@layoutit/polycss@*"]) {
    const root = makeRepo(
      withManifests(
        {},
        {
          vue: {
            name: "@layoutit/polycss-vue",
            dependencies: { "@layoutit/polycss-core": spec },
          },
        },
      ),
    );
    const violations = runChecks(root);
    assert.equal(violations.length, 1, spec);
    assert.match(
      violations[0],
      /resolves to disallowed package "@layoutit\/polycss" via workspace alias/,
      spec,
    );
    cleanup(root);
  }
});

test("a workspace path that cannot be read is not assumed allowed", () => {
  const root = makeRepo(
    withManifests(
      {},
      {
        react: {
          name: "@layoutit/polycss-react",
          dependencies: { "@layoutit/polycss-core": "workspace:../nowhere" },
        },
      },
    ),
  );
  const violations = runChecks(root);
  assert.equal(violations.length, 1);
  assert.match(violations[0], /whose package.json name could not be read/);
  cleanup(root);
});

test("specifier forms with an undeterminable target fail instead of passing", () => {
  const unresolvable = [
    ["catalog:", /pnpm catalog reference/],
    ["catalog:default", /pnpm catalog reference/],
    ["jsr:@layoutit/polycss", /JSR specifier/],
    ["github:layoutit/polycss", /git specifier/],
    ["git+https://github.com/layoutit/polycss.git", /git specifier/],
    ["git+ssh://git@github.com/layoutit/polycss.git", /git specifier/],
    ["https://example.com/polycss-0.1.0.tgz", /remote tarball/],
    ["layoutit/polycss", /git shorthand/],
    ["layoutit/polycss#v1", /git shorthand/],
    ["mystery:whatever", /unrecognised specifier protocol/],
    ["workspace:", /empty "workspace:" specifier/],
    ["", /empty version specifier/],
    [42, /non-string version specifier/],
  ];
  for (const [spec, pattern] of unresolvable) {
    const resolved = resolveDependencyTarget("@layoutit/polycss-core", spec, {});
    assert.equal(resolved.name, undefined, `${spec} must not resolve to a name`);
    assert.match(resolved.unresolved, pattern, String(spec));

    // And the resolver's verdict must reach the manifest check as a violation,
    // even though the KEY itself is allow-listed.
    const violations = checkManifestDependencies(
      { dependencies: { "@layoutit/polycss-core": spec } },
      "react",
      PACKAGE_RULES.react,
      {},
    );
    assert.equal(violations.length, 1, String(spec));
    assert.match(violations[0], /so the allow-list cannot be applied/, String(spec));
  }
});

test("plain ranges, dist-tags and workspace ranges keep the declared key", () => {
  const keep = [
    "^0.2.0",
    "0.2.0",
    "*",
    ">=1.0.0 <2.0.0",
    "1.x",
    "latest",
    "next",
    "workspace:^",
    "workspace:*",
    "workspace:~",
    "workspace:1.2.3",
    "workspace:^1.2.3",
    "workspace:>=1.0.0 <2.0.0",
  ];
  for (const spec of keep) {
    const resolved = resolveDependencyTarget("@layoutit/polycss-core", spec, {});
    assert.equal(resolved.name, "@layoutit/polycss-core", spec);
    assert.equal(resolved.unresolved, undefined, spec);
  }
});
