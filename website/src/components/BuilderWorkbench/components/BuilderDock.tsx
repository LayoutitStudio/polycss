import type { ReactNode } from "react";
import {
  Dock,
  DockScene,
} from "../../Dock";
import type { SceneOptionsState } from "../../types";
import type { PlacedItem } from "../types";
import { DockBuilderLighting } from "../slots/BuilderDockSlots";
import { BuilderMeshPanel } from "./BuilderMeshPanel";

export interface BuilderDockProps {
  sceneOptions: SceneOptionsState;
  updateScene: (partial: Partial<SceneOptionsState>) => void;
  selected: PlacedItem | null;
  onScaleChange: (scale: number) => void;
  onColorChange: (color: string) => void;
  onStepElevation: (direction: 1 | -1) => void;
  onDeleteSelected: () => void;
  sceneFolderContent: ReactNode;
}

export function BuilderDock({
  sceneOptions,
  updateScene,
  selected,
  onScaleChange,
  onColorChange,
  onStepElevation,
  onDeleteSelected,
  sceneFolderContent,
}: BuilderDockProps) {
  return (
    <Dock>
      <DockScene content={sceneFolderContent} />
      <DockBuilderLighting
        castShadow={sceneOptions.castShadow}
        showLight={sceneOptions.showLight}
        lightIntensity={sceneOptions.lightIntensity}
        ambientIntensity={sceneOptions.ambientIntensity}
        onUpdateScene={updateScene}
      />
      {selected ? (
        <BuilderMeshPanel
          selected={selected}
          gridResolution={sceneOptions.gridResolution}
          onScaleChange={onScaleChange}
          onColorChange={onColorChange}
          onStepElevation={onStepElevation}
          onDelete={onDeleteSelected}
        />
      ) : null}
    </Dock>
  );
}
