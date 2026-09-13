/**
 * Sidebar panel for the active map's walls and doors (T101, T102): the
 * **Wall** and **Door** tool buttons (the tools themselves run on the
 * canvas — `map/wallGesture.ts` through `DmCanvas`), **Snap to grid**, the
 * counts, what is selected on the canvas (its kind and its length in cells)
 * with **Delete**, and **Clear walls** behind an inline confirm dispatching
 * `map/walls-clear`. Wall edits are not in any undo history. Doors in play
 * (T103) extend this panel.
 */
import { useEffect, useState, type CSSProperties } from "react";
import { activeMap } from "../state/maps";
import { useTableStore, type TableStore } from "../state/store";
import { doorsOf, findWall, segmentLength, type WallKind, type WallSegment } from "../state/walls";
import { WALL_TOOL_KINDS, WALL_TOOL_LABELS, type WallToolSettings } from "./wallTool";

const styles = {
  heading: { fontSize: 13, margin: "12px 0 6px", color: "#aaa" },
  form: { display: "grid", gap: 6, fontSize: 12 },
  row: { display: "flex", gap: 6, alignItems: "center" },
  tools: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 },
  active: { background: "#2a2510", borderColor: "#ff9d2e", color: "#ff9d2e" },
  check: { display: "flex", alignItems: "center", gap: 6, color: "#aaa" },
  muted: { color: "#666", fontSize: 13 },
  status: { color: "#aaa", fontSize: 12, margin: 0 },
  selected: {
    display: "grid",
    gap: 6,
    padding: 8,
    border: "1px solid #ff9d2e",
    borderRadius: 4,
    background: "#1e1a12",
  },
  danger: { color: "#f88" },
} satisfies Record<string, CSSProperties>;

export interface WallsPanelProps {
  store: TableStore;
  settings: WallToolSettings;
  onSettingsChange: (patch: Partial<WallToolSettings>) => void;
  /** Whether the wall / door tool is armed on the canvas. */
  active: boolean;
  /** Arms the tool with `kind`; disarms it when it is already armed with it. */
  onSelectTool: (kind: WallKind) => void;
  onStop: () => void;
  /** The segment selected on the canvas, if any. */
  selectedId: string | null;
  onDelete: (id: string) => void;
}

/** "wall", "door (closed)" or "door (open)". */
export function describeWallKind(segment: WallSegment): string {
  return segment.kind === "door" ? `door (${segment.open ? "open" : "closed"})` : "wall";
}

/** A segment's length in grid cells, to one decimal ("2 cells", "1.4 cells"). */
export function describeWallLength(segment: WallSegment, cellSize: number): string {
  if (!(cellSize > 0)) return `${Math.round(segmentLength(segment))} px`;
  const cells = Math.round((segmentLength(segment) / cellSize) * 10) / 10;
  return `${cells} cell${cells === 1 ? "" : "s"}`;
}

export function WallsPanel({
  store,
  settings,
  onSettingsChange,
  active,
  onSelectTool,
  onStop,
  selectedId,
  onDelete,
}: WallsPanelProps) {
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
  const selected = selectedId === null ? undefined : findWall(scene, selectedId);

  return (
    <section data-testid="walls-panel" style={styles.form}>
      <h3 style={styles.heading}>
        Walls and doors <span data-testid="wall-count">({scene.walls.length})</span>
      </h3>
      <div style={styles.tools} role="group" aria-label="Wall tool">
        {WALL_TOOL_KINDS.map((kind) => {
          const on = active && settings.tool === kind;
          return (
            <button
              key={kind}
              type="button"
              onClick={() => onSelectTool(kind)}
              aria-pressed={on}
              style={on ? styles.active : undefined}
              data-testid={`wall-tool-${kind}`}
            >
              {WALL_TOOL_LABELS[kind]}
            </button>
          );
        })}
      </div>
      {active && (
        <button type="button" onClick={onStop} data-testid="wall-stop">
          Stop (Esc)
        </button>
      )}
      <label style={styles.check}>
        <input
          type="checkbox"
          checked={settings.snap}
          onChange={(e) => onSettingsChange({ snap: e.target.checked })}
          data-testid="wall-snap"
        />
        Snap to grid (hold Shift to skip)
      </label>
      <p style={styles.status} data-testid="wall-summary" data-walls={plainCount} data-doors={doorCount}>
        {scene.walls.length === 0
          ? "No walls on this map yet."
          : `${plainCount} wall${plainCount === 1 ? "" : "s"}, ${doorCount} door${doorCount === 1 ? "" : "s"}.`}
      </p>
      {selected ? (
        <div
          data-testid="wall-selected"
          data-wall-id={selected.id}
          data-wall-kind={selected.kind}
          style={styles.selected}
        >
          <span>
            Selected: <strong data-testid="wall-selected-kind">{describeWallKind(selected)}</strong>,{" "}
            <span data-testid="wall-selected-length">
              {describeWallLength(selected, scene.grid.cellSize)}
            </span>
          </span>
          <span style={styles.status}>Drag an end on the canvas to move it.</span>
          <button
            type="button"
            onClick={() => onDelete(selected.id)}
            aria-label={`Delete selected ${selected.kind}`}
            data-testid="wall-delete"
          >
            Delete (Del)
          </button>
        </div>
      ) : (
        <p style={styles.status} data-testid="wall-selection-hint">
          {active
            ? settings.tool === "wall"
              ? "Click each corner of the wall in turn; double-click the last one, or press Esc, to finish."
              : "Drag across a doorway to add a closed door."
            : "With no tool armed, click a wall or door on the canvas to select it."}
        </p>
      )}
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
        Walls block sight and doors let it through while open. Walls are shown on your canvas
        only, never on the player screen. Wall edits cannot be undone.
      </p>
    </section>
  );
}
