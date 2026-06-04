/**
 * @layoutit/polycss/elements — side-effect entry that registers the PolyCSS custom
 * elements with `customElements`.
 *
 * Importing this module has the effect of making the elements available
 * in HTML. Re-imports are safe (idempotent registration check).
 *
 * In non-DOM environments (SSR, Node test runners without happy-dom),
 * `customElements` is undefined and we silently no-op so importing this
 * module doesn't crash the bundle.
 */
import { PolySceneElement } from "./PolySceneElement";
import { PolyMeshElement } from "./PolyMeshElement";
import { PolyIframeElement } from "./PolyIframeElement";
import { PolyPolygonElement } from "./PolyPolygonElement";
import { PolyAxesHelperElement } from "./PolyAxesHelperElement";
import { PolyDirectionalLightHelperElement } from "./PolyDirectionalLightHelperElement";
import { PolyOrbitControlsElement } from "./PolyOrbitControlsElement";
import { PolyMapControlsElement } from "./PolyMapControlsElement";
import { PolyFirstPersonControlsElement } from "./PolyFirstPersonControlsElement";
import { PolyPerspectiveCameraElement } from "./PolyPerspectiveCameraElement";
import { PolyOrthographicCameraElement } from "./PolyOrthographicCameraElement";
import { PolyCameraElement } from "./PolyCameraElement";
import { PolyTransformControlsElement } from "./PolyTransformControlsElement";
import { PolySelectElement } from "./PolySelectElement";
import {
  PolyBoxElement,
  PolyPlaneElement,
  PolyRingElement,
  PolyOctahedronElement,
  PolySphereElement,
  PolyTetrahedronElement,
  PolyIcosahedronElement,
  PolyDodecahedronElement,
  PolyCylinderElement,
  PolyConeElement,
  PolyTorusElement,
} from "./PolyShapeElements";

if (typeof customElements !== "undefined") {
  if (!customElements.get("poly-scene")) {
    customElements.define("poly-scene", PolySceneElement);
  }
  if (!customElements.get("poly-mesh")) {
    customElements.define("poly-mesh", PolyMeshElement);
  }
  if (!customElements.get("poly-iframe")) {
    customElements.define("poly-iframe", PolyIframeElement);
  }
  if (!customElements.get("poly-polygon")) {
    customElements.define("poly-polygon", PolyPolygonElement);
  }
  if (!customElements.get("poly-axes-helper")) {
    customElements.define("poly-axes-helper", PolyAxesHelperElement);
  }
  if (!customElements.get("poly-directional-light-helper")) {
    customElements.define(
      "poly-directional-light-helper",
      PolyDirectionalLightHelperElement,
    );
  }
  if (!customElements.get("poly-orbit-controls")) {
    customElements.define("poly-orbit-controls", PolyOrbitControlsElement);
  }
  if (!customElements.get("poly-map-controls")) {
    customElements.define("poly-map-controls", PolyMapControlsElement);
  }
  if (!customElements.get("poly-first-person-controls")) {
    customElements.define("poly-first-person-controls", PolyFirstPersonControlsElement);
  }
  if (!customElements.get("poly-perspective-camera")) {
    customElements.define("poly-perspective-camera", PolyPerspectiveCameraElement);
  }
  if (!customElements.get("poly-orthographic-camera")) {
    customElements.define("poly-orthographic-camera", PolyOrthographicCameraElement);
  }
  if (!customElements.get("poly-camera")) {
    customElements.define("poly-camera", PolyCameraElement);
  }
  if (!customElements.get("poly-transform-controls")) {
    customElements.define("poly-transform-controls", PolyTransformControlsElement);
  }
  if (!customElements.get("poly-select")) {
    customElements.define("poly-select", PolySelectElement);
  }
  if (!customElements.get("poly-box")) {
    customElements.define("poly-box", PolyBoxElement);
  }
  if (!customElements.get("poly-plane")) {
    customElements.define("poly-plane", PolyPlaneElement);
  }
  if (!customElements.get("poly-ring")) {
    customElements.define("poly-ring", PolyRingElement);
  }
  if (!customElements.get("poly-octahedron")) {
    customElements.define("poly-octahedron", PolyOctahedronElement);
  }
  if (!customElements.get("poly-tetrahedron")) {
    customElements.define("poly-tetrahedron", PolyTetrahedronElement);
  }
  if (!customElements.get("poly-sphere")) {
    customElements.define("poly-sphere", PolySphereElement);
  }
  if (!customElements.get("poly-icosahedron")) {
    customElements.define("poly-icosahedron", PolyIcosahedronElement);
  }
  if (!customElements.get("poly-dodecahedron")) {
    customElements.define("poly-dodecahedron", PolyDodecahedronElement);
  }
  if (!customElements.get("poly-cylinder")) {
    customElements.define("poly-cylinder", PolyCylinderElement);
  }
  if (!customElements.get("poly-cone")) {
    customElements.define("poly-cone", PolyConeElement);
  }
  if (!customElements.get("poly-torus")) {
    customElements.define("poly-torus", PolyTorusElement);
  }
}

export {
  PolySceneElement,
  PolyMeshElement,
  PolyIframeElement,
  PolyPolygonElement,
  PolyAxesHelperElement,
  PolyDirectionalLightHelperElement,
  PolyOrbitControlsElement,
  PolyMapControlsElement,
  PolyFirstPersonControlsElement,
  PolyPerspectiveCameraElement,
  PolyOrthographicCameraElement,
  PolyCameraElement,
  PolyTransformControlsElement,
  PolySelectElement,
  PolyBoxElement,
  PolyPlaneElement,
  PolyRingElement,
  PolyOctahedronElement,
  PolySphereElement,
  PolyTetrahedronElement,
  PolyIcosahedronElement,
  PolyDodecahedronElement,
  PolyCylinderElement,
  PolyConeElement,
  PolyTorusElement,
};
