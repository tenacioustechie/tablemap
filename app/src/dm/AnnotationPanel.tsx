/**
 * Sidebar panel for the active map's annotations (T011): the drawing tool
 * (pen / eraser, colour, width, who sees new strokes, clear the layer), the
 * note tool (place a note by clicking the canvas) with the list of notes,
 * and a reminder of the ping gesture. The tools themselves run on the
 * canvas (`DmCanvas`); this panel edits the settings the view owns and
 * turns a tool on or off.
 */
import type { CSSProperties } from "react";
import { sceneNotes, type AnnotationActions } from "../state/annotationActions";
import { activeMap } from "../state/maps";
import { ANNOTATION_VISIBILITIES } from "../state/annotations";
import type { AnnotationVisibility } from "../state/model";
import { useTableStore, type TableStore } from "../state/store";
import {
  DRAW_MODE_LABELS,
  DRAW_PALETTE,
  DRAW_STROKE_WIDTH,
  DRAW_VISIBILITY_LABELS,
  type DrawMode,
  type DrawToolSettings,
} from "./annotationTool";

const styles = {
  heading: { fontSize: 13, margin: "12px 0 6px", color: "#aaa" },
  form: { display: "grid", gap: 6, fontSize: 12 },
  row: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 },
  active: { background: "#10252a", borderColor: "#5ac8fa", color: "#5ac8fa" },
  activeErase: { background: "#2a1010", borderColor: "#f66", color: "#f66" },
  muted: { color: "#666", fontSize: 13 },
  status: { color: "#aaa", fontSize: 12, margin: 0 },
  label: { display: "grid", gap: 2, color: "#aaa" },
  inline: { display: "flex", alignItems: "center", gap: 6, color: "#aaa" },
  swatches: { display: "flex", gap: 4, flexWrap: "wrap" },
  swatch: { width: 20, height: 20, borderRadius: 4, border: "1px solid #444", padding: 0 },
  list: { listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 4 },
  item: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    padding: "4px 6px",
    borderRadius: 4,
    background: "#1e1e1e",
  },
  itemSelected: { background: "#10252a", outline: "1px solid #5ac8fa" },
  itemButton: {
    flex: 1,
    textAlign: "left",
    background: "none",
    border: "none",
    color: "#ddd",
    padding: 0,
    cursor: "pointer",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  select: { padding: "4px 6px", background: "#0d0d0d", color: "#eee", border: "1px solid #444", borderRadius: 4 },
} satisfies Record<string, CSSProperties>;

export interface AnnotationPanelProps {
  store: TableStore;
  actions: AnnotationActions;
  settings: DrawToolSettings;
  onSettingsChange: (patch: Partial<DrawToolSettings>) => void;
  /** Whether the drawing tool is running on the canvas. */
  drawing: boolean;
  /** Turns the drawing tool on in `mode`; turns it off when it is already on in it. */
  onSelectDraw: (mode: DrawMode) => void;
  /** Whether the note tool (click to place) is running on the canvas. */
  placingNote: boolean;
  onToggleNoteTool: () => void;
  onStop: () => void;
  /** The note whose popover is open on the canvas. */
  selectedNoteId: string | null;
  onSelectNote: (id: string | null) => void;
}

/** The list entry's text: the first line, or a placeholder for an empty note. */
export function noteLabel(text: string): string {
  const line = text.split("\n").find((l) => l.trim() !== "")?.trim() ?? "";
  return line === "" ? "(empty note)" : line;
}

export function AnnotationPanel({
  store,
  actions,
  settings,
  onSettingsChange,
  drawing,
  onSelectDraw,
  placingNote,
  onToggleNoteTool,
  onStop,
  selectedNoteId,
  onSelectNote,
}: AnnotationPanelProps) {
  const scene = useTableStore((s) => activeMap(s.shared), store);

  if (!scene) {
    return (
      <section data-testid="annotation-panel">
        <h3 style={styles.heading}>Annotations</h3>
        <p style={styles.muted}>Show a map to draw on it or pin notes.</p>
      </section>
    );
  }

  const notes = sceneNotes(scene);
  const drawingCount = scene.annotations.filter((a) => a.kind === "drawing").length;
  const modeStyle = settings.mode === "draw" ? styles.active : styles.activeErase;

  return (
    <section data-testid="annotation-panel" style={styles.form}>
      <h3 style={styles.heading}>Annotations</h3>
      <div style={styles.row} role="group" aria-label="Drawing tool">
        {(["draw", "erase"] as DrawMode[]).map((mode) => {
          const on = drawing && settings.mode === mode;
          return (
            <button
              key={mode}
              type="button"
              onClick={() => onSelectDraw(mode)}
              aria-pressed={on}
              style={on ? modeStyle : undefined}
              data-testid={`draw-mode-${mode}`}
            >
              {DRAW_MODE_LABELS[mode]}
            </button>
          );
        })}
      </div>
      <label style={styles.label}>
        <span>
          Pen colour:{" "}
          <span style={styles.inline}>
            <input
              type="color"
              value={settings.color}
              onChange={(e) => onSettingsChange({ color: e.target.value })}
              aria-label="Pen colour"
              data-testid="draw-color"
            />
            <span style={styles.swatches}>
              {DRAW_PALETTE.map((color) => (
                <button
                  key={color}
                  type="button"
                  aria-label={`Pen colour ${color}`}
                  title={color}
                  onClick={() => onSettingsChange({ color })}
                  style={{
                    ...styles.swatch,
                    background: color,
                    outline: settings.color === color ? "2px solid #5ac8fa" : undefined,
                  }}
                  data-testid="draw-swatch"
                  data-color={color}
                />
              ))}
            </span>
          </span>
        </span>
      </label>
      <label style={styles.label}>
        <span>
          Pen width: <span data-testid="draw-width-value">{settings.strokeWidth}</span> px
        </span>
        <input
          type="range"
          min={DRAW_STROKE_WIDTH.min}
          max={DRAW_STROKE_WIDTH.max}
          step={1}
          value={settings.strokeWidth}
          onChange={(e) => onSettingsChange({ strokeWidth: Number(e.target.value) })}
          aria-label="Pen width"
          data-testid="draw-width"
        />
      </label>
      <label style={styles.label}>
        <span>New strokes are shown on</span>
        <select
          value={settings.visibility}
          onChange={(e) => onSettingsChange({ visibility: e.target.value as AnnotationVisibility })}
          aria-label="Drawing visibility"
          style={styles.select}
          data-testid="draw-visibility"
        >
          {ANNOTATION_VISIBILITIES.map((v) => (
            <option key={v} value={v}>
              {DRAW_VISIBILITY_LABELS[v]}
            </option>
          ))}
        </select>
      </label>
      <button
        type="button"
        onClick={() => actions.clearDrawings(scene.id)}
        disabled={drawingCount === 0}
        data-testid="draw-clear"
      >
        Clear drawings{drawingCount > 0 ? ` (${drawingCount})` : ""}
      </button>

      <h3 style={styles.heading}>
        Notes <span data-testid="note-count">({notes.length})</span>
      </h3>
      <button
        type="button"
        onClick={onToggleNoteTool}
        aria-pressed={placingNote}
        style={placingNote ? styles.active : undefined}
        data-testid="note-tool"
      >
        {placingNote ? "Click the map to pin a note…" : "Add note…"}
      </button>
      {(drawing || placingNote) && (
        <button type="button" onClick={onStop} data-testid="annotation-stop">
          Stop (Esc)
        </button>
      )}
      {notes.length > 0 && (
        <ul style={styles.list} data-testid="note-list">
          {notes.map((note) => {
            const selected = note.id === selectedNoteId;
            return (
              <li
                key={note.id}
                data-testid="note-item"
                data-note-id={note.id}
                data-selected={selected ? "true" : "false"}
                style={selected ? { ...styles.item, ...styles.itemSelected } : styles.item}
              >
                <button
                  type="button"
                  onClick={() => onSelectNote(selected ? null : note.id)}
                  style={styles.itemButton}
                  aria-label={`Open note ${noteLabel(note.text)}`}
                >
                  {noteLabel(note.text)}
                </button>
                <button
                  type="button"
                  onClick={() => actions.remove(scene.id, note.id)}
                  aria-label={`Delete note ${noteLabel(note.text)}`}
                  data-testid="note-delete"
                >
                  ×
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <p style={styles.status}>
        Notes are only ever shown here, never on the player screen. Alt-click the map to ping it.
      </p>
    </section>
  );
}
