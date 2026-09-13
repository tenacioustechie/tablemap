/**
 * Sidebar panel for the active map's walls and doors (T101): a placeholder
 * until T102 brings the drawing tools — the counts and a **Clear walls**
 * button with an inline confirm, dispatching `map/walls-clear` on the
 * store. Doors in play (T103) and the tools (T102) extend this panel.
 */
import { useEffect, useState, type CSSProperties } from "react";
import { activeMap } from "../state/maps";
import { useTableStore, type TableStore } from "../state/store";
import { doorsOf } from "../state/walls";

const styles = {
  heading: { fontSize: 13, margin: "12px 0 6px", color: "#aaa" },
  form: { display: "grid", gap: 6, fontSize: 12 },
  row: { display: "flex", gap: 6, alignItems: "center" },
  muted: { color: "#666", fontSize: 13 },
  status: { color: "#aaa", fontSize: 12, margin: 0 },
  danger: { color: "#f88" },
} satisfies Record<string, CSSProperties>;

export interface WallsPanelProps {
  store: TableStore;
}

export function WallsPanel({ store }: WallsPanelProps) {
  const scene = useTableStore((s) => activeMap(s.shared), store);
  const dispatch = useTableStore((s) => s.dispatch, store);
  const [confirmClear, setConfirmClear] = useState(false);
  const sceneId = scene?.id ?? null;
  const wallCount = scene?.walls.length ?? 0;

  // A pending confirm belongs to the map and its walls it was asked about.
  useEffect(() => {
    setConfirmClear(false);
  }, [sceneId, wallCount]);

  if (!scene) {
    return (
      <section data-testid="walls-panel">
        <h3 style={styles.heading}>Walls and doors</h3>
        <p style={styles.muted}>Show a map to see its walls.</p>
      </section>
    );
  }

  const doorCount = doorsOf(scene.walls).length;
  const plainCount = scene.walls.length - doorCount;

  return (
    <section data-testid="walls-panel" style={styles.form}>
      <h3 style={styles.heading}>
        Walls and doors <span data-testid="wall-count">({scene.walls.length})</span>
      </h3>
      <p style={styles.status} data-testid="wall-summary" data-walls={plainCount} data-doors={doorCount}>
        {scene.walls.length === 0
          ? "No walls on this map yet."
          : `${plainCount} wall${plainCount === 1 ? "" : "s"}, ${doorCount} door${doorCount === 1 ? "" : "s"}.`}
      </p>
      {confirmClear ? (
        <div style={styles.row}>
          <button
            type="button"
            style={styles.danger}
            onClick={() => {
              dispatch({ kind: "map/walls-clear", id: scene.id });
              setConfirmClear(false);
            }}
            aria-label="Confirm clear walls"
            data-testid="walls-clear-confirm"
          >
            Confirm clear walls
          </button>
          <button type="button" onClick={() => setConfirmClear(false)} data-testid="walls-clear-cancel">
            Cancel
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setConfirmClear(true)}
          disabled={scene.walls.length === 0}
          data-testid="walls-clear"
        >
          Clear walls{scene.walls.length > 0 ? ` (${scene.walls.length})` : ""}
        </button>
      )}
      <p style={styles.status}>
        Walls block sight and doors let it through while open. Drawing tools arrive in a later
        version; walls are shown on your canvas only, never on the player screen.
      </p>
    </section>
  );
}
