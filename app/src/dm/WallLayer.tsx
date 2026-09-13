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
 * as easy to see zoomed out as zoomed in. Read-only for now
 * (`listening={false}`): T102 adds the drawing tools, T103 the click on a
 * door.
 */
import { Group, Line } from "react-konva";
import type { WallSegment } from "../state/walls";

/** One colour for walls and doors, distinct from every other canvas chrome. */
export const WALL_COLOR = "#ff9d2e";
/** Screen pixels. */
export const WALL_STROKE_PX = 3;
export const OPEN_DOOR_STROKE_PX = 1.5;
export const DOOR_DASH: readonly number[] = [8, 6];

export interface WallLayerProps {
  walls: readonly WallSegment[];
}

/** One segment as a Konva node; `id` is `wall-<segment id>`, `name` is `wall`. */
export function WallNode({ segment }: { segment: WallSegment }) {
  const open = segment.kind === "door" && segment.open;
  return (
    <Line
      name="wall"
      id={`wall-${segment.id}`}
      points={[segment.x1, segment.y1, segment.x2, segment.y2]}
      stroke={WALL_COLOR}
      strokeWidth={open ? OPEN_DOOR_STROKE_PX : WALL_STROKE_PX}
      strokeScaleEnabled={false}
      dash={segment.kind === "door" && !open ? [...DOOR_DASH] : undefined}
      lineCap="round"
      listening={false}
    />
  );
}

export function WallLayer({ walls }: WallLayerProps) {
  return (
    <Group name="walls" listening={false}>
      {walls.map((segment) => (
        <WallNode key={segment.id} segment={segment} />
      ))}
    </Group>
  );
}
