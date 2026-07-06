import type {
  ParseResult,
  Polygon,
} from "@layoutit/polycss-core";
import {
  OrthographicCamera,
  PerspectiveCamera,
} from "@layoutit/polycss-core/three";
import type {
  PolyOrthographicCameraFromThreeOptions,
  PolyPerspectiveCameraFromThreeOptions,
} from "@layoutit/polycss-core/three";
import {
  createPolyOrthographicCamera,
  createPolyPerspectiveCamera,
  createPolyScene,
} from "./index";
import type {
  PolyMeshTransform,
  PolySceneHandle,
  PolySceneOptions,
} from "./index";

export {
  AmbientLight,
  DirectionalLight,
  Euler,
  Object3D,
  OrthographicCamera,
  PerspectiveCamera,
  PointLight,
  Vector3,
  polyToThreeDirection,
  polyToThreePoint,
  threeToPolyDirection,
  threeToPolyPoint,
  transformPointToPoly,
  transformPolygonsToPoly,
} from "@layoutit/polycss-core/three";
export type {
  PolyCameraFromThreeOptions,
  PolyOrthographicCameraFromThreeOptions,
  PolyOrthographicCameraOptionsFromThree,
  PolyPerspectiveCameraFromThreeOptions,
  PolyPerspectiveCameraOptionsFromThree,
  Vector3Tuple,
} from "@layoutit/polycss-core/three";

export {
  boxPolygons,
  loadMesh,
  octahedronPolygons,
  planePolygons,
  spherePolygons,
  tetrahedronPolygons,
  icosahedronPolygons,
  dodecahedronPolygons,
  cylinderPolygons,
  conePolygons,
  torusPolygons,
} from "@layoutit/polycss-core";
export type {
  LoadMeshOptions,
  ParseResult,
  Polygon,
  PolyAmbientLight,
  PolyDirectionalLight,
  PolyPointLight,
  Vec3,
} from "@layoutit/polycss-core";

export {
  createPolyOrthographicCamera,
  createPolyPerspectiveCamera,
  createPolyScene,
};

export function createPolyPerspectiveCameraFromThree(
  camera: PerspectiveCamera,
  options: PolyPerspectiveCameraFromThreeOptions = {},
) {
  return createPolyPerspectiveCamera(camera.toPolyCameraState(options));
}

export function createPolyOrthographicCameraFromThree(
  camera: OrthographicCamera,
  options: PolyOrthographicCameraFromThreeOptions = {},
) {
  return createPolyOrthographicCamera(camera.toPolyCameraState(options));
}

export interface PolyThreeMeshMount {
  polygons: Polygon[];
  transform?: PolyMeshTransform;
}

export interface MountPolyThreeSceneOptions extends Omit<PolySceneOptions, "camera"> {
  camera: PerspectiveCamera | OrthographicCamera;
  cameraOptions?: PolyPerspectiveCameraFromThreeOptions | PolyOrthographicCameraFromThreeOptions;
  polygons?: Polygon[];
  meshes?: PolyThreeMeshMount[];
}

export function mountPolyThreeScene(
  host: HTMLElement,
  options: MountPolyThreeSceneOptions,
): PolySceneHandle {
  const camera = options.camera instanceof PerspectiveCamera
    ? createPolyPerspectiveCameraFromThree(
        options.camera,
        options.cameraOptions as PolyPerspectiveCameraFromThreeOptions | undefined,
      )
    : createPolyOrthographicCameraFromThree(
        options.camera,
        options.cameraOptions as PolyOrthographicCameraFromThreeOptions | undefined,
      );

  const {
    camera: _camera,
    cameraOptions: _cameraOptions,
    polygons,
    meshes,
    ...sceneOptions
  } = options;
  const scene = createPolyScene(host, { ...sceneOptions, camera });

  if (meshes) {
    for (const mesh of meshes) {
      scene.add(parseResultFromPolygons(mesh.polygons), {
        merge: false,
        ...mesh.transform,
      });
    }
  } else {
    scene.add(parseResultFromPolygons(polygons ?? []), { merge: false });
  }

  return scene;
}

function parseResultFromPolygons(polygons: Polygon[]): ParseResult {
  return {
    polygons,
    objectUrls: [],
    warnings: [],
    dispose() {},
  };
}
