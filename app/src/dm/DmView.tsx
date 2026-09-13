/** DM view — full editing UI. Must never be imported by src/player/. */
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type DragEvent,
} from "react";
import { Link } from "react-router-dom";
import { bakeFogMask } from "../map/fogMask";
import type { Point } from "../map/viewport";
import {
  createAnnotationActions,
  type AnnotationActions,
} from "../state/annotationActions";
import {
  createCalibrationSession,
  type CalibrationSession,
} from "../state/calibrationSession";
import { getDb, type TableMapDb } from "../state/db";
import type { AssetSource } from "../state/dmSync";
import type { FogShape } from "../state/fog";
import { createFogActions, type FogActions } from "../state/fogActions";
import { createFogHistory, type FogHistory } from "../state/fogHistory";
import {
  createMapActions,
  type MapActions,
  type MeasureImage,
} from "../state/mapActions";
import { activeMap } from "../state/maps";
import type { GridGeometry } from "../state/model";
import { getAsset } from "../state/persistence";
import { createSplashActions, type SplashActions } from "../state/splashActions";
import { tableStore, useTableStore, type TableStore } from "../state/store";
import { createTokenActions, type TokenActions } from "../state/tokenActions";
import type { TokenPoint } from "../state/tokens";
import type { TransportFactory } from "../state/transport";
import type { TokenTool } from "../map/TokenLayer";
import { AnnotationPanel } from "./AnnotationPanel";
import { DEFAULT_DRAW_TOOL_SETTINGS, type DrawMode, type DrawToolSettings } from "./annotationTool";
import { CalibrationPanel } from "./CalibrationPanel";
import { PlayerViewPanel } from "./PlayerViewPanel";
import {
  DmCanvas,
  type AlignmentProps,
  type DrawToolProps,
  type FogToolProps,
  type NoteToolProps,
} from "./DmCanvas";
import { FogPanel } from "./FogPanel";
import { TokenPanel } from "./TokenPanel";
import {
  DEFAULT_FOG_TOOL_SETTINGS,
  fogFeatherPx,
  type FogToolKind,
  type FogToolSettings,
} from "./fogTool";
import { GridPanel } from "./GridPanel";
import { MapPanel } from "./MapPanel";
import type { PlayerWindowController } from "./playerWindow";
import { SidebarTabs, useRememberedTab, type TabStorage } from "./SidebarTabs";
import { describeTool, type DmTool } from "./toolStatus";
import { useDmSync } from "./useDmSync";
import { useMapImport } from "./useMapImport";
import { usePlayerWindow } from "./usePlayerWindow";

export type { DmTool } from "./toolStatus";

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
    flexWrap: "wrap",
    alignItems: "center",
    gap: 12,
    padding: "8px 12px",
    borderBottom: "1px solid #333",
    background: "#1a1a1a",
  },
  sidebar: {
    minHeight: 0,
    borderRight: "1px solid #333",
    background: "#161616",
    overflow: "hidden",
  },
  toolStatus: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    padding: "2px 4px 2px 10px",
    borderRadius: 14,
    background: "#2a2510",
    border: "1px solid #fc6",
    color: "#fc6",
    fontSize: 13,
  },
  toolStatusName: {
    background: "none",
    border: "none",
    color: "inherit",
    font: "inherit",
    padding: 0,
    cursor: "pointer",
    textDecoration: "underline dotted",
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
  divider: { width: 1, alignSelf: "stretch", background: "#333" },
  pressed: { background: "#402020", color: "#fbb", border: "1px solid #f88" },
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
  /** Injected in tests; the real app persists calibration in the database. */
  calibrationSession?: CalibrationSession;
  /** Injected in tests; the real app bakes compacted fog masks on a canvas. */
  fogActions?: FogActions;
  /** Injected in tests; the real app keeps redo stacks over the app store. */
  fogHistory?: FogHistory;
  /** Injected in tests; the real app stores the splash image in the database. */
  splashActions?: SplashActions;
  /** Injected in tests; the real app stores token images in the database. */
  tokenActions?: TokenActions;
  /** Injected in tests to fix ids and timestamps; annotations touch no storage. */
  annotationActions?: AnnotationActions;
  /** Where the chosen sidebar tab is remembered; the real app uses `localStorage`. */
  tabStorage?: TabStorage | null;
}

function hasFiles(e: DragEvent): boolean {
  return Array.from(e.dataTransfer?.types ?? []).includes("Files");
}

/** Keyboard shortcuts must not steal keys from text fields. */
function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable;
}

export function DmView({
  playerWindow,
  store = tableStore,
  db = getDb(),
  createTransport,
  measureImage,
  mapActions,
  calibrationSession,
  fogActions,
  fogHistory,
  splashActions,
  tokenActions,
  annotationActions,
  tabStorage,
}: DmViewProps) {
  const pw = usePlayerWindow(playerWindow);
  // The sidebar tab is DM-window UI state (T016): remembered per browser,
  // never in the store. Switching it never touches the armed tool.
  const [tab, setTab] = useRememberedTab(tabStorage);
  const calibration = useMemo(
    () => calibrationSession ?? createCalibrationSession(store, db),
    [calibrationSession, store, db]
  );
  useEffect(() => calibration.start(), [calibration]);
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
  const fog = useMemo(
    () => fogActions ?? createFogActions(store, db, { bake: bakeFogMask }),
    [fogActions, store, db]
  );
  const history = useMemo(
    () => fogHistory ?? createFogHistory(store, { apply: fog.apply }),
    [fogHistory, store, fog]
  );
  useEffect(() => history.start(), [history]);
  const splash = useMemo(
    () => splashActions ?? createSplashActions(store, db),
    [splashActions, store, db]
  );
  const tokens = useMemo(
    () => tokenActions ?? createTokenActions(store, db),
    [tokenActions, store, db]
  );
  const annotations = useMemo(
    () => annotationActions ?? createAnnotationActions(store),
    [annotationActions, store]
  );
  const campaignName = useTableStore((s) => s.shared.campaignName, store);
  const dispatch = useTableStore((s) => s.dispatch, store);
  const [dragging, setDragging] = useState(false);

  // Table overrides (T009): both are DM-only presentation flags the sync
  // layer pushes to the player the moment they change.
  const blackout = useTableStore((s) => s.presentation.blackout, store);
  const splashOn = useTableStore((s) => s.presentation.splash, store);
  const setPresentation = useTableStore((s) => s.setPresentation, store);

  // Canvas tools: toggled from the sidebar panels, run by the canvas. One at
  // a time; switching (or losing) the active map ends whichever is on.
  const activeScene = useTableStore((s) => activeMap(s.shared), store);
  const activeSceneId = activeScene?.id ?? null;
  const [tool, setTool] = useState<DmTool>("none");
  useEffect(() => {
    setTool("none");
  }, [activeSceneId]);
  const toggleTool = useCallback(
    (which: DmTool) => {
      if (activeSceneId !== null) setTool((t) => (t === which ? "none" : which));
    },
    [activeSceneId]
  );
  const aligning = tool === "align";
  const toggleAlign = useCallback(() => toggleTool("align"), [toggleTool]);
  const alignment = useMemo<AlignmentProps | undefined>(
    () =>
      aligning && activeScene
        ? {
            onAligned: (geometry: GridGeometry) => {
              actions.setGrid(activeScene.id, { ...activeScene.grid, ...geometry });
              setTool("none");
            },
            onCancel: () => setTool("none"),
          }
        : undefined,
    [aligning, activeScene, actions]
  );

  // Fog tools (T008): the settings are DM-only UI state; the canvas runs the
  // gesture and hands back a shape, which becomes one fog op here.
  const fogging = tool === "fog";
  const [fogSettings, setFogSettings] = useState<FogToolSettings>(DEFAULT_FOG_TOOL_SETTINGS);
  const patchFogSettings = useCallback((patch: Partial<FogToolSettings>) => {
    setFogSettings((s) => ({ ...s, ...patch }));
  }, []);
  const selectFogTool = useCallback(
    (kind: FogToolKind) => {
      if (activeSceneId === null) return;
      setFogSettings((s) => ({ ...s, tool: kind }));
      setTool((t) => (t === "fog" && fogSettings.tool === kind ? "none" : "fog"));
    },
    [activeSceneId, fogSettings.tool]
  );
  const stopFogTool = useCallback(() => setTool("none"), []);
  const cellSize = activeScene?.grid.cellSize ?? 0;
  const fogTool = useMemo<FogToolProps | undefined>(
    () =>
      fogging && activeSceneId !== null
        ? {
            settings: fogSettings,
            onShape: (shape: FogShape) => {
              const feather =
                fogSettings.feather && !fogSettings.snap ? fogFeatherPx(cellSize) : undefined;
              if (fogSettings.mode === "reveal") fog.reveal(activeSceneId, shape, feather);
              else fog.hide(activeSceneId, shape, feather);
            },
            onCancel: () => setTool("none"),
          }
        : undefined,
    [fogging, activeSceneId, fogSettings, cellSize, fog]
  );

  // Tokens (T010): the selection is DM UI state; it follows the active map
  // and clears itself when the token is gone. Dragging on the canvas ends
  // in one `map/token-update` through the actions (clamped + snapped).
  const [selectedTokenId, setSelectedTokenId] = useState<string | null>(null);
  useEffect(() => {
    setSelectedTokenId(null);
  }, [activeSceneId]);
  const selectedToken =
    selectedTokenId !== null && activeScene?.tokens.some((t) => t.id === selectedTokenId)
      ? selectedTokenId
      : null;
  const tokenTool = useMemo<TokenTool | undefined>(
    () =>
      activeSceneId !== null
        ? {
            selectedId: selectedToken,
            onSelect: (id: string) => setSelectedTokenId(id),
            onMove: (id: string, topLeft: TokenPoint) => tokens.move(activeSceneId, id, topLeft),
          }
        : undefined,
    [activeSceneId, selectedToken, tokens]
  );

  // Annotations (T011): the drawing settings are DM-only UI state; the canvas
  // runs the pen / eraser gesture and hands back strokes and eraser points.
  // Notes: the open popover's note id is UI state here (reset on a map
  // switch, ignored once the note is gone); placing is the `note` tool.
  const drawingOn = tool === "draw";
  const [drawSettings, setDrawSettings] = useState<DrawToolSettings>(DEFAULT_DRAW_TOOL_SETTINGS);
  const patchDrawSettings = useCallback((patch: Partial<DrawToolSettings>) => {
    setDrawSettings((s) => ({ ...s, ...patch }));
  }, []);
  const selectDrawMode = useCallback(
    (mode: DrawMode) => {
      if (activeSceneId === null) return;
      setDrawSettings((s) => ({ ...s, mode }));
      setTool((t) => (t === "draw" && drawSettings.mode === mode ? "none" : "draw"));
    },
    [activeSceneId, drawSettings.mode]
  );
  const stopAnnotationTool = useCallback(() => setTool("none"), []);
  const drawTool = useMemo<DrawToolProps | undefined>(
    () =>
      drawingOn && activeSceneId !== null
        ? {
            settings: drawSettings,
            onStroke: (points: number[]) =>
              annotations.addDrawing(activeSceneId, {
                points,
                color: drawSettings.color,
                strokeWidth: drawSettings.strokeWidth,
                visibility: drawSettings.visibility,
              }),
            onErase: (point: Point, radius: number) =>
              annotations.erase(activeSceneId, point, radius),
            onCancel: () => setTool("none"),
          }
        : undefined,
    [drawingOn, activeSceneId, drawSettings, annotations]
  );

  const placingNote = tool === "note";
  const toggleNoteTool = useCallback(() => toggleTool("note"), [toggleTool]);
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null);
  useEffect(() => {
    setSelectedNoteId(null);
  }, [activeSceneId]);
  const selectedNote =
    selectedNoteId !== null &&
    activeScene?.annotations.some((a) => a.kind === "note" && a.id === selectedNoteId)
      ? selectedNoteId
      : null;
  const noteTool = useMemo<NoteToolProps | undefined>(
    () =>
      activeSceneId !== null
        ? {
            placing: placingNote,
            selectedId: selectedNote,
            onPlace: (point: Point) => {
              const note = annotations.addNote(activeSceneId, point);
              setTool("none");
              setSelectedNoteId(note?.id ?? null);
            },
            onSelect: (id: string | null) => setSelectedNoteId(id),
            onMove: (id: string, point: Point) =>
              annotations.updateNote(activeSceneId, id, { x: point.x, y: point.y }),
            onTextChange: (id: string, text: string) =>
              annotations.updateNote(activeSceneId, id, { text }),
            onDelete: (id: string) => {
              annotations.remove(activeSceneId, id);
              setSelectedNoteId((s) => (s === id ? null : s));
            },
            onCancel: () => setTool("none"),
          }
        : undefined,
    [activeSceneId, placingNote, selectedNote, annotations]
  );
  const onPing = useCallback(
    (point: Point) => {
      if (activeSceneId !== null) annotations.ping(activeSceneId, point);
    },
    [activeSceneId, annotations]
  );

  // Undo / redo shortcuts for the fog log: Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z or Ctrl/Cmd+Y.
  useEffect(() => {
    if (activeSceneId === null) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || isEditableTarget(e.target)) return;
      const key = e.key.toLowerCase();
      if (key === "z") {
        e.preventDefault();
        if (e.shiftKey) history.redo(activeSceneId);
        else history.undo(activeSceneId);
      } else if (key === "y") {
        e.preventDefault();
        history.redo(activeSceneId);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [activeSceneId, history]);

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
  const toolStatus = describeTool(tool, fogSettings, drawSettings);
  const stopTool = useCallback(() => setTool("none"), []);

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
        <span style={styles.divider} />
        <button
          type="button"
          data-testid="blackout-toggle"
          aria-pressed={blackout}
          style={blackout ? styles.pressed : undefined}
          onClick={() => setPresentation({ blackout: !blackout })}
        >
          {blackout ? "End blackout" : "Blackout"}
        </button>
        <button
          type="button"
          data-testid="splash-toggle"
          aria-pressed={splashOn}
          style={splashOn ? styles.pressed : undefined}
          onClick={() => setPresentation({ splash: !splashOn })}
        >
          {splashOn ? "Hide splash" : "Show splash"}
        </button>
        {toolStatus && (
          <span
            data-testid="tool-status"
            data-tool={tool}
            data-tab={toolStatus.tab}
            style={styles.toolStatus}
          >
            <button
              type="button"
              data-testid="tool-status-name"
              title="Open the tool's tab"
              onClick={() => setTab(toolStatus.tab)}
              style={styles.toolStatusName}
            >
              {toolStatus.label}
            </button>
            <button type="button" data-testid="tool-stop" onClick={stopTool}>
              Stop (Esc)
            </button>
          </span>
        )}
        <span data-testid="player-window-status" style={styles.status}>
          Player view: {statusText}
        </span>
      </header>

      <aside data-testid="dm-sidebar" style={styles.sidebar}>
        <SidebarTabs active={tab} onSelect={setTab}>
          {tab === "maps" && (
            <>
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
              <GridPanel
                store={store}
                actions={actions}
                aligning={aligning}
                onToggleAlign={toggleAlign}
              />
            </>
          )}
          {tab === "fog" && (
            <FogPanel
              store={store}
              actions={fog}
              history={history}
              settings={fogSettings}
              onSettingsChange={patchFogSettings}
              active={fogging}
              onSelectTool={selectFogTool}
              onStop={stopFogTool}
            />
          )}
          {tab === "tokens" && (
            <TokenPanel
              store={store}
              actions={tokens}
              selectedId={selectedToken}
              onSelect={setSelectedTokenId}
            />
          )}
          {tab === "draw" && (
            <AnnotationPanel
              store={store}
              actions={annotations}
              settings={drawSettings}
              onSettingsChange={patchDrawSettings}
              drawing={drawingOn}
              onSelectDraw={selectDrawMode}
              placingNote={placingNote}
              onToggleNoteTool={toggleNoteTool}
              onStop={stopAnnotationTool}
              selectedNoteId={selectedNote}
              onSelectNote={setSelectedNoteId}
            />
          )}
          {tab === "table" && (
            <>
              <CalibrationPanel store={store} session={calibration} />
              <PlayerViewPanel store={store} db={db} splash={splash} />
            </>
          )}
        </SidebarTabs>
      </aside>

      <section data-testid="dm-canvas" style={styles.canvas}>
        <DmCanvas
          store={store}
          db={db}
          alignment={alignment}
          fog={fogTool}
          tokens={tokenTool}
          draw={drawTool}
          notes={noteTool}
          onPing={onPing}
        />
      </section>
    </div>
  );
}
