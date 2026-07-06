import { memo, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { PerspectiveCamera } from "@layoutit/polycss-core/three";
import type { Vector3Tuple } from "@layoutit/polycss-core/three";
import { PolyCameraContext } from "../camera/context";
import { usePolyCamera } from "../camera/useCamera";

export interface PolyThreePerspectiveCameraProps {
  camera?: PerspectiveCamera;
  fov?: number;
  aspect?: number;
  near?: number;
  far?: number;
  zoom?: number;
  polyZoom?: number;
  perspective?: number;
  viewportHeight?: number;
  position?: Vector3Tuple;
  lookAt?: Vector3Tuple;
  up?: Vector3Tuple;
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
}

function applyCameraProps(
  camera: PerspectiveCamera,
  props: Pick<PolyThreePerspectiveCameraProps, "fov" | "aspect" | "near" | "far" | "zoom" | "position" | "lookAt" | "up">,
): PerspectiveCamera {
  if (props.fov !== undefined) camera.fov = props.fov;
  if (props.aspect !== undefined) camera.aspect = props.aspect;
  if (props.near !== undefined) camera.near = props.near;
  if (props.far !== undefined) camera.far = props.far;
  if (props.zoom !== undefined) camera.zoom = props.zoom;
  if (props.position !== undefined) camera.position.set(props.position[0], props.position[1], props.position[2]);
  if (props.up !== undefined) camera.up.set(props.up[0], props.up[1], props.up[2]);
  if (props.lookAt !== undefined) camera.lookAt(props.lookAt[0], props.lookAt[1], props.lookAt[2]);
  return camera;
}

function PolyThreePerspectiveCameraInner({
  camera: cameraProp,
  fov = 50,
  aspect = 1,
  near = 0.1,
  far = 2000,
  zoom,
  polyZoom,
  perspective,
  viewportHeight,
  position,
  lookAt,
  up,
  className,
  style,
  children,
}: PolyThreePerspectiveCameraProps) {
  const localCameraRef = useRef<PerspectiveCamera | null>(null);
  if (!localCameraRef.current) {
    localCameraRef.current = new PerspectiveCamera(fov, aspect, near, far);
  }

  const [measuredHeight, setMeasuredHeight] = useState(viewportHeight ?? 420);
  const camera = applyCameraProps(cameraProp ?? localCameraRef.current, {
    fov,
    aspect,
    near,
    far,
    zoom,
    position,
    lookAt,
    up,
  });
  const polyCamera = camera.toPolyCameraState({
    zoom: polyZoom,
    perspective,
    viewportHeight: viewportHeight ?? measuredHeight,
  });
  const perspectiveStyle = `${polyCamera.perspective}px`;

  const {
    store,
    cameraRef,
    sceneElRef,
    cameraElRef,
    applyTransformDirect,
  } = usePolyCamera({
    zoom: polyCamera.zoom,
    target: polyCamera.target,
    rotX: polyCamera.rotX,
    rotY: polyCamera.rotY,
    distance: polyCamera.distance,
    projection: "perspective",
    perspectiveStyle,
  });

  useEffect(() => {
    if (viewportHeight !== undefined) return;
    const el = cameraElRef.current;
    if (!el) return;
    const measure = () => {
      const next = el.getBoundingClientRect().height || el.clientHeight || 420;
      setMeasuredHeight(next);
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [cameraElRef, viewportHeight]);

  const contextValue = useMemo(
    () => ({ store, cameraRef, sceneElRef, cameraElRef, applyTransformDirect }),
    [store, cameraRef, sceneElRef, cameraElRef, applyTransformDirect],
  );

  return (
    <PolyCameraContext.Provider value={contextValue}>
      <div
        ref={cameraElRef}
        className={`polycss-camera${className ? ` ${className}` : ""}`}
        style={{ ...style, perspective: perspectiveStyle }}
        data-polycss-camera-projection="perspective"
        data-polycss-camera-perspective={perspectiveStyle}
        data-polycss-camera-applied-perspective={perspectiveStyle}
        data-polycss-camera-zoom={cameraRef.current.state.zoom}
        data-polycss-camera-distance={cameraRef.current.state.distance}
        data-polycss-camera-rot-x={cameraRef.current.state.rotX}
        data-polycss-camera-rot-y={cameraRef.current.state.rotY}
        data-polycss-camera-target={cameraRef.current.state.target.join(",")}
      >
        {children}
      </div>
    </PolyCameraContext.Provider>
  );
}

export const PolyThreePerspectiveCamera = memo(PolyThreePerspectiveCameraInner);
