---
name: compat-hunter
description: Use when hunting for OBJ/GLB/glTF/VOX parser compatibility issues by streaming candidate models, parsing each immediately, deleting clean files, and retaining only actionable failures, unknown warnings, or unexplained zero-polygon outputs. Especially useful in the polycss repo with scripts/compat-hunter.mjs.
---

# Compat Hunter

Use this skill when the user wants to keep digging for parser compatibility issues without building a fixed local corpus.

## Workflow

1. In the repo, prefer the reusable script:

   ```bash
   pnpm compat-hunter -- --max-models 2000
   ```

   Equivalent explicit form:

   ```bash
   pnpm --filter @layoutit/polycss-core build
   node .agents/skills/compat-hunter/scripts/compat-hunter.mjs --max-models 2000
   ```

2. Let the script stream remote OBJ/GLB/glTF/VOX candidates, parse each model, and discard clean files. Reports are written under `bench/results/`, which is ignored by git.

3. Treat these as known non-actionable unless the user asks to support them:
   - glTF POINTS/LINES/LINE_LOOP/LINE_STRIP primitives.
   - Required Draco or meshopt compressed primitives skipped with a warning.
   - STL source-quality diagnostics that the parser already handles: degenerate triangles, repaired winding, component orientation, non-manifold/shared-edge topology, supplied-normal mismatches, malformed normals/facets, overdeclared binary triangle counts, trailing binary bytes, and ignored non-Magics binary attribute bytes.
   - Empty/corrupt STL containers with no complete triangle records or no valid ASCII facets.

4. Stop and inspect anything classified as:
   - `throw`
   - `unknown-warning`
   - `obj-zero-no-warning`
   - `glb-zero-no-warning`

5. If an actionable parser issue is found, keep the saved file under the report's `interesting/` directory, add a focused parser test using that behavior, implement the smallest fix, and rerun the focused parser tests plus the hunter on the saved file or source class.

## Useful Commands

Fresh Objaverse and expanded GitHub stream:

```bash
pnpm compat-hunter -- --max-models 5000 --max-bytes 10mb --timeout-ms 30000
```

Objaverse only, later shards:

```bash
pnpm compat-hunter -- --sources objaverse --objaverse-shards 120:220 --max-models 5000
```

GitHub only:

```bash
pnpm compat-hunter -- --sources github --max-models 500
```

Poly Haven only:

```bash
pnpm compat-hunter -- --sources polyhaven --polyhaven-limit 250 --max-models 200
```

VOX-heavy GitHub sources:

```bash
pnpm compat-hunter -- --sources github --github-repos ephtracy/voxel-model@master:vox/,mikelovesrobots/mmmm@master:vox/ --max-models 1000
```

Local directory:

```bash
pnpm compat-hunter -- --sources local --local-root /tmp/models --max-models 1000
```

Keep known-warning files too:

```bash
pnpm compat-hunter -- --keep-known --max-models 500
```

For STL hunts, `--keep-known` keeps warning-only models under `known/` and the report includes `warningCategoriesByKind` plus `stlDiagnostics` on retained rows. Unknown STL warning text, throws, zero-polygon outputs, and suspicious DOM collapses remain `interesting/`.

Avoid repeating the same shuffled queue:

```bash
pnpm compat-hunter -- --sources thingi10k --exts stl --max-models 5000 --seed "$(date +%s)" --queue-offset 5000
```

Skip models already attempted by prior reports:

```bash
pnpm compat-hunter -- --sources thingi10k --exts stl --max-models 5000 --skip-report bench/results/<previous-run>/report.json
```

Continue after interesting cases:

```bash
pnpm compat-hunter -- --no-stop-on-interesting --max-models 2000
```

## Reporting

Summarize the final `report.json` with:

```bash
pnpm compat-hunter -- --report bench/results/<run>/report.json
```

In the final response, state the attempted/parsed counts, whether any interesting files were retained, and whether the findings are actionable. Do not imply a clean stream proves full compatibility; it only means this pass found no new actionable parser issue.
