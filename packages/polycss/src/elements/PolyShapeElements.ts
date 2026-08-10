/**
 * Primitive shape custom elements — <poly-box>, <poly-plane>, <poly-sphere>, <poly-ring>,
 * <poly-octahedron>, <poly-tetrahedron>, <poly-icosahedron>, <poly-dodecahedron>,
 * <poly-cylinder>, <poly-cone>, <poly-torus>.
 *
 * Each element reads shape-specific attributes, calls the matching polygon
 * generator from @layoutit/polycss-core, then registers the result with the
 * nearest <poly-scene> ancestor using the same mechanism as <poly-mesh>.
 *
 * Attribute naming follows kebab-case conventions: `radial-segments`,
 * `tubular-segments`, `radius-top`, `half-thickness`, etc.
 */
import type { Polygon, Vec3 } from "@layoutit/polycss-core";
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
  computeSceneBbox,
} from "@layoutit/polycss-core";
import type { PolyMeshHandle, PolySceneHandle } from "../api/createPolyScene";
import type { PolySceneElement } from "./PolySceneElement";

const ELEMENT_BASE: typeof HTMLElement =
  typeof HTMLElement !== "undefined"
    ? HTMLElement
    : (class {} as unknown as typeof HTMLElement);

function findScene(el: HTMLElement): PolySceneElement | null {
  const found = el.closest("poly-scene") as unknown as
    | (PolySceneElement & { getScene?: () => unknown })
    | null;
  return found ?? null;
}

function numAttr(el: HTMLElement, name: string, fallback: number): number {
  const raw = el.getAttribute(name);
  if (!raw) return fallback;
  const n = parseFloat(raw);
  return Number.isFinite(n) ? n : fallback;
}

function strAttr(el: HTMLElement, name: string, fallback?: string): string | undefined {
  return el.getAttribute(name) ?? fallback;
}

function parseVec3Attr(el: HTMLElement, name: string): Vec3 | undefined {
  const raw = el.getAttribute(name);
  if (!raw) return undefined;
  const parts = raw.split(",").map((s) => parseFloat(s.trim()));
  if (parts.length !== 3 || parts.some((p) => !Number.isFinite(p))) return undefined;
  return [parts[0], parts[1], parts[2]];
}

function recenter(polygons: Polygon[]): Polygon[] {
  if (polygons.length === 0) return polygons;
  const bbox = computeSceneBbox(polygons);
  const cx = (bbox.min[0] + bbox.max[0]) / 2;
  const cy = (bbox.min[1] + bbox.max[1]) / 2;
  const cz = (bbox.min[2] + bbox.max[2]) / 2;
  if (cx === 0 && cy === 0 && cz === 0) return polygons;
  const shift = (v: Vec3): Vec3 => [v[0] - cx, v[1] - cy, v[2] - cz];
  return polygons.map((p) => ({ ...p, vertices: p.vertices.map(shift) }));
}

/**
 * Base class for all primitive shape elements. Subclasses implement
 * `buildPolygons()` which returns a Polygon[] from this element's attributes.
 */
abstract class PolyShapeElement extends ELEMENT_BASE {
  private _handle: PolyMeshHandle | null = null;

  abstract buildPolygons(): Polygon[];

  connectedCallback(): void {
    this._mount();
  }

  disconnectedCallback(): void {
    this._tearDown();
  }

  attributeChangedCallback(
    name: string,
    oldValue: string | null,
    newValue: string | null,
  ): void {
    if (oldValue === newValue) return;
    if (!this._handle) return;
    // Transform attributes update the handle in place. Geometry attributes
    // (size, color, etc.) require re-emitting polygons — re-mount.
    if (
      name === "position" ||
      name === "scale" ||
      name === "rotation" ||
      name === "cast-shadow" ||
      name === "receive-shadow"
    ) {
      this._handle.setTransform({
        position: parseVec3Attr(this, "position"),
        scale: (() => {
          const raw = this.getAttribute("scale");
          if (!raw) return undefined;
          if (raw.includes(",")) return parseVec3Attr(this, "scale");
          const n = parseFloat(raw);
          return Number.isFinite(n) ? n : undefined;
        })(),
        rotation: parseVec3Attr(this, "rotation"),
        castShadow: this.hasAttribute("cast-shadow"),
        receiveShadow: this.hasAttribute("receive-shadow"),
      });
      return;
    }
    // Geometry/material change: tear down and re-mount.
    this._tearDown();
    this._mount();
  }

  private _tearDown(): void {
    if (this._handle) {
      try { this._handle.dispose(); } catch { /* ignore */ }
      this._handle = null;
    }
  }

  private _mount(): void {
    const sceneEl = findScene(this);
    if (!sceneEl) return;
    const scene = (sceneEl as unknown as { getScene?: () => PolySceneHandle | null }).getScene?.();
    if (!scene) return;

    let polygons = this.buildPolygons();
    if (this.hasAttribute("auto-center")) {
      polygons = recenter(polygons);
    }

    // Assemble a minimal ParseResult (no object URLs, no animation).
    const parseResult = {
      polygons,
      objectUrls: [] as string[],
      warnings: [] as string[],
      dispose: () => { /* no URLs to revoke */ },
    };

    this._handle = scene.add(
      parseResult,
      {
        position: parseVec3Attr(this, "position"),
        scale: (() => {
          const raw = this.getAttribute("scale");
          if (!raw) return undefined;
          if (raw.includes(",")) return parseVec3Attr(this, "scale");
          const n = parseFloat(raw);
          return Number.isFinite(n) ? n : undefined;
        })(),
        rotation: parseVec3Attr(this, "rotation"),
        // Shadow flags mirror <poly-mesh> so primitive shapes can act as
        // ground planes for shadow receivers without needing a GLB.
        castShadow: this.hasAttribute("cast-shadow"),
        receiveShadow: this.hasAttribute("receive-shadow"),
        // Helper shapes (ground planes, axes, light gizmos) shouldn't
        // skew the scene's auto-center calculation. Opt out via the
        // `exclude-from-auto-center` attribute.
        excludeFromAutoCenter: this.hasAttribute("exclude-from-auto-center"),
        merge: false,
      },
    );
  }
}

// ── Fixed-geometry primitives ────────────────────────────────────────────────

export class PolyBoxElement extends PolyShapeElement {
  static get observedAttributes(): string[] {
    return ["size", "color", "auto-center", "position", "scale", "rotation"];
  }

  buildPolygons(): Polygon[] {
    const sizeAttr = this.getAttribute("size");
    const size = sizeAttr ? parseFloat(sizeAttr) : undefined;
    return boxPolygons({
      size: size !== undefined && Number.isFinite(size) ? size : undefined,
      color: strAttr(this, "color"),
    });
  }
}

export class PolyPlaneElement extends PolyShapeElement {
  static get observedAttributes(): string[] {
    return [
      "axis",
      "size",
      "offset",
      "color",
      "auto-center",
      "position",
      "scale",
      "rotation",
      "cast-shadow",
      "receive-shadow",
    ];
  }

  buildPolygons(): Polygon[] {
    const axisRaw = numAttr(this, "axis", 2);
    const axis = (axisRaw === 0 || axisRaw === 1 || axisRaw === 2 ? axisRaw : 2) as 0 | 1 | 2;
    // Default offset to 0 (plane centered at the element's local origin) —
    // `planePolygons` itself defaults to `size * 2` because it was authored
    // for transform-control drag handles, but for ground planes / generic
    // quads "centered" is the obvious user expectation.
    const offsetAttr = this.getAttribute("offset");
    const offset = offsetAttr === null ? 0 : parseFloat(offsetAttr);
    return planePolygons({
      axis,
      size: numAttr(this, "size", 0.4),
      offset: Number.isFinite(offset) ? offset : 0,
      color: strAttr(this, "color"),
    });
  }
}

export class PolyRingElement extends PolyShapeElement {
  static get observedAttributes(): string[] {
    return ["axis", "radius", "segments", "half-thickness", "color", "auto-center", "position", "scale", "rotation"];
  }

  buildPolygons(): Polygon[] {
    const axisRaw = numAttr(this, "axis", 2);
    const axis = (axisRaw === 0 || axisRaw === 1 || axisRaw === 2 ? axisRaw : 2) as 0 | 1 | 2;
    const halfThicknessAttr = this.getAttribute("half-thickness");
    return ringPolygons({
      axis,
      radius: numAttr(this, "radius", 50),
      segments: numAttr(this, "segments", 32),
      halfThickness: halfThicknessAttr ? parseFloat(halfThicknessAttr) : undefined,
      color: strAttr(this, "color"),
    });
  }
}

export class PolyOctahedronElement extends PolyShapeElement {
  static get observedAttributes(): string[] {
    return ["size", "color", "center", "auto-center", "position", "scale", "rotation"];
  }

  buildPolygons(): Polygon[] {
    return octahedronPolygons({
      center: parseVec3Attr(this, "center") ?? [0, 0, 0],
      size: numAttr(this, "size", 50),
      color: strAttr(this, "color"),
    });
  }
}

export class PolyTetrahedronElement extends PolyShapeElement {
  static get observedAttributes(): string[] {
    return ["size", "color", "auto-center", "position", "scale", "rotation"];
  }

  buildPolygons(): Polygon[] {
    return tetrahedronPolygons({
      size: numAttr(this, "size", 100),
      color: strAttr(this, "color"),
    });
  }
}

export class PolyIcosahedronElement extends PolyShapeElement {
  static get observedAttributes(): string[] {
    return ["size", "color", "auto-center", "position", "scale", "rotation"];
  }

  buildPolygons(): Polygon[] {
    return icosahedronPolygons({
      size: numAttr(this, "size", 100),
      color: strAttr(this, "color"),
    });
  }
}

export class PolyDodecahedronElement extends PolyShapeElement {
  static get observedAttributes(): string[] {
    return ["size", "color", "auto-center", "position", "scale", "rotation"];
  }

  buildPolygons(): Polygon[] {
    return dodecahedronPolygons({
      size: numAttr(this, "size", 100),
      color: strAttr(this, "color"),
    });
  }
}

export class PolySphereElement extends PolyShapeElement {
  static get observedAttributes(): string[] {
    return ["radius", "subdivisions", "color", "auto-center", "position", "scale", "rotation"];
  }

  buildPolygons(): Polygon[] {
    return spherePolygons({
      radius: numAttr(this, "radius", 50),
      subdivisions: numAttr(this, "subdivisions", 1),
      color: strAttr(this, "color"),
    });
  }
}

// ── Parametric primitives ─────────────────────────────────────────────────────

export class PolyCylinderElement extends PolyShapeElement {
  static get observedAttributes(): string[] {
    return ["radius", "radius-top", "height", "radial-segments", "color", "auto-center", "position", "scale", "rotation"];
  }

  buildPolygons(): Polygon[] {
    const radiusTopAttr = this.getAttribute("radius-top");
    return cylinderPolygons({
      radius: numAttr(this, "radius", 50),
      radiusTop: radiusTopAttr ? parseFloat(radiusTopAttr) : undefined,
      height: numAttr(this, "height", 100),
      radialSegments: numAttr(this, "radial-segments", 12),
      color: strAttr(this, "color"),
    });
  }
}

export class PolyConeElement extends PolyShapeElement {
  static get observedAttributes(): string[] {
    return ["radius", "height", "radial-segments", "color", "auto-center", "position", "scale", "rotation"];
  }

  buildPolygons(): Polygon[] {
    return conePolygons({
      radius: numAttr(this, "radius", 50),
      height: numAttr(this, "height", 100),
      radialSegments: numAttr(this, "radial-segments", 12),
      color: strAttr(this, "color"),
    });
  }
}

export class PolyTorusElement extends PolyShapeElement {
  static get observedAttributes(): string[] {
    return ["radius", "tube", "radial-segments", "tubular-segments", "color", "auto-center", "position", "scale", "rotation"];
  }

  buildPolygons(): Polygon[] {
    return torusPolygons({
      radius: numAttr(this, "radius", 50),
      tube: numAttr(this, "tube", 15),
      radialSegments: numAttr(this, "radial-segments", 12),
      tubularSegments: numAttr(this, "tubular-segments", 16),
      color: strAttr(this, "color"),
    });
  }
}
