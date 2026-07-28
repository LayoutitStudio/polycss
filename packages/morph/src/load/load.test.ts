import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildPolyMorphCatalog,
  buildPolyMorphPackage,
  encodePolyMorphCanonicalJson,
  hashPolyMorphBytes,
  PolyMorphPackageError,
  type PolyMorphBuiltCatalog,
  type PolyMorphBuiltPackage,
} from "../package/index.js";
import {
  clonePolyMorphFixture,
  createPolyMorphModelFixture,
} from "../testing/modelFixture.js";
import {
  loadPolyMorphCatalog,
  loadPolyMorphPackage,
  type PolyMorphLoadOptions,
} from "./index.js";

const BASE_URL = "https://assets.example.test/morph/";
const MANIFEST_PATH = "models/morph-gem/manifest.json";

interface LoadFixture {
  readonly builtPackage: PolyMorphBuiltPackage;
  readonly builtCatalog: PolyMorphBuiltCatalog;
  readonly files: Map<string, Uint8Array>;
}

async function createLoadFixture(): Promise<LoadFixture> {
  const builtPackage = await buildPolyMorphPackage(
    createPolyMorphModelFixture("morph-regions"),
    [
      {
        path: "assets/gem.bin",
        role: "data",
        mediaType: "application/octet-stream",
        bytes: new Uint8Array([2, 7, 1, 8]),
      },
    ],
  );
  const builtCatalog = await buildPolyMorphCatalog("morph-gem", [
    {
      manifest: builtPackage.manifest,
      manifestPath: MANIFEST_PATH,
      manifestSha256: builtPackage.manifestSha256,
    },
  ]);
  const files = new Map<string, Uint8Array>([
    [`${BASE_URL}catalog.json`, builtCatalog.bytes],
    [`${BASE_URL}${MANIFEST_PATH}`, builtPackage.manifestBytes],
  ]);
  for (const [path, bytes] of builtPackage.files) {
    files.set(`${BASE_URL}models/morph-gem/${path}`, bytes);
  }
  return { builtPackage, builtCatalog, files };
}

function fetchFrom(files: ReadonlyMap<string, Uint8Array>): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = input instanceof Request ? input.url : String(input);
    const bytes = files.get(url);
    if (!bytes) return new Response("missing", { status: 404 });
    return new Response(Uint8Array.from(bytes), {
      status: 200,
      headers: {
        "content-length": String(bytes.byteLength),
        "content-type": url.endsWith(".json") ? "application/json" : "application/octet-stream",
      },
    });
  }) as typeof fetch;
}

async function expectLoadCode(
  fixture: LoadFixture,
  code: string,
  options: PolyMorphLoadOptions = {},
): Promise<void> {
  try {
    await loadPolyMorphPackage(BASE_URL, {
      fetchImpl: fetchFrom(fixture.files),
      ...options,
    });
  } catch (error) {
    expect(error).toBeInstanceOf(PolyMorphPackageError);
    expect((error as PolyMorphPackageError).code).toBe(code);
    return;
  }
  throw new Error(`Expected ${code}.`);
}

async function expectPackageCode(
  action: Promise<unknown>,
  code: string,
): Promise<void> {
  try {
    await action;
  } catch (error) {
    expect(error).toBeInstanceOf(PolyMorphPackageError);
    expect((error as PolyMorphPackageError).code).toBe(code);
    return;
  }
  throw new Error(`Expected ${code}.`);
}

describe("browser package loading", () => {
  it("loads and binds catalog, manifest, model, and resource hashes", async () => {
    const fixture = await createLoadFixture();
    const loadedCatalog = await loadPolyMorphCatalog(BASE_URL, {
      fetchImpl: fetchFrom(fixture.files),
    });
    expect(loadedCatalog.sha256).toBe(fixture.builtCatalog.sha256);

    const loaded = await loadPolyMorphPackage(BASE_URL, {
      fetchImpl: fetchFrom(fixture.files),
    });
    expect(loaded.catalogSha256).toBe(fixture.builtCatalog.sha256);
    expect(loaded.manifestSha256).toBe(fixture.builtPackage.manifestSha256);
    expect(loaded.model.identity.id).toBe("morph-gem");
    expect([...loaded.resources]).toHaveLength(2);
    for (const [path, resource] of loaded.resources) {
      expect(path).toBe(resource.descriptor.path);
      expect(await hashPolyMorphBytes(resource.bytes)).toBe(resource.descriptor.sha256);
    }
  });

  it("fails closed on tampered and stale-hash resources", async () => {
    const fixture = await createLoadFixture();
    fixture.files.set(
      `${BASE_URL}models/morph-gem/assets/gem.bin`,
      new Uint8Array([2, 7, 1, 9]),
    );
    await expectLoadCode(fixture, "stale-hash");

    const staleManifest = await createLoadFixture();
    staleManifest.files.set(
      `${BASE_URL}${MANIFEST_PATH}`,
      encodePolyMorphCanonicalJson({
        ...staleManifest.builtPackage.manifest,
        profile: "static-prepared",
      }),
    );
    await expectLoadCode(staleManifest, "stale-hash");
  });

  it("fails closed on missing and unknown resources", async () => {
    const missing = await createLoadFixture();
    missing.files.delete(`${BASE_URL}models/morph-gem/assets/gem.bin`);
    await expectLoadCode(missing, "request-failed");

    const unknown = await createLoadFixture();
    await expectLoadCode(unknown, "unknown-package", { modelId: "unknown-gem" });
  });

  it("fails closed on catalog/manifest profile mismatches", async () => {
    const fixture = await createLoadFixture();
    const catalog = clonePolyMorphFixture(fixture.builtCatalog.catalog);
    catalog.packages[0]!.profile = "static-prepared";
    fixture.files.set(`${BASE_URL}catalog.json`, encodePolyMorphCanonicalJson(catalog));
    await expectLoadCode(fixture, "profile-mismatch");
  });

  it("bounds individual resources and total declared bytes", async () => {
    const individual = await createLoadFixture();
    await expectLoadCode(individual, "resource-too-large", { maxResourceBytes: 64 });

    const total = await createLoadFixture();
    await expectLoadCode(total, "package-too-large", {
      maxResourceBytes: 1_000_000,
      maxTotalBytes: total.builtPackage.manifest.resources[0]!.bytes,
    });
  });

  it.each([
    null,
    "",
    "https://assets.example.test\\morph",
    "https://assets.example.test/morph#fragment",
    "https://assets.example.test/morph?query=1",
    "file:///tmp/morph/",
    "http://[",
  ])("rejects unsafe base URLs: %s", async (baseUrl) => {
    await expectPackageCode(
      loadPolyMorphCatalog(baseUrl as string, { fetchImpl: fetchFrom(new Map()) }),
      "invalid-base-url",
    );
  });

  it("normalizes a missing trailing slash", async () => {
    const fixture = await createLoadFixture();
    const loaded = await loadPolyMorphCatalog(BASE_URL.slice(0, -1), {
      fetchImpl: fetchFrom(fixture.files),
    });
    expect(loaded.sha256).toBe(fixture.builtCatalog.sha256);
  });

  it("rejects invalid resource and package limits", async () => {
    const fixture = await createLoadFixture();
    await expectPackageCode(
      loadPolyMorphCatalog(BASE_URL, {
        fetchImpl: fetchFrom(fixture.files),
        maxResourceBytes: 0,
      }),
      "invalid-limit",
    );
    await expectPackageCode(
      loadPolyMorphPackage(BASE_URL, {
        fetchImpl: fetchFrom(fixture.files),
        maxTotalBytes: 1.5,
      }),
      "invalid-limit",
    );
  });

  it("normalizes transport failures and rejects dishonest content lengths", async () => {
    const throwingFetch = (async () => {
      throw new Error("offline");
    }) as typeof fetch;
    await expectPackageCode(
      loadPolyMorphCatalog(BASE_URL, { fetchImpl: throwingFetch }),
      "request-failed",
    );

    const statusFetch = (async () => new Response("unavailable", {
      status: 503,
    })) as typeof fetch;
    await expectPackageCode(
      loadPolyMorphCatalog(BASE_URL, { fetchImpl: statusFetch }),
      "request-failed",
    );

    const invalidLengthFetch = (async () => new Response("{}", {
      headers: { "content-length": "not-a-number" },
    })) as typeof fetch;
    await expectPackageCode(
      loadPolyMorphCatalog(BASE_URL, { fetchImpl: invalidLengthFetch }),
      "resource-too-large",
    );
  });

  it("enforces streamed and array-buffer byte limits", async () => {
    const fixture = await createLoadFixture();
    const streamedFetch = (async () => new Response(fixture.builtCatalog.bytes)) as typeof fetch;
    await expectPackageCode(
      loadPolyMorphCatalog(BASE_URL, {
        fetchImpl: streamedFetch,
        maxResourceBytes: fixture.builtCatalog.bytes.byteLength - 1,
      }),
      "resource-too-large",
    );

    const arrayBufferFetch = (async () => ({
      ok: true,
      status: 200,
      headers: new Headers(),
      body: null,
      arrayBuffer: async () => fixture.builtCatalog.bytes.buffer.slice(
        fixture.builtCatalog.bytes.byteOffset,
        fixture.builtCatalog.bytes.byteOffset + fixture.builtCatalog.bytes.byteLength,
      ),
    } as Response)) as typeof fetch;
    await expectPackageCode(
      loadPolyMorphCatalog(BASE_URL, {
        fetchImpl: arrayBufferFetch,
        maxResourceBytes: fixture.builtCatalog.bytes.byteLength - 1,
      }),
      "resource-too-large",
    );
    await expect(
      loadPolyMorphCatalog(BASE_URL, {
        fetchImpl: arrayBufferFetch,
        maxResourceBytes: fixture.builtCatalog.bytes.byteLength,
      }),
    ).resolves.toMatchObject({ sha256: fixture.builtCatalog.sha256 });
  });

  it("rejects resources whose delivered size differs from the manifest", async () => {
    const fixture = await createLoadFixture();
    fixture.files.set(
      `${BASE_URL}models/morph-gem/assets/gem.bin`,
      new Uint8Array([2, 7, 1]),
    );
    await expectLoadCode(fixture, "stale-size");
  });

  it("keeps the loader free of product paths and Node-only dependencies", () => {
    const source = readFileSync(resolve(process.cwd(), "src/load/load.ts"), "utf8");
    expect(source).not.toMatch(/node:|sharp|from\s+["'][^"']*prepare/);
    expect(source).not.toMatch(new RegExp(["css", "fa", "ce"].join(""), "i"));
  });
});
