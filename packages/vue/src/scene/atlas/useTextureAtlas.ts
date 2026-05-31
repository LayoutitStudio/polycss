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
} from "@layoutit/polycss-core";
import { isBorderShapeSupported, isSolidTriangleSupported, projectiveQuadSupported } from "./detection";
import { filterAtlasPlans } from "./filterPlans";
import { packTextureAtlasPlansWithScale } from "./packing";
import { buildAtlasPages } from "./buildAtlasPages";

// TextureAtlasResult exposed by useTextureAtlas.
export interface TextureAtlasResult {
  entries: ComputedRef<Array<PackedTextureAtlasEntry | null>>;
  pages: Ref<TextureAtlasPage[]>;
  ready: ComputedRef<boolean>;
  useFullRectSolid: ComputedRef<boolean>;
  useProjectiveQuad: ComputedRef<boolean>;
  useStableTriangle: ComputedRef<boolean>;
  useBorderShape: ComputedRef<boolean>;
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
  strategies: ComputedRef<PolyRenderStrategiesOption | undefined> = computed(() => undefined),
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
    );
    return packTextureAtlasPlansWithScale(
      atlasPlans,
      textureQuality.value,
      typeof document !== "undefined" ? document : null,
    );
  });

  const pages = ref<TextureAtlasPage[]>(
    atlasState.value.packed.pages.map((page) => ({ width: page.width, height: page.height, url: null })),
  );
  // Blob URLs currently shown on screen — revoked one frame after they're
  // replaced (or on scope dispose), never while still painting.
  let activeUrls: string[] = [];

  watch(
    () => [atlasState.value, textureLighting.value] as const,
    ([nextAtlasState, nextTextureLighting], _prev, onCleanup) => {
      const { packed: nextPacked, atlasScale: nextAtlasScale } = nextAtlasState;
      let cancelled = false;
      let built: string[] = [];

      onCleanup(() => {
        cancelled = true;
        deferRevoke(built);
      });

      if (nextPacked.pages.length === 0) {
        // No textured leaves anymore → drop the bitmaps.
        deferRevoke(activeUrls);
        activeUrls = [];
        if (pages.value.length !== 0) pages.value = [];
        return;
      }
      if (typeof document === "undefined") return;

      // Double-buffer: keep the previous bitmap painting (geometry leaves still
      // reposition live from `entries`) until the new atlas is rasterised AND
      // decoded, then swap. Never blank — on a layout change a brief stale
      // sample under the new slices beats a blank flash.
      if (!pages.value.some((page) => page.url)) {
        pages.value = nextPacked.pages.map((page) => ({ width: page.width, height: page.height, url: null }));
      }

      buildAtlasPages(nextPacked.pages, nextTextureLighting, document, nextAtlasScale, () => cancelled)
        .then(async (nextPages) => {
          built = blobUrlsOf(nextPages);
          await decodeBlobUrls(built);
          if (cancelled) {
            deferRevoke(built);
            return;
          }
          const stale = activeUrls;
          activeUrls = built;
          built = [];
          deferRevoke(stale);
          pages.value = nextPages;
        })
        .catch(() => {});
    },
    { immediate: true },
  );

  if (getCurrentScope()) {
    onScopeDispose(() => {
      revokeUrls(activeUrls);
      activeUrls = [];
    });
  }

  return {
    entries: computed(() => atlasState.value.packed.entries),
    pages,
    ready: computed(() => pages.value.length === 0 || pages.value.every((page) => !!page.url)),
    useFullRectSolid,
    useProjectiveQuad,
    useStableTriangle,
    useBorderShape,
  };
}
