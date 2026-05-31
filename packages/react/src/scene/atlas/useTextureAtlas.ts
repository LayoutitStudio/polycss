import { useEffect, useMemo, useRef, useState } from "react";
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

function blobUrlsOf(pages: readonly TextureAtlasPage[]): string[] {
  return pages.flatMap((page) => page.url?.startsWith("blob:") ? [page.url] : []);
}

// Force the browser to decode the new atlas bitmaps before they're swapped onto
// mounted leaves. A freshly created Blob URL isn't decoded until its first
// paint; copying it onto a live element decodes lazily on the next frame —
// exactly the visible blank. `Image.decode()` does that work upfront.
function decodeBlobUrls(urls: string[]): Promise<void> {
  if (urls.length === 0 || typeof Image === "undefined") return Promise.resolve();
  return Promise.all(urls.map((url) => {
    const img = new Image();
    img.src = url;
    const decoded = img.decode?.();
    return decoded ? decoded.catch(() => {}) : Promise.resolve();
  })).then(() => undefined);
}

// Revoke after the browser has had a frame to paint with the replacement URL,
// so the old bitmap is never freed while it's still on screen.
function deferRevoke(urls: string[]): void {
  if (urls.length === 0) return;
  const run = (): void => { for (const url of urls) URL.revokeObjectURL(url); };
  if (typeof requestAnimationFrame === "function") requestAnimationFrame(run);
  else setTimeout(run, 0);
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
  // Blob URLs currently shown on screen — revoked one frame after they're
  // replaced (or on unmount), never while still painting.
  const shownUrls = useRef<string[]>([]);

  useEffect(() => {
    let cancelled = false;

    if (packed.pages.length === 0) {
      // No textured leaves anymore → drop the bitmaps.
      deferRevoke(shownUrls.current);
      shownUrls.current = [];
      setPages((prev) => prev.length === 0 ? prev : []);
      return () => {};
    }
    if (typeof document === "undefined") return () => {};

    // Double-buffer: keep the previous bitmap painting (geometry leaves still
    // reposition live from `entries`) until the new atlas is rasterised AND
    // decoded, then swap. Never blank — on a layout change a brief stale sample
    // under the new slices beats a blank flash.
    setPages((prev) => prev.some((page) => page.url) ? prev : pageShells(packed.pages));

    let built: string[] = [];
    buildAtlasPages(packed.pages, textureLighting, document, atlasScale, () => cancelled)
      .then(async (nextPages) => {
        built = blobUrlsOf(nextPages);
        await decodeBlobUrls(built);
        if (cancelled) {
          deferRevoke(built);
          return;
        }
        const stale = shownUrls.current;
        shownUrls.current = built;
        built = [];
        deferRevoke(stale);
        setPages(nextPages);
      })
      .catch(() => {});

    return () => {
      cancelled = true;
      // If this build resolved but was superseded before swapping, free it.
      deferRevoke(built);
    };
  }, [packed, textureLighting, atlasScale]);

  useEffect(() => () => {
    for (const url of shownUrls.current) URL.revokeObjectURL(url);
    shownUrls.current = [];
  }, []);

  return {
    entries: packed.entries,
    pages,
    ready: pages.length === 0 || pages.every((page) => !!page.url),
  };
}
