<template>
  <div class="scene-host">
    <PolyPerspectiveCamera :rot-x="65" :rot-y="45" :zoom="0.1">
      <PolyOrbitControls />
      <PolyScene>
        <PolyMesh
          v-if="parseResult"
          :ref="animRef"
          :polygons="parseResult.polygons"
          :auto-center="true"
          :merge="false"
        />
      </PolyScene>
    </PolyPerspectiveCamera>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, watch } from "vue";
import {
  PolyPerspectiveCamera,
  PolyScene,
  PolyOrbitControls,
  PolyMesh,
  usePolyAnimation,
  loadMesh,
} from "@layoutit/polycss-vue";
import type { ParseResult } from "@layoutit/polycss-vue";

const parseResult = ref<ParseResult | null>(null);

onMounted(async () => {
  parseResult.value = await loadMesh("https://polycss.com/gallery/glb/AnimatedWizard.glb");
});

const clips = ref(parseResult.value?.animation?.clips);
const controller = ref(parseResult.value?.animation);

watch(parseResult, (result) => {
  clips.value = result?.animation?.clips;
  controller.value = result?.animation ?? undefined;
});

const { ref: animRef, actions } = usePolyAnimation(clips, controller);

watch(actions, (a) => {
  const firstClip = clips.value?.[0];
  if (firstClip) a[firstClip.name]?.play();
}, { immediate: true });
</script>

<style>
html, body { margin: 0; height: 100%; background: #111; }
.scene-host { width: 100%; height: 100vh; }
.scene-host .polycss-camera { width: 100%; height: 100%; }
</style>
