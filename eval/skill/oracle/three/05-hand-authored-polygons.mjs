import * as THREE from "three";
import { lights, makeRenderer } from "./_common.mjs";

const SIZE = 2.6;
const GAP = 0.45;

/** One flat tile, wound counter-clockwise seen from above. */
function tile(cx, cz) {
  const h = SIZE / 2;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(
      [
        cx - h, 0, cz + h,
        cx + h, 0, cz + h,
        cx + h, 0, cz - h,
        cx - h, 0, cz + h,
        cx + h, 0, cz - h,
        cx - h, 0, cz - h,
      ],
      3,
    ),
  );
  geometry.computeVertexNormals();
  return geometry;
}

export function mount(host) {
  const renderer = makeRenderer(host);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(45, 900 / 600, 0.1, 100);
  camera.position.set(0, 8, 8);
  camera.lookAt(0, 0, 0);
  lights(scene);

  const material = new THREE.MeshLambertMaterial({ color: 0x84cc16 });
  const step = SIZE + GAP;
  for (const [x, z] of [
    [-step / 2, -step / 2],
    [step / 2, -step / 2],
    [step / 2, step / 2],
    [-step / 2, step / 2],
  ]) {
    scene.add(new THREE.Mesh(tile(x, z), material));
  }

  renderer.setAnimationLoop(() => renderer.render(scene, camera));
}
