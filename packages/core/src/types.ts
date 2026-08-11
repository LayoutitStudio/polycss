/* Core type and constant definitions shared across polycss runtime modules. */
export const DEFAULT_PROJECTION = "cubic" as const;

/**
 * How polygon lighting is applied by DOM renderers.
 * - "baked": multiply the light tint into the off-DOM canvas before the
 *   polygon becomes an atlas sprite. Best fidelity (full RGB tint), but a
 *   light change needs a rebake. React/Vue re-render and rebake on any light
 *   prop change. Vanilla freezes the lit surface on a `directionalLight`
 *   change until an explicit `mesh.rebakeAtlas()`; a `pointLights` change
 *   does re-render every mesh.
 * - "dynamic": lighting computed entirely in CSS via per-polygon normals
 *   embedded in calc() and scene-root light vars (background-color +
 *   background-blend-mode multiply, masked by the atlas alpha). Atlas
 *   stays light-independent — sliding the light only writes a few CSS
 *   variables, with no JS work in vanilla. (React/Vue mesh rendering may still
 *   recompute atlas plans on a light-prop change; the direct
 *   `<PolyScene polygons>` path keeps its plans stable.)
 */
export type PolyTextureLightingMode = "baked" | "dynamic";
export type PolyTextureLeafSizing = "canonical" | "local" | "raster";
export type PolyTextureBackend = "auto" | "atlas" | "image";
export type PolyTextureImageRendering = "auto" | "pixelated";
export type PolyTextureImageLighting = "scene" | "source";
export type PolyTextureProjection = "affine" | "projective";

export interface PolyTextureImageSource {
  url: string;
  width: number;
  height: number;
  sourceRect?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  imageRendering?: PolyTextureImageRendering;
}

export interface PolyTexturePresentation {
  imageRendering?: PolyTextureImageRendering;
  backend?: PolyTextureBackend;
  lighting?: PolyTextureImageLighting;
  projection?: PolyTextureProjection;
}

/**
 * Mesh post-processing intent.
 * - "lossless": preserve the authored surface while applying exact
 *   reductions such as interior culling and coplanar merge.
 * - "lossy": allow bounded geometric approximation when it reduces the
 *   rendered polygon/DOM count.
 */
export type MeshResolution = "lossless" | "lossy";

/**
 * 3D point/vector, stored as a `[x, y, z]` tuple. Tuple (rather than
 * `{x, y, z}`) for compact JSON: meshes serialize to thousands of vertices
 * and the difference adds up. Destructure with `const [x, y, z] = v` when
 * you need named axes.
 *
 * PolyCSS world space convention: +X right, +Y forward, +Z up.
 */
export type Vec3 = [number, number, number];

/**
 * 2D point/vector — `[u, v]`. Used for texture-atlas UV coordinates on
 * polygons. Convention follows OBJ: u is horizontal (0=left, 1=right),
 * v is vertical (0=bottom, 1=top). Renderers flip v when binding to raster
 * image space whose Y-axis points down.
 */
export type Vec2 = [number, number];

export interface TextureTriangle {
  vertices: [Vec3, Vec3, Vec3];
  uvs: [Vec2, Vec2, Vec2];
}

export type PolyTextureWrapMode = "repeat" | "clamp-to-edge" | "mirrored-repeat";

export interface PolyTextureWrap {
  s: PolyTextureWrapMode;
  t: PolyTextureWrapMode;
}

export type PolyTextureAlphaMode = "opaque" | "mask" | "blend";

/**
 * Directional light — simulates a single distant source (sun, key light).
 * Contributes Lambert shading scaled by `intensity`. `direction` is in
 * scene-local CSS-pixel coords and does not need to be pre-normalized.
 * Mirrors three.js's `DirectionalLight`.
 */
export interface PolyDirectionalLight {
  /** Unit direction from the surface toward the distant light source. */
  direction: Vec3;
  /** Light tint, hex string. White by default. */
  color?: string;
  /** Scalar multiplier on the directional contribution. Default 1. */
  intensity?: number;
}

/**
 * Point light — radiates from a world-space position. Contributes per-face
 * Lambert like a directional light, but the light direction is computed
 * per polygon (face centroid → light position) rather than being global.
 *
 * DIRECTION-ONLY by design: there is no distance falloff (no `decay`/
 * `distance`). A point light differs from a directional light only in that
 * its direction varies per face. To emulate in three.js for parity, use
 * `new THREE.PointLight(color, intensity, 0, 0)` (distance 0, decay 0 →
 * no attenuation). Shading is flat per face (the centroid direction), so it
 * approximates three.js's per-fragment gradient — exact for small faces /
 * distant lights, never a CSS gradient.
 */
export interface PolyPointLight {
  /** World-space position the light radiates from. */
  position: Vec3;
  /** Light tint, hex string. White by default. */
  color?: string;
  /** Scalar multiplier on the contribution. Default 1. */
  intensity?: number;
  /** When true, this light casts shadows (radial projection). Default false. */
  castShadow?: boolean;
}

/**
 * Ambient light — uniform fill that adds to every polygon regardless of
 * orientation. Mirrors three.js's `AmbientLight`. Decoupled from the
 * directional contribution: the two add independently rather than
 * splitting a fixed energy budget.
 */
export interface PolyAmbientLight {
  /** Tint, hex string. White by default. */
  color?: string;
  /** Scalar multiplier on the ambient contribution. Default 0.4. */
  intensity?: number;
}

/**
 * Material — paint configuration shareable across many polygons.
 *
 * In CSS terms, a material bundles the `background-image` source plus paint
 * config. Material-backed polygons render through the texture atlas by
 * default. A direct image leaf — source URL and rect, no per-polygon canvas
 * rasterization — requires valid `imageSource` metadata AND a resolved
 * presentation of `backend: "image"` with source lighting; the default
 * `"auto"` backend resolves to the atlas.
 *
 * Three.js parallel: combines THREE.Texture + a basic Material in one. CSS
 * has no shader/sampler concerns, so the texture/material split from
 * Three.js doesn't pay rent here.
 */
export interface PolyMaterial {
  /** Image source. Anything `background-image: url(...)` can use. */
  texture: string;
  /** Optional unique key (used by PolyCSS to dedupe / cache). Caller can
   *  pass a stable string; if omitted, the material's identity is its object
   *  reference. */
  key?: string;
  imageSource?: PolyTextureImageSource;
  presentation?: PolyTexturePresentation;
}

/**
 * The single polygon type for polycss. N coplanar vertices in 3D space,
 * CCW winding from outside. No bbox field, no shape discriminator, no
 * input/output distinction — one type, used by parsers, by the merge
 * pass, and by the renderer.
 */
export interface Polygon {
  /** N coplanar vertices in 3D space, CCW winding from outside. */
  vertices: Vec3[];
  /**
   * Solid base color. Falls back to "#cccccc" when neither color nor
   * texture is set.
   */
  color?: string;
  /**
   * Texture URL. When set with `uvs`, UV-mapped via affine; without
   * `uvs`, single-tile fill. If the load fails, renderer falls back to
   * `color` (or default gray).
   */
  texture?: string;
  /**
   * Texture sampler wrap mode for UVs outside [0, 1]. glTF imports preserve
   * sampler.wrapS / wrapT here so the atlas rasterizer can tile repeated UVs.
   * When unset, renderers keep the historical single-image behavior.
   * @internal
   */
  textureWrap?: PolyTextureWrap;
  /**
   * Texture alpha interpretation imported from glTF `material.alphaMode`.
   * Opaque textures can use transparent PNG padding without cutting holes in
   * the rendered polygon.
   * @internal
   */
  textureAlphaMode?: PolyTextureAlphaMode;
  /**
   * Shared material. When set, `material.texture` takes precedence over the
   * inline `texture` field. Material-backed polygons render through the atlas
   * by default; a direct image leaf requires valid `imageSource` metadata plus
   * a resolved `backend: "image"` with source lighting. UV shape has no effect
   * on backend selection.
   */
  material?: PolyMaterial;
  textureImageSource?: PolyTextureImageSource;
  texturePresentation?: PolyTexturePresentation;
  /**
   * Per-vertex UV coords (0..1, OBJ convention with v=0 at bottom).
   * Length MUST equal vertices.length when set; mismatched UVs are
   * stripped by `normalizePolygons`.
   */
  uvs?: Vec2[];
  /**
   * Renderer-internal source triangles for UV textures. Merge passes use this
   * to reduce DOM planes while preserving per-triangle texture mapping in the
   * generated atlas.
   * @internal
   */
  textureTriangles?: TextureTriangle[];
  /**
   * Import-time simplifier seam keys retained after solid texture baking.
   * Renderers ignore this; mesh optimization uses it to avoid welding vertices
   * that shared a position but came from different texture/attribute seams.
   * @internal
   */
  simplifyVertexKeys?: string[];
  /**
   * Stricter import-time simplifier keys that preserve source vertex identity.
   * Renderers ignore this; candidate simplification uses it only for fallback
   * passes where relaxed seam welding loses after render-cost optimization.
   * @internal
   */
  simplifySourceVertexKeys?: string[];
  /**
   * Source material requested two-sided rendering. Importers use this so
   * optimization passes do not collapse intentional reverse-wound faces.
   * @internal
   */
  doubleSided?: boolean;
  /**
   * User-controlled metadata. Reflected to DOM as `data-*` attributes via
   * stringification by the framework wrappers. Only string|number|boolean
   * values are kept; other shapes are dropped by `normalizePolygons`.
   */
  data?: Record<string, string | number | boolean>;
}
