import { lstat, mkdir, open, realpath, rmdir, unlink } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { errorCode, invariant } from "./errors.js";
import { ensureRealDirectory } from "./path-security.js";
import type { DomBuildResult } from "./public-types.js";

interface OutputEntry {
  readonly target: string;
  readonly bytes: Uint8Array;
}

function inside(base: string, target: string): boolean {
  return target === base || target.startsWith(`${base}${sep}`);
}

function assertSeparatedOutputs(entries: readonly OutputEntry[]): void {
  const targets = entries.map(({ target }) => resolve(target).toLowerCase());
  for (let left = 0; left < targets.length; left += 1) {
    for (let right = left + 1; right < targets.length; right += 1) {
      invariant(
        targets[left] !== targets[right]
        && !targets[left].startsWith(`${targets[right]}${sep}`)
        && !targets[right].startsWith(`${targets[left]}${sep}`),
        "OUTPUT_COLLISION",
        "The JSON document and resource output paths are not physically distinct on supported filesystems.",
      );
    }
  }
}

async function outputMustBeAbsent(path: string): Promise<void> {
  try {
    await lstat(path);
  } catch (error) {
    if (errorCode(error) === "ENOENT") return;
    throw error;
  }
  invariant(false, "OUTPUT_EXISTS", `Refusing to overwrite ${path}.`);
}

async function createOutputParents(base: string, entries: readonly OutputEntry[], createdDirectories: string[]): Promise<void> {
  const realBase = await ensureRealDirectory(base, "UNSAFE_OUTPUT_PATH", "Selected package directory", createdDirectories);
  const parents: string[] = [...new Set<string>(entries.map(({ target }) => dirname(target)))].sort();
  for (const parent of parents) {
    const relativeParent = relative(base, parent);
    invariant(relativeParent === "" || (!relativeParent.startsWith(`..${sep}`) && relativeParent !== ".."), "UNSAFE_OUTPUT_PATH", `Output ${parent} escapes the selected package directory.`);
    let current = base;
    for (const segment of relativeParent === "" ? [] : relativeParent.split(sep)) {
      current = join(current, segment);
      try {
        const metadata = await lstat(current);
        invariant(metadata.isDirectory() && !metadata.isSymbolicLink(), "UNSAFE_OUTPUT_PATH", `Output directory ${current} must be a real directory, not a symbolic link.`);
      } catch (error) {
        if (errorCode(error) !== "ENOENT") throw error;
        await mkdir(current);
        createdDirectories.push(current);
      }
    }
    const resolvedParent = await realpath(parent);
    invariant(inside(realBase, resolvedParent), "UNSAFE_OUTPUT_PATH", `Output directory ${parent} resolves outside the selected package directory.`);
  }
}

async function writeNew(path: string, bytes: Uint8Array, created: string[]): Promise<void> {
  const handle = await open(path, "wx");
  created.push(path);
  try {
    await handle.writeFile(bytes);
  } finally {
    await handle.close();
  }
}

export async function writeDomFiles(output: string, built: DomBuildResult): Promise<void> {
  const documentTarget = resolve(output);
  const base = dirname(documentTarget);
  const entries = [...built.externalResources].map(([path, bytes]) => ({
    target: join(base, ...path.split("/")),
    bytes,
  }));
  entries.push({ target: documentTarget, bytes: built.bytes });
  assertSeparatedOutputs(entries);
  for (const { target } of entries) await outputMustBeAbsent(target);

  const created: string[] = [];
  const createdDirectories: string[] = [];
  try {
    await createOutputParents(base, entries, createdDirectories);
    for (const { target } of entries) await outputMustBeAbsent(target);
    // Publish the JSON document last so its complete resource set already exists.
    for (const { target, bytes } of entries) await writeNew(target, bytes, created);
  } catch (error) {
    for (const target of created.reverse()) {
      try { await unlink(target); } catch {}
    }
    for (const directory of createdDirectories.reverse()) {
      try { await rmdir(directory); } catch {}
    }
    throw error;
  }
}
