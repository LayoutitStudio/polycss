import * as THREE from "three";

/** Shared setup so each reference scene shows only what its task is about. */
export function makeRenderer(host) {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(900, 600, false);
  renderer.setPixelRatio(1);
  renderer.setClearColor(0xffffff, 1);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  host.appendChild(renderer.domElement);
  return renderer;
}

export function lights(scene, { intensity = 2.4, ambient = 0.55 } = {}) {
  const sun = new THREE.DirectionalLight(0xffffff, intensity);
  sun.position.set(5, 8, 4);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  const d = 12;
  Object.assign(sun.shadow.camera, { left: -d, right: d, top: d, bottom: -d, near: 0.5, far: 40 });
  sun.shadow.camera.updateProjectionMatrix();
  scene.add(sun);
  scene.add(new THREE.AmbientLight(0xffffff, ambient));
  return sun;
}
