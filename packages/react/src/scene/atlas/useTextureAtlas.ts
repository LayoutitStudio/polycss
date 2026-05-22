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
    () => filterAtlasPlans(plans, textureLighting, disabled),
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
    () => packed.pages.map((page) => ({ width: page.width, height: page.height, url: null })),
  );

  useEffect(() => {
    let cancelled = false;
    let urls: string[] = [];
    setPages(packed.pages.map((page) => ({ width: page.width, height: page.height, url: null })));

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
        setPages(nextPages);
      })
      .catch(() => {
        if (!cancelled) {
          setPages(packed.pages.map((page) => ({ width: page.width, height: page.height, url: null })));
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
