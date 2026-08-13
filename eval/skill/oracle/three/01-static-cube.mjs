import * as THREE from "three";
import { lights, makeRenderer } from "./_common.mjs";

export function mount(host) {
  const renderer = makeRenderer(host);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(45, 900 / 600, 0.1, 100);
  camera.position.set(5, 4, 5);
  camera.lookAt(0, 0, 0);
  lights(scene);

  scene.add(
    new THREE.Mesh(
      new THREE.BoxGeometry(4, 4, 4),
      new THREE.MeshLambertMaterial({ color: 0xff8c1a }),
    ),
  );

  renderer.setAnimationLoop(() => renderer.render(scene, camera));
}
