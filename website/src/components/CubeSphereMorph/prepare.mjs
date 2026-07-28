import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { preparePolyMorphModel } from "@layoutit/polycss-morph/prepare";

const root = dirname(fileURLToPath(import.meta.url));
const report = await preparePolyMorphModel({
  configPath: resolve(root, "source/prepare.json"),
  outputRoot: resolve(root, "assets/package"),
  check: process.argv.includes("--check"),
});

console.log(JSON.stringify({
  model: report.model.identity.id,
  vertices: report.model.topology.vertices.length,
  triangles: report.model.topology.polygons.length,
  leaves: report.model.render.leaves.length,
  manifest: report.manifestSha256,
  checked: report.checked,
}));
