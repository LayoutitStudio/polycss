import type { BuilderToolMode } from "../types";

export interface BuilderToolRibbonProps {
  mode: BuilderToolMode;
  onChange: (mode: BuilderToolMode) => void;
  hasActiveShape: boolean;
  onRestart: () => void;
}

const TOOLS: Array<{ id: BuilderToolMode; label: string; icon: string }> = [
  { id: "move", label: "Move", icon: "open_with" },
  { id: "add", label: "Add", icon: "add_box" },
  { id: "remove", label: "Remove", icon: "delete" },
];

export function BuilderToolRibbon({
  mode,
  onChange,
  hasActiveShape,
  onRestart,
}: BuilderToolRibbonProps) {
  return (
    <div className="builder-tool-ribbon" role="toolbar" aria-label="Builder tools">
      {TOOLS.map((tool) => (
        <button
          key={tool.id}
          type="button"
          className={`builder-tool-ribbon__button${mode === tool.id ? " is-active" : ""}`}
          onClick={() => onChange(tool.id)}
          aria-pressed={mode === tool.id}
          title={tool.id === "add" && !hasActiveShape ? "Select a shape first" : tool.label}
        >
          <span className="material-symbols-rounded builder-tool-ribbon__icon" aria-hidden="true">
            {tool.icon}
          </span>
          <span>{tool.label}</span>
        </button>
      ))}
      <span className="builder-tool-ribbon__divider" aria-hidden="true" />
      <button
        type="button"
        className="builder-tool-ribbon__button builder-tool-ribbon__button--restart"
        onClick={onRestart}
        title="Restart"
        aria-label="Restart scene"
      >
        <span className="material-symbols-rounded builder-tool-ribbon__icon" aria-hidden="true">
          restart_alt
        </span>
        <span>Restart</span>
      </button>
    </div>
  );
}
