/**
 * The DM's fog tool settings (T008): which tool, which way, how big, and the
 * feather / snap toggles. DM-only UI state held by `DmView`, read by the
 * fog panel (to edit) and the canvas (to run the gesture and build the op).
 * The room fill (T108) is the fourth tool: a click, always whole cells.
 */
import type { FogMode } from "../state/fog";
import { FOG_GESTURE_TOOLS, type FogGestureTool } from "../map/fogGesture";
import { ROOM_FILL_LIMIT } from "../map/roomFill";

/** The fog tools: the three drag gestures of `map/fogGesture.ts`, then the room fill (`map/roomFill.ts`). */
export type FogToolKind = FogGestureTool | "fill";

export const FOG_TOOL_KINDS: readonly FogToolKind[] = [...FOG_GESTURE_TOOLS, "fill"];

export interface FogToolSettings {
  tool: FogToolKind;
  mode: FogMode;
  /** Brush radius in map pixels. */
  radius: number;
  /** Soft edges on (ignored while snapping: cells have hard edges). */
  feather: boolean;
  /** Expand every shape to whole grid cells. */
  snap: boolean;
}

/** Brush radius bounds; `step` is what the `[` / `]` keys change it by (T018). */
export const FOG_BRUSH_RADIUS = { min: 4, max: 400, default: 40, step: 8 } as const;

/** The radius after one `[` (−1) or `]` (+1) press, kept within bounds. */
export function stepBrushRadius(radius: number, direction: -1 | 1): number {
  const next = radius + direction * FOG_BRUSH_RADIUS.step;
  return Math.max(FOG_BRUSH_RADIUS.min, Math.min(FOG_BRUSH_RADIUS.max, next));
}

export const DEFAULT_FOG_TOOL_SETTINGS: FogToolSettings = {
  tool: "brush",
  mode: "reveal",
  radius: FOG_BRUSH_RADIUS.default,
  feather: true,
  snap: false,
};

/** Feather width for a map, in map pixels: about a third of a cell, 4–64 (shared with vision, T106). */
export { fogFeatherPx } from "../state/fog";

/** Whether the tool's shapes get the feather: never while snapping, nor for the fill (whole cells). */
export function fogToolFeathers(settings: Pick<FogToolSettings, "tool" | "feather" | "snap">): boolean {
  return settings.feather && !settings.snap && settings.tool !== "fill";
}

/** Screen-pixel thresholds the canvas divides by the viewport scale. */
export const FOG_MIN_STEP_PX = 3;
export const FOG_MIN_DRAG_PX = 2;

export const FOG_TOOL_LABELS: Record<FogToolKind, string> = {
  brush: "Brush",
  rect: "Rectangle",
  lasso: "Lasso",
  fill: "Fill",
};

/** The panel's warning after a fill that reached more than `ROOM_FILL_LIMIT` cells (T108). */
export const FILL_TOO_LARGE_MESSAGE = `Too large to fill: more than ${ROOM_FILL_LIMIT.toLocaleString("en-US")} cells are reachable from there, so nothing changed. Draw the room's walls (and close its doors) first.`;
