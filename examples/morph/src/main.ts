import { loadPolyMorphPackage } from "@layoutit/polycss-morph";
import {
  mountPolyMorphPlaneDemo,
  type PolyMorphPlaneDemoController,
} from "./planeDemo";
import "./styles.css";

declare global {
  interface Window {
    __polyMorphDemo?: PolyMorphPlaneDemoController;
  }
}

const root = document.querySelector<HTMLElement>("[data-morph-workbench]")!;

async function boot(): Promise<void> {
  const loaded = await loadPolyMorphPackage("/model/");
  window.__polyMorphDemo = await mountPolyMorphPlaneDemo(root, loaded.model);
}

void boot().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  root.querySelector<HTMLElement>("[data-debug]")!.textContent = message;
  root.querySelector<HTMLElement>("[data-scene-label]")!.textContent = "ERROR";
  console.error(error);
});
