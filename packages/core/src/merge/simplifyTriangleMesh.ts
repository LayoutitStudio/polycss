import type { Polygon, Vec3 } from "../types";

export interface SimplifyTriangleMeshPolygonsOptions {
  /** Target triangle ratio per eligible connected material group. Default 0.7. */
  ratio?: number;
  /** Maximum accepted local plane displacement in scene units. Default 0.18. */
  maxError?: number;
  /** Reject collapses that rotate any affected face beyond this angle. Default 65. */
  maxNormalAngleDeg?: number;
  /** Only collapse vertices onto existing endpoint positions. Default true. */
  preserveVertices?: boolean;
  /** Use stricter importer source-vertex keys instead of relaxed seam keys. Default "relaxed". */
  vertexKeyMode?: "relaxed" | "source";
  /** Keep topological/material boundary vertices fixed. Default true. */
  lockBoundary?: boolean;
  /** Skip small groups where decimation is unlikely to repay the mutation cost. Default 80. */
  minGroupTriangles?: number;
  /** Hard cap for rebuild passes. Default 12. */
  maxPasses?: number;
}

interface ResolvedSimplifyTriangleMeshPolygonsOptions {
  ratio: number;
  maxError: number;
  maxNormalDot: number;
  preserveVertices: boolean;
  vertexKeyMode: "relaxed" | "source";
  lockBoundary: boolean;
  minGroupTriangles: number;
  maxPasses: number;
}

interface TriangleGroup {
  indices: number[];
  polygons: Polygon[];
}

interface MeshTriangle {
  a: number;
  b: number;
  c: number;
  polygon: Polygon;
  normal: Vec3;
}

interface MutableMesh {
  vertices: Vec3[];
  triangles: MeshTriangle[];
  alive: boolean[];
  vertexTriangles: Set<number>[];
  activeCount: number;
}

interface MeshEdge {
  a: number;
  b: number;
  triangles: number[];
}

interface CollapseCandidate {
  a: number;
  b: number;
  target: Vec3;
  error: number;
  length: number;
}

type Quadric = [
  number, number, number, number,
  number, number, number,
  number, number,
  number,
];

const DEFAULT_OPTIONS: ResolvedSimplifyTriangleMeshPolygonsOptions = {
  ratio: 0.7,
  maxError: 0.18,
  maxNormalDot: Math.cos((65 * Math.PI) / 180),
  preserveVertices: true,
  vertexKeyMode: "relaxed",
  lockBoundary: true,
  minGroupTriangles: 80,
  maxPasses: 12,
};

function resolveOptions(
  options: SimplifyTriangleMeshPolygonsOptions = {},
): ResolvedSimplifyTriangleMeshPolygonsOptions {
  const ratio = Number.isFinite(options.ratio)
    ? Math.max(0.05, Math.min(0.98, options.ratio!))
    : DEFAULT_OPTIONS.ratio;
  const maxError = Number.isFinite(options.maxError) && options.maxError! > 0
    ? options.maxError!
    : DEFAULT_OPTIONS.maxError;
  const maxNormalAngleDeg = Number.isFinite(options.maxNormalAngleDeg)
    ? Math.max(0, Math.min(89, options.maxNormalAngleDeg!))
    : 65;
  return {
    ratio,
    maxError,
    maxNormalDot: Math.cos((maxNormalAngleDeg * Math.PI) / 180),
    preserveVertices: options.preserveVertices ?? DEFAULT_OPTIONS.preserveVertices,
    vertexKeyMode: options.vertexKeyMode ?? DEFAULT_OPTIONS.vertexKeyMode,
    lockBoundary: options.lockBoundary ?? DEFAULT_OPTIONS.lockBoundary,
    minGroupTriangles: Math.max(3, Math.floor(options.minGroupTriangles ?? DEFAULT_OPTIONS.minGroupTriangles)),
    maxPasses: Math.max(1, Math.floor(options.maxPasses ?? DEFAULT_OPTIONS.maxPasses)),
  };
}

function hasTexturePaint(polygon: Polygon): boolean {
  return Boolean(
    polygon.texture ||
    polygon.material?.texture ||
    polygon.uvs?.length ||
    polygon.textureTriangles?.length
  );
}

function eligibleTriangle(polygon: Polygon): boolean {
  return polygon.vertices.length === 3 && !hasTexturePaint(polygon);
}

function materialKey(polygon: Polygon): string {
  return [
    polygon.color ?? "",
    polygon.doubleSided === true ? "2" : "1",
    polygon.material?.key ?? "",
  ].join("\u0000");
}

function vertexKey(vertex: Vec3): string {
  return `${Math.round(vertex[0] * 100000)},${Math.round(vertex[1] * 100000)},${Math.round(vertex[2] * 100000)}`;
}

function simplifyVertexKey(
  polygon: Polygon,
  vertex: Vec3,
  vertexIndex: number,
  options: ResolvedSimplifyTriangleMeshPolygonsOptions,
): string {
  const seamKey = options.vertexKeyMode === "source"
    ? polygon.simplifySourceVertexKeys?.[vertexIndex] ?? polygon.simplifyVertexKeys?.[vertexIndex]
    : polygon.simplifyVertexKeys?.[vertexIndex];
  return seamKey ? `${vertexKey(vertex)}|${seamKey}` : vertexKey(vertex);
}

function addVec(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function subVec(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function mulVec(a: Vec3, scale: number): Vec3 {
  return [a[0] * scale, a[1] * scale, a[2] * scale];
}

function dotVec(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function crossVec(a: Vec3, b: Vec3): Vec3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function lengthVec(a: Vec3): number {
  return Math.hypot(a[0], a[1], a[2]);
}

function distanceVec(a: Vec3, b: Vec3): number {
  return lengthVec(subVec(a, b));
}

function normalizeVec(a: Vec3): Vec3 {
  const length = lengthVec(a);
  return length > 1e-12 ? [a[0] / length, a[1] / length, a[2] / length] : [0, 0, 1];
}

function triangleNormal(vertices: Vec3[], a: number, b: number, c: number): Vec3 {
  return normalizeVec(crossVec(
    subVec(vertices[b]!, vertices[a]!),
    subVec(vertices[c]!, vertices[a]!),
  ));
}

function triangleArea(vertices: Vec3[], a: number, b: number, c: number): number {
  return lengthVec(crossVec(
    subVec(vertices[b]!, vertices[a]!),
    subVec(vertices[c]!, vertices[a]!),
  )) / 2;
}

function emptyQuadric(): Quadric {
  return [0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
}

function addQuadric(into: Quadric, other: Quadric): void {
  for (let i = 0; i < into.length; i += 1) into[i] += other[i]!;
}

function planeQuadric(normal: Vec3, point: Vec3, weight: number): Quadric {
  const a = normal[0];
  const b = normal[1];
  const c = normal[2];
  const d = -dotVec(normal, point);
  return [
    a * a * weight,
    a * b * weight,
    a * c * weight,
    a * d * weight,
    b * b * weight,
    b * c * weight,
    b * d * weight,
    c * c * weight,
    c * d * weight,
    d * d * weight,
  ];
}

function quadricError(q: Quadric, p: Vec3): number {
  const x = p[0];
  const y = p[1];
  const z = p[2];
  return (
    q[0] * x * x +
    2 * q[1] * x * y +
    2 * q[2] * x * z +
    2 * q[3] * x +
    q[4] * y * y +
    2 * q[5] * y * z +
    2 * q[6] * y +
    q[7] * z * z +
    2 * q[8] * z +
    q[9]
  );
}

function solve3x3(
  a00: number, a01: number, a02: number,
  a10: number, a11: number, a12: number,
  a20: number, a21: number, a22: number,
  b0: number, b1: number, b2: number,
): Vec3 | null {
  const det =
    a00 * (a11 * a22 - a12 * a21) -
    a01 * (a10 * a22 - a12 * a20) +
    a02 * (a10 * a21 - a11 * a20);
  if (Math.abs(det) < 1e-10) return null;
  const inv = 1 / det;
  const dx =
    b0 * (a11 * a22 - a12 * a21) -
    a01 * (b1 * a22 - a12 * b2) +
    a02 * (b1 * a21 - a11 * b2);
  const dy =
    a00 * (b1 * a22 - a12 * b2) -
    b0 * (a10 * a22 - a12 * a20) +
    a02 * (a10 * b2 - b1 * a20);
  const dz =
    a00 * (a11 * b2 - b1 * a21) -
    a01 * (a10 * b2 - b1 * a20) +
    b0 * (a10 * a21 - a11 * a20);
  const out: Vec3 = [dx * inv, dy * inv, dz * inv];
  return out.every(Number.isFinite) ? out : null;
}

function optimalPoint(q: Quadric, a: Vec3, b: Vec3, preserveVertices: boolean): Vec3 {
  const solved = solve3x3(
    q[0], q[1], q[2],
    q[1], q[4], q[5],
    q[2], q[5], q[7],
    -q[3], -q[6], -q[8],
  );
  const midpoint = mulVec(addVec(a, b), 0.5);
  const maxDistance = distanceVec(a, b) * 1.35;
  const candidates = preserveVertices
    ? [a, b]
    : [
      a,
      b,
      midpoint,
      ...(solved && distanceVec(solved, midpoint) <= maxDistance ? [solved] : []),
    ];
  let best = candidates[0]!;
  let bestError = quadricError(q, best);
  for (let i = 1; i < candidates.length; i += 1) {
    const candidate = candidates[i]!;
    const error = quadricError(q, candidate);
    if (error < bestError) {
      best = candidate;
      bestError = error;
    }
  }
  return best;
}

function edgeKey(a: number, b: number): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

function triangleKey(a: number, b: number, c: number): string {
  return `${a}|${b}|${c}`;
}

function buildGroupMesh(
  polygons: Polygon[],
  options: ResolvedSimplifyTriangleMeshPolygonsOptions,
): { vertices: Vec3[]; triangles: MeshTriangle[] } {
  const vertexByKey = new Map<string, number>();
  const vertices: Vec3[] = [];
  const triangles: MeshTriangle[] = [];
  for (const polygon of polygons) {
    const indices: number[] = [];
    for (let vertexIndex = 0; vertexIndex < polygon.vertices.length; vertexIndex += 1) {
      const vertex = polygon.vertices[vertexIndex]!;
      const key = simplifyVertexKey(polygon, vertex, vertexIndex, options);
      let index = vertexByKey.get(key);
      if (index === undefined) {
        index = vertices.length;
        vertexByKey.set(key, index);
        vertices.push([...vertex]);
      }
      indices.push(index);
    }
    const [a, b, c] = indices;
    if (a === undefined || b === undefined || c === undefined) continue;
    if (a === b || a === c || b === c) continue;
    triangles.push({
      a,
      b,
      c,
      polygon,
      normal: triangleNormal(vertices, a, b, c),
    });
  }
  return { vertices, triangles };
}

function createMutableMesh(
  polygons: Polygon[],
  options: ResolvedSimplifyTriangleMeshPolygonsOptions,
): MutableMesh {
  const mesh = buildGroupMesh(polygons, options);
  const vertexTriangles = Array.from({ length: mesh.vertices.length }, () => new Set<number>());
  const alive = Array.from({ length: mesh.triangles.length }, () => true);
  for (let index = 0; index < mesh.triangles.length; index += 1) {
    const triangle = mesh.triangles[index]!;
    vertexTriangles[triangle.a]!.add(index);
    vertexTriangles[triangle.b]!.add(index);
    vertexTriangles[triangle.c]!.add(index);
  }
  return {
    vertices: mesh.vertices,
    triangles: mesh.triangles,
    alive,
    vertexTriangles,
    activeCount: mesh.triangles.length,
  };
}

function collectEdges(mesh: MutableMesh): Map<string, MeshEdge> {
  const edges = new Map<string, MeshEdge>();
  const add = (a: number, b: number, triangle: number): void => {
    const key = edgeKey(a, b);
    const current = edges.get(key);
    if (current) {
      current.triangles.push(triangle);
    } else {
      edges.set(key, {
        a: Math.min(a, b),
        b: Math.max(a, b),
        triangles: [triangle],
      });
    }
  };
  for (let i = 0; i < mesh.triangles.length; i += 1) {
    if (!mesh.alive[i]) continue;
    const triangle = mesh.triangles[i]!;
    add(triangle.a, triangle.b, i);
    add(triangle.b, triangle.c, i);
    add(triangle.c, triangle.a, i);
  }
  return edges;
}

function collectQuadrics(mesh: MutableMesh): Quadric[] {
  const quadrics = Array.from({ length: mesh.vertices.length }, () => emptyQuadric());
  for (let index = 0; index < mesh.triangles.length; index += 1) {
    if (!mesh.alive[index]) continue;
    const triangle = mesh.triangles[index]!;
    const area = Math.max(1e-6, triangleArea(mesh.vertices, triangle.a, triangle.b, triangle.c));
    const q = planeQuadric(triangle.normal, mesh.vertices[triangle.a]!, Math.sqrt(area));
    addQuadric(quadrics[triangle.a]!, q);
    addQuadric(quadrics[triangle.b]!, q);
    addQuadric(quadrics[triangle.c]!, q);
  }
  return quadrics;
}

function collectAffectedTriangleIndices(mesh: MutableMesh, a: number, b: number): number[] {
  const out = new Set<number>();
  const add = (vertex: number): void => {
    const triangles = mesh.vertexTriangles[vertex];
    if (!triangles) return;
    for (const triangle of triangles) {
      if (mesh.alive[triangle]) out.add(triangle);
    }
  };
  add(a);
  add(b);
  return Array.from(out).sort((left, right) => left - right);
}

function activeEdgeTriangleCount(mesh: MutableMesh, a: number, b: number): number {
  const aTriangles = mesh.vertexTriangles[a];
  const bTriangles = mesh.vertexTriangles[b];
  if (!aTriangles || !bTriangles) return 0;
  const [small, large] = aTriangles.size <= bTriangles.size
    ? [aTriangles, bTriangles]
    : [bTriangles, aTriangles];
  let count = 0;
  for (const triangle of small) {
    if (mesh.alive[triangle] && large.has(triangle)) count += 1;
  }
  return count;
}

function replacedTriangle(triangle: MeshTriangle, a: number, b: number): [number, number, number] {
  return [
    triangle.a === b ? a : triangle.a,
    triangle.b === b ? a : triangle.b,
    triangle.c === b ? a : triangle.c,
  ];
}

function candidateIsValid(
  mesh: MutableMesh,
  candidate: CollapseCandidate,
  options: ResolvedSimplifyTriangleMeshPolygonsOptions,
): number[] | null {
  if (activeEdgeTriangleCount(mesh, candidate.a, candidate.b) !== 2) return null;
  const affected = collectAffectedTriangleIndices(mesh, candidate.a, candidate.b);
  if (affected.length === 0) return null;

  const previous = mesh.vertices[candidate.a]!;
  mesh.vertices[candidate.a] = candidate.target;
  let kept = 0;
  let valid = true;
  for (const triangleIndex of affected) {
    const triangle = mesh.triangles[triangleIndex]!;
    const [a, b, c] = replacedTriangle(triangle, candidate.a, candidate.b);
    if (a === b || a === c || b === c) continue;
    const area = triangleArea(mesh.vertices, a, b, c);
    if (area <= 1e-8) {
      valid = false;
      break;
    }
    const nextNormal = triangleNormal(mesh.vertices, a, b, c);
    if (dotVec(triangle.normal, nextNormal) < options.maxNormalDot) {
      valid = false;
      break;
    }
    const planePoint = triangle.a === candidate.a ? previous : mesh.vertices[triangle.a]!;
    const planeOffset = Math.abs(dotVec(triangle.normal, subVec(candidate.target, planePoint)));
    if (planeOffset > options.maxError) {
      valid = false;
      break;
    }
    kept += 1;
  }
  mesh.vertices[candidate.a] = previous;
  return valid && kept > 0 ? affected : null;
}

function removeTriangleFromVertices(mesh: MutableMesh, triangleIndex: number, triangle: MeshTriangle): void {
  mesh.vertexTriangles[triangle.a]?.delete(triangleIndex);
  mesh.vertexTriangles[triangle.b]?.delete(triangleIndex);
  mesh.vertexTriangles[triangle.c]?.delete(triangleIndex);
}

function addTriangleToVertices(mesh: MutableMesh, triangleIndex: number, triangle: MeshTriangle): void {
  mesh.vertexTriangles[triangle.a]!.add(triangleIndex);
  mesh.vertexTriangles[triangle.b]!.add(triangleIndex);
  mesh.vertexTriangles[triangle.c]!.add(triangleIndex);
}

function collapseCandidateInPlace(
  mesh: MutableMesh,
  candidate: CollapseCandidate,
  affected: number[],
): void {
  mesh.vertices[candidate.a] = candidate.target;
  const seen = new Set<string>();
  for (const triangleIndex of affected) {
    if (!mesh.alive[triangleIndex]) continue;
    const triangle = mesh.triangles[triangleIndex]!;
    const [a, b, c] = replacedTriangle(triangle, candidate.a, candidate.b);
    removeTriangleFromVertices(mesh, triangleIndex, triangle);
    if (a === b || a === c || b === c) {
      mesh.alive[triangleIndex] = false;
      mesh.activeCount -= 1;
      continue;
    }
    const key = triangleKey(a, b, c);
    if (seen.has(key)) {
      mesh.alive[triangleIndex] = false;
      mesh.activeCount -= 1;
      continue;
    }
    seen.add(key);
    const next = {
      ...triangle,
      a,
      b,
      c,
      normal: triangleNormal(mesh.vertices, a, b, c),
    };
    mesh.triangles[triangleIndex] = next;
    addTriangleToVertices(mesh, triangleIndex, next);
  }
}

function buildCandidates(
  mesh: MutableMesh,
  options: ResolvedSimplifyTriangleMeshPolygonsOptions,
): CollapseCandidate[] {
  const edges = collectEdges(mesh);
  const lockedVertices = new Set<number>();
  for (const edge of edges.values()) {
    if (edge.triangles.length > 2) {
      lockedVertices.add(edge.a);
      lockedVertices.add(edge.b);
    }
  }
  if (options.lockBoundary) {
    for (const edge of edges.values()) {
      if (edge.triangles.length !== 1) continue;
      lockedVertices.add(edge.a);
      lockedVertices.add(edge.b);
    }
  }

  const quadrics = collectQuadrics(mesh);
  const maxQuadricError = options.maxError * options.maxError;
  const candidates: CollapseCandidate[] = [];
  for (const edge of edges.values()) {
    if (edge.triangles.length !== 2) continue;
    if (lockedVertices.has(edge.a) || lockedVertices.has(edge.b)) continue;
    const q = [...quadrics[edge.a]!] as Quadric;
    addQuadric(q, quadrics[edge.b]!);
    const target = optimalPoint(q, mesh.vertices[edge.a]!, mesh.vertices[edge.b]!, options.preserveVertices);
    const error = Math.max(0, quadricError(q, target));
    if (error > maxQuadricError * Math.max(1, edge.triangles.length)) continue;
    const length = distanceVec(mesh.vertices[edge.a]!, mesh.vertices[edge.b]!);
    candidates.push({ a: edge.a, b: edge.b, target, error, length });
  }
  candidates.sort((a, b) => a.error - b.error || a.length - b.length);
  return candidates;
}

function activeTriangles(mesh: MutableMesh): MeshTriangle[] {
  const out: MeshTriangle[] = [];
  for (let index = 0; index < mesh.triangles.length; index += 1) {
    if (mesh.alive[index]) out.push(mesh.triangles[index]!);
  }
  return out;
}

function simplifyGroup(
  polygons: Polygon[],
  options: ResolvedSimplifyTriangleMeshPolygonsOptions,
): Polygon[] {
  if (polygons.length < options.minGroupTriangles) return polygons;
  const mesh = createMutableMesh(polygons, options);
  const sourceCount = mesh.activeCount;
  if (sourceCount < options.minGroupTriangles) return polygons;
  const targetCount = Math.max(1, Math.floor(sourceCount * options.ratio));
  if (targetCount >= sourceCount) return polygons;

  let accepted = 0;
  for (let pass = 0; pass < options.maxPasses && mesh.activeCount > targetCount; pass += 1) {
    const candidates = buildCandidates(mesh, options);
    if (candidates.length === 0) break;
    let passAccepted = 0;
    for (const candidate of candidates) {
      if (mesh.activeCount <= targetCount) break;
      const affected = candidateIsValid(mesh, candidate, options);
      if (!affected) continue;
      const beforeCount = mesh.activeCount;
      collapseCandidateInPlace(mesh, candidate, affected);
      if (mesh.activeCount >= beforeCount) continue;
      accepted += 1;
      passAccepted += 1;
    }
    if (passAccepted === 0) break;
  }
  if (accepted === 0 || mesh.activeCount >= sourceCount) return polygons;

  return activeTriangles(mesh).map((triangle) => ({
    ...triangle.polygon,
    vertices: [
      [...mesh.vertices[triangle.a]!] as Vec3,
      [...mesh.vertices[triangle.b]!] as Vec3,
      [...mesh.vertices[triangle.c]!] as Vec3,
    ],
  }));
}

function collectGroups(polygons: Polygon[]): Map<string, TriangleGroup> {
  const groups = new Map<string, TriangleGroup>();
  for (let index = 0; index < polygons.length; index += 1) {
    const polygon = polygons[index]!;
    if (!eligibleTriangle(polygon)) continue;
    const key = materialKey(polygon);
    const group = groups.get(key);
    if (group) {
      group.indices.push(index);
      group.polygons.push(polygon);
    } else {
      groups.set(key, { indices: [index], polygons: [polygon] });
    }
  }
  return groups;
}

/**
 * Import-time triangle decimation for already-solid meshes.
 *
 * This is deliberately conservative: textured polygons and material/color
 * boundaries are kept out of the collapse graph, endpoint-preserving collapses
 * mirror meshoptimizer's index-buffer simplification shape by default, and
 * callers can cheaply compare the returned candidate against their normal
 * render-cost optimizer before accepting it.
 */
export function simplifyTriangleMeshPolygons(
  polygons: Polygon[],
  options?: SimplifyTriangleMeshPolygonsOptions,
): Polygon[] {
  const resolved = resolveOptions(options);
  const groups = collectGroups(polygons);
  if (groups.size === 0) return polygons;

  const replacements = new Map<number, Polygon[]>();
  let changed = false;
  for (const group of groups.values()) {
    const simplified = simplifyGroup(group.polygons, resolved);
    if (simplified === group.polygons || simplified.length >= group.polygons.length) continue;
    replacements.set(group.indices[0]!, simplified);
    for (let i = 1; i < group.indices.length; i += 1) replacements.set(group.indices[i]!, []);
    changed = true;
  }
  if (!changed) return polygons;

  const out: Polygon[] = [];
  for (let index = 0; index < polygons.length; index += 1) {
    const replacement = replacements.get(index);
    if (replacement) out.push(...replacement);
    else if (replacement === undefined) out.push(polygons[index]!);
  }
  return out;
}
