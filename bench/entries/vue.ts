/**
 * Bench entry — Vue 3. Bundled by bench/build.mjs into bench/.generated/polycss-vue.js
 * and loaded by bench/perf-vue.html.
 *
 * Mounts a <PolyCamera><PolyScene><PolyOrbitControls + mesh> tree and drives
 * per-frame state via reactive ref() updates from a shared rAF loop.
 *
 * Supports the full parity-quad URL param set + the postMessage protocol
 * (`?sync=1`). See bench/perf-shared.mjs `parseUrlParams` and
 * `installParitySync`.
 */
import { createApp, defineComponent, h, onMounted, onBeforeUnmount, ref, computed } from "vue";
import {
  PolyCamera,
  PolyScene,
  PolyOrbitControls,
  PolyMesh,
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
    cfg: { type: Object as () => any, required: true },
    parseResult: { type: Object as () => ParseResult | null, default: null },
  },
  setup(props) {
    const cfg = props.cfg;
    const haveDirVec = cfg.dir.x !== null && cfg.dir.y !== null && cfg.dir.z !== null;
    const initialDir: [number, number, number] = haveDirVec
      ? [cfg.dir.x, cfg.dir.y, cfg.dir.z]
      : dirFromAzEl(cfg.az, cfg.el);
    const initialLift = cfg.shadow.lift !== null ? cfg.shadow.lift : 1 / Math.max(1, cfg.preset.zoom);

    const rotX = ref(cfg.preset.rotX);
    const rotY = ref(cfg.preset.rotY);
    const zoom = ref(cfg.preset.zoom);
    const lightDir = ref<[number, number, number]>(initialDir);
    const dirIntensity = ref(cfg.dir.intensity);
    const dirColor = ref(cfg.dir.color);
    const ambIntensity = ref(cfg.amb.intensity);
    const ambColor = ref(cfg.amb.color);
    const shadowOpacity = ref(cfg.shadow.opacity);
    const shadowLift = ref(initialLift);
    const objPosition = ref<[number, number, number]>([cfg.obj.x, cfg.obj.y, cfg.obj.z]);
    const objScale = ref(cfg.obj.scale);
    const objRotation = ref<[number, number, number]>([cfg.obj.rx, cfg.obj.ry, cfg.obj.rz]);

    const directionalLight = computed(() => ({
      direction: lightDir.value,
      color: dirColor.value,
      intensity: dirIntensity.value,
    }));
    const ambientLight = computed(() => ({
      color: ambColor.value,
      intensity: ambIntensity.value,
    }));
    const shadow = computed(() => ({ opacity: shadowOpacity.value, lift: shadowLift.value }));

    let raf: number | null = null;
    onMounted(() => {
      const polyCount = props.parseResult?.polygons?.length ?? 0;
      const recorder = createPerfRecorder({
        rendererLabel: "vue",
        meshId: cfg.meshId, mode: cfg.mode, motion: cfg.motion, polyCount,
        polygons: props.parseResult?.polygons ?? [],
      });

      let azimuth = cfg.az;
      let frameCount = 0;
      const tick = (now: number): void => {
        recorder.onFrame(now);
        frameCount += 1;
        if (cfg.motion === "light") {
          azimuth = (azimuth + 0.5) % 360;
          lightDir.value = dirFromAzEl(azimuth, cfg.el);
        } else if (cfg.motion === "rot") {
          rotY.value = (((cfg.preset.rotY + frameCount * 0.5) % 360) + 360) % 360;
        }
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    });
    onBeforeUnmount(() => {
      if (raf !== null) cancelAnimationFrame(raf);
    });

    // Parity-quad sync: install postMessage listener that mutates reactive
    // refs, which Vue re-renders into PolyScene/PolyMesh props.
    onMounted(() => {
      if (!cfg.sync) return;
      installParitySync({
        applyCamera: ({ rotX: rx, rotY: ry, zoom: z }: { rotX: number | null; rotY: number | null; zoom: number | null }) => {
          if (rx != null) rotX.value = rx;
          if (ry != null) rotY.value = ry;
          if (z != null) zoom.value = z;
        },
        applyLight: ({ dir, intensity, color }: { dir: [number, number, number] | null; intensity: number | null; color: string | null }) => {
          if (dir) lightDir.value = dir;
          if (intensity != null) dirIntensity.value = intensity;
          if (color != null) dirColor.value = color;
        },
        applyAmbient: ({ intensity, color }: { intensity: number | null; color: string | null }) => {
          if (intensity != null) ambIntensity.value = intensity;
          if (color != null) ambColor.value = color;
        },
        applyObject: ({ position, scale, rotation }: { position: [number, number, number] | null; scale: number | null; rotation: [number, number, number] | null }) => {
          if (position) objPosition.value = position;
          if (scale != null) objScale.value = scale;
          if (rotation) objRotation.value = rotation;
        },
        applyShadow: ({ opacity, lift }: { opacity: number | null; lift: number | null }) => {
          if (opacity != null) shadowOpacity.value = opacity;
          if (lift != null) shadowLift.value = lift;
        },
        reportCamera: () => {}, // handled inline via onChange below
      });
    });

    function onOrbitChange(snap: { rotX?: number; rotY?: number; zoom?: number }): void {
      if (!cfg.sync) return;
      if (typeof snap.rotX === "number") rotX.value = snap.rotX;
      if (typeof snap.rotY === "number") rotY.value = snap.rotY;
      if (typeof snap.zoom === "number") zoom.value = snap.zoom;
      if (window.parent !== window) {
        window.parent.postMessage({ kind: "camera-changed", rotX: snap.rotX, rotY: snap.rotY, zoom: snap.zoom }, "*");
      }
    }

    const centerPolys = computed(() => {
      if (!props.parseResult) return undefined;
      if (!cfg.floorVisible) return props.parseResult.polygons;
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
            ambientLight: ambientLight.value,
            shadow: shadow.value,
            textureLighting: cfg.mode,
            strategies: cfg.strategies,
            autoCenter: cfg.autoCenter,
            centerPolygons: centerPolys.value,
          },
          {
            default: () => [
              h(PolyOrbitControls, { drag: true, wheel: true, animate: false, onChange: cfg.sync ? onOrbitChange : undefined }),
              props.parseResult
                ? h(PolyMesh, {
                    polygons: props.parseResult.polygons,
                    voxelSource: props.parseResult.voxelSource,
                    castShadow: cfg.castShadow,
                    receiveShadow: cfg.selfShadow,
                    position: objPosition.value,
                    scale: objScale.value,
                    rotation: objRotation.value,
                  })
                : cfg.preset.url
                  ? h(PolyMesh, {
                      src: cfg.preset.url,
                      mtlUrl: cfg.preset.mtlUrl,
                      castShadow: cfg.castShadow,
                      receiveShadow: cfg.selfShadow,
                      position: objPosition.value,
                      scale: objScale.value,
                      rotation: objRotation.value,
                    })
                  : null,
              cfg.floorVisible
                ? h(PolyMesh, { polygons: buildFloorPolygons(), receiveShadow: cfg.floorReceives })
                : null,
            ],
          },
        ),
      },
    );
  },
});

async function main(): Promise<void> {
  const cfg = parseUrlParams() as any;

  const css = document.createElement("style");
  css.textContent = PERF_OVERLAY_CSS;
  document.head.appendChild(css);
  if (!cfg.hideOverlay) document.body.insertAdjacentHTML("beforeend", PERF_OVERLAY_HTML);

  let parseResult: ParseResult | null = null;
  if (cfg.isSynth) {
    parseResult = getSynthMesh(cfg.meshId);
  } else if (cfg.preset.url) {
    parseResult = await loadMesh(cfg.preset.url, {
      ...(cfg.preset.mtlUrl ? { mtlUrl: cfg.preset.mtlUrl } : {}),
      objOptions: cfg.preset.options,
    });
  }

  const host = document.getElementById("host")!;
  createApp(PerfApp, { cfg, parseResult }).mount(host);
}

main().catch((err) => {
  console.error("perf-vue entry failed", err);
  const fpsNow = document.getElementById("fps-now");
  if (fpsNow) fpsNow.textContent = "ERR";
});
