import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildPolyMorphCatalog,
  preparePolyMorphModel,
} from "@layoutit/polycss-morph/prepare";
import { generatePlaneFixture } from "./generate-plane.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packageRoot = resolve(root, "public/model/package");
const generated = await generatePlaneFixture();
const report = await preparePolyMorphModel({
  configPath: generated.configPath,
  outputRoot: packageRoot,
});
const catalog = await buildPolyMorphCatalog(report.model.identity.id, [{
  manifest: report.manifest,
  manifestPath: "package/manifest.json",
  manifestSha256: report.manifestSha256,
}]);
await mkdir(resolve(root, "public/model"), { recursive: true });
await writeFile(resolve(root, "public/model/catalog.json"), catalog.bytes);
console.log(JSON.stringify({
  model: report.model.identity.id,
  profile: report.model.profile,
  leaves: report.model.render.leaves.length,
  manifest: report.manifestSha256,
  files: [...report.files, "catalog.json"],
}));
