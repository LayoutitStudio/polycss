import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import {
  dirname,
  join,
  relative,
  resolve,
} from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { generateCertificationFixture } from "./generate-certification-fixture.mjs";

const runFile = promisify(execFile);
const morphRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = resolve(morphRoot, "..", "..");
const registryDependencies = process.argv.includes("--registry-dependencies");
const reportFlag = process.argv.indexOf("--report");
const reportArgument = reportFlag === -1 ? null : process.argv[reportFlag + 1];
if (
  reportFlag !== -1
  && (reportArgument === undefined || reportArgument.startsWith("--"))
) {
  throw new Error("--report requires a path");
}
const reportPath = reportArgument
  ? resolve(process.cwd(), reportArgument)
  : null;

async function run(command, args, cwd, options = {}) {
  const result = await runFile(command, args, {
    cwd,
    env: { ...process.env, ...options.env },
    maxBuffer: 32 * 1024 * 1024,
  });
  return {
    stdout: result.stdout.trim(),
    stderr: result.stderr.trim(),
  };
}

async function packPackage(packageName, packageRoot, artifactRoot, ignoreScripts) {
  const before = new Set(await readdir(artifactRoot));
  await run(
    "pnpm",
    [
      `--config.ignore-scripts=${ignoreScripts ? "true" : "false"}`,
      "--dir",
      packageRoot,
      "pack",
      "--pack-destination",
      artifactRoot,
    ],
    repoRoot,
  );
  const created = (await readdir(artifactRoot))
    .filter((entry) => !before.has(entry) && entry.endsWith(".tgz"));
  if (created.length !== 1) {
    throw new Error(`${packageName} pack created ${created.length} tarballs`);
  }
  return resolve(artifactRoot, created[0]);
}

async function tarInventory(tarball) {
  const result = await run("tar", ["-tzf", tarball], repoRoot);
  return result.stdout.split("\n").filter(Boolean).sort();
}

async function extractTarball(tarball, target) {
  await mkdir(target, { recursive: true });
  await run("tar", ["-xzf", tarball, "-C", target], repoRoot);
}

function exactInventory(actual, expected) {
  if (
    actual.length !== expected.length
    || actual.some((entry, index) => entry !== expected[index])
  ) {
    throw new Error(
      `unexpected Morph tarball inventory:\n${actual.join("\n")}`,
    );
  }
}

function fileDependency(tarball, consumerRoot) {
  return `file:${relative(consumerRoot, tarball).replaceAll("\\", "/")}`;
}

function linkDependency(packageRoot, consumerRoot) {
  return `link:${relative(consumerRoot, packageRoot).replaceAll("\\", "/")}`;
}

async function writeConsumer(
  consumerRoot,
  artifactRoot,
  tarballs,
  polycssDependency,
) {
  const sourceRoot = resolve(consumerRoot, "source");
  const morphDependency = fileDependency(tarballs.morph, consumerRoot);
  const [canonicalConsumerRoot, happyDomRoot, typescriptRoot] = await Promise.all([
    realpath(consumerRoot),
    realpath(resolve(morphRoot, "node_modules/happy-dom")),
    realpath(resolve(morphRoot, "node_modules/typescript")),
  ]);
  const dependencies = {
    "@layoutit/polycss": registryDependencies
      ? polycssDependency
      : fileDependency(tarballs.polycss, consumerRoot),
    "@layoutit/polycss-morph": morphDependency,
    "happy-dom": linkDependency(happyDomRoot, canonicalConsumerRoot),
    "typescript": linkDependency(typescriptRoot, canonicalConsumerRoot),
  };
  const consumerPackage = {
    name: "polycss-morph-clean-consumer",
    private: true,
    version: "0.0.0",
    type: "module",
    dependencies,
    ...(registryDependencies
      ? {}
      : {
          pnpm: {
            overrides: {
              "@layoutit/polycss-core": fileDependency(tarballs.core, consumerRoot),
              "@layoutit/polycss": fileDependency(tarballs.polycss, consumerRoot),
            },
          },
        }),
  };
  await generateCertificationFixture(sourceRoot);
  await writeFile(
    resolve(consumerRoot, "package.json"),
    `${JSON.stringify(consumerPackage, null, 2)}\n`,
  );
  await writeFile(resolve(consumerRoot, "tsconfig.json"), `${JSON.stringify({
    compilerOptions: {
      target: "ES2020",
      module: "NodeNext",
      moduleResolution: "NodeNext",
      lib: ["ES2020", "DOM", "DOM.Iterable"],
      strict: true,
      skipLibCheck: false,
      noEmit: true,
    },
    include: ["declarations.ts"],
  }, null, 2)}\n`);
  await writeFile(resolve(consumerRoot, "declarations.ts"), `
import { createPolyOrthographicCamera } from "@layoutit/polycss";
import {
  createPolyMorphDeformationRuntime,
  mountPolyMorphModel,
  type PolyMorphModel,
} from "@layoutit/polycss-morph";
import {
  preparePolyMorphModel,
  type PolyMorphPrepareOptions,
} from "@layoutit/polycss-morph/prepare";

declare const host: HTMLElement;
declare const model: PolyMorphModel;

const camera = createPolyOrthographicCamera({ zoom: 1 });
const mounted = mountPolyMorphModel(host, model, { camera });
const runtime = createPolyMorphDeformationRuntime(model);
const options: PolyMorphPrepareOptions = {
  configPath: "./source/prepare.json",
  outputRoot: "./model/package",
};

void runtime.sample({ tick: 0 });
void mounted;
void preparePolyMorphModel(options);
`);
  await writeFile(resolve(consumerRoot, "prepare-smoke.mjs"), `
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  buildPolyMorphCatalog,
  preparePolyMorphModel,
} from "@layoutit/polycss-morph/prepare";

const outputRoot = resolve("model/package");
const report = await preparePolyMorphModel({
  configPath: resolve("source/prepare.json"),
  outputRoot,
});
const catalog = await buildPolyMorphCatalog(report.model.identity.id, [{
  manifest: report.manifest,
  manifestPath: "package/manifest.json",
  manifestSha256: report.manifestSha256,
}]);
await mkdir(resolve("model"), { recursive: true });
await writeFile(resolve("model/catalog.json"), catalog.bytes);
console.log(JSON.stringify({
  identity: report.model.identity,
  profile: report.model.profile,
  leaves: report.model.render.leaves.length,
  manifestSha256: report.manifestSha256,
  files: [...report.files, "catalog.json"].sort(),
  writeOrder: report.writeOrder,
}));
`);
  await writeFile(resolve(consumerRoot, "browser-smoke.mjs"), `
import { readFile } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { Window } from "happy-dom";

const browser = new Window({ url: "https://consumer.test/" });
for (const [key, value] of Object.entries({
  window: browser,
  document: browser.document,
  location: browser.location,
  navigator: browser.navigator,
  HTMLElement: browser.HTMLElement,
  Element: browser.Element,
  Node: browser.Node,
  CSSStyleSheet: browser.CSSStyleSheet,
  getComputedStyle: browser.getComputedStyle.bind(browser),
})) {
  Object.defineProperty(globalThis, key, {
    configurable: true,
    writable: true,
    value,
  });
}

const modelRoot = resolve("model");
const fetchImpl = async (input) => {
  const raw = typeof input === "string"
    ? input
    : input instanceof URL
      ? input.href
      : input.url;
  const url = new URL(raw);
  if (url.origin !== "https://consumer.test" || !url.pathname.startsWith("/model/")) {
    return new Response(null, { status: 404 });
  }
  const path = decodeURIComponent(url.pathname.slice("/model/".length));
  const absolute = resolve(modelRoot, path);
  if (absolute !== modelRoot && !absolute.startsWith(\`\${modelRoot}\${sep}\`)) {
    return new Response(null, { status: 404 });
  }
  try {
    const bytes = await readFile(absolute);
    return new Response(bytes, {
      status: 200,
      headers: { "content-length": String(bytes.byteLength) },
    });
  } catch {
    return new Response(null, { status: 404 });
  }
};

const {
  createPolyMorphDeformationRuntime,
  loadPolyMorphPackage,
  mountPolyMorphModel,
} = await import("@layoutit/polycss-morph");
const { createPolyOrthographicCamera } = await import("@layoutit/polycss");
const loaded = await loadPolyMorphPackage("https://consumer.test/model/", { fetchImpl });
Object.defineProperty(browser, "CSS", {
  configurable: true,
  value: { supports: () => true },
});
const host = document.createElement("main");
document.body.appendChild(host);
const mounted = mountPolyMorphModel(host, loaded.model, {
  camera: createPolyOrthographicCamera({ zoom: 1 }),
  resources: loaded.resources,
});
const identities = [...mounted.leafHandles.values()].map((entry) => entry.element);
const deformation = createPolyMorphDeformationRuntime(loaded.model);
if (loaded.model.deformation.kind !== "morph-regions") {
  throw new Error("packed fixture is not a morph-regions model");
}
const targetId = loaded.model.deformation.targets[0]?.id;
if (!targetId) {
  throw new Error("packed fixture contains no morph target");
}
const frame = deformation.sample({
  tick: 0,
  morphWeights: { [targetId]: 0.5 },
});
const applied = mounted.apply({ leaves: frame.leafUpdates });
mounted.assertStableDomIdentity();
const identityStable = [...mounted.leafHandles.values()]
  .every((entry, index) => entry.element === identities[index]);
const solidLeaves = loaded.model.render.leaves.every((leaf) =>
  leaf.strategy === "solid-triangle"
  && leaf.atlas === null
  && leaf.fallback
  && leaf.fallback.width === leaf.fallback.atlas.width
  && leaf.fallback.height === leaf.fallback.atlas.height);
const fallbackPaths = new Set(loaded.model.render.leaves.map(
  (leaf) => leaf.fallback?.atlas.resourcePath,
));
fallbackPaths.delete(undefined);
const fallbackSlices = new Set(loaded.model.render.leaves.map((leaf) =>
  leaf.fallback
    ? \`\${leaf.fallback.atlas.resourcePath}:\${leaf.fallback.atlas.x}:\${leaf.fallback.atlas.y}\`
    : ""));
fallbackSlices.delete("");
const polygonSizedFallbacks =
  fallbackSlices.size === loaded.model.render.leaves.length;
const canonicalDom = [...mounted.leafHandles.values()].every(({ element }) =>
  element.localName === "u"
  && element.style.width === ""
  && element.style.height === "");

Object.defineProperty(browser, "CSS", {
  configurable: true,
  value: { supports: () => false },
});
Object.defineProperty(browser.navigator, "userAgent", {
  configurable: true,
  value: "Mozilla/5.0 Version/18.0 Safari/605.1.15",
});
const fallbackHost = document.createElement("main");
document.body.appendChild(fallbackHost);
const fallbackMounted = mountPolyMorphModel(fallbackHost, loaded.model, {
  camera: createPolyOrthographicCamera({ zoom: 1 }),
  resources: loaded.resources,
});
const fallbackIdentities = [...fallbackMounted.leafHandles.values()]
  .map((entry) => entry.element);
const fallbackApplied = fallbackMounted.apply({ leaves: frame.leafUpdates });
fallbackMounted.assertStableDomIdentity();
const fallbackDom = [...fallbackMounted.leafHandles.values()]
  .every(({ element }, index) => {
    const fallback = loaded.model.render.leaves[index]?.fallback;
    return !!fallback
    && element === fallbackIdentities[index]
    && element.localName === "s"
    && element.dataset.polyMorphResolvedStrategy === "atlas-slice"
    && element.style.width === \`\${fallback.width}px\`
    && element.style.height === \`\${fallback.height}px\`
    && element.style.getPropertyValue("mask-image").includes("blob:")
    && element.style.getPropertyValue("-webkit-mask-image").includes("blob:");
  });

if (
  mounted.leafHandles.size !== loaded.model.render.leaves.length
  || frame.dirtyLeafIds.length === 0
  || !identityStable
  || !solidLeaves
  || !polygonSizedFallbacks
  || !canonicalDom
  || applied.atlasRedraws !== 0
  || applied.topologyConstructions !== 0
  || applied.schedulerCallbacks !== 0
  || !fallbackDom
  || fallbackApplied.atlasRedraws !== 0
  || fallbackApplied.topologyConstructions !== 0
  || fallbackApplied.schedulerCallbacks !== 0
) {
  throw new Error("packed browser entry violated the retained-model contract");
}

console.log(JSON.stringify({
  identity: loaded.model.identity,
  profile: loaded.model.profile,
  resources: [...loaded.resources.keys()].sort(),
  leaves: mounted.leafHandles.size,
  targetId,
  dirtyLeafIds: frame.dirtyLeafIds,
  identityStable,
  solidLeaves,
  polygonSizedFallbacks,
  canonicalDom,
  applied,
  stats: mounted.stats,
  fallback: {
    identityStable: fallbackDom,
    pages: fallbackPaths.size,
    slices: fallbackSlices.size,
    verifiedImageResources: fallbackPaths.size,
    applied: fallbackApplied,
    stats: fallbackMounted.stats,
  },
}));
mounted.destroy();
fallbackMounted.destroy();
await browser.happyDOM.abort();
`);
  return artifactRoot;
}

function parseJsonOutput(result, label) {
  const line = result.stdout.split("\n").filter(Boolean).at(-1);
  if (!line) throw new Error(`${label} produced no output`);
  return JSON.parse(line);
}

const tempRoot = await mkdtemp(join(tmpdir(), "polycss-morph-cert-"));
const artifactRoot = resolve(tempRoot, "artifacts");
const consumerRoot = resolve(tempRoot, "consumer");
const extractedRoot = resolve(tempRoot, "extracted");

try {
  await Promise.all([
    mkdir(artifactRoot, { recursive: true }),
    mkdir(consumerRoot, { recursive: true }),
  ]);
  const pnpmVersion = (await run("pnpm", ["--version"], repoRoot)).stdout;
  await run("pnpm", ["--filter", "@layoutit/polycss-core", "build"], repoRoot);
  await run("pnpm", ["--filter", "@layoutit/polycss", "build"], repoRoot);
  await run("pnpm", ["--filter", "@layoutit/polycss-morph", "build"], repoRoot);
  const coreTarball = registryDependencies
    ? null
    : await packPackage(
        "core",
        resolve(repoRoot, "packages/core"),
        artifactRoot,
        true,
      );
  const polycssTarball = registryDependencies
    ? null
    : await packPackage(
        "polycss",
        resolve(repoRoot, "packages/polycss"),
        artifactRoot,
        true,
      );
  const morphTarball = await packPackage("morph", morphRoot, artifactRoot, false);
  const inventory = await tarInventory(morphTarball);
  const distFiles = (await readdir(resolve(morphRoot, "dist")))
    .sort()
    .map((entry) => `package/dist/${entry}`);
  exactInventory(inventory, [
    "package/LICENSE",
    "package/README.md",
    ...distFiles,
    "package/package.json",
  ].sort());
  await extractTarball(morphTarball, extractedRoot);
  const packedPackage = JSON.parse(
    await readFile(resolve(extractedRoot, "package/package.json"), "utf8"),
  );
  const polycssPackage = JSON.parse(
    await readFile(resolve(repoRoot, "packages/polycss/package.json"), "utf8"),
  );
  if (
    packedPackage.name !== "@layoutit/polycss-morph"
    || packedPackage.dependencies?.["@layoutit/polycss"] !== `^${polycssPackage.version}`
    || Object.hasOwn(packedPackage.dependencies ?? {}, "sharp")
    || JSON.stringify(Object.keys(packedPackage.exports).sort()) !== JSON.stringify([".", "./prepare"])
    || packedPackage.typesVersions?.["*"]?.prepare?.[0] !== "dist/prepare.d.ts"
    || JSON.stringify(packedPackage.files) !== JSON.stringify(["dist"])
    || JSON.stringify(packedPackage).includes("workspace:")
  ) {
    throw new Error("packed Morph package metadata is not distributable");
  }
  const runtimeOutputNames = (await readdir(resolve(extractedRoot, "package/dist")))
    .filter((entry) => entry.endsWith(".js") || entry.endsWith(".cjs"))
    .sort();
  if (
    JSON.stringify(runtimeOutputNames)
    !== JSON.stringify(["index.cjs", "index.js", "prepare.cjs", "prepare.js"])
  ) {
    throw new Error(`unexpected runtime chunks: ${runtimeOutputNames.join(", ")}`);
  }
  const browserOutputs = await Promise.all([
    readFile(resolve(extractedRoot, "package/dist/index.js"), "utf8"),
    readFile(resolve(extractedRoot, "package/dist/index.cjs"), "utf8"),
  ]);
  const browserForbidden = browserOutputs.flatMap((source, index) =>
    ["node:", "sharp", "preparePolyMorphModel"]
      .filter((token) => source.includes(token))
      .map((token) => ({ output: index === 0 ? "index.js" : "index.cjs", token })));
  if (browserForbidden.length > 0) {
    throw new Error(`browser entry contains Node preparation edges: ${JSON.stringify(browserForbidden)}`);
  }
  await writeConsumer(consumerRoot, artifactRoot, {
    core: coreTarball,
    polycss: polycssTarball,
    morph: morphTarball,
  }, packedPackage.dependencies["@layoutit/polycss"]);
  await run(
    "pnpm",
    [
      "install",
      ...(registryDependencies ? [] : ["--offline"]),
      "--frozen-lockfile=false",
    ],
    consumerRoot,
  );
  const installedPolycss = JSON.parse(
    await readFile(
      resolve(consumerRoot, "node_modules/@layoutit/polycss/package.json"),
      "utf8",
    ),
  );
  const declarationResult = await run(
    "pnpm",
    ["exec", "tsc", "-p", "tsconfig.json"],
    consumerRoot,
  );
  const prepareResult = parseJsonOutput(
    await run("node", ["prepare-smoke.mjs"], consumerRoot),
    "prepare smoke",
  );
  const browserResult = parseJsonOutput(
    await run("node", ["browser-smoke.mjs"], consumerRoot),
    "browser smoke",
  );
  const morphBytes = await readFile(morphTarball);
  const morphStat = await stat(morphTarball);
  const report = {
    schema: "polycss-morph.package-certification@1",
    completedAt: new Date().toISOString(),
    nodeVersion: process.version,
    pnpmVersion,
    package: {
      name: packedPackage.name,
      version: packedPackage.version,
      tarball: morphTarball.split("/").at(-1),
      bytes: morphStat.size,
      sha256: createHash("sha256").update(morphBytes).digest("hex"),
      inventory,
      exports: packedPackage.exports,
      dependencies: packedPackage.dependencies,
      browserForbidden,
    },
    consumer: {
      installMode: registryDependencies
        ? "registry-dependencies"
        : "offline-tarballs",
      offlineInstall: !registryDependencies,
      polycssVersion: installedPolycss.version,
      declarations: declarationResult.stderr === "",
      prepare: prepareResult,
      browser: browserResult,
    },
  };
  if (reportPath) {
    await mkdir(dirname(reportPath), { recursive: true });
    await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  }
  console.log(JSON.stringify(report, null, 2));
} finally {
  if (process.env.POLYCSS_MORPH_KEEP_CERT_TEMP !== "1") {
    await rm(tempRoot, { recursive: true, force: true });
  } else {
    console.error(`kept certification temp at ${tempRoot}`);
  }
}
