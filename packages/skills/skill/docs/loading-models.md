# Loading Models

## Supported formats

| Format | Extension | Notes |
|---|---|---|
| OBJ + MTL | `.obj` + `.mtl` | UV maps via `vt`, textures from `map_Kd`. |
| STL | `.stl` | ASCII or binary triangle mesh; binary Magics face colors. No standard units, textures, UVs, or hierarchy. |
| glTF | `.gltf` | Embedded or external buffers, `TEXCOORD_0` UVs. |
| GLB | `.glb` | Binary glTF; embedded textures extracted as blob URLs. |
| MagicaVoxel | `.vox` | Exposed faces become colored quads; eligible baked-mode meshes use a direct-voxel fast path. |

## Declarative

```html
<poly-mesh src="/cottage.obj" mtl="/cottage.mtl"></poly-mesh>
```

```tsx
<PolyMesh src="/cottage.obj" mtl="/cottage.mtl" />
```

Fetches, parses, and mounts one leaf per visible polygon inside a
`.polycss-mesh` wrapper. Disposal is automatic on unmount or `src` change.

React/Vue add `fallback` (`#fallback` slot) and `errorFallback` (`#error` slot).

## Imperative

```ts
import { createPolyCamera, createPolyScene, loadMesh } from "@layoutit/polycss";

const result = await loadMesh("/cottage.obj", {
  mtlUrl: "/cottage.mtl",
  objOptions: { targetSize: 30 },
});
const scene = createPolyScene(host, { camera: createPolyCamera({ rotX: 65, rotY: 45 }) });
scene.add(result);

// later
scene.destroy();   // removes the scene and disposes registered meshes
```

`loadMesh` returns a `ParseResult`:

```ts
interface ParseResult {
  polygons: Polygon[];
  objectUrls: string[];          // blob URLs minted during parse — do not mutate
  warnings: string[];            // non-fatal parse warnings
  dispose: () => void;           // idempotent; revokes the object URLs
  voxelSource?: PolyVoxelSource;         // `.vox` fast-path marker
  animation?: ParseAnimationController;  // glTF/GLB clips, when present
}
```

React/Vue wrap this as `usePolyMesh(url, opts)`, which disposes on unmount and
returns more than the polygons:

```ts
interface UseMeshResult {
  polygons: Polygon[];
  voxelSource: ParseResult["voxelSource"];
  loading: boolean;
  error: Error | null;
  warnings: string[];
  dispose: () => void;   // also called for you on unmount
}
```

Read `warnings` — parse problems surface there rather than throwing.

Format-specific parsers are also exported directly: `parseObj`, `parseStl`,
`parseGltf`, `parseVox`. Use them when you need the raw parser output without
`loadMesh`'s optimization pass, then `scene.add(result, { merge: false })`.

## Parse options

Nested per format under `loadMesh` / `parseOptions`:

```tsx
<PolyMesh
  src="/character.obj"
  parseOptions={{
    objOptions: {
      targetSize: 40,
      materialColors: { Skin: "#f4c2a1" },
      materialTextures: { Body: "/body-diffuse.png" },
      includeObjects: ["Body", "Head"],
    },
  }}
/>
```

- **`targetSize`** (default `60`) scales the model so its longest axis fits that
  many world units. It does not decimate geometry. `.vox` snaps to the nearest
  integer voxel CSS cell size, so the final size may differ slightly.
- **`materialColors` / `materialTextures`** override by material name without
  editing the source file. Available under `objOptions` and `gltfOptions`. For
  glTF, an explicit `materialColors` entry **wins over** the color derived from
  the file's material.
- **`includeObjects` / `excludeObjects`** filter by object name.
- **`baseUrl`** resolves relative texture paths for OBJ/glTF.
- **`solidTextureSamples`** converts texture-backed faces whose sampled UV
  region is effectively one color into solid-color polygons before optimization
  — avoids atlas slices for assets that use texture images as color swatches.
- **`paletteMergeDistance` / `colorRegionMergeDistance`** (`.vox`) fold nearby
  opaque, hue-compatible colors before greedy meshing and clean up small color
  islands. **Lossy** — they change authored colors.
- **`meshResolution`** (`"lossy"` default / `"lossless"`) is the optimizer
  intent. On `<PolyMesh>` the top-level `meshResolution` prop wins over
  `parseOptions.meshResolution`.

## Optimization on load

`loadMesh` optimizes at parse time and `scene.add` optimizes again at render
time. `merge: false` only affects the second pass — it cannot restore source
geometry. See [authoring-polygons.md](authoring-polygons.md) §4 for the exact
thresholds and the STL exception.

## Per-polygon control over a loaded mesh

```tsx
// React render prop
<PolyMesh src="/character.glb">
  {(polygon, index) => (
    <Poly {...polygon} onClick={() => setSelected(index)} />
  )}
</PolyMesh>
```

```vue
<!-- Vue scoped slot -->
<PolyMesh src="/character.glb">
  <template #polygon="{ polygon, index }">
    <Poly v-bind="polygon" @click="selected = index" />
  </template>
</PolyMesh>
```

```ts
// Vanilla: one mesh handle per polygon.
const result = await loadMesh("/character.glb");
const handles = result.polygons.map((polygon, i) =>
  scene.add(
    // Each wrapper is a view onto `result`; it owns no URLs of its own.
    { polygons: [polygon], objectUrls: [], warnings: [], dispose: () => {} },
    { id: `polygon-${i}`, merge: false },
  ),
);

// Keep `result` — the wrappers above have no-op disposers, so its object URLs
// are only released when you dispose the original.
// later: handles.forEach((h) => h.remove()); result.dispose();
```

Merged polygons lose per-polygon DOM addressing, which is why `merge: false`
matters here.

## Blob URL lifecycle

Embedded textures and generated atlas pages are blob URLs, revoked on
`dispose()`. Never hold references to them across remounts. The mesh element,
`<PolyMesh>`, and `usePolyMesh` handle this for you; imperative callers must
call `dispose()` (or `scene.destroy()` for registered meshes).
