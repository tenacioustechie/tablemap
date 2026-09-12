/**
 * Sidebar panel for the active map's grid: cell size and offset (typed, or
 * derived with the two-corner alignment tool on the canvas), and the overlay
 * style — visibility, colour, opacity — separately for the DM and player
 * views (ADR 0010). Every change is one `setGrid` action, so it persists and
 * reaches the player like any other op.
 */
import { useEffect, useState, type CSSProperties } from "react";
import type { MapActions } from "../state/mapActions";
import { activeMap } from "../state/maps";
import {
  GRID_VIEWS,
  type GridSettings,
  type GridStyle,
  type GridView,
} from "../state/model";
import { useTableStore, type TableStore } from "../state/store";

const styles = {
  heading: { fontSize: 13, margin: "12px 0 6px", color: "#aaa" },
  form: { display: "grid", gap: 6, fontSize: 12 },
  row: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 },
  label: { display: "grid", gap: 2, color: "#aaa" },
  inline: { display: "flex", alignItems: "center", gap: 6, color: "#aaa" },
  input: {
    padding: "4px 6px",
    background: "#0d0d0d",
    color: "#eee",
    border: "1px solid #444",
    borderRadius: 4,
    width: "100%",
    boxSizing: "border-box",
  },
  fieldset: {
    border: "1px solid #333",
    borderRadius: 4,
    padding: "6px 8px",
    margin: 0,
    display: "grid",
    gap: 6,
  },
  legend: { color: "#aaa", padding: "0 4px", fontSize: 12 },
  alignActive: { background: "#1b2530", borderColor: "#8cf", color: "#8cf" },
  muted: { color: "#666", fontSize: 13 },
} satisfies Record<string, CSSProperties>;

const VIEW_LABELS: Record<GridView, string> = { dm: "DM view", player: "Player view" };

export interface GridPanelProps {
  store: TableStore;
  actions: MapActions;
  /** Whether the alignment tool is running on the canvas. */
  aligning: boolean;
  onToggleAlign: () => void;
}

/**
 * A number input that keeps what the DM is typing (so clearing the field
 * does not snap back) and commits only values that pass `accept`.
 */
function NumberField({
  label,
  ariaLabel,
  value,
  accept,
  onCommit,
  step = 1,
  min,
}: {
  label: string;
  /** Distinct accessible name (the blank-map form has a "Cell size" too). */
  ariaLabel: string;
  value: number;
  accept: (n: number) => boolean;
  onCommit: (n: number) => void;
  step?: number;
  min?: number;
}) {
  const [text, setText] = useState(String(value));
  useEffect(() => {
    setText((current) => (Number(current) === value ? current : String(value)));
  }, [value]);
  return (
    <label style={styles.label}>
      {label}
      <input
        aria-label={ariaLabel}
        type="number"
        step={step}
        min={min}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          const n = Number(e.target.value);
          if (e.target.value.trim() !== "" && Number.isFinite(n) && accept(n)) onCommit(n);
        }}
        style={styles.input}
      />
    </label>
  );
}

function StyleFields({
  view,
  style,
  onChange,
}: {
  view: GridView;
  style: GridStyle;
  onChange: (patch: Partial<GridStyle>) => void;
}) {
  const name = VIEW_LABELS[view];
  return (
    <fieldset data-testid={`grid-style-${view}`} style={styles.fieldset}>
      <legend style={styles.legend}>{name}</legend>
      <label style={styles.inline}>
        <input
          type="checkbox"
          aria-label={`Show grid (${name})`}
          checked={style.visible}
          onChange={(e) => onChange({ visible: e.target.checked })}
        />
        Show grid
      </label>
      <div style={styles.row}>
        <label style={styles.label}>
          Colour
          <input
            type="color"
            aria-label={`Grid colour (${name})`}
            value={style.color}
            onChange={(e) => onChange({ color: e.target.value })}
            style={{ ...styles.input, padding: 0, height: 26 }}
          />
        </label>
        <label style={styles.label}>
          Opacity {Math.round(style.opacity * 100)}%
          <input
            type="range"
            aria-label={`Grid opacity (${name})`}
            min={0}
            max={1}
            step={0.05}
            value={style.opacity}
            onChange={(e) => onChange({ opacity: Number(e.target.value) })}
          />
        </label>
      </div>
    </fieldset>
  );
}

export function GridPanel({ store, actions, aligning, onToggleAlign }: GridPanelProps) {
  const scene = useTableStore((s) => activeMap(s.shared), store);

  if (!scene) {
    return (
      <section data-testid="grid-panel">
        <h3 style={styles.heading}>Grid</h3>
        <p style={styles.muted}>Show a map to edit its grid.</p>
      </section>
    );
  }

  const grid = scene.grid;
  const update = (patch: Partial<GridSettings>) =>
    actions.setGrid(scene.id, { ...grid, ...patch });
  const updateStyle = (view: GridView, patch: Partial<GridStyle>) =>
    update({ [view]: { ...grid[view], ...patch } });

  return (
    <section data-testid="grid-panel" style={styles.form}>
      <h3 style={styles.heading}>Grid</h3>
      <button
        type="button"
        onClick={onToggleAlign}
        aria-pressed={aligning}
        style={aligning ? styles.alignActive : undefined}
        data-testid="align-grid-button"
      >
        {aligning ? "Cancel alignment" : "Align grid…"}
      </button>
      {aligning && (
        <p style={{ ...styles.muted, margin: 0 }}>
          On the map, drag across one printed square (or click two opposite
          corners). Esc cancels.
        </p>
      )}
      <NumberField
        label="Cell size (px)"
        ariaLabel="Grid cell size"
        value={grid.cellSize}
        min={1}
        step={0.5}
        accept={(n) => n > 0}
        onCommit={(cellSize) => update({ cellSize })}
      />
      <div style={styles.row}>
        <NumberField
          label="Offset X (px)"
          ariaLabel="Grid offset X"
          value={grid.offsetX}
          accept={() => true}
          onCommit={(offsetX) => update({ offsetX })}
        />
        <NumberField
          label="Offset Y (px)"
          ariaLabel="Grid offset Y"
          value={grid.offsetY}
          accept={() => true}
          onCommit={(offsetY) => update({ offsetY })}
        />
      </div>
      {GRID_VIEWS.map((view) => (
        <StyleFields
          key={view}
          view={view}
          style={grid[view]}
          onChange={(patch) => updateStyle(view, patch)}
        />
      ))}
    </section>
  );
}
