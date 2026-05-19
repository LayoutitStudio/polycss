/**
 * PolyCamera — alias for PolyOrthographicCamera.
 *
 * The default camera in polycss is orthographic — the engine's structural
 * advantages (integer-pixel atlas slicing, DOM-as-render-tree) are most
 * visible in iso/voxel/diagrammatic scenes. Use PolyPerspectiveCamera
 * explicitly when depth foreshortening is needed.
 */
export { PolyOrthographicCamera as PolyCamera } from "./PolyOrthographicCamera";
export type { PolyOrthographicCameraProps as PolyCameraProps } from "./PolyOrthographicCamera";
