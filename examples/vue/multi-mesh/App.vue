<template>
  <div class="scene-host">
    <PolyCamera :rot-x="65" :rot-y="45" :zoom="0.3">
      <PolyOrbitControls />
      <PolyScene>
        <PolyBox  :size="80" color="#4ecdc4" :position="[-120, 0, 0]" />
        <PolyTorus color="#ff6644" :position="[0, 0, 0]" />
        <PolyCone  color="#ffd166" :position="[120, 0, 0]" />
      </PolyScene>
    </PolyCamera>
  </div>
</template>

<script setup lang="ts">
import { PolyCamera, PolyScene, PolyOrbitControls, PolyBox, PolyTorus, PolyCone } from "@layoutit/polycss-vue";
</script>

<style>
html, body { margin: 0; height: 100%; background: #111; }
.scene-host { width: 100%; height: 100vh; }
.scene-host .polycss-camera { width: 100%; height: 100%; }
</style>
