/**
 * Bench entry — Vue shadow-parity mount. Bundled by bench/build.mjs into
 * bench/.generated/shadow-parity-vue.js and used by bench/shadow-parity.html.
 *
 * Mirror of shadowParityReact.tsx: a tiny imperative `mount(host, params)`
 * that renders the same scene as the other panes via the public component API.
 */
import { createApp, h, reactive } from "vue";
import { PolyCamera, PolyScene, PolyMesh } from "@layoutit/polycss-vue";

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
  const st = reactive<{ p: ParityParams }>({ p: initial });
  const app = createApp({
    render() {
      const p = st.p;
      return h(
        PolyCamera as never,
        { rotX: p.cam.rotX, rotY: p.cam.rotY, zoom: p.cam.zoom },
        {
          default: () =>
            h(
              PolyScene as never,
              {
                directionalLight: p.directionalLight,
                pointLights: p.pointLights,
                ambientLight: p.ambientLight,
                textureLighting: p.textureLighting,
                shadow: p.shadow,
              },
              {
                default: () => [
                  h(PolyMesh as never, { polygons: p.floorPolys, receiveShadow: true }),
                  h(PolyMesh as never, { polygons: p.cubePolys, position: p.cubeCenter, castShadow: true }),
                ],
              },
            ),
        },
      );
    },
  });
  app.mount(host);
  return { update: (np: ParityParams) => { st.p = np; }, dispose: () => app.unmount() };
}
