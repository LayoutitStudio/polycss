import type { PolyMeshHandle } from "./createPolyScene";

export function pointInMeshElement(
  meshEl: HTMLElement,
  clientX: number,
  clientY: number,
): boolean {
  const polys = Array.from(meshEl.querySelectorAll("i,b,s,u")) as HTMLElement[];
  for (const p of polys) {
    const r = p.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) continue;
    if (
      clientX >= r.left &&
      clientX <= r.right &&
      clientY >= r.top &&
      clientY <= r.bottom
    ) {
      return true;
    }
  }
  return false;
}

export function findMeshUnderPoint(
  meshes: Iterable<PolyMeshHandle>,
  clientX: number,
  clientY: number,
  filter?: (mesh: PolyMeshHandle) => boolean,
): PolyMeshHandle | null {
  for (const mesh of meshes) {
    if (filter && !filter(mesh)) continue;
    if (pointInMeshElement(mesh.element, clientX, clientY)) return mesh;
  }
  return null;
}
