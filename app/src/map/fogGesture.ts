/**
 * The fog tools' pointer gesture as a pure state machine (T008): press,
 * drag, release in map pixels → one `FogShape`, or nothing. `DmCanvas`
 * feeds it stage events and draws `gestureShape` as the live preview; the
 * same finalisation runs on release, so what is previewed is what is
 * committed.
 *
 * - **brush**: the path of the drag becomes a `stroke` of `radius`; points
 *   closer than `minStep` to the last kept point are skipped (a 60 fps drag
 *   would otherwise record a vertex per pixel). A click is a single-point
 *   stroke, i.e. a disc.
 * - **rect**: the box from press to release; nothing when either side is
 *   under `minDrag` (a click).
 * - **lasso**: the drag path closed into a `polygon`; nothing with fewer than
 *   three kept points or a box under `minDrag` either way.
 *
 * `minStep` and `minDrag` are in map pixels; callers divide screen-pixel
 * thresholds by the viewport scale.
 */
import { polygonShape, rectShape, strokeShape, type FogShape } from "../state/fog";
import type { Point } from "./viewport";

export type FogToolKind = "brush" | "rect" | "lasso";

export const FOG_TOOL_KINDS: readonly FogToolKind[] = ["brush", "rect", "lasso"];

export interface FogGestureConfig {
  tool: FogToolKind;
  /** Brush radius in map pixels. */
  radius: number;
  /** Minimum distance between kept path points, map pixels. */
  minStep: number;
  /** Smallest box (either side) a rect / lasso gesture may produce, map pixels. */
  minDrag: number;
}

export type FogGestureState =
  | { phase: "idle" }
  | {
      phase: "dragging";
      tool: FogToolKind;
      start: Point;
      current: Point;
      /** Kept path points, flat, for brush and lasso. */
      points: number[];
    };

export const IDLE_FOG_GESTURE: FogGestureState = { phase: "idle" };

export type FogGestureEvent =
  | { type: "down"; point: Point }
  | { type: "move"; point: Point }
  | { type: "up"; point: Point }
  | { type: "cancel" };

export interface FogGestureStep {
  state: FogGestureState;
  /** Present on a release that produced a shape. */
  shape?: FogShape;
}

function farEnough(points: readonly number[], p: Point, minStep: number): boolean {
  if (points.length < 2) return true;
  const lx = points[points.length - 2];
  const ly = points[points.length - 1];
  return Math.hypot(p.x - lx, p.y - ly) >= minStep;
}

function withPoint(points: readonly number[], p: Point, minStep: number): number[] {
  return farEnough(points, p, minStep) ? [...points, p.x, p.y] : [...points];
}

/** The shape a drag would produce if released at `point`; null for none. */
export function finalizeFogGesture(
  state: FogGestureState,
  point: Point,
  config: FogGestureConfig
): FogShape | null {
  if (state.phase !== "dragging") return null;
  switch (state.tool) {
    case "brush":
      return strokeShape(withPoint(state.points, point, config.minStep), config.radius);
    case "rect": {
      const rect = rectShape(state.start, point);
      if (rect.width < config.minDrag || rect.height < config.minDrag) return null;
      return rect;
    }
    case "lasso": {
      const points = withPoint(state.points, point, config.minStep);
      if (points.length < 6) return null;
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (let i = 0; i < points.length; i += 2) {
        minX = Math.min(minX, points[i]);
        maxX = Math.max(maxX, points[i]);
        minY = Math.min(minY, points[i + 1]);
        maxY = Math.max(maxY, points[i + 1]);
      }
      if (maxX - minX < config.minDrag || maxY - minY < config.minDrag) return null;
      return polygonShape(points);
    }
  }
}

/** The live preview: what the gesture would commit right now. */
export function gestureShape(state: FogGestureState, config: FogGestureConfig): FogShape | null {
  return state.phase === "dragging" ? finalizeFogGesture(state, state.current, config) : null;
}

export function reduceFogGesture(
  state: FogGestureState,
  event: FogGestureEvent,
  config: FogGestureConfig
): FogGestureStep {
  switch (event.type) {
    case "down":
      return {
        state: {
          phase: "dragging",
          tool: config.tool,
          start: event.point,
          current: event.point,
          points: [event.point.x, event.point.y],
        },
      };
    case "move":
      if (state.phase !== "dragging") return { state };
      return {
        state: {
          ...state,
          current: event.point,
          points:
            state.tool === "rect"
              ? state.points
              : withPoint(state.points, event.point, config.minStep),
        },
      };
    case "up": {
      if (state.phase !== "dragging") return { state };
      const shape = finalizeFogGesture(state, event.point, config);
      return shape ? { state: IDLE_FOG_GESTURE, shape } : { state: IDLE_FOG_GESTURE };
    }
    case "cancel":
      return { state: IDLE_FOG_GESTURE };
  }
}
