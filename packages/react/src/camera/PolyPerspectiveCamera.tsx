import { memo, useMemo } from "react";
import type { ReactNode } from "react";
import type { Vec3 } from "@layoutit/polycss-core";
import { PolyCameraContext } from "./context";
import { usePolyCamera } from "./useCamera";

export interface PolyPerspectiveCameraProps {
  zoom?: number;
  target?: Vec3;
  rotX?: number;
  rotY?: number;
  /** Camera pull-back in CSS pixels (dolly). Default 0. */
  distance?: number;
  /** CSS perspective distance in pixels. Defaults to 32000. */
  perspective?: number;
  children?: ReactNode;
  className?: string;
  style?: React.CSSProperties;
}

const DEFAULT_PERSPECTIVE = 32000;

function PolyPerspectiveCameraInner({
  zoom,
  target,
  rotX,
  rotY,
  distance,
  perspective,
  children,
  className,
  style,
}: PolyPerspectiveCameraProps) {
  const perspectiveValue = `${typeof perspective === "number" ? perspective : DEFAULT_PERSPECTIVE}px`;
  const {
    store,
    cameraRef,
    sceneElRef,
    cameraElRef,
    applyTransformDirect,
  } = usePolyCamera({
    zoom,
    target,
    rotX,
    rotY,
    distance,
    projection: "perspective",
    perspectiveStyle: perspectiveValue,
  });

  const contextValue = useMemo(
    () => ({ store, cameraRef, sceneElRef, cameraElRef, applyTransformDirect }),
    [store, cameraRef, sceneElRef, cameraElRef, applyTransformDirect]
  );

  const cameraStyle: React.CSSProperties = {
    ...style,
    perspective: perspectiveValue,
  };

  return (
    <PolyCameraContext.Provider value={contextValue}>
      <div
        ref={cameraElRef}
        className={`polycss-camera${className ? ` ${className}` : ""}`}
        style={cameraStyle}
        data-polycss-camera-projection="perspective"
        data-polycss-camera-perspective={perspectiveValue}
        data-polycss-camera-applied-perspective={perspectiveValue}
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

export const PolyPerspectiveCamera = memo(PolyPerspectiveCameraInner);
