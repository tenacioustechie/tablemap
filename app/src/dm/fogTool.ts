/**
 * The DM's fog tool settings (T008): which tool, which way, how big, and the
 * feather / snap toggles. DM-only UI state held by `DmView`, read by the
 * fog panel (to edit) and the canvas (to run the gesture and build the op).
 */
import type { FogMode } from "../state/fog";
import type { FogToolKind } from "../map/fogGesture";

export type { FogToolKind } from "../map/fogGesture";
export { FOG_TOOL_KINDS } from "../map/fogGesture";

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

export const FOG_BRUSH_RADIUS = { min: 4, max: 400, default: 40 } as const;

export const DEFAULT_FOG_TOOL_SETTINGS: FogToolSettings = {
  tool: "brush",
  mode: "reveal",
  radius: FOG_BRUSH_RADIUS.default,
  feather: true,
  snap: false,
};

/** Feather width for a map, in map pixels: about a third of a cell, 4–64. */
export function fogFeatherPx(cellSize: number): number {
  const px = cellSize * 0.3;
  return Math.max(4, Math.min(64, Number.isFinite(px) ? px : 4));
}

/** Screen-pixel thresholds the canvas divides by the viewport scale. */
export const FOG_MIN_STEP_PX = 3;
export const FOG_MIN_DRAG_PX = 2;

export const FOG_TOOL_LABELS: Record<FogToolKind, string> = {
  brush: "Brush",
  rect: "Rectangle",
  lasso: "Lasso",
};
