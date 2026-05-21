import { createRoot } from "react-dom/client";
import {
  PolyCamera,
  PolyScene,
  PolyOrbitControls,
  PolyIcosahedron,
} from "@layoutit/polycss-react";

function App() {
  return (
    <PolyCamera rotX={65} rotY={45} style={{ width: "100%", height: "100vh" }}>
      <PolyOrbitControls animate={{ speed: 0.3 }} />
      <PolyScene>
        <PolyIcosahedron size={100} color="#ff6644" />
      </PolyScene>
    </PolyCamera>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
