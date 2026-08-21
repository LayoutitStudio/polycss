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
  selfShadow: boolean;
  shadowMaxExtend: number;
  shadowParametric: boolean;
  shadowDefinition: number;
  shadowStyle: "vector" | "pixel";
  shadowFollowAnimation: boolean;
  shadowOpacity: number;
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
    selfShadow?: boolean;
    shadowMaxExtend?: number;
    shadowParametric?: boolean;
    shadowDefinition?: number;
    shadowStyle?: "vector" | "pixel";
    shadowFollowAnimation?: boolean;
    shadowOpacity?: number;
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
    selfShadow,
    shadowMaxExtend,
    shadowParametric,
    shadowDefinition,
    shadowStyle,
    shadowFollowAnimation,
    shadowOpacity,
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
  // Self-shadow without Cast shadow is a no-op (you need a caster to
  // throw shadows on the mesh's own faces). Auto-enable Cast shadow +
  // Show ground when the user flips Self-shadow on, mirroring the
  // Cast shadow toggle's "also enable ground" affordance above.
  useToggle(folder, "Self-shadow", selfShadow, (value) =>
    onUpdateScene({
      selfShadow: value,
      ...(value ? { castShadow: true, showGround: true } : null),
    }),
  );
  useSlider(
    folder,
    "Shadow reach",
    { min: 200, max: 10000, step: 100 },
    shadowMaxExtend,
    (value) => onUpdateScene({ shadowMaxExtend: value }),
  );
  // Parametric shadows: a low-res silhouette per caster instead of full
  // geometry. `Shadow def.` sets the detail (silhouette points / pixel grid);
  // `Pixel shadow` swaps the smooth contour for blocky voxel blocks.
  useToggle(folder, "Parametric shadow", shadowParametric, (value) =>
    onUpdateScene({ shadowParametric: value }),
  );
  const shadowDefinitionControl = useSlider(
    folder,
    "Shadow def.",
    { min: 3, max: 96, step: 1 },
    shadowDefinition,
    (value) => onUpdateScene({ shadowDefinition: value }),
  );
  const shadowStyleControl = useToggle(folder, "Pixel shadow", shadowStyle === "pixel", (value) =>
    onUpdateScene({ shadowStyle: value ? "pixel" : "vector" }),
  );
  // The engine reads `shadow.definition` and `shadow.style` only inside the
  // parametric branch of the receiver-shadow builder, so both are literal
  // no-ops while `Parametric shadow` is off. Grey them out rather than let
  // the user toggle a control that changes nothing.
  useEffect(() => {
    shadowDefinitionControl?.setEnabled(shadowParametric);
    shadowStyleControl?.setEnabled(shadowParametric);
  }, [shadowDefinitionControl, shadowStyleControl, shadowParametric]);
  // Shading of the shadow itself (engine `shadow.opacity`), separate from
  // the geometry knobs above.
  useSlider(folder, "Shadow strength", { min: 0, max: 1, step: 0.01 }, shadowOpacity, (value) =>
    onUpdateScene({ shadowOpacity: value }),
  );
  useToggle(folder, "Animate shadow", shadowFollowAnimation, (value) =>
    onUpdateScene({ shadowFollowAnimation: value }),
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
