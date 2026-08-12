# Performance

Performance scales with **mounted leaf count** and **atlas area**. Every visible
polygon is one DOM element with a CSS transform.

Measured on a 10k-triangle mesh with autorotate over 7 s: scripting ~579 ms
(mostly React re-renders), rendering (style recalc + layout) ~2130 ms. Rendering
dominates — reducing polygon count beats optimising JS.

## The no-JS-in-the-render-loop principle

| JS runs here | JS does NOT run here |
|---|---|
| Scene construction, mesh ops, vertex snapping | Per-frame polygon paint |
| Model import, mesh optimisation, coplanar merging | Per-frame Lambert (dynamic mode is pure CSS) |
| Atlas planning + rasterisation (one-shot) | Per-frame atlas redraw |
| Control input handling | Per-frame transform recompute of every polygon |
| Camera math → one scene-root CSS variable | Per-polygon JS in any hot path |
| Hover/selection raycasting (pointer events only) | Continuous renderer "ticks" |

If you want a `requestAnimationFrame` loop that updates many renderer DOM nodes,
stop and find the CSS variable that should carry the change instead. The only
sanctioned exception is skeletal animation ([animation.md](animation.md)).

## Render strategies

The renderer picks the cheapest CSS primitive that can represent each polygon,
then places it with `matrix3d(...)`. Ordered cheapest → most expensive:

| Leaf | Chosen for | Atlas memory |
|---|---|---|
| `<b>` | Axis-aligned rectangles and stable quads. `background: currentColor`. | none |
| `<u>` | Solid triangles and exact beveled-corner solids (`corner-shape`), with a border-width triangle fallback. | none |
| `<i>` | Other solid clipped polygons, via `border-shape: polygon(...)`. | none |
| `<s>` | Textured polygons **and** the universal fallback. | bounding-rect area |

These are internal tags, not public API — never document or depend on them in
app code, but do understand that the mesher's job is to maximise `<b>`/`<u>`/`<i>`
and minimise `<s>`.

Fall-through when a strategy is unsupported or disabled: `b → i → s`,
`u → i → s`, `i → s`. `<s>` cannot be disabled.

`strategies={{ disable: ["b", "i", "u"] }}` forces atlas rendering — a
diagnostic for comparing output or isolating a browser compositor bug, not a
production setting.

## Diagnostics

- `collectPolyRenderStats(root)` — mounted leaf mix by strategy.
- `collectPolyTextureReadiness(root)` — whether atlas bitmaps have decoded.
- `queryPolyLeaves(root)` — the leaf elements themselves.

## Automatic mesh optimization

`meshResolution: "lossy"` (default) bakes solid texture swatches, merges
visually redundant swatch colors, tries static triangle simplification for
eligible non-animated imports, merges compatible polygons, and can use bounded
geometric approximation when that lowers estimated DOM render cost. Wider lossy
candidates are gated by whole-mesh seam diagnostics and a minimum render-cost
win.

`"lossless"` keeps exact planar candidates only; dedupe and interior culling
still run.

Best on architectural meshes with large flat surfaces — walls, floors, ceilings,
voxel faces.

Limitations: per-polygon DOM addressing is lost inside a merged region, and
UV-textured polygons only merge when texture mapping can be preserved.

## Levers, in order of impact

1. **Fewer polygons.** Lower-poly source assets, or let the lossy optimizer
   work (don't reflexively pass `merge: false`).
2. **Fewer textured polygons.** `solidTextureSamples` converts uniform texture
   swatches into solid colors, skipping atlas slices entirely.
3. **Lower `textureQuality`.** `0.5` costs about a quarter of the bitmap memory
   of `1`.
4. **Cheaper shadows.** `shadow.parametric` with a modest `definition`; avoid
   self-shadow on complex meshes; use `dragDefinition` (vanilla) or lower
   `definition` in state during interaction.
5. **Dynamic lighting** if lights move — it removes the atlas rebake entirely.

`targetSize` does **not** reduce polygon count. It only sets world-space scale
(and therefore atlas footprint size).

## Voxel fast paths

Voxel-shaped meshes are the exception to "all polygons stay mounted": a mesh
with at most the six axis-aligned face normals mounts only camera-facing leaves
and patches the mounted set when the camera or mesh rotation crosses a
visible-normal boundary. Non-voxel meshes keep the full leaf DOM mounted —
broad camera-dependent culling is not worth the mutation cost.

Raw `.vox` sources additionally get a direct-voxel fast path: eligible
baked-mode meshes in vanilla, React, and Vue render visible voxel quads directly
as `<b>` leaves inside persistent signed-face wrappers.

Falls back to the polygon renderer for: dynamic lighting, shadows, stable-DOM
animation, non-exact voxel geometry, and geometry replaced via `setPolygons()`.

## Atlas lifecycle

Textured meshes do a one-time atlas pass at mount; very large texture footprints
still cost memory and startup time. Blob URLs are revoked on `dispose()` /
unmount. Don't hold references across remounts.
