<template>
  <div class="scene-host">
    <PolyPerspectiveCamera :rot-x="65" :rot-y="45">
      <PolyOrbitControls :animate="{ speed: 0.3 }" />
      <PolyScene>
        <PolyMesh src="https://polycss.com/gallery/glb/apple.glb" :auto-center="true" />
      </PolyScene>
    </PolyPerspectiveCamera>
  </div>
</template>

<script setup lang="ts">
import { PolyPerspectiveCamera, PolyScene, PolyOrbitControls, PolyMesh } from "@layoutit/polycss-vue";
</script>

<style>
html, body { margin: 0; height: 100%; background: #111; }
.scene-host { width: 100%; height: 100vh; }
.scene-host .polycss-camera { width: 100%; height: 100%; }
</style>
