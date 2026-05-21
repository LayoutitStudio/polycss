import {
  createPolyPerspectiveCamera,
  createPolyScene,
  createPolyOrbitControls,
  loadMesh,
} from "@layoutit/polycss";

const host = document.getElementById("host")!;
const camera = createPolyPerspectiveCamera({ rotX: 65, rotY: 45 });
const scene = createPolyScene(host, { camera, autoCenter: true });

createPolyOrbitControls(scene, { animate: { speed: 0.3 } });

loadMesh("https://polycss.com/gallery/glb/apple.glb").then((result) => {
  scene.add(result);
});
