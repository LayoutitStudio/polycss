import * as THREE from "three";
import { lights, makeRenderer } from "./_common.mjs";

export function mount(host) {
  const renderer = makeRenderer(host);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(45, 900 / 600, 0.1, 100);
  camera.position.set(0, 9, 14);
  camera.lookAt(0, 0.5, 0);
  lights(scene);

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(26, 26),
    new THREE.MeshLambertMaterial({ color: 0x64748b }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  const add = (geometry, color, x, y) => {
    const mesh = new THREE.Mesh(geometry, new THREE.MeshLambertMaterial({ color }));
    mesh.position.set(x, y, 0);
    mesh.castShadow = true;
    scene.add(mesh);
    return mesh;
  };

  add(new THREE.BoxGeometry(3, 3, 3), 0xef4444, -5.2, 1.5);
  add(new THREE.CylinderGeometry(1.5, 1.5, 3.4, 24), 0x3b82f6, 0, 1.7);
  add(new THREE.TorusGeometry(1.7, 0.6, 16, 32), 0xeab308, 5.2, 1.8).rotation.x = Math.PI / 2;

  renderer.setAnimationLoop(() => renderer.render(scene, camera));
}
