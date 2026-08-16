import {
  createPolyBox,
  createPolyCamera,
  createPolyCylinder,
  createPolyOrbitControls,
  createPolyPlane,
  createPolyScene,
  createPolyTorus,
} from "@layoutit/polycss";

export function mount(host) {
  const camera = createPolyCamera({ rotX: 62, rotY: 45, zoom: 1.1 });
  const scene = createPolyScene(host, {
    camera,
    directionalLight: { direction: [0.45, -0.55, 0.7], color: "#ffffff", intensity: 1 },
    ambientLight: { color: "#ffffff", intensity: 0.35 },
    shadow: { opacity: 0.3, parametric: true, definition: 24 },
  });

  scene.add(createPolyPlane({ axis: 2, size: 260, offset: 0, color: "#64748b" }), {
    receiveShadow: true,
  });

  scene.add(createPolyBox({ size: 80, color: "#ef4444" }), {
    position: [0, -150, 55],
    castShadow: true,
  });
  scene.add(createPolyCylinder({ radius: 45, height: 110, color: "#3b82f6" }), {
    position: [0, 0, 70],
    castShadow: true,
  });
  scene.add(createPolyTorus({ radius: 55, tube: 18, color: "#eab308" }), {
    position: [0, 150, 60],
    castShadow: true,
  });

  createPolyOrbitControls(scene, { drag: true, wheel: true });
  return scene;
}
