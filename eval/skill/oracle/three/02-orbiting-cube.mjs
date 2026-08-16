import * as THREE from "three";
import { lights, makeRenderer } from "./_common.mjs";

export function mount(host) {
  const renderer = makeRenderer(host);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(45, 900 / 600, 0.1, 100);
  lights(scene);

  scene.add(
    new THREE.Mesh(
      new THREE.BoxGeometry(4, 4, 4),
      new THREE.MeshLambertMaterial({ color: 0x14b8a6 }),
    ),
  );

  const radius = 8;
  let angle = 0;
  renderer.setAnimationLoop(() => {
    angle += 0.01;
    camera.position.set(Math.cos(angle) * radius, 4.5, Math.sin(angle) * radius);
    camera.lookAt(0, 0, 0);
    renderer.render(scene, camera);
  });
}
