import {
  createPolyOrthographicCamera,
  createPolyScene,
  createPolyOrbitControls,
  createPolyBox,
  createPolyTorus,
  createPolyCone,
} from "@layoutit/polycss";

const host = document.getElementById("host")!;
const camera = createPolyOrthographicCamera({ rotX: 65, rotY: 45, zoom: 0.3 });
const scene = createPolyScene(host, { camera });

createPolyOrbitControls(scene);
scene.add(createPolyBox({ size: 80, color: "#4ecdc4" }), { position: [-120, 0, 0] });
scene.add(createPolyTorus({ color: "#ff6644" }), { position: [0, 0, 0] });
scene.add(createPolyCone({ color: "#ffd166" }), { position: [120, 0, 0] });
