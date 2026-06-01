/**
 * parity-quad Vue mount entry. Bundled by bench/build.mjs into
 * bench/.generated/polycss-parity-quad-vue.js so parity-quad.html can
 * `import { mount } from "./.generated/polycss-parity-quad-vue.js"` and
 * stand up a self-contained Vue scene inside a host div.
 *
 * Mirrors three-parity's pattern: one state object drives everything; each
 * `update(state)` mutates reactive refs which Vue then re-renders.
 */
import { createApp, defineComponent, h, reactive, type App as VueApp } from "vue";
import {
  PolyCamera,
  PolyScene,
  PolyOrbitControls,
  PolyMesh,
} from "@layoutit/polycss-vue";
import type { Polygon } from "@layoutit/polycss-core";

export interface ParityQuadState {
  textureLighting: "baked" | "dynamic";
  polygons: Polygon[];
  voxelSource?: unknown;
  castShadow: boolean;
  selfShadow: boolean;
  floorVisible: boolean;
  floorReceives: boolean;
  autoCenter: boolean;
  floorPolygons: Polygon[];
  obj: { position: [number, number, number]; scale: number; rotation: [number, number, number] };
  dir: { direction: [number, number, number]; intensity: number; color: string };
  amb: { intensity: number; color: string };
  shadow: { opacity: number };
  cam: { rotX: number; rotY: number; zoom: number };
}

type OrbitChange = (snap: { rotX: number; rotY: number; zoom: number }) => void;

export interface ParityQuadMount {
  update(state: ParityQuadState): void;
  destroy(): void;
}

export function mount(host: HTMLElement, initial: ParityQuadState, onCameraChange?: OrbitChange): ParityQuadMount {
  // Single reactive holder — `update(next)` swaps the whole inner state, and
  // Vue's reactivity flushes a re-render with the new props.
  const store = reactive({ s: initial as ParityQuadState });

  const Root = defineComponent({
    name: "ParityQuadRoot",
    setup() {
      return () => {
        const s = store.s;
        return h(
          PolyCamera,
          { rotX: s.cam.rotX, rotY: s.cam.rotY, zoom: s.cam.zoom },
          {
            default: () => h(
              PolyScene,
              {
                directionalLight: s.dir,
                ambientLight: s.amb,
                shadow: s.shadow,
                textureLighting: s.textureLighting,
                autoCenter: s.autoCenter,
                centerPolygons: s.floorVisible ? [...s.polygons, ...s.floorPolygons] : s.polygons,
              },
              {
                default: () => [
                  h(PolyOrbitControls, { drag: true, wheel: true, animate: false, onChange: onCameraChange }),
                  h(PolyMesh, {
                    polygons: s.polygons,
                    voxelSource: s.voxelSource,
                    castShadow: s.castShadow,
                    receiveShadow: s.selfShadow,
                    position: s.obj.position,
                    scale: s.obj.scale,
                    rotation: s.obj.rotation,
                  }),
                  s.floorVisible ? h(PolyMesh, { polygons: s.floorPolygons, receiveShadow: s.floorReceives }) : null,
                ],
              },
            ),
          },
        );
      };
    },
  });

  const app: VueApp = createApp(Root);
  app.mount(host);

  return {
    update(next) { store.s = next; },
    destroy() { app.unmount(); },
  };
}

(globalThis as Record<string, unknown>).__parityQuadVue = { mount };
