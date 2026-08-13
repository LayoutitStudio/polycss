import { createPolyCamera, createPolyScene } from "@layoutit/polycss";

const COLOR = "#84cc16";
const SIZE = 70;
const GAP = 12;

/**
 * One flat tile on z = 0, wound counter-clockwise seen from +Z so its normal
 * points up at the camera. Reversing any of these four vertex orders flips the
 * normal and the tile is backface-culled — it paints nothing.
 */
function tile(cx, cy) {
  const h = SIZE / 2;
  return {
    vertices: [
      [cx - h, cy - h, 0],
      [cx + h, cy - h, 0],
      [cx + h, cy + h, 0],
      [cx - h, cy + h, 0],
    ],
    color: COLOR,
  };
}

const step = SIZE + GAP;
const polygons = [
  tile(-step / 2, -step / 2),
  tile(step / 2, -step / 2),
  tile(step / 2, step / 2),
  tile(-step / 2, step / 2),
];

export function mount(host) {
  const camera = createPolyCamera({ rotX: 58, rotY: 45, zoom: 2.4 });
  const scene = createPolyScene(host, {
    camera,
    directionalLight: { direction: [0.5, -0.6, 0.7], color: "#ffffff", intensity: 1 },
    ambientLight: { color: "#ffffff", intensity: 0.45 },
  });

  scene.add({ polygons, objectUrls: [], warnings: [], dispose: () => {} }, { merge: false });
  return scene;
}
