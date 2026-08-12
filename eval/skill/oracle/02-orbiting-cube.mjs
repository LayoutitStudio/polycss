import {
  createPolyBox,
  createPolyCamera,
  createPolyOrbitControls,
  createPolyScene,
} from "@layoutit/polycss";

export function mount(host) {
  const camera = createPolyCamera({ rotX: 65, rotY: 45, zoom: 3 });
  const scene = createPolyScene(host, {
    camera,
    directionalLight: { direction: [0.5, -0.6, 0.7], color: "#ffffff", intensity: 1 },
    ambientLight: { color: "#ffffff", intensity: 0.4 },
  });

  scene.add(createPolyBox({ size: 100, color: "#14b8a6" }));
  createPolyOrbitControls(scene, {
    drag: true,
    wheel: true,
    animate: { speed: 0.6, axis: "y" },
  });

  return scene;
}
