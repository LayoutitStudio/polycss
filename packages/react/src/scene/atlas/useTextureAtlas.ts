import { useEffect, useMemo, useState } from "react";
import type {
  TextureAtlasPlan,
  PackedTextureAtlasEntry,
  TextureAtlasPage,
  PolyTextureLightingMode,
  TextureQuality,
  PolyRenderStrategy,
  PolyRenderStrategiesOption,
} from "@layoutit/polycss-core";
import { filterAtlasPlans } from "./filterPlans";
import { packTextureAtlasPlansWithScale } from "./packing";
import { buildAtlasPages } from "./buildAtlasPages";

// TextureAtlasResult exposed by useTextureAtlas.
export interface TextureAtlasResult {
  entries: Array<PackedTextureAtlasEntry | null>;
  pages: TextureAtlasPage[];
  ready: boolean;
}

function pageShells(pages: readonly { width: number; height: number }[]): TextureAtlasPage[] {
  return pages.map((page) => ({ width: page.width, height: page.height, url: null }));
}

function textureAtlasPagesEqual(a: readonly TextureAtlasPage[], b: readonly TextureAtlasPage[]): boolean {
  return a.length === b.length && a.every((page, index) => {
    const other = b[index];
    return page.width === other.width && page.height === other.height && page.url === other.url;
  });
}

// ---------------------------------------------------------------------------
// useTextureAtlas — React hook that packs plans into atlas pages with blob URLs
// ---------------------------------------------------------------------------

export function useTextureAtlas(
  plans: Array<TextureAtlasPlan | null>,
  textureLighting: PolyTextureLightingMode,
  textureQualityInput?: TextureQuality,
  strategies?: PolyRenderStrategiesOption,
): TextureAtlasResult {
  const disabled = useMemo(
    () => new Set((strategies?.disable ?? []) as PolyRenderStrategy[]),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [strategies?.disable?.join(",")],
  );

  const atlasPlans = useMemo(
    () => filterAtlasPlans(
      plans,
      textureLighting,
      disabled,
      typeof document !== "undefined" ? document : null,
    ),
    [plans, textureLighting, disabled],
  );

  const { packed, atlasScale } = useMemo(
    () => packTextureAtlasPlansWithScale(
      atlasPlans,
      textureQualityInput,
      typeof document !== "undefined" ? document : null,
    ),
    [atlasPlans, textureQualityInput],
  );

  const [pages, setPages] = useState<TextureAtlasPage[]>(
    () => pageShells(packed.pages),
  );

  useEffect(() => {
    let cancelled = false;
    let urls: string[] = [];
    const nextPageShells = pageShells(packed.pages);
    setPages((prev) => textureAtlasPagesEqual(prev, nextPageShells) ? prev : nextPageShells);

    if (packed.pages.length === 0 || typeof document === "undefined") {
      return () => {};
    }

    buildAtlasPages(packed.pages, textureLighting, document, atlasScale, () => cancelled)
      .then((nextPages) => {
        if (cancelled) {
          for (const page of nextPages) {
            if (page.url?.startsWith("blob:")) URL.revokeObjectURL(page.url);
          }
          return;
        }
        urls = nextPages.flatMap((page) => page.url?.startsWith("blob:") ? [page.url] : []);
        setPages((prev) => textureAtlasPagesEqual(prev, nextPages) ? prev : nextPages);
      })
      .catch(() => {
        if (!cancelled) {
          setPages((prev) => textureAtlasPagesEqual(prev, nextPageShells) ? prev : nextPageShells);
        }
      });

    return () => {
      cancelled = true;
      for (const url of urls) URL.revokeObjectURL(url);
    };
  }, [packed, textureLighting, atlasScale]);

  return {
    entries: packed.entries,
    pages,
    ready: pages.length === 0 || pages.every((page) => !!page.url),
  };
}
