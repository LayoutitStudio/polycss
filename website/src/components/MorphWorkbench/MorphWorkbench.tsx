import { useEffect, useRef } from "react";
import {
  mountPolyMorphPlaneDemo,
  type PolyMorphPlaneDemoController,
} from "../../../../examples/morph/src/planeDemo";
import modelUrl from "./assets/model.json?url";
import "../../../../examples/morph/src/styles.css";

export default function MorphWorkbench() {
  const rootRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    let disposed = false;
    let controller: PolyMorphPlaneDemoController | null = null;

    void (async () => {
      const response = await fetch(modelUrl);
      if (!response.ok) throw new Error(`Failed to load prepared terrain: ${response.status}`);
      const model = await response.json();
      if (disposed) return;
      controller = await mountPolyMorphPlaneDemo(root, model);
      if (disposed) controller.destroy();
    })().catch((error: unknown) => {
      if (disposed) return;
      const message = error instanceof Error ? error.stack ?? error.message : String(error);
      root.querySelector<HTMLElement>("[data-debug]")!.textContent = message;
      root.querySelector<HTMLElement>("[data-scene-label]")!.textContent = "ERROR";
      console.error(error);
    });

    return () => {
      disposed = true;
      controller?.destroy();
    };
  }, []);

  return (
    <main className="morph-workbench morph-workbench--site" data-morph-workbench ref={rootRef}>
      <section className="morph-shell">
        <div className="morph-scene-wrap" data-scene-wrap>
          <div className="morph-scene-grid" aria-hidden="true" />
          <div
            className="morph-scene"
            data-scene
            aria-label="Interactive tessellated CSS 3D terrain"
          />
          <div className="morph-drag-indicator" data-drag-indicator aria-hidden="true" />
          <div className="morph-scene-hint">
            <span>CLICK + DRAG</span>
            Drag terrain to sculpt · drag black space to orbit
          </div>
          <div className="morph-scene-label" data-scene-label>LOADING</div>
        </div>

        <aside className="morph-panel">
          <div className="morph-choice">
            <span>On release</span>
            <div className="morph-segmented" aria-label="Sculpt release behavior">
              <button type="button" data-release="keep" aria-pressed="true">Keep</button>
              <button type="button" data-release="spring" aria-pressed="false">Spring back</button>
            </div>
          </div>

          <div className="morph-choice">
            <span>Zoom</span>
            <div className="morph-zoom-control">
              <button type="button" data-action="zoom-out" aria-label="Zoom out">−</button>
              <input data-zoom type="range" min="20" max="300" step="1" defaultValue="72" aria-label="Terrain zoom" />
              <button type="button" data-action="zoom-in" aria-label="Zoom in">+</button>
              <output data-zoom-output>100%</output>
            </div>
          </div>

          <div className="morph-elevation-key">
            <div><span>LOW</span><span>ZERO</span><span>HIGH</span></div>
            <span aria-hidden="true" />
          </div>

          <div className="morph-controls morph-controls--reset">
            <button className="morph-reset" type="button" data-action="reset">Reset</button>
            <button className="morph-random" type="button" data-action="random">Random</button>
          </div>

          <pre data-debug hidden />
        </aside>
      </section>
    </main>
  );
}
