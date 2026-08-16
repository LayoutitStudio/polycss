import { BASE_TILE } from "../camera/camera";
import type {
  CameraState,
} from "../camera/camera";
import type {
  Polygon,
  PolyAmbientLight,
  PolyDirectionalLight,
  PolyPointLight,
  TextureTriangle,
  Vec3,
} from "../types";

const DEG = Math.PI / 180;
const EPS = 1e-12;
const DEFAULT_VIEWPORT_HEIGHT = 420;

export type Vector3Tuple = [number, number, number];

export interface PolyCameraFromThreeOptions {
  /** PolyCSS CSS-pixel scale per world unit. Defaults to BASE_TILE. */
  zoom?: number;
  /** Viewport height in CSS px for fov/frustum conversion. Defaults to 420. */
  viewportHeight?: number;
}

export interface PolyPerspectiveCameraFromThreeOptions extends PolyCameraFromThreeOptions {
  /** CSS perspective distance in px. Defaults to the value derived from fov. */
  perspective?: number;
}

export type PolyOrthographicCameraFromThreeOptions = PolyCameraFromThreeOptions;

export interface PolyPerspectiveCameraStateFromThree extends CameraState {
  perspective: number;
}

export type PolyOrthographicCameraStateFromThree = CameraState;

export class Vector3 {
  x: number;
  y: number;
  z: number;

  constructor(x = 0, y = 0, z = 0) {
    this.x = x;
    this.y = y;
    this.z = z;
  }

  set(x: number, y: number, z: number): this {
    this.x = x;
    this.y = y;
    this.z = z;
    return this;
  }

  copy(v: Vector3): this {
    this.x = v.x;
    this.y = v.y;
    this.z = v.z;
    return this;
  }

  clone(): Vector3 {
    return new Vector3(this.x, this.y, this.z);
  }

  add(v: Vector3): this {
    this.x += v.x;
    this.y += v.y;
    this.z += v.z;
    return this;
  }

  sub(v: Vector3): this {
    this.x -= v.x;
    this.y -= v.y;
    this.z -= v.z;
    return this;
  }

  multiplyScalar(s: number): this {
    this.x *= s;
    this.y *= s;
    this.z *= s;
    return this;
  }

  dot(v: Vector3): number {
    return this.x * v.x + this.y * v.y + this.z * v.z;
  }

  cross(v: Vector3): this {
    const x = this.y * v.z - this.z * v.y;
    const y = this.z * v.x - this.x * v.z;
    const z = this.x * v.y - this.y * v.x;
    this.x = x;
    this.y = y;
    this.z = z;
    return this;
  }

  length(): number {
    return Math.hypot(this.x, this.y, this.z);
  }

  normalize(): this {
    const len = this.length();
    if (len > EPS) this.multiplyScalar(1 / len);
    return this;
  }

  toArray(): Vector3Tuple {
    return [this.x, this.y, this.z];
  }
}

export class Euler {
  x: number;
  y: number;
  z: number;
  readonly order = "XYZ";
  #onChange: () => void;

  constructor(x = 0, y = 0, z = 0, onChange: () => void = () => {}) {
    this.x = x;
    this.y = y;
    this.z = z;
    this.#onChange = onChange;
  }

  set(x: number, y: number, z: number): this {
    this.x = x;
    this.y = y;
    this.z = z;
    this.#onChange();
    return this;
  }
}

export class Object3D {
  readonly position = new Vector3();
  readonly rotation: Euler;
  readonly scale = new Vector3(1, 1, 1);
  up = new Vector3(0, 1, 0);
  #lookAtTarget: Vector3 | null = null;

  constructor() {
    this.rotation = new Euler(0, 0, 0, () => {
      this.#lookAtTarget = null;
    });
  }

  lookAt(x: number | Vector3, y?: number, z?: number): this {
    this.#lookAtTarget = x instanceof Vector3
      ? x.clone()
      : new Vector3(x, y ?? 0, z ?? 0);
    return this;
  }

  get lookAtTarget(): Vector3 | null {
    return this.#lookAtTarget?.clone() ?? null;
  }

  localToWorld(v: Vector3): Vector3 {
    const out = rotateByEuler(
      new Vector3(v.x * this.scale.x, v.y * this.scale.y, v.z * this.scale.z),
      this.rotation,
    );
    return out.add(this.position);
  }

  worldForward(): Vector3 {
    if (this.#lookAtTarget) {
      return this.#lookAtTarget.clone().sub(this.position).normalize();
    }
    return rotateByEuler(new Vector3(0, 0, -1), this.rotation).normalize();
  }
}

export class PerspectiveCamera extends Object3D {
  readonly type = "PerspectiveCamera";
  fov: number;
  aspect: number;
  near: number;
  far: number;
  zoom = 1;

  constructor(fov = 50, aspect = 1, near = 0.1, far = 2000) {
    super();
    this.fov = fov;
    this.aspect = aspect;
    this.near = near;
    this.far = far;
  }

  toPolyCameraState(options: PolyPerspectiveCameraFromThreeOptions = {}): PolyPerspectiveCameraStateFromThree {
    const perspective = options.perspective ?? perspectiveFromFov(
      this.fov,
      options.viewportHeight ?? DEFAULT_VIEWPORT_HEIGHT,
      this.zoom,
    );
    const state = cameraStateFromObject(this, options.zoom ?? BASE_TILE);
    return {
      ...state,
      distance: state.distance - perspective,
      perspective,
    };
  }
}

export class OrthographicCamera extends Object3D {
  readonly type = "OrthographicCamera";
  left: number;
  right: number;
  top: number;
  bottom: number;
  near: number;
  far: number;
  zoom = 1;

  constructor(left = -1, right = 1, top = 1, bottom = -1, near = 0.1, far = 2000) {
    super();
    this.left = left;
    this.right = right;
    this.top = top;
    this.bottom = bottom;
    this.near = near;
    this.far = far;
  }

  toPolyCameraState(options: PolyOrthographicCameraFromThreeOptions = {}): PolyOrthographicCameraStateFromThree {
    const frustumHeight = Math.abs(this.top - this.bottom) || 1;
    const zoom = options.zoom ?? (((options.viewportHeight ?? DEFAULT_VIEWPORT_HEIGHT) / frustumHeight) * this.zoom);
    return cameraStateFromObject(this, zoom);
  }
}

export class DirectionalLight extends Object3D {
  readonly target = new Object3D();
  color: string;
  intensity: number;

  constructor(color = "#ffffff", intensity = 1) {
    super();
    this.color = color;
    this.intensity = intensity;
    this.position.set(0, 1, 0);
  }

  toPolyDirectionalLight(): PolyDirectionalLight {
    const direction = this.position.clone().sub(this.target.position).normalize();
    return {
      direction: threeToPolyDirection(direction),
      color: this.color,
      intensity: this.intensity,
    };
  }
}

export class PointLight extends Object3D {
  color: string;
  intensity: number;
  distance: number;
  decay: number;
  castShadow = false;

  constructor(color = "#ffffff", intensity = 1, distance = 0, decay = 0) {
    super();
    this.color = color;
    this.intensity = intensity;
    this.distance = distance;
    this.decay = decay;
  }

  toPolyPointLight(): PolyPointLight {
    return {
      position: threeToPolyPoint(this.position),
      color: this.color,
      intensity: this.intensity,
      castShadow: this.castShadow,
    };
  }
}

export class AmbientLight {
  color: string;
  intensity: number;

  constructor(color = "#ffffff", intensity = 1) {
    this.color = color;
    this.intensity = intensity;
  }

  toPolyAmbientLight(): PolyAmbientLight {
    return {
      color: this.color,
      intensity: this.intensity,
    };
  }
}

// Y-up (three) -> Z-up (polycss) must be a ROTATION (det +1), not an axis
// swap. [x, z, y] is a reflection and flips winding; [x, -z, y] is +90deg
// about X and keeps polygon normals/light response right-handed.
export function threeToPolyPoint(v: Vector3 | Vector3Tuple): Vec3 {
  const [x, y, z] = vectorTuple(v);
  return [x, -z, y];
}

export function polyToThreePoint(v: Vec3): Vector3 {
  return new Vector3(v[0], v[2], -v[1]);
}

export function threeToPolyDirection(v: Vector3 | Vector3Tuple): Vec3 {
  const [x, y, z] = vectorTuple(v);
  return [x, -z, y];
}

export function polyToThreeDirection(v: Vec3): Vector3 {
  return new Vector3(v[0], v[2], -v[1]);
}

export function transformPointToPoly(point: Vector3 | Vector3Tuple, object: Object3D): Vec3 {
  return threeToPolyPoint(object.localToWorld(asVector3(point)));
}

export function transformPolygonsToPoly(polygons: Polygon[], object: Object3D): Polygon[] {
  return polygons.map((polygon) => ({
    ...polygon,
    vertices: polygon.vertices.map((v) => transformPointToPoly(v, object)),
    ...(polygon.textureTriangles?.length
      ? {
          textureTriangles: polygon.textureTriangles.map((triangle) => ({
            ...triangle,
            vertices: triangle.vertices.map((v) => transformPointToPoly(v, object)) as TextureTriangle["vertices"],
          })),
        }
      : null),
  }));
}

function cameraStateFromObject(object: Object3D, zoom: number): CameraState {
  const target = object.lookAtTarget ?? object.position.clone().add(object.worldForward());
  const eye = threeToPolyPoint(object.position);
  const aim = threeToPolyPoint(target);
  const dx = eye[0] - aim[0];
  const dy = eye[1] - aim[1];
  const dz = eye[2] - aim[2];
  const horizontal = Math.hypot(dx, dy) || EPS;

  return {
    target: aim,
    rotX: Math.atan2(horizontal, dz) / DEG,
    rotY: Math.atan2(dy, dx) / DEG,
    zoom,
    distance: Math.hypot(dx, dy, dz) * zoom,
  };
}

function rotateByEuler(v: Vector3, euler: Euler): Vector3 {
  const a = Math.cos(euler.x);
  const b = Math.sin(euler.x);
  const c = Math.cos(euler.y);
  const d = Math.sin(euler.y);
  const e = Math.cos(euler.z);
  const f = Math.sin(euler.z);

  const x = v.x;
  const y = v.y;
  const z = v.z;

  return new Vector3(
    c * e * x - c * f * y + d * z,
    (a * f + b * e * d) * x + (a * e - b * f * d) * y - b * c * z,
    (b * f - a * e * d) * x + (b * e + a * f * d) * y + a * c * z,
  );
}

function perspectiveFromFov(fov: number, viewportHeight: number, zoom = 1): number {
  return (viewportHeight * zoom) / (2 * Math.tan((fov * DEG) / 2));
}

function asVector3(v: Vector3 | Vector3Tuple): Vector3 {
  return v instanceof Vector3 ? v.clone() : new Vector3(v[0], v[1], v[2]);
}

function vectorTuple(v: Vector3 | Vector3Tuple): Vector3Tuple {
  return v instanceof Vector3 ? [v.x, v.y, v.z] : v;
}
