# @layoutit/polycss-morph

Prepared retained-model deformation and playback for PolyCSS.

Version `0.0.1` is the first release candidate. This README documents the
source-tree API; it does not announce npm registry availability.

## Boundary

Morph has two public entries:

- `@layoutit/polycss-morph/prepare` is Node-only. It reads strict authoring
  config and glTF/GLB source, builds topology and retained render plans,
  emits canonical solid CSS triangle leaves plus packed alpha-atlas fallback
  pages with one local-size slice per polygon, and writes a deterministic,
  content-addressed package with `manifest.json` last.
- `@layoutit/polycss-morph` is browser-safe. It validates and loads prepared
  packages, mounts one retained PolyCSS graph, and exposes imperative,
  caller-driven runtimes.

The generic Node preparer directly creates `static-prepared` and
`morph-regions` models. The browser runtime executes all four validated
profiles:

| Profile | Runtime contract |
|---|---|
| `static-prepared` | Mount a prepared retained graph without deformation. |
| `morph-regions` | Apply sparse prepared morph targets, semantic controls, springs, and clips. |
| `joint-skin` | Evaluate a validated joint hierarchy and weighted vertex deformation. |
| `prepared-playback` | Apply source-ordered model, shape, visibility, opacity, transform, and atlas-row changes. |

There are no React or Vue wrappers. React, Vue, and vanilla applications use
the same imperative package.

## Prepare in Node

```ts
import { preparePolyMorphModel } from "@layoutit/polycss-morph/prepare";

const report = await preparePolyMorphModel({
  configPath: "./source/prepare.json",
  outputRoot: "./public/model/package",
});

console.log(report.manifestSha256);
```

Pass `check: true` to verify that an existing output directory matches the
deterministic package exactly without rewriting it.

## Load and mount in a browser

```ts
import {
  createPolyMorphDeformationRuntime,
  loadPolyMorphPackage,
  mountPolyMorphModel,
} from "@layoutit/polycss-morph";

const loaded = await loadPolyMorphPackage("/model/");
const mounted = mountPolyMorphModel(host, loaded.model, {
  resources: loaded.resources,
});
const deformation = createPolyMorphDeformationRuntime(loaded.model);
const frame = deformation.sample({
  tick: 0,
  morphWeights: { "corner-lift": 0.5 },
});

mounted.apply({ leaves: frame.leafUpdates });
```

The browser API is intentionally imperative:

- load or validate a model;
- mount once;
- create only the runtimes the model uses;
- sample them from application input or time;
- pass changed model, shape, or leaf rows to `mounted.apply(...)`;
- for prepared playback, call `runtime.commit(sample)` only after
  `mounted.apply(sample.update)` succeeds;
- call `mounted.destroy()` at teardown.

Morph owns no `requestAnimationFrame` loop, interval, or other scheduler. A
mounted model keeps the same leaf elements for its lifetime. Runtime updates do
not rebuild topology, add or remove leaves, construct image resources, or
redraw prepared image resources.

The browser resolves prepared triangles once during mount. Supporting browsers,
including Firefox, use a native CSS triangle primitive. WebKit/Safari and other
browsers without a supported primitive use each leaf's prepared polygon-sized
atlas slice. Mount creates object URLs from the loader's already-verified image
bytes and revokes them at teardown; it does not refetch package resources.
Atlas pages are generated with Node built-ins, so Morph has no Sharp or other
native image dependency.

## Consumer adapters

Product-specific source cadence, schemas, input ordering, presentation, and
oracle tooling stay in the consuming product. Product adapters own their
prepared packages, mounting paths, presentation, and oracle evidence.
