import { copyFile, mkdir, readFile, readdir, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourceRoot = resolve(root, "public/model/package");
const targetRoot = resolve(root, "../../website/src/components/MorphWorkbench/assets");
const files = [
  ...(await readdir(resolve(sourceRoot, "assets")))
    .filter((name) => name.endsWith(".png"))
    .sort()
    .map((name) => `assets/${name}`),
  "model.json",
];

await rm(resolve(targetRoot, "assets"), { recursive: true, force: true });
await mkdir(targetRoot, { recursive: true });
for (const path of files) {
  await mkdir(dirname(resolve(targetRoot, path)), { recursive: true });
  await copyFile(resolve(sourceRoot, path), resolve(targetRoot, path));
}

const modelBytes = await readFile(resolve(targetRoot, "model.json"));
console.log(JSON.stringify({
  target: "website/src/components/MorphWorkbench/assets",
  bytes: modelBytes.byteLength,
  sha256: createHash("sha256").update(modelBytes).digest("hex"),
}));
