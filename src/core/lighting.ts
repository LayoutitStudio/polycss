/* Shared lighting helpers for voxcss shapes. */
import type { CubeFace, WallsMask } from "./types";
import {
  type ParsedColor,
  parsePureColor,
  parseRgbColor,
  clampChannel,
  formatColor
} from "./color";

export type { ParsedColor };

const defaultColor: ParsedColor = { rgb: [204, 204, 204], alpha: 1 };
const colorCache = new Map<string, ParsedColor>();
let probeEl: HTMLElement | null = null;

function ensureProbe(doc: Document | null = typeof document !== "undefined" ? document : null): HTMLElement | null {
  if (typeof document === "undefined" && !doc) return null;
  if (probeEl && probeEl.ownerDocument) return probeEl;
  const owner = doc ?? document;
  if (!owner) return null;
  probeEl = owner.createElement("div");
  owner.head.appendChild(probeEl);
  return probeEl;
}

export function parseColor(input: string): ParsedColor | null {
  if (!input) return null;
  const key = input.trim();
  const cached = colorCache.get(key);
  if (cached) return cached;

  // Try pure parsing first (hex, rgb/rgba) — no DOM needed
  const pureParsed = parsePureColor(key);
  if (pureParsed) {
    colorCache.set(key, pureParsed);
    return pureParsed;
  }

  // Fallback: DOM probe for CSS named colors ("red", "tomato", etc.)
  const probe = ensureProbe();
  if (!probe) return null;
  probe.style.color = "";
  probe.style.color = key;
  const computed = getComputedStyle(probe);
  const value = computed.color;
  if (!value || value === "rgba(0, 0, 0, 0)" || value === "transparent") {
    return null;
  }
  const parsed = parseRgbColor(value);
  if (!parsed) return null;
  colorCache.set(key, parsed);
  return parsed;
}

export function shadeColor(base: string, delta: number): string {
  const parsed = parseColor(base) ?? defaultColor;
  const rgb: [number, number, number] = [
    clampChannel(parsed.rgb[0] + delta),
    clampChannel(parsed.rgb[1] + delta),
    clampChannel(parsed.rgb[2] + delta)
  ];
  return formatColor({ rgb, alpha: parsed.alpha });
}

const FACE_ADJUSTMENTS: Record<CubeFace, number> = {
  t: 0,
  b: 0,
  fr: -15,
  fl: -25,
  bl: -40,
  br: -30
};

export function getCubeFaceLightDelta(face: CubeFace): number {
  return FACE_ADJUSTMENTS[face] ?? 0;
}

export function shadeCubeFace(base: string, face: CubeFace): string {
  const delta = getCubeFaceLightDelta(face);
  return shadeColor(base, delta);
}

const WALL_FACE_MAP: Partial<Record<keyof WallsMask, CubeFace>> = {
  fr: "fr",
  fl: "fl",
  bl: "bl",
  br: "br"
};

export function shadeWallFace(base: string, face: keyof WallsMask): string {
  const cubeFace = WALL_FACE_MAP[face];
  if (!cubeFace) return shadeColor(base, 0);
  const delta = FACE_ADJUSTMENTS[cubeFace] ?? 0;
  return shadeColor(base, -delta);
}

export type ShapeType = "ramp" | "wedge" | "spike";

interface ShapeSurfaceDefinition {
  id: string;
  baseAngle: number;
  allowPeak?: boolean;
}

export interface ShapeSurfaceLighting {
  id: string;
  angle: number;
  level: number;
  delta: number;
  color: string;
}

const SHAPE_SURFACE_DEFINITIONS: Record<ShapeType, ShapeSurfaceDefinition[]> = {
  ramp: [{ id: "slope", baseAngle: 0 }],
  wedge: [
    { id: "primary", baseAngle: 0 },
    { id: "secondary", baseAngle: 90 }
  ],
  spike: [
    { id: "primary", baseAngle: 0 },
    { id: "secondary", baseAngle: 270 }
  ]
};

const SHAPE_LIGHT_SOURCE_ANGLE = 180;
const SHAPE_LEVEL_DELTAS: Record<number, number> = {
  1: 18,
  2: 8,
  3: -12,
  4: -28
};

function normalizeShapeAngle(value: number): number {
  if (!Number.isFinite(value)) return 0;
  const normalized = value % 360;
  return normalized < 0 ? normalized + 360 : normalized;
}

function shapeAngularDifference(a: number, b: number): number {
  const diff = Math.abs(normalizeShapeAngle(a) - normalizeShapeAngle(b));
  return diff > 180 ? 360 - diff : diff;
}

function angleToBrightnessLevel(angle: number, { allowPeak = false }: { allowPeak?: boolean } = {}): number {
  const diff = shapeAngularDifference(angle, SHAPE_LIGHT_SOURCE_ANGLE);
  if (allowPeak && diff <= 10) return 1;
  if (diff <= 30) return 2;
  if (diff <= 90) return 3;
  return 4;
}

export function computeShapeLighting(
  shape: ShapeType,
  rotation: number,
  baseColor: string
): ShapeSurfaceLighting[] {
  const surfaces = SHAPE_SURFACE_DEFINITIONS[shape];
  if (!surfaces) return [];
  const normalizedRotation = normalizeShapeAngle(rotation);
  return surfaces.map((surface) => {
    const angle = normalizeShapeAngle(normalizedRotation + surface.baseAngle);
    const level = angleToBrightnessLevel(angle, { allowPeak: surface.allowPeak });
    const delta = SHAPE_LEVEL_DELTAS[level] ?? 0;
    return {
      id: surface.id,
      angle,
      level,
      delta,
      color: shadeColor(baseColor, delta)
    };
  });
}
