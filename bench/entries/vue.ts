/**
 * Bench entry — Vue 3. Bundled by bench/build.mjs into bench/.generated/polycss-vue.js
 * and loaded by bench/perf-vue.html.
 *
 * Mounts a <PolyCamera><PolyScene><PolyOrbitControls + mesh> tree and drives
 * per-frame state via reactive ref() updates from a shared rAF loop.
 * Measures Vue's reactivity flush + render cost on top of the polycss
 * renderer.
 *
 * Uses defineComponent + render functions (not SFC templates) so the
 * bundler doesn't need a Vue template compiler.
 */
import { createApp, defineComponent, h, onMounted, onBeforeUnmount, ref, computed } from "vue";
import {
  PolyCamera,
  PolyScene,
  PolyOrbitControls,
  PolyMesh,
  Poly,
} from "@layoutit/polycss-vue";
import type { Polygon } from "@layoutit/polycss-core";
import { loadMesh } from "@layoutit/polycss-core";
// @ts-expect-error — sibling .mjs without types
import { parseUrlParams, dirFromAzEl, createPerfRecorder, buildFloorPolygons, installParitySync, PERF_OVERLAY_HTML, PERF_OVERLAY_CSS } from "../perf-shared.mjs";
// @ts-expect-error — sibling .mjs without types
import { getSynthMesh } from "../synth-mesh.mjs";

interface ParseResult { polygons: Polygon[]; voxelSource?: unknown; dispose?: () => void }

const PerfApp = defineComponent({
  name: "PerfApp",
  props: {
    meshId: { type: String, required: true },
    mode: { type: String as () => "dynamic" | "baked", required: true },
    motion: { type: String as () => "light" | "rot" | "none", required: true },
    az: { type: Number, required: true },
    el: { type: Number, required: true },
    preset: { type: Object as () => any, required: true },
    parseResult: { type: Object as () => ParseResult | null, default: null },
    strategies: { type: Object as () => { disable: Array<"b" | "i" | "u"> } | undefined, default: undefined },
    castShadow: { type: Boolean, default: false },
    floor: { type: Boolean, default: false },
    sync: { type: Boolean, default: false },
  },
  setup(props) {
    const rotX = ref(props.preset.rotX);
    const rotY = ref(props.preset.rotY);
    const zoom = ref(props.preset.zoom);
    const azState = ref(props.az);
    const elState = ref(props.el);
    const lightDir = ref<[number, number, number]>(dirFromAzEl(props.az, props.el));

    const directionalLight = computed(() => ({
      direction: lightDir.value,
      color: "#ffffff",
      intensity: 1,
    }));
    const ambientLight = { color: "#ffffff", intensity: 0.4 };

    let raf: number | null = null;
    onMounted(() => {
      const polyCount = props.parseResult?.polygons?.length ?? 0;
      const recorder = createPerfRecorder({
        rendererLabel: "vue",
        meshId: props.meshId,
        mode: props.mode,
        motion: props.motion,
        polyCount,
        polygons: props.parseResult?.polygons ?? [],
      });

      let azimuth = props.az;
      let frameCount = 0;
      const tick = (now: number): void => {
        recorder.onFrame(now);
        frameCount += 1;
        if (props.motion === "light") {
          azimuth = (azimuth + 0.5) % 360;
          lightDir.value = dirFromAzEl(azimuth, props.el);
        } else if (props.motion === "rot") {
          rotY.value = (((props.preset.rotY + frameCount * 0.5) % 360) + 360) % 360;
        }
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    });
    onBeforeUnmount(() => {
      if (raf !== null) cancelAnimationFrame(raf);
    });

    // Parity-quad sync: bridge parent postMessage to camera/light state.
    onMounted(() => {
      if (!props.sync) return;
      installParitySync({
        applyCamera: ({ rotX: rx, rotY: ry, zoom: z }: { rotX: number | null; rotY: number | null; zoom: number | null }) => {
          if (rx != null) rotX.value = rx;
          if (ry != null) rotY.value = ry;
          if (z != null) zoom.value = z;
        },
        applyLight: ({ az, el }: { az: number | null; el: number | null }) => {
          if (az != null) azState.value = az;
          if (el != null) elState.value = el;
          lightDir.value = dirFromAzEl(azState.value, elState.value);
        },
        reportCamera: () => {}, // handled inline via onChange below
      });
    });

    function onOrbitChange(snap: { rotX?: number; rotY?: number; zoom?: number }): void {
      if (!props.sync) return;
      if (typeof snap.rotX === "number") rotX.value = snap.rotX;
      if (typeof snap.rotY === "number") rotY.value = snap.rotY;
      if (typeof snap.zoom === "number") zoom.value = snap.zoom;
      window.parent.postMessage({ kind: "camera-changed", rotX: snap.rotX, rotY: snap.rotY, zoom: snap.zoom }, "*");
    }

    // Include the floor polygons in centerPolygons when the floor is on, so
    // Vue autoCenter mirrors vanilla's joint-bbox-of-all-meshes calc.
    const centerPolys = computed(() => {
      if (!props.parseResult) return undefined;
      if (!props.floor) return props.parseResult.polygons;
      return [...props.parseResult.polygons, ...buildFloorPolygons()];
    });
    return () => h(
      PolyCamera,
      { rotX: rotX.value, rotY: rotY.value, zoom: zoom.value },
      {
        default: () => h(
          PolyScene,
          {
            directionalLight: directionalLight.value,
            ambientLight,
            textureLighting: props.mode,
            strategies: props.strategies,
            autoCenter: true,
            centerPolygons: centerPolys.value,
          },
          {
            default: () => [
              h(PolyOrbitControls, { drag: true, wheel: true, animate: false, onChange: props.sync ? onOrbitChange : undefined }),
              props.parseResult
                ? h(PolyMesh, { polygons: props.parseResult.polygons, voxelSource: props.parseResult.voxelSource, castShadow: props.castShadow })
                : props.preset.url
                  ? h(PolyMesh, { src: props.preset.url, mtlUrl: props.preset.mtlUrl, castShadow: props.castShadow })
                  : null,
              props.floor
                ? h(PolyMesh, { polygons: buildFloorPolygons(), receiveShadow: true })
                : null,
            ],
          },
        ),
      },
    );
  },
});

async function main(): Promise<void> {
  const params = parseUrlParams() as {
    meshId: string;
    mode: "dynamic" | "baked";
    motion: "light" | "rot" | "none";
    az: number;
    el: number;
    isSynth: boolean;
    strategies?: { disable: Array<"b" | "i" | "u"> };
    castShadow: boolean;
    floor: boolean;
    hideOverlay: boolean;
    sync: boolean;
    preset: any;
  };

  const css = document.createElement("style");
  css.textContent = PERF_OVERLAY_CSS;
  document.head.appendChild(css);
  if (!params.hideOverlay) document.body.insertAdjacentHTML("beforeend", PERF_OVERLAY_HTML);

  let parseResult: ParseResult | null = null;
  if (params.isSynth) {
    parseResult = getSynthMesh(params.meshId);
  } else if (params.preset.url) {
    parseResult = await loadMesh(params.preset.url, {
      ...(params.preset.mtlUrl ? { mtlUrl: params.preset.mtlUrl } : {}),
      objOptions: params.preset.options,
    });
  }

  const host = document.getElementById("host")!;
  createApp(PerfApp, {
    meshId: params.meshId,
    mode: params.mode,
    motion: params.motion,
    az: params.az,
    el: params.el,
    preset: params.preset,
    parseResult,
    strategies: params.strategies,
    castShadow: params.castShadow,
    floor: params.floor,
    sync: params.sync,
  }).mount(host);
}

main().catch((err) => {
  console.error("perf-vue entry failed", err);
  const fpsNow = document.getElementById("fps-now");
  if (fpsNow) fpsNow.textContent = "ERR";
});
