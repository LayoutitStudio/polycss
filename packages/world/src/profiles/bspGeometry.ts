import type { Vec3 } from "@layoutit/polycss-core";

export const polyWorldBspEpsilon = 0.0001;

export interface PolyWorldBspGeometryPlane {
  normal: Vec3;
  distance: number;
}

export function signedPlaneDistance(plane: PolyWorldBspGeometryPlane, point: Vec3): number {
  return dotVec3(plane.normal, point) - plane.distance;
}

export function dotVec3(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

export function crossVec3(a: Vec3, b: Vec3): Vec3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

export function addVec3(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

export function subtractVec3(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

export function scaleVec3(value: Vec3, scale: number): Vec3 {
  return [value[0] * scale, value[1] * scale, value[2] * scale];
}

export function lerpVec3(a: Vec3, b: Vec3, t: number): Vec3 {
  return [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
  ];
}

export function lengthSqVec3(value: Vec3): number {
  return dotVec3(value, value);
}

export function normalizeVec3OrZero(value: Vec3, epsilon = 0): Vec3 {
  const length = Math.sqrt(lengthSqVec3(value));
  if (length <= epsilon) return [0, 0, 0];
  return [value[0] / length, value[1] / length, value[2] / length];
}

export function normalizeVec3OrUndefined(value: Vec3, epsilon = 0.000001): Vec3 | undefined {
  const length = Math.hypot(value[0], value[1], value[2]);
  if (length <= epsilon) return undefined;
  return [value[0] / length, value[1] / length, value[2] / length];
}

export function averageVec3(values: readonly Vec3[]): Vec3 {
  if (values.length === 0) return [0, 0, 0];
  const sum = values.reduce<Vec3>((acc, value) => [
    acc[0] + value[0],
    acc[1] + value[1],
    acc[2] + value[2],
  ], [0, 0, 0]);
  return [sum[0] / values.length, sum[1] / values.length, sum[2] / values.length];
}

export function polygonAreaNormal(vertices: readonly Vec3[]): Vec3 {
  return vertices.reduce<Vec3>((acc, vertex, index) => {
    const next = vertices[(index + 1) % vertices.length] ?? vertex;
    return addVec3(acc, crossVec3(vertex, next));
  }, [0, 0, 0]);
}

export function uniqueVec3(values: readonly Vec3[], epsilon = polyWorldBspEpsilon): Vec3[] {
  const result: Vec3[] = [];
  for (const value of values) {
    if (!result.some((existing) => sameVec3(existing, value, epsilon))) {
      result.push([...value] as Vec3);
    }
  }
  return result;
}

export function sameVec3(a: Vec3, b: Vec3, epsilon = polyWorldBspEpsilon): boolean {
  return (
    Math.abs(a[0] - b[0]) <= epsilon &&
    Math.abs(a[1] - b[1]) <= epsilon &&
    Math.abs(a[2] - b[2]) <= epsilon
  );
}
