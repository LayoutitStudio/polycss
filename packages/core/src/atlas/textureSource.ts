import type {
  PolyTextureImageRendering,
  PolyTextureImageSource,
  PolyTexturePresentation,
  Polygon,
} from "../types";

export function resolvePolyTextureImageSource(
  polygon: Polygon,
): PolyTextureImageSource | undefined {
  return polygon.textureImageSource ?? polygon.material?.imageSource;
}

export function resolvePolyTextureUrl(polygon: Polygon): string | undefined {
  return polygon.material?.texture ??
    polygon.texture ??
    polygon.textureImageSource?.url ??
    polygon.material?.imageSource?.url;
}

export function resolvePolyTexturePresentation(
  polygon: Polygon,
  defaults: PolyTexturePresentation = {},
): PolyTexturePresentation {
  const source = resolvePolyTextureImageSource(polygon);
  return {
    ...defaults,
    ...polygon.material?.presentation,
    ...(source?.imageRendering ? { imageRendering: source.imageRendering } : null),
    ...polygon.texturePresentation,
  };
}

export function resolvePolyTextureImageRendering(
  polygon: Polygon,
  defaultImageRendering: PolyTextureImageRendering | undefined,
): PolyTextureImageRendering {
  return resolvePolyTexturePresentation(polygon, {
    imageRendering: defaultImageRendering,
  }).imageRendering ?? "auto";
}
