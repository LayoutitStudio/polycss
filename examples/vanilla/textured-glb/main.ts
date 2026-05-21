import {
  createPolyPerspectiveCamera,
  createPolyScene,
  createPolyOrbitControls,
  loadMesh,
} from "@layoutit/polycss";

const host = document.getElementById("host")!;
const camera = createPolyPerspectiveCamera({ rotX: 65, rotY: 45, zoom: 0.1 });
const scene = createPolyScene(host, { camera, autoCenter: true });

createPolyOrbitControls(scene);

loadMesh("https://polycss.com/gallery/obj/cottage.obj", {
  mtlUrl: "https://polycss.com/gallery/obj/cottage.mtl",
}).then((result) => {
  scene.add(result);
});
