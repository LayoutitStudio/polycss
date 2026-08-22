import ts from "typescript";

const FORBIDDEN_SCOPE_NAMES = Object.freeze([
  "playbackSparseStage",
  "stagePlayback:sequential",
  "stageVariants:sequential",
  "applyPlaybackStage:range",
  "applyVariantStage:range",
  "publishVariantTarget",
  "installActiveStage",
  "applyStage:range",
  "publishStageShapeVisibility",
  "publishSurfaceTarget",
  "publishSurfaceRangeWithForced",
  "applySurface",
  "stageProfileVisibility",
  "recoverSurface",
  "recoverPendingTransforms",
  "publishProfileVisibility",
  "publishRecoveredShapeVisibility",
]);

function optionalNamedFunction(sourceFile, name) {
  let match;
  const visit = (node) => {
    if (match) return;
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) match = node;
    else if (ts.isVariableDeclaration(node)
      && ts.isIdentifier(node.name)
      && node.name.text === name
      && node.initializer
      && (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))) match = node.initializer;
    if (!match) ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return match;
}

function namedFunction(sourceFile, name) {
  const match = optionalNamedFunction(sourceFile, name);
  if (!match) throw new Error(`Publication allocation guard could not find ${name}.`);
  return match;
}

function optionalBranchWithCondition(sourceFile, functionNode, pattern) {
  let branch;
  const visit = (node) => {
    if (branch) return;
    if (ts.isIfStatement(node) && pattern.test(node.expression.getText(sourceFile))) branch = node.thenStatement;
    if (!branch) ts.forEachChild(node, visit);
  };
  visit(functionNode.body);
  return branch;
}

function branchWithCondition(sourceFile, functionNode, pattern, label) {
  const branch = optionalBranchWithCondition(sourceFile, functionNode, pattern);
  if (!branch) throw new Error(`Publication allocation guard could not find ${label}.`);
  return branch;
}

function forbiddenOperation(sourceFile, node) {
  if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
    const owner = node.expression.expression.getText(sourceFile);
    const method = node.expression.name.text;
    if (method === "slice") return "slice-copy";
    if (method === "from" && /(?:^|\.)(?:Array|(?:Uint|Int|Float|BigInt|BigUint)\d*Array)$/u.test(owner)) return "array-from-copy";
    if (method === "sort" || method === "toSorted") return "sort-call";
  }
  if (ts.isNewExpression(node)) {
    const constructor = node.expression.getText(sourceFile);
    if (/(?:^|\.)(?:Array|(?:Uint|Int|Float|BigInt|BigUint)\d*Array)$/u.test(constructor)) return "array-constructor";
    if (/(?:^|\.)(?:Set|Map)$/u.test(constructor)) return "set-map-constructor";
  }
  if (ts.isArrayLiteralExpression(node)) return node.elements.some(ts.isSpreadElement) ? "spread-array-clone" : "array-literal";
  if (ts.isArrowFunction(node) || ts.isFunctionExpression(node) || ts.isFunctionDeclaration(node)) return "nested-closure";
  return null;
}

function within(node, ancestor) {
  for (let current = node; current; current = current.parent) if (current === ancestor) return true;
  return false;
}

function auditNode(sourceFile, node, scope, excluded = []) {
  const violations = [];
  const visit = (candidate) => {
    if (excluded.some((branch) => within(candidate, branch))) return;
    const operation = forbiddenOperation(sourceFile, candidate);
    if (operation) {
      const position = sourceFile.getLineAndCharacterOfPosition(candidate.getStart(sourceFile));
      violations.push(Object.freeze({
        scope,
        operation,
        line: position.line + 1,
        column: position.character + 1,
        expression: candidate.getText(sourceFile).replace(/\s+/gu, " ").slice(0, 160),
      }));
    }
    ts.forEachChild(candidate, visit);
  };
  visit(node);
  return violations;
}

function completeBranches(sourceFile, functionNode) {
  const branches = [];
  const visit = (node) => {
    if (ts.isIfStatement(node) && /stage\.(?:kind\s*===\s*["']complete["']|complete)/u.test(node.expression.getText(sourceFile))) branches.push(node.thenStatement);
    ts.forEachChild(node, visit);
  };
  visit(functionNode.body);
  return branches;
}

function pagedDispatchGuard(sourceFile) {
  const stageFrame = namedFunction(sourceFile, "stageFrame");
  const first = ts.isBlock(stageFrame.body) ? stageFrame.body.statements[0] : undefined;
  const text = first?.getText(sourceFile).replace(/\s+/gu, " ") ?? "";
  return Boolean(first
    && ts.isIfStatement(first)
    && /packet\.kind\s*===\s*["']paged["']/u.test(first.expression.getText(sourceFile))
    && /return\s+options\.pagedState!?\.stage\(frame,\s*true\)/u.test(text));
}

export function auditSequentialPagedPublicationSources({ pagedSource, polycssSource, statePagesSource, pagedFile = "src/state/paged-state.ts", polycssFile = "src/state/polycss.ts", statePagesFile = "src/state-pages.ts" }) {
  const paged = ts.createSourceFile(pagedFile, pagedSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const polycss = ts.createSourceFile(polycssFile, polycssSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const statePages = ts.createSourceFile(statePagesFile, statePagesSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const playbackSparseStage = namedFunction(paged, "playbackSparseStage");
  const stagePlayback = namedFunction(paged, "stagePlayback");
  const stageVariants = namedFunction(paged, "stageVariants");
  const applyPlaybackStage = namedFunction(paged, "applyPlaybackStage");
  const applyVariantStage = namedFunction(paged, "applyVariantStage");
  const publishVariantTarget = optionalNamedFunction(paged, "publishVariantTarget");
  const installActiveStage = optionalNamedFunction(paged, "installActiveStage");
  const applyStage = namedFunction(polycss, "applyStage");
  const publishStageShapeVisibility = optionalNamedFunction(polycss, "publishStageShapeVisibility");
  const publishSurfaceTarget = optionalNamedFunction(polycss, "publishSurfaceTarget");
  const publishSurfaceRangeWithForced = optionalNamedFunction(polycss, "publishSurfaceRangeWithForced");
  const applySurface = namedFunction(polycss, "applySurface");
  const stageProfileVisibility = namedFunction(polycss, "stageProfileVisibility");
  const recoverSurface = optionalNamedFunction(polycss, "recoverSurface");
  const recoverPendingTransforms = optionalNamedFunction(polycss, "recoverPendingTransforms");
  const publishProfileVisibility = optionalNamedFunction(polycss, "publishProfileVisibility");
  const publishRecoveredShapeVisibility = optionalNamedFunction(polycss, "publishRecoveredShapeVisibility");
  const validatePagedPlaybackBoundaryFromCanonical = namedFunction(statePages, "validatePagedPlaybackBoundaryFromCanonical");
  const stagePlaybackSequential = branchWithCondition(paged, stagePlayback, /frame\s*===\s*expected|frame\s*===\s*\(.*expected/u, "stagePlayback sequential branch");
  const stageVariantsSequential = branchWithCondition(paged, stageVariants, /frame\s*===\s*expected/u, "stageVariants sequential branch");
  const pageBoundaryValidationCalled = /validatePagedPlaybackBoundaryFromCanonical\s*\(/u.test(stagePlaybackSequential.getText(paged));
  const applyStageRange = optionalBranchWithCondition(polycss, applyStage, /next\.kind\s*===\s*["']range["']/u);
  const missingScopes = [
    ...(publishVariantTarget ? [] : ["publishVariantTarget"]),
    ...(installActiveStage ? [] : ["installActiveStage"]),
    ...(applyStageRange ? [] : ["applyStage:range"]),
    ...(publishStageShapeVisibility ? [] : ["publishStageShapeVisibility"]),
    ...(publishSurfaceTarget ? [] : ["publishSurfaceTarget"]),
    ...(publishSurfaceRangeWithForced ? [] : ["publishSurfaceRangeWithForced"]),
    ...(recoverSurface ? [] : ["recoverSurface"]),
    ...(recoverPendingTransforms ? [] : ["recoverPendingTransforms"]),
    ...(publishProfileVisibility ? [] : ["publishProfileVisibility"]),
    ...(publishRecoveredShapeVisibility ? [] : ["publishRecoveredShapeVisibility"]),
    ...(pageBoundaryValidationCalled ? [] : ["validatePagedPlaybackBoundaryFromCanonical:call-site"]),
  ];
  const violations = [
    ...auditNode(paged, playbackSparseStage.body, "playbackSparseStage"),
    ...auditNode(paged, stagePlaybackSequential, "stagePlayback:sequential"),
    ...auditNode(paged, stageVariantsSequential, "stageVariants:sequential"),
    ...auditNode(paged, applyPlaybackStage.body, "applyPlaybackStage:range", completeBranches(paged, applyPlaybackStage)),
    ...auditNode(paged, applyVariantStage.body, "applyVariantStage:range", completeBranches(paged, applyVariantStage)),
    ...(publishVariantTarget ? auditNode(paged, publishVariantTarget.body, "publishVariantTarget") : []),
    ...(installActiveStage ? auditNode(paged, installActiveStage.body, "installActiveStage") : []),
    ...(applyStageRange ? auditNode(polycss, applyStageRange, "applyStage:range") : []),
    ...(publishStageShapeVisibility ? auditNode(polycss, publishStageShapeVisibility.body, "publishStageShapeVisibility") : []),
    ...(publishSurfaceTarget ? auditNode(polycss, publishSurfaceTarget.body, "publishSurfaceTarget") : []),
    ...(publishSurfaceRangeWithForced ? auditNode(polycss, publishSurfaceRangeWithForced.body, "publishSurfaceRangeWithForced") : []),
    ...auditNode(polycss, applySurface.body, "applySurface"),
    ...auditNode(polycss, stageProfileVisibility.body, "stageProfileVisibility"),
    ...(recoverSurface ? auditNode(polycss, recoverSurface.body, "recoverSurface") : []),
    ...(recoverPendingTransforms ? auditNode(polycss, recoverPendingTransforms.body, "recoverPendingTransforms") : []),
    ...(publishProfileVisibility ? auditNode(polycss, publishProfileVisibility.body, "publishProfileVisibility") : []),
    ...(publishRecoveredShapeVisibility ? auditNode(polycss, publishRecoveredShapeVisibility.body, "publishRecoveredShapeVisibility") : []),
    ...auditNode(statePages, validatePagedPlaybackBoundaryFromCanonical.body, "validatePagedPlaybackBoundaryFromCanonical"),
  ];
  const pagedDispatchBeforeInlineMaterialization = pagedDispatchGuard(polycss);
  return Object.freeze({
    schema: "domformat-sequential-paged-source-guard@1",
    method: "typescript-ast-bounded-forbidden-form-guard",
    measuredHeapAllocations: false,
    files: Object.freeze([pagedFile, polycssFile, statePagesFile]),
    scopes: Object.freeze([...FORBIDDEN_SCOPE_NAMES, "validatePagedPlaybackBoundaryFromCanonical"]),
    forbiddenOperations: Object.freeze(["slice-copy", "array-from-copy", "array-constructor", "array-literal", "spread-array-clone", "set-map-constructor", "sort-call", "nested-closure"]),
    pagedDispatchBeforeInlineMaterialization,
    pageBoundaryValidationCalled,
    missingScopes: Object.freeze(missingScopes),
    violations: Object.freeze(violations),
    pass: pagedDispatchBeforeInlineMaterialization && missingScopes.length === 0 && violations.length === 0,
    limitation: "This bounded source guard rejects selected source forms only in the named guarded scopes. It does not traverse the call graph and is not a general JavaScript heap-allocation measurement.",
  });
}
