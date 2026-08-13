import {
  createPolyBox,
  createPolyCamera,
  createPolyScene,
  createPolySphere,
} from "@layoutit/polycss";

export function mount(host) {
  const camera = createPolyCamera({ rotX: 65, rotY: 45, zoom: 1.6 });
  const scene = createPolyScene(host, {
    camera,
    directionalLight: { direction: [0.5, -0.6, 0.7], color: "#ffffff", intensity: 1 },
    ambientLight: { color: "#ffffff", intensity: 0.4 },
  });

  scene.add(createPolyBox({ size: 90, color: "#6366f1" }), { position: [0, -110, 0] });
  scene.add(createPolySphere({ radius: 50, subdivisions: 2, color: "#f43f5e" }), {
    position: [0, 110, 0],
  });

  return scene;
}
