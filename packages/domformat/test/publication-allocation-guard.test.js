import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { auditSequentialPagedPublicationSources } from "../scripts/publication-allocation-guard.js";
import { assertSingleCycleTraceDuration, publicationFrameAdvances, publicationPageBoundariesCrossed } from "../scripts/publication-trace-window.js";

const pagedPath = new URL("../src/state/paged-state.ts", import.meta.url);
const polycssPath = new URL("../src/state/polycss.ts", import.meta.url);
const statePagesPath = new URL("../src/state-pages.ts", import.meta.url);
const publicationReportPath = new URL("../scripts/check-publication-performance.js", import.meta.url);
const browserPath = new URL("../src/browser.ts", import.meta.url);
const viewerPath = new URL("../viewer/viewer.js", import.meta.url);
const diagnosticViewerPath = new URL("../scripts/publication-diagnostics-viewer.js", import.meta.url);
const packagePath = new URL("../package.json", import.meta.url);
const [pagedSource, polycssSource, statePagesSource, publicationReportSource, browserSource, viewerSource, diagnosticViewerSource, packageSource] = await Promise.all([
  readFile(pagedPath, "utf8"),
  readFile(polycssPath, "utf8"),
  readFile(statePagesPath, "utf8"),
  readFile(publicationReportPath, "utf8"),
  readFile(browserPath, "utf8"),
  readFile(viewerPath, "utf8"),
  readFile(diagnosticViewerPath, "utf8"),
  readFile(packagePath, "utf8"),
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

for (const [scope, sourceName] of [
  ["publishVariantTarget", "pagedSource"],
  ["publishStageShapeVisibility", "polycssSource"],
  ["publishSurfaceTarget", "polycssSource"],
]) {
  test(`sequential paged publication guard rejects Set construction in ${scope}`, () => {
    const source = sourceName === "pagedSource" ? pagedSource : polycssSource;
    const mutated = injectIntoFunction(source, scope, "void new Set();");
    const result = audit({ [sourceName]: mutated });
    assert.equal(result.pass, false);
    assert.ok(result.violations.some((entry) => entry.scope === scope && entry.operation === "set-map-constructor"));
  });
}

test("sequential paged publication guard fails closed when an adjacent helper is renamed", () => {
  const mutated = polycssSource.replace("const publishStageShapeVisibility = (", "const renamedStageShapeVisibility = (");
  const result = audit({ polycssSource: mutated });
  assert.equal(result.pass, false);
  assert.ok(result.missingScopes.includes("publishStageShapeVisibility"));
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
  assert.match(publicationReportSource, /traceStartFrame: entry\.startFrame/u);
  assert.match(publicationReportSource, /traceEndFrame: entry\.endFrame/u);
  assert.match(publicationReportSource, /const visitStartFrame = diagnostic\?\.startFrame \?\? entry\.startFrame/u);
  assert.match(publicationReportSource, /const visitEndFrame = diagnostic\?\.endFrame \?\? entry\.endFrame/u);
  assert.match(publicationReportSource, /tracePageBoundariesCrossed: pageBoundariesCrossed\(entry\.startFrame, entry\.endFrame\)/u);
  assert.match(publicationReportSource, /visitPageBoundariesCrossed: pageBoundariesCrossed\(visitStartFrame, visitEndFrame\)/u);
  assert.match(publicationReportSource, /startFrame: frame\.contentWindow\.domformatProof\.sourceFrame/u);
  assert.match(publicationReportSource, /startFrame: win\.domformatDiagnosticProof\.sourceFrame/u);
  assert.match(publicationReportSource, /minimumAdvances: framesPerPage \* 2/u);
  assert.match(publicationReportSource, /Raw visit totals from different endpoints must not be compared without normalization/u);
  assert.match(publicationReportSource, /runtimeGitRevision/u);
  assert.match(publicationReportSource, /runtimeGitDirty/u);
  assert.match(publicationReportSource, /createHash\("sha256"\)/u);
  assert.match(publicationReportSource, /playbackBoundaryShapeVisits: boundaries \* 3/u);
  assert.match(publicationReportSource, /playbackBoundaryLeafVisits: boundaries \* \(workload\.leafCount \* 2 \+ \(workload\.denseTransformCount \+ workload\.sparseTransformCount\) \* 3\)/u);
  assert.match(publicationReportSource, /DOMFORMAT_CSSGRAPHICS_ROOT/u);
  assert.match(publicationReportSource, /manifestVerified/u);
  assert.doesNotMatch(publicationReportSource, /verifiedByTraceRun/u);
  assert.match(publicationReportSource, /8da516167305a1a653523ef3cad4e5c5ee11ac3b/u);
});

test("publication trace windows count one cyclic wrap and reject ambiguous multi-cycle durations", () => {
  assert.equal(publicationFrameAdvances(1, 1_261, 1_440), 1_260);
  assert.equal(publicationPageBoundariesCrossed(1, 1_261, 1_440, 60), 21);
  assert.equal(publicationFrameAdvances(1_400, 100, 1_440), 140);
  assert.equal(publicationPageBoundariesCrossed(1_400, 100, 1_440, 60), 2);
  assert.doesNotThrow(() => assertSingleCycleTraceDuration(42_000, 1_440, 30));
  assert.doesNotThrow(() => assertSingleCycleTraceDuration(45_000, 1_440, 30));
  assert.throws(() => assertSingleCycleTraceDuration(45_001, 1_440, 30), (error) => error?.code === "PUBLICATION_TRACE_DURATION");
});

test("publication diagnostics stay outside production mount and shipped viewer surfaces", () => {
  assert.doesNotMatch(browserSource, /PolycssPublicationDiagnostics|readonly diagnostics\?|\bdiagnostics,/u);
  assert.doesNotMatch(viewerSource, /diagnostics|internal-conformance/u);
  assert.match(diagnosticViewerSource, /createPolycssPublicationDiagnostics/u);
  assert.match(diagnosticViewerSource, /mountConformanceDom/u);
  assert.match(diagnosticViewerSource, /domformatDiagnosticProof/u);
  assert.doesNotMatch(JSON.stringify(JSON.parse(packageSource).exports), /internal-conformance/u);
});

test("publication trace binds lossless capture, raw preservation, and the page-preparation policy", () => {
  assert.match(publicationReportSource, /requestAnimationFrame\(\(\) => requestAnimationFrame/u);
  assert.match(publicationReportSource, /performance\.mark\("domformat-publication:flush"\)/u);
  assert.match(publicationReportSource, /cdp\.send\("Tracing\.start", PUBLICATION_TRACE_START_CONFIG\)/u);
  assert.match(publicationReportSource, /catch \(error\) \{[\s\S]*traceCompletion = await stopTrace\(cdp\)[\s\S]*writeRawTrace\(rawTrace, events, traceCompletion\)/u);
  assert.match(publicationReportSource, /writeRawTrace\(rawTrace, events, traceCompletion\);[\s\S]*assertPublicationTraceComplete\(traceCompletion\)[\s\S]*summarizeTrace/u);
  assert.match(publicationReportSource, /assertPublicationTraceComplete\(traceCompletion\)/u);
  assert.match(publicationReportSource, /assertPublicationPagePreparationGate\(trace\)/u);
  assert.match(publicationReportSource, /pagePreparationTaskMaxMs: PUBLICATION_PAGE_PREPARATION_MAX_TASK_MS/u);
  assert.match(publicationReportSource, /General RunTask, cadence, and relative-speed observations have no hard gate/u);
  assert.match(publicationReportSource, /attribution: PUBLICATION_PAGE_PREPARATION_ATTRIBUTION/u);
  assert.match(publicationReportSource, /idleCallbackCount: idle\.length/u);
});
