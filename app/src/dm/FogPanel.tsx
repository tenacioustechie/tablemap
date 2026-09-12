/**
 * Sidebar panel for the active map's fog of war (T007): the rectangle
 * reveal tool (run by the canvas), hide all / reveal all, and how many ops
 * the map's log holds. Brush, lasso, hiding shapes, feathering and undo
 * arrive with T008.
 */
import type { CSSProperties } from "react";
import type { FogActions } from "../state/fogActions";
import { activeMap } from "../state/maps";
import { useTableStore, type TableStore } from "../state/store";

const styles = {
  heading: { fontSize: 13, margin: "12px 0 6px", color: "#aaa" },
  form: { display: "grid", gap: 6, fontSize: 12 },
  row: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 },
  active: { background: "#2a2510", borderColor: "#fc6", color: "#fc6" },
  muted: { color: "#666", fontSize: 13 },
  status: { color: "#aaa", fontSize: 12, margin: 0 },
} satisfies Record<string, CSSProperties>;

export interface FogPanelProps {
  store: TableStore;
  actions: FogActions;
  /** Whether the rectangle reveal tool is running on the canvas. */
  revealing: boolean;
  onToggleReveal: () => void;
}

export function FogPanel({ store, actions, revealing, onToggleReveal }: FogPanelProps) {
  const scene = useTableStore((s) => activeMap(s.shared), store);

  if (!scene) {
    return (
      <section data-testid="fog-panel">
        <h3 style={styles.heading}>Fog of war</h3>
        <p style={styles.muted}>Show a map to edit its fog.</p>
      </section>
    );
  }

  return (
    <section data-testid="fog-panel" style={styles.form}>
      <h3 style={styles.heading}>Fog of war</h3>
      <button
        type="button"
        onClick={onToggleReveal}
        aria-pressed={revealing}
        style={revealing ? styles.active : undefined}
        data-testid="fog-reveal-rect-button"
      >
        {revealing ? "Stop revealing" : "Reveal rectangle…"}
      </button>
      {revealing && (
        <p style={{ ...styles.muted, margin: 0 }}>
          Drag across the map to reveal that area to the players. Esc stops.
        </p>
      )}
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
