import { memo, useMemo } from "react";
import type { ReactNode } from "react";
import type { Vec3 } from "@layoutit/polycss-core";
import { PolyCameraContext } from "./context";
import { usePolyCamera } from "./useCamera";

export interface PolyOrthographicCameraProps {
  zoom?: number;
  target?: Vec3;
  rotX?: number;
  rotY?: number;
  /** Camera pull-back in CSS pixels (dolly). Default 0. */
  distance?: number;
  children?: ReactNode;
  className?: string;
  style?: React.CSSProperties;
}

function PolyOrthographicCameraInner({
  zoom,
  target,
  rotX,
  rotY,
  distance,
  children,
  className,
  style,
}: PolyOrthographicCameraProps) {
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
    projection: "orthographic",
    perspectiveStyle: "none",
  });

  const contextValue = useMemo(
    () => ({ store, cameraRef, sceneElRef, cameraElRef, applyTransformDirect }),
    [store, cameraRef, sceneElRef, cameraElRef, applyTransformDirect]
  );

  const cameraStyle: React.CSSProperties = {
    ...style,
    // Vanilla emits 1000000px instead of "none" because true `perspective: none`
    // sends Chrome down a compositor fast path that mis-rasterizes <u>
    // border-triangle leaves. A very large finite value is visually orthographic
    // but routes through the normal compositor path. Mirror that here so React
    // produces byte-identical output to vanilla.
    perspective: "1000000px",
  };

  return (
    <PolyCameraContext.Provider value={contextValue}>
      <div
        ref={cameraElRef}
        className={`polycss-camera${className ? ` ${className}` : ""}`}
        style={cameraStyle}
        data-polycss-camera-projection="orthographic"
        data-polycss-camera-perspective="none"
        data-polycss-camera-applied-perspective="1000000px"
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

export const PolyOrthographicCamera = memo(PolyOrthographicCameraInner);
