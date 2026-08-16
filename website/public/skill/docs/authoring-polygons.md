# Authoring Polygons

Read this before generating `Polygon[]` by hand. Every constraint here fails
**silently** — no throw, no console warning, no visual error state.

## The shape

```ts
interface Polygon {
  vertices: [number, number, number][];  // 3+ points, CCW seen from outside
  color?: string;                        // hex or rgb()/rgba() ONLY
  texture?: string;                      // image URL
  uvs?: [number, number][];              // one per vertex
  material?: PolyMaterial;               // shared material; material.texture wins over `texture`
  textureImageSource?: PolyTextureImageSource;    // source image metadata; needs texturePresentation.backend="image" (advanced)
  texturePresentation?: PolyTexturePresentation;  // per-polygon texture overrides (advanced)
  data?: Record<string, string | number | boolean>;  // → data-* attributes
}
```

Fields not listed here (`textureWrap`, `textureTriangles`, `doubleSided`, …)
are parser-internal — do not author them.

## What each entry point does for you

How much cleanup you get for free varies by parser and by entry point.

**Winding:** STL repairs it from connectivity; `.vox` is correct by
construction; **OBJ and glTF preserve source winding as-is**. All parsers fit to
target size and normalize into PolyCSS Z-up coordinates. The axis transform is
per-format: OBJ and glTF apply a cyclic `(x,y,z) → (z,x,y)` permutation (never a
y↔z swap, so handedness is preserved); STL defaults to identity axes; `.vox` is
already Z-up.

**Validation:** only React/Vue `<PolyScene polygons>` runs `normalizePolygons`
(drops degenerates, strips mismatched `uvs`, replaces bad colors with
`#cccccc`, fan-triangulates non-coplanar n-gons) — and its warnings are never
surfaced. `scene.add(...)`, `<PolyMesh polygons>`, `<Poly>`, and
`<poly-polygon>` do **not** normalize.

## 1. Winding decides visibility

Vertex order sets the face normal by the right-hand rule
(`(v1-v0) × (v2-v0)`), and PolyCSS backface-culls every leaf. A reversed face is
invisible from the side you meant to show, and shades from the flipped normal —
typically ambient-only, since the directional term clamps at zero (it darkens,
it does not invert).

Shadows differ by path: React/Vue's ground fallback projects every polygon
regardless of orientation, but the `receiveShadow` path (vanilla's only
mechanism) light-back-face-culls casters, so a reversed open face can lose its
shadow too.

**Wind counter-clockwise as seen from the side you want to look at.**

```ts
// Faces +Z (up) — visible from above.
{ vertices: [[0,0,0], [1,0,0], [1,1,0], [0,1,0]], color: "#d8d2c7" }
// Same quad reversed — faces -Z, invisible from above.
{ vertices: [[0,0,0], [0,1,0], [1,1,0], [1,0,0]], color: "#d8d2c7" }
```

Corollaries:

- Solids wind outward; rooms and interiors wind **inward**.
- Mirroring or negative scale reverses handedness and requires reversing
  winding.
- Reversing vertices requires reversing `uvs` in the same order.
- `doubleSided` is importer-internal and is **not** a render-time flag — it will
  not make a face visible from behind. There is no way to make one polygon
  visible from both sides; emit two polygons with opposite winding.

**Diagnostic rule:** a single-sided face disappearing when the camera moves
behind it is correct behavior, not a bug. The winding symptom is a surface
missing or flickering **from the viewpoint it was built to be seen from** — it
exists in the data, its neighbours render, but it only shows from the opposite
side. Then inspect winding and normal before touching culling, lighting, or
camera code.

## 2. `color` is not a full CSS color

Only `#rgb`, `#rrggbb`, `rgb()`, and `rgba()` parse. Named colors (`"tomato"`),
`hsl()`, and `color()` fail silently — rendering **white**, or `#cccccc` on the
normalizing `<PolyScene polygons>` path.

Convert before authoring:

```ts
// Wrong — renders white.
{ vertices, color: "rebeccapurple" }
// Right.
{ vertices, color: "#663399" }
```

## 3. Non-triangular polygons must be coplanar

On every path except `<PolyScene polygons>`, a non-planar n-gon is flattened
onto its average plane, opening cracks against its neighbours;
`<PolyScene polygons>` instead fan-triangulates it, silently changing topology.
Triangles are always safe.

If you need a quad whose corners do not lie on one plane, emit two triangles
instead. If you deliberately snap a vertex onto a shared plane to enable a
merge, propagate the new position to **every** polygon that references it, or
you have traded a flatten for a crack.

## 4. The optimizer rewrites geometry by default

`merge` defaults to `true` and `meshResolution` to `"lossy"`:

- Coincident faces within `0.05` world units are deduped.
- Interior faces are culled.
- Lossy merging starts at `0.35` world units of plane displacement / `0.04`
  boundary / `15°` — but that is not the ceiling: the optimizer also tries
  aggressive `30°`, `45°`, and `60°` variants (the widest at `0.06` boundary),
  accepted on a material render-cost win.

The degree values are angular thresholds; the displacement budgets are absolute
world units. **None are configurable.**

Dedupe and interior culling count as exact reductions and still run under
`meshResolution: "lossless"` — with one parse-time exception: STL parse results
force the lossless optimizer *and* pass `skipInteriorCull`, but that protection
does not survive into the renderer's own pass, which culls again unless you set
`merge: false`.

`merge: false` renders the array you pass untouched, but only on
`scene.add(...)` and `<PolyMesh polygons>`. It does **not** exist on
`<PolyScene polygons>` (always normalized + merged) or `<poly-mesh>`, and it
cannot undo `loadMesh`'s own parse-time optimization.

There is no exact-as-authored path for file geometry — the parsers normalize
(fit to `targetSize` `60`, origin reposition, per-format axis normalization,
rounding, fan-triangulation; STL repairs winding; `.vox` greedy-meshes quads).
To preserve the *direct parser output* from renderer optimization, call
`parseObj` / `parseStl` / `parseGltf` / `parseVox` directly and add with
`merge: false`.

## 5. Degenerate polygons vanish silently

Under 3 vertices, zero area, or a degenerate first edge produces no leaf and no
console output. If a polygon you authored is simply absent from the DOM, check
for duplicate consecutive vertices before anything else.

## Getting geometry into a scene

`scene.add()` takes a `ParseResult`, not a raw array. Wrap it yourself:

```ts
scene.add({ polygons, objectUrls: [], warnings: [], dispose: () => {} }, { merge: false });
```

There is **no** `polygons` option on `createPolyScene`. In React/Vue,
`<PolyScene polygons={...}>` and `<PolyMesh polygons={...}>` both exist and
behave differently (see the validation note above).

## Meshing for cheap rendering

If you are generating geometry programmatically, the mesher's job is to
maximise cheap leaves and minimise atlas-backed ones.

- **Polygon count is the dominant cost.** One visible polygon = one DOM node,
  one `matrix3d`, one paint.
- **Fill ratio matters for textured polygons.** A textured polygon's atlas slice
  equals its local-2D bounding rect; empty space inside is wasted bitmap.
  Axis-aligned rectangle = 1.0 (and the fastest path); right-isosceles triangle
  = 0.5; skinny triangles are far worse and many of them balloon atlas memory.
- **Regular grids are not required.** Any planar tiling whose edges match across
  neighbours (no T-junctions, no cracks) is valid. Break the grid where it lets
  you fit larger axis-aligned rects to flat regions.
- **Track cumulative vertex displacement**, not per-merge error, when snapping
  vertices to shared planes. Errors compound.

See [performance.md](performance.md) for the render-strategy table.
