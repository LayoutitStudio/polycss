# Textures

A polygon is textured when it has `texture` (or `material.texture`) plus `uvs`,
one UV pair per vertex. `material.texture` wins over `texture`.

## The atlas pipeline

Rasterisation happens **once**, at mount, not per frame:

1. Extract or fetch the texture image.
2. Solve a 6-DOF affine transform from the polygon's UVs to its 2D footprint.
3. Pack polygon footprints into one or more atlas pages.
4. Clip, draw texture pixels or shaded color fills, and export pages to blob
   URLs via `canvas.toBlob()`.
5. Repair antialiased pixels along shared textured edges, then render each
   polygon as an `<s>` leaf with `background-image` / `-size` / `-position`.

Atlas blob URLs are revoked on unmount or `dispose()`.

Flat-color polygons bypass the atlas entirely when they can render as CSS
solids or `border-shape` polygons — that is the cheap path, and the mesher
should aim for it.

## Fill ratio

A textured polygon's atlas slice equals its **local-2D bounding rect**. Empty
space inside that rect is wasted bitmap memory.

- axis-aligned rectangle → 1.0 (and the fastest path)
- right-isosceles triangle → 0.5
- skinny/long triangle → ≪ 0.5, the worst case

Many skinny textured triangles balloon atlas memory. This is the main reason to
prefer rectangle-friendly meshing.

## `textureQuality`

Default `"auto"`. Auto starts from the packed atlas area, caps oversized runtime
bitmaps by page side length and decoded-memory budget, and chooses the fixed CSS
sprite size used by atlas leaves: **128px** for desktop-class auto (avoids
Safari/Firefox compositor flattening artifacts), **64px** for mobile-class auto
and for explicit numeric quality.

Numeric values override the raster scale: `0.5` uses about a quarter of the
atlas bitmap memory of `1`. Use `0.5`–`0.75` for distant or dense assets, `1`
for close-up inspection. Numeric quality keeps the 64px sprite size.

```html
<poly-scene texture-quality="0.5"><poly-mesh src="/model.glb"></poly-mesh></poly-scene>
```

```tsx
<PolyScene textureQuality={0.5}>…</PolyScene>
<PolyMesh src="/model.glb" textureQuality={0.5} />   {/* React/Vue per-mesh */}
```

## Texture presentation options

Scene defaults, overridable per mesh in React/Vue:

| Option | Values | Default | Meaning |
|---|---|---|---|
| `textureBackend` | `"auto" \| "atlas" \| "image"` | `"auto"` | `"auto"` **always resolves to the atlas today.** Direct image leaves require an explicit `"image"`. |
| `textureImageRendering` | `"auto" \| "pixelated"` | `"auto"` | CSS image filtering. Use `"pixelated"` for pixel-art textures. |
| `textureProjection` | `"affine" \| "projective"` | `"affine"` | Projection request for textured quads. |
| `textureLeafSizing` | `"canonical" \| "local" \| "raster"` | `"canonical"` | Leaf CSS primitive sizing. **Scene/atlas-wide — no per-polygon override.** |

Precedence for a given polygon: scene defaults → `material.presentation` →
source `imageRendering` → `polygon.texturePresentation`.

Direct image leaves (`backend: "image"` with `textureImageSource`) skip atlas
rasterisation and use the caller's source URL and source rect directly. They
**preserve source lighting** (`texturePresentation.lighting = "source"`) — a
scene-lit direct image falls back to the atlas path. Use them for source-exact
surfaces; use the atlas when you want scene lighting.

Atlas position/size, image position/size, filtering, readiness, projection, and
source rect are exposed as PolyCSS-owned metadata. Read them with
`resolvePolyTextureLeafGeometry`, `resolvePolyTextureImageSource`,
`resolvePolyTexturePresentation`, and `resolvePolyTextureImageRendering` rather
than parsing style strings.

## Seams

Shared textured edges are repaired automatically during atlas generation:
geometry is unchanged, only low-alpha atlas pixels at shared edges are filled
from nearby opaque texels.

Solid (untextured) shared edges use `seamBleed` instead — see
[scenes-and-cameras.md](scenes-and-cameras.md). Its semantics are owned by core
and identical in all three renderers.

## Readiness

`collectPolyTextureReadiness(root)` reports the renderer's own readiness state
for texture leaves. Treat it as a progress signal, **not as proof that every
texture decoded**: a direct-image leaf counts as ready once its CSS URL is
assigned, which says nothing about whether the browser has fetched or decoded
the bytes.

Textured scenes still need real settle time before a screenshot — an atlas that
has not painted yet looks like a rendering regression but is not one. Readiness
narrows that window; it does not close it.

React/Vue `atomicAtlas` holds the previous atlas frame until the next is
decoded, then swaps atomically; `onFrameReady` fires on that swap.
