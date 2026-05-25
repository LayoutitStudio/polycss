import { useDockGui, useFolder, useOption, useSlider, useToggle } from "../../Dock";
import type { WorkbenchMeshResolution } from "../../types";

const MESH_RESOLUTION_OPTIONS: Record<string, WorkbenchMeshResolution> = {
  Lossy: "lossy",
  Lossless: "lossless",
  Disabled: "disabled",
};

export interface DockBuilderRenderingInputs {
  meshResolution: WorkbenchMeshResolution;
  interiorFill: boolean;
  onUpdateScene: (partial: {
    meshResolution?: WorkbenchMeshResolution;
    interiorFill?: boolean;
  }) => void;
}

export function DockBuilderRendering(inputs: DockBuilderRenderingInputs): null {
  const folder = useFolder(useDockGui(), "Rendering", { open: false });
  useOption(folder, "Mesh resolution", MESH_RESOLUTION_OPTIONS, inputs.meshResolution, (value) =>
    inputs.onUpdateScene({ meshResolution: value }),
  );
  useToggle(folder, "Interior fill", inputs.interiorFill, (value) =>
    inputs.onUpdateScene({ interiorFill: value }),
  );
  return null;
}

export interface DockBuilderViewInputs {
  autoCenter: boolean;
  showAxes: boolean;
  onUpdateScene: (partial: {
    autoCenter?: boolean;
    showAxes?: boolean;
  }) => void;
}

export function DockBuilderView(inputs: DockBuilderViewInputs): null {
  const folder = useFolder(useDockGui(), "View", { open: false });
  useToggle(folder, "Axes", inputs.showAxes, (value) => inputs.onUpdateScene({ showAxes: value }));
  useToggle(folder, "Auto center", inputs.autoCenter, (value) => inputs.onUpdateScene({ autoCenter: value }));
  return null;
}

export interface DockBuilderLightingInputs {
  castShadow: boolean;
  showLight: boolean;
  lightIntensity: number;
  ambientIntensity: number;
  onUpdateScene: (partial: {
    castShadow?: boolean;
    showLight?: boolean;
    lightIntensity?: number;
    ambientIntensity?: number;
  }) => void;
}

export function DockBuilderLighting(inputs: DockBuilderLightingInputs): null {
  const folder = useFolder(useDockGui(), "Lighting", { open: false });
  useToggle(folder, "Cast shadow", inputs.castShadow, (value) => inputs.onUpdateScene({ castShadow: value }));
  useToggle(folder, "Light helper", inputs.showLight, (value) => inputs.onUpdateScene({ showLight: value }));
  useSlider(folder, "Key", { min: 0, max: 2, step: 0.05 }, inputs.lightIntensity, (value) =>
    inputs.onUpdateScene({ lightIntensity: value }),
  );
  useSlider(folder, "Ambient", { min: 0, max: 2, step: 0.05 }, inputs.ambientIntensity, (value) =>
    inputs.onUpdateScene({ ambientIntensity: value }),
  );
  return null;
}
