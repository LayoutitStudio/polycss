/**
 * PolyOrthographicCamera — Vue camera component with no CSS perspective.
 * Mirrors React's PolyOrthographicCamera.
 *
 * Sets `perspective: none` on the wrapper element, yielding an isometric-style
 * flat projection. Prefer this over PolyCamera with perspective=false for
 * explicit three.js-style naming.
 */
import { defineComponent, h, provide, computed } from "vue";
import type { PropType } from "vue";
import type { Vec3 } from "@layoutit/polycss-core";
import { usePolyCamera } from "./useCamera";
import { PolyCameraContextKey } from "./context";

export interface PolyOrthographicCameraProps {
  zoom?: number;
  target?: Vec3;
  rotX?: number;
  rotY?: number;
  /** Camera pull-back in CSS pixels (dolly). Default 0. */
  distance?: number;
  class?: string;
}

export const PolyOrthographicCamera = defineComponent({
  name: "PolyOrthographicCamera",
  props: {
    zoom: { type: Number },
    target: { type: Array as unknown as PropType<Vec3> },
    rotX: { type: Number },
    rotY: { type: Number },
    distance: { type: Number },
    class: { type: String },
  },
  setup(props, { slots }) {
    const cameraOptions = computed(() => ({
      zoom: props.zoom,
      target: props.target,
      rotX: props.rotX,
      rotY: props.rotY,
      distance: props.distance,
      projection: "orthographic" as const,
      perspectiveStyle: "none",
    }));

    const {
      store,
      cameraRef,
      sceneElRef,
      cameraElRef,
      autoCenterOffset,
      applyTransformDirect,
    } = usePolyCamera(cameraOptions);

    provide(PolyCameraContextKey, { store, cameraRef, sceneElRef, cameraElRef, autoCenterOffset, applyTransformDirect });

    return () => {
      return h(
        "div",
        {
          ref: cameraElRef,
          class: `polycss-camera${props.class ? ` ${props.class}` : ""}`,
          // Vanilla emits 1000000px instead of "none" because true
          // `perspective: none` sends Chrome down a compositor fast path that
          // mis-rasterizes <u> border-triangle leaves. A very large finite
          // value is visually orthographic but routes through the normal
          // compositor path. Mirror that here so Vue produces byte-identical
          // output to vanilla.
          style: { perspective: "1000000px" },
          "data-polycss-camera-projection": "orthographic",
          "data-polycss-camera-perspective": "none",
          "data-polycss-camera-applied-perspective": "1000000px",
          "data-polycss-camera-zoom": cameraRef.value.state.zoom,
          "data-polycss-camera-distance": cameraRef.value.state.distance,
          "data-polycss-camera-rot-x": cameraRef.value.state.rotX,
          "data-polycss-camera-rot-y": cameraRef.value.state.rotY,
          "data-polycss-camera-target": cameraRef.value.state.target.join(","),
        },
        slots.default?.()
      );
    };
  },
});
