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
  let activeUrls: string[] = [];

  watch(
    () => [atlasState.value, textureLighting.value] as const,
    ([nextAtlasState, nextTextureLighting], _prev, onCleanup) => {
      const { packed: nextPacked, atlasScale: nextAtlasScale } = nextAtlasState;
      let cancelled = false;
      revokeUrls(activeUrls);
      activeUrls = [];
      pages.value = nextPacked.pages.map((page) => ({
        width: page.width,
        height: page.height,
        url: null,
      }));

      onCleanup(() => {
        cancelled = true;
        revokeUrls(activeUrls);
        activeUrls = [];
      });

      if (nextPacked.pages.length === 0 || typeof document === "undefined") return;

      buildAtlasPages(nextPacked.pages, nextTextureLighting, document, nextAtlasScale, () => cancelled)
        .then((nextPages) => {
          if (cancelled) {
            revokeUrls(nextPages.flatMap((page) => page.url?.startsWith("blob:") ? [page.url] : []));
            return;
          }
          activeUrls = nextPages.flatMap((page) => page.url?.startsWith("blob:") ? [page.url] : []);
          pages.value = nextPages;
        })
        .catch(() => {
          if (!cancelled) {
            pages.value = nextPacked.pages.map((page) => ({
              width: page.width,
              height: page.height,
              url: null,
            }));
          }
        });
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
