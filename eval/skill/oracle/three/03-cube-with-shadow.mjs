import * as THREE from "three";
import { lights, makeRenderer } from "./_common.mjs";

export function mount(host) {
  const renderer = makeRenderer(host);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(45, 900 / 600, 0.1, 100);
  camera.position.set(6, 8, 9);
  camera.lookAt(0, 1, 0);
  // Light from behind-left so the shadow falls toward the camera instead of
  // hiding behind the cube.
  lights(scene).position.set(-5, 9, -4);

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(16, 16),
    new THREE.MeshLambertMaterial({ color: 0x94a3b8 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  const cube = new THREE.Mesh(
    new THREE.BoxGeometry(3, 3, 3),
    new THREE.MeshLambertMaterial({ color: 0xfbbf24 }),
  );
  cube.position.y = 2.2;
  cube.castShadow = true;
  scene.add(cube);

  renderer.setAnimationLoop(() => renderer.render(scene, camera));
}
