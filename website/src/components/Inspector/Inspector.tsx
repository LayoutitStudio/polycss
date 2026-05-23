import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";
import type { Polygon } from "@layoutit/polycss";

export interface InspectorColorGroup {
  /** Hex when `editable`; group label (e.g. "textured") when not. */
  color: string;
  count: number;
  editable: boolean;
  polygons: Polygon[];
}

export interface InspectorMesh {
  id: string;
  label: string;
  groups: InspectorColorGroup[];
}

export type InspectorColorChangeHandler = (
  mesh: InspectorMesh,
  group: InspectorColorGroup,
  next: string,
) => void;

export function Inspector({
  meshes,
  onColorChange,
  title = "Inspector",
}: {
  meshes: InspectorMesh[];
  onColorChange: InspectorColorChangeHandler;
  title?: string;
}) {
  if (meshes.length === 0) return null;
  return (
    <aside className="dn-inspector" aria-label={title}>
      <header className="dn-inspector__title">{title}</header>
      <InspectorContent meshes={meshes} onColorChange={onColorChange} />
    </aside>
  );
}

export const InspectorPanel = Inspector;

export function InspectorContent({
  meshes,
  onColorChange,
  className = "dn-inspector__body dark-scrollbar",
  emptyText,
  layout = "rows",
}: {
  meshes: InspectorMesh[];
  onColorChange: InspectorColorChangeHandler;
  className?: string;
  emptyText?: string;
  layout?: "rows" | "palette";
}) {
  if (meshes.length === 0) {
    return emptyText ? <p className="dn-materials-empty">{emptyText}</p> : null;
  }
  return (
    <div className={className}>
      {meshes.map((mesh) => (
        layout === "palette" ? (
          <PaletteMeshNode key={mesh.id} mesh={mesh} onColorChange={onColorChange} />
        ) : (
          <MeshNode key={mesh.id} mesh={mesh} onColorChange={onColorChange} />
        )
      ))}
    </div>
  );
}

function PaletteMeshNode({
  mesh,
  onColorChange,
}: {
  mesh: InspectorMesh;
  onColorChange: InspectorColorChangeHandler;
}) {
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const [draftColors, setDraftColors] = useState<Record<number, string>>({});
  useEffect(() => {
    setOpenIndex(null);
    setDraftColors({});
  }, [mesh.id, mesh.groups]);
  const activeGroup = openIndex == null ? null : mesh.groups[openIndex] ?? null;
  const activeColor = openIndex == null ? null : draftColors[openIndex] ?? activeGroup?.color ?? null;
  return (
    <div className="dn-material-palette">
      <div className="dn-material-palette__grid">
        {mesh.groups.map((group, index) => (
          <PaletteSwatch
            key={`${group.color}:${index}`}
            group={group}
            color={draftColors[index] ?? group.color}
            open={openIndex === index}
            onToggle={() => setOpenIndex((current) => (current === index ? null : index))}
          />
        ))}
      </div>
      {activeGroup?.editable && activeColor && (
        <ColorSelector
          color={activeColor}
          onPreview={(next) => {
            setDraftColors((current) => ({ ...current, [openIndex!]: next }));
          }}
          onCommit={(next) => {
            setDraftColors((current) => ({ ...current, [openIndex!]: next }));
            onColorChange(mesh, activeGroup, next);
          }}
        />
      )}
    </div>
  );
}

function MeshNode({
  mesh,
  onColorChange,
}: {
  mesh: InspectorMesh;
  onColorChange: InspectorColorChangeHandler;
}) {
  const [open, setOpen] = useState(true);
  return (
    <div className="dn-mesh-node">
      <button
        type="button"
        className={`dn-mesh-header${open ? " is-open" : ""}`}
        onClick={() => setOpen(!open)}
      >
        <span className="dn-mesh-chevron" aria-hidden="true">
          {open ? "▾" : "▸"}
        </span>
        <span className="dn-mesh-icon" aria-hidden="true">
          {"⬢"}
        </span>
        <span className="dn-mesh-label">{mesh.label}</span>
        <span className="dn-mesh-meta">{mesh.groups.length}</span>
      </button>
      {open && (
        <ul className="dn-mesh-groups">
          {mesh.groups.map((g, i) => (
            <GroupRow
              key={`${g.color}:${i}`}
              group={g}
              onChange={(next) => onColorChange(mesh, g, next)}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function GroupRow({
  group,
  onChange,
}: {
  group: InspectorColorGroup;
  onChange: (next: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [currentColor, setCurrentColor] = useState(group.color);
  // Reset when the upstream group changes (model reload, polygon rebuild).
  useEffect(() => {
    setCurrentColor(group.color);
  }, [group.color]);
  if (!group.editable) {
    return (
      <li className="dn-group-row is-readonly">
        <span className="dn-swatch dn-swatch--readonly" aria-hidden="true" />
        <span className="dn-group-label">{group.color}</span>
        <span className="dn-group-count">{group.count}</span>
      </li>
    );
  }
  return (
    <li className="dn-group-row">
      <button
        type="button"
        className="dn-swatch"
        style={{ background: currentColor }}
        onClick={() => inputRef.current?.click()}
        aria-label={`Change color of ${group.count} polygons (currently ${currentColor})`}
      />
      <input
        ref={inputRef}
        type="color"
        className="dn-color-input"
        value={currentColor}
        onChange={(e) => {
          setCurrentColor(e.target.value);
          onChange(e.target.value);
        }}
      />
      <span className="dn-group-label">{currentColor}</span>
      <span className="dn-group-count">{group.count}</span>
    </li>
  );
}

function PaletteSwatch({
  group,
  color,
  open,
  onToggle,
}: {
  group: InspectorColorGroup;
  color: string;
  open: boolean;
  onToggle: () => void;
}) {
  if (!group.editable) {
    return (
      <span
        className="dn-material-swatch dn-material-swatch--readonly"
        title={`${group.color}: ${group.count} polygons`}
        aria-label={`${group.color}: ${group.count} polygons`}
      />
    );
  }
  return (
    <span className="dn-material-swatch-wrap">
      <button
        type="button"
        className={`dn-material-swatch${open ? " is-open" : ""}`}
        style={{ background: color }}
        title={`${color}: ${group.count} polygons`}
        aria-label={`${open ? "Close" : "Open"} ${color} material selector with ${group.count} polygons`}
        onClick={onToggle}
      />
    </span>
  );
}

function ColorSelector({
  color,
  onPreview,
  onCommit,
}: {
  color: string;
  onPreview: (next: string) => void;
  onCommit: (next: string) => void;
}) {
  const [hsv, setHsv] = useState(() => hexToHsv(color));
  useEffect(() => {
    setHsv(hexToHsv(color));
  }, [color]);

  const update = (next: Hsv, commit: boolean) => {
    setHsv(next);
    const hex = hsvToHex(next);
    onPreview(hex);
    if (commit) onCommit(hex);
  };

  const drag = (
    event: ReactPointerEvent<HTMLElement>,
    resolve: (event: PointerEvent | ReactPointerEvent<HTMLElement>) => Hsv,
  ) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    update(resolve(event), false);
    const target = event.currentTarget;
    const handleMove = (moveEvent: PointerEvent) => update(resolve(moveEvent), false);
    const cleanup = () => {
      if (target.hasPointerCapture(event.pointerId)) {
        target.releasePointerCapture(event.pointerId);
      }
      target.removeEventListener("pointermove", handleMove);
      target.removeEventListener("pointerup", handleUp);
      target.removeEventListener("pointercancel", cleanup);
    };
    const handleUp = (upEvent: PointerEvent) => {
      update(resolve(upEvent), true);
      cleanup();
    };
    target.addEventListener("pointermove", handleMove);
    target.addEventListener("pointerup", handleUp);
    target.addEventListener("pointercancel", cleanup);
  };

  return (
    <div className="dn-color-selector" style={{ "--dn-selector-hue": hsv.h } as CSSProperties}>
      <div
        className="dn-color-selector__field"
        onPointerDown={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          drag(event, (pointerEvent) => ({
            h: hsv.h,
            s: clamp((pointerEvent.clientX - rect.left) / rect.width, 0, 1),
            v: 1 - clamp((pointerEvent.clientY - rect.top) / rect.height, 0, 1),
          }));
        }}
      >
        <span
          className="dn-color-selector__field-marker"
          style={{
            left: `${hsv.s * 100}%`,
            top: `${(1 - hsv.v) * 100}%`,
          }}
        />
      </div>
      <div
        className="dn-color-selector__hue"
        onPointerDown={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          drag(event, (pointerEvent) => ({
            ...hsv,
            h: clamp((pointerEvent.clientX - rect.left) / rect.width, 0, 1) * 360,
          }));
        }}
      >
        <span
          className="dn-color-selector__hue-marker"
          style={{ left: `${(hsv.h / 360) * 100}%` }}
        />
      </div>
    </div>
  );
}

interface Hsv {
  h: number;
  s: number;
  v: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function hexToHsv(hex: string): Hsv {
  const normalized = /^#[0-9a-f]{3}$/i.test(hex)
    ? `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}`
    : hex;
  const match = normalized.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  if (!match) return { h: 0, s: 0, v: 1 };
  const r = parseInt(match[1], 16) / 255;
  const g = parseInt(match[2], 16) / 255;
  const b = parseInt(match[3], 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  let h = 0;
  if (delta !== 0) {
    if (max === r) h = 60 * (((g - b) / delta) % 6);
    else if (max === g) h = 60 * ((b - r) / delta + 2);
    else h = 60 * ((r - g) / delta + 4);
  }
  if (h < 0) h += 360;
  return {
    h,
    s: max === 0 ? 0 : delta / max,
    v: max,
  };
}

function hsvToHex({ h, s, v }: Hsv): string {
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  let r = 0;
  let g = 0;
  let b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return `#${[r, g, b]
    .map((channel) => Math.round((channel + m) * 255).toString(16).padStart(2, "0"))
    .join("")}`;
}
