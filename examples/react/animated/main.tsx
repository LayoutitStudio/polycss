import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  PolyPerspectiveCamera,
  PolyScene,
  PolyOrbitControls,
  PolyMesh,
  usePolyAnimation,
} from "@layoutit/polycss-react";
import { loadMesh } from "@layoutit/polycss-react";
import type { ParseResult, PolyMeshHandle } from "@layoutit/polycss-react";

function AnimatedScene() {
  const [parseResult, setParseResult] = useState<ParseResult | null>(null);
  const meshRef = useRef<PolyMeshHandle | null>(null);

  useEffect(() => {
    let disposed = false;
    loadMesh("https://polycss.com/gallery/glb/AnimatedWizard.glb").then((result) => {
      if (!disposed) setParseResult(result);
    });
    return () => {
      disposed = true;
      parseResult?.dispose();
    };
  }, []);

  const { actions } = usePolyAnimation(
    parseResult?.animation?.clips,
    parseResult?.animation,
    meshRef,
  );

  useEffect(() => {
    if (parseResult?.animation?.clips[0]) {
      actions[parseResult.animation.clips[0].name]?.play();
    }
  }, [actions, parseResult]);

  if (!parseResult) return null;

  return (
    <PolyMesh
      ref={meshRef}
      polygons={parseResult.polygons}
      autoCenter
      merge={false}
    />
  );
}

function App() {
  return (
    <PolyPerspectiveCamera rotX={65} rotY={45} zoom={0.1} style={{ width: "100%", height: "100vh" }}>
      <PolyOrbitControls animate={{ speed: 0.3 }} />
      <PolyScene>
        <AnimatedScene />
      </PolyScene>
    </PolyPerspectiveCamera>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
