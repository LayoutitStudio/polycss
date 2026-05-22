import {
  packTextureAtlasPlansWithScaleCore,
} from "@layoutit/polycss-core";
import type {
  TextureAtlasPlan,
  PackedAtlas,
  TextureQuality,
} from "@layoutit/polycss-core";

// ---------------------------------------------------------------------------
// Atlas packing (copied from packages/polycss/src/render/atlas/packing.ts)
// ---------------------------------------------------------------------------

export function isMobileDocument(doc: Document | null | undefined): boolean {
  if (!doc) return false;
  const win = doc.defaultView ?? (typeof window !== "undefined" ? window : undefined);
  const media = win?.matchMedia;
  if (!media) return false;
  // Same device-class heuristic as borderShapeSupported: coarse pointer or
  // no hover capability = phone/tablet, which has a tight GPU-memory budget
  // for composited 3D layers.
  return media("(pointer: coarse)").matches || media("(hover: none)").matches;
}

export function packTextureAtlasPlansWithScale(
  plans: Array<TextureAtlasPlan | null>,
  textureQualityInput: TextureQuality | undefined,
  doc: Document | null | undefined,
): { packed: PackedAtlas; atlasScale: number; atlasCanonicalSize: number } {
  return packTextureAtlasPlansWithScaleCore(plans, textureQualityInput, isMobileDocument(doc));
}
