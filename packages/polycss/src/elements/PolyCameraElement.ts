/**
 * <poly-camera> — ergonomic alias for <poly-orthographic-camera>.
 *
 * The default camera in polycss is orthographic. `<poly-camera>` maps to
 * `PolyOrthographicCameraElement` so the canonical tree shape works without
 * spelling out "orthographic" when it isn't relevant to the scene being built.
 *
 * Use <poly-perspective-camera> when depth foreshortening is needed.
 */
import { PolyOrthographicCameraElement } from "./PolyOrthographicCameraElement";

export class PolyCameraElement extends PolyOrthographicCameraElement {}
