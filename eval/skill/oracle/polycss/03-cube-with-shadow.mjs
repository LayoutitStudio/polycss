import {
  createPolyBox,
  createPolyCamera,
  createPolyPlane,
  createPolyScene,
} from "@layoutit/polycss";

export function mount(host) {
  const camera = createPolyCamera({ rotX: 60, rotY: 45, zoom: 2 });
  const scene = createPolyScene(host, {
    camera,
    directionalLight: { direction: [0.45, -0.55, 0.7], color: "#ffffff", intensity: 1 },
    ambientLight: { color: "#ffffff", intensity: 0.35 },
    shadow: { opacity: 0.35 },
  });

  // Vanilla has no ground-shadow fallback: without an explicit receiver the
  // caster draws nothing at all.
  scene.add(createPolyPlane({ axis: 2, size: 160, offset: 0, color: "#94a3b8" }), {
    receiveShadow: true,
  });
  scene.add(createPolyBox({ size: 100, color: "#fbbf24" }), {
    position: [0, 0, 70],
    castShadow: true,
  });

  return scene;
}
