import type { Vec3 } from "../types";

export const DEFAULT_TILE = 50;
export const DEFAULT_LIGHT_DIR: Vec3 = [0.4, -0.7, 0.59];
export const DEFAULT_LIGHT_COLOR = "#ffffff";
export const DEFAULT_LIGHT_INTENSITY = 1;
export const DEFAULT_AMBIENT_COLOR = "#ffffff";
export const DEFAULT_AMBIENT_INTENSITY = 0.4;
export const ATLAS_MAX_SIZE = 4096;
export const ATLAS_PADDING = 1;
export const MIN_ATLAS_SCALE = 0.1;
export const MAX_ATLAS_SCALE = 1;
export const AUTO_ATLAS_LOW_AREA = ATLAS_MAX_SIZE * ATLAS_MAX_SIZE;
export const AUTO_ATLAS_MEDIUM_AREA = AUTO_ATLAS_LOW_AREA * 3;
export const AUTO_ATLAS_MAX_BITMAP_SIDE = 2048;
// Total decoded RGBA bytes summed across all atlas pages, picked per device
// class. On mobile Chrome (Galaxy S23 Ultra-class hardware), large textured
// meshes sit right at the compositor's GPU-memory edge — when the scene
// transform mutates per frame the compositor evicts and re-rasterizes pages
// mid-frame, producing visible flicker/tearing during rotation. 4 MB keeps
// us under that threshold with no perceptible loss of texture detail at
// typical mobile display sizes. Desktop GPUs have orders of magnitude more
// memory, so we keep textures sharp there.
export const AUTO_ATLAS_MAX_DECODED_BYTES_MOBILE = 4 * 1024 * 1024;
export const AUTO_ATLAS_MAX_DECODED_BYTES_DESKTOP = 16 * 1024 * 1024;
export const AUTO_ATLAS_SCALE_GUARD = 0.995;
export const COLOR_PARSE_CACHE_MAX = 512;

// Budget for the internal async atlas planner used by large imperative
// scene updates. Keep comfortably under the 50ms long-task threshold.
export const ASYNC_RENDER_BUDGET_MS = 12;

export const RECT_EPS = 1e-3;
export const BASIS_EPS = 1e-9;
export const SURFACE_NORMAL_EPS = 1e-4;
export const SURFACE_DISTANCE_EPS = 0.1;
export const SEAM_LIGHT_EPS = 0.01;
export const TEXTURE_TRIANGLE_BLEED = 0.75;
export const TEXTURE_EDGE_REPAIR_ALPHA_MIN = 1;
export const TEXTURE_EDGE_REPAIR_SOURCE_ALPHA_MIN = 250;
export const TEXTURE_EDGE_REPAIR_RADIUS = 1.5;
export const SOLID_TRIANGLE_BLEED = 0.75;
export const DEFAULT_MATRIX_DECIMALS = 3;
export const DEFAULT_BORDER_SHAPE_DECIMALS = 2;
export const DEFAULT_ATLAS_CSS_DECIMALS = 4;
export const DECIMAL_SCALES = [1, 10, 100, 1000, 10000, 100000, 1000000];
export const SOLID_QUAD_CANONICAL_SIZE = 64;
export const SOLID_TRIANGLE_CANONICAL_SIZE = 32;
export const SOLID_TRIANGLE_CORNER_CLASS = "polycss-corner-triangle";
export const ATLAS_CANONICAL_SIZE_EXPLICIT = 64;
export const ATLAS_CANONICAL_SIZE_AUTO_DESKTOP = 128;
export const BORDER_SHAPE_CENTER_PERCENT = 50;
export const BORDER_SHAPE_POINT_EPS = 1e-7;
export const BORDER_SHAPE_CANONICAL_SIZE = 16;
export const BORDER_SHAPE_BLEED = 0.9;
export const CORNER_SHAPE_POINT_EPS = 0.75;
export const CORNER_SHAPE_DUPLICATE_EPS = 0.2;
export const PROJECTIVE_QUAD_DENOM_EPS = 0.05;
export const PROJECTIVE_QUAD_MAX_WEIGHT_RATIO = Number.POSITIVE_INFINITY;
export const PROJECTIVE_QUAD_BLEED = 0.6;
export const DEFAULT_SEAM_BLEED = 1.5;
