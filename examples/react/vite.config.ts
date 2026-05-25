import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "path";

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
        "baked-shapes": resolve(__dirname, "baked-shapes/index.html"),
        "multi-mesh": resolve(__dirname, "multi-mesh/index.html"),
        "solid-glb": resolve(__dirname, "solid-glb/index.html"),
        "textured-glb": resolve(__dirname, "textured-glb/index.html"),
        animated: resolve(__dirname, "animated/index.html"),
        voxel: resolve(__dirname, "voxel/index.html"),
        "core-runner": resolve(__dirname, "core-runner/index.html"),
      },
    },
  },
});
