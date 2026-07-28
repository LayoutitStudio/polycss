import {
  existsSync,
} from "node:fs";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  parse,
  relative,
  resolve,
  sep,
} from "node:path";
import { readPolyMorphPrepareConfig, resolvePolyMorphSourcePath } from "./config.js";
import { buildPolyMorphPreparedPackage } from "./compile.js";
import { failPolyMorphPrepare } from "./error.js";
import { loadPolyMorphGltf } from "./gltf.js";
import type {
  PolyMorphPrepareOptions,
  PolyMorphPrepareReport,
} from "./types.js";

function safeOutputRoot(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) {
    failPolyMorphPrepare("invalid-argument", "$.outputRoot", "expected a path");
  }
  const target = resolve(value);
  if (target === parse(target).root) {
    failPolyMorphPrepare("unsafe-path", "$.outputRoot", "filesystem root is forbidden");
  }
  return target;
}

async function inventory(root: string, current = ""): Promise<string[]> {
  const directory = join(root, current);
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries.sort((left, right) =>
    left.name < right.name ? -1 : left.name > right.name ? 1 : 0)) {
    const path = current === "" ? entry.name : `${current}/${entry.name}`;
    if (entry.isSymbolicLink()) {
      failPolyMorphPrepare("unsafe-output", path, "symbolic links are forbidden");
    }
    if (entry.isDirectory()) {
      files.push(...await inventory(root, path));
    } else if (entry.isFile()) {
      files.push(path);
    } else {
      failPolyMorphPrepare("unsafe-output", path, "unsupported filesystem entry");
    }
  }
  return files;
}

async function packageDrift(
  target: string,
  expected: ReadonlyMap<string, Uint8Array>,
): Promise<{ readonly path: string; readonly message: string } | null> {
  if (!existsSync(target)) {
    return { path: "$.outputRoot", message: "prepared package is missing" };
  }
  const actualPaths = await inventory(target);
  const expectedPaths = [...expected.keys()].sort();
  if (
    actualPaths.length !== expectedPaths.length
    || actualPaths.some((path, index) => path !== expectedPaths[index])
  ) {
    return {
      path: "$.outputRoot",
      message: `inventory differs: expected ${expectedPaths.join(", ")}`,
    };
  }
  for (const path of expectedPaths) {
    const actual = new Uint8Array(await readFile(join(target, path)));
    const wanted = expected.get(path)!;
    if (
      actual.byteLength !== wanted.byteLength
      || actual.some((value, index) => value !== wanted[index])
    ) {
      return { path, message: "prepared bytes differ" };
    }
  }
  return null;
}

async function assertExactPackage(
  target: string,
  expected: ReadonlyMap<string, Uint8Array>,
): Promise<void> {
  const drift = await packageDrift(target, expected);
  if (drift) failPolyMorphPrepare("drift", drift.path, drift.message);
}

async function writePackage(
  target: string,
  files: ReadonlyMap<string, Uint8Array>,
): Promise<readonly string[]> {
  const parent = dirname(target);
  await mkdir(parent, { recursive: true });
  const staging = await mkdtemp(join(parent, `.polycss-morph-${basename(target)}-`));
  const backup = `${target}.previous-${process.pid}`;
  const nonManifestPaths = [...files.keys()]
    .filter((path) => path !== "manifest.json")
    .sort();
  const writeOrder = [...nonManifestPaths, "manifest.json"];
  let movedPrevious = false;
  try {
    for (const path of writeOrder) {
      const absolute = resolve(staging, path);
      const rel = relative(staging, absolute);
      if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
        failPolyMorphPrepare("unsafe-path", path, "package path escapes staging");
      }
      await mkdir(dirname(absolute), { recursive: true });
      await writeFile(absolute, files.get(path)!);
    }
    if (existsSync(backup)) {
      failPolyMorphPrepare(
        "unsafe-output",
        "$.outputRoot",
        `backup already exists at ${backup}`,
      );
    }
    if (existsSync(target)) {
      await rename(target, backup);
      movedPrevious = true;
    }
    await rename(staging, target);
    if (movedPrevious) {
      await rm(backup, { recursive: true, force: true }).catch(() => {});
    }
    return writeOrder;
  } catch (error) {
    if (movedPrevious && !existsSync(target) && existsSync(backup)) {
      await rename(backup, target);
    }
    throw error;
  } finally {
    if (existsSync(staging)) {
      await rm(staging, { recursive: true, force: true });
    }
  }
}

export async function preparePolyMorphModel(
  options: PolyMorphPrepareOptions,
): Promise<PolyMorphPrepareReport> {
  if (!options || typeof options !== "object") {
    failPolyMorphPrepare("invalid-argument", "$", "expected prepare options");
  }
  if (typeof options.configPath !== "string" || options.configPath.length === 0) {
    failPolyMorphPrepare("invalid-argument", "$.configPath", "expected a path");
  }
  if (options.check !== undefined && typeof options.check !== "boolean") {
    failPolyMorphPrepare("invalid-argument", "$.check", "expected a boolean");
  }
  const configPath = resolve(options.configPath);
  const outputRoot = safeOutputRoot(options.outputRoot);
  const config = await readPolyMorphPrepareConfig(configPath);
  const sourcePath = resolvePolyMorphSourcePath(configPath, config.source.path);
  const source = await loadPolyMorphGltf(sourcePath);
  const built = await buildPolyMorphPreparedPackage(source, config);
  const files = new Map(built.package.files);
  files.set("manifest.json", built.package.manifestBytes);
  const expectedPaths = [...files.keys()].sort();
  if (options.check) {
    await assertExactPackage(outputRoot, files);
    return {
      config,
      source,
      model: built.prepared.model,
      manifest: built.package.manifest,
      manifestSha256: built.package.manifestSha256,
      outputRoot,
      files: expectedPaths,
      writeOrder: [],
      checked: true,
      changed: false,
    };
  }
  if (await packageDrift(outputRoot, files) === null) {
    return {
      config,
      source,
      model: built.prepared.model,
      manifest: built.package.manifest,
      manifestSha256: built.package.manifestSha256,
      outputRoot,
      files: expectedPaths,
      writeOrder: [],
      checked: false,
      changed: false,
    };
  }
  const writeOrder = await writePackage(outputRoot, files);
  return {
    config,
    source,
    model: built.prepared.model,
    manifest: built.package.manifest,
    manifestSha256: built.package.manifestSha256,
    outputRoot,
    files: expectedPaths,
    writeOrder,
    checked: false,
    changed: true,
  };
}
