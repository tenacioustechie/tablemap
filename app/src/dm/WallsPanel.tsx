/**
 * Sidebar panel for the active map's walls and doors (T101, T102, T103):
 * the **Wall** and **Door** tool buttons (the tools themselves run on the
 * canvas — `map/wallGesture.ts` through `DmCanvas`), **Snap to grid**, the
 * counts, the **Doors** list (T103: one row per door with its state, a
 * click selects it and centres the canvas on it, **Open** / **Close**
 * flips it through `onToggleDoor`), what is selected on the canvas (its
 * kind and its length in cells) with **Delete**, and **Clear walls** behind
 * an inline confirm dispatching `map/walls-clear`. Wall edits are not in
 * any undo history.
 *
 * A selected door gets a **Name** field (ADR 0030): the draft commits on
 * Enter or blur as one `map/wall-set` of the door with the normalized name
 * (blank removes it), Esc puts the stored name back. Named doors show their
 * name in the list and on the canvas instead of "Door n" / `Dn`.
 */
import { useEffect, useState, type CSSProperties, type KeyboardEvent } from "react";
import { activeMap } from "../state/maps";
import { useTableStore, type TableStore } from "../state/store";
import {
  DOOR_NAME_MAX_LENGTH,
  doorsOf,
  findWall,
  normalizeDoorName,
  patchWall,
  segmentLength,
  type DoorSegment,
  type WallKind,
  type WallSegment,
} from "../state/walls";
import { doorLabelText } from "./WallLayer";
import { WALL_TOOL_KINDS, WALL_TOOL_LABELS, type WallToolSettings } from "./wallTool";

const styles = {
  heading: { fontSize: 13, margin: "12px 0 6px", color: "#aaa" },
  subheading: { fontSize: 12, margin: "6px 0 0", color: "#aaa" },
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
  doorList: { listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 4 },
  doorItem: {
    display: "flex",
    gap: 6,
    alignItems: "center",
    padding: "2px 4px",
    borderRadius: 4,
    border: "1px solid transparent",
  },
  doorItemSelected: { borderColor: "#5ee6b0", background: "#122019" },
  doorLabel: {
    flex: 1,
    textAlign: "left",
    background: "none",
    border: "none",
    color: "#ddd",
    font: "inherit",
    padding: "4px 2px",
    cursor: "pointer",
  },
  doorOpen: { color: "#5ee6b0" },
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
  /** Opens a closed door, closes an open one (T103). */
  onToggleDoor: (id: string) => void;
  /** Selects a segment and centres the canvas on it (T103). */
  onFocus: (id: string) => void;
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

/** The door list's label for the n-th door (1-based): "Door 2 · open", or "Vault · open" when named (ADR 0030). */
export function describeDoor(ordinal: number, open: boolean, name?: string): string {
  return `${name ?? `Door ${ordinal}`} · ${open ? "open" : "closed"}`;
}

/** The selected door's name field (ADR 0030); `onCommit` gets the raw draft. */
function DoorNameField({
  door,
  ordinal,
  onCommit,
}: {
  door: DoorSegment;
  ordinal: number;
  onCommit: (raw: string) => void;
}) {
  const stored = door.name ?? "";
  const [draft, setDraft] = useState(stored);
  // Another door selected, or the name changed elsewhere: show what is stored.
  useEffect(() => {
    setDraft(stored);
  }, [door.id, stored]);
  const commit = () => {
    if ((normalizeDoorName(draft) ?? "") !== stored) onCommit(draft);
    else setDraft(stored);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      commit();
    } else if (e.key === "Escape") {
      // Esc here reverts the draft; it must not also deselect the door or stop a tool.
      e.stopPropagation();
      setDraft(stored);
      e.currentTarget.blur();
    }
  };
  return (
    <label style={{ display: "grid", gap: 2 }}>
      <span style={{ color: "#aaa" }}>Name (shown on your canvas only)</span>
      <input
        type="text"
        data-testid="door-name-input"
        value={draft}
        maxLength={DOOR_NAME_MAX_LENGTH}
        placeholder={doorLabelText(ordinal)}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={onKeyDown}
      />
    </label>
  );
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
  onToggleDoor,
  onFocus,
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

  const doors = doorsOf(scene.walls);
  const doorCount = doors.length;
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
      {doors.length > 0 && (
        <>
          <h4 style={styles.subheading}>Doors</h4>
          <ul
            data-testid="door-list"
            data-doors-open={doors.filter((d) => d.open).length}
            aria-label="Doors"
            style={styles.doorList}
          >
            {doors.map((door, index) => {
              const label = describeDoor(index + 1, door.open, door.name);
              const isSelected = door.id === selectedId;
              return (
                <li
                  key={door.id}
                  data-testid="door-item"
                  data-door-id={door.id}
                  data-open={door.open ? "true" : "false"}
                  data-selected={isSelected ? "true" : "false"}
                  style={isSelected ? { ...styles.doorItem, ...styles.doorItemSelected } : styles.doorItem}
                >
                  <button
                    type="button"
                    data-testid="door-select"
                    aria-label={`Select door ${index + 1}`}
                    title="Select this door and centre the canvas on it"
                    onClick={() => onFocus(door.id)}
                    style={door.open ? { ...styles.doorLabel, ...styles.doorOpen } : styles.doorLabel}
                  >
                    {label}
                  </button>
                  <button
                    type="button"
                    data-testid="door-toggle"
                    aria-label={`${door.open ? "Close" : "Open"} door ${index + 1}`}
                    aria-pressed={door.open}
                    onClick={() => onToggleDoor(door.id)}
                  >
                    {door.open ? "Close" : "Open"}
                  </button>
                </li>
              );
            })}
          </ul>
          <p style={styles.status}>
            Click a door on the canvas to open or close it, whatever tool is armed. Click its name
            here to select it and centre the canvas on it.
          </p>
        </>
      )}
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
          {selected.kind === "door" && (
            <DoorNameField
              door={selected}
              ordinal={doors.findIndex((d) => d.id === selected.id) + 1}
              onCommit={(raw) => {
                const next = patchWall(selected, { name: normalizeDoorName(raw) ?? null });
                if (next !== selected) dispatch({ kind: "map/wall-set", id: scene.id, segment: next });
              }}
            />
          )}
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
            : "With no tool armed, click a wall on the canvas to select it; pick a door by its name in the list."}
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
