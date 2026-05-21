import { createRoot } from "react-dom/client";
import {
  PolyPerspectiveCamera,
  PolyScene,
  PolyOrbitControls,
  PolyMesh,
} from "@layoutit/polycss-react";

function App() {
  return (
    <PolyPerspectiveCamera rotX={65} rotY={45} zoom={0.3} style={{ width: "100%", height: "100vh" }}>
      <PolyOrbitControls animate={{ speed: 0.3 }} />
      <PolyScene>
        <PolyMesh src="https://polycss.com/gallery/glb/apple.glb" autoCenter />
      </PolyScene>
    </PolyPerspectiveCamera>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
