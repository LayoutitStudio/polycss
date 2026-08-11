# @layoutit/polycss-core

The pure-math core of [PolyCSS](https://polycss.com). Vec3/polygon math, scene
and camera math, mesh parsers, mesh optimization, lighting, shadow projection,
and texture-atlas planning — with **zero browser globals** (built against
`lib: ES2020` only).

This package does not render anything. It has no DOM access, emits no elements,
and injects no CSS. If you want to draw a scene, install a renderer instead:

| Package | Use it for |
|---|---|
| [`@layoutit/polycss`](https://www.npmjs.com/package/@layoutit/polycss) | Vanilla JS renderer + custom elements (`<poly-scene>`) |
| [`@layoutit/polycss-react`](https://www.npmjs.com/package/@layoutit/polycss-react) | React components and hooks |
| [`@layoutit/polycss-vue`](https://www.npmjs.com/package/@layoutit/polycss-vue) | Vue 3 components and composables |

All three renderers depend on this package and re-export most of its surface, so
you rarely install it directly. Reach for it when you need PolyCSS geometry work
**outside a browser** — a Node build step, a worker, a test, a server-side mesh
pipeline, or your own renderer.

<!-- polycss:shared:links:start -->
Visit [polycss.com](https://polycss.com) for docs and model examples.

Join [chat.polycss.com](https://chat.polycss.com) for support and community discussions.

<img width="1600" height="300" alt="PolyCSS primitives banner" src="https://github.com/user-attachments/assets/b05e2204-9323-4f83-8d1b-01ea0dd000db" />
<!-- polycss:shared:links:end -->

## Installation

```bash
npm install @layoutit/polycss-core
```

## Parsing a mesh without a browser

The parsers (`parseObj`, `parseStl`, `parseGltf`, `parseVox`, `parseMtl`) are
synchronous functions over already-loaded bytes and strings, so they run under
Node. `parseGltf` has two caveats: `.gltf` files with external `.bin` buffers
need an `options.resolveBuffer` callback returning the bytes as a `Uint8Array`
**synchronously** (returning a Promise throws — read the buffers first), and
embedded images mint blob object URLs, so callers must call `result.dispose()`
when done with the mesh. `dispose()` is idempotent, and a no-op for the other
parsers. `loadMesh` is the convenience wrapper on top: it fetches a URL and
dispatches by extension, so it needs `fetch` and is not pure.

```ts
import { readFile } from "node:fs/promises";
import { parseObj, optimizeMeshPolygons } from "@layoutit/polycss-core";

const result = parseObj(await readFile("cottage.obj", "utf8"));
const optimized = optimizeMeshPolygons(result.polygons, { meshResolution: "lossy" });

console.log(result.polygons.length, "→", optimized.length);
```

Supported formats: OBJ (+ MTL), STL (ASCII and binary, including Magics face
colors), glTF / GLB (embedded images, `TEXCOORD_0`), and MagicaVoxel `.vox`.
`loadMesh` fetches and dispatches by extension; the `parse*` functions take
already-loaded input.

## What's in here

- **Types** — `Polygon`, `PolyMaterial`, `Vec2`, `Vec3`, the `PolyTexture*`
  presentation types, `PolyDirectionalLight`, `PolyPointLight`,
  `PolyAmbientLight`, `PolyTextureLightingMode`, `MeshResolution`.
- **Scene + camera math** — `buildSceneContext`, `computeSceneBbox`,
  `normalizePolygons`, `createIsometricCamera`, `buildPolyCameraSceneTransform`,
  `capturePolyCameraSnapshot`, `screenToWorldRay`, `screenToWorldOnSphere`,
  `BASE_TILE`.
- **Transforms** — `buildPolyMeshTransform`, `buildPolySceneTransform`,
  rotation and quaternion helpers.
- **Color + lighting** — `parseColor`, `parsePureColor`, `shadeColor`,
  `computeShapeLighting`.
- **Primitives** — `boxPolygons`, `planePolygons`, `spherePolygons`,
  `cylinderPolygons`, `conePolygons`, `torusPolygons`, `ringPolygons`,
  `axesHelperPolygons`, and the Platonic solids.
- **Mesh optimization** — `optimizeMeshPolygons`, `mergePolygons`,
  `dedupeOverlappingPolygons`, `cullInteriorPolygons`,
  `simplifyTriangleMeshPolygons`, `repairMeshSeams`.
- **Culling** — `polygonFacesCamera`, `polygonCssSurfaceNormal`,
  `cameraCullNormalGroups`, and the voxel camera-cull helpers.
- **Shadow projection** — `buildParametricCasterOverride`,
  `computeParametricShadowSilhouette`, `computeCoverageShadowSilhouette`,
  `projectCssVertexToGround`, `convexHull2D`.
- **Atlas planning** — the pure-math half of the texture atlas pipeline. Canvas
  rasterisation itself lives in each renderer, because it needs the DOM.

The package has two public entry points: the root (`@layoutit/polycss-core`,
exported from `src/index.ts`) and the Three.js parity subpath
(`@layoutit/polycss-core/three`, described below). Everything they export is the
supported surface; anything else is implementation detail.

## Authoring polygons directly

If you build `Polygon[]` by hand, read
[Authoring Polygons](https://polycss.com/core-concepts#authoring-polygons)
first. Three constraints bite immediately:

- **Winding is CCW seen from the outside.** Vertex order sets the face normal
  via the right-hand rule, and PolyCSS backface-culls, so a reversed face is
  invisible.
- **`color` accepts hex and `rgb()`/`rgba()` only** — not CSS named colors.
- **Non-triangular polygons must be coplanar.** Only the React/Vue
  `<PolyScene polygons>` entry point runs `normalizePolygons` for you
  (fan-triangulating non-coplanar n-gons); `scene.add(...)`,
  `<PolyMesh polygons>`, `<Poly>`, and `<poly-polygon>` do not.

## Three.js parity

`@layoutit/polycss-core/three` exposes Three-like math wrappers (`Vector3`,
`Euler`, `Object3D`, `PerspectiveCamera`, `OrthographicCamera`,
`DirectionalLight`, `PointLight`, `AmbientLight`) plus
`transformPolygonsToPoly` for converting Y-up authoring geometry into native
PolyCSS coordinates. See
[polycss.com/api/three-parity](https://polycss.com/api/three-parity).

<!-- polycss:shared:license:start -->
## License

MIT.
<!-- polycss:shared:license:end -->
