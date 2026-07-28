import { describe, expect, it } from "vitest";
import {
  buildPolyMorphCatalog,
  buildPolyMorphPackage,
  encodePolyMorphCanonicalJson,
  hashPolyMorphBytes,
  PolyMorphPackageError,
  stringifyPolyMorphCanonicalJson,
  validatePolyMorphCatalog,
  validatePolyMorphPackageManifest,
} from "./index.js";
import {
  clonePolyMorphFixture,
  createPolyMorphModelFixture,
} from "../testing/modelFixture.js";

function expectPackageCode(action: () => unknown, code: string): void {
  try {
    action();
  } catch (error) {
    expect(error).toBeInstanceOf(PolyMorphPackageError);
    expect((error as PolyMorphPackageError).code).toBe(code);
    return;
  }
  throw new Error(`Expected ${code}.`);
}

describe("canonical package construction", () => {
  it("serializes equivalent objects to identical bytes and hashes", async () => {
    const left = { z: [3, { b: true, a: null }], a: "gem" };
    const right = { a: "gem", z: [3, { a: null, b: true }] };
    const leftBytes = encodePolyMorphCanonicalJson(left);
    const rightBytes = encodePolyMorphCanonicalJson(right);
    expect(leftBytes).toEqual(rightBytes);
    expect(stringifyPolyMorphCanonicalJson(left)).toBe(
      "{\"a\":\"gem\",\"z\":[3,{\"a\":null,\"b\":true}]}",
    );
    expect(await hashPolyMorphBytes(leftBytes)).toBe(await hashPolyMorphBytes(rightBytes));
  });

  it("builds byte-identical packages from equivalent model key order", async () => {
    const fixture = createPolyMorphModelFixture("morph-regions");
    const reversed = Object.fromEntries(Object.entries(fixture).reverse());
    const resource = {
      path: "assets/gem.bin",
      role: "data" as const,
      mediaType: "application/octet-stream",
      bytes: new Uint8Array([3, 1, 4, 1, 5]),
    };
    const left = await buildPolyMorphPackage(fixture, [resource]);
    const right = await buildPolyMorphPackage(reversed, [resource]);
    expect(left.manifestBytes).toEqual(right.manifestBytes);
    expect(left.files.get("model.json")).toEqual(right.files.get("model.json"));
    expect(left.manifestSha256).toBe(right.manifestSha256);
  });

  it("sorts and content-binds every declared resource", async () => {
    const built = await buildPolyMorphPackage(createPolyMorphModelFixture(), [
      {
        path: "data/metadata.bin",
        role: "data",
        mediaType: "application/octet-stream",
        bytes: new TextEncoder().encode("gem"),
      },
      {
        path: "assets/gem.webp",
        role: "image",
        mediaType: "image/webp",
        bytes: new Uint8Array([1, 2, 3]),
      },
    ]);
    expect(built.manifest.resources.map((resource) => resource.path)).toEqual([
      "assets/gem.webp",
      "data/metadata.bin",
      "model.json",
    ]);
    for (const descriptor of built.manifest.resources) {
      const bytes = built.files.get(descriptor.path);
      expect(bytes?.byteLength).toBe(descriptor.bytes);
      expect(bytes && await hashPolyMorphBytes(bytes)).toBe(descriptor.sha256);
    }
  });

  it("requires every prepared image reference to bind an image resource", async () => {
    const model = clonePolyMorphFixture(createPolyMorphModelFixture());
    model.render.leaves[0]!.fallback = {
      width: 7,
      height: 5,
      matrixFromLeaf: model.render.leaves[0]!.matrix,
      atlas: {
        resourcePath: "assets/solid-triangles-000.png",
        x: 0,
        y: 0,
        width: 7,
        height: 5,
        pageWidth: 7,
        pageHeight: 5,
      },
    };
    await expect(buildPolyMorphPackage(model)).rejects.toMatchObject({
      code: "missing-resource",
    });
    await expect(buildPolyMorphPackage(model, [{
      path: "assets/solid-triangles-000.png",
      role: "data",
      mediaType: "image/png",
      bytes: new Uint8Array([1]),
    }])).rejects.toMatchObject({
      code: "invalid-role",
    });
    await expect(buildPolyMorphPackage(model, [{
      path: "assets/solid-triangles-000.png",
      role: "image",
      mediaType: "image/png",
      bytes: new Uint8Array([1]),
    }])).resolves.toMatchObject({
      manifest: {
        resources: expect.arrayContaining([
          expect.objectContaining({
            path: "assets/solid-triangles-000.png",
            role: "image",
          }),
        ]),
      },
    });
  });

  it("requires image resources to declare an image media type", async () => {
    await expect(buildPolyMorphPackage(createPolyMorphModelFixture(), [{
      path: "assets/paint.bin",
      role: "image",
      mediaType: "application/octet-stream",
      bytes: new Uint8Array([1]),
    }])).rejects.toMatchObject({
      code: "invalid-media-type",
    });
  });

  it("rejects unknown, duplicate, unsafe, and malformed manifest data", () => {
    const fixture = {
      schema: "polycss-morph.package@1",
      identity: { id: "morph-gem", name: "Morph Gem", revision: "1.0.0" },
      profile: "static-prepared",
      modelPath: "model.json",
      resources: [
        {
          path: "model.json",
          role: "model",
          mediaType: "application/json",
          bytes: 1,
          sha256: "a".repeat(64),
        },
      ],
    };
    expect(validatePolyMorphPackageManifest(fixture).modelPath).toBe("model.json");

    expectPackageCode(() =>
      validatePolyMorphPackageManifest({ ...fixture, unknown: true }), "invalid-keys");
    expectPackageCode(() =>
      validatePolyMorphPackageManifest({
        ...fixture,
        resources: [...fixture.resources, fixture.resources[0]],
      }), "duplicate");
    expectPackageCode(() =>
      validatePolyMorphPackageManifest({
        ...fixture,
        modelPath: "../model.json",
        resources: [{ ...fixture.resources[0], path: "../model.json" }],
      }), "invalid-path");
    expectPackageCode(() =>
      validatePolyMorphPackageManifest({
        ...fixture,
        resources: [{ ...fixture.resources[0], role: "unknown" }],
      }), "invalid-role");
  });

  it("builds a strict content-addressed catalog", async () => {
    const first = await buildPolyMorphPackage(createPolyMorphModelFixture());
    const secondModel = clonePolyMorphFixture(createPolyMorphModelFixture());
    secondModel.identity.id = "second-gem";
    secondModel.identity.name = "Second Gem";
    const second = await buildPolyMorphPackage(secondModel);
    const built = await buildPolyMorphCatalog("morph-gem", [
      {
        manifest: second.manifest,
        manifestPath: "models/second-gem/manifest.json",
        manifestSha256: second.manifestSha256,
      },
      {
        manifest: first.manifest,
        manifestPath: "models/morph-gem/manifest.json",
        manifestSha256: first.manifestSha256,
      },
    ]);
    expect(built.catalog.packages.map((row) => row.id)).toEqual(["morph-gem", "second-gem"]);
    expect(await hashPolyMorphBytes(built.bytes)).toBe(built.sha256);
    expect(validatePolyMorphCatalog(built.catalog)).toEqual(built.catalog);
  });
});
