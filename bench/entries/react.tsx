/**
 * Bench entry — React. Bundled by bench/build.mjs into bench/.generated/polycss-react.js
 * and loaded by bench/perf-react.html.
 *
 * Mounts a <PolyCamera><PolyScene><PolyOrbitControls + mesh> tree and drives
 * per-frame state via React useState updates from a shared rAF loop.
 * Measures the React reconciliation cost on top of the polycss renderer.
 */
import { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  PolyCamera,
  PolyScene,
  PolyOrbitControls,
  PolyMesh,
  Poly,
} from "@layoutit/polycss-react";
import type { Polygon } from "@layoutit/polycss-core";
import { loadMesh } from "@layoutit/polycss-core";
// @ts-expect-error — sibling .mjs without types
import { parseUrlParams, dirFromAzEl, createPerfRecorder, buildFloorPolygons, PERF_OVERLAY_HTML, PERF_OVERLAY_CSS } from "../perf-shared.mjs";
// @ts-expect-error — sibling .mjs without types
import { getSynthMesh } from "../synth-mesh.mjs";

interface ParseResult { polygons: Polygon[]; voxelSource?: unknown; dispose?: () => void }

function PerfApp({
  meshId, mode, motion, az, el, preset, parseResult, strategies, castShadow, floor,
}: {
  meshId: string;
  mode: "dynamic" | "baked";
  motion: "light" | "rot" | "none";
  az: number;
  el: number;
  preset: { rotX: number; rotY: number; zoom: number; url: string | null; mtlUrl?: string };
  parseResult: ParseResult | null;
  strategies?: { disable: Array<"b" | "i" | "u"> };
  castShadow: boolean;
  floor: boolean;
}) {
  // Per-frame reactive state — React's render pipeline runs each tick.
  const [rotY, setRotY] = useState(preset.rotY);
  const [lightDir, setLightDir] = useState<[number, number, number]>(() => dirFromAzEl(az, el));

  useEffect(() => {
    const polyCount = parseResult?.polygons?.length ?? 0;
    const recorder = createPerfRecorder({
      rendererLabel: "react",
      meshId, mode, motion, polyCount,
      polygons: parseResult?.polygons ?? [],
    });

    let azimuth = az;
    let frameCount = 0;
    let raf: number | null = null;
    const tick = (now: number) => {
      recorder.onFrame(now);
      frameCount += 1;
      if (motion === "light") {
        azimuth = (azimuth + 0.5) % 360;
        setLightDir(dirFromAzEl(azimuth, el));
      } else if (motion === "rot") {
        setRotY((((preset.rotY + frameCount * 0.5) % 360) + 360) % 360);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => { if (raf !== null) cancelAnimationFrame(raf); };
  }, [meshId, mode, motion, az, el, preset.rotX, preset.rotY, parseResult]);

  const directionalLight = useMemo(
    () => ({ direction: lightDir, color: "#ffffff", intensity: 1 }),
    [lightDir],
  );
  const ambientLight = useMemo(
    () => ({ color: "#ffffff", intensity: 0.4 }),
    [],
  );

  // Include the floor polygons in centerPolygons when the floor is on, so
  // React/Vue autoCenter mirrors vanilla's joint-bbox-of-all-meshes calc.
  const centerPolys = useMemo(() => {
    if (!parseResult) return undefined;
    if (!floor) return parseResult.polygons;
    return [...parseResult.polygons, ...buildFloorPolygons()];
  }, [parseResult, floor]);
  return (
    <PolyCamera rotX={preset.rotX} rotY={rotY} zoom={preset.zoom}>
      <PolyScene
        directionalLight={directionalLight}
        ambientLight={ambientLight}
        textureLighting={mode}
        strategies={strategies}
        autoCenter
        centerPolygons={centerPolys}
      >
        <PolyOrbitControls drag wheel animate={false} />
        {parseResult
          ? <PolyMesh polygons={parseResult.polygons} voxelSource={parseResult.voxelSource} castShadow={castShadow} />
          : preset.url
            ? <PolyMesh src={preset.url} mtlUrl={preset.mtlUrl} castShadow={castShadow} />
            : null}
        {floor && (
          <PolyMesh polygons={buildFloorPolygons()} receiveShadow />
        )}
      </PolyScene>
    </PolyCamera>
  );
}

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
    preset: any;
  };

  // Inject the shared overlay first so meta-renderer, etc. exist when
  // createPerfRecorder fires inside PerfApp's effect. Skipped when
  // `?nohud=1` (clean screenshot capture).
  const css = document.createElement("style");
  css.textContent = PERF_OVERLAY_CSS;
  document.head.appendChild(css);
  if (!params.hideOverlay) document.body.insertAdjacentHTML("beforeend", PERF_OVERLAY_HTML);

  // For React the component renders with `polygons` directly when a
  // parseResult is available (synth + OBJ both go through the same path
  // for honesty — measures rendering N <Poly> children, not the imperative
  // PolyMesh wrapper). For OBJ we load via @layoutit/polycss-core's loadMesh.
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
  createRoot(host).render(
    <PerfApp
      meshId={params.meshId}
      mode={params.mode}
      motion={params.motion}
      az={params.az}
      el={params.el}
      preset={params.preset}
      parseResult={parseResult}
      strategies={params.strategies}
      castShadow={params.castShadow}
      floor={params.floor}
    />,
  );
}

main().catch((err) => {
  console.error("perf-react entry failed", err);
  const fpsNow = document.getElementById("fps-now");
  if (fpsNow) fpsNow.textContent = "ERR";
});
