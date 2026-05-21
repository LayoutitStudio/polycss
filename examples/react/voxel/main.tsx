import { createRoot } from "react-dom/client";
import {
  PolyCamera,
  PolyScene,
  PolyOrbitControls,
  PolyMesh,
} from "@layoutit/polycss-react";

function App() {
  return (
    <PolyCamera rotX={65} rotY={45} style={{ width: "100%", height: "100vh" }}>
      <PolyOrbitControls />
      <PolyScene>
        <PolyMesh src="https://polycss.com/gallery/vox/apple.vox" autoCenter />
      </PolyScene>
    </PolyCamera>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
