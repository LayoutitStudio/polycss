import {
  computed,
  getCurrentScope,
  onScopeDispose,
  ref,
  watch,
} from "vue";
import type { ComputedRef, Ref } from "vue";
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
import { isBorderShapeSupported, isSolidTriangleSupported, projectiveQuadSupported } from "./detection";
import { filterAtlasPlans } from "./filterPlans";
import { packTextureAtlasPlansWithScale } from "./packing";
import { buildAtlasPages } from "./buildAtlasPages";

// TextureAtlasResult exposed by useTextureAtlas. `plans` is the plan list whose
// atlas is currently displayed — in atomic mode it lags `entries`/`pages` as one
// frame so solid + textured leaves always swap together.
export interface TextureAtlasResult {
  plans: ComputedRef<Array<TextureAtlasPlan | null>>;
  entries: ComputedRef<Array<PackedTextureAtlasEntry | null>>;
  pages: ComputedRef<TextureAtlasPage[]>;
  ready: ComputedRef<boolean>;
  useFullRectSolid: ComputedRef<boolean>;
  useProjectiveQuad: ComputedRef<boolean>;
  useStableTriangle: ComputedRef<boolean>;
  useBorderShape: ComputedRef<boolean>;
}

interface AtlasFrame {
  plans: Array<TextureAtlasPlan | null>;
  entries: Array<PackedTextureAtlasEntry | null>;
  pages: TextureAtlasPage[];
}

// ---------------------------------------------------------------------------
// useTextureAtlas — Vue composable that packs plans into atlas pages with blob URLs
// ---------------------------------------------------------------------------

function revokeUrls(urls: string[]): void {
  for (const url of urls) {
    if (url.startsWith("blob:")) URL.revokeObjectURL(url);
  }
}

function blobUrlsOf(pages: readonly TextureAtlasPage[]): string[] {
  return pages.flatMap((page) => page.url?.startsWith("blob:") ? [page.url] : []);
}

function shellsOf(pages: readonly { width: number; height: number }[]): TextureAtlasPage[] {
  return pages.map((page) => ({ width: page.width, height: page.height, url: null }));
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
  if (typeof requestAnimationFrame === "function") requestAnimationFrame(() => revokeUrls(urls));
  else setTimeout(() => revokeUrls(urls), 0);
}

export function useTextureAtlas(
  plans: ComputedRef<Array<TextureAtlasPlan | null>>,
  textureLighting: ComputedRef<PolyTextureLightingMode>,
  textureQuality: ComputedRef<TextureQuality | undefined> = computed(() => undefined),
  textureLeafSizing: ComputedRef<PolyTextureLeafSizing | undefined> = computed(() => undefined),
  textureBackend: ComputedRef<PolyTextureBackend | undefined> = computed(() => undefined),
  textureImageRendering: ComputedRef<PolyTextureImageRendering | undefined> = computed(() => undefined),
  textureProjection: ComputedRef<PolyTextureProjection | undefined> = computed(() => undefined),
  strategies: ComputedRef<PolyRenderStrategiesOption | undefined> = computed(() => undefined),
  // Atomic mode: hold the whole previous frame (geometry + bitmap) until the
  // next atlas is rasterised AND decoded, then swap all at once. Default (false)
  // streams the bitmap in while geometry updates live.
  atomic: ComputedRef<boolean> = computed(() => false),
): TextureAtlasResult {
  const disabled = computed(() => new Set((strategies.value?.disable ?? []) as PolyRenderStrategy[]));
  const useFullRectSolid = computed(() => !disabled.value.has("b"));
  const useProjectiveQuad = computed(() => {
    const doc = typeof document !== "undefined" ? document : null;
    return useFullRectSolid.value && (!doc || projectiveQuadSupported(doc));
  });
  const useStableTriangle = computed(() => !disabled.value.has("u") && isSolidTriangleSupported());
  const useBorderShape = computed(
    () => !disabled.value.has("i") && textureLighting.value !== "dynamic" && isBorderShapeSupported(),
  );

  const atlasState = computed(() => {
    const atlasPlans = filterAtlasPlans(
      plans.value,
      textureLighting.value,
      disabled.value,
      typeof document !== "undefined" ? document : null,
      textureBackend.value,
      textureImageRendering.value,
      textureProjection.value,
    );
    return packTextureAtlasPlansWithScale(
      atlasPlans,
      textureQuality.value,
      typeof document !== "undefined" ? document : null,
      textureLeafSizing.value,
    );
  });

  // Streaming-mode page state (default).
  const pages = ref<TextureAtlasPage[]>(shellsOf(atlasState.value.packed.pages));
  // Atomic-mode whole-frame state.
  const frame = ref<AtlasFrame>({
    plans: plans.value,
    entries: atlasState.value.packed.entries,
    pages: shellsOf(atlasState.value.packed.pages),
  });
  // Blob URLs currently shown on screen — revoked a frame after they're replaced.
  let activeUrls: string[] = [];
  let seq = 0;
  let disposed = false;

  watch(
    () => [atlasState.value, textureLighting.value, atomic.value] as const,
    ([nextAtlasState, nextTextureLighting, nextAtomic], _prev, onCleanup) => {
      const { packed: nextPacked, atlasScale: nextAtlasScale } = nextAtlasState;

      if (nextAtomic) {
        const mySeq = ++seq;
        const snapPlans = plans.value;
        const snapEntries = nextPacked.entries;
        if (nextPacked.pages.length === 0 || typeof document === "undefined") {
          deferRevoke(activeUrls);
          activeUrls = [];
          frame.value = { plans: snapPlans, entries: snapEntries, pages: shellsOf(nextPacked.pages) };
          return;
        }
        // Cancel as soon as a newer edit arrives: only the latest build swaps,
        // so an intermediate baked texture never flashes in.
        const stale = (): boolean => disposed || mySeq !== seq;
        let built: string[] = [];
        buildAtlasPages(nextPacked.pages, nextTextureLighting, document, nextAtlasScale, stale)
          .then(async (nextPages) => {
            built = blobUrlsOf(nextPages);
            await decodeBlobUrls(built);
            if (stale()) {
              deferRevoke(built);
              return;
            }
            const prev = activeUrls;
            activeUrls = built;
            built = [];
            deferRevoke(prev);
            frame.value = { plans: snapPlans, entries: snapEntries, pages: nextPages };
          })
          .catch(() => {});
        return;
      }

      // --- streaming mode (default): geometry live, bitmap double-buffered ---
      let cancelled = false;
      let built: string[] = [];
      onCleanup(() => {
        cancelled = true;
        deferRevoke(built);
      });

      if (nextPacked.pages.length === 0) {
        deferRevoke(activeUrls);
        activeUrls = [];
        if (pages.value.length !== 0) pages.value = [];
        return;
      }
      if (typeof document === "undefined") return;

      if (!pages.value.some((page) => page.url)) {
        pages.value = shellsOf(nextPacked.pages);
      }

      buildAtlasPages(nextPacked.pages, nextTextureLighting, document, nextAtlasScale, () => cancelled)
        .then(async (nextPages) => {
          built = blobUrlsOf(nextPages);
          await decodeBlobUrls(built);
          if (cancelled) {
            deferRevoke(built);
            return;
          }
          const prev = activeUrls;
          activeUrls = built;
          built = [];
          deferRevoke(prev);
          pages.value = nextPages;
        })
        .catch(() => {});
    },
    { immediate: true },
  );

  if (getCurrentScope()) {
    onScopeDispose(() => {
      disposed = true;
      revokeUrls(activeUrls);
      activeUrls = [];
    });
  }

  return {
    plans: computed(() => atomic.value ? frame.value.plans : plans.value),
    entries: computed(() => atomic.value ? frame.value.entries : atlasState.value.packed.entries),
    pages: computed(() => atomic.value ? frame.value.pages : pages.value),
    ready: computed(() => {
      const p = atomic.value ? frame.value.pages : pages.value;
      return p.length === 0 || p.every((page) => !!page.url);
    }),
    useFullRectSolid,
    useProjectiveQuad,
    useStableTriangle,
    useBorderShape,
  };
}
