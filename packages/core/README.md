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

Visit [polycss.com](https://polycss.com) for docs and model examples.

## Installation

```bash
npm install @layoutit/polycss-core
```

## Parsing a mesh without a browser

The parsers (`parseObj`, `parseStl`, `parseGltf`, `parseVox`, `parseMtl`) are
pure, synchronous functions over already-loaded bytes and strings, so they run
under Node. `loadMesh` is the convenience wrapper on top: it fetches a URL and
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

Everything exported from `src/index.ts` is the supported surface; anything else
is implementation detail.

## Authoring polygons directly

If you build `Polygon[]` by hand, read
[Authoring Polygons](https://polycss.com/core-concepts#authoring-polygons)
first. Three constraints bite immediately:

- **Winding is CCW seen from the outside.** Vertex order sets the face normal
  via the right-hand rule, and PolyCSS backface-culls, so a reversed face is
  invisible.
- **`color` accepts hex and `rgb()`/`rgba()` only** — not CSS named colors.
- **Non-triangular polygons must be coplanar.** Renderers do not call
  `normalizePolygons` for you.

## Three.js parity

`@layoutit/polycss-core/three` exposes Three-like math wrappers (`Vector3`,
`Euler`, `Object3D`, `PerspectiveCamera`, `OrthographicCamera`,
`DirectionalLight`, `PointLight`, `AmbientLight`) plus
`transformPolygonsToPoly` for converting Y-up authoring geometry into native
PolyCSS coordinates. See
[polycss.com/api/three-parity](https://polycss.com/api/three-parity).

## License

MIT.
