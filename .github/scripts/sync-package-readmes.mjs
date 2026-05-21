import { copyFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const source = resolve(repoRoot, "README.md");
const targets = [
  "packages/core/README.md",
  "packages/polycss/README.md",
  "packages/react/README.md",
  "packages/vue/README.md",
];

for (const target of targets) {
  copyFileSync(source, resolve(repoRoot, target));
}

console.log(`[sync-package-readmes] copied README.md to ${targets.length} package READMEs`);
