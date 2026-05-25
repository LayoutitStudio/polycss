import {
  boxPolygons,
  conePolygons,
  cylinderPolygons,
  dodecahedronPolygons,
  icosahedronPolygons,
  octahedronPolygons,
  spherePolygons,
  tetrahedronPolygons,
  torusPolygons,
} from "@layoutit/polycss";
import type { PresetModel } from "../GalleryWorkbench/types";
import { POLYCSS_GENERATED_PRIMITIVE_ATTRIBUTION } from "../GalleryWorkbench/presets/attributions";

export interface BuilderShapePreset extends PresetModel {
  color: string;
  thumbnailSrc: string;
}

function primitiveShapePreset(
  id: string,
  label: string,
  color: string,
  generatePolygons: PresetModel["generatePolygons"],
): BuilderShapePreset {
  const slug = id.replace(/^builder-shape-/, "");
  return {
    id,
    label,
    color,
    thumbnailSrc: `/builder/shape-thumbnails/${slug}.png?v=transparent3`,
    category: "Shapes",
    kind: "primitive",
    galleryBucket: "Primitives",
    zoom: 0.05,
    rotX: 65,
    rotY: 45,
    attribution: POLYCSS_GENERATED_PRIMITIVE_ATTRIBUTION,
    generatePolygons,
  };
}

export const BUILDER_SHAPE_PRESETS: BuilderShapePreset[] = [
  primitiveShapePreset("builder-shape-box", "Box", "#ff7043", () =>
    boxPolygons({ size: 100, color: "#ff7043" }),
  ),
  primitiveShapePreset("builder-shape-octahedron", "Octahedron", "#f59e0b", () =>
    octahedronPolygons({ center: [0, 0, 0], size: 84, color: "#f59e0b" }),
  ),
  primitiveShapePreset("builder-shape-sphere", "Sphere", "#60a5fa", () =>
    spherePolygons({ radius: 50, subdivisions: 1, color: "#60a5fa" }),
  ),
  primitiveShapePreset("builder-shape-tetrahedron", "Tetrahedron", "#f472b6", () =>
    tetrahedronPolygons({ size: 86, color: "#f472b6" }),
  ),
  primitiveShapePreset("builder-shape-icosahedron", "Icosahedron", "#c084fc", () =>
    icosahedronPolygons({ size: 84, color: "#c084fc" }),
  ),
  primitiveShapePreset("builder-shape-dodecahedron", "Dodecahed.", "#34d399", () =>
    dodecahedronPolygons({ size: 84, color: "#34d399" }),
  ),
  primitiveShapePreset("builder-shape-cylinder", "Cylinder", "#22d3ee", () =>
    cylinderPolygons({ radius: 42, height: 100, radialSegments: 12, color: "#22d3ee" }),
  ),
  primitiveShapePreset("builder-shape-cone", "Cone", "#fb7185", () =>
    conePolygons({ radius: 50, height: 100, radialSegments: 12, color: "#fb7185" }),
  ),
  primitiveShapePreset("builder-shape-torus", "Torus", "#facc15", () =>
    torusPolygons({ radius: 48, tube: 14, radialSegments: 12, tubularSegments: 16, color: "#facc15" }),
  ),
];
