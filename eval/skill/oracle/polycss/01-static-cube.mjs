import { createPolyBox, createPolyCamera, createPolyScene } from "@layoutit/polycss";

export function mount(host) {
  const camera = createPolyCamera({ rotX: 65, rotY: 45, zoom: 3 });
  const scene = createPolyScene(host, {
    camera,
    directionalLight: { direction: [0.5, -0.6, 0.7], color: "#ffffff", intensity: 1 },
    ambientLight: { color: "#ffffff", intensity: 0.4 },
  });

  scene.add(createPolyBox({ size: 100, color: "#ff8c1a" }));
  return scene;
}
