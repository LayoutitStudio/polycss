import type { BuilderShapePreset } from "../shapePresets";
import type { BuilderGridTone } from "../../types";

export interface ShapePickerProps {
  shapes: BuilderShapePreset[];
  activeShapeId: string | null;
  onShapeClick: (id: string) => void;
  gridTone: BuilderGridTone;
  onToggleGridTone: () => void;
  onImportClick: () => void;
}

export function ShapePicker({
  shapes,
  activeShapeId,
  onShapeClick,
  gridTone,
  onToggleGridTone,
  onImportClick,
}: ShapePickerProps) {
  const nextGridTone = gridTone === "gray" ? "dark" : "gray";
  return (
    <aside className="shape-picker" aria-label="Shape picker">
      <div className="shape-picker__body dark-scrollbar">
        <div className="shape-picker__header">
          <h2 className="shape-picker__title">Shapes</h2>
        </div>

        {shapes.length === 0 ? (
          <div className="shape-picker__empty">No shapes</div>
        ) : (
          <div className="shape-picker__grid dark-scrollbar">
            {shapes.map((shape) => {
              const isActive = shape.id === activeShapeId;
              return (
                <button
                  type="button"
                  key={shape.id}
                  className={`shape-picker__item${isActive ? " is-active" : ""}`}
                  onClick={() => onShapeClick(shape.id)}
                  aria-label={`Select ${shape.label}`}
                >
                  <span className="shape-picker__thumb">
                    <img src={shape.thumbnailSrc} alt="" decoding="async" />
                  </span>
                  <span className="shape-picker__label">{shape.label}</span>
                </button>
              );
            })}
            <button
              type="button"
              className="shape-picker__item shape-picker__item--import"
              onClick={onImportClick}
              aria-label="Import shape"
            >
              <span className="shape-picker__thumb shape-picker__thumb--import">
                <span className="material-symbols-rounded shape-picker__import-icon" aria-hidden="true">
                  add
                </span>
              </span>
              <span className="shape-picker__label">Import</span>
            </button>
          </div>
        )}

        <div className="shape-picker__surface">
          <span className="shape-picker__surface-label">Grid surface</span>
          <button
            type="button"
            className="shape-picker__surface-button"
            onClick={onToggleGridTone}
            aria-label={`Switch grid surface to ${nextGridTone}`}
          >
            <span className={`shape-picker__surface-swatch is-${gridTone}`} aria-hidden="true" />
            <span>{gridTone === "gray" ? "Light" : "Dark"}</span>
          </button>
        </div>
      </div>
    </aside>
  );
}
