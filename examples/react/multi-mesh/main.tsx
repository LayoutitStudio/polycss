import { createRoot } from "react-dom/client";
import {
  PolyCamera,
  PolyScene,
  PolyOrbitControls,
  PolyBox,
  PolyTorus,
  PolyCone,
} from "@layoutit/polycss-react";

function App() {
  return (
    <PolyCamera rotX={65} rotY={45} zoom={0.1} style={{ width: "100%", height: "100vh" }}>
      <PolyOrbitControls />
      <PolyScene>
        <PolyBox  size={80} color="#4ecdc4" position={[-120, 0, 0]} />
        <PolyTorus color="#ff6644" position={[0, 0, 0]} />
        <PolyCone  color="#ffd166" position={[120, 0, 0]} />
      </PolyScene>
    </PolyCamera>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
