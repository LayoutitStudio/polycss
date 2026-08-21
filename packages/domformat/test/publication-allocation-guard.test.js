import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { auditSequentialPagedPublicationSources } from "../scripts/publication-allocation-guard.js";

const pagedPath = new URL("../src/state/paged-state.ts", import.meta.url);
const polycssPath = new URL("../src/state/polycss.ts", import.meta.url);
const statePagesPath = new URL("../src/state-pages.ts", import.meta.url);
const publicationReportPath = new URL("../scripts/check-publication-performance.js", import.meta.url);
const [pagedSource, polycssSource, statePagesSource, publicationReportSource] = await Promise.all([
  readFile(pagedPath, "utf8"),
  readFile(polycssPath, "utf8"),
  readFile(statePagesPath, "utf8"),
  readFile(publicationReportPath, "utf8"),
]);

function audit(overrides = {}) {
  return auditSequentialPagedPublicationSources({ pagedSource, polycssSource, statePagesSource, ...overrides });
}

function injectIntoFunction(source, name, statement) {
  const declaration = `function ${name}(`;
  const marker = source.includes(declaration) ? declaration : `const ${name} = (`;
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `missing ${name}`);
  const body = source.indexOf("{", start);
  assert.notEqual(body, -1, `missing ${name} body`);
  return `${source.slice(0, body + 1)}\n  ${statement}\n${source.slice(body + 1)}`;
}

function injectIntoBranch(source, functionName, branchMarker, statement) {
  const functionStart = source.indexOf(`const ${functionName} = (`);
  assert.notEqual(functionStart, -1, `missing ${functionName}`);
  const branch = source.indexOf(branchMarker, functionStart);
  assert.notEqual(branch, -1, `missing ${functionName} ${branchMarker}`);
  const body = source.indexOf("{", branch);
  assert.notEqual(body, -1, `missing ${functionName} branch body`);
  return `${source.slice(0, body + 1)}\n      ${statement}\n${source.slice(body + 1)}`;
}

test("sequential paged publication guard accepts the range-backed implementation", () => {
  const result = audit();
  assert.equal(result.pass, true);
  assert.equal(result.measuredHeapAllocations, false);
  assert.equal(result.pagedDispatchBeforeInlineMaterialization, true);
  assert.equal(result.pageBoundaryValidationCalled, true);
  assert.deepEqual(result.missingScopes, []);
  assert.deepEqual(result.violations, []);
});

for (const [operation, statement] of [
  ["slice-copy", "void page.shapeTargets.slice(shapeStart, shapeEnd);"],
  ["array-from-copy", "void Array.from(page.shapeTargets.subarray(shapeStart, shapeEnd));"],
  ["array-constructor", "void new Uint32Array(shapeEnd - shapeStart);"],
  ["spread-array-clone", "void [...page.shapeTargets.subarray(shapeStart, shapeEnd)];"],
]) {
  test(`sequential paged publication guard rejects ${operation}`, () => {
    const mutated = injectIntoFunction(pagedSource, "playbackSparseStage", statement);
    const result = audit({ pagedSource: mutated });
    assert.equal(result.pass, false);
    assert.ok(result.violations.some((entry) => entry.scope === "playbackSparseStage" && entry.operation === operation));
  });
}

test("sequential paged publication guard requires paged dispatch before inline materialization", () => {
  const mutated = injectIntoFunction(polycssSource, "stageFrame", "void frame;");
  const result = audit({ polycssSource: mutated });
  assert.equal(result.pass, false);
  assert.equal(result.pagedDispatchBeforeInlineMaterialization, false);
});

for (const [collection, statement] of [
  ["Set", "void new Set([stage.frame]);"],
  ["Map", "void new Map([[stage.frame, stage]]);"],
]) {
  test(`sequential paged publication guard rejects ${collection} construction while installing an active stage`, () => {
    const mutated = injectIntoFunction(pagedSource, "installActiveStage", statement);
    const result = audit({ pagedSource: mutated });
    assert.equal(result.pass, false);
    assert.ok(result.violations.some((entry) => entry.scope === "installActiveStage" && entry.operation === "set-map-constructor"));
  });
}

test("sequential paged publication guard rejects target arrays in the applyStage range branch", () => {
  const mutated = injectIntoBranch(polycssSource, "applyStage", 'if (next.kind === "range")', "void new Uint32Array(next.shapeEnd - next.shapeStart);");
  const result = audit({ polycssSource: mutated });
  assert.equal(result.pass, false);
  assert.ok(result.violations.some((entry) => entry.scope === "applyStage:range" && entry.operation === "array-constructor"));
});

test("sequential paged publication guard rejects sorting in forced surface range publication", () => {
  const mutated = injectIntoFunction(polycssSource, "publishSurfaceRangeWithForced", "void [start, end].sort();");
  const result = audit({ polycssSource: mutated });
  assert.equal(result.pass, false);
  assert.ok(result.violations.some((entry) => entry.scope === "publishSurfaceRangeWithForced" && entry.operation === "sort-call"));
});

test("sequential paged publication guard rejects Map construction in adjacent surface publication", () => {
  const mutated = injectIntoBranch(polycssSource, "applySurface", "if (sequential)", "void new Map();");
  const result = audit({ polycssSource: mutated });
  assert.equal(result.pass, false);
  assert.ok(result.violations.some((entry) => entry.scope === "applySurface" && entry.operation === "set-map-constructor"));
});

test("sequential paged publication guard rejects Set construction in adjacent profile visibility staging", () => {
  const mutated = injectIntoBranch(polycssSource, "stageProfileVisibility", "if (offsets && targets && frame ===", "void new Set();");
  const result = audit({ polycssSource: mutated });
  assert.equal(result.pass, false);
  assert.ok(result.violations.some((entry) => entry.scope === "stageProfileVisibility" && entry.operation === "set-map-constructor"));
});

test("sequential paged publication guard rejects generic arrays in adjacent profile visibility staging", () => {
  const mutated = injectIntoBranch(polycssSource, "stageProfileVisibility", "if (offsets && targets && frame ===", "void [frame];");
  const result = audit({ polycssSource: mutated });
  assert.equal(result.pass, false);
  assert.ok(result.violations.some((entry) => entry.scope === "stageProfileVisibility" && entry.operation === "array-literal"));
});

test("sequential paged publication guard rejects local closures in surface application", () => {
  const mutated = injectIntoFunction(polycssSource, "applySurface", "void (() => frame);");
  const result = audit({ polycssSource: mutated });
  assert.equal(result.pass, false);
  assert.ok(result.violations.some((entry) => entry.scope === "applySurface" && entry.operation === "nested-closure"));
});

test("sequential paged publication guard rejects sorting in surface application", () => {
  const mutated = injectIntoFunction(polycssSource, "applySurface", "void [frame].sort();");
  const result = audit({ polycssSource: mutated });
  assert.equal(result.pass, false);
  assert.ok(result.violations.some((entry) => entry.scope === "applySurface" && entry.operation === "sort-call"));
});

test("sequential paged publication guard directly audits page-boundary validation", () => {
  const mutated = injectIntoFunction(statePagesSource, "validatePagedPlaybackBoundaryFromCanonical", "void Array.from(target.leafTargets);");
  const result = audit({ statePagesSource: mutated });
  assert.equal(result.pass, false);
  assert.ok(result.violations.some((entry) => entry.scope === "validatePagedPlaybackBoundaryFromCanonical" && entry.operation === "array-from-copy"));
  assert.match(result.limitation, /does not traverse the call graph/u);
});

test("publication report keeps timing and visit windows distinct and identity-bound", () => {
  assert.match(publicationReportSource, /traceEndFrame: entry\.endFrame/u);
  assert.match(publicationReportSource, /const visitStartFrame = diagnostic\?\.startFrame \?\? 1/u);
  assert.match(publicationReportSource, /const visitEndFrame = diagnostic\?\.endFrame \?\? entry\.endFrame/u);
  assert.match(publicationReportSource, /visitPageBoundariesCrossed: pageBoundariesCrossed\(visitStartFrame, visitEndFrame\)/u);
  assert.match(publicationReportSource, /startFrame: win\.domformatProof\.sourceFrame/u);
  assert.match(publicationReportSource, /minimumAdvances: framesPerPage \* 2/u);
  assert.match(publicationReportSource, /Raw visit totals from different endpoints must not be compared without normalization/u);
  assert.match(publicationReportSource, /runtimeGitRevision/u);
  assert.match(publicationReportSource, /runtimeGitDirty/u);
  assert.match(publicationReportSource, /createHash\("sha256"\)/u);
  assert.match(publicationReportSource, /playbackBoundaryShapeVisits: boundaries \* 3/u);
  assert.match(publicationReportSource, /playbackBoundaryLeafVisits: boundaries \* \(workload\.leafCount \* 2 \+ \(workload\.denseTransformCount \+ workload\.sparseTransformCount\) \* 3\)/u);
  assert.match(publicationReportSource, /DOMFORMAT_CSSGRAPHICS_ROOT/u);
  assert.match(publicationReportSource, /verifiedByTraceRun/u);
  assert.match(publicationReportSource, /8da516167305a1a653523ef3cad4e5c5ee11ac3b/u);
});
