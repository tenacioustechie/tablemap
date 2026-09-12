/**
 * The grid alignment tool's interaction, as a pure state machine over
 * pointer events in map coordinates. The DM either drags from one corner of
 * a printed square to the opposite corner, or clicks one corner and then
 * the other; both end with `alignGridToSquare(first, second)`.
 *
 *   idle      --down--> dragging(first = p)
 *   dragging  --move--> dragging (preview follows the pointer)
 *   dragging  --up-->   done, if the pointer travelled at least `minDrag`
 *                       (a real drag); otherwise second(first) — it was a click
 *   second    --move--> second (preview follows the pointer)
 *   second    --down--> done
 *   any       --cancel--> idle
 *
 * `minDrag` is in map pixels; callers convert a screen-pixel threshold with
 * the current viewport scale so the click/drag distinction feels the same at
 * every zoom.
 */
import { alignGridToSquare } from "./grid";
import type { Point } from "./viewport";
import type { GridGeometry } from "../state/model";

export type AlignmentState =
  | { phase: "idle" }
  /** Button held since the first corner. */
  | { phase: "dragging"; first: Point; current: Point }
  /** First corner placed by a click; waiting for the second click. */
  | { phase: "second"; first: Point; current: Point | null };

export type AlignmentEvent =
  | { type: "down"; point: Point }
  | { type: "move"; point: Point }
  | { type: "up"; point: Point; minDrag: number }
  | { type: "cancel" };

export interface AlignmentStep {
  state: AlignmentState;
  /** Set when this event completed the tool: both corners are known. */
  result?: { first: Point; second: Point; geometry: GridGeometry | null };
}

export const IDLE_ALIGNMENT: AlignmentState = { phase: "idle" };

/** Screen-pixel travel below which a press-release counts as a click. */
export const ALIGN_CLICK_THRESHOLD_PX = 6;

function finish(first: Point, second: Point): AlignmentStep {
  return {
    state: IDLE_ALIGNMENT,
    result: { first, second, geometry: alignGridToSquare(first, second) },
  };
}

export function reduceAlignment(
  state: AlignmentState,
  event: AlignmentEvent
): AlignmentStep {
  if (event.type === "cancel") return { state: IDLE_ALIGNMENT };
  if (state.phase === "idle") {
    if (event.type === "down") {
      return { state: { phase: "dragging", first: event.point, current: event.point } };
    }
    return { state };
  }
  if (event.type === "move") return { state: { ...state, current: event.point } };
  if (event.type === "down") {
    // In "second" this is the second click. In "dragging" the release
    // happened off-stage; treat this press as the second corner anyway.
    return finish(state.first, event.point);
  }
  // up
  if (state.phase === "second") return { state };
  const travelled = Math.hypot(event.point.x - state.first.x, event.point.y - state.first.y);
  return travelled >= event.minDrag
    ? finish(state.first, event.point)
    : { state: { phase: "second", first: state.first, current: null } };
}

/** The box to preview: from the first corner to the pointer, if both are known. */
export function alignmentBox(
  state: AlignmentState
): { first: Point; second: Point } | null {
  if (state.phase === "idle" || state.current === null) return null;
  return { first: state.first, second: state.current };
}
