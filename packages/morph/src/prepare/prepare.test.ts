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
import { PolyMorphPrepareError } from "./error.js";
import { loadPolyMorphGltf } from "./gltf.js";
import { preparePolyMorphModel } from "./prepare.js";
import {
  POLY_MORPH_PREPARE_SCHEMA,
  type PolyMorphGltfDocument,
  type PolyMorphPrepareConfig,
} from "./types.js";

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
    "model.css",
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
      "model.css",
      "model.json",
    ]);
    expect(first.writeOrder.at(-1)).toBe("manifest.json");
    expect((await readdir(firstRoot)).sort()).toEqual([
      "assets",
      "manifest.json",
      "model.css",
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
      "model.css",
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

    await writeFile(join(outputRoot, "model.css"), "drift");
    await expect(preparePolyMorphModel({
      configPath,
      outputRoot,
      check: true,
    })).rejects.toMatchObject<Partial<PolyMorphPrepareError>>({ code: "drift" });

    await preparePolyMorphModel({ configPath, outputRoot });
    await writeFile(join(outputRoot, "extra.json"), "{}");
    await expect(preparePolyMorphModel({
      configPath,
      outputRoot,
      check: true,
    })).rejects.toMatchObject<Partial<PolyMorphPrepareError>>({ code: "drift" });
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
    })).rejects.toMatchObject<Partial<PolyMorphPrepareError>>({
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
});
