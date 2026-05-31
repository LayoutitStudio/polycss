/**
 * "Lighting" folder of the Dock GUI.
 *
 * Three toggles (cast shadow, ground plane, light helper) plus the directional
 * key-light azimuth/elevation/intensity/color and an ambient
 * intensity/color pair. All controllers funnel into a single
 * `onUpdateScene` callback so the parent owns the scene-options state.
 */
import type { GUI } from "lil-gui";
import { useEffect } from "react";

import { useColor, useFolder, useSlider, useToggle } from "../primitives";

export interface LightingFolderInputs {
  castShadow: boolean;
  shadowMaxExtend: number;
  showGround: boolean;
  groundColor: string;
  showLight: boolean;
  lightAzimuth: number;
  lightElevation: number;
  lightIntensity: number;
  lightColor: string;
  ambientIntensity: number;
  ambientColor: string;
  onUpdateScene: (partial: {
    castShadow?: boolean;
    shadowMaxExtend?: number;
    showGround?: boolean;
    groundColor?: string;
    showLight?: boolean;
    lightAzimuth?: number;
    lightElevation?: number;
    lightIntensity?: number;
    lightColor?: string;
    ambientIntensity?: number;
    ambientColor?: string;
  }) => void;
}

export function useLightingFolder(parent: GUI | null, inputs: LightingFolderInputs): void {
  const {
    castShadow,
    shadowMaxExtend,
    showGround,
    groundColor,
    showLight,
    lightAzimuth,
    lightElevation,
    lightIntensity,
    lightColor,
    ambientIntensity,
    ambientColor,
    onUpdateScene,
  } = inputs;

  const folder = useFolder(parent, "Lighting", { open: true });

  useToggle(folder, "Cast shadow", castShadow, (value) =>
    onUpdateScene({
      castShadow: value,
      ...(value ? { showGround: true } : null),
    }),
  );
  useSlider(
    folder,
    "Shadow reach",
    { min: 200, max: 10000, step: 100 },
    shadowMaxExtend,
    (value) => onUpdateScene({ shadowMaxExtend: value }),
  );
  useToggle(folder, "Show ground", showGround, (value) => onUpdateScene({ showGround: value }));
  const groundColorControl = useColor(folder, "Ground color", groundColor, (value) =>
    onUpdateScene({ groundColor: value }),
  );
  useEffect(() => {
    groundColorControl?.setVisible(showGround);
  }, [groundColorControl, showGround]);
  useToggle(folder, "Light helper", showLight, (value) => onUpdateScene({ showLight: value }));

  useSlider(folder, "Azimuth", { min: 0, max: 360, step: 1 }, lightAzimuth, (value) =>
    onUpdateScene({ lightAzimuth: value }),
  );
  useSlider(folder, "Elev.", { min: 0, max: 90, step: 1 }, lightElevation, (value) =>
    onUpdateScene({ lightElevation: value }),
  );
  useSlider(folder, "Light intensity", { min: 0, max: 8, step: 0.05 }, lightIntensity, (value) =>
    onUpdateScene({ lightIntensity: value }),
  );
  useColor(folder, "Light color", lightColor, (value) => onUpdateScene({ lightColor: value }));

  useSlider(folder, "Ambient", { min: 0, max: 4, step: 0.05 }, ambientIntensity, (value) =>
    onUpdateScene({ ambientIntensity: value }),
  );
  useColor(folder, "Amb. color", ambientColor, (value) => onUpdateScene({ ambientColor: value }));
}
