/** DM view — full editing UI. Must never be imported by src/player/. */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent,
} from "react";
import { nanoid } from "nanoid";
import { Link } from "react-router-dom";
import { bakeFogMask, rotateFogMask } from "../map/fogMask";
import type { Point } from "../map/viewport";
import type { NewWallSegment } from "../map/wallGesture";
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
import type { RotationDegrees } from "../state/sceneRotation";
import { createSplashActions, type SplashActions } from "../state/splashActions";
import { tableStore, useTableStore, type TableStore } from "../state/store";
import { createTokenActions, type TokenActions } from "../state/tokenActions";
import type { TokenPoint } from "../state/tokens";
import type { TransportFactory } from "../state/transport";
import { createVisionActions, type VisionActions } from "../state/visionActions";
import { createDoor, createWall, findWall, patchWall, type WallKind } from "../state/walls";
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
  type WallFocus,
  type WallToolProps,
} from "./DmCanvas";
import { FogPanel } from "./FogPanel";
import { TokenPanel } from "./TokenPanel";
import {
  DEFAULT_FOG_TOOL_SETTINGS,
  fogFeatherPx,
  fogToolFeathers,
  stepBrushRadius,
  type FogToolKind,
  type FogToolSettings,
} from "./fogTool";
import { GridPanel } from "./GridPanel";
import { InitiativePanel } from "./InitiativePanel";
import { MapPanel } from "./MapPanel";
import type { PlayerWindowController } from "./playerWindow";
import { ShortcutHelp } from "./ShortcutHelp";
import { isEditableTarget, shortcutFor, shortcutKeyFor, type ShortcutCommand } from "./shortcuts";
import {
  SidebarTabs,
  useRememberedSidebar,
  useRememberedTab,
  type DmTabId,
  type TabStorage,
} from "./SidebarTabs";
import { describeCalibration, describeTool, toolAfterTabChange, type DmTool } from "./toolStatus";
import { useDmSync } from "./useDmSync";
import { useMapImport } from "./useMapImport";
import { usePlayerWindow } from "./usePlayerWindow";
import type { WallEnd } from "./WallLayer";
import { WallsPanel } from "./WallsPanel";
import { DEFAULT_WALL_TOOL_SETTINGS, type WallToolSettings } from "./wallTool";

export type { DmTool } from "./toolStatus";

/** Sidebar width (T019): 300 px open, a strip of tab initials when collapsed. */
export const SIDEBAR_WIDTH = 300;
export const SIDEBAR_COLLAPSED_WIDTH = 44;

const styles = {
  root: {
    display: "grid",
    gridTemplateRows: "auto 1fr",
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
  toolStatusKey: {
    display: "inline-block",
    padding: "0 5px",
    border: "1px solid #fc6",
    borderRadius: 3,
    fontSize: 11,
    lineHeight: "16px",
    font: "inherit",
  },
  helpButton: {
    minWidth: 28,
    fontWeight: "bold",
  },
  mapName: {
    maxWidth: 220,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    color: "#eee",
    fontSize: 14,
  },
  mapNameNone: { color: "#888", fontStyle: "italic" },
  calibrationChip: {
    padding: "2px 10px",
    borderRadius: 14,
    background: "#102a1a",
    border: "1px solid #6c6",
    color: "#8f8",
    font: "inherit",
    fontSize: 13,
    cursor: "pointer",
  },
  calibrationChipOff: {
    background: "#222",
    border: "1px solid #555",
    color: "#aaa",
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
  /** Injected in tests; the real app reveals through the fog actions (so reveals compact). */
  visionActions?: VisionActions;
  /** Injected in tests to fix ids and timestamps; annotations touch no storage. */
  annotationActions?: AnnotationActions;
  /** Where the chosen sidebar tab and the sidebar's collapsed state are remembered; the real app uses `localStorage`. */
  tabStorage?: TabStorage | null;
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
  calibrationSession,
  fogActions,
  fogHistory,
  splashActions,
  tokenActions,
  visionActions,
  annotationActions,
  tabStorage,
}: DmViewProps) {
  const pw = usePlayerWindow(playerWindow);
  // The sidebar tab is DM-window UI state (T016): remembered per browser,
  // never in the store. A tab the DM picks (a tab click, a tab key, the
  // chips) puts down any armed tool that belongs to another tab and drops
  // a wall / door selection when leaving Walls (ADR 0028); a tool key arms
  // its tool and opens its own tab, so it never disarms itself. So is
  // the sidebar's collapsed state (T019); an explicit tab choice (a tab
  // key, the chips) expands it, a tool key only records the tab.
  const [tab, setTab] = useRememberedTab(tabStorage);
  const [sidebarCollapsed, setSidebarCollapsed] = useRememberedSidebar(tabStorage);
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
    () => mapActions ?? createMapActions(store, db, { measureImage, rotateFogMask }),
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
  // Vision (T106, ADR 0026): a seeing token's drop, a vision given to a
  // token and a door toggle reveal what the tokens see, through the fog
  // actions — one dispatch per trigger, so one undo step. The canvas
  // previews it while a token is dragged.
  const vision = useMemo(
    () => visionActions ?? createVisionActions(store, { apply: fog.apply }),
    [visionActions, store, fog]
  );
  useEffect(() => vision.start(), [vision]);
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

  // Table overrides (T009): DM-only presentation flags the sync layer pushes
  // to the player the moment they change — as is the turn strip (T111).
  const blackout = useTableStore((s) => s.presentation.blackout, store);
  const splashOn = useTableStore((s) => s.presentation.splash, store);
  const initiativeStrip = useTableStore((s) => s.presentation.initiativeStrip, store);
  const setPresentation = useTableStore((s) => s.setPresentation, store);
  // Session facts in the toolbar (T019): the shown map and the calibration.
  const displayCalibration = useTableStore((s) => s.presentation.calibration, store);
  const cellUnit = useTableStore((s) => s.presentation.cellUnit, store);
  const calibrationLabel = describeCalibration(displayCalibration, cellUnit);

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
  // Map rotation (T017): a document change to the shown map. Whatever tool
  // is armed is put down first — its gesture would be in the old coordinates.
  const rotateMap = useCallback(
    (degrees: RotationDegrees) => {
      if (activeSceneId === null) return Promise.resolve(false);
      setTool("none");
      return actions.rotate(activeSceneId, degrees);
    },
    [activeSceneId, actions]
  );
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
  // gesture and hands back a shape, which becomes one fog op here. The room
  // fill (T108) hands back its room as whole cells (never feathered), or
  // reports that it reached too many cells: the panel warns until the next
  // fill that commits, a tool change or a map switch.
  const fogging = tool === "fog";
  const [fillWarning, setFillWarning] = useState(false);
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
  useEffect(() => {
    setFillWarning(false);
  }, [activeSceneId, fogging, fogSettings.tool]);
  const cellSize = activeScene?.grid.cellSize ?? 0;
  const fogTool = useMemo<FogToolProps | undefined>(
    () =>
      fogging && activeSceneId !== null
        ? {
            settings: fogSettings,
            onShape: (shape: FogShape) => {
              const feather = fogToolFeathers(fogSettings) ? fogFeatherPx(cellSize) : undefined;
              if (fogSettings.mode === "reveal") fog.reveal(activeSceneId, shape, feather);
              else fog.hide(activeSceneId, shape, feather);
              if (fogSettings.tool === "fill") setFillWarning(false);
            },
            onFillTooLarge: () => setFillWarning(true),
            onCancel: () => setTool("none"),
          }
        : undefined,
    [fogging, activeSceneId, fogSettings, cellSize, fog]
  );

  // Tokens (T010): the selection is DM UI state; it follows the active map
  // and clears itself when the token is gone. Dragging on the canvas ends
  // in one `map/token-update` through the actions (clamped + snapped); for
  // a seeing token the vision actions then reveal what it sees (T106).
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

  // Walls and doors (T102, ADR 0025): the tool settings are DM-only UI
  // state; the canvas runs the gesture and hands back segments, each one
  // `map/wall-set` here. The selection is DM UI state like a token's: it
  // follows the active map, clears when the segment is gone or a tool is
  // armed, and Delete / Backspace remove it. Nothing here is undoable.
  // Doors in play (T103): a click on a door (canvas or panel) is one
  // `map/door-set-open`; the panel's list also selects a door and asks the
  // canvas to centre on it (`wallFocus`).
  const wallsOn = tool === "wall";
  const [wallSettings, setWallSettings] = useState<WallToolSettings>(DEFAULT_WALL_TOOL_SETTINGS);
  const patchWallSettings = useCallback((patch: Partial<WallToolSettings>) => {
    setWallSettings((s) => ({ ...s, ...patch }));
  }, []);
  const selectWallTool = useCallback(
    (kind: WallKind) => {
      if (activeSceneId === null) return;
      setWallSettings((s) => ({ ...s, tool: kind }));
      setTool((t) => (t === "wall" && wallSettings.tool === kind ? "none" : "wall"));
    },
    [activeSceneId, wallSettings.tool]
  );
  const stopWallTool = useCallback(() => setTool("none"), []);
  const [selectedWallId, setSelectedWallId] = useState<string | null>(null);
  useEffect(() => {
    setSelectedWallId(null);
  }, [activeSceneId]);
  useEffect(() => {
    if (tool !== "none") setSelectedWallId(null);
  }, [tool]);
  // A tab the DM chose (ADR 0028): see the note at `useRememberedTab`.
  const changeTab = useCallback(
    (id: DmTabId) => {
      setTab(id);
      setTool((t) => toolAfterTabChange(t, id));
      if (id !== "walls") setSelectedWallId(null);
    },
    [setTab]
  );
  const selectTab = useCallback(
    (id: DmTabId) => {
      changeTab(id);
      setSidebarCollapsed(false);
    },
    [changeTab, setSidebarCollapsed]
  );
  const selectedWall =
    selectedWallId !== null && activeScene?.walls.some((w) => w.id === selectedWallId)
      ? selectedWallId
      : null;
  const removeWall = useCallback(
    (id: string) => {
      if (activeSceneId === null) return;
      dispatch({ kind: "map/wall-remove", id: activeSceneId, segmentId: id });
      setSelectedWallId((s) => (s === id ? null : s));
    },
    [activeSceneId, dispatch]
  );
  const toggleDoor = useCallback(
    (id: string) => {
      if (activeSceneId === null) return;
      const segment = findWall(activeMap(store.getState().shared), id);
      if (!segment || segment.kind !== "door") return;
      dispatch({ kind: "map/door-set-open", id: activeSceneId, segmentId: id, open: !segment.open });
    },
    [activeSceneId, dispatch, store]
  );
  const [wallFocus, setWallFocus] = useState<WallFocus | undefined>(undefined);
  useEffect(() => {
    setWallFocus(undefined);
  }, [activeSceneId]);
  const focusWall = useCallback((id: string) => {
    setSelectedWallId(id);
    setWallFocus((f) => ({ id, nonce: (f?.nonce ?? 0) + 1 }));
  }, []);
  const wallTool = useMemo<WallToolProps | undefined>(
    () =>
      activeSceneId !== null
        ? {
            drawing: wallsOn,
            settings: wallSettings,
            selectedId: selectedWall,
            onSegment: ({ kind, ...ends }: NewWallSegment) =>
              dispatch({
                kind: "map/wall-set",
                id: activeSceneId,
                segment:
                  kind === "door"
                    ? createDoor({ id: nanoid(), ...ends })
                    : createWall({ id: nanoid(), ...ends }),
              }),
            onSelect: (id: string | null) => setSelectedWallId(id),
            onMoveEndpoint: (id: string, end: WallEnd, point: Point) => {
              const existing = findWall(activeMap(store.getState().shared), id);
              if (!existing) return;
              const next = patchWall(
                existing,
                end === "start" ? { x1: point.x, y1: point.y } : { x2: point.x, y2: point.y }
              );
              if (next !== existing) dispatch({ kind: "map/wall-set", id: activeSceneId, segment: next });
            },
            onToggleDoor: toggleDoor,
            focus: wallFocus,
            onCancel: () => setTool("none"),
          }
        : undefined,
    [activeSceneId, wallsOn, wallSettings, selectedWall, dispatch, store, toggleDoor, wallFocus]
  );
  useEffect(() => {
    if (selectedWall === null) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Delete" && e.key !== "Backspace") return;
      if (e.ctrlKey || e.metaKey || e.altKey || isEditableTarget(e.target)) return;
      e.preventDefault();
      removeWall(selectedWall);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selectedWall, removeWall]);

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

  // Single-key shortcuts (T018, ADR 0022): the pure keymap in `shortcuts.ts`
  // names a command; this turns it into the tool / tab calls above. A fog or
  // draw key *arms* its tool (it never toggles it off — that is V or Esc)
  // and opens the tool's tab. Tool commands need a map, like the buttons.
  // The turn keys (T110) are one `initiative/next` / `initiative/prev` each,
  // and only while the Turns tab is the chosen one (folded sidebar or not);
  // on any other tab they are not taken at all.
  const [helpOpen, setHelpOpen] = useState(false);
  const runShortcut = useCallback(
    (command: ShortcutCommand) => {
      switch (command.kind) {
        case "help":
          setHelpOpen((open) => !open);
          return;
        case "tab":
          selectTab(command.tab);
          return;
        case "turn":
          dispatch({ kind: command.direction === 1 ? "initiative/next" : "initiative/prev" });
          return;
        case "stop":
          setTool("none");
          return;
        case "brush-radius":
          setFogSettings((s) => ({ ...s, radius: stepBrushRadius(s.radius, command.direction) }));
          return;
      }
      if (activeSceneId === null) return;
      switch (command.kind) {
        case "fog-mode":
          setFogSettings((s) => ({ ...s, mode: command.mode }));
          setTool("fog");
          setTab("fog");
          return;
        case "fog-tool":
          setFogSettings((s) => ({ ...s, tool: command.tool }));
          setTool("fog");
          setTab("fog");
          return;
        case "draw-mode":
          setDrawSettings((s) => ({ ...s, mode: command.mode }));
          setTool("draw");
          setTab("draw");
          return;
        case "note":
          setTool("note");
          setTab("draw");
          return;
        case "align":
          setTool("align");
          setTab("maps");
          return;
        case "wall-tool":
          setWallSettings((s) => ({ ...s, tool: command.tool }));
          setTool("wall");
          setTab("walls");
          return;
      }
    },
    [activeSceneId, setTab, selectTab, dispatch]
  );
  const helpOpenRef = useRef(helpOpen);
  helpOpenRef.current = helpOpen;
  const tabRef = useRef(tab);
  tabRef.current = tab;
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const command = shortcutFor(e);
      if (!command) return;
      // The open cheat sheet takes only its own key; nothing arms behind it.
      if (helpOpenRef.current && command.kind !== "help") return;
      if (command.kind === "turn" && tabRef.current !== "turns") return;
      e.preventDefault();
      runShortcut(command);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [runShortcut]);
  useEffect(() => {
    // Esc closes the cheat sheet and nothing else: this runs in the capture
    // phase on the document, ahead of the tools' own Esc listeners on the
    // window, and stops the event there.
    if (!helpOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      setHelpOpen(false);
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [helpOpen]);
  const closeHelp = useCallback(() => setHelpOpen(false), []);
  const toggleHelp = useCallback(() => setHelpOpen((open) => !open), []);

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
  const toolStatus = describeTool(tool, fogSettings, drawSettings, wallSettings);
  const stopTool = useCallback(() => setTool("none"), []);
  const sidebarWidth = sidebarCollapsed ? SIDEBAR_COLLAPSED_WIDTH : SIDEBAR_WIDTH;

  return (
    <div
      data-testid="dm-view"
      data-dragging={dragging ? "true" : "false"}
      data-sidebar={sidebarCollapsed ? "collapsed" : "expanded"}
      style={{ ...styles.root, gridTemplateColumns: `${sidebarWidth}px 1fr` }}
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
        <button
          type="button"
          data-testid="initiative-strip-toggle"
          aria-pressed={initiativeStrip}
          title="Show the initiative order along the top of the TV"
          style={initiativeStrip ? styles.pressed : undefined}
          onClick={() => setPresentation({ initiativeStrip: !initiativeStrip })}
        >
          Turn strip
        </button>
        <span style={styles.divider} />
        <span
          data-testid="active-map-name"
          data-map-id={activeScene?.id ?? ""}
          title={activeScene ? `Shown on the TV: ${activeScene.name}` : "No map is shown on the TV"}
          style={activeScene ? styles.mapName : { ...styles.mapName, ...styles.mapNameNone }}
        >
          {activeScene ? activeScene.name : "No map shown"}
        </span>
        <button
          type="button"
          data-testid="calibration-chip"
          data-calibrated={displayCalibration ? "true" : "false"}
          title="Open the Table tab"
          onClick={() => selectTab("table")}
          style={
            displayCalibration
              ? styles.calibrationChip
              : { ...styles.calibrationChip, ...styles.calibrationChipOff }
          }
        >
          {calibrationLabel}
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
              onClick={() => selectTab(toolStatus.tab)}
              style={styles.toolStatusName}
            >
              {toolStatus.label}
            </button>
            {toolStatus.key !== null && (
              <kbd
                data-testid="tool-status-key"
                title={`Press ${toolStatus.key} to arm this tool`}
                style={styles.toolStatusKey}
              >
                {toolStatus.key}
              </kbd>
            )}
            <button type="button" data-testid="tool-stop" onClick={stopTool}>
              Stop (Esc)
            </button>
          </span>
        )}
        <button
          type="button"
          data-testid="shortcut-help-button"
          aria-label="Keyboard shortcuts"
          aria-pressed={helpOpen}
          title={`Keyboard shortcuts (${shortcutKeyFor({ kind: "help" }) ?? "?"})`}
          onClick={toggleHelp}
          style={styles.helpButton}
        >
          ?
        </button>
        <span data-testid="player-window-status" style={styles.status}>
          Player view: {statusText}
        </span>
      </header>
      {helpOpen && <ShortcutHelp onClose={closeHelp} />}

      <aside
        data-testid="dm-sidebar"
        data-collapsed={sidebarCollapsed ? "true" : "false"}
        style={{ ...styles.sidebar, width: sidebarWidth }}
      >
        <SidebarTabs
          active={tab}
          onSelect={changeTab}
          collapsed={sidebarCollapsed}
          onCollapsedChange={setSidebarCollapsed}
        >
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
                onRotate={rotateMap}
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
              fillWarning={fillWarning}
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
          {tab === "turns" && <InitiativePanel store={store} />}
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
          {tab === "walls" && (
            <WallsPanel
              store={store}
              settings={wallSettings}
              onSettingsChange={patchWallSettings}
              active={wallsOn}
              onSelectTool={selectWallTool}
              onStop={stopWallTool}
              selectedId={selectedWall}
              onDelete={removeWall}
              onToggleDoor={toggleDoor}
              onFocus={focusWall}
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
          walls={wallTool}
        />
      </section>
    </div>
  );
}
