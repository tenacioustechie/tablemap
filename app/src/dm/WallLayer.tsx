/**
 * The DM canvas's rendering of a scene's walls and doors (T101, ADR 0024):
 * DM chrome, drawn in the stage's *controls* layer by `DmCanvas` — never by
 * the shared stage — so nothing in `map/` or `player/` can put a wall on
 * the TV (`player/boundary.test.ts` keeps this module out of both). The
 * segments themselves are shared state (the player needs them for vision);
 * only this picture of them is DM-only.
 *
 * Walls are solid orange lines. A door has its own colour (T103): closed,
 * it is a solid short bar across the doorway; open, the bar is swung
 * `OPEN_DOOR_SWING_DEG` off the doorway as a thin outline (`door-leaf`),
 * with the doorway itself left as a faint dashed line so the DM still sees
 * — and can click — where the door is. Stroke widths are screen pixels
 * (`strokeScaleEnabled` off) so a wall is as easy to see zoomed out as
 * zoomed in.
 *
 * **Selection and editing** (T102): while `interactive` (no canvas tool
 * armed, Space up) every segment answers a click with `onSelect`, generous
 * to the pointer (`WALL_HIT_PX` screen pixels wide: with `strokeScaleEnabled`
 * off Konva draws the hit stroke unscaled too). The selected segment is
 * highlighted and gets a draggable handle on each end; a handle follows the
 * pointer through `snapPoint` (the canvas snaps it to grid corners unless
 * Shift is held) with the segment redrawn live, and the drop calls
 * `onMoveEndpoint` — the caller commits it as one `map/wall-set`.
 *
 * **Doors in play** (T103, ADR 0024): while `doorsClickable`, a door's node
 * listens whatever else is going on — the fog brush or the pen may be
 * armed — and a click calls `onToggleDoor` *instead of* `onSelect`: picking
 * a door to edit it must not open it (the Walls panel's door list selects
 * doors). A press that starts on the door is `cancelBubble`d, and so is its
 * release, so the stage's tool never sees that click, the way note markers
 * stay clickable under every tool (T011); a drag that merely ends on a door
 * still reaches the tool. An Alt-click (a ping) and a non-primary button (a
 * middle-button pan) are left to the stage.
 *
 * **Door labels** (ADR 0028): every door carries a small screen-sized tag,
 * `D1`, `D2`, … numbered in the same order as the Walls panel's door list
 * ("Door 1", "Door 2", …), set off to one side of the doorway's middle so
 * it never hides the door. The tags are drawn above every segment and do
 * not listen, so a click goes to the door (or the tool) underneath. Like
 * the walls themselves they are DM chrome: the player never sees them.
 * A door the DM has named (ADR 0030) shows its name instead of `Dn`; the
 * tag grows to fit it.
 */
import { useRef, useState } from "react";
import type { KonvaEventObject } from "konva/lib/Node";
import Konva from "konva";
import { Circle, Group, Line, Rect, Text } from "react-konva";
import { rotateVector, type Point } from "../map/viewport";
import { doorDisplayName, doorsOf, type DoorSegment, type WallSegment } from "../state/walls";

/** One colour for walls, distinct from every other canvas chrome. */
export const WALL_COLOR = "#ff9d2e";
/** The door colour (T103): a door reads differently from the wall it sits in. */
export const DOOR_COLOR = "#5ee6b0";
/** Screen pixels. */
export const WALL_STROKE_PX = 3;
/** Screen pixels: a closed door is a solid bar, thicker than a wall (T103). */
export const DOOR_STROKE_PX = 6;
/** Screen pixels: an open door's swung leaf, and the faint doorway under it. */
export const OPEN_DOOR_STROKE_PX = 1.5;
/** The faint dashed line left across the doorway of an open door. */
export const DOOR_DASH: readonly number[] = [8, 6];
export const OPEN_DOORWAY_OPACITY = 0.45;
/** Degrees clockwise the leaf of an open door is swung about its first end (T103). */
export const OPEN_DOOR_SWING_DEG = 45;
/** Screen pixels: how wide a segment is to the pointer (T102). */
export const WALL_HIT_PX = 12;
/** The selected segment's halo (T102). */
export const WALL_SELECTED_COLOR = "#fff";
export const WALL_SELECTED_STROKE_PX = 9;
/** Screen pixels: the end handles of the selected segment (T102). */
export const WALL_HANDLE_RADIUS_PX = 6;

/** Door labels (ADR 0028): screen pixels. */
export const DOOR_LABEL_FONT_PX = 11;
export const DOOR_LABEL_HEIGHT_PX = 16;
/** How far the label's centre sits off the doorway's middle, perpendicular to it. */
export const DOOR_LABEL_OFFSET_PX = 14;
export const DOOR_LABEL_TEXT_COLOR = "#0b1a14";

export type WallEnd = "start" | "end";

export interface WallPointerModifiers {
  shift: boolean;
}

export interface WallLayerProps {
  walls: readonly WallSegment[];
  /** Stage scale: the end handles are screen-sized. */
  scale?: number;
  /** While true, segments answer clicks and the selected one's ends can be dragged. */
  interactive?: boolean;
  /** While true, a click on a door toggles it whatever else is armed (T103). */
  doorsClickable?: boolean;
  selectedId?: string | null;
  onSelect?: (id: string) => void;
  /** A door was clicked (T103): the caller flips its `open`. */
  onToggleDoor?: (id: string) => void;
  /** Where a dragged end lands (snapping is the caller's); identity by default. */
  snapPoint?: (point: Point, modifiers: WallPointerModifiers) => Point;
  /** The selected segment's end was dropped at `point` (already through `snapPoint`). */
  onMoveEndpoint?: (id: string, end: WallEnd, point: Point) => void;
}

/** A handle drag in progress: the end being moved and where it is now. */
interface EndDrag {
  id: string;
  end: WallEnd;
  point: Point;
}

function setCursor(e: KonvaEventObject<MouseEvent>, cursor: string) {
  const container = e.target.getStage()?.container();
  if (container) container.style.cursor = cursor;
}

function shiftOf(e: KonvaEventObject<Event>): WallPointerModifiers {
  const evt = e.evt as MouseEvent | undefined;
  return { shift: evt?.shiftKey === true };
}

function altOf(e: KonvaEventObject<Event>): boolean {
  const evt = e.evt as MouseEvent | undefined;
  return evt?.altKey === true;
}

/** A touch, or the main mouse button (not a middle-button pan). */
function primaryOf(e: KonvaEventObject<Event>): boolean {
  const evt = e.evt as MouseEvent | undefined;
  return typeof evt?.button !== "number" || evt.button === 0;
}

/** The segment's endpoints, with a dragged end where the pointer has it. */
function endpointsOf(segment: WallSegment, drag: EndDrag | null): [Point, Point] {
  const a = { x: segment.x1, y: segment.y1 };
  const b = { x: segment.x2, y: segment.y2 };
  if (!drag || drag.id !== segment.id) return [a, b];
  return drag.end === "start" ? [drag.point, b] : [a, drag.point];
}

/**
 * The leaf of an open door: the doorway segment swung `OPEN_DOOR_SWING_DEG`
 * clockwise about its first end (the hinge), the same length. Pure.
 */
export function openDoorLeaf(from: Point, to: Point, degrees = OPEN_DOOR_SWING_DEG): [Point, Point] {
  const swung = rotateVector({ x: to.x - from.x, y: to.y - from.y }, degrees);
  return [from, { x: from.x + swung.x, y: from.y + swung.y }];
}

/** The canvas label of the n-th door (1-based), matching the Walls panel's "Door n". */
export function doorLabelText(ordinal: number): string {
  return `D${ordinal}`;
}

/** Screen pixels of padding either side of a label's text. */
export const DOOR_LABEL_PADDING_PX = 4;

let measureNode: Konva.Text | null = null;

/**
 * How wide a door tag is, in screen pixels: its text's measured width (bold,
 * `DOOR_LABEL_FONT_PX`) plus padding, never narrower than a `D1` tag. Falls
 * back to an estimate where text cannot be measured (no canvas).
 */
export function doorLabelWidth(text: string): number {
  let measured = 0;
  try {
    measureNode ??= new Konva.Text({ fontSize: DOOR_LABEL_FONT_PX, fontStyle: "bold", fontFamily: "system-ui, sans-serif" });
    measureNode.text(text);
    measured = measureNode.width();
  } catch {
    measured = 0;
  }
  const textWidth = Number.isFinite(measured) && measured > 0 ? measured : text.length * 7;
  return Math.max(22, Math.ceil(textWidth) + DOOR_LABEL_PADDING_PX * 2);
}

/**
 * Where a door's label is centred, in map pixels: the doorway's middle,
 * pushed `DOOR_LABEL_OFFSET_PX` screen pixels along the doorway's normal
 * (the side that points up the screen, or left for a vertical doorway, so
 * labels sit consistently). A zero-length doorway gets its own point. Pure.
 */
export function doorLabelPosition(from: Point, to: Point, scale = 1): Point {
  const mid = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy);
  if (length === 0) return mid;
  let nx = -dy / length;
  let ny = dx / length;
  if (ny > 0 || (ny === 0 && nx > 0)) {
    nx = -nx;
    ny = -ny;
  }
  const offset = DOOR_LABEL_OFFSET_PX / (scale > 0 ? scale : 1);
  return { x: mid.x + nx * offset, y: mid.y + ny * offset };
}

/** One door's tag; `id` is `door-label-<segment id>`, `name` is `door-label`. */
function DoorLabel({
  door,
  ordinal,
  scale,
  drag,
}: {
  door: DoorSegment;
  ordinal: number;
  scale: number;
  drag: EndDrag | null;
}) {
  const [a, b] = endpointsOf(door, drag);
  const at = doorLabelPosition(a, b, scale);
  const text = doorDisplayName(door, doorLabelText(ordinal));
  const width = doorLabelWidth(text);
  const inverse = 1 / (scale > 0 ? scale : 1);
  return (
    <Group
      name="door-label"
      id={`door-label-${door.id}`}
      x={at.x}
      y={at.y}
      scaleX={inverse}
      scaleY={inverse}
      listening={false}
    >
      <Rect
        x={-width / 2}
        y={-DOOR_LABEL_HEIGHT_PX / 2}
        width={width}
        height={DOOR_LABEL_HEIGHT_PX}
        cornerRadius={4}
        fill={DOOR_COLOR}
        opacity={door.open ? 0.7 : 0.95}
      />
      <Text
        x={-width / 2}
        y={-DOOR_LABEL_HEIGHT_PX / 2}
        width={width}
        height={DOOR_LABEL_HEIGHT_PX}
        text={text}
        align="center"
        verticalAlign="middle"
        fontSize={DOOR_LABEL_FONT_PX}
        fontStyle="bold"
        fontFamily="system-ui, sans-serif"
        fill={DOOR_LABEL_TEXT_COLOR}
      />
    </Group>
  );
}

export interface WallNodeProps {
  segment: WallSegment;
  interactive?: boolean;
  doorsClickable?: boolean;
  selected?: boolean;
  onSelect?: (id: string) => void;
  onToggleDoor?: (id: string) => void;
  /** The end of this segment being dragged, if any. */
  drag?: EndDrag | null;
}

/**
 * One segment as a Konva node; `id` is `wall-<segment id>`, `name` is
 * `wall` (plus `door` for a door). An open door adds a non-listening
 * `door-leaf` line for the swung bar.
 */
export function WallNode({
  segment,
  interactive = false,
  doorsClickable = false,
  selected = false,
  onSelect,
  onToggleDoor,
  drag = null,
}: WallNodeProps) {
  const isDoor = segment.kind === "door";
  const open = isDoor && segment.open;
  const clickable = isDoor && doorsClickable;
  const listening = interactive || clickable;
  const [a, b] = endpointsOf(segment, drag);
  const points = [a.x, a.y, b.x, b.y];
  // Whether the press in progress started on this door: its release is then
  // the door's too, and the stage's tool must not see either (T103).
  const pressed = useRef(false);
  const press = (e: KonvaEventObject<Event>) => {
    if (!clickable || altOf(e) || !primaryOf(e)) return;
    e.cancelBubble = true;
    pressed.current = true;
    // A release off the door never reaches this node; forget the press then.
    const releaseType = e.evt?.type.startsWith("touch") ? "touchend" : "mouseup";
    window.addEventListener(
      releaseType,
      () => {
        setTimeout(() => {
          pressed.current = false;
        }, 0);
      },
      { once: true }
    );
  };
  const release = (e: KonvaEventObject<Event>) => {
    if (pressed.current) e.cancelBubble = true;
    pressed.current = false;
  };
  const click = (e: KonvaEventObject<Event>) => {
    if (altOf(e) || !primaryOf(e)) return; // a ping or a pan, not a selection or a toggle
    if (clickable) {
      e.cancelBubble = true;
      onToggleDoor?.(segment.id);
    } else if (interactive) {
      onSelect?.(segment.id);
    }
  };
  const stroke = isDoor ? DOOR_COLOR : WALL_COLOR;
  const strokeWidth = isDoor ? (open ? OPEN_DOOR_STROKE_PX : DOOR_STROKE_PX) : WALL_STROKE_PX;
  return (
    <>
      {selected && (
        <Line
          name="wall-highlight"
          points={points}
          stroke={WALL_SELECTED_COLOR}
          strokeWidth={WALL_SELECTED_STROKE_PX}
          strokeScaleEnabled={false}
          opacity={0.45}
          lineCap="round"
          listening={false}
        />
      )}
      <Line
        name={isDoor ? "wall door" : "wall"}
        id={`wall-${segment.id}`}
        points={points}
        stroke={stroke}
        strokeWidth={strokeWidth}
        strokeScaleEnabled={false}
        hitStrokeWidth={WALL_HIT_PX}
        dash={open ? [...DOOR_DASH] : undefined}
        opacity={open ? OPEN_DOORWAY_OPACITY : 1}
        lineCap={isDoor && !open ? "butt" : "round"}
        listening={listening}
        onMouseDown={press}
        onMouseUp={release}
        onTouchStart={press}
        onTouchEnd={release}
        onClick={click}
        onTap={click}
        onMouseEnter={(e) => listening && setCursor(e, "pointer")}
        onMouseLeave={(e) => listening && setCursor(e, "")}
      />
      {open && (
        <Line
          name="door-leaf"
          id={`door-leaf-${segment.id}`}
          points={openDoorLeaf(a, b).flatMap((p) => [p.x, p.y])}
          stroke={DOOR_COLOR}
          strokeWidth={OPEN_DOOR_STROKE_PX}
          strokeScaleEnabled={false}
          lineCap="round"
          listening={false}
        />
      )}
    </>
  );
}

function EndHandle({
  segment,
  end,
  scale,
  interactive,
  snapPoint,
  onDrag,
  onDrop,
}: {
  segment: WallSegment;
  end: WallEnd;
  scale: number;
  interactive: boolean;
  snapPoint: (point: Point, modifiers: WallPointerModifiers) => Point;
  onDrag: (drag: EndDrag) => void;
  onDrop: (drag: EndDrag) => void;
}) {
  const x = end === "start" ? segment.x1 : segment.x2;
  const y = end === "start" ? segment.y1 : segment.y2;
  const settle = (e: KonvaEventObject<DragEvent>): EndDrag => {
    const node = e.target as Konva.Circle;
    const point = snapPoint(node.position(), shiftOf(e));
    node.position(point);
    return { id: segment.id, end, point };
  };
  return (
    <Circle
      name="wall-handle"
      id={`wall-handle-${segment.id}-${end}`}
      x={x}
      y={y}
      radius={WALL_HANDLE_RADIUS_PX / scale}
      fill={segment.kind === "door" ? DOOR_COLOR : WALL_COLOR}
      stroke={WALL_SELECTED_COLOR}
      strokeWidth={2}
      strokeScaleEnabled={false}
      draggable={interactive}
      listening={interactive}
      onDragMove={(e) => onDrag(settle(e))}
      onDragEnd={(e) => onDrop(settle(e))}
      onMouseEnter={(e) => interactive && setCursor(e, "move")}
      onMouseLeave={(e) => interactive && setCursor(e, "")}
    />
  );
}

const identity = (point: Point) => point;

export function WallLayer({
  walls,
  scale = 1,
  interactive = false,
  doorsClickable = false,
  selectedId = null,
  onSelect,
  onToggleDoor,
  snapPoint = identity,
  onMoveEndpoint,
}: WallLayerProps) {
  const [drag, setDrag] = useState<EndDrag | null>(null);
  const selected = selectedId === null ? undefined : walls.find((w) => w.id === selectedId);
  const drop = (done: EndDrag) => {
    setDrag(null);
    onMoveEndpoint?.(done.id, done.end, done.point);
  };
  return (
    <Group name="walls" listening={interactive || doorsClickable}>
      {walls.map((segment) => (
        <WallNode
          key={segment.id}
          segment={segment}
          interactive={interactive}
          doorsClickable={doorsClickable}
          selected={segment.id === selectedId}
          onSelect={onSelect}
          onToggleDoor={onToggleDoor}
          drag={drag}
        />
      ))}
      <Group name="door-labels" listening={false}>
        {doorsOf(walls).map((door, index) => (
          <DoorLabel key={door.id} door={door} ordinal={index + 1} scale={scale} drag={drag} />
        ))}
      </Group>
      {selected && (
        <Group name="wall-handles">
          {(["start", "end"] as const).map((end) => (
            <EndHandle
              key={`${selected.id}-${end}`}
              segment={selected}
              end={end}
              scale={scale}
              interactive={interactive}
              snapPoint={snapPoint}
              onDrag={setDrag}
              onDrop={drop}
            />
          ))}
        </Group>
      )}
    </Group>
  );
}
