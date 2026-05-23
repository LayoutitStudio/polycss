import { useMemo, type RefObject } from "react";
import {
  PolyAxesHelper,
  PolyOrthographicCamera,
  PolyPerspectiveCamera,
  PolyMapControls,
  PolyOrbitControls,
  PolyMesh,
  PolyScene,
  PolySelect,
  PolyTransformControls,
  octahedronPolygons,
} from "@layoutit/polycss-react";
import type {
  PolyAmbientLight,
  PolyDirectionalLight,
  PolyMeshHandle,
  Polygon,
  Vec3,
} from "@layoutit/polycss-react";
import {
  cameraCullNormalGroupsFromPolygons,
  isVoxelCameraCullableNormalGroups,
  polygonFacesCamera,
  type TextureQuality,
} from "@layoutit/polycss";
import { meshResolutionShowsMesh, type GizmoMode, type SceneOptionsState } from "../types";

const LIGHT_HELPER_TILE = 50;

function LightHelperMesh({
  light,
  target,
  distance,
  size,
}: {
  light: PolyDirectionalLight;
  target: Vec3;
  distance: number;
  size: number;
}) {
  const swatch = light.color ?? "#ffd54a";
  const polygons = useMemo(
    () => octahedronPolygons({ center: [0, 0, 0], size, color: swatch }),
    [size, swatch],
  );
  const position = useMemo<Vec3>(() => {
    const [dx, dy, dz] = light.direction;
    const len = Math.hypot(dx, dy, dz) || 1;
    return [
      (target[1] + (dx / len) * distance) * LIGHT_HELPER_TILE,
      (target[0] + (dy / len) * distance) * LIGHT_HELPER_TILE,
      (target[2] + (dz / len) * distance) * LIGHT_HELPER_TILE,
    ];
  }, [light.direction, target, distance]);

  return (
    <PolyMesh
      id="light-helper"
      className="dn-light-helper"
      polygons={polygons}
      position={position}
    />
  );
}

function canCullCameraBackfaces(polygons: Polygon[]): boolean {
  return isVoxelCameraCullableNormalGroups(cameraCullNormalGroupsFromPolygons(polygons));
}

function cullCameraBackfaces(
  polygons: Polygon[],
  rotX: number,
  rotY: number,
  meshRotation?: Vec3,
): Polygon[] {
  return polygons.filter((polygon) => polygonFacesCamera(polygon, { rotX, rotY, meshRotation }));
}

export interface ReactSceneProps {
  rendererDebugKey: string;
  sceneOptions: SceneOptionsState;
  scenePolygons: Polygon[];
  interiorShellPolygons: Polygon[];
  directionalLight: PolyDirectionalLight;
  ambientLight: PolyAmbientLight;
  textureQuality: TextureQuality;
  gizmoDragging: boolean;
  setGizmoDragging: (v: boolean) => void;
  handleCameraChange: (cam: { rotX: number; rotY: number; zoom: number; target?: Vec3 }) => void;
  loaded: { label?: string } | null;
  selectedMeshes: PolyMeshHandle[];
  setSelectedMeshes: (meshes: PolyMeshHandle[]) => void;
  meshRef: RefObject<PolyMeshHandle | null>;
  meshPosition: Vec3;
  setMeshPosition: (pos: Vec3) => void;
  meshRotation: Vec3;
  setMeshRotation: (rot: Vec3) => void;
  hoveredMeshId: string | null;
  setHoveredMeshId: (id: string | null) => void;
  gizmoMode: GizmoMode;
  helperScale: number;
  helperTarget: [number, number, number];
}

export function ReactScene({
  rendererDebugKey,
  sceneOptions,
  scenePolygons,
  interiorShellPolygons,
  directionalLight,
  ambientLight,
  textureQuality,
  gizmoDragging,
  setGizmoDragging,
  handleCameraChange,
  loaded,
  selectedMeshes,
  setSelectedMeshes,
  meshRef,
  meshPosition,
  setMeshPosition,
  meshRotation,
  setMeshRotation,
  hoveredMeshId,
  setHoveredMeshId,
  gizmoMode,
  helperScale,
  helperTarget,
}: ReactSceneProps) {
  const Cam = sceneOptions.perspective === false ? PolyOrthographicCamera : PolyPerspectiveCamera;
  const camProps = sceneOptions.perspective === false
    ? { zoom: sceneOptions.zoom, rotX: sceneOptions.rotX, rotY: sceneOptions.rotY, target: sceneOptions.target }
    : { zoom: sceneOptions.zoom, rotX: sceneOptions.rotX, rotY: sceneOptions.rotY, target: sceneOptions.target, perspective: sceneOptions.perspective };
  const orbitCameraDrag = sceneOptions.interactive && !gizmoDragging;
  const mapCameraDrag = sceneOptions.interactive && !gizmoDragging;
  const centerPolygons = scenePolygons;
  const effectiveMeshRotation = sceneOptions.selection ? meshRotation : undefined;
  const canCullScenePolygons = useMemo(
    () => canCullCameraBackfaces(scenePolygons),
    [scenePolygons],
  );
  const visibleScenePolygons = useMemo(
    () => canCullScenePolygons
      ? cullCameraBackfaces(scenePolygons, sceneOptions.rotX, sceneOptions.rotY, effectiveMeshRotation)
      : scenePolygons,
    [scenePolygons, canCullScenePolygons, sceneOptions.rotX, sceneOptions.rotY, effectiveMeshRotation],
  );
  const shellMesh = interiorShellPolygons.length > 0 ? (
    <PolyMesh
      polygons={interiorShellPolygons}
      className="dn-interior-shell-mesh"
    />
  ) : null;
  const modelClassName = [
    "dn-model-mesh",
    !meshResolutionShowsMesh(sceneOptions.meshResolution) ? "is-mesh-hidden" : "",
    sceneOptions.hoverEffects && hoveredMeshId === (loaded?.label ?? "model") ? "is-hovered" : "",
  ].filter(Boolean).join(" ");
  return (
    <Cam key={rendererDebugKey} {...camProps}>
      {sceneOptions.dragMode === "pan" ? (
        <PolyMapControls
          drag={mapCameraDrag}
          wheel={sceneOptions.interactive && !gizmoDragging}
          animate={sceneOptions.animate ? { speed: 0.35, axis: "y", pauseOnInteraction: true } : false}
          onInteractionEnd={handleCameraChange}
        />
      ) : (
        // FPV control mode is vanilla-only in this spike; the React
        // renderer keeps orbit semantics for now.
        <PolyOrbitControls
          drag={orbitCameraDrag}
          wheel={sceneOptions.interactive && !gizmoDragging}
          animate={sceneOptions.animate ? { speed: 0.35, axis: "y", pauseOnInteraction: true } : false}
          onInteractionEnd={handleCameraChange}
        />
      )}
      <PolyScene
        polygons={[]}
        centerPolygons={centerPolygons}
        autoCenter={sceneOptions.autoCenter}
        directionalLight={directionalLight}
        ambientLight={ambientLight}
        textureLighting={sceneOptions.textureLighting}
        textureQuality={textureQuality}
        strategies={{ disable: sceneOptions.disableStrategies }}
        shadow={{ maxExtend: sceneOptions.shadowMaxExtend }}
      >
        {sceneOptions.selection ? (
          <PolySelect onChange={setSelectedMeshes} clearOnMiss={false}>
            <PolyMesh
              ref={meshRef}
              id={loaded?.label ?? "model"}
              polygons={visibleScenePolygons}
              position={meshPosition}
              rotation={meshRotation}
              className={modelClassName}
              style={sceneOptions.hoverEffects ? { cursor: "pointer" } : undefined}
              onPointerOver={
                sceneOptions.hoverEffects
                  ? (event) => setHoveredMeshId(event.eventObject.id ?? null)
                  : undefined
              }
              onPointerOut={
                sceneOptions.hoverEffects ? () => setHoveredMeshId(null) : undefined
              }
            >
              {shellMesh}
            </PolyMesh>
          </PolySelect>
        ) : null}
        {!sceneOptions.selection ? (
          <PolyMesh
            id={loaded?.label ?? "model"}
            polygons={visibleScenePolygons}
            className={modelClassName}
          >
            {shellMesh}
          </PolyMesh>
        ) : null}
        {sceneOptions.selection && selectedMeshes.length > 0 && (
          <PolyTransformControls
            object={meshRef}
            mode={gizmoMode}
            onObjectChange={(event) => {
              if (event.position) setMeshPosition(event.position);
              if (event.rotation) setMeshRotation(event.rotation);
            }}
            onDraggingChanged={setGizmoDragging}
          />
        )}
        {sceneOptions.showAxes && <PolyAxesHelper size={helperScale * 0.6} />}
        {sceneOptions.showLight && (
          <LightHelperMesh
            light={directionalLight}
            target={helperTarget}
            distance={helperScale * 0.7}
            size={helperScale * 0.05}
          />
        )}
      </PolyScene>
    </Cam>
  );
}
