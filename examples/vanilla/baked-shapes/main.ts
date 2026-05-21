import {
  createPolyOrthographicCamera,
  createPolyScene,
  createPolyOrbitControls,
  createPolyIcosahedron,
} from "@layoutit/polycss";

const host = document.getElementById("host")!;
const camera = createPolyOrthographicCamera({ rotX: 65, rotY: 45 });
const scene = createPolyScene(host, { camera });

createPolyOrbitControls(scene, { animate: { speed: 0.3 } });
scene.add(createPolyIcosahedron({ size: 100, color: "#ff6644" }));
