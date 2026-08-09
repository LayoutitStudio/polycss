import { lstat, mkdir, realpath } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { errorCode, errorName, invariant } from "./errors.js";

export async function assertRealDirectory(path: string, code: string, label: string): Promise<string> {
  const absolute = resolve(path);
  const metadata = await lstat(absolute);
  invariant(metadata.isDirectory() && !metadata.isSymbolicLink(), code, `${label} must be a real directory, not a symbolic link.`);
  return realpath(absolute);
}

export async function assertRealDescendantComponents(base: string, relativePath: string, code: string, label: string): Promise<void> {
  const segments = relativePath.split("/");
  let current = base;
  for (let index = 0; index < segments.length; index += 1) {
    current = join(current, segments[index]);
    const metadata = await lstat(current);
    invariant(!metadata.isSymbolicLink(), code, `${label} contains a symbolic-link path component.`);
    if (index < segments.length - 1) invariant(metadata.isDirectory(), code, `${label} contains a non-directory path component.`);
  }
}

export async function ensureRealDirectory(path: string, code: string, label: string, createdDirectories: string[] = []): Promise<string> {
  const missing: string[] = [];
  let current = resolve(path);
  while (true) {
    try {
      const metadata = await lstat(current);
      invariant(metadata.isDirectory() && !metadata.isSymbolicLink(), code, `${label} must be a real directory, not a symbolic link.`);
      break;
    } catch (error) {
      if (errorName(error) === "DomFormatError") throw error;
      if (errorCode(error) !== "ENOENT") throw error;
      missing.push(current);
      const parent = dirname(current);
      invariant(parent !== current, code, `${label} has no safe existing parent directory.`);
      current = parent;
    }
  }
  for (const directory of missing.reverse()) {
    await mkdir(directory);
    createdDirectories.push(directory);
    const metadata = await lstat(directory);
    invariant(metadata.isDirectory() && !metadata.isSymbolicLink(), code, `${label} creation did not produce a real directory.`);
  }
  return realpath(resolve(path));
}
