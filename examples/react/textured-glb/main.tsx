import { createRoot } from "react-dom/client";
import {
  PolyPerspectiveCamera,
  PolyScene,
  PolyOrbitControls,
  PolyMesh,
} from "@layoutit/polycss-react";

function App() {
  return (
    <PolyPerspectiveCamera rotX={65} rotY={45} zoom={0.1} style={{ width: "100%", height: "100vh" }}>
      <PolyOrbitControls animate={{ speed: 0.3 }} />
      <PolyScene>
        <PolyMesh
          src="https://polycss.com/gallery/obj/cottage.obj"
          mtl="https://polycss.com/gallery/obj/cottage.mtl"
          autoCenter
        />
      </PolyScene>
    </PolyPerspectiveCamera>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
