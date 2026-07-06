import { computed, defineComponent, h, provide, ref, watch } from "vue";
import type { PropType } from "vue";
import { OrthographicCamera } from "@layoutit/polycss-core/three";
import type { Vector3Tuple } from "@layoutit/polycss-core/three";
import { usePolyCamera } from "../camera/useCamera";
import { PolyCameraContextKey } from "../camera/context";

export interface PolyThreeOrthographicCameraProps {
  camera?: OrthographicCamera;
  left?: number;
  right?: number;
  top?: number;
  bottom?: number;
  near?: number;
  far?: number;
  zoom?: number;
  polyZoom?: number;
  viewportHeight?: number;
  position?: Vector3Tuple;
  lookAt?: Vector3Tuple;
  up?: Vector3Tuple;
  class?: string;
}

function applyCameraProps(
  camera: OrthographicCamera,
  props: PolyThreeOrthographicCameraProps,
): OrthographicCamera {
  if (props.left !== undefined) camera.left = props.left;
  if (props.right !== undefined) camera.right = props.right;
  if (props.top !== undefined) camera.top = props.top;
  if (props.bottom !== undefined) camera.bottom = props.bottom;
  if (props.near !== undefined) camera.near = props.near;
  if (props.far !== undefined) camera.far = props.far;
  if (props.zoom !== undefined) camera.zoom = props.zoom;
  if (props.position !== undefined) camera.position.set(props.position[0], props.position[1], props.position[2]);
  if (props.up !== undefined) camera.up.set(props.up[0], props.up[1], props.up[2]);
  if (props.lookAt !== undefined) camera.lookAt(props.lookAt[0], props.lookAt[1], props.lookAt[2]);
  return camera;
}

export const PolyThreeOrthographicCamera = defineComponent({
  name: "PolyThreeOrthographicCamera",
  props: {
    camera: { type: Object as PropType<OrthographicCamera>, default: undefined },
    left: { type: Number, default: -1 },
    right: { type: Number, default: 1 },
    top: { type: Number, default: 1 },
    bottom: { type: Number, default: -1 },
    near: { type: Number, default: 0.1 },
    far: { type: Number, default: 2000 },
    zoom: { type: Number, default: undefined },
    polyZoom: { type: Number, default: undefined },
    viewportHeight: { type: Number, default: undefined },
    position: { type: Array as unknown as PropType<Vector3Tuple>, default: undefined },
    lookAt: { type: Array as unknown as PropType<Vector3Tuple>, default: undefined },
    up: { type: Array as unknown as PropType<Vector3Tuple>, default: undefined },
    class: { type: String, default: undefined },
  },
  setup(props, { slots }) {
    const localCamera = new OrthographicCamera(props.left, props.right, props.top, props.bottom, props.near, props.far);
    const measuredHeight = ref(props.viewportHeight ?? 420);

    const polyCamera = computed(() => applyCameraProps(props.camera ?? localCamera, props).toPolyCameraState({
      zoom: props.polyZoom,
      viewportHeight: props.viewportHeight ?? measuredHeight.value,
    }));
    const cameraOptions = computed(() => ({
      zoom: polyCamera.value.zoom,
      target: polyCamera.value.target,
      rotX: polyCamera.value.rotX,
      rotY: polyCamera.value.rotY,
      distance: polyCamera.value.distance,
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

    watch(cameraElRef, (el, _prev, onCleanup) => {
      if (props.viewportHeight !== undefined || !el) return;
      const measure = () => {
        measuredHeight.value = el.getBoundingClientRect().height || el.clientHeight || 420;
      };
      measure();
      if (typeof ResizeObserver === "undefined") return;
      const observer = new ResizeObserver(measure);
      observer.observe(el);
      onCleanup(() => observer.disconnect());
    }, { flush: "post" });

    return () => h(
      "div",
      {
        ref: cameraElRef,
        class: `polycss-camera${props.class ? ` ${props.class}` : ""}`,
        style: { perspective: "none" },
        "data-polycss-camera-projection": "orthographic",
        "data-polycss-camera-perspective": "none",
        "data-polycss-camera-applied-perspective": "1000000px",
        "data-polycss-camera-zoom": cameraRef.value.state.zoom,
        "data-polycss-camera-distance": cameraRef.value.state.distance,
        "data-polycss-camera-rot-x": cameraRef.value.state.rotX,
        "data-polycss-camera-rot-y": cameraRef.value.state.rotY,
        "data-polycss-camera-target": cameraRef.value.state.target.join(","),
      },
      slots.default?.(),
    );
  },
});
