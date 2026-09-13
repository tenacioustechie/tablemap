/**
 * The DM canvas's rendering of a scene's walls and doors (T101, ADR 0024):
 * DM chrome, drawn in the stage's *controls* layer by `DmCanvas` — never by
 * the shared stage — so nothing in `map/` or `player/` can put a wall on
 * the TV (`player/boundary.test.ts` keeps this module out of both). The
 * segments themselves are shared state (the player needs them for vision);
 * only this picture of them is DM-only.
 *
 * Walls are solid lines, closed doors dashed, open doors a thin outline.
 * Stroke widths are screen pixels (`strokeScaleEnabled` off) so a wall is
 * as easy to see zoomed out as zoomed in.
 *
 * **Selection and editing** (T102): while `interactive` (no canvas tool
 * armed, Space up) every segment answers a click with `onSelect`, generous
 * to the pointer (`WALL_HIT_PX` wide). The selected segment is highlighted
 * and gets a draggable handle on each end; a handle follows the pointer
 * through `snapPoint` (the canvas snaps it to grid corners unless Shift is
 * held) with the segment redrawn live, and the drop calls
 * `onMoveEndpoint` — the caller commits it as one `map/wall-set`. T103 adds
 * the click that opens a door.
 */
import { useState } from "react";
import type Konva from "konva";
import type { KonvaEventObject } from "konva/lib/Node";
import { Circle, Group, Line } from "react-konva";
import type { Point } from "../map/viewport";
import type { WallSegment } from "../state/walls";

/** One colour for walls and doors, distinct from every other canvas chrome. */
export const WALL_COLOR = "#ff9d2e";
/** Screen pixels. */
export const WALL_STROKE_PX = 3;
export const OPEN_DOOR_STROKE_PX = 1.5;
export const DOOR_DASH: readonly number[] = [8, 6];
/** Screen pixels: how wide a segment is to the pointer (T102). */
export const WALL_HIT_PX = 12;
/** The selected segment's halo (T102). */
export const WALL_SELECTED_COLOR = "#fff";
export const WALL_SELECTED_STROKE_PX = 9;
/** Screen pixels: the end handles of the selected segment (T102). */
export const WALL_HANDLE_RADIUS_PX = 6;

export type WallEnd = "start" | "end";

export interface WallPointerModifiers {
  shift: boolean;
}

export interface WallLayerProps {
  walls: readonly WallSegment[];
  /** Stage scale: hit widths, the halo and the handles are screen-sized. */
  scale?: number;
  /** While true, segments answer clicks and the selected one's ends can be dragged. */
  interactive?: boolean;
  selectedId?: string | null;
  onSelect?: (id: string) => void;
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

/** The segment's endpoints, with a dragged end where the pointer has it. */
function endpointsOf(segment: WallSegment, drag: EndDrag | null): [Point, Point] {
  const a = { x: segment.x1, y: segment.y1 };
  const b = { x: segment.x2, y: segment.y2 };
  if (!drag || drag.id !== segment.id) return [a, b];
  return drag.end === "start" ? [drag.point, b] : [a, drag.point];
}

export interface WallNodeProps {
  segment: WallSegment;
  scale?: number;
  interactive?: boolean;
  selected?: boolean;
  onSelect?: (id: string) => void;
  /** The end of this segment being dragged, if any. */
  drag?: EndDrag | null;
}

/** One segment as a Konva node; `id` is `wall-<segment id>`, `name` is `wall`. */
export function WallNode({
  segment,
  scale = 1,
  interactive = false,
  selected = false,
  onSelect,
  drag = null,
}: WallNodeProps) {
  const open = segment.kind === "door" && segment.open;
  const [a, b] = endpointsOf(segment, drag);
  const points = [a.x, a.y, b.x, b.y];
  const select = (e: KonvaEventObject<Event>) => {
    const evt = e.evt as MouseEvent | undefined;
    if (evt?.altKey) return; // a ping, not a selection
    onSelect?.(segment.id);
  };
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
        name="wall"
        id={`wall-${segment.id}`}
        points={points}
        stroke={WALL_COLOR}
        strokeWidth={open ? OPEN_DOOR_STROKE_PX : WALL_STROKE_PX}
        strokeScaleEnabled={false}
        hitStrokeWidth={WALL_HIT_PX / scale}
        dash={segment.kind === "door" && !open ? [...DOOR_DASH] : undefined}
        lineCap="round"
        listening={interactive}
        onClick={select}
        onTap={select}
        onMouseEnter={(e) => interactive && setCursor(e, "pointer")}
        onMouseLeave={(e) => interactive && setCursor(e, "")}
      />
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
      fill={WALL_COLOR}
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
  selectedId = null,
  onSelect,
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
    <Group name="walls" listening={interactive}>
      {walls.map((segment) => (
        <WallNode
          key={segment.id}
          segment={segment}
          scale={scale}
          interactive={interactive}
          selected={segment.id === selectedId}
          onSelect={onSelect}
          drag={drag}
        />
      ))}
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
