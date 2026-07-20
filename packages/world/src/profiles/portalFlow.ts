import type { Vec3 } from "@layoutit/polycss-core";
import type {
  PolyWorldBounds,
  PolyWorldData,
  PolyWorldLink,
  PolyWorldSelection,
  PolyWorldSelectionReason,
  PolyWorldTopology,
} from "../topology";
import { resolvePolyWorldRegionByPoint } from "../topology";
import type {
  PolyWorldPortalLinkState,
  PolyWorldPortalLinkStateContext,
  PolyWorldPortalReasonLabels,
  PolyWorldRegionSelectionKeys,
} from "./portal";
import { resolvePolyWorldRegionSelectionKeys } from "./portal";
import {
  crossVec3,
  dotVec3,
  normalizeVec3OrUndefined,
  scaleVec3,
  subtractVec3,
} from "./bspGeometry";

interface PolyWorldPortalFlowClipPlane {
  normal: Vec3;
  distance: number;
}

export type PolyWorldPortalFlowTraceStatus =
  | "visible"
  | "outside-broad-phase"
  | "closed"
  | "blocked"
  | "depth-capped"
  | "missing-link"
  | "missing-portal"
  | "degenerate-portal"
  | "clipped";

export interface PolyWorldPortalFlowPortal {
  id: string;
  linkId: string;
  bounds?: PolyWorldBounds;
  vertices?: readonly Vec3[];
  selectionKeys?: readonly string[];
  data?: PolyWorldData;
}

export interface PolyWorldPortalFlowOptions {
  point: Vec3;
  currentRegionId?: string;
  forward: Vec3;
  up?: Vec3;
  aspect?: number;
  fovDegrees?: number;
  near?: number;
  far?: number;
  maxDepth?: number;
  portals?: readonly PolyWorldPortalFlowPortal[];
  broadRegionIds?: readonly string[];
  portalState?: PolyWorldPortalLinkState;
  includeTrace?: boolean;
  regionSelectionKeys?: PolyWorldRegionSelectionKeys;
  reasonLabels?: PolyWorldPortalReasonLabels;
  reasons?: readonly PolyWorldSelectionReason[];
  data?: PolyWorldData;
}

export interface PolyWorldPortalFlowTraceEntry {
  portalId: string;
  linkId: string;
  fromRegionId: string;
  toRegionId: string;
  depth: number;
  status: PolyWorldPortalFlowTraceStatus;
  inputVertexCount: number;
  clippedVertexCount?: number;
  clipPlaneCount?: number;
  selectionKeys?: readonly string[];
}

export interface PolyWorldPortalFlow {
  currentRegionId?: string;
  regionIds: readonly string[];
  linkIds: readonly string[];
  portalIds: readonly string[];
  selectionKeys: readonly string[];
  selection: PolyWorldSelection;
  trace?: readonly PolyWorldPortalFlowTraceEntry[];
}

export function resolvePolyWorldPortalFlow(
  topology: PolyWorldTopology,
  options: PolyWorldPortalFlowOptions,
): PolyWorldPortalFlow {
  const labels = {
    current: "current",
    visible: "visible",
    link: "link",
    closed: "closed",
    blocked: "blocked",
    selectionKey: "selection-key",
    ...options.reasonLabels,
  };
  const currentRegionId = options.currentRegionId
    ?? resolvePolyWorldRegionByPoint(topology, options.point, { nearest: true })?.regionId;
  const regionIds: string[] = [];
  const linkIds: string[] = [];
  const portalIds: string[] = [];
  const selectionKeys: string[] = [];
  const reasons: PolyWorldSelectionReason[] = [...(options.reasons ?? [])];
  const trace: PolyWorldPortalFlowTraceEntry[] = [];

  if (currentRegionId === undefined || !topology.regionsById.has(currentRegionId)) {
    return {
      currentRegionId,
      regionIds,
      linkIds,
      portalIds,
      selectionKeys,
      selection: { regionIds, linkIds, selectionKeys, reasons, data: options.data },
      ...(options.includeTrace === true ? { trace } : {}),
    };
  }

  add(regionIds, currentRegionId);
  reasons.push({
    id: "poly-world-portal-flow-current",
    kind: "current",
    label: labels.current,
    regionIds: [currentRegionId],
  });

  const initialClip = createPortalFlowFrustumClip(options);
  const broadRegionIds = options.broadRegionIds === undefined ? undefined : new Set(options.broadRegionIds);
  const maxDepth = options.maxDepth ?? 8;
  const portalsByLinkId = new Map((options.portals ?? []).map((portal) => [portal.linkId, portal]));
  const visited = new Set<string>([currentRegionId]);
  const queue: Array<{ regionId: string; depth: number; clipPlanes: readonly PolyWorldPortalFlowClipPlane[] }> = [
    { regionId: currentRegionId, depth: 0, clipPlanes: initialClip },
  ];

  while (queue.length > 0) {
    const item = queue.shift();
    if (item === undefined) break;
    for (const link of topology.linksByRegionId.get(item.regionId) ?? []) {
      const toRegionId = linkedRegionId(link, item.regionId);
      if (toRegionId === undefined) continue;
      if (visited.has(toRegionId)) continue;
      const portal = portalsByLinkId.get(link.id);
      const traceBase = {
        portalId: portal?.id ?? link.id,
        linkId: link.id,
        fromRegionId: item.regionId,
        toRegionId,
        depth: item.depth + 1,
      };

      if (broadRegionIds !== undefined && !broadRegionIds.has(toRegionId)) {
        trace.push({
          ...traceBase,
          status: "outside-broad-phase",
          inputVertexCount: portal?.vertices?.length ?? 0,
        });
        continue;
      }
      const state = resolvePortalFlowLinkState(options.portalState, link, item.regionId, toRegionId, item.depth + 1, topology);
      if (state === "closed") {
        trace.push({ ...traceBase, status: "closed", inputVertexCount: portal?.vertices?.length ?? 0 });
        continue;
      }
      if (state === "blocked") {
        trace.push({ ...traceBase, status: "blocked", inputVertexCount: portal?.vertices?.length ?? 0 });
        continue;
      }
      if (item.depth >= maxDepth) {
        trace.push({ ...traceBase, status: "depth-capped", inputVertexCount: portal?.vertices?.length ?? 0 });
        continue;
      }
      if (portal === undefined) {
        trace.push({ ...traceBase, status: "missing-portal", inputVertexCount: 0 });
        continue;
      }
      const vertices = resolvePortalFlowPortalVertices(portal);
      if (vertices.length < 3) {
        trace.push({ ...traceBase, status: "degenerate-portal", inputVertexCount: vertices.length });
        continue;
      }
      const clipped = clipPortalFlowPolygon(vertices, item.clipPlanes);
      if (clipped.length < 3) {
        trace.push({
          ...traceBase,
          status: "clipped",
          inputVertexCount: vertices.length,
          clippedVertexCount: clipped.length,
          clipPlaneCount: item.clipPlanes.length,
          selectionKeys: portal.selectionKeys,
        });
        continue;
      }

      add(regionIds, toRegionId);
      add(linkIds, link.id);
      add(portalIds, portal.id);
      for (const selectionKey of link.selectionKeys ?? []) add(selectionKeys, selectionKey);
      for (const selectionKey of portal.selectionKeys ?? []) add(selectionKeys, selectionKey);
      trace.push({
        ...traceBase,
        status: "visible",
        inputVertexCount: vertices.length,
        clippedVertexCount: clipped.length,
        clipPlaneCount: item.clipPlanes.length,
        selectionKeys: portal.selectionKeys,
      });
      if (!visited.has(toRegionId)) {
        visited.add(toRegionId);
        queue.push({
          regionId: toRegionId,
          depth: item.depth + 1,
          clipPlanes: [...item.clipPlanes, ...createPortalFlowPortalClipPlanes(options.point, clipped)],
        });
      }
    }
  }

  for (const regionId of regionIds) {
    const region = topology.regionsById.get(regionId);
    for (const selectionKey of region?.selectionKeys ?? []) add(selectionKeys, selectionKey);
    for (const selectionKey of resolvePolyWorldRegionSelectionKeys(options.regionSelectionKeys, regionId, topology)) {
      add(selectionKeys, selectionKey);
    }
  }
  if (regionIds.length > 0) {
    reasons.push({
      id: "poly-world-portal-flow-visible",
      kind: "visible",
      label: labels.visible,
      regionIds,
      linkIds,
    });
  }
  const closedLinkIds = trace.filter((entry) => entry.status === "closed").map((entry) => entry.linkId);
  if (closedLinkIds.length > 0) {
    reasons.push({
      id: "poly-world-portal-flow-closed",
      kind: "closed",
      label: labels.closed,
      linkIds: unique(closedLinkIds),
    });
  }
  const blockedLinkIds = trace.filter((entry) => entry.status === "blocked").map((entry) => entry.linkId);
  if (blockedLinkIds.length > 0) {
    reasons.push({
      id: "poly-world-portal-flow-blocked",
      kind: "blocked",
      label: labels.blocked,
      linkIds: unique(blockedLinkIds),
    });
  }
  if (selectionKeys.length > 0) {
    reasons.push({
      id: "poly-world-portal-flow-selection-key",
      kind: "selectionKey",
      label: labels.selectionKey,
      selectionKeys,
    });
  }

  return {
    currentRegionId,
    regionIds,
    linkIds,
    portalIds,
    selectionKeys,
    selection: {
      regionIds,
      linkIds,
      selectionKeys,
      reasons,
      data: options.data,
    },
    ...(options.includeTrace === true ? { trace } : {}),
  };
}

function createPortalFlowFrustumClip(options: PolyWorldPortalFlowOptions): PolyWorldPortalFlowClipPlane[] {
  const point = options.point;
  const forward = normalizeVec3OrUndefined(options.forward) ?? [1, 0, 0];
  const up = normalizeVec3OrUndefined(options.up ?? [0, 0, 1]) ?? [0, 0, 1];
  const right = normalizeVec3OrUndefined(crossVec3(forward, up)) ?? [0, -1, 0];
  const resolvedUp = normalizeVec3OrUndefined(crossVec3(right, forward)) ?? up;
  const fov = ((options.fovDegrees ?? 90) * Math.PI) / 180;
  const near = Math.max(0.001, options.near ?? 0.01);
  const far = Math.max(near, options.far ?? 1000);
  const halfHeight = Math.tan(fov / 2) * near;
  const halfWidth = halfHeight * (options.aspect ?? 1);
  const center = addVec3(point, scaleVec3(forward, near));
  const topLeft = addVec3(addVec3(center, scaleVec3(resolvedUp, halfHeight)), scaleVec3(right, -halfWidth));
  const topRight = addVec3(addVec3(center, scaleVec3(resolvedUp, halfHeight)), scaleVec3(right, halfWidth));
  const bottomLeft = addVec3(addVec3(center, scaleVec3(resolvedUp, -halfHeight)), scaleVec3(right, -halfWidth));
  const bottomRight = addVec3(addVec3(center, scaleVec3(resolvedUp, -halfHeight)), scaleVec3(right, halfWidth));
  const planes = [
    planeFromPointNormal(addVec3(point, scaleVec3(forward, near)), forward),
    planeFromPointNormal(addVec3(point, scaleVec3(forward, far)), scaleVec3(forward, -1)),
    planeFromTriangle(point, bottomLeft, topLeft),
    planeFromTriangle(point, topRight, bottomRight),
    planeFromTriangle(point, topLeft, topRight),
    planeFromTriangle(point, bottomRight, bottomLeft),
  ].filter((plane): plane is PolyWorldPortalFlowClipPlane => plane !== undefined);
  return planes;
}

function createPortalFlowPortalClipPlanes(
  origin: Vec3,
  vertices: readonly Vec3[],
): PolyWorldPortalFlowClipPlane[] {
  const centroid = vertices.reduce<Vec3>((sum, vertex) => [
    sum[0] + vertex[0] / vertices.length,
    sum[1] + vertex[1] / vertices.length,
    sum[2] + vertex[2] / vertices.length,
  ], [0, 0, 0]);
  const planes: PolyWorldPortalFlowClipPlane[] = [];
  for (let index = 0; index < vertices.length; index += 1) {
    const a = vertices[index] ?? vertices[0];
    const b = vertices[(index + 1) % vertices.length] ?? a;
    const plane = planeFromTriangle(origin, a, b);
    if (plane === undefined) continue;
    if (signedDistance(plane, centroid) < 0) {
      planes.push({ normal: scaleVec3(plane.normal, -1), distance: -plane.distance });
      continue;
    }
    planes.push(plane);
  }
  return planes;
}

function clipPortalFlowPolygon(
  vertices: readonly Vec3[],
  planes: readonly PolyWorldPortalFlowClipPlane[],
): Vec3[] {
  let output = vertices.map((vertex) => [...vertex] as Vec3);
  for (const plane of planes) {
    if (output.length === 0) break;
    const input = output;
    output = [];
    for (let index = 0; index < input.length; index += 1) {
      const current = input[index] ?? input[0];
      const previous = input[(index + input.length - 1) % input.length] ?? current;
      const currentInside = signedDistance(plane, current) >= -0.0001;
      const previousInside = signedDistance(plane, previous) >= -0.0001;
      if (currentInside !== previousInside) {
        output.push(intersectPortalFlowSegmentPlane(previous, current, plane));
      }
      if (currentInside) output.push(current);
    }
  }
  return output;
}

function resolvePortalFlowPortalVertices(portal: PolyWorldPortalFlowPortal): Vec3[] {
  if (portal.vertices !== undefined) return portal.vertices.map((vertex) => [...vertex] as Vec3);
  if (portal.bounds === undefined) return [];
  return verticesFromPortalFlowBounds(portal.bounds);
}

function verticesFromPortalFlowBounds(bounds: PolyWorldBounds): Vec3[] {
  const epsilon = 0.0001;
  const zeroAxes = ([0, 1, 2] as const).filter((axis) => Math.abs(bounds.max[axis] - bounds.min[axis]) <= epsilon);
  if (zeroAxes.length !== 1) return [];
  const planeAxis = zeroAxes[0] ?? 0;
  const [a, b] = ([0, 1, 2] as const).filter((axis) => axis !== planeAxis);
  const makePoint = (va: number, vb: number): Vec3 => {
    const point = [0, 0, 0] as Vec3;
    point[planeAxis] = bounds.min[planeAxis];
    point[a] = va;
    point[b] = vb;
    return point;
  };
  return [
    makePoint(bounds.min[a], bounds.min[b]),
    makePoint(bounds.max[a], bounds.min[b]),
    makePoint(bounds.max[a], bounds.max[b]),
    makePoint(bounds.min[a], bounds.max[b]),
  ];
}

function resolvePortalFlowLinkState(
  state: PolyWorldPortalLinkState | undefined,
  link: PolyWorldLink,
  fromRegionId: string,
  toRegionId: string,
  depth: number,
  topology: PolyWorldTopology,
): "open" | "closed" | "blocked" {
  const value = typeof state === "function"
    ? state({ link, fromRegionId, toRegionId, depth, topology } satisfies PolyWorldPortalLinkStateContext)
    : state?.[link.id];
  if (value === false || value === "closed") return "closed";
  if (value === "blocked") return "blocked";
  return "open";
}

function linkedRegionId(link: PolyWorldLink, regionId: string): string | undefined {
  if (link.fromRegionId === regionId) return link.toRegionId;
  if (link.direction === "forward") return undefined;
  if (link.toRegionId === regionId) return link.fromRegionId;
  return undefined;
}

function planeFromTriangle(a: Vec3, b: Vec3, c: Vec3): PolyWorldPortalFlowClipPlane | undefined {
  const normal = normalizeVec3OrUndefined(crossVec3(subtractVec3(b, a), subtractVec3(c, a)));
  if (normal === undefined) return undefined;
  return planeFromPointNormal(a, normal);
}

function planeFromPointNormal(point: Vec3, normal: Vec3): PolyWorldPortalFlowClipPlane {
  return { normal, distance: dotVec3(normal, point) };
}

function signedDistance(plane: PolyWorldPortalFlowClipPlane, point: Vec3): number {
  return dotVec3(plane.normal, point) - plane.distance;
}

function intersectPortalFlowSegmentPlane(a: Vec3, b: Vec3, plane: PolyWorldPortalFlowClipPlane): Vec3 {
  const da = signedDistance(plane, a);
  const db = signedDistance(plane, b);
  const t = da / (da - db || 1);
  return [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
  ];
}

function addVec3(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function add(values: string[], value: string): void {
  if (!values.includes(value)) values.push(value);
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}
