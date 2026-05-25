import { useEffect, useState } from "react";
import { stripParenthesizedText } from "../../GalleryWorkbench/presets";
import type { PlacedItem } from "../types";

export interface BuilderMeshPanelProps {
  selected: PlacedItem;
  gridResolution: number;
  onScaleChange: (scale: number) => void;
  onColorChange: (color: string) => void;
  onStepElevation: (direction: 1 | -1) => void;
  onDelete: () => void;
}

function clampScale(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.max(0.1, Math.min(5, value));
}

function zLevelLabel(elevation: number, gridResolution: number): string {
  const level = gridResolution > 0 ? elevation / gridResolution : elevation;
  return Number.isInteger(level) ? String(level) : level.toFixed(1);
}

function normalizeHexColor(value: string): string | null {
  const trimmed = value.trim();
  if (/^#[0-9a-fA-F]{6}$/.test(trimmed)) return trimmed.toLowerCase();
  if (/^[0-9a-fA-F]{6}$/.test(trimmed)) return `#${trimmed.toLowerCase()}`;
  return null;
}

export function BuilderMeshPanel({
  selected,
  gridResolution,
  onScaleChange,
  onColorChange,
  onStepElevation,
  onDelete,
}: BuilderMeshPanelProps) {
  const scale = clampScale(selected.scale);
  const elevation = Math.max(0, selected.elevation ?? 0);
  const [colorDraft, setColorDraft] = useState(selected.color);

  useEffect(() => {
    setColorDraft(selected.color);
  }, [selected.id, selected.color]);

  return (
    <section className="builder-mesh-panel" aria-label="Mesh">
      <div className="builder-mesh-panel__header">
        <div className="builder-mesh-panel__title-group">
          <h2 className="builder-mesh-panel__title">Mesh</h2>
          <p className="builder-mesh-panel__name">{stripParenthesizedText(selected.preset.label)}</p>
        </div>
        <button
          type="button"
          className="builder-mesh-panel__delete"
          aria-label={`Remove ${selected.preset.label}`}
          onClick={onDelete}
        >
          ×
        </button>
      </div>

      <div className="builder-mesh-panel__field">
        <div className="builder-mesh-panel__field-row">
          <label className="builder-mesh-panel__label" htmlFor="builder-mesh-scale">Scale</label>
          <input
            id="builder-mesh-scale"
            className="builder-mesh-panel__number"
            type="number"
            min={0.1}
            max={5}
            step={0.05}
            value={scale.toFixed(2)}
            onChange={(event) => onScaleChange(clampScale(Number(event.currentTarget.value)))}
          />
        </div>
        <input
          className="builder-mesh-panel__range"
          type="range"
          min={0.1}
          max={5}
          step={0.05}
          value={scale}
          aria-label="Scale"
          onChange={(event) => onScaleChange(clampScale(Number(event.currentTarget.value)))}
        />
      </div>

      <div className="builder-mesh-panel__field">
        <div className="builder-mesh-panel__field-row">
          <label className="builder-mesh-panel__label" htmlFor="builder-mesh-color">Color</label>
          <input
            id="builder-mesh-color"
            className="builder-mesh-panel__color"
            type="color"
            value={selected.color}
            onChange={(event) => {
              setColorDraft(event.currentTarget.value);
              onColorChange(event.currentTarget.value);
            }}
            onInput={(event) => {
              setColorDraft(event.currentTarget.value);
              onColorChange(event.currentTarget.value);
            }}
          />
          <input
            className="builder-mesh-panel__color-text"
            type="text"
            aria-label="Mesh color hex"
            value={colorDraft}
            spellCheck={false}
            onChange={(event) => {
              setColorDraft(event.currentTarget.value);
              const color = normalizeHexColor(event.currentTarget.value);
              if (color) onColorChange(color);
            }}
          />
        </div>
      </div>

      <div className="builder-mesh-panel__field">
        <div className="builder-mesh-panel__field-row">
          <span className="builder-mesh-panel__label">Z level</span>
          <div className="builder-mesh-panel__stepper">
            <button
              type="button"
              aria-label="Lower mesh"
              disabled={elevation <= 0}
              onClick={() => onStepElevation(-1)}
            >
              −
            </button>
            <output>{zLevelLabel(elevation, gridResolution)}</output>
            <button
              type="button"
              aria-label="Raise mesh"
              onClick={() => onStepElevation(1)}
            >
              +
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
