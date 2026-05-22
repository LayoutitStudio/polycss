<template>
  <div class="scene-host">
    <PolyCamera :rot-x="65" :rot-y="45" :zoom="0.1">
      <PolyOrbitControls :animate="{ speed: 0.3 }" />
      <PolyScene>
        <PolyMesh src="https://polycss.com/gallery/vox/apple.vox" :auto-center="true" />
      </PolyScene>
    </PolyCamera>
  </div>
</template>

<script setup lang="ts">
import { PolyCamera, PolyScene, PolyOrbitControls, PolyMesh } from "@layoutit/polycss-vue";
</script>

<style>
html, body { margin: 0; height: 100%; background: #111; }
.scene-host { width: 100%; height: 100vh; }
.scene-host .polycss-camera { width: 100%; height: 100%; }
</style>
