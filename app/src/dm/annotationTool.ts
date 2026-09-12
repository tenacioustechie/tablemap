/**
 * The DM's drawing tool settings (T011): pen or eraser, colour, stroke
 * width, and which views see new strokes. DM-only UI state held by
 * `DmView`, read by the annotation panel (to edit) and the canvas (to run
 * the gesture and build the annotation).
 */
import type { AnnotationVisibility } from "../state/model";

export type DrawMode = "draw" | "erase";

export interface DrawToolSettings {
  mode: DrawMode;
  /** CSS colour of new strokes. */
  color: string;
  /** Stroke width of new strokes, in map pixels. */
  strokeWidth: number;
  /** Who sees new strokes: the DM only, or both views. */
  visibility: AnnotationVisibility;
}

export const DRAW_STROKE_WIDTH = { min: 1, max: 40, default: 4 } as const;

/** A few contrasting pen colours; the colour input accepts any other. */
export const DRAW_PALETTE: readonly string[] = [
  "#ff3b30",
  "#ffcc00",
  "#34c759",
  "#5ac8fa",
  "#ffffff",
  "#111111",
];

export const DEFAULT_DRAW_TOOL_SETTINGS: DrawToolSettings = {
  mode: "draw",
  color: DRAW_PALETTE[0],
  strokeWidth: DRAW_STROKE_WIDTH.default,
  visibility: "all",
};

/** Eraser reach in screen pixels; the canvas divides it by the viewport scale. */
export const ERASER_RADIUS_PX = 10;

export const DRAW_VISIBILITY_LABELS: Record<AnnotationVisibility, string> = {
  dm: "DM only",
  all: "Both views",
};

export const DRAW_MODE_LABELS: Record<DrawMode, string> = {
  draw: "Draw",
  erase: "Eraser",
};
