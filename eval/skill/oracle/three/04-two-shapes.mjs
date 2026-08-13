import * as THREE from "three";
import { lights, makeRenderer } from "./_common.mjs";

export function mount(host) {
  const renderer = makeRenderer(host);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(45, 900 / 600, 0.1, 100);
  camera.position.set(0, 6, 12);
  camera.lookAt(0, 0, 0);
  lights(scene);

  const cube = new THREE.Mesh(
    new THREE.BoxGeometry(3.2, 3.2, 3.2),
    new THREE.MeshLambertMaterial({ color: 0x6366f1 }),
  );
  cube.position.x = -3.6;
  scene.add(cube);

  const sphere = new THREE.Mesh(
    new THREE.SphereGeometry(1.9, 32, 16),
    new THREE.MeshLambertMaterial({ color: 0xf43f5e }),
  );
  sphere.position.x = 3.6;
  scene.add(sphere);

  renderer.setAnimationLoop(() => renderer.render(scene, camera));
}
