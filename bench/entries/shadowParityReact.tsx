/**
 * Bench entry — React shadow-parity mount. Bundled by bench/build.mjs into
 * bench/.generated/shadow-parity-react.js and used by bench/shadow-parity.html.
 *
 * Exposes a tiny imperative `mount(host, params)` that renders the SAME scene
 * the vanilla / Vue / three panes render, so the parity page can compare all
 * renderers pixel-for-pixel. Driven via the public component API (no iframe /
 * postMessage).
 */
import { createElement as h } from "react";
import { createRoot } from "react-dom/client";
import { PolyCamera, PolyScene, PolyMesh } from "@layoutit/polycss-react";

export interface ParityParams {
  cubePolys: unknown[];
  floorPolys: unknown[];
  cubeCenter: [number, number, number];
  directionalLight?: unknown;
  pointLights?: unknown[];
  ambientLight?: unknown;
  textureLighting: "baked" | "dynamic";
  shadow: { color?: string; opacity?: number; lift?: number };
  cam: { rotX: number; rotY: number; zoom: number };
}

export function mount(host: HTMLElement, initial: ParityParams) {
  const root = createRoot(host);
  const render = (p: ParityParams): void => {
    root.render(
      h(
        PolyCamera as never,
        { rotX: p.cam.rotX, rotY: p.cam.rotY, zoom: p.cam.zoom } as never,
        h(
          PolyScene as never,
          {
            directionalLight: p.directionalLight,
            pointLights: p.pointLights,
            ambientLight: p.ambientLight,
            textureLighting: p.textureLighting,
            shadow: p.shadow,
          } as never,
          h(PolyMesh as never, { key: "floor", polygons: p.floorPolys, receiveShadow: true } as never),
          h(PolyMesh as never, { key: "cube", polygons: p.cubePolys, position: p.cubeCenter, castShadow: true } as never),
        ),
      ),
    );
  };
  render(initial);
  return { update: render, dispose: () => root.unmount() };
}
