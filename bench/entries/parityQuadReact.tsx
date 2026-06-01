/**
 * parity-quad React mount entry. Bundled by bench/build.mjs into
 * bench/.generated/polycss-parity-quad-react.js so parity-quad.html can
 * `import { mount } from "./.generated/polycss-parity-quad-react.js"` and
 * stand up a self-contained React scene inside a host div.
 *
 * Mirrors the three-parity pattern: one state object drives everything;
 * each `update(state)` call re-renders with the new props. No iframes, no
 * postMessage. The orbit-controls onChange callback fires when the user
 * drags inside the React pane so the page can sync the other three.
 */
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import {
  PolyCamera,
  PolyScene,
  PolyOrbitControls,
  PolyMesh,
} from "@layoutit/polycss-react";
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
  shadow: { opacity: number; lift?: number };
  cam: { rotX: number; rotY: number; zoom: number };
}

type OrbitChange = (snap: { rotX: number; rotY: number; zoom: number }) => void;

function App({ state, onCameraChange }: { state: ParityQuadState; onCameraChange?: OrbitChange }) {
  return (
    <PolyCamera rotX={state.cam.rotX} rotY={state.cam.rotY} zoom={state.cam.zoom}>
      <PolyScene
        directionalLight={state.dir}
        ambientLight={state.amb}
        shadow={state.shadow}
        textureLighting={state.textureLighting}
        autoCenter={state.autoCenter}
        centerPolygons={state.floorVisible ? [...state.polygons, ...state.floorPolygons] : state.polygons}
      >
        <PolyOrbitControls drag wheel animate={false} onChange={onCameraChange} />
        <PolyMesh
          polygons={state.polygons}
          voxelSource={state.voxelSource}
          castShadow={state.castShadow}
          receiveShadow={state.selfShadow}
          position={state.obj.position}
          scale={state.obj.scale}
          rotation={state.obj.rotation}
        />
        {state.floorVisible && (
          <PolyMesh polygons={state.floorPolygons} receiveShadow={state.floorReceives} />
        )}
      </PolyScene>
    </PolyCamera>
  );
}

export interface ParityQuadMount {
  update(state: ParityQuadState): void;
  destroy(): void;
}

export function mount(host: HTMLElement, initial: ParityQuadState, onCameraChange?: OrbitChange): ParityQuadMount {
  const root: Root = createRoot(host);
  let current = initial;
  root.render(<App state={current} onCameraChange={onCameraChange} />);
  return {
    update(next) {
      current = next;
      root.render(<App state={current} onCameraChange={onCameraChange} />);
    },
    destroy() {
      root.unmount();
    },
  };
}

// Expose on window for vanilla-JS callers that load the bundle via <script
// type=module>. Direct ESM imports also work via the named export above.
(globalThis as Record<string, unknown>).__parityQuadReact = { mount };
