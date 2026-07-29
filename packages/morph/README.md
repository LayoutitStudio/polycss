# @layoutit/polycss-morph

Prepare, load, and animate retained DOM models with PolyCSS.

```bash
npm install @layoutit/polycss-morph
```

## Package entries

Morph has two public entries:

- `@layoutit/polycss-morph/prepare` is Node-only. It reads strict authoring
  config and glTF/GLB source, builds topology and retained render plans,
  emits canonical solid CSS triangle leaves plus packed alpha-atlas fallback
  pages with one local-size slice per polygon, and writes a deterministic,
  content-addressed package with `manifest.json` last.
- `@layoutit/polycss-morph` is browser-safe. It validates and loads prepared
  packages, mounts one retained PolyCSS graph, and exposes imperative,
  caller-driven runtimes.

The Node preparer creates `static-prepared` and `morph-regions` models. The
browser runtime supports all four profiles:

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

See the [cube-to-sphere example](https://polycss.com/guides/morph/#example-cube-to-sphere)
for a complete rendered deformation example.

The browser API is intentionally imperative:

- load or validate a model;
- mount once;
- create only the runtimes the model uses;
- sample them from application input or time;
- pass changed model, shape, or leaf rows to `mounted.apply(...)`;
- for prepared playback, call `runtime.commit(sample)` only after
  `mounted.apply(sample.update)` succeeds;
- call `mounted.destroy()` at teardown.

Consumers that already own a retained DOM graph can adopt its source-ordered
model, shape, and leaf elements with `createPolyMorphPreparedDomTarget`.
The target owns write deduplication and invalidation, while the consumer
continues to own the elements and their teardown.

Morph owns no `requestAnimationFrame` loop, interval, or other scheduler. A
mounted model keeps the same leaf elements for its lifetime. Runtime updates do
not rebuild topology, add or remove leaves, construct image resources, or
redraw prepared image resources.

Morph chooses the triangle paint path once when it mounts. It uses
`corner-shape` where available, a larger CSS border triangle in Firefox, and
each leaf's prepared polygon-sized atlas slice in WebKit/Safari. Mount creates
object URLs from the loader's already-verified image bytes and revokes them at
teardown; it does not refetch package resources. Atlas pages are generated with
Node built-ins, so Morph has no Sharp or other native image dependency.

## Application ownership

Morph owns the prepared model format and sparse DOM updates. Your application
owns input, timing, presentation, model-specific preparation, and product
behavior.
