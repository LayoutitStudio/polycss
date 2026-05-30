/**
 * Primitive shape components — thin wrappers over the polygon generators in
 * @layoutit/polycss-core. Each component calls the matching `xPolygons()`
 * generator and passes the result to `<PolyMesh :polygons="...">`.
 *
 * Props are flat (shape geometry + common PolyMesh props). No geometry/material
 * split — a Polygon carries its own color/texture.
 */
import { computed, defineComponent, h } from "vue";
import type { PropType } from "vue";
import {
  boxPolygons,
  planePolygons,
  ringPolygons,
  octahedronPolygons,
  spherePolygons,
  tetrahedronPolygons,
  icosahedronPolygons,
  dodecahedronPolygons,
  cylinderPolygons,
  conePolygons,
  torusPolygons,
} from "@layoutit/polycss-core";
import type {
  BoxPolygonsOptions,
  PlanePolygonsOptions,
  RingPolygonsOptions,
  OctahedronPolygonsOptions,
  SpherePolygonsOptions,
  TetrahedronPolygonsOptions,
  IcosahedronPolygonsOptions,
  DodecahedronPolygonsOptions,
  CylinderPolygonsOptions,
  ConePolygonsOptions,
  TorusPolygonsOptions,
  PolyMaterial,
  Vec2,
  Vec3,
} from "@layoutit/polycss-core";
import { PolyMesh } from "../scene/PolyMesh";
import type { PolyMeshProps } from "../scene/PolyMesh";

// ── Shared mesh prop pass-through helpers ────────────────────────────────────
// We spread the mesh-compatible props without src/mtl/polygons (those are
// controlled by the shape component). Vue doesn't allow direct key exclusion
// from interfaces, so we pick explicit passes through `attrs` where needed.
type ShapeMeshProps = Omit<PolyMeshProps, "polygons" | "src" | "mtl">;

// ── Fixed-geometry primitives ─────────────────────────────────────────────────

export interface PolyBoxProps extends ShapeMeshProps, BoxPolygonsOptions {}

export const PolyBox = defineComponent({
  name: "PolyBox",
  props: {
    // BoxPolygonsOptions
    size: { type: [Number, Array] as PropType<number | Vec3>, default: undefined },
    center: { type: Array as unknown as PropType<Vec3>, default: undefined },
    min: { type: Array as unknown as PropType<Vec3>, default: undefined },
    max: { type: Array as unknown as PropType<Vec3>, default: undefined },
    color: { type: String, default: undefined },
    texture: { type: String, default: undefined },
    material: { type: Object as PropType<PolyMaterial>, default: undefined },
    uvs: { type: Array as PropType<Vec2[]>, default: undefined },
    data: { type: Object as PropType<BoxPolygonsOptions["data"]>, default: undefined },
    faces: { type: Object as PropType<BoxPolygonsOptions["faces"]>, default: undefined },
    // Common mesh props
    position: { type: Array as unknown as PropType<Vec3>, default: undefined },
    scale: { type: [Number, Array] as unknown as PropType<number | Vec3>, default: undefined },
    rotation: { type: Array as unknown as PropType<Vec3>, default: undefined },
    autoCenter: { type: Boolean, default: false },
    id: { type: String, default: undefined },
  },
  setup(props) {
    const polygons = computed(() =>
      boxPolygons({
        size: props.size as number | Vec3 | undefined,
        center: props.center,
        min: props.min,
        max: props.max,
        color: props.color,
        texture: props.texture,
        material: props.material,
        uvs: props.uvs,
        data: props.data,
        faces: props.faces,
      }),
    );
    return () =>
      h(PolyMesh, {
        polygons: polygons.value,
        position: props.position,
        scale: props.scale,
        rotation: props.rotation,
        autoCenter: props.autoCenter,
        id: props.id,
      });
  },
});

export interface PolyPlaneProps extends ShapeMeshProps, PlanePolygonsOptions {}

export const PolyPlane = defineComponent({
  name: "PolyPlane",
  props: {
    axis: { type: Number as PropType<0 | 1 | 2>, required: true },
    size: { type: Number, default: undefined },
    offset: { type: [Number, Array] as unknown as PropType<number | [number, number]>, default: undefined },
    along: { type: Number, default: undefined },
    color: { type: String, default: undefined },
    // Common mesh props
    position: { type: Array as unknown as PropType<Vec3>, default: undefined },
    scale: { type: [Number, Array] as unknown as PropType<number | Vec3>, default: undefined },
    rotation: { type: Array as unknown as PropType<Vec3>, default: undefined },
    autoCenter: { type: Boolean, default: false },
    id: { type: String, default: undefined },
  },
  setup(props) {
    const polygons = computed(() =>
      planePolygons({
        axis: props.axis,
        size: props.size,
        offset: props.offset,
        along: props.along,
        color: props.color,
      }),
    );
    return () =>
      h(PolyMesh, {
        polygons: polygons.value,
        position: props.position,
        scale: props.scale,
        rotation: props.rotation,
        autoCenter: props.autoCenter,
        id: props.id,
      });
  },
});

export interface PolyRingProps extends ShapeMeshProps, RingPolygonsOptions {}

export const PolyRing = defineComponent({
  name: "PolyRing",
  props: {
    axis: { type: Number as PropType<0 | 1 | 2>, required: true },
    radius: { type: Number, required: true },
    halfThickness: { type: Number, default: undefined },
    segments: { type: Number, default: undefined },
    color: { type: String, default: undefined },
    // Common mesh props
    position: { type: Array as unknown as PropType<Vec3>, default: undefined },
    scale: { type: [Number, Array] as unknown as PropType<number | Vec3>, default: undefined },
    rotation: { type: Array as unknown as PropType<Vec3>, default: undefined },
    autoCenter: { type: Boolean, default: false },
    id: { type: String, default: undefined },
  },
  setup(props) {
    const polygons = computed(() =>
      ringPolygons({
        axis: props.axis,
        radius: props.radius,
        halfThickness: props.halfThickness,
        segments: props.segments,
        color: props.color,
      }),
    );
    return () =>
      h(PolyMesh, {
        polygons: polygons.value,
        position: props.position,
        scale: props.scale,
        rotation: props.rotation,
        autoCenter: props.autoCenter,
        id: props.id,
      });
  },
});

export interface PolyOctahedronProps extends ShapeMeshProps, OctahedronPolygonsOptions {}

export const PolyOctahedron = defineComponent({
  name: "PolyOctahedron",
  props: {
    center: { type: Array as unknown as PropType<Vec3>, required: true },
    size: { type: Number, required: true },
    color: { type: String, default: undefined },
    // Common mesh props
    position: { type: Array as unknown as PropType<Vec3>, default: undefined },
    scale: { type: [Number, Array] as unknown as PropType<number | Vec3>, default: undefined },
    rotation: { type: Array as unknown as PropType<Vec3>, default: undefined },
    autoCenter: { type: Boolean, default: false },
    id: { type: String, default: undefined },
  },
  setup(props) {
    const polygons = computed(() =>
      octahedronPolygons({
        center: props.center,
        size: props.size,
        color: props.color,
      }),
    );
    return () =>
      h(PolyMesh, {
        polygons: polygons.value,
        position: props.position,
        scale: props.scale,
        rotation: props.rotation,
        autoCenter: props.autoCenter,
        id: props.id,
      });
  },
});

export interface PolyTetrahedronProps extends ShapeMeshProps, TetrahedronPolygonsOptions {}

export const PolyTetrahedron = defineComponent({
  name: "PolyTetrahedron",
  props: {
    size: { type: Number, default: undefined },
    color: { type: String, default: undefined },
    // Common mesh props
    position: { type: Array as unknown as PropType<Vec3>, default: undefined },
    scale: { type: [Number, Array] as unknown as PropType<number | Vec3>, default: undefined },
    rotation: { type: Array as unknown as PropType<Vec3>, default: undefined },
    autoCenter: { type: Boolean, default: false },
    id: { type: String, default: undefined },
  },
  setup(props) {
    const polygons = computed(() =>
      tetrahedronPolygons({ size: props.size, color: props.color }),
    );
    return () =>
      h(PolyMesh, {
        polygons: polygons.value,
        position: props.position,
        scale: props.scale,
        rotation: props.rotation,
        autoCenter: props.autoCenter,
        id: props.id,
      });
  },
});

export interface PolyIcosahedronProps extends ShapeMeshProps, IcosahedronPolygonsOptions {}

export const PolyIcosahedron = defineComponent({
  name: "PolyIcosahedron",
  props: {
    size: { type: Number, default: undefined },
    color: { type: String, default: undefined },
    // Common mesh props
    position: { type: Array as unknown as PropType<Vec3>, default: undefined },
    scale: { type: [Number, Array] as unknown as PropType<number | Vec3>, default: undefined },
    rotation: { type: Array as unknown as PropType<Vec3>, default: undefined },
    autoCenter: { type: Boolean, default: false },
    id: { type: String, default: undefined },
  },
  setup(props) {
    const polygons = computed(() =>
      icosahedronPolygons({ size: props.size, color: props.color }),
    );
    return () =>
      h(PolyMesh, {
        polygons: polygons.value,
        position: props.position,
        scale: props.scale,
        rotation: props.rotation,
        autoCenter: props.autoCenter,
        id: props.id,
      });
  },
});

export interface PolyDodecahedronProps extends ShapeMeshProps, DodecahedronPolygonsOptions {}

export const PolyDodecahedron = defineComponent({
  name: "PolyDodecahedron",
  props: {
    size: { type: Number, default: undefined },
    color: { type: String, default: undefined },
    // Common mesh props
    position: { type: Array as unknown as PropType<Vec3>, default: undefined },
    scale: { type: [Number, Array] as unknown as PropType<number | Vec3>, default: undefined },
    rotation: { type: Array as unknown as PropType<Vec3>, default: undefined },
    autoCenter: { type: Boolean, default: false },
    id: { type: String, default: undefined },
  },
  setup(props) {
    const polygons = computed(() =>
      dodecahedronPolygons({ size: props.size, color: props.color }),
    );
    return () =>
      h(PolyMesh, {
        polygons: polygons.value,
        position: props.position,
        scale: props.scale,
        rotation: props.rotation,
        autoCenter: props.autoCenter,
        id: props.id,
      });
  },
});

export interface PolySphereProps extends ShapeMeshProps, SpherePolygonsOptions {}

export const PolySphere = defineComponent({
  name: "PolySphere",
  props: {
    radius: { type: Number, default: undefined },
    subdivisions: { type: Number, default: undefined },
    color: { type: String, default: undefined },
    // Common mesh props
    position: { type: Array as unknown as PropType<Vec3>, default: undefined },
    scale: { type: [Number, Array] as unknown as PropType<number | Vec3>, default: undefined },
    rotation: { type: Array as unknown as PropType<Vec3>, default: undefined },
    autoCenter: { type: Boolean, default: false },
    id: { type: String, default: undefined },
  },
  setup(props) {
    const polygons = computed(() =>
      spherePolygons({ radius: props.radius, subdivisions: props.subdivisions, color: props.color }),
    );
    return () =>
      h(PolyMesh, {
        polygons: polygons.value,
        position: props.position,
        scale: props.scale,
        rotation: props.rotation,
        autoCenter: props.autoCenter,
        id: props.id,
      });
  },
});

// ── Parametric primitives ─────────────────────────────────────────────────────

export interface PolyCylinderProps extends ShapeMeshProps, CylinderPolygonsOptions {}

export const PolyCylinder = defineComponent({
  name: "PolyCylinder",
  props: {
    radius: { type: Number, default: undefined },
    radiusTop: { type: Number, default: undefined },
    height: { type: Number, default: undefined },
    radialSegments: { type: Number, default: undefined },
    color: { type: String, default: undefined },
    // Common mesh props
    position: { type: Array as unknown as PropType<Vec3>, default: undefined },
    scale: { type: [Number, Array] as unknown as PropType<number | Vec3>, default: undefined },
    rotation: { type: Array as unknown as PropType<Vec3>, default: undefined },
    autoCenter: { type: Boolean, default: false },
    id: { type: String, default: undefined },
  },
  setup(props) {
    const polygons = computed(() =>
      cylinderPolygons({
        radius: props.radius,
        radiusTop: props.radiusTop,
        height: props.height,
        radialSegments: props.radialSegments,
        color: props.color,
      }),
    );
    return () =>
      h(PolyMesh, {
        polygons: polygons.value,
        position: props.position,
        scale: props.scale,
        rotation: props.rotation,
        autoCenter: props.autoCenter,
        id: props.id,
      });
  },
});

export interface PolyConeProps extends ShapeMeshProps, ConePolygonsOptions {}

export const PolyCone = defineComponent({
  name: "PolyCone",
  props: {
    radius: { type: Number, default: undefined },
    height: { type: Number, default: undefined },
    radialSegments: { type: Number, default: undefined },
    color: { type: String, default: undefined },
    // Common mesh props
    position: { type: Array as unknown as PropType<Vec3>, default: undefined },
    scale: { type: [Number, Array] as unknown as PropType<number | Vec3>, default: undefined },
    rotation: { type: Array as unknown as PropType<Vec3>, default: undefined },
    autoCenter: { type: Boolean, default: false },
    id: { type: String, default: undefined },
  },
  setup(props) {
    const polygons = computed(() =>
      conePolygons({
        radius: props.radius,
        height: props.height,
        radialSegments: props.radialSegments,
        color: props.color,
      }),
    );
    return () =>
      h(PolyMesh, {
        polygons: polygons.value,
        position: props.position,
        scale: props.scale,
        rotation: props.rotation,
        autoCenter: props.autoCenter,
        id: props.id,
      });
  },
});

export interface PolyTorusProps extends ShapeMeshProps, TorusPolygonsOptions {}

export const PolyTorus = defineComponent({
  name: "PolyTorus",
  props: {
    radius: { type: Number, default: undefined },
    tube: { type: Number, default: undefined },
    radialSegments: { type: Number, default: undefined },
    tubularSegments: { type: Number, default: undefined },
    color: { type: String, default: undefined },
    // Common mesh props
    position: { type: Array as unknown as PropType<Vec3>, default: undefined },
    scale: { type: [Number, Array] as unknown as PropType<number | Vec3>, default: undefined },
    rotation: { type: Array as unknown as PropType<Vec3>, default: undefined },
    autoCenter: { type: Boolean, default: false },
    id: { type: String, default: undefined },
  },
  setup(props) {
    const polygons = computed(() =>
      torusPolygons({
        radius: props.radius,
        tube: props.tube,
        radialSegments: props.radialSegments,
        tubularSegments: props.tubularSegments,
        color: props.color,
      }),
    );
    return () =>
      h(PolyMesh, {
        polygons: polygons.value,
        position: props.position,
        scale: props.scale,
        rotation: props.rotation,
        autoCenter: props.autoCenter,
        id: props.id,
      });
  },
});
