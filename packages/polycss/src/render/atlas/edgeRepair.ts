import type { Polygon } from "@layoutit/polycss-core";
import type { Vec3 } from "@layoutit/polycss-core";

function pointKey(point: Vec3): string {
  return `${point[0]},${point[1]},${point[2]}`;
}

function edgeKey(a: Vec3, b: Vec3): string {
  const ak = pointKey(a);
  const bk = pointKey(b);
  return ak < bk ? `${ak}|${bk}` : `${bk}|${ak}`;
}

export function buildTextureEdgeRepairSets(polygons: Polygon[]): Array<Set<number> | undefined> {
  const edgeOwners = new Map<string, Array<{ polygon: number; edge: number }>>();
  for (let polygonIndex = 0; polygonIndex < polygons.length; polygonIndex++) {
    const vertices = polygons[polygonIndex].vertices;
    if (!vertices || vertices.length < 3 || !polygons[polygonIndex].texture) continue;
    for (let edgeIndex = 0; edgeIndex < vertices.length; edgeIndex++) {
      const key = edgeKey(vertices[edgeIndex], vertices[(edgeIndex + 1) % vertices.length]);
      const owners = edgeOwners.get(key);
      const owner = { polygon: polygonIndex, edge: edgeIndex };
      if (owners) owners.push(owner);
      else edgeOwners.set(key, [owner]);
    }
  }
  const repairEdges = polygons.map(() => new Set<number>());
  for (const owners of edgeOwners.values()) {
    if (owners.length < 2) continue;
    for (let i = 0; i < owners.length; i++) {
      for (let j = i + 1; j < owners.length; j++) {
        repairEdges[owners[i].polygon].add(owners[i].edge);
        repairEdges[owners[j].polygon].add(owners[j].edge);
      }
    }
  }
  return repairEdges.map((edges) => edges.size > 0 ? edges : undefined);
}
