/**
 * The DM's map canvas: the active scene on a Konva stage with free pan
 * (drag) and zoom (wheel), fitted to the container whenever the scene
 * changes or changes size (a map rotation, T017).
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
 * The fourth fog tool, the **room fill** (T108), is a click: the pointer's
 * grid cell is tracked while it hovers (state that changes only when the
 * pointer enters another cell), the room it would fill — `map/roomFill.ts`
 * over the scene's blocking segments — is the preview, and a click hands
 * that room to `fog.onShape` as one `rects` shape, or calls
 * `fog.onFillTooLarge` when more than `ROOM_FILL_LIMIT` cells are reachable.
 * `data-fill-preview` reports `room` | `too-large` | `none`, `data-fill-cell`
 * the hovered cell.
 *
 * The **player viewport rectangle** (T009) is always drawn: the map area the
 * player display shows (`map/playerView.ts`, from the store's presentation
 * and the display the player window reported — 1080p until one has). While
 * the player scale is locked to the calibration and no tool is running, the
 * rectangle is draggable; each drag move writes the new centre to the
 * store's presentation, which the sync layer pushes to the player at once.
 * A white bar marks the edge of the map that is at the top of the TV. Its
 * looks (`PlayerViewportFrame`) are in the stage's controls layer, above
 * everything; its grab handle (`PlayerViewportHandle`) is in the stage's
 * underlay layer, *beneath the tokens*, so a token standing inside the TV
 * area is still the thing a drag on it moves (T013).
 *
 * **Tokens** (T010) are drawn by the stage's token layer; with no canvas
 * tool running, the `tokens` prop makes them draggable and selectable (the
 * drop position is clamped and snapped by the layer and reported through
 * `tokens.onMove`). The image Blobs of the active map's image tokens are
 * read from the database here (`useAssetBlobs`).
 *
 * **Annotations** (T011, ADR 0016). With `draw` active, a drag is a pen
 * stroke (the same thinned path as the fog brush, `map/fogGesture.ts` with
 * the brush tool) previewed live in the overlay and handed to
 * `draw.onStroke` on release; in eraser mode every press and drag move
 * calls `draw.onErase` with the eraser's reach. With `notes` placing, a
 * click on the map calls `notes.onPlace`. **Note markers** are DM chrome
 * drawn here in the stage's controls layer — never by the shared stage —
 * so the player has no code that could draw one; they are always
 * clickable (opens the popover, a DOM box at the marker's screen position
 * with the text and a delete button) and draggable (`notes.onMove`). An
 * **Alt-click** anywhere is a ping (`onPing`) whatever tool is running; the
 * store's recent pings are handed to the stage, which animates them.
 *
 * **Pan override** (T018, ADR 0022): a middle-button drag, or a drag while
 * **Space** is held, pans the canvas whatever tool is armed. The stage does
 * the panning (`MapStage`'s `panOverride` prop and its middle-button rule)
 * and keeps those pointer events from the tool, so a gesture in progress is
 * left as it was and the tool is ready again on release. This component
 * watches Space (outside text fields; the key's default — a focused button
 * would click — is suppressed while the pointer is over the canvas), shows
 * the "grab" cursor, and takes the tokens, the player-viewport handle and
 * the note markers out of the drag while Space is down so the pan wins
 * over them too. `data-pan-override` reports `space` | `none`.
 *
 * **Walls and doors** (T101, ADR 0024) are drawn here, in the controls
 * layer, by `WallLayer` — DM chrome like the note markers, never by the
 * shared stage, so the player has no code that could draw one. With
 * `walls` (T102, ADR 0025): while `walls.drawing`, presses run the wall
 * gesture machine (`map/wallGesture.ts`) for the wall polyline or the door
 * drag, snapping to grid corners within `WALL_SNAP_PX` unless Shift is
 * held, and every committed segment goes to `walls.onSegment`; Esc ends a
 * polyline in progress, or leaves the tool when none is. With no tool
 * armed the walls are clickable (`walls.onSelect`), the selected segment
 * shows two draggable end handles (`walls.onMoveEndpoint` on drop, snapped
 * the same way) and Esc clears the selection. `data-walls` reports the
 * count and `data-wall-segments` every segment's kind and endpoints (and a
 * door's state).
 *
 * **Doors in play** (T103, ADR 0024): with `walls`, a door is clickable
 * whatever tool is armed — the fog brush, the pen, a note — like the note
 * markers: a click calls `walls.onToggleDoor` (never `onSelect`) and the
 * press never reaches the tool. The exceptions are the tools that click on
 * grid corners, where doors end — the wall and door drawing tools and grid
 * alignment — and Space held (the pan wins, T018). `walls.focus` centres
 * the viewport on a segment (the panel's door list). `data-doors-open`
 * reports how many doors are open, `data-doors-clickable` whether a click
 * on one would toggle it.
 *
 * **Vision preview** (T106, ADR 0026): while a token with vision is dragged
 * (`TokenTool.onDragMove`, reporting where it would land), the canvas shows
 * what it would see from there — its `tokenVisionPolygon`, drawn like a
 * fog reveal preview: tinted in the overlay and punched through the fog —
 * and, on a map that dims (T107), through the dim layer (`dimOverlay`), so
 * the area reads as seen. The polygon is recomputed at most once per animation frame, from the
 * latest drag position, and dropped on release (or when the tokens stop
 * being draggable). Nothing is dispatched until the drop; the reveal itself
 * is the view's vision actions'. `data-vision-preview` reports the
 * polygon's vertex count, 0 for none.
 *
 * **Turn ring** (T110, ADR 0027; on the shared stage since T111): the
 * canvas hands the current initiative entry's token id to the stage
 * (`turnTokenId`), whose token layer rings that token — on the DM always,
 * hidden or fogged, and not listening, so clicks and drags still reach the
 * token. It follows the store: another turn, a moved or resized token, a
 * map switch. A link to a token on another map, or a dangling one, draws
 * nothing. `data-turn-ring` reports the ringed token's id.
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
import { MapStage, type PointerModifiers, type StagePointerTool } from "../map/MapStage";
import { cellAt, roomCells, type GridCell } from "../map/roomFill";
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
import {
  centerOn,
  fitToView,
  mapToScreen,
  type Point,
  type Size,
  type Viewport,
} from "../map/viewport";
import { blockingSegments } from "../map/visibility";
import {
  IDLE_WALL_GESTURE,
  reduceWallGesture,
  snapWallPoint,
  wallGesturePreview,
  type NewWallSegment,
  type WallGestureConfig,
  type WallGestureEvent,
  type WallGestureState,
} from "../map/wallGesture";
import { notesOf, type NoteAnnotation } from "../state/annotations";
import { playerPresentation } from "../state/calibration";
import type { TableMapDb } from "../state/db";
import { rectsShape, type FogMode, type FogShape } from "../state/fog";
import { currentEntry } from "../state/initiative";
import { activeMap } from "../state/maps";
import type { AssetId, GridGeometry, MapScene } from "../state/model";
import { mapEdgeAtTop, type Rotation } from "../state/rotation";
import { useTableStore, type TableStore } from "../state/store";
import type { TokenPoint } from "../state/tokens";
import { tokenVisionPolygon } from "../state/vision";
import { doorDisplayName, doorsOf, findWall, openDoorsOf, type WallSegment } from "../state/walls";
import { ERASER_RADIUS_PX, type DrawToolSettings } from "./annotationTool";
import { isEditableTarget } from "./shortcuts";
import {
  FOG_MIN_DRAG_PX,
  FOG_MIN_STEP_PX,
  FOG_TOOL_LABELS,
  type FogToolSettings,
} from "./fogTool";
import { useAssetBlob, useAssetBlobs } from "./useAssetBlob";
import { DOOR_COLOR, doorLabelText, WALL_COLOR, WALL_STROKE_PX, WallLayer, type WallEnd } from "./WallLayer";
import {
  WALL_CLICK_THRESHOLD_PX,
  WALL_SNAP_PX,
  WALL_TOOL_LABELS,
  type WallToolSettings,
} from "./wallTool";

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
  drawHint: {
    position: "absolute",
    left: 12,
    top: 12,
    right: 12,
    color: "#fff",
    fontSize: 13,
    background: "rgba(10, 50, 70, 0.85)",
    border: "1px solid #5ac8fa",
    padding: "6px 10px",
    borderRadius: 4,
    pointerEvents: "none",
  },
  notePopover: {
    position: "absolute",
    width: 220,
    display: "grid",
    gap: 6,
    padding: 8,
    background: "#1e1e1e",
    border: "1px solid #ff8fd8",
    borderRadius: 6,
    boxShadow: "0 4px 16px rgba(0,0,0,0.5)",
    zIndex: 5,
    fontSize: 12,
    color: "#ddd",
  },
  noteText: {
    width: "100%",
    minHeight: 72,
    boxSizing: "border-box",
    resize: "vertical",
    background: "#0d0d0d",
    color: "#eee",
    border: "1px solid #444",
    borderRadius: 4,
    padding: 6,
    font: "inherit",
  },
} satisfies Record<string, CSSProperties>;

/** Note marker colour (DM chrome only). */
export const NOTE_COLOR = "#ff8fd8";
/** Marker radius in screen pixels. */
export const NOTE_MARKER_RADIUS = 9;
/** Where the popover sits relative to the marker, screen pixels. */
const NOTE_POPOVER_OFFSET = { x: 14, y: -10 };

export interface AlignmentProps {
  /** Called with the derived geometry once both corners are placed. */
  onAligned: (geometry: GridGeometry) => void;
  /** Esc, or a click on the hint's cancel affordance. */
  onCancel: () => void;
}

export interface FogToolProps {
  settings: FogToolSettings;
  /** Called with each completed shape, in map pixels, already snapped if snapping is on; a fill's room as `rects`. */
  onShape: (shape: FogShape) => void;
  /** A fill click that reached more than `ROOM_FILL_LIMIT` cells (T108): nothing was committed. */
  onFillTooLarge?: () => void;
  /** Esc while no gesture is in progress. */
  onCancel: () => void;
}

export interface DrawToolProps {
  settings: DrawToolSettings;
  /** A completed pen stroke: the thinned drag path, flat, in map pixels. */
  onStroke: (points: number[]) => void;
  /** The eraser passed over a point with the given reach (map pixels). */
  onErase: (point: Point, radius: number) => void;
  /** Esc while no stroke is in progress. */
  onCancel: () => void;
}

export interface NoteToolProps {
  /** Whether the next click on the map places a note. */
  placing: boolean;
  /** The note whose popover is open; null for none. */
  selectedId: string | null;
  onPlace: (point: Point) => void;
  onSelect: (id: string | null) => void;
  onMove: (id: string, point: Point) => void;
  onTextChange: (id: string, text: string) => void;
  onDelete: (id: string) => void;
  /** Esc while placing. */
  onCancel: () => void;
}

/** A request to centre the canvas on a segment (T103); a new `nonce` re-centres on the same id. */
export interface WallFocus {
  id: string;
  nonce: number;
}

export interface WallToolProps {
  /** Whether the wall / door tool is armed: presses draw instead of selecting. */
  drawing: boolean;
  settings: WallToolSettings;
  /** The selected segment; null for none. */
  selectedId: string | null;
  /** A segment the tool committed, in map pixels, already snapped. */
  onSegment: (segment: NewWallSegment) => void;
  onSelect: (id: string | null) => void;
  /** An end of a segment was dropped at `point` (map pixels, already snapped). */
  onMoveEndpoint: (id: string, end: WallEnd, point: Point) => void;
  /** A door was clicked on the canvas (T103): flip its `open`. */
  onToggleDoor: (id: string) => void;
  /** Centre the canvas on this segment (T103); undefined or an unknown id does nothing. */
  focus?: WallFocus;
  /** Esc while the tool is armed and nothing is in progress. */
  onCancel: () => void;
}

/**
 * `data-wall-segments`: every segment as `kind:x1,y1,x2,y2`, a door with
 * `:open` or `:closed` after it (T103), `;`-separated, 3 decimals at most.
 */
export function wallSegmentsAttribute(walls: readonly WallSegment[]): string {
  const r = (n: number) => String(Math.round(n * 1000) / 1000);
  return walls
    .map((w) => {
      const entry = `${w.kind}:${r(w.x1)},${r(w.y1)},${r(w.x2)},${r(w.y2)}`;
      return w.kind === "door" ? `${entry}:${w.open ? "open" : "closed"}` : entry;
    })
    .join(";");
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
  /** Present while the drawing tool is active (T011). */
  draw?: DrawToolProps;
  /** Note markers, popover and placement (T011); absent hides the markers. */
  notes?: NoteToolProps;
  /** An Alt-click on the map, in map pixels (T011). */
  onPing?: (point: Point) => void;
  /** Wall and door tools, selection and editing (T102); absent leaves the walls read-only. */
  walls?: WallToolProps;
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
function FogShapeNodes({
  shape,
  style,
  name,
}: {
  shape: FogShape;
  style: ShapeNodeStyle;
  /** Konva node name, for tests. */
  name?: string;
}) {
  const common = {
    name,
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
            name={name}
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
          name={name}
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

/**
 * The grab handle of the player viewport rectangle: an invisible node the
 * size of the rectangle, drawn in the stage's underlay layer (beneath the
 * tokens) so that a drag that starts on a token inside the TV area moves
 * the token, and a drag anywhere else inside the rectangle pans the player
 * view (T013). Konva hit-tests a fill-less shape's whole interior, which is
 * exactly what a handle wants — and exactly why it cannot sit above the
 * tokens. Its looks are `PlayerViewportFrame`, in the controls layer.
 */
function PlayerViewportHandle({
  rect,
  draggable,
  map,
  onMove,
}: {
  rect: MapRect;
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
      <Rect x={0} y={0} width={rect.width} height={rect.height} />
    </Group>
  );
}

/** What the DM sees of the player viewport rectangle; hit-testing is the handle's. */
function PlayerViewportFrame({
  rect,
  rotation,
  scale,
  draggable,
}: {
  rect: MapRect;
  rotation: Rotation;
  /** DM stage scale, to keep strokes and labels a fixed screen size. */
  scale: number;
  draggable: boolean;
}) {
  return (
    <Group name="player-viewport-frame" x={rect.x} y={rect.y} listening={false}>
      {/* No fill: the interior must not tint the DM's view of the map (tests
          sample its pixels). */}
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

/** A note's pin on the DM canvas: click opens its popover, drag moves it. */
function NoteMarker({
  note,
  scale,
  selected,
  draggable,
  onSelect,
  onMove,
}: {
  note: NoteAnnotation;
  scale: number;
  selected: boolean;
  /** Off while Space is held, so a pan can start on a marker (T018). */
  draggable: boolean;
  onSelect: (id: string | null) => void;
  onMove: (id: string, point: Point) => void;
}) {
  const r = NOTE_MARKER_RADIUS / scale;
  const stop = (e: KonvaEventObject<Event>) => {
    // The stage's tool handlers must not see presses on a marker.
    e.cancelBubble = true;
  };
  const setCursor = (e: KonvaEventObject<MouseEvent>, cursor: string) => {
    const container = e.target.getStage()?.container();
    if (container) container.style.cursor = cursor;
  };
  return (
    <Group
      name="note-marker"
      id={`note-${note.id}`}
      x={note.x}
      y={note.y}
      draggable={draggable}
      onMouseDown={stop}
      onMouseUp={stop}
      onTouchStart={stop}
      onTouchEnd={stop}
      onClick={(e) => {
        stop(e);
        if (!e.evt.altKey) onSelect(selected ? null : note.id);
      }}
      onTap={(e) => {
        stop(e);
        onSelect(selected ? null : note.id);
      }}
      onDragEnd={(e) => onMove(note.id, { x: e.target.x(), y: e.target.y() })}
      onMouseEnter={(e) => setCursor(e, "pointer")}
      onMouseLeave={(e) => setCursor(e, "")}
    >
      <Circle
        radius={r}
        fill={NOTE_COLOR}
        stroke={selected ? "#fff" : "#111"}
        strokeWidth={selected ? 3 : 2}
        strokeScaleEnabled={false}
      />
      <Circle radius={r * 0.35} fill="#111" listening={false} />
    </Group>
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

export function DmCanvas({
  store,
  db,
  alignment,
  fog,
  tokens,
  draw,
  notes,
  onPing,
  walls,
}: DmCanvasProps) {
  const scene = useTableStore((s) => activeMap(s.shared), store);
  const pings = useTableStore((s) => s.pings, store);
  // The turn ring (T110; drawn by the stage's token layer since T111): the
  // current entry's token id, and that token if it is on this map.
  const turnTokenId = useTableStore((s) => currentEntry(s.shared.initiative)?.tokenId ?? null, store);
  const turnToken =
    turnTokenId !== null ? scene?.tokens.find((t) => t.id === turnTokenId) : undefined;
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
  // Refit when the scene changes *or* its size does (a map rotation, T017,
  // swaps the sides and the old pan would leave the map half off screen).
  const fitKey = sceneId === null ? null : `${sceneId}:${sceneW}x${sceneH}`;
  const fit = useCallback(() => {
    if (sceneId === null || size.width === 0 || size.height === 0) return;
    setViewport(
      fitToView({ width: sceneW, height: sceneH }, size, FIT_PADDING)
    );
    fittedFor.current = fitKey;
  }, [sceneId, sceneW, sceneH, size, fitKey]);

  useEffect(() => {
    if (fitKey !== null && fittedFor.current !== fitKey) fit();
  }, [fitKey, fit]);

  // ---- pan override: Space (T018) -----------------------------------------
  // Space is watched on the window so it works wherever focus is (bar text
  // fields). Its default is only suppressed while the pointer is over the
  // canvas: there, a focused button must not click on release; elsewhere,
  // Space keeps activating whatever is focused.
  const [spaceHeld, setSpaceHeld] = useState(false);
  const hoveringRef = useRef(false);
  const preventedRef = useRef(false);
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== " " || isEditableTarget(e.target)) return;
      if (hoveringRef.current) {
        e.preventDefault();
        preventedRef.current = true;
      }
      setSpaceHeld(true);
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key !== " ") return;
      if (preventedRef.current) e.preventDefault();
      preventedRef.current = false;
      setSpaceHeld(false);
    };
    const onBlur = () => {
      preventedRef.current = false;
      setSpaceHeld(false);
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
    };
  }, []);
  const onMouseEnter = useCallback(() => {
    hoveringRef.current = true;
  }, []);
  const onMouseLeave = useCallback(() => {
    hoveringRef.current = false;
  }, []);

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
  // The room fill (T108) is a click, not a gesture: the machine has no config for it.
  const filling = fogging && settings?.tool === "fill";
  const gestureConfig = useMemo<FogGestureConfig | null>(
    () =>
      settings && settings.tool !== "fill"
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

  // ---- room fill (T108) ---------------------------------------------------------
  // The hovered cell is state that changes only when the pointer enters
  // another cell, so the preview is recomputed per cell — and when the walls,
  // a door, the grid or the map change — never per pointer move.
  const [fillCell, setFillCell] = useState<GridCell | null>(null);
  const fillPressedRef = useRef(false);
  useEffect(() => {
    setFillCell(null);
    fillPressedRef.current = false;
  }, [filling, sceneId]);
  const hoverFill = useCallback((point: Point) => {
    const target = sceneRef.current;
    const cell = target ? cellAt(point, target.grid, target) : null;
    setFillCell((current) =>
      current === cell || (current && cell && current.column === cell.column && current.row === cell.row)
        ? current
        : cell
    );
  }, []);
  const commitFill = useCallback((point: Point) => {
    const current = fogRef.current;
    const target = sceneRef.current;
    const cell = target ? cellAt(point, target.grid, target) : null;
    if (!current || !target || !cell) return;
    const room = roomCells(cell, target.grid, target, blockingSegments(target.walls));
    if (room === "too-large") current.onFillTooLarge?.();
    else if (room.length > 0) current.onShape(rectsShape(room));
  }, []);
  const sceneGrid = scene?.grid;
  const sceneWalls = scene?.walls;
  const fillSegments = useMemo(() => (sceneWalls ? blockingSegments(sceneWalls) : []), [sceneWalls]);
  const fillRoom = useMemo(
    () =>
      filling && fillCell && sceneGrid
        ? roomCells(fillCell, sceneGrid, { width: sceneW, height: sceneH }, fillSegments)
        : null,
    [filling, fillCell, sceneGrid, sceneW, sceneH, fillSegments]
  );

  const fogTool = useMemo<StagePointerTool | undefined>(
    () =>
      !fogging
        ? undefined
        : filling
          ? {
              onDown: (point: Point) => {
                fillPressedRef.current = true;
                hoverFill(point);
              },
              onMove: (point: Point) => hoverFill(point),
              onUp: (point: Point) => {
                if (!fillPressedRef.current) return;
                fillPressedRef.current = false;
                commitFill(point);
              },
            }
          : {
              onDown: (point: Point) => feedFog({ type: "down", point }),
              onMove: (point: Point) => {
                setHover(point);
                feedFog({ type: "move", point });
              },
              onUp: (point: Point) => feedFog({ type: "up", point }),
            },
    [fogging, filling, feedFog, hoverFill, commitFill]
  );

  const preview = useMemo(() => {
    if (!fogging || !settings || !scene) return null;
    if (settings.tool === "fill") {
      return Array.isArray(fillRoom) && fillRoom.length > 0 ? rectsShape(fillRoom) : null;
    }
    const raw = gestureConfig ? gestureShape(gesture, gestureConfig) : null;
    return raw ? finalFogShape(raw, settings, scene) : null;
  }, [fogging, settings, gestureConfig, gesture, scene, fillRoom]);

  // ---- drawing tool (T011) ----------------------------------------------------
  const drawing = draw !== undefined && !aligning && !fogging;
  const drawRef = useRef(draw);
  drawRef.current = draw;
  const drawSettings = draw?.settings;
  const drawConfig = useMemo<FogGestureConfig | null>(
    () =>
      drawSettings
        ? {
            tool: "brush",
            radius: drawSettings.strokeWidth / 2,
            minStep: FOG_MIN_STEP_PX / scale,
            minDrag: 0,
          }
        : null,
    [drawSettings, scale]
  );
  const drawConfigRef = useRef(drawConfig);
  drawConfigRef.current = drawConfig;
  const strokeRef = useRef<FogGestureState>(IDLE_FOG_GESTURE);
  const [stroke, setStrokeForRender] = useState<FogGestureState>(IDLE_FOG_GESTURE);
  const setStroke = useCallback((next: FogGestureState) => {
    strokeRef.current = next;
    setStrokeForRender(next);
  }, []);
  const erasingRef = useRef(false);
  const [drawHover, setDrawHover] = useState<Point | null>(null);

  useEffect(() => {
    setStroke(IDLE_FOG_GESTURE);
    erasingRef.current = false;
    setDrawHover(null);
  }, [drawing, drawSettings?.mode, sceneId, setStroke]);

  useEffect(() => {
    if (!drawing) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (strokeRef.current.phase === "dragging") setStroke(IDLE_FOG_GESTURE);
      else drawRef.current?.onCancel();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [drawing, setStroke]);

  const eraserRadius = ERASER_RADIUS_PX / scale;
  const drawTool = useMemo<StagePointerTool | undefined>(() => {
    if (!drawing) return undefined;
    const erase = (point: Point) => drawRef.current?.onErase(point, eraserRadius);
    const pen = (event: FogGestureEvent) => {
      const config = drawConfigRef.current;
      if (!config) return;
      const step = reduceFogGesture(strokeRef.current, event, config);
      setStroke(step.state);
      if (step.shape && step.shape.kind === "stroke") drawRef.current?.onStroke(step.shape.points);
    };
    const mode = drawRef.current?.settings.mode;
    return {
      onDown: (point) => {
        if (mode === "erase") {
          erasingRef.current = true;
          erase(point);
        } else pen({ type: "down", point });
      },
      onMove: (point) => {
        setDrawHover(point);
        if (mode === "erase") {
          if (erasingRef.current) erase(point);
        } else pen({ type: "move", point });
      },
      onUp: (point) => {
        if (mode === "erase") erasingRef.current = false;
        else pen({ type: "up", point });
      },
    };
  }, [drawing, drawSettings?.mode, eraserRadius, setStroke]);

  const strokePreview = useMemo(
    () => (drawing && drawConfig ? gestureShape(stroke, drawConfig) : null),
    [drawing, drawConfig, stroke]
  );

  // ---- notes (T011) -----------------------------------------------------------------
  const placingNote = notes?.placing === true && !aligning && !fogging && !drawing;
  const notesRef = useRef(notes);
  notesRef.current = notes;
  useEffect(() => {
    if (!placingNote) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") notesRef.current?.onCancel();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [placingNote]);
  const noteTool = useMemo<StagePointerTool | undefined>(
    () =>
      placingNote
        ? {
            onDown: () => {},
            onMove: () => {},
            onUp: (point: Point) => notesRef.current?.onPlace(point),
          }
        : undefined,
    [placingNote]
  );
  const sceneNotes = useMemo(() => (scene ? notesOf(scene.annotations) : []), [scene]);
  const openNote =
    notes && notes.selectedId !== null
      ? sceneNotes.find((n) => n.id === notes.selectedId) ?? null
      : null;
  const openNoteScreen = openNote ? mapToScreen(viewport, openNote) : null;

  // ---- walls and doors (T102) --------------------------------------------------
  const wallDrawing =
    walls?.drawing === true && !aligning && !fogging && !drawing && !placingNote;
  const wallsRef = useRef(walls);
  wallsRef.current = walls;
  const wallSettings = walls?.settings;
  const grid = scene?.grid;
  // The config exists whenever the walls are editable at all: the end
  // handles snap through it too, not only the drawing tools.
  const wallConfig = useMemo<WallGestureConfig | null>(
    () =>
      wallSettings && grid
        ? {
            tool: wallSettings.tool,
            grid: wallSettings.snap ? grid : null,
            snapThreshold: WALL_SNAP_PX / scale,
            minDrag: WALL_CLICK_THRESHOLD_PX / scale,
          }
        : null,
    [wallSettings, grid, scale]
  );
  const wallConfigRef = useRef(wallConfig);
  wallConfigRef.current = wallConfig;
  const wallGestureRef = useRef<WallGestureState>(IDLE_WALL_GESTURE);
  const [wallGesture, setWallGestureForRender] = useState<WallGestureState>(IDLE_WALL_GESTURE);
  const setWallGesture = useCallback((next: WallGestureState) => {
    wallGestureRef.current = next;
    setWallGestureForRender(next);
  }, []);
  const [wallHover, setWallHover] = useState<Point | null>(null);

  useEffect(() => {
    // Entering or leaving the tool, switching tools or maps ends any polyline.
    setWallGesture(IDLE_WALL_GESTURE);
    setWallHover(null);
  }, [wallDrawing, wallSettings?.tool, sceneId, setWallGesture]);

  useEffect(() => {
    if (!wallDrawing) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (wallGestureRef.current.phase !== "idle") setWallGesture(IDLE_WALL_GESTURE);
      else wallsRef.current?.onCancel();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [wallDrawing, setWallGesture]);

  const wallSelectedId = walls?.selectedId ?? null;
  const wallsEditable = walls !== undefined;
  useEffect(() => {
    // With nothing armed, Esc drops the selection.
    if (!wallsEditable || wallDrawing || wallSelectedId === null) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") wallsRef.current?.onSelect(null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [wallsEditable, wallDrawing, wallSelectedId]);

  const feedWall = useCallback(
    (event: WallGestureEvent) => {
      const config = wallConfigRef.current;
      if (!config) return;
      const step = reduceWallGesture(wallGestureRef.current, event, config);
      setWallGesture(step.state);
      if (step.segment) wallsRef.current?.onSegment(step.segment);
    },
    [setWallGesture]
  );
  const wallTool = useMemo<StagePointerTool | undefined>(
    () =>
      wallDrawing
        ? {
            onDown: (point, m) => feedWall({ type: "down", point, shift: m.shift }),
            onMove: (point, m) => {
              const config = wallConfigRef.current;
              setWallHover(config ? snapWallPoint(point, config, m.shift) : point);
              feedWall({ type: "move", point, shift: m.shift });
            },
            onUp: (point, m) => feedWall({ type: "up", point, shift: m.shift }),
            onDoubleClick: (point, m) => feedWall({ type: "double", point, shift: m.shift }),
          }
        : undefined,
    [wallDrawing, feedWall]
  );
  const wallPreview = useMemo(
    () => (wallDrawing ? wallGesturePreview(wallGesture) : null),
    [wallDrawing, wallGesture]
  );
  /** Where a dragged end handle lands: snapped like a drawn point. */
  const snapWallEnd = useCallback((point: Point, m: PointerModifiers) => {
    const config = wallConfigRef.current;
    return config ? snapWallPoint(point, config, m.shift) : point;
  }, []);
  // Centre on a segment when asked (T103: the panel's door list). Only a
  // new request moves the view; the segment's later moves do not.
  const wallFocus = walls?.focus;
  const focusedNonce = useRef<number | null>(null);
  useEffect(() => {
    if (!wallFocus || focusedNonce.current === wallFocus.nonce) return;
    focusedNonce.current = wallFocus.nonce;
    const segment = findWall(sceneRef.current, wallFocus.id);
    if (!segment || size.width === 0 || size.height === 0) return;
    const middle = { x: (segment.x1 + segment.x2) / 2, y: (segment.y1 + segment.y2) / 2 };
    setViewport((v) => centerOn(v, middle, size));
  }, [wallFocus, size]);

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

  // ---- vision preview (T106) ----------------------------------------------------
  // The latest drag position waits in a ref; one animation frame turns it
  // into the polygon, however many moves arrived meanwhile.
  const [visionPreview, setVisionPreview] = useState<number[] | null>(null);
  const visionDragRef = useRef<{ id: string; topLeft: TokenPoint } | null>(null);
  const visionFrameRef = useRef<number | null>(null);
  const endVisionPreview = useCallback(() => {
    visionDragRef.current = null;
    if (visionFrameRef.current !== null) {
      cancelAnimationFrame(visionFrameRef.current);
      visionFrameRef.current = null;
    }
    setVisionPreview(null);
  }, []);
  const previewVision = useCallback((id: string, topLeft: TokenPoint) => {
    visionDragRef.current = { id, topLeft };
    if (visionFrameRef.current !== null) return;
    visionFrameRef.current = requestAnimationFrame(() => {
      visionFrameRef.current = null;
      const drag = visionDragRef.current;
      const target = sceneRef.current;
      const token = drag ? target?.tokens.find((t) => t.id === drag.id) : undefined;
      const points =
        drag && target && token ? tokenVisionPolygon(target, { ...token, ...drag.topLeft }) : [];
      setVisionPreview(points.length >= 6 ? points : null);
    });
  }, []);
  useEffect(
    () => () => {
      if (visionFrameRef.current !== null) cancelAnimationFrame(visionFrameRef.current);
    },
    []
  );
  useEffect(() => {
    endVisionPreview();
  }, [sceneId, endVisionPreview]);

  const pointerTool = alignTool ?? fogTool ?? drawTool ?? noteTool ?? wallTool;
  // While Space is held nothing but the stage may take a drag (T018).
  const tokensDraggable = pointerTool || spaceHeld ? undefined : tokens;
  const tokenTool = useMemo<TokenTool | undefined>(
    () =>
      tokensDraggable
        ? {
            ...tokensDraggable,
            onDragMove: previewVision,
            onMove: (id: string, topLeft: TokenPoint) => {
              endVisionPreview();
              tokensDraggable.onMove(id, topLeft);
            },
          }
        : undefined,
    [tokensDraggable, previewVision, endVisionPreview]
  );
  useEffect(() => {
    if (!tokensDraggable) endVisionPreview();
  }, [tokensDraggable, endVisionPreview]);
  const visionPreviewShape = useMemo<FogShape | null>(
    () => (visionPreview ? { kind: "polygon", points: visionPreview } : null),
    [visionPreview]
  );
  const wallsInteractive = walls !== undefined && !pointerTool && !spaceHeld;
  // Doors answer clicks under every tool but those that click on grid
  // corners, where doors end: the wall tools and alignment (T103).
  const doorsClickable = walls !== undefined && !wallDrawing && !aligning && !spaceHeld;
  const dragging = gesture.phase === "dragging";
  const strokeDragging = stroke.phase === "dragging";
  const playerRectDraggable = isScaleLocked(presentation) && !pointerTool && !spaceHeld;
  const underlay =
    playerView && playerRect && scene ? (
      <PlayerViewportHandle
        rect={playerRect}
        draggable={playerRectDraggable}
        map={scene}
        onMove={movePlayerCenter}
      />
    ) : undefined;
  const controls =
    playerView && playerRect && scene ? (
      <>
        <WallLayer
          walls={scene.walls}
          scale={scale}
          interactive={wallsInteractive}
          doorsClickable={doorsClickable}
          selectedId={wallSelectedId}
          onSelect={walls?.onSelect}
          onToggleDoor={walls?.onToggleDoor}
          snapPoint={snapWallEnd}
          onMoveEndpoint={walls?.onMoveEndpoint}
        />
        <PlayerViewportFrame
          rect={playerRect}
          rotation={playerView.rotation}
          scale={scale}
          draggable={playerRectDraggable}
        />
        {notes &&
          sceneNotes.map((note) => (
            <NoteMarker
              key={note.id}
              note={note}
              scale={scale}
              selected={note.id === notes.selectedId}
              draggable={!spaceHeld}
              onSelect={notes.onSelect}
              onMove={notes.onMove}
            />
          ))}
      </>
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
  ) : drawing && drawSettings ? (
    <>
      {strokePreview && strokePreview.kind === "stroke" && (
        <FogShapeNodes shape={strokePreview} style={{ fill: drawSettings.color }} />
      )}
      {drawSettings.mode === "erase" && drawHover && (
        <Circle
          x={drawHover.x}
          y={drawHover.y}
          radius={eraserRadius}
          stroke="#f66"
          strokeWidth={1}
          strokeScaleEnabled={false}
          dash={[4, 4]}
          listening={false}
        />
      )}
    </>
  ) : wallDrawing && wallSettings ? (
    <>
      {wallGesture.phase === "drawing" &&
        wallGesture.vertices.map((v, i) => (
          <Circle
            key={i}
            x={v.x}
            y={v.y}
            radius={4 / scale}
            fill={WALL_COLOR}
            listening={false}
          />
        ))}
      {wallPreview && (
        <Line
          name="wall-preview"
          points={[wallPreview.from.x, wallPreview.from.y, wallPreview.to.x, wallPreview.to.y]}
          stroke={wallSettings.tool === "door" ? DOOR_COLOR : WALL_COLOR}
          strokeWidth={WALL_STROKE_PX}
          strokeScaleEnabled={false}
          lineCap="round"
          opacity={0.8}
          listening={false}
        />
      )}
      {wallHover && (
        <Circle
          name="wall-snap-cursor"
          x={wallHover.x}
          y={wallHover.y}
          radius={WALL_SNAP_PX / 2 / scale}
          stroke={WALL_COLOR}
          strokeWidth={1.5}
          strokeScaleEnabled={false}
          listening={false}
        />
      )}
    </>
  ) : visionPreviewShape ? (
    <FogShapeNodes name="vision-preview" shape={visionPreviewShape} style={PREVIEW_TINT.reveal} />
  ) : undefined;
  const fogOverlay =
    fogging && settings?.mode === "reveal" && preview ? (
      <FogShapeNodes shape={preview} style={PUNCH_THROUGH} />
    ) : visionPreviewShape ? (
      <FogShapeNodes name="vision-preview-reveal" shape={visionPreviewShape} style={PUNCH_THROUGH} />
    ) : undefined;
  // The preview lifts the dim too (T107), so what the token would see reads as seen.
  const dimOverlay = visionPreviewShape ? (
    <FogShapeNodes name="vision-preview-lit" shape={visionPreviewShape} style={PUNCH_THROUGH} />
  ) : undefined;

  const fogHint = !settings
    ? ""
    : settings.tool === "brush"
      ? "paint over the area (a click paints one dot)."
      : settings.tool === "rect"
        ? "drag across the area."
        : settings.tool === "lasso"
          ? "drag around the area; letting go closes the shape."
          : fillRoom === "too-large"
            ? "too large from here: draw the room's walls first."
            : "click inside a room; the fill stops at walls and closed doors.";
  const onSurfaceLeave = useCallback(() => {
    onMouseLeave();
    setFillCell(null);
  }, [onMouseLeave]);

  return (
    <div
      ref={containerRef}
      data-testid="dm-canvas-surface"
      data-map-size={scene ? `${scene.width},${scene.height}` : ""}
      data-map-rotation={scene?.imageRotation ?? ""}
      data-aligning={aligning ? "true" : "false"}
      data-fogging={fogging && settings ? settings.mode : "false"}
      data-fog-tool={fogging && settings ? settings.tool : "none"}
      data-fog-gesture={dragging ? "dragging" : "idle"}
      data-fill-preview={
        !filling ? "none" : fillRoom === "too-large" ? "too-large" : fillRoom && fillRoom.length > 0 ? "room" : "none"
      }
      data-fill-cell={filling && fillCell ? `${fillCell.column},${fillCell.row}` : ""}
      data-player-center={playerView ? `${playerView.center.x},${playerView.center.y}` : ""}
      data-player-rect={
        playerRect
          ? [playerRect.x, playerRect.y, playerRect.width, playerRect.height]
              .map((n) => Math.round(n))
              .join(",")
          : ""
      }
      data-player-rotation={playerView?.rotation ?? 0}
      data-player-draggable={underlay && playerRectDraggable ? "true" : "false"}
      data-token-tool={tokenTool ? "active" : "none"}
      data-drawing={drawing && drawSettings ? drawSettings.mode : "false"}
      data-draw-gesture={strokeDragging ? "dragging" : "idle"}
      data-note-tool={placingNote ? "placing" : "none"}
      data-note-open={openNote?.id ?? ""}
      data-notes={sceneNotes.length}
      data-walls={scene?.walls.length ?? 0}
      data-doors-open={scene ? openDoorsOf(scene.walls).length : 0}
      data-door-labels={JSON.stringify(
        scene ? doorsOf(scene.walls).map((door, i) => doorDisplayName(door, doorLabelText(i + 1))) : []
      )}
      data-doors-clickable={doorsClickable ? "true" : "false"}
      data-wall-segments={scene ? wallSegmentsAttribute(scene.walls) : ""}
      data-wall-tool={wallDrawing && wallSettings ? wallSettings.tool : "none"}
      data-wall-gesture={wallGesture.phase}
      data-wall-snap={wallSettings?.snap ? "true" : "false"}
      data-wall-selected={wallSelectedId ?? ""}
      data-pan-override={spaceHeld ? "space" : "none"}
      data-vision-preview={visionPreview ? visionPreview.length / 2 : 0}
      data-turn-ring={turnToken?.id ?? ""}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onSurfaceLeave}
      style={{
        ...styles.root,
        cursor: spaceHeld
          ? "grab"
          : aligning || fogging || drawing || placingNote || wallDrawing
            ? "crosshair"
            : undefined,
      }}
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
            panOverride={spaceHeld}
            overlay={overlay}
            fogOverlay={fogOverlay}
            dimOverlay={dimOverlay}
            controls={controls}
            underlay={underlay}
            fogBase={fogBase}
            tokenImages={tokenImages}
            tokenTool={tokenTool}
            turnTokenId={turnTokenId}
            pings={pings}
            onAltClick={onPing}
            data-testid="dm-map-stage"
          />
          {openNote && openNoteScreen && notes && (
            <div
              data-testid="note-popover"
              data-note-id={openNote.id}
              role="dialog"
              aria-label="Note"
              style={{
                ...styles.notePopover,
                left: openNoteScreen.x + NOTE_POPOVER_OFFSET.x,
                top: openNoteScreen.y + NOTE_POPOVER_OFFSET.y,
              }}
            >
              <textarea
                data-testid="note-text"
                aria-label="Note text"
                placeholder="Only you can see this note."
                value={openNote.text}
                autoFocus
                onChange={(e) => notes.onTextChange(openNote.id, e.target.value)}
                style={styles.noteText}
              />
              <div style={{ display: "flex", gap: 6, justifyContent: "space-between" }}>
                <button
                  type="button"
                  data-testid="note-popover-delete"
                  onClick={() => notes.onDelete(openNote.id)}
                >
                  Delete note
                </button>
                <button
                  type="button"
                  data-testid="note-popover-close"
                  onClick={() => notes.onSelect(null)}
                >
                  Close
                </button>
              </div>
            </div>
          )}
          {drawing && drawSettings && (
            <div data-testid="draw-hint" role="status" style={styles.drawHint}>
              <strong>{drawSettings.mode === "erase" ? "Eraser:" : "Draw:"}</strong>{" "}
              {drawSettings.mode === "erase"
                ? "drag over a stroke to remove it."
                : `drag to draw (${drawSettings.visibility === "all" ? "both views" : "DM only"}).`}{" "}
              Esc {strokeDragging ? "abandons this stroke" : "stops"}.
            </div>
          )}
          {placingNote && (
            <div data-testid="note-hint" role="status" style={styles.drawHint}>
              <strong>Pin a note:</strong> click where it belongs on the map. Esc cancels.
            </div>
          )}
          {wallDrawing && wallSettings && (
            <div data-testid="wall-hint" role="status" style={styles.fogHint}>
              <strong>{WALL_TOOL_LABELS[wallSettings.tool]}:</strong>{" "}
              {wallSettings.tool === "wall"
                ? "click each corner in turn; double-click the last one to finish."
                : "drag across the doorway."}{" "}
              {wallSettings.snap ? "Points snap to grid corners (hold Shift to skip). " : ""}
              Esc {wallGesture.phase !== "idle" ? "ends this one" : "stops"}.
            </div>
          )}
          {fogging && settings && (
            <div data-testid="fog-hint" role="status" style={styles.fogHint}>
              <strong>
                {settings.mode === "reveal" ? "Reveal" : "Hide"}{" "}
                {settings.tool === "fill"
                  ? "a room (whole cells)"
                  : `with the ${FOG_TOOL_LABELS[settings.tool].toLowerCase()}${settings.snap ? " (whole cells)" : ""}`}:
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
