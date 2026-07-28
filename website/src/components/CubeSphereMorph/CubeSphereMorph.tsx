import { useEffect, useRef } from "react";
import modelUrl from "./assets/package/model.json?url";
import { mountMorphTargetsSphereDemo } from "./cubeSphereDemo";
import "./styles.css";

export default function MorphTargetsSphere() {
  const rootRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    let disposed = false;
    let controller: ReturnType<typeof mountMorphTargetsSphereDemo> | null = null;

    void (async () => {
      const response = await fetch(modelUrl);
      if (!response.ok) {
        throw new Error(`Failed to load Animated Morph Sphere: ${response.status}`);
      }
      const model = await response.json();
      if (disposed) return;
      controller = mountMorphTargetsSphereDemo(root, model);
      root.dataset.status = "ready";
    })().catch((error: unknown) => {
      if (disposed) return;
      root.dataset.status = "error";
      root.querySelector<HTMLElement>("[data-morph-state]")!.textContent = "ERROR";
      console.error(error);
    });

    return () => {
      disposed = true;
      controller?.destroy();
    };
  }, []);

  return (
    <main className="cube-sphere-workbench" data-status="loading" ref={rootRef}>
      <div
        className="cube-sphere-scene"
        data-cube-sphere-scene
        aria-label="Interactive PolyCSS morph targets sphere"
      />

      <div className="cube-sphere-hint">
        <strong>DRAG</strong> to orbit · <strong>SCROLL</strong> to zoom
      </div>

      <aside className="cube-sphere-panel">
        <div className="cube-sphere-kicker">CC0 MORPH TARGETS</div>
        <div className="cube-sphere-state">
          <span data-morph-state>LOADING</span>
          <output data-morph-output>—</output>
        </div>
        <button type="button" data-morph-action aria-pressed="false">Pause</button>
        <dl>
          <div><dt>Triangles</dt><dd data-leaf-count>960</dd></div>
          <div><dt>CSS points</dt><dd data-point-count>1876</dd></div>
          <div><dt>Topology</dt><dd>retained</dd></div>
          <div><dt>Renderer</dt><dd>PolyCSS</dd></div>
        </dl>
        <a
          href="https://github.com/mrdoob/three.js/tree/dev/examples/models/gltf/AnimatedMorphSphere"
          target="_blank"
          rel="noreferrer"
        >
          AnimatedMorphSphere source
        </a>
      </aside>
    </main>
  );
}
