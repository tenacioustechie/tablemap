/** DM view — full editing UI. Must never be imported by src/player/. */
import { useCallback, useMemo, useState, type CSSProperties, type DragEvent } from "react";
import { Link } from "react-router-dom";
import { getDb, type TableMapDb } from "../state/db";
import type { AssetSource } from "../state/dmSync";
import {
  createMapActions,
  type MapActions,
  type MeasureImage,
} from "../state/mapActions";
import { getAsset } from "../state/persistence";
import { tableStore, useTableStore, type TableStore } from "../state/store";
import type { TransportFactory } from "../state/transport";
import { DmCanvas } from "./DmCanvas";
import { MapPanel } from "./MapPanel";
import type { PlayerWindowController } from "./playerWindow";
import { useDmSync } from "./useDmSync";
import { useMapImport } from "./useMapImport";
import { usePlayerWindow } from "./usePlayerWindow";

const SIDEBAR_WIDTH = 260;

const styles = {
  root: {
    display: "grid",
    gridTemplateRows: "auto 1fr",
    gridTemplateColumns: `${SIDEBAR_WIDTH}px 1fr`,
    height: "100vh",
    overflow: "hidden",
    position: "relative",
  },
  toolbar: {
    gridColumn: "1 / -1",
    display: "flex",
    alignItems: "center",
    gap: 12,
    padding: "8px 12px",
    borderBottom: "1px solid #333",
    background: "#1a1a1a",
  },
  sidebar: {
    padding: 12,
    borderRight: "1px solid #333",
    background: "#161616",
    overflowY: "auto",
  },
  canvas: {
    position: "relative",
    background: "#0d0d0d",
    overflow: "hidden",
  },
  dropOverlay: {
    position: "absolute",
    inset: 0,
    display: "grid",
    placeItems: "center",
    background: "rgba(20, 60, 100, 0.6)",
    border: "3px dashed #8cf",
    color: "#fff",
    fontSize: 24,
    pointerEvents: "none",
    zIndex: 10,
  },
  status: { marginLeft: "auto", color: "#aaa", fontSize: 14 },
  hint: { color: "#fc6", fontSize: 13 },
  field: { display: "grid", gap: 4, marginBottom: 16, fontSize: 13 },
  input: {
    padding: "6px 8px",
    background: "#0d0d0d",
    color: "#eee",
    border: "1px solid #444",
    borderRadius: 4,
  },
} satisfies Record<string, CSSProperties>;

export interface DmViewProps {
  /** Injected in tests; the real app creates a browser-backed controller. */
  playerWindow?: PlayerWindowController;
  /** Injected in tests; the real app uses the app-wide store. */
  store?: TableStore;
  /** Injected in tests; the real app uses the app-wide database. */
  db?: TableMapDb;
  /** Injected in tests; the real app uses a BroadcastChannel. */
  createTransport?: TransportFactory;
  /** Injected in tests (no image decoding under jsdom). */
  measureImage?: MeasureImage;
  /** Injected in tests to observe or fake map actions. */
  mapActions?: MapActions;
}

function hasFiles(e: DragEvent): boolean {
  return Array.from(e.dataTransfer?.types ?? []).includes("Files");
}

export function DmView({
  playerWindow,
  store = tableStore,
  db = getDb(),
  createTransport,
  measureImage,
  mapActions,
}: DmViewProps) {
  const pw = usePlayerWindow(playerWindow);
  const assetSource = useMemo<AssetSource>(
    () => async (id) => {
      const record = await getAsset(db, id);
      return record ? { kind: record.kind, blob: record.blob } : undefined;
    },
    [db]
  );
  useDmSync(store, createTransport, assetSource);
  const actions = useMemo(
    () => mapActions ?? createMapActions(store, db, { measureImage }),
    [mapActions, store, db, measureImage]
  );
  const { importFiles, importing, error: importError } = useMapImport(actions);
  const campaignName = useTableStore((s) => s.shared.campaignName, store);
  const dispatch = useTableStore((s) => s.dispatch, store);
  const [dragging, setDragging] = useState(false);

  const onDragOver = useCallback((e: DragEvent) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
    setDragging(true);
  }, []);
  const onDragLeave = useCallback((e: DragEvent) => {
    // Leaving to a child fires dragleave too; only clear when leaving the root.
    if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
    setDragging(false);
  }, []);
  const onDrop = useCallback(
    (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      setDragging(false);
      const files = Array.from(e.dataTransfer.files);
      if (files.length > 0) void importFiles(files);
    },
    [importFiles]
  );

  const statusText = !pw.status.open
    ? "closed"
    : pw.status.fullscreen
      ? "fullscreen"
      : "open";

  return (
    <div
      data-testid="dm-view"
      data-dragging={dragging ? "true" : "false"}
      style={styles.root}
      onDragOver={onDragOver}
      onDragEnter={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      {dragging && (
        <div data-testid="drop-overlay" style={styles.dropOverlay}>
          Drop image to import a map
        </div>
      )}
      <header data-testid="dm-controls" style={styles.toolbar}>
        <Link to="/" style={{ color: "#8cf" }}>
          TableMap
        </Link>
        <strong>DM view</strong>
        <button type="button" onClick={pw.open}>
          Open player view
        </button>
        <button
          type="button"
          onClick={() => void pw.toggleFullscreen()}
          disabled={!pw.status.open}
        >
          {pw.status.fullscreen
            ? "Exit player fullscreen"
            : "Fullscreen player view"}
        </button>
        <button type="button" onClick={pw.close} disabled={!pw.status.open}>
          Close player view
        </button>
        {pw.lastFullscreenResult === "denied" && (
          <span data-testid="fullscreen-hint" style={styles.hint}>
            Browser blocked fullscreen from here. Press F in the player window.
          </span>
        )}
        <span data-testid="player-window-status" style={styles.status}>
          Player view: {statusText}
        </span>
      </header>

      <aside data-testid="dm-sidebar" style={styles.sidebar}>
        <h2 style={{ fontSize: 14, margin: "0 0 8px", color: "#aaa" }}>
          Campaign
        </h2>
        <label style={styles.field}>
          <span style={{ color: "#aaa" }}>Campaign name</span>
          <input
            data-testid="campaign-name-input"
            type="text"
            value={campaignName}
            placeholder="Shown on the player screen"
            onChange={(e) =>
              dispatch({ kind: "campaign/set-name", name: e.target.value })
            }
            style={styles.input}
          />
        </label>
        <MapPanel
          store={store}
          db={db}
          actions={actions}
          importFiles={importFiles}
          importError={importError}
          importing={importing}
        />
        <h2 style={{ fontSize: 14, margin: "16px 0 8px", color: "#aaa" }}>
          Tools
        </h2>
        <p style={{ color: "#666", fontSize: 13 }}>
          Fog, grid alignment, tokens and annotations arrive in later tasks.
        </p>
      </aside>

      <section data-testid="dm-canvas" style={styles.canvas}>
        <DmCanvas store={store} db={db} />
      </section>
    </div>
  );
}
