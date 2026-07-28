import { readFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { isPolyMorphId, type PolyMorphBudgets } from "../contracts/index.js";
import { failPolyMorphPrepare } from "./error.js";
import {
  POLY_MORPH_PREPARE_SCHEMA,
  type PolyMorphPrepareConfig,
} from "./types.js";

function record(
  value: unknown,
  path: string,
  keys: readonly string[],
): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    failPolyMorphPrepare("invalid-config", path, "expected an object");
  }
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (
    actual.length !== expected.length
    || actual.some((key, index) => key !== expected[index])
  ) {
    failPolyMorphPrepare(
      "invalid-config",
      path,
      `expected exactly ${expected.join(", ")}`,
    );
  }
  return value as Record<string, unknown>;
}

function array(value: unknown, path: string): readonly unknown[] {
  if (!Array.isArray(value)) {
    failPolyMorphPrepare("invalid-config", path, "expected an array");
  }
  return value;
}

function text(value: unknown, path: string): string {
  if (typeof value !== "string" || value.length === 0 || value !== value.trim()) {
    failPolyMorphPrepare("invalid-config", path, "expected non-empty trimmed text");
  }
  return value;
}

function id(value: unknown, path: string): string {
  const result = text(value, path);
  if (!isPolyMorphId(result)) {
    failPolyMorphPrepare("invalid-config", path, "expected a normalized kebab-case id");
  }
  return result;
}

function finite(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    failPolyMorphPrepare("invalid-config", path, "expected a finite number");
  }
  return value;
}

function positiveInteger(value: unknown, path: string): number {
  const result = finite(value, path);
  if (!Number.isSafeInteger(result) || result < 1) {
    failPolyMorphPrepare("invalid-config", path, "expected a positive integer");
  }
  return result;
}

function parseBudgets(value: unknown): PolyMorphBudgets {
  const input = record(value, "$.budgets", [
    "maxBytes",
    "maxFrames",
    "maxJoints",
    "maxLeaves",
    "maxPolygons",
    "maxResources",
    "maxVertices",
  ]);
  return {
    maxVertices: positiveInteger(input.maxVertices, "$.budgets.maxVertices"),
    maxPolygons: positiveInteger(input.maxPolygons, "$.budgets.maxPolygons"),
    maxLeaves: positiveInteger(input.maxLeaves, "$.budgets.maxLeaves"),
    maxFrames: positiveInteger(input.maxFrames, "$.budgets.maxFrames"),
    maxJoints: positiveInteger(input.maxJoints, "$.budgets.maxJoints"),
    maxResources: positiveInteger(input.maxResources, "$.budgets.maxResources"),
    maxBytes: positiveInteger(input.maxBytes, "$.budgets.maxBytes"),
  };
}

export function parsePolyMorphPrepareConfig(value: unknown): PolyMorphPrepareConfig {
  const input = record(value, "$", [
    "animations",
    "budgets",
    "controls",
    "identity",
    "morphAliases",
    "profile",
    "schema",
    "source",
    "springs",
    "transform",
  ]);
  if (input.schema !== POLY_MORPH_PREPARE_SCHEMA) {
    failPolyMorphPrepare(
      "invalid-config",
      "$.schema",
      `expected ${POLY_MORPH_PREPARE_SCHEMA}`,
    );
  }
  const identityInput = record(input.identity, "$.identity", ["id", "name", "revision"]);
  const identity = {
    id: id(identityInput.id, "$.identity.id"),
    name: text(identityInput.name, "$.identity.name"),
    revision: text(identityInput.revision, "$.identity.revision"),
  };
  if (!/^\d+\.\d+\.\d+$/u.test(identity.revision)) {
    failPolyMorphPrepare("invalid-config", "$.identity.revision", "expected x.y.z");
  }
  const profile = text(input.profile, "$.profile");
  if (profile !== "morph-regions" && profile !== "static-prepared") {
    failPolyMorphPrepare(
      "invalid-config",
      "$.profile",
      "generic preparation supports morph-regions or static-prepared",
    );
  }
  const sourceInput = record(input.source, "$.source", [
    "id",
    "kind",
    "license",
    "path",
    "uri",
  ]);
  const kind = text(sourceInput.kind, "$.source.kind");
  if (kind !== "authored" && kind !== "generated" && kind !== "open-data") {
    failPolyMorphPrepare("invalid-config", "$.source.kind", "unknown source kind");
  }
  const sourcePath = text(sourceInput.path, "$.source.path");
  if (
    isAbsolute(sourcePath)
    || sourcePath.includes("\\")
    || sourcePath.split("/").some((part) => part === "" || part === "." || part === "..")
  ) {
    failPolyMorphPrepare(
      "unsafe-path",
      "$.source.path",
      "expected a normalized config-relative path",
    );
  }
  const source = {
    id: id(sourceInput.id, "$.source.id"),
    kind,
    path: sourcePath,
    uri: text(sourceInput.uri, "$.source.uri"),
    license: text(sourceInput.license, "$.source.license"),
  } as const;
  if (
    source.uri.startsWith("/")
    || source.uri.startsWith("file:")
    || source.uri.includes("\\")
  ) {
    failPolyMorphPrepare(
      "invalid-config",
      "$.source.uri",
      "local filesystem paths are forbidden",
    );
  }
  const transformInput = record(input.transform, "$.transform", [
    "axes",
    "center",
    "scale",
    "signs",
  ]);
  const axes = array(transformInput.axes, "$.transform.axes");
  if (
    axes.length !== 3
    || axes.some((axis) => axis !== "x" && axis !== "y" && axis !== "z")
    || new Set(axes).size !== 3
  ) {
    failPolyMorphPrepare(
      "invalid-config",
      "$.transform.axes",
      "expected each source axis exactly once",
    );
  }
  const signs = array(transformInput.signs, "$.transform.signs");
  if (signs.length !== 3 || signs.some((sign) => sign !== -1 && sign !== 1)) {
    failPolyMorphPrepare(
      "invalid-config",
      "$.transform.signs",
      "expected three values of -1 or 1",
    );
  }
  const scale = finite(transformInput.scale, "$.transform.scale");
  if (!(scale > 0)) {
    failPolyMorphPrepare("invalid-config", "$.transform.scale", "expected a positive scale");
  }
  if (typeof transformInput.center !== "boolean") {
    failPolyMorphPrepare("invalid-config", "$.transform.center", "expected a boolean");
  }
  const aliases = record(
    input.morphAliases,
    "$.morphAliases",
    Object.keys((input.morphAliases ?? {}) as object),
  );
  const morphAliases = Object.fromEntries(
    Object.entries(aliases)
      .map(([sourceName, targetId]) => [
        text(sourceName, "$.morphAliases key"),
        id(targetId, `$.morphAliases.${sourceName}`),
      ])
      .sort(([left], [right]) => left.localeCompare(right)),
  );
  if (new Set(Object.values(morphAliases)).size !== Object.keys(morphAliases).length) {
    failPolyMorphPrepare(
      "invalid-config",
      "$.morphAliases",
      "prepared target ids must be unique",
    );
  }
  if (
    (profile === "morph-regions") !== (Object.keys(morphAliases).length > 0)
  ) {
    failPolyMorphPrepare(
      "invalid-config",
      "$.morphAliases",
      "morph-regions requires aliases and static-prepared forbids them",
    );
  }
  const config: PolyMorphPrepareConfig = {
    schema: POLY_MORPH_PREPARE_SCHEMA,
    identity,
    profile,
    source,
    transform: {
      axes: axes as PolyMorphPrepareConfig["transform"]["axes"],
      signs: signs as PolyMorphPrepareConfig["transform"]["signs"],
      scale,
      center: transformInput.center,
    },
    morphAliases,
    controls: structuredClone(array(input.controls, "$.controls")) as PolyMorphPrepareConfig["controls"],
    springs: structuredClone(array(input.springs, "$.springs")) as PolyMorphPrepareConfig["springs"],
    animations: structuredClone(array(input.animations, "$.animations")) as PolyMorphPrepareConfig["animations"],
    budgets: parseBudgets(input.budgets),
  };
  return config;
}

export async function readPolyMorphPrepareConfig(
  configPath: string,
): Promise<PolyMorphPrepareConfig> {
  let value: unknown;
  try {
    value = JSON.parse(await readFile(configPath, "utf8")) as unknown;
  } catch {
    failPolyMorphPrepare(
      "invalid-config",
      "$",
      "config is not readable UTF-8 JSON",
    );
  }
  return parsePolyMorphPrepareConfig(value);
}

export function resolvePolyMorphSourcePath(
  configPath: string,
  sourcePath: string,
): string {
  const root = resolve(dirname(configPath));
  const candidate = resolve(root, sourcePath);
  const rel = relative(root, candidate);
  if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    failPolyMorphPrepare(
      "unsafe-path",
      "$.source.path",
      "source escapes its authoring directory",
    );
  }
  return candidate;
}
