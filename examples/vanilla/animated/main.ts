import {
  createPolyPerspectiveCamera,
  createPolyScene,
  createPolyOrbitControls,
  createPolyAnimationMixer,
  loadMesh,
} from "@layoutit/polycss";

const host = document.getElementById("host")!;
const camera = createPolyPerspectiveCamera({ rotX: 65, rotY: 45, zoom: 0.3 });
const scene = createPolyScene(host, { camera, autoCenter: true });

createPolyOrbitControls(scene);

loadMesh("https://polycss.com/gallery/glb/AnimatedWizard.glb").then((result) => {
  const mesh = scene.add(result, { merge: false, stableDom: true });

  if (result.animation && result.animation.clips.length > 0) {
    const mixer = createPolyAnimationMixer(mesh, result.animation);
    mixer.clipAction(result.animation.clips[0].name).play();

    let lastTime: number | null = null;
    function tick(now: number) {
      if (lastTime === null) { lastTime = now; }
      mixer.update((now - lastTime) / 1000);
      lastTime = now;
      requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  }
});
