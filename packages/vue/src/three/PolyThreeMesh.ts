import { computed, defineComponent, h, shallowRef } from "vue";
import type { CSSProperties, PropType } from "vue";
import {
  computeSceneBbox,
} from "@layoutit/polycss-core";
import type {
  LoadMeshOptions,
  MeshResolution,
  Polygon,
  PolyTextureBackend,
  PolyTextureImageRendering,
  PolyTextureLeafSizing,
  PolyTextureLightingMode,
  PolyTextureProjection,
  Vec3,
} from "@layoutit/polycss-core";
import {
  Object3D,
  transformPolygonsToPoly,
} from "@layoutit/polycss-core/three";
import type { Vector3Tuple } from "@layoutit/polycss-core/three";
import { PolyMesh } from "../scene/PolyMesh";
import { usePolyMesh } from "../scene/useMesh";

export interface PolyThreeMeshProps {
  id?: string;
  object?: Object3D;
  polygons?: Polygon[];
  src?: string;
  mtl?: string;
  position?: Vector3Tuple;
  rotation?: Vector3Tuple;
  scale?: number | Vector3Tuple;
  autoCenter?: boolean;
  textureLighting?: PolyTextureLightingMode;
  textureQuality?: number | "auto";
  textureLeafSizing?: PolyTextureLeafSizing;
  textureImageRendering?: PolyTextureImageRendering;
  textureBackend?: PolyTextureBackend;
  textureProjection?: PolyTextureProjection;
  castShadow?: boolean;
  receiveShadow?: boolean;
  merge?: boolean;
  meshResolution?: MeshResolution;
  parseOptions?: LoadMeshOptions;
  class?: string;
  style?: CSSProperties | string;
}

function applyObjectProps(
  object: Object3D,
  props: Pick<PolyThreeMeshProps, "position" | "rotation" | "scale">,
): Object3D {
  if (props.position) object.position.set(props.position[0], props.position[1], props.position[2]);
  if (props.rotation) object.rotation.set(props.rotation[0], props.rotation[1], props.rotation[2]);
  if (typeof props.scale === "number") object.scale.set(props.scale, props.scale, props.scale);
  else if (props.scale) object.scale.set(props.scale[0], props.scale[1], props.scale[2]);
  return object;
}

function recenterPolygons(polygons: Polygon[]): Polygon[] {
  if (polygons.length === 0) return polygons;
  const bbox = computeSceneBbox(polygons);
  const center: Vec3 = [
    (bbox.min[0] + bbox.max[0]) / 2,
    (bbox.min[1] + bbox.max[1]) / 2,
    (bbox.min[2] + bbox.max[2]) / 2,
  ];
  if (center[0] === 0 && center[1] === 0 && center[2] === 0) return polygons;
  const shift = (v: Vec3): Vec3 => [v[0] - center[0], v[1] - center[1], v[2] - center[2]];
  return polygons.map((polygon) => ({
    ...polygon,
    vertices: polygon.vertices.map(shift),
    ...(polygon.textureTriangles?.length
      ? {
          textureTriangles: polygon.textureTriangles.map((triangle) => ({
            ...triangle,
            vertices: triangle.vertices.map(shift) as typeof triangle.vertices,
          })),
        }
      : null),
  }));
}

export const PolyThreeMesh = defineComponent({
  name: "PolyThreeMesh",
  inheritAttrs: false,
  props: {
    id: { type: String, default: undefined },
    object: { type: Object as PropType<Object3D>, default: undefined },
    polygons: { type: Array as PropType<Polygon[]>, default: undefined },
    src: { type: String, default: undefined },
    mtl: { type: String, default: undefined },
    position: { type: Array as unknown as PropType<Vector3Tuple>, default: undefined },
    rotation: { type: Array as unknown as PropType<Vector3Tuple>, default: undefined },
    scale: { type: [Number, Array] as unknown as PropType<number | Vector3Tuple>, default: undefined },
    autoCenter: { type: Boolean, default: false },
    textureLighting: { type: String as PropType<PolyTextureLightingMode>, default: undefined },
    textureQuality: { type: [Number, String] as PropType<number | "auto">, default: undefined },
    textureLeafSizing: { type: String as PropType<PolyTextureLeafSizing>, default: undefined },
    textureImageRendering: { type: String as PropType<PolyTextureImageRendering>, default: undefined },
    textureBackend: { type: String as PropType<PolyTextureBackend>, default: undefined },
    textureProjection: { type: String as PropType<PolyTextureProjection>, default: undefined },
    castShadow: { type: Boolean, default: false },
    receiveShadow: { type: Boolean, default: false },
    merge: { type: Boolean, default: true },
    meshResolution: { type: String as PropType<MeshResolution>, default: undefined },
    parseOptions: { type: Object as PropType<LoadMeshOptions>, default: undefined },
    class: { type: String, default: undefined },
    style: { type: [Object, String] as PropType<CSSProperties | string>, default: undefined },
  },
  setup(props, { attrs, slots }) {
    const objectRef = shallowRef<Object3D>(props.object ?? new Object3D());
    const srcRef = computed(() => props.src ?? "");
    const meshOptions = computed<LoadMeshOptions | undefined>(() => {
      if (!props.mtl && !props.parseOptions && props.meshResolution === undefined) return undefined;
      return {
        ...(props.parseOptions ?? {}),
        ...(props.mtl ? { mtlUrl: props.mtl } : {}),
        ...(props.meshResolution !== undefined ? { meshResolution: props.meshResolution } : {}),
      };
    });
    const fetched = usePolyMesh(srcRef, meshOptions.value);

    const sourcePolygons = computed(() => {
      const raw = props.polygons ?? (props.src ? fetched.polygons.value : []);
      return props.autoCenter ? recenterPolygons(raw) : raw;
    });
    const polyPolygons = computed(() => transformPolygonsToPoly(
      sourcePolygons.value,
      applyObjectProps(props.object ?? objectRef.value, {
        position: props.position,
        rotation: props.rotation,
        scale: props.scale,
      }),
    ));

    return () => {
      if (props.src && fetched.loading.value && polyPolygons.value.length === 0 && slots.fallback) {
        return slots.fallback();
      }
      if (props.src && fetched.error.value && slots.error) {
        return slots.error({ error: fetched.error.value });
      }

      return h(PolyMesh, {
        ...attrs,
        id: props.id,
        polygons: polyPolygons.value,
        autoCenter: false,
        textureLighting: props.textureLighting,
        textureQuality: props.textureQuality,
        textureLeafSizing: props.textureLeafSizing,
        textureImageRendering: props.textureImageRendering,
        textureBackend: props.textureBackend,
        textureProjection: props.textureProjection,
        castShadow: props.castShadow,
        receiveShadow: props.receiveShadow,
        merge: props.merge,
        meshResolution: props.meshResolution,
        class: props.class,
        style: props.style,
      }, slots);
    };
  },
});
