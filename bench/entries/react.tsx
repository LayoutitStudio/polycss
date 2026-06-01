/**
 * Bench entry — React. Bundled by bench/build.mjs into bench/.generated/polycss-react.js
 * and loaded by bench/perf-react.html.
 *
 * Mounts a <PolyCamera><PolyScene><PolyOrbitControls + mesh> tree and drives
 * per-frame state via React useState updates from a shared rAF loop.
 * Measures the React reconciliation cost on top of the polycss renderer.
 *
 * Supports the full parity-quad URL param set + the postMessage protocol
 * (`?sync=1`). See bench/perf-shared.mjs `parseUrlParams` and
 * `installParitySync`.
 */
import { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  PolyCamera,
  PolyScene,
  PolyOrbitControls,
  PolyMesh,
} from "@layoutit/polycss-react";
import type { Polygon } from "@layoutit/polycss-core";
import { loadMesh } from "@layoutit/polycss-core";
// @ts-expect-error — sibling .mjs without types
import { parseUrlParams, dirFromAzEl, createPerfRecorder, buildFloorPolygons, installParitySync, PERF_OVERLAY_HTML, PERF_OVERLAY_CSS } from "../perf-shared.mjs";
// @ts-expect-error — sibling .mjs without types
import { getSynthMesh } from "../synth-mesh.mjs";

interface ParseResult { polygons: Polygon[]; voxelSource?: unknown; dispose?: () => void }

interface CfgShape {
  meshId: string;
  mode: "dynamic" | "baked";
  motion: "light" | "rot" | "none";
  az: number;
  el: number;
  isSynth: boolean;
  strategies?: { disable: Array<"b" | "i" | "u"> };
  castShadow: boolean;
  selfShadow: boolean;
  floorVisible: boolean;
  floorReceives: boolean;
  autoCenter: boolean;
  hideOverlay: boolean;
  sync: boolean;
  obj: { x: number; y: number; z: number; scale: number; rx: number; ry: number; rz: number };
  dir: { x: number | null; y: number | null; z: number | null; intensity: number; color: string };
  amb: { intensity: number; color: string };
  shadow: { opacity: number; lift: number | null };
  preset: { rotX: number; rotY: number; zoom: number; url: string | null; mtlUrl?: string; options?: any };
}

function PerfApp({ cfg, parseResult }: { cfg: CfgShape; parseResult: ParseResult | null }) {
  const haveDirVec = cfg.dir.x !== null && cfg.dir.y !== null && cfg.dir.z !== null;
  const initialDir: [number, number, number] = haveDirVec
    ? [cfg.dir.x as number, cfg.dir.y as number, cfg.dir.z as number]
    : dirFromAzEl(cfg.az, cfg.el);
  const initialLift = cfg.shadow.lift !== null ? cfg.shadow.lift : 1 / Math.max(1, cfg.preset.zoom);

  // Per-frame reactive state — React's render pipeline runs each tick.
  const [rotX, setRotX] = useState(cfg.preset.rotX);
  const [rotY, setRotY] = useState(cfg.preset.rotY);
  const [zoom, setZoom] = useState(cfg.preset.zoom);
  const [lightDir, setLightDir] = useState<[number, number, number]>(initialDir);
  const [dirIntensity, setDirIntensity] = useState(cfg.dir.intensity);
  const [dirColor, setDirColor] = useState(cfg.dir.color);
  const [ambIntensity, setAmbIntensity] = useState(cfg.amb.intensity);
  const [ambColor, setAmbColor] = useState(cfg.amb.color);
  const [shadowOpacity, setShadowOpacity] = useState(cfg.shadow.opacity);
  const [shadowLift, setShadowLift] = useState(initialLift);
  const [objPosition, setObjPosition] = useState<[number, number, number]>([cfg.obj.x, cfg.obj.y, cfg.obj.z]);
  const [objScale, setObjScale] = useState(cfg.obj.scale);
  const [objRotation, setObjRotation] = useState<[number, number, number]>([cfg.obj.rx, cfg.obj.ry, cfg.obj.rz]);

  useEffect(() => {
    const polyCount = parseResult?.polygons?.length ?? 0;
    const recorder = createPerfRecorder({
      rendererLabel: "react",
      meshId: cfg.meshId, mode: cfg.mode, motion: cfg.motion, polyCount,
      polygons: parseResult?.polygons ?? [],
    });

    let azimuth = cfg.az;
    let frameCount = 0;
    let raf: number | null = null;
    const tick = (now: number) => {
      recorder.onFrame(now);
      frameCount += 1;
      if (cfg.motion === "light") {
        azimuth = (azimuth + 0.5) % 360;
        setLightDir(dirFromAzEl(azimuth, cfg.el));
      } else if (cfg.motion === "rot") {
        setRotY((((cfg.preset.rotY + frameCount * 0.5) % 360) + 360) % 360);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => { if (raf !== null) cancelAnimationFrame(raf); };
  }, [cfg, parseResult]);

  // Parity-quad sync: install postMessage listener that updates reactive
  // state, which re-renders the scene via PolyScene/PolyMesh props.
  useEffect(() => {
    if (!cfg.sync) return;
    installParitySync({
      applyCamera: ({ rotX: rx, rotY: ry, zoom: z }: { rotX: number | null; rotY: number | null; zoom: number | null }) => {
        if (rx != null) setRotX(rx);
        if (ry != null) setRotY(ry);
        if (z != null) setZoom(z);
      },
      applyLight: ({ dir, intensity, color }: { dir: [number, number, number] | null; intensity: number | null; color: string | null }) => {
        if (dir) setLightDir(dir);
        if (intensity != null) setDirIntensity(intensity);
        if (color != null) setDirColor(color);
      },
      applyAmbient: ({ intensity, color }: { intensity: number | null; color: string | null }) => {
        if (intensity != null) setAmbIntensity(intensity);
        if (color != null) setAmbColor(color);
      },
      applyObject: ({ position, scale, rotation }: { position: [number, number, number] | null; scale: number | null; rotation: [number, number, number] | null }) => {
        if (position) setObjPosition(position);
        if (scale != null) setObjScale(scale);
        if (rotation) setObjRotation(rotation);
      },
      applyShadow: ({ opacity, lift }: { opacity: number | null; lift: number | null }) => {
        if (opacity != null) setShadowOpacity(opacity);
        if (lift != null) setShadowLift(lift);
      },
      reportCamera: () => {
        // Drag report is wired inline via <PolyOrbitControls onChange> below.
      },
    });
  }, [cfg.sync]);

  const directionalLight = useMemo(
    () => ({ direction: lightDir, color: dirColor, intensity: dirIntensity }),
    [lightDir, dirColor, dirIntensity],
  );
  const ambientLight = useMemo(
    () => ({ color: ambColor, intensity: ambIntensity }),
    [ambColor, ambIntensity],
  );
  const shadow = useMemo(
    () => ({ opacity: shadowOpacity, lift: shadowLift }),
    [shadowOpacity, shadowLift],
  );

  // Include the floor polygons in centerPolygons when the floor is on, so
  // React/Vue autoCenter mirrors vanilla's joint-bbox-of-all-meshes calc.
  const centerPolys = useMemo(() => {
    if (!parseResult) return undefined;
    if (!cfg.floorVisible) return parseResult.polygons;
    return [...parseResult.polygons, ...buildFloorPolygons()];
  }, [parseResult, cfg.floorVisible]);

  return (
    <PolyCamera rotX={rotX} rotY={rotY} zoom={zoom}>
      <PolyScene
        directionalLight={directionalLight}
        ambientLight={ambientLight}
        shadow={shadow}
        textureLighting={cfg.mode}
        strategies={cfg.strategies}
        autoCenter={cfg.autoCenter}
        centerPolygons={centerPolys}
      >
        <PolyOrbitControls drag wheel animate={false}
          onChange={cfg.sync ? (snap: { rotX?: number; rotY?: number; zoom?: number }) => {
            if (typeof snap.rotX === "number") setRotX(snap.rotX);
            if (typeof snap.rotY === "number") setRotY(snap.rotY);
            if (typeof snap.zoom === "number") setZoom(snap.zoom);
            if (window.parent !== window) {
              window.parent.postMessage({ kind: "camera-changed", rotX: snap.rotX, rotY: snap.rotY, zoom: snap.zoom }, "*");
            }
          } : undefined}
        />
        {parseResult
          ? <PolyMesh polygons={parseResult.polygons} voxelSource={parseResult.voxelSource}
              castShadow={cfg.castShadow} receiveShadow={cfg.selfShadow}
              position={objPosition} scale={objScale} rotation={objRotation} />
          : cfg.preset.url
            ? <PolyMesh src={cfg.preset.url} mtlUrl={cfg.preset.mtlUrl}
                castShadow={cfg.castShadow} receiveShadow={cfg.selfShadow}
                position={objPosition} scale={objScale} rotation={objRotation} />
            : null}
        {cfg.floorVisible && (
          <PolyMesh polygons={buildFloorPolygons()} receiveShadow={cfg.floorReceives} />
        )}
      </PolyScene>
    </PolyCamera>
  );
}

async function main(): Promise<void> {
  const cfg = parseUrlParams() as CfgShape;

  // Inject the shared overlay first so meta-renderer, etc. exist when
  // createPerfRecorder fires inside PerfApp's effect. Skipped when
  // `?nohud=1` (clean screenshot capture).
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
  createRoot(host).render(<PerfApp cfg={cfg} parseResult={parseResult} />);
}

main().catch((err) => {
  console.error("perf-react entry failed", err);
  const fpsNow = document.getElementById("fps-now");
  if (fpsNow) fpsNow.textContent = "ERR";
});
