import {
  createPolyOrthographicCamera,
  createPolyScene,
  createPolyOrbitControls,
  loadMesh,
} from "@layoutit/polycss";

const host = document.getElementById("host")!;
const camera = createPolyOrthographicCamera({ rotX: 65, rotY: 45, zoom: 0.1 });
const scene = createPolyScene(host, { camera, autoCenter: true });

createPolyOrbitControls(scene, { animate: { speed: 0.3 } });

loadMesh("https://polycss.com/gallery/vox/apple.vox").then((result) => {
  scene.add(result);
});
