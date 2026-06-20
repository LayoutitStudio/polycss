/**
 * Bench entry — shared scene geometry for shadow-parity.html, so every pane
 * (vanilla / React / Vue) renders byte-identical polygons. Bundled into
 * bench/.generated/parity-meshes.js.
 */
import { boxPolygons } from "@layoutit/polycss-core";
import type { Polygon } from "@layoutit/polycss-core";

/** Unit-2 cube centered at the origin (sit it on the floor with position z=1). */
export function cubePolygons(color = "#dc2626"): Polygon[] {
  return boxPolygons({ size: 2 }).map((p) => ({ ...p, color }));
}

/** Flat square floor on z=0. */
export function floorPolygons(size = 20, color = "#cbd5e1"): Polygon[] {
  const h = size / 2;
  return [
    {
      vertices: [
        [-h, -h, 0],
        [h, -h, 0],
        [h, h, 0],
        [-h, h, 0],
      ],
      color,
    },
  ];
}
