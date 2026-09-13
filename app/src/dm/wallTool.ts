/**
 * The wall tools' settings (T102): which of the two tools the Walls tab
 * arms — the wall polyline or the door — and whether placed points snap to
 * grid corners. DM-only UI state held by `DmView`, read by the panel and
 * the canvas; nothing here is in the store.
 */
import { WALL_KINDS, type WallKind } from "../state/walls";

export interface WallToolSettings {
  tool: WallKind;
  /** Snap placed points (and dragged endpoints) to grid corners; Shift skips it for one point. */
  snap: boolean;
}

export const DEFAULT_WALL_TOOL_SETTINGS: WallToolSettings = { tool: "wall", snap: true };

export const WALL_TOOL_KINDS: readonly WallKind[] = WALL_KINDS;

export const WALL_TOOL_LABELS: Record<WallKind, string> = { wall: "Wall", door: "Door" };

/** Screen pixels: a point this close to a grid corner lands on it. */
export const WALL_SNAP_PX = 12;
/** Screen pixels: press-release travel under which a press is a click, and two vertices are one. */
export const WALL_CLICK_THRESHOLD_PX = 6;
