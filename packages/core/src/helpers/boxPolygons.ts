/**
 * Axis-aligned box/cuboid geometry as six quad polygons.
 *
 * Returned polygons are in standard PolyCSS world space:
 * +X = right, +Y = front/forward, +Z = top/up.
 */
import type { Polygon, Vec2, Vec3 } from "../types";

export type BoxFace = "right" | "left" | "front" | "back" | "top" | "bottom";

export type BoxFaceOptions = Pick<
  Polygon,
  "color" | "texture" | "material" | "uvs" | "data"
>;

export interface BoxPolygonsOptions extends BoxFaceOptions {
  /** Size along the world X/Y/Z axes. Defaults to a 1×1×1 cube. */
  size?: number | Vec3;
  /** Center used with `size`. Defaults to the origin. */
  center?: Vec3;
  /** Explicit minimum world-space corner. When set with `max`, bounds win over size/center. */
  min?: Vec3;
  /** Explicit maximum world-space corner. When set with `min`, bounds win over size/center. */
  max?: Vec3;
  /** Per-face material/data overrides. Set a face to `false` to omit it. */
  faces?: Partial<Record<BoxFace, BoxFaceOptions | false>>;
}

type FaceSpec = {
  name: BoxFace;
  vertices: Vec3[];
};

const FACE_ORDER: BoxFace[] = ["right", "left", "front", "back", "top", "bottom"];

function cloneVec3(v: Vec3): Vec3 {
  return [v[0], v[1], v[2]];
}

function normalizeBounds(a: Vec3, b: Vec3): { min: Vec3; max: Vec3 } {
  return {
    min: [
      Math.min(a[0], b[0]),
      Math.min(a[1], b[1]),
      Math.min(a[2], b[2]),
    ],
    max: [
      Math.max(a[0], b[0]),
      Math.max(a[1], b[1]),
      Math.max(a[2], b[2]),
    ],
  };
}

function boundsFromOptions(options: BoxPolygonsOptions): { min: Vec3; max: Vec3 } {
  if (options.min && options.max) {
    return normalizeBounds(options.min, options.max);
  }

  const center: Vec3 = options.center ? cloneVec3(options.center) : [0, 0, 0];
  let size: Vec3;
  if (typeof options.size === "number") {
    size = [options.size, options.size, options.size];
  } else if (options.size) {
    size = cloneVec3(options.size);
  } else {
    size = [1, 1, 1];
  }
  const half: Vec3 = [size[0] / 2, size[1] / 2, size[2] / 2];

  return normalizeBounds(
    [center[0] - half[0], center[1] - half[1], center[2] - half[2]],
    [center[0] + half[0], center[1] + half[1], center[2] + half[2]],
  );
}

function buildFaceSpecs(min: Vec3, max: Vec3): FaceSpec[] {
  const [x0, y0, z0] = min;
  const [x1, y1, z1] = max;

  return [
    {
      name: "right",
      vertices: [[x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1]],
    },
    {
      name: "left",
      vertices: [[x0, y1, z0], [x0, y0, z0], [x0, y0, z1], [x0, y1, z1]],
    },
    {
      name: "front",
      vertices: [[x1, y1, z0], [x0, y1, z0], [x0, y1, z1], [x1, y1, z1]],
    },
    {
      name: "back",
      vertices: [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]],
    },
    {
      name: "top",
      vertices: [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]],
    },
    {
      name: "bottom",
      vertices: [[x0, y1, z0], [x1, y1, z0], [x1, y0, z0], [x0, y0, z0]],
    },
  ];
}

function mergeFaceOptions(
  base: BoxFaceOptions,
  face: BoxFaceOptions | undefined,
): BoxFaceOptions {
  const merged: BoxFaceOptions = {
    ...base,
    ...face,
  };
  if (base.data !== undefined || face?.data !== undefined) {
    merged.data = {
      ...(base.data ?? {}),
      ...(face?.data ?? {}),
    };
  }
  return merged;
}

function polygonFromFace(spec: FaceSpec, options: BoxFaceOptions): Polygon {
  const polygon: Polygon = {
    vertices: spec.vertices.map(cloneVec3),
  };
  if (options.color !== undefined) polygon.color = options.color;
  if (options.texture !== undefined) polygon.texture = options.texture;
  if (options.material !== undefined) polygon.material = options.material;
  if (options.uvs !== undefined) polygon.uvs = options.uvs.map((uv): Vec2 => [uv[0], uv[1]]);
  if (options.data !== undefined) polygon.data = { ...options.data };
  return polygon;
}

/** Build the polygons for one axis-aligned box/cuboid. */
export function boxPolygons(options: BoxPolygonsOptions = {}): Polygon[] {
  const { min, max } = boundsFromOptions(options);
  if (min[0] === max[0] || min[1] === max[1] || min[2] === max[2]) return [];

  const base: BoxFaceOptions = {
    color: options.color ?? "#ffffff",
    texture: options.texture,
    material: options.material,
    uvs: options.uvs,
    data: options.data,
  };

  const specs = buildFaceSpecs(min, max);
  const byFace = new Map(specs.map((spec) => [spec.name, spec]));
  const polygons: Polygon[] = [];

  for (const face of FACE_ORDER) {
    const override = options.faces?.[face];
    if (override === false) continue;
    const spec = byFace.get(face);
    if (!spec) continue;
    polygons.push(polygonFromFace(spec, mergeFaceOptions(base, override)));
  }

  return polygons;
}
