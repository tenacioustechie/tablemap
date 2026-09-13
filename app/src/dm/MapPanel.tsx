/**
 * Sidebar panel listing the campaign's maps with thumbnails, plus import
 * (file picker) and a blank-map form. All changes go through `MapActions`.
 * The blank-map form is a setup-once control, so it sits behind a
 * "New blank map" disclosure, closed by default (T019); the import stays
 * visible because dropping or picking an image is the common path.
 */
import {
  useState,
  type ChangeEvent,
  type CSSProperties,
  type FormEvent,
} from "react";
import type { TableMapDb } from "../state/db";
import type { MapActions } from "../state/mapActions";
import {
  DEFAULT_BLANK_MAP_COLOR,
  DEFAULT_BLANK_MAP_COLUMNS,
  DEFAULT_BLANK_MAP_NAME,
  DEFAULT_BLANK_MAP_ROWS,
} from "../state/maps";
import { defaultGridSettings, type MapScene } from "../state/model";
import { useTableStore, type TableStore } from "../state/store";
import { useAssetBlob, useObjectUrl } from "./useAssetBlob";

const styles = {
  heading: { fontSize: 14, margin: "16px 0 8px", color: "#aaa" },
  list: { listStyle: "none", padding: 0, margin: "0 0 12px" },
  item: {
    display: "grid",
    gridTemplateColumns: "48px 1fr",
    gap: 8,
    padding: 6,
    marginBottom: 4,
    borderRadius: 4,
    border: "1px solid #333",
    background: "#1c1c1c",
  },
  itemActive: { borderColor: "#8cf", background: "#1b2530" },
  thumb: {
    width: 48,
    height: 36,
    objectFit: "cover",
    borderRadius: 2,
    background: "#000",
    display: "block",
  },
  name: {
    fontSize: 13,
    fontWeight: 600,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  meta: { fontSize: 11, color: "#888" },
  actions: { display: "flex", flexWrap: "wrap", gap: 4, marginTop: 4 },
  small: { fontSize: 11, padding: "2px 6px" },
  input: {
    padding: "4px 6px",
    background: "#0d0d0d",
    color: "#eee",
    border: "1px solid #444",
    borderRadius: 4,
    width: "100%",
    boxSizing: "border-box",
  },
  error: { color: "#f88", fontSize: 12, margin: "4px 0" },
  disclosure: {
    display: "block",
    width: "100%",
    textAlign: "left",
    margin: "12px 0 6px",
    padding: "6px 8px",
    background: "#1c1c1c",
    color: "#ccc",
    border: "1px solid #333",
    borderRadius: 4,
    fontSize: 13,
    cursor: "pointer",
  },
  form: { display: "grid", gap: 6, fontSize: 12 },
  row: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 },
  label: { display: "grid", gap: 2, color: "#aaa" },
} satisfies Record<string, CSSProperties>;

export interface MapPanelProps {
  store: TableStore;
  db: TableMapDb;
  actions: MapActions;
  /** Imports files chosen via the picker; owned by the view (shared with drag-drop). */
  importFiles: (files: readonly File[]) => void;
  importError: string | null;
  importing: boolean;
}

function Thumbnail({ db, map }: { db: TableMapDb; map: MapScene }) {
  const blob = useAssetBlob(db, map.imageAssetId);
  const url = useObjectUrl(blob);
  if (map.imageAssetId && url) {
    return <img src={url} alt="" style={styles.thumb} data-testid="map-thumb" />;
  }
  return (
    <div
      data-testid="map-thumb"
      style={{ ...styles.thumb, background: map.backgroundColor }}
    />
  );
}

function MapItem({
  db,
  map,
  active,
  actions,
}: {
  db: TableMapDb;
  map: MapScene;
  active: boolean;
  actions: MapActions;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const submitRename = (e: FormEvent) => {
    e.preventDefault();
    if (draft !== null && draft.trim() !== "") actions.rename(map.id, draft.trim());
    setDraft(null);
  };

  return (
    <li
      data-testid="map-item"
      data-map-id={map.id}
      data-active={active ? "true" : "false"}
      aria-current={active ? "true" : undefined}
      style={{ ...styles.item, ...(active ? styles.itemActive : {}) }}
    >
      <Thumbnail db={db} map={map} />
      <div style={{ minWidth: 0 }}>
        {draft === null ? (
          <div data-testid="map-item-name" style={styles.name} title={map.name}>
            {map.name}
          </div>
        ) : (
          <form onSubmit={submitRename} style={{ display: "flex", gap: 4 }}>
            <input
              aria-label="Map name"
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              style={styles.input}
            />
            <button type="submit" style={styles.small}>
              Save
            </button>
            <button type="button" style={styles.small} onClick={() => setDraft(null)}>
              Cancel
            </button>
          </form>
        )}
        <div style={styles.meta}>
          {map.width}×{map.height}
          {map.imageAssetId === null ? " · blank" : ""}
        </div>
        <div style={styles.actions}>
          <button
            type="button"
            style={styles.small}
            onClick={() => actions.setActive(map.id)}
            disabled={active}
            aria-label={`Show ${map.name}`}
          >
            {active ? "Showing" : "Show"}
          </button>
          <button
            type="button"
            style={styles.small}
            onClick={() => setDraft(map.name)}
            aria-label={`Rename ${map.name}`}
          >
            Rename
          </button>
          <button
            type="button"
            style={styles.small}
            onClick={() => void actions.duplicate(map.id)}
            aria-label={`Duplicate ${map.name}`}
          >
            Duplicate
          </button>
          {confirmDelete ? (
            <>
              <button
                type="button"
                style={{ ...styles.small, color: "#f88" }}
                onClick={() => void actions.remove(map.id)}
                aria-label={`Confirm delete ${map.name}`}
              >
                Confirm delete
              </button>
              <button
                type="button"
                style={styles.small}
                onClick={() => setConfirmDelete(false)}
              >
                Cancel
              </button>
            </>
          ) : (
            <button
              type="button"
              style={styles.small}
              onClick={() => setConfirmDelete(true)}
              aria-label={`Delete ${map.name}`}
            >
              Delete
            </button>
          )}
        </div>
      </div>
    </li>
  );
}

function BlankMapForm({ actions }: { actions: MapActions }) {
  const [name, setName] = useState(DEFAULT_BLANK_MAP_NAME);
  const [columns, setColumns] = useState(String(DEFAULT_BLANK_MAP_COLUMNS));
  const [rows, setRows] = useState(String(DEFAULT_BLANK_MAP_ROWS));
  const [cellSize, setCellSize] = useState(String(defaultGridSettings().cellSize));
  const [color, setColor] = useState(DEFAULT_BLANK_MAP_COLOR);

  const cols = Number(columns);
  const rws = Number(rows);
  const cell = Number(cellSize);
  const valid = cols >= 1 && rws >= 1 && cell >= 1 && Number.isFinite(cols + rws + cell);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!valid) return;
    actions.createBlank({
      name: name.trim() === "" ? DEFAULT_BLANK_MAP_NAME : name.trim(),
      columns: cols,
      rows: rws,
      cellSize: cell,
      color,
    });
  };

  return (
    <form data-testid="blank-map-form" onSubmit={submit} style={styles.form}>
      <label style={styles.label}>
        Name
        <input
          aria-label="Blank map name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          style={styles.input}
        />
      </label>
      <div style={styles.row}>
        <label style={styles.label}>
          Columns
          <input
            aria-label="Columns"
            type="number"
            min={1}
            value={columns}
            onChange={(e) => setColumns(e.target.value)}
            style={styles.input}
          />
        </label>
        <label style={styles.label}>
          Rows
          <input
            aria-label="Rows"
            type="number"
            min={1}
            value={rows}
            onChange={(e) => setRows(e.target.value)}
            style={styles.input}
          />
        </label>
      </div>
      <div style={styles.row}>
        <label style={styles.label}>
          Cell size (px)
          <input
            aria-label="Cell size"
            type="number"
            min={1}
            value={cellSize}
            onChange={(e) => setCellSize(e.target.value)}
            style={styles.input}
          />
        </label>
        <label style={styles.label}>
          Colour
          <input
            aria-label="Background colour"
            type="color"
            value={color}
            onChange={(e) => setColor(e.target.value)}
            style={{ ...styles.input, padding: 0, height: 26 }}
          />
        </label>
      </div>
      <button type="submit" disabled={!valid}>
        Create blank map
      </button>
    </form>
  );
}

export function MapPanel({
  store,
  db,
  actions,
  importFiles,
  importError,
  importing,
}: MapPanelProps) {
  const maps = useTableStore((s) => s.shared.maps, store);
  const activeMapId = useTableStore((s) => s.shared.activeMapId, store);
  const [blankOpen, setBlankOpen] = useState(false);

  const onPick = (e: ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files ? [...e.target.files] : [];
    e.target.value = "";
    if (files.length > 0) importFiles(files);
  };

  return (
    <section data-testid="map-panel">
      <h2 style={styles.heading}>Maps</h2>
      {maps.length === 0 ? (
        <p data-testid="map-list-empty" style={{ color: "#666", fontSize: 13 }}>
          No maps yet. Import an image or create a blank map.
        </p>
      ) : (
        <ul data-testid="map-list" style={styles.list}>
          {maps.map((map) => (
            <MapItem
              key={map.id}
              db={db}
              map={map}
              active={map.id === activeMapId}
              actions={actions}
            />
          ))}
        </ul>
      )}

      <label style={{ ...styles.label, marginBottom: 8 }}>
        Import image (PNG, JPEG, WebP)
        <input
          data-testid="map-file-input"
          aria-label="Import map image"
          type="file"
          accept="image/png,image/jpeg,image/webp"
          multiple
          onChange={onPick}
          disabled={importing}
        />
      </label>
      {importing && (
        <p data-testid="map-importing" style={{ color: "#aaa", fontSize: 12 }}>
          Importing…
        </p>
      )}
      {importError && (
        <p data-testid="map-import-error" role="alert" style={styles.error}>
          {importError}
        </p>
      )}

      <button
        type="button"
        data-testid="blank-map-disclosure"
        aria-expanded={blankOpen}
        aria-controls="blank-map-form"
        onClick={() => setBlankOpen((open) => !open)}
        style={styles.disclosure}
      >
        {blankOpen ? "▾" : "▸"} New blank map
      </button>
      {blankOpen && (
        <div id="blank-map-form">
          <BlankMapForm actions={actions} />
        </div>
      )}
    </section>
  );
}
