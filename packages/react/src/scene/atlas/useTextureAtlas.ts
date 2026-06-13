import { useEffect, useMemo, useRef, useState } from "react";
import type {
  TextureAtlasPlan,
  PackedTextureAtlasEntry,
  TextureAtlasPage,
  PolyTextureLightingMode,
  TextureQuality,
  PolyRenderStrategy,
  PolyRenderStrategiesOption,
  PolyTextureBackend,
  PolyTextureImageRendering,
  PolyTextureLeafSizing,
  PolyTextureProjection,
} from "@layoutit/polycss-core";
import { filterAtlasPlans } from "./filterPlans";
import { packTextureAtlasPlansWithScale } from "./packing";
import { buildAtlasPages } from "./buildAtlasPages";

// TextureAtlasResult exposed by useTextureAtlas. `plans` is the plan list whose
// atlas is currently displayed — in `atomic` mode it lags `entries`/`pages` as
// one frame so solid + textured leaves always swap together.
export interface TextureAtlasResult {
  plans: Array<TextureAtlasPlan | null>;
  entries: Array<PackedTextureAtlasEntry | null>;
  pages: TextureAtlasPage[];
  ready: boolean;
}

interface AtlasFrame {
  plans: Array<TextureAtlasPlan | null>;
  entries: Array<PackedTextureAtlasEntry | null>;
  pages: TextureAtlasPage[];
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
  textureLeafSizing?: PolyTextureLeafSizing,
  textureBackend?: PolyTextureBackend,
  textureImageRendering?: PolyTextureImageRendering,
  textureProjection?: PolyTextureProjection,
  strategies?: PolyRenderStrategiesOption,
  // Atomic mode: hold the entire previous frame (geometry + bitmap) until the
  // next atlas is rasterised AND decoded, then swap all at once. Use it when
  // geometry changes arrive as discrete commits (no continuous drag), so an
  // edit never shows geometry before its texture. Default (false) streams the
  // bitmap in while geometry updates live — better for continuous drags.
  atomic = false,
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
      textureBackend,
      textureImageRendering,
      textureProjection,
    ),
    [plans, textureLighting, disabled, textureBackend, textureImageRendering, textureProjection],
  );

  const { packed, atlasScale } = useMemo(
    () => packTextureAtlasPlansWithScale(
      atlasPlans,
      textureQualityInput,
      typeof document !== "undefined" ? document : null,
      textureLeafSizing,
    ),
    [atlasPlans, textureQualityInput, textureLeafSizing],
  );

  // Streaming-mode page state (default).
  const [pages, setPages] = useState<TextureAtlasPage[]>(() => pageShells(packed.pages));
  // Atomic-mode whole-frame state.
  const [frame, setFrame] = useState<AtlasFrame>(() => ({
    plans,
    entries: packed.entries,
    pages: pageShells(packed.pages),
  }));
  // Blob URLs currently on screen — revoked a frame after they're replaced.
  const shownUrls = useRef<string[]>([]);
  const seqRef = useRef(0);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      for (const url of shownUrls.current) URL.revokeObjectURL(url);
      shownUrls.current = [];
    };
  }, []);

  useEffect(() => {
    if (atomic) {
      const seq = ++seqRef.current;
      const snapPlans = plans;
      const snapEntries = packed.entries;
      if (packed.pages.length === 0 || typeof document === "undefined") {
        deferRevoke(shownUrls.current);
        shownUrls.current = [];
        setFrame({ plans: snapPlans, entries: snapEntries, pages: pageShells(packed.pages) });
        return;
      }
      // Cancel as soon as a newer edit arrives (seqRef advances): the stale
      // build aborts and is dropped, so an intermediate baked texture never
      // swaps in. Only the latest build reaches the swap.
      const stale = (): boolean => seq !== seqRef.current;
      let built: string[] = [];
      buildAtlasPages(packed.pages, textureLighting, document, atlasScale, stale)
        .then(async (nextPages) => {
          built = blobUrlsOf(nextPages);
          await decodeBlobUrls(built);
          if (!mountedRef.current || stale()) {
            deferRevoke(built);
            return;
          }
          const prev = shownUrls.current;
          shownUrls.current = built;
          built = [];
          deferRevoke(prev);
          setFrame({ plans: snapPlans, entries: snapEntries, pages: nextPages });
        })
        .catch(() => {});
      return;
    }

    // --- streaming mode (default): geometry live, bitmap double-buffered ---
    let cancelled = false;
    if (packed.pages.length === 0) {
      deferRevoke(shownUrls.current);
      shownUrls.current = [];
      setPages((prev) => prev.length === 0 ? prev : []);
      return () => {};
    }
    if (typeof document === "undefined") return () => {};

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
      deferRevoke(built);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [packed, textureLighting, atlasScale, atomic]);

  if (atomic) {
    return {
      plans: frame.plans,
      entries: frame.entries,
      pages: frame.pages,
      ready: frame.pages.length === 0 || frame.pages.every((page) => !!page.url),
    };
  }
  return {
    plans,
    entries: packed.entries,
    pages,
    ready: pages.length === 0 || pages.every((page) => !!page.url),
  };
}
