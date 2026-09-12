/**
 * Sidebar panel for the active map's fog of war (T007, T008): the tool
 * settings (reveal / hide, brush / rectangle / lasso, brush radius, feather,
 * grid snap), undo / redo, hide all / reveal all, and how many ops the
 * map's log holds. The tools themselves run on the canvas (`DmCanvas`);
 * this panel only edits the settings the view owns and turns a tool on or
 * off.
 */
import { useSyncExternalStore, type CSSProperties } from "react";
import type { FogActions } from "../state/fogActions";
import type { FogHistory } from "../state/fogHistory";
import { activeMap } from "../state/maps";
import { useTableStore, type TableStore } from "../state/store";
import {
  FOG_BRUSH_RADIUS,
  FOG_TOOL_KINDS,
  FOG_TOOL_LABELS,
  type FogToolKind,
  type FogToolSettings,
} from "./fogTool";

const styles = {
  heading: { fontSize: 13, margin: "12px 0 6px", color: "#aaa" },
  form: { display: "grid", gap: 6, fontSize: 12 },
  row: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 },
  row3: { display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6 },
  active: { background: "#2a2510", borderColor: "#fc6", color: "#fc6" },
  activeHide: { background: "#2a1010", borderColor: "#f66", color: "#f66" },
  muted: { color: "#666", fontSize: 13 },
  status: { color: "#aaa", fontSize: 12, margin: 0 },
  label: { display: "grid", gap: 2, color: "#aaa" },
  check: { display: "flex", alignItems: "center", gap: 6, color: "#aaa" },
} satisfies Record<string, CSSProperties>;

export interface FogPanelProps {
  store: TableStore;
  actions: FogActions;
  history: FogHistory;
  settings: FogToolSettings;
  onSettingsChange: (patch: Partial<FogToolSettings>) => void;
  /** Whether a fog tool is running on the canvas. */
  active: boolean;
  /** Turns the tool on with `kind`; turns it off when it is already on with it. */
  onSelectTool: (kind: FogToolKind) => void;
  onStop: () => void;
}

export function FogPanel({
  store,
  actions,
  history,
  settings,
  onSettingsChange,
  active,
  onSelectTool,
  onStop,
}: FogPanelProps) {
  const scene = useTableStore((s) => activeMap(s.shared), store);
  const sceneId = scene?.id ?? "";
  const redoDepth = useSyncExternalStore(history.subscribe, () => history.redoDepth(sceneId));

  if (!scene) {
    return (
      <section data-testid="fog-panel">
        <h3 style={styles.heading}>Fog of war</h3>
        <p style={styles.muted}>Show a map to edit its fog.</p>
      </section>
    );
  }

  const canUndo = scene.fogOps.length > 0;
  const canRedo = redoDepth > 0;
  const modeStyle = settings.mode === "reveal" ? styles.active : styles.activeHide;

  return (
    <section data-testid="fog-panel" style={styles.form}>
      <h3 style={styles.heading}>Fog of war</h3>
      <div style={styles.row} role="group" aria-label="Fog mode">
        <button
          type="button"
          onClick={() => onSettingsChange({ mode: "reveal" })}
          aria-pressed={settings.mode === "reveal"}
          style={settings.mode === "reveal" ? styles.active : undefined}
          data-testid="fog-mode-reveal"
        >
          Reveal
        </button>
        <button
          type="button"
          onClick={() => onSettingsChange({ mode: "hide" })}
          aria-pressed={settings.mode === "hide"}
          style={settings.mode === "hide" ? styles.activeHide : undefined}
          data-testid="fog-mode-hide"
        >
          Hide
        </button>
      </div>
      <div style={styles.row3} role="group" aria-label="Fog tool">
        {FOG_TOOL_KINDS.map((kind) => {
          const on = active && settings.tool === kind;
          return (
            <button
              key={kind}
              type="button"
              onClick={() => onSelectTool(kind)}
              aria-pressed={on}
              style={on ? modeStyle : undefined}
              data-testid={`fog-tool-${kind}`}
            >
              {FOG_TOOL_LABELS[kind]}
            </button>
          );
        })}
      </div>
      {active && (
        <button type="button" onClick={onStop} data-testid="fog-stop">
          Stop (Esc)
        </button>
      )}
      <label style={styles.label}>
        <span>
          Brush radius: <span data-testid="fog-brush-radius-value">{settings.radius}</span> px
        </span>
        <input
          type="range"
          min={FOG_BRUSH_RADIUS.min}
          max={FOG_BRUSH_RADIUS.max}
          step={1}
          value={settings.radius}
          onChange={(e) => onSettingsChange({ radius: Number(e.target.value) })}
          aria-label="Brush radius"
          data-testid="fog-brush-radius"
        />
      </label>
      <label style={styles.check}>
        <input
          type="checkbox"
          checked={settings.feather}
          onChange={(e) => onSettingsChange({ feather: e.target.checked })}
          data-testid="fog-feather"
        />
        Feathered edges
      </label>
      <label style={styles.check}>
        <input
          type="checkbox"
          checked={settings.snap}
          onChange={(e) => onSettingsChange({ snap: e.target.checked })}
          data-testid="fog-snap"
        />
        Snap to grid (whole cells)
      </label>
      <div style={styles.row}>
        <button
          type="button"
          onClick={() => history.undo(scene.id)}
          disabled={!canUndo}
          title="Undo (Ctrl+Z)"
          data-testid="fog-undo"
        >
          Undo
        </button>
        <button
          type="button"
          onClick={() => history.redo(scene.id)}
          disabled={!canRedo}
          title="Redo (Ctrl+Shift+Z)"
          data-testid="fog-redo"
        >
          Redo{canRedo ? ` (${redoDepth})` : ""}
        </button>
      </div>
      <div style={styles.row}>
        <button
          type="button"
          onClick={() => actions.hideAll(scene.id)}
          data-testid="fog-hide-all"
        >
          Hide all
        </button>
        <button
          type="button"
          onClick={() => actions.revealAll(scene.id)}
          data-testid="fog-reveal-all"
        >
          Reveal all
        </button>
      </div>
      <p style={styles.status}>
        Fog ops: <span data-testid="fog-op-count">{scene.fogOps.length}</span>
        {scene.fogMaskAssetId ? " on a saved mask" : ""}
      </p>
    </section>
  );
}
