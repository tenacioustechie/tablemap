/**
 * The DM's map canvas: the active scene on a Konva stage with free pan
 * (drag) and zoom (wheel), fitted to the container whenever the scene
 * changes.
 *
 * With `alignment` active, the canvas runs the grid alignment tool instead
 * of drag-pan: the DM drags across (or clicks the two opposite corners of)
 * one printed map square; the resulting cell size + offset go to
 * `alignment.onAligned`. Esc cancels. The interaction itself is the pure
 * state machine in `map/alignment.ts`; this component only feeds it pointer
 * events in map coordinates and draws the preview box.
 *
 * With `fog` active (T007, T008), presses run the fog gesture machine
 * (`map/fogGesture.ts`) for the chosen tool — brush, rectangle or lasso —
 * and each completed gesture becomes one shape in map pixels handed to
 * `fog.onShape` (the view turns it into a fog op). With snapping on, the
 * shape is expanded to whole grid cells first (`map/fogSnap.ts`), and the
 * preview shows the cells. The preview of a *reveal* punches through the
 * fog layer live (`fogOverlay`), so the DM sees the map appear under the
 * brush at 60 fps without the mask being touched until release; a *hide*
 * preview is a red tint. The tool stays on for the next gesture; Esc
 * abandons a gesture in progress, or leaves the tool when none is. The fog
 * base PNG for the active map is read from the database here (the player
 * gets it over the sync channel).
 *
 * The **player viewport rectangle** (T009) is always drawn: the map area the
 * player display shows (`map/playerView.ts`, from the store's presentation
 * and the display the player window reported — 1080p until one has). While
 * the player scale is locked to the calibration and no tool is running, the
 * rectangle is draggable; each drag move writes the new centre to the
 * store's presentation, which the sync layer pushes to the player at once.
 * A white bar marks the edge of the map that is at the top of the TV.
 *
 * **Tokens** (T010) are drawn by the stage's token layer; with no canvas
 * tool running, the `tokens` prop makes them draggable and selectable (the
 * drop position is clamped and snapped by the layer and reported through
 * `tokens.onMove`). The image Blobs of the active map's image tokens are
 * read from the database here (`useAssetBlobs`).
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import type Konva from "konva";
import type { KonvaEventObject } from "konva/lib/Node";
import { Circle, Group, Line, Rect, Shape, Text } from "react-konva";
import {
  ALIGN_CLICK_THRESHOLD_PX,
  alignmentBox,
  IDLE_ALIGNMENT,
  reduceAlignment,
  type AlignmentEvent,
  type AlignmentState,
} from "../map/alignment";
import {
  gestureShape,
  IDLE_FOG_GESTURE,
  reduceFogGesture,
  type FogGestureConfig,
  type FogGestureEvent,
  type FogGestureState,
} from "../map/fogGesture";
import { snapShapeToCells } from "../map/fogSnap";
import { MIN_ALIGN_CELL_SIZE } from "../map/grid";
import { MapStage, type StagePointerTool } from "../map/MapStage";
import type { TokenTool } from "../map/TokenLayer";
import {
  clampCenter,
  DEFAULT_PLAYER_DISPLAY,
  isScaleLocked,
  playerViewportRect,
  resolvePlayerView,
  type MapRect,
} from "../map/playerView";
import { useContainerSize } from "../map/useContainerSize";
import { useImageElement } from "../map/useImageElement";
import { fitToView, type Point, type Size, type Viewport } from "../map/viewport";
import { playerPresentation } from "../state/calibration";
import type { TableMapDb } from "../state/db";
import type { FogMode, FogShape } from "../state/fog";
import { activeMap } from "../state/maps";
import type { AssetId, GridGeometry, MapScene } from "../state/model";
import { mapEdgeAtTop, type Rotation } from "../state/rotation";
import { useTableStore, type TableStore } from "../state/store";
import {
  FOG_MIN_DRAG_PX,
  FOG_MIN_STEP_PX,
  FOG_TOOL_LABELS,
  type FogToolSettings,
} from "./fogTool";
import { useAssetBlob, useAssetBlobs } from "./useAssetBlob";

const FIT_PADDING = 24;

const styles = {
  root: { position: "absolute", inset: 0 },
  placeholder: {
    position: "absolute",
    inset: 0,
    display: "grid",
    placeItems: "center",
    color: "#555",
    textAlign: "center",
    padding: 24,
  },
  hud: {
    position: "absolute",
    right: 12,
    bottom: 12,
    display: "flex",
    gap: 8,
    alignItems: "center",
    color: "#aaa",
    fontSize: 12,
    background: "rgba(0,0,0,0.5)",
    padding: "4px 8px",
    borderRadius: 4,
  },
  alignHint: {
    position: "absolute",
    left: 12,
    top: 12,
    right: 12,
    color: "#fff",
    fontSize: 13,
    background: "rgba(20, 60, 100, 0.85)",
    border: "1px solid #8cf",
    padding: "6px 10px",
    borderRadius: 4,
    pointerEvents: "none",
  },
  fogHint: {
    position: "absolute",
    left: 12,
    top: 12,
    right: 12,
    color: "#fff",
    fontSize: 13,
    background: "rgba(80, 60, 10, 0.85)",
    border: "1px solid #fc6",
    padding: "6px 10px",
    borderRadius: 4,
    pointerEvents: "none",
  },
} satisfies Record<string, CSSProperties>;

export interface AlignmentProps {
  /** Called with the derived geometry once both corners are placed. */
  onAligned: (geometry: GridGeometry) => void;
  /** Esc, or a click on the hint's cancel affordance. */
  onCancel: () => void;
}

export interface FogToolProps {
  settings: FogToolSettings;
  /** Called with each completed shape, in map pixels, already snapped if snapping is on. */
  onShape: (shape: FogShape) => void;
  /** Esc while no gesture is in progress. */
  onCancel: () => void;
}

export interface DmCanvasProps {
  store: TableStore;
  db: TableMapDb;
  /** Present while the grid alignment tool is active. */
  alignment?: AlignmentProps;
  /** Present while a fog tool is active. */
  fog?: FogToolProps;
  /**
   * Token selection and dragging (T010). Tokens are only interactive while
   * no canvas tool runs, so a tool gets every press.
   */
  tokens?: TokenTool;
}

/** Asset ids of a scene's image tokens, deduplicated, in a stable order. */
export function tokenImageAssetIds(scene: Pick<MapScene, "tokens"> | undefined): AssetId[] {
  if (!scene) return [];
  const ids = new Set<AssetId>();
  for (const t of scene.tokens) if (t.appearance.type === "image") ids.add(t.appearance.assetId);
  return [...ids].sort();
}

// ---- previews ------------------------------------------------------------------

interface ShapeNodeStyle {
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  dash?: number[];
  globalCompositeOperation?: GlobalCompositeOperation;
}

/**
 * Any fog shape as Konva nodes. A `stroke` shape is drawn as a thick round
 * line in `fill` (its outline style is ignored); everything else gets the
 * fill plus a 1-screen-px outline.
 */
function FogShapeNodes({ shape, style }: { shape: FogShape; style: ShapeNodeStyle }) {
  const common = {
    listening: false,
    fill: style.fill,
    stroke: style.stroke,
    strokeWidth: style.strokeWidth ?? 1.5,
    strokeScaleEnabled: false,
    dash: style.dash,
    globalCompositeOperation: style.globalCompositeOperation,
  };
  switch (shape.kind) {
    case "rect":
      return <Rect {...common} x={shape.x} y={shape.y} width={shape.width} height={shape.height} />;
    case "circle":
      return <Circle {...common} x={shape.x} y={shape.y} radius={shape.radius} />;
    case "polygon":
      return <Line {...common} points={shape.points} closed />;
    case "rects":
      return (
        <Shape
          {...common}
          sceneFunc={(ctx, node) => {
            ctx.beginPath();
            for (let i = 0; i + 3 < shape.rects.length; i += 4) {
              ctx.rect(shape.rects[i], shape.rects[i + 1], shape.rects[i + 2], shape.rects[i + 3]);
            }
            ctx.closePath();
            ctx.fillStrokeShape(node);
          }}
        />
      );
    case "stroke": {
      const colour = style.fill ?? style.stroke;
      if (shape.points.length < 4) {
        return (
          <Circle
            listening={false}
            x={shape.points[0]}
            y={shape.points[1]}
            radius={shape.radius}
            fill={colour}
            globalCompositeOperation={style.globalCompositeOperation}
          />
        );
      }
      return (
        <Line
          listening={false}
          points={shape.points}
          stroke={colour}
          strokeWidth={shape.radius * 2}
          lineCap="round"
          lineJoin="round"
          globalCompositeOperation={style.globalCompositeOperation}
        />
      );
    }
  }
}

const PREVIEW_TINT: Record<FogMode, ShapeNodeStyle> = {
  reveal: { fill: "rgba(255, 204, 102, 0.2)", stroke: "#fc6", dash: [6, 4] },
  hide: { fill: "rgba(255, 102, 102, 0.35)", stroke: "#f66", dash: [6, 4] },
};

/** The reveal preview inside the fog layer: the shape cut out of the mask. */
const PUNCH_THROUGH: ShapeNodeStyle = { fill: "#000", globalCompositeOperation: "destination-out" };

/** The map-pixel line along the rectangle edge that sits at the top of the TV. */
export function tvTopEdgePoints(rect: MapRect, rotation: Rotation): number[] {
  const { width: w, height: h } = rect;
  switch (mapEdgeAtTop(rotation)) {
    case "top":
      return [0, 0, w, 0];
    case "left":
      return [0, 0, 0, h];
    case "bottom":
      return [0, h, w, h];
    case "right":
      return [w, 0, w, h];
  }
}

function PlayerViewportRect({
  rect,
  rotation,
  scale,
  draggable,
  map,
  onMove,
}: {
  rect: MapRect;
  rotation: Rotation;
  /** DM stage scale, to keep strokes and labels a fixed screen size. */
  scale: number;
  draggable: boolean;
  map: Size;
  onMove: (center: Point) => void;
}) {
  const setCursor = (e: KonvaEventObject<MouseEvent>, cursor: string) => {
    const container = e.target.getStage()?.container();
    if (container) container.style.cursor = cursor;
  };
  const moved = (e: KonvaEventObject<DragEvent>) => {
    const node = e.target as Konva.Group;
    const center = clampCenter(
      { x: node.x() + rect.width / 2, y: node.y() + rect.height / 2 },
      map
    );
    node.position({ x: center.x - rect.width / 2, y: center.y - rect.height / 2 });
    onMove(center);
  };
  return (
    <Group
      name="player-viewport"
      x={rect.x}
      y={rect.y}
      draggable={draggable}
      onDragMove={moved}
      onDragEnd={moved}
      onMouseEnter={(e) => draggable && setCursor(e, "move")}
      onMouseLeave={(e) => setCursor(e, "")}
    >
      {/* No fill: the interior must not tint the DM's view of the map (tests
          sample its pixels). Konva still hit-tests the whole rectangle. */}
      <Rect
        x={0}
        y={0}
        width={rect.width}
        height={rect.height}
        stroke="#8cf"
        strokeWidth={2}
        strokeScaleEnabled={false}
        dash={draggable ? undefined : [8, 6]}
      />
      <Line
        points={tvTopEdgePoints(rect, rotation)}
        stroke="#fff"
        strokeWidth={5}
        strokeScaleEnabled={false}
        listening={false}
      />
      <Text
        x={6 / scale}
        y={6 / scale}
        text={draggable ? "Player view" : "Player view (whole map)"}
        fontSize={12 / scale}
        fontFamily="system-ui, sans-serif"
        fill="#8cf"
        listening={false}
      />
    </Group>
  );
}

function AlignmentPreview({ state, scale }: { state: AlignmentState; scale: number }) {
  if (state.phase === "idle") return null;
  const box = alignmentBox(state);
  const marker = 5 / scale;
  return (
    <>
      {box && (
        <Rect
          x={Math.min(box.first.x, box.second.x)}
          y={Math.min(box.first.y, box.second.y)}
          width={Math.abs(box.second.x - box.first.x)}
          height={Math.abs(box.second.y - box.first.y)}
          stroke="#8cf"
          strokeWidth={1.5}
          strokeScaleEnabled={false}
          dash={[6, 4]}
          fill="rgba(136, 204, 255, 0.15)"
          listening={false}
        />
      )}
      <Circle
        x={state.first.x}
        y={state.first.y}
        radius={marker}
        fill="#8cf"
        listening={false}
      />
    </>
  );
}

/** The brush's footprint under the pointer while no drag is in progress. */
function BrushCursor({ point, radius, mode }: { point: Point; radius: number; mode: FogMode }) {
  return (
    <Circle
      x={point.x}
      y={point.y}
      radius={radius}
      stroke={PREVIEW_TINT[mode].stroke}
      strokeWidth={1}
      strokeScaleEnabled={false}
      dash={[4, 4]}
      listening={false}
    />
  );
}

/** The shape a gesture will commit, snapped to cells when asked. */
export function finalFogShape(
  shape: FogShape,
  settings: Pick<FogToolSettings, "snap">,
  scene: Pick<MapScene, "grid" | "width" | "height">
): FogShape | null {
  return settings.snap ? snapShapeToCells(shape, scene.grid, scene) : shape;
}

export function DmCanvas({ store, db, alignment, fog, tokens }: DmCanvasProps) {
  const scene = useTableStore((s) => activeMap(s.shared), store);
  const blob = useAssetBlob(db, scene?.imageAssetId);
  const { image, status } = useImageElement(blob);
  const fogBase = useAssetBlob(db, scene?.fogMaskAssetId);
  const sceneTokens = scene?.tokens;
  const tokenAssetIds = useMemo(
    () => tokenImageAssetIds(sceneTokens ? { tokens: sceneTokens } : undefined),
    [sceneTokens]
  );
  const tokenImages = useAssetBlobs(db, tokenAssetIds);
  const containerRef = useRef<HTMLDivElement>(null);
  const size = useContainerSize(containerRef);
  const [viewport, setViewport] = useState<Viewport>({ x: 0, y: 0, scale: 1 });
  const fittedFor = useRef<string | null>(null);

  const sceneId = scene?.id ?? null;
  const sceneW = scene?.width ?? 0;
  const sceneH = scene?.height ?? 0;
  const fit = useCallback(() => {
    if (sceneId === null || size.width === 0 || size.height === 0) return;
    setViewport(
      fitToView({ width: sceneW, height: sceneH }, size, FIT_PADDING)
    );
    fittedFor.current = sceneId;
  }, [sceneId, sceneW, sceneH, size]);

  useEffect(() => {
    if (sceneId !== null && fittedFor.current !== sceneId) fit();
  }, [sceneId, fit]);

  // ---- grid alignment tool ------------------------------------------------
  const aligning = alignment !== undefined;
  // The machine's state lives in a ref (so pointer handlers always reduce
  // from the latest state and side effects stay out of React updaters) and
  // is mirrored into state for rendering.
  const alignStateRef = useRef<AlignmentState>(IDLE_ALIGNMENT);
  const [alignState, setAlignStateForRender] = useState<AlignmentState>(IDLE_ALIGNMENT);
  const [alignError, setAlignError] = useState<string | null>(null);
  const alignRef = useRef(alignment);
  alignRef.current = alignment;
  const setAlignState = useCallback((state: AlignmentState) => {
    alignStateRef.current = state;
    setAlignStateForRender(state);
  }, []);

  useEffect(() => {
    // Entering or leaving the tool (or switching maps) starts it afresh.
    setAlignState(IDLE_ALIGNMENT);
    setAlignError(null);
  }, [aligning, sceneId, setAlignState]);

  useEffect(() => {
    if (!aligning) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") alignRef.current?.onCancel();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [aligning]);

  const feed = useCallback(
    (event: AlignmentEvent) => {
      const step = reduceAlignment(alignStateRef.current, event);
      setAlignState(step.state);
      if (!step.result) return;
      if (step.result.geometry) {
        setAlignError(null);
        alignRef.current?.onAligned(step.result.geometry);
      } else {
        setAlignError(
          `That box is too small to be a cell (at least ${MIN_ALIGN_CELL_SIZE} px). Try again.`
        );
      }
    },
    [setAlignState]
  );

  const scale = viewport.scale;
  const alignTool = useMemo<StagePointerTool | undefined>(
    () =>
      aligning
        ? {
            onDown: (point: Point) => feed({ type: "down", point }),
            onMove: (point: Point) => feed({ type: "move", point }),
            onUp: (point: Point) =>
              feed({ type: "up", point, minDrag: ALIGN_CLICK_THRESHOLD_PX / scale }),
          }
        : undefined,
    [aligning, feed, scale]
  );

  // ---- fog tools --------------------------------------------------------------
  const fogging = fog !== undefined && !aligning;
  const fogRef = useRef(fog);
  fogRef.current = fog;
  const settings = fog?.settings;
  const gestureConfig = useMemo<FogGestureConfig | null>(
    () =>
      settings
        ? {
            tool: settings.tool,
            radius: settings.radius,
            minStep: FOG_MIN_STEP_PX / scale,
            minDrag: FOG_MIN_DRAG_PX / scale,
          }
        : null,
    [settings, scale]
  );
  const configRef = useRef(gestureConfig);
  configRef.current = gestureConfig;
  const gestureRef = useRef<FogGestureState>(IDLE_FOG_GESTURE);
  const [gesture, setGestureForRender] = useState<FogGestureState>(IDLE_FOG_GESTURE);
  const setGesture = useCallback((next: FogGestureState) => {
    gestureRef.current = next;
    setGestureForRender(next);
  }, []);
  const [hover, setHover] = useState<Point | null>(null);

  useEffect(() => {
    // Entering or leaving the tool, switching tools or maps drops any gesture.
    setGesture(IDLE_FOG_GESTURE);
    setHover(null);
  }, [fogging, settings?.tool, sceneId, setGesture]);

  useEffect(() => {
    if (!fogging) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (gestureRef.current.phase === "dragging") setGesture(IDLE_FOG_GESTURE);
      else fogRef.current?.onCancel();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [fogging, setGesture]);

  const sceneRef = useRef(scene);
  sceneRef.current = scene;
  const feedFog = useCallback(
    (event: FogGestureEvent) => {
      const config = configRef.current;
      if (!config) return;
      const step = reduceFogGesture(gestureRef.current, event, config);
      setGesture(step.state);
      const current = fogRef.current;
      const target = sceneRef.current;
      if (!step.shape || !current || !target) return;
      const shape = finalFogShape(step.shape, current.settings, target);
      if (shape) current.onShape(shape);
    },
    [setGesture]
  );

  const fogTool = useMemo<StagePointerTool | undefined>(
    () =>
      fogging
        ? {
            onDown: (point: Point) => feedFog({ type: "down", point }),
            onMove: (point: Point) => {
              setHover(point);
              feedFog({ type: "move", point });
            },
            onUp: (point: Point) => feedFog({ type: "up", point }),
          }
        : undefined,
    [fogging, feedFog]
  );

  const preview = useMemo(() => {
    if (!fogging || !settings || !gestureConfig || !scene) return null;
    const raw = gestureShape(gesture, gestureConfig);
    return raw ? finalFogShape(raw, settings, scene) : null;
  }, [fogging, settings, gestureConfig, gesture, scene]);

  // ---- player viewport rectangle (T009) ---------------------------------------
  const presentationState = useTableStore((s) => s.presentation, store);
  const setPresentation = useTableStore((s) => s.setPresentation, store);
  const playerDisplay = presentationState.playerDisplay;
  const display = useMemo<Size>(
    () =>
      playerDisplay
        ? { width: playerDisplay.width, height: playerDisplay.height }
        : DEFAULT_PLAYER_DISPLAY,
    [playerDisplay]
  );
  const presentation = useMemo(() => playerPresentation(presentationState), [presentationState]);
  const playerView = useMemo(
    () => (scene ? resolvePlayerView(presentation, scene, display) : null),
    [presentation, scene, display]
  );
  const playerRect = useMemo(
    () => (playerView ? playerViewportRect(playerView, display) : null),
    [playerView, display]
  );
  const movePlayerCenter = useCallback(
    (center: Point) => setPresentation({ center }),
    [setPresentation]
  );

  const pointerTool = alignTool ?? fogTool;
  const tokenTool = pointerTool ? undefined : tokens;
  const dragging = gesture.phase === "dragging";
  const controls =
    playerView && playerRect && scene ? (
      <PlayerViewportRect
        rect={playerRect}
        rotation={playerView.rotation}
        scale={scale}
        draggable={isScaleLocked(presentation) && !pointerTool}
        map={scene}
        onMove={movePlayerCenter}
      />
    ) : undefined;
  const overlay = aligning ? (
    <AlignmentPreview state={alignState} scale={scale} />
  ) : fogging && settings ? (
    <>
      {preview && <FogShapeNodes shape={preview} style={PREVIEW_TINT[settings.mode]} />}
      {!dragging && hover && settings.tool === "brush" && (
        <BrushCursor point={hover} radius={settings.radius} mode={settings.mode} />
      )}
    </>
  ) : undefined;
  const fogOverlay =
    fogging && settings?.mode === "reveal" && preview ? (
      <FogShapeNodes shape={preview} style={PUNCH_THROUGH} />
    ) : undefined;

  const fogHint = settings
    ? settings.tool === "brush"
      ? "paint over the area (a click paints one dot)."
      : settings.tool === "rect"
        ? "drag across the area."
        : "drag around the area; letting go closes the shape."
    : "";

  return (
    <div
      ref={containerRef}
      data-testid="dm-canvas-surface"
      data-aligning={aligning ? "true" : "false"}
      data-fogging={fogging && settings ? settings.mode : "false"}
      data-fog-tool={fogging && settings ? settings.tool : "none"}
      data-fog-gesture={dragging ? "dragging" : "idle"}
      data-player-center={playerView ? `${playerView.center.x},${playerView.center.y}` : ""}
      data-player-rect={
        playerRect
          ? [playerRect.x, playerRect.y, playerRect.width, playerRect.height]
              .map((n) => Math.round(n))
              .join(",")
          : ""
      }
      data-player-rotation={playerView?.rotation ?? 0}
      data-player-draggable={controls && isScaleLocked(presentation) && !pointerTool ? "true" : "false"}
      data-token-tool={tokenTool ? "active" : "none"}
      style={{ ...styles.root, cursor: aligning || fogging ? "crosshair" : undefined }}
    >
      {scene ? (
        <>
          <MapStage
            scene={scene}
            image={image}
            imageStatus={scene.imageAssetId ? status : "none"}
            size={size}
            viewport={viewport}
            gridView="dm"
            interactive
            onViewportChange={setViewport}
            pointerTool={pointerTool}
            overlay={overlay}
            fogOverlay={fogOverlay}
            controls={controls}
            fogBase={fogBase}
            tokenImages={tokenImages}
            tokenTool={tokenTool}
            data-testid="dm-map-stage"
          />
          {fogging && settings && (
            <div data-testid="fog-hint" role="status" style={styles.fogHint}>
              <strong>
                {settings.mode === "reveal" ? "Reveal" : "Hide"} with the{" "}
                {FOG_TOOL_LABELS[settings.tool].toLowerCase()}
                {settings.snap ? " (whole cells)" : ""}:
              </strong>{" "}
              {fogHint} Esc {dragging ? "abandons this one" : "stops"}.
            </div>
          )}
          {aligning && (
            <div data-testid="align-hint" role="status" style={styles.alignHint}>
              <strong>Align grid:</strong>{" "}
              {alignState.phase === "second"
                ? "now click the opposite corner of the same square."
                : "drag across one map square, or click one corner then the opposite corner."}{" "}
              Esc cancels.
              {alignError && (
                <span data-testid="align-error" style={{ color: "#fc6" }}>
                  {" "}
                  {alignError}
                </span>
              )}
            </div>
          )}
          <div style={styles.hud}>
            <span data-testid="canvas-zoom">
              {Math.round(viewport.scale * 100)}%
            </span>
            <button type="button" onClick={fit} data-testid="canvas-fit">
              Fit
            </button>
          </div>
        </>
      ) : (
        <div style={styles.placeholder}>
          <p>
            No map selected.
            <br />
            Drop a PNG, JPEG or WebP here, or use the Maps panel.
          </p>
        </div>
      )}
    </div>
  );
}
