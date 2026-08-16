import {
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { compilePolyMorphSource } from "./compile.js";
import {
  parsePolyMorphPrepareConfig,
  readPolyMorphPrepareConfig,
  resolvePolyMorphSourcePath,
} from "./config.js";
import { PolyMorphPrepareError } from "./error.js";
import { loadPolyMorphGltf } from "./gltf.js";
import { preparePolyMorphModel } from "./prepare.js";
import {
  POLY_MORPH_PREPARE_SCHEMA,
  type PolyMorphGltfDocument,
  type PolyMorphPrepareConfig,
} from "./types.js";
import { mutable } from "../testing/mutable.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) =>
    rm(root, { recursive: true, force: true })));
});

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "polycss-morph-prepare-"));
  roots.push(root);
  return root;
}

function concatenate(parts: readonly Uint8Array[]): Uint8Array {
  const bytes = new Uint8Array(parts.reduce((sum, part) => sum + part.byteLength, 0));
  let offset = 0;
  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.byteLength;
  }
  return bytes;
}

function floatBytes(values: readonly number[]): Uint8Array {
  const bytes = new Uint8Array(values.length * 4);
  const view = new DataView(bytes.buffer);
  values.forEach((value, index) => view.setFloat32(index * 4, value, true));
  return bytes;
}

function uint16Bytes(values: readonly number[]): Uint8Array {
  const bytes = new Uint8Array(values.length * 2);
  const view = new DataView(bytes.buffer);
  values.forEach((value, index) => view.setUint16(index * 2, value, true));
  return bytes;
}

function padded(bytes: Uint8Array, alignment: number, fill = 0): Uint8Array {
  const length = Math.ceil(bytes.byteLength / alignment) * alignment;
  const output = new Uint8Array(length);
  output.fill(fill);
  output.set(bytes);
  return output;
}

function fixtureDocument(bufferByteLength: number): Record<string, unknown> {
  return {
    asset: { version: "2.0", generator: "polycss-morph-test" },
    buffers: [{ byteLength: bufferByteLength }],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: 48 },
      { buffer: 0, byteOffset: 48, byteLength: 12 },
      { buffer: 0, byteOffset: 60, byteLength: 48 },
    ],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 4, type: "VEC3" },
      { bufferView: 1, componentType: 5123, count: 6, type: "SCALAR" },
      { bufferView: 2, componentType: 5126, count: 4, type: "VEC3" },
    ],
    materials: [{
      name: "Signal Orange",
      pbrMetallicRoughness: { baseColorFactor: [1, 0.25, 0.05, 1] },
    }],
    meshes: [{
      name: "Kite",
      extras: { targetNames: ["Lift"] },
      primitives: [{
        attributes: { POSITION: 0 },
        indices: 1,
        material: 0,
        mode: 4,
        targets: [{ POSITION: 2 }],
      }],
    }],
    nodes: [{ name: "Kite Root", mesh: 0 }],
    scenes: [{ nodes: [0] }],
    scene: 0,
  };
}

function fixtureBinary(): Uint8Array {
  return concatenate([
    floatBytes([
      -1, -0.5, 0,
      1, -0.5, 0,
      0.65, 0.5, 0,
      -0.65, 0.5, 0,
    ]),
    uint16Bytes([0, 1, 2, 0, 2, 3]),
    floatBytes([
      0, 0, 0,
      0, 0, 0,
      0, 0.6, 0.2,
      0, 0.6, 0.2,
    ]),
  ]);
}

function encodeGlb(json: Record<string, unknown>, binary: Uint8Array): Uint8Array {
  const jsonBytes = padded(
    new TextEncoder().encode(JSON.stringify(json)),
    4,
    0x20,
  );
  const binBytes = padded(binary, 4);
  const output = new Uint8Array(12 + 8 + jsonBytes.length + 8 + binBytes.length);
  const view = new DataView(output.buffer);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, output.byteLength, true);
  view.setUint32(12, jsonBytes.byteLength, true);
  view.setUint32(16, 0x4e4f534a, true);
  output.set(jsonBytes, 20);
  const binOffset = 20 + jsonBytes.byteLength;
  view.setUint32(binOffset, binBytes.byteLength, true);
  view.setUint32(binOffset + 4, 0x004e4942, true);
  output.set(binBytes, binOffset + 8);
  return output;
}

function fixtureConfig(sourcePath = "kite.glb") {
  return {
    schema: POLY_MORPH_PREPARE_SCHEMA,
    identity: {
      id: "morph-kite",
      name: "Morph Kite",
      revision: "1.0.0",
    },
    profile: "morph-regions",
    source: {
      path: sourcePath,
      id: "authored-kite",
      kind: "authored",
      uri: "urn:polycss:morph-kite",
      license: "MIT",
    },
    transform: {
      axes: ["x", "y", "z"],
      signs: [1, 1, 1],
      scale: 64,
      center: true,
    },
    morphAliases: { Lift: "lift" },
    controls: [{
      id: "kite-tip",
      anchor: [0, 32, 0],
      axis: [0, 1, 0],
      radius: 18,
      minimum: 0,
      maximum: 1,
      initial: 0,
      targets: [{ targetId: "lift", scale: 1 }],
    }],
    springs: [{
      id: "kite-tip-spring",
      controlId: "kite-tip",
      stiffness: 120,
      damping: 18,
    }],
    animations: [{
      id: "kite-flap",
      durationMs: 1000,
      loop: true,
      channels: [{
        target: "control-value",
        targetId: "kite-tip",
        interpolation: "linear",
        timesMs: [0, 500, 1000],
        values: [[0], [1], [0]],
      }],
    }],
    budgets: {
      maxVertices: 8,
      maxPolygons: 4,
      maxLeaves: 4,
      maxFrames: 1,
      maxJoints: 1,
      maxResources: 4,
      maxBytes: 1_000_000,
    },
  };
}

type MutablePrepareConfig = ReturnType<typeof fixtureConfig>;
type MutableGltfDocument = Record<string, any>;

function expectPrepareFailure(
  action: () => unknown,
  code: string,
  path?: string,
): void {
  try {
    action();
  } catch (error) {
    expect(error).toBeInstanceOf(PolyMorphPrepareError);
    expect(error).toMatchObject({
      code,
      ...(path ? { path } : {}),
    });
    return;
  }
  throw new Error(`Expected ${code}.`);
}

async function expectPrepareRejection(
  action: Promise<unknown>,
  code: string,
  path?: string,
): Promise<void> {
  try {
    await action;
  } catch (error) {
    expect(error).toBeInstanceOf(PolyMorphPrepareError);
    expect(error).toMatchObject({
      code,
      ...(path ? { path } : {}),
    });
    return;
  }
  throw new Error(`Expected ${code}.`);
}

async function writeEmbeddedGltf(
  root: string,
  name: string,
  mutate: (document: MutableGltfDocument) => void = () => {},
): Promise<string> {
  const binary = fixtureBinary();
  const document = fixtureDocument(binary.byteLength) as MutableGltfDocument;
  document.buffers[0].uri =
    `data:application/octet-stream;base64,${Buffer.from(binary).toString("base64")}`;
  mutate(document);
  const sourcePath = join(root, `${name}.gltf`);
  await writeFile(sourcePath, JSON.stringify(document));
  return sourcePath;
}

function mixedSizeConfig(): PolyMorphPrepareConfig {
  return {
    schema: POLY_MORPH_PREPARE_SCHEMA,
    identity: {
      id: "mixed-triangles",
      name: "Mixed Triangles",
      revision: "1.0.0",
    },
    profile: "static-prepared",
    source: {
      path: "mixed-triangles.gltf",
      id: "mixed-triangles-source",
      kind: "generated",
      uri: "urn:polycss:mixed-triangles",
      license: "MIT",
    },
    transform: {
      axes: ["x", "y", "z"],
      signs: [1, 1, 1],
      scale: 1,
      center: false,
    },
    morphAliases: {},
    controls: [],
    springs: [],
    animations: [],
    budgets: {
      maxVertices: 9,
      maxPolygons: 3,
      maxLeaves: 3,
      maxFrames: 1,
      maxJoints: 1,
      maxResources: 4,
      maxBytes: 1_000_000,
    },
  };
}

function mixedSizeSource(): PolyMorphGltfDocument {
  return {
    format: "gltf",
    sourceBytes: 1,
    sourceSha256: "a".repeat(64),
    contentSha256: "b".repeat(64),
    materials: [{
      sourceIndex: 0,
      name: "White",
      color: [1, 1, 1, 1],
    }],
    instances: [{
      nodeIndex: 0,
      nodeName: "Mixed Triangles",
      meshIndex: 0,
      meshName: "Mixed Triangles",
      matrix: [
        1, 0, 0, 0,
        0, 1, 0, 0,
        0, 0, 1, 0,
        0, 0, 0, 1,
      ],
      primitives: [{
        primitiveIndex: 0,
        materialIndex: 0,
        positions: [
          [0, 0, 0], [12, 0, 0], [0, 5, 0],
          [0, 10, 0], [24, 10, 0], [0, 19, 0],
          [0, 30, 0], [7, 30, 0], [0, 47, 0],
        ],
        triangles: [
          [0, 1, 2],
          [3, 4, 5],
          [6, 7, 8],
        ],
        targets: [],
      }],
    }],
  };
}

async function writeFixture(
  root: string,
): Promise<{ readonly configPath: string; readonly sourcePath: string }> {
  const binary = fixtureBinary();
  const sourcePath = join(root, "kite.glb");
  const configPath = join(root, "prepare.json");
  await writeFile(sourcePath, encodeGlb(fixtureDocument(binary.byteLength), binary));
  await writeFile(configPath, JSON.stringify(fixtureConfig("kite.glb")));
  return { configPath, sourcePath };
}

async function packageBytes(root: string): Promise<ReadonlyMap<string, Uint8Array>> {
  const paths = [
    "assets/solid-triangles-000.png",
    "manifest.json",
    "model.json",
  ];
  return new Map(await Promise.all(paths.map(async (path) => [
    path,
    new Uint8Array(await readFile(join(root, path))),
  ] as const)));
}

describe("preparePolyMorphModel", () => {
  it("produces byte-identical complete packages and writes the manifest last", async () => {
    const root = await temporaryRoot();
    const { configPath } = await writeFixture(root);
    const firstRoot = join(root, "first");
    const secondRoot = join(root, "second");
    const first = await preparePolyMorphModel({ configPath, outputRoot: firstRoot });
    const second = await preparePolyMorphModel({ configPath, outputRoot: secondRoot });

    expect(first.files).toEqual([
      "assets/solid-triangles-000.png",
      "manifest.json",
      "model.json",
    ]);
    expect(first.writeOrder[first.writeOrder.length - 1]).toBe("manifest.json");
    expect((await readdir(firstRoot)).sort()).toEqual([
      "assets",
      "manifest.json",
      "model.json",
    ]);
    expect(await readdir(join(firstRoot, "assets"))).toEqual([
      "solid-triangles-000.png",
    ]);
    const firstBytes = await packageBytes(firstRoot);
    const secondBytes = await packageBytes(secondRoot);
    for (const [path, bytes] of firstBytes) {
      expect(secondBytes.get(path)).toEqual(bytes);
    }
    expect(first.manifestSha256).toBe(second.manifestSha256);
    expect(first.model.profile).toBe("morph-regions");
    expect(first.model.deformation.kind).toBe("morph-regions");
    expect(first.model.render.leaves).toHaveLength(2);
    expect(first.model.render.leaves.every((leaf) =>
      leaf.strategy === "solid-triangle"
      && leaf.width === 32
      && leaf.height === 32
      && leaf.atlas === null
      && leaf.fallback !== null
      && leaf.fallback.width === leaf.fallback.atlas.width
      && leaf.fallback.height === leaf.fallback.atlas.height
      && leaf.fallback.atlas.resourcePath === "assets/solid-triangles-000.png"
      && (leaf.fallback.width !== 32 || leaf.fallback.height !== 32))).toBe(true);
    expect(new Set(first.model.render.leaves.map((leaf) =>
      `${leaf.fallback!.atlas.x}:${leaf.fallback!.atlas.y}`,
    )).size).toBe(2);
    expect(
      [...firstBytes.get("assets/solid-triangles-000.png")!.subarray(0, 8)],
    ).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    const manifest = JSON.parse(
      new TextDecoder().decode(firstBytes.get("manifest.json")),
    ) as { resources: readonly { path: string }[] };
    expect(manifest.resources.map(({ path }) => path)).toEqual([
      "assets/solid-triangles-000.png",
      "model.json",
    ]);
  });

  it("passes exact check mode and detects byte or inventory drift", async () => {
    const root = await temporaryRoot();
    const { configPath } = await writeFixture(root);
    const outputRoot = join(root, "package");
    await preparePolyMorphModel({ configPath, outputRoot });
    const checked = await preparePolyMorphModel({
      configPath,
      outputRoot,
      check: true,
    });
    expect(checked).toMatchObject({
      checked: true,
      changed: false,
      writeOrder: [],
    });

    await writeFile(join(outputRoot, "model.json"), "drift");
    await expect(preparePolyMorphModel({
      configPath,
      outputRoot,
      check: true,
    })).rejects.toMatchObject({ code: "drift" });

    const repaired = await preparePolyMorphModel({ configPath, outputRoot });
    expect(repaired.changed).toBe(true);
    const unchanged = await preparePolyMorphModel({ configPath, outputRoot });
    expect(unchanged).toMatchObject({
      checked: false,
      changed: false,
      writeOrder: [],
    });
    await writeFile(join(outputRoot, "extra.json"), "{}");
    await expect(preparePolyMorphModel({
      configPath,
      outputRoot,
      check: true,
    })).rejects.toMatchObject({ code: "drift" });
  });

  it("leaves the prior package untouched when source preparation fails", async () => {
    const root = await temporaryRoot();
    const { configPath, sourcePath } = await writeFixture(root);
    const outputRoot = join(root, "package");
    await preparePolyMorphModel({ configPath, outputRoot });
    const before = await packageBytes(outputRoot);

    await writeFile(sourcePath, new Uint8Array([0, 1, 2]));
    await expect(preparePolyMorphModel({
      configPath,
      outputRoot,
    })).rejects.toBeInstanceOf(PolyMorphPrepareError);
    const after = await packageBytes(outputRoot);
    for (const [path, bytes] of before) expect(after.get(path)).toEqual(bytes);
  });

  it("rejects the removed atlas authoring option", async () => {
    const root = await temporaryRoot();
    const binary = fixtureBinary();
    const sourcePath = join(root, "kite.glb");
    const configPath = join(root, "prepare.json");
    await writeFile(sourcePath, encodeGlb(fixtureDocument(binary.byteLength), binary));
    await writeFile(configPath, JSON.stringify({
      ...fixtureConfig(),
      atlas: { format: "webp", tileSize: 8 },
    }));
    await expect(preparePolyMorphModel({
      configPath,
      outputRoot: join(root, "package"),
    })).rejects.toMatchObject({
      code: "invalid-config",
      path: "$",
    });
  });
});

describe("compilePolyMorphSource", () => {
  it("generates deterministic polygon-sized fallbacks for mixed triangles", async () => {
    const first = await compilePolyMorphSource(
      mixedSizeSource(),
      mixedSizeConfig(),
    );
    const second = await compilePolyMorphSource(
      mixedSizeSource(),
      mixedSizeConfig(),
    );
    const fallbacks = first.model.render.leaves.map((leaf) => leaf.fallback!);
    const pagePaths = new Set(first.fallbackAtlasPages.map((page) => page.path));

    expect(first.fallbackAtlasPages).toHaveLength(1);
    expect(first.fallbackAtlasPages.every(({ width, height }) =>
      width < 128 && height < 128)).toBe(true);
    expect(new Set(
      fallbacks.map(({ width, height }) => `${width}:${height}`),
    ).size)
      .toBeGreaterThan(1);
    expect(fallbacks.every(({ width, height, atlas }) =>
      width === atlas.width
      && height === atlas.height
      && pagePaths.has(atlas.resourcePath)
      && atlas.x + atlas.width <= atlas.pageWidth
      && atlas.y + atlas.height <= atlas.pageHeight)).toBe(true);
    expect(second.model.render.leaves.map((leaf) => leaf.fallback))
      .toEqual(first.model.render.leaves.map((leaf) => leaf.fallback));
    expect(second.fallbackAtlasPages.map(({ path, width, height, bytes }) => ({
      path,
      width,
      height,
      bytes: [...bytes],
    }))).toEqual(first.fallbackAtlasPages.map(({ path, width, height, bytes }) => ({
      path,
      width,
      height,
      bytes: [...bytes],
    })));
  });

  it("preserves front-face winding through reflective authoring transforms", async () => {
    const config = mutable(mixedSizeConfig());
    config.transform.signs = [-1, 1, 1];
    const compiled = await compilePolyMorphSource(mixedSizeSource(), config);
    expect(compiled.model.topology.polygons[0]!.vertexIndices).toEqual([0, 2, 1]);
    expect(compiled.model.topology.normals[0]).toEqual([0, 0, 1]);
  });
});

describe("prepare config validation", () => {
  it("accepts both generic authoring profiles and resolves local sources", () => {
    const morph = fixtureConfig();
    (morph.morphAliases as Record<string, string>).Bend = "bend";
    const parsedMorph = parsePolyMorphPrepareConfig(morph);
    expect(Object.keys(parsedMorph.morphAliases)).toEqual(["Bend", "Lift"]);

    const staticPrepared = fixtureConfig();
    staticPrepared.profile = "static-prepared";
    staticPrepared.source.kind = "open-data";
    staticPrepared.transform.axes = ["z", "x", "y"];
    staticPrepared.transform.signs = [-1, 1, -1];
    staticPrepared.transform.center = false;
    staticPrepared.morphAliases = {} as MutablePrepareConfig["morphAliases"];
    expect(parsePolyMorphPrepareConfig(staticPrepared)).toMatchObject({
      profile: "static-prepared",
      source: { kind: "open-data" },
      transform: { center: false },
      morphAliases: {},
    });

    expect(resolvePolyMorphSourcePath("/tmp/morph/prepare.json", "model/kite.glb"))
      .toBe("/tmp/morph/model/kite.glb");
  });

  const invalidCases: readonly {
    readonly name: string;
    readonly code: string;
    readonly path: string;
    readonly mutate: (config: MutablePrepareConfig) => void;
  }[] = [
    {
      name: "unknown root keys",
      code: "invalid-config",
      path: "$",
      mutate: (config) => {
        (config as unknown as Record<string, unknown>).atlas = {};
      },
    },
    {
      name: "schema revisions",
      code: "invalid-config",
      path: "$.schema",
      mutate: (config) => {
        // Deliberately out-of-contract schema revision.
        (config as { schema: string }).schema = "polycss-morph.prepare@2";
      },
    },
    {
      name: "unnormalized ids",
      code: "invalid-config",
      path: "$.identity.id",
      mutate: (config) => {
        config.identity.id = "Morph Kite";
      },
    },
    {
      name: "blank names",
      code: "invalid-config",
      path: "$.identity.name",
      mutate: (config) => {
        config.identity.name = " ";
      },
    },
    {
      name: "non-semver revisions",
      code: "invalid-config",
      path: "$.identity.revision",
      mutate: (config) => {
        config.identity.revision = "v1";
      },
    },
    {
      name: "unsupported profiles",
      code: "invalid-config",
      path: "$.profile",
      mutate: (config) => {
        config.profile = "joint-skin";
      },
    },
    {
      name: "unknown source kinds",
      code: "invalid-config",
      path: "$.source.kind",
      mutate: (config) => {
        config.source.kind = "private";
      },
    },
    {
      name: "absolute source paths",
      code: "unsafe-path",
      path: "$.source.path",
      mutate: (config) => {
        config.source.path = "/tmp/kite.glb";
      },
    },
    {
      name: "parent source paths",
      code: "unsafe-path",
      path: "$.source.path",
      mutate: (config) => {
        config.source.path = "../kite.glb";
      },
    },
    {
      name: "filesystem source URIs",
      code: "invalid-config",
      path: "$.source.uri",
      mutate: (config) => {
        config.source.uri = "file:///tmp/kite.glb";
      },
    },
    {
      name: "duplicate axes",
      code: "invalid-config",
      path: "$.transform.axes",
      mutate: (config) => {
        config.transform.axes = ["x", "x", "z"];
      },
    },
    {
      name: "invalid axis signs",
      code: "invalid-config",
      path: "$.transform.signs",
      mutate: (config) => {
        config.transform.signs = [1, 0, 1];
      },
    },
    {
      name: "non-positive scales",
      code: "invalid-config",
      path: "$.transform.scale",
      mutate: (config) => {
        config.transform.scale = 0;
      },
    },
    {
      name: "non-boolean centering",
      code: "invalid-config",
      path: "$.transform.center",
      mutate: (config) => {
        config.transform.center = "yes" as unknown as boolean;
      },
    },
    {
      name: "duplicate target aliases",
      code: "invalid-config",
      path: "$.morphAliases",
      mutate: (config) => {
        (config.morphAliases as Record<string, string>).Bend = "lift";
      },
    },
    {
      name: "morph profiles without aliases",
      code: "invalid-config",
      path: "$.morphAliases",
      mutate: (config) => {
        config.morphAliases = {} as MutablePrepareConfig["morphAliases"];
      },
    },
    {
      name: "static profiles with aliases",
      code: "invalid-config",
      path: "$.morphAliases",
      mutate: (config) => {
        config.profile = "static-prepared";
      },
    },
    {
      name: "non-array controls",
      code: "invalid-config",
      path: "$.controls",
      mutate: (config) => {
        config.controls = {} as MutablePrepareConfig["controls"];
      },
    },
    {
      name: "non-array springs",
      code: "invalid-config",
      path: "$.springs",
      mutate: (config) => {
        config.springs = {} as MutablePrepareConfig["springs"];
      },
    },
    {
      name: "non-array animations",
      code: "invalid-config",
      path: "$.animations",
      mutate: (config) => {
        config.animations = {} as MutablePrepareConfig["animations"];
      },
    },
    {
      name: "zero budgets",
      code: "invalid-config",
      path: "$.budgets.maxBytes",
      mutate: (config) => {
        config.budgets.maxBytes = 0;
      },
    },
    {
      name: "fractional budgets",
      code: "invalid-config",
      path: "$.budgets.maxVertices",
      mutate: (config) => {
        config.budgets.maxVertices = 1.5;
      },
    },
  ];

  it.each(invalidCases)("rejects $name", ({ code, path, mutate }) => {
    const config = structuredClone(fixtureConfig());
    mutate(config);
    expectPrepareFailure(() => parsePolyMorphPrepareConfig(config), code, path);
  });

  it("rejects non-object configs, unreadable JSON, and escaped resolved paths", async () => {
    expectPrepareFailure(
      () => parsePolyMorphPrepareConfig(null),
      "invalid-config",
      "$",
    );
    const root = await temporaryRoot();
    const configPath = join(root, "prepare.json");
    await writeFile(configPath, "{");
    await expectPrepareRejection(
      readPolyMorphPrepareConfig(configPath),
      "invalid-config",
      "$",
    );
    expectPrepareFailure(
      () => resolvePolyMorphSourcePath(configPath, "../kite.glb"),
      "unsafe-path",
      "$.source.path",
    );
  });
});

describe("loadPolyMorphGltf", () => {
  it("loads a JSON glTF with a source-relative external buffer", async () => {
    const root = await temporaryRoot();
    const binary = fixtureBinary();
    const document = fixtureDocument(binary.byteLength);
    (document.buffers as Record<string, unknown>[])[0]!.uri = "kite.bin";
    await writeFile(join(root, "kite.bin"), binary);
    await writeFile(join(root, "kite.gltf"), JSON.stringify(document));

    const loaded = await loadPolyMorphGltf(join(root, "kite.gltf"));
    expect(loaded.format).toBe("gltf");
    expect(loaded.instances[0]?.primitives[0]?.targets[0]?.name).toBe("Lift");
    expect(loaded.contentSha256).toMatch(/^[a-f0-9]{64}$/u);
  });

  it("loads embedded triangle strips with implicit scenes and node TRS", async () => {
    const root = await temporaryRoot();
    const sourcePath = await writeEmbeddedGltf(root, "strip", (document) => {
      document.accessors[1].count = 4;
      document.meshes[0].primitives[0].mode = 5;
      delete document.meshes[0].primitives[0].material;
      delete document.meshes[0].extras;
      delete document.meshes[0].name;
      document.nodes[0] = {
        mesh: 0,
        translation: [1, 2, 3],
        rotation: [0, 0, Math.SQRT1_2, Math.SQRT1_2],
        scale: [2, 3, 4],
      };
      delete document.scenes;
      delete document.scene;
      delete document.materials;
    });

    const loaded = await loadPolyMorphGltf(sourcePath);
    expect(loaded.format).toBe("gltf");
    expect(loaded.instances[0]).toMatchObject({
      nodeName: "node-0",
      meshName: "mesh-0",
      primitives: [{
        materialIndex: -1,
        triangles: [[0, 1, 2], [2, 1, 0]],
        targets: [{ name: "morph-0" }],
      }],
    });
  });

  const invalidGltfCases: readonly {
    readonly name: string;
    readonly code: string;
    readonly mutate: (document: MutableGltfDocument) => void;
  }[] = [
    {
      name: "glTF 1 assets",
      code: "unsupported-gltf",
      mutate: (document) => {
        document.asset.version = "1.0";
      },
    },
    {
      name: "required extensions",
      code: "unsupported-gltf",
      mutate: (document) => {
        document.extensionsRequired = ["KHR_draco_mesh_compression"];
      },
    },
    {
      name: "missing buffers",
      code: "missing-buffer",
      mutate: (document) => {
        document.buffers = [];
      },
    },
    {
      name: "negative buffer lengths",
      code: "invalid-buffer",
      mutate: (document) => {
        document.buffers[0].byteLength = -1;
      },
    },
    {
      name: "unsupported data URIs",
      code: "unsupported-uri",
      mutate: (document) => {
        document.buffers[0].uri = "data:text/plain;base64,AA==";
      },
    },
    {
      name: "mismatched buffer lengths",
      code: "invalid-buffer",
      mutate: (document) => {
        document.buffers[0].byteLength -= 4;
      },
    },
    {
      name: "sparse accessors",
      code: "invalid-accessor",
      mutate: (document) => {
        document.accessors[0].sparse = {};
      },
    },
    {
      name: "unknown accessor types",
      code: "invalid-accessor",
      mutate: (document) => {
        document.accessors[0].type = "VEC5";
      },
    },
    {
      name: "absent accessor buffers",
      code: "invalid-accessor",
      mutate: (document) => {
        document.bufferViews[0].buffer = 1;
      },
    },
    {
      name: "invalid accessor strides",
      code: "invalid-accessor",
      mutate: (document) => {
        document.bufferViews[0].byteStride = 1;
      },
    },
    {
      name: "misaligned accessor strides",
      code: "invalid-accessor",
      mutate: (document) => {
        document.bufferViews[0].byteStride = 14;
      },
    },
    {
      name: "oversized accessor strides",
      code: "invalid-accessor",
      mutate: (document) => {
        document.bufferViews[0].byteStride = 256;
      },
    },
    {
      name: "accessors outside their buffer views",
      code: "invalid-accessor",
      mutate: (document) => {
        document.accessors[0].byteOffset = 12;
      },
    },
    {
      name: "buffer views outside their buffers",
      code: "invalid-accessor",
      mutate: (document) => {
        document.bufferViews[0].byteLength = 200;
      },
    },
    {
      name: "scalar positions",
      code: "invalid-accessor",
      mutate: (document) => {
        document.accessors[0].type = "SCALAR";
      },
    },
    {
      name: "vector indices",
      code: "invalid-index",
      mutate: (document) => {
        document.accessors[1].type = "VEC3";
        document.accessors[1].count = 2;
      },
    },
    {
      name: "non-triangle primitive modes",
      code: "unsupported-primitive",
      mutate: (document) => {
        document.meshes[0].primitives[0].mode = 1;
      },
    },
    {
      name: "incomplete triangle lists",
      code: "invalid-primitive",
      mutate: (document) => {
        document.accessors[1].count = 5;
      },
    },
    {
      name: "missing scene nodes",
      code: "invalid-scene",
      mutate: (document) => {
        document.scenes[0] = {};
      },
    },
    {
      name: "unknown scene nodes",
      code: "invalid-node",
      mutate: (document) => {
        document.scenes[0].nodes = [9];
      },
    },
    {
      name: "node cycles",
      code: "invalid-node",
      mutate: (document) => {
        document.nodes[0].children = [0];
      },
    },
    {
      name: "negative mesh indices",
      code: "invalid-node",
      mutate: (document) => {
        document.nodes[0].mesh = -1;
      },
    },
    {
      name: "non-array node children",
      code: "invalid-node",
      mutate: (document) => {
        document.nodes[0].children = {};
      },
    },
    {
      name: "short node matrices",
      code: "invalid-node",
      mutate: (document) => {
        document.nodes[0].matrix = new Array(15).fill(0);
      },
    },
    {
      name: "zero node quaternions",
      code: "invalid-node",
      mutate: (document) => {
        document.nodes[0].rotation = [0, 0, 0, 0];
      },
    },
    {
      name: "empty meshes",
      code: "invalid-mesh",
      mutate: (document) => {
        document.meshes[0].primitives = [];
      },
    },
    {
      name: "missing positions",
      code: "invalid-primitive",
      mutate: (document) => {
        delete document.meshes[0].primitives[0].attributes.POSITION;
      },
    },
    {
      name: "morph targets without positions",
      code: "invalid-morph",
      mutate: (document) => {
        document.meshes[0].primitives[0].targets[0] = {};
      },
    },
    {
      name: "short morph targets",
      code: "invalid-morph",
      mutate: (document) => {
        document.accessors[2].count = 3;
      },
    },
    {
      name: "negative material indices",
      code: "invalid-material",
      mutate: (document) => {
        document.meshes[0].primitives[0].material = -2;
      },
    },
    {
      name: "null materials",
      code: "invalid-material",
      mutate: (document) => {
        document.materials[0] = null;
      },
    },
    {
      name: "out-of-range material colors",
      code: "invalid-material",
      mutate: (document) => {
        document.materials[0].pbrMetallicRoughness.baseColorFactor = [2, 0, 0, 1];
      },
    },
    {
      name: "empty default scenes",
      code: "empty-model",
      mutate: (document) => {
        document.scenes[0].nodes = [];
      },
    },
  ];

  it.each(invalidGltfCases)("rejects $name", async ({ name, code, mutate }) => {
    const root = await temporaryRoot();
    const sourcePath = await writeEmbeddedGltf(root, name.replace(/ /g, "-"), mutate);
    await expectPrepareRejection(loadPolyMorphGltf(sourcePath), code);
  });

  it("rejects malformed source containers", async () => {
    const root = await temporaryRoot();
    const invalidJson = join(root, "invalid.gltf");
    const nonObjectJson = join(root, "array.gltf");
    const unsupported = join(root, "model.obj");
    const truncatedGlb = join(root, "truncated.glb");
    const invalidHeaderGlb = join(root, "header.glb");
    await writeFile(invalidJson, "{");
    await writeFile(nonObjectJson, "[]");
    await writeFile(unsupported, "");
    await writeFile(truncatedGlb, new Uint8Array([1, 2, 3]));
    const binary = fixtureBinary();
    const invalidHeader = encodeGlb(fixtureDocument(binary.byteLength), binary);
    invalidHeader[0] = 0;
    await writeFile(invalidHeaderGlb, invalidHeader);

    await expectPrepareRejection(loadPolyMorphGltf(invalidJson), "invalid-gltf");
    await expectPrepareRejection(loadPolyMorphGltf(nonObjectJson), "invalid-gltf");
    await expectPrepareRejection(loadPolyMorphGltf(unsupported), "unsupported-format");
    await expectPrepareRejection(loadPolyMorphGltf(truncatedGlb), "invalid-glb");
    await expectPrepareRejection(loadPolyMorphGltf(invalidHeaderGlb), "invalid-glb");
  });
});
